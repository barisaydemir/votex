/**
 * Birleşik hedef modeli.
 * Ham detection kayıtlarını silmez; yalnızca aynı fiziksel hedef için bir üst
 * sunum katmanı üretir.
 */

export const LEGACY_MERGE_POLICY = Object.freeze({
  positionToleranceM: 1.25,
  depthToleranceM: 0.75,
  horizontalGapToleranceM: 0.35,
  connectorWidthRatio: 0.65,
});

/** Hazır profiller: kullanıcıya sayı kalabalığı vermeden birleşme duyarlılığını seçtirir. */
export const LEGACY_MERGE_PROFILES = Object.freeze({
  cautious: Object.freeze({ positionToleranceM: 0.75, depthToleranceM: 0.5, horizontalGapToleranceM: 0.05 }),
  normal: Object.freeze({}),
  research: Object.freeze({ positionToleranceM: 1.75, depthToleranceM: 1, horizontalGapToleranceM: 0.6 }),
});

export function mergePolicyOf(options = {}) {
  const profile = String(options?.mergeProfile || "normal");
  const profileValues = LEGACY_MERGE_PROFILES[profile] || LEGACY_MERGE_PROFILES.normal;
  return { ...LEGACY_MERGE_POLICY, ...profileValues, ...(options || {}) };
}

function pointOf(detection) {
  const raw = detection?.raw || {};
  const x = Number(raw.cx ?? detection?.stationM);
  const y = Number(raw.cy ?? detection?.offsetM);
  return { x: Number.isFinite(x) ? x : Number(detection?.stationM) || 0, y: Number.isFinite(y) ? y : Number(detection?.offsetM) || 0 };
}

