/**
 * themeToggle.js — Karanlık / Aydınlık tema geçişi.
 *
 * Özellikler:
 *   • İlk yüklemede Windows tema tercihini otomatik algılar
 *   • Kullanıcı tercihini localStorage'a kaydeder
 *   • class="theme-toggle" butonuna tıklayarak geçiş yapar
 *   • Geçiş anında animasyon (opacity fade)
 *   • OS tercihi değişirse canlı güncelleme
 *
 * Kullanım:
 *   import { initTheme } from "./themeToggle.js";
 *   initTheme();
 */

const STORAGE_KEY = "votex-theme";

/**
 * Tema tercihini oku: localStorage > OS tercihi > varsayılan (karanlık)
 */
function readPreferredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* localStorage mevcut değil */ }

  // OS tercihini kontrol et
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/**
 * Temayı uygula
 */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  // Buton ikonunu güncelle
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    const icon = btn.querySelector(".theme-icon");
    const label = btn.querySelector(".theme-label");
    if (icon) icon.textContent = theme === "light" ? "🌙" : "☀️";
    if (label) label.textContent = theme === "light" ? "Karanlık" : "Aydınlık";
    btn.setAttribute("data-theme", theme);
  }
}

/**
 * Temayı değiştir ve kaydet
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";

  applyTheme(next);

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch { /* ignored */ }

  // Telemetriye bildir (varsa)
  if (typeof window.__logLine === "function") {
    window.__logLine(`Tema: ${next === "dark" ? "🌙 Karanlık" : "☀️ Aydınlık"}`, "info");
  }
}

/**
 * Tema modülünü başlat.
 * - İlk tercihi uygula
 * - Buton olayını bağla
 * - OS tercihi değişikliğini dinle
 */
export function initTheme() {
  // İlk tercihi uygula
  const initial = readPreferredTheme();
  applyTheme(initial);

  // Buton tıklama
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", toggleTheme);
  }

  // OS tema değişikliğini dinle (kullanıcı el ile değiştirmemişse)
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (mq) {
    mq.addEventListener("change", (e) => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        // Kullanıcı elle bir tercih belirlememişse OS'e göre güncelle
        if (!saved) {
          applyTheme(e.matches ? "light" : "dark");
        }
      } catch { /* ignored */ }
    });
  }
}

/**
 * Mevcut temayı döndür
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}
