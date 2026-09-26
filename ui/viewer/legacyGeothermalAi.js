/**
 * Jeotermal proxy haritası için AI / yerel yorum.
 * 3D mesh ve tespitleri değiştirmez; yalnız metin üretir.
 */
import { aiClient } from "../ai/aiClient.js";
import { state } from "../app/state.js";
import { normalizeLegacyResult, mergeLegacyShapes } from "./legacyNormalize.js";

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gridOf(result) {
  const normalized = normalizeLegacyResult(result);
  let w = Math.round(numberOf(normalized.gridW, 0));
  let h = Math.round(numberOf(normalized.gridH, 0));
  let values = Array.isArray(normalized.gridValues) && normalized.gridValues.length >= 4
    ? normalized.gridValues
    : (Array.isArray(normalized.residualPreview) ? normalized.residualPreview : []);
  const coverage = Array.isArray(normalized.gridCoverage) ? normalized.gridCoverage : [];
  if (!Array.isArray(values) || values.length < 4) return null;

  if (w < 2 || h < 2 || values.length !== w * h) {
    const side = Math.round(Math.sqrt(values.length));
    if (side >= 2 && side * side === values.length) {
      w = side;
      h = side;
    } else {
      return null;
    }
  }
  return {
    w,
    h,
    values: values.map(Number),
    coverage: coverage.length === values.length ? coverage.map(Number) : values.map(() => 1),
    result: normalized,
  };
}

/**
 * |σ| proxy özeti — AI bağlamı ve yerel yorum için.
 * @param {object} [result]
 * @param {{ topN?: number, maxDepthM?: number }} [options]
 */
export function buildGeothermalProxySummary(result = state.legacyDikResult, options = {}) {
  const grid = gridOf(result);
  if (!grid) return null;

  const model = state.legacyDikGroup?.userData || {};
  const widthM = Math.max(0.5, numberOf(model.gridWidthM, numberOf(grid.result.gridWidthM, 4)));
  const depthPlanM = Math.max(0.5, numberOf(model.gridDepthM, numberOf(grid.result.gridDepthM, 5)));
  const originX = numberOf(model.gridOriginXM, numberOf(grid.result.gridOriginXM, 0));
  const originZ = numberOf(model.gridOriginZM, numberOf(grid.result.gridOriginYM, 0));
  const maxDepthM = Math.max(1, numberOf(options.maxDepthM, numberOf(model.depthMapM, 10)));
  const topN = Math.max(1, Math.min(8, Math.round(numberOf(options.topN, 5))));

  const candidates = [];
  let measured = 0;
  let sumAbs = 0;
  let maxAbs = 1e-6;
  for (let iy = 0; iy < grid.h; iy += 1) {
    for (let ix = 0; ix < grid.w; ix += 1) {
      const i = iy * grid.w + ix;
      const value = Number(grid.values[i]);
      if (!(Number(grid.coverage[i]) > 0) || !Number.isFinite(value)) continue;
      measured += 1;
      const abs = Math.abs(value);
      sumAbs += abs;
      maxAbs = Math.max(maxAbs, abs);
      candidates.push({ ix, iy, value, abs });
    }
  }
  if (!measured) return null;

  candidates.sort((a, b) => b.abs - a.abs);
  const hotSpots = candidates.slice(0, topN).map((cell, rank) => {
    const xM = originX + ((cell.ix + 0.5) / grid.w) * widthM;
    const zM = originZ + ((cell.iy + 0.5) / grid.h) * depthPlanM;
    const heat01 = clamp(cell.abs / maxAbs, 0, 1);
    return {
      rank: rank + 1,
      xM: Number(xM.toFixed(2)),
      zM: Number(zM.toFixed(2)),
      residual: Number(cell.value.toFixed(2)),
      heatProxy01: Number(heat01.toFixed(3)),
      // Proxy derinlik bandı: güçlü sinyal sığ-orta bandda vurgulanır (ölçüm değil).
      depthBandM: [
        Number((maxDepthM * 0.15).toFixed(2)),
        Number((maxDepthM * 0.55).toFixed(2)),
      ],
    };
  });

  const shapes = mergeLegacyShapes(grid.result).slice(0, 8).map((shape, index) => ({
    id: `detection-${index + 1}`,
    kind: String(shape.kind || "anomaly"),
    cx: Number(numberOf(shape.cx).toFixed(2)),
    cy: Number(numberOf(shape.cy).toFixed(2)),
    depthTopM: Number(numberOf(shape.depthTopM, 0.5).toFixed(2)),
    depthBottomM: Number(numberOf(shape.depthBottomM, 1.5).toFixed(2)),
    peakSigma: Number(numberOf(shape.peakSigma, shape.strength).toFixed(2)),
  }));

  const meanAbs = sumAbs / measured;
  return {
    isThermalProxy: true,
    disclaimer: "Bu skor gerçek sıcaklık (°C) değildir; manyetik residual |σ| tabanlı ısı anomalisi proxy’sidir.",
    gridW: grid.w,
    gridH: grid.h,
    measuredCells: measured,
    maxAbs: Number(maxAbs.toFixed(3)),
    meanAbs: Number(meanAbs.toFixed(3)),
    mapWidthM: Number(widthM.toFixed(2)),
    mapDepthM: Number(depthPlanM.toFixed(2)),
    maxDepthM: Number(maxDepthM.toFixed(2)),
    hotSpots,
    detectionsNearby: shapes,
    fileName: state.legacyDikFileName || null,
  };
}

