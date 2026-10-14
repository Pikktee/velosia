"""Echte Gemini-Token-Zählung für die Kostenübersicht im Admin-Panel.

Jeder generate_content-Aufruf in gemini_service meldet seine `usage_metadata`
über record(). Gesammelt wird in einem UsageTally, das der Aufrufer (ein
Endpunkt in main.py) per track() für die Dauer der KI-Arbeit aktiv setzt und
danach dem Nutzer gutschreibt. So muss keine Service-Funktion ihre Signatur
ändern, und Aufrufe ohne aktives Tally (Skripte, Tests) laufen einfach ohne
Zählung weiter.

Threads: ThreadPoolExecutor übernimmt den Kontext NICHT von selbst; wer dort
KI-Aufrufe startet, reicht ihn mit contextvars.copy_context().run weiter. Das
Tally ist dabei dasselbe Objekt, deshalb zählt es unter einem Lock.
"""
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional


class UsageTally:
    def __init__(self):
        self._lock = threading.Lock()
        self.calls = 0
        self.prompt_tokens = 0
        self.output_tokens = 0    # sichtbare Antwort (candidates_token_count)
        self.thinking_tokens = 0  # Thinking, wird wie Output abgerechnet

    def add(self, prompt: int, output: int, thinking: int) -> None:
        with self._lock:
            self.calls += 1
            self.prompt_tokens += prompt
            self.output_tokens += output
            self.thinking_tokens += thinking

    @property
    def empty(self) -> bool:
        return self.calls == 0


_current: ContextVar[Optional[UsageTally]] = ContextVar("velosia_ai_usage", default=None)


@contextmanager
def track():
    """Sammelt alle KI-Aufrufe im Block in einem neuen Tally (yield)."""
    tally = UsageTally()
    token = _current.set(tally)
    try:
        yield tally
    finally:
        _current.reset(token)


def _count(meta, name: str) -> int:
    try:
        return int(getattr(meta, name, 0) or 0)
    except (TypeError, ValueError):
        return 0


def record(response) -> None:
    """Bucht die Token einer Gemini-Antwort aufs aktive Tally. Wirft nie."""
    tally = _current.get()
    if tally is None or response is None:
        return
    try:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return
        prompt = _count(meta, "prompt_token_count")
        output = _count(meta, "candidates_token_count")
        thinking = _count(meta, "thoughts_token_count")
        if not thinking:
            # google-generativeai 0.8.x kennt das Feld thoughts_token_count nicht
            # und verwirft es; total_token_count enthält das Thinking aber weiter.
            thinking = max(0, _count(meta, "total_token_count") - prompt - output)
        tally.add(prompt, output, thinking)
    except Exception as e:
        print(f"Velosia: Token-Zählung fehlgeschlagen: {e}", flush=True)
