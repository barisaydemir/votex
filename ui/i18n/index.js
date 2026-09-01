const STORAGE_KEY = "votex.locale";

/** @type {"tr" | "en"} */
let locale = "tr";

/** @type {Set<() => void>} */
const listeners = new Set();

/** @type {Record<string, Record<string, unknown>> | null} */
let packs = null;

export function getLocale() {
  return locale;
}

export function t(path, vars) {
  const raw = lookup(locale, path) ?? lookup("tr", path) ?? path;
  if (typeof raw !== "string") return String(path);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

export function tPhrase(text) {
  if (!text) return "";
  const s = String(text);
  if (locale === "tr") return s;
  const map = lookup("en", "phrase") || {};
  if (map[s]) return map[s];
  for (const [from, to] of Object.entries(map)) {
    if (from.length >= 8 && s.includes(from)) {
      return s.split(from).join(to);
    }
  }
  return s;
}

function lookup(lang, path) {
  if (!packs) return undefined;
  const dict = packs[lang];
  if (!dict) return undefined;
  return String(path)
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), dict);
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyDom(root) {
  if (typeof document === "undefined") return;
  const host = root || document;
  host.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  host.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  host.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  host.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  host.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    el.setAttribute("alt", t(el.getAttribute("data-i18n-alt")));
  });
  host.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  document.documentElement.lang = locale;
  syncLangButtons();
}

function syncLangButtons() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === locale);
  });
}

export async function setLocale(next, { persist = true, silent = false } = {}) {
  const lang = next === "en" ? "en" : "tr";
  if (lang === locale && !silent) {
    applyDom();
    return;
  }
  locale = lang;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }
  applyDom();
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(t("app.windowTitle"));
  } catch {
    if (typeof document !== "undefined") document.title = t("app.windowTitle");
  }
  if (!silent) {
    listeners.forEach((fn) => {
      try {
        fn(locale);
      } catch (e) {
        console.warn("locale listener", e);
      }
    });
  }
}

export async function initI18n() {
  if (!packs) {
    const mod = await import("./locales.js");
    packs = { tr: mod.tr, en: mod.en };
  }
  let saved = null;
    try {
      saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    saved = null;
  }
  locale = saved === "en" ? "en" : "tr";
  applyDom();
  bindLangSwitch();
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(t("app.windowTitle"));
  } catch {
    if (typeof document !== "undefined") document.title = t("app.windowTitle");
  }
  return locale;
}

function bindLangSwitch() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang === "en" ? "en" : "tr";
      setLocale(lang);
    });
  });
}

export function formatWhen(createdAt) {
  if (!createdAt) return "—";
  const pipe = String(createdAt).split("|");
  const tag = locale === "en" ? "en-GB" : "tr-TR";
  if (pipe.length >= 2) {
    const secs = Number(pipe[0]);
    if (Number.isFinite(secs) && secs > 0) {
      try {
        return new Date(secs * 1000).toLocaleString(tag, {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        /* fallthrough */
      }
    }
    return pipe[1];
  }
  return String(createdAt).slice(0, 19);
}
