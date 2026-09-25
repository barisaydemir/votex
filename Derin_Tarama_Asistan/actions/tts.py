"""
TTS (Text-to-Speech) - Windows System.Speech kullanir.
"""

import threading

from actions.windows_utils import list_windows_voices, speak_with_windows


VOICE = ""


def speak_text(text: str, on_done=None, blocking: bool = False):
    if not text or not text.strip():
        if on_done:
            on_done()
        return

    max_len = 500
    if len(text) > max_len:
        text = text[:max_len] + "..."

    def _run():
        try:
            speak_with_windows(text, VOICE)
        finally:
            if on_done:
                on_done()

    if blocking:
        _run()
    else:
        threading.Thread(target=_run, daemon=True).start()


def get_available_voices() -> list[str]:
    return list_windows_voices()
