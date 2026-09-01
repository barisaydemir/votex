/**
 * heartbeat.js — Küçük sol heartbeat monitörü (sistem sağlığı).
 *
 * Sol alt köşede mini ECG çizgisi + durum etiketi. Ağır bağımlılığı yoktur.
 */

import { $ } from "../app/state.js";

let ctx = null;
let w = 0;
let h = 0;
let running = false;
let busy = false;
let lastBeat = 0;
// EKG animasyonu ~25 fps yeterli: her karede çizmek boşa CPU/GPU harcar
// ve WebView kompozitörünü sürekli meşgul eder (kasma hissi).
const DRAW_INTERVAL_MS = 40;
let lastDraw = 0;

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (document.hidden) return; // pencere gizliyken hiç çizme
  if (now - lastDraw < DRAW_INTERVAL_MS) return;
  lastDraw = now;
  const x = ((now / 30) % (w + 16)) - 16;
  const amp = busy ? 6 : 3;
  ctx.clearRect(0, 0, w, h);
  // ızgara
  ctx.strokeStyle = "rgba(96,220,140,0.10)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < w; gx += 7) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, h);
    ctx.stroke();
  }
  // ECG izi
  ctx.strokeStyle = busy ? "#7ef0a8" : "rgba(126,210,150,0.85)";
  ctx.beginPath();
  const cx = w - 1 - x;
  ctx.moveTo(cx - 10, h / 2);
  ctx.lineTo(cx - 4, h / 2);
  ctx.lineTo(cx - 2, h / 2 - amp);
  ctx.lineTo(cx, h / 2 + amp * 1.4);
  ctx.lineTo(cx + 2, h / 2 - amp);
  ctx.lineTo(cx + 5, h / 2);
  ctx.lineTo(cx + 12, h / 2);
  ctx.stroke();
}

export function initHeartbeat() {
  const cv = $("heartbeat-canvas");
  if (!cv) return;
  ctx = cv.getContext("2d");
  w = cv.width;
  h = cv.height;
  running = true;
  lastBeat = performance.now();
  requestAnimationFrame(frame);
  // düzenli nabız
  setInterval(() => {
    if (running) lastBeat = performance.now();
  }, 2200);
}

export function heartbeatSet(label) {
  const el = $("heartbeat-label");
  if (el) el.textContent = label ?? "";
}

export function heartbeatBusy(b) {
  busy = !!b;
  lastBeat = performance.now();
  const el = $("heartbeat-label");
  if (el) el.classList.toggle("busy", !!b);
}