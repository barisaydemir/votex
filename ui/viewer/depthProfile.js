/**
 * depthProfile.js — Derinlik Profili Kesiti
 *
 * Seçili noktadan yatay veya dikey manyetik yoğunluk profili çizer.
 * Profil, CSV veya image grid verisinden kesit alarak manyetik
 * değerlerin derinlik/uzaklık değişimini 2D grafik olarak gösterir.
 *
 * Kullanım:
 *   import { initDepthProfile, drawProfile } from "./depthProfile.js";
 *   initDepthProfile(canvasElement);
 *   drawProfile(grid, point, 'horizontal');
 */

import { state } from '../app/state.js';
import { invalidate } from './scene.js';

// ── Durum ──
let _canvas = null;
let _ctx = null;
let _active = false;
let _mode = 'horizontal'; // 'horizontal' veya 'vertical'
let _selectedPoint = null;
let _profileData = null;
let _grid = null;
let _gridRes = 64;
let _poolSizeM = 30;

// ── Renkler ──
const COLORS = {
  bg: '#0a0e14',
  grid: 'rgba(62,220,140,0.15)',
  gridLabel: '#555',
  line: '#3edc8c',
  fill: 'rgba(62,220,140,0.2)',
  positive: '#e85858',
  negative: '#5888e8',
  center: '#ffd27a',
  text: '#c8d8c8',
  axis: '#666',
  title: '#8ea8b8',
};

// ── Başlatma ──

/**
 * Derinlik profili canvas'ını başlat.
 * @param {HTMLCanvasElement} canvas
 */
export function initDepthProfile(canvas) {
  if (!canvas) return;
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _active = true;

  // Canvas boyutunu ayarla
  _canvas.width = _canvas.clientWidth || 400;
  _canvas.height = _canvas.clientHeight || 150;

  console.log('[DepthProfile] Başlatıldı');
}

/**
 * Profili çiz.
 *
 * @param {Array} grid - Fusion grid [{x, y, magnetic, confidence, sources}]
 * @param {Object} point - Seçili nokta {x, z} (metre)
 * @param {string} mode - 'horizontal' veya 'vertical'
 * @param {Object} opts - { poolSizeM, gridRes, structures }
 */
