"""
Proton ELIC ekran goruntusu on-analizi.
Votex proton-physics-parser.js, elic-overlay.js ve elic-depth.js mantiginin Python portu.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from PIL import Image

COVER_MIN_M = 0.05
COVER_MAX_M = 0.12
MAX_SAMPLE_GRID = 50


def heatmap_roi(width: int, height: int) -> dict[str, int]:
    x0 = max(0, int(width * 0.11))
    y0 = max(0, int(height * 0.085))
    x1 = max(x0 + 2, int(width * 0.995))
    y1 = max(y0 + 2, int(height * 0.91))
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


def parse_depth_label_text(text: str) -> float | None:
    if not text:
        return None
    s = str(text).replace(",", ".")
    m = re.search(r"Depth\s*:?\s*(\d+)\s*m\s*(\d+)\s*cm", s, re.IGNORECASE)
    if m:
        return max(0.0, int(m.group(1)) + int(m.group(2)) / 100.0)
    m2 = re.search(r"Depth\s*:?\s*(\d+(?:\.\d+)?)\s*m\b", s, re.IGNORECASE)
    if m2:
        return max(0.0, float(m2.group(1)))
    m3 = re.search(r"Depth\s*:?\s*(\d+)\s*cm\b", s, re.IGNORECASE)
    if m3:
        return max(0.0, int(m3.group(1)) / 100.0)
    return None


def extract_physics_signal(r: int, g: int, b: int) -> dict[str, Any]:
    """Renk → sinyal tipi (Votex elic-color-taxonomy.js ile aynı sözlük).

    Pasif manyetik: ana veri kırmızı (metal) / mavi (void).
    Çevredeki açık tonlar = yeryüzüne fırlayan ışınlar (wall) → şekil tahmini.
    Yeşil = LiDAR yüzey; yeşil üstü ince açık çizgi = glow (yapı izi).
    Sarı/turuncu metal değildir.
    """
    r_n = r / 255.0
    g_n = g / 255.0
    b_n = b / 255.0
    max_c = max(r_n, g_n, b_n)
    min_c = min(r_n, g_n, b_n)

    if max_c < 0.1:
        return {"c": 0, "l": 0, "h": 0, "purity": 0, "type": "none"}

    h = 0.0
    d = max_c - min_c
    if max_c != min_c:
        if max_c == r_n:
            h = 60 * (((g_n - b_n) / d) % 6)
        elif max_c == g_n:
            h = 60 * (((b_n - r_n) / d) + 2)
        else:
            h = 60 * (((r_n - g_n) / d) + 4)
    if h < 0:
        h += 360

    l = (max_c + min_c) / 2
    s = 0 if max_c == 0 else d / max_c

    def wall_ray_c() -> float:
        return max(45.0, min(58.0, round(48 + (l - 0.5) * 12)))

    # 1) Glow — yeşilden ince beyaz/açık damar (yapı izi)
    pale_filament = (
        l >= 0.62
        and g_n >= r_n
        and g_n >= b_n * 0.92
        and 55.0 <= h <= 160.0
        and s <= 0.45
        and max_c >= 0.55
    )
    bright_green_ray = (
        70.0 <= h <= 155.0
        and g_n >= r_n * 0.95
        and g_n >= b_n * 0.9
        and l >= 0.55
        and g_n >= 0.48
        and 0.10 <= s <= 0.35
    )
    if pale_filament or bright_green_ray:
        return {
            "c": max(1, min(100, 42 + (l - 0.5) * 35)),
            "l": l,
            "h": h,
            "purity": s,
            "type": "glow",
        }

    # 2) Wall / ışın halesi
    if max_c > 0.85 and min_c > 0.78 and (max_c - min_c) <= 0.10 and g_n <= r_n * 1.02:
        return {"c": 105.0, "l": 1.0, "h": 0, "purity": 0, "type": "wall"}

    warm_edge = (
        l >= 0.68
        and s <= 0.35
        and max_c >= 0.65
        and (h <= 50 or h >= 330 or (15 <= h <= 70 and s < 0.25))
        and g_n < r_n * 1.08
        and not (g_n > r_n * 1.05 and g_n > b_n * 1.05)
    )
    if warm_edge:
        return {"c": wall_ray_c(), "l": l, "h": h, "purity": s, "type": "wall"}

    if (
        l >= 0.72
        and s <= 0.28
        and max_c >= 0.7
        and not (g_n > r_n * 1.05 and g_n > b_n * 1.05)
        and (160 <= h <= 250 or s < 0.15)
    ):
        return {"c": wall_ray_c(), "l": l, "h": h, "purity": s, "type": "wall"}

    # Sarı / turuncu — metal değil; ışın ara tonu
    yellow_orange = (
        28.0 < h < 72.0
        and r_n >= 0.4
        and g_n >= 0.28
        and b_n < min(r_n, g_n) * 0.85
        and s > 0.1
        and max_c >= 0.35
    )
    if yellow_orange:
        return {"c": wall_ray_c(), "l": l, "h": h, "purity": s, "type": "wall"}

    if l >= 0.7 and s < 0.25 and max_c > 0.55:
        c_w = 105.0 if l > 0.9 else wall_ray_c()
        return {"c": c_w, "l": l, "h": h, "purity": s, "type": "wall"}

    # 3) Mavi çekirdek → void
    blue_hue = 165.0 <= h <= 265.0
    blue_dom = b_n >= r_n * 1.05 and b_n >= g_n * 0.82
    if blue_hue and blue_dom and s > 0.12:
        void_c = max(1.0, min(20.0, round(4 + (1 - l) * 14)))
        return {"c": void_c, "l": l, "h": h, "purity": s, "type": "void"}

    # 4) Yeşil → soil
    is_green_band = (
        62.0 <= h <= 158.0
        and g_n >= r_n * 0.88
        and g_n >= b_n * 0.88
        and s > 0.1
        and max_c >= 0.25
    )
    if is_green_band:
        soil_c = max(34.0, min(46.0, 40.0 + (0.5 - l) * 6))
        return {"c": soil_c, "l": l, "h": h, "purity": s, "type": "soil"}

    # 5) Kırmızı çekirdek → metal (yalnız kırmızı)
    red_hue = h <= 28.0 or h >= 340.0
    red_dom = r_n >= g_n * 1.15 and r_n >= b_n * 1.12
    if red_hue and red_dom and s > 0.18 and max_c >= 0.35:
        metal_c = 65 + (1 - l) * 28 + s * 12
        metal_c = max(65.0, min(100.0, metal_c))
        return {"c": metal_c, "l": l, "h": h, "purity": s, "type": "metal"}

    # 6) Koyu / gri
    if l < 0.35 and s < 0.35:
        void_c = max(1.0, min(20.0, round(4 + (1 - l) * 14)))
        return {"c": void_c, "l": l, "h": h, "purity": s, "type": "void"}

    return {"c": 40.0, "l": l, "h": h, "purity": s, "type": "soil"}


def _spatial_relations(samples: list[dict]) -> list[dict]:
    """Komşu örneklerden çapraz ilişkiler: metal-in-void, void+wall."""
    metals = [s for s in samples if s["type"] == "metal"]
    voids = [s for s in samples if s["type"] == "void"]
    walls = [s for s in samples if s["type"] == "wall"]
    relations: list[dict] = []

    def _near(a: dict, b: dict, thresh_pct: float = 18.0) -> bool:
        return abs(a["x_pct"] - b["x_pct"]) <= thresh_pct and abs(a["y_pct"] - b["y_pct"]) <= thresh_pct

    metal_in_void_hits = 0
    for m in metals[:40]:
        for v in voids[:40]:
            if _near(m, v, 22.0):
                metal_in_void_hits += 1
                break
    if metal_in_void_hits >= 2 or (metal_in_void_hits >= 1 and len(metals) >= 3 and len(voids) >= 3):
        relations.append({
            "type": "metal_in_void",
            "hits": metal_in_void_hits,
            "note": "Kirmizi metal sinyali mavi bosluk bolgesine yakin/icinde",
        })

    void_wall_hits = 0
    for v in voids[:40]:
        for w in walls[:40]:
            if _near(v, w, 16.0):
                void_wall_hits += 1
                break
    if void_wall_hits >= 2 and len(walls) >= 2:
        relations.append({
            "type": "void_with_wall",
            "hits": void_wall_hits,
            "note": "Mavi bosluk cevresinde ince beyaz cizgi — duvar ipucu",
        })

    metal_wall_hits = 0
    for m in metals[:40]:
        for w in walls[:40]:
            if _near(m, w, 16.0):
                metal_wall_hits += 1
                break
    if metal_wall_hits >= 2 and len(walls) >= 1:
        relations.append({
            "type": "metal_with_wall",
            "hits": metal_wall_hits,
            "note": "Kirmizi gecisinde ince beyaz cizgi — duvar/sert kenar ipucu",
        })

    glows = [s for s in samples if s["type"] == "glow"]
    glow_void_hits = 0
    for g in glows[:50]:
        for v in voids[:40]:
            if _near(g, v, 20.0):
                glow_void_hits += 1
                break
    if glow_void_hits >= 2 or (len(glows) >= 4 and len(voids) >= 2):
        relations.append({
            "type": "glow_near_void",
            "hits": glow_void_hits,
            "note": "Yesilden isik cizgileri mavi bosluga yakin — oda/tunel guclenir",
        })

    return relations


def _cover_floor_m(sig: dict, lightness: float) -> float:
    c = sig.get("c", 0)
    sig_type = sig.get("type")
    if sig_type == "void" or (isinstance(c, (int, float)) and c < 25):
        return min(COVER_MAX_M, max(COVER_MIN_M, COVER_MIN_M + (1 - lightness) * 0.05))
    return COVER_MIN_M


def _apply_cover_floor(mid_m: float, half: float, cover_floor: float, cap: float) -> dict[str, float]:
    cover = min(COVER_MAX_M, max(COVER_MIN_M, cover_floor))
    mid = mid_m
    if mid < cover + 0.08:
        mid = cover + max(0.08, half * 0.5)
    mid = min(cap * 0.95, mid)
    top_m = cover
    bottom_m = min(cap, max(top_m + 0.08, mid + half, 2 * mid - top_m))
    return {
        "cover_m": top_m,
        "top_m": top_m,
        "bottom_m": bottom_m,
        "mid_m": mid,
        "thickness_m": max(0.08, bottom_m - top_m),
    }


def build_depth_calibration(probe_sig: dict, probe_depth_m: float) -> dict[str, float]:
    d = max(0.05, float(probe_depth_m or 1))
    l_raw = probe_sig.get("lightness", probe_sig.get("l", 0.5))
    l_val = min(1.0, max(0.0, float(l_raw))) if l_raw is not None else 0.5
    darkness = max(0.08, 1 - l_val)
    scale = d / darkness
    return {"probeDepthM": d, "probeL": l_val, "scale": scale, "darkness": darkness}


def calibrated_anomaly_depth(sig: dict, cal: dict, depth_cap_m: float = 10.0, depth_scale: float = 1.0) -> dict[str, float]:
    cap = depth_cap_m if depth_cap_m > 0 else 1000.0
    l_raw = sig.get("lightness", sig.get("l", 0.5))
    l_val = min(1.0, max(0.0, float(l_raw))) if l_raw is not None else 0.5
    darkness = max(0.08, 1 - l_val)
    scale = cal.get("scale", 0) if cal.get("scale", 0) > 0 else cal.get("probeDepthM", 1)

    mid_m = darkness * scale
    if cal.get("probeDepthM", 0) > 0 and abs(l_val - cal.get("probeL", 0.5)) < 0.04:
        mid_m = cal["probeDepthM"]
    mid_m = min(cap * 0.95, max(0.05, mid_m))

    c = sig.get("c", 0)
    sig_type = sig.get("type")
    if sig_type == "void" or (isinstance(c, (int, float)) and c < 25):
        half = min(cap * 0.28, max(0.25, mid_m * 0.45 + l_val * 0.4))
    elif sig_type == "wall" or (isinstance(c, (int, float)) and c >= 100):
        half = min(cap * 0.2, max(0.2, mid_m * 0.35))
    elif sig_type == "metal" or (isinstance(c, (int, float)) and c > 70):
        half = min(cap * 0.18, max(0.15, mid_m * 0.3))
    else:
        half = min(cap * 0.22, max(0.2, mid_m * 0.4))
    half *= depth_scale

    return _apply_cover_floor(mid_m, half, _cover_floor_m(sig, l_val), cap)


def fallback_anomaly_depth(sig: dict, depth_cap_m: float = 10.0, depth_scale: float = 1.0) -> dict[str, float]:
    cap = max(0.5, depth_cap_m or 10.0)
    l_raw = sig.get("lightness", sig.get("l", 0.5))
    l_val = min(1.0, max(0.0, float(l_raw))) if l_raw is not None else 0.5
    margin = min(0.8, cap * 0.08)
    span = max(margin, cap - 2 * margin)
    mid_m = margin + (1 - l_val) * span
    half = min(cap * 0.28, max(cap * 0.08, cap * 0.18 * (0.4 + l_val))) * depth_scale
    return _apply_cover_floor(mid_m, half, _cover_floor_m(sig, l_val), cap)


def _region_label(ix: int, iy: int, grid_w: int, grid_h: int) -> str:
    col = "sol" if ix < grid_w / 3 else ("orta" if ix < 2 * grid_w / 3 else "sag")
    row = "ust" if iy < grid_h / 3 else ("orta" if iy < 2 * grid_h / 3 else "alt")
    if row == "orta" and col == "orta":
        return "merkez"
    return f"{row}-{col}"


def _format_depth_range(depth_info: dict) -> str:
    top_m = depth_info.get("top_m", 0)
    bottom_m = depth_info.get("bottom_m", 0)
    return f"{top_m:.1f}-{bottom_m:.1f}"


def analyze_heatmap(image_path: Path, depth_cap_m: float = 10.0) -> dict[str, Any]:
    with Image.open(image_path) as img:
        work = img.convert("RGB")
        fw, fh = work.size

    roi = heatmap_roi(fw, fh)
    rw = max(2, roi["x1"] - roi["x0"])
    rh = max(2, roi["y1"] - roi["y0"])

    crop = work.crop((roi["x0"], roi["y0"], roi["x1"], roi["y1"]))
    cw, ch = crop.size
    step_x = max(1, cw // MAX_SAMPLE_GRID)
    step_y = max(1, ch // MAX_SAMPLE_GRID)

    type_counts: dict[str, int] = {
        "metal": 0, "void": 0, "soil": 0, "wall": 0, "glow": 0, "none": 0,
    }
    anomalies: list[dict] = []
    spatial_samples: list[dict] = []
    pixels = crop.load()

    center_ix, center_iy = cw // 2, ch // 2
    probe_sig = extract_physics_signal(*pixels[center_ix, center_iy])

    for iy in range(0, ch, step_y):
        for ix in range(0, cw, step_x):
            sig = extract_physics_signal(*pixels[ix, iy])
            sig_type = sig["type"]
            type_counts[sig_type] = type_counts.get(sig_type, 0) + 1
            x_pct = round(ix / max(1, cw - 1) * 100, 1)
            y_pct = round(iy / max(1, ch - 1) * 100, 1)
            if sig_type in ("metal", "void", "wall", "glow"):
                spatial_samples.append({
                    "type": sig_type,
                    "x_pct": x_pct,
                    "y_pct": y_pct,
                    "c": sig["c"],
                })
            if sig_type in ("metal", "void", "wall") and sig["c"] > 0:
                depth_info = fallback_anomaly_depth(sig, depth_cap_m)
                anomalies.append({
                    "type": sig_type,
                    "c": round(sig["c"], 1),
                    "l": round(sig["l"], 3),
                    "region": _region_label(ix, iy, cw, ch),
                    "x_pct": x_pct,
                    "y_pct": y_pct,
                    "est_depth_m": _format_depth_range(depth_info),
                })

    total = sum(type_counts.values()) or 1
    # glow, LiDAR yeşil yüzeyi ailesinde sayılır
    soil_like = type_counts.get("soil", 0) + type_counts.get("glow", 0)
    heatmap_stats = {
        "metal_pct": round(type_counts.get("metal", 0) / total * 100, 1),
        "void_pct": round(type_counts.get("void", 0) / total * 100, 1),
        "soil_pct": round(soil_like / total * 100, 1),
        "wall_pct": round(type_counts.get("wall", 0) / total * 100, 1),
        "glow_pct": round(type_counts.get("glow", 0) / total * 100, 1),
    }
    relations = _spatial_relations(spatial_samples)

    def _anomaly_rank(a: dict) -> float:
        t = a["type"]
        if t == "metal":
            return a["c"] + 20
        if t == "void":
            return (100 - a["c"]) + 10
        if t == "wall":
            return a["c"]
        return a["c"]

    anomalies.sort(key=_anomaly_rank, reverse=True)
    dominant: list[dict] = []
    seen_regions: set[str] = set()
    for item in anomalies:
        if item["region"] in seen_regions:
            continue
        seen_regions.add(item["region"])
        dominant.append({
            "type": item["type"],
            "region": item["region"],
            "c_avg": item["c"],
            "est_depth_m": item["est_depth_m"],
        })
        if len(dominant) >= 5:
            break

    strongest = anomalies[0] if anomalies else None
    result: dict[str, Any] = {
        "depth_label_m": None,
        "heading": None,
        "probe_center": {
            "x_pct": 50.0,
            "y_pct": 50.0,
            "type": probe_sig.get("type"),
            "c": round(probe_sig.get("c", 0), 1),
        },
        "dominant_signals": dominant,
        "heatmap_stats": heatmap_stats,
        "spatial_relations": relations,
        "image_size": {"width": fw, "height": fh},
        "roi": roi,
    }
    if strongest:
        result["strongest_anomaly"] = {
            "type": strongest["type"],
            "region": strongest["region"],
            "x_pct": strongest["x_pct"],
            "y_pct": strongest["y_pct"],
            "c": strongest["c"],
            "est_depth_m": strongest["est_depth_m"],
        }

    try:
        from actions.elic_inference import infer_scene, format_inference_summary
        inference = infer_scene(result)
        result["inference"] = {
            "findings": inference.get("findings"),
            "hypotheses": inference.get("hypotheses"),
            "top_hypothesis": inference.get("top_hypothesis"),
            "recommended_actions": inference.get("recommended_actions"),
            "summary": format_inference_summary(inference),
        }
    except Exception:
        pass

    try:
        from actions.compass_reader import enrich_heatmap_with_hud
        return enrich_heatmap_with_hud(result, image_path, use_gemini=False)
    except Exception:
        return result
