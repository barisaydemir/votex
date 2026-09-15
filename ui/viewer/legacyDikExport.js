/**
 * Legacy tespit dışa aktarım — CSV / GeoJSON (plan metre; CAD değil).
 */
import { state } from "../app/state.js";
import { saveFileDialog } from "../api/tauri.js";

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function depthParamsSnapshot(params = null) {
  const p = params || {};
  return {
    sensorHeightM: numberOrNull(p.sensorHeightM ?? p.sensor_height_m),
    bipolarSepFactor: numberOrNull(p.bipolarSepFactor ?? p.bipolar_sep_factor),
    dipoleBlend: numberOrNull(p.dipoleBlend ?? p.dipole_blend),
  };
}

export function detectionsToRows(detections, params = null) {
  const depthParams = depthParamsSnapshot(params);
  return (Array.isArray(detections) ? detections : []).map((d) => {
    const raw = d?.raw || {};
    return {
      detectionId: d.detectionId || "",
      stepIndex: numberOrNull(d.stepIndex),
      stationM: numberOrNull(d.stationM),
      depthTopM: numberOrNull(d.depthTopM),
      depthBottomM: numberOrNull(d.depthBottomM),
      peakSigma: numberOrNull(d.strength ?? d.peakSigma ?? raw.peakSigma),
      confidence: numberOrNull(d.confidence),
      type: d.type || "",
      widthM: numberOrNull(d.dimensions?.width ?? raw.widthM),
      lengthM: numberOrNull(d.dimensions?.length ?? raw.lengthM),
      cx: numberOrNull(raw.cx),
      cy: numberOrNull(raw.cy),
      status: d.status || "",
      sensorHeightM: depthParams.sensorHeightM,
      bipolarSepFactor: depthParams.bipolarSepFactor,
      dipoleBlend: depthParams.dipoleBlend,
    };
  });
}

export function buildLegacyDetectionsCsv(detections, params = null) {
  const rows = detectionsToRows(detections, params);
  const headers = [
    "detectionId",
    "stepIndex",
    "stationM",
    "depthTopM",
    "depthBottomM",
    "peakSigma",
    "confidence",
    "type",
    "widthM",
    "lengthM",
    "cx",
    "cy",
    "status",
    "sensorHeightM",
    "bipolarSepFactor",
    "dipoleBlend",
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

export function buildLegacyDetectionsGeoJson(detections, params = null, meta = {}) {
  const depthParams = depthParamsSnapshot(params);
  const rows = detectionsToRows(detections, params);
  return {
    type: "FeatureCollection",
    properties: {
      source: "VOTEX Legacy3DMAG",
      disclaimer: "Plan metre koordinat; CAD / gerçek cisim şekli değil.",
      fileName: meta.fileName || state.legacyDikFileName || null,
      ...depthParams,
    },
    features: rows.map((row) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          Number.isFinite(row.cx) ? row.cx : 0,
          Number.isFinite(row.cy) ? row.cy : 0,
        ],
      },
      properties: { ...row },
    })),
  };
}

function baseName() {
  const raw = String(state.legacyDikFileName || "legacy_detections").replace(/\.[^.]+$/, "");
  return raw || "legacy_detections";
}

function downloadBlob(content, fileName, mime) {
  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportLegacyDetectionsCsv(detections, params = null) {
  const text = buildLegacyDetectionsCsv(detections, params);
  const name = `${baseName()}.detections.csv`;
  try {
    const saved = await saveFileDialog(text, name, "CSV", ["csv"]);
    if (saved) return { ok: true, via: "dialog", path: saved };
  } catch {
    /* fallback */
  }
  downloadBlob(text, name, "text/csv;charset=utf-8");
  return { ok: true, via: "download" };
}

export async function exportLegacyDetectionsGeoJson(detections, params = null) {
  const geo = buildLegacyDetectionsGeoJson(detections, params, {
    fileName: state.legacyDikFileName,
  });
  const text = `${JSON.stringify(geo, null, 2)}\n`;
  const name = `${baseName()}.detections.geojson`;
  try {
    const saved = await saveFileDialog(text, name, "GeoJSON", ["geojson", "json"]);
    if (saved) return { ok: true, via: "dialog", path: saved };
  } catch {
    /* fallback */
  }
  downloadBlob(text, name, "application/geo+json");
  return { ok: true, via: "download" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLegacyFieldSummaryHtml(options = {}) {
  const {
    fileName = state.legacyDikFileName || "legacy.json",
    briefHtml = "",
    briefText = "",
    residualNote = "residual σ · kalibre nT değil",
    params = {},
    fingerprint = "",
  } = options;
  const p = depthParamsSnapshot(params);
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"/><title>VOTEX Saha Özeti</title>
<style>
body{font-family:Segoe UI,sans-serif;margin:24px;color:#122;background:#fff;max-width:720px}
h1{font-size:1.25rem;margin:0 0 .4rem} .muted{color:#567;font-size:.85rem}
.box{border:1px solid #ccd;border-radius:6px;padding:12px 14px;margin:12px 0}
.k{font-size:.7rem;letter-spacing:.06em;color:#368;font-weight:700}
.print-btn{margin:8px 0 16px;padding:8px 14px}
@media print{.print-btn{display:none}}
</style></head><body>
<button class="print-btn" onclick="window.print()">Yazdır / PDF kaydet</button>
<h1>VOTEX · Saha özeti</h1>
<p class="muted">${escapeHtml(fileName)}${fingerprint ? ` · ${escapeHtml(fingerprint)}` : ""}</p>
<div class="box"><div class="k">SEÇİLİ BULGU</div>${briefHtml || `<pre>${escapeHtml(briefText || "Tespit seçilmedi")}</pre>`}</div>
<div class="box"><div class="k">LEJANT</div><p>${escapeHtml(residualNote)}</p>
<p class="muted">Manyetik ayak izi · gerçek duvar/obje CAD’i değil · χ ölçülmedi</p></div>
<div class="box"><div class="k">PARAMETRE</div>
<p>Cihaz–yüzey: <b>${p.sensorHeightM ?? "—"}</b> m · Bipolar: <b>${p.bipolarSepFactor ?? "—"}</b> · Dipol: <b>${p.dipoleBlend != null ? Math.round(p.dipoleBlend * 100) : "—"}%</b></p>
<p class="muted">Invert proxy: kompakt dipol uydurma — CAD / gerçek şekil değil.</p></div>
</body></html>`;
}

export async function exportLegacyFieldSummary(options = {}) {
  const html = buildLegacyFieldSummaryHtml(options);
  const name = `${baseName()}.saha-ozet.html`;
  try {
    const saved = await saveFileDialog(html, name, "HTML Raporu", ["html"]);
    if (saved) return { ok: true, via: "dialog", path: saved };
  } catch {
    /* fallback */
  }
  downloadBlob(html, name, "text/html;charset=utf-8");
  return { ok: true, via: "download" };
}
