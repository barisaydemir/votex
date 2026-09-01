/**
 * annotations.js — Harita üzerinde tıklama ile annotation/not ekleme.
 *
 * Kullanıcı 2D önizleme haritasına tıkladığında sabit bir pin bırakır ve
 * not yazar. Notlar normalize koordinatlarda (0-1) saklanır ve harita
 * yeniden yüklendiğinde konum korunur.
 *
 * Özellikler:
 *   - Tıklama ile pin ekleme (normalize koordinat)
 *   - Floating input ile not yazma
 *   - Silme (sağ tık veya X butonu)
 *   - Pin renkleri: kırmızı (varsayılan), sarı, yeşil, mavi
 *   - Preview-marks canvas üzerine render
 *
 * Kullanım:
 *   import { bindAnnotations, toggleAnnotationMode } from "./annotations.js";
 *   bindAnnotations();
 */
import { $, state } from "../app/state.js";

// ── Sabitler ──
const PIN_COLORS = ["#e23a3a", "#f5c542", "#3edc8c", "#4a9eff"];
const PIN_RADIUS = 8;
const PIN_OUTER = 11;
const FONT_SIZE = 10;

// ── Durum ──
let mode = false;         // Annotation modu açık mı
let pendingPos = null;    // Eklenen pin'in normalize koordinatı
let editingIdx = -1;      // Düzenlenen annotation indeksi (yeni = -1)
let floatingEl = null;    // Floating input popup'ı
let bound = false;

// ── State accessor ──
function getAnnotations() {
  if (!state.annotations) state.annotations = [];
  return state.annotations;
}

// ── Mod toggle ──
export function toggleAnnotationMode() {
  mode = !mode;
  updateButton();
  updateCursor();
  if (!mode) hideFloating();
  return mode;
}

export function isAnnotationMode() {
  return mode;
}

// ── Event binding ──
export function bindAnnotations() {
  if (bound) return;
  bound = true;

  const wrap = document.getElementById("preview-wrap");
  if (!wrap) return;

  // Tıklama → pin ekle
  wrap.addEventListener("click", onPreviewClick);

  // Sağ tık → pin sil
  wrap.addEventListener("contextmenu", onPreviewRightClick);

  // Butonu bağla
  const btn = $("btn-annotate");
  if (btn) btn.addEventListener("click", toggleAnnotationMode);

  // Escape → modu kapat
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode) {
      toggleAnnotationMode();
      e.preventDefault();
    }
  });

  // Pencere yeniden boyutlandırıldığında yeniden çiz
  window.addEventListener("resize", () => {
    if (getAnnotations().length) renderAnnotationPins();
  });
}

// ── Tıklama olayı ──
function onPreviewClick(e) {
  if (!mode) return;

  const img = $("preview");
  const canvas = $("preview-marks");
  if (!img || !canvas || !img.naturalWidth) return;

  // Tıklama konumunu normalize (0-1) koordinata çevir
  const rect = img.getBoundingClientRect();
  const drawInfo = getDrawInfo(img, rect);
  if (!drawInfo) return;

  const { offsetX, offsetY, drawW, drawH } = drawInfo;

  // Tıklama relative to canvas display
  const relX = e.clientX - rect.left;
  const relY = e.clientY - rect.top;

  // Letterbox/pillarbox alanını hesaba kat
  const normX = (relX - offsetX) / drawW;
  const normY = (relY - offsetY) / drawH;

  // Sınır kontrolü
  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

  pendingPos = { x: normX, y: normY };
  editingIdx = -1; // Yeni annotation
  showFloating(normX, normY, "");

  e.stopPropagation();
}

