"""
Windows yerel takvim araci.

Windows'un herkeste ortak ve izin istemeyen bir Calendar API'si olmadigi icin JARVIS,
etkinlikleri proje belleğinde JSON olarak tutar. Bu, sesli asistana takvim okuma,
ekleme ve silme islevlerini Windows'ta ek bagimlilik olmadan saglar.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
CALENDAR_FILE = BASE_DIR / "memory" / "calendar_events.json"

TR_WEEKDAYS = ["Pazartesi", "Sali", "Carsamba", "Persembe", "Cuma", "Cumartesi", "Pazar"]
TR_MONTHS = ["", "Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran", "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"]


def _load_events() -> list[dict]:
    try:
        if CALENDAR_FILE.exists():
            data = json.loads(CALENDAR_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
    except Exception:
        pass
    return []


def _save_events(events: list[dict]) -> None:
    CALENDAR_FILE.parent.mkdir(parents=True, exist_ok=True)
    CALENDAR_FILE.write_text(json.dumps(events, indent=2, ensure_ascii=False), encoding="utf-8")


def _parse_iso(value: str) -> dt.datetime:
    value = (value or "").strip()
    if not value:
        raise ValueError("Tarih bos.")
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def _to_event(item: dict) -> dict | None:
    try:
        start = _parse_iso(str(item.get("start_iso", "")))
        end_raw = str(item.get("end_iso", "") or "")
        end = _parse_iso(end_raw) if end_raw else start + dt.timedelta(hours=1)
    except Exception:
        return None
    return {
        "id": str(item.get("id", "")),
        "start_ts": int(start.timestamp()),
        "end_ts": int(end.timestamp()),
        "calendar": str(item.get("calendar", "Windows Local")).strip(),
        "title": str(item.get("title", "")).strip() or "Adsiz etkinlik",
        "location": str(item.get("location", "")).strip(),
        "all_day": bool(item.get("all_day", False)),
    }


def _month_start(value: dt.datetime) -> dt.datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _add_months(value: dt.datetime, months: int) -> dt.datetime:
    total = (value.year * 12 + (value.month - 1)) + months
    return value.replace(year=total // 12, month=total % 12 + 1, day=1)


def _normalize_query(query: str) -> dict:
    q = (query or "today").strip().lower()
    now = dt.datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    month_match = re.search(r"(\d+)\s*(ay|month|months)", q)
    if "gelecek ay" in q or "onumuzdeki ay" in q or "next month" in q:
        start = _add_months(_month_start(now), 1)
        return {"start": start, "end": _add_months(start, 1), "limit": 24, "kind": "next_month", "header": "Gelecek ay icin {count} etkinlik buldum:", "empty": "Gelecek ay takviminde etkinlik gorunmuyor."}
    if "bu ay" in q or "this month" in q:
        start = _month_start(now)
        return {"start": start, "end": _add_months(start, 1), "limit": 24, "kind": "this_month", "header": "Bu ay icin {count} etkinlik buldum:", "empty": "Bu ay takviminde etkinlik gorunmuyor."}
    if month_match:
        months = max(1, min(12, int(month_match.group(1))))
        return {"start": today_start, "end": _add_months(_month_start(now), months), "limit": min(60, max(12, months * 12)), "kind": "months", "header": f"Onumuzdeki {months} ay icin {{count}} etkinlik buldum:", "empty": f"Onumuzdeki {months} ayda takviminde etkinlik gorunmuyor."}

    week_match = re.search(r"(\d+)\s*(hafta|week|weeks)", q)
    if week_match:
        weeks = max(1, min(12, int(week_match.group(1))))
        return {"start": today_start, "end": today_start + dt.timedelta(days=weeks * 7), "limit": min(60, max(8, weeks * 8)), "kind": "weeks", "header": f"Onumuzdeki {weeks} hafta icin {{count}} etkinlik buldum:", "empty": f"Onumuzdeki {weeks} haftada takviminde etkinlik gorunmuyor."}

    day_match = re.search(r"(\d+)\s*(g[uü]n|gun|day|days)", q)
    if day_match:
        days = max(1, min(365, int(day_match.group(1))))
        return {"start": today_start, "end": today_start + dt.timedelta(days=days), "limit": min(60, max(8, days * 2)), "kind": "days", "header": f"Onumuzdeki {days} gun icin {{count}} etkinlik buldum:", "empty": f"Onumuzdeki {days} gunde takviminde etkinlik gorunmuyor."}

    if any(token in q for token in ("yarin", "tomorrow")):
        return {"start": today_start + dt.timedelta(days=1), "end": today_start + dt.timedelta(days=2), "limit": 6, "kind": "tomorrow", "header": "Yarin icin {count} etkinlik buldum:", "empty": "Yarin takviminde etkinlik gorunmuyor."}
    if any(token in q for token in ("hafta", "week", "7 gun")):
        return {"start": today_start, "end": today_start + dt.timedelta(days=7), "limit": 10, "kind": "week", "header": "Onumuzdeki 7 gun icin {count} etkinlik buldum:", "empty": "Onumuzdeki 7 gunde takviminde etkinlik gorunmuyor."}
    if any(token in q for token in ("siradaki", "sıradaki", "sonraki", "next")):
        return {"start": now, "end": today_start + dt.timedelta(days=365), "limit": 1, "kind": "next", "header": "", "empty": "Siradaki takvim etkinligini bulamadim."}
    if any(token in q for token in ("ajanda", "agenda", "yaklasan", "yaklaşan", "upcoming")):
        return {"start": now, "end": today_start + dt.timedelta(days=365), "limit": 8, "kind": "agenda", "header": "Yaklasan ajandanda {count} etkinlik var:", "empty": "Yaklasan takvim etkinligi gorunmuyor."}
    return {"start": today_start, "end": today_start + dt.timedelta(days=1), "limit": 6, "kind": "today", "header": "Bugun icin {count} etkinlik buldum:", "empty": "Bugun takviminde etkinlik gorunmuyor."}


def _day_label(when: dt.datetime, now: dt.datetime) -> str:
    if when.date() == now.date():
        return "bugun"
    if when.date() == now.date() + dt.timedelta(days=1):
        return "yarin"
    return f"{when.day} {TR_MONTHS[when.month]} {TR_WEEKDAYS[when.weekday()]}"


def _format_time_range(event: dict, now: dt.datetime) -> str:
    start = dt.datetime.fromtimestamp(event["start_ts"])
    end = dt.datetime.fromtimestamp(event["end_ts"])
    prefix = _day_label(start, now)
    if event["all_day"]:
        return f"{prefix} tum gun"
    return f"{prefix} {start.strftime('%H:%M')}-{end.strftime('%H:%M')}"


def _format_event_line(event: dict, now: dt.datetime) -> str:
    pieces = [f"{_format_time_range(event, now)} - {event['title']}"]
    if event["calendar"]:
        pieces.append(f"[{event['calendar']}]")
    if event["location"]:
        pieces.append(f"@ {event['location']}")
    return " ".join(pieces)


def get_calendar_events(query: str = "today", limit: int = 6) -> str:
    window = _normalize_query(query)
    selected_limit = max(1, min(60, int(limit or window["limit"])))
    start_ts = int(window["start"].timestamp())
    end_ts = int(window["end"].timestamp())
    events = [
        event for event in (_to_event(item) for item in _load_events())
        if event and event["end_ts"] >= start_ts and event["start_ts"] < end_ts
    ]
    events.sort(key=lambda event: (event["start_ts"], event["title"].lower()))

    if not events:
        return window["empty"]
    if window["kind"] == "next":
        return f"Siradaki etkinlik: {_format_event_line(events[0], dt.datetime.now())}."

    selected = events[:selected_limit]
    lines = [str(window["header"]).format(count=len(selected))]
    now = dt.datetime.now()
    lines.extend(f"- {_format_event_line(event, now)}" for event in selected)
    return "\n".join(lines)


def add_calendar_event(
    title: str,
    start_iso: str,
    end_iso: str = "",
    notes: str = "",
    location: str = "",
    calendar_name: str = "",
    all_day: bool = False,
) -> str:
    title = (title or "").strip()
    start_iso = (start_iso or "").strip()
    if not title:
        return "Takvime eklemek icin etkinlik basligi gerekli."
    if not start_iso:
        return "Takvime eklemek icin baslangic tarihi gerekli."

    try:
        start = _parse_iso(start_iso)
        end = _parse_iso(end_iso) if (end_iso or "").strip() else start + dt.timedelta(hours=1)
    except Exception as exc:
        return f"Takvim etkinligi eklenemedi: tarih okunamadi ({exc})."

    item = {
        "id": f"local-{int(dt.datetime.now().timestamp() * 1000)}",
        "title": title,
        "start_iso": start.isoformat(),
        "end_iso": end.isoformat(),
        "notes": (notes or "").strip(),
        "location": (location or "").strip(),
        "calendar": (calendar_name or "Windows Local").strip(),
        "all_day": bool(all_day),
    }
    events = _load_events()
    events.append(item)
    _save_events(events)
    event = _to_event(item)
    assert event is not None
    return f"Takvime eklendi: {_format_event_line(event, dt.datetime.now())}."


def delete_calendar_event(
    title: str,
    start_iso: str = "",
    calendar_name: str = "",
    delete_all_matches: bool = False,
) -> str:
    title_norm = (title or "").strip().casefold()
    if not title_norm:
        return "Takvimden silmek icin etkinlik basligi gerekli."

    start_filter = None
    if (start_iso or "").strip():
        try:
            start_filter = _parse_iso(start_iso)
        except Exception:
            start_filter = None

    events = _load_events()
    matches: list[tuple[int, dict]] = []
    for index, item in enumerate(events):
        event = _to_event(item)
        if not event:
            continue
        if title_norm not in event["title"].casefold():
            continue
        if calendar_name and calendar_name.casefold() not in event["calendar"].casefold():
            continue
        if start_filter:
            event_start = dt.datetime.fromtimestamp(event["start_ts"])
            if abs((event_start - start_filter).total_seconds()) > 24 * 60 * 60:
                continue
        matches.append((index, event))

    if not matches:
        return "Eslesen yerel Windows takvim etkinligi bulunamadi."
    if len(matches) > 1 and not delete_all_matches and not start_filter:
        now = dt.datetime.now()
        preview = " | ".join(_format_event_line(event, now) for _, event in matches[:3])
        return f"Birden fazla etkinlik eslesti. Tarih/saat belirt: {preview}"

    remove_indexes = {index for index, _ in (matches if delete_all_matches else matches[:1])}
    deleted = matches[0][1]
    _save_events([item for index, item in enumerate(events) if index not in remove_indexes])
    return f"Takvimden silindi: {_format_event_line(deleted, dt.datetime.now())}."
