import { $, state } from "../app/state.js";
import { formatDepthM } from "../viewer/colors.js";
import { BANDS, FREE_DRAW_BAND_ORDER, applyFreeDrawVisibility } from "../viewer/builders/freeDraw.js";
import { focusFreeDraw } from "../viewer/labels.js";
import { t } from "../i18n/index.js";

// Tauri invoke (varsa)
let _invoke = null;
async function invoke(cmd, args) {
  if (!_invoke) {
    try {
      const mod = await import("@tauri-apps/api/core");
      _invoke = mod.invoke;
    } catch {
      _invoke = () => Promise.reject(new Error("Tauri API not available"));
    }
  }
  return _invoke(cmd, args);
}

/**
 * freeDrawItems'taki kontak bantlarını StructureHint formatına çevir.
 * Her kontak = void band ↔ pos band kenarı = potansiyel tünel bağlantısı.
 *
 * @returns {Array<{kind:string, cx:number, cy:number, rx:number, ry:number, label:string}>}
 */
export function contactsToHints() {
  const contacts = (state.freeDrawItems || []).filter((i) => i.band === "contact");
  if (!contacts.length) return [];

  return contacts.map((c) => {
    // Kontak konumu state.freeDrawTargets'ta kayıtlı
    const target = state.freeDrawTargets?.[c.id];
    let cx = 0.5;
    let cy = 0.5;
    if (target?.position) {
      // THREE.Vector3 → normalize harita (x → cx, z → cy)
      // position zaten normalize dünya koordinatında
      cx = Math.min(0.98, Math.max(0.02, target.position.x));
      cy = Math.min(0.98, Math.max(0.02, target.position.z));
    }

    // Label: void→pos band çifti
    const via = c.via || [];
    const label = via.length >= 2
      ? `fd_${via[0]}_to_${via[1]}`
      : `fd_contact_${c.num}`;

    // rx/ry: kontak yarıçapı (state.freeDrawTargets'tan)
    const radius = target?.radius || 0.06;

    return {
      kind: "tunnel",
      cx,
      cy,
      rx: Math.min(radius * 0.02, 0.12),
      ry: Math.min(radius * 0.02, 0.12),
      label,
    };
  });
}

/**
 * Kontakları dta_hints'e gönder.
 * Başarılıysa eklenen ipucu sayısını döner.
 */
