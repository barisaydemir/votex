#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VOTEX <-> DTA köprü canlı E2E sürücüsü.

0.4.154'teki 18 senaryoluk canlı doğrulamanın ve 0.4.155'teki POST /dta/chat
{"text":...} gövde kabul düzeltmesinin kalıcı regresyon testi.

Çalışma şekli:
- VOTEX (köprü, 127.0.0.1:18765) çalışıyor olmalı: GET /health ile anlaşılır.
- DTA bağımlı senaryolar yalnız DTA canlıyken koşar (dtaOnline bayrağı);
  DTA yoksa köprü senaryoları koşar, DTA senaryoları SKIPPED sayılır.
- DTA kanıtları diske yazılan logs/boot.log'dan okunur (ui.write_log diske
  yazmaz; yalnız main.py'deki _boot_log satırları kanıt sayılır).
- Pencere görünürlüğü ctypes FindWindowW + IsWindowVisible ile ölçülür
  (Get-Process MainWindowHandle withdraw sonrası bayat okur — kullanılmaz).

Kullanım:
  python scripts/e2e_dta_bridge.py                  # otomatik: DTA canlıysa tam tur
  python scripts/e2e_dta_bridge.py --bridge-only    # yalnız köprü senaryoları
  python scripts/e2e_dta_bridge.py --boot-log PATH --bridge-url URL --wait 45

Çıkış kodu: 0 = tümü PASS/SKIPPED, 1 = en az bir FAIL.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import time
import urllib.parse
from http.client import HTTPConnection

DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT = "127.0.0.1", 18765
DEFAULT_BOOT_LOG = r"C:\votex\Derin_Tarama_Asistan\logs\boot.log"
DEFAULT_WINDOW_TITLE = "Derin Tarama Asistan"

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"


# ── HTTP yardımcıları ────────────────────────────────────────────────────────
def http(method: str, path: str, payload: dict | None = None, *, base: str, timeout: float = 6.0):
    """Tek kullanımlık http.client bağlantısı; Content-Length kadar tam okur
    (mini sunucu kapatma yarışında 10054'ü önler)."""
    parsed = urllib.parse.urlsplit(base)
    host = parsed.hostname or DEFAULT_BRIDGE_HOST
    port = parsed.port or DEFAULT_BRIDGE_PORT
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    last_err: Exception | None = None
    for attempt in range(5):  # mini sunucu arada yarım okuma/RST yapar — zararsız retry
        try:
            conn = HTTPConnection(host, port, timeout=timeout)
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8", "replace")
            status = resp.status
            conn.close()
            if not raw.strip():
                # Sunucu isteği yarım okuyup yanıtsız kapattı — yeniden dene
                raise RuntimeError(f"bos govde (status={status})")
            last_err = None
            break
        except Exception as e:
            last_err = e
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(0.3 * (attempt + 1))
    if last_err is not None:
        return 0, {"ok": False, "_error": str(last_err)}
    try:
        out = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        out = {"_raw": raw}
    return status, out


