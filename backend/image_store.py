"""Storing uploaded photos.

Every image that ends up on the volume goes through `store_upload()` /
`store_bytes()`: the upload is size-limited while it is read, decoded with
Pillow (photo formats only), turned upright according to its EXIF orientation
and re-encoded as a JPEG under a server-chosen name. Re-encoding writes only the
pixels (plus the colour profile), so camera metadata — EXIF including the GPS
position, XMP, comments, embedded thumbnails or motion-photo trailers — never
reaches the volume, the platforms or other users.

`sanitize_existing_uploads()` brings files stored before this pipeline existed
to the same state once (see main.py startup).
"""

import io
import os
import shutil
import tempfile
import threading
import uuid
from typing import BinaryIO, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps

# Pillow refuses to even open files whose header declares more pixels than twice
# this value. Large JPEGs are decoded at a reduced scale (see _open_image), so the
# real memory bound is MAX_DECODED_PIXELS below; this only rejects absurd headers.
Image.MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_HEADER_PIXELS", "250000000"))

# Largest pixel count actually decoded into memory (≈ 40 MP → ~120 MB as RGB).
MAX_DECODED_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
# Per-file upload limit. Phone photos are typically 2–12 MB; 50–200 MP modes
# can produce 20+ MB files, which are still accepted and scaled down.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
# Longest edge of a stored photo. Vinted and Kleinanzeigen display listing photos
# well below this, and the AI analysis scales to 1024 px anyway, so this costs no
# visible quality while keeping storage and platform uploads small.
MAX_STORED_DIM = int(os.getenv("MAX_STORED_IMAGE_DIM", "2560"))
JPEG_QUALITY = int(os.getenv("STORED_JPEG_QUALITY", "90"))
# Refuse new uploads when the volume is nearly full (507), instead of failing
# halfway through writing a draft.
MIN_FREE_BYTES = int(os.getenv("MIN_FREE_DISK_MB", "200")) * 1024 * 1024

# Formats accepted for upload. MPO is what many phones write for JPEGs carrying a
# second (depth/preview) frame. HEIC is not decodable without an extra plugin
# and was never supported by the analysis either; browsers/Android hand over JPEGs.
ACCEPTED_FORMATS = ("JPEG", "MPO", "PNG", "WEBP")

_CHUNK = 1024 * 1024

_NOT_AN_IMAGE = "Mindestens eine Datei ist kein unterstütztes Bild (JPEG, PNG oder WebP)."


def _too_large() -> HTTPException:
    mb = MAX_UPLOAD_BYTES // (1024 * 1024)
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"Ein Bild ist zu groß (höchstens {mb} MB pro Bild).",
    )


def _bad_image(detail: str = _NOT_AN_IMAGE) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def disk_space_ok(path: str) -> bool:
    try:
        return shutil.disk_usage(path).free >= MIN_FREE_BYTES
    except Exception:
        return True


def _read_limited(src: BinaryIO) -> tempfile.SpooledTemporaryFile:
    """Copy `src` into a temp file, aborting with 413 past MAX_UPLOAD_BYTES."""
    buf = tempfile.SpooledTemporaryFile(max_size=4 * _CHUNK)
    total = 0
    while True:
        chunk = src.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            buf.close()
            raise _too_large()
        buf.write(chunk)
    if total == 0:
        buf.close()
        raise _bad_image("Eine der Dateien ist leer.")
    buf.seek(0)
    return buf


def _open_image(fp, formats=ACCEPTED_FORMATS, max_dim: int = MAX_STORED_DIM) -> Image.Image:
    """Decode an image upright and at most `max_dim` on its longest edge."""
    try:
        img = Image.open(fp, formats=list(formats) if formats else None)
        if img.format in ("JPEG", "MPO"):
            # Let libjpeg decode at 1/2, 1/4 or 1/8 scale where that still covers
            # max_dim — a 200 MP photo then never exists in memory at full size.
            # EXIF orientation may swap the axes, so request the square bound.
            img.draft("RGB", (max_dim, max_dim))
        if img.width * img.height > MAX_DECODED_PIXELS:
            raise _bad_image("Das Bild hat zu viele Pixel.")
        img.load()
        img = ImageOps.exif_transpose(img)
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise _bad_image("Das Bild hat zu viele Pixel.")
    except Exception:
        raise _bad_image()
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    return img


