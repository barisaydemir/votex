#!/usr/bin/env python3
"""CLI: ELIC Case ZIP/klasor → Votex import ozeti (+ opsiyonel ofis HTML)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Votex ELIC Case import (schema 1.0)")
    parser.add_argument("path", type=Path, help="elic_case_*.zip veya klasor")
    parser.add_argument("--office", action="store_true", help="HTML ofis raporu uret")
    parser.add_argument("--bridge", action="store_true", help="PhysicsBridge calistir")
    parser.add_argument("--json", action="store_true", help="votex dict yazdir")
    args = parser.parse_args()

    from actions.votex_case_reader import case_summary, import_checklist, open_elic_case

    opened = open_elic_case(args.path)
    if not opened.get("ok"):
        print("IMPORT FAIL:", "; ".join(opened.get("errors") or []))
        return 1

    case = opened["case"]
    votex = opened["votex"]
    print("IMPORT OK")
    print(case_summary(case))

    if args.bridge or args.office:
        from actions.elic_physics_bridge import bridge_reparse_case
        if case.screen_path:
            br = bridge_reparse_case(case.screen_path, case.analysis)
            print("BRIDGE:", br.get("compare", {}).get("message"), "ok=", br.get("ok"))
        else:
            print("BRIDGE: screen yok")

    if args.office:
        from actions.elic_office_report import generate_office_report
        case.close()
        rep = generate_office_report(args.path)
        print("OFFICE:", rep.get("html_path"), "ok=", rep.get("ok"))
        return 0 if rep.get("ok") else 1

    if args.json:
        print(json.dumps(votex, ensure_ascii=False, indent=2))

    print("Votex checklist:")
    for item in import_checklist():
        print(f"  [{item['adim']}] {item['madde']}")

    case.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
