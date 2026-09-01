/**
 * rail.js — Sol modül rayı: her modül kendi ekranını açar.
 *
 * Modüller:
 *   image   → GÖRÜNTÜ (DTA / Proton ELIC) — varsayılan ekran
 *   csv     → CSV / Excel verisi
 *   hybrid  → HİBRİT analiz (image + csv)
 *   sys     → SİSTEM (lisans, DTA/VPE, arşiv, güncelleme)
 *
 * Davranış:
 *   - body[data-mod] + ops-core / fold-zone görünürlüğü ile her modülün
 *     kendi ekranı açılır; aktif olmayan modülün kontrolleri gizlenir.
 *   - Modül JS'i ilk açılışta lazy yüklenir (csvPanel, unifiedPanel) —
 *     three.js + CSV motoru yalnızca ihtiyaç olunca yüklenir.
 *   - 3D sahne katmanları modüle göre gösterilir (DTA / CSV / ipuçları).
 *
 * API:
 *   bindModuleRail()   — ray butonlarını bağla + ilk modülü uygula
 *   setModule(name)    — programatik modül değiştir
 *   activeModule()     — şu anki modül adı
 */

import { state } from "../app/state.js";
import { heartbeatSet, heartbeatBusy } from "../ui/heartbeat.js";
import { isHintsVisible } from "../viewer/hintEngine.js";
import { invalidate } from "../viewer/scene.js";

const MODULES = {
  image: { label: "GÖRÜNTÜ", note: "DTA / Proton ELIC" },
  csv: { label: "CSV", note: "CSV / EXCEL" },
  hybrid: { label: "HİBRİT", note: "IMAGE + CSV" },
  sys: { label: "SİSTEM", note: "AYARLAR / ARŞİV" },
};

/** hangi modülde hangi fold'lar görünür (other `hidden`) */
const FOLD_GROUPS = {
  image: ["csv-fold"],  // CSV artık GÖRÜNTÜ içinde
  csv: ["csv-fold"],
  hybrid: ["unified-fold"],
  sys: ["dta-settings-fold", "vpe-settings-fold", "archive-fold", "update-fold"],
};

let active = "image";
const loaded = new Set(["image"]);

// ── 3D katmanlar: modül → görünürlük ──
function applyLayerVisibility() {
  const scene = state.scene;
  if (!scene) return;

  const isImageLike = active === "image" || active === "hybrid";
  const isCsvLike = active === "csv" || active === "hybrid" || active === "image";  // CSV artık GÖRÜNTÜ içinde

  scene.traverse((obj) => {
    const layer = obj.userData?.votexLayer;
    if (!layer) return;
    if (layer === "dta") obj.visible = isImageLike;
    else if (layer === "csv") obj.visible = isCsvLike;
    else if (layer === "hybrid") obj.visible = active === "hybrid";
    // İpucu katmanları kaynağına göre: DTA ipuçları yalnız GÖRÜNTÜ/HİBRİT,
    // CSV ipuçları yalnız CSV/HİBRİT — CSV verisi ilk haritada görünmez.
    else if (layer === "hint-dta") obj.visible = isImageLike && isHintsVisible();
    else if (layer === "hint-csv") obj.visible = isCsvLike && isHintsVisible();
    else if (layer === "hint") obj.visible = isHintsVisible(); // geriye dönük
  });
  // csvOverlay state üzerinden ayrıca
  if (state.csvOverlay) state.csvOverlay.visible = isCsvLike;
  invalidate();
}

// ── Ekran görünürlüğü (ops-core + fold-zone) ──
function applyScreen() {
  const isImage = active === "image";

  // Görüntü çekirdeği (#ops-core-a / #ops-core-b) yalnız image modülünde
  document.querySelectorAll(".ops-core").forEach((el) => {
    el.hidden = !isImage;
  });

  // Fold bölgesi: sadece aktif modülün fold'ları görünür
  const showList = FOLD_GROUPS[active] || [];
  document.querySelectorAll("[data-fold]").forEach((el) => {
    const on = showList.includes(el.id);
    el.hidden = !on;
    if (on) el.open = true;
  });

  // data-mod-show elemanları (ör. split-heatmap sadece CSV'de)
  document.querySelectorAll("[data-mod-show]").forEach((el) => {
    const show = active === "csv";
    const sets = el.dataset.modShow.split(",").map((s) => s.trim());
    el.hidden = !sets.includes(active);
    if (!sets.includes(active)) el.style.display = "none";
  });
}

export async function setModule(name) {
  if (!MODULES[name]) name = "image";
  const prev = active;
  active = name;

  // Sekme aktifliği
  document.querySelectorAll("#votex-ray .vr-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mod === name);
  });

  document.body.dataset.module = name;
  applyScreen();
  heartbeatSet(`${MODULES[name].label} · ${MODULES[name].note}`);

  // HİBRİT'ten çıkınca birleşik analiz sahnesini tamamen kaldır (gizlemek yerine)
  if (prev === "hybrid" && name !== "hybrid") {
    try {
      const { clearUnifiedScene } = await import("../hybrid/unifiedAnalysis.js");
      const removed = clearUnifiedScene(state.scene);
      if (removed) console.log("[Rail] HİBRİT sahnesi temizlendi");
    } catch (e) {
      console.warn("[Rail] HİBRİT sahne temizliği:", e);
    }
  }

  // Modül JS'ini ilk açılışta yükle (lazy chunk)
  // CSV artık GÖRÜNTÜ içinde — image modülünde de yüklenir
  if (!loaded.has(name)) {
    loaded.add(name);
    heartbeatBusy(true);
    try {
      if (name === "csv" || name === "image") {
        const { bindCsvPanel } = await import("../ui/csvPanel.js");
        bindCsvPanel();
      }
      if (name === "hybrid") {
        const { bindUnifiedPanel } = await import("../hybrid/unifiedPanel.js");
        bindUnifiedPanel();
      }
    } catch (e) {
      console.warn(`[Rail] ${name} modülü yüklenemedi:`, e);
    } finally {
      heartbeatBusy(false);
    }
  }
  applyLayerVisibility(active);
}

export function activeModule() {
  return active;
}

export async function bindModuleRail() {
  const rail = document.getElementById("votex-ray");
  if (!rail || rail.dataset.bound === "1") return;
  rail.dataset.bound = "1";

  rail.querySelectorAll(".vr-btn").forEach((btn) => {
    btn.addEventListener("click", () => setModule(btn.dataset.mod));
  });

  // İlk modül: image (varsayılan)
  await setModule("image");
}