def _to_rgb(img: Image.Image) -> Image.Image:
    """Flatten transparency onto white (JPEG has no alpha; black would be wrong)."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _atomic_save(img: Image.Image, dest: str, replace_only: bool = False, **kwargs) -> None:
    """Write `img` to a temp file next to `dest`, then move it into place. Only
    the pixels and the given options are written — no metadata. With
    `replace_only`, a `dest` deleted in the meantime is not recreated."""
    if kwargs.get("icc_profile") is None:
        kwargs.pop("icc_profile", None)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest) or ".", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as fh:
            img.save(fh, **kwargs)
        if replace_only and not os.path.exists(dest):
            os.remove(tmp)
            return
        os.replace(tmp, dest)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _write_jpeg(img: Image.Image, dest: str, quality: int = JPEG_QUALITY,
                icc: Optional[bytes] = None, replace_only: bool = False) -> None:
    """Write `img` as a metadata-free JPEG (colour profile kept)."""
    _atomic_save(_to_rgb(img), dest, replace_only=replace_only,
                 format="JPEG", quality=quality, optimize=True, icc_profile=icc)


def _store_from_file(fp, upload_dir: str, prefix: str) -> Tuple[str, str]:
    img = _open_image(fp)
    icc = img.info.get("icc_profile")
    name = f"{prefix}{uuid.uuid4()}.jpg"
    local = os.path.join(upload_dir, name)
    try:
        _write_jpeg(img, local, icc=icc)
    except Exception as e:
        print(f"[images] Speichern fehlgeschlagen: {e}", flush=True)
        raise HTTPException(status_code=500, detail="Das Bild konnte nicht gespeichert werden.")
    return f"/uploads/{name}", local


def store_upload(upload: UploadFile, upload_dir: str, prefix: str = "") -> Tuple[str, str]:
    """Validate and store one uploaded photo. Returns (/uploads/<name>.jpg, local path).

    Raises HTTPException 400 (not a supported image), 413 (too large)."""
    ctype = (upload.content_type or "").lower()
    # The declared type is only a first filter (it is client-controlled); the
    # decoder below decides. Generic types are accepted because some pickers
    # send application/octet-stream for gallery files.
    if ctype and not (ctype.startswith("image/") or ctype == "application/octet-stream"):
        raise _bad_image()
    buf = _read_limited(upload.file)
    try:
        return _store_from_file(buf, upload_dir, prefix)
    finally:
        buf.close()


def store_bytes(data: bytes, upload_dir: str, prefix: str = "") -> Tuple[str, str]:
    """Like store_upload() for an in-memory image (e.g. a base64 screenshot)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise _too_large()
    if not data:
        raise _bad_image("Die Datei ist leer.")
    return _store_from_file(io.BytesIO(data), upload_dir, prefix)


# --- One-time clean-up of files stored before the pipeline above --------------

_MIGRATION_MARKER = ".metadata-cleanup-v1.done"
_METADATA_KEYS = ("exif", "xmp", "XML:com.adobe.xmp", "comment", "photoshop", "iptc")


def _has_metadata(img: Image.Image) -> bool:
    if img.format == "MPO":
        return True  # secondary frames carry their own EXIF
    if any(k in img.info for k in _METADATA_KEYS):
        return True
    if getattr(img, "text", None):  # PNG tEXt/iTXt chunks
        return True
    try:
        return len(img.getexif()) > 0
    except Exception:
        return False


def _sanitize_file(path: str) -> str:
    """Rewrite one stored file without metadata, keeping its name. Returns
    'cleaned', 'clean' (nothing to do) or 'skipped' (not a readable image)."""
    try:
        with Image.open(path) as probe:
            fmt = probe.format
            if fmt not in ACCEPTED_FORMATS:
                return "skipped"
            if not _has_metadata(probe):
                return "clean"
        with open(path, "rb") as fh:
            try:
                img = _open_image(fh, formats=None, max_dim=10_000)
            except HTTPException:
                # Above MAX_DECODED_PIXELS at that size (e.g. 50+ MP photos):
                # decode reduced to the size new uploads are stored at.
                fh.seek(0)
                img = _open_image(fh, formats=None)
        icc = img.info.get("icc_profile")
        if fmt in ("JPEG", "MPO"):
            # One re-encode at high quality; these files were stored as sent.
            _write_jpeg(img, path, quality=93, icc=icc, replace_only=True)
        elif fmt == "PNG":
            _atomic_save(img, path, replace_only=True, format="PNG", optimize=True, icc_profile=icc)
        else:
            _atomic_save(img, path, replace_only=True, format="WEBP", quality=92, icc_profile=icc)
        return "cleaned"
    except Exception as e:
        print(f"[images] Bereinigung übersprungen für {os.path.basename(path)}: {e}", flush=True)
        return "skipped"


def sanitize_existing_uploads(upload_dir: str) -> None:
    """Strip metadata from every stored photo once. Idempotent via a marker file;
    a crash midway simply reruns it (already clean files are skipped quickly)."""
    marker = os.path.join(upload_dir, _MIGRATION_MARKER)
    if os.path.exists(marker):
        return
    counts = {"cleaned": 0, "clean": 0, "skipped": 0}
    try:
        names = sorted(os.listdir(upload_dir))
    except Exception as e:
        print(f"[images] Upload-Verzeichnis nicht lesbar: {e}", flush=True)
        return
    for name in names:
        path = os.path.join(upload_dir, name)
        if name.startswith(".") or name.endswith(".part") or not os.path.isfile(path):
            continue
        counts[_sanitize_file(path)] += 1
    try:
        with open(marker, "w") as fh:
            fh.write(f"{counts}\n")
    except Exception as e:
        print(f"[images] Marker konnte nicht geschrieben werden: {e}", flush=True)
    print(
        f"[images] Metadaten-Bereinigung abgeschlossen: {counts['cleaned']} bereinigt, "
        f"{counts['clean']} ohne Metadaten, {counts['skipped']} übersprungen.",
        flush=True,
    )


def start_sanitize_existing_uploads(upload_dir: str) -> None:
    """Run sanitize_existing_uploads() in the background so startup isn't delayed."""
    if os.path.exists(os.path.join(upload_dir, _MIGRATION_MARKER)):
        return
    threading.Thread(
        target=sanitize_existing_uploads, args=(upload_dir,), name="upload-metadata-cleanup", daemon=True
    ).start()
