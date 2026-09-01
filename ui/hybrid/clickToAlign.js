/**
 * clickToAlign.js — Interaktif Koordinat Hizalama Aracı
 *
 * 2D harita/heatmap canvas üzerinde doğrudan tıklayarak referans noktaları seçme.
 * Tıklama yerinde açılan floating popup ile CSV koordinatı girme.
 * Hizalama sonrası grid overlay ile görsel doğrulama.
 *
 * Eski sistemin avantajlarını korur (CoordinateAligner entegrasyonu):
 *   - Max 5 nokta, otomatik regresyon
 *   - RMSE kalite skoru
 *   - Manuel/Auto mod geçişi
 *
 * Yeni:
 *   - Floating popup (canvas üzerinde, tıklama yerinde)
 *   - Sürükleerek nokta taşıma
 *   - Sağ tıkla ile silme
 *   - Hizalama grid overlay (doğrulama ızgarası)
 *   - Tooltip: image piksel + normalize koordinat bilgisi
 */

import { CoordinateAligner, drawControlPoints } from "./coordinateAlignment.js";
import { state } from "../app/state.js";
import { invalidate } from "../viewer/scene.js";

// ── Durum ──
let _points = [];          // [{ imageX, imageY, csvX, csvY, id }]
let _aligner = null;
let _canvas = null;
let _ctx = null;
let _popup = null;         // Floating popup div
let _gridOverlay = null;   // Grid overlay canvas
let _activeIdx = -1;       // Sürüklenebilen nokta indeksi
let _dragStart = null;     // Sürükleme başlangıcı
let _onApply = null;       // Hizalama uygulandığında callback
let _onClear = null;       // Temizlendiğinde callback
let _image = null;         // Harita görseli
let _bound = false;
let _tooltipEl = null;

const MAX_POINTS = 5;
const POINT_RADIUS = 7;

// ── Stil Sabitleri ──
const COLORS = {
  point: "#3edc8c",
  pointStroke: "#ffffff",
  pointActive: "#ffd27a",
  line: "rgba(62,220,140,0.4)",
  grid: "rgba(62,220,140,0.15)",
  gridStrong: "rgba(62,220,140,0.3)",
  popupBg: "rgba(10,16,24,0.95)",
  popupBorder: "#3edc8c",
};

// ── Başlatma ──

/**
 * Click-to-align aracını canvas'a bağla.
 *
 * @param {HTMLCanvasElement} canvas - Image/heatmap canvas
 * @param {HTMLImageElement} image - Harita görseli
 * @param {Object} opts - { onApply, onClear }
 * @returns {Function} Cleanup fonksiyonu
 */
export function initClickToAlign(canvas, image, opts = {}) {
  if (_bound) destroy();

  _canvas = canvas;
  _ctx = canvas.getContext("2d");
  _image = image;
  _onApply = opts.onApply || null;
  _onClear = opts.onClear || null;
  _points = [];
  _aligner = null;

  // Tooltip oluştur
  _createTooltip();

  // Event'leri bağla
  canvas.addEventListener("mousedown", _onMouseDown);
  canvas.addEventListener("mousemove", _onMouseMove);
  canvas.addEventListener("mouseup", _onMouseUp);
  canvas.addEventListener("contextmenu", _onContextMenu);
  canvas.addEventListener("mouseleave", _onMouseLeave);
  canvas.style.cursor = "crosshair";
  _bound = true;

  // Grid overlay canvas oluştur
  _createGridOverlay(canvas);

  console.log("[ClickToAlign] Başlatıldı");
  return destroy;
}

/**
 * Temizleme.
 */
export function destroy() {
  if (!_canvas) return;
  _canvas.removeEventListener("mousedown", _onMouseDown);
  _canvas.removeEventListener("mousemove", _onMouseMove);
  _canvas.removeEventListener("mouseup", _onMouseUp);
  _canvas.removeEventListener("contextmenu", _onContextMenu);
  _canvas.removeEventListener("mouseleave", _onMouseLeave);
  _canvas.style.cursor = "";
  _removePopup();
  _removeTooltip();
  _removeGridOverlay();
  _canvas = null;
  _ctx = null;
  _bound = false;
  _points = [];
  _aligner = null;
}

// ── Tooltip ──

