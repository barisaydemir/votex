"""Proton ELIC HUD okuma: pusula, manyetik depth, LiDAR zemin ref, aktif sensör."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from PIL import Image

from actions.elic_parser import (
    analyze_heatmap,
    extract_physics_signal,
    heatmap_roi,
    parse_depth_label_text,
)

CARDINAL_DEG = {
    "N": 0.0,
    "NE": 45.0,
    "E": 90.0,
    "SE": 135.0,
    "S": 180.0,
    "SW": 225.0,
    "W": 270.0,
    "NW": 315.0,
}


def cardinal_to_deg(cardinal: str | None) -> float | None:
    if not cardinal:
        return None
    key = re.sub(r"[^A-Z]", "", str(cardinal).upper())
    return CARDINAL_DEG.get(key)


def is_lidar_green_soil(sig: dict) -> bool:
    if sig.get("type") in ("soil", "glow"):
        return True
    h = float(sig.get("h", 0))
    c = float(sig.get("c", 0))
    return 70 <= h <= 160 and 30 <= c <= 55


def _detect_surface_ref_ok(image_path: Path) -> bool:
    with Image.open(image_path) as img:
        work = img.convert("RGB")
        roi = heatmap_roi(*work.size)
        crop = work.crop((roi["x0"], roi["y0"], roi["x1"], roi["y1"]))
        pixels = crop.load()
        cw, ch = crop.size
        step = max(1, min(cw, ch) // 40)
        soil = 0
        total = 0
        for iy in range(0, ch, step):
            for ix in range(0, cw, step):
                sig = extract_physics_signal(*pixels[ix, iy])
                total += 1
                if is_lidar_green_soil(sig):
                    soil += 1
        return total > 0 and (soil / total) >= 0.28


def _detect_active_sensor(stats: dict) -> str:
    soil = float(stats.get("soil_pct", 0) or 0)
    void_p = float(stats.get("void_pct", 0) or 0)
    metal_p = float(stats.get("metal_pct", 0) or 0)
    if soil >= 25:
        return "magnetic"
    if void_p + metal_p >= 15 and soil < 20:
        return "thermal"
    return "magnetic"


def _detect_cardinal_from_top_band(image_path: Path) -> tuple[str | None, float | None]:
    """Ust bantta parlak piksel kumesi — basit heuristik; OCR yok."""
    with Image.open(image_path) as img:
        work = img.convert("RGB")
        w, h = work.size
        top = work.crop((0, 0, w, max(8, int(h * 0.12))))
        tw, th = top.size
        pixels = top.load()
        bright_cols: list[int] = []
        for x in range(tw):
            bright = 0
            for y in range(th):
                r, g, b = pixels[x, y]
                if r + g + b > 520:
                    bright += 1
            if bright >= max(2, th // 4):
                bright_cols.append(x)
        if not bright_cols:
            return None, None
        center_x = sum(bright_cols) / len(bright_cols)
        ratio = center_x / max(1, tw - 1)
        if ratio < 0.35:
            return "W", 270.0
        if ratio < 0.45:
            return "SW", 225.0
        if ratio < 0.55:
            return "S", 180.0
        if ratio < 0.65:
            return "SE", 135.0
        return "E", 90.0


def _read_hud_with_gemini(image_path: Path) -> dict[str, Any]:
    api_key = ""
    try:
        from app_config import get_app_config_value
        api_key = str(get_app_config_value("gemini_api_key", "") or "").strip()
    except Exception:
        pass
    if not api_key:
        return {}

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        img_bytes = image_path.read_bytes()
        prompt = (
            "Bu Proton ELIC ekran goruntusunden SADECE su alanlari JSON olarak ver:\n"
            '{"heading_cardinal":"S|SE|E|NW|...", "heading_deg":135, "depth_m":0.22, '
            '"anomaly_gauge":19, "active_sensor":"magnetic|thermal", '
            '"depth_label_text":"Depth 0 m 22 cm"}\n'
            "HUD: ust yatay cizgi=yon; orta daire yani Depth=derinlik; "
            "yan dikey olcek=anomaly_gauge (isaretli deger).\n"
            "Bulamazsan null birak. Sadece JSON."
        )
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                prompt,
                types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
            ],
            config=types.GenerateContentConfig(temperature=0.0),
        )
        text = str(getattr(response, "text", "") or "").strip()
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return {}
        import json
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def enrich_heatmap_with_hud(
    heatmap: dict[str, Any],
    image_path: Path,
    *,
    use_gemini: bool = True,
) -> dict[str, Any]:
    """analyze_heatmap ciktisina HUD alanlarini ekler."""
    path = Path(image_path)
    stats = heatmap.get("heatmap_stats", {})
    cardinal, heading_deg = _detect_cardinal_from_top_band(path)
    surface_ref_ok = _detect_surface_ref_ok(path)
    active_sensor = _detect_active_sensor(stats)
    depth_m = heatmap.get("depth_label_m")
    depth_label_text = None
    anomaly_gauge = heatmap.get("anomaly_gauge")

    if use_gemini and (heading_deg is None or depth_m is None or anomaly_gauge is None):
        gemini_hud = _read_hud_with_gemini(path)
        if gemini_hud.get("heading_cardinal"):
            cardinal = str(gemini_hud["heading_cardinal"]).upper()
            heading_deg = cardinal_to_deg(cardinal)
        if gemini_hud.get("heading_deg") is not None:
            try:
                heading_deg = float(gemini_hud["heading_deg"])
            except (TypeError, ValueError):
                pass
        if gemini_hud.get("depth_m") is not None:
            try:
                depth_m = float(gemini_hud["depth_m"])
            except (TypeError, ValueError):
                pass
        if gemini_hud.get("depth_label_text"):
            depth_label_text = str(gemini_hud["depth_label_text"])
            parsed = parse_depth_label_text(depth_label_text)
            if parsed is not None:
                depth_m = parsed
        if gemini_hud.get("active_sensor") in ("magnetic", "thermal"):
            active_sensor = gemini_hud["active_sensor"]
        if gemini_hud.get("anomaly_gauge") is not None:
            try:
                anomaly_gauge = float(gemini_hud["anomaly_gauge"])
            except (TypeError, ValueError):
                pass

    if depth_m is None and depth_label_text:
        depth_m = parse_depth_label_text(depth_label_text)

    merged = dict(heatmap)
    merged.update({
        "heading_deg": heading_deg,
        "heading": heading_deg,
        "heading_cardinal": cardinal,
        "depth_m": depth_m,
        "depth_label_m": depth_m,
        "surface_ref_ok": surface_ref_ok,
        "active_sensor": active_sensor,
    })
    if anomaly_gauge is not None:
        merged["anomaly_gauge"] = anomaly_gauge
    try:
        from actions.elic_inference import format_inference_summary, infer_scene
        inference = infer_scene(merged)
        merged["inference"] = {
            "findings": inference.get("findings"),
            "hypotheses": inference.get("hypotheses"),
            "top_hypothesis": inference.get("top_hypothesis"),
            "recommended_actions": inference.get("recommended_actions"),
            "summary": format_inference_summary(inference),
        }
    except Exception:
        pass
    return merged


def read_elic_hud(
    image_path: Path,
    depth_cap_m: float = 10.0,
    use_gemini: bool = True,
    heatmap: dict[str, Any] | None = None,
) -> dict[str, Any]:
    path = Path(image_path)
    heatmap = heatmap or analyze_heatmap(path, depth_cap_m=depth_cap_m)
    return enrich_heatmap_with_hud(heatmap, path, use_gemini=use_gemini)
