import { $ } from "../app/state.js";

const MAX_LINES = 80;

function stamp() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** Pipeline telemetri satırı (sahte sensör X,Y yok). */
export function logLine(msg, level = "info") {
  const host = $("telemetry-log");
  if (!host) return;
  const line = document.createElement("div");
  line.className = `log-line ${level}`;
  line.innerHTML = `<span class="ts">[${stamp()}]</span> ${escapeHtml(String(msg))}`;
  host.appendChild(line);
  while (host.children.length > MAX_LINES) {
    host.removeChild(host.firstChild);
  }
  host.scrollTop = host.scrollHeight;
}

export function clearTelemetry() {
  const host = $("telemetry-log");
  if (host) host.innerHTML = "";
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