function _createTooltip() {
  if (_tooltipEl) return;
  _tooltipEl = document.createElement("div");
  Object.assign(_tooltipEl.style, {
    position: "fixed",
    display: "none",
    background: COLORS.popupBg,
    border: "1px solid var(--line, #333)",
    borderRadius: "6px",
    padding: "4px 8px",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.62rem",
    color: "#c8d8c8",
    pointerEvents: "none",
    zIndex: "10001",
    whiteSpace: "pre-line",
    backdropFilter: "blur(6px)",
    maxWidth: "200px",
  });
  document.body.appendChild(_tooltipEl);
}

function _removeTooltip() {
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
}

function _showTooltip(clientX, clientY, normX, normY) {
  if (!_tooltipEl || !_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  const pxX = (normX * _canvas.width).toFixed(0);
  const pxY = (normY * _canvas.height).toFixed(0);
  _tooltipEl.textContent = `Piksel: ${pxX}, ${pxY}\nNormalize: ${normX.toFixed(3)}, ${normY.toFixed(3)}`;
  _tooltipEl.style.left = (clientX + 14) + "px";
  _tooltipEl.style.top = (clientY - 10) + "px";
  _tooltipEl.style.display = "block";
}

function _hideTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = "none";
}

// ── Grid Overlay ──

function _createGridOverlay(canvas) {
  _removeGridOverlay();
  _gridOverlay = document.createElement("canvas");
  _gridOverlay.width = canvas.width;
  _gridOverlay.height = canvas.height;
  Object.assign(_gridOverlay.style, {
    position: "absolute",
    left: canvas.offsetLeft + "px",
    top: canvas.offsetTop + "px",
    width: canvas.style.width || canvas.width + "px",
    height: canvas.style.height || canvas.height + "px",
    pointerEvents: "none",
    zIndex: "5",
    opacity: "0",
    transition: "opacity 0.3s ease",
  });
  canvas.parentElement?.appendChild(_gridOverlay);
}

function _removeGridOverlay() {
  if (_gridOverlay) { _gridOverlay.remove(); _gridOverlay = null; }
}

