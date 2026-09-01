/**
 * treeAnimate.js — Sol menü tree section animasyonlu açılış/kapanış.
 *
 * YALNIZCA sol paneldeki (.panel-ops) tree-section'lara animasyon ekler.
 * Sağ panel (.panel-intel) bölümleri bu modül tarafından ETKİLENMEZ.
 *
 * USAGE:
 *   import { initTreeAnimations } from "./treeAnimate.js";
 *   initTreeAnimations();
 */

const DURATION = 280; // ms
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

let _initialized = false;

export function initTreeAnimations() {
  if (_initialized) return;
  _initialized = true;

  const opsPanel = document.querySelector(".panel-ops");
  if (!opsPanel) return;

  const sections = opsPanel.querySelectorAll(".tree-section");

  for (const section of sections) {
    // Başlangıç: açıksa kapat
    if (section.hasAttribute("open")) {
      section.removeAttribute("open");
    }

    // Tree-body'yi gizle
    const body = section.querySelector(":scope > .tree-body");
    if (body) {
      body.style.maxHeight = "0";
      body.style.overflow = "hidden";
      body.style.opacity = "0";
    }

    // Tıklama yakala
    const summary = section.querySelector(":scope > summary");
    if (summary) {
      summary.addEventListener("click", (e) => {
        e.preventDefault();
        if (section.dataset.animating === "1") return;

        if (section.hasAttribute("open")) {
          closeSection(section);
        } else {
          openSection(section);
        }
      });
    }
  }

  initRightPanelTrees();
}

/**
 * Animasyonlu açılış:
 * 1. Transition OFF → open aç → scrollHeight ölç
 * 2. Transition ON → maxHeight: hedef → opacity: 1
 * 3. Bitince transition OFF → maxHeight:serbest (auto)
 */
function openSection(section) {
  const body = section.querySelector(":scope > .tree-body");
  if (!body) { section.setAttribute("open", ""); return; }

  section.dataset.animating = "1";

  // 1. Hazırlık: transition OFF, gizli durumda.open aç
  body.style.transition = "none";
  body.style.maxHeight = "0px";
  body.style.overflow = "hidden";
  body.style.opacity = "0";
  section.setAttribute("open", "");

  // Force reflow — DOM'un güncel boyutunu ölç
  void body.offsetHeight;
  const targetH = body.scrollHeight;

  // 2. Animasyon: transition ON, hedefe geç
  body.style.transition = `max-height ${DURATION}ms ${EASING}, opacity ${DURATION}ms ease`;
  body.style.maxHeight = `${targetH}px`;
  body.style.opacity = "1";

  // 3. Tamamlandı: transition OFF, maxHeight serbest
  const cleanup = () => {
    body.removeEventListener("transitionend", onEnd);
    body.style.transition = "";
    body.style.maxHeight = "";
    body.style.overflow = "";
    delete section.dataset.animating;
  };

  function onEnd(ev) {
    if (ev.propertyName === "max-height") cleanup();
  }
  body.addEventListener("transitionend", onEnd);
  setTimeout(cleanup, DURATION + 100);
}

/**
 * Animasyonlu kapanış:
 * 1. Transition OFF → scrollHeight'ı sabitle
 * 2. Transition ON → maxHeight:0 → opacity:0
 * 3. Tamamlandı → open kaldır
 */
function closeSection(section) {
  const body = section.querySelector(":scope > .tree-body");
  if (!body) { section.removeAttribute("open"); return; }

  section.dataset.animating = "1";

  // 1. Mevcut yüksekliği sabitle, transition OFF
  body.style.transition = "none";
  const currentH = body.scrollHeight;
  body.style.maxHeight = `${currentH}px`;
  body.style.overflow = "hidden";

  // Force reflow
  void body.offsetHeight;

  // 2. Animasyon: transition ON,0'a küçült
  body.style.transition = `max-height ${DURATION}ms ${EASING}, opacity ${DURATION}ms ease`;
  body.style.maxHeight = "0px";
  body.style.opacity = "0";

  // 3. Tamamlandı → open kaldır
  const cleanup = () => {
    body.removeEventListener("transitionend", onEnd);
    section.removeAttribute("open");
    body.style.transition = "";
    body.style.maxHeight = "";
    body.style.overflow = "";
    body.style.opacity = "";
    delete section.dataset.animating;
  };

  function onEnd(ev) {
    if (ev.propertyName === "max-height") cleanup();
  }
  body.addEventListener("transitionend", onEnd);
  setTimeout(cleanup, DURATION + 100);
}

/**
 * Sağ panel tree-section'ları: basit toggle (animasyonsuz).
 */
function initRightPanelTrees() {
  const rightPanel = document.querySelector(".panel-intel");
  if (!rightPanel) return;

  const sections = rightPanel.querySelectorAll(".tree-section");
  for (const section of sections) {
    const summary = section.querySelector(":scope > summary");
    if (summary) {
      summary.addEventListener("click", (e) => {
        e.preventDefault();
        if (section.hasAttribute("open")) {
          section.removeAttribute("open");
        } else {
          section.setAttribute("open", "");
        }
      });
    }
  }
}
