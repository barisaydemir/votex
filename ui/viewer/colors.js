export function formatDepthM(meters) {
  const m = Math.max(0, Number(meters) || 0);
  const whole = Math.floor(m);
  const cm = Math.round((m - whole) * 100);
  if (whole <= 0) return `${cm} cm`;
  return `${whole} m ${String(cm).padStart(2, "0")} cm`;
}

/** Derinlik → Kontrastlı renkler (heatmap'ten net ayrılacak) */
export function depthColorStops(kind) {
  if (kind === "metal") {
    // parlak kırmızı → turuncu → amber
    return [0xff2200, 0xff6600, 0xffaa00, 0xdd8800];
  }
  if (kind === "tunnel" || kind === "shaft") {
    // parlak sarı → altın → turuncu
    return [0xffcc00, 0xffaa00, 0xff8800, 0xdd7700];
  }
  if (kind === "tomb") {
    // mor → menekşe → pembe
    return [0xaa44ff, 0xcc66ff, 0xdd88ff, 0xbb55dd];
  }
  if (kind === "excavation") {
    // kum rengi → kahverengi (açık kazı alanı)
    return [0xe8c878, 0xc8a050, 0xa08040, 0x886830];
  }
  // room — parlak cyan → aqua (heatmap'ten çok farklı)
  return [0x00ddff, 0x00bbff, 0x0099ff, 0x0077dd];
}

export function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}

export function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (lerpChannel(ar, br, t) << 16) | (lerpChannel(ag, bg, t) << 8) | lerpChannel(ab, bb, t);
}

export function colorByDepth(depthM, kind) {
  const stops = depthColorStops(kind);
  const t = Math.min(1, Math.max(0, (Number(depthM) - 0.6) / 15));
  const x = t * (stops.length - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(stops.length - 1, i0 + 1);
  return lerpHex(stops[i0], stops[i1], x - i0);
}

export function edgeColorByDepth(depthM, kind) {
  const c = colorByDepth(depthM, kind);
  // Kenar rengi daha parlak — heatmap'ten net ayrılacak
  return lerpHex(c, 0xffffff, 0.45);
}
