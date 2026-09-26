#!/usr/bin/env python3
"""
ELIC saha / entegrasyon test calistiricisi.
Gercek ELIC penceresi aciksa yakalama dener; yoksa ornek ekran ile devam eder.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SAMPLE = ROOT / "tests" / "sample_elic_screen.png"


def _section(title: str) -> None:
    print()
    print("=" * 60)
    print(title)
    print("=" * 60)


def test_hwid() -> bool:
    from core.hwid import get_hwid_hash, get_hwid_short

    _section("HWID")
    print(f"short: {get_hwid_short()}")
    print(f"hash:  {get_hwid_hash()[:32]}...")
    return True


def test_license_flow() -> bool:
    from core.license_manager import (
        activate_license_token,
        check_tool_allowed,
        get_license_status,
        issue_license_token,
        max_corners_allowed,
    )
    from core.hwid import get_hwid_hash

    _section("LISANS")
    token = issue_license_token("trial", 7, hwid_hash=get_hwid_hash(), customer="field-test")
    ok, msg = activate_license_token(token)
    print(f"activate: {ok} — {msg}")
    status = get_license_status(refresh=True)
    print(json.dumps({k: status[k] for k in ("valid", "mode", "days_left", "is_trial")}, indent=2))
    nav_ok, nav_msg = check_tool_allowed("get_navigation_guidance")
    ana_ok, ana_msg = check_tool_allowed("analyze_elic_screen")
    print(f"navigation allowed: {nav_ok} ({nav_msg})")
    print(f"analyze allowed: {ana_ok}")
    print(f"max_corners: {max_corners_allowed()}")
    return ok and ana_ok and not nav_ok


def test_hud_sample() -> bool:
    from actions.compass_reader import read_elic_hud

    _section("HUD (ornek ekran)")
    if not SAMPLE.exists():
        print(f"ATLA: {SAMPLE} yok")
        return False
    data = read_elic_hud(SAMPLE, use_gemini=False)
    keys = (
        "heading_cardinal",
        "heading_deg",
        "depth_m",
        "surface_ref_ok",
        "active_sensor",
    )
    for key in keys:
        print(f"  {key}: {data.get(key)}")
    stats = data.get("heatmap_stats") or {}
    print(f"  metal/void/soil: {stats.get('metal_pct')}/{stats.get('void_pct')}/{stats.get('soil_pct')}%")
    return data.get("surface_ref_ok") is not None


def test_survey_geometry() -> bool:
    from actions.survey_nav import compute_fourth_corner, navigation_instruction

    _section("SURVEY GEOMETRI")
    session = {
        "corners": [
            {"index": 1, "x_m": 0.0, "y_m": 0.0},
            {"index": 2, "x_m": 10.0, "y_m": 0.0},
            {"index": 3, "x_m": 10.0, "y_m": 15.0},
        ]
    }
    c4 = compute_fourth_corner(session)
    assert c4 is not None
    print(f"  kose 4: ({c4.x_m:.1f}, {c4.y_m:.1f}) m — beklenen (0, 15)")
    nav = navigation_instruction(180.0, 0.0, 15.0, 10.0, 0.0)
    print(f"  yonlendirme: {nav[:80]}...")
    ok = abs(c4.x_m) < 0.01 and abs(c4.y_m - 15.0) < 0.01
    print(f"  geometri OK: {ok}")
    return ok


def test_elic_window_capture() -> bool:
    from app_config import get_app_config_value
    from actions.windows_utils import capture_window

    _section("ELIC PENCERE YAKALAMA")
    target = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC")
    ok, detail, payload = capture_window(target)
    print(f"  hedef: {target}")
    print(f"  sonuc: {ok} — {detail}")
    if not ok:
        print("  NOT: Proton ELIC acik degilse bu adim basarisiz sayilir (normal).")
        return False
    path = Path(str(payload.get("image_path", "")))
    try:
        from actions.compass_reader import read_elic_hud

        if path.exists():
            hud = read_elic_hud(path, use_gemini=False)
            print(f"  pusula: {hud.get('heading_cardinal')} / {hud.get('heading_deg')}")
            print(f"  depth_m: {hud.get('depth_m')}")
            print(f"  surface_ref_ok: {hud.get('surface_ref_ok')}")
            return True
    finally:
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass
    return ok


def test_sensor_validation() -> bool:
    from actions.sensor_validation import should_recommend_thermal

    _section("SENSOR VALIDATION")
    sample = {
        "active_sensor": "magnetic",
        "heatmap_stats": {"void_pct": 3.0, "metal_pct": 2.0},
        "strongest_anomaly": {"type": "void", "region": "center-left"},
    }
    rec = should_recommend_thermal(sample)
    print(f"  termal onerisi (bosluk): {rec}")
    return rec is True


def main() -> int:
    print("ELIC Asistan — Saha / Entegrasyon Testi")
    results: dict[str, bool] = {}
    results["hwid"] = test_hwid()
    results["license"] = test_license_flow()
    results["hud_sample"] = test_hud_sample()
    results["survey"] = test_survey_geometry()
    results["sensor"] = test_sensor_validation()
    results["elic_window"] = test_elic_window_capture()

    _section("OZET")
    for name, ok in results.items():
        mark = "OK" if ok else "FAIL/SKIP"
        print(f"  {name}: {mark}")

    core_ok = all(results[k] for k in ("hwid", "license", "hud_sample", "survey", "sensor"))
    print()
    if core_ok:
        print("Cekirdek testler GECTI.")
        if not results["elic_window"]:
            print("Sonraki adim: Proton ELIC acikken bu scripti tekrar calistirin.")
        return 0
    print("Bazi cekirdek testler BASARISIZ.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
