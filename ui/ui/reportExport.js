/**
 * reportExport.js — Profesyonel saha raporu dışa aktarma.
 *
 * Tek tıkla:
 *   1. 3D sahne PNG yakalama
 *   2. Yapı listesi + metal tespitleri + istatistikler
 *   3. Yeni pencerede PDF'e hazır HTML rapor (Ctrl+P ile kaydet)
 *   4. Doğrudan PNG indirme
 */
import { state } from "../app/state.js";
import { saveFileDialog } from "../api/tauri.js";
import { getDetectionNotes, loadDetectionNotes } from "./detectionNotes.js";
import { getCacheStatus, getOriginalResult, getCacheEntry } from "../hybrid/colorBasedAnalysis.js";
import { compareResults } from "../hybrid/colorCompare.js";
import { PALETTES } from "../viewer/colorizer.js";

/**
 * 3D sahnenin görüntüsünü yakala.
 * @param {string} format — "image/png" veya "image/jpeg"
 * @param {number} quality — JPEG kalitesi (0-1, sadece JPEG için)
 * @returns {string|null} base64 data URL
 */
function captureSceneImage(format = "image/png", quality = 0.92) {
  const renderer = state.renderer;
  if (!renderer || !renderer.domElement) return null;
  // Bir render tetikle (tampon taze olsun)
  if (state.scene && state.camera) {
    renderer.render(state.scene, state.camera);
  }
  try {
    if (format === "image/jpeg") {
      return renderer.domElement.toDataURL(format, quality);
    }
    return renderer.domElement.toDataURL(format);
  } catch {
    return null;
  }
}

/**
 * Bir tespitin saha notunu/fotoğraflarını HTML olarak döndür.
 * @param {string} focusId - chamber-0, tunnel-1, metal-2 vb.
 * @returns {string} HTML bloğu (boşsa boş string)
 */
