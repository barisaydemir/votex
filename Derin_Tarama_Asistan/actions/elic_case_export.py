"""
ELIC Case paketleyici — DTA → Votex köprüsü (schema 1.0).

Kullanım:
  build_case_from_analysis(...) → Path (klasör veya .zip)
  validate_case_path(path) → (ok, errors)
"""

from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app_config import BASE_DIR, get_app_config_value
from actions.elic_case_schema import (
    CASE_FILES,
    DISCLAIMER_TR,
    SCHEMA_VERSION,
    build_analysis_payload,
    build_inference_payload,
    build_manifest,
    validate_case_dict,
)

CASES_DIR = BASE_DIR / "reports" / "elic_cases"


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _iso_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def attach_recording_to_case(
    case_dir: Path,
    session_dir: Path | None,
    *,
    max_frames: int = 40,
) -> dict[str, Any]:
    """REC oturumunu case icine recording/ olarak kopyalar (Faz 4)."""
    if session_dir is None:
        return {"attached": False, "reason": "session yok"}
    session_dir = Path(session_dir)
    if not session_dir.is_dir():
        return {"attached": False, "reason": f"klasor yok: {session_dir}"}

    rec_dir = Path(case_dir) / "recording"
    if rec_dir.exists():
        shutil.rmtree(rec_dir)
    rec_dir.mkdir(parents=True)

    meta_src = session_dir / "session.json"
    frame_count = 0
    video_copied = False

    if meta_src.is_file():
        shutil.copy2(meta_src, rec_dir / "session.json")

    frames_src = session_dir / "frames"
    frames_dst = rec_dir / "frames"
    if frames_src.is_dir():
        frames = sorted(frames_src.glob("frame_*.png"))
        if max_frames > 0 and len(frames) > max_frames:
            # ilk + son dilim (zaman serisi ornekleme)
            head = max(1, max_frames // 4)
            tail = max_frames - head
            frames = frames[:head] + frames[-tail:]
        frames_dst.mkdir(parents=True, exist_ok=True)
        for fp in frames:
            shutil.copy2(fp, frames_dst / fp.name)
            frame_count += 1

    for pattern in ("*.mp4", "*.gif", "*.webm"):
        for vid in session_dir.glob(pattern):
            shutil.copy2(vid, rec_dir / vid.name)
            video_copied = True

    info = {
        "attached": True,
        "session_dir": str(session_dir),
        "frames_copied": frame_count,
        "video_copied": video_copied,
        "max_frames": max_frames,
    }
    _write_json(rec_dir / "attach_info.json", info)
    return info


def resolve_recording_session() -> Path | None:
    """Aktif veya son REC oturumu."""
    try:
        from actions.elic_recorder import RECORDINGS_DIR, get_recorder
        st = get_recorder().status()
        sid = str(st.get("session_dir") or "").strip()
        if sid:
            p = Path(sid)
            if p.is_dir():
                return p
        if RECORDINGS_DIR.is_dir():
            sessions = sorted(
                [d for d in RECORDINGS_DIR.iterdir() if d.is_dir() and d.name.startswith("elic_")],
                key=lambda d: d.stat().st_mtime,
                reverse=True,
            )
            if sessions:
                return sessions[0]
    except Exception:
        pass
    return None


def survey_payload_from_session() -> dict[str, Any] | None:
    """Aktif saha taramasindan Votex uyumlu survey.json govdesi."""
    try:
        from actions.survey_nav import get_survey_ui_state
        state = get_survey_ui_state()
    except Exception:
        return None
    if not state.get("active"):
        return None
    width_m = float(state.get("width_m") or 0)
    length_m = float(state.get("length_m") or 0)
    if width_m <= 0 or length_m <= 0:
        return None
    corners = state.get("corners") or []
    corner_summaries = []
    for i, c in enumerate(corners, start=1):
        if not isinstance(c, dict):
            continue
        corner_summaries.append({
            "index": i,
            "heading_deg": c.get("heading_deg"),
            "depth_m": c.get("depth_m"),
            "heading_cardinal": c.get("heading_cardinal"),
        })
    return {
        "width_m": width_m,
        "length_m": length_m,
        "height_m": length_m,  # Votex height_m / boy
        "en_m": width_m,
        "boy_m": length_m,
        "corner_count": int(state.get("corner_count") or len(corners)),
        "corners": corner_summaries,
        "corner4": state.get("corner4"),
        "source": "Derin_Tarama_Asistan_survey",
    }


def build_case_from_analysis(
    analysis: dict[str, Any],
    screen_path: Path | None = None,
    *,
    cases_dir: Path | None = None,
    case_id: str | None = None,
    make_zip: bool = True,
    voice_summary: str | None = None,
    survey: dict[str, Any] | None = None,
    device_model: str = "",
    serial: str = "",
    recording_session: Path | None = None,
    include_recording: bool = False,
    max_rec_frames: int = 40,
) -> dict[str, Any]:
    """Analiz + ekran görüntüsünden ELIC Case klasörü/ZIP üretir."""
    out_root = Path(cases_dir) if cases_dir else CASES_DIR
    out_root.mkdir(parents=True, exist_ok=True)
    cid = case_id or f"elic_case_{_stamp()}"
    case_dir = out_root / cid
    if case_dir.exists():
        shutil.rmtree(case_dir)
    case_dir.mkdir(parents=True)

    window_title = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC")
    active = str(analysis.get("active_sensor") or "magnetic")

    manifest = build_manifest(
        capture_time=_iso_now(),
        device_model=device_model,
        serial=serial,
        active_sensor=active,
        window_title=window_title,
        extra={"case_id": cid, "schema_frozen": True},
    )
    analysis_payload = build_analysis_payload(analysis)
    inference_payload = build_inference_payload(analysis)

    summary = voice_summary or inference_payload.get("summary") or ""
    if DISCLAIMER_TR not in summary:
        summary = f"{summary}\n\n{DISCLAIMER_TR}".strip()

    _write_json(case_dir / CASE_FILES["manifest"], manifest)
    _write_json(case_dir / CASE_FILES["analysis"], analysis_payload)
    _write_json(case_dir / CASE_FILES["inference"], inference_payload)
    (case_dir / CASE_FILES["voice_summary"]).write_text(summary, encoding="utf-8")

    screen_ok = False
    if screen_path and Path(screen_path).is_file():
        dest = case_dir / CASE_FILES["screen"]
        shutil.copy2(screen_path, dest)
        screen_ok = dest.stat().st_size > 0

    survey_payload = survey if survey is not None else survey_payload_from_session()
    if survey_payload:
        _write_json(case_dir / CASE_FILES["survey"], survey_payload)
        manifest["has_survey"] = True
        manifest["survey_width_m"] = survey_payload.get("width_m")
        manifest["survey_length_m"] = survey_payload.get("length_m")
        _write_json(case_dir / CASE_FILES["manifest"], manifest)

    rec_info: dict[str, Any] | None = None
    if include_recording:
        session = recording_session or resolve_recording_session()
        rec_info = attach_recording_to_case(case_dir, session, max_frames=max_rec_frames)
        if rec_info.get("attached"):
            manifest["has_recording"] = True
            manifest["recording_frames"] = rec_info.get("frames_copied", 0)
            _write_json(case_dir / CASE_FILES["manifest"], manifest)

    errors = validate_case_dict(
        manifest=manifest,
        analysis=analysis_payload,
        inference=inference_payload,
        has_screen=screen_ok,
    )

    zip_path: Path | None = None
    if make_zip and not errors:
        zip_path = out_root / f"{cid}.zip"
        if zip_path.exists():
            zip_path.unlink()
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(case_dir.rglob("*")):
                if p.is_file():
                    zf.write(p, arcname=f"{cid}/{p.relative_to(case_dir).as_posix()}")

    return {
        "ok": not errors,
        "errors": errors,
        "case_id": cid,
        "case_dir": str(case_dir),
        "zip_path": str(zip_path) if zip_path else None,
        "schema_version": SCHEMA_VERSION,
        "recording": rec_info,
        "survey": survey_payload,
    }


def validate_case_path(path: Path) -> dict[str, Any]:
    """Klasör veya ZIP doğrula."""
    path = Path(path)
    tmp_extract: Path | None = None
    try:
        if path.is_file() and path.suffix.lower() == ".zip":
            import tempfile
            tmp_extract = Path(tempfile.mkdtemp(prefix="elic_case_"))
            with zipfile.ZipFile(path, "r") as zf:
                zf.extractall(tmp_extract)
            # zip icinde tek kok klasor olabilir
            children = [p for p in tmp_extract.iterdir() if p.is_dir()]
            case_dir = children[0] if len(children) == 1 else tmp_extract
        elif path.is_dir():
            case_dir = path
        else:
            return {"ok": False, "errors": [f"Gecersiz yol: {path}"], "path": str(path)}

        def _load(name: str) -> dict[str, Any] | None:
            fp = case_dir / name
            if not fp.is_file():
                return None
            return json.loads(fp.read_text(encoding="utf-8"))

        manifest = _load(CASE_FILES["manifest"])
        analysis = _load(CASE_FILES["analysis"])
        inference = _load(CASE_FILES["inference"])
        has_screen = (case_dir / CASE_FILES["screen"]).is_file()
        voice = case_dir / CASE_FILES["voice_summary"]

        errors: list[str] = []
        if manifest is None:
            errors.append("manifest.json yok")
        if analysis is None:
            errors.append("analysis.json yok")
        if not voice.is_file():
            errors.append("voice_summary.txt yok")

        if manifest and analysis:
            errors.extend(
                validate_case_dict(
                    manifest=manifest,
                    analysis=analysis,
                    inference=inference,
                    has_screen=has_screen,
                )
            )

        return {
            "ok": not errors,
            "errors": errors,
            "path": str(path),
            "case_dir": str(case_dir),
            "schema_version": (manifest or {}).get("schema_version"),
            "case_id": (manifest or {}).get("case_id"),
        }
    finally:
        if tmp_extract and tmp_extract.exists():
            shutil.rmtree(tmp_extract, ignore_errors=True)


def export_case_from_image(
    image_path: Path,
    *,
    depth_cap_m: float | None = None,
    make_zip: bool = True,
    cases_dir: Path | None = None,
    use_gemini: bool = False,
    include_recording: bool = False,
    recording_session: Path | None = None,
) -> dict[str, Any]:
    """Ekran görüntüsünden heatmap + HUD + case paketi."""
    from actions.compass_reader import read_elic_hud

    image_path = Path(image_path)
    cap = depth_cap_m
    if cap is None:
        cap = float(get_app_config_value("elic_depth_cap_m", 10) or 10)
    analysis = read_elic_hud(image_path, depth_cap_m=cap, use_gemini=use_gemini)
    return build_case_from_analysis(
        analysis,
        screen_path=image_path,
        make_zip=make_zip,
        cases_dir=cases_dir,
        include_recording=include_recording,
        recording_session=recording_session,
    )


def create_field_report(*, use_gemini_hud: bool = False, include_recording: bool = True) -> str:
    """Proton ELIC penceresini yakala ve ELIC Case ZIP uret (RAPOR butonu)."""
    from actions.windows_utils import capture_window

    target = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC").strip()
    ok, detail, payload = capture_window(target)
    if not ok:
        return f"Rapor alinamadi: {detail}"

    image_path = Path(str(payload.get("image_path", "")))
    try:
        if not image_path.exists() or image_path.stat().st_size <= 0:
            return "Rapor alinamadi: ekran goruntusu bos."
        result = export_case_from_image(
            image_path,
            make_zip=True,
            use_gemini=use_gemini_hud,
            include_recording=include_recording,
        )
        if not result.get("ok"):
            errs = "; ".join(result.get("errors") or ["bilinmeyen"])
            return f"Rapor paketi dogrulanamadi: {errs}"
        zip_path = result.get("zip_path") or result.get("case_dir")
        summary = ""
        try:
            case_dir = Path(result["case_dir"])
            summary = (case_dir / "voice_summary.txt").read_text(encoding="utf-8").split("\n")[0][:180]
        except Exception:
            pass
        msg = f"ELIC Case kaydedildi (schema {SCHEMA_VERSION}): {zip_path}"
        rec = result.get("recording") or {}
        if rec.get("attached"):
            msg += f" · REC {rec.get('frames_copied', 0)} kare eklendi"
        survey = result.get("survey") or {}
        if survey.get("width_m") and survey.get("length_m"):
            msg += f" · survey {survey['width_m']}x{survey['length_m']} m"
        if summary:
            msg = f"{msg}\n{summary}"
        return msg
    finally:
        try:
            if image_path.exists():
                image_path.unlink()
        except Exception:
            pass
