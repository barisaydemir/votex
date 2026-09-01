import { activateLicense, getLicenseStatus } from "../api/tauri.js";
import { $ } from "../app/state.js";
import { logLine } from "./telemetry.js";
import { setStatus } from "../app/status.js";

function fillBadge(st) {
  const el = $("license-badge");
  if (!el) return;
  if (!st) {
    el.textContent = "Lisans…";
    el.dataset.state = "wait";
    return;
  }
  if (!st.enforce) {
    el.textContent = "DEV";
    el.dataset.state = "dev";
    el.title = st.message || "Lisans zorunluluğu kapalı";
    return;
  }
  if (!st.valid) {
    const msg = String(st.message || "");
    el.textContent =
      msg.includes("başka cihaza") || msg.includes("bagli") || msg.includes("bağlı")
        ? "CİHAZ UYUŞMAZ"
        : "LİSANS YOK";
    el.dataset.state = "bad";
    el.title = msg || "";
    return;
  }
  const plan = String(st.plan || "").toUpperCase();
  const days = st.daysLeft ?? st.days_left ?? 0;
  if (st.isDemo || st.is_demo) {
    const used = st.uploadsUsed ?? st.uploads_used ?? 0;
    const lim = st.uploadsLimit ?? st.uploads_limit ?? 50;
    el.textContent = `DEMO · ${days}g · ${used}/${lim}`;
    el.dataset.state = "demo";
  } else {
    el.textContent = `${plan} · ${days}g`;
    el.dataset.state = "ok";
  }
  el.title = st.hwidShort || st.hwid_short || "Lisans ekranını aç";
}

function canContinue(st) {
  if (!st) return false;
  if (!st.enforce) return true;
  return Boolean(st.valid);
}

function fillGate(st) {
  const gate = $("license-gate");
  if (!gate) return;
  const planEl = $("license-gate-plan");
  const daysEl = $("license-gate-days");
  const hwidEl = $("license-gate-hwid");
  const subEl = $("license-gate-sub");
  const cont = $("license-gate-continue");
  if (!st) {
    if (subEl) subEl.textContent = "Lisans durumu alınamadı.";
    if (cont) cont.disabled = true;
    return;
  }
  const plan = String(st.plan || "—").toUpperCase();
  const days = st.daysLeft ?? st.days_left ?? 0;
  const hwidShort = st.hwidShort || st.hwid_short || "—";
  const hwidFull = st.hwid || "";
  if (planEl) planEl.textContent = plan;
  if (daysEl) {
    daysEl.textContent = st.valid ? `${days} gün` : "—";
  }
  if (hwidEl) {
    hwidEl.textContent = hwidShort;
    hwidEl.title = hwidFull || hwidShort;
    hwidEl.dataset.full = hwidFull;
  }
  if (subEl) {
    if (!st.enforce) {
      subEl.textContent = "Geliştirme modu — lisans zorunlu değil.";
    } else if (!st.valid) {
      subEl.textContent = st.message || "Geçerli lisans gerekli.";
    } else if (st.isDemo || st.is_demo) {
      const used = st.uploadsUsed ?? st.uploads_used ?? 0;
      const lim = st.uploadsLimit ?? st.uploads_limit ?? 50;
      subEl.textContent = `Demo aktif · ${used}/${lim} dosya · ${st.daysLeft ?? st.days_left ?? "?"} gün. Lisans, +dosya veya +gün kredi kodu girebilirsiniz.`;
    } else {
      subEl.textContent = st.message || "Lisans aktif.";
    }
  }
  if (cont) cont.disabled = !canContinue(st);
}

async function copyMachineCode() {
  const hwidEl = $("license-gate-hwid");
  const code = (hwidEl?.dataset?.full || hwidEl?.textContent || "").trim();
  if (!code || code === "—") {
    showGateMsg("Makine kodu yok");
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    showGateMsg("Makine kodu kopyalandı — üreticiye gönderin.", true);
    setStatus("Makine kodu panoda");
    logLine("Makine kodu kopyalandı", "ok");
  } catch (e) {
    showGateMsg(String(e?.message || e));
  }
}

function showGateMsg(text, ok = false) {
  const el = $("license-gate-msg");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.ok = ok ? "1" : "0";
}

export function openLicenseGate() {
  const gate = $("license-gate");
  if (!gate) return;
  gate.hidden = false;
  showGateMsg("");
  const input = $("license-gate-token");
  if (input) setTimeout(() => input.focus(), 50);
}

export function closeLicenseGate() {
  const gate = $("license-gate");
  if (gate) gate.hidden = true;
}

export async function refreshLicenseBadge() {
  try {
    const st = await getLicenseStatus();
    fillBadge(st);
    fillGate(st);
    return st;
  } catch {
    fillBadge(null);
    fillGate(null);
    return null;
  }
}

async function doActivate(tokenInput) {
  const token = String(tokenInput?.value || "").trim();
  if (!token) {
    setStatus("Lisans kodu girin");
    showGateMsg("Lisans kodu girin");
    return;
  }
  try {
    const res = await activateLicense(token);
    fillBadge(res?.status);
    fillGate(res?.status);
    const msg = res?.message || "Lisans kaydedildi";
    logLine(msg, res?.ok ? "ok" : "warn");
    setStatus(msg);
    showGateMsg(msg, Boolean(res?.ok));
    if (res?.ok) {
      tokenInput.value = "";
      const side = $("license-token");
      if (side) side.value = "";
    }
  } catch (e) {
    logLine(String(e), "err");
    setStatus(String(e));
    showGateMsg(String(e));
  }
}

export function wireLicenseUi() {
  const btn = $("btn-license-activate");
  const input = $("license-token");
  if (btn && input) {
    btn.addEventListener("click", () => doActivate(input));
  }

  const gateAct = $("license-gate-activate");
  const gateTok = $("license-gate-token");
  const gateCont = $("license-gate-continue");
  const gateCopy = $("license-gate-copy-hwid");
  if (gateCopy) {
    gateCopy.addEventListener("click", () => copyMachineCode());
  }
  if (gateAct && gateTok) {
    gateAct.addEventListener("click", () => doActivate(gateTok));
    gateTok.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doActivate(gateTok);
    });
  }
  if (gateCont) {
    gateCont.addEventListener("click", () => {
      if (!gateCont.disabled) closeLicenseGate();
    });
  }

  const badge = $("license-badge");
  if (badge) {
    badge.addEventListener("click", () => {
      openLicenseGate();
      refreshLicenseBadge();
    });
  }

  refreshLicenseBadge().then((st) => {
    // Açılışta lisans ekranı (enforce açıkken)
    if (st && st.enforce) {
      openLicenseGate();
    }
  });
  setInterval(refreshLicenseBadge, 60000);
}
