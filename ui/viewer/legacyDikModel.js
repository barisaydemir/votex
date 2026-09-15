/**
 * LEGACY3DMAG saha modeli.
 * UI ve 3D katmanı aynı adım/tespit/metre sözleşmesini kullanır.
 * Ham snake_case girişi normalizeLegacyResult ile camelCase'e çevrilir.
 */

import { dimensionsOf, volumeM3Of } from "./volume.js";
import { mergeLegacyShapes, normalizeLegacyResult } from "./legacyNormalize.js";

export { mergeLegacyShapes, normalizeLegacyResult, orderScanStepsLeftFirst } from "./legacyNormalize.js";

export function legacyStepsOf(result) {
  const normalized = result?.scanSteps ? result : normalizeLegacyResult(result);
  const source = Array.isArray(normalized?.scanSteps) ? normalized.scanSteps : [];
  // normalizeLegacyResult zaten orderScanStepsLeftFirst uygular; burada yalnız
  // alanları sayısallaştır. Tekrar sıralama (eski dx/dy) numaraları kaydırıyordu.
  return source.map((step, index) => ({
    ...step,
    index: Number(step.index) || index + 1,
    xStartM: Number(step.xStartM) || 0,
    xEndM: Number(step.xEndM) || 0,
    xCenterM: Number(step.xCenterM) || 0,
    yStartM: Number(step.yStartM) || 0,
    yEndM: Number(step.yEndM) || 0,
    yCenterM: Number(step.yCenterM) || 0,
    widthM: Number(step.widthM) || 0,
    lengthM: Number(step.lengthM) || 0,
    pointCount: Number(step.pointCount) || 0,
    spacingFromPreviousM: Number(step.spacingFromPreviousM) || 0,
  }));
}

export function legacyShapesOf(result) {
  const normalized = result?.shapes ? result : normalizeLegacyResult(result);
  return Array.isArray(normalized.shapes) && normalized.shapes.length
    ? normalized.shapes
    : mergeLegacyShapes(normalized);
}

function strengthOf(shape) {
  return Number(shape?.peakSigma ?? shape?.strength) || 0;
}

