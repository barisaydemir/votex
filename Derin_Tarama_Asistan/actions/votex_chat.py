"""
DTA → VOTEX sohbet halkası köprüsü.

VOTEX 3D altındaki DTA paneli ile konuşma akışı:
- DTA konuşma turu bitince (turn_complete) kullanıcı sözü + asistan yanıtı
  POST /dta/chat ile VOTEX halkasına itilir (push).
- VOTEX panelinden yazılan mesajlar GET /dta/chat/pending ile çekilir (poll);
  işlenen mesaj sonraki POST'ta ackCursor ile onaylanır.
- Arka plan poller'ı 2 saniyede bir pending kontrol eder; gelen mesaj
  Jarvis metin komutuna dönüştürülür (on_text_command).

Bu localhost (127.0.0.1:18765) köprüsüdür; internet/Gemini bağlantısı ile
karıştırılmaz.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from typing import Any, Callable

VOTEX_BRIDGE = "http://127.0.0.1:18765"
CHAT_TIMEOUT_S = 4
POLL_INTERVAL_S = 2.0

_poll_lock = threading.Lock()
_poll_thread: threading.Thread | None = None
_poll_stop = threading.Event()
_ack_cursor = 0

# Panel sırası boşken gereksiz log şişmesini önler
_last_empty_poll_log = 0.0


def _http_json(method: str, path: str, payload: dict | None = None) -> dict[str, Any]:
    url = f"{VOTEX_BRIDGE}{path}"
    data = None
    headers = {"Accept": "application/json", "Connection": "close"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=CHAT_TIMEOUT_S) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    if not raw.strip():
        return {"ok": True}
    out = json.loads(raw)
    if isinstance(out, dict):
        out.setdefault("ok", True)
    return out


def push_chat_turns(
    turns: list[dict[str, Any]], *, retries: int = 2
) -> dict[str, Any]:
    """
    Konuşma turunu VOTEX halkasına iter.

    turns: [{role: "user"|"assistant"|"system", text, ts?, meta?}]
    Dönüş: {"ok": bool, "accepted": int, "pending": [...]} — pending,
    VOTEX panelinden gelen henüz ack'lenmemiş mesajlardır.
    """
    global _ack_cursor
    clean: list[dict[str, Any]] = []
    for turn in turns or []:
        if not isinstance(turn, dict):
            continue
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        item: dict[str, Any] = {
            "role": str(turn.get("role") or "assistant"),
            "text": text[:2000],
        }
        if turn.get("ts"):
            item["ts"] = int(turn.get("ts") or 0)
        if turn.get("meta"):
            item["meta"] = str(turn.get("meta"))[:200]
        clean.append(item)
    if not clean:
        return {"ok": True, "accepted": 0, "pending": []}

    payload: dict[str, Any] = {"turns": clean}
    if _ack_cursor > 0:
        payload["ackCursor"] = _ack_cursor

    last_err: dict[str, Any] = {"ok": False, "message": "VOTEX köprüsü yanıt vermiyor."}
    for attempt in range(max(1, retries)):
        try:
            out = _http_json("POST", "/dta/chat", payload)
            if out.get("ok"):
                return out
            last_err = out
        except Exception as e:
            last_err = {"ok": False, "message": str(e)}
        time.sleep(0.4 * (attempt + 1))
    return last_err


def fetch_pending_panel_messages() -> list[dict[str, Any]]:
    """VOTEX panelinden gelen, henüz ack'lenmemiş mesajları çeker."""
    global _ack_cursor
    try:
        out = _http_json("GET", "/dta/chat/pending")
        items = out.get("pending") or []
        return [it for it in items if isinstance(it, dict)]
    except Exception:
        return []


def _poll_loop(on_message: Callable[[str], None]) -> None:
    global _ack_cursor
    while not _poll_stop.is_set():
        try:
            messages = fetch_pending_panel_messages()
            for msg in messages:
                text = str(msg.get("text") or "").strip()
                msg_id = int(msg.get("id") or 0)
                if text and msg_id > _ack_cursor:
                    _ack_cursor = msg_id
                    try:
                        on_message(text)
                    except Exception:
                        pass
        except Exception:
            pass
        _poll_stop.wait(POLL_INTERVAL_S)


def start_panel_message_poller(on_message: Callable[[str], None]) -> None:
    """DTA açık kaldığı sürece VOTEX panel mesajlarını çeker (2 sn)."""
    global _poll_thread
    with _poll_lock:
        if _poll_thread and _poll_thread.is_alive():
            return
        _poll_stop.clear()
        _poll_thread = threading.Thread(
            target=_poll_loop,
            args=(on_message,),
            name="votex-chat-poll",
            daemon=True,
        )
        _poll_thread.start()


def stop_panel_message_poller() -> None:
    _poll_stop.set()