function _drawGrid() {
  if (!_gridOverlay || !_aligner || _points.length < 2 || !_canvas) {
    if (_gridOverlay) _gridOverlay.style.opacity = "0";
    return;
  }

  const gCtx = _gridOverlay.getContext("2d");
  const w = _gridOverlay.width;
  const h = _gridOverlay.height;
  gCtx.clearRect(0, 0, w, h);

  const transform = _aligner.transform;
  if (!transform) { _gridOverlay.style.opacity = "0"; return; }

  const nLines = 12;

  // ── 1) Image koordinat ızgarası (yeşil, ince) ──
  gCtx.strokeStyle = "rgba(62,220,140,0.2)";
  gCtx.lineWidth = 1;
  gCtx.setLineDash([]);

  for (let i = 0; i <= nLines; i++) {
    const t = i / nLines;
    const x = t * w;
    const y = t * h;
    gCtx.beginPath(); gCtx.moveTo(x, 0); gCtx.lineTo(x, h); gCtx.stroke();
    gCtx.beginPath(); gCtx.moveTo(0, y); gCtx.lineTo(w, y); gCtx.stroke();
  }

  // ── 2) CSV koordinat ızgarası (turuncu, transformlanmış) ──
  // Her CSV grid çizgisini ters transform ile image uzayına projekte et
  gCtx.strokeStyle = "rgba(255,180,60,0.45)";
  gCtx.lineWidth = 1.2;
  gCtx.setLineDash([6, 3]);

  // CSV sınırlarını hesapla
  const { scaleX, scaleY, offsetX, offsetY } = transform;
  const invScaleX = 1 / (scaleX || 1);
  const invScaleY = 1 / (scaleY || 1);

  // CSV ızgarası: her metre aralığında (veya akıllı adım)
  const csvMinX = -offsetX * invScaleX;
  const csvMaxX = (1 - offsetX) * invScaleX;
  const csvMinY = -offsetY * invScaleY;
  const csvMaxY = (1 - offsetY) * invScaleY;
  const csvRangeX = csvMaxX - csvMinX;
  const csvRangeY = csvMaxY - csvMinY;

  // Akıllı adım seç (0.5, 1, 2, 5, 10, 20, 50...)
  function niceStep(range, targetLines) {
    const raw = range / targetLines;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    if (norm <= 1.5) return mag;
    if (norm <= 3.5) return 2 * mag;
    if (norm <= 7.5) return 5 * mag;
    return 10 * mag;
  }

  const stepX = niceStep(csvRangeX, nLines);
  const stepY = niceStep(csvRangeY, nLines);

  // CSV X çizgileri (dikey)
  const startCsvX = Math.ceil(csvMinX / stepX) * stepX;
  for (let csvX = startCsvX; csvX <= csvMaxX; csvX += stepX) {
    const imgX = (csvX - offsetX) / scaleX;
    const px = imgX * w;
    gCtx.beginPath(); gCtx.moveTo(px, 0); gCtx.lineTo(px, h); gCtx.stroke();

    // Koordinat etiketi
    gCtx.fillStyle = "rgba(255,180,60,0.7)";
    gCtx.font = `bold ${Math.max(9, w * 0.012)}px monospace`;
    gCtx.fillText(csvX.toFixed(csvX % 1 === 0 ? 0 : 1) + "m", px + 2, 12);
  }

  // CSV Y çizgileri (yatay)
  const startCsvY = Math.ceil(csvMinY / stepY) * stepY;
  for (let csvY = startCsvY; csvY <= csvMaxY; csvY += stepY) {
    const imgY = (csvY - offsetY) / scaleY;
    const py = imgY * h;
    gCtx.beginPath(); gCtx.moveTo(0, py); gCtx.lineTo(w, py); gCtx.stroke();

    // Koordinat etiketi
    gCtx.fillStyle = "rgba(255,180,60,0.7)";
    gCtx.font = `bold ${Math.max(9, w * 0.012)}px monospace`;
    gCtx.fillText(csvY.toFixed(csvY % 1 === 0 ? 0 : 1) + "m", 2, py - 2);
  }

  gCtx.setLineDash([]);

  // ── 3) Köşe / Referans noktaları etrafında hata vektörleri ──
  // Her referans noktasında image ve CSV'nin kesişme noktalarını göster
  gCtx.lineWidth = 2;
  for (let i = 0; i < _points.length; i++) {
    const p = _points[i];
    const px = p.imageX * w;
    const py = p.imageY * h;

    // Image noktası (yeşil daire)
    gCtx.beginPath();
    gCtx.arc(px, py, 5, 0, Math.PI * 2);
    gCtx.fillStyle = "rgba(62,220,140,0.9)";
    gCtx.fill();
    gCtx.strokeStyle = "#fff";
    gCtx.lineWidth = 1.5;
    gCtx.stroke();

    // Koordinat etrafında duyarlılık halkası (transform hassasiyeti)
    const epsPx = 3;
    const epsCsvX = epsPx / w * Math.abs(scaleX);
    const epsCsvY = epsPx / h * Math.abs(scaleY);
    gCtx.beginPath();
    gCtx.arc(px, py, 12, 0, Math.PI * 2);
    gCtx.strokeStyle = "rgba(62,220,140,0.2)";
    gCtx.lineWidth = 1;
    gCtx.stroke();
  }

  // ── 4) Kalite rozeti (sol üst) ──
  const q = _aligner.qualityCheck();
  const rmse = _aligner.rmse;
  const scoreColor = q.score >= 70 ? "#3edc8c" : q.score >= 40 ? "#eab308" : "#f97316";

  // Arka plan
  gCtx.fillStyle = "rgba(10,16,24,0.85)";
  gCtx.beginPath();
  gCtx.roundRect(4, h - 48, 180, 44, 6);
  gCtx.fill();
  gCtx.strokeStyle = "rgba(62,220,140,0.3)";
  gCtx.lineWidth = 1;
  gCtx.stroke();

  gCtx.font = `bold ${Math.max(10, w * 0.014)}px monospace`;
  gCtx.fillStyle = scoreColor;
  gCtx.fillText(`${q.score}/100 — ${q.quality}`, 10, h - 30);

  gCtx.font = `${Math.max(9, w * 0.012)}px monospace`;
  gCtx.fillStyle = "#8ea8b8";
  gCtx.fillText(`RMSE: ${rmse.toFixed(2)}m | ${_points.length} nokta`, 10, h - 14);

  // ── 5) Lejant (sağ alt) ──
  const legW = 160;
  const legH = 42;
  const legX = w - legW - 6;
  const legY = h - legH - 6;

  gCtx.fillStyle = "rgba(10,16,24,0.85)";
  gCtx.beginPath();
  gCtx.roundRect(legX, legY, legW, legH, 6);
  gCtx.fill();
  gCtx.strokeStyle = "rgba(255,255,255,0.08)";
  gCtx.lineWidth = 1;
  gCtx.stroke();

  // Image çizgisi
  gCtx.strokeStyle = "rgba(62,220,140,0.6)";
  gCtx.lineWidth = 1.5;
  gCtx.setLineDash([]);
  gCtx.beginPath(); gCtx.moveTo(legX + 8, legY + 14); gCtx.lineTo(legX + 38, legY + 14); gCtx.stroke();
  gCtx.fillStyle = "rgba(62,220,140,0.8)";
  gCtx.font = `${Math.max(9, w * 0.011)}px sans-serif`;
  gCtx.fillText("Image ızgarası", legX + 44, legY + 17);

  // CSV çizgisi
  gCtx.strokeStyle = "rgba(255,180,60,0.7)";
  gCtx.lineWidth = 1.2;
  gCtx.setLineDash([6, 3]);
  gCtx.beginPath(); gCtx.moveTo(legX + 8, legY + 30); gCtx.lineTo(legX + 38, legY + 30); gCtx.stroke();
  gCtx.setLineDash([]);
  gCtx.fillStyle = "rgba(255,180,60,0.8)";
  gCtx.fillText("CSV ızgarası (metre)", legX + 44, legY + 33);

  _gridOverlay.style.opacity = "1";
}

