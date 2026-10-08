// Maps a garment photo onto the body as a triangle mesh.
// Pure functions (affineFrom, buildTopMesh, buildBottomMesh, estimateYaw) are tested in Node.
import { add, sub, mul, dist, norm, lerp, mid, dot } from './geometry.js';

/** Affine transform [a,b,c,d,e,f] (canvas order) that maps triangle s0,s1,s2 onto d0,d1,d2. */
export function affineFrom(s0, s1, s2, d0, d1, d2) {
  const det = s0.x * (s1.y - s2.y) - s1.x * (s0.y - s2.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(det) < 1e-9) return null;
  // inverse of [[x0,x1,x2],[y0,y1,y2],[1,1,1]]
  const i = [
    [(s1.y - s2.y) / det, (s2.x - s1.x) / det, (s1.x * s2.y - s2.x * s1.y) / det],
    [(s2.y - s0.y) / det, (s0.x - s2.x) / det, (s2.x * s0.y - s0.x * s2.y) / det],
    [(s0.y - s1.y) / det, (s1.x - s0.x) / det, (s0.x * s1.y - s1.x * s0.y) / det],
  ];
  const row = (v0, v1, v2) => [0, 1, 2].map(c => v0 * i[0][c] + v1 * i[1][c] + v2 * i[2][c]);
  const [a, c, e] = row(d0.x, d1.x, d2.x);
  const [b, dd, f] = row(d0.y, d1.y, d2.y);
  return [a, b, c, dd, e, f];
}
export const applyAffine = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** How far the person has turned. k = visible width fraction (1 facing, ~0.3 side-on). */
export function estimateYaw(g, lockSw, zDiff = 0) {
  const k = Math.max(0.3, Math.min(1, g.sw / Math.max(lockSw || g.sw, 1)));
  return { k, sign: Math.sign(zDiff) || 0, angle: Math.acos(k) };
}

/** Torso + sleeves mesh for a top. Returns grids of matching source/destination points. */
export function buildTopMesh(g, info, { k = 1, sign = 0, swayOff = 0 } = {}) {
  const { E, d } = g;
  // photo left -> screen left: use body axes that point to the right of the screen
  const u = screenRight(g.u), uh = screenRight(g.uh);
  const chestW = Math.max(g.sw * 1.22, g.hw * 1.35);
  const s = chestW / info.torsoW;                       // source px -> screen px
  const neck = add(g.sc, mul(d, -E * 0.13));
  const armC = add(g.sc, mul(d, E * 0.42));
  const shift = sign * (1 - k) * chestW * 0.2;

  const map = p => {
    let c, f;
    if (p.y <= info.armY) {
      f = (p.y - info.top) / Math.max(1, info.armY - info.top);
      c = lerp(neck, armC, f); f = 0;
    } else {
      const along = (p.y - info.armY) * s;
      const toHip = dist(armC, g.hc);
      f = Math.min(1, along / Math.max(toHip, 1));
      c = add(armC, mul(d, along));
      const below = Math.max(0, along - toHip);
      if (below > 0) c = add(c, mul(uh, swayOff * Math.min(1, below / (g.thigh || 1))));
    }
    const axis = norm(lerp(u, uh, f));
    return add(c, mul(axis, (p.x - info.cx) * s * k + shift));
  };

  const ys = [info.top, info.armY];
  for (let i = 1; i <= 8; i++) ys.push(info.armY + (info.bottom - info.armY) * i / 8);
  const xs = [info.srcL, (info.srcL + info.cx) / 2, info.cx, (info.cx + info.srcR) / 2, info.srcR];
  const src = ys.map(y => xs.map(x => ({ x, y })));
  const torso = { src, dst: src.map(r => r.map(map)) };

  // sleeves follow the arm on the same screen side as the sleeve in the photo
  const leftIsL = g.ls.x <= g.rs.x;
  const arms = {
    L: leftIsL ? { el: g.le, wr: g.lw } : { el: g.re, wr: g.rw },
    R: leftIsL ? { el: g.re, wr: g.rw } : { el: g.le, wr: g.lw },
  };
  const sleeves = (info.sleeves || []).map(sl => {
    const A = { x: sl.seamX, y: info.top + (info.armY - info.top) * 0.08 }, B = { x: sl.seamX, y: info.armY };
    const D = { x: sl.tipX, y: sl.cuffTop }, C = { x: sl.tipX, y: sl.cuffBot };
    const Ad = map(A), Bd = map(B), seamV = sub(Bd, Ad);
    const len = dist(mid(A, B), mid(C, D)) * s;
    const arm = arms[sl.side];
    const path = [mid(Ad, Bd), arm.el, arm.wr];
    const TS = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const sections = TS.map(t => {
      if (t === 0) return [Ad, Bd];
      const { p, dir } = along(path, t * len);
      let n = { x: -dir.y, y: dir.x }; if (dot(n, seamV) < 0) n = mul(n, -1);
      const half = (1 - t) * dist(Ad, Bd) / 2 + t * dist(C, D) * s / 2;
      return [add(p, mul(n, -half)), add(p, mul(n, half))];
    });
    const srcS = TS.map(t => [lerp(A, D, t), lerp(B, C, t)]);
    return { side: sl.side, src: srcS, dst: sections };
  });
  return { torso, sleeves, map };
}

