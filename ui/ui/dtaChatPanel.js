/**
 * dtaChatPanel.js — 3D sahnenin altında yarı saydam DTA sohbet paneli.
 *
 * Veri kaynağı: Rust köprüsündeki sohbet halkası.
 * - Turlar: get_dta_chat_since(cursor) ile 2 sn'de bir çekilir (DTA'nın
 *   POST /dta/chat ile ittiği konuşma turları).
 * - Panel mesajı: send_dta_panel_message → outbox'a yazılır; DTA poller'ı
 *   2 sn'de bir çeker ve Jarvis'e iletir.
 *
 * Saf modül: DOM'a doğrudan erişir ama Three.js/analiz durumuna dokunmaz;
 * index.html'deki #dta-chat-panel hostuna bağlanır.
 * Hedef kısayolları paneldeki BİRLEŞİK HEDEFLER sıralamasını (rankLegacyTargetsForReview)
 * birebir kullanır; paralel numaralandırma üretilmez.
 */

import { state } from "../app/state.js";
import { rankLegacyTargetsForReview } from "../viewer/legacyMergedTargetModel.js";

const POLL_INTERVAL_MS = 2000;
const TARGET_SHORTCUT_LIMIT = 4;

let chatCursor = 0;
let pollTimer = null;
let sending = false;
let onlineState = false;
let lastTurnCount = -1;
let autoScroll = true;
let chipSignature = "";
/**
 * Kanonik sohbet günlüğü: [{role, text, ts}] — vaka oturumuna yazılır ve
 * arşiv/vaka açılışında geri yüklenir. Rust halkası tur id'leri kullanır;
 * bu günlük salt görüntü + kalıcılık sorumludur.
 */
let chatLog = [];
/** Aktif vaka anahtarı; değişince sohbet günlüğü sıfırlanır (yeni vaka). */
let chatCaseKey = "";
let fieldSessionControllerRef = null;
let persistTimer = null;
/** Otomatik katlama zamanlayıcısı (panel açıkken asistan yanıtı sonrası çalışır) */
let autoCollapseTimer = null;
/** Ayarlı süre (saniye). 0 = hiç katlama. loadAutoCollapseSetting ile dolar. */
let autoCollapseSecs = 0;
/** DTA penceresi tray'de gizli mi (Rust dta_window_hidden ile senkron) */
let dtaWindowHidden = false;

/** DOM referansları (bind sonrası dolar) */
let els = null;