export async function pushContactsAsHints() {
  const hints = contactsToHints();
  if (!hints.length) return 0;
  try {
    const added = await invoke("add_contact_hints", { hints });
    return added || 0;
  } catch (e) {
    console.warn("pushContactsAsHints failed:", e);
    return 0;
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function foundBands() {
  const found = new Set();
  for (const item of state.freeDrawItems || []) {
    if (item?.band) found.add(item.band);
  }
  const wallN = Number(state.freeDrawGroup?.userData?.counts?.wallN || 0);
  if (wallN > 0) found.add("wall");
  return found;
}

function bandOn(band) {
  return (state.freeDrawBands || {})[band] !== false;
}

function setBand(band, visible) {
  state.freeDrawBands = state.freeDrawBands || {};
  state.freeDrawBands[band] = !!visible;
  applyFreeDrawVisibility();
  renderFreeDrawPanel();
}

function chipHtml(band) {
  const spec = BANDS[band];
  if (!spec) return "";
  const on = bandOn(band);
  const name = t(spec.key);
  return `
    <div class="fd-chip ${on ? "on" : "off"}" data-fd-band="${esc(band)}">
      <span class="fd-swatch" style="background:${esc(spec.hex || "#888")}"></span>
      <span class="fd-chip-name">${esc(name)}</span>
      <button type="button" class="fd-mini" data-fd-show="${esc(band)}" ${on ? "disabled" : ""}>${esc(t("fd.show"))}</button>
      <button type="button" class="fd-mini danger" data-fd-hide="${esc(band)}" ${on ? "" : "disabled"}>${esc(t("fd.hide"))}</button>
    </div>
  `;
}

function itemHtml(item) {
  const spec = BANDS[item.band] || {};
  const on = bandOn(item.band);
  const active = state.selectedFreeDrawId === item.id;
  const hex = item.hex || spec.hex || "#4a5560";
  return `
    <button type="button" class="fd-item ${on ? "" : "dim"} ${active ? "active" : ""}" data-fd-id="${esc(item.id)}">
      <span class="fd-num" style="background:${esc(hex)}">${esc(item.num)}</span>
      <span class="fd-body">
        <strong>${esc(item.title)}</strong>
        <span>${esc(t("sc.cover"))} ${esc(formatDepthM(item.topM))} · ${esc(t("sc.dip"))} ${esc(formatDepthM(item.dipM))}</span>
      </span>
    </button>
  `;
}

/**
 * Sanal liste: büyük listelerde yalnızca görünür öğeleri render eder.
 *
 * Mimari:
 * - Container: overflow-y: auto, position: relative (scroll container)
 * - Sentinel div: toplam yüksekliği temsil eder (n × ITEM_H px)
 * - Öğeler: position: absolute, container içinde doğrudan konumlandırılır
 *
 * Scroll姑娘只有看到的项目才会被创建 DOM — 1000 öğeli listede ~20 DOM düğümü.
 */
const VIRTUAL_ITEM_HEIGHT = 48; // fd-item buton yüksekliği (px)
const VIRTUAL_BUFFER = 5;       // görünür aralığın üst/altına ekstra öğe

class VirtualList {
  /**
   * @param {HTMLElement} container - fd-list veya fd-ct-list
   * @param {Function} renderFn - (item) => html string
   * @param {number} [maxHeight=320] - container maks yükseklik (px)
   * @param {string} [emptyMsg] - boş liste mesajı
   */
  constructor(container, renderFn, maxHeight = 320, emptyMsg = "") {
    this.container = container;
    this.renderFn = renderFn;
    this.maxHeight = maxHeight;
    this.emptyMsg = emptyMsg;
    this.items = [];
    this._lastStart = -1;
    this._lastEnd = -1;
    this._rafId = 0;
    this._scrollHandler = this._onScroll.bind(this);
    this._itemEls = []; // görünür öğe DOM düğümleri

    // Container stilini ayarla
    this.container.style.maxHeight = `${maxHeight}px`;
    this.container.style.overflowY = "auto";
    this.container.style.position = "relative";

    // Sentinel: toplam yüksekliği temsil eder
    this._sentinel = document.createElement("div");
    this._sentinel.style.height = "1px";
    this._sentinel.style.pointerEvents = "none";
    this._sentinel.style.visibility = "hidden";
    this.container.appendChild(this._sentinel);

    // Scroll olayı (passive — scroll performansını bozmaz)
    this.container.addEventListener("scroll", this._scrollHandler, { passive: true });
  }

  /** Listeyi güncelle (öğeler değiştiğinde). */
  update(items) {
    this.items = items || [];
    this._lastStart = -1;
    this._lastEnd = -1;

    // Eski öğeleri temizle
    for (const el of this._itemEls) el.remove();
    this._itemEls = [];

    // Toplam yükseklik hisarı
    this._sentinel.style.height = `${this.items.length * VIRTUAL_ITEM_HEIGHT}px`;

    // Boş liste
    if (this.items.length === 0) {
      if (this.emptyMsg) {
        this._sentinel.insertAdjacentHTML("afterend",
          `<p class="hint compact" style="padding:4px 0">${esc(this.emptyMsg)}</p>`);
      }
      return;
    }

    // İlk render
    this._renderVisible();
  }

  /** Scroll olayı — rAF ile throttled. */
  _onScroll() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = 0;
      this._renderVisible();
    });
  }

  /** Görünür öğeleri render et. */
  _renderVisible() {
    if (this.items.length === 0) return;

    const scrollTop = this.container.scrollTop;
    const viewH = this.container.clientHeight;

    // Görünür aralık (+ buffer)
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_BUFFER);
    const end = Math.min(
      this.items.length,
      Math.ceil((scrollTop + viewH) / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_BUFFER
    );

    // Aynı aralıkta tekrar render etme
    if (start === this._lastStart && end === this._lastEnd) return;

    // Eski öğeleri kaldır
    for (const el of this._itemEls) el.remove();
    this._itemEls = [];

    this._lastStart = start;
    this._lastEnd = end;

    // Yeni öğeleri oluştur
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
      el.style.left = "0";
      el.style.right = "0";
      el.style.height = `${VIRTUAL_ITEM_HEIGHT}px`;
      el.innerHTML = this.renderFn(this.items[i]);
      frag.appendChild(el);
      this._itemEls.push(el);
    }
    this.container.appendChild(frag);
  }

  /** Temizle. */
  destroy() {
    this.container.removeEventListener("scroll", this._scrollHandler);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    for (const el of this._itemEls) el.remove();
    this._itemEls = [];
  }
}