// ── Floating Popup ──

function _showPopup(canvasX, canvasY, clientX, clientY, pointIdx) {
  _removePopup();

  const normX = canvasX / _canvas.width;
  const normY = canvasY / _canvas.height;

  _popup = document.createElement("div");
  Object.assign(_popup.style, {
    position: "fixed",
    left: (clientX + 12) + "px",
    top: (clientY - 8) + "px",
    background: COLORS.popupBg,
    border: `1px solid ${COLORS.popupBorder}`,
    borderRadius: "8px",
    padding: "8px 10px",
    zIndex: "10002",
    minWidth: "180px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    backdropFilter: "blur(8px)",
    fontFamily: "var(--font-sans, sans-serif)",
  });

  const isEdit = pointIdx >= 0;
  const existing = isEdit ? _points[pointIdx] : null;

  _popup.innerHTML = `
    <div style="font-size:0.65rem;color:#3edc8c;font-weight:600;margin-bottom:4px;">
      ${isEdit ? `P${pointIdx + 1} Düzenle` : `P${_points.length + 1} Ekle`}
    </div>
    <div style="font-size:0.58rem;color:#666;margin-bottom:6px;">
      Image: (${normX.toFixed(3)}, ${normY.toFixed(3)})
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
      <label style="font-size:0.6rem;color:#8ea8b8;min-width:14px;">X</label>
      <input type="number" id="cta-csv-x" step="0.1" value="${existing?.csvX ?? 0}"
        style="flex:1;width:60px;padding:3px 5px;font-size:0.65rem;background:#0e1520;border:1px solid #333;border-radius:4px;color:#e0e0e0;outline:none;"
        placeholder="metre" />
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px;">
      <label style="font-size:0.6rem;color:#8ea8b8;min-width:14px;">Y</label>
      <input type="number" id="cta-csv-y" step="0.1" value="${existing?.csvY ?? 0}"
        style="flex:1;width:60px;padding:3px 5px;font-size:0.65rem;background:#0e1520;border:1px solid #333;border-radius:4px;color:#e0e0e0;outline:none;"
        placeholder="metre" />
    </div>
    <div style="display:flex;gap:4px;">
      <button id="cta-apply" style="flex:1;padding:4px 8px;font-size:0.62rem;font-weight:600;background:rgba(62,220,140,0.15);border:1px solid #3edc8c;color:#3edc8c;border-radius:4px;cursor:pointer;">
        ${isEdit ? "Güncelle" : "Ekle"}
      </button>
      <button id="cta-cancel" style="padding:4px 8px;font-size:0.62rem;background:rgba(255,106,74,0.1);border:1px solid #ff6a4a;color:#ff6a4a;border-radius:4px;cursor:pointer;">
        ✕
      </button>
    </div>
    <div style="font-size:0.52rem;color:#555;margin-top:4px;">Enter = ekle · Esc = kapat</div>
  `;

  document.body.appendChild(_popup);

  // X input'una odaklan
  const xInput = _popup.querySelector("#cta-csv-x");
  const yInput = _popup.querySelector("#cta-csv-y");
  if (xInput) { xInput.focus(); xInput.select(); }

  // Enter = uygula
  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      _applyPopup(pointIdx, normX, normY);
    } else if (e.key === "Escape") {
      _removePopup();
    }
  };
  _popup.addEventListener("keydown", onKey);

  // Butonlar
  _popup.querySelector("#cta-apply")?.addEventListener("click", () => {
    _applyPopup(pointIdx, normX, normY);
  });
  _popup.querySelector("#cta-cancel")?.addEventListener("click", () => {
    _removePopup();
  });
}

