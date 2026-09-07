/**
 * shortcutHelp.js — Klavye Kısayolları Yardım Ekranı.
 *
 * "?" tuşu ile açılır, tüm kısayolları kategorilere ayrılmış şekilde gösterir.
 *
 * Kullanım:
 *   import { toggleShortcutHelp, initShortcutHelp } from "./shortcutHelp.js";
 *   initShortcutHelp();  // Klavye dinleyicisini bağla
 */

const SHORTCUTS = [
  {
    category: "🎯 Genel",
    items: [
      { keys: ["Ctrl", "Z"], desc: "Geri al (Undo)" },
      { keys: ["Ctrl", "Y"], desc: "İleri al (Redo)" },
      { keys: ["Ctrl", "S"], desc: "Oturum kaydet" },
      { keys: ["Ctrl", "O"], desc: "Oturum yükle" },
      { keys: ["Ctrl", "M"], desc: "Ölçüm modu aç/kapa" },
      { keys: ["?"], desc: "Bu yardım ekranını göster" },
    ],
  },
  {
    category: "🗺️ 3D Görünüm",
    items: [
      { keys: ["X"], desc: "X-Ray / fresnel görünümü aç/kapa" },
      { keys: ["K"], desc: "Kesit (clipping) modu aç/kapa" },
      { keys: ["↑"], desc: "Kesit yüksekliğini +1 m artır" },
      { keys: ["↓"], desc: "Kesit yüksekliğini -1 m azalt" },
      { keys: ["G"], desc: "Zemin ızgarasını aç/kapa" },
      { keys: ["H"], desc: "Manyetik heatmap'i aç/kapa" },
      { keys: ["F"], desc: "Tam ekran modu" },
    ],
  },
  {
    category: "📊 Analiz",
    items: [
      { keys: ["Ctrl", "Enter"], desc: "Analiz çalıştır" },
      { keys: ["Ctrl", "R"], desc: "PDF rapor oluştur" },
      { keys: ["1"], desc: "Derinlik profili: Yatay" },
      { keys: ["2"], desc: "Derinlik profili: Dikey" },
    ],
  },
  {
    category: "📷 Etkileşim",
    items: [
      { keys: ["Sol Tık"], desc: "Döndür" },
      { keys: ["Sağ Tık"], desc: "Kaydır" },
      { keys: ["Fare Tekerleği"], desc: "Yakınlaş/Uzaklaş" },
      { keys: ["Ctrl", "Tıkla"], desc: "Nokta seç" },
    ],
  },
];

let _overlay = null;
let _isVisible = false;

/**
 * Yardım ekranını aç/kapa.
 */
export function toggleShortcutHelp() {
  if (_isVisible) {
    hideShortcutHelp();
  } else {
    showShortcutHelp();
  }
}

/**
 * Yardım ekranını göster.
 */
export function showShortcutHelp() {
  if (_overlay) return;
  _isVisible = true;

  _overlay = document.createElement("div");
  _overlay.className = "shortcut-help-overlay";
  _overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--bg, #1a1a2e);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    color: var(--text, #eee);
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  `;

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:16px;color:var(--accent,#00ff88);">⌨️ Klavye Kısayolları</h3>
      <button id="shortcut-help-close" style="
        background:none;border:none;color:var(--muted,#888);font-size:18px;cursor:pointer;
        padding:4px 8px;border-radius:4px;
      " onmouseover="this.style.color='var(--text,#eee)'" 
         onmouseout="this.style.color='var(--muted,#888)'">✕</button>
    </div>
  `;

  for (const group of SHORTCUTS) {
    html += `<div style="margin-bottom:16px;">`;
    html += `<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--accent,#00ff88);">${group.category}</div>`;
    for (const item of group.items) {
      const keysHtml = item.keys
        .map(
          (k) =>
            `<kbd style="
              background:var(--bg-hover,#2a2a4a);
              border:1px solid var(--border,#444);
              border-radius:4px;
              padding:2px 6px;
              font-size:11px;
              font-family:monospace;
              color:var(--text,#eee);
              margin:0 2px;
            ">${k}</kbd>`
        )
        .join(" + ");
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;">
          <span style="color:var(--muted,#aaa);">${item.desc}</span>
          <span>${keysHtml}</span>
        </div>`;
    }
    html += `</div>`;
  }

  html += `
    <div style="text-align:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--line,#333);font-size:11px;color:var(--muted,#666);">
      Votex — Manyetik Anomali Tespit Sistemi
    </div>
  `;

  modal.innerHTML = html;
  _overlay.appendChild(modal);

  // Kapatma
  modal.querySelector("#shortcut-help-close").addEventListener("click", hideShortcutHelp);
  _overlay.addEventListener("click", (e) => {
    if (e.target === _overlay) hideShortcutHelp();
  });

  document.body.appendChild(_overlay);
}

/**
 * Yardım ekranını gizle.
 */
export function hideShortcutHelp() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _isVisible = false;
}

/**
 * Klavye dinleyicisini bağla — ? tuşu ile aç/kapa.
 */
export function initShortcutHelp() {
  document.addEventListener("keydown", (e) => {
    // Form elemanındaysa atla
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      toggleShortcutHelp();
    }

    // ESC ile kapat
    if (e.key === "Escape" && _isVisible) {
      hideShortcutHelp();
    }
  });
}
