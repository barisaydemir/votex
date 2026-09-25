const MAX_REFERENCES = 3;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function featureOf(detection) {
  const depthTopM = finite(detection?.depthTopM);
  const depthBottomM = finite(detection?.depthBottomM, depthTopM);
  return {
    type: String(detection?.type || "Anomali").toLocaleLowerCase("tr-TR"),
    depthMidM: (depthTopM + depthBottomM) / 2,
    depthSpanM: Math.max(0, depthBottomM - depthTopM),
    confidencePct: Math.max(0, Math.min(100, finite(detection?.confidence) * 100)),
    strengthSigma: finite(detection?.strength ?? detection?.peakSigma),
  };
}

function distanceBetween(a, b) {
  const typePenalty = a.type === b.type ? 0 : 0.8;
  const depth = Math.abs(a.depthMidM - b.depthMidM) / 1.5;
  const span = Math.abs(a.depthSpanM - b.depthSpanM) / 1.5;
  const confidence = Math.abs(a.confidencePct - b.confidencePct) / 35;
  const strength = Math.abs(a.strengthSigma - b.strengthSigma) / 3;
  return (typePenalty + depth + span + confidence + strength) / 5;
}

/** Match a current detection to explicit confirmed/rejected decisions in local archives. */
export function findSimilarReviewedCases(current, history, limit = MAX_REFERENCES) {
  if (!current) return [];
  const currentFingerprint = String(current.fingerprint || "");
  const currentFeatures = featureOf(current.detection || current);
  const bestPerCase = new Map();
  for (const item of Array.isArray(history) ? history : []) {
    const decision = String(item?.decision || "").toLowerCase();
    if (decision !== "confirmed" && decision !== "rejected") continue;
    if (currentFingerprint && item.fingerprint && String(item.fingerprint) === currentFingerprint) continue;
    const features = featureOf(item.detection);
    const distance = distanceBetween(currentFeatures, features);
    const similarityPct = Math.max(0, Math.round((1 - distance) * 100));
    if (similarityPct < 50) continue;
    const caseKey = String(item.caseKey || item.fingerprint || item.archiveId || "");
    if (!caseKey) continue;
    const previous = bestPerCase.get(caseKey);
    if (!previous || similarityPct > previous.similarityPct) {
      bestPerCase.set(caseKey, {
        decision,
        similarityPct,
        type: String(item.detection?.type || "Anomali"),
        depthTopM: finite(item.detection?.depthTopM),
        depthBottomM: finite(item.detection?.depthBottomM, finite(item.detection?.depthTopM)),
        confidencePct: Math.round(finite(item.detection?.confidence) * 100),
        strengthSigma: finite(item.detection?.strength ?? item.detection?.peakSigma),
      });
    }
  }
  return [...bestPerCase.values()]
    .sort((a, b) => b.similarityPct - a.similarityPct)
    .slice(0, Math.max(0, Math.min(MAX_REFERENCES, Math.floor(finite(limit, MAX_REFERENCES)))));
}

export function formatSimilarReviewedCases(references) {
  const items = Array.isArray(references) ? references : [];
  if (!items.length) return "";
  return [
    "\n\nBENZER, OPERATÖR KARARI KAYITLI ARŞİV ÖRNEKLERİ (yalnızca karşılaştırma bağlamı):",
    "Yakınlık yüzdesi istatistiksel benzerlik göstergesidir; başarı olasılığı veya teşhis değildir. Arşiv kararını bu vakaya doğrudan kopyalama.",
    ...items.map((item, index) => `  Örnek ${index + 1} · yakınlık %${item.similarityPct} · ${item.type} · operatör kararı: ${item.decision === "confirmed" ? "doğrulandı" : "reddedildi"} · tahmini derinlik ${item.depthTopM.toFixed(2)}–${item.depthBottomM.toFixed(2)} m · güven %${item.confidencePct} · ${item.strengthSigma.toFixed(1)}σ`),
  ].join("\n");
}
