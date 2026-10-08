// Pure helpers for the Drape embed widget. No DOM, no network. Tested in Node.
//
// A store embeds the try-on with a snippet:
//
//   <script src="https://<host>/drape-fitting-room/widget/drape-widget.js"
//     data-image="https://shop.com/products/tee.jpg"
//     data-name="Everyday tee"
//     data-price="Rs 1,450"
//     data-url="https://shop.com/products/everyday-tee"></script>
//
// The loader opens widget/embed.html?image=...&name=... in a modal iframe.

/** Parse an embed.html query string into a widget config. */
export function parseWidgetParams(search) {
  const s = search.startsWith('?') ? search : '?' + search;
  const q = new URLSearchParams(s);
  const pick = k => (q.get(k) || '').trim();
  return {
    image: pick('image'),
    name: pick('name'),
    price: pick('price'),
    url: pick('url'),
    token: pick('token'),
    space: pick('space'),
  };
}

/** Build the embed.html URL for a config. `base` is the embed.html URL without a query. */
export function buildEmbedUrl(base, cfg) {
  const q = new URLSearchParams();
  for (const k of ['image', 'name', 'price', 'url', 'token', 'space']) {
    if (cfg[k]) q.set(k, cfg[k]);
  }
  const s = q.toString();
  return s ? base + (base.includes('?') ? '&' : '?') + s : base;
}

/** '' when the widget can run, otherwise a human-readable reason it cannot. */
export function validateWidgetConfig(cfg) {
  if (!cfg.image) return 'Add data-image="..." with the product photo URL.';
  try {
    const u = new URL(cfg.image);
    if (!/^https?:$/.test(u.protocol)) return 'Product photo URL must start with http(s).';
  } catch {
    return 'Product photo URL is not valid.';
  }
  return '';
}

/** Center 3:4 crop rect for a photo of w by h pixels (the try-on model wants 3:4). */
export function cropRectFor34(w, h) {
  let cw = w, ch = (w * 4) / 3;
  if (ch > h) { ch = h; cw = (h * 3) / 4; }
  return { sx: Math.round((w - cw) / 2), sy: Math.round((h - ch) / 2), sw: Math.round(cw), sh: Math.round(ch) };
}
