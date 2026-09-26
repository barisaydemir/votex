import { $, state } from "../app/state.js";

let timer = null;
let button = null;

function stopInternal() {
  if (timer) clearInterval(timer);
  timer = null;
  if (button) {
    button.textContent = "▶ Derinlik animasyonu";
    button.setAttribute("aria-pressed", "false");
  }
}

export function isDepthSliceAnimating() {
  return timer != null;
}

export function stopDepthSliceAnimation() {
  stopInternal();
}

export function toggleDepthSliceAnimation() {
  const slider = $("csv-depth-slice");
  if (!slider || slider.disabled || Number(slider.max) <= 0) return false;
  if (timer) {
    stopInternal();
    return false;
  }
  button = $("csv-depth-play");
  if (button) {
    button.textContent = "⏸ Durdur";
    button.setAttribute("aria-pressed", "true");
  }
  const max = Math.max(1, Number(slider.max) || 1);
  let next = Math.max(0, Number(slider.value) || 0);
  timer = setInterval(() => {
    if (!state.csvData || slider.disabled) {
      stopInternal();
      return;
    }
    next = next >= max ? 1 : next + 1;
    slider.value = String(next);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, 700);
  return true;
}

export function initDepthSliceAnimation() {
  button = $("csv-depth-play");
  button?.addEventListener("click", toggleDepthSliceAnimation);
  window.addEventListener("beforeunload", stopInternal);
}
