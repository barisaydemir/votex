import { describe, it, expect } from "vitest";
import { decideTier, TIERS } from "./adaptiveQuality.js";

describe("adaptiveQuality.decideTier", () => {
  it("düşük FPS kademeyi düşürür", () => {
    expect(decideTier(30, 0)).toBe(1);
    expect(decideTier(20, 2)).toBe(3);
  });

  it("en dipte daha fazla düşmez", () => {
    const last = TIERS.length - 1;
    expect(decideTier(10, last)).toBe(last);
  });

  it("yüksek ve kararlı FPS kademeyi yükseltir", () => {
    expect(decideTier(60, 2)).toBe(1);
    expect(decideTier(58, 1)).toBe(0);
  });

  it("en üstte daha fazla yükseltmez", () => {
    expect(decideTier(60, 0)).toBe(0);
  });

  it("soğuma bekleme süresi içinde kademe değiştirmez", () => {
    expect(decideTier(20, 0, { downOk: false })).toBe(0);
    expect(decideTier(60, 3, { upOk: false })).toBe(3);
  });

  it("eşik sınırlarında karar değişmez (histerezis)", () => {
    // FPS_DOWN ile FPS_UP arası ölü bölge: ne düşür ne yükselt
    expect(decideTier(38, 1)).toBe(1);
    expect(decideTier(57, 1)).toBe(1);
    expect(decideTier(45, 1)).toBe(1);
  });

  it("geçersiz ölçüm kademeyi korur", () => {
    expect(decideTier(NaN, 2)).toBe(2);
    expect(decideTier(undefined, 1)).toBe(1);
  });
});
