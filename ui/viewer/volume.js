/** Fiziksel boyut ve hacim yardımcıları.
 * Tüm sonuçlar metre/metreküp cinsindedir; 3D'deki dikey abartı hacme dahil edilmez.
 */

const valueOf = (object, camel, snake = camel) => object?.[camel] ?? object?.[snake];
const positive = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function dimensionsOf(record = {}, defaults = {}) {
  const rawWidth = positive(valueOf(record, "widthM", "width_m"), 0);
  const rawLength = positive(valueOf(record, "lengthM", "length_m"), 0);
  const width = rawWidth || positive(record.rx, 0) * 2 || positive(defaults.width, 0);
  const length = rawLength || positive(record.ry, 0) * 2 || positive(defaults.length, width) || width;
  const top = Number(valueOf(record, "topFromSurfaceM", "top_from_surface_m"));
  const bottom = Number(valueOf(record, "bottomFromSurfaceM", "bottom_from_surface_m"));
  const depthThickness = Number.isFinite(top) && Number.isFinite(bottom) && bottom > top
    ? bottom - top
    : 0;
  const height = positive(
    valueOf(record, "heightM", "height_m"),
    positive(valueOf(record, "plumeHeightM", "plume_height_m"), depthThickness || positive(defaults.height, 0)),
  );
  return { width: width || 0, length: length || width || 0, height, top, bottom };
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const ax = Number(a[0]);
    const az = Number(a[1]);
    const bx = Number(b[0]);
    const bz = Number(b[1]);
    if (![ax, az, bx, bz].every(Number.isFinite)) return 0;
    area += ax * bz - bx * az;
  }
  return Math.abs(area) * 0.5;
}

export function footprintAreaM2Of(record = {}, options = {}) {
  const { width, length } = dimensionsOf(record, options);
  const typeValue = valueOf(record, "shapeType", "shape_type");
  const type = String(typeValue || record.kind || "rectangle").toLowerCase();
  const polygon = Array.isArray(record.polygon) ? record.polygon : [];
  const source = String(valueOf(record, "shapeSource", "shape_source") || "").toLowerCase();

  // Ölçüm konturu normalize ise grid boyutuyla metreye çevrilir; metre tabanlı
  // eski kontur doğrudan kullanılır. Böylece hacim 3D ayak iziyle eşleşir.
  if (polygon.length >= 3 && (source === "grid-contour" || type === "polygon" || type === "irregular")) {
    const rawArea = polygonArea(polygon);
    if (rawArea > 0) {
      const normalized = polygon.every((point) => Array.isArray(point) && point[0] >= -0.001 && point[0] <= 1.001 && point[1] >= -0.001 && point[1] <= 1.001);
      const mapWidth = positive(options.mapWidthM, width || 1);
      const mapDepth = positive(options.mapDepthM, length || 1);
      return normalized ? rawArea * mapWidth * mapDepth : rawArea;
    }
  }

  if (type === "shaft") {
    const diameter = Math.min(width, length);
    return Math.PI * (diameter * 0.5) ** 2;
  }
  if (type === "circle" || type === "ellipse" || type === "metal") {
    return Math.PI * (width * 0.5) * (length * 0.5);
  }
  if (type === "capsule" || type === "tunnel") {
    const short = Math.min(width, length);
    const straight = Math.max(Math.max(width, length) - short, 0);
    return straight * short + Math.PI * (short * 0.5) ** 2;
  }
  return width * length;
}

function coordinateSpaceOf(record) {
  return String(record?.coordinateSpace ?? record?.coordinate_space ?? "").toLowerCase();
}

export function segmentLengthMOf(record = {}, options = {}) {
  const x0 = Number(record.x0);
  const z0 = Number(record.y0 ?? record.z0);
  const x1 = Number(record.x1);
  const z1 = Number(record.y1 ?? record.z1);
  if (![x0, z0, x1, z1].every(Number.isFinite)) return 0;
  const explicit = coordinateSpaceOf(record);
  const normalized = explicit === "normalized" || explicit === "norm" || explicit === "uv"
    || (!explicit && [x0, z0, x1, z1].every((value) => value >= -0.001 && value <= 1.001));
  const dx = x1 - x0;
  const dz = z1 - z0;
  if (!normalized) return Math.hypot(dx, dz);
  const mapWidth = positive(options.mapWidthM, 1);
  const mapDepth = positive(options.mapDepthM, mapWidth);
  return Math.hypot(dx * mapWidth, dz * mapDepth);
}

/** Yaklaşık fiziksel hacim; yalnızca ölçülen boyutlar kullanılır. */
export function volumeM3Of(record = {}, options = {}) {
  const kind = String(record.kind || options.kind || "anomaly").toLowerCase();
  const dimensions = dimensionsOf(record, options);
  if (kind === "tunnel") {
    const length = segmentLengthMOf(record, options) || positive(record.lengthM ?? record.length_m, dimensions.length);
    const width = positive(record.widthM ?? record.width_m, dimensions.width);
    const height = positive(record.heightM ?? record.height_m, dimensions.height || options.height || 0);
    // makeTunnel uzun tünelde D-kesit (dikdörtgen + yarım daire) çizer.
    const crossSectionFactor = options.tunnelProfile === "vault"
      ? Math.PI / 4
      : options.tunnelProfile === "box" ? 1
      : options.tunnelProfile === "cylinder" ? Math.PI / 4
      : options.exactTunnel === false ? 1 : 0.5 + Math.PI / 8;
    return Math.max(0, length * width * height * crossSectionFactor);
  }
  if (kind === "shaft") {
    const diameter = Math.min(dimensions.width, dimensions.length);
    return Math.PI * (diameter * 0.5) ** 2 * dimensions.height;
  }
  if (kind === "water") {
    const thickness = positive(valueOf(record, "thicknessM", "thickness_m"), dimensions.height || 0.2);
    return footprintAreaM2Of(record, options) * thickness;
  }
  const area = footprintAreaM2Of(record, options);
  const height = dimensions.height || Math.max(dimensions.bottom - dimensions.top, 0.2);
  return area * height;
}

export function formatVolumeM3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} m³`;
}