function distance(a, b) {
  const pa = pointOf(a);
  const pb = pointOf(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function depthGap(a, b) {
  const top = Math.max(Number(a?.depthTopM) || 0, Number(b?.depthTopM) || 0);
  const bottom = Math.min(Number(a?.depthBottomM) || top, Number(b?.depthBottomM) || top);
  return Math.max(0, top - bottom);
}

function kindOf(detection) {
  const raw = String(detection?.raw?.kind || detection?.type || "anomaly").toLowerCase();
  if (raw.includes("metal")) return "metal";
  if (raw.includes("room") || raw.includes("shaft")) return "void";
  if (raw.includes("tunnel")) return "tunnel";
  return "anomaly";
}

function compatibleKinds(a, b) {
  const left = kindOf(a);
  const right = kindOf(b);
  if (left === right || left === "anomaly" || right === "anomaly") return true;
  return false;
}

function footprintOf(detection) {
  const raw = detection?.raw || {};
  const measured = detection?.dimensions || {};
  const width = Number(raw.widthM ?? detection?.widthM ?? measured.width ?? (Number(raw.rx) || 0) * 2);
  const length = Number(raw.lengthM ?? detection?.lengthM ?? measured.length ?? (Number(raw.ry) || 0) * 2);
  return {
    x: Math.max(Number.isFinite(width) && width > 0 ? width * 0.5 : 0.12, 0.12),
    y: Math.max(Number.isFinite(length) && length > 0 ? length * 0.5 : 0.12, 0.12),
  };
}

/**
 * Two evidence footprints can belong to one horizontal object even when their
 * centers are more than the old point tolerance apart. This measures the gap
 * between their axis-aligned footprints, so touching/overlapping cells connect.
 */
function horizontalFootprintGap(a, b) {
  const left = pointOf(a);
  const right = pointOf(b);
  const leftSize = footprintOf(a);
  const rightSize = footprintOf(b);
  const gapX = Math.max(0, Math.abs(left.x - right.x) - leftSize.x - rightSize.x);
  const gapY = Math.max(0, Math.abs(left.y - right.y) - leftSize.y - rightSize.y);
  return Math.max(gapX, gapY);
}

function canMerge(a, b, options) {
  const centersAreClose = distance(a, b) <= options.positionToleranceM;
  const footprintsTouch = horizontalFootprintGap(a, b) <= options.horizontalGapToleranceM;
  return (centersAreClose || footprintsTouch)
    && depthGap(a, b) <= options.depthToleranceM
    && compatibleKinds(a, b);
}

function weightedAverage(items, field, fallback = 0) {
  let total = 0;
  let weight = 0;
  for (const item of items) {
    const value = Number(item?.[field]);
    if (!Number.isFinite(value)) continue;
    const w = Math.max(Number(item?.confidence) || 0.1, 0.1);
    total += value * w;
    weight += w;
  }
  return weight ? total / weight : fallback;
}

function evidenceQualityOf(items, spread, connectorCount) {
  if (items.length < 2) return "single";
  if (connectorCount > 0 && spread <= 0.5) return "high";
  if (connectorCount > 0 || spread <= 1.25) return "medium";
  return "low";
}

/**
 * Birleşik hedefin ham kanıtlarını tarama sırasına göre okunabilir zaman
 * çizelgesine çevirir. Her satır tek bir ölçüm kanıtını temsil eder; birleşik
 * güveni geriye dönük dağıtmaz.
 */
export function buildLegacyTargetTimeline(target) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  return evidence
    .map((item, index) => {
      const analysis = item?.analysisEvidence;
      const confidence = analysis?.metrics?.anomalyConfidence?.value != null
        ? Number(analysis.metrics.anomalyConfidence.value)
        : Math.round((Number(item?.confidence) || 0) * 100);
      const depthTopM = Number(item?.depthTopM);
      const depthBottomM = Number(item?.depthBottomM ?? item?.depthTopM);
      const signal = analysis?.metrics?.signalStrength?.value != null
        ? Number(analysis.metrics.signalStrength.value)
        : null;
      return {
        order: index + 1,
        detectionId: String(item?.detectionId || ""),
        stepIndex: Number.isFinite(Number(item?.stepIndex)) ? Number(item.stepIndex) : null,
        confidencePct: Math.max(0, Math.min(100, Math.round(confidence))),
        depthTopM: Number.isFinite(depthTopM) ? depthTopM : null,
        depthBottomM: Number.isFinite(depthBottomM) ? depthBottomM : null,
        signalPct: Number.isFinite(signal) ? Math.max(0, Math.min(100, Math.round(signal))) : null,
        stationM: Number.isFinite(Number(item?.stationM)) ? Number(item.stationM) : null,
      };
    })
    .sort((a, b) => (a.stepIndex ?? Number.MAX_SAFE_INTEGER) - (b.stepIndex ?? Number.MAX_SAFE_INTEGER));
}

/** SVG için güvenli, sabit ölçekli güven trendi verisi üretir. */
export function buildLegacyTargetConfidenceChart(timeline, options = {}) {
  const rows = (Array.isArray(timeline) ? timeline : [])
    .filter((item) => Number.isFinite(Number(item?.confidencePct)));
  const width = Math.max(160, Number(options.width) || 280);
  const height = Math.max(56, Number(options.height) || 86);
  const padding = 12;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const points = rows.map((item, index) => {
    const x = rows.length <= 1 ? width / 2 : padding + (index / (rows.length - 1)) * innerWidth;
    const confidencePct = Math.max(0, Math.min(100, Number(item.confidencePct)));
    const y = padding + ((100 - confidencePct) / 100) * innerHeight;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), stepIndex: item.stepIndex, confidencePct };
  });
  const first = rows[0]?.confidencePct;
  const last = rows[rows.length - 1]?.confidencePct;
  return {
    width,
    height,
    points,
    polyline: points.map((point) => `${point.x},${point.y}`).join(" "),
    firstPct: first == null ? null : Number(first),
    lastPct: last == null ? null : Number(last),
    deltaPct: first == null || last == null ? null : Number(last) - Number(first),
    minPct: rows.length ? Math.min(...rows.map((item) => Number(item.confidencePct))) : null,
    maxPct: rows.length ? Math.max(...rows.map((item) => Number(item.confidencePct))) : null,
  };
}

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function detectionPointOf(detection) {
  const raw = detection?.raw || {};
  const x = Number(raw.cx ?? detection?.stationM);
  const y = Number(raw.cy ?? detection?.offsetM);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function detectionDepthRangeOf(detection) {
  const top = Number(detection?.depthTopM);
  const bottom = Number(detection?.depthBottomM ?? detection?.depthTopM);
  const safeTop = Number.isFinite(top) ? Math.max(0, top) : null;
  const safeBottom = Number.isFinite(bottom) ? Math.max(safeTop ?? 0, bottom) : safeTop;
  return { top: safeTop, bottom: safeBottom };
}

function depthOverlapScoreOf(left, right) {
  const a = detectionDepthRangeOf(left);
  const b = detectionDepthRangeOf(right);
  if (a.top == null || a.bottom == null || b.top == null || b.bottom == null) return 0.5;
  const intersection = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const union = Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top);
  return union > 0 ? intersection / union : 0;
}

