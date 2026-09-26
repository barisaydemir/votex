/** 1 unit = 1 m.
 * Dik/yan: nx→X, ny→Z (harita en-boyu); gömü DTO metrelerinden −Y.
 * Legacy/DTA kayıtlarında normalize; CSV/terrain kayıtlarında metre koordinatı kullanılabilir.
 */

export function depthRangeOf(surfaceOrMode) {
  if (typeof surfaceOrMode === "string") {
    return surfaceOrMode === "side" ? 15 : 30;
  }
  const mode = surfaceOrMode?.viewMode || surfaceOrMode?.view_mode || "side";
  const d = Number(surfaceOrMode?.depthRangeM ?? surfaceOrMode?.depth_range_m);
  if (Number.isFinite(d) && d > 0) return d;
  return mode === "side" ? 15 : 30;
}

/** Normalize → dünya XZ (yan/dik aynı; mapD = görüntü en-boyu). */
export function mapToWorld(nx, ny, mapW, mapD, _sideView = false) {
  const x = (nx - 0.5) * mapW;
  const z = (ny - 0.5) * mapD;
  return { x, z };
}

/**
 * Yapı kayıtlarını dünya koordinatına çevir.
 *
 * Görüntü/DTA yapıları cx/cy veya x0..y1 değerlerini 0–1 normalize taşır;
 * CSV/terrain yapıları ise metre taşır. Eski kod metre değerlerini 1'e
 * kıskaçladığı için özellikle pozitif koordinatlı nesneler köşeye yapışıyordu.
 * Kayıt açıkça metre belirtmiyorsa, 0–1 aralığı normalize kabul edilir; aralık
 * dışındaki koordinatlar metre olarak çevrilir ve harita sınırına kıskaçlanır.
 */
export function recordPointToWorld(record, xKey, zKey, mapW, mapD, sideView = false) {
  const x = Number(record?.[xKey]);
  const z = Number(record?.[zKey]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { x: 0, z: 0, mode: "invalid" };

  const explicit = String(
    record?.coordinateSpace ?? record?.coordinate_space ?? record?.positionUnits ?? record?.position_units ?? ""
  ).toLowerCase();
  const explicitMeters = explicit === "m" || explicit === "meter" || explicit === "meters" || explicit === "world" || explicit === "metric";
  const explicitNormalized = explicit === "normalized" || explicit === "norm" || explicit === "uv";
  const meterMode = explicitMeters || (!explicitNormalized && (Math.abs(x) > 1.0001 || Math.abs(z) > 1.0001));

  if (!meterMode) {
    return { ...mapToWorld(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, z)), mapW, mapD, sideView), mode: "normalized" };
  }

  return {
    x: Math.max(-mapW * 0.5, Math.min(mapW * 0.5, x)),
    z: Math.max(-mapD * 0.5, Math.min(mapD * 0.5, z)),
    mode: "meters",
  };
}

/** Tünel/hat uçlarını tek koordinat sözleşmesiyle dünya noktalarına çevir. */
export function recordSegmentToWorld(record, mapW, mapD, sideView = false) {
  const x0 = Number(record?.x0);
  const z0 = Number(record?.y0 ?? record?.z0);
  const x1 = Number(record?.x1);
  const z1 = Number(record?.y1 ?? record?.z1);
  const values = [x0, z0, x1, z1];
  if (!values.every(Number.isFinite)) return null;

  const explicit = String(
    record?.coordinateSpace ?? record?.coordinate_space ?? record?.positionUnits ?? record?.position_units ?? ""
  ).toLowerCase();
  const explicitMeters = explicit === "m" || explicit === "meter" || explicit === "meters" || explicit === "world" || explicit === "metric";
  const explicitNormalized = explicit === "normalized" || explicit === "norm" || explicit === "uv";
  const meterMode = explicitMeters || (!explicitNormalized && values.some((value) => Math.abs(value) > 1.0001));
  const point = (x, z) => meterMode
    ? {
        x: Math.max(-mapW * 0.5, Math.min(mapW * 0.5, x)),
        z: Math.max(-mapD * 0.5, Math.min(mapD * 0.5, z)),
      }
    : mapToWorld(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, z)), mapW, mapD, sideView);
  return { a: point(x0, z0), b: point(x1, z1), mode: meterMode ? "meters" : "normalized" };
}