function $(id) {
  return document.getElementById(id);
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Hedef kartı kısayollarını üretir (DOM'suz, test edilebilir).
 * Sıralama paneldeki birleşik hedef kartlarıyla aynıdır:
 * 1. = ÖNCE İNCELE, sonra ADAY 2, ADAY 3…
 * @returns {Array<{targetId: string, rank: number, label: string, question: string}>}
 */
export function planTargetShortcuts(targets = [], limit = TARGET_SHORTCUT_LIMIT) {
  const ranked = rankLegacyTargetsForReview(Array.isArray(targets) ? targets : []);
  const chips = ranked.slice(0, Math.max(0, limit)).map((target, index) => {
    const rank = index + 1;
    return {
      targetId: String(target?.targetId || ""),
      rank,
      label: rank === 1 ? "★ Önce incele" : `Aday ${rank}`,
      question: `3D'deki ${rank}. hedefi açıkla`,
    };
  });
  if (ranked.length) {
    chips.push({ targetId: "", rank: 0, label: "Özet", question: "3D'deki tüm hedefleri özetle" });
  }
  return chips;
}

/**
 * Tur listesini role ayrıştırıp render planına çevirir (DOM'suz, test edilebilir).
 * @returns {Array<{role: string, who: string, text: string, cls: string, meta: string}>}
 */
export function planChatTurns(turns) {
  if (!Array.isArray(turns)) return [];
  return turns.map((turn) => {
    const role = String(turn?.role || "assistant").toLowerCase();
    const isUser = role === "user";
    const isSystem = role === "system";
    return {
      role,
      who: isUser ? "Siz" : isSystem ? "Sistem" : "DTA",
      text: String(turn?.text || ""),
      cls: isUser ? "is-user" : isSystem ? "is-system" : "is-assistant",
      meta: hhmm(turn?.ts) ? `${isUser ? "Siz" : isSystem ? "Sistem" : "DTA"} · ${hhmm(turn?.ts)}` : isUser ? "Siz" : isSystem ? "Sistem" : "DTA",
    };
  });
}

function hhmm(ts) {
  if (!ts) return "";
  try {
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function renderTurns(turns) {
  if (!els?.body || !Array.isArray(turns)) return;
  for (const plan of planChatTurns(turns)) {
    const row = document.createElement("div");
    row.className = `dta-chat-msg ${plan.cls}`;
    const meta = document.createElement("span");
    meta.className = "dta-chat-meta";
    meta.textContent = plan.meta;
    const text = document.createElement("span");
    text.className = "dta-chat-text";
    text.textContent = plan.text;
    row.append(meta, text);
    els.body.appendChild(row);
  }
  lastTurnCount = els.body.children.length;
  if (autoScroll) {
    els.body.scrollTop = els.body.scrollHeight;
  }
}

async function pollOnce() {
  if (!els || document.hidden) return;
  try {
    const { getDtaChatSince } = await import("../api/tauri.js");
    const resp = await getDtaChatSince(chatCursor);
    if (!resp) return;
    const wasOnline = onlineState;
    onlineState = !!resp.dtaOnline;
    if (onlineState !== wasOnline) updateStatus();
    refreshTargetChips();
    if (Array.isArray(resp.turns) && resp.turns.length) {
      chatCursor = Number(resp.cursor) || chatCursor;
      const canonical = resp.turns.map((t) => ({
        role: String(t.role || "assistant"),
        text: String(t.text || ""),
        ts: Number(t.ts) || 0,
      }));
      recordTurnsToSession(canonical);
      renderTurns(resp.turns);
      if (els.host.dataset.open !== "1") {
        // DTA konuşmaya devam ederken yanıtlar panelde görünür olsun:
        // asistan yanıtı gelince panel kendiliğinden açılır.
        const hasAssistant = resp.turns.some((t) => String(t.role) === "assistant");
        if (hasAssistant) {
          els.host.dataset.open = "1";
          els.badge.hidden = true;
          scheduleAutoCollapse();
        } else {
          els.badge.hidden = false;
        }
      }
    }
  } catch {
    /* Tauri olmayan ortamda sessizce yok say */
  }
}

function updateStatus() {
  if (!els?.status) return;
  els.status.dataset.state = onlineState ? "online" : "off";
  els.status.textContent = onlineState ? "DTA bağlı" : "DTA bekleniyor";
}

/**
 * Otomatik katlama zamanlayıcısını (yeniden) kurar: panel açıkken çağrılır.
 * Süre 0 ise zamanlayıcı kurulmaz (panel açık kalır).
 */
export function scheduleAutoCollapse() {
  if (autoCollapseTimer) {
    clearTimeout(autoCollapseTimer);
    autoCollapseTimer = null;
  }
  if (!els?.host || els.host.dataset.open !== "1") return;
  const secs = Number(autoCollapseSecs) || 0;
  if (secs <= 0) return;
  autoCollapseTimer = setTimeout(() => {
    autoCollapseTimer = null;
    if (!els?.host) return;
    // Kullanıcı bu arada elle yazışmaya başladıysa katlamayalım
    if (document.activeElement === els.input) {
      scheduleAutoCollapse();
      return;
    }
    els.host.dataset.open = "0";
  }, secs * 1000);
}

/** Kullanıcı panelle etkileşime girdiğinde zamanlayıcıyı yeniler. */
function resetAutoCollapseOnActivity() {
  if (els?.host?.dataset.open === "1") scheduleAutoCollapse();
}

/**
 * DTA penceresini tray'e küçültür / geri getirir (istemci tarafı geçici
 * durum, Rust dta_window_hidden ile senkron; DTA poller istekleri çeker).
 */
export async function toggleDtaWindowHidden() {
  const next = !dtaWindowHidden;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("request_dta_window", { action: next ? "hide" : "restore" });
    dtaWindowHidden = next;
    updateHideDtaUi();
  } catch (e) {
    console.warn("dta window toggle:", e);
    if (els?.status) {
      els.status.textContent = "Pencere isteği iletilemedi";
      setTimeout(updateStatus, 2500);
    }
  }
}

function updateHideDtaUi() {
  if (!els?.hideDta) return;
  els.hideDta.textContent = dtaWindowHidden ? "D'yi göster" : "D'yi gizle";
  els.hideDta.title = dtaWindowHidden
    ? "DTA penceresini geri getir"
    : "DTA penceresini tray'e küçült (konuşma sürer)";
  els.hideDta.dataset.hidden = dtaWindowHidden ? "1" : "0";
}

/** Ayarlı süreyi bellek + kalıcı ayarlara yazar. */
export async function setAutoCollapseSecs(secs) {
  const value = Math.max(0, Math.min(3600, Math.floor(Number(secs) || 0)));
  autoCollapseSecs = value;
  syncCollapseSelect();
  scheduleAutoCollapse();
  try {
    const { setDtaPanelAutoCollapse } = await import("../api/tauri.js");
    await setDtaPanelAutoCollapse(value);
  } catch {
    /* Tauri olmayan ortamda yalnız bellek */
  }
}

function syncCollapseSelect() {
  if (!els?.collapse) return;
  const known = [0, 5, 10, 15, 30, 60];
  if (!known.includes(Number(autoCollapseSecs))) {
    // Özel değer: geçici option ekle
    let opt = els.collapse.querySelector("option[data-custom]");
    if (!opt) {
      opt = document.createElement("option");
      opt.dataset.custom = "1";
      els.collapse.appendChild(opt);
    }
    opt.value = String(autoCollapseSecs);
    opt.textContent = `${autoCollapseSecs} sn`;
  }
  els.collapse.value = String(autoCollapseSecs);
}

/** Kalıcı ayardan süreyi yükler (panel bind anında bir kez). */
export async function loadAutoCollapseSetting() {
  try {
    const { getAppSettings } = await import("../api/tauri.js");
    const s = await getAppSettings();
    autoCollapseSecs = Math.max(0, Math.min(3600, Math.floor(Number(s?.dtaPanelAutoCollapseSecs) || 0)));
  } catch {
    autoCollapseSecs = 0;
  }
  syncCollapseSelect();
  return autoCollapseSecs;
}

function updateCollapsedHeight() {
  if (!els?.host || !els?.body) return;
  // CSS ile yönetiliyor; burada yalnız okunur yükseklik sınıfı tutulur
  els.host.classList.toggle("has-content", (lastTurnCount || 0) > 0);
}

async function sendText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || sending) return;
  sending = true;
  if (els?.send) els.send.disabled = true;
  try {
    const { sendDtaPanelMessage } = await import("../api/tauri.js");
    await sendDtaPanelMessage(trimmed);
    // Kendi mesajımızı hemen gösterelim + oturuma yazalım; tur yanıtı DTA'dan gelecek
    const turn = { role: "user", text: trimmed, ts: Date.now(), meta: "panel" };
    recordTurnsToSession([turn]);
    renderTurns([turn]);
    if (els?.status) els.status.textContent = "DTA'ya iletildi";
    setTimeout(updateStatus, 2500);
  } catch (e) {
    if (els?.status) {
      els.status.textContent = "Gönderilemedi — VOTEX masaüstü gerekli";
      els.status.dataset.state = "off";
    }
    console.warn("dta chat send:", e);
  } finally {
    sending = false;
    if (els?.send) els.send.disabled = false;
  }
}

async function sendMessage() {
  if (!els?.input) return;
  const text = els.input.value.trim();
  if (!text) return;
  await sendText(text);
  els.input.value = "";
  els.input.focus();
}

/**
 * Turları kanonik günlüğe ekler ve vaka oturumuna yazar (debounce'lu persist).
 * Oturum denetleyicisi yoksa (ör. test ortamı) yalnız bellekte tutulur.
 */
function recordTurnsToSession(turns) {
  if (!Array.isArray(turns) || !turns.length) return;
  const known = new Set(chatLog.map((t) => `${t.role}:${t.text.slice(0, 120)}`));
  const fresh = turns.filter((t) => !known.has(`${t.role}:${t.text.slice(0, 120)}`));
  if (!fresh.length) return;
  chatLog = [...chatLog, ...fresh].slice(-100);
  const controller = fieldSessionControllerRef;
  if (!controller?.session?.key) return;
  controller.appendDtaChat(fresh);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { void controller.persist(); } catch { /* kalıcılık başarısızsa bellek devam eder */ }
  }, 800);
}

