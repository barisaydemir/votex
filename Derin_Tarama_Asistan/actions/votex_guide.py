"""
DTA → VOTEX yönlendirme köprüsü.

VOTEX açıkken localhost:18765 /guide ile yapı ipuçları gönderilir;
VOTEX son haritayı yeniden hesaplar, 3D'yi günceller ve kaydeder.

Güçlü bağlantı: çoklu deneme, RTT ölçümü, arka plan heartbeat.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any

VOTEX_BRIDGE = "http://127.0.0.1:18765"
TIMEOUT_S = 20
RETRY_COUNT = 4
RETRY_DELAY_S = 0.55
HEARTBEAT_INTERVAL_S = 12

_hb_lock = threading.Lock()
_hb_thread: threading.Thread | None = None
_hb_stop = threading.Event()
_last_link: dict[str, Any] = {
    "ok": False,
    "rtt_ms": None,
    "checked_at": 0.0,
    "message": "",
    "has_session": False,
    "hint_count": 0,
}


def _http_json(
    method: str,
    path: str,
    payload: dict | None = None,
    *,
    timeout: float = TIMEOUT_S,
    retries: int = 1,
) -> dict[str, Any]:
    url = f"{VOTEX_BRIDGE}{path}"
    last_err: dict[str, Any] | None = None
    for attempt in range(max(1, retries)):
        data = None
        headers = {"Accept": "application/json", "Connection": "close"}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            rtt = int((time.perf_counter() - t0) * 1000)
            if not raw.strip():
                return {"ok": True, "rttMs": rtt}
            out = json.loads(raw)
            if isinstance(out, dict):
                out.setdefault("ok", True)
                out["rttMs"] = rtt
                return out
            return {"ok": True, "rttMs": rtt, "data": out}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
                if isinstance(parsed, dict):
                    last_err = parsed
                    last_err.setdefault("ok", False)
                else:
                    last_err = {"ok": False, "message": f"HTTP {e.code}: {body[:300]}"}
            except Exception:
                last_err = {"ok": False, "message": f"HTTP {e.code}: {body[:300]}"}
        except urllib.error.URLError as e:
            last_err = {
                "ok": False,
                "message": (
                    f"VOTEX köprüsü henüz yanıt vermedi ({VOTEX_BRIDGE}). "
                    f"VOTEX açık mı? Birkaç saniye sonra tekrar denenecek. ({e.reason})"
                ),
            }
        except Exception as e:
            last_err = {"ok": False, "message": str(e)}
        if attempt + 1 < retries:
            time.sleep(RETRY_DELAY_S * (attempt + 1))
    return last_err or {"ok": False, "message": "VOTEX köprüsü yanıt vermiyor."}


def votex_bridge_health() -> dict[str, Any]:
    return _http_json("GET", "/health", retries=RETRY_COUNT, timeout=8)


def votex_bridge_status() -> dict[str, Any]:
    return _http_json("GET", "/status", retries=RETRY_COUNT, timeout=8)


def probe_votex_link(*, forceful: bool = True) -> dict[str, Any]:
    """
    VOTEX localhost köprüsünü güçlü kontrol eder.
    Gemini/internet bağlantısı ile karıştırılmaz.
    """
    retries = RETRY_COUNT if forceful else 2
    health = _http_json("GET", "/health", retries=retries, timeout=8)
    if not health.get("ok"):
        result = {
            "ok": False,
            "quality": "down",
            "rtt_ms": None,
            "has_session": False,
            "hint_count": 0,
            "message": health.get("message")
            or "VOTEX köprüsü kapalı — VOTEX uygulamasını açın.",
        }
        _store_link(result)
        return result

    st = _http_json("GET", "/status", retries=retries, timeout=8)
    rtt = health.get("rttMs") or st.get("rttMs")
    has_session = bool(st.get("hasSession"))
    hint_count = int(st.get("hintCount") or 0)
    if rtt is None:
        quality = "ok"
    elif int(rtt) <= 120:
        quality = "strong"
    elif int(rtt) <= 800:
        quality = "ok"
    else:
        quality = "slow"

    if has_session:
        msg = (
            f"VOTEX köprüsü sağlam (RTT {rtt} ms). "
            f"3D oturum var · ipucu={hint_count}."
        )
    else:
        msg = (
            f"VOTEX köprüsü sağlam (RTT {rtt} ms). "
            "Henüz 3D yok — VOTEX'te harita yükleyip Analizi Başlat."
        )
    result = {
        "ok": True,
        "quality": quality,
        "rtt_ms": rtt,
        "has_session": has_session,
        "hint_count": hint_count,
        "view_mode": st.get("viewMode"),
        "message": msg,
    }
    _store_link(result)
    return result


def _store_link(info: dict[str, Any]) -> None:
    with _hb_lock:
        _last_link.clear()
        _last_link.update(info)
        _last_link["checked_at"] = time.time()


def get_last_votex_link() -> dict[str, Any]:
    with _hb_lock:
        return dict(_last_link)


def _heartbeat_loop() -> None:
    while not _hb_stop.is_set():
        try:
            probe_votex_link(forceful=False)
        except Exception:
            pass
        _hb_stop.wait(HEARTBEAT_INTERVAL_S)


def start_votex_heartbeat() -> None:
    """DTA açık kaldığı sürece VOTEX /health ping — 'bağlı değil' sahte alarmını keser."""
    global _hb_thread
    with _hb_lock:
        if _hb_thread and _hb_thread.is_alive():
            return
        _hb_stop.clear()
        _hb_thread = threading.Thread(
            target=_heartbeat_loop, name="votex-bridge-hb", daemon=True
        )
        _hb_thread.start()


def stop_votex_heartbeat() -> None:
    _hb_stop.set()


def _norm_hint(h: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(h, dict):
        return None
    kind = str(h.get("kind") or h.get("type") or "").strip().lower()
    if not kind:
        return None
    aliases = {
        "oda": "room",
        "mezar": "tomb",
        "tunel": "tunnel",
        "tünel": "tunnel",
        "koridor": "tunnel",
        "kuyu": "shaft",
        "well": "shaft",
        "anomali": "metal",
        "field": "metal",
    }
    kind = aliases.get(kind, kind)
    try:
        cx = float(h.get("cx", h.get("x", 0.5)))
        cy = float(h.get("cy", h.get("y", 0.5)))
    except (TypeError, ValueError):
        return None
    rx = float(h.get("rx", h.get("radius", 0.06)) or 0.06)
    ry = float(h.get("ry", h.get("radius_y", rx)) or rx)
    label = str(h.get("label") or h.get("note") or "").strip()
    return {
        "kind": kind,
        "cx": max(0.02, min(0.98, cx)),
        "cy": max(0.02, min(0.98, cy)),
        "rx": max(0.02, min(0.25, rx)),
        "ry": max(0.02, min(0.25, ry)),
        "label": label or f"DTA {kind}",
    }


def guide_votex(
    hints: list | str | None = None,
    clear: bool = False,
    append: bool = False,
    rebuild: bool = True,
    note: str = "",
) -> str:
    """
    VOTEX'e yapı yönlendirmesi gönder; 3D yeniden çizilir ve VOTEX kaydeder.

    hints: [{kind, cx, cy, rx?, ry?, label?}] — konumlar 0–1 normalize
      kind: room|tomb|tunnel|metal|shaft
    """
    start_votex_heartbeat()

    parsed: list[dict] = []
    if isinstance(hints, str):
        text = hints.strip()
        if text:
            try:
                hints = json.loads(text)
            except json.JSONDecodeError:
                return (
                    "hints JSON değil. Örnek: "
                    '[{"kind":"room","cx":0.45,"cy":0.55,"rx":0.08,"ry":0.06,"label":"olası oda"}]'
                )
    if isinstance(hints, dict):
        hints = [hints]
    if isinstance(hints, list):
        for item in hints:
            nh = _norm_hint(item) if isinstance(item, dict) else None
            if nh:
                parsed.append(nh)

    if not clear and not parsed and not note:
        link = probe_votex_link(forceful=True)
        if not link.get("ok"):
            return (
                f"{link.get('message')}\n"
                "Bu localhost köprüsüdür (internet değil). "
                "VOTEX açıkken tekrar guide_votex çağır. "
                "Kullanıcıya 'bağlantım kötü' deme — VOTEX kapalı/hazır değil de."
            )
        return (
            f"{link.get('message')}\n"
            "Yönlendirmek için hints gönder (örn. room cx=0.4 cy=0.6). "
            "İpucu gönderince VOTEX 3D yeniden çizilir ve kaydedilir."
        )

    # Önce köprüyü doğrula
    link = probe_votex_link(forceful=True)
    if not link.get("ok"):
        return (
            f"VOTEX yönlendirme yapılamadı: {link.get('message')}\n"
            "Internet/Gemini değil — VOTEX uygulaması ve 3D oturumu gerekli. "
            "'Bağlantım kötü' deme; VOTEX'i açıp Analizi Başlat de."
        )
    if not link.get("has_session") and rebuild:
        return (
            "VOTEX köprüsü açık ama henüz 3D oturumu yok. "
            "Kullanıcıya söyle: VOTEX'te haritayı yükleyip Analizi Başlat. "
            "Sonra aynı ipuçlarıyla guide_votex tekrar çağırılacak."
        )

    payload = {
        "hints": parsed,
        "clear": bool(clear),
        "append": bool(append),
        "rebuild": bool(rebuild),
        "persist": True,
    }
    result = _http_json(
        "POST", "/guide", payload, retries=RETRY_COUNT, timeout=TIMEOUT_S
    )
    if not result.get("ok", False):
        return (
            f"VOTEX yönlendirme başarısız: {result.get('message')}\n"
            "Köprü yanıt verdi ama işlem tamamlanamadı — 'bağlantı kötü' değil."
        )

    msg = result.get("message") or "tamam"
    n = result.get("hintCount", len(parsed))
    rebuilt = result.get("rebuilt", rebuild)
    saved = result.get("saved", False)
    lines = [
        f"VOTEX yönlendirildi: {n} ipucu · 3D yeniden çizim={'evet' if rebuilt else 'hayır'} · kayıt={'evet' if saved else 'hayır'}.",
        f"Köprü: {msg}",
    ]
    if note:
        lines.append(f"Not: {note}")
    if parsed:
        brief = ", ".join(
            f"{h['kind']}@{h['cx']:.2f},{h['cy']:.2f}" for h in parsed[:6]
        )
        lines.append(f"İpuçları: {brief}")
    lines.append(
        "3D sahnede yeni/güçlendirilmiş yapılar görünmeli ve VOTEX son değişiklikleri kaydetti. "
        "Kullanıcıya kısa Türkçe saha diliyle söyle; internet bağlantısından bahsetme."
    )
    return "\n".join(lines)


def hints_from_local_stats(structured: dict | None) -> list[dict]:
    """Yerel VOTEX ekran özetinden kaba ipucu üret."""
    if not structured or not isinstance(structured, dict):
        return []
    out: list[dict] = []
    for key, kind in (
        ("void_blobs", "room"),
        ("rooms", "room"),
        ("metals", "metal"),
        ("tunnels", "tunnel"),
    ):
        items = structured.get(key)
        if not isinstance(items, list):
            continue
        for it in items[:4]:
            if not isinstance(it, dict):
                continue
            cx = it.get("cx", it.get("x"))
            cy = it.get("cy", it.get("y"))
            if cx is None or cy is None:
                continue
            try:
                out.append(
                    {
                        "kind": kind,
                        "cx": float(cx),
                        "cy": float(cy),
                        "rx": float(it.get("rx", 0.07) or 0.07),
                        "ry": float(it.get("ry", 0.06) or 0.06),
                        "label": str(it.get("label") or f"auto-{kind}"),
                    }
                )
            except (TypeError, ValueError):
                continue
    return out
