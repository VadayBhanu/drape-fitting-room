import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAlpha } from '../src/garment.js';

// paint rectangles into an alpha map
function canvas(w, h, rects) {
  const a = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  return a;
}

test('garment: a flat-lay t-shirt is read as torso plus two sleeves', () => {
  const w = 200, h = 200;
  // body 60..140, sleeves 10..190 from row 10 to 60
  const a = canvas(w, h, [[60, 10, 140, 190], [10, 10, 190, 60]]);
  const info = analyzeAlpha(a, w, h);
  assert.equal(info.kind, 'top');
  assert.equal(info.hasSleeves, true);
  assert.ok(Math.abs(info.torsoW - 80) <= 2, `torsoW ${info.torsoW}`);
  assert.ok(Math.abs(info.armY - 59) <= 2, `armY ${info.armY}`);
  const [L, R] = info.sleeves;
  assert.equal(L.side, 'L'); assert.equal(R.side, 'R');
  assert.ok(L.tipX <= 11 && R.tipX >= 188);
  assert.ok(L.cuffTop >= 9 && L.cuffBot <= 60);
});

test('garment: a sleeveless top has no sleeves and an estimated armpit', () => {
  const w = 120, h = 200;
  const info = analyzeAlpha(canvas(w, h, [[30, 10, 90, 190]]), w, h);
  assert.equal(info.kind, 'top');
  assert.equal(info.hasSleeves, false);
  assert.ok(info.armY > info.top && info.armY < info.bottom);
});

test('garment: a long dress is flagged as long', () => {
  const w = 120, h = 400;
  const info = analyzeAlpha(canvas(w, h, [[35, 5, 85, 395]]), w, h);
  assert.equal(info.long, true);
});

test('garment: trousers are detected from the gap between the legs', () => {
  const w = 160, h = 300;
  const a = canvas(w, h, [[30, 10, 130, 90], [30, 90, 75, 290], [85, 90, 130, 290]]);
  const info = analyzeAlpha(a, w, h);
  assert.equal(info.kind, 'bottom');
  assert.ok(info.srcL <= 31 && info.srcR >= 128);
});

test('garment: an empty image returns null', () => {
  assert.equal(analyzeAlpha(new Uint8Array(100 * 100), 100, 100), null);
});