export function drawProfile(grid, point, mode = 'horizontal', opts = {}) {
  if (!_canvas || !_ctx || !grid || grid.length === 0 || !point) return;

  _grid = grid;
  _gridRes = opts.gridRes || 64;
  _poolSizeM = opts.poolSizeM || 30;
  _mode = mode;
  _selectedPoint = point;

  const W = _canvas.width;
  const H = _canvas.height;
  const margin = { top: 25, bottom: 25, left: 45, right: 15 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  // Temizle
  _ctx.fillStyle = COLORS.bg;
  _ctx.fillRect(0, 0, W, H);

  // ── Kesit çizgisini bul ──
  const slice = extractSlice(grid, point, mode, _poolSizeM, _gridRes);
  if (slice.length === 0) {
    _ctx.fillStyle = COLORS.text;
    _ctx.font = '11px monospace';
    _ctx.textAlign = 'center';
    _ctx.fillText('Bu noktada kesit verisi yok', W / 2, H / 2);
    return;
  }

  // ── İstatistikler ──
  const values = slice.map(s => s.value);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const vRange = (vMax - vMin) || 1;
  const vAbsMax = Math.max(Math.abs(vMin), Math.abs(vMax));
  const distMin = slice[0].distance;
  const distMax = slice[slice.length - 1].distance;
  const distRange = (distMax - distMin) || 1;

  // ── Izgara çizgileri ──
  _ctx.strokeStyle = COLORS.grid;
  _ctx.lineWidth = 0.5;

  // Yatay ızgara (değer ekseninde)
  const vStep = niceStep(vRange, 5);
  const vStart = Math.ceil(vMin / vStep) * vStep;
  for (let v = vStart; v <= vMax; v += vStep) {
    const y = margin.top + plotH - ((v - vMin) / vRange) * plotH;
    _ctx.beginPath();
    _ctx.moveTo(margin.left, y);
    _ctx.lineTo(margin.left + plotW, y);
    _ctx.stroke();

    // Etiket
    _ctx.fillStyle = COLORS.gridLabel;
    _ctx.font = '9px monospace';
    _ctx.textAlign = 'right';
    _ctx.fillText(formatNt(v), margin.left - 4, y + 3);
  }

  // Dikey ızgara (mesafe ekseninde)
  const dStep = niceStep(distRange, 6);
  const dStart = Math.ceil(distMin / dStep) * dStep;
  for (let d = dStart; d <= distMax; d += dStep) {
    const x = margin.left + ((d - distMin) / distRange) * plotW;
    _ctx.beginPath();
    _ctx.moveTo(x, margin.top);
    _ctx.lineTo(x, margin.top + plotH);
    _ctx.stroke();

    // Etiket
    _ctx.fillStyle = COLORS.gridLabel;
    _ctx.font = '9px monospace';
    _ctx.textAlign = 'center';
    _ctx.fillText(d.toFixed(1) + 'm', x, H - margin.bottom + 14);
  }

  // ── Sıfır çizgisi ──
  if (vMin < 0 && vMax > 0) {
    const zeroY = margin.top + plotH - ((0 - vMin) / vRange) * plotH;
    _ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    _ctx.lineWidth = 1;
    _ctx.setLineDash([4, 4]);
    _ctx.beginPath();
    _ctx.moveTo(margin.left, zeroY);
    _ctx.lineTo(margin.left + plotW, zeroY);
    _ctx.stroke();
    _ctx.setLineDash([]);
  }

  // ── Alan grafiği (fill) ──
  const zeroY = vMin < 0 && vMax > 0
    ? margin.top + plotH - ((0 - vMin) / vRange) * plotH
    : margin.top + plotH;

  _ctx.beginPath();
  _ctx.moveTo(margin.left, zeroY);
  for (let i = 0; i < slice.length; i++) {
    const x = margin.left + ((slice[i].distance - distMin) / distRange) * plotW;
    const y = margin.top + plotH - ((slice[i].value - vMin) / vRange) * plotH;
    _ctx.lineTo(x, y);
  }
  _ctx.lineTo(margin.left + plotW, zeroY);
  _ctx.closePath();

  // Pozitif/negatif renkli dolgu
  _ctx.fillStyle = COLORS.fill;
  _ctx.fill();

  // ── Çizgi ──
  _ctx.beginPath();
  _ctx.strokeStyle = COLORS.line;
  _ctx.lineWidth = 1.5;
  for (let i = 0; i < slice.length; i++) {
    const x = margin.left + ((slice[i].distance - distMin) / distRange) * plotW;
    const y = margin.top + plotH - ((slice[i].value - vMin) / vRange) * plotH;
    if (i === 0) _ctx.moveTo(x, y);
    else _ctx.lineTo(x, y);
  }
  _ctx.stroke();

  // ── Seçili nokta ──
  const centerX = margin.left + ((0 - distMin) / distRange) * plotW;
  const centerIdx = slice.findIndex(s => s.distance >= 0);
  const centerY = centerIdx >= 0
    ? margin.top + plotH - ((slice[centerIdx].value - vMin) / vRange) * plotH
    : zeroY;

  _ctx.beginPath();
  _ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
  _ctx.fillStyle = COLORS.center;
  _ctx.fill();
  _ctx.strokeStyle = '#000';
  _ctx.lineWidth = 1;
  _ctx.stroke();

  // Merkez çizgisi
  _ctx.strokeStyle = 'rgba(255,210,122,0.3)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([2, 2]);
  _ctx.beginPath();
  _ctx.moveTo(centerX, margin.top);
  _ctx.lineTo(centerX, margin.top + plotH);
  _ctx.stroke();
  _ctx.setLineDash([]);

  // ── Eksen başlıkları ──
  _ctx.fillStyle = COLORS.title;
  _ctx.font = '10px monospace';
  _ctx.textAlign = 'center';

  if (mode === 'horizontal') {
    _ctx.fillText('Mesafe (X ekseni)', margin.left + plotW / 2, H - 2);
  } else {
    _ctx.fillText('Mesafe (Z ekseni)', margin.left + plotW / 2, H - 2);
  }

  // Y ekseni başlığı
  _ctx.save();
  _ctx.translate(12, margin.top + plotH / 2);
  _ctx.rotate(-Math.PI / 2);
  _ctx.fillText('Manyetik (nT)', 0, 0);
  _ctx.restore();

  // ── Başlık ──
  _ctx.fillStyle = COLORS.text;
  _ctx.font = '10px monospace';
  _ctx.textAlign = 'left';
  const modeLabel = mode === 'horizontal' ? 'YATAY' : 'DİKEY';
  const ptLabel = `(${point.x.toFixed(1)}, ${point.z.toFixed(1)})`;
  _ctx.fillText(`${modeLabel} KESİT ${ptLabel}`, margin.left, 14);

  // ── İstatistik ──
  _ctx.fillStyle = COLORS.gridLabel;
  _ctx.font = '9px monospace';
  _ctx.textAlign = 'right';
  _ctx.fillText(
    `nT: ${vMin.toFixed(0)}..${vMax.toFixed(0)} | Ort: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(0)}`,
    W - margin.right, 14
  );

  // Profil verisini sakla
  _profileData = { slice, mode, point, vMin, vMax, distMin, distMax };
}

// ── Kesit Çıkarma ──

/**
 * Grid'den yatay veya dikey kesit çıkarır.
 * Seçili noktadan geçen doğru boyunca interpolasyon yapar.
 *
 * @param {Array} grid - [{x, y, magnetic, confidence}]
 * @param {Object} point - {x, z}
 * @param {string} mode - 'horizontal' veya 'vertical'
 * @param {number} poolSizeM
 * @param {number} gridRes
 * @returns {Array} [{distance, value, gx, gy}]
 */
function extractSlice(grid, point, mode, poolSizeM, gridRes) {
  const slice = [];
  const halfPool = poolSizeM / 2;

  // Grid hücre boyutu
  const cellSize = poolSizeM / gridRes;

  // Kesit çizgisi boyunca örneklem al
  const sampleCount = 80; // Yeterince akıcı
  const halfWidth = poolSizeM / 2;

  for (let i = 0; i < sampleCount; i++) {
    const t = (i / (sampleCount - 1)) * 2 - 1; // -1..1
    const dist = t * halfWidth;

    let wx, wz;
    if (mode === 'horizontal') {
      wx = point.x + dist;
      wz = point.z;
    } else {
      wx = point.x;
      wz = point.z + dist;
    }

    // Grid indeksine çevir
    const gx = Math.round(((wx + halfPool) / poolSizeM) * (gridRes - 1));
    const gy = Math.round(((wz + halfPool) / poolSizeM) * (gridRes - 1));

    // En yakın grid hücresini bul
    const value = findNearestGridValue(grid, gx, gy, gridRes);

    slice.push({
      distance: dist,
      value,
      gx,
      gy,
      wx,
      wz,
    });
  }

  return slice;
}

/**
 * Belirli grid koordinatındaki değeri bulur (en yakın komşu ile interpolasyon).
 */
function findNearestGridValue(grid, targetGx, targetGy, gridRes) {
  // Doğrudan eşleşme ara
  for (const cell of grid) {
    if (cell.gx === targetGx && cell.gy === targetGy) {
      return cell.magnetic || cell.nT || 0;
    }
  }

  // En yakın komşuyu bul
  let bestDist = Infinity;
  let bestVal = 0;
  for (const cell of grid) {
    const dx = (cell.gx || 0) - targetGx;
    const dy = (cell.gy || 0) - targetGy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestVal = cell.magnetic || cell.nT || 0;
    }
  }

  return bestVal;
}

// ── Yardımcı Fonksiyonlar ──

/**
 * Güzel adım aralığı hesapla.
 */
function niceStep(range, maxTicks) {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm <= 1.5) step = 1 * mag;
  else if (norm <= 3.5) step = 2 * mag;
  else if (norm <= 7.5) step = 5 * mag;
  else step = 10 * mag;
  return step || 1;
}

/**
 * nT değerini formatla.
 */
function formatNt(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}

// ── API ──

/**
 * Profil modunu değiştir.
 */
export function setProfileMode(mode) {
  _mode = mode === 'vertical' ? 'vertical' : 'horizontal';
}

/**
 * Aktif profil modunu döndür.
 */
export function getProfileMode() {
  return _mode;
}

/**
 * Son profil verisini döndür.
 */
export function getLastProfile() {
  return _profileData;
}

/**
 * Profili PNG olarak dışa aktar.
 */
export function exportProfilePNG() {
  if (!_canvas) return null;
  return _canvas.toDataURL('image/png');
}

/**
 * Temizle.
 */
export function destroyDepthProfile() {
  _canvas = null;
  _ctx = null;
  _active = false;
  _profileData = null;
}
