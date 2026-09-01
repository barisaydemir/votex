/**
 * detectionNotes.js — Her tespit için saha fotoğrafı ve not ekleme.
 *
 * focusId formatı: "chamber-0", "tunnel-1", "metal-2"
 *
 * Özellikler:
 *   • Her karta 📝 butonu ekler (analiz panelinde)
 *   • Tıklanınca modal açılır: metin notu + fotoğraf yükleme
 *   • Fotoğraflar base64 olarak state.detectionNotes'a kaydedilir
 *   • Mevcut not/fotoğraflar kartta mini önizleme olarak gösterilir
 *   • localStorage'a otomatik kayıt (session Persist entegrasyonu)
 *
 * Kullanım:
 *   import { attachNoteButtons, getDetectionNotes, saveDetectionNotes } from "./detectionNotes.js";
 *   attachNoteButtons(panelEl);
 */

import { state } from "../app/state.js";

const STORAGE_KEY = "votex-detection-notes";

/**
 * localStorage'dan notları yükle
 */
export function loadDetectionNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.detectionNotes = JSON.parse(raw);
    }
  } catch { /* ignored */ }
}

/**
 * Notları localStorage'a kaydet
 */
export function saveDetectionNotes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.detectionNotes));
  } catch { /* ignored */ }
}

/**
 * Belirli bir tespitin notlarını al
 */
export function getDetectionNotes(focusId) {
  return state.detectionNotes[focusId] || { notes: "", photos: [] };
}

/**
 * Bir tespitin notlarını güncelle
 */
export function setDetectionNotes(focusId, data) {
  state.detectionNotes[focusId] = data;
  saveDetectionNotes();
}

/**
 * Analiz panelindeki kartlara 📝 butonları ekle.
 * renderReportdan sonra çağrılır.
 */
