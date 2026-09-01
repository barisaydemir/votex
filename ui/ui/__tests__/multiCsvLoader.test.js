import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock state — must be before module imports
const mockState = {};
vi.mock("../../app/state.js", () => ({
  get state() { return mockState; },
  $: () => null,
}));

import { initMultiCsv, addCsvContent, removeDataset, clearAll, getMergedData, getDatasets, setMergeMode, selectDataset, setDatasetVisible, getDatasetCount, isMergeMode } from "../multiCsvLoader.js";

describe("multiCsvLoader", () => {
  beforeEach(async () => {
    Object.keys(mockState).forEach(k => delete mockState[k]);
    clearAll();
  });

  it("başlangıçta boş dataset listesi", () => {
    expect(getDatasets()).toHaveLength(0);
    expect(getDatasetCount()).toBe(0);
  });

  it("CSV içerik ekler", async () => {
    const csv = "x,y,z,magnetic\n100,50,2,100\n200,60,3,200\n300,70,4,300";
    const ds = await addCsvContent(csv, "Test", "test.csv");

    expect(ds).toBeTruthy();
    expect(ds.name).toBe("Test");
    expect(ds.pointCount).toBe(3);
    expect(ds.color).toBeTruthy();
    expect(ds.id).toMatch(/^csv-/);
  });

  it("birden fazla dataset ekler", async () => {
    await addCsvContent("x,y,z,magnetic\n100,50,2,100\n200,60,3,200", "A", "a.csv");
    await addCsvContent("x,y,z,magnetic\n300,70,4,300\n400,80,5,400", "B", "b.csv");

    expect(getDatasets()).toHaveLength(2);
    expect(getDatasetCount()).toBe(2);
  });

  it("dataset kaldırır", async () => {
    const ds = await addCsvContent("x,y,z,magnetic\n100,50,2,100", "Test", "test.csv");
    expect(getDatasetCount()).toBe(1);
    removeDataset(ds.id);
    expect(getDatasetCount()).toBe(0);
  });

  it("tümünü temizler", async () => {
    await addCsvContent("x,y,z,magnetic\n100,50,2,100", "A", "a.csv");
    await addCsvContent("x,y,z,magnetic\n200,60,3,200", "B", "b.csv");
    expect(getDatasetCount()).toBe(2);
    clearAll();
    expect(getDatasetCount()).toBe(0);
  });

  it("birleşik veri oluşturur", async () => {
    await addCsvContent("x,y,z,magnetic\n100,50,2,100\n200,60,3,200", "A", "a.csv");
    await addCsvContent("x,y,z,magnetic\n300,70,4,300", "B", "b.csv");

    const merged = getMergedData();
    expect(merged).toBeTruthy();
    expect(merged.pointCount).toBe(3);
    expect(merged.xMin).toBe(100);
    expect(merged.xMax).toBe(300);
  });

  it("görünmeyen dataset'i hariç tutar", async () => {
    const ds1 = await addCsvContent("x,y,z,magnetic\n100,50,2,100", "A", "a.csv");
    await addCsvContent("x,y,z,magnetic\n200,60,3,200", "B", "b.csv");

    setDatasetVisible(ds1.id, false);
    const merged = getMergedData();
    expect(merged.pointCount).toBe(1);
  });

  it("merge modunu değiştirir", () => {
    expect(isMergeMode()).toBe(true);
    setMergeMode("separate");
    expect(isMergeMode()).toBe(false);
    setMergeMode("overlay");
    expect(isMergeMode()).toBe(true);
  });

  it("dataset rengi döngüsel", async () => {
    const colors = new Set();
    for (let i = 0; i < 12; i++) {
      const ds = await addCsvContent("x,y,z,magnetic\n100,50,2,100", `DS${i}`, `d${i}.csv`);
      colors.add(ds.color);
    }
    expect(colors.size).toBeLessThanOrEqual(10);
  });

  it("çok satırlı CSV handle eder", async () => {
    let csv = "x,y,z,magnetic\n";
    for (let i = 0; i < 500; i++) {
      csv += `${i},${i * 0.5},${i * 0.1},${Math.sin(i) * 200}\n`;
    }
    const ds = await addCsvContent(csv, "Large", "large.csv");
    expect(ds.pointCount).toBe(500);
  });
});
