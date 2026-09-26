import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../ai/aiClient.js", () => ({
  aiClient: {
    preferredModel: "test-model",
    connect: vi.fn(async () => null),
    chat: vi.fn(async () => ({ text: "" })),
  },
}));

import { state } from "../app/state.js";
import { aiClient } from "../ai/aiClient.js";
import {
  buildGeothermalProxySummary,
  formatLocalGeothermalInterpretation,
  interpretGeothermalWithAi,
} from "./legacyGeothermalAi.js";

const result = {
  gridW: 3,
  gridH: 2,
  gridValues: [-3, -1, 0, 2, 4, 6],
  gridCoverage: [1, 1, 1, 2, 2, 2],
  gridWidthM: 6,
  gridDepthM: 4,
  anomalies: [{ cx: 1.5, cy: 1, kind: "anomaly", peakSigma: 3, depthTopM: 1, depthBottomM: 3 }],
  metals: [],
};

afterEach(() => {
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacyDikFileName = null;
  vi.clearAllMocks();
});

describe("legacyGeothermalAi", () => {
  it("proxy özetinde sıcak noktalar ve disclaimer üretir", () => {
    const summary = buildGeothermalProxySummary(result, { topN: 3, maxDepthM: 10 });
    expect(summary).toBeTruthy();
    expect(summary.isThermalProxy).toBe(true);
    expect(summary.disclaimer).toMatch(/°C/);
    expect(summary.measuredCells).toBe(6);
    expect(summary.maxAbs).toBe(6);
    expect(summary.hotSpots).toHaveLength(3);
    expect(summary.hotSpots[0].residual).toBe(6);
    expect(summary.hotSpots[0].heatProxy01).toBe(1);
    expect(summary.detectionsNearby.length).toBeGreaterThan(0);
  });

  it("yerel yorum metni °C uyarısı ve odakları içerir", () => {
    const summary = buildGeothermalProxySummary(result);
    const text = formatLocalGeothermalInterpretation(summary);
    expect(text).toMatch(/Yerel özet/);
    expect(text).toMatch(/gerçek sıcaklık/i);
    expect(text).toMatch(/Sıcak proxy odakları/);
    expect(text).toMatch(/Öneri:/);
  });

  it("AI yoksa local kaynağa düşer", async () => {
    aiClient.connect.mockResolvedValueOnce(null);
    const out = await interpretGeothermalWithAi(result);
    expect(out.source).toBe("local");
    expect(out.summary.maxAbs).toBe(6);
    expect(out.text).toMatch(/Yerel özet/);
  });

  it("AI yanıtı gelince source=ai olur", async () => {
    aiClient.connect.mockResolvedValueOnce({ ollama_connected: true });
    aiClient.chat.mockResolvedValueOnce({ text: "Sıcak odaklar sığ banda yakın.", model_used: "gemma2:2b" });
    const out = await interpretGeothermalWithAi(result);
    expect(out.source).toBe("ai");
    expect(out.text).toMatch(/AI yorumu/);
    expect(out.text).toMatch(/Sıcak odaklar/);
    expect(out.model).toBe("gemma2:2b");
  });

  it("forceLocal AI çağırmadan yerel metin döner", async () => {
    const out = await interpretGeothermalWithAi(result, { forceLocal: true });
    expect(out.source).toBe("local");
    expect(aiClient.connect).not.toHaveBeenCalled();
  });
});