export function attachNoteButtons(panelEl) {
  if (!panelEl) return;

  loadDetectionNotes();

  const cards = panelEl.querySelectorAll(".ap-card[data-focus-id]");
  cards.forEach((card) => {
    const focusId = card.dataset.focusId;
    if (!focusId) return;

    const existing = getDetectionNotes(focusId);
    const hasContent = existing.notes || (existing.photos && existing.photos.length > 0);

    // Not butonu
    const btn = document.createElement("button");
    btn.className = "ap-note-btn";
    btn.innerHTML = `📝${hasContent ? " ✏️" : ""}`;
    btn.title = hasContent ? "Notu/Fotoğrafı düzenle" : "Not ekle / fotoğraf yükle";
    btn.style.cssText = `
      position: absolute; top: 8px; right: 48px;
      background: ${hasContent ? "rgba(62,220,140,0.15)" : "rgba(255,255,255,0.05)"};
      border: 1px solid ${hasContent ? "rgba(62,220,140,0.3)" : "rgba(255,255,255,0.1)"};
      border-radius: 6px; padding: 4px 8px; cursor: pointer;
      font-size: 12px; color: #ccc; transition: all 0.2s;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(62,220,140,0.25)";
      btn.style.borderColor = "rgba(62,220,140,0.5)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = hasContent ? "rgba(62,220,140,0.15)" : "rgba(255,255,255,0.05)";
      btn.style.borderColor = hasContent ? "rgba(62,220,140,0.3)" : "rgba(255,255,255,0.1)";
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNoteModal(focusId);
    });

    // Kartın position'unu relative yap
    card.style.position = "relative";
    card.appendChild(btn);

    // Mevcut not/fotoğraf önizlemesi
    if (hasContent) {
      const preview = document.createElement("div");
      preview.className = "ap-note-preview";
      preview.style.cssText = `
        margin-top: 8px; padding-top: 8px; border-top: 1px solid #333;
        font-size: 11px; color: #999;
      `;

      if (existing.notes) {
        const noteText = existing.notes.length > 100
          ? existing.notes.substring(0, 100) + "..."
          : existing.notes;
        preview.innerHTML = `<div style="color:#b8d4e3;margin-bottom:4px">📝 ${noteText}</div>`;
      }

      if (existing.photos && existing.photos.length > 0) {
        const thumbs = document.createElement("div");
        thumbs.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;";
        existing.photos.forEach((photo, idx) => {
          const thumb = document.createElement("img");
          thumb.src = photo.dataUrl;
          thumb.alt = photo.name || `Fotoğraf ${idx + 1}`;
          thumb.style.cssText = "width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #444;cursor:pointer;";
          thumb.addEventListener("click", (e) => {
            e.stopPropagation();
            openPhotoViewer(photo.dataUrl, photo.name);
          });
          thumbs.appendChild(thumb);
        });
        preview.appendChild(thumbs);
      }

      card.appendChild(preview);
    }
  });
}

/**
 * Not/Fotoğraf modalını aç
 */
function openNoteModal(focusId) {
  const existing = getDetectionNotes(focusId);

  // Modal overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100000;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
  `;

  // Modal
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: #1a1a2e; border: 1px solid #333; border-radius: 12px;
    width: min(480px, 90vw); max-height: 80vh; overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    padding: 16px; border-bottom: 1px solid #333;
    display: flex; justify-content: space-between; align-items: center;
  `;
  header.innerHTML = `
    <span style="font-size:14px;font-weight:600;color:#e0e0e0">📝 ${focusId} — Not / Fotoğraf</span>
  `;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = "background:none;border:none;color:#888;font-size:20px;cursor:pointer;";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.style.cssText = "padding: 16px;";

  // Not alanı
  const noteLabel = document.createElement("div");
  noteLabel.style.cssText = "font-size:12px;color:#888;margin-bottom:6px;";
  noteLabel.textContent = "📝 Saha Notu";
  body.appendChild(noteLabel);

  const textarea = document.createElement("textarea");
  textarea.value = existing.notes || "";
  textarea.placeholder = "Saha gözlemlerinizi buraya yazın...";
  textarea.style.cssText = `
    width: 100%; min-height: 80px; padding: 10px;
    background: #0f0f1e; border: 1px solid #333; border-radius: 6px;
    color: #e0e0e0; font-size: 13px; resize: vertical;
    font-family: inherit;
  `;
  body.appendChild(textarea);

  // Fotoğraf bölümü
  const photoSection = document.createElement("div");
  photoSection.style.cssText = "margin-top: 16px;";

  const photoLabel = document.createElement("div");
  photoLabel.style.cssText = "font-size:12px;color:#888;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;";
  photoLabel.innerHTML = "📷 Saha Fotoğrafları";

  // Fotoğraf ekle butonu
  const addPhotoBtn = document.createElement("button");
  addPhotoBtn.textContent = "+ Fotoğraf Ekle";
  addPhotoBtn.style.cssText = `
    background: rgba(62,220,140,0.12); border: 1px solid rgba(62,220,140,0.3);
    border-radius: 6px; padding: 4px 10px; color: #3edc8c; font-size: 11px; cursor: pointer;
  `;
  photoLabel.appendChild(addPhotoBtn);
  photoSection.appendChild(photoLabel);

  // Fotoğraf input (gizli)
  const photoInput = document.createElement("input");
  photoInput.type = "file";
  photoInput.accept = "image/*";
  photoInput.capture = "environment"; // mobilde arka kamera
  photoInput.multiple = true;
  photoInput.style.display = "none";
  photoSection.appendChild(photoInput);

  addPhotoBtn.addEventListener("click", () => photoInput.click());

  // Fotoğraf listesi
  const photoList = document.createElement("div");
  photoList.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;";
  photoSection.appendChild(photoList);

  // Mevcut fotoğrafları göster
  let photos = [...(existing.photos || [])];
  renderPhotoList(photoList, photos);

  photoInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name} çok büyük (maks 5MB)`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      photos.push({
        dataUrl,
        name: file.name,
        ts: Date.now(),
      });
    }
    renderPhotoList(photoList, photos);
    photoInput.value = "";
  });

  body.appendChild(photoSection);
  modal.appendChild(body);

  // Footer
  const footer = document.createElement("div");
  footer.style.cssText = `
    padding: 12px 16px; border-top: 1px solid #333;
    display: flex; justify-content: flex-end; gap: 8px;
  `;

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "İptal";
  cancelBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid #444; border-radius: 6px;
    background: transparent; color: #888; cursor: pointer; font-size: 13px;
  `;
  cancelBtn.addEventListener("click", () => overlay.remove());
  footer.appendChild(cancelBtn);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "💾 Kaydet";
  saveBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 6px;
    background: linear-gradient(180deg, #2aaa6a, #1a8a50);
    color: #f0fff6; cursor: pointer; font-size: 13px; font-weight: 600;
  `;
  saveBtn.addEventListener("click", () => {
    setDetectionNotes(focusId, {
      notes: textarea.value,
      photos,
    });
    overlay.remove();
    // Panoyu yenile (not butonlarını güncelle)
    refreshPanel();
  });
  footer.appendChild(saveBtn);

  modal.appendChild(footer);
  overlay.appendChild(modal);

  // Overlay tıklamasıyla kapatma
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // ESC ile kapatma
  const escHandler = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  document.body.appendChild(overlay);
  textarea.focus();
}

