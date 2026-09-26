/**
 * rail.js — Sol modül rayı: her modül kendi ekranını açar.
 *
 * Modüller:
 *   image   → GÖRÜNTÜ (DTA / Proton ELIC) — varsayılan ekran
 *   csv     → CSV / Excel verisi
 *   legacy  → LEGACY3DMAG (JSON dik tarama)
 *   tools   → ARAÇLAR (analiz, rapor, dışa aktarma, ölçüm)
 *   hybrid  → HİBRİT analiz (image + csv)
 *   sys     → SİSTEM (lisans, DTA/VPE, arşiv, güncelleme)
 *
 * Davranış:
 *   - body[data-mod] + ops-core / fold-zone görünürlüğü ile her modülün
 *     kendi ekranı açılır; CSV, LEGACY3DMAG ve ARAÇLAR ayrı üst sekmelerdir.
 *     Aktif olmayan modülün kontrolleri gizlenir.
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
  image: { label: "GÖRÜNTÜ", note: "DTA / PROTON ELIC" },
  csv: { label: "CSV VERİ", note: "İÇE AKTARMA / HARİTA" },
  legacy: { label: "LEGACY3DMAG", note: "JSON DİK TARAMA" },
  tools: { label: "ARAÇLAR", note: "ANALİZ / RAPOR / ÖLÇÜM" },
  hybrid: { label: "HİBRİT", note: "IMAGE + CSV" },
  sys: { label: "SİSTEM", note: "AYARLAR / ARŞİV" },
};

/** hangi modülde hangi üst içerik görünür (other `hidden`) */
const FOLD_GROUPS = {
  image: [],
  csv: ["csv-fold"],
  legacy: ["legacy-fold"],
  tools: ["tools-fold"],
  hybrid: ["unified-fold"],
  sys: ["dta-settings-fold", "vpe-settings-fold", "archive-fold", "update-fold"],
};

let _panelsPrepared = false;

function sectionByLabel(root, label) {
  return [...root.querySelectorAll("details.tree-section")]
    .find((el) => el.querySelector(":scope > summary .tree-label")?.textContent?.trim() === label);
}

/**
 * Mevcut DOM düğümlerini yeni üst sekmelere taşır.
 * ID'ler değişmediği için main.js ve csvPanel.js bağlayıcıları bozulmaz.
 */
function prepareModulePanels() {
  if (_panelsPrepared) return;
  _panelsPrepared = true;

  const foldZone = document.getElementById("panel-fold-zone");
  if (!foldZone) return;

  // JSON kutusunu CSV akışından çıkarıp kendi üst sekmesine al.
  const legacyBox = document.getElementById("legacy-dik-box");
  if (legacyBox) {
    const legacyFold = document.createElement("details");
    legacyFold.className = "dta-settings-fold module-tab-fold";
    legacyFold.id = "legacy-fold";
    legacyFold.dataset.fold = "legacy";
    legacyFold.innerHTML = `
      <summary>
        <span class="panel-tag">JSON</span>
        <span>LEGACY3DMAG · JSON VERİ İŞLEM</span>
      </summary>
      <div class="dta-settings module-tab-body" id="legacy-panel"></div>`;
    legacyFold.querySelector("#legacy-panel").appendChild(legacyBox);
    foldZone.appendChild(legacyFold);
  }

  // Analiz araçları, rapor/dışa aktarma ve ölçüm araçlarını tek üst sekmede topla.
  const toolsFold = document.createElement("details");
  toolsFold.className = "dta-settings-fold module-tab-fold";
  toolsFold.id = "tools-fold";
  toolsFold.dataset.fold = "tools";
  toolsFold.innerHTML = `
    <summary>
      <span class="panel-tag">TOOLS</span>
      <span>ARAÇLAR · ANALİZ VE DIŞA AKTARMA</span>
    </summary>
    <div class="dta-settings module-tab-body" id="tools-panel"></div>`;
  const toolsBody = toolsFold.querySelector("#tools-panel");
  const opsA = document.getElementById("ops-core-a");
  const opsB = document.getElementById("ops-core-b");
  if (opsA) {
    const analysisTools = sectionByLabel(opsA, "ANALİZ ARAÇLARI");
    const tools = sectionByLabel(opsA, "ARAÇLAR");
    if (analysisTools) toolsBody.appendChild(analysisTools);
    if (tools) toolsBody.appendChild(tools);
    const freeDraw = document.getElementById("fd-panel");
    if (freeDraw) toolsBody.appendChild(freeDraw);
  }
  if (opsB) {
    for (const label of ["OTURUMLAR", "3D ÖLÇÜM", "DERİNLİK PROFİLİ"]) {
      const section = sectionByLabel(opsB, label);
      if (section) toolsBody.appendChild(section);
    }
  }
  foldZone.appendChild(toolsFold);
}

let active = "image";
// main.js CSV bağlayıcısını başlangıçta kurduğu için ikinci kez bağlamayalım.
const loaded = new Set(["image", "csv"]);

// ── 3D katmanlar: modül → görünürlük ──
function applyLayerVisibility() {
  const scene = state.scene;
  if (!scene) return;

  const isImageLike = active === "image" || active === "hybrid";
  const isCsvLike = active === "csv" || active === "hybrid";

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
  // CSV overlay yalnız CSV/HİBRİT sekmesinde görünür.
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

  // Fold bölgesi: sadece aktif modülün üst sekme içeriği görünür
  const showList = FOLD_GROUPS[active] || [];
  document.querySelectorAll("[data-fold]").forEach((el) => {
    const on = showList.includes(el.id);
    el.hidden = !on;
    if (on) el.open = true;
  });

  // data-mod-show elemanları (ör. split-heatmap sadece CSV'de)
  document.querySelectorAll("[data-mod-show]").forEach((el) => {
    const sets = el.dataset.modShow.split(",").map((s) => s.trim());
    const show = sets.includes(active);
    el.hidden = !show;
    el.style.display = show ? "" : "none";
  });
}

export async function setModule(name) {
  if (!MODULES[name]) name = "image";
  const prev = active;
  active = name;

  // Sekme aktifliği
  document.querySelectorAll("#votex-ray .vr-btn").forEach((b) => {
    const selected = b.dataset.mod === name;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-selected", selected ? "true" : "false");
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
  if (!loaded.has(name)) {
    loaded.add(name);
    heartbeatBusy(true);
    try {
      if (name === "csv") {
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
  prepareModulePanels();

  rail.querySelectorAll(".vr-btn").forEach((btn) => {
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", btn.classList.contains("active") ? "true" : "false");
    btn.addEventListener("click", () => setModule(btn.dataset.mod));
  });

  // İlk modül: image (varsayılan); CSV/JSON/Araçlar üst sekmeleri kapalı içerikle başlar.
  await setModule("image");
}