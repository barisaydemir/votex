import { normalizeLegacyResult } from "./legacyNormalize.js";

const CHART = { width: 360, height: 156, left: 42, right: 12, top: 12, bottom: 28 };
let activeAxis = "x";

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sectionFailure(reason, detection) {
  return { available: false, reason, depthTopM: finite(detection?.depthTopM), depthBottomM: finite(detection?.depthBottomM) };
}

/** Read measured residuals along the selected target's X or Y grid row/column. */
export function buildLegacyTargetSection(result, detection, axis = "x") {
  if (!detection) return sectionFailure("Kesit için bir aday seçin.", null);
  const normalized = normalizeLegacyResult(result);
  const w = Math.floor(finite(normalized.gridW) || 0);
  const h = Math.floor(finite(normalized.gridH) || 0);
  const values = normalized.gridValues;
  const coverage = normalized.gridCoverage;
  if (w < 2 || h < 2 || !Array.isArray(values) || values.length !== w * h) {
    return sectionFailure("Bu JSON analizinde ölçüm grid'i bulunmuyor; kesit oluşturulmadı.", detection);
  }
  if (!Array.isArray(coverage) || coverage.length !== values.length) {
    return sectionFailure("Ölçüm hücrelerinin kapsam bilgisi yok; bilinmeyen alanları ayırt edemediğimiz için kesit oluşturulmadı.", detection);
  }

  const raw = detection.raw && typeof detection.raw === "object" ? detection.raw : detection;
  const centerX = finite(raw.cx);
  const centerY = finite(raw.cy);
  const originX = finite(normalized.gridOriginXM);
  const originY = finite(normalized.gridOriginYM);
  const widthM = finite(normalized.gridWidthM);
  const depthM = finite(normalized.gridDepthM);
  if ([centerX, centerY, originX, originY, widthM, depthM].some((item) => item == null)
    || widthM <= 0 || depthM <= 0) {
    return sectionFailure("Aday veya grid koordinatları kesit için yeterli değil.", detection);
  }

  const alongX = axis !== "y";
  const rowOrColumn = alongX
    ? clamp(Math.round(((centerY - originY) / depthM) * h - 0.5), 0, h - 1)
    : clamp(Math.round(((centerX - originX) / widthM) * w - 0.5), 0, w - 1);
  const count = alongX ? w : h;
  const spanM = alongX ? widthM : depthM;
  const startM = alongX ? originX : originY;
  const points = Array.from({ length: count }, (_, index) => {
    const x = alongX ? index : rowOrColumn;
    const y = alongX ? rowOrColumn : index;
    const offset = y * w + x;
    const value = finite(values[offset]);
    const measured = Number(coverage[offset]) > 0 && value != null;
    return { positionM: startM + ((index + 0.5) / count) * spanM, value: measured ? value : null, coverage: measured ? Number(coverage[offset]) : 0 };
  });
  const measuredPoints = points.filter((point) => point.value != null);
  if (measuredPoints.length < 3) {
    return sectionFailure("Adayın geçtiği grid hattında kesit için yeterli ölçülmüş hücre yok.", detection);
  }

  const axisCenterM = alongX ? centerX : centerY;
  const shapeSizeM = finite(alongX ? raw.widthM : raw.lengthM) ?? ((finite(alongX ? raw.rx : raw.ry) ?? 0) * 2);
  return {
    available: true,
    axis: alongX ? "x" : "y",
    points,
    measuredCount: measuredPoints.length,
    totalCount: points.length,
    minValue: Math.min(...measuredPoints.map((point) => point.value)),
    maxValue: Math.max(...measuredPoints.map((point) => point.value)),
    axisCenterM,
    targetHalfWidthM: Math.max(0, shapeSizeM * 0.5),
    depthTopM: finite(detection.depthTopM),
    depthBottomM: finite(detection.depthBottomM),
  };
}

function profilePath(section, xOf, yOf) {
  let active = false;
  return section.points.map((point) => {
    if (point.value == null) { active = false; return ""; }
    const command = `${active ? "L" : "M"}${xOf(point.positionM).toFixed(1)},${yOf(point.value).toFixed(1)}`;
    active = true;
    return command;
  }).filter(Boolean).join(" ");
}

