import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWidgetParams, buildEmbedUrl, validateWidgetConfig, cropRectFor34 } from '../widget/config.js';

test('widget: params parse from a query string', () => {
  const c = parseWidgetParams('?image=https%3A%2F%2Fshop.com%2Ftee.jpg&name=Everyday+tee&price=Rs+1%2C450');
  assert.equal(c.image, 'https://shop.com/tee.jpg');
  assert.equal(c.name, 'Everyday tee');
  assert.equal(c.price, 'Rs 1,450');
  assert.equal(c.url, '');
});

test('widget: embed URL carries only the set params, encoded', () => {
  const u = buildEmbedUrl('https://x.test/widget/embed.html',
    { image: 'https://shop.com/tee.jpg', name: 'Tee & co', price: '', url: '', token: '', space: '' });
  assert.equal(u, 'https://x.test/widget/embed.html?image=https%3A%2F%2Fshop.com%2Ftee.jpg&name=Tee+%26+co');
});

test('widget: missing or bad product photo is rejected', () => {
  assert.match(validateWidgetConfig({ image: '' }), /data-image/);
  assert.match(validateWidgetConfig({ image: 'not a url' }), /not valid/);
  assert.match(validateWidgetConfig({ image: 'ftp://x.test/a.jpg' }), /http\(s\)/);
  assert.equal(validateWidgetConfig({ image: 'https://shop.com/tee.jpg' }), '');
});

test('widget: 3:4 crop is centered and never exceeds the photo', () => {
  for (const [w, h] of [[800, 1200], [1200, 800], [1000, 1000], [300, 500]]) {
    const r = cropRectFor34(w, h);
    assert.ok(r.sw <= w && r.sh <= h, `${w}x${h}`);
    assert.ok(Math.abs(r.sw / r.sh - 0.75) < 0.02, `${w}x${h} is 3:4`);
    assert.equal(r.sx, Math.round((w - r.sw) / 2));
    assert.equal(r.sy, Math.round((h - r.sh) / 2));
  }
});
