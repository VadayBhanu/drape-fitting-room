import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, OPTS } from '../src/catalog.js';

const all = [...CATALOG.tops, ...CATALOG.bottoms];

test('catalog: ids are unique', () => {
  assert.equal(new Set(all.map(i => i.id)).size, all.length);
});
test('catalog: every top has fitting options and every bottom is trousers', () => {
  for (const t of CATALOG.tops) assert.ok(OPTS[t.type], `missing OPTS for ${t.type}`);
  for (const b of CATALOG.bottoms) assert.equal(b.type, 'pants');
});
test('catalog: colours are valid hex and patterns are known', () => {
  const patterns = new Set(['solid', 'stripe', 'check', 'block', 'denim', 'twill']);
  for (const it of all) {
    assert.ok(patterns.has(it.pattern), `${it.id} pattern`);
    assert.ok(it.colors.length >= 1);
    for (const c of it.colors) {
      assert.match(c.base, /^#[0-9a-f]{6}$/i);
      if (c.accent) assert.match(c.accent, /^#[0-9a-f]{6}$/i);
    }
    assert.equal(it.ci, 0);
  }
});
test('catalog: fitting options stay in sane ranges', () => {
  for (const [type, o] of Object.entries(OPTS)) {
    assert.ok(o.len >= 0 && o.len <= 1.2, `${type} len`);
    assert.ok(o.sleeve >= 0 && o.sleeve <= 2, `${type} sleeve`);
    assert.ok(o.flare >= 0 && o.flare <= 0.6, `${type} flare`);
  }
});
