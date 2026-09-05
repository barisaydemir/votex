/**
 * Geophysics Dual-Spectrum Heatmap Color Palette Generator
 * 
 * Anomaly Average (Mean Baseline \mu):
 * - Below Mean (\text{val} < \mu): Deep Blue -> White (Boşluk / Void)
 * - Mean Baseline (\text{val} = \mu): White [1.0, 1.0, 1.0]
 * - Above Mean (\text{val} > \mu): White -> Bright Red (Metal / High Anomaly)
 */

export function getRgbForValue(value, min, max, palette = "geophysics", mean = null) {
  const avg = mean !== null && Number.isFinite(mean) ? mean : (min + max) * 0.5;

  if (palette === "geophysics" || palette === "void_metal") {
    if (value <= avg) {
      // Below Mean: Void / Boşluk (Mavi -> Beyaz)
      const range = Math.max(1e-6, avg - min);
      const t = Math.max(0, Math.min(1, (avg - value) / range)); // t=0 at avg, t=1 at min
      // t=0 -> White [1, 1, 1], t=1 -> Deep Blue [0, 0.2, 1.0]
      const r = 1.0 - t * 1.0;
      const g = 1.0 - t * 0.8;
      const b = 1.0;
      return [r, g, b];
    } else {
      // Above Mean: Metal / Yüksek Anomali (Beyaz -> Kırmızı)
      const range = Math.max(1e-6, max - avg);
      const t = Math.max(0, Math.min(1, (value - avg) / range)); // t=0 at avg, t=1 at max
      // t=0 -> White [1, 1, 1], t=1 -> Bright Red [1, 0, 0]
      const r = 1.0;
      const g = 1.0 - t * 1.0;
      const b = 1.0 - t * 1.0;
      return [r, g, b];
    }
  } else if (palette === "jet") {
    const norm = Math.max(0, Math.min(1, max > min ? (value - min) / (max - min) : 0.5));
    let r = Math.max(0, Math.min(1, 1.5 - Math.abs(norm * 4.0 - 3.0)));
    let g = Math.max(0, Math.min(1, 1.5 - Math.abs(norm * 4.0 - 2.0)));
    let b = Math.max(0, Math.min(1, 1.5 - Math.abs(norm * 4.0 - 1.0)));
    return [r, g, b];
  } else if (palette === "rainbow") {
    const norm = Math.max(0, Math.min(1, max > min ? (value - min) / (max - min) : 0.5));
    const h = (1.0 - norm) * 240.0;
    return hslToRgb(h / 360, 1.0, 0.5);
  } else if (palette === "viridis") {
    const norm = Math.max(0, Math.min(1, max > min ? (value - min) / (max - min) : 0.5));
    const r = Math.sin(norm * Math.PI * 0.85);
    const g = norm;
    const b = Math.cos(norm * Math.PI * 0.5);
    return [r, g, b];
  } else {
    // Fallback Geophysics
    return getRgbForValue(value, min, max, "geophysics", avg);
  }
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r, g, b];
}

export function getCssGradient(palette = "geophysics") {
  if (palette === "geophysics" || palette === "void_metal") {
    return "linear-gradient(to right, #0033ff 0%, #ffffff 50%, #ff0000 100%)";
  } else if (palette === "jet") {
    return "linear-gradient(to right, #000080, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000, #800000)";
  } else if (palette === "rainbow") {
    return "linear-gradient(to right, #4b0082, #0000ff, #00ff00, #ffff00, #ff7f00, #ff0000)";
  } else if (palette === "viridis") {
    return "linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)";
  } else {
    return "linear-gradient(to right, #0033ff 0%, #ffffff 50%, #ff0000 100%)";
  }
}

export function updateLegendBar(palette = "geophysics") {
  const legendBar = document.getElementById("legend-bar");
  if (legendBar) {
    legendBar.style.background = getCssGradient(palette);
  }
}
