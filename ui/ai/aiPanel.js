/**
 * aiPanel.js — VOTEX AI paneli.
 *
 * Sol panelden erişilen AI yardimcısı:
 *   - Bağlantı durumu + model seçimi
 *   - Sohbet (chat) arayüzü
 *   - Hızlı analiz butonları (image, anomaly, report)
 *   - Model indirme
 *
 * Kullanım:
 *   import { initAIPanel } from "../ai/aiPanel.js";
 *   initAIPanel();
 */

import { aiClient } from "./aiClient.js";

const $ = (sel) => document.querySelector(sel);

/* ── HTML Şablonu ─────────────────────────────────────── */
function panelHTML() {
  return `
  <div id="ai-panel" class="ai-panel" style="display:none;">
    <div class="ai-panel-header">
      <span class="ai-icon">🤖</span>
      <span class="ai-title">YAPAY ZEKA</span>
      <button id="ai-close" class="ai-close-btn" title="Kapat">✕</button>
    </div>

    <!-- Bağlantı Durumu -->
    <div id="ai-status" class="ai-status disconnected">
      <div class="ai-status-dot"></div>
      <span id="ai-status-text">Bağlantı yok</span>
      <button id="ai-connect-btn" class="ai-btn-small">Bağlan</button>
    </div>

    <!-- Bağlantı Ayarları (collapse) -->
    <div id="ai-settings" class="ai-settings" style="display:none;">
      <label>Sunucu URL:</label>
      <input id="ai-server-url" type="text" value="http://127.0.0.1:8080" class="ai-input" />
      <button id="ai-save-url" class="ai-btn-small">Kaydet</button>
    </div>

    <!-- Model Seçimi -->
    <div id="ai-model-section" class="ai-section" style="display:none;">
      <div class="ai-section-header">
        <span>📦 Modeller</span>
        <button id="ai-refresh-models" class="ai-btn-tiny" title="Yenile">🔄</button>
      </div>
      <select id="ai-model-select" class="ai-select">
        <option value="">Model seçin...</option>
      </select>
      <div id="ai-model-actions" class="ai-model-actions">
        <button id="ai-pull-btn" class="ai-btn-small">📦 Model İndir</button>
      </div>
    </div>

    <!-- Hızlı Aksiyonlar -->
    <div id="ai-actions" class="ai-actions" style="display:none;">
      <div class="ai-section-header"><span>⚡ Hızlı Analiz</span></div>
      <button id="ai-analyze-img" class="ai-action-btn">🔍 Görseli AI ile Analiz Et</button>
      <button id="ai-detect-anomaly" class="ai-action-btn">📊 Anomali Tespit Et</button>
      <button id="ai-gen-report" class="ai-action-btn">📝 Rapor Oluştur</button>
    </div>

    <!-- Sohbet -->
    <div id="ai-chat-section" class="ai-chat-section" style="display:none;">
      <div class="ai-section-header"><span>💬 Sohbet</span></div>
      <div id="ai-chat-messages" class="ai-chat-messages"></div>
      <div class="ai-chat-input-row">
        <textarea id="ai-chat-input" class="ai-chat-input" placeholder="AI'ya soru sor..." rows="2"></textarea>
        <button id="ai-chat-send" class="ai-btn-send">➤</button>
      </div>
    </div>

    <!-- Sonuç Alanı -->
    <div id="ai-result" class="ai-result" style="display:none;">
      <div class="ai-section-header">
        <span>📋 Sonuç</span>
        <button id="ai-result-close" class="ai-btn-tiny">✕</button>
      </div>
      <div id="ai-result-content" class="ai-result-content"></div>
    </div>
  </div>`;
}

