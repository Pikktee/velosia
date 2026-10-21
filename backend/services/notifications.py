"""
Lightweight e-mail notifications (stdlib smtplib, no extra dependency).

Used by the autofill telemetry/anomaly detector to alert the maintainer when a
field or the category selection starts failing en masse (i.e. Vinted/Kleinanzeigen
likely changed their form). Configured entirely via environment variables; if
they are not set, alerts are only logged (never crashes a request).

Railway env vars:
  SMTP_HOST           e.g. smtp.gmail.com
  SMTP_PORT           e.g. 587 (STARTTLS)
  SMTP_USER           SMTP username / full e-mail
  SMTP_PASSWORD       SMTP password / app password
  ALERT_EMAIL_FROM    optional, defaults to SMTP_USER
  ALERT_EMAIL_TO      recipient (where alerts go)
"""

import os
import smtplib
import ssl
from email.message import EmailMessage


def _cfg():
    return {
        "host": os.getenv("SMTP_HOST"),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": os.getenv("SMTP_USER"),
        "password": os.getenv("SMTP_PASSWORD"),
        "sender": os.getenv("ALERT_EMAIL_FROM") or os.getenv("SMTP_USER"),
        "to": os.getenv("ALERT_EMAIL_TO"),
    }


def email_configured() -> bool:
    c = _cfg()
    return all([c["host"], c["user"], c["password"], c["to"]])


def _failure_reason(e: Exception) -> str:
    """Log-safe description of a send failure. The exception text itself is not
    logged: smtplib puts the refused sender/recipient addresses into it."""
    code = getattr(e, "smtp_code", None)
    return f"{type(e).__name__} ({code})" if code else type(e).__name__


def send_email(subject: str, body: str) -> bool:
    """Send a plain-text e-mail. Returns True on success, False (and logs) on any
    failure or missing config — never raises.

    The subject ends up in the Railway log, so it must not carry personal data
    (e-mail addresses, names); those belong in the body, which is never logged."""
    c = _cfg()
    if not email_configured():
        print(f"[notifications] SMTP nicht konfiguriert — Alarm nur geloggt: {subject}", flush=True)
        return False
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = c["sender"]
        msg["To"] = c["to"]
        msg.set_content(body)
        ctx = ssl.create_default_context()
        with smtplib.SMTP(c["host"], c["port"], timeout=15) as server:
            server.starttls(context=ctx)
            server.login(c["user"], c["password"])
            server.send_message(msg)
        print(f"[notifications] Alarm-Mail gesendet: {subject}", flush=True)
        return True
    except Exception as e:
        print(f"[notifications] Mailversand fehlgeschlagen: {_failure_reason(e)}", flush=True)
        return False
