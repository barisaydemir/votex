/** 1 unit = 1 m.
 * Dik/yan: nx→X, ny→Z (harita en-boyu); gömü DTO metrelerinden −Y.
 * Yan: colormap görüntü oranında; yapılar blob (cx,cy) konumunda — ortaya yığılmaz.
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
