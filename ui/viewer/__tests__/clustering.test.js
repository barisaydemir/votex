import { describe, it, expect } from "vitest";
import { dbscan, clusterStructures, getClusterStats } from "../clustering.js";

describe("clustering.dbscan", () => {
  it("boş veri boş döndürür", () => {
    expect(dbscan([], 5, 2)).toEqual([]);
  });

  it("tek nokta kümelemez", () => {
    expect(dbscan([{ x: 0, y: 0, z: 0 }], 5, 2)).toEqual([]);
  });

  it("yakın noktaları gruplar", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 }, // uzak
      { x: 51, y: 0, z: 0 },
    ];
    const clusters = dbscan(points, 5, 2);
    expect(clusters.length).toBe(2); // 2 küme
    expect(clusters[0].size).toBe(3);
    expect(clusters[1].size).toBe(2);
  });

  it("gürültü noktalarını atlar", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 }, // izole
      { x: 200, y: 0, z: 0 }, // izole
    ];
    const clusters = dbscan(points, 5, 2);
    expect(clusters.length).toBe(0); // hiçbiri yeterince yakın değil
  });

  it("centroid doğru hesaplar", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const clusters = dbscan(points, 15, 2);
    expect(clusters.length).toBe(1);
    expect(clusters[0].centroid.x).toBe(5);
    expect(clusters[0].centroid.z).toBe(0);
  });
});

describe("clustering.clusterStructures", () => {
  it("boş yapılar boş döndürür", () => {
    expect(clusterStructures([], [], [])).toEqual([]);
  });

  it("yeterli yapı varsa küme üretir", () => {
    const chambers = [
      { x: 0, y: 0, z: 0, kind: "room", confidence: 0.8 },
      { x: 3, y: 1, z: 2, kind: "room", confidence: 0.9 },
    ];
    const clusters = clusterStructures(chambers, [], [], { eps: 10, minPts: 2 });
    expect(clusters.length).toBe(1);
    expect(clusters[0].size).toBe(2);
    expect(clusters[0].type).toBe("room");
    expect(clusters[0].avgConfidence).toBe(85);
  });

  it("farklı türleri gruplar", () => {
    const chambers = [
      { x: 0, y: 0, z: 0, kind: "room", confidence: 0.7 },
      { x: 2, y: 0, z: 0, kind: "room", confidence: 0.8 },
      { x: 1, y: 0, z: 0, kind: "tunnel", confidence: 0.6 },
    ];
    const clusters = clusterStructures(chambers, [], [], { eps: 10, minPts: 2 });
    expect(clusters.length).toBe(1);
    expect(clusters[0].members.length).toBe(3);
  });
});

describe("clustering.getClusterStats", () => {
  it("boş küme istatistiği", () => {
    const stats = getClusterStats([]);
    expect(stats.total).toBe(0);
    expect(stats.members).toBe(0);
  });

  it("doğru istatistik üretir", () => {
    const clusters = [
      { type: "room", size: 3, radius: 5 },
      { type: "tunnel", size: 2, radius: 10 },
    ];
    const stats = getClusterStats(clusters);
    expect(stats.total).toBe(2);
    expect(stats.members).toBe(5);
    expect(stats.avgRadius).toBe(7.5);
    expect(stats.types.room).toBe(1);
    expect(stats.types.tunnel).toBe(1);
  });
});