// ── Sağ tık → pin sil ──
function onPreviewRightClick(e) {
  if (getAnnotations().length === 0) return;

  const img = $("preview");
  if (!img || !img.naturalWidth) return;

  const rect = img.getBoundingClientRect();
  const drawInfo = getDrawInfo(img, rect);
  if (!drawInfo) return;

  const relX = e.clientX - rect.left;
  const relY = e.clientY - rect.top;
  const { offsetX, offsetY, drawW, drawH } = drawInfo;

  const normX = (relX - offsetX) / drawW;
  const normY = (relY - offsetY) / drawH;

  // En yakın pin'i bul (eşik: 0.03)
  const annotations = getAnnotations();
  let closestIdx = -1;
  let closestDist = Infinity;

  annotations.forEach((a, i) => {
    const dx = a.x - normX;
    const dy = a.y - normY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });

  if (closestIdx >= 0 && closestDist < 0.05) {
    annotations.splice(closestIdx, 1);
    renderAnnotationPins();
    e.preventDefault();
  }
}

// ── Floating input popup ──
function showFloating(nx, ny, text) {
  hideFloating();

  const img = $("preview");
  if (!img) return;

  const rect = img.getBoundingClientRect();
  const drawInfo = getDrawInfo(img, rect);
  if (!drawInfo) return;

  const { offsetX, offsetY, drawW, drawH } = drawInfo;
  const px = offsetX + nx * drawW;
  const py = offsetY + ny * drawH;

  floatingEl = document.createElement("div");
  floatingEl.className = "annotation-popup";
  floatingEl.style.cssText = `
    position:absolute; left:${px}px; top:${py - 8}px;
    transform:translate(-50%, -100%);
    z-index:9000; pointer-events:auto;
  `;

  floatingEl.innerHTML = `
    <div class="annotation-popup-inner">
      <div class="annotation-popup-header">
        <span class="annotation-popup-title">📝 Not</span>
        <div class="annotation-popup-colors">
          ${PIN_COLORS.map((c, i) =>
            `<span class="annotation-color-dot" data-color="${i}" style="background:${c}${i === 0 ? '' : ';opacity:0.5'}"></span>`
          ).join("")}
        </div>
      </div>
      <textarea class="annotation-input" rows="2" placeholder="Not yazın...">${text || ""}</textarea>
      <div class="annotation-popup-footer">
        <button class="annotation-btn save" id="annotation-save">✓ Kaydet</button>
        <button class="annotation-btn cancel" id="annotation-cancel">✕ İptal</button>
      </div>
    </div>
  `;

  // Parent'ı absolute positioning için ayarla
  const wrap = document.getElementById("preview-wrap");
  if (wrap) {
    wrap.style.position = "relative";
    wrap.appendChild(floatingEl);
  }

  // Event bağları
  floatingEl.querySelector("#annotation-save").addEventListener("click", saveAnnotation);
  floatingEl.querySelector("#annotation-cancel").addEventListener("click", hideFloating);

  // Renk seçimi
  let selectedColor = 0;
  floatingEl.querySelectorAll(".annotation-color-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      selectedColor = parseInt(dot.dataset.color);
      floatingEl.querySelectorAll(".annotation-color-dot").forEach((d, i) => {
        d.style.opacity = i === selectedColor ? "1" : "0.5";
      });
    });
  });

  // Textarea enter → kaydet (ctrl+enter ile)
  floatingEl.querySelector(".annotation-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveAnnotation();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideFloating();
    }
  });

  floatingEl._selectedColor = () => selectedColor;

  // Input'a odaklan
  setTimeout(() => {
    const input = floatingEl?.querySelector(".annotation-input");
    if (input) input.focus();
  }, 50);

  // Tıklama propagasyonunu durdur
  floatingEl.addEventListener("click", (e) => e.stopPropagation());
}

function hideFloating() {
  if (floatingEl) {
    floatingEl.remove();
    floatingEl = null;
  }
  pendingPos = null;
  editingIdx = -1;
}