function relationKindOf(detection) {
  const raw = String(detection?.raw?.kind || detection?.type || "anomaly").toLowerCase();
  if (raw.includes("metal")) return "metal";
  if (raw.includes("room") || raw.includes("shaft") || raw.includes("void")) return "void";
  if (raw.includes("tunnel")) return "tunnel";
  return "anomaly";
}

function lateralResponseRadiusMOf(detection, options = {}) {
  const range = detectionDepthRangeOf(detection);
  const midpoint = range.top != null && range.bottom != null
    ? (range.top + range.bottom) * 0.5
    : 1;
  const depthScale = Math.max(0.75, Math.min(1.33, Number(options.lateralDepthScale) || 1));
  const calibratedMidpoint = midpoint * depthScale;
  const sensorHeightM = Math.max(0, Math.min(0.2, Number(options.sensorHeightM ?? 0.1)));
  const baseRadiusM = Math.max(0.12, Number(options.baseResponseRadiusM) || 0.18);
  const spreadFactor = Math.max(0.05, Number(options.lateralSpreadFactor) || 0.35);
  const maxRadiusM = Math.max(baseRadiusM, Number(options.maxResponseRadiusM) || 2.5);
  return Math.min(maxRadiusM, baseRadiusM + sensorHeightM * 0.5 + calibratedMidpoint * spreadFactor);
}

