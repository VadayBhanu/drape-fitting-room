import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropBoxForPerson, explainError, GRADIO_CLIENT } from '../src/realfit.js';

test('real fit: crop is 3:4, inside the frame, and contains the person', () => {
  const W = 1280, H = 720;
  for (const b of [{ x0: 560, y0: 80, x1: 720, y1: 690 }, { x0: 0, y0: 0, x1: 200, y1: 400 }, { x0: 900, y0: 300, x1: 1270, y1: 700 }]) {
    const c = cropBoxForPerson(b, W, H);
    assert.ok(Math.abs(c.w / c.h - 0.75) < 0.01, `ratio ${c.w / c.h}`);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H);
    assert.ok(c.x <= b.x0 + 1 && c.x + c.w >= Math.min(b.x1, W) - 1 || c.w >= b.x1 - b.x0 - 1);
  }
});

test('real fit: errors become plain directions', () => {
  assert.match(explainError(new Error('You have exceeded your GPU quota')), /token/);
  assert.match(explainError(new Error('Space is sleeping')), /waking up/);
  assert.match(explainError(new Error('Failed to fetch')), /connection/);
});

test('real fit: client version is pinned', () => {
  assert.match(GRADIO_CLIENT, /@\d+\.\d+\.\d+\//);
});