/**
 * Fotoğraf listesini göster
 */
function renderPhotoList(container, photos) {
  container.innerHTML = "";
  photos.forEach((photo, idx) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;";

    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = photo.name || `Fotoğraf ${idx + 1}`;
    img.style.cssText = `
      width: 64px; height: 64px; object-fit: cover;
      border-radius: 6px; border: 1px solid #444; cursor: pointer;
    `;
    img.addEventListener("click", () => openPhotoViewer(photo.dataUrl, photo.name));

    // Sil butonu
    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    delBtn.style.cssText = `
      position: absolute; top: -4px; right: -4px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #ef4444; color: white; border: none;
      font-size: 10px; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
    `;
    delBtn.addEventListener("click", () => {
      photos.splice(idx, 1);
      renderPhotoList(container, photos);
    });

    // Dosya adı etiketi
    const nameLabel = document.createElement("div");
    nameLabel.style.cssText = "font-size:9px;color:#666;text-align:center;margin-top:2px;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    nameLabel.textContent = photo.name || `Fotoğraf ${idx + 1}`;

    wrapper.appendChild(img);
    wrapper.appendChild(delBtn);
    wrapper.appendChild(nameLabel);
    container.appendChild(wrapper);
  });

  if (photos.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:11px;color:#555;padding:8px;";
    empty.textContent = "Henüz fotoğraf eklenmedi";
    container.appendChild(empty);
  }
}

/**
 * Fotoğraf tam ekran görüntüleyici
 */
function openPhotoViewer(dataUrl, name) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 200000;
    background: rgba(0,0,0,0.9); display: flex;
    flex-direction: column; align-items: center; justify-content: center;
    cursor: pointer;
  `;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText = "max-width: 90vw; max-height: 80vh; object-fit: contain; border-radius: 8px;";

  const label = document.createElement("div");
  label.style.cssText = "color: #888; font-size: 12px; margin-top: 12px;";
  label.textContent = name || "Saha fotoğrafı";

  const hint = document.createElement("div");
  hint.style.cssText = "color: #555; font-size: 11px; margin-top: 8px;";
  hint.textContent = "Kapatmak için tıklayın veya ESC basın";

  overlay.appendChild(img);
  overlay.appendChild(label);
  overlay.appendChild(hint);

  overlay.addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", esc);
    }
  });

  document.body.appendChild(overlay);
}

/**
 * Dosyayı DataUrl olarak oku
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Analiz panelini yenile (not butonlarını güncelle)
 * panelEl'i bulup attachNoteButtons çağır
 */
function refreshPanel() {
  const panel = document.querySelector(".ap-panel");
  if (panel) {
    // Mevcut not butonlarını temizle, yeniden oluştur
    panel.querySelectorAll(".ap-note-btn").forEach((b) => b.remove());
    panel.querySelectorAll(".ap-note-preview").forEach((p) => p.remove());
    attachNoteButtons(panel);
  }
}