/** Two-leg mesh for trousers/shorts. */
export function buildBottomMesh(g, info, { k = 1 } = {}) {
  const { E, d } = g;
  const uh = screenRight(g.uh);
  const waistW = Math.max(g.hw * 1.45, E * 0.85);
  const s = waistW / Math.max(1, info.srcR - info.srcL);
  const waist = add(g.hc, mul(d, -E * 0.12));
  // length comes from the body: trousers reach the ankles, shorts stop above the knee
  const aspect = (info.bottom - info.top) / Math.max(1, info.srcR - info.srcL);
  const coverage = Math.max(0.3, Math.min(1.04, aspect / 2.4));
  const leftIsL = g.lh.x <= g.rh.x;
  const legs = [['L', info.srcL], ['R', info.srcR]].map(([side, outerX]) => {
    const hip = (side === 'L') === leftIsL ? g.lh : g.rh;
    const knee = (side === 'L') === leftIsL ? g.lk : g.rk;
    const ank = (side === 'L') === leftIsL ? g.la : g.ra;
    const sgn = side === 'L' ? -1 : 1;
    const outerW = add(waist, mul(uh, sgn * waistW / 2 * k));
    const path = [mid(outerW, waist), knee, ank];
    const legLen = coverage * (dist(path[0], path[1]) + dist(path[1], path[2]));
    const srcRows = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const y = info.top + (info.bottom - info.top) * t;
      return [{ x: outerX, y }, { x: info.cx, y }];
    });
    const dstRows = [0, 0.25, 0.5, 0.75, 1].map(t => {
      if (t === 0) return [outerW, waist];
      const { p, dir } = along(path, t * legLen);
      const n = norm({ x: -dir.y, y: dir.x });
      const half = Math.abs(info.cx - outerX) * s * k / 2 * (1 - 0.25 * t);
      const a = add(p, mul(n, half)), b = add(p, mul(n, -half));
      return dot(sub(a, b), mul(uh, sgn)) > 0 ? [a, b] : [b, a];
    });
    void hip;
    return { side, src: srcRows, dst: dstRows };
  });
  return { legs };
}

const screenRight = v => (v.x < 0 ? mul(v, -1) : v);

/** Point and direction at arc length `len` along a polyline (extends past the end). */
export function along(path, len) {
  let left = len;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = dist(path[i], path[i + 1]);
    const dir = norm(sub(path[i + 1], path[i]));
    if (left <= seg || i === path.length - 2) return { p: add(path[i], mul(dir, left)), dir };
    left -= seg;
  }
  return { p: path[0], dir: { x: 0, y: 1 } };
}

/** Draw an image through a grid of source/destination points (browser only). */
export function drawGrid(ctx, img, src, dst) {
  for (let r = 0; r < src.length - 1; r++) for (let c = 0; c < src[r].length - 1; c++) {
    drawTri(ctx, img, src[r][c], src[r][c + 1], src[r + 1][c], dst[r][c], dst[r][c + 1], dst[r + 1][c]);
    drawTri(ctx, img, src[r][c + 1], src[r + 1][c + 1], src[r + 1][c], dst[r][c + 1], dst[r + 1][c + 1], dst[r + 1][c]);
  }
}
function drawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const m = affineFrom(s0, s1, s2, d0, d1, d2); if (!m) return;
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = p => { const v = { x: p.x - cx, y: p.y - cy }, l = Math.hypot(v.x, v.y) || 1; return { x: p.x + v.x / l * 0.8, y: p.y + v.y / l * 0.8 }; };
  const a = grow(d0), b = grow(d1), c = grow(d2);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
