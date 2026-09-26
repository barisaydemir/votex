"""
ELIC ofis raporu (HTML) — Votex OfficeReport referans cikti.
"""

from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path
from typing import Any

from app_config import BASE_DIR, PRODUCT_NAME, VENDOR_CREDIT_SHORT
from actions.elic_case_schema import DISCLAIMER_TR
from actions.votex_case_reader import case_summary, open_elic_case

OFFICE_DIR = BASE_DIR / "reports" / "office"


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def render_office_html(
    votex: dict[str, Any],
    *,
    bridge: dict[str, Any] | None = None,
    screen_uri: str | None = None,
) -> str:
    hud = votex.get("hud") or {}
    stats = votex.get("heatmap_stats") or {}
    top = votex.get("top_hypothesis") or {}
    hyp_rows = ""
    for h in votex.get("inference", {}).get("hypotheses") or votex.get("hypotheses") or []:
        hyp_rows += (
            f"<tr><td>{_esc(h.get('id'))}</td><td>{_esc(h.get('label'))}</td>"
            f"<td>{_esc(h.get('confidence'))}</td></tr>"
        )
    if not hyp_rows and top:
        hyp_rows = (
            f"<tr><td>{_esc(top.get('id'))}</td><td>{_esc(top.get('label'))}</td>"
            f"<td>{_esc(top.get('confidence'))}</td></tr>"
        )

    rel_rows = "".join(
        f"<tr><td>{_esc(r.get('type'))}</td><td>{_esc(r.get('note') or r.get('hits'))}</td></tr>"
        for r in (votex.get("spatial_relations") or [])
    ) or "<tr><td colspan='2'>—</td></tr>"

    bridge_block = ""
    if bridge and bridge.get("compare"):
        diffs = bridge["compare"].get("diffs") or []
        drows = "".join(
            f"<tr><td>{_esc(d['key'])}</td><td>{d['packaged']}</td>"
            f"<td>{d['recomputed']}</td><td>{d['delta']}</td>"
            f"<td>{'OK' if d['ok'] else 'SAPMA'}</td></tr>"
            for d in diffs
        )
        bridge_block = f"""
        <h2>PhysicsBridge</h2>
        <p>{_esc(bridge['compare'].get('message'))}</p>
        <table>
          <tr><th>Alan</th><th>Paket</th><th>Yeniden</th><th>Δ</th><th>Durum</th></tr>
          {drows}
        </table>
        """

    img = ""
    if screen_uri:
        img = f'<div class="shot"><img src="{_esc(screen_uri)}" alt="ELIC ekran"/></div>'

    voice = _esc(votex.get("voice_summary") or "")
    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<title>ELIC Ofis Raporu — {_esc(votex.get('case_id'))}</title>
<style>
  body {{ font-family: Segoe UI, sans-serif; margin: 24px; color: #111; background: #f7f7f5; }}
  h1 {{ font-size: 1.4rem; margin: 0 0 8px; }}
  h2 {{ font-size: 1.05rem; margin-top: 28px; }}
  .meta {{ color: #555; font-size: 0.9rem; }}
  .warn {{ background: #fff3cd; border: 1px solid #e6d59a; padding: 10px 12px; margin: 16px 0; }}
  table {{ border-collapse: collapse; width: 100%; max-width: 720px; background: #fff; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 0.9rem; }}
  th {{ background: #eee; }}
  .shot img {{ max-width: 100%; border: 1px solid #ccc; margin-top: 12px; }}
  .grid {{ display: grid; grid-template-columns: repeat(4, minmax(80px, 1fr)); gap: 8px; max-width: 720px; }}
  .stat {{ background: #fff; border: 1px solid #ddd; padding: 8px; }}
  .stat b {{ display: block; font-size: 1.1rem; }}
</style>
</head>
<body>
  <h1>{_esc(PRODUCT_NAME)} — Ofis Raporu</h1>
  <p class="meta">{_esc(VENDOR_CREDIT_SHORT)} · schema {_esc(votex.get('schema_version'))} ·
     case {_esc(votex.get('case_id'))} · { _esc(datetime.now().isoformat(timespec='seconds')) }</p>
  <div class="warn">{_esc(votex.get('disclaimer') or DISCLAIMER_TR)}</div>
  <h2>HUD</h2>
  <div class="grid">
    <div class="stat"><span>Depth</span><b>{_esc(hud.get('depth_m'))} m</b></div>
    <div class="stat"><span>Yon</span><b>{_esc(hud.get('heading'))}</b></div>
    <div class="stat"><span>Anomali</span><b>{_esc(hud.get('anomaly_gauge'))}</b></div>
    <div class="stat"><span>Sensor</span><b>{_esc(hud.get('active_sensor'))}</b></div>
  </div>
  <h2>Isi haritasi %</h2>
  <div class="grid">
    <div class="stat"><span>Metal</span><b>{_esc(stats.get('metal_pct'))}</b></div>
    <div class="stat"><span>Void</span><b>{_esc(stats.get('void_pct'))}</b></div>
    <div class="stat"><span>Wall</span><b>{_esc(stats.get('wall_pct'))}</b></div>
    <div class="stat"><span>Glow</span><b>{_esc(stats.get('glow_pct'))}</b></div>
  </div>
  <h2>Hipotezler</h2>
  <table>
    <tr><th>ID</th><th>Label</th><th>Guven</th></tr>
    {hyp_rows or "<tr><td colspan='3'>—</td></tr>"}
  </table>
  <h2>Capraz iliskiler</h2>
  <table>
    <tr><th>Tip</th><th>Not</th></tr>
    {rel_rows}
  </table>
  {bridge_block}
  <h2>Saha ozeti</h2>
  <p>{voice.replace(chr(10), '<br/>')}</p>
  {img}
</body>
</html>
"""


def generate_office_report(case_path: Path | str, *, out_dir: Path | None = None) -> dict[str, Any]:
    """Case'ten HTML ofis raporu + physics bridge."""
    from actions.elic_physics_bridge import bridge_reparse_case

    opened = open_elic_case(case_path)
    if not opened.get("ok"):
        return {"ok": False, "errors": opened.get("errors") or [], "html_path": None}

    case = opened["case"]
    votex = opened["votex"]
    # inference hypotheses for table
    votex = dict(votex)
    votex["hypotheses"] = (case.inference or {}).get("hypotheses") or []
    votex["inference"] = case.inference

    bridge = None
    screen_copy: Path | None = None
    try:
        out = Path(out_dir) if out_dir else OFFICE_DIR
        out.mkdir(parents=True, exist_ok=True)
        cid = case.case_id
        report_dir = out / cid
        report_dir.mkdir(parents=True, exist_ok=True)

        if case.screen_path and case.screen_path.is_file():
            screen_copy = report_dir / "screen.png"
            screen_copy.write_bytes(case.screen_path.read_bytes())
            bridge = bridge_reparse_case(case.screen_path, case.analysis)

        html_path = report_dir / "office_report.html"
        html_path.write_text(
            render_office_html(
                votex,
                bridge=bridge,
                screen_uri="screen.png" if screen_copy else None,
            ),
            encoding="utf-8",
        )
        summary_path = report_dir / "summary.txt"
        summary_path.write_text(case_summary(votex), encoding="utf-8")

        return {
            "ok": True,
            "errors": [],
            "html_path": str(html_path),
            "summary_path": str(summary_path),
            "bridge_ok": bool((bridge or {}).get("ok")),
            "case_id": cid,
            "summary": case_summary(votex),
        }
    finally:
        case.close()
