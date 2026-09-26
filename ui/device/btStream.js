/**
 * BLE bildirim akışını tam JSON mesajlarına böler ve Legacy3DMag belgesine derler.
 *
 * Saf modül: DOM/Tauri bağımlılığı yoktur, vitest ile doğrudan test edilir.
 * Cihaz protokolü ne olursa olsun üç akış biçimi desteklenir:
 *   1) Tek parça JSON belgeleri (metadata + scan içeren),
 *   2) Satır mesajları — nesne kayıtları ({time, x, y, ...}),
 *   3) Satır mesajları — sayı dizileri ([t, x, y, z, x_coords, y_coords]).
 * Parçalanmış (yarım) mesajlar tamamlanana kadar tamponlanır; JSON dışı
 * artıklar sessizce atılır (sayaç: droppedCount). Uydurma desen/örüntü
 * üretilmez — yalnızca gerçekten gelen satırlar haritaya girer.
 *
 * Ayrıca satırları canlı 2D ısı haritası noktalarına eşler (legacyRowToHeatPoint);
 * sütun çözümlemesi Rust `parse_outer_and_table` ile birebir aynı takma adları,
 * ısı değeri `analyze.rs::magnitude` ile aynı |B| = hypot(bx,by,bz) kullanır.
 */

/** Legacy cihaz çıktılarının standart sütun dizilimi (6 sütunlu satırlar için). */
export const LEGACY_STANDARD_COLUMNS = ["time", "x", "y", "z", "x_coords", "y_coords"];

/** CSV heatmap eksen ölçeği: 1 m = 10⁷ piksel (csvOverlay drawAxes ile aynı). */
export const HEAT_PX_PER_M = 1e7;

// Rust parse_outer_and_table ile birebir sütun takma adları.
const B_X_ALIASES = ["bx", "mag_x", "magnetic_x", "field_x"];
const B_Y_ALIASES = ["by", "mag_y", "magnetic_y", "field_y"];
const B_Z_ALIASES = ["bz", "mag_z", "magnetic_z", "field_z"];
const POS_X_ALIASES = ["x_coords", "x_coord", "pos_x", "position_x", "east", "easting"];
const POS_Y_ALIASES = ["y_coords", "y_coord", "pos_y", "position_y", "north", "northing"];

/** Bir JSON değeri tam belge mi (metadata/scan/table içeren)? */
export function isDocMessage(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("scan" in value ||
      "table" in value ||
      "metadata" in value ||
      "meta" in value ||
      (Array.isArray(value.data) && ("columns" in value || "rows" in value)))
  );
}

/** Bir JSON değeri ölçüm satırı mı (sayı dizisi ya da düz kayıt nesnesi)? */
export function isPointMessage(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((v) => typeof v === "number" || v == null || v === "");
  }
  if (value && typeof value === "object") return !isDocMessage(value);
  return false;
}

/**
 * Tampondan tamamlanmış JSON değerlerini çıkarır.
 * Yarım kalan değer `rest` içinde bekler; bozuk/JSON dışı parçalar `dropped`
 * olarak sayılır. Dizgi içi süslü parantezler (ör. "a}b") güvenle atlanır.
 */