/**
 * AI sunucusu yokken deterministik yerel yorum.
 * @param {object} summary
 */
export function formatLocalGeothermalInterpretation(summary) {
  if (!summary) return "Jeotermal proxy özeti üretilemedi (grid yok).";
  const lines = [
    "Yerel özet (AI sunucusu yok veya yanıt alınamadı)",
    summary.disclaimer,
    "",
    `Ölçülen hücre: ${summary.measuredCells} · max |σ|: ${summary.maxAbs} · ortalama |σ|: ${summary.meanAbs}`,
    `Saha: ${summary.mapWidthM}×${summary.mapDepthM} m · proxy derinlik tavanı ${summary.maxDepthM} m`,
    "",
    "Sıcak proxy odakları:",
  ];
  summary.hotSpots.forEach((spot) => {
    lines.push(
      `  #${spot.rank} x=${spot.xM} m · z=${spot.zM} m · residual ${spot.residual} · ısı proxy ${Math.round(spot.heatProxy01 * 100)}% · band ${spot.depthBandM[0]}–${spot.depthBandM[1]} m`,
    );
  });
  if (summary.detectionsNearby?.length) {
    lines.push("", "Yakın manyetik tespitler (bağlam; değiştirilmedi):");
    summary.detectionsNearby.slice(0, 5).forEach((d) => {
      lines.push(
        `  ${d.kind} @ (${d.cx}, ${d.cy}) · ${d.depthTopM}–${d.depthBottomM} m · ${d.peakSigma}σ`,
      );
    });
  }
  lines.push(
    "",
    "Öneri: En yüksek ısı proxy noktalarını sahada kontrol edin; sonuçları gerçek termal ölçümle doğrulamadan jeotermal kaynak iddiası yapmayın.",
  );
  return lines.join("\n");
}

function buildPrompt(summary) {
  return [
    "Sen VOTEX saha asistanısın. Aşağıdaki JSON bir JEOTERMAL PROXY özetidir (gerçek °C değil).",
    "Görev: Kısa Türkçe yorum yaz (madde işaretli, max ~12 satır).",
    "Zorunlu: (1) bunun °C olmadığını hatırlat (2) sıcak proxy odaklarını sırala (3) manyetik tespitlerle örtüşme varsa not et (4) saha kontrol önerisi ver.",
    "Tespit ekleme/silme veya sayı uydurma. Sadece verilen özeti yorumla.",
    "",
    JSON.stringify(summary, null, 2),
  ].join("\n");
}

/**
 * AI ile yorumla; başarısızsa yerel özet döner.
 * @param {object} [result]
 * @param {{ topN?: number, forceLocal?: boolean }} [options]
 * @returns {Promise<{ text: string, source: "ai"|"local", summary: object|null, latencyMs?: number }>}
 */
export async function interpretGeothermalWithAi(result = state.legacyDikResult, options = {}) {
  const summary = buildGeothermalProxySummary(result, options);
  if (!summary) {
    return { text: formatLocalGeothermalInterpretation(null), source: "local", summary: null };
  }

  if (options.forceLocal) {
    return { text: formatLocalGeothermalInterpretation(summary), source: "local", summary };
  }

  const started = Date.now();
  try {
    const status = await aiClient.connect();
    if (!status) {
      return { text: formatLocalGeothermalInterpretation(summary), source: "local", summary };
    }
    const response = await aiClient.chat(buildPrompt(summary), "legacy-geothermal-proxy");
    const text = String(response?.text || response?.message || "").trim();
    if (!text) {
      return { text: formatLocalGeothermalInterpretation(summary), source: "local", summary };
    }
    const wrapped = [
      "AI yorumu (jeotermal proxy — gerçek °C değil)",
      summary.disclaimer,
      "",
      text,
    ].join("\n");
    return {
      text: wrapped,
      source: "ai",
      summary,
      latencyMs: Date.now() - started,
      model: response?.model_used || aiClient.preferredModel || null,
    };
  } catch {
    return { text: formatLocalGeothermalInterpretation(summary), source: "local", summary };
  }
}
