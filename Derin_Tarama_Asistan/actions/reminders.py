"""
Windows yerel animsatici araci.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
REMINDERS_FILE = BASE_DIR / "memory" / "reminders.json"
TR_WEEKDAYS = ["Pazartesi", "Sali", "Carsamba", "Persembe", "Cuma", "Cumartesi", "Pazar"]
TR_MONTHS = ["", "Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran", "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"]


def _load_reminders() -> list[dict]:
    try:
        if REMINDERS_FILE.exists():
            data = json.loads(REMINDERS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
    except Exception:
        pass
    return []


def _save_reminders(items: list[dict]) -> None:
    REMINDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    REMINDERS_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


def _parse_iso(value: str) -> dt.datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        try:
            return dt.datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return None


def _day_label(when: dt.datetime, now: dt.datetime) -> str:
    if when.date() == now.date():
        return "bugun"
    if when.date() == now.date() + dt.timedelta(days=1):
        return "yarin"
    return f"{when.day} {TR_MONTHS[when.month]} {TR_WEEKDAYS[when.weekday()]}"


def _format_due(item: dict, now: dt.datetime) -> str:
    due = _parse_iso(str(item.get("due_iso", "")))
    if not due:
        return "zaman atanmamis"
    if item.get("all_day"):
        return f"{_day_label(due, now)} tum gun"
    return f"{_day_label(due, now)} {due.strftime('%H:%M')}"


def _format_reminder_line(item: dict, now: dt.datetime) -> str:
    parts = [f"{_format_due(item, now)} - {str(item.get('title', 'Adsiz animsatici'))}"]
    if item.get("list_name"):
        parts.append(f"[{item['list_name']}]")
    if str(item.get("priority", "")).lower() in {"high", "1", "yuksek"}:
        parts.append("(yuksek oncelik)")
    return " ".join(parts)


def _open_items() -> list[dict]:
    return [item for item in _load_reminders() if not item.get("completed")]


def get_reminders(query: str = "upcoming", limit: int = 8, list_name: str = "") -> str:
    query = (query or "upcoming").strip().lower()
    limit = max(1, min(20, int(limit or 8)))
    now = dt.datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today + dt.timedelta(days=1)

    items = _open_items()
    if list_name:
        items = [item for item in items if list_name.casefold() in str(item.get("list_name", "")).casefold()]

    def due_dt(item: dict) -> dt.datetime:
        return _parse_iso(str(item.get("due_iso", ""))) or dt.datetime.max

    if any(token in query for token in ("bugun", "today")):
        items = [item for item in items if (due := _parse_iso(str(item.get("due_iso", "")))) and today <= due < tomorrow]
        header = f"Bugun icin {len(items[:limit])} animsatici buldum:"
        empty = "Bugun icin animsatici gorunmuyor."
    elif any(token in query for token in ("geciken", "gecmis", "overdue")):
        items = [item for item in items if (due := _parse_iso(str(item.get("due_iso", "")))) and due < now]
        header = f"Gecikmis {len(items[:limit])} animsatici buldum:"
        empty = "Geciken animsatici gorunmuyor."
    elif any(token in query for token in ("siradaki", "sıradaki", "next")):
        items = [item for item in items if due_dt(item) >= now]
        items.sort(key=due_dt)
        if not items:
            return "Siradaki animsaticiyi bulamadim."
        return f"Siradaki animsatici: {_format_reminder_line(items[0], now)}."
    elif any(token in query for token in ("hepsi", "tum", "tüm", "all", "listele")):
        header = f"Acik {len(items[:limit])} animsatici buldum:"
        empty = "Kayitli acik animsatici gorunmuyor."
    else:
        items = [item for item in items if due_dt(item) >= now]
        header = f"Yaklasan {len(items[:limit])} animsatici buldum:"
        empty = "Yaklasan animsatici gorunmuyor."

    items.sort(key=due_dt)
    selected = items[:limit]
    if not selected:
        return empty
    return "\n".join([header, *[f"- {_format_reminder_line(item, now)}" for item in selected]])


def add_reminder(
    title: str,
    due_iso: str = "",
    notes: str = "",
    list_name: str = "",
    priority: str = "",
    all_day: bool = False,
) -> str:
    title = (title or "").strip()
    if not title:
        return "Animsatici basligi bos olamaz."
    due = _parse_iso(due_iso)
    if due_iso and not due:
        return "Animsatici tarihi gecersiz. due_iso icin 'YYYY-MM-DD' veya 'YYYY-MM-DDTHH:MM' kullan."

    item = {
        "id": f"local-{int(dt.datetime.now().timestamp() * 1000)}",
        "title": title,
        "due_iso": due.isoformat(timespec="minutes") if due else "",
        "notes": (notes or "").strip(),
        "list_name": (list_name or "").strip(),
        "priority": (priority or "").strip(),
        "all_day": bool(all_day) or (bool(due_iso) and "T" not in due_iso),
        "completed": False,
    }
    items = _load_reminders()
    items.append(item)
    _save_reminders(items)
    list_suffix = f" [{item['list_name']}]" if item["list_name"] else ""
    return f"Animsatici eklendi: {_format_due(item, dt.datetime.now())} - {item['title']}{list_suffix}"
