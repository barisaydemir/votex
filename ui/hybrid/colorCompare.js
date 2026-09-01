/**
 * colorCompare.js — Renk-Bazlı Analiz Karşılaştırması
 *
 * İki analiz sonucunu (orijinal vs renkli) karşılaştırır:
 *   - Bulunan yapı sayıları (oda, tünel, metal)
 *   - Güven skorları değişimi
 *   - Yeni kaybolan tespitler
 *   - Fusion grid farkları
 *
 * Kullanım:
 *   import { compareResults, formatComparison } from "./colorCompare.js";
 *   const diff = compareResults(originalResult, colorResult);
 *   console.log(formatComparison(diff));
 */
import { PALETTES } from "../viewer/colorizer.js";

/* ── Karşılaştırma Motoru ────────────────────────────── */

/**
 * İki analiz sonucunu karşılaştır.
 * @param {Object} original — orijinal (renksiz) analiz sonucu
 * @param {Object} colored — renkli analiz sonucu
 * @returns {Object} karşılaştırma sonucu
 */
export function compareResults(original, colored) {
  if (!original || !colored) {
    return {
      valid: false,
      error: !original ? "Orijinal sonuç yok" : "Renkli sonuç yok",
    };
  }

  const diff = {
    valid: true,
    timestamp: Date.now(),

    // Yapı sayıları
    structures: compareStructures(original, colored),

    // Güven skorları
    confidence: compareConfidence(original, colored),

    // Tespit farkları
    detections: compareDetections(original, colored),

    // Özet
    summary: null,
  };

  diff.summary = buildSummary(diff);
  return diff;
}

/**
 * Yapı sayılarını karşılaştır.
 */
function compareStructures(original, colored) {
  const oStructs = extractStructures(original);
  const cStructs = extractStructures(colored);

  return {
    original: oStructs,
    colored: cStructs,
    delta: {
      chambers: cStructs.chambers - oStructs.chambers,
      tunnels: cStructs.tunnels - oStructs.tunnels,
      metals: cStructs.metals - oStructs.metals,
      total: cStructs.total - oStructs.total,
    },
  };
}

/**
 * Analiz sonucundan yapı sayılarını çıkar.
 */
function extractStructures(result) {
  const structs = result.structures || {};
  const chambers = (structs.chambers || []).length;
  const tunnels = (structs.tunnels || []).length;
  const metals = (structs.metals || []).length;
  return {
    chambers,
    tunnels,
    metals,
    total: chambers + tunnels + metals,
  };
}

/**
 * Güven skorlarını karşılaştır.
 */
function compareConfidence(original, colored) {
  const oConf = extractConfidences(original);
  const cConf = extractConfidences(colored);

  return {
    original: oConf,
    colored: cConf,
    delta: {
      avgConfidence: cConf.avg - oConf.avg,
      minConfidence: cConf.min - oConf.min,
      maxConfidence: cConf.max - oConf.max,
    },
  };
}

/**
 * Analiz sonucundan güven skorlarını çıkar.
 */
function extractConfidences(result) {
  const scores = [];
  const structs = result.structures || {};

  for (const list of [structs.chambers, structs.tunnels, structs.metals]) {
    if (!list) continue;
    for (const s of list) {
      if (typeof s.confidence === "number") scores.push(s.confidence);
      else if (typeof s.score === "number") scores.push(s.score);
    }
  }

  if (scores.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };

  return {
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores),
    count: scores.length,
  };
}

/**
 * Tespit farklarını karşılaştır (eşleşen / yeni / kaybolan).
 */
function compareDetections(original, colored) {
  const oDets = extractDetectionIds(original);
  const cDets = extractDetectionIds(colored);

  const oSet = new Set(oDets.map((d) => d.id));
  const cSet = new Set(cDets.map((d) => d.id));

  const matched = oDets.filter((d) => cSet.has(d.id));
  const lost = oDets.filter((d) => !cSet.has(d.id));
  const gained = cDets.filter((d) => !oSet.has(d.id));

  return {
    originalCount: oDets.length,
    coloredCount: cDets.length,
    matched: matched.length,
    lost: lost.map((d) => ({ id: d.id, type: d.type, label: d.label })),
    gained: gained.map((d) => ({ id: d.id, type: d.type, label: d.label })),
  };
}

/**
 * Analiz sonucundan tespit ID'lerini çıkar.
 */
function extractDetectionIds(result) {
  const dets = [];
  const structs = result.structures || {};

  let idx = 0;
  for (const [type, list] of Object.entries(structs)) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      dets.push({
        id: s.id || `${type}-${idx}`,
        type,
        label: s.label || s.kind || type,
        confidence: s.confidence || s.score || 0,
      });
      idx++;
    }
  }

  return dets;
}

/**
 * İnsan-okunabilir özet oluştur.
 */