function medianOf(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

/**
 * Converts 1 m saha kazığı okumalarını into a bounded depth scale used only
 * for lateral-response scoring. It never changes measured footprints or the
 * displayed object depth; the median keeps one bad reading from dominating.
 */
export function lateralCalibrationOf(options = {}) {
  const readings = (Array.isArray(options.fieldCalibrationReadings) ? options.fieldCalibrationReadings : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const referenceM = Number(options.fieldCalibrationReferenceM);
  const referenceDepthM = Number.isFinite(referenceM) && referenceM > 0 ? referenceM : 1;
  const afterM = Number(options.fieldCalibrationAfterM);
  const restoredObservedM = Number(options.fieldCalibrationObservedM);
  const observedM = Number.isFinite(restoredObservedM) && restoredObservedM > 0
    ? restoredObservedM
    : Number.isFinite(afterM) && afterM > 0
      ? afterM
      : medianOf(readings);
  if (!(observedM > 0)) {
    return {
      applied: false,
      readingCount: 0,
      referenceDepthM,
      observedM: null,
      depthScale: 1,
      quality: "none",
      scoreAdjustment: "none",
    };
  }
  const rawScale = referenceDepthM / observedM;
  const restoredDepthScale = Number(options.fieldCalibrationDepthScale);
  const depthScale = Number.isFinite(restoredDepthScale) && restoredDepthScale > 0
    ? Math.max(0.75, Math.min(1.33, restoredDepthScale))
    : Math.max(0.75, Math.min(1.33, rawScale));
  const quality = readings.length >= 3
    ? "repeatable"
    : readings.length === 2
      ? "limited-repeat"
      : readings.length === 1
        ? "single-read"
        : "after-reanalysis";
  return {
    applied: true,
    readingCount: readings.length,
    referenceDepthM,
    observedM,
    rawDepthScale: rawScale,
    depthScale,
    quality,
    scoreAdjustment: depthScale === rawScale ? "bounded" : "clamped",
  };
}

function signalSimilarityOf(left, right) {
  const values = [left?.strength, right?.strength]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) return 0.5;
  return 0.5 + 0.5 * (Math.min(...values) / Math.max(...values));
}

/**
 * Produces explanatory relationships without changing merged-target grouping.
 * The radius is a depth-dependent sensor-response proxy, not an object size.
 */
export function buildLegacyEvidenceRelations(detections, options = {}) {
  const source = Array.isArray(detections) ? detections.filter(Boolean) : [];
  const calibration = options.lateralCalibration?.applied
    ? options.lateralCalibration
    : lateralCalibrationOf(options);
  const scoringOptions = {
    ...options,
    lateralDepthScale: calibration.depthScale,
  };
  const maxStepGap = Math.max(1, Math.round(Number(options.maxStepGap) || 2));
  const relations = [];

  for (let leftIndex = 0; leftIndex < source.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < source.length; rightIndex += 1) {
      const left = source[leftIndex];
      const right = source[rightIndex];
      const leftStep = Number(left?.stepIndex);
      const rightStep = Number(right?.stepIndex);
      if (!Number.isFinite(leftStep) || !Number.isFinite(rightStep)) continue;
      const stepGap = Math.abs(leftStep - rightStep);
      if (stepGap < 1 || stepGap > maxStepGap) continue;

      const leftKind = relationKindOf(left);
      const rightKind = relationKindOf(right);
      if (leftKind !== rightKind && leftKind !== "anomaly" && rightKind !== "anomaly") continue;

      const leftPoint = detectionPointOf(left);
      const rightPoint = detectionPointOf(right);
      const distanceM = Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y);
      const uncalibratedLeftRadiusM = lateralResponseRadiusMOf(left, options);
      const uncalibratedRightRadiusM = lateralResponseRadiusMOf(right, options);
      const leftRadiusM = lateralResponseRadiusMOf(left, scoringOptions);
      const rightRadiusM = lateralResponseRadiusMOf(right, scoringOptions);
      const responseRadiusM = Math.max(leftRadiusM, rightRadiusM);
      // Conservative overlap proxy: do not turn a deep response radius into a
      // physical connector or an enlarged footprint.
      const maxDistanceM = Math.min(
        Math.max(responseRadiusM, 0.2) * 1.6,
        Number(options.maxRelationDistanceM) || 2.5,
      );
      const uncalibratedMaxDistanceM = Math.min(
        Math.max(uncalibratedLeftRadiusM, uncalibratedRightRadiusM, 0.2) * 1.6,
        Number(options.maxRelationDistanceM) || 2.5,
      );
      if (distanceM > maxDistanceM) continue;

      const depthOverlap = depthOverlapScoreOf(left, right);
      if (depthOverlap < 0.15) continue;
      const stepAdjacency = stepGap === 1 ? 1 : 0.55;
      const lateralFit = clamp01(1 - distanceM / Math.max(maxDistanceM, 1e-6));
      const uncalibratedLateralFit = clamp01(1 - distanceM / Math.max(uncalibratedMaxDistanceM, 1e-6));
      const kindScore = leftKind === rightKind ? 1 : 0.55;
      const signalSimilarity = signalSimilarityOf(left, right);
      const score = clamp01(
        stepAdjacency * 0.22
        + depthOverlap * 0.24
        + lateralFit * 0.34
        + kindScore * 0.1
        + signalSimilarity * 0.1,
      );
      const baseScore = clamp01(
        stepAdjacency * 0.22
        + depthOverlap * 0.24
        + uncalibratedLateralFit * 0.34
        + kindScore * 0.1
        + signalSimilarity * 0.1,
      );
      if (score < (Number(options.minimumScore) || 0.55)) continue;

      const reasons = [
        stepGap === 1 ? "komşu tarama adımı" : `${stepGap} adım uzaklıkta yakın kanıt`,
        depthOverlap >= 0.6 ? "derinlik aralıkları örtüşüyor" : "derinlik aralıkları kısmen örtüşüyor",
        "yatay mesafe tahmini lateral yanıt alanında",
      ];
      if (signalSimilarity >= 0.75) reasons.push("sinyal gücü benzer");
      if (leftKind === rightKind) reasons.push("anomali türü uyumlu");
      if (calibration.applied) {
        reasons.push(`saha kalibrasyonu uygulandı · 1 m referans / ${calibration.observedM.toFixed(2)} m okuma`);
      }

      const fromDetectionId = String(left.detectionId || "");
      const toDetectionId = String(right.detectionId || "");
      relations.push({
        relationId: `legacy-relation-${fromDetectionId}-${toDetectionId}`,
        fromDetectionId,
        toDetectionId,
        relation: "lateral-response-candidate",
        score,
        scorePct: Math.round(score * 100),
        baseScore,
        baseScorePct: Math.round(baseScore * 100),
        calibrationScoreDelta: score - baseScore,
        calibrationScoreDeltaPct: Math.round((score - baseScore) * 100),
        stepGap,
        distanceM,
        depthOverlap,
        responseRadiusM,
        reasons,
        proxy: true,
        calibration: {
          applied: calibration.applied,
          readingCount: calibration.readingCount,
          referenceDepthM: calibration.referenceDepthM,
          observedM: calibration.observedM,
          depthScale: calibration.depthScale,
          quality: calibration.quality,
          scoreAdjustment: calibration.scoreAdjustment,
        },
      });
    }
  }

  return relations.sort((left, right) => right.score - left.score
    || left.fromDetectionId.localeCompare(right.fromDetectionId)
    || left.toDetectionId.localeCompare(right.toDetectionId));
}

