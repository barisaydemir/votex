import { describe, it, expect } from "vitest";
import {
  appendDtaChatTurns,
  createEmptyFieldSession,
  normalizeDtaChat,
  normalizeDtaChatTurn,
  normalizeFieldSession,
} from "../legacyFieldSession.js";

describe("dtaChat oturum kalıcılığı", () => {
  it("normalizeDtaChatTurn bozuk turu atar, geçerliyi temizler", () => {
    expect(normalizeDtaChatTurn(null)).toBe(null);
    expect(normalizeDtaChatTurn({ role: "bilinmeyen", text: "x" })).toBe(null);
    expect(normalizeDtaChatTurn({ role: "user", text: "   " })).toBe(null);
    const ok = normalizeDtaChatTurn({ role: "USER", text: "  3D'deki 2. hedefi açıkla  ", ts: 1727200000000.7 });
    expect(ok.role).toBe("user");
    expect(ok.text).toBe("3D'deki 2. hedefi açıkla");
    expect(ok.ts).toBe(1727200000000);
    // ts yoksa 0 — render katmanı saat bilgisini atlar
    expect(normalizeDtaChatTurn({ role: "assistant", text: "Merhaba" }).ts).toBe(0);
  });

  it("normalizeDtaChat diziyi kırpıp temizler", () => {
    const turns = [
      { role: "user", text: "selam" },
      null,
      { role: "assistant", text: "merhaba" },
      { role: "user", text: "" },
      "bozuk",
    ];
    expect(normalizeDtaChat(turns).length).toBe(2);
    expect(normalizeDtaChat("degil")).toEqual([]);
    expect(normalizeDtaChat(undefined)).toEqual([]);
    // max sınırı
    const many = Array.from({ length: 150 }, (_, i) => ({ role: "user", text: `t${i}` }));
    expect(normalizeDtaChat(many).length).toBe(100);
  });

  it("appendDtaChatTurns ekler ve updatedAt'i tazeler", () => {
    let session = createEmptyFieldSession("fp-1");
    const before = session.updatedAt;
    session = appendDtaChatTurns(session, [
      { role: "user", text: "3D'deki 1. hedefi açıkla" },
      { role: "assistant", text: "Önce incele işaretli hedef..." },
    ]);
    expect(session.dtaChat.length).toBe(2);
    expect(session.dtaChat[0].text).toBe("3D'deki 1. hedefi açıkla");
    expect(session.updatedAt).not.toBe(before);
  });

  it("appendDtaChatTurns aynı turu tekrar eklemez (Rust halkası + restore çift kaydı önleme)", () => {
    let session = createEmptyFieldSession("fp-2");
    const turns = [
      { role: "user", text: "3D'deki 2. hedefi açıkla" },
      { role: "assistant", text: "Aday 2..." },
    ];
    session = appendDtaChatTurns(session, turns);
    const countAfterFirst = session.dtaChat.length;
    // Aynı turlar tekrar geldi (restore + canlı halka birleşimi)
    session = appendDtaChatTurns(session, turns);
    expect(session.dtaChat.length).toBe(countAfterFirst);
    // Yeni tur yine eklenir
    session = appendDtaChatTurns(session, [{ role: "user", text: "Özet ver" }]);
    expect(session.dtaChat.length).toBe(countAfterFirst + 1);
  });

  it("appendDtaChatTurns 100 turu aşınca en eskisini atar", () => {
    let session = createEmptyFieldSession("fp-3");
    for (let i = 0; i < 120; i++) {
      session = appendDtaChatTurns(session, [{ role: "user", text: `soru ${i}` }]);
    }
    expect(session.dtaChat.length).toBe(100);
    expect(session.dtaChat[0].text).toBe("soru 20");
    expect(session.dtaChat[99].text).toBe("soru 119");
  });

  it("normalizeFieldSession kayıtlı dtaChat'ı geri yükler", () => {
    const restored = normalizeFieldSession({
      key: "fp-4",
      schemaVersion: 3,
      dtaChat: [
        { role: "user", text: "selam", ts: 1 },
        { role: "assistant", text: "merhaba", ts: 2 },
        { role: "bilinmeyen", text: "çöp" },
      ],
    });
    expect(restored.dtaChat.length).toBe(2);
    expect(restored.dtaChat[1].role).toBe("assistant");
    // Eski kayıtlarda dtaChat yoksa boş dizi — geriye uyumlu
    const legacy = normalizeFieldSession({ key: "fp-5" });
    expect(legacy.dtaChat).toEqual([]);
  });

  it("appendDtaChatTurns null oturumu olduğu gibi döner", () => {
    expect(appendDtaChatTurns(null, [{ role: "user", text: "x" }])).toBe(null);
  });
});
