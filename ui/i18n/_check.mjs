import { tr, en } from "./locales.js";
import { initI18n, t, setLocale, getLocale, tPhrase } from "./index.js";

function collectKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) keys.push(...collectKeys(v, path));
    else keys.push(path);
  }
  return keys;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const trKeys = collectKeys(tr).filter((k) => !k.startsWith("phrase"));
const enKeys = new Set(collectKeys(en).filter((k) => !k.startsWith("phrase")));
const missing = trKeys.filter((k) => !enKeys.has(k));
assert(missing.length === 0, `EN missing keys: ${missing.slice(0, 20).join(", ")}`);

await initI18n();
await setLocale("tr", { persist: false, silent: true });
assert(t("ops.analyze") === "Analizi Başlat", `tr ops.analyze = ${t("ops.analyze")}`);
assert(t("metal.inside").includes("Yapı"), t("metal.inside"));
await setLocale("en", { persist: false, silent: true });
assert(getLocale() === "en", "locale not en");
assert(t("ops.analyze") === "Start Analysis", `en ops.analyze = ${t("ops.analyze")}`);
assert(t("metal.inside") === "In-structure magnetic anomaly", t("metal.inside"));
assert(t("msg.fileReady").includes("Start Analysis"), t("msg.fileReady"));
assert(
  tPhrase("Güçlü metal merkezi — altın / gümüş / demir varsayımı").includes("gold"),
  tPhrase("Güçlü metal merkezi — altın / gümüş / demir varsayımı")
);
console.log("i18n ok", { tr: trKeys.length, en: enKeys.size, locale: getLocale() });