def wait_until(pred, timeout: float, interval: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if pred():
                return True
        except Exception:
            pass
        time.sleep(interval)
    try:
        return bool(pred())
    except Exception:
        return False


# ── Pencere görünürlüğü (ctypes) ─────────────────────────────────────────────
def window_visible(title: str) -> bool | None:
    if sys.platform != "win32":
        return None
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return False
        return bool(user32.IsWindowVisible(hwnd))
    except Exception:
        return None


# ── boot.log kuyruğu (yalnız eklenen satırlar) ──────────────────────────────
class BootLog:
    def __init__(self, path: str):
        self.path = path
        self.offset = 0
        self.lines: list[str] = []
        self._marks: dict[str, int] = {}

    def poll(self) -> None:
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return
        if size < self.offset:  # dosya yeniden yaratıldı (DTA yeniden başlatıldı)
            self.offset = 0
        if size == self.offset:
            return
        try:
            with open(self.path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self.offset)
                chunk = f.read()
                self.offset = f.tell()
        except OSError:
            return
        for line in chunk.splitlines():
            line = line.strip()
            if line:
                self.lines.append(line)

    def mark(self, key: str) -> None:
        self.poll()
        self._marks[key] = len(self.lines)

    def since(self, key: str) -> list[str]:
        self.poll()
        start = self._marks.get(key, 0)
        return self.lines[start:]

    def has_since(self, key: str, *markers: str) -> bool:
        seg = self.since(key)
        return any(any(m in line for m in markers) for line in seg)


# ── Senaryolar ───────────────────────────────────────────────────────────────
def t_health(ctx) -> tuple[str, str]:
    status, out = http("GET", "/health", base=ctx["base"])
    ok = out.get("ok") is True and "bridge" in str(out.get("service", ""))
    return (PASS if ok else FAIL), f"service={out.get('service')}"


def t_chat_text_shape(ctx) -> tuple[str, str]:
    """0.4.155 regresyonu: {\"text\":...} gövdesi halka turuna çevrilmeli
    (düzeltmeden önce sessizce accepted:0 ile yutuluyordu)."""
    _, since = http("GET", f"/dta/chat/since?cursor={ctx['cursor']}", base=ctx["base"])
    ctx["cursor_text_shape"] = int(since.get("cursor", ctx["cursor"]))
    status, out = http(
        "POST", "/dta/chat",
        {"text": "[E2E] text-govde kabul testi"}, base=ctx["base"],
    )
    ok = out.get("ok") is True and int(out.get("accepted", 0)) >= 1
    detail = f"accepted={out.get('accepted')} lastId={out.get('lastId')}"
    if not ok and out.get("_error"):
        detail += f" err={out['_error']}"
    return (PASS if ok else FAIL), detail


def t_chat_turns_shape(ctx) -> tuple[str, str]:
    payload = {"turns": [
        {"role": "user", "text": "[E2E] turns-sekli 1", "meta": "e2e"},
        {"role": "user", "text": "[E2E] turns-sekli 2", "meta": "e2e"},
    ]}
    status, out = http("POST", "/dta/chat", payload, base=ctx["base"])
    ok = out.get("ok") is True and int(out.get("accepted", 0)) == 2
    return (PASS if ok else FAIL), f"accepted={out.get('accepted')}"


def t_since_returns(ctx) -> tuple[str, str]:
    status, since = http(
        "GET", f"/dta/chat/since?cursor={ctx['cursor_text_shape']}", base=ctx["base"],
    )
    ctx["cursor"] = int(since.get("cursor", ctx["cursor"]))
    texts = [str(t.get("text", "")) for t in since.get("turns", [])]
    ok = "[E2E] text-govde kabul testi" in texts
    return (PASS if ok else FAIL), f"ring tur sayısı={len(texts)}"


def t_outbox_pending_ack(ctx) -> tuple[str, str]:
    status, out = http("POST", "/dta/chat/outbox", {"text": "[E2E] outbox pending"}, base=ctx["base"])
    last_id = int(out.get("lastId", 0))
    pending = out.get("pending") or []
    found_now = any(int(p.get("id", 0)) == last_id for p in pending)
    if found_now:
        http("POST", "/dta/chat", {"turns": [], "ackCursor": last_id}, base=ctx["base"])
        _, pend2 = http("GET", "/dta/chat/pending", base=ctx["base"])
        gone = not any(int(p.get("id", 0)) == last_id for p in (pend2.get("pending") or []))
        return (PASS if gone else FAIL), f"lastId={last_id} ack sonrası pending temizlendi"
    # DTA canlıysa poller (2 sn) çoktan tüketip ack'lemiş olabilir — bu da geçerli
    _, since = http("GET", f"/dta/chat/since?cursor={ctx['cursor']}", base=ctx["base"])
    ctx["cursor"] = int(since.get("cursor", ctx["cursor"]))
    if since.get("dtaOnline"):
        return PASS, f"lastId={last_id} — DTA poller tüketti (dtaOnline)"
    return FAIL, f"lastId={last_id} pending'de görünmedi ve DTA canlı değil"


def t_window_flag(ctx) -> tuple[str, str]:
    _, w0 = http("GET", "/dta/window", base=ctx["base"])
    ctx["initial_hidden"] = bool(w0.get("hidden"))
    http("POST", "/dta/window/hide", {}, base=ctx["base"])
    _, w1 = http("GET", "/dta/window", base=ctx["base"])
    hid = w1.get("hidden") is True
    http("POST", "/dta/window/restore", {}, base=ctx["base"])
    _, w2 = http("GET", "/dta/window", base=ctx["base"])
    res = w2.get("hidden") is False
    ok = hid and res
    return (PASS if ok else FAIL), f"hide→hidden=True, restore→hidden=False (başlangıç={ctx['initial_hidden']})"


def t_dta_online(ctx) -> tuple[str, str]:
    _, since = http("GET", f"/dta/chat/since?cursor={ctx['cursor']}", base=ctx["base"])
    ctx["cursor"] = int(since.get("cursor", ctx["cursor"]))
    ok = since.get("dtaOnline") is True
    return (PASS if ok else FAIL), "dtaOnline=True (poller temasta)"


def t_panel_delivered(ctx) -> tuple[str, str]:
    ctx["log"].mark("panel")
    http("POST", "/dta/chat/outbox", {"text": "[E2E] teslimat kaniti"}, base=ctx["base"])
    ok = wait_until(lambda: ctx["log"].has_since("panel", "[chat] panel mesaji alindi"), ctx["wait"])
    return (PASS if ok else FAIL), "boot.log: [chat] panel mesaji alindi (0.4.155 kanıt satırı)"


def t_live_send(ctx) -> tuple[str, str]:
    ok = wait_until(lambda: ctx["log"].has_since("panel", "[chat] send_client_content ok"), 20)
    alt = wait_until(lambda: ctx["log"].has_since("panel", "[chat] send_realtime_input(text) fallback ok"), 3)
    ok = ok or alt
    return (PASS if ok else FAIL), "boot.log: send_client_content ok (yazı Live'a ulaştı)"


def t_transcript(ctx) -> tuple[str, str]:
    ok = wait_until(
        lambda: ctx["log"].has_since("panel", "[chat] out_transcript", "[chat] model_turn.text"),
        ctx["wait"],
    )
    return (PASS if ok else FAIL), "boot.log: asistan sesi transcript kanalı (out_transcript/model_turn.text)"


def t_turn_complete(ctx) -> tuple[str, str]:
    ok = wait_until(lambda: ctx["log"].has_since("panel", "[chat] turn_complete:"), ctx["wait"])
    return (PASS if ok else FAIL), "boot.log: turn_complete tetiklendi"


def t_push_ok(ctx) -> tuple[str, str]:
    ok = wait_until(
        lambda: any("push ok" in ln and "assistant" in ln for ln in ctx["log"].since("panel")),
        ctx["wait"],
    )
    return (PASS if ok else FAIL), "boot.log: [chat] push ok roles=['assistant'] — halkaya itildi"


def t_ring_assistant(ctx) -> tuple[str, str]:
    _, since = http("GET", f"/dta/chat/since?cursor={ctx['cursor_live_start']}", base=ctx["base"])
    ctx["cursor"] = int(since.get("cursor", ctx["cursor"]))
    has_assistant = any(t.get("role") == "assistant" for t in since.get("turns", []))
    return (PASS if has_assistant else FAIL), "halkada assistant turu var (since canlı başlangıcı)"


def t_hide(ctx) -> tuple[str, str]:
    ctx["log"].mark("hide")
    http("POST", "/dta/window/hide", {}, base=ctx["base"])
    ok = wait_until(lambda: window_visible(ctx["title"]) is False, 15)
    vis = window_visible(ctx["title"])
    return (PASS if ok else FAIL), f"hide→IsWindowVisible=False (hwnd görünürlük={vis})"


def t_hide_log(ctx) -> tuple[str, str]:
    ok = wait_until(lambda: ctx["log"].has_since("hide", "[panel] hide uygulandi"), 10)
    return (PASS if ok else FAIL), "boot.log: [panel] hide uygulandi kanıtı"


def t_hidden_chat(ctx) -> tuple[str, str]:
    ctx["log"].mark("hidden_chat")
    http("POST", "/dta/chat/outbox", {"text": "[E2E] gizliyken konusma suruyor"}, base=ctx["base"])
    ok = wait_until(
        lambda: any("push ok" in ln and "assistant" in ln for ln in ctx["log"].since("hidden_chat")),
        ctx["wait"],
    )
    return (PASS if ok else FAIL), "gizliyken yeni assistant yanıtı halkaya düştü (konuşma sürüyor)"


def t_restore(ctx) -> tuple[str, str]:
    ctx["log"].mark("restore")
    http("POST", "/dta/window/restore", {}, base=ctx["base"])
    ok = wait_until(lambda: window_visible(ctx["title"]) is True, 15)
    vis = window_visible(ctx["title"])
    return (PASS if ok else FAIL), f"restore→IsWindowVisible=True (görünürlük={vis})"


def t_restore_log(ctx) -> tuple[str, str]:
    ok = wait_until(lambda: ctx["log"].has_since("restore", "[panel] restore uygulandi"), 10)
    return (PASS if ok else FAIL), "boot.log: [panel] restore uygulandi kanıtı"


# (ad, fn, DTA gerekli)
TESTS = [
    ("health_ok", t_health, False),
    ("chat_text_shape_accepted [0.4.155 regresyonu]", t_chat_text_shape, False),
    ("chat_turns_shape_accepted", t_chat_turns_shape, False),
    ("since_returns_pushed_turns", t_since_returns, False),
    ("outbox_pending_and_ack", t_outbox_pending_ack, False),
    ("window_flag_roundtrip", t_window_flag, False),
    ("dta_online_flag", t_dta_online, True),
    ("panel_message_delivered", t_panel_delivered, True),
    ("live_send_ok", t_live_send, True),
    ("assistant_transcription_received", t_transcript, True),
    ("turn_complete_fired", t_turn_complete, True),
    ("push_to_ring_ok", t_push_ok, True),
    ("assistant_turn_in_ring", t_ring_assistant, True),
    ("hide_withdraws_window", t_hide, True),
    ("hide_bootlog_evidence", t_hide_log, True),
    ("conversation_continues_while_hidden", t_hidden_chat, True),
    ("restore_deiconify", t_restore, True),
    ("restore_bootlog_evidence", t_restore_log, True),
]


def cleanup(ctx) -> None:
    """Sistemi bulduğumuz duruma döndür: pencere bayrağı + bekleyen pending."""
    try:
        _, w = http("GET", "/dta/window", base=ctx["base"])
        if bool(w.get("hidden")) != ctx.get("initial_hidden", False):
            action = "/dta/window/hide" if ctx.get("initial_hidden") else "/dta/window/restore"
            http("POST", action, {}, base=ctx["base"])
    except Exception:
        pass
    try:
        _, pend = http("GET", "/dta/chat/pending", base=ctx["base"])
        ids = [int(p.get("id", 0)) for p in (pend.get("pending") or [])]
        if ids:
            http("POST", "/dta/chat", {"turns": [], "ackCursor": max(ids)}, base=ctx["base"])
    except Exception:
        pass


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="VOTEX <-> DTA köprü canlı E2E")
    ap.add_argument("--bridge-url", default=f"http://{DEFAULT_BRIDGE_HOST}:{DEFAULT_BRIDGE_PORT}")
    ap.add_argument("--boot-log", default=DEFAULT_BOOT_LOG)
    ap.add_argument("--window-title", default=DEFAULT_WINDOW_TITLE)
    ap.add_argument("--bridge-only", action="store_true", help="DTA bağımlı senaryoları atla")
    ap.add_argument("--wait", type=float, default=45.0, help="bekleme üst sınırı (sn)")
    args = ap.parse_args()

    ctx = {"base": args.bridge_url, "title": args.window_title, "wait": args.wait,
           "cursor": 0, "cursor_live_start": 0, "log": BootLog(args.boot_log)}

    # Önkoşul: köprü canlı olmalı
    status, health = http("GET", "/health", base=ctx["base"])
    if health.get("ok") is not True:
        print(f"KÖPRÜ YOK: {ctx['base']} yanıt vermiyor ({health.get('_error', status)}).")
        print("VOTEX'i başlatın (köprü 127.0.0.1:18765) ve yeniden deneyin.")
        return 1
    _, w0 = http("GET", "/dta/window", base=ctx["base"])
    ctx["initial_hidden"] = bool(w0.get("hidden"))

    _, since0 = http("GET", "/dta/chat/since?cursor=0", base=ctx["base"])
    dta_online = since0.get("dtaOnline") is True
    ctx["cursor"] = int(since0.get("cursor", 0))

    mode = "bridge-only" if args.bridge_only else ("tam tur (DTA canlı)" if dta_online else "tam tur istendi ama DTA canlı değil")
    print(f"VOTEX <-> DTA canlı E2E — mod: {mode}")
    print(f"Köprü: {ctx['base']}  boot.log: {args.boot_log}")
    print("-" * 72)

    counters = {PASS: 0, FAIL: 0, SKIP: 0}
    for name, fn, needs_dta in TESTS:
        if needs_dta and args.bridge_only:
            counters[SKIP] += 1
            print(f"  {SKIP:4}  {name} (DTA senaryosu --bridge-only)")
            continue
        if needs_dta and not dta_online:
            counters[SKIP] += 1
            print(f"  {SKIP:4}  {name} (DTA canlı değil — başlatıp yeniden deneyin)")
            continue
        if name == "dta_online_flag":
            ctx["cursor_live_start"] = ctx["cursor"]
        try:
            result, detail = fn(ctx)
        except Exception as e:
            result, detail = FAIL, f"istisna: {e}"
        counters[result] += 1
        print(f"  {result:4}  {name} — {detail}")

    cleanup(ctx)

    print("-" * 72)
    total = len(TESTS)
    print(f"SONUÇ: {counters[PASS]} PASS, {counters[FAIL]} FAIL, {counters[SKIP]} SKIP (toplam {total})")
    return 1 if counters[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
