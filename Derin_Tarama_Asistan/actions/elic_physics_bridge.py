"""
ELIC PhysicsBridge — paketlenmis analysis ile screen.png yeniden parse karsilastirmasi.

Votex ofiste ayni islevi JS parser ile yapabilir; bu Python esdeger referans.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


STAT_KEYS = ("metal_pct", "void_pct", "soil_pct", "wall_pct", "glow_pct")


def compare_heatmap_stats(
    packaged: dict[str, Any],
    recomputed: dict[str, Any],
    *,
    tolerance_pct: float = 5.0,
) -> dict[str, Any]:
    packed_stats = dict(packaged.get("heatmap_stats") or packaged)
    recomputed_stats = dict(recomputed.get("heatmap_stats") or recomputed)
    diffs: list[dict[str, Any]] = []
    for key in STAT_KEYS:
        a = float(packed_stats.get(key, 0) or 0)
        b = float(recomputed_stats.get(key, 0) or 0)
        delta = abs(a - b)
        diffs.append({
            "key": key,
            "packaged": a,
            "recomputed": b,
            "delta": round(delta, 2),
            "ok": delta <= tolerance_pct,
        })
    ok = all(d["ok"] for d in diffs)
    return {
        "ok": ok,
        "tolerance_pct": tolerance_pct,
        "diffs": diffs,
        "message": "Physics uyumlu" if ok else "Physics sapmasi — ofiste screen.png esas alinsin",
    }


def bridge_reparse_case(screen_path: Path, packaged_analysis: dict[str, Any]) -> dict[str, Any]:
    """screen.png uzerinden yeniden okuyup paketlenmis analysis ile kiyasla."""
    from actions.compass_reader import read_elic_hud
    from actions.elic_case_schema import build_analysis_payload

    screen_path = Path(screen_path)
    if not screen_path.is_file():
        return {"ok": False, "errors": ["screen.png yok"], "compare": None, "recomputed": None}

    live = read_elic_hud(screen_path, use_gemini=False)
    recomputed = build_analysis_payload(live)
    compare = compare_heatmap_stats(packaged_analysis, recomputed)
    rel_pack = {(r.get("type"), True) for r in (packaged_analysis.get("spatial_relations") or [])}
    rel_live = {(r.get("type"), True) for r in (recomputed.get("spatial_relations") or [])}
    relations_match = rel_pack == rel_live

    return {
        "ok": compare["ok"],
        "errors": [] if compare["ok"] else [compare["message"]],
        "compare": compare,
        "recomputed": recomputed,
        "relations_match": relations_match,
        "packaged_relations": [r.get("type") for r in (packaged_analysis.get("spatial_relations") or [])],
        "recomputed_relations": [r.get("type") for r in (recomputed.get("spatial_relations") or [])],
    }


def bridge_open_case(path: Path | str) -> dict[str, Any]:
    """Case ac + physics bridge calistir."""
    from actions.votex_case_reader import open_elic_case

    opened = open_elic_case(path)
    if not opened.get("ok"):
        return {
            "ok": False,
            "errors": opened.get("errors") or ["case acilamadi"],
            "bridge": None,
            "votex": None,
        }

    case = opened["case"]
    try:
        bridge = bridge_reparse_case(case.screen_path, case.analysis) if case.screen_path else {
            "ok": False,
            "errors": ["screen yok"],
            "compare": None,
        }
        return {
            "ok": bool(bridge.get("ok")),
            "errors": bridge.get("errors") or [],
            "bridge": bridge,
            "votex": opened.get("votex"),
            "summary": None,
        }
    finally:
        case.close()
