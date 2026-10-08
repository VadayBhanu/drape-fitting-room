// Understand a product photo: cut the background and find torso, sleeves and hem.
// analyzeAlpha() is pure so it can be tested in Node.

/**
 * @param {Uint8ClampedArray|Uint8Array} alpha one value per pixel (0..255)
 * @returns layout of the garment in source-pixel coordinates, or null if empty
 */
export function analyzeAlpha(alpha, w, h, threshold = 40) {
  const minX = new Int32Array(h).fill(-1), maxX = new Int32Array(h).fill(-1);
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > threshold) { if (lo < 0) lo = x; hi = x; }
    minX[y] = lo; maxX[y] = hi;
    if (lo >= 0) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0 || bottom - top < 4) return null;
  const H = bottom - top;
  const rowW = y => (minX[y] < 0 ? 0 : maxX[y] - minX[y] + 1);
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

  // two legs: centre column empty across much of the lower half
  const cxAll = median(range(top, bottom).filter(y => minX[y] >= 0).map(y => (minX[y] + maxX[y]) / 2));
  const lower = range(Math.round(top + H * 0.55), Math.round(top + H * 0.95));
  const gapRows = lower.filter(y => alpha[y * w + Math.round(cxAll)] <= threshold && rowW(y) > 0).length;
  if (gapRows > lower.length * 0.5) {
    return { kind: 'bottom', top, bottom, srcL: Math.min(...lower.map(y => minX[y]).filter(v => v >= 0)),
      srcR: Math.max(...lower.map(y => maxX[y])), cx: cxAll, waistY: top };
  }

  // torso width: median of the lower body rows
  const torsoRows = range(Math.round(top + H * 0.72), Math.round(top + H * 0.95));
  const torsoW = median(torsoRows.map(rowW));
  const cx = median(torsoRows.map(y => (minX[y] + maxX[y]) / 2));
  const torsoL = cx - torsoW / 2, torsoR = cx + torsoW / 2;

  // sleeves: upper rows clearly wider than the torso
  const upperEnd = Math.round(top + H * 0.65);
  const sleeveRows = range(top, upperEnd).filter(y => rowW(y) > torsoW * 1.25);
  const hasSleeves = sleeveRows.length > H * 0.04;
  let armY = Math.round(top + Math.min(H * 0.32, torsoW * 0.45));
  let sleeves = [];
  if (hasSleeves) {
    armY = sleeveRows[sleeveRows.length - 1];
    for (const side of ['L', 'R']) {
      const tipX = side === 'L' ? Math.min(...sleeveRows.map(y => minX[y])) : Math.max(...sleeveRows.map(y => maxX[y]));
      // rows that reach close to the tip give the cuff's top and bottom
      const near = Math.max(3, torsoW * 0.06);
      const cuffRows = sleeveRows.filter(y => side === 'L' ? minX[y] <= tipX + near : maxX[y] >= tipX - near);
      sleeves.push({ side, tipX, cuffTop: Math.min(...cuffRows), cuffBot: Math.max(...cuffRows),
        seamX: side === 'L' ? torsoL : torsoR });
    }
  }
  const body = range(armY, bottom).filter(y => minX[y] >= 0);
  const srcL = Math.min(torsoL, ...body.map(y => minX[y]));
  const srcR = Math.max(torsoR, ...body.map(y => maxX[y]));
  return { kind: 'top', top, bottom, cx, torsoL, torsoR, torsoW, armY, srcL, srcR, hasSleeves, sleeves,
    long: H / torsoW > 1.9 };
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

/** Flood-fill the background from the corners, then crop to the garment. Browser only. */
export function cutBackground(img, max = 720) {
  const sc = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h), d = id.data, seen = new Uint8Array(w * h);
  const alreadyCut = d[3] < 10 && d[(w * h - 1) * 4 + 3] < 10;
  if (!alreadyCut) {
    const ref = [d[0], d[1], d[2]], tol = 90;
    const stack = [0, w - 1, (h - 1) * w, h * w - 1];
    while (stack.length) {
      const i = stack.pop(); if (i < 0 || i >= w * h || seen[i]) continue; seen[i] = 1;
      const k = i * 4, diff = Math.abs(d[k] - ref[0]) + Math.abs(d[k + 1] - ref[1]) + Math.abs(d[k + 2] - ref[2]);
      if (d[k + 3] > 10 && diff > tol) continue;
      d[k + 3] = 0;
      const x = i % w;
      if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); stack.push(i - w, i + w);
    }
    g.putImageData(id, 0, 0);
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 <= x0 || y1 <= y0) return { canvas: c, info: null };
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  const og = out.getContext('2d', { willReadFrequently: true });
  og.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const px = og.getImageData(0, 0, out.width, out.height).data;
  const alpha = new Uint8Array(out.width * out.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  return { canvas: out, info: analyzeAlpha(alpha, out.width, out.height) };
}