export function renderFreeDrawPanel() {
  const panel = $("fd-panel");
  const bandsHost = $("fd-bands");
  const listHost = $("fd-list");
  const ctChips = $("fd-ct-chips");
  const ctList = $("fd-ct-list");
  if (!panel || !bandsHost || !listHost) return;

  const on = !!state.useFootprintShape && !!state.freeDrawGroup;
  panel.hidden = !on;
  if (!on) {
    bandsHost.innerHTML = "";
    if (listHost._vlist) { listHost._vlist.destroy(); delete listHost._vlist; }
    listHost.innerHTML = "";
    if (ctChips) ctChips.innerHTML = "";
    if (ctList?._vlist) { ctList._vlist.destroy(); delete ctList._vlist; }
    if (ctList) ctList.innerHTML = "";
    return;
  }

  const found = foundBands();
  const chips = FREE_DRAW_BAND_ORDER.filter((id) => found.has(id)).map(chipHtml);
  bandsHost.innerHTML = chips.length
    ? chips.join("")
    : `<p class="hint compact">${esc(t("fd.empty"))}</p>`;

  // hacim listesi (virtual scroll)
  const items = (state.freeDrawItems || []).filter((i) => i.band !== "contact");
  if (!listHost._vlist) {
    listHost._vlist = new VirtualList(listHost, itemHtml, 320, t("fd.empty"));
  }
  listHost._vlist.update(items);

  // kontak listesi (virtual scroll) + hint gönderme butonu
  const contacts = (state.freeDrawItems || []).filter((i) => i.band === "contact");
  if (ctChips) {
    ctChips.innerHTML = contacts.length ? chipHtml("contact") : "";
    // Kontakları hint olarak gönder butonu
    if (contacts.length > 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fd-mini";
      btn.style.marginLeft = "6px";
      btn.textContent = esc(t("fd.pushHints"));
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = esc(t("fd.pushHintsSending"));
        try {
          const n = await pushContactsAsHints();
          btn.textContent = esc(t("fd.pushHintsOk", { n }));
          setTimeout(() => { btn.textContent = esc(t("fd.pushHints")); btn.disabled = false; }, 2000);
        } catch {
          btn.textContent = esc(t("fd.pushHintsErr"));
          setTimeout(() => { btn.textContent = esc(t("fd.pushHints")); btn.disabled = false; }, 2000);
        }
      });
      ctChips.appendChild(btn);
    }
  }
  if (ctList) {
    if (!ctList._vlist) {
      ctList._vlist = new VirtualList(ctList, itemHtml, 240, t("fd.contactsEmpty"));
    }
    ctList._vlist.update(contacts);
  }
}

export function bindFreeDrawPanel() {
  const panel = $("fd-panel");
  if (!panel || panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";
  panel.addEventListener("click", (e) => {
    const hide = e.target.closest("[data-fd-hide]");
    if (hide) {
      e.preventDefault();
      setBand(hide.getAttribute("data-fd-hide"), false);
      return;
    }
    const show = e.target.closest("[data-fd-show]");
    if (show) {
      e.preventDefault();
      setBand(show.getAttribute("data-fd-show"), true);
      return;
    }
    const item = e.target.closest("[data-fd-id]");
    if (!item) return;
    e.preventDefault();
    focusFreeDraw(item.getAttribute("data-fd-id"));
    renderFreeDrawPanel();
  });
}
