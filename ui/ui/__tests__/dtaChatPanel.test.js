import { describe, it, expect } from "vitest";
import {
  planChatTurns,
  planTargetShortcuts,
  planHiddenBadge,
  __internals,
} from "../dtaChatPanel.js";

describe("planHiddenBadge — 'D gizli' rozet planı", () => {
  it("rozet yalnız DTA penceresi gizli VE panel açıkken görünür", () => {
    expect(planHiddenBadge({ windowHidden: true, panelOpen: true })).toEqual({ visible: true });
    expect(planHiddenBadge({ windowHidden: true, panelOpen: false }).visible).toBe(false);
    expect(planHiddenBadge({ windowHidden: false, panelOpen: true }).visible).toBe(false);
    expect(planHiddenBadge({ windowHidden: false, panelOpen: false }).visible).toBe(false);
  });

  it("eksik/bozuk girdide güvenli varsayılan (gizli)", () => {
    expect(planHiddenBadge()).toEqual({ visible: false });
    expect(planHiddenBadge(null).visible).toBe(false);
    expect(planHiddenBadge({ windowHidden: 1, panelOpen: "evet" }).visible).toBe(true);
    expect(planHiddenBadge({ windowHidden: "1", panelOpen: 0 }).visible).toBe(false);
  });
});

describe("panel otomatik açılma planı", () => {
  it("asistan yanıtı olan tur paketinde otomatik açma kararı çıkar", () => {
    // pollOnce davranışının saf karşılığı: assistant varsa aç
    const withAssistant = [
      { role: "user", text: "soru" },
      { role: "assistant", text: "yanıt" },
    ];
    expect(withAssistant.some((t) => String(t.role) === "assistant")).toBe(true);
    const userOnly = [{ role: "user", text: "sadece kullanıcı" }];
    expect(userOnly.some((t) => String(t.role) === "assistant")).toBe(false);
  });
});

describe("dtaChatPanel", () => {
  it("planChatTurns rolleri ayrıştırır ve kullanıcı mesajını vurgular", () => {
    const plans = planChatTurns([
      { role: "user", text: "Selam" },
      { role: "assistant", text: "Merhaba, dinliyorum." },
      { role: "system", text: "bağlandı" },
    ]);
    expect(plans.length).toBe(3);
    expect(plans[0].cls).toBe("is-user");
    expect(plans[0].who).toBe("Siz");
    expect(plans[1].cls).toBe("is-assistant");
    expect(plans[1].who).toBe("DTA");
    expect(plans[2].cls).toBe("is-system");
    expect(plans[2].who).toBe("Sistem");
    expect(plans[0].text).toBe("Selam");
  });

  it("planChatTurns eksik/bozuk girdide varsayılan role düşer", () => {
    const plans = planChatTurns([{ text: "rol yok" }]);
    expect(plans.length).toBe(1);
    expect(plans[0].role).toBe("assistant");
    expect(plans[0].cls).toBe("is-assistant");
    expect(planChatTurns(null)).toEqual([]);
    expect(planChatTurns(undefined)).toEqual([]);
    expect(planChatTurns("degil")).toEqual([]);
  });

  it("esc ve hhmm yardımcıları güvenli çıktı üretir", () => {
    expect(__internals.esc('<b>"x"</b>')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    expect(__internals.esc("")).toBe("");
    expect(__internals.hhmm(0)).toBe("");
    expect(__internals.hhmm("abc")).toBe("");
    expect(typeof __internals.hhmm(Date.now())).toBe("string");
  });

  it("hedef kısayolları panel sırasını birebir izler ve 1. hedef 'Önce incele' olur", () => {
    // rankLegacyTargetsForReview sırası: kanıt sayısı → tutarlılık → güven
    const targets = [
      { targetId: "legacy-target-a", detectionIds: ["d1"], confidence: 0.9, consistency: { level: "loose", evidenceCount: 1 } },
      { targetId: "legacy-target-b", detectionIds: ["d2", "d3"], confidence: 0.6, consistency: { level: "tight", evidenceCount: 2 } },
    ];
    const chips = planTargetShortcuts(targets);
    expect(chips[0].targetId).toBe("legacy-target-b");
    expect(chips[0].rank).toBe(1);
    expect(chips[0].label).toBe("★ Önce incele");
    expect(chips[0].question).toBe("3D'deki 1. hedefi açıkla");
    expect(chips[1].targetId).toBe("legacy-target-a");
    expect(chips[1].label).toBe("Aday 2");
    expect(chips[1].question).toBe("3D'deki 2. hedefi açıkla");
  });

  it("hedef kısayolları özet çipini ekler ve limit dışı hedefleri kırpılır", () => {
    const targets = Array.from({ length: 6 }, (_, i) => ({
      targetId: `legacy-target-${i}`,
      detectionIds: [`d${i}`],
      confidence: 0.5,
    }));
    const chips = planTargetShortcuts(targets, 3);
    expect(chips.filter((c) => c.rank > 0).length).toBe(3);
    const summary = chips.find((c) => c.rank === 0);
    expect(summary).toBeTruthy();
    expect(summary.question).toBe("3D'deki tüm hedefleri özetle");
  });

  it("hedef yoksa kısayol listesi boştur", () => {
    expect(planTargetShortcuts([])).toEqual([]);
    expect(planTargetShortcuts(null)).toEqual([]);
    expect(planTargetShortcuts(undefined)).toEqual([]);
  });

  it("planChatTurns zaman damgası varsa meta'ya ekler", () => {
    const ts = new Date("2026-09-25T10:30:00").getTime();
    const [plan] = planChatTurns([{ role: "user", text: "x", ts }]);
    expect(plan.meta).toContain("Siz");
    expect(plan.meta).toContain("10:30");
  });
});
