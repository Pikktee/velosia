#!/usr/bin/env python3
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile


def _fmt(cmd):
    return " ".join(cmd) if isinstance(cmd, (list, tuple)) else str(cmd)


def run_cmd(cmd, cwd=None, env=None, stream=False):
    """Run a command given as an argument list (no shell), exit on failure."""
    if isinstance(cmd, str):
        raise TypeError("run_cmd expects an argument list, not a shell string")
    print(f"Running: {_fmt(cmd)}")
    full_env = {**os.environ, **env} if env else None
    if stream:
        # Long-running builds: let output through live instead of buffering.
        res = subprocess.run(cmd, cwd=cwd, env=full_env, text=True)
        if res.returncode != 0:
            print(f"Error: command failed with exit code {res.returncode}")
            sys.exit(res.returncode)
        return ""
    res = subprocess.run(cmd, cwd=cwd, env=full_env, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error: {res.stderr}")
        sys.exit(res.returncode)
    return res.stdout.strip()


# ---------------------------------------------------------------------------
# Files deploy.py writes itself. Only these (plus already tracked files via
# `git add -u`) are staged — new files elsewhere must be added deliberately.
# ---------------------------------------------------------------------------
ENGINE_SOURCE = "shared/autofill-engine.js"
ENGINE_MIRRORS = [
    "extension/autofill-engine.js",
    "android/app/src/main/assets/autofill-engine.js",
    # Served by Vite at /autofill-engine.js so the Android shell can hot-load the
    # latest engine over the web (a 2-min web deploy) without a full Play release.
    # The bundled asset above stays as the offline fallback.
    "frontend/public/autofill-engine.js",
]
REMOTE_ENGINE = "frontend/public/autofill-engine.js"
REMOTE_ENGINE_SIG = REMOTE_ENGINE + ".sig"
EXTENSION_ZIP = "frontend/public/velosia-extension.zip"

GENERATED_FILES = [
    "VERSION",
    "backend/main.py",
    "frontend/package.json",
    "extension/manifest.json",
    "android/app/build.gradle",
    *ENGINE_MIRRORS,
    REMOTE_ENGINE_SIG,
    EXTENSION_ZIP,
]

# Engine signing (ECDSA P-256, SHA256withECDSA). The private key lives outside the
# repository; the app verifies against the public key below.
ENGINE_SIGNING_KEY = os.path.expanduser(
    os.environ.get("VELOSIA_ENGINE_SIGNING_KEY", "~/.config/velosia/engine-signing-key.pem")
)
ENGINE_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEosPqOHmOom9PoUADLkAxlU1FpRVu
MzEp7sWplnm1jsOn3GnLnT+BeEJi/ZNw1j8ANce128N2PSnsiJ+6UjWyGQ==
-----END PUBLIC KEY-----
"""


def build_commit_cmd(message):
    """git commit as an argument list — the message is passed verbatim."""
    return ["git", "commit", "-m", message]


def find_untracked(allowed=GENERATED_FILES, cwd=None):
    """Untracked, not-ignored files that deploy.py does not generate itself."""
    out = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=cwd, capture_output=True, text=True, check=True,
    ).stdout
    allowed_set = set(allowed)
    return sorted(p for p in out.split("\0") if p and p not in allowed_set)


# Secret patterns checked against the staged diff before committing.
SECRET_PATTERNS = [
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("Private key block", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("Service-account private key", re.compile(r'"private_key"\s*:')),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[0-9A-Za-z]{36,}\b")),
    ("Slack token", re.compile(r"\bxox[abposr]-[0-9A-Za-z-]{10,}")),
]
SENSITIVE_NAME_PATTERNS = [
    re.compile(r"(^|/)\.env(\.[^/]*)?$"),
    re.compile(r"\.(pem|p12|pfx|keystore|jks|key)$"),
    re.compile(r"-key\.json$"),
    re.compile(r"service-account[^/]*\.json$"),
    re.compile(r"\.(db|sqlite|sqlite3)$"),
]
SENSITIVE_NAME_ALLOW = {"backend/.env.example", ".env.example"}


def scan_for_secrets(diff_text, staged_names=()):
    """Return findings for added diff lines matching secret patterns and for
    staged file names that look like credentials or databases."""
    findings = []
    current = None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            current = line[4:]
            if current.startswith("b/"):
                current = current[2:]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        for label, rx in SECRET_PATTERNS:
            if rx.search(line):
                findings.append(f"{current}: {label}")
    for name in staged_names:
        if name in SENSITIVE_NAME_ALLOW or name.endswith("/.env.example"):
            continue
        if any(rx.search(name) for rx in SENSITIVE_NAME_PATTERNS):
            findings.append(f"{name}: sensitive file name")
    return findings


def check_staged_for_secrets():
    diff = subprocess.run(
        ["git", "diff", "--cached", "--no-color", "-U0", "--no-ext-diff"],
        capture_output=True, text=True, errors="replace", check=True,
    ).stdout
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACR", "-z"],
        capture_output=True, text=True, check=True,
    ).stdout.split("\0")
    findings = scan_for_secrets(diff, [n for n in names if n])
    if findings:
        print("\n✖ Possible secrets in the staged changes — aborting before commit:")
        for f in findings:
            print(f"   - {f}")
        print("Unstage with `git reset` and fix (or add the file to .gitignore), then re-run.")
        sys.exit(1)
    print("✔ Secret scan: no findings.")


# Android JDK: CLI Gradle builds use the JDK bundled with Android Studio (JBR 21).
# Overridable via JAVA_HOME if you have another suitable JDK on PATH.
ANDROID_STUDIO_JBR = (
    "/Volumes/Daten/System/Programme/Android Studio.app/Contents/jbr/Contents/Home"
)


def publish_to_play():
    """Build the signed release AAB and upload it to the Play *internal* track via
    Gradle Play Publisher. Requires two gitignored secrets to be present:
      - android/keystore.properties  (upload-key signing)
      - android/play-deploy-key.json (Play service-account credentials)
    The service account must have 'Releases for testing tracks' permission on the
    app in the Play Console, and the Android Publisher API must be enabled.
    versionCode was already bumped above, so the upload is strictly newer."""
    keystore = "android/keystore.properties"
    play_key = "android/play-deploy-key.json"
    missing = [p for p in (keystore, play_key) if not os.path.exists(p)]
    if missing:
        print(f"⚠ Skipping Play upload — missing secret(s): {', '.join(missing)}")
        return

    java_home = os.environ.get("JAVA_HOME")
    if not java_home or not os.path.exists(os.path.join(java_home, "bin", "java")):
        if os.path.exists(os.path.join(ANDROID_STUDIO_JBR, "bin", "java")):
            java_home = ANDROID_STUDIO_JBR
        else:
            print("⚠ Skipping Play upload — no usable JDK (set JAVA_HOME or install Android Studio).")
            return

    print("\n---> Building signed AAB and uploading to Play internal track...")
    run_cmd(
        ["./gradlew", ":app:publishReleaseBundle", "--no-daemon"],
        cwd="android",
        env={"JAVA_HOME": java_home},
        stream=True,
    )
    print("✔ Uploaded AAB to Play Internal Test track.")

def sync_shared_engine():
    """Mirror the single-source autofill engine (shared/autofill-engine.js) into
    the browser extension, the Android assets and the frontend, so every platform
    ships the exact same autofill logic. Copied byte-for-byte (the remote copy is
    signed over its exact bytes)."""
    src = ENGINE_SOURCE
    if not os.path.exists(src):
        print("⚠ shared/autofill-engine.js not found — skipping engine sync.")
        return
    with open(src, "rb") as f:
        content = f.read()
    for dst in ENGINE_MIRRORS:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(content)
        print(f"✔ Synced autofill engine -> {dst}")


def _openssl(args, data=None):
    return subprocess.run(["openssl", *args], input=data, capture_output=True)


def verify_engine_signature(data, sig_b64, public_key_pem=ENGINE_PUBLIC_KEY_PEM):
    """True if sig_b64 (Base64 DER ECDSA) is a valid SHA256withECDSA signature
    over data for the given public key."""
    try:
        sig = base64.b64decode(sig_b64.strip(), validate=True)
    except Exception:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        pub = os.path.join(tmp, "pub.pem")
        sig_path = os.path.join(tmp, "engine.sig")
        with open(pub, "w") as f:
            f.write(public_key_pem)
        with open(sig_path, "wb") as f:
            f.write(sig)
        res = _openssl(["dgst", "-sha256", "-verify", pub, "-signature", sig_path], data=data)
        return res.returncode == 0


def sign_bytes(data, key_path):
    """Base64 DER ECDSA signature (SHA-256) over data, or None on failure."""
    res = _openssl(["dgst", "-sha256", "-sign", key_path], data=data)
    if res.returncode != 0 or not res.stdout:
        print(f"⚠ openssl signing failed: {res.stderr.decode(errors='replace').strip()}")
        return None
    return base64.b64encode(res.stdout).decode("ascii")


def sign_remote_engine(engine_path=REMOTE_ENGINE, sig_path=REMOTE_ENGINE_SIG,
                       key_path=ENGINE_SIGNING_KEY, public_key_pem=ENGINE_PUBLIC_KEY_PEM):
    """Write <engine>.sig next to the web-served engine. An existing signature that
    still verifies is kept (ECDSA signatures are randomized — re-signing unchanged
    bytes would churn git on every deploy). Without the key: warn and continue;
    a stale signature is removed so the app falls back to its bundled engine."""
    if not os.path.exists(engine_path):
        print(f"⚠ {engine_path} not found — skipping engine signature.")
        return False
    with open(engine_path, "rb") as f:
        data = f.read()

    if os.path.exists(sig_path):
        with open(sig_path, "r") as f:
            existing = f.read()
        if verify_engine_signature(data, existing, public_key_pem):
            print(f"✔ Engine signature up to date -> {sig_path}")
            return True

    if not os.path.exists(key_path):
        print(f"⚠ Engine signing key not found ({key_path}) — shipping without signature;"
              " the app will use its bundled engine.")
        if os.path.exists(sig_path):
            os.remove(sig_path)
            print(f"⚠ Removed stale {sig_path}.")
        return False

    sig_b64 = sign_bytes(data, key_path)
    if not sig_b64 or not verify_engine_signature(data, sig_b64, public_key_pem):
        print("⚠ Engine signature does not verify against the app's public key"
              " (wrong signing key?) — shipping without signature.")
        if os.path.exists(sig_path):
            os.remove(sig_path)
        return False
    with open(sig_path, "w") as f:
        f.write(sig_b64 + "\n")
    print(f"✔ Signed autofill engine -> {sig_path}")
    return True


def _is_dev_url(pattern):
    return bool(re.match(r"^[a-z*]+://(localhost|127\.0\.0\.1|\[::1\])(:\d+|:\*)?/", pattern))


def strip_dev_entries(manifest):
    """Copy of the extension manifest without localhost host permissions and
    content-script matches (local development only)."""
    m = json.loads(json.dumps(manifest))
    if "host_permissions" in m:
        m["host_permissions"] = [p for p in m["host_permissions"] if not _is_dev_url(p)]
    scripts = []
    for cs in m.get("content_scripts", []):
        matches = [p for p in cs.get("matches", []) if not _is_dev_url(p)]
        if not matches:
            continue
        cs["matches"] = matches
        scripts.append(cs)
    if "content_scripts" in m:
        m["content_scripts"] = scripts
    resources = []
    for war in m.get("web_accessible_resources", []):
        if "matches" in war:
            war["matches"] = [p for p in war["matches"] if not _is_dev_url(p)]
            if not war["matches"]:
                continue
        resources.append(war)
    if "web_accessible_resources" in m:
        m["web_accessible_resources"] = resources
    return m


def build_extension_zip(ext_dir="extension", out_path=EXTENSION_ZIP):
    """Package the WebExtension into a single zip the landing page offers for
    download. Written into frontend/public so Vite ships it as a static asset at
    /velosia-extension.zip — always matching the engine just synced above.
    The manifest in the archive has the localhost development entries removed.
    The archive is reproducible (fixed timestamps) so identical contents produce
    identical bytes and don't churn git on every deploy."""
    if not os.path.isdir(ext_dir):
        print("⚠ extension/ not found — skipping extension zip.")
        return
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    skip = {".DS_Store"}
    entries = []
    for root, _dirs, names in os.walk(ext_dir):
        for n in names:
            if n in skip:
                continue
            full = os.path.join(root, n)
            # manifest.json sits at the archive root so the extracted folder loads
            # directly via Chrome's "Load unpacked".
            arc = os.path.relpath(full, ext_dir).replace(os.sep, "/")
            entries.append((full, arc))
    entries.sort(key=lambda e: e[1])
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in entries:
            with open(full, "rb") as fh:
                data = fh.read()
            if arc == "manifest.json":
                manifest = strip_dev_entries(json.loads(data.decode("utf-8")))
                data = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
            info = zipfile.ZipInfo(arc, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    print(f"✔ Packaged extension ({len(entries)} files) -> {out_path}")


def stage_and_commit(commit_msg, extra_files=()):
    """Stage tracked changes plus the files deploy.py generated (and explicitly
    approved new files), scan for secrets, then commit."""
    run_cmd(["git", "add", "-u"])
    paths = [p for p in [*GENERATED_FILES, *extra_files] if os.path.exists(p)]
    if paths:
        run_cmd(["git", "add", "--", *paths])
    check_staged_for_secrets()
    run_cmd(build_commit_cmd(commit_msg))


def main():
    # 1. Get current version
    version_file = "VERSION"
    if not os.path.exists(version_file):
        current_version = "2.0.0"
        with open(version_file, "w") as f:
            f.write(current_version)
    else:
        with open(version_file, "r") as f:
            current_version = f.read().strip()

    print(f"Current version: {current_version}")
    
    # Calculate next patch version
    parts = current_version.split('.')
    if len(parts) == 3:
        next_version = f"{parts[0]}.{parts[1]}.{int(parts[2])+1}"
    else:
        next_version = current_version + ".1"

    # Set up argument parser
    parser = argparse.ArgumentParser(description="Velosia Deploy Tool")
    parser.add_argument("--local", action="store_true", help="Deploy directly from the local machine using Railway CLI")
    parser.add_argument("--play", action="store_true", help="Also build the signed AAB and upload it to the Play internal test track")
    parser.add_argument("--allow-new", action="store_true", help="Also commit new untracked files (they are listed before committing)")
    parser.add_argument("version", nargs="?", help="New version to deploy (e.g. 2.0.3)")
    parser.add_argument("message", nargs="?", help="Commit/release message")
    args = parser.parse_args()

    # Refuse to silently publish new files: anything untracked (and not ignored)
    # that deploy.py does not generate must be added deliberately.
    new_files = find_untracked()
    if new_files:
        print("New untracked files:")
        for p in new_files:
            print(f"   + {p}")
        if not args.allow_new:
            print("\n✖ Aborting: add them with `git add <file>` (or to .gitignore), "
                  "or re-run with --allow-new to commit them with this release.")
            sys.exit(1)
        print("---> --allow-new: these files will be committed.\n")

    # Determine new version
    new_version = args.version or next_version
    if not args.version:
        try:
            user_input = input(f"Enter new version [default: {next_version}]: ").strip()
            if user_input:
                new_version = user_input
        except (KeyboardInterrupt, EOFError):
            pass

    if not re.fullmatch(r"\d+\.\d+\.\d+", new_version):
        print(f"✖ Invalid version '{new_version}' (expected MAJOR.MINOR.PATCH).")
        sys.exit(1)

    # Determine commit message
    default_msg = f"Release {new_version}"
    commit_msg = args.message or default_msg
    if not args.message:
        try:
            user_input = input(f"Enter release message [default: {default_msg}]: ").strip()
            if user_input:
                commit_msg = user_input
        except (KeyboardInterrupt, EOFError):
            pass
        
    print(f"\n---> Deploying version: {new_version}")
    print(f"---> Commit message: {commit_msg}")
    print(f"---> Target: {'Local CLI' if args.local else 'GitHub Actions'}\n")

    # 2. Write new version file
    with open(version_file, "w") as f:
        f.write(new_version)

    # 3. Update backend/main.py
    main_py_path = "backend/main.py"
    if os.path.exists(main_py_path):
        with open(main_py_path, "r") as f:
            content = f.read()
        content = re.sub(r'version="[^"]+"', f'version="{new_version}"', content)
        with open(main_py_path, "w") as f:
            f.write(content)
        print("✔ Updated backend/main.py version.")

    # 4. Update frontend/package.json
    pkg_json_path = "frontend/package.json"
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r") as f:
            data = json.load(f)
        data["version"] = new_version
        with open(pkg_json_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print("✔ Updated frontend/package.json version.")

    # 5. Update extension/manifest.json
    manifest_path = "extension/manifest.json"
    if os.path.exists(manifest_path):
        with open(manifest_path, "r") as f:
            data = json.load(f)
        data["version"] = new_version
        with open(manifest_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print("✔ Updated extension/manifest.json version.")

    # 5b. Update android/app/build.gradle version
    android_gradle_path = "android/app/build.gradle"
    if os.path.exists(android_gradle_path):
        with open(android_gradle_path, "r") as f:
            content = f.read()
        
        # Replace versionName
        content = re.sub(r'versionName "[^"]+"', f'versionName "{new_version}"', content)
        
        # Increment versionCode
        version_code_match = re.search(r'versionCode (\d+)', content)
        if version_code_match:
            new_code = int(version_code_match.group(1)) + 1
            content = re.sub(r'versionCode \d+', f'versionCode {new_code}', content)
            
        with open(android_gradle_path, "w") as f:
            f.write(content)
        print("✔ Updated android/app/build.gradle version.")

    # 5c. Keep the shared autofill engine mirrored into extension + android assets
    sync_shared_engine()

    # 5c'. Sign the web-served engine copy for the Android shell's hot-load path.
    sign_remote_engine()

    # 5d. Package the extension for the landing-page download (after the sync, so
    # the zip always carries the freshly-mirrored engine).
    build_extension_zip()

    # 6. Git commit & push
    stage_and_commit(commit_msg, extra_files=new_files)
    run_cmd(["git", "push"])
    print("✔ Committed and pushed version changes to GitHub.")

    # 6b. Optional: upload the signed AAB to the Play internal track (--play).
    if args.play:
        publish_to_play()

    # 7. Railway Deployments
    if args.local:
        print("\n---> Uploading & deploying to Railway backend locally...")
        run_cmd(["railway", "up", "--service", "backend", "--path-as-root", "--detach", "backend"])
        print(f"Backend deployment initiated.")
        
        print("\n---> Uploading & deploying to Railway frontend locally...")
        run_cmd(["railway", "up", "--service", "frontend", "--path-as-root", "--detach", "frontend"])
        print(f"Frontend deployment initiated.")
        
        print("\n🎉 Deployment successfully initiated locally! Monitor the builds in your Railway dashboard:")
        print("https://railway.app/project/42d17b5d-61c9-4921-a21f-582d9a4c1d8a")
    else:
        print("\n🎉 Code pushed to GitHub! GitHub Actions will now automatically build and deploy this release.")
        print("Monitor the build on GitHub: https://github.com/Pikktee/velosia/actions")
        print("Or check your Railway dashboard: https://railway.app/project/42d17b5d-61c9-4921-a21f-582d9a4c1d8a")

if __name__ == "__main__":
    main()
