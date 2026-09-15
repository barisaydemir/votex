/**
 * Tarama matrisi etiketi vs analiz adım sayısı — saf karşılaştırma (UI bağımsız).
 * @param {{ matrixRows: number, matrixCols: number, scanStepCount: number }} matrix
 * @param {number | null | undefined} analyzedStepCount
 * @returns {{ text: string, status: "auto" | "label" | "match" | "mismatch" | "error" }}
 */
export function formatLegacyMatrixProductStatus(matrix, analyzedStepCount) {
  const rows = Number(matrix?.matrixRows) || 0;
  const cols = Number(matrix?.matrixCols) || 0;
  const product = Number(matrix?.scanStepCount) || 0;
  if (!(product > 0) || rows <= 0 || cols <= 0) {
    return { text: "0 = otomatik · yalnızca adım no", status: "auto" };
  }
  if (analyzedStepCount == null || analyzedStepCount === "") {
    return {
      text: `${rows}×${cols} = ${product} adım (etiket)`,
      status: "label",
    };
  }
  const analyzed = Number(analyzedStepCount);
  if (!Number.isFinite(analyzed) || analyzed < 0) {
    return {
      text: `${rows}×${cols} = ${product} adım (etiket)`,
      status: "label",
    };
  }
  if (analyzed === product) {
    return {
      text: `${rows}×${cols} = ${product} adım · analiz eşleşti`,
      status: "match",
    };
  }
  return {
    text: `Etiket ${product} · analiz ${analyzed} adım — yeniden JSON Seç / Uygula`,
    status: "mismatch",
  };
}
