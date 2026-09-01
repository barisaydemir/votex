import { describe, it, expect } from "vitest";
import {
  bandOf,
  blobsFromMask,
  outlineFromCells,
  douglasPeucker,
  adaptiveOutlineLimit,
  adaptiveMinPx,
  chainCues,
} from "./freeDraw.js";
import { makeFootprintVolume } from "./footprint.js";

/* ─── bandOf ─── */
describe("bandOf", () => {
  it("returns skip for green", () => {
    expect(bandOf(30, 180, 40)).toBe("skip");
  });
  it("returns skip for dark/low-sat", () => {
    expect(bandOf(5, 5, 5)).toBe("skip");
  });
  it("returns white for neutral bright", () => {
    expect(bandOf(200, 198, 205)).toBe("white");
  });
  it("returns cyan for h 155-195", () => {
    // hsl(180, 100%, 50%) → rgb(0,255,255)
    expect(bandOf(0, 255, 255)).toBe("cyan");
  });
  it("returns blue for h 195-250", () => {
    // hsl(220, 100%, 50%) → rgb(0,70,255)
    expect(bandOf(0, 70, 255)).toBe("blue");
  });
  it("returns purple for h 250-320", () => {
    // hsl(280, 100%, 50%) → rgb(170,0,255)
    expect(bandOf(170, 0, 255)).toBe("purple");
  });
  it("returns yellow for h 42-75", () => {
    // hsl(60, 100%, 50%) → rgb(255,255,0)
    expect(bandOf(255, 255, 0)).toBe("yellow");
  });
  it("returns orange for h 18-42", () => {
    // hsl(30, 100%, 50%) → rgb(255,128,0)
    expect(bandOf(255, 128, 0)).toBe("orange");
  });
  it("returns red for h < 18 or h > 320", () => {
    // hsl(10, 100%, 50%) → rgb(255,42,0)
    expect(bandOf(255, 42, 0)).toBe("red");
    // hsl(330, 100%, 50%) → rgb(255,0,128)
    expect(bandOf(255, 0, 128)).toBe("red");
  });
});

/* ─── blobsFromMask ─── */
describe("blobsFromMask", () => {
  it("finds single connected blob", () => {
    // 4×4 grid, blob at (1,1)-(2,1)-(1,2)-(2,2)
    const gw = 4, gh = 4;
    const mask = new Uint8Array(16);
    mask[5] = 1; mask[6] = 1; mask[9] = 1; mask[10] = 1;
    const blobs = blobsFromMask(mask, gw, gh, 1);
    expect(blobs.length).toBe(1);
    expect(blobs[0].length).toBe(4);
  });
  it("separates two disjoint blobs", () => {
    const gw = 6, gh = 2;
    const mask = new Uint8Array(12);
    mask[0] = 1; mask[1] = 1; // blob 1
    mask[8] = 1; mask[9] = 1; // blob 2
    const blobs = blobsFromMask(mask, gw, gh, 1);
    expect(blobs.length).toBe(2);
  });
  it("filters by minPx", () => {
    const gw = 4, gh = 4;
    const mask = new Uint8Array(16);
    mask[0] = 1; // single pixel
    mask[10] = 1; mask[11] = 1; mask[14] = 1; mask[15] = 1; // 4 px blob
    const blobs = blobsFromMask(mask, gw, gh, 3);
    expect(blobs.length).toBe(1);
    expect(blobs[0].length).toBe(4);
  });
  it("returns blobs sorted by size descending", () => {
    const gw = 8, gh = 2;
    const mask = new Uint8Array(16);
    // small blob: 2px
    mask[0] = 1; mask[1] = 1;
    // large blob: 6px
    for (let i = 6; i < 12; i++) mask[i] = 1;
    const blobs = blobsFromMask(mask, gw, gh, 1);
    expect(blobs[0].length).toBeGreaterThanOrEqual(blobs[1].length);
  });
  it("handles empty mask", () => {
    const mask = new Uint8Array(16);
    expect(blobsFromMask(mask, 4, 4, 1).length).toBe(0);
  });
});

/* ─── douglasPeucker ─── */
describe("douglasPeucker", () => {
  it("returns original if ≤ 3 points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }];
    expect(douglasPeucker(pts, 0.01)).toBe(pts);
  });
  it("simplifies redundant collinear points along edges", () => {
    // Rectangle with extra points along edges — DP should keep only corners
    const pts = [
      { x: 0, y: 0 },   // corner
      { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 }, // collinear
      { x: 0.5, y: 0 }, // corner
      { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.2 }, // collinear
      { x: 0.5, y: 0.4 }, // corner
      { x: 0.4, y: 0.4 }, { x: 0.3, y: 0.4 }, // collinear
      { x: 0, y: 0.4 },  // corner
      { x: 0, y: 0.3 }, { x: 0, y: 0.2 }, // collinear
    ];
    const result = douglasPeucker(pts, 0.02);
    expect(result.length).toBeLessThan(pts.length);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
    // Corners should be preserved
    expect(result.some((p) => Math.abs(p.x - 0.5) < 0.01 && Math.abs(p.y) < 0.01)).toBe(true);
    expect(result.some((p) => Math.abs(p.x - 0.5) < 0.01 && Math.abs(p.y - 0.4) < 0.01)).toBe(true);
  });
  it("preserves square shape with high tolerance", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0.5, y: 1 },
      { x: 0, y: 1 }, { x: 0, y: 0.5 },
    ];
    const result = douglasPeucker(pts, 0.01);
    // corners should be kept
    expect(result.length).toBeGreaterThanOrEqual(4);
  });
});