function confidenceOf(shape) {
  const value = Number(shape?.confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function pointOfStep(step) {
  return { x: step.xCenterM, y: step.yCenterM };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function stationRanges(steps) {
  const stations = [];
  let station = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (i > 0) station += distance(pointOfStep(steps[i - 1]), pointOfStep(steps[i]));
    stations.push(station);
  }
  return stations.map((center, i) => {
    const previous = i > 0 ? (center + stations[i - 1]) * 0.5 : 0;
    const next = i < stations.length - 1
      ? (center + stations[i + 1]) * 0.5
      : center + Math.max(steps[i].lengthM, steps[i].widthM, 0.01) * 0.5;
    return { centerM: center, startM: previous, endM: Math.max(next, previous) };
  });
}

function pointToSegmentDistance(point, step) {
  const ax = Number(step.xStartM);
  const ay = Number(step.yStartM);
  const bx = Number(step.xEndM);
  const by = Number(step.yEndM);
  const px = Number(point.x);
  const py = Number(point.y);
  if (![ax, ay, bx, by, px, py].every(Number.isFinite)) {
    return distance(point, pointOfStep(step));
  }
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return distance(point, { x: ax, y: ay });
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return distance(point, { x: ax + t * abx, y: ay + t * aby });
}

function nearestStep(shape, steps, stations) {
  if (!steps.length) return { step: null, stepPosition: null, distanceM: Infinity };
  const point = { x: Number(shape?.cx), y: Number(shape?.cy) };
  let best = null;
  steps.forEach((step, index) => {
    const center = pointOfStep(step);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
    // Önce tarama segmentine uzaklık; eşitlikte merkez — uzun geçişlerde doğru adım.
    const segmentDistance = pointToSegmentDistance(point, step);
    const centerDistance = distance(point, center);
    const better = !best
      || segmentDistance < best.distanceM - 1e-9
      || (Math.abs(segmentDistance - best.distanceM) <= 1e-9 && centerDistance < best.centerDistance);
    if (better) {
      best = {
        step,
        stepPosition: stations[index],
        distanceM: segmentDistance,
        centerDistance,
        index,
      };
    }
  });
  return best || { step: steps[0], stepPosition: stations[0], distanceM: Infinity, index: 0 };
}

function signedOffset(shape, step) {
  if (!step) return 0;
  const px = Number(shape?.cx) - step.xCenterM;
  const py = Number(shape?.cy) - step.yCenterM;
  const dx = step.xEndM - step.xStartM;
  const dy = step.yEndM - step.yStartM;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return Math.hypot(px, py);
  return (-dy * px + dx * py) / length;
}

function depthRange(shape) {
  const top = Number(shape?.depthTopM);
  const bottom = Number(shape?.depthBottomM);
  const safeTop = Number.isFinite(top) ? Math.max(0, top) : 0;
  const safeBottom = Number.isFinite(bottom) && bottom >= safeTop ? bottom : safeTop;
  return { topM: safeTop, bottomM: safeBottom };
}

function typeLabel(shape) {
  const kind = String(shape?.kind || "anomaly").toLowerCase();
  if (kind === "metal") return "Metal anomali adayı";
  if (kind === "tunnel") return "Uzun anomali adayı";
  if (kind === "room" || kind === "shaft") return "Kompakt anomali adayı";
  return "Anomali / boşluk adayı";
}

function statusOf(shape) {
  const confidence = confidenceOf(shape);
  const strength = strengthOf(shape);
  if (confidence >= 0.8 || strength >= 3) return "strong";
  if (confidence >= 0.55 || strength >= 2) return "attention";
  return "normal";
}

function recommendationOf(shape, detection) {
  const depth = detection.depthTopM;
  const status = detection.status;
  if (status === "strong") {
    return `Adım ${detection.stepIndex} çevresinde ${Math.max(2, Number(shape?.rx) * 4 || 3).toFixed(1)} m × ${Math.max(2, Number(shape?.ry) * 4 || 3).toFixed(1)} m doğrulama taraması önerilir.`;
  }
  if (depth > 2) return "Daha derin hedef; ikinci yönde çapraz tarama ve kontrollü doğrulama önerilir.";
  return "Komşu adımlardan çapraz ölçüm alın; tek başına kazı kararı vermeyin.";
}

export function buildLegacyFieldModel(result) {
  const normalized = normalizeLegacyResult(result);
  const steps = legacyStepsOf(normalized);
  const ranges = stationRanges(steps);
  const stepByIndex = new Map(steps.map((step, index) => [step.index, { step, range: ranges[index] }]));
  const detections = legacyShapesOf(normalized).map((shape, index) => {
    const nearest = nearestStep(shape, steps, ranges);
    const step = nearest.step;
    const range = nearest.stepPosition || { centerM: 0, startM: 0, endM: 0 };
    const depth = depthRange(shape);
    const dimensions = dimensionsOf(shape, { height: Math.max(depth.bottomM - depth.topM, 0.2) });
    const volumeM3 = volumeM3Of(shape, {
      mapWidthM: Number(normalized.gridWidthM ?? normalized.meta?.xMeters) || dimensions.width,
      mapDepthM: Number(normalized.gridDepthM ?? normalized.meta?.yMeters) || dimensions.length,
      height: dimensions.height,
    });
    const detection = {
      detectionId: `legacy-dik-shape-${index + 1}`,
      stepIndex: step?.index ?? null,
      stationM: range.centerM,
      offsetM: signedOffset(shape, step),
      depthTopM: depth.topM,
      depthBottomM: depth.bottomM,
      dimensions,
      volumeM3,
      type: typeLabel(shape),
      confidence: confidenceOf(shape),
      strength: strengthOf(shape),
      polarity: Number(shape?.polarity),
      status: statusOf(shape),
      geometry: shape.shapeType || "irregular",
      evidence: {
        source: shape.shapeSource || "inferred",
        shapeConfidence: Number(shape.shapeConfidence) || 0,
        shapeFitError: Number(shape.shapeFitError) || 0,
      },
      recommendation: "",
      raw: shape,
    };
    detection.magneticResponse = magneticResponseOf(detection);
    detection.recommendation = recommendationOf(shape, detection);
    return detection;
  });
  const modelSteps = steps.map((step, index) => {
    const range = ranges[index] || { centerM: 0, startM: 0, endM: 0 };
    const stepDetections = detections.filter((detection) => detection.stepIndex === step.index);
    const strongest = stepDetections[0];
    return {
      stepIndex: step.index,
      stationM: range.centerM,
      centerM: range.centerM,
      startM: range.startM,
      endM: range.endM,
      widthM: step.widthM,
      anomalyCount: stepDetections.length,
      status: strongest?.status || "normal",
      detections: stepDetections,
      raw: step,
    };
  });
  const scale = residualScaleOf(normalized);
  return { steps: modelSteps, detections, stepByIndex, result: normalized, residualScale: scale };
}

export function matchesLegacyListFilter(filter, item = {}) {
  const normalized = String(filter || "all").toLowerCase();
  if (normalized === "all") return true;
  if (normalized === "detections") return !!item.isDetection || Number(item.anomalyCount) > 0;
  return normalized === String(item.status || "normal").toLowerCase();
}

export function statusLabel(status) {
  return status === "strong" ? "GÜÇLÜ" : status === "attention" ? "DİKKAT" : "NORMAL";
}

/**
 * Grid residual max |değer| — lejant ölçeği.
 * gridValues ham residual'dır; magSigma varsa σ'ya çevrilir. Kalibre nT değildir.
 */
export function residualScaleOf(result) {
  const normalized = result?.gridValues || result?.residualPreview || result?.magSigma != null
    ? result
    : normalizeLegacyResult(result);
  const values = Array.isArray(normalized?.gridValues) && normalized.gridValues.length
    ? normalized.gridValues
    : (Array.isArray(normalized?.residualPreview) ? normalized.residualPreview : []);
  let maxAbs = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.abs(Number(values[i]));
    if (Number.isFinite(v) && v > maxAbs) maxAbs = v;
  }
  if (!(maxAbs > 0)) return null;
  const magSigma = Number(normalized?.magSigma);
  const maxAbsSigma = Number.isFinite(magSigma) && magSigma > 1e-6 ? maxAbs / magSigma : null;
  if (maxAbsSigma != null) {
    return {
      maxAbs,
      maxAbsSigma,
      unit: "σ",
      note: "residual / magSigma · kalibre nT değil",
      display: `Ölçek ~${maxAbsSigma.toFixed(2)} σ (residual/magSigma)`,
    };
  }
  return {
    maxAbs,
    maxAbsSigma: null,
    unit: "residual",
    note: "ham residual · σ’ya bölünmedi · kalibre nT değil",
    display: `Ölçek ~${maxAbs.toFixed(2)} residual (σ değil · nT değil)`,
  };
}

/**
 * Kutup + güçten manyetik tepki yorumu.
 * χ ölçülmez; ferromanyetik/diyamanyetik teşhis değildir.
 */
export function magneticResponseOf(source = {}) {
  const shape = source?.raw && typeof source.raw === "object" ? source.raw : source;
  const kindRaw = String(shape?.kind || source?.type || "").toLowerCase();
  const isMetal = kindRaw.includes("metal");
  const polarity = Number(shape?.polarity ?? source?.polarity);
  const strength = Number(source?.strength ?? shape?.peakSigma ?? shape?.strength) || 0;
  const disclaimer = "χ ölçülmedi · malzeme kimliği değil";

  let classId = "uncertain";
  let label = "Belirsiz manyetik tepki";
  if (isMetal && strength >= 1.15 && (!Number.isFinite(polarity) || polarity >= 0)) {
    classId = "metal_like_positive";
    label = "Güçlü pozitif (metal-benzeri)";
  } else if (Number.isFinite(polarity) && polarity < 0 && strength >= 1.0) {
    classId = "void_like_negative";
    label = "Negatif residual (boşluk-benzeri)";
  } else if (Number.isFinite(polarity) && polarity > 0 && strength >= 1.5) {
    classId = "positive_residual";
    label = "Pozitif residual tepki";
  }

  return {
    classId,
    label,
    disclaimer,
    line: `${label} · ${disclaimer}`,
    polarity: Number.isFinite(polarity) ? polarity : null,
    strength,
  };
}

export function formatLegacyFieldLine(detection) {
  const offset = detection.offsetM >= 0 ? `+${detection.offsetM.toFixed(2)}` : detection.offsetM.toFixed(2);
  return `Adım ${detection.stepIndex ?? "—"} · ${detection.stationM.toFixed(2)} m · ${detection.type} · ${detection.depthTopM.toFixed(2)}–${detection.depthBottomM.toFixed(2)} m · %${Math.round(detection.confidence * 100)} güven · offset ${offset} m`;
}

/**
 * Seçili bulgu için sade saha özeti (ekran / PDF / kopyala).
 * Hesap sonucunu değiştirmez.
 */
export function buildLegacyFieldBrief(detection) {
  if (!detection) return null;
  const confPct = Math.round((Number(detection.confidence) || 0) * 100);
  const confWord = confPct >= 70 ? "yüksek" : confPct >= 45 ? "orta" : "düşük";
  const strength = Number(detection.strength) || 0;
  const strengthWord = strength >= 3 ? "çok belirgin" : strength >= 1.5 ? "belirgin" : "zayıf";
  const sigmaText = strength > 0 ? `${strength.toFixed(1)}σ` : "—";
  const w = Number(detection.dimensions?.width) || 0;
  const l = Number(detection.dimensions?.length) || 0;
  const h = Number(detection.dimensions?.height) || Math.max(0.2, detection.depthBottomM - detection.depthTopM);
  const volume = Number(detection.volumeM3);
  const mag = detection.magneticResponse || magneticResponseOf(detection);
  const lines = [
    `${detection.type || "Bulgu"} · ${statusLabel(detection.status)}`,
    `Ne kadar derin: ${detection.depthTopM.toFixed(2)}–${detection.depthBottomM.toFixed(2)} m`,
    `Haritada nerede: Adım ${detection.stepIndex ?? "—"} · hat ${Number(detection.stationM || 0).toFixed(2)} m`,
    `Yaklaşık boyut: ${w.toFixed(2)} × ${l.toFixed(2)} × ${h.toFixed(2)} m${Number.isFinite(volume) ? ` · ~${volume.toFixed(2)} m³` : ""}`,
    `Ne kadar net: ${strengthWord} · güven ${confWord} (%${confPct}) · ${sigmaText}`,
    `Manyetik tepki: ${mag.line}`,
  ];
  if (detection.recommendation) lines.push(`Öneri: ${detection.recommendation}`);
  return {
    detectionId: detection.detectionId,
    title: lines[0],
    lines,
    plainText: lines.join("\n"),
  };
}

export function formatLegacyFieldBriefHtml(brief) {
  if (!brief) return "";
  const body = brief.lines
    .slice(1)
    .map((line) => `<div class="legacy-saha-brief-line">${escapeLegacyHtml(line)}</div>`)
    .join("");
  return `<div class="legacy-saha-brief-title">${escapeLegacyHtml(brief.title)}</div>${body}`;
}

/** HTML etiket kaçışı — panel ve rapor ortak kullanır. */
export function escapeLegacyHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