/**
 * Vaka değiştiğinde çağrılır: sohbet günlüğünü kayıtlı oturumdan yükler ve
 * Rust halkasındaki canlı turlarla birleştirir (dedup'lı).
 * @param {{ caseKey?: string, session?: object|null }} input
 */
export function restoreDtaChatLog({ caseKey = "", session = null } = {}) {
  const key = String(caseKey || session?.key || "");
  const saved = Array.isArray(session?.dtaChat) ? session.dtaChat : [];
  const sameCase = key && key === chatCaseKey;
  if (!sameCase) {
    chatCaseKey = key;
    chatLog = [];
  }
  const canonical = saved.map((t) => ({
    role: String(t.role || "assistant"),
    text: String(t.text || ""),
    ts: Number(t.ts) || 0,
  }));
  recordTurnsToSession(canonical);
  if (els?.body) {
    els.body.innerHTML = "";
    lastTurnCount = 0;
    renderTurns(chatLog);
  }
  return chatLog.length;
}

/** Testler ve dış okuma için kanonik günlüğün kopyası. */
export function dtaChatLogSnapshot() {
  return chatLog.map((t) => ({ ...t }));
}

/** Oturum denetleyicisini enjekte eder (legacyDikPanel bind anında). */
export function setDtaChatSessionController(controller) {
  fieldSessionControllerRef = controller || null;
}

