"""Expiring signed URLs for /uploads.

Uploaded photos used to be served by a bare StaticFiles mount: anyone who knew
(or was handed) a URL could fetch any user's photo — including the screenshots
attached to bug reports — forever, with no auth at all. UUID filenames made that
hard to exploit blindly, but "unguessable" is not "protected".

Why signatures rather than an Authorization header: none of the three consumers
can send one. The frontend renders photos in <img src>, the Android shell
downloads them with a plain okhttp GET, and the autofill engine fetches them
from inside vinted.de / kleinanzeigen.de. All three simply take the path out of
the API response and prefix the backend URL — so signing the paths *in the
response* makes every client work unchanged, with no app release needed.

The signature grants access to one file until it expires (a capability URL).
It is not tied to a user: doing that would need a DB lookup per image and an
authenticated context that <img> does not have. The API only ever hands a user
their own paths, so this closes the "public forever" hole while staying
compatible with how the clients actually load images.
"""

import hashlib
import hmac
import os
import time
from typing import Optional

from auth_utils import SECRET_KEY

# Long enough that a listing being autofilled never expires mid-flow, short
# enough that a leaked URL stops working. Clients refetch drafts constantly, so
# they always hold fresh links.
TTL_S = int(os.getenv("UPLOAD_URL_TTL_S", str(14 * 24 * 3600)))

# Expiries are rounded up to a whole day so that serializing the same file twice
# yields the SAME url. With a per-second expiry every draft fetch would mint new
# urls, and the browser/WebView would re-download every thumbnail over mobile
# data instead of hitting its cache. Real lifetime is thus TTL_S..TTL_S+1 day.
_BUCKET_S = 24 * 3600

# Emergency switch: restores the old unauthenticated behaviour without a code
# rollback, in case a client turns up that we did not anticipate.
PUBLIC = os.getenv("UPLOADS_PUBLIC", "").lower() in ("1", "true", "yes")

_PREFIX = "/uploads/"


def _signature(filename: str, expires: int) -> str:
    msg = f"{filename}:{expires}".encode()
    return hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def verify(filename: str, expires: str, signature: str) -> bool:
    """True if `signature` is ours for this filename and has not expired."""
    if not filename or not expires or not signature:
        return False
    try:
        expires_at = int(expires)
    except (TypeError, ValueError):
        return False
    if expires_at < time.time():
        return False
    return hmac.compare_digest(_signature(filename, expires_at), signature)


def sign_path(path: Optional[str]) -> Optional[str]:
    """Append `?e=<expiry>&s=<sig>` to an /uploads/... path.

    Anything else (None, absolute URLs, already-signed paths) is returned
    unchanged, so this is safe to apply blindly during serialization.
    """
    if not path or not isinstance(path, str):
        return path
    if not path.startswith(_PREFIX) or "?" in path:
        return path
    filename = path[len(_PREFIX):]
    if not filename:
        return path
    expires = ((int(time.time()) + TTL_S) // _BUCKET_S + 1) * _BUCKET_S
    return f"{path}?e={expires}&s={_signature(filename, expires)}"


def strip_signature(path: Optional[str]) -> Optional[str]:
    """Drop the query string, recovering the raw path as stored in the database.

    Clients hand signed paths back to us (e.g. when deleting one photo of a
    draft), and those must still match the stored value.
    """
    if not path or not isinstance(path, str):
        return path
    return path.split("?", 1)[0]