export function extractCompleteJsonValues(buffer) {
  const values = [];
  let rest = String(buffer ?? "");
  let dropped = 0;
  for (;;) {
    const start = rest.search(/[[{]/);
    if (start < 0) {
      if (rest.trim().length) dropped += 1; // yalnızca gerçek artık — boşluk değil
      rest = "";
      break;
    }
    if (start > 0) {
      if (rest.slice(0, start).trim().length) dropped += 1;
      rest = rest.slice(start);
    }
    const open = rest[0];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break; // yarım kalan mesaj tamamlanana kadar bekle
    const raw = rest.slice(0, end + 1);
    rest = rest.slice(end + 1);
    try {
      values.push(JSON.parse(raw));
    } catch (_) {
      dropped += 1;
    }
  }
  return { values, rest, dropped };
}

/**
 * BLE bildirim akışı birleştiricisi — base64 bayt parçalarını alır,
 * tamamlanan JSON mesajlarını biriktirir.
 */
export function createBtJsonAssembler() {
  let decoder = new TextDecoder("utf-8");
  let buffer = "";
  let values = [];
  let byteCount = 0;
  let droppedCount = 0;
  let pointCount = 0;

  function absorb(text) {
    buffer += String(text ?? "");
    const r = extractCompleteJsonValues(buffer);
    buffer = r.rest;
    droppedCount += r.dropped;
    if (r.values.length) {
      pointCount += r.values.filter(isPointMessage).length;
      values.push(...r.values);
    }
    return r.values;
  }

  return {
    /** base64 bildirim katmanı (bt-data olayı) → ham baytlar. */
    pushBase64(b64) {
      const bin = atob(String(b64 ?? "").replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      byteCount += bytes.length;
      return absorb(decoder.decode(bytes, { stream: true }));
    },
    /** Metin parçası (testler ve metin tabanlı cihazlar için). */
    pushText(text) {
      return absorb(text);
    },
    /** UTF-8 kuyruğunu kapatır; tamamlanmamış JSON reddedilir. */
    flush() {
      buffer += decoder.decode();
      const extracted = absorb("");
      if (buffer.length) droppedCount += 1;
      buffer = "";
      return extracted;
    },
    values() {
      return values.slice();
    },
    stats() {
      return {
        messageCount: values.length,
        pointCount,
        byteCount,
        droppedCount,
        bufferedChars: buffer.length,
      };
    },
    reset() {
      decoder = new TextDecoder("utf-8");
      buffer = "";
      values = [];
      byteCount = 0;
      droppedCount = 0;
      pointCount = 0;
    },
  };
}

const normalizeCell = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0; // boş / sayısal olmayan hücre — parse tarafının varsayılanı
};

/**
 * Mesajları tek satır tabanına toplar (belge tabloları + kayıtlar + diziler).
 * Sütunlar bilinmiyorsa satır genişliğinden standart Legacy dizilimine düşer.
 * @returns {{ columns: string[], rows: number[][], docMeta: object|null,
 *             segmentRanges: array|null, singleDoc: boolean }}
 */
export function collectLegacyRows(values) {
  const list = Array.isArray(values) ? values.filter((v) => v != null) : [];
  let columns = [];
  const pushColumn = (name) => {
    const s = String(name);
    if (s && !columns.includes(s)) columns.push(s);
  };
  const rows = []; // dizi satırlar
  const records = []; // nesne satırlar
  let docMeta = null;
  let segmentRanges = null;
  let docMessageCount = 0;
  let otherCount = 0;

  const absorbTable = (table) => {
    if (!table || typeof table !== "object") return;
    if (Array.isArray(table.columns)) {
      for (const c of table.columns) if (typeof c === "string") pushColumn(c);
    }
    const data = Array.isArray(table.data)
      ? table.data
      : Array.isArray(table.rows)
        ? table.rows
        : [];
    for (const row of data) {
      if (Array.isArray(row)) {
        rows.push(row);
      } else if (row && typeof row === "object") {
        Object.keys(row).forEach(pushColumn);
        records.push(row);
      }
    }
  };

  for (const value of list) {
    if (Array.isArray(value)) {
      if (value.length && value.every((v) => typeof v === "string")) {
        value.forEach(pushColumn); // sütun başlığı mesajı
      } else {
        rows.push(value);
      }
      otherCount += 1;
      continue;
    }
    if (!isDocMessage(value)) {
      Object.keys(value).forEach(pushColumn);
      records.push(value);
      otherCount += 1;
      continue;
    }
    docMessageCount += 1;
    const meta = value.metadata || value.meta;
    if (meta && typeof meta === "object") docMeta = { ...(docMeta || {}), ...meta };
    if (Array.isArray(value.segment_ranges)) segmentRanges = value.segment_ranges;
    absorbTable(
      value.scan ||
        value.table ||
        (Array.isArray(value.data) || Array.isArray(value.rows)
          ? { columns: value.columns, rows: Array.isArray(value.data) ? value.data : value.rows }
          : null)
    );
  }

  // Satırları tek biçime (dizi) indir — parse_scan_table karışık satır türlerini sevmez.
  for (const rec of records) rows.push(columns.map((c) => normalizeCell(rec[c])));

  let width = columns.length;
  for (const row of rows) width = Math.max(width, row.length);
  if (!columns.length) {
    // Sütun adları bilinmiyorsa satır genişliğinden standart Legacy dizilimine düş.
    columns =
      width === LEGACY_STANDARD_COLUMNS.length
        ? [...LEGACY_STANDARD_COLUMNS]
        : Array.from({ length: width }, (_, i) => `col_${i}`);
  } else {
    while (columns.length < width) columns.push(`col_${columns.length}`);
  }
  const data = rows.map((row) => columns.map((_, i) => normalizeCell(row[i])));

  return {
    columns,
    rows: data,
    docMeta,
    segmentRanges,
    singleDoc: docMessageCount === 1 && otherCount === 0,
  };
}

/**
 * Manyetik (Bx/By/Bz) ve konum (x_m/y_m) sütun indekslerini çözer.
 * Rust `parse_outer_and_table` ile birebir aynı kurallar: B bileşen takma adları
 * yoksa x/y/z manyetik sayılır; konum sütunu yoksa sessiz tahmin üretilmez.
 * @returns {{ bx: number, by: number, bz: number, xm: number, ym: number } | null}
 */
export function resolveLegacyFieldColumns(columns) {
  const lower = (Array.isArray(columns) ? columns : []).map((c) => String(c).toLowerCase());
  const find = (names) => lower.findIndex((c) => names.includes(c));
  const hasB = find(B_X_ALIASES) >= 0;
  let bx;
  let by;
  let bz;
  if (hasB) {
    bx = find(B_X_ALIASES);
    by = find(B_Y_ALIASES);
    bz = find(B_Z_ALIASES);
  } else {
    bx = lower.indexOf("x");
    by = lower.indexOf("y");
    bz = lower.indexOf("z");
  }
  let xm = find(POS_X_ALIASES);
  let ym = find(POS_Y_ALIASES);
  if (xm < 0 && hasB) xm = lower.indexOf("x");
  if (ym < 0 && hasB) ym = lower.indexOf("y");
  if (bx < 0 || by < 0 || bz < 0 || xm < 0 || ym < 0) return null;
  // Aynı kolon hem manyetik hem konum olamaz — sessiz tahmin yok (Rust ile aynı).
  if (bx === xm || by === ym || bz === xm || bz === ym) return null;
  return { bx, by, bz, xm, ym };
}

/**
 * Legacy satırını canlı heatmap noktasına çevirir.
 * Isı değeri analizdeki `magnitude()` ile aynı: |B| = hypot(bx, by, bz).
 * z bilinçli olarak y ile eşlenir — heatmap dikey eksen etiketleri z aralığından okunur.
 */
export function legacyRowToHeatPoint(row, cols) {
  if (!cols || !Array.isArray(row)) return null;
  const bx = Number(row[cols.bx]);
  const by = Number(row[cols.by]);
  const bz = Number(row[cols.bz]);
  const xM = Number(row[cols.xm]);
  const yM = Number(row[cols.ym]);
  if (![bx, by, bz, xM, yM].every(Number.isFinite)) return null;
  return {
    x: xM * HEAT_PX_PER_M,
    y: yM * HEAT_PX_PER_M,
    z: yM * HEAT_PX_PER_M,
    magnetic: Math.hypot(bx, by, bz),
  };
}

/** Satır tabanını heatmap noktalarına çevirir (çözümlenemeyen satırlar atlanır). */
export function legacyRowsToHeatPoints(columns, rows) {
  const cols = resolveLegacyFieldColumns(columns);
  if (!cols) return [];
  const points = [];
  for (const row of rows || []) {
    const p = legacyRowToHeatPoint(row, cols);
    if (p) points.push(p);
  }
  return points;
}

/**
 * Canlı heatmap biriktiricisi — mesaj sayısına göre önbellekli nokta üretimi.
 * Sütun bilgisi geç gelirse (başlık mesajı) eşleme geriye dönük uygulanır.
 */
export function createLiveHeatAccumulator() {
  let cachedCount = -1;
  let cachedPoints = [];
  return {
    update(values) {
      const list = Array.isArray(values) ? values : [];
      if (list.length === cachedCount) return cachedPoints;
      const { columns, rows } = collectLegacyRows(list);
      cachedPoints = legacyRowsToHeatPoints(columns, rows);
      cachedCount = list.length;
      return cachedPoints;
    },
    reset() {
      cachedCount = -1;
      cachedPoints = [];
    },
  };
}

/**
 * Toplanan JSON mesajlarını tek bir Legacy3DMag belgesine derler.
 * Çıktı, Rust `parse_scan_table` şemasına uygun snake_case metadata içerir.
 * @returns {{ ok: boolean, content?: string, columns?: string[], pointCount: number, message?: string }}
 */
export function buildLegacyJsonFromMessages(values, options = {}) {
  const list = Array.isArray(values) ? values.filter((v) => v != null) : [];
  if (!list.length) {
    return { ok: false, message: "Canlı akışta henüz veri yok", pointCount: 0 };
  }

  const { columns, rows, docMeta, segmentRanges, singleDoc } = collectLegacyRows(list);
  if (!rows.length) {
    return { ok: false, message: "Akışta ölçüm satırı yok", pointCount: 0 };
  }

  // Metadata — Rust parse tarafı snake_case okur (x_meters / y_meters).
  const meta = {
    device_code: "Legacy3DMagDevice",
    date: new Date().toISOString(),
    ...(docMeta || {}),
  };
  const xMeters = Number(options.xMeters);
  const yMeters = Number(options.yMeters);
  if (meta.x_meters == null && meta.xMeters == null && Number.isFinite(xMeters) && xMeters > 0) {
    meta.x_meters = xMeters;
  }
  if (meta.y_meters == null && meta.yMeters == null && Number.isFinite(yMeters) && yMeters > 0) {
    meta.y_meters = yMeters;
  }

  const doc = { metadata: meta, scan: { columns, data: rows } };
  // segment_ranges yalnızca tek belge akışında anlamlıdır (ek satır geldiyse düşer).
  if (singleDoc && Array.isArray(segmentRanges)) {
    doc.segment_ranges = segmentRanges;
  }

  return {
    ok: true,
    content: JSON.stringify(doc),
    columns,
    pointCount: rows.length,
  };
}

/**
 * Tarama kapsama hesabı — hedef matrisin (rows × cols) hangi karelerinin en az
 * bir ölçüm aldığını, hangilerinin atlandığını çıkarır. Amaç: "kenar boş kaldı"
 * sorununu sahadayken göstermek. Uydurma ölçüm üretilmez; boş kare açıkça
 * boş raporlanır.
 *
 * Hücreler alan tanımından (xMeters/yMeters × origin) bölünür. Alan tanımı yoksa
 * ya da veri alanın tamamen dışındaysa (cihaz mutlak koordinat gönderiyorsa)
 * veri sınırlarına düşülür — bu modda eksik kenar kareleri tespit edilemez;
 * `boundsFromField: false` ile dürüstçe bildirilir.
 *
 * @param {Array<{x:number,y:number}>} points heatmap noktaları (HEAT_PX_PER_M ölçekli)
 * @param {{rows?:number, cols?:number, xMeters?:number, yMeters?:number,
 *          originX?:number, originY?:number}} options
 * @returns {null | {
 *   rows:number, cols:number, totalCells:number, visitedCount:number,
 *   unvisitedCount:number, coverage:number, cellCounts:number[],
 *   unvisited: Array<{row:number, col:number, index:number}>,
 *   outOfFieldCount:number, boundsFromField:boolean,
 *   fieldPx: {xMin:number, xMax:number, yMin:number, yMax:number}
 * }}
 */
export function computeScanCoverage(points, options = {}) {
  const rows = Math.floor(Number(options.rows));
  const cols = Math.floor(Number(options.cols));
  const list = Array.isArray(points)
    ? points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    : [];
  if (!(rows > 0) || !(cols > 0) || !list.length) return null;

  const pts = list.map((p) => ({ x: p.x / HEAT_PX_PER_M, y: p.y / HEAT_PX_PER_M }));
  let dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
  for (const p of pts) {
    if (p.x < dMinX) dMinX = p.x;
    if (p.x > dMaxX) dMaxX = p.x;
    if (p.y < dMinY) dMinY = p.y;
    if (p.y > dMaxY) dMaxY = p.y;
  }

  const xMeters = Number(options.xMeters);
  const yMeters = Number(options.yMeters);
  const originX = Number.isFinite(Number(options.originX)) ? Number(options.originX) : 0;
  const originY = Number.isFinite(Number(options.originY)) ? Number(options.originY) : 0;
  const hasField = Number.isFinite(xMeters) && xMeters > 0 && Number.isFinite(yMeters) && yMeters > 0;
  const boundsFromField =
    hasField &&
    pts.some(
      (p) =>
        p.x >= originX && p.x <= originX + xMeters && p.y >= originY && p.y <= originY + yMeters
    );

  let g0x, g1x, g0y, g1y;
  let outOfFieldCount = 0;
  if (boundsFromField) {
    // Alanı hafifçe aşan veri heatmap'ten kaybolmasın diye sınırlar veriyle birleşir;
    // alan tamamen kapsandığında hücreler matris kareleriyle birebir örtüşür.
    g0x = Math.min(originX, dMinX);
    g1x = Math.max(originX + xMeters, dMaxX);
    g0y = Math.min(originY, dMinY);
    g1y = Math.max(originY + yMeters, dMaxY);
    outOfFieldCount = pts.filter(
      (p) =>
        p.x < originX || p.x > originX + xMeters || p.y < originY || p.y > originY + yMeters
    ).length;
  } else {
    g0x = dMinX;
    g1x = dMaxX;
    g0y = dMinY;
    g1y = dMaxY;
  }
  // Tek nokta / sıfır aralık koruması.
  if (g1x - g0x < 1e-9) {
    g0x -= 0.5;
    g1x += 0.5;
  }
  if (g1y - g0y < 1e-9) {
    g0y -= 0.5;
    g1y += 0.5;
  }

  const cellCounts = new Array(rows * cols).fill(0);
  const cellW = (g1x - g0x) / cols;
  const cellH = (g1y - g0y) / rows;
  for (const p of pts) {
    let c = Math.floor((p.x - g0x) / cellW);
    let r = Math.floor((p.y - g0y) / cellH);
    c = Math.min(cols - 1, Math.max(0, c));
    r = Math.min(rows - 1, Math.max(0, r));
    cellCounts[r * cols + c] += 1;
  }

  const unvisited = [];
  let visitedCount = 0;
  for (let i = 0; i < cellCounts.length; i++) {
    if (cellCounts[i] > 0) visitedCount += 1;
    else unvisited.push({ row: Math.floor(i / cols), col: i % cols, index: i });
  }
  const totalCells = rows * cols;
  return {
    rows,
    cols,
    totalCells,
    visitedCount,
    unvisitedCount: totalCells - visitedCount,
    coverage: visitedCount / totalCells,
    cellCounts,
    unvisited,
    outOfFieldCount,
    boundsFromField,
    fieldPx: {
      xMin: g0x * HEAT_PX_PER_M,
      xMax: g1x * HEAT_PX_PER_M,
      yMin: g0y * HEAT_PX_PER_M,
      yMax: g1y * HEAT_PX_PER_M,
    },
  };
}

/**
 * Yürüyüş izi — örnekleri varış sırasına göre tutar; `minStepPx`'den yakın
 * ardışık tekrarları (aynı noktaya tekrar basan çekimler) atar.
 */
export function heatPointsToTrail(points, minStepPx = 0) {
  const trail = [];
  let last = null;
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (last) {
      const step = Math.hypot(p.x - last.x, p.y - last.y);
      if (step <= minStepPx) continue;
    }
    trail.push({ x: p.x, y: p.y });
    last = p;
  }
  return trail;
}