/** Hedef kısayol çiplerini panel verisiyle tazeler; imza değişmeden yeniden çizmez. */
export function refreshTargetChips() {
  if (!els?.chips) return;
  const targets = state?.legacyFieldModel?.mergedTargets;
  const chips = planTargetShortcuts(targets);
  const signature = chips.map((c) => `${c.targetId}:${c.rank}`).join("|");
  if (signature === chipSignature) return;
  chipSignature = signature;
  els.chips.innerHTML = "";
  if (!chips.length) {
    els.chips.hidden = true;
    return;
  }
  els.chips.hidden = false;
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dta-chat-chip";
    btn.textContent = chip.label;
    btn.title = chip.question;
    btn.dataset.targetId = chip.targetId;
    btn.addEventListener("click", () => {
      void sendText(chip.question);
    });
    els.chips.appendChild(btn);
  }
}

function bindScroll() {
  if (!els?.body) return;
  els.body.addEventListener("scroll", () => {
    const el = els.body;
    autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  });
}

export function bindDtaChatPanel() {
  const host = $("dta-chat-panel");
  if (!host || host.dataset.bound === "1") return host;
  host.dataset.bound = "1";
  els = {
    host,
    body: $("dta-chat-body"),
    input: $("dta-chat-input"),
    send: $("dta-chat-send"),
    status: $("dta-chat-status"),
    badge: $("dta-chat-badge"),
    toggle: $("dta-chat-toggle"),
    chips: $("dta-chat-chips"),
    collapse: $("dta-chat-collapse"),
    hideDta: $("dta-chat-hide-dta"),
  };

  els.toggle?.addEventListener("click", () => {
    const collapsed = host.dataset.open !== "1";
    host.dataset.open = collapsed ? "1" : "0";
    if (collapsed) {
      els.badge.hidden = true;
      els.input?.focus();
      scheduleAutoCollapse();
    } else if (autoCollapseTimer) {
      clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }
  });
  els.collapse?.addEventListener("change", () => {
    void setAutoCollapseSecs(Number(els.collapse.value) || 0);
  });
  els.hideDta?.addEventListener("click", () => void toggleDtaWindowHidden());
  // Panel etkileşimi zamanlayıcıyı tazeler
  ["click", "keydown", "scroll"].forEach((evt) => {
    host.addEventListener(evt, resetAutoCollapseOnActivity, { passive: true });
  });
  els.send?.addEventListener("click", () => sendMessage());
  els.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  bindScroll();
  updateStatus();

  if (!pollTimer) {
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  }
  void loadAutoCollapseSetting();
  pollOnce();
  return host;
}

export function stopDtaChatPanel() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (autoCollapseTimer) {
    clearTimeout(autoCollapseTimer);
    autoCollapseTimer = null;
  }
}

/** Testler için: saf yardımcılar (DOM gerektirmez) */
export const __internals = { esc, hhmm };
