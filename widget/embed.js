// Drape embed widget: photo-based try-on for a store product page.
// Reads ?image=&name=&price=&url=&token=&space=, uploads the shopper's photo,
// runs the AI try-on on that garment, and shows a before/after slider.
import { parseWidgetParams, validateWidgetConfig, cropRectFor34 } from './config.js';
import { runTryOn, explainError, DEFAULT_SPACE } from '../src/realfit.js';

const $ = s => document.querySelector(s);
const TOKEN_KEY = 'drape-hf-token';

const cfg = parseWidgetParams(location.search);
const space = cfg.space || DEFAULT_SPACE;
const fatal = validateWidgetConfig(cfg);

let personBlob = null, personUrl = null, resultUrl = null;

function post(event, extra) {
  try { window.parent.postMessage(Object.assign({ type: 'drape:tryon', event }, extra || {}), '*'); }
  catch { /* standalone page */ }
}

function show(id) {
  for (const s of ['pickState', 'workState', 'doneState', 'errState']) $('#' + s).hidden = s !== id;
}

function init() {
  $('#pName').textContent = cfg.name || 'Try it on';
  $('#pPrice').textContent = cfg.price || '';
  if (cfg.image) { $('#pThumb').src = cfg.image; $('#pThumb').alt = cfg.name || 'Product'; }
  if (cfg.url) { const b = $('#buyBtn'); b.href = cfg.url; b.hidden = false; }
  if (window.self === window.top) $('#closeBtn').hidden = true;
  const saved = localStorage.getItem(TOKEN_KEY) || '';
  if (cfg.token) localStorage.setItem(TOKEN_KEY, cfg.token);
  $('#tokenInput').value = localStorage.getItem(TOKEN_KEY) || '';

  if (fatal) {
    $('#errText').textContent = fatal;
    show('errState'); $('#retryBtn').hidden = true; $('#goBtn').disabled = true;
    return;
  }
  post('opened', { name: cfg.name });
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('read')); };
    img.src = url;
  });
}

/** Downscale the photo to a 3:4 JPEG blob the try-on model expects. */
async function prepPhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    const r = cropRectFor34(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const scale = Math.min(1, 768 / r.sw);
    const c = document.createElement('canvas');
    c.width = Math.round(r.sw * scale); c.height = Math.round(r.sh * scale);
    c.getContext('2d').drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('#photoInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  e.target.value = '';
  try {
    personBlob = await prepPhoto(f);
    if (personUrl) URL.revokeObjectURL(personUrl);
    personUrl = URL.createObjectURL(personBlob);
    $('#preview').src = personUrl;
    show('workState');
    $('#goBtn').disabled = false;
    $('#goBtn').textContent = 'Try it on';
    post('photo-ready');
  } catch {
    $('#errText').textContent = 'Could not read that photo. Try another one.';
    show('errState'); $('#retryBtn').hidden = false;
  }
});

$('#dropZone').addEventListener('dragover', e => e.preventDefault());
$('#dropZone').addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) { const dt = new DataTransfer(); dt.items.add(f); $('#photoInput').files = dt.files; $('#photoInput').dispatchEvent(new Event('change')); }
});

$('#goBtn').addEventListener('click', async () => {
  if (!personBlob || $('#goBtn').disabled) return;
  const btn = $('#goBtn'); btn.disabled = true; btn.textContent = 'Working…';
  $('#statusText').textContent = 'Starting…';
  show('workState');
  post('started');
  try {
    const token = ($('#tokenInput').value || '').trim();
    if (token) localStorage.setItem(TOKEN_KEY, token);
    resultUrl = await runTryOn({
      person: personBlob,
      garment: cfg.image,
      description: cfg.name || 'a garment',
      space,
      token,
      onStatus: t => { $('#statusText').textContent = t; },
    });
    $('#beforeImg').src = personUrl;
    $('#afterImg').src = resultUrl;
    setSlider(50);
    show('doneState');
    btn.textContent = 'Try it on';
    post('done');
  } catch (err) {
    $('#errText').textContent = explainError(err);
    show('errState'); $('#retryBtn').hidden = false;
    btn.disabled = false; btn.textContent = 'Try it on';
    post('error', { message: String((err && err.message) || err).slice(0, 200) });
  }
});

function setSlider(v) {
  $('#baSlider').value = v;
  $('#beforeWrap').style.width = v + '%';
}
$('#baSlider').addEventListener('input', e => setSlider(+e.target.value));

$('#againBtn').addEventListener('click', () => {
  personBlob = null; resultUrl = null;
  $('#goBtn').disabled = true; $('#goBtn').textContent = 'Try it on';
  show('pickState');
});

$('#retryBtn').addEventListener('click', () => {
  $('#retryBtn').hidden = false;
  show(personBlob ? 'workState' : 'pickState');
});

$('#saveBtn').addEventListener('click', () => {
  if (!resultUrl) return;
  const a = document.createElement('a');
  a.href = resultUrl; a.download = 'drape-tryon.jpg'; a.target = '_blank'; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
});

$('#buyBtn').addEventListener('click', () => post('buy', { url: cfg.url }));
$('#closeBtn').addEventListener('click', () => post('close'));
$('#tokenInput').addEventListener('change', e => localStorage.setItem(TOKEN_KEY, e.target.value.trim()));

init();
