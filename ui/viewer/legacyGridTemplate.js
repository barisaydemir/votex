/**
 * Legacy3DMAG saha ızgarası: fiziksel ölçüm merkezi ile hücre numarasını
 * aynı kayda bağlar. 6×3 = 6 satır (hareket yönü) × 3 sütun (hat).
 *
 * Numaralandırma yönü (ltr/rtl) fiziksel konumu değiştirmez; yalnız
 * hangi sütunun 1’den başladığını belirler.
 */

function positiveInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function findLegacyGridCell(template, xM, yM) {
  if (!template?.cells?.length) return null;
  const x = Number(xM);
  const y = Number(yM);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const inside = template.cells.find((cell) => (
    x >= cell.minXM - 1e-9 && x <= cell.maxXM + 1e-9
      && y >= cell.minYM - 1e-9 && y <= cell.maxYM + 1e-9
  ));
  if (inside) return inside;
  return template.cells.reduce((best, cell) => {
    const distance = Math.hypot(x - cell.centerXM, y - cell.centerYM);
    return !best || distance < best.distance ? { cell, distance } : best;
  }, null)?.cell || null;
}

/**
 * Sütun-major görünen adım no: LTR’de sol sütun 1’den, RTL’de sağ sütun 1’den.
 */
export function displayStepIndexForCell(row, col, rowCount, colCount, numberingDirection = "rtl") {
  const leftToRight = String(numberingDirection).toLowerCase() !== "rtl";
  const orderedCol = leftToRight ? col : (colCount - 1 - col);
  return orderedCol * rowCount + row + 1;
}

/**
 * Matris hücrelerini harita dikdörtgenine tam oturtur.
 * Hücre boyutu width/cols × depth/rows (kare zorlanmaz — yan boşluk kalmaz).
 */
export function buildLegacyGridTemplate({
  rows,
  cols,
  widthM,
  depthM,
  originXM = 0,
  originYM = 0,
  scanSteps = [],
  numberingDirection = "rtl",
} = {}) {
  const rowCount = positiveInt(rows);
  const colCount = positiveInt(cols);
  if (!rowCount || !colCount) return null;
  const width = Math.max(0, finite(widthM));
  const depth = Math.max(0, finite(depthM));
  const cellWidthM = width / colCount;
  const cellHeightM = depth / rowCount;
  if (!(cellWidthM > 0) || !(cellHeightM > 0)) return null;
  const orderedSteps = Array.isArray(scanSteps) ? scanSteps : [];
  const direction = String(numberingDirection || "rtl").toLowerCase() === "rtl" ? "rtl" : "ltr";
  const cells = [];

  for (let col = 0; col < colCount; col += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      const minXM = originXM + col * cellWidthM;
      const minYM = originYM + row * cellHeightM;
      const centerXM = minXM + cellWidthM * 0.5;
      const centerYM = minYM + cellHeightM * 0.5;
      const stepIndex = displayStepIndexForCell(row, col, rowCount, colCount, direction);
      cells.push({
        cellIndex: row * colCount + col,
        row,
        col,
        stepIndex,
        scanOrder: null,
        direction: col % 2 === 0 ? "forward" : "return",
        minXM,
        maxXM: minXM + cellWidthM,
        minYM,
        maxYM: minYM + cellHeightM,
        centerXM,
        centerYM,
        widthM: cellWidthM,
        heightM: cellHeightM,
      });
    }
  }

  // Tarama adımlarını fiziksel konuma göre hücreye bağla (numara yönünden bağımsız).
  orderedSteps.forEach((step, scanIndex) => {
    const x = Number(step?.xCenterM);
    const y = Number(step?.yCenterM);
    let cell = null;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      cell = findLegacyGridCell({ cells }, x, y);
    }
    if (!cell) {
      // Konum yoksa tarama sırası → sütun-major LTR yerleşim
      const logicalCol = Math.min(colCount - 1, Math.floor(scanIndex / rowCount));
      const row = scanIndex % rowCount;
      cell = cells.find((item) => item.row === row && item.col === logicalCol) || null;
    }
    if (!cell) return;
    cell.scanOrder = Number(step.index) || scanIndex + 1;
    cell.sourceStepIndex = Number(step.index) || scanIndex + 1;
    cell.direction = cell.col % 2 === 0 ? "forward" : "return";
    if (Number.isFinite(x) && Number.isFinite(y)) {
      cell.physicalXM = x;
      cell.physicalYM = y;
    }
  });

  return {
    rows: rowCount,
    cols: colCount,
    widthM: width,
    depthM: depth,
    cellWidthM,
    cellHeightM,
    nominalCellWidthM: cellWidthM,
    nominalCellHeightM: cellHeightM,
    numberingDirection: direction,
    cells,
  };
}

/**
 * Analiz scanSteps listesine LTR/RTL görünen adım numaralarını yazar.
 */
export function applyDisplayStepNumbering(steps, {
  rows,
  cols,
  widthM,
  depthM,
  originXM = 0,
  originYM = 0,
  numberingDirection = "rtl",
} = {}) {
  const list = Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
  if (!list.length) return list;
  const template = buildLegacyGridTemplate({
    rows,
    cols,
    widthM,
    depthM,
    originXM,
    originYM,
    scanSteps: list,
    numberingDirection,
  });
  if (!template) {
    return list.map((step, index) => ({ ...step, index: index + 1 }));
  }
  return list
    .map((step, index) => {
      const cell = findLegacyGridCell(template, step.xCenterM, step.yCenterM)
        || template.cells.find((item) => item.scanOrder === (Number(step.index) || index + 1));
      return {
        ...step,
        index: cell?.stepIndex || index + 1,
        scanOrder: Number(step.scanOrder) || Number(step.index) || index + 1,
      };
    })
    .sort((a, b) => Number(a.index) - Number(b.index));
}

/**
 * Normalize edilmiş sonuçtaki scanSteps numaralarını yön seçimine göre günceller (yerinde).
 */
export function applyLegacyNumberingToNormalized(normalized, {
  widthM,
  depthM,
  originXM = 0,
  originYM = 0,
  numberingDirection = "rtl",
} = {}) {
  if (!normalized || typeof normalized !== "object") return normalized;
  const rows = Number(normalized.matrixRows);
  const cols = Number(normalized.matrixCols);
  if (!(rows > 0 && cols > 0)) return normalized;
  const steps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
  if (!steps.length) return normalized;
  const xMeters = Math.max(0.5, Number(widthM ?? normalized.gridWidthM ?? normalized.meta?.xMeters ?? 4));
  const zMeters = Math.max(0.5, Number(depthM ?? normalized.gridDepthM ?? normalized.meta?.yMeters ?? 5));
  normalized.scanSteps = applyDisplayStepNumbering(steps, {
    rows,
    cols,
    widthM: xMeters,
    depthM: zMeters,
    originXM: Number(originXM ?? normalized.gridOriginXM ?? 0),
    originYM: Number(originYM ?? normalized.gridOriginYM ?? 0),
    numberingDirection,
  });
  return normalized;
}