function profileSvg(section) {
  const { width, height, left, right, top, bottom } = CHART;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const first = section.points[0].positionM;
  const last = section.points.at(-1).positionM;
  const center = (section.minValue + section.maxValue) * 0.5;
  const pad = Math.max((section.maxValue - section.minValue) * 0.12, Math.abs(center) * 0.08, 0.05);
  const min = Math.min(0, section.minValue) - pad;
  const max = Math.max(0, section.maxValue) + pad;
  const xOf = (position) => left + ((position - first) / Math.max(last - first, 1e-6)) * plotWidth;
  const yOf = (value) => top + ((max - value) / Math.max(max - min, 1e-6)) * plotHeight;
  const bandLeft = Math.max(left, xOf(section.axisCenterM - section.targetHalfWidthM));
  const bandRight = Math.min(width - right, xOf(section.axisCenterM + section.targetHalfWidthM));
  const zeroY = yOf(0);
  const ticks = [min, (min + max) * 0.5, max].map((value) => {
    const y = yOf(value).toFixed(1);
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="target-section-grid"/><text x="${left - 5}" y="${Number(y) + 3}" text-anchor="end" class="target-section-axis-label">${value.toFixed(2)}</text>`;
  }).join("");
  return `<svg class="target-section-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ölçüm gridinde aday merkezinden geçen saha ${section.axis.toUpperCase()} profili">
    ${ticks}<rect x="${bandLeft.toFixed(1)}" y="${top}" width="${Math.max(0, bandRight - bandLeft).toFixed(1)}" height="${plotHeight}" class="target-section-target-band"/>
    <line x1="${left}" y1="${zeroY.toFixed(1)}" x2="${width - right}" y2="${zeroY.toFixed(1)}" class="target-section-zero"/>
    <path d="${profilePath(section, xOf, yOf)}" class="target-section-profile"/>
    <line x1="${xOf(section.axisCenterM).toFixed(1)}" y1="${top}" x2="${xOf(section.axisCenterM).toFixed(1)}" y2="${height - bottom}" class="target-section-center"/>
    <text x="${left}" y="${height - 5}" class="target-section-axis-label">${first.toFixed(2)} m</text>
    <text x="${width - right}" y="${height - 5}" text-anchor="end" class="target-section-axis-label">${last.toFixed(2)} m</text>
    <text x="6" y="10" class="target-section-axis-label">residual</text>
  </svg>`;
}

function depthBandMarkup(section) {
  const topM = section.depthTopM;
  const bottomM = section.depthBottomM;
  if (topM == null || bottomM == null || bottomM < topM) {
    return `<div class="target-section-depth-copy">Bu aday için derinlik aralığı hesaplanmamış.</div>`;
  }
  const maxDepth = Math.max(bottomM * 1.2, topM + 0.4, 1);
  const trackTop = 5;
  const trackHeight = 74;
  const y1 = trackTop + (topM / maxDepth) * trackHeight;
  const y2 = trackTop + (bottomM / maxDepth) * trackHeight;
  return `<div class="target-section-depth-visual"><svg class="target-section-depth-track" viewBox="0 0 26 84" aria-hidden="true"><line x1="13" y1="${trackTop}" x2="13" y2="${trackTop + trackHeight}" class="target-depth-axis"/><rect x="7" y="${y1.toFixed(1)}" width="12" height="${Math.max(2, y2 - y1).toFixed(1)}" rx="2" class="target-depth-band"/></svg><div><b>${topM.toFixed(2)}–${bottomM.toFixed(2)} m</b><span>Tahmini derinlik aralığı</span><small>Model çıktısı · doğrudan derinlik ölçümü değil</small></div></div>`;
}

export function setLegacyTargetSectionAxis(axis) {
  activeAxis = axis === "y" ? "y" : "x";
  return activeAxis;
}

export function getLegacyTargetSectionAxis() { return activeAxis; }

export function renderLegacyTargetSection(host, result, detection) {
  if (!host) return null;
  const details = host.closest("details");
  if (!detection) {
    host.replaceChildren();
    if (details) details.hidden = true;
    return null;
  }
  if (details) details.hidden = false;
  const section = buildLegacyTargetSection(result, detection, activeAxis);
  const axisButtons = `<div class="target-section-axis-toggle" role="group" aria-label="Kesit yönü"><button type="button" class="mil${activeAxis === "x" ? " is-active" : ""}" data-target-section-axis="x" aria-pressed="${activeAxis === "x"}">X boyunca</button><button type="button" class="mil${activeAxis === "y" ? " is-active" : ""}" data-target-section-axis="y" aria-pressed="${activeAxis === "y"}">Y boyunca</button></div>`;
  const profile = section.available
    ? `<div class="target-section-profile-head"><b>Ölçüm gridindeki kesit profili</b><span>${section.measuredCount}/${section.totalCount} ölçülmüş hücre · residual</span></div>${profileSvg(section)}<div class="target-section-legend"><span><i class="is-profile"></i>ölçülen residual</span><span><i class="is-target"></i>aday ayak izi</span></div>`
    : `<div class="target-section-unavailable">${section.reason}</div>`;
  host.innerHTML = `${axisButtons}${profile}${depthBandMarkup(section)}<p class="target-section-caveat">Profil, seçili aday merkezinden geçen ölçüm gridini gösterir. Derinlik bandı model tahminidir; grid derinlik boyunca ölçüm içermez.</p>`;
  return section;
}
