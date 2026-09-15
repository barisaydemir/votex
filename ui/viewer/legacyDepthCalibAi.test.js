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
  buildDepthCalibSummary,
  proposeDepthParamsLocal,
  suggestDepthParamsWithAi,
} from "./legacyDepthCalibAi.js";

const result = {
  metals: [
    {
      kind: "metal",
      cx: 1.2,
      cy: 2.1,
      depthTopM: 2.6,
      depthBottomM: 3.0,
      depthMethod: "bipolar",
      peakSigma: 4.2,
    },
  ],
};

const params = {
  sensorHeightM: 0.5,
  bipolarSepFactor: 1.85,
  dipoleBlend: 0.3,
};

afterEach(() => {
  state.legacyDikResult = null;
  state.legacyDikFileName = null;
  vi.clearAllMocks();
});

describe("legacyDepthCalibAi", () => {
  it("özet etiket–VOTEX farkını üretir", () => {
    state.legacyDikResult = result;
    const summary = buildDepthCalibSummary(3.4, params, result);
    expect(summary).toBeTruthy();
    expect(summary.votexMidM).toBeCloseTo(2.8, 5);
    expect(summary.labelDepthM).toBe(3.4);
    expect(summary.deltaM).toBeCloseTo(0.6, 5);
    expect(summary.disclaimer).toMatch(/proxy/i);
  });

  it("küçük kaymada cihaz–yüzey ofsetini önerir", () => {
    const summary = buildDepthCalibSummary(3.1, params, result);
    const out = proposeDepthParamsLocal(summary);
    expect(out.ok).toBe(true);
    expect(out.suggested.sensorHeightM).toBe(0.5);
    expect(out.suggested.bipolarSepFactor).toBe(1.85);
  });

  it("büyük farkta bipolar çarpanı ölçekler", () => {
    const summary = buildDepthCalibSummary(4.5, params, result);
    const out = proposeDepthParamsLocal(summary);
    expect(out.ok).toBe(true);
    expect(out.suggested.bipolarSepFactor).toBeGreaterThan(1.85);
    expect(out.text).toMatch(/bipolar/i);
  });

  it("AI yoksa local kaynağa düşer", async () => {
    state.legacyDikResult = result;
    aiClient.connect.mockResolvedValueOnce(null);
    const out = await suggestDepthParamsWithAi(3.4, params);
    expect(out.source).toBe("local");
    expect(out.suggested).toBeTruthy();
    expect(out.text).toMatch(/Yerel kalibrasyon/);
  });

  it("AI JSON yanıtını clamp eder", async () => {
    state.legacyDikResult = result;
    aiClient.connect.mockResolvedValueOnce({ ollama_connected: true });
    aiClient.chat.mockResolvedValueOnce({
      text: '{"sensorHeightM":0.55,"bipolarSepFactor":2.1,"dipoleBlend":0.22,"rationaleTr":["Etikete yaklaş"]}',
      model_used: "gemma2:2b",
    });
    const out = await suggestDepthParamsWithAi(3.4, params);
    expect(out.source).toBe("ai");
    expect(out.suggested.sensorHeightM).toBe(0.5);
    expect(out.suggested.bipolarSepFactor).toBe(2.1);
    expect(out.suggested.dipoleBlend).toBe(0.22);
    expect(out.text).toMatch(/AI kalibrasyon/);
  });
});