function mergeGroup(items, index, policy = LEGACY_MERGE_POLICY) {
  const sorted = [...items].sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
  const top = Math.min(...items.map((item) => Number(item.depthTopM) || 0));
  const bottom = Math.max(...items.map((item) => Number(item.depthBottomM) || Number(item.depthTopM) || 0));
  const confidences = items.map((item) => Math.max(0, Math.min(1, Number(item.confidence) || 0)));
  const average = confidences.reduce((sum, value) => sum + value, 0) / Math.max(confidences.length, 1);
  const coverageBonus = Math.min(0.18, Math.max(0, items.length - 1) * 0.06);
  const spread = Math.max(...items.map((item) => distance(item, sorted[0])), 0);
  const consistency = spread <= 0.5 ? "tight" : spread <= 1.25 ? "medium" : "loose";
  const connectors = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const gapM = horizontalFootprintGap(items[left], items[right]);
      if (gapM <= policy.horizontalGapToleranceM) {
        const from = pointOf(items[left]);
        const to = pointOf(items[right]);
        const leftFootprint = footprintOf(items[left]);
        const rightFootprint = footprintOf(items[right]);
        connectors.push({
          fromDetectionId: String(items[left].detectionId),
          toDetectionId: String(items[right].detectionId),
          from,
          to,
          gapM,
          widthM: Math.max(0.08, Math.min(leftFootprint.x, leftFootprint.y, rightFootprint.x, rightFootprint.y) * 2 * policy.connectorWidthRatio),
        });
      }
    }
  }
  const center = {
    x: weightedAverage(items, "stationM", Number(sorted[0].stationM) || 0),
    y: weightedAverage(items, "offsetM", Number(sorted[0].offsetM) || 0),
  };
  const footprints = items.map((item) => {
    const point = pointOf(item);
    const size = footprintOf(item);
    return {
      detectionId: String(item.detectionId),
      x: point.x,
      z: point.y,
      widthM: size.x * 2,
      lengthM: size.y * 2,
      stepIndex: Number(item.stepIndex) || null,
    };
  });
  const maxConnectorGapM = connectors.length
    ? Math.max(...connectors.map((connector) => connector.gapM))
    : 0;
  return {
    targetId: `legacy-target-${index + 1}`,
    detectionIds: items.map((item) => String(item.detectionId)),
    stepIndices: [...new Set(items.map((item) => Number(item.stepIndex)).filter(Number.isFinite))].sort((a, b) => a - b),
    evidence: items,
    timeline: buildLegacyTargetTimeline({ evidence: items }),
    footprints,
    center,
    maxConnectorGapM,
    depthTopM: top,
    depthBottomM: bottom,
    confidence: Math.min(0.98, average + coverageBonus),
    consistency: {
      level: consistency,
      evidenceCount: items.length,
      spreadM: spread,
    },
    evidenceQuality: evidenceQualityOf(items, spread, connectors.length),
    mergeReasons: items.length > 1 ? [
      `${items.length} kanıt birlikte değerlendirildi`,
      connectors.length ? `${connectors.length} yatay bağlantı üretildi` : "yatay koridor üretilemedi",
      connectors.length ? `en büyük yatay boşluk ${maxConnectorGapM.toFixed(2)} m` : "",
      `konum yayılımı ${spread.toFixed(2)} m`,
    ].filter(Boolean) : ["tek kanıt"],
    connectors,
    geometry: sorted[0].geometry || "irregular",
    type: sorted[0].type || "Anomali",
    mergeMode: items.length > 1 ? "automatic" : "single-evidence",
  };
}

