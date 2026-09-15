import { describe, expect, it } from "vitest";
import { normalizeLegacyResult, linkInvertProxiesToDetections } from "./legacyNormalize.js";

describe("invertProxies normalize", () => {
  it("camelCase ve snake_case invert proxy alanlarını birleştirir", () => {
    const normalized = normalizeLegacyResult({
      ok: true,
      meta: { xMeters: 3, yMeters: 4 },
      invert_proxies: [
        {
          method: "compact-dipole",
          disclaimer: "CAD değil",
          cx: 1.2,
          cy: 2.1,
          depth_m: 2.9,
          depth_magnetic_m: 2.5,
          rx_m: 0.6,
          ry_m: 0.5,
          misfit_rms: 0.22,
          fit_samples: 40,
          polygon: [[0.2, 0.3], [0.4, 0.3], [0.4, 0.5], [0.2, 0.5]],
          sensor_height_m: 0.5,
          detection_id: "legacy-dik-shape-1",
        },
      ],
    });
    expect(normalized.invertProxies).toHaveLength(1);
    const p = normalized.invertProxies[0];
    expect(p.method).toBe("compact-dipole");
    expect(p.depthM).toBeCloseTo(2.9, 5);
    expect(p.depthMagneticM).toBeCloseTo(2.5, 5);
    expect(p.misfitRms).toBeCloseTo(0.22, 5);
    expect(p.polygon).toHaveLength(4);
    expect(p.disclaimer).toMatch(/CAD/);
    expect(p.detectionId).toBe("legacy-dik-shape-1");
  });

  it("proxy yoksa boş dizi döner", () => {
    const normalized = normalizeLegacyResult({ ok: true, meta: {} });
    expect(normalized.invertProxies).toEqual([]);
  });

  it("cx/cy ile detectionId bağlar", () => {
    const linked = linkInvertProxiesToDetections(
      [{ cx: 1.0, cy: 2.0, depthM: 2, detectionId: null }],
      [
        { detectionId: "legacy-dik-shape-2", raw: { cx: 5, cy: 5 } },
        { detectionId: "legacy-dik-shape-1", raw: { cx: 1.05, cy: 1.95 } },
      ],
    );
    expect(linked[0].detectionId).toBe("legacy-dik-shape-1");
  });

  it("uzak proxy’ye detectionId zorla bağlanmaz", () => {
    const linked = linkInvertProxiesToDetections(
      [{ cx: 0, cy: 0, depthM: 2, detectionId: null }],
      [{ detectionId: "legacy-dik-shape-1", raw: { cx: 8, cy: 8 } }],
      1.5,
    );
    expect(linked[0].detectionId).toBeNull();
  });
});
