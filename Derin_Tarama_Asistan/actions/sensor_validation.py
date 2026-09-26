"""Manyetik/termal cift sensor dogrulama."""

from __future__ import annotations

from typing import Any

_last_magnetic_analysis: dict[str, Any] | None = None


def set_last_magnetic_analysis(analysis: dict[str, Any]) -> None:
    global _last_magnetic_analysis
    _last_magnetic_analysis = dict(analysis or {})


def get_last_magnetic_analysis() -> dict[str, Any] | None:
    return _last_magnetic_analysis


def should_recommend_thermal(analysis: dict[str, Any]) -> bool:
    if analysis.get("active_sensor") == "thermal":
        return False

    try:
        from actions.elic_inference import infer_scene, should_recommend_thermal_from_inference
        inference = analysis.get("inference")
        if not inference or not inference.get("hypotheses"):
            inference = infer_scene(analysis)
        if should_recommend_thermal_from_inference(inference):
            return True
    except Exception:
        pass

    stats = analysis.get("heatmap_stats") or {}
    void_p = float(stats.get("void_pct", 0) or 0)
    metal_p = float(stats.get("metal_pct", 0) or 0)
    wall_p = float(stats.get("wall_pct", 0) or 0)
    relations = analysis.get("spatial_relations") or []
    if any(r.get("type") in ("metal_in_void", "void_with_wall") for r in relations):
        return True
    if void_p >= 2.0 or wall_p >= 1.5:
        return True
    strongest = analysis.get("strongest_anomaly") or {}
    if strongest.get("type") in ("void", "wall"):
        return True
    if void_p >= 1.0 and metal_p < 5:
        return True
    dominant = analysis.get("dominant_signals") or []
    for sig in dominant:
        if sig.get("type") in ("void", "wall"):
            return True
    return False


def sensor_switch_instruction(target: str) -> str:
    target = (target or "thermal").strip().lower()
    if target == "thermal":
        return (
            "Manyetik tespitte bosluk veya belirsiz sinyal var. "
            "Dogrulama icin ELIC'te termal sensore gecin, sonra 'termal ekrani yorumla' deyin."
        )
    return "Manyetik moda geri donebilirsiniz. 'Ekrani yorumla' diyerek devam edin."


def recommend_sensor_switch(target: str = "thermal") -> str:
    analysis = get_last_magnetic_analysis()
    if target == "thermal":
        if analysis and not should_recommend_thermal(analysis):
            return (
                "Su an guclu bir termal dogrulama gereksinimi gorulmuyor. "
                "Yine de termal sensore gecebilirsiniz."
            )
        return sensor_switch_instruction("thermal")
    return sensor_switch_instruction("magnetic")


def compare_magnetic_thermal(mag: dict[str, Any], thermal: dict[str, Any]) -> str:
    mag_stats = mag.get("heatmap_stats") or {}
    th_stats = thermal.get("heatmap_stats") or {}
    mag_void = float(mag_stats.get("void_pct", 0) or 0)
    th_void = float(th_stats.get("void_pct", 0) or 0)
    mag_metal = float(mag_stats.get("metal_pct", 0) or 0)
    mag_wall = float(mag_stats.get("wall_pct", 0) or 0)
    mag_region = (mag.get("strongest_anomaly") or {}).get("region", "")
    th_region = (thermal.get("strongest_anomaly") or {}).get("region", "")
    mag_relations = mag.get("spatial_relations") or []
    metal_in_void = any(r.get("type") == "metal_in_void" for r in mag_relations)

    parts = ["Capraz dogrulama sonucu:"]
    if mag_void >= 1 or th_void >= 1:
        if mag_void >= 1 and th_void >= 0.5:
            parts.append("Termal goruntu manyetik bosluk tespitini destekliyor.")
            confidence = "yuksek"
        elif mag_void >= 1 and th_void < 0.5:
            parts.append("Termal goruntu boslugu netlestirmiyor; dikkatli yorumlayin.")
            confidence = "orta"
        else:
            parts.append("Termal ve manyetik sinyaller kismen uyumlu.")
            confidence = "orta"
    else:
        parts.append("Belirgin bosluk sinyali yok; zemin/agirlik normal gorunuyor.")
        confidence = "dusuk"

    if metal_in_void:
        parts.append(
            f"Manyetikte bosluk ici metal adayi vardi (metal %{mag_metal:.1f}, void %{mag_void:.1f})."
        )
    if mag_wall >= 1:
        parts.append(f"Manyetikte duvar/sert kenar izi: %{mag_wall:.1f}.")

    if mag_region and th_region:
        if mag_region == th_region:
            parts.append(f"Her iki sensörde de bolge ortusuyor: {mag_region}.")
        else:
            parts.append(f"Manyetik bolge {mag_region}, termal bolge {th_region}.")

    mag_depth = mag.get("depth_m")
    th_depth = thermal.get("depth_m")
    if mag_depth is not None:
        parts.append(f"Lazer noktasi (manyetik) derinlik: {float(mag_depth):.2f} m.")
    if th_depth is not None and th_depth != mag_depth:
        parts.append(f"Termal okuma derinligi: {float(th_depth):.2f} m.")

    parts.append(f"Bosluk adayi guveni: {confidence}.")
    return " ".join(parts)


def verify_with_thermal(thermal_analysis: dict[str, Any]) -> str:
    mag = get_last_magnetic_analysis()
    if not mag:
        return (
            "Once manyetik modda ekran analizi yapilmadi. "
            "'Ekrani yorumla' deyip ardindan termal moda gecin."
        )
    if thermal_analysis.get("active_sensor") != "thermal":
        return (
            "Ekran hala manyetik modda gorunuyor. "
            "ELIC'te termal sensore gecip tekrar deneyin."
        )
    return compare_magnetic_thermal(mag, thermal_analysis)
