export const $ = (id) => document.getElementById(id);

/** @type {{
  pendingFile: { name: string, base64: string } | null,
  surfaceState: any,
  renderer: import("three").WebGLRenderer | null,
  scene: import("three").Scene | null,
  camera: import("three").PerspectiveCamera | null,
  controls: import("three").OrbitControls | null,
  animId: number | null,
  structureGroup: import("three").Group | null,
  groundPlane: import("three").Mesh | null,
  structureTargets: Record<string, { position: import("three").Vector3, object: import("three").Object3D, label?: import("three").Sprite, detailLabel?: import("three").Sprite, radius?: number, title?: string }>,
  selectedStructureId: string | null,
  selectionMarker: import("three").Object3D | null,
  structureKotM: Record<string, number>,
}} */
export const state = {
  pendingFile: null,
  surfaceState: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  animId: null,
  structureGroup: null,
  groundPlane: null,
  structureTargets: {},
  selectedStructureId: null,
  selectionMarker: null,
  /** Yapı üstü yerel kot farkı (m) — focusId → metre */
  structureKotM: {},
  /** true = serbest çizim overlay (analiz şablonunu bozmaz) */
  useFootprintShape: false,
  /** serbest çizimde havuz dolu (true) — boşaltınca analiz yapıları görünür */
  poolFilled: true,
  freeDrawGroup: null,
  freeDrawTargets: {},
  freeDrawItems: [],
  selectedFreeDrawId: null,
  /** bant id → görünür (serbest çizim renk filtresi) */
  freeDrawBands: {},
  /** CSV overlay grubu (3D nokta bulutu) */
  csvOverlay: null,
  /** CSV verisi (CsvImportResult) */
  csvData: null,
  /** CSV ham içerik */
  csvContent: null,
  /** CSV dosya adı */
  csvFileName: null,
  /** Kesit (clipping) modu: zemini yatay düzlemle kes */
  clipEnabled: false,
  /** Kesit düzlemi yüksekliği (dünya Y, metre) */
  clipHeightM: 3,
  /** X-Ray / fresnel görünümü (yapılar hologram gibi) */
  xray: false,
  /** Karşılaştırma split clip plane'leri — { scene: THREE.Plane, comparison: THREE.Plane } */
  splitClipPlanes: null,
  /** Her tespit için saha notları ve fotoğrafları — { [focusId]: { notes: string, photos: [{dataUrl, name, ts}] } } */
  detectionNotes: {},
};
