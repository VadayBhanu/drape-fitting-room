// Photo-real try-on. Sends a photo of the person and the garment to a virtual try-on
// model (IDM-VTON on Hugging Face by default) and returns an image of them wearing it.
// This is the ONLY place the app sends images off the device, and only when the person
// presses "Start real fit".

export const GRADIO_CLIENT = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.5.1/dist/browser.js';
export const DEFAULT_SPACE = 'yisol/IDM-VTON';

/** 3:4 crop around the person (IDM-VTON works at 768x1024). bbox in pixels. */
export function cropBoxForPerson(bbox, W, H, margin = 0.12) {
  const bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0;
  let h = bh * (1 + margin * 2), w = h * 3 / 4;
  if (w < bw * (1 + margin * 2)) { w = bw * (1 + margin * 2); h = w * 4 / 3; }
  if (h > H) { h = H; w = h * 3 / 4; }
  if (w > W) { w = W; h = Math.min(H, w * 4 / 3); }
  const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
  const x = Math.max(0, Math.min(W - w, cx - w / 2));
  const y = Math.max(0, Math.min(H - h, cy - h / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Plain-language message for a failed request. */
export function explainError(err) {
  const m = String(err?.message || err || '');
  if (/quota|ZeroGPU|exceeded|limit/i.test(m)) return 'The free GPU quota ran out. Add a Hugging Face token in the settings below, or try again later.';
  if (/sleep|paused|building|not running|503/i.test(m)) return 'The try-on service is waking up or busy. Try again in a minute.';
  if (/fetch|network|Failed to/i.test(m)) return 'Could not reach the try-on service. Check your connection and try again.';
  return 'The try-on did not finish: ' + m.slice(0, 160);
}

let clientPromise = null, clientKey = '';
async function getClient(space, token) {
  const key = space + '|' + (token ? 'tok' : '');
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    clientPromise = import(GRADIO_CLIENT).then(({ Client }) => Client.connect(space, token ? { token } : {}));
  }
  return clientPromise;
}

/**
 * @param {object} o
 * @param {Blob} o.person   JPEG of the person (3:4)
 * @param {Blob|string} o.garment  garment image, or a public image URL (the service downloads it)
 * @returns {Promise<string>} URL of the result image
 */
export async function runTryOn({ person, garment, description = 'a garment', space = DEFAULT_SPACE, token = '', onStatus = () => {} }) {
  const { handle_file } = await import(GRADIO_CLIENT);
  const client = await getClient(space, token);
  onStatus('Queued');
  const job = client.submit('/tryon', [
    { background: handle_file(person), layers: [], composite: null },
    handle_file(garment),
    description || 'a garment',
    true,   // auto mask
    false,  // auto crop (we already crop)
    30,     // denoising steps
    42,     // seed
  ]);
  for await (const msg of job) {
    if (msg.type === 'status') {
      if (msg.stage === 'error') throw new Error(msg.message || 'error');
      if (msg.queue && msg.position != null) onStatus(`In queue, position ${msg.position + 1}`);
      else if (msg.stage === 'pending') onStatus('Generating');
    }
    if (msg.type === 'data') {
      const out = msg.data?.[0];
      const url = typeof out === 'string' ? out : out?.url;
      if (!url) throw new Error('no image returned');
      return url;
    }
  }
  throw new Error('no result');
}