/* ─── adaptiveOutlineLimit ─── */
describe("adaptiveOutlineLimit", () => {
  it("returns 28 for small blobs", () => {
    expect(adaptiveOutlineLimit(10, 100, 100)).toBe(28);
  });
  it("returns 24 for medium blobs (500 < cells <= 1% of total)", () => {
    // total=60000, 1% = 600, 550 cells → >500 but ≤600 → 24
    expect(adaptiveOutlineLimit(550, 200, 300)).toBe(24);
  });
  it("returns 20 for large blobs (1%-5% of total)", () => {
    // total=10000, 1% = 100, 400 cells → >1% but <5% → 20
    expect(adaptiveOutlineLimit(400, 100, 100)).toBe(20);
  });
  it("returns 16 for very large blobs", () => {
    expect(adaptiveOutlineLimit(6000, 100, 100)).toBe(16); // > 5%
  });
});

/* ─── adaptiveMinPx ─── */
describe("adaptiveMinPx", () => {
  it("returns 4+ for small grids", () => {
    const v = adaptiveMinPx(50, 50);
    expect(v).toBeGreaterThanOrEqual(4);
  });
  it("returns higher threshold for large grids", () => {
    const small = adaptiveMinPx(50, 50);
    const large = adaptiveMinPx(200, 200);
    expect(large).toBeGreaterThan(small);
  });
  it("scales monotonically with grid size", () => {
    const a = adaptiveMinPx(80, 80);
    const b = adaptiveMinPx(150, 150);
    const c = adaptiveMinPx(250, 250);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });
});

/* ─── outlineFromCells ─── */
describe("outlineFromCells", () => {
  it("returns null for < 4 border cells", () => {
    const cells = [0, 1, 2]; // too small
    expect(outlineFromCells(cells, 10, 10)).toBeNull();
  });
  it("returns polygon for a 4×4 square blob", () => {
    const gw = 10, gh = 10;
    const cells = [];
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) cells.push(y * gw + x);
    }
    const outline = outlineFromCells(cells, gw, gh);
    expect(outline).not.toBeNull();
    expect(outline.length).toBeGreaterThanOrEqual(4);
    // All points should be normalized [0,1]
    for (const p of outline) {
      expect(p.x).toBeGreaterThanOrEqual(-0.05);
      expect(p.x).toBeLessThanOrEqual(1.05);
      expect(p.y).toBeGreaterThanOrEqual(-0.05);
      expect(p.y).toBeLessThanOrEqual(1.05);
    }
  });
  it("produces fewer points than raw border (simplification)", () => {
    const gw = 20, gh = 20;
    const cells = [];
    for (let y = 3; y < 17; y++) {
      for (let x = 3; x < 17; x++) cells.push(y * gw + x);
    }
    const outline = outlineFromCells(cells, gw, gh);
    // raw border of 14×14 square is ~52 cells; after DP should be ≤28
    expect(outline).not.toBeNull();
    expect(outline.length).toBeLessThanOrEqual(28);
    expect(outline.length).toBeGreaterThanOrEqual(4);
  });
  it("preserves shape of large irregular blob", () => {
    const gw = 30, gh = 30;
    const cells = [];
    // L-shaped blob
    for (let y = 5; y < 15; y++) for (let x = 5; x < 20; x++) cells.push(y * gw + x);
    for (let y = 15; y < 25; y++) for (let x = 5; x < 12; x++) cells.push(y * gw + x);
    const outline = outlineFromCells(cells, gw, gh);
    expect(outline).not.toBeNull();
    // Should have enough points to represent L-shape
    expect(outline.length).toBeGreaterThanOrEqual(6);
  });
  it("outline {x,y} nesnesi makeFootprintVolume için [x,y] dizisine çevrilmeli", () => {
    // REGRESYON: outlineFromCells {x,y} döndürür, makeFootprintVolume [x,y] bekler.
    // addBandVolume dönüşümü unutursa serbest çizim boş kalır (gerçek veride 0 hacim).
    const gw = 10, gh = 10;
    const cells = [];
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) cells.push(y * gw + x);
    const outline = outlineFromCells(cells, gw, gh);
    expect(outline).not.toBeNull();

    // Ham {x,y} çıktısı makeFootprintVolume'a verilirse null olur (kırık yol)
    const rawNull = makeFootprintVolume({
      outline, mapW: 24, mapD: 24, sideView: false, cx: 0.5, cy: 0.5,
      topM: 0.5, heightM: 1, vertExag: 1, wallColor: 0x2a7ec8, wireframe: false,
    });
    expect(rawNull).toBeNull();

    // [x,y] dizisine çevrilirse başarılı olur (fix)
    const ring = outline.map((p) => [p.x, p.y]);
    const ok = makeFootprintVolume({
      outline: ring, mapW: 24, mapD: 24, sideView: false, cx: 0.5, cy: 0.5,
      topM: 0.5, heightM: 1, vertExag: 1, wallColor: 0x2a7ec8, wireframe: false,
    });
    expect(ok).not.toBeNull();
  });
});

/* ─── chainCues ─── */
describe("chainCues", () => {
  it("chains nearby points into a single line", () => {
    const cues = [
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.11 },
      { x: 0.14, y: 0.12 },
      { x: 0.16, y: 0.13 },
    ];
    const lines = chainCues(cues, 0.05);
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBe(4);
  });
  it("separates distant groups", () => {
    const cues = [
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.11 },
      { x: 0.8, y: 0.8 },
      { x: 0.82, y: 0.81 },
    ];
    const lines = chainCues(cues, 0.05);
    expect(lines.length).toBe(2);
  });
  it("ignores singletons (poly.length < 2)", () => {
    const cues = [{ x: 0.5, y: 0.5 }];
    const lines = chainCues(cues, 0.05);
    expect(lines.length).toBe(0);
  });
});
