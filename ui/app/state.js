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
  legacyDikGroup: import("three").Group | null,
  legacyListFilter: string,
}} */
export const state = {
  /** Yapı Tespit Hassasiyeti yüzdesi (%0 - %100) */
  sensitivityPercent: 50,
  confidencePercent: 48,
  displayConfidencePercent: 50,
  symmetryPercent: 0,
  signalRatioPercent: 50,
  wallSupportPercent: 50,
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
  /** Legacy dik JSON ölçüm grid'i ve anomali katmanı */
  legacyDikGroup: null,
  /** Legacy JSON'dan türetilen isteğe bağlı tomografi dilimleri görünür mü? */
  legacyTomographyVisible: false,
  /** Tomografi aktif derinlik kesiti (m) */
  legacyTomographyDepthM: null,
  /** Tomografi dilim opaklığı 0.12–0.95 */
  legacyTomographyOpacity: 0.55,
  /** Tomografi otomatik dilim gezintisi */
  legacyTomographyPlaying: false,
  /** |σ| eşiğinin altı şeffaf/gri gösterilir */
  legacyTomographySigmaFloor: 0,
  /** Bulguları tekil sürekli 3D objelere birleştiren katman (aç/kapa) */
  legacyUnifiedObjectMapVisible: false,
  /** Bulguları derinlik hacminde gösteren yardımcı harita (aç/kapa) */
  legacyUndergroundMapVisible: false,
  /** Yüzey altı 3D renk haritası (aç/kapa; tespitlerden bağımsız) */
  legacySubsurfaceMapVisible: false,
  /** Yüzey altı harita dilim opaklığı 0.08–0.55 */
  legacySubsurfaceMapOpacity: 0.28,
  /** Jeotermal 3D proxy haritası (aç/kapa; |σ| ısı skoru, °C değil) */
  legacyGeothermalMapVisible: false,
  /** Jeotermal proxy dilim opaklığı 0.08–0.55 */
  legacyGeothermalMapOpacity: 0.26,
  /** Son jeotermal AI / yerel yorum metni */
  legacyGeothermalAiText: null,
  /** Son derinlik kalibrasyon AI / yerel öneri metni */
  legacyDepthCalibAiText: null,
  /** Son önerilen Parametre (alanlara yazılana kadar) */
  legacyDepthCalibSuggestion: null,
  /** Kalibrasyon modu: single-object veya field-stake */
  legacyDepthCalibrationMode: "single-object",
  /** Öneri zincirinde kullanılan değişmemiş başlangıç parametreleri; öneri üstüne öneri katlanmasını önler */
  legacyDepthCalibBaseParams: null,
  /** Saha kazığı tekrar okumaları ve kalibrasyon karşılaştırması */
  legacyFieldCalibrationReadings: [],
  legacyFieldCalibrationBeforeM: null,
  legacyFieldCalibrationAfterM: null,
  legacyFieldCalibrationObservedM: null,
  legacyFieldCalibrationDepthScale: null,
  /** Aynı JSON fingerprint oturumundan lateral kalibrasyon geri yüklendi mi? */
  legacyFieldCalibrationRestored: false,
  /** Doğrulanmış kararlardan öğrenilen eşik modeli (legacyThresholdLearning çıktısı) */
  legacyLearnedThresholds: null,
  /** Tahmini derinlik haritası (aç/kapa bakış; invert değil) */
  legacyDepthMapVisible: false,
  /** Derinlik haritası plan opaklığı 0.2–0.95 */
  legacyDepthMapOpacity: 0.72,
  /** Kompakt dipol invert proxy ayak izi (CAD değil; varsayılan kapalı) */
  legacyInvertProxyVisible: false,
  /** 3D etiket modu: off | badge | full */
  legacyLabelMode: "badge",
  /** Adım numaralandırma yönü: ltr = soldan sağa, rtl = sağdan sola */
  legacyStepNumberingDirection: "rtl",
  /** 3D obje bakışı: shape | signal | both (varsayılan shape — saha kullanıcısı) */
  legacyObjectViewMode: "shape",
  /** Kontür(0) ↔ sinyal(1) karışım; both modunda kullanılır */
  legacyObjectViewBlend: 0.5,
  /** Map detectionId → { n, spreadM, midM } çoklu çekim tutarlılığı */
  legacyArchiveDepthSpread: null,
  /** Legacy 3D sahne görünümü: combined, plan veya objects */
  legacySceneViewMode: "combined",
  /** Sol LEGACY3DMAG listesi filtresi: all, detections, strong, attention veya normal */
  legacyListFilter: "all",
  /** Son yüklenen Legacy dik JSON analiz sonucu (AnalysisResult) */
  legacyDikResult: null,
  /** Analiz sonucu ile saha gözlemlerini ayıran tek vaka modeli */
  legacyCase: null,
  /** Analiz + türetilmiş saha modeli + operatör/öğrenme snapshot'ı */
  legacyCasePackage: null,
  /** Son Legacy arşiv kaydının id'si — saha raporu iliştirme için */
  legacyArchiveEntryId: null,
  /** Adım, tespit ve saha metrelerini birleştiren ortak görünüm modeli */
  legacyFieldModel: null,
  /** Legacy harita: full = tüm kanıtlar, merged = birleşik hedefler, both = ikisi */
  legacyMapViewMode: "merged",
  /** Birleşik hedef seçimi */
  legacySelectedMergedTargetId: null,
  /** Seçili birleşik hedefin 3D sunumu: simple | evidence | full */
  legacyMergedTargetViewMode: "simple",
  /** Kullanıcının otomatik gruptan ayırdığı ham kanıt kimlikleri */
  legacyMergedSplitDetectionIds: [],
  legacyDikRawContent: null,
  legacyDikFileName: null,
  /** CSV verisi (CsvImportResult) */
  csvData: null,
  /** CSV ham içerik */
  csvContent: null,
  /** CSV dosya adı */
  csvFileName: null,
  /** Manyetik zemin haritasını göster */
  showMagneticGround: false,
  /** Manyetik zemin haritası opaklığı (0..1) */
  magneticOverlayOpacity: 0.45,
  /** Manyetik zemin görünüm modu: magnetic veya gradient */
  magneticOverlayMode: "magnetic",
  /** Manyetik gradyan yön oklarını göster */
  magneticOverlayArrows: true,
  /** Iso-nT manyetik kontur çizgilerini göster */
  magneticOverlayContours: true,
  /** Manyetik renk ölçeği otomatik mi? */
  magneticOverlayAutoScale: true,
  /** Manuel manyetik renk ölçeği alt/üst sınırı (nT) */
  magneticOverlayScaleLow: null,
  magneticOverlayScaleHigh: null,
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
  /** 3D kullanıcı görünüm profili: simple, technical veya field */
  viewProfile: "simple",
  /** LEGACY kullanıcı paneli: simple veya expert */
  legacyUserMode: "simple",
  /** Hedef modunda yalnızca seçili hedefi büyüt */
  legacyTargetMode: false,
  /** Saha raporuna elle eklenen Legacy hedef kimlikleri */
  legacyReportTargetIds: [],
  /** Legacy saha operatörü görev akışını göster */
  legacyFieldWorkflowEnabled: true,
  /** Adım/obje/kamera görünürlüğünün ortak seçim sözleşmesi */
  legacyTargetSession: {
    kind: "none",
    stepIndex: null,
    detectionId: null,
    view: "scene",
    visibility: "step",
    source: "initial",
  },
  /** Hazır derinlik profili adı */
  legacyDepthProfile: "normal",
  /** Birleşme duyarlılığı: cautious | normal | research */
  legacyMergeProfile: "normal",
};
