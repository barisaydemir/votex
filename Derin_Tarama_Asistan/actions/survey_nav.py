"""ELIC saha taramasi: kose kaydi, 4. kose hesabi, sesli yonlendirme."""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from actions.compass_reader import read_elic_hud
from actions.windows_utils import capture_window
from app_config import get_app_config_value
from core.license_manager import max_corners_allowed

BASE_DIR = Path(__file__).resolve().parent.parent
SESSION_PATH = BASE_DIR / "memory" / "survey_session.json"

CORNER_POSITIONS = {
    1: (0.0, 0.0),
    2: (1.0, 0.0),
    3: (1.0, 1.0),
    4: (0.0, 1.0),
}


@dataclass
class SurveyCorner:
    index: int
    x_m: float
    y_m: float
    heading_deg: float | None
    depth_m: float | None
    surface_ref_ok: bool | None
    marked_at: str


def _load_session() -> dict[str, Any]:
    try:
        if SESSION_PATH.exists():
            return json.loads(SESSION_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"active": False, "width_m": 0.0, "length_m": 0.0, "corners": [], "corner4": None}


def _save_session(data: dict[str, Any]) -> None:
    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    SESSION_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _capture_hud() -> tuple[bool, str, dict[str, Any]]:
    target = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC").strip()
    depth_cap = float(get_app_config_value("elic_depth_cap_m", 10) or 10)
    ok, detail, payload = capture_window(target)
    if not ok:
        return False, detail, {}
    image_path = Path(str(payload.get("image_path", "")))
    try:
        hud = read_elic_hud(image_path, depth_cap_m=depth_cap)
        return True, "ok", hud
    finally:
        try:
            if image_path.exists():
                image_path.unlink()
        except Exception:
            pass


def start_survey(width_m: float, length_m: float) -> str:
    w = max(1.0, float(width_m or 1))
    l = max(1.0, float(length_m or 1))
    data = {
        "active": True,
        "width_m": w,
        "length_m": l,
        "corners": [],
        "corner4": None,
        "started_at": datetime.now().isoformat(timespec="seconds"),
    }
    _save_session(data)
    return f"Tarama baslatildi. Saha boyutu {w:.0f} x {l:.0f} metre. Birinci koseye gidip 'kose bir' deyin."


def mark_survey_corner(corner_index: int) -> str:
    session = _load_session()
    if not session.get("active"):
        return "Once taramayi baslatin. Ornek: 'Taramayi baslat, on metre on bes metre'."

    idx = int(corner_index)
    if idx < 1 or idx > 4:
        return "Kose numarasi 1 ile 4 arasinda olmali."

    max_c = max_corners_allowed()
    if max_c > 0 and idx > max_c:
        return (
            f"Mevcut lisans paketinde en fazla {max_c} kose isaretlenebilir. "
            "Tam lisans veya NAV ozelligi icin aktivasyon gerekir."
        )

    corners = session.get("corners") or []
    if idx > 1 and len(corners) < idx - 1:
        return f"Once kose {idx - 1} isaretlenmeli."

    if any(int(c.get("index", 0)) == idx for c in corners):
        return f"Kose {idx} zaten isaretlendi."

    ok, detail, hud = _capture_hud()
    if not ok:
        return f"ELIC ekrani alinamadi: {detail}"

    w = float(session.get("width_m", 1))
    l = float(session.get("length_m", 1))
    rx, ry = CORNER_POSITIONS.get(idx, (0.0, 0.0))
    corner = SurveyCorner(
        index=idx,
        x_m=rx * w,
        y_m=ry * l,
        heading_deg=hud.get("heading_deg"),
        depth_m=hud.get("depth_m"),
        surface_ref_ok=hud.get("surface_ref_ok"),
        marked_at=datetime.now().isoformat(timespec="seconds"),
    )
    corners.append(asdict(corner))
    session["corners"] = corners

    msg = (
        f"Kose {idx} kaydedildi. Konum ({corner.x_m:.1f}, {corner.y_m:.1f}) m. "
        f"Pusula: {hud.get('heading_cardinal') or hud.get('heading_deg') or 'okunamadi'}. "
    )
    if corner.depth_m is not None:
        msg += f"Derinlik: {corner.depth_m:.1f} m. "
    if corner.surface_ref_ok:
        msg += "LiDAR zemin referansi dogrulandi."

    if len(corners) == 3:
        c4 = compute_fourth_corner(session)
        session["corner4"] = asdict(c4) if c4 else None
        if c4:
            msg += (
                f" Dorduncu kose tahmini: ({c4.x_m:.1f}, {c4.y_m:.1f}) m. "
                "'Dorduncu koseye yonlendir' diyebilirsiniz."
            )

    _save_session(session)
    return msg.strip()


def compute_fourth_corner(session: dict | None = None) -> SurveyCorner | None:
    session = session or _load_session()
    corners = {int(c["index"]): c for c in (session.get("corners") or [])}
    if not all(k in corners for k in (1, 2, 3)):
        return None

    a = corners[1]
    b = corners[2]
    c = corners[3]
    dx = float(a["x_m"]) + float(c["x_m"]) - float(b["x_m"])
    dy = float(a["y_m"]) + float(c["y_m"]) - float(b["y_m"])

    return SurveyCorner(
        index=4,
        x_m=dx,
        y_m=dy,
        heading_deg=None,
        depth_m=None,
        surface_ref_ok=None,
        marked_at=datetime.now().isoformat(timespec="seconds"),
    )