function renderDetectionNotesHTML(focusId) {
  const notes = getDetectionNotes(focusId);
  if (!notes.notes && (!notes.photos || notes.photos.length === 0)) return "";

  let html = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08)">`;

  if (notes.notes) {
    html += `<div style="font-size:12px;color:#b8d4e3;margin-bottom:6px">
      <span style="color:#8ea8b8">📝 Saha Notu:</span><br/>
      <div style="white-space:pre-wrap;margin-top:4px;color:#c8d8e4;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:4px">${escapeHTML(notes.notes)}</div>
    </div>`;
  }

  if (notes.photos && notes.photos.length > 0) {
    html += `<div style="margin-top:6px">
      <div style="font-size:12px;color:#8ea8b8;margin-bottom:6px">📷 Saha Fotoğrafları (${notes.photos.length})</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">`;
    for (const photo of notes.photos) {
      html += `<div style="text-align:center">
        <img src="${photo.dataUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #333" />
        <div style="font-size:9px;color:#666;margin-top:2px">${escapeHTML(photo.name || "Fotoğraf")}</div>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * HTML içeriğini escape et.
 */
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Surface verisinden istatistikleri çıkar.
 */
function extractStats(surface) {
  if (!surface) return null;
  const s = surface.structures || {};
  const chambers = s.chambers || [];
  const tunnels = s.tunnels || [];
  const metals = s.metals || [];
  const waters = s.waters || [];
  const rooms = chambers.filter(c => c.kind === "room" || c.kind === "tomb");
  const shafts = chambers.filter(c => c.kind === "shaft");

  // camelCase veya snake_case — her ikisini de dene
  const mapW = surface.mapWidthM ?? surface.map_width_m ?? surface.mapSizeM ?? surface.map_size_m ?? 0;
  const mapD = surface.mapDepthM ?? surface.map_depth_m ?? 0;
  const viewMode = surface.viewMode ?? surface.view_mode ?? "top";
  const soilProfile = surface.soilProfile ?? surface.soil_profile ?? "off";
  const soilLabel = surface.soilLabel ?? surface.soil_label ?? "";
  const accepted = s.acceptedCount ?? s.accepted_count ?? (rooms.length + shafts.length + tunnels.length + metals.length);
  const rejected = s.rejectedCount ?? s.rejected_count ?? 0;
  const vpeUsed = !!surface.vpeUsed ?? !!surface.vpe_used;

  return {
    // Counts (numbers)
    roomCount: rooms.length,
    shaftCount: shafts.length,
    tunnelCount: tunnels.length,
    metalCount: metals.length,
    waterCount: waters.length,
    totalCount: chambers.length + tunnels.length + metals.length,
    accepted,
    rejected,
    mapWidth: mapW,
    mapDepth: mapD,
    viewMode,
    soilProfile,
    soilLabel,
    vpeUsed,
    // Arrays (for card generation)
    chambers,
    tunnels,
    metals,
  };
}

/**
 * Metal sınıflandırması üret.
 */
function classifyMetal(m) {
  const fs = m.fieldStrength ?? m.field_strength ?? 0;
  const guess = m.metalGuess ?? m.metal_guess ?? "";
  const cue = m.cueKind ?? m.cue_kind ?? "";
  const isValuable = guess === "au_ag_fe";
  const hasStrongCue = cue === "metal" || cue === "oxidation";

  let reliability, label;
  if ((fs >= 0.55 && (isValuable || hasStrongCue)) || fs >= 0.7) {
    reliability = "high";
    label = isValuable ? "Değerli Metal (Au/Ag/Fe)" : "Metal Anomalisi";
  } else if (fs >= 0.3 || ((m.insideChamber ?? m.inside_chamber) && fs >= 0.2)) {
    reliability = "medium";
    label = isValuable ? "Değerli Metal" : "Metal";
  } else {
    reliability = "low";
    label = "Düşük Güvenilir Metal";
  }
  return { reliability, label, fieldStrength: fs, isValuable, guess, cue };
}

/**
 * Yapı türünü Türkçe'ye çevir.
 */
function kindLabel(kind) {
  const map = { room: "Oda", tomb: "Mezar", shaft: "Kuyu", tunnel: "Tünel" };
  return map[kind] || kind || "Bilinmiyor";
}

/**
 * Güvenilirlik rengi.
 */
function reliabilityColor(r) {
  return { high: "#22c55e", medium: "#eab308", low: "#f97316", rejected: "#ef4444" }[r] || "#666";
}

/**
 * Güvenilirlik etiketi.
 */
function reliabilityLabel(r) {
  return { high: "Yüksek", medium: "Orta", low: "Düşük", rejected: "Reddedildi" }[r] || r;
}

/**
 * Metre değerini güvenli biçimde formatla.
 * @param {number|undefined|null} val
 * @param {number} decimals
 * @returns {string}
 */
function fmtM(val, decimals = 1) {
  if (val == null || isNaN(val) || val === 0) return "—";
  return val.toFixed(decimals) + "m";
}

/**
 * Yüzde değerini güvenli biçimde formatla.
 */
function fmtPct(val) {
  if (val == null || isNaN(val)) return "—";
  return Math.round(val * 100) + "%";
}

/**
 * SNR değerini güvenli biçimde formatla.
 */
function fmtSNR(val) {
  if (val == null || isNaN(val)) return "—";
  return Number(val).toFixed(1);
}

/**
 * Renk-bazlı analiz karşılaştırma HTML'i.
 * Önbellekteki tüm renk şeması analizlerini karşılaştırır.
 */
function renderColorComparisonHTML() {
  const cacheStatus = getCacheStatus();
  const original = getOriginalResult();

  // Orijinal analiz yoksa veya önbellek boşsa gösterme
  if (!original || cacheStatus.count <= 1) return "";

  // Her renk şeması için karşılaştırma
  const comparisons = [];
  for (const key of cacheStatus.keys) {
    if (key === "none") continue;
    const pal = PALETTES[key];
    if (!pal) continue;

    // Önbellekten sonucu al
    const cached = getCacheEntry(key);
    if (!cached?.result) continue;

    const diff = compareResults(original, cached.result);
    if (!diff.valid) continue;

    const s = diff.structures;
    const c = diff.confidence;
    const deltaColor = (val) => val > 0 ? "#22c55e" : val < 0 ? "#ef4444" : "#666";
    const deltaStr = (val) => val > 0 ? `+${val}` : `${val}`;

    comparisons.push(`
      <div style="padding:10px;background:rgba(14,21,32,0.8);border-radius:6px;border:1px solid rgba(74,158,255,0.2)">
        <div style="font-weight:600;color:#4a9eff;font-size:12px;margin-bottom:8px">🎨 ${pal.label}</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr style="border-bottom:1px solid rgba(255,255,255,0.1)">
            <td style="padding:3px 0;color:#888">Yapı</td>
            <td style="text-align:right;padding:3px 0">Orijinal</td>
            <td style="text-align:right;padding:3px 0">Renkli</td>
            <td style="text-align:right;padding:3px 0">Fark</td>
          </tr>
          <tr>
            <td style="padding:2px 0">Oda</td>
            <td style="text-align:right">${s.original.chambers}</td>
            <td style="text-align:right">${s.colored.chambers}</td>
            <td style="text-align:right;color:${deltaColor(s.delta.chambers)}">${deltaStr(s.delta.chambers)}</td>
          </tr>
          <tr>
            <td style="padding:2px 0">Tünel</td>
            <td style="text-align:right">${s.original.tunnels}</td>
            <td style="text-align:right">${s.colored.tunnels}</td>
            <td style="text-align:right;color:${deltaColor(s.delta.tunnels)}">${deltaStr(s.delta.tunnels)}</td>
          </tr>
          <tr>
            <td style="padding:2px 0">Metal</td>
            <td style="text-align:right">${s.original.metals}</td>
            <td style="text-align:right">${s.colored.metals}</td>
            <td style="text-align:right;color:${deltaColor(s.delta.metals)}">${deltaStr(s.delta.metals)}</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.15);font-weight:600">
            <td style="padding:3px 0">Toplam</td>
            <td style="text-align:right">${s.original.total}</td>
            <td style="text-align:right">${s.colored.total}</td>
            <td style="text-align:right;color:${deltaColor(s.delta.total)}">${deltaStr(s.delta.total)}</td>
          </tr>
        </table>
        <div style="margin-top:6px;font-size:10px;color:#888">
          Ort. güven: ${(c.original.avg * 100).toFixed(0)}% → ${(c.colored.avg * 100).toFixed(0)}%
          (${c.delta.avgConfidence > 0 ? "+" : ""}${(c.delta.avgConfidence * 100).toFixed(1)}%)
        </div>
        ${diff.detections.lost.length > 0 ? `<div style="margin-top:4px;font-size:10px;color:#ef4444">❌ Kaybolan: ${diff.detections.lost.map(l => l.label || l.id).join(", ")}</div>` : ""}
        ${diff.detections.gained.length > 0 ? `<div style="margin-top:4px;font-size:10px;color:#22c55e">✅ Yeni: ${diff.detections.gained.map(g => g.label || g.id).join(", ")}</div>` : ""}
        <div style="margin-top:4px;font-size:10px;color:#666">Özet: ${diff.summary}</div>
      </div>
    `);
  }

  if (comparisons.length === 0) return "";

  return `
  <div class="section print-break">
    <div class="section-title">🎨 Renk Bazlı Analiz Karşılaştırması</div>
    <div style="font-size:11px;color:#8ea8b8;margin-bottom:10px">
      Farklı renk şemasıyla tekrar analiz edilen yapı tespitlerinin karşılaştırması.
      Her şema zemin ve yapı renklerini değiştirerek farklı açılardan bakış sağlar.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${comparisons.join("\n")}
    </div>
  </div>`;
}

/**
 * Tam HTML rapor üret.
 */
function generateReportHTML(stats, scenePNG) {
  // Saha notlarını/yüklemelerini yükle
  loadDetectionNotes();
  const now = new Date();
  const dateStr = now.toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  // Priority list: odalar → tüller → metaller (güvenilirliğe göre sıralı)
  let prioNum = 0;
  const priorities = [];

  // Yüksek güvenilirlik: odalar
  for (const ch of (stats?.chambers || [])) {
    if ((ch.confidence || 0) >= 0.7) {
      prioNum++;
      priorities.push({ num: prioNum, label: kindLabel(ch.kind), conf: ch.confidence, level: "high" });
    }
  }
  // Yüksek: tüller
  for (const t of (stats?.tunnels || [])) {
    if ((t.confidence || 0) >= 0.7) {
      prioNum++;
      priorities.push({ num: prioNum, label: "Tünel", conf: t.confidence, level: "high" });
    }
  }
  // Orta: odalar + tüller
  for (const ch of (stats?.chambers || [])) {
    const c = ch.confidence || 0;
    if (c >= 0.5 && c < 0.7) {
      prioNum++;
      priorities.push({ num: prioNum, label: kindLabel(ch.kind), conf: ch.confidence, level: "medium" });
    }
  }
  for (const t of (stats?.tunnels || [])) {
    const c = t.confidence || 0;
    if (c >= 0.5 && c < 0.7) {
      prioNum++;
      priorities.push({ num: prioNum, label: "Tünel", conf: t.confidence, level: "medium" });
    }
  }
  // Metaller
  for (const m of (stats?.metals || [])) {
    const mc = classifyMetal(m);
    if (mc.reliability !== "low") {
      prioNum++;
      priorities.push({
        num: prioNum,
        label: mc.label,
        conf: mc.fieldStrength,
        level: mc.reliability,
        note: (m.insideChamber ?? m.inside_chamber) ? `${m.hostKind ?? m.host_kind} içinde` : "Bağımsız",
      });
    }
  }

  // Top priority indicators HTML
  const priorityHTML = priorities.length > 0
    ? priorities.map(p => `
      <tr>
        <td style="text-align:center;font-weight:700;color:${reliabilityColor(p.level)}">${p.num}</td>
        <td>${p.label}${p.note ? ` <span style="color:#8ea8b8">(${p.note})</span>` : ""}</td>
        <td style="text-align:center">
          <span style="background:${reliabilityColor(p.level)};color:#000;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">
            ${reliabilityLabel(p.level)}
          </span>
        </td>
        <td style="text-align:center;font-family:monospace">${Math.round((p.conf || 0) * 100)}%</td>
      </tr>`).join("")
    : '<tr><td colspan="4" style="text-align:center;color:#666;padding:12px">Öncelikli tespit yok</td></tr>';

  // Chamber detail cards
  const chamberCards = (stats?.chambers || []).map((ch, i) => {
    const conf = Math.round((ch.confidence || 0) * 100);
    const wallSup = ch.evidence?.wallSupport ?? ch.evidence?.wall_support ?? null;
    const snr = ch.evidence?.snr ?? null;
    const confColor = conf >= 70 ? "#22c55e" : conf >= 50 ? "#eab308" : "#f97316";
    const topM = ch.topFromSurfaceM ?? ch.top_from_surface_m ?? null;
    const heightM = ch.heightM ?? ch.height_m ?? null;
    const widthM = ch.widthM ?? ch.width_m ?? null;
    const lengthM = ch.lengthM ?? ch.length_m ?? null;
    return `
      <div style="background:#0e1520;border:1px solid #1e2d3d;border-left:4px solid ${confColor};border-radius:8px;padding:12px 16px;margin:8px 0;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:700;font-size:14px">${i + 1}. ${kindLabel(ch.kind)}</span>
          <span style="background:${confColor};color:#000;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${conf}% güven</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;color:#8ea8b8">
          <div>SNR: <strong style="color:#e8f0f4">${fmtSNR(snr)}</strong></div>
          <div>Duvar: <strong style="color:#e8f0f4">${wallSup != null ? Math.round(wallSup * 100) + '%' : '—'}</strong></div>
          <div>Derinlik: <strong style="color:#e8f0f4">${fmtM(topM)}</strong></div>
          <div>Yükseklik: <strong style="color:#e8f0f4">${fmtM(heightM)}</strong></div>
          <div>Boyut: <strong style="color:#e8f0f4">${(widthM != null && lengthM != null) ? widthM.toFixed(1) + '×' + lengthM.toFixed(1) + 'm' : '—'}</strong></div>
        </div>
        ${renderDetectionNotesHTML(`chamber-${i}`)}
      </div>`;
  }).join("");

  // Tunnel cards
  const tunnelCards = (stats?.tunnels || []).map((t, i) => {
    const conf = Math.round((t.confidence || 0) * 100);
    const wallSup = t.evidence?.wallSupport ?? t.evidence?.wall_support ?? null;
    const snr = t.evidence?.snr ?? null;
    const confColor = conf >= 70 ? "#22c55e" : conf >= 50 ? "#eab308" : "#f97316";
    const floorM = t.floorFromSurfaceM ?? t.floor_from_surface_m ?? null;
    const widthM = t.widthM ?? t.width_m ?? null;
    const heightM = t.heightM ?? t.height_m ?? null;
    return `
      <div style="background:#0e1520;border:1px solid #1e2d3d;border-left:4px solid ${confColor};border-radius:8px;padding:12px 16px;margin:8px 0;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:700;font-size:14px">🚇 Tünel #${i + 1}</span>
          <span style="background:${confColor};color:#000;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${conf}% güven</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;color:#8ea8b8">
          <div>SNR: <strong style="color:#e8f0f4">${fmtSNR(snr)}</strong></div>
          <div>Duvar: <strong style="color:#e8f0f4">${wallSup != null ? Math.round(wallSup * 100) + '%' : '—'}</strong></div>
          <div>Yön: <strong style="color:#e8f0f4">${t.heading || "—"}</strong></div>
          <div>Derinlik: <strong style="color:#e8f0f4">${fmtM(floorM)}</strong></div>
          <div>Genişlik: <strong style="color:#e8f0f4">${fmtM(widthM)}</strong></div>
          <div>Yükseklik: <strong style="color:#e8f0f4">${fmtM(heightM)}</strong></div>
        </div>
        ${renderDetectionNotesHTML(`tunnel-${i}`)}
      </div>`;
  }).join("");

  // Metal cards
  const metalCards = (stats?.metals || []).map((m, i) => {
    const mc = classifyMetal(m);
    const color = reliabilityColor(mc.reliability);
    const insideChamber = m.insideChamber ?? m.inside_chamber ?? false;
    const hostKind = m.hostKind ?? m.host_kind ?? "";
    const sizeM = m.sizeM ?? m.size_m ?? null;
    const depthM = m.depthFromSurfaceM ?? m.depth_from_surface_m ?? null;
    return `
      <div style="background:#0e1520;border:1px solid #1e2d3d;border-left:4px solid ${color};border-radius:8px;padding:12px 16px;margin:8px 0;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:700;font-size:14px">🧲 ${mc.label} #${i + 1}</span>
          <span style="background:${color};color:#000;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${reliabilityLabel(mc.reliability)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;color:#8ea8b8">
          <div>Alan gücü: <strong style="color:#e8f0f4">${Math.round(mc.fieldStrength * 100)}%</strong></div>
          <div>Tahmin: <strong style="color:#e8f0f4">${mc.guess || "—"}</strong></div>
          <div>İpucu: <strong style="color:#e8f0f4">${mc.cue || "—"}</strong></div>
          <div>Konum: <strong style="color:#e8f0f4">${insideChamber ? `${hostKind} içinde` : "Bağımsız"}</strong></div>
          ${(() => { try { const g = window.__gpsMod?.getGpsState(); if (g?.active) { const gps = window.__gpsMod.localToGps(Number(m.cx)||0, Number(m.cy)||0); if (gps) return `<div style="grid-column:1/-1">📍 GPS: <strong style="color:#3edc8c">${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E</strong> <a href="https://maps.google.com/?q=${gps.lat.toFixed(6)},${gps.lon.toFixed(6)}" target="_blank" style="color:#4a9eff;font-size:11px">Map</a></div>`; } } catch(e) {} return ""; })()}
          <div>Boyut: <strong style="color:#e8f0f4">${sizeM != null ? '~' + sizeM.toFixed(1) + 'm' : '—'}</strong></div>
          <div>Derinlik: <strong style="color:#e8f0f4">${fmtM(depthM)}</strong></div>
        </div>
        ${renderDetectionNotesHTML(`metal-${i}`)}
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>VOTEX Saha Raporu — ${dateStr}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  :root { --bg:#080c14; --surface:#0e1520; --border:#1e2d3d; --accent:#3edc8c; --blue:#4a9eff; --text:#e8f0f4; --text2:#8ea8b8; --text3:#5a7080; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:0; }
  @page { size:A4; margin:15mm; }
  @media print { body { background:#fff; color:#111; } .no-print { display:none!important; } .print-break { page-break-before:always; } }

  .report { max-width:210mm; margin:0 auto; padding:20px; }
  .header { text-align:center; padding:24px 0 16px; border-bottom:2px solid var(--border); margin-bottom:20px; }
  .header h1 { font-size:28px; font-weight:800; background:linear-gradient(135deg,var(--accent),var(--blue)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .header .subtitle { font-size:13px; color:var(--text3); margin-top:4px; }
  .header .date { font-size:12px; color:var(--text3); margin-top:8px; font-family:'JetBrains Mono',monospace; }

  .section { margin:16px 0; }
  .section-title { font-size:16px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:8px; }

  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0; }
  .stat-box { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center; }
  .stat-val { font-size:22px; font-weight:800; color:var(--accent); }
  .stat-label { font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }

  .scene-img { width:100%; border-radius:8px; border:1px solid var(--border); margin:12px 0; }

  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; padding:8px 10px; background:var(--surface); color:var(--text2); font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid var(--border); }
  td { padding:7px 10px; border-bottom:1px solid rgba(30,45,61,0.5); color:var(--text2); }
  tr:nth-child(even) td { background:rgba(14,21,32,0.5); }

  .footer { margin-top:24px; padding-top:12px; border-top:1px solid var(--border); display:flex; justify-content:space-between; font-size:10px; color:var(--text3); }
  .footer-center { text-align:center; }

  .print-btn { position:fixed; bottom:20px; right:20px; background:var(--accent); color:#000; border:none; padding:12px 24px; border-radius:8px; font-weight:700; cursor:pointer; font-size:14px; box-shadow:0 4px 16px rgba(62,220,140,0.3); z-index:10000; }
  .print-btn:hover { box-shadow:0 6px 24px rgba(62,220,140,0.5); transform:translateY(-1px); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ PDF olarak kaydet</button>

<div class="report">
  <!-- HEADER -->
  <div class="header">
    <h1>⛏️ VOTEX SAHA RAPORU</h1>
    <div class="subtitle">Manyetik Anomali Analiz Raporu · Manyetik Anomali Analiz</div>
    <div class="date">${dateStr} ${timeStr}</div>
  </div>

  <!-- 3D SAHNE -->
  ${scenePNG ? `
  <div class="section">
    <div class="section-title">🗺️ 3D Sahne Görüntüsü</div>
    <img class="scene-img" src="${scenePNG}" alt="VOTEX 3D Sahne" />
  </div>` : ""}

  <!-- İSTATİSTİKLER -->
  <div class="section">
    <div class="section-title">📊 Genel İstatistikler${stats?.vpeUsed ? ' <span style="color:#3edc8c;font-size:12px">🤖 VPE ile harmanlanmış</span>' : ''}</div>
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-val">${stats?.roomCount || 0}</div>
        <div class="stat-label">Oda / Mezar</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${stats?.tunnelCount || 0}</div>
        <div class="stat-label">Tünel</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${stats?.metalCount || 0}</div>
        <div class="stat-label">Metal</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${stats?.totalCount || 0}</div>
        <div class="stat-label">Toplam Tespit</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;color:var(--text2);margin-top:8px">
      <div>📍 Harita: <strong style="color:var(--text)">${stats?.mapWidth || 0}m × ${stats?.mapDepth || 0}m</strong></div>
      <div>👁️ Çekim: <strong style="color:var(--text)">${stats?.viewMode === "side" ? "Yan" : "Dik"}</strong></div>
      <div>🌍 Toprak: <strong style="color:var(--text)">${stats?.soilLabel || stats?.soilProfile || "Kapalı"}</strong></div>
    </div>
  </div>

  <!-- ÖNCELİK SIRASI -->
  <div class="section print-break">
    <div class="section-title">🎯 Öncelik Sırası</div>
    <table>
      <thead><tr><th style="width:40px">#</th><th>Tespit</th><th>Güvenilirlik</th><th>Güven</th></tr></thead>
      <tbody>${priorityHTML}</tbody>
    </table>
  </div>

  <!-- ODALAR -->
  ${(chamberCards && chamberCards.length) ? `
  <div class="section">
    <div class="section-title">🏛️ Yapılar (${stats?.chambers?.length || 0})</div>
    ${chamberCards}
  </div>` : ""}

  <!-- TÜELLER -->
  ${(tunnelCards && tunnelCards.length) ? `
  <div class="section">
    <div class="section-title">🚇 Tüller (${stats?.tunnels?.length || 0})</div>
    ${tunnelCards}
  </div>` : ""}

  <!-- METALLER -->
  ${(metalCards && metalCards.length) ? `
  <div class="section print-break">
    <div class="section-title">🧲 Metal Anomalileri (${stats?.metals?.length || 0})</div>
    ${metalCards}
  </div>` : ""}

  <!-- ÇİFT ANALİZ -->
  ${stats?.dualAnalysis ? `
  <div class="section print-break">
    <div class="section-title">🔬 Çift Analiz Raporu</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${stats.dualAnalysis.feedback ? `
      <div style="padding:10px;background:rgba(14,21,32,0.8);border-radius:6px;border:1px solid rgba(62,220,140,0.2)">
        <div style="font-weight:600;color:var(--accent);font-size:12px;margin-bottom:6px">🔄 Geri Besleme Döngüsü</div>
        <div style="font-size:11px;color:var(--text2)">
          CSV Eşik: ${stats.dualAnalysis.feedback.csvThresholds?.threshold?.toFixed(2) || '—'}<br/>
          Image Güven: ${stats.dualAnalysis.feedback.imageThresholds?.minConfidence?.toFixed(2) || '—'}
        </div>
      </div>` : ''}
      ${stats.dualAnalysis.confidence ? `
      <div style="padding:10px;background:rgba(14,21,32,0.8);border-radius:6px;border:1px solid rgba(139,92,246,0.2)">
        <div style="font-weight:600;color:#8b5cf6;font-size:12px;margin-bottom:6px">📊 Birleşik Güven</div>
        <div style="font-size:11px;color:var(--text2)">
          Ortalama: <strong>${(stats.dualAnalysis.confidence.averageScore * 100).toFixed(0)}%</strong><br/>
          ${Object.entries(stats.dualAnalysis.confidence.gradeDistribution || {}).map(([g, c]) => `${g}: ${c}`).join(' · ')}
        </div>
      </div>` : ''}
      ${stats.dualAnalysis.geometric ? `
      <div style="padding:10px;background:rgba(14,21,32,0.8);border-radius:6px;border:1px solid rgba(245,158,11,0.2)">
        <div style="font-weight:600;color:#f59e0b;font-size:12px;margin-bottom:6px">📐 Geometrik Karşılaştırma</div>
        <div style="font-size:11px;color:var(--text2)">
          Uyum: <strong>${(stats.dualAnalysis.geometric.averageScore * 100).toFixed(0)}%</strong>
        </div>
      </div>` : ''}
      ${stats.dualAnalysis.fusion ? `
      <div style="padding:10px;background:rgba(14,21,32,0.8);border-radius:6px;border:1px solid rgba(239,68,68,0.2)">
        <div style="font-weight:600;color:#ef4444;font-size:12px;margin-bottom:6px">🔥 Fusion Tespiti</div>
        <div style="font-size:11px;color:var(--text2)">
          Fusion Yapı: ${stats.dualAnalysis.fusion.blobs || 0}<br/>
          CSV Eşleşen: ${stats.dualAnalysis.fusion.matchedWithCsv || 0}<br/>
          Sadece Image: ${stats.dualAnalysis.fusion.uniqueToImage || 0}
        </div>
      </div>` : ''}
    </div>
  </div>` : ''}

  <!-- RENK BAZLI KARŞILAŞTIRMA -->
  ${renderColorComparisonHTML()}

  <!-- FOOTER -->
  <div class="footer">
    <span>© ${now.getFullYear()} Digital Future Tech — Barış Aydemir</span>
    <span class="footer-center">VOTEX 0.3.11 · Tactical Geophysics</span>
    <span>www.digitalfuture.tech</span>
  </div>
</div>

<script>
  // Otomatik odak — kullanıcı Ctrl+P'ye bassın
  window.addEventListener('load', () => {
    document.querySelector('.print-btn')?.focus();
  });
</script>
</body>
</html>`;
}

/**
 * Raporu yeni pencerede aç (PDF için Ctrl+P).
 */
export async function exportReport() {
  const surface = state.surfaceState;
  if (!surface) {
    alert("Önce bir analiz çalıştırın — rapor için veri yok.");
    return;
  }

  const stats = extractStats(surface);
  const scenePNG = captureSceneImage("image/png");

  const html = generateReportHTML(stats, scenePNG);

  // Tauri native save dialog ile kaydet
  try {
    const saved = await saveFileDialog(html, `votex-rapor-${Date.now()}.html`, "HTML Raporu", ["html"]);
    if (saved) {
      console.log("[Export] Rapor kaydedildi:", saved);
    }
  } catch (e) {
    console.warn("[Export] Save dialog hatası, fallback:", e);
    downloadHTML(html, stats);
  }
}

/**
 * Sahne görüntüsünü PNG veya JPEG olarak dışa aktar.
 * Format seçimi basit bir prompt ile yapılır.
 */
export async function exportSceneImage() {
  const surface = state.surfaceState;
  if (!surface) {
    alert("Önce bir analiz çalıştırın.");
    return;
  }

  // Format seçimi
  const formatChoice = prompt(
    "Dışa aktarım formatı seçin:\n\n" +
    "1 — PNG (kaliteli, büyük dosya)\n" +
    "2 — JPEG (hızlı, küçük dosya)\n\n" +
    "Seçiminiz (1 veya 2):",
    "1"
  );

  let format, ext, filterName;
  if (formatChoice === "2") {
    format = "image/jpeg";
    ext = "jpg";
    filterName = "JPEG Görüntüsü";
  } else {
    format = "image/png";
    ext = "png";
    filterName = "PNG Görüntüsü";
  }

  const image = captureSceneImage(format, 0.92);
  if (!image) {
    alert("3D sahne yakalanamadı — sahne yüklü mü?\n\nİpucu: Sahne üzerinde hareket edin (döndür/zoom) ardından tekrar deneyin.");
    return;
  }

  const ts = Date.now();
  try {
    const saved = await saveFileDialog(image, `votex-3d-${ts}.${ext}`, filterName, [ext]);
    if (saved) {
      console.log(`[Export] ${ext.toUpperCase()} kaydedildi:`, saved);
    }
  } catch (e) {
    console.warn(`[Export] ${ext.toUpperCase()} save dialog hatası:`, e);
    alert(`${ext.toUpperCase()} kaydedilemedi: ` + e);
  }
}

/**
 * HTML raporu dosya olarak indir (popup engellendiyse).
 */
function downloadHTML(html, stats) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `votex-rapor-${Date.now()}.html`;
  link.click();
  URL.revokeObjectURL(url);
}
