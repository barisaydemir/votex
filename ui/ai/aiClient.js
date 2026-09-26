/**
 * aiClient.js — VOTEX AI istemcisi.
 *
 * Yerel AI sunucusuyla (FastAPI + Ollama) iletişim kurar.
 * Image analiz, anomali tespiti, rapor üretme ve genel sohbet.
 *
 * Kullanım:
 *   import { aiClient } from "../ai/aiClient.js";
 *   await aiClient.connect();
 *   const result = await aiClient.analyzeImage(base64, prompt);
 */

const DEFAULT_URL = "http://127.0.0.1:8080";

class AIClient {
  constructor() {
    this.serverUrl = localStorage.getItem("votex_ai_url") || DEFAULT_URL;
    this.connected = false;
    this.models = [];
    this.preferredModel = null;
    this.ws = null;
    this._wsCallbacks = new Map();
    this._wsId = 0;
  }

  /* ── Connection ─────────────────────────────────────── */

  async connect(url) {
    if (url) {
      this.serverUrl = url;
      localStorage.setItem("votex_ai_url", url);
    }
    try {
      const res = await fetch(`${this.serverUrl}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = await res.json();
      this.connected = true;
      this.models = status.models_available || [];
      console.log(`[AI] Connected — ${this.models.length} models, Ollama: ${status.ollama_connected}`);
      return status;
    } catch (e) {
      this.connected = false;
      console.warn("[AI] Connection failed:", e.message);
      return null;
    }
  }

  async disconnect() {
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /* ── Image Analysis ─────────────────────────────────── */

  /**
   * Manyetik/harita görselini AI ile analiz et.
   * @param {string} imageBase64 — base64 encoded image (data:image/... prefix'siz)
   * @param {string} prompt — analiz talimatı
   * @param {string} [model] — kullanılacak model (varsayılan: en iyi vision model)
   * @returns {Promise<{text, model_used, latency_ms}>}
   */
  async analyzeImage(imageBase64, prompt, model) {
    return this._post("/analyze/image", {
      image_base64: imageBase64,
      prompt: prompt || "Bu manyetik harita görselinde yeraltı yapılarını analiz et. Odalar, tüneller, metal tespitleri ve su kaynaklarını belirle.",
      model: model || this.preferredModel,
    });
  }

  /* ── Anomaly Detection ──────────────────────────────── */

  /**
   * Manyetik veri noktalarını AI ile analiz et.
   * @param {Array<{x,y,z,bx,by,bz}>} dataPoints
   * @param {string} [context]
   * @returns {Promise<{detections, summary, latency_ms}>}
   */
  async detectAnomaly(dataPoints, context = "") {
    return this._post("/detect/anomaly", {
      data_points: dataPoints,
      context,
      model: this.preferredModel,
    });
  }

  /* ── Report Generation ──────────────────────────────── */

  /**
   * Analiz sonuçlarından profesyonel rapor üret.
   * @param {Array} structures — tespit edilen yapılar
   * @param {object} surfaceInfo — yüzey bilgisi
   * @param {string} [language] — "tr" veya "en"
   * @returns {Promise<{report, model_used, latency_ms}>}
   */
  async generateReport(structures, surfaceInfo, language = "tr") {
    return this._post("/generate/report", {
      structures,
      surface_info: surfaceInfo,
      language,
      model: this.preferredModel,
    });
  }

  /* ── Chat ───────────────────────────────────────────── */

  /**
   * Genel amaçlı sohbet.
   * @param {string} message
   * @param {string} [context]
   * @param {boolean} [stream]
   * @returns {Promise<{text}>} veya StreamingResponse
   */
  async chat(message, context = "", stream = false) {
    if (stream) {
      return this._chatStream(message, context);
    }
    return this._post("/chat", { message, context, model: this.preferredModel });
  }

  /**
   * Streaming sohbet — her token için callback.
   * @param {string} message
   * @param {function} onChunk — (text, done) çağrılır
   */
  async chatStream(message, onChunk) {
    const res = await fetch(`${this.serverUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        model: this.preferredModel,
        stream: true,
      }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onChunk("", true);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            onChunk(parsed.text || "", parsed.done || false);
          } catch {}
        }
      }
    }
  }

  /* ── Model Management ───────────────────────────────── */

  async listModels() {
    try {
      const res = await fetch(`${this.serverUrl}/models/list`);
      this.models = await res.json();
      return this.models;
    } catch {
      return [];
    }
  }

  async pullModel(name) {
    return this._post(`/models/pull?name=${encodeURIComponent(name)}`);
  }

  setPreferredModel(model) {
    // Geçersiz model adlarını reddet
    if (!model || typeof model !== "string") return;
    const trimmed = model.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (/^(list|pull|status|chat|models)$/i.test(trimmed)) return;
    this.preferredModel = trimmed;
    localStorage.setItem("votex_ai_preferred", trimmed);
  }

  /* ── WebSocket (live) ───────────────────────────────── */

  async connectWS() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/ws";
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const cb = this._wsCallbacks.get(data.id);
        if (cb) cb(data);
      } catch {}
    };
    return new Promise((resolve) => {
      this.ws.onopen = () => resolve(true);
      this.ws.onerror = () => resolve(false);
    });
  }

  /* ── Internal ───────────────────────────────────────── */

  async _post(path, body) {
    // Model adını temizle — geçersiz isimleri engelle
    if (body.model && typeof body.model === "string") {
      const m = body.model.trim();
      if (!m || m.length < 2 || /^(list|pull|status|chat|models)$/i.test(m)) {
        delete body.model;
      } else {
        body.model = m;
      }
    }
    const t0 = performance.now();
    try {
      const res = await fetch(`${this.serverUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn(`[AI] ${path} failed:`, e.message);
      throw e;
    }
  }

  async _chatStream(message, context) {
    const res = await fetch(`${this.serverUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        context,
        model: this.preferredModel,
        stream: true,
      }),
    });
    return res.body.getReader();
  }

  getStatus() {
    return {
      connected: this.connected,
      serverUrl: this.serverUrl,
      models: this.models,
      preferredModel: this.preferredModel,
    };
  }
}

export const aiClient = new AIClient();
