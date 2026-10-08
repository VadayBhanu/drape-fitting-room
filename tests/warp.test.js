import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affineFrom, applyAffine, along, buildTopMesh, buildBottomMesh, estimateYaw } from '../src/warp.js';
import { computeGeom, dist } from '../src/geometry.js';
import { analyzeAlpha } from '../src/garment.js';
import { standingPose, W, H } from './helpers.js';

const close = (a, b, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

function tee() {
  const w = 200, h = 200, a = new Uint8Array(w * h);
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255; };
  fill(60, 10, 140, 190); fill(10, 10, 190, 60);
  return analyzeAlpha(a, w, h);
}

test('warp: affine transform maps each triangle corner exactly', () => {
  const s = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const d = [{ x: 5, y: 7 }, { x: 25, y: 9 }, { x: 3, y: 30 }];
  const m = affineFrom(...s, ...d);
  s.forEach((p, i) => assert.ok(close(applyAffine(m, p), d[i]), `corner ${i}`));
  assert.equal(affineFrom(s[0], s[0], s[0], ...d), null);
});

test('warp: walking along a polyline bends at the joint', () => {
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.ok(close(along(path, 5).p, { x: 5, y: 0 }));
  assert.ok(close(along(path, 15).p, { x: 10, y: 5 }));
  assert.ok(close(along(path, 15).dir, { x: 0, y: 1 }));
});

test('warp: sleeves join the torso seam exactly (no gap)', () => {
  const g = computeGeom(standingPose(), W, H);
  const mesh = buildTopMesh(g, tee());
  assert.equal(mesh.sleeves.length, 2);
  for (const sl of mesh.sleeves) {
    assert.ok(close(sl.dst[0][0], mesh.map(sl.src[0][0])));
    assert.ok(close(sl.dst[0][1], mesh.map(sl.src[0][1])));
  }
});

test('warp: sleeves follow the arms (up and out)', () => {
  const info = tee();
  const up = computeGeom(standingPose({ pose: 'up' }), W, H);
  for (const sl of buildTopMesh(up, info).sleeves) {
    const tip = sl.dst[3][0];
    assert.ok(tip.y < up.sc.y, 'with arms raised, sleeve tips rise above the shoulders');
  }
  const out = computeGeom(standingPose({ pose: 'out' }), W, H);
  const xs = buildTopMesh(out, info).sleeves.map(sl => sl.dst[3][0].x);
  assert.ok(Math.abs(xs[0] - xs[1]) > out.sw * 1.5, 'with arms out, sleeve tips spread wide');
});

test('warp: torso narrows when the person turns', () => {
  const g = computeGeom(standingPose(), W, H), info = tee();
  const width = k => { const row = buildTopMesh(g, info, { k }).torso.dst[1]; return dist(row[0], row[2]); };
  assert.ok(width(0.5) < width(1) * 0.6);
});

test('warp: turn estimate from shoulder width', () => {
  const lockSw = computeGeom(standingPose(), W, H).sw;
  assert.ok(estimateYaw(computeGeom(standingPose(), W, H), lockSw).k > 0.95);
  const side = estimateYaw(computeGeom(standingPose({ turned: true }), W, H), lockSw, 0.2);
  assert.ok(side.k < 0.5); assert.equal(side.sign, 1);
});

test('warp: trouser legs run from the waist to the ankles', () => {
  const g = computeGeom(standingPose(), W, H);
  const info = { kind: 'bottom', top: 0, bottom: 300, srcL: 30, srcR: 130, cx: 80 };
  const { legs } = buildBottomMesh(g, info);
  assert.equal(legs.length, 2);
  for (const leg of legs) {
    const end = leg.dst[2], ankleY = Math.max(g.la.y, g.ra.y);
    assert.ok(end[0].y > g.kc.y, 'hem below the knees');
    assert.ok(Math.abs(end[0].y - ankleY) < g.E * 1.2, 'hem near the ankles');
  }
});

test('warp: photo-left sleeve goes on the screen-left arm, and legs do not cross', () => {
  const g = computeGeom(standingPose({ pose: 'out' }), W, H);
  const sl = buildTopMesh(g, tee()).sleeves;
  const L = sl.find(s => s.side === 'L'), R = sl.find(s => s.side === 'R');
  assert.ok(L.dst[3][0].x < g.sc.x && R.dst[3][0].x > g.sc.x);
  const legs = buildBottomMesh(computeGeom(standingPose(), W, H), { kind: 'bottom', top: 0, bottom: 300, srcL: 30, srcR: 130, cx: 80 }).legs;
  const hemL = legs.find(l => l.side === 'L').dst[2], hemR = legs.find(l => l.side === 'R').dst[2];
  assert.ok(Math.max(hemL[0].x, hemL[1].x) < Math.min(hemR[0].x, hemR[1].x));
});

test('warp: shorts stop above the knee, trousers reach the ankle', () => {
  const g = computeGeom(standingPose(), W, H);
  const hem = h => buildBottomMesh(g, { kind: 'bottom', top: 0, bottom: h, srcL: 30, srcR: 130, cx: 80 }).legs[0].dst[2][0].y;
  assert.ok(hem(100) < g.kc.y, 'shorts above the knee');
  assert.ok(hem(250) > g.kc.y + (g.la.y - g.kc.y) * 0.8, 'trousers near the ankle');
});
