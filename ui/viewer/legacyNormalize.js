/**
 * Legacy3DMAG DTO adaptörü.
 * Eski arşiv snake_case yalnız burada çözülür; tüketiciler camelCase okur.
 */

const NORMALIZED_FLAG = "__legacyNormalized";

const pick = (obj, camel, snake = camel) => obj?.[camel] ?? obj?.[snake];

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function strengthOf(shape) {
  return finite(pick(shape, "peakSigma", "peak_sigma"), finite(shape?.strength, 0));
}

function normalizeStep(step, index) {
  return {
    ...step,
    index: Number(pick(step, "index")) || index + 1,
    start: Number(pick(step, "start")) || 0,
    end: Number(pick(step, "end")) || 0,
    xStartM: finite(pick(step, "xStartM", "x_start_m")),
    xEndM: finite(pick(step, "xEndM", "x_end_m")),
    xCenterM: finite(pick(step, "xCenterM", "x_center_m")),
    yStartM: finite(pick(step, "yStartM", "y_start_m")),
    yEndM: finite(pick(step, "yEndM", "y_end_m")),
    yCenterM: finite(pick(step, "yCenterM", "y_center_m")),
    widthM: finite(pick(step, "widthM", "width_m")),
    lengthM: finite(pick(step, "lengthM", "length_m")),
    pointCount: Number(pick(step, "pointCount", "point_count")) || 0,
    spacingFromPreviousM: finite(pick(step, "spacingFromPreviousM", "spacing_from_previous_m")),
  };
}

/**
 * 1D değerleri toleransla kümele (matris satır/sütun merkezleri).
 */
function clusterAxisValues(values, tol) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return [];
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tol) {
      clusters.push({ sum: value, n: 1, mean: value });
    } else {
      last.sum += value;
      last.n += 1;
      last.mean = last.sum / last.n;
    }
  }
  return clusters.map((cluster) => cluster.mean);
}

function clusterTolerance(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length < 2) return 0.15;
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 1e-6) gaps.push(gap);
  }
  if (!gaps.length) return 0.15;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(0.05, median * 0.45);
}

