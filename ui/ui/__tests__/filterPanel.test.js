import { describe, it, expect } from "vitest";
import { filterCsvRows, filterStructures, filterState } from "../filterPanel.js";

describe("filterPanel", () => {
  const sampleRows = [
    { x: 10, y: -5, z: 20, mag: 450 },
    { x: 20, y: -10, z: 30, mag: 520 },
    { x: 30, y: -15, z: 40, mag: 380 },
    { x: 40, y: -20, z: 50, mag: 600 },
  ];

  const sampleStats = {
    chambers: [
      { kind: "room", x: 10, y: -5 },
      { kind: "tomb", x: 20, y: -10 },
    ],
    tunnels: [{ kind: "tunnel", x: 30, y: -15 }],
    metals: [{ kind: "metal", x: 40, y: -20 }],
    shafts: [{ kind: "shaft", x: 50, y: -25 }],
  };

  it("devre dışı filtre tüm satırları döndürür", () => {
    filterState.enabled = false;
    const result = filterCsvRows(sampleRows);
    expect(result.length).toBe(4);
  });

  it("manyetik aralık filtresi çalışır", () => {
    filterState.enabled = true;
    filterState.magMin = 400;
    filterState.magMax = 550;
    filterState.depthMin = -Infinity;
    filterState.depthMax = Infinity;
    filterState.xMin = -Infinity;
    filterState.xMax = Infinity;
    filterState.zMin = -Infinity;
    filterState.zMax = Infinity;

    const result = filterCsvRows(sampleRows);
    expect(result.length).toBe(2); // 450 ve 520
    filterState.enabled = false;
  });

  it("derinlik aralık filtresi çalışır", () => {
    filterState.enabled = true;
    filterState.magMin = -Infinity;
    filterState.magMax = Infinity;
    filterState.depthMin = -15;
    filterState.depthMax = -5;
    filterState.xMin = -Infinity;
    filterState.xMax = Infinity;
    filterState.zMin = -Infinity;
    filterState.zMax = Infinity;

    const result = filterCsvRows(sampleRows);
    expect(result.length).toBe(3); // -5, -10, -15
    filterState.enabled = false;
  });

  it("yapı türü filtresi çalışır", () => {
    filterState.enabled = true;
    filterState.kinds = new Set(["room", "tunnel"]);
    filterState.magMin = -Infinity;
    filterState.magMax = Infinity;
    filterState.depthMin = -Infinity;
    filterState.depthMax = Infinity;
    filterState.xMin = -Infinity;
    filterState.xMax = Infinity;
    filterState.zMin = -Infinity;
    filterState.zMax = Infinity;

    const result = filterStructures(sampleStats);
    expect(result.chambers.length).toBe(1); // sadece room
    expect(result.tunnels.length).toBe(1);
    expect(result.metals.length).toBe(0);
    filterState.enabled = false;
    filterState.kinds = new Set(["room", "tunnel", "metal", "shaft"]);
  });

  it("boş veri güvenli döndürür", () => {
    filterState.enabled = true;
    expect(filterCsvRows([])).toEqual([]);
    expect(filterCsvRows(null)).toEqual([]);
    filterState.enabled = false;
  });
});
