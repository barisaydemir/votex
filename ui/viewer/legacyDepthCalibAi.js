/**
 * Legacy derinlik Parametre kalibrasyonu — AI / yerel öneri.
 * Otomatik kaydetmez; operatör alanlara yazar ve Uygula ile onaylar.
 */
import { aiClient } from "../ai/aiClient.js";
import { state } from "../app/state.js";
import { normalizeLegacyResult } from "./legacyNormalize.js";

const DEFAULTS = Object.freeze({
  sensorHeightM: 0.1,
  bipolarSepFactor: 1.85,
  dipoleBlend: 0.3,
});

function numberOf(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}

/** Tekrarlı 1 m kazık okumalarını tek referans istatistiğine dönüştürür. */
export function summarizeFieldStakeReadings(readings, measuredAfterM = null) {
  const values = (Array.isArray(readings) ? readings : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageM = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const afterM = Number.isFinite(Number(measuredAfterM)) ? Number(measuredAfterM) : null;
  return {
    count: values.length,
    averageM,
    beforeErrorM: averageM == null ? null : Math.abs(1 - averageM),
    afterM,
    afterErrorM: afterM == null ? null : Math.abs(1 - afterM),
  };
}

function pickMetal(result) {
  const normalized = normalizeLegacyResult(result || state.legacyDikResult);
  const metals = Array.isArray(normalized.metals) ? normalized.metals : [];
  if (!metals.length) return null;
  const metal = metals[0];
  const top = numberOf(metal.depthTopM, 0);
  const bot = numberOf(metal.depthBottomM, top);
  const mid = 0.5 * (top + bot);
  return {
    midM: mid,
    topM: top,
    bottomM: bot,
    method: String(metal.depthMethod || ""),
    peakSigma: numberOf(metal.peakSigma ?? metal.strength, 0),
    cx: numberOf(metal.cx, 0),
    cy: numberOf(metal.cy, 0),
    label: String(metal.label || ""),
  };
}

/**
 * @param {number} labelDepthM Saha etiketi (m)
 * @param {{ sensorHeightM: number, bipolarSepFactor: number, dipoleBlend: number }} params
 * @param {object} [result]
 */
export function buildDepthCalibSummary(labelDepthM, params, result = state.legacyDikResult) {
  const labelM = numberOf(labelDepthM, NaN);
  if (!(labelM > 0) || labelM > 20) return null;
  const metal = pickMetal(result);
  if (!metal || !(metal.midM > 0)) return null;

  const current = {
    sensorHeightM: clamp(numberOf(params?.sensorHeightM, DEFAULTS.sensorHeightM), 0, 0.2),
    bipolarSepFactor: clamp(numberOf(params?.bipolarSepFactor, DEFAULTS.bipolarSepFactor), 0.5, 4),
    dipoleBlend: clamp(numberOf(params?.dipoleBlend, DEFAULTS.dipoleBlend), 0, 1),
  };

  const deltaM = labelM - metal.midM;
  const ratio = labelM / Math.max(metal.midM, 0.2);

  return {
    calibrationMode: String(params?.calibrationMode || "single-object"),
    disclaimer:
      "Derinlik proxy kalibrasyonu — invert değil. Öneri operatör onayı ister; JSON dosyasını değiştirmez.",
    fileName: state.legacyDikFileName || null,
    labelDepthM: round(labelM, 2),
    votexMidM: round(metal.midM, 2),
    votexTopM: round(metal.topM, 2),
    votexBottomM: round(metal.bottomM, 2),
    deltaM: round(deltaM, 2),
    ratio: round(ratio, 3),
    depthMethod: metal.method || "unknown",
    peakSigma: round(metal.peakSigma, 2),
    metalAt: { x: round(metal.cx, 2), y: round(metal.cy, 2) },
    currentParams: current,
    clamps: {
      sensorHeightM: [0, 0.2],
      bipolarSepFactor: [0.5, 4],
      dipoleBlend: [0, 1],
    },
  };
}

/**
 * Deterministik yerel öneri (AI yokken de çalışır).
 * Küçük sabit kayma → cihaz–yüzey; oran sapması → bipolar; ince ayar → dipol karışım.
 */
export function proposeDepthParamsLocal(summary) {
  if (!summary) {
    return {
      ok: false,
      text: "Öneri için önce JSON yükleyin ve saha etiketi (m) girin (metal tespiti gerekli).",
      suggested: null,
      reasons: [],
    };
  }

  const cur = { ...summary.currentParams };
  let h = clamp(summary.currentParams.sensorHeightM, 0, 0.2);
  let factor = cur.bipolarSepFactor;
  let blend = cur.dipoleBlend;
  const reasons = [];
  const absDelta = Math.abs(summary.deltaM);

  if (absDelta < 0.12) {
    reasons.push("VOTEX orta derinlik etiketle uyumlu (±0,12 m); mevcut parametreleri koruyun.");
    return {
      ok: true,
      text: formatSuggestionText(summary, cur, reasons, "local"),
      suggested: cur,
      reasons,
      source: "local",
    };
  }

  // 1) Küçük–orta kayma: önce ofset (cihaz–yüzey)
  if (absDelta <= 0.65) {
    const hNext = clamp(h + summary.deltaM, 0, 0.2);
    if (Math.abs(hNext - h) >= 0.02) {
      reasons.push(
        `Sabit kayma ~${summary.deltaM > 0 ? "+" : ""}${summary.deltaM} m → cihaz–yüzey ${h.toFixed(2)} → ${hNext.toFixed(2)} m`,
      );
      h = hNext;
    }
  } else {
    // 2) Büyük fark: manyetik proxy ölçeği (bipolar çarpan)
    const magneticNow = Math.max(summary.votexMidM - h, 0.25);
    const magneticWant = Math.max(summary.labelDepthM - h, 0.25);
    const scale = clamp(magneticWant / magneticNow, 0.55, 1.85);
    const factorNext = clamp(round(factor * scale, 2), 0.5, 4);
    if (Math.abs(factorNext - factor) >= 0.03) {
      reasons.push(
        `Oran sapması (etiket/VOTEX=${summary.ratio}) → bipolar ${factor.toFixed(2)} → ${factorNext.toFixed(2)}`,
      );
      factor = factorNext;
    }
    // Kalan farkın bir kısmını ofsete ver
    const residual = clamp(summary.deltaM * 0.25, -0.1, 0.1);
    const hNext = clamp(round(h + residual, 2), 0, 0.2);
    if (Math.abs(hNext - h) >= 0.03) {
      reasons.push(`Kalan ofset → cihaz–yüzey ${h.toFixed(2)} → ${hNext.toFixed(2)} m`);
      h = hNext;
    }
  }

  // 3) İnce ayar: etiket daha derin ve bipolar baskınsa dipol payını biraz azalt
  if (summary.deltaM > 0.35 && blend > 0.12) {
    const blendNext = clamp(round(blend - 0.08, 2), 0, 1);
    if (blendNext !== blend) {
      reasons.push(
        `Etiket daha derin → dipol karışım %${Math.round(blend * 100)} → %${Math.round(blendNext * 100)} (bipolar payı artar)`,
      );
      blend = blendNext;
    }
  } else if (summary.deltaM < -0.35 && blend < 0.55) {
    const blendNext = clamp(round(blend + 0.08, 2), 0, 1);
    if (blendNext !== blend) {
      reasons.push(
        `Etiket daha sığ → dipol karışım %${Math.round(blend * 100)} → %${Math.round(blendNext * 100)}`,
      );
      blend = blendNext;
    }
  }

  // Cihaz–yüzey mesafesi saha kuralıdır; öneri 0,20 m üstüne çıkamaz.
  h = clamp(h, 0, 0.2);
  const suggested = {
    sensorHeightM: round(h, 2),
    bipolarSepFactor: round(factor, 2),
    dipoleBlend: round(blend, 2),
  };
  reasons.push("Öneri alanlara yazıldıktan sonra Parametre → Uygula ile kaydedin ve yeniden analiz edin.");
  reasons.push("Mümkünse aynı noktayı 3 çekimle doğrulayın; tek etiketle aşırı uydurmayın.");

  return {
    ok: true,
    text: formatSuggestionText(summary, suggested, reasons, "local"),
    suggested,
    reasons,
    source: "local",
  };
}

function formatSuggestionText(summary, suggested, reasons, source) {
  const lines = [
    source === "ai"
      ? "AI kalibrasyon önerisi (proxy — invert değil)"
      : "Yerel kalibrasyon önerisi (AI yok veya yanıt yok)",
    summary.disclaimer,
    summary.calibrationMode === "field-stake"
      ? "Kalibrasyon türü: 1,00 m metal uçlu referans kazığı — cihaz derinlik ölçeği mihenk noktası."
      : "Kalibrasyon türü: bilinen derinlikte tek obje.",
    "",
    `Etiket: ${summary.labelDepthM} m · VOTEX orta: ${summary.votexMidM} m · fark: ${summary.deltaM > 0 ? "+" : ""}${summary.deltaM} m · yöntem: ${summary.depthMethod || "—"}`,
    "",
    "Önerilen Parametre:",
    `  Cihaz–yüzey: ${suggested.sensorHeightM} m`,
    `  Bipolar çarpan: ${suggested.bipolarSepFactor}`,
    `  Dipol karışım: %${Math.round(suggested.dipoleBlend * 100)}`,
    "",
    "Gerekçe:",
    ...reasons.map((r) => `  • ${r}`),
  ];
  return lines.join("\n");
}

function extractJsonObject(text) {
  const raw = String(text || "");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampSuggested(obj, fallback) {
  const base = fallback || DEFAULTS;
  return {
    sensorHeightM: clamp(
      numberOf(obj?.sensorHeightM ?? obj?.sensor_height_m, base.sensorHeightM),
      0,
      0.2,
    ),
    bipolarSepFactor: clamp(
      numberOf(obj?.bipolarSepFactor ?? obj?.bipolar_sep_factor, base.bipolarSepFactor),
      0.5,
      4,
    ),
    dipoleBlend: clamp(
      numberOf(obj?.dipoleBlend ?? obj?.dipole_blend, base.dipoleBlend),
      0,
      1,
    ),
  };
}

function buildPrompt(summary, localSuggested) {
  const fieldReference = summary.calibrationMode === "field-stake";
  return [
    "Sen VOTEX saha asistanısın. Aşağıdaki JSON, Legacy manyetik DERİNLİK PROXY kalibrasyon özetidir (invert değil).",
    fieldReference
      ? "Kalibrasyon türü: 1,00 m derinliğe çakılmış metal uçlu referans kazık; amaç cihazın 1 m derinlik ölçeğini ankrajlamaktır."
      : "Kalibrasyon türü: bilinen derinlikte tek obje; amaç seçili objeye göre derinlik proxy'sini düzeltmektir.",
    "Görev: Saha referansına yaklaşmak için Parametre öner.",
    "Kurallar:",
    "- sensorHeightM yalnızca 0..0.20 m olabilir; normal başlangıç değeri 0.10 m'dir.",
    "- bipolarSepFactor (0.5..4) ve dipoleBlend (0..1) öner.",
    "- Küçük sabit kaymada önce sensorHeightM; büyük oranda bipolarSepFactor; ince ayarda dipoleBlend.",
    "- Aşırı uydurma yapma; tek çekim belirsizliğini not et.",
    fieldReference
      ? "- Referans kazığı normal obje/metal listesine eklenmez; yalnızca derinlik ölçeği mihenk noktasıdır."
      : "- Seçili objeyi yeni bir obje türü olarak uydurma.",
    "- Yanıtın SADECE şu JSON olsun (başka metin yok):",
    '{"sensorHeightM":0.1,"bipolarSepFactor":1.85,"dipoleBlend":0.3,"rationaleTr":["madde1","madde2"]}',
    "",
    "Yerel ön-öneri (istersen iyileştir):",
    JSON.stringify(localSuggested, null, 2),
    "",
    "Özet:",
    JSON.stringify(summary, null, 2),
  ].join("\n");
}

/**
 * @param {number} labelDepthM
 * @param {{ sensorHeightM: number, bipolarSepFactor: number, dipoleBlend: number }} params
 * @param {{ forceLocal?: boolean, baselineParams?: object, calibrationMode?: string }} [options]
 */
export async function suggestDepthParamsWithAi(labelDepthM, params, options = {}) {
  // UI yeni öneriyi alana yazsa bile aynı hedef/ölçüm için ilk parametrelerden
  // yeniden hesaplar; böylece öneri üstüne öneri çarpanları katlamaz.
  const sourceParams = options.baselineParams || params;
  const summary = buildDepthCalibSummary(labelDepthM, {
    ...sourceParams,
    calibrationMode: options.calibrationMode || sourceParams?.calibrationMode || "single-object",
  });
  const local = proposeDepthParamsLocal(summary);
  if (!local.ok || !summary) {
    return { ...local, summary: null };
  }

  if (options.forceLocal) {
    return { ...local, summary };
  }

  const started = Date.now();
  try {
    const status = await aiClient.connect();
    if (!status) {
      return { ...local, summary };
    }
    const response = await aiClient.chat(
      buildPrompt(summary, local.suggested),
      "legacy-depth-calib",
    );
    const rawText = String(response?.text || response?.message || "").trim();
    const parsed = extractJsonObject(rawText);
    if (!parsed) {
      return { ...local, summary, latencyMs: Date.now() - started };
    }
    const suggested = clampSuggested(parsed, local.suggested);
    const rationale = Array.isArray(parsed.rationaleTr)
      ? parsed.rationaleTr.map(String).filter(Boolean)
      : Array.isArray(parsed.rationale)
        ? parsed.rationale.map(String).filter(Boolean)
        : local.reasons;
    const reasons = [
      ...rationale.slice(0, 6),
      "Öneri alanlara yazıldıktan sonra Parametre → Uygula ile kaydedin.",
    ];
    return {
      ok: true,
      text: formatSuggestionText(summary, suggested, reasons, "ai"),
      suggested,
      reasons,
      source: "ai",
      summary,
      latencyMs: Date.now() - started,
      model: response?.model_used || aiClient.preferredModel || null,
    };
  } catch {
    return { ...local, summary };
  }
}
