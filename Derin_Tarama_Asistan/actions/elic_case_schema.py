"""
ELIC Case şema sözleşmesi — schema_version 1.0 (DONDU).

DTA (saha) ve Votex (ofis) bu alanlarla konuşur.
Değişiklik için minor/major version yükseltin; 1.0 alanlarını silmeyin.
"""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = "1.0"
SCHEMA_ID = "elic_case"
SOURCE_DTA = "Derin_Tarama_Asistan"

# Zorunlu kök / alt alanlar (validate_case bunları arar)
REQUIRED_MANIFEST_KEYS = (
    "schema_version",
    "schema_id",
    "source",
    "capture_time",
    "product",
)
REQUIRED_ANALYSIS_KEYS = (
    "heatmap_stats",
    "hud",
)
REQUIRED_HEATMAP_STAT_KEYS = (
    "metal_pct",
    "void_pct",
    "soil_pct",
    "wall_pct",
    "glow_pct",
)
REQUIRED_HUD_KEYS = ()  # depth/heading opsiyonel ama tercih edilir — soft check

KNOWN_RELATION_TYPES = frozenset({
    "metal_in_void",
    "void_with_wall",
    "metal_with_wall",
    "glow_near_void",
})

KNOWN_HYPOTHESIS_IDS = frozenset({
    "void_candidate",
    "metal_candidate",
    "metal_in_void",
    "structure_glow",
    "wall_edge",
    "clear_soil",
})

CASE_FILES = {
    "manifest": "manifest.json",
    "analysis": "analysis.json",
    "inference": "inference.json",
    "voice_summary": "voice_summary.txt",
    "screen": "screen.png",
    "survey": "survey.json",  # opsiyonel
    "recording_meta": "recording/session.json",  # opsiyonel Faz 4
}

DISCLAIMER_TR = (
    "Ince cizgiler (glow / duvar kenari) ipucu niteliklidir; "
    "manyetik alan nesne etrafindan suzulerek bu renkleri uretir. "
    "Kesin tesbit degildir; mumkunse termal ile dogrulayin."
)


def build_manifest(
    *,
    capture_time: str,
    device_model: str = "",
    serial: str = "",
    active_sensor: str = "magnetic",
    window_title: str = "Proton ELIC",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app_config import PRODUCT_NAME, PRODUCT_SHORT, VENDOR_AUTHOR, VENDOR_ORG

    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "schema_id": SCHEMA_ID,
        "source": SOURCE_DTA,
        "product": {"name": PRODUCT_NAME, "short": PRODUCT_SHORT},
        "vendor": {"author": VENDOR_AUTHOR, "org": VENDOR_ORG},
        "capture_time": capture_time,
        "device": {
            "model": device_model or "PROTON ELIC",
            "serial": serial or "",
            "window_title": window_title,
        },
        "active_sensor": active_sensor,
        "disclaimer": DISCLAIMER_TR,
    }
    if extra:
        manifest.update(extra)
    return manifest


def build_hud_block(analysis: dict[str, Any]) -> dict[str, Any]:
    depth = analysis.get("depth_m")
    if depth is None:
        depth = analysis.get("depth_label_m")
    return {
        "depth_m": depth,
        "heading": analysis.get("heading_cardinal") or analysis.get("heading"),
        "heading_deg": analysis.get("heading_deg")
        if analysis.get("heading_deg") is not None
        else analysis.get("heading") if isinstance(analysis.get("heading"), (int, float)) else None,
        "anomaly_gauge": analysis.get("anomaly_gauge"),
        "probe_center": analysis.get("probe_center"),
        "surface_ref_ok": analysis.get("surface_ref_ok"),
        "active_sensor": analysis.get("active_sensor") or "magnetic",
    }


def build_analysis_payload(analysis: dict[str, Any]) -> dict[str, Any]:
    stats = dict(analysis.get("heatmap_stats") or {})
    for key in REQUIRED_HEATMAP_STAT_KEYS:
        stats.setdefault(key, 0.0)
    return {
        "heatmap_stats": stats,
        "hud": build_hud_block(analysis),
        "dominant_signals": list(analysis.get("dominant_signals") or []),
        "strongest_anomaly": analysis.get("strongest_anomaly"),
        "spatial_relations": list(analysis.get("spatial_relations") or []),
        "roi": analysis.get("roi"),
        "image_size": analysis.get("image_size"),
    }


def build_inference_payload(analysis: dict[str, Any]) -> dict[str, Any]:
    inf = dict(analysis.get("inference") or {})
    if not inf.get("hypotheses"):
        try:
            from actions.elic_inference import format_inference_summary, infer_scene
            full = infer_scene(analysis)
            return {
                "findings": full.get("findings") or [],
                "hypotheses": full.get("hypotheses") or [],
                "top_hypothesis": full.get("top_hypothesis"),
                "recommended_actions": full.get("recommended_actions") or [],
                "summary": format_inference_summary(full),
                "color_legend_ref": "elic_color_legend_v1",
                "disclaimer": DISCLAIMER_TR,
            }
        except Exception:
            pass
    return {
        "findings": inf.get("findings") or [],
        "hypotheses": inf.get("hypotheses") or [],
        "top_hypothesis": inf.get("top_hypothesis"),
        "recommended_actions": inf.get("recommended_actions") or [],
        "summary": inf.get("summary") or "",
        "color_legend_ref": "elic_color_legend_v1",
        "disclaimer": DISCLAIMER_TR,
    }


def validate_case_dict(
    *,
    manifest: dict[str, Any],
    analysis: dict[str, Any],
    inference: dict[str, Any] | None = None,
    has_screen: bool = True,
) -> list[str]:
    """Hata mesajlari listesi; bos = gecerli."""
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest JSON degil"]
    if not isinstance(analysis, dict):
        return ["analysis JSON degil"]

    for key in REQUIRED_MANIFEST_KEYS:
        if key not in manifest or manifest[key] in (None, ""):
            errors.append(f"manifest.{key} eksik")

    ver = str(manifest.get("schema_version", ""))
    if ver != SCHEMA_VERSION:
        errors.append(f"schema_version beklenen {SCHEMA_VERSION}, gelen {ver or '(yok)'}")

    if manifest.get("schema_id") != SCHEMA_ID:
        errors.append(f"schema_id beklenen {SCHEMA_ID}")

    for key in REQUIRED_ANALYSIS_KEYS:
        if key not in analysis:
            errors.append(f"analysis.{key} eksik")

    stats = analysis.get("heatmap_stats") or {}
    if not isinstance(stats, dict):
        errors.append("analysis.heatmap_stats obje degil")
    else:
        for key in REQUIRED_HEATMAP_STAT_KEYS:
            if key not in stats:
                errors.append(f"analysis.heatmap_stats.{key} eksik")

    hud = analysis.get("hud") or {}
    if not isinstance(hud, dict):
        errors.append("analysis.hud obje degil")

    if inference is not None:
        if not isinstance(inference, dict):
            errors.append("inference JSON degil")
        else:
            if "hypotheses" not in inference:
                errors.append("inference.hypotheses eksik")
            if "disclaimer" not in inference and "summary" not in inference:
                errors.append("inference.summary veya disclaimer eksik")

    if not has_screen:
        errors.append("screen.png eksik")

    return errors
