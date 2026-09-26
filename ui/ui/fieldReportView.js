/**
 * Saha raporu modalı — "Bitir ve Kaydet" sonrası üretilen tek sayfalık HTML
 * raporu gösterir. Yazdırma (PDF olarak kaydetme yazdırma diyaloğundan) ve
 * HTML dosyası olarak kaydetme seçenekleri sunar.
 */

import { saveFileDialog } from "../api/tauri.js";
import { $ } from "../app/state.js";
import { legacyFieldReportFileName } from "../viewer/legacyFieldReport.js";

let _bound = false;
let _html = "";
let _fileName = "";

function frame() {
  return $("field-report-frame");
}

function closeModal() {
  const modal = $("field-report-modal");
  if (modal) modal.hidden = true;
}

/** Rapor HTML'ini modalda gösterir. */
export function showLegacyFieldReport(html) {
  const modal = $("field-report-modal");
  if (!modal) return;
  bindFieldReportView();
  _html = String(html || "");
  _fileName = legacyFieldReportFileName();
  const f = frame();
  if (f) f.srcdoc = _html;
  modal.hidden = false;
}

export function bindFieldReportView() {
  if (_bound) return;
  const modal = $("field-report-modal");
  if (!modal) return;
  _bound = true;
  $("field-report-print")?.addEventListener("click", () => {
    const f = frame();
    try {
      f?.contentWindow?.focus();
      f?.contentWindow?.print();
    } catch (e) {
      console.warn("[rapor] yazdırma:", e);
    }
  });
  $("field-report-save")?.addEventListener("click", async () => {
    if (!_html) return;
    try {
      const saved = await saveFileDialog(_html, _fileName, "HTML Raporu", ["html"]);
      if (saved) closeModal();
    } catch (e) {
      console.warn("[rapor] kayıt:", e);
    }
  });
  $("field-report-close")?.addEventListener("click", closeModal);
}
