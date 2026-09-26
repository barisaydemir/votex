import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearAllSessions,
  exportSessionJson,
  importSessionJson,
} from "../sessionManager.js";

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
vi.stubGlobal("localStorage", localStorageMock);

// Mock state
vi.mock("../../app/state.js", () => ({
  state: {
    surfaceState: null,
    csvData: null,
    csvContent: null,
    csvFileName: null,
    csvAlignment: null,
    clipEnabled: false,
    clipHeightM: 3,
    xray: false,
    colorPalette: "none",
    detectionNotes: {},
    pendingFile: null,
  },
  $: (id) => null,
}));

describe("sessionManager", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
  });

  it("saveSession kaydeder ve listSessions'a düşer", () => {
    const snap = saveSession("Test Oturum");
    expect(snap.name).toBe("Test Oturum");
    expect(snap.id).toBeTruthy();
    expect(snap.timestamp).toBeTruthy();

    const list = listSessions();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Test Oturum");
  });

  it("loadSession doğru oturumu yükler", () => {
    saveSession("Yuklenecek");
    const list = listSessions();
    const result = loadSession(list[0].id);
    expect(result).toBe(true);
  });

  it("loadSession olmayan ID ile false döner", () => {
    expect(loadSession("nonexistent")).toBe(false);
  });

  it("deleteSession oturumu siler", () => {
    saveSession("Silinecek");
    const list = listSessions();
    deleteSession(list[0].id);
    expect(listSessions().length).toBe(0);
  });

  it("clearAllSessions tümünü temizler", () => {
    saveSession("A");
    saveSession("B");
    clearAllSessions();
    expect(listSessions().length).toBe(0);
  });

  it("exportSessionJson geçerli JSON döner", () => {
    const json = exportSessionJson();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("0.3.13");
    expect(parsed.timestamp).toBeTruthy();
  });

  it("importSessionJson geçerli JSON ile yükler", () => {
    const json = JSON.stringify({
      version: "0.3.13",
      timestamp: new Date().toISOString(),
      name: "İçe Aktarılan",
    });
    const result = importSessionJson(json);
    expect(result).toBe(true);
  });

  it("importSessionJson geçersiz JSON ile false döner", () => {
    expect(importSessionJson("not json")).toBe(false);
    expect(importSessionJson("{}")).toBe(false);
  });

  it("maksimum 20 oturum tutar", () => {
    for (let i = 0; i < 25; i++) {
      saveSession(`Oturum ${i}`);
    }
    expect(listSessions().length).toBe(20);
  });
});
