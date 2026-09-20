export const DEFAULT_DEPTH_PARAMS = Object.freeze({
  sensorHeightM: 0.1,
  bipolarSepFactor: 1.85,
  dipoleBlend: 0.3,
});

export function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeDepthParams(params = DEFAULT_DEPTH_PARAMS) {
  return {
    sensorHeightM: clampNum(params.sensorHeightM ?? params.sensor_height_m, 0, 0.2, DEFAULT_DEPTH_PARAMS.sensorHeightM),
    bipolarSepFactor: clampNum(params.bipolarSepFactor ?? params.bipolar_sep_factor, 0.5, 4, DEFAULT_DEPTH_PARAMS.bipolarSepFactor),
    dipoleBlend: clampNum(params.dipoleBlend ?? params.dipole_blend, 0, 1, DEFAULT_DEPTH_PARAMS.dipoleBlend),
  };
}

export function readDepthParams(values = {}) {
  const normalized = normalizeDepthParams({
    sensorHeightM: values.sensorHeightM,
    bipolarSepFactor: values.bipolarSepFactor,
    dipoleBlend: clampNum(values.dipoleBlend, 0, 100, DEFAULT_DEPTH_PARAMS.dipoleBlend * 100) / 100,
  });
  return normalized;
}

export function readMatrixInput(rowsValue = "0", colsValue = "0") {
  const rowsRaw = String(rowsValue ?? "0").trim();
  const colsRaw = String(colsValue ?? "0").trim();
  const matrixRows = rowsRaw === "" ? 0 : Number(rowsRaw);
  const matrixCols = colsRaw === "" ? 0 : Number(colsRaw);
  if (!Number.isInteger(matrixRows) || matrixRows < 0 || matrixRows > 500) {
    throw new Error("Satır sayısı 0–500 arasında tam sayı olmalıdır");
  }
  if (!Number.isInteger(matrixCols) || matrixCols < 0 || matrixCols > 500) {
    throw new Error("Sütun sayısı 0–500 arasında tam sayı olmalıdır");
  }
  if ((matrixRows > 0) !== (matrixCols > 0)) {
    throw new Error("Satır ve sütunu birlikte girin (ör. 6×3), ya da ikisini de 0 bırakın");
  }
  const scanStepCount = matrixRows > 0 && matrixCols > 0 ? matrixRows * matrixCols : 0;
  if (scanStepCount > 10000) throw new Error("Matris çarpımı (satır×sütun) 10000’den büyük olamaz");
  return { matrixRows, matrixCols, scanStepCount, hint: scanStepCount > 0 ? { matrixRows, matrixCols } : null };
}

export function readAnalyzeInputs({ rows, cols, spacing } = {}) {
  const matrix = readMatrixInput(rows, cols);
  const raw = String(spacing ?? "0").trim();
  const scanStepSpacingM = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(scanStepSpacingM) || scanStepSpacingM < 0 || scanStepSpacingM > 1000) {
    throw new Error("Yatay adım ölçüsü 0–1000 metre arasında olmalıdır");
  }
  return { matrix, effectiveStepSpacingM: matrix.scanStepCount > 0 ? 0 : scanStepSpacingM };
}
