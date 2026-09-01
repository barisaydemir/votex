import { $, state } from "../app/state.js";
import { pulsePreviewMarks } from "./scanFx.js";

export function clearPreviewMarks() {
  const canvas = $("preview-marks");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  pulsePreviewMarks(false);
}

export function markNormXY(obj) {
  return {
    x: Number(obj.cx),
    y: Number(obj.cy),
  };
}

/**
 * 2D önizleme: duvar ipuçları (krem) + boşluk / metal / tünel.
 */
export function updatePreviewMarks(surface) {
  const img = $("preview");
  const canvas = $("preview-marks");
  if (!img || !canvas || !surface) {
    clearPreviewMarks();
    return;
  }

  const paint = () => {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (w < 8 || h < 8) return;

    canvas.width = w;
    canvas.height = h;
    const rect = img.getBoundingClientRect();
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // object-fit: contain / cover durumunda gerçek görüntü alanını hesapla
    // Böylece canvas ile img arasında 1:1 piksel eşleşmesi sağlanır
    const imgAspect = w / h;
    const elemAspect = rect.width / rect.height;
    let offsetX = 0, offsetY = 0, drawW = rect.width, drawH = rect.height;
    if (elemAspect > imgAspect) {
      // Element daha geniş — dikeyde boşluk var (letterbox)
      drawH = rect.width / imgAspect;
      offsetY = (rect.height - drawH) / 2;
    } else if (elemAspect < imgAspect) {
      // Element daha dar — yatayda boşluk var (pillarbox)
      drawW = rect.height * imgAspect;
      offsetX = (rect.width - drawW) / 2;
    }
    // Canvas CSS offset'ini ayarla ki canvas tam img üzerine otursun
    // transform: none ile merkezleme transform'unu kaldır
    canvas.style.transform = "none";
    canvas.style.left = `${offsetX}px`;
    canvas.style.top = `${offsetY}px`;
    canvas.style.width = `${drawW}px`;
    canvas.style.height = `${drawH}px`;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const walls = surface.wallCues || surface.wall_cues || [];
    walls.forEach((c) => {
      const x = Number(c.x);
      const y = Number(c.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const px = Math.min(1, Math.max(0, x)) * w;
      const py = Math.min(1, Math.max(0, y)) * h;
      const s = Math.max(0.2, Math.min(1, Number(c.strength) || 0.5));
      const nearVoid = !!(c.nearVoid ?? c.near_void);
      const greenLine = !!(c.greenLine ?? c.green_line);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2.5, Math.min(w, h) * 0.006 * (0.7 + s)), 0, Math.PI * 2);
      ctx.fillStyle = greenLine
        ? `rgba(255, 250, 210, ${0.55 + s * 0.4})`
        : nearVoid
          ? `rgba(240, 248, 255, ${0.45 + s * 0.45})`
          : `rgba(255, 236, 170, ${0.4 + s * 0.45})`;
      ctx.fill();
    });
    // Yeşil-içı tünel çizgisi segmentlerini birleştir (görsel)
    const linePts = walls.filter((c) => c.greenLine || c.green_line);
    if (linePts.length >= 2) {
      ctx.strokeStyle = "rgba(255, 245, 200, 0.55)";
      ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.004);
      for (let i = 0; i < linePts.length - 1; i++) {
        const a = linePts[i];
        const b = linePts[i + 1];
        const dx = Number(a.x) - Number(b.x);
        const dy = Number(a.y) - Number(b.y);
        if (dx * dx + dy * dy > 0.01) continue;
        ctx.beginPath();
        ctx.moveTo(Number(a.x) * w, Number(a.y) * h);
        ctx.lineTo(Number(b.x) * w, Number(b.y) * h);
        ctx.stroke();
      }
    }

    const s = surface.structures || {};
    const marks = [];

    (s.chambers || []).forEach((c) => {
      marks.push({ ...markNormXY(c), kind: "void" });
    });
    (s.tunnels || []).forEach((t) => {
      marks.push({
        x: (Number(t.x0) + Number(t.x1)) * 0.5,
        y: (Number(t.y0) + Number(t.y1)) * 0.5,
        kind: "tunnel",
      });
      const x0 = Math.min(1, Math.max(0, Number(t.x0))) * w;
      const y0 = Math.min(1, Math.max(0, Number(t.y0))) * h;
      const x1 = Math.min(1, Math.max(0, Number(t.x1))) * w;
      const y1 = Math.min(1, Math.max(0, Number(t.y1))) * h;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = "rgba(78, 192, 212, 0.75)";
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
      ctx.stroke();
    });
    (s.metals || []).forEach((m) => {
      marks.push({ ...markNormXY(m), kind: "metal" });
    });

    const r = Math.max(7, Math.min(w, h) * 0.032);
    marks.forEach((m) => {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
      const px = Math.min(1, Math.max(0, m.x)) * w;
      const py = Math.min(1, Math.max(0, m.y)) * h;
      const stroke =
        m.kind === "metal"
          ? "rgba(226, 58, 58, 0.95)"
          : m.kind === "tunnel"
            ? "rgba(78, 192, 212, 0.95)"
            : "rgba(58, 168, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(2.5, r * 0.28);
      ctx.shadowColor = stroke;
      ctx.shadowBlur = Math.max(4, r * 0.45);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, r * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();
    });

    // Annotation pin'lerini çiz
    if (state.annotations?.length) {
      const PIN_COLORS = ["#e23a3a", "#f5c542", "#3edc8c", "#4a9eff"];
      state.annotations.forEach((a, idx) => {
        const px = Math.min(1, Math.max(0, a.x)) * w;
        const py = Math.min(1, Math.max(0, a.y)) * h;
        const color = a.color || PIN_COLORS[0];

        // Dış halka
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // İç nokta
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Numara
        ctx.save();
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(idx + 1), px, py);

        // Metin etiketi
        if (a.text) {
          const labelX = px + 15;
          const labelY = py;
          const truncated = a.text.length > 30 ? a.text.slice(0, 28) + '…' : a.text;
          const metrics = ctx.measureText(truncated);
          const textW = Math.min(metrics.width, w * 0.3);
          const textH = 16;
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.beginPath();
          ctx.roundRect(labelX - 3, labelY - textH / 2, textW + 8, textH, 3);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.font = '10px -apple-system, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(truncated, labelX + 1, labelY);
        }
        ctx.restore();
      });
    }

    if (marks.length || walls.length || state.annotations?.length) pulsePreviewMarks(true);
  };

  if (img.complete && img.naturalWidth > 0) {
    paint();
  } else {
    img.addEventListener("load", paint, { once: true });
  }
}
