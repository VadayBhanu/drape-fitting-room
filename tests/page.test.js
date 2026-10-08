import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('page: every element the script looks up exists in index.html', () => {
  const ids = [...main.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(ids.length > 10);
  for (const id of new Set(ids)) assert.match(html, new RegExp(`id="${id}"`), `#${id} missing`);
});
test('page: every toolbar and move-card action is handled', () => {
  const acts = [...html.matchAll(/data-act="(\w+)"/g)].map(m => m[1]);
  for (const a of new Set(acts)) assert.match(main, new RegExp(`act==='${a}'`), `${a} not handled`);
});
test('page: linked local files exist', () => {
  for (const f of ['styles.css', 'src/main.js', 'src/geometry.js', 'src/catalog.js', 'src/garment.js', 'src/warp.js', 'src/realfit.js', 'sw.js', 'manifest.webmanifest'])
    assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
  assert.match(html, /<script type="module" src="src\/main\.js">/);
});
test('page: mobile viewport is set and CDN versions are pinned', () => {
  assert.match(html, /name="viewport"[^>]+width=device-width/);
  const urls = [...main.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/(@[\w-]+\/[\w.-]+@[\w.-]+|[\w.-]+@[\w.-]+|[^"\s]+)/g)].map(m => m[1]);
  assert.ok(urls.length > 0);
  for (const u of urls) assert.match(u, /@\d+\.\d+\.\d+$/, `unpinned: ${u}`);
});
test('page: photos leave the device only through real fit, started by its button', () => {
  assert.doesNotMatch(main, /method:\s*['"]POST/i);
  assert.doesNotMatch(main, /XMLHttpRequest|sendBeacon/);
  const calls = [...main.matchAll(/runTryOn\(/g)].length;
  assert.equal(calls, 1, 'runTryOn called in one place');
  assert.match(main, /\$\('#rfBtn'\)\.onclick = startRealFit/);
});

test('page: installable app can receive shared photos', () => {
  const man = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(man.share_target.action, './share');
  assert.ok(man.share_target.params.files[0].accept.includes('image/*'));
  for (const i of man.icons) assert.ok(existsSync(new URL('../' + i.src, import.meta.url)), i.src);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /endsWith\('\/share'\)/);
  assert.match(main, /register\('\.\/sw\.js'\)/);
});