/* ── Stil ─────────────────────────────────────────────── */
function injectStyles() {
  if (document.getElementById("ai-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "ai-panel-styles";
  style.textContent = `
    .ai-panel {
      position: fixed; top: 52px; left: 310px; width: 320px;
      max-height: calc(100vh - 60px);
      background: #0b1218; border: 1px solid #1a3040; border-radius: 8px;
      color: #c8d8e8; font-size: 13px; z-index: 1000;
      display: flex; flex-direction: column;
      box-shadow: 0 4px 24px rgba(0,0,0,0.6);
      overflow: hidden;
    }
    .ai-panel-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; background: #0d1820;
      border-bottom: 1px solid #1a3040;
    }
    .ai-icon { font-size: 18px; }
    .ai-title { font-weight: 700; font-size: 13px; letter-spacing: 1px; flex: 1; color: #6ec8ff; }
    .ai-close-btn {
      background: none; border: none; color: #888; cursor: pointer; font-size: 16px;
    }
    .ai-close-btn:hover { color: #ff6b6b; }

    .ai-status {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-bottom: 1px solid #1a2a35;
    }
    .ai-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ff4444; flex-shrink: 0;
    }
    .ai-status.connected .ai-status-dot { background: #44cc66; }
    .ai-status-text { flex: 1; font-size: 12px; }

    .ai-settings { padding: 8px 12px; border-bottom: 1px solid #1a2a35; }
    .ai-settings label { display: block; font-size: 11px; color: #778; margin-bottom: 4px; }
    .ai-input {
      width: 100%; padding: 5px 8px; background: #0a1418; border: 1px solid #1a3040;
      color: #c8d8e8; border-radius: 4px; font-size: 12px; margin-bottom: 6px;
    }

    .ai-section { padding: 8px 12px; border-bottom: 1px solid #1a2a35; }
    .ai-section-header {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; font-weight: 600; color: #8ab4d0; margin-bottom: 6px;
    }

    .ai-select {
      width: 100%; padding: 5px 8px; background: #0a1418; border: 1px solid #1a3040;
      color: #c8d8e8; border-radius: 4px; font-size: 12px;
    }

    .ai-actions { padding: 8px 12px; border-bottom: 1px solid #1a2a35; }
    .ai-action-btn {
      display: block; width: 100%; padding: 8px 10px; margin: 4px 0;
      background: #0d1e28; border: 1px solid #1a3a50; color: #8cc4e0;
      border-radius: 4px; cursor: pointer; font-size: 12px; text-align: left;
      transition: all 0.15s;
    }
    .ai-action-btn:hover { background: #152838; border-color: #2a5a70; color: #a0daf8; }

    .ai-chat-section {
      display: flex; flex-direction: column;
      padding: 8px 12px; border-bottom: 1px solid #1a2a35;
      max-height: 300px;
    }
    .ai-chat-messages {
      flex: 1; max-height: 200px; overflow-y: auto;
      padding: 6px; margin-bottom: 6px;
    }
    .ai-chat-msg {
      padding: 6px 10px; margin: 4px 0; border-radius: 8px;
      font-size: 12px; line-height: 1.4;
    }
    .ai-chat-msg.user { background: #1a3050; color: #a0d0f0; margin-left: 20px; }
    .ai-chat-msg.ai { background: #0d1a22; color: #c0d8e8; margin-right: 20px; border: 1px solid #1a2a35; }
    .ai-chat-msg.error { background: #2a1018; color: #ff8888; }

    .ai-chat-input-row { display: flex; gap: 6px; }
    .ai-chat-input {
      flex: 1; padding: 6px 8px; background: #0a1418; border: 1px solid #1a3040;
      color: #c8d8e8; border-radius: 4px; font-size: 12px; resize: none;
    }
    .ai-btn-send {
      padding: 6px 12px; background: #1a4060; border: 1px solid #2a6080;
      color: #80c0ff; border-radius: 4px; cursor: pointer; font-size: 14px;
    }
    .ai-btn-send:hover { background: #2a5070; }

    .ai-result {
      padding: 8px 12px; max-height: 250px; overflow-y: auto;
    }
    .ai-result-content {
      font-size: 12px; line-height: 1.5; color: #b8c8d8;
      white-space: pre-wrap;
    }

    .ai-btn-small {
      padding: 4px 10px; background: #1a3040; border: 1px solid #2a5060;
      color: #80c0ff; border-radius: 4px; cursor: pointer; font-size: 11px;
    }
    .ai-btn-small:hover { background: #2a4050; }
    .ai-btn-tiny {
      background: none; border: none; color: #6090b0; cursor: pointer; font-size: 14px;
    }
    .ai-model-actions { margin-top: 6px; }

    .ai-loading {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid #2a4060; border-top-color: #60a0d0;
      border-radius: 50%; animation: ai-spin 0.8s linear infinite;
    }
    @keyframes ai-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

/* ── Initialization ───────────────────────────────────── */
export function initAIPanel() {
  injectStyles();

  // Panel'i DOM'a ekle
  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelHTML();
  document.body.appendChild(wrapper.firstElementChild);

  // Butonları bağla
  const panel = $("#ai-panel");
  const statusEl = $("#ai-status");
  const statusText = $("#ai-status-text");
  const settingsEl = $("#ai-settings");
  const modelSection = $("#ai-model-section");
  const actionsEl = $("#ai-actions");
  const chatSection = $("#ai-chat-section");

  // Toggle — header'a tıklayınca aç/kapa
  $("#ai-close").onclick = () => { panel.style.display = "none"; };

  // Bağlantı
  $("#ai-connect-btn").onclick = async () => {
    statusText.textContent = "Bağlanıyor...";
    const status = await aiClient.connect();
    if (status) {
      statusEl.className = "ai-status connected";
      statusText.textContent = `Bağlı — ${status.models_loaded} model`;
      modelSection.style.display = "";
      actionsEl.style.display = "";
      chatSection.style.display = "";
      refreshModelSelect();
    } else {
      statusEl.className = "ai-status disconnected";
      statusText.textContent = "Bağlantı başarısız";
      settingsEl.style.display = settingsEl.style.display === "none" ? "" : "none";
    }
  };

  // URL kaydet
  $("#ai-save-url").onclick = () => {
    const url = $("#ai-server-url").value.trim();
    if (url) aiClient.connect(url);
  };

  // Model listesini yenile
  $("#ai-refresh-models").onclick = refreshModelSelect;

  // Model indir
  $("#ai-pull-btn").onclick = async () => {
    const name = prompt("İndirilecek model adı (örn: gemma2:2b, llava:7b):");
    if (!name) return;
    showResult(`📦 "${name}" indiriliyor...`);
    try {
      await aiClient.pullModel(name);
      showResult(`✓ "${name}" indirme başlatıldı. Ollama loglarından takip edin.`);
      setTimeout(refreshModelSelect, 3000);
    } catch (e) {
      showResult(`✗ Hata: ${e.message}`);
    }
  };

  // Hızlı aksiyonlar
  $("#ai-analyze-img").onclick = async () => {
    if (!window.__aiAnalyzeImage) {
      showResult("⚠️ Önce bir görsel analiz çalıştırın (Image Analysis).");
      return;
    }
    showResult("🔍 AI ile görsel analiz çalıştırılıyor...");
    try {
      const result = await window.__aiAnalyzeImage();
      showResult(result.text || "Sonuç bulunamadı");
    } catch (e) {
      showResult(`✗ Hata: ${e.message}`);
    }
  };

  $("#ai-detect-anomaly").onclick = async () => {
    if (!window.__surfaceState?.structures) {
      showResult("⚠️ Önce bir analiz çalıştırın.");
      return;
    }
    showResult("📊 Anomali tespiti çalışıyor...");
    try {
      const structures = window.__surfaceState.structures.metals || [];
      const result = await aiClient.detectAnomaly(structures, "VOTEX magnetic anomaly data");
      showResult(result.summary || "Anomali tespit edilemedi");
    } catch (e) {
      showResult(`✗ Hata: ${e.message}`);
    }
  };

  $("#ai-gen-report").onclick = async () => {
    if (!window.__surfaceState) {
      showResult("⚠️ Önce bir analiz çalıştırın.");
      return;
    }
    showResult("📝 Rapor oluşturuluyor...");
    try {
      const s = window.__surfaceState;
      const result = await aiClient.generateReport(
        [...(s.structures?.chambers || []), ...(s.structures?.tunnels || []), ...(s.structures?.metals || [])],
        { map_width_m: s.map_width_m, map_depth_m: s.map_depth_m },
        "tr"
      );
      showResult(result.report || "Rapor oluşturulamadı");
    } catch (e) {
      showResult(`✗ Hata: ${e.message}`);
    }
  };

  // Sohbet
  $("#ai-chat-send").onclick = sendChat;
  $("#ai-chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  $("#ai-result-close").onclick = () => { $("#ai-result").style.display = "none"; };

  // Global show/hide
  window.__showAIPanel = () => { panel.style.display = panel.style.display === "none" ? "" : "none"; };
}

/* ── Helpers ──────────────────────────────────────────── */
async function refreshModelSelect() {
  const sel = $("#ai-model-select");
  const models = await aiClient.listModels();
  // Geçici olarak onchange'i devre dışı bırak
  sel.onchange = null;
  sel.innerHTML = '<option value="">Model seçin...</option>';
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.size})`;
    sel.appendChild(opt);
  });
  // Önceki tercih edilen modeli seç
  if (aiClient.preferredModel) {
    sel.value = aiClient.preferredModel;
  }
  // Sadece geçerli model adlarıyla changed handler ekle
  sel.onchange = () => {
    const val = sel.value?.trim();
    if (val && val.length > 0 && !val.match(/^(list|pull|status)$/i)) {
      aiClient.setPreferredModel(val);
    }
  };
}

async function sendChat() {
  const input = $("#ai-chat-input");
  const messages = $("#ai-chat-messages");
  const text = input.value.trim();
  if (!text) return;

  // Kullanıcı mesajı
  appendChat("user", text);
  input.value = "";

  // AI yanıtı
  const aiMsg = document.createElement("div");
  aiMsg.className = "ai-chat-msg ai";
  aiMsg.innerHTML = '<span class="ai-loading"></span>';
  messages.appendChild(aiMsg);
  messages.scrollTop = messages.scrollHeight;

  try {
    let fullText = "";
    await aiClient.chatStream(text, (chunk, done) => {
      fullText += chunk;
      aiMsg.textContent = fullText || "...";
      messages.scrollTop = messages.scrollHeight;
    });
  } catch (e) {
    aiMsg.className = "ai-chat-msg error";
    aiMsg.textContent = `Hata: ${e.message}`;
  }
}

function appendChat(role, text) {
  const messages = $("#ai-chat-messages");
  const div = document.createElement("div");
  div.className = `ai-chat-msg ${role}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showResult(text) {
  const el = $("#ai-result");
  const content = $("#ai-result-content");
  el.style.display = "";
  content.textContent = text;
}
