"""Survey navigasyon birim testleri."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from actions.survey_nav import compute_fourth_corner, navigation_instruction


def test_compute_fourth_corner_rectangle():
    session = {
        "corners": [
            {"index": 1, "x_m": 0.0, "y_m": 0.0},
            {"index": 2, "x_m": 10.0, "y_m": 0.0},
            {"index": 3, "x_m": 10.0, "y_m": 15.0},
        ]
    }
    c4 = compute_fourth_corner(session)
    assert c4 is not None
    assert abs(c4.x_m - 0.0) < 0.01
    assert abs(c4.y_m - 15.0) < 0.01


def test_navigation_instruction_has_distance():
    msg = navigation_instruction(180.0, 0.0, 15.0, 10.0, 0.0)
    assert "metre" in msg.lower()


def test_survey_session_example_exists():
    example = ROOT / "memory" / "survey_session.example.json"
    assert example.exists()
    data = json.loads(example.read_text(encoding="utf-8"))
    assert "width_m" in data
    assert "corners" in data


if __name__ == "__main__":
    test_compute_fourth_corner_rectangle()
    test_navigation_instruction_has_distance()
    test_survey_session_example_exists()
    print("OK: survey_nav tests passed")
