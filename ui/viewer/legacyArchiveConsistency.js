/**
 * Çoklu çekim tutarlılık — arşiv dosya adına göre grupla, derinlik yayılımı.
 */

export function archiveSiteKey(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/i, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .replace(/[-_](pass|cek|çek|v)\d+$/i, "")
    .trim()
    .toLowerCase() || "unknown";
}

export function midDepthOfShape(shape) {
  const top = Number(shape?.depthTopM ?? shape?.depth_top_m);
  const bot = Number(shape?.depthBottomM ?? shape?.depth_bottom_m);
  if (Number.isFinite(top) && Number.isFinite(bot)) return 0.5 * (top + bot);
  if (Number.isFinite(top)) return top;
  return NaN;
}

/**
 * @param {Array<{ fileName?: string, sourceKind?: string, id?: string }>} entries
 * @returns {Map<string, typeof entries>}
 */
export function groupArchiveEntriesBySite(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    if (entry?.sourceKind && entry.sourceKind !== "legacy_dik_json") continue;
    const key = archiveSiteKey(entry.fileName);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

/**
 * Yüklenmiş sonuçlardan (cx,cy) eşleşmeli mid-depth yayılımı.
 * @returns {Map<string, { n: number, spreadM: number, midM: number }>} key = nearest detectionId in primary
 */
export function depthSpreadByDetection(primaryDetections, siblingResults) {
  const out = new Map();
  const primary = Array.isArray(primaryDetections) ? primaryDetections : [];
  const siblings = Array.isArray(siblingResults) ? siblingResults : [];
  if (!primary.length || siblings.length < 1) return out;

  for (const det of primary) {
    const cx = Number(det?.raw?.cx ?? det?.cx);
    const cy = Number(det?.raw?.cy ?? det?.cy);
    const mid0 = midDepthOfShape(det?.raw || det);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(mid0)) continue;
    const mids = [mid0];
    for (const result of siblings) {
      const shapes = [
        ...(Array.isArray(result?.metals) ? result.metals : []),
        ...(Array.isArray(result?.anomalies) ? result.anomalies : []),
        ...(Array.isArray(result?.candidates) ? result.candidates : []),
      ];
      let best = null;
      let bestDist = Infinity;
      for (const shape of shapes) {
        const sx = Number(shape.cx);
        const sy = Number(shape.cy);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
        const dist = Math.hypot(sx - cx, sy - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = shape;
        }
      }
      if (best && bestDist < 1.2) {
        const mid = midDepthOfShape(best);
        if (Number.isFinite(mid)) mids.push(mid);
      }
    }
    if (mids.length < 2) continue;
    const lo = Math.min(...mids);
    const hi = Math.max(...mids);
    out.set(det.detectionId, {
      n: mids.length,
      spreadM: hi - lo,
      midM: mids.reduce((a, b) => a + b, 0) / mids.length,
    });
  }
  return out;
}
