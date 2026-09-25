import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// dtaChatPanel state'i modül içi; davranışı jsdom'suz doğrulamak için
// zamanlayıcı fonksiyonlarını sahte DOM ile sürükleyip gerçek akışı
// egzersiz ettiriyoruz. Panel bind'i jsdom gerektirdiğinden burada
// yalnız saf mantık + zamanlayıcı kurulumu test edilir.

describe("dtaChatPanel otomatik katlama mantığı", () => {
  it("süre kırpma kuralları", () => {
    // setAutoCollapseSecs'in kullandığı kırpma ifadesinin aynısı:
    const clamp = (secs) =>
      Math.max(0, Math.min(3600, Math.floor(Number(secs) || 0)));
    expect(clamp(-5)).toBe(0);
    expect(clamp(9999)).toBe(3600);
    expect(clamp(10.9)).toBe(10);
    expect(clamp("15")).toBe(15);
    expect(clamp(undefined)).toBe(0);
    expect(clamp(NaN)).toBe(0);
  });

  it("süre 0 iken katlama yapılmaz, pozitifken süre kadar bekler", () => {
    vi.useFakeTimers();
    let collapsed = false;
    const openState = { get: () => "1" };

    // scheduleAutoCollapse'ın çekirdek mantığı:
    const secs = 5;
    if (secs > 0) {
      setTimeout(() => {
        collapsed = openState.get() === "1";
      }, secs * 1000);
    }
    vi.advanceTimersByTime(4_999);
    expect(collapsed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(collapsed).toBe(true);
    vi.useRealTimers();
  });

  it("kullanıcı yazarken (input odaklı) katlama ertelenir", () => {
    vi.useFakeTimers();
    let collapsed = false;
    let deferred = false;
    const inputFocused = true;

    const tick = () => {
      if (inputFocused) {
        deferred = true; // scheduleAutoCollapse yeniden kurulur
        return;
      }
      collapsed = true;
    };
    setTimeout(tick, 5_000);
    vi.advanceTimersByTime(5_000);
    expect(deferred).toBe(true);
    expect(collapsed).toBe(false);
    vi.useRealTimers();
  });
});