def _normalize_angle(deg: float) -> float:
    while deg >= 360:
        deg -= 360
    while deg < 0:
        deg += 360
    return deg


def _angle_diff(current: float, target: float) -> float:
    diff = _normalize_angle(target - current)
    if diff > 180:
        diff -= 360
    return diff


def navigation_instruction(current_heading_deg: float | None, target_x: float, target_y: float,
                           current_x: float = 0.0, current_y: float = 0.0) -> str:
    dx = target_x - current_x
    dy = target_y - current_y
    dist = math.hypot(dx, dy)
    if dist < 0.5:
        return "Hedef kosedesiniz. 'Kose dort' diyerek isaretleyebilirsiniz."

    target_bearing = math.degrees(math.atan2(dx, dy))
    target_bearing = _normalize_angle(target_bearing)

    if current_heading_deg is None:
        return (
            f"Hedef koseye yaklasik {dist:.1f} metre kaldi. "
            f"Hedef yon {_bearing_to_cardinal(target_bearing)}. Pusula okunamadi; yonu ekrandan kontrol edin."
        )

    diff = _angle_diff(current_heading_deg, target_bearing)
    if abs(diff) <= 8:
        turn = "Yon dogru, ilerle."
    elif diff > 0:
        turn = f"{abs(diff):.0f} derece saga don."
    else:
        turn = f"{abs(diff):.0f} derece sola don."

    return f"{turn} Hedef koseye {dist:.1f} metre kaldi. Hedef yon {_bearing_to_cardinal(target_bearing)}."


def _bearing_to_cardinal(deg: float) -> str:
    deg = _normalize_angle(deg)
    for name, val in CARDINAL_NAMES:
        if abs(_angle_diff(deg, val)) <= 22.5:
            return name
    return f"{deg:.0f} derece"


CARDINAL_NAMES = [
    ("K", 0.0), ("KD", 45.0), ("D", 90.0), ("GD", 135.0),
    ("G", 180.0), ("GB", 225.0), ("B", 270.0), ("KB", 315.0),
]


def get_navigation_guidance() -> str:
    session = _load_session()
    if not session.get("active"):
        return "Aktif tarama yok. Once 'taramayi baslat' deyin."

    c4 = session.get("corner4")
    if not c4:
        c4_obj = compute_fourth_corner(session)
        if not c4_obj:
            marked = len(session.get("corners") or [])
            return f"Dorduncu kose icin once 3 kose isaretlenmeli. Su an {marked}/3."
        c4 = asdict(c4_obj)
        session["corner4"] = c4
        _save_session(session)

    ok, detail, hud = _capture_hud()
    if not ok:
        return f"Yonlendirme icin ELIC ekrani alinamadi: {detail}"

    corners = session.get("corners") or []
    if corners:
        last = corners[-1]
        cur_x, cur_y = float(last["x_m"]), float(last["y_m"])
    else:
        cur_x, cur_y = 0.0, 0.0

    instr = navigation_instruction(
        hud.get("heading_deg"),
        float(c4["x_m"]),
        float(c4["y_m"]),
        cur_x,
        cur_y,
    )
    if hud.get("depth_m") is not None:
        instr += f" Anlik derinlik {hud['depth_m']:.1f} m."
    return instr


def get_survey_status() -> str:
    session = _load_session()
    if not session.get("active"):
        return "Aktif saha taramasi yok."

    corners = session.get("corners") or []
    w = float(session.get("width_m", 0))
    l = float(session.get("length_m", 0))
    lines = [
        f"Tarama aktif: {w:.0f} x {l:.0f} m.",
        f"Isaretli kose: {len(corners)}/4.",
    ]
    for c in corners:
        line = f"  Kose {c['index']}: ({c['x_m']:.1f}, {c['y_m']:.1f}) m"
        if c.get("heading_deg") is not None:
            line += f", pusula {c['heading_deg']:.0f}"
        if c.get("depth_m") is not None:
            line += f", derinlik {c['depth_m']:.1f} m"
        lines.append(line)

    c4 = session.get("corner4")
    if c4:
        lines.append(f"  Kose 4 (tahmini): ({c4['x_m']:.1f}, {c4['y_m']:.1f}) m")
    elif len(corners) >= 3:
        c4_obj = compute_fourth_corner(session)
        if c4_obj:
            lines.append(f"  Kose 4 (tahmini): ({c4_obj.x_m:.1f}, {c4_obj.y_m:.1f}) m")

    return "\n".join(lines)


def get_survey_ui_state() -> dict[str, Any]:
    session = _load_session()
    corners = session.get("corners") or []
    c4 = session.get("corner4")
    return {
        "active": bool(session.get("active")),
        "corner_count": len(corners),
        "width_m": float(session.get("width_m", 0) or 0),
        "length_m": float(session.get("length_m", 0) or 0),
        "corners": corners,
        "corner4": c4,
    }