// ── Kaydet ──
function saveAnnotation() {
  if (!floatingEl || !pendingPos) return;

  const text = floatingEl.querySelector(".annotation-input")?.value?.trim();
  if (!text) {
    hideFloating();
    return;
  }

  const colorIdx = floatingEl._selectedColor?.() ?? 0;
  const annotations = getAnnotations();

  if (editingIdx >= 0) {
    // Mevcut annotation'ı güncelle
    annotations[editingIdx].text = text;
    annotations[editingIdx].color = PIN_COLORS[colorIdx];
  } else {
    // Yeni annotation ekle
    annotations.push({
      x: pendingPos.x,
      y: pendingPos.y,
      text,
      color: PIN_COLORS[colorIdx],
      ts: Date.now(),
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    });
  }

  hideFloating();
  renderAnnotationPins();
}

// ── Canvas üzerine pin render ──
export function renderAnnotationPins() {
  const img = $("preview");
  const canvas = $("preview-marks");
  if (!img || !canvas) return;

  const annotations = getAnnotations();
  if (!annotations.length) return;

  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w < 8 || h < 8) return;

  const ctx = canvas.getContext("2d");

  // previewMarks.js zaten canvas'ı temizleyip yeniden çiziyor.
  // Biz sadece annotation pin'lerini ek olarak çizeceğiz.
  // previewMarks çağrıldıktan sonra ekleme yapılır.
  // Bu yüzden setTimeout ile bir frame sonrasına atıyoruz.

  requestAnimationFrame(() => {
    annotations.forEach((a, idx) => {
      const px = Math.min(1, Math.max(0, a.x)) * w;
      const py = Math.min(1, Math.max(0, a.y)) * h;

      // Pin dış halka (gölge)
      ctx.save();
      ctx.shadowColor = a.color || PIN_COLORS[0];
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, PIN_OUTER, 0, Math.PI * 2);
      ctx.strokeStyle = a.color || PIN_COLORS[0];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Pin iç nokta
      ctx.beginPath();
      ctx.arc(px, py, PIN_RADIUS * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = a.color || PIN_COLORS[0];
      ctx.fill();

      // Numara etiketi
      ctx.save();
      ctx.font = `bold ${FONT_SIZE}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(String(idx + 1), px, py);

      // Metin etiketi (sağında)
      if (a.text) {
        const labelX = px + PIN_OUTER + 4;
        const labelY = py;
        const maxWidth = w * 0.3;
        const truncated = a.text.length > 30 ? a.text.slice(0, 28) + "…" : a.text;

        // Etiket arka planı
        const metrics = ctx.measureText(truncated);
        const textW = Math.min(metrics.width, maxWidth);
        const textH = FONT_SIZE + 6;
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.beginPath();
        ctx.roundRect(labelX - 3, labelY - textH / 2, textW + 8, textH, 3);
        ctx.fill();

        // Etiket metni
        ctx.fillStyle = a.color || "#fff";
        ctx.font = `${FONT_SIZE}px -apple-system, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(truncated, labelX + 1, labelY);
      }
      ctx.restore();
    });
  });
}

// ── Yardımcılar ──
function getDrawInfo(img, rect) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const imgAspect = w / h;
  const elemAspect = rect.width / rect.height;
  let offsetX = 0, offsetY = 0, drawW = rect.width, drawH = rect.height;

  if (elemAspect > imgAspect) {
    drawH = rect.width / imgAspect;
    offsetY = (rect.height - drawH) / 2;
  } else if (elemAspect < imgAspect) {
    drawW = rect.height * imgAspect;
    offsetX = (rect.width - drawW) / 2;
  }

  return { offsetX, offsetY, drawW, drawH };
}

function updateButton() {
  const btn = $("btn-annotate");
  if (!btn) return;
  if (mode) {
    btn.style.background = "rgba(226, 58, 58, 0.2)";
    btn.style.borderColor = "#e23a3a";
    btn.style.color = "#e23a3a";
    btn.textContent = "✏️ NOT EKLEMEDE";
  } else {
    btn.style.background = "";
    btn.style.borderColor = "";
    btn.style.color = "";
    btn.textContent = "📌 NOT";
  }
}

function updateCursor() {
  const wrap = document.getElementById("preview-wrap");
  if (wrap) {
    wrap.style.cursor = mode ? "crosshair" : "";
    wrap.classList.toggle("annotate-mode", mode);
  }
}
