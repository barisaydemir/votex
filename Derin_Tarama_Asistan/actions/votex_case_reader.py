"""
Votex ELIC Case Importer (schema 1.0) — ofis tarafi referans / stub.

Gercek Votex JS'e tasinacak sozlesme yuzeyi:
  open_elic_case(path) → {ok, case, errors}
  case_summary(case) → kisa ofis ozeti
"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from actions.elic_case_schema import CASE_FILES, SCHEMA_VERSION, validate_case_dict
from actions.elic_case_export import validate_case_path


@dataclass
class ElicCase:
    """Votex'in tuketecegi bellek ici case modeli."""

    case_id: str
    schema_version: str
    manifest: dict[str, Any]
    analysis: dict[str, Any]
    inference: dict[str, Any]
    voice_summary: str
    screen_path: Path | None = None
    survey: dict[str, Any] | None = None
    root_dir: Path | None = None
    _cleanup_dirs: list[Path] = field(default_factory=list, repr=False)

    def close(self) -> None:
        for d in self._cleanup_dirs:
            shutil.rmtree(d, ignore_errors=True)
        self._cleanup_dirs.clear()

    def to_votex_dict(self) -> dict[str, Any]:
        """Votex JS import icin duz JSON sozlesmesi."""
        return {
            "schema_version": self.schema_version,
            "case_id": self.case_id,
            "manifest": self.manifest,
            "analysis": self.analysis,
            "inference": self.inference,
            "voice_summary": self.voice_summary,
            "survey": self.survey,
            "has_screen": self.screen_path is not None and self.screen_path.is_file(),
            "screen_path": str(self.screen_path) if self.screen_path else None,
            "hud": (self.analysis or {}).get("hud") or {},
            "heatmap_stats": (self.analysis or {}).get("heatmap_stats") or {},
            "spatial_relations": (self.analysis or {}).get("spatial_relations") or [],
            "top_hypothesis": (self.inference or {}).get("top_hypothesis"),
            "disclaimer": (self.inference or {}).get("disclaimer")
            or (self.manifest or {}).get("disclaimer"),
        }


def _resolve_case_dir(path: Path) -> tuple[Path, Path | None]:
    """(case_dir, cleanup_tmp_or_None)."""
    path = Path(path)
    if path.is_file() and path.suffix.lower() == ".zip":
        tmp = Path(tempfile.mkdtemp(prefix="votex_elic_"))
        with zipfile.ZipFile(path, "r") as zf:
            zf.extractall(tmp)
        children = [p for p in tmp.iterdir() if p.is_dir()]
        case_dir = children[0] if len(children) == 1 else tmp
        return case_dir, tmp
    if path.is_dir():
        return path, None
    raise FileNotFoundError(f"ELIC Case bulunamadi: {path}")


def open_elic_case(path: Path | str) -> dict[str, Any]:
    """
    ZIP veya klasor acar.

    Returns:
      {ok, errors, case: ElicCase|None, votex: dict|None, validation: dict}
    """
    path = Path(path)
    validation = validate_case_path(path)
    if not validation.get("ok"):
        return {
            "ok": False,
            "errors": list(validation.get("errors") or []),
            "case": None,
            "votex": None,
            "validation": validation,
        }

    try:
        case_dir, cleanup = _resolve_case_dir(path)
    except Exception as exc:
        return {
            "ok": False,
            "errors": [str(exc)],
            "case": None,
            "votex": None,
            "validation": validation,
        }

    def _json(name: str) -> dict[str, Any]:
        fp = case_dir / name
        return json.loads(fp.read_text(encoding="utf-8"))

    manifest = _json(CASE_FILES["manifest"])
    analysis = _json(CASE_FILES["analysis"])
    inference = _json(CASE_FILES["inference"])
    voice = (case_dir / CASE_FILES["voice_summary"]).read_text(encoding="utf-8")
    screen = case_dir / CASE_FILES["screen"]
    survey_path = case_dir / CASE_FILES["survey"]
    survey = _json(CASE_FILES["survey"]) if survey_path.is_file() else None

    # Cift dogrulama (acik model)
    errors = validate_case_dict(
        manifest=manifest,
        analysis=analysis,
        inference=inference,
        has_screen=screen.is_file(),
    )
    if errors:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)
        return {
            "ok": False,
            "errors": errors,
            "case": None,
            "votex": None,
            "validation": validation,
        }

    case = ElicCase(
        case_id=str(manifest.get("case_id") or path.stem),
        schema_version=str(manifest.get("schema_version") or SCHEMA_VERSION),
        manifest=manifest,
        analysis=analysis,
        inference=inference,
        voice_summary=voice,
        screen_path=screen if screen.is_file() else None,
        survey=survey,
        root_dir=case_dir,
    )
    if cleanup:
        case._cleanup_dirs.append(cleanup)

    return {
        "ok": True,
        "errors": [],
        "case": case,
        "votex": case.to_votex_dict(),
        "validation": validation,
    }


def case_summary(case_or_votex: ElicCase | dict[str, Any]) -> str:
    """Ofis paneli / log icin kisa Turkce ozet."""
    if isinstance(case_or_votex, ElicCase):
        v = case_or_votex.to_votex_dict()
    else:
        v = case_or_votex

    hud = v.get("hud") or {}
    stats = v.get("heatmap_stats") or {}
    top = v.get("top_hypothesis") or {}
    parts = [
        f"Case {v.get('case_id')} · schema {v.get('schema_version')}",
    ]
    if top:
        parts.append(
            f"Ana hipotez: {top.get('label')} (guven: {top.get('confidence')})"
        )
    depth = hud.get("depth_m")
    if depth is not None:
        parts.append(f"Depth: {float(depth):.2f} m")
    heading = hud.get("heading")
    if heading is not None:
        parts.append(f"Yon: {heading}")
    if hud.get("anomaly_gauge") is not None:
        parts.append(f"Anomali olcek: {hud.get('anomaly_gauge')}")
    parts.append(
        f"Stats metal%{stats.get('metal_pct', 0)} void%{stats.get('void_pct', 0)} "
        f"wall%{stats.get('wall_pct', 0)} glow%{stats.get('glow_pct', 0)}"
    )
    disc = v.get("disclaimer")
    if disc:
        parts.append(f"Not: {disc[:120]}...")
    return " | ".join(parts)


def import_checklist() -> list[dict[str, str]]:
    """Gercek Votex entegasyonu icin kontrol listesi."""
    return [
        {"adim": "1", "madde": "ZIP sec / surukle birak"},
        {"adim": "2", "madde": "schema_version == 1.0 dogrula"},
        {"adim": "3", "madde": "screen.png galeriye yukle"},
        {"adim": "4", "madde": "analysis.hud Depth/yon/gauge paneli"},
        {"adim": "5", "madde": "inference.hypotheses listele (ipucu etiketi)"},
        {"adim": "6", "madde": "PhysicsBridge ile yeniden parse (opsiyonel)"},
        {"adim": "7", "madde": "OfficeReport PDF/HTML bas"},
    ]