function buildSummary(diff) {
  if (!diff.valid) return diff.error;

  const s = diff.structures.delta;
  const c = diff.confidence.delta;
  const d = diff.detections;

  const lines = [];

  // Yapı değişimleri
  if (s.total === 0) {
    lines.push("Yapı sayısı değişmedi");
  } else {
    if (s.chambers !== 0)
      lines.push(
        `Oda: ${s.chambers > 0 ? "+" : ""}${s.chambers}`
      );
    if (s.tunnels !== 0)
      lines.push(
        `Tünel: ${s.tunnels > 0 ? "+" : ""}${s.tunnels}`
      );
    if (s.metals !== 0)
      lines.push(
        `Metal: ${s.metals > 0 ? "+" : ""}${s.metals}`
      );
  }

  // Güven değişimi
  if (Math.abs(c.avgConfidence) > 0.01) {
    lines.push(
      `Ort. güven: ${c.avgConfidence > 0 ? "+" : ""}${(
        c.avgConfidence * 100
      ).toFixed(1)}%`
    );
  }

  // Tespit farkları
  if (d.lost.length > 0) {
    lines.push(`${d.lost.length} tespit kayboldu`);
  }
  if (d.gained.length > 0) {
    lines.push(`${d.gained.length} yeni tespit`);
  }

  return lines.length > 0 ? lines.join(" · ") : "Fark yok";
}

/* ── Formatlama ──────────────────────────────────────── */

/**
 * Karşılaştırma sonucunu HTML formatında göster.
 * @param {Object} diff — compareResults sonucu
 * @param {string} [paletteKey] — renk şeması adı
 * @returns {string} HTML
 */
export function formatComparison(diff, paletteKey) {
  if (!diff.valid) {
    return `<div class="compare-error">${diff.error}</div>`;
  }

  const palLabel = PALETTES[paletteKey]?.label || paletteKey || "—";
  const s = diff.structures;
  const c = diff.confidence;
  const d = diff.detections;

  const deltaColor = (val) =>
    val > 0 ? "#3edc8c" : val < 0 ? "#ff6a4a" : "#888";
  const deltaStr = (val) =>
    val > 0 ? `+${val}` : val < 0 ? `${val}` : "0";

  return `
    <div class="color-compare" style="font-size:0.8rem;margin:0.5rem 0;">
      <div style="font-weight:600;margin-bottom:0.3rem;color:#4a9eff;">
        📊 Karşılaştırma: ${palLabel}
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <td style="padding:0.2rem 0;color:#888;">Yapı</td>
          <td style="padding:0.2rem 0;text-align:right;">Orijinal</td>
          <td style="padding:0.2rem 0;text-align:right;">Renkli</td>
          <td style="padding:0.2rem 0;text-align:right;">Fark</td>
        </tr>
        <tr>
          <td style="padding:0.15rem 0;">Oda</td>
          <td style="text-align:right;">${s.original.chambers}</td>
          <td style="text-align:right;">${s.colored.chambers}</td>
          <td style="text-align:right;color:${deltaColor(s.delta.chambers)}">${deltaStr(s.delta.chambers)}</td>
        </tr>
        <tr>
          <td style="padding:0.15rem 0;">Tünel</td>
          <td style="text-align:right;">${s.original.tunnels}</td>
          <td style="text-align:right;">${s.colored.tunnels}</td>
          <td style="text-align:right;color:${deltaColor(s.delta.tunnels)}">${deltaStr(s.delta.tunnels)}</td>
        </tr>
        <tr>
          <td style="padding:0.15rem 0;">Metal</td>
          <td style="text-align:right;">${s.original.metals}</td>
          <td style="text-align:right;">${s.colored.metals}</td>
          <td style="text-align:right;color:${deltaColor(s.delta.metals)}">${deltaStr(s.delta.metals)}</td>
        </tr>
        <tr style="border-top:1px solid rgba(255,255,255,0.15);font-weight:600;">
          <td style="padding:0.2rem 0;">Toplam</td>
          <td style="text-align:right;">${s.original.total}</td>
          <td style="text-align:right;">${s.colored.total}</td>
          <td style="text-align:right;color:${deltaColor(s.delta.total)}">${deltaStr(s.delta.total)}</td>
        </tr>
      </table>

      <div style="margin-top:0.3rem;font-size:0.7rem;opacity:0.7;">
        Ort. güven: ${(c.original.avg * 100).toFixed(0)}% → ${(c.colored.avg * 100).toFixed(0)}%
        (${c.delta.avgConfidence > 0 ? "+" : ""}${(c.delta.avgConfidence * 100).toFixed(1)}%)
      </div>

      ${
        d.lost.length > 0
          ? `<div style="margin-top:0.2rem;font-size:0.7rem;color:#ff6a4a;">
              ❌ Kaybolan: ${d.lost.map((l) => l.label || l.id).join(", ")}
            </div>`
          : ""
      }
      ${
        d.gained.length > 0
          ? `<div style="margin-top:0.2rem;font-size:0.7rem;color:#3edc8c;">
              ✅ Yeni: ${d.gained.map((g) => g.label || g.id).join(", ")}
            </div>`
          : ""
      }
    </div>
  `;
}

/**
 * Karşılaştırma sonucunu düz metin olarak formatla.
 * @param {Object} diff
 * @param {string} [paletteKey]
 * @returns {string}
 */
export function formatComparisonText(diff, paletteKey) {
  if (!diff.valid) return `Hata: ${diff.error}`;

  const palLabel = PALETTES[paletteKey]?.label || paletteKey || "—";
  const s = diff.structures;
  const c = diff.confidence;

  return [
    `Karşılaştırma: ${palLabel}`,
    `Yapılar: ${s.original.total} → ${s.colored.total} (${s.delta.total >= 0 ? "+" : ""}${s.delta.total})`,
    `Ort. güven: ${(c.original.avg * 100).toFixed(0)}% → ${(c.colored.avg * 100).toFixed(0)}%`,
    `Özet: ${diff.summary}`,
  ].join("\n");
}
