"""Faz 2/3: Votex reader + PhysicsBridge + ofis HTML testleri."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from actions.elic_case_export import CASES_DIR, export_case_from_image
from actions.votex_case_reader import case_summary, open_elic_case
from actions.elic_physics_bridge import bridge_reparse_case, compare_heatmap_stats
from actions.elic_office_report import generate_office_report

SAMPLE = ROOT / "tests" / "sample_elic_screen.png"


def _ensure_sample_zip() -> Path:
    out = export_case_from_image(
        SAMPLE,
        make_zip=True,
        cases_dir=CASES_DIR / "_faz2_sample",
    )
    assert out["ok"], out.get("errors")
    return Path(out["zip_path"])


def test_votex_import_zip():
    z = _ensure_sample_zip()
    opened = open_elic_case(z)
    assert opened["ok"], opened.get("errors")
    case = opened["case"]
    votex = opened["votex"]
    assert votex["schema_version"] == "1.0"
    assert votex["has_screen"] is True
    assert "heatmap_stats" in votex
    text = case_summary(case)
    assert "schema 1.0" in text
    case.close()
    print("FAZ2 import OK", votex["case_id"])


def test_physics_bridge_self_consistent():
    z = _ensure_sample_zip()
    opened = open_elic_case(z)
    assert opened["ok"]
    case = opened["case"]
    br = bridge_reparse_case(case.screen_path, case.analysis)
    case.close()
    assert br["compare"] is not None
    # Ayni motor ile yeniden parse — tolerance icinde olmali
    assert br["ok"] is True, br
    print("FAZ3 bridge OK", br["compare"]["message"])


def test_office_html():
    z = _ensure_sample_zip()
    rep = generate_office_report(z, out_dir=CASES_DIR / "_faz3_office")
    assert rep["ok"], rep.get("errors")
    html_path = Path(rep["html_path"])
    assert html_path.is_file()
    body = html_path.read_text(encoding="utf-8")
    assert "Ofis Raporu" in body
    assert "ipucu" in body.lower() or "Ipucu" in body or "suzulerek" in body
    print("FAZ3 office OK", html_path)


def test_rec_attach_faz4():
    from PIL import Image
    from actions.elic_case_export import build_case_from_analysis, attach_recording_to_case
    from actions.compass_reader import read_elic_hud

    # sahte REC oturumu
    session = CASES_DIR / "_faz4_fake_rec" / "elic_fake"
    frames = session / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (64, 48), (40, 180, 60))
    for i in range(1, 6):
        img.save(frames / f"frame_{i:06d}.png")
    (session / "session.json").write_text(
        '{"fps": 2, "frame_count": 5}', encoding="utf-8"
    )

    analysis = read_elic_hud(SAMPLE, use_gemini=False)
    out = build_case_from_analysis(
        analysis,
        screen_path=SAMPLE,
        make_zip=True,
        cases_dir=CASES_DIR / "_faz4_sample",
        include_recording=True,
        recording_session=session,
        max_rec_frames=10,
    )
    assert out["ok"], out.get("errors")
    assert out["recording"]["attached"] is True
    assert out["recording"]["frames_copied"] == 5
    case_dir = Path(out["case_dir"])
    assert (case_dir / "recording" / "session.json").is_file()
    assert (case_dir / "recording" / "frames" / "frame_000001.png").is_file()
    print("FAZ4 REC attach OK", out["case_id"])


def test_survey_json_in_case():
    from actions.elic_case_export import build_case_from_analysis
    from actions.compass_reader import read_elic_hud
    import json

    analysis = read_elic_hud(SAMPLE, use_gemini=False)
    survey = {
        "width_m": 12.0,
        "length_m": 18.0,
        "height_m": 18.0,
        "corner_count": 2,
    }
    out = build_case_from_analysis(
        analysis,
        screen_path=SAMPLE,
        make_zip=True,
        cases_dir=CASES_DIR / "_survey_sample",
        survey=survey,
        include_recording=False,
    )
    assert out["ok"], out.get("errors")
    sp = Path(out["case_dir"]) / "survey.json"
    assert sp.is_file()
    data = json.loads(sp.read_text(encoding="utf-8"))
    assert data["width_m"] == 12.0
    assert data["length_m"] == 18.0
    print("A1 survey.json OK", out["case_id"])


def test_compare_tolerance():
    a = {"heatmap_stats": {"metal_pct": 10, "void_pct": 2, "soil_pct": 80, "wall_pct": 0, "glow_pct": 0.2}}
    b = {"heatmap_stats": {"metal_pct": 12, "void_pct": 2.5, "soil_pct": 78, "wall_pct": 0.1, "glow_pct": 0.3}}
    c = compare_heatmap_stats(a, b, tolerance_pct=5.0)
    assert c["ok"] is True


if __name__ == "__main__":
    test_compare_tolerance()
    test_votex_import_zip()
    test_physics_bridge_self_consistent()
    test_office_html()
    test_rec_attach_faz4()
    test_survey_json_in_case()
    print("faz2_faz3_faz4_a1 tests OK")
