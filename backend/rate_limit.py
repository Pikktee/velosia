"""Sliding-window rate limiting for the public / brute-forceable endpoints.

Counters live in this process's memory. That is authoritative here because the
API runs as a SINGLE uvicorn process (Railway start command has no `--workers`,
and the SQLite-on-a-volume setup rules out multiple replicas anyway). If the
deployment ever grows to several workers or replicas, this has to move to a
shared store (Redis) — otherwise every worker would grant the full limit.

Two-step API on purpose:

    check(...)   # raises 429 if the key is already over its limit
    record(...)  # counts one hit

so that login can count only FAILED attempts. Using the combined `enforce()`
there would lock a user out after N *successful* logins. `enforce()` is right
for endpoints where the request itself is the scarce resource (registration,
waitlist sign-ups, bug reports with screenshots).
"""

import os
import threading
import time
from collections import deque
from typing import Deque, Dict, NamedTuple, Optional, Tuple

from fastapi import HTTPException, Request, status


class Policy(NamedTuple):
    """`limit` events allowed within a rolling `window_s` seconds."""
    limit: int
    window_s: int


# --- Policies (one place to tune them) ---------------------------------------
# Login limits count FAILED attempts only, so a normal user never hits them.
#
# The ACCOUNT limit is the actual brute-force defence: it is tied to the account
# under attack, so it bites regardless of how many IPs the attacker rotates
# through, and it can never lock out a bystander.
#
# The IP limit is deliberately loose. Velosia is primarily a mobile app, and
# mobile carriers put thousands of subscribers behind one CGNAT address — a
# tight per-IP limit would let one stranger's typos lock out every other user on
# the same carrier. It exists to blunt credential stuffing across many accounts
# and to cap bcrypt CPU burn, not as the primary defence.
LOGIN_IP = Policy(limit=40, window_s=300)          # 40 Fehlversuche / 5 min je IP
LOGIN_ACCOUNT = Policy(limit=8, window_s=900)      # 8 Fehlversuche / 15 min je Konto
REGISTER_IP = Policy(limit=5, window_s=3600)       # 5 neue Konten / Stunde je IP
GOOGLE_IP = Policy(limit=30, window_s=300)         # Google-Login (Token-Verify)
WAITLIST_IP = Policy(limit=5, window_s=3600)       # Warteliste (öffentlich, mailt uns)
BUGREPORT_USER = Policy(limit=12, window_s=3600)   # Bug-Reports (speichern Screenshots)

# Escape hatch for local development and tests.
DISABLED = os.getenv("RATE_LIMIT_DISABLED", "").lower() in ("1", "true", "yes")

_lock = threading.Lock()
_hits: Dict[Tuple[str, str], Deque[float]] = {}
_last_sweep = time.monotonic()
_SWEEP_EVERY_S = 600
_MAX_WINDOW_S = 3600


def client_ip(request: Request) -> str:
    """Best-effort client IP behind Railway's edge proxy.

    Takes the LAST entry of X-Forwarded-For, not the first: a client can forge
    the header, but the proxy appends the address it actually saw, so the last
    hop is the one we can trust. With a header-replacing proxy there is only one
    entry and this is identical to taking the first.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


def _sweep_locked(now: float) -> None:
    """Drop buckets whose newest hit is older than any window. Without this the
    dict would grow one entry per IP seen, forever."""
    global _last_sweep
    if now - _last_sweep < _SWEEP_EVERY_S:
        return
    _last_sweep = now
    cutoff = now - _MAX_WINDOW_S
    for key in [k for k, dq in _hits.items() if not dq or dq[-1] < cutoff]:
        del _hits[key]


def _retry_after(bucket: str, key: str, policy: Policy, now: float) -> Optional[int]:
    """Seconds until the oldest hit leaves the window, or None if under limit."""
    dq = _hits.get((bucket, key))
    if not dq:
        return None
    cutoff = now - policy.window_s
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) < policy.limit:
        return None
    return max(1, int(dq[0] + policy.window_s - now) + 1)


def check(bucket: str, key: str, policy: Policy, detail: str) -> None:
    """Raise 429 if this key already exhausted its allowance. Counts nothing."""
    if DISABLED or not key:
        return
    now = time.monotonic()
    with _lock:
        retry_after = _retry_after(bucket, key, policy, now)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )


def record(bucket: str, key: str) -> None:
    """Count one hit against this key."""
    if DISABLED or not key:
        return
    now = time.monotonic()
    with _lock:
        _hits.setdefault((bucket, key), deque()).append(now)
        _sweep_locked(now)


def reset(bucket: str, key: str) -> None:
    """Clear a key's history (e.g. after a successful login)."""
    if not key:
        return
    with _lock:
        _hits.pop((bucket, key), None)


def enforce(bucket: str, key: str, policy: Policy, detail: str) -> None:
    """check() + record() — for endpoints where the request itself is the cost."""
    check(bucket, key, policy, detail)
    record(bucket, key)