function nearestClusterIndex(value, centers) {
  let best = 0;
  let bestDist = Infinity;
  centers.forEach((center, index) => {
    const dist = Math.abs(value - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

/**
 * Matris: alt satırdan üst satıra, her satırda soldan sağa.
 * Hint yoksa otomatik küme; net ızgara yoksa X/Y açıklığı yedek sırası.
 * @param {object[]} steps
 * @param {{ matrixRows?: number, matrixCols?: number } | null} hint
 */
export function orderScanStepsLeftFirst(steps, hint = null) {
  const list = Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
  const hintRows = Math.max(0, Math.floor(Number(hint?.matrixRows) || 0));
  const hintCols = Math.max(0, Math.floor(Number(hint?.matrixCols) || 0));
  const hasHint = hintRows >= 1 && hintCols >= 1;

  if (list.length < 2) {
    return list.map((step, index) => ({
      ...step,
      index: index + 1,
      spacingFromPreviousM: 0,
      matrixRows: hasHint ? hintRows : undefined,
      matrixCols: hasHint ? hintCols : undefined,
    }));
  }

  // JSON/cihaz dizisi fiziksel tarama sırasıdır. Cihazın soldan tutulması,
  // gidiş-dönüş yönü ve hatlar arasındaki bir adım kayması bu dizide zaten
  // kodludur; koordinata göre yeniden sıralamak gerçek saha sırasını bozar.
  // Bu nedenle kaynak sırasını koruyor, yalnızca kanonik 1..N indeksliyoruz.
  const isMatrix = hasHint;
  const nCol = hasHint ? hintCols : 0;
  const nRow = hasHint ? hintRows : 0;
  // JSON/cihaz dizisi fiziksel tarama sırasıdır. Cihazın soldan tutulması,
  // gidiş-dönüş yönü ve hatlar arasındaki bir adım kayması bu dizide zaten
  // kodludur; koordinata göre yeniden sıralamak gerçek saha sırasını bozar.
  // Bu nedenle kaynak sırasını koruyor, yalnızca kanonik 1..N indeksliyoruz.
  let previous = null;
  return list.map((step, index) => {
    const spacing = previous
      ? Math.hypot(step.xCenterM - previous.xCenterM, step.yCenterM - previous.yCenterM)
      : 0;
    previous = step;
    return {
      ...step,
      index: index + 1,
      spacingFromPreviousM: spacing,
      matrixCols: hasHint ? hintCols : undefined,
      matrixRows: hasHint ? hintRows : undefined,
    };
  });
}

function averageStepSpacing(steps) {
  const values = (steps || [])
    .slice(1)
    .map((step) => Number(step.spacingFromPreviousM))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeInvertProxies(source) {
  const raw = Array.isArray(source?.invertProxies)
    ? source.invertProxies
    : (Array.isArray(source?.invert_proxies) ? source.invert_proxies : []);
  return raw.map((item) => {
    if (!item || typeof item !== "object") return null;
    const detectionId = pick(item, "detectionId", "detection_id");
    return {
      method: String(pick(item, "method") || "compact-dipole"),
      disclaimer: String(pick(item, "disclaimer") || ""),
      cx: finite(pick(item, "cx")),
      cy: finite(pick(item, "cy")),
      depthM: finite(pick(item, "depthM", "depth_m")),
      depthMagneticM: finite(pick(item, "depthMagneticM", "depth_magnetic_m")),
      rxM: finite(pick(item, "rxM", "rx_m"), 0.3),
      ryM: finite(pick(item, "ryM", "ry_m"), 0.3),
      misfitRms: finite(pick(item, "misfitRms", "misfit_rms"), 1),
      fitSamples: Number(pick(item, "fitSamples", "fit_samples")) || 0,
      polygon: Array.isArray(item.polygon) ? item.polygon : [],
      sensorHeightM: finite(pick(item, "sensorHeightM", "sensor_height_m")),
      detectionId: detectionId != null && String(detectionId).trim() ? String(detectionId) : null,
    };
  }).filter(Boolean);
}

/** Invert proxy’leri field model tespitlerine cx/cy ile bağla. */
export function linkInvertProxiesToDetections(proxies, detections, maxDistM = 1.5) {
  const list = Array.isArray(proxies) ? proxies : [];
  const dets = Array.isArray(detections) ? detections : [];
  const limit = Number.isFinite(Number(maxDistM)) ? Math.max(0.4, Number(maxDistM)) : 1.5;
  return list.map((proxy) => {
    if (proxy?.detectionId && dets.some((d) => d.detectionId === proxy.detectionId)) {
      return proxy;
    }
    let bestId = null;
    let bestDist = Infinity;
    for (const detection of dets) {
      const cx = Number(detection?.raw?.cx ?? detection?.cx);
      const cy = Number(detection?.raw?.cy ?? detection?.cy);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const dist = Math.hypot(Number(proxy.cx) - cx, Number(proxy.cy) - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = detection.detectionId;
      }
    }
    if (!(bestDist <= limit)) {
      return { ...proxy, detectionId: proxy?.detectionId || null };
    }
    return { ...proxy, detectionId: bestId };
  });
}

function normalizeShapeFields(shape) {
  if (!shape || typeof shape !== "object") return shape;
  return {
    ...shape,
    kind: String(shape.kind || "anomaly"),
    label: shape.label,
    cx: finite(shape.cx),
    cy: finite(shape.cy),
    rx: finite(shape.rx),
    ry: finite(shape.ry),
    polarity: finite(shape.polarity, 1),
    strength: finite(shape.strength),
    confidence: finite(shape.confidence),
    depthTopM: finite(pick(shape, "depthTopM", "depth_top_m")),
    depthBottomM: finite(pick(shape, "depthBottomM", "depth_bottom_m")),
    meshKind: String(pick(shape, "meshKind", "mesh_kind") || "box"),
    peakSigma: finite(pick(shape, "peakSigma", "peak_sigma"), finite(shape.strength)),
    depthLabel: String(pick(shape, "depthLabel", "depth_label") || ""),
    depthMethod: String(pick(shape, "depthMethod", "depth_method") || ""),
    depthFitError: finite(pick(shape, "depthFitError", "depth_fit_error"), 1),
    depthUncertaintyM: finite(pick(shape, "depthUncertaintyM", "depth_uncertainty_m")),
    depthIntervalLowM: finite(pick(shape, "depthIntervalLowM", "depth_interval_low_m")),
    depthIntervalHighM: finite(pick(shape, "depthIntervalHighM", "depth_interval_high_m")),
    depthFitSamples: Number(pick(shape, "depthFitSamples", "depth_fit_samples")) || 0,
    polygon: Array.isArray(shape.polygon) ? shape.polygon : [],
    shapeType: String(pick(shape, "shapeType", "shape_type") || "irregular"),
    shapeSource: String(pick(shape, "shapeSource", "shape_source") || "inferred"),
    orientationDeg: finite(pick(shape, "orientationDeg", "orientation_deg")),
    widthM: finite(pick(shape, "widthM", "width_m"), Math.abs(finite(shape.rx)) * 2),
    lengthM: finite(pick(shape, "lengthM", "length_m"), Math.abs(finite(shape.ry)) * 2),
    roundness: finite(pick(shape, "roundness")),
    aspectRatio: finite(pick(shape, "aspectRatio", "aspect_ratio")),
    shapeFitError: finite(pick(shape, "shapeFitError", "shape_fit_error"), 1),
    shapeConfidence: finite(pick(shape, "shapeConfidence", "shape_confidence")),
    corePolygon: Array.isArray(pick(shape, "corePolygon", "core_polygon"))
      ? pick(shape, "corePolygon", "core_polygon")
      : [],
    peakXM: finite(pick(shape, "peakXM", "peak_x_m")),
    peakYM: finite(pick(shape, "peakYM", "peak_y_m")),
    footprintAreaM2: finite(pick(shape, "footprintAreaM2", "footprint_area_m2")),
    footprintPerimeterM: finite(pick(shape, "footprintPerimeterM", "footprint_perimeter_m")),
    contourThresholdSigma: finite(pick(shape, "contourThresholdSigma", "contour_threshold_sigma")),
    templateKind: String(pick(shape, "templateKind", "template_kind") || ""),
    templateScore: finite(pick(shape, "templateScore", "template_score")),
    templateScores: Array.isArray(pick(shape, "templateScores", "template_scores"))
      ? pick(shape, "templateScores", "template_scores")
      : [],
  };
}

/**
 * anomalies + metals birleştirir; aynı cx:cy konumunda metal önceliklidir.
 * Güçlüden zayıfa sıralar.
 */
export function mergeLegacyShapes(result) {
  const source = result?.anomalies?.length ? result.anomalies : (result?.candidates || []);
  const byLocation = new Map();
  for (const shape of source) {
    const x = Number(shape?.cx);
    const y = Number(shape?.cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    byLocation.set(`${x.toFixed(3)}:${y.toFixed(3)}`, shape);
  }
  for (const metal of result?.metals || []) {
    const x = Number(metal?.cx);
    const y = Number(metal?.cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    byLocation.set(`${x.toFixed(3)}:${y.toFixed(3)}`, metal);
  }
  return [...byLocation.values()].sort((a, b) => strengthOf(b) - strengthOf(a));
}

/**
 * Ham LegacyDikResult (camelCase veya eski snake_case) → tek camelCase sözleşme.
 * @param {object} raw
 * @param {{ matrixRows?: number, matrixCols?: number } | null} matrixHint
 */
export function normalizeLegacyResult(raw, matrixHint = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const requestedRows = Math.max(0, Math.floor(Number(matrixHint?.matrixRows) || 0));
  const requestedCols = Math.max(0, Math.floor(Number(matrixHint?.matrixCols) || 0));
  // Normalizasyon birden fazla renderer'dan çağrılabilir. Aynı DTO'yu tekrar
  // sıralamak özellikle serpantin adımlarını tersine çevirebilir; uyumlu hint
  // varsa hazır sözleşmeyi doğrudan kullan.
  if (source[NORMALIZED_FLAG]
    && (!requestedRows || source.matrixRows === requestedRows)
    && (!requestedCols || source.matrixCols === requestedCols)) {
    return source;
  }
  const metaRaw = source.meta || {};
  const scanStepsSource = Array.isArray(source.scanSteps)
    ? source.scanSteps
    : (Array.isArray(source.scan_steps) ? source.scan_steps : []);
  const anomalies = Array.isArray(source.anomalies) ? source.anomalies.map(normalizeShapeFields) : [];
  const candidates = Array.isArray(source.candidates) ? source.candidates.map(normalizeShapeFields) : [];
  const metals = Array.isArray(source.metals) ? source.metals.map(normalizeShapeFields) : [];

  const gridValues = Array.isArray(source.gridValues)
    ? source.gridValues
    : (Array.isArray(source.grid_values) ? source.grid_values : []);
  const gridCoverage = Array.isArray(source.gridCoverage)
    ? source.gridCoverage
    : (Array.isArray(source.grid_coverage) ? source.grid_coverage : []);
  const residualPreview = Array.isArray(source.residualPreview)
    ? source.residualPreview
    : (Array.isArray(source.residual_preview) ? source.residual_preview : []);

  const hintRows = Math.max(0, Math.floor(Number(matrixHint?.matrixRows ?? source.matrixRows ?? source.matrix_rows) || 0));
  const hintCols = Math.max(0, Math.floor(Number(matrixHint?.matrixCols ?? source.matrixCols ?? source.matrix_cols) || 0));
  const hint = hintRows >= 1 && hintCols >= 1 ? { matrixRows: hintRows, matrixCols: hintCols } : null;

  const meta = {
    deviceCode: String(pick(metaRaw, "deviceCode", "device_code") || "Legacy3DMagDevice"),
    date: pick(metaRaw, "date") ?? null,
    xMeters: finite(pick(metaRaw, "xMeters", "x_meters"), 4),
    yMeters: finite(pick(metaRaw, "yMeters", "y_meters"), 5),
    version: pick(metaRaw, "version") ?? null,
  };

  const normalized = {
    ...source,
    ok: !!source.ok,
    message: String(source.message || ""),
    viewMode: String(pick(source, "viewMode", "view_mode") || "top"),
    meta,
    pointCount: Number(pick(source, "pointCount", "point_count")) || 0,
    gridW: Number(pick(source, "gridW", "grid_w")) || 0,
    gridH: Number(pick(source, "gridH", "grid_h")) || 0,
    mapSizeM: finite(pick(source, "mapSizeM", "map_size_m"), meta.xMeters),
    mapDepthM: finite(pick(source, "mapDepthM", "map_depth_m"), meta.yMeters),
    magMedian: finite(pick(source, "magMedian", "mag_median")),
    magSigma: finite(pick(source, "magSigma", "mag_sigma")),
    anomalies,
    candidates,
    metals,
    passEstimate: Number(pick(source, "passEstimate", "pass_estimate")) || 0,
    scanStepCount: Number(pick(source, "scanStepCount", "scan_step_count")) || 0,
    scanSegmentCount: Number(pick(source, "scanSegmentCount", "scan_segment_count")) || 0,
    scanSteps: orderScanStepsLeftFirst(scanStepsSource.map(normalizeStep), hint),
    scanStepInputM: finite(pick(source, "scanStepInputM", "scan_step_input_m")),
    matrixRows: hint?.matrixRows || 0,
    matrixCols: hint?.matrixCols || 0,
    scanStepSpacingM: finite(pick(source, "scanStepSpacingM", "scan_step_spacing_m")),
    uniquePoints: Number(pick(source, "uniquePoints", "unique_points")) || 0,
    rawPointCount: Number(pick(source, "rawPointCount", "raw_point_count")) || 0,
    fingerprint: String(source.fingerprint || ""),
    residualPreview,
    gridValues,
    gridCoverage,
    gridOriginXM: finite(pick(source, "gridOriginXM", "grid_origin_x_m")),
    gridOriginYM: finite(pick(source, "gridOriginYM", "grid_origin_y_m")),
    gridWidthM: finite(pick(source, "gridWidthM", "grid_width_m"), meta.xMeters),
    gridDepthM: finite(pick(source, "gridDepthM", "grid_depth_m"), meta.yMeters),
    invertProxies: normalizeInvertProxies(source),
    [NORMALIZED_FLAG]: true,
  };

  if (!(normalized.scanStepSpacingM > 0) && normalized.scanSteps.length > 1) {
    normalized.scanStepSpacingM = averageStepSpacing(normalized.scanSteps);
  }
  normalized.scanStepCount = normalized.scanSteps.length || normalized.scanStepCount;

  normalized.shapes = mergeLegacyShapes(normalized);
  return normalized;
}