/**
 * Muhafazakâr greedy grouping. Bir bulgu en güçlü uyumlu hedefe bağlanır;
 * uzak/derinliği çelişen bulgular ayrı hedef olarak kalır.
 */
export function mergeLegacyDetections(detections, options = {}) {
  // Aynı sözleşme hem gruplamayı hem de 3D bağlantı geometrisini yönlendirir.
  const config = mergePolicyOf(options);
  const source = Array.isArray(detections) ? detections.filter(Boolean) : [];
  const groups = [];
  const ordered = [...source].sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
  const splitIds = new Set((config.splitDetectionIds || []).map(String));
  for (const detection of ordered) {
    if (splitIds.has(String(detection.detectionId))) {
      groups.push([detection]);
      continue;
    }
    const candidates = groups
      .map((group, index) => ({
        group,
        index,
        distance: Math.min(...group.map((item) => distance(item, detection))),
        footprintGap: Math.min(...group.map((item) => horizontalFootprintGap(item, detection))),
      }))
      .filter(({ group, distance: d, footprintGap }) =>
        (d <= config.positionToleranceM || footprintGap <= config.horizontalGapToleranceM)
        && group.some((item) => canMerge(item, detection, config)))
      .sort((a, b) => Math.min(a.distance, a.footprintGap) - Math.min(b.distance, b.footprintGap));
    if (candidates.length) candidates[0].group.push(detection);
    else groups.push([detection]);
  }
  return groups.map((group, index) => mergeGroup(group, index, config));
}

/**
 * 3D, panel ve raporun aynı birleşme kararını tüketmesi için canonical çıktı.
 * Geometri üretimi görünüm katmanında kalır; burada yalnız bağlantı sözleşmesi,
 * kanıt kalitesi ve nedenleri belirlenir.
 */
export function buildLegacyMergePresentation(detections, options = {}) {
  const policy = mergePolicyOf(options);
  const targets = mergeLegacyDetections(detections, policy);
  return {
    policy,
    targets,
    detectionToTarget: Object.fromEntries(targets.flatMap((target) =>
      target.detectionIds.map((detectionId) => [String(detectionId), target.targetId]))),
  };
}

export function mergedTargetForDetection(targets, detectionId) {
  return (Array.isArray(targets) ? targets : []).find((target) => target.detectionIds.includes(String(detectionId))) || null;
}

/** Orders target candidates for operator review; this is not a probability of being real. */
export function rankLegacyTargetsForReview(targets = []) {
  const consistencyRank = { tight: 2, medium: 1, loose: 0 };
  return [...(Array.isArray(targets) ? targets : [])].sort((a, b) =>
    (Number(b.consistency?.evidenceCount ?? b.detectionIds?.length) || 0) - (Number(a.consistency?.evidenceCount ?? a.detectionIds?.length) || 0)
    || (consistencyRank[b.consistency?.level] ?? -1) - (consistencyRank[a.consistency?.level] ?? -1)
    || (Number(b.confidence) || 0) - (Number(a.confidence) || 0)
  );
}