function _applyPopup(pointIdx, normX, normY) {
  if (!_popup) return;
  const csvX = Number(_popup.querySelector("#cta-csv-x")?.value) || 0;
  const csvY = Number(_popup.querySelector("#cta-csv-y")?.value) || 0;

  if (pointIdx >= 0) {
    // Güncelleme
    _points[pointIdx].csvX = csvX;
    _points[pointIdx].csvY = csvY;
  } else {
    // Yeni nokta
    if (_points.length >= MAX_POINTS) return;
    _points.push({
      imageX: normX,
      imageY: normY,
      csvX,
      csvY,
      id: `p${_points.length + 1}`,
    });
  }

  _removePopup();
  _recompute();
  _redraw();
}

function _removePopup() {
  if (_popup) { _popup.remove(); _popup = null; }
}

// ── Event Handlers ──

function _getNormCoords(e) {
  const rect = _canvas.getBoundingClientRect();
  const displayX = e.clientX - rect.left;
  const displayY = e.clientY - rect.top;
  const normX = Math.max(0, Math.min(1, (displayX / rect.width) * (_canvas.width / _canvas.width)));
  const normY = Math.max(0, Math.min(1, (displayY / rect.height) * (_canvas.height / _canvas.height)));
  return { normX, normY, clientX: e.clientX, clientY: e.clientY };
}

function _hitTest(normX, normY) {
  const threshold = POINT_RADIUS / _canvas.width * 2;
  for (let i = _points.length - 1; i >= 0; i--) {
    const p = _points[i];
    const dx = p.imageX - normX;
    const dy = p.imageY - normY;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
  }
  return -1;
}

function _onMouseDown(e) {
  if (e.button === 2) return; // Sağ tık ayrı handle
  const { normX, normY, clientX, clientY } = _getNormCoords(e);

  // Var olan noktaya tıklandı mı? → sürükleme başlat
  const hitIdx = _hitTest(normX, normY);
  if (hitIdx >= 0) {
    _activeIdx = hitIdx;
    _dragStart = { normX, normY, startX: clientX, startY: clientY };
    e.preventDefault();
    return;
  }

  // Boş alana tıklandı → popup aç
  if (_points.length >= MAX_POINTS) return;
  const rect = _canvas.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left) / rect.width * _canvas.width;
  const canvasY = (e.clientY - rect.top) / rect.height * _canvas.height;
  _showPopup(canvasX, canvasY, clientX, clientY, -1);
}

function _onMouseMove(e) {
  const { normX, normY, clientX, clientY } = _getNormCoords(e);

  // Sürükleme devam ediyor mu?
  if (_activeIdx >= 0 && _dragStart) {
    const p = _points[_activeIdx];
    const rect = _canvas.getBoundingClientRect();
    p.imageX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    p.imageY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    _recompute();
    _redraw();
    return;
  }

  // Hover tooltip
  const hitIdx = _hitTest(normX, normY);
  if (hitIdx >= 0) {
    const p = _points[hitIdx];
    _showTooltip(clientX, clientY, p.imageX, p.imageY);
    _canvas.style.cursor = "grab";
  } else {
    _hideTooltip();
    _canvas.style.cursor = "crosshair";
  }
}

function _onMouseUp(e) {
  if (_activeIdx >= 0) {
    _activeIdx = -1;
    _dragStart = null;
    _canvas.style.cursor = "crosshair";
  }
}

function _onContextMenu(e) {
  e.preventDefault();
  const { normX, normY } = _getNormCoords(e);

  // Sağ tık → nokta sil
  const hitIdx = _hitTest(normX, normY);
  if (hitIdx >= 0) {
    _points.splice(hitIdx, 1);
    _points.forEach((p, i) => p.id = `p${i + 1}`);
    _recompute();
    _redraw();
  }
}

function _onMouseLeave() {
  _hideTooltip();
  if (_activeIdx >= 0) {
    _activeIdx = -1;
    _dragStart = null;
  }
}

// ── Hizalama Hesaplama ──

function _recompute() {
  _aligner = null;
  if (_points.length < 2) {
    state.manualAligner = null;
    _drawGrid();
    return;
  }

  _aligner = new CoordinateAligner();
  for (const p of _points) {
    _aligner.addControlPoint(p.imageX, p.imageY, p.csvX, p.csvY);
  }
  _aligner.computeManualTransform();
  state.manualAligner = _aligner;

  // Grid overlay güncelle
  _drawGrid();

  // Callback
  if (_onApply) _onApply(_aligner);

  const q = _aligner.qualityCheck();
  console.log(`[ClickToAlign] Hizalama: ${q.quality} (${q.score}/100), RMSE=${_aligner.rmse.toFixed(2)}m`);
}

function _redraw() {
  if (!_ctx || !_canvas) return;

  // Image'ı yeniden çiz
  if (_image) {
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _ctx.drawImage(_image, 0, 0, _canvas.width, _canvas.height);
  }

  // Noktaları çiz
  if (_points.length > 0) {
    _drawAlignedPoints();
  }
}

function _drawAlignedPoints() {
  const w = _canvas.width;
  const h = _canvas.height;

  // Çizgiler (noktalar arası)
  if (_points.length >= 2) {
    _ctx.beginPath();
    _ctx.setLineDash([4, 4]);
    _ctx.strokeStyle = COLORS.line;
    _ctx.lineWidth = 1.5;
    for (let i = 0; i < _points.length; i++) {
      const px = _points[i].imageX * w;
      const py = _points[i].imageY * h;
      if (i === 0) _ctx.moveTo(px, py);
      else _ctx.lineTo(px, py);
    }
    _ctx.stroke();
    _ctx.setLineDash([]);
  }

  // Noktalar
  for (let i = 0; i < _points.length; i++) {
    const p = _points[i];
    const px = p.imageX * w;
    const py = p.imageY * h;
    const isActive = i === _activeIdx;

    // Dış halka (gölge)
    _ctx.beginPath();
    _ctx.arc(px, py, POINT_RADIUS + 3, 0, Math.PI * 2);
    _ctx.fillStyle = "rgba(0,0,0,0.4)";
    _ctx.fill();

    // Nokta
    _ctx.beginPath();
    _ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
    _ctx.fillStyle = isActive ? COLORS.pointActive : COLORS.point;
    _ctx.fill();
    _ctx.strokeStyle = COLORS.pointStroke;
    _ctx.lineWidth = 2;
    _ctx.stroke();

    // Etiket
    _ctx.fillStyle = "#fff";
    _ctx.font = "bold 10px monospace";
    _ctx.fillText(`P${i + 1}`, px + 10, py - 4);

    // CSV koordinatı
    if (p.csvX !== 0 || p.csvY !== 0) {
      _ctx.font = "9px monospace";
      _ctx.fillStyle = "#3edc8c";
      _ctx.fillText(`→ ${p.csvX.toFixed(1)}, ${p.csvY.toFixed(1)}m`, px + 10, py + 8);
    }
  }
}

// ── Public API ──

/**
 * Mevcut noktaları döndür.
 */
export function getPoints() {
  return [..._points];
}

/**
 * Noktaları manuel olarak ayarla.
 */
export function setPoints(points) {
  _points = points.map((p, i) => ({ ...p, id: p.id || `p${i + 1}` }));
  _recompute();
  _redraw();
}

/**
 * Tüm noktaları temizle.
 */
export function clearPoints() {
  _points = [];
  _aligner = null;
  state.manualAligner = null;
  if (_gridOverlay) _gridOverlay.style.opacity = "0";
  _redraw();
  if (_onClear) _onClear();
}

/**
 * Hizalama kalite bilgisini döndür.
 */
export function getQuality() {
  if (!_aligner) return null;
  return _aligner.qualityCheck();
}

/**
 * Grid overlay görünürlüğünü ayarla.
 */
export function toggleGrid(show) {
  if (_gridOverlay) {
    _gridOverlay.style.opacity = show ? "1" : "0";
  }
}

/**
 * Aktif hizalamayı uygula (harita üzerine bindir).
 */
export function applyAlignment() {
  if (_points.length < 2) return null;
  _recompute();
  return _aligner;
}
