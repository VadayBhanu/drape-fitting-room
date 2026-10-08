/* Drape embed widget loader. Paste on any product page:
 *
 *   <script src="https://<host>/drape-fitting-room/widget/drape-widget.js"
 *     data-image="https://shop.com/products/tee.jpg"
 *     data-name="Everyday tee"
 *     data-price="Rs 1,450"
 *     data-url="https://shop.com/products/everyday-tee"></script>
 *
 * data-image is required. data-name falls back to og:title, data-url to the
 * canonical URL (or page URL). Renders a "Try it on" button where the script
 * tag sits (or inside the element matched by data-target) and opens the
 * try-on in a modal. Also: <button data-drape-tryon data-image="...">Try it on</button>
 * and window.DrapeWidget.open({...}).
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var script = document.currentScript;
  var overlay = null;

  function embedBase() {
    try { return new URL('embed.html', script.src).href; }
    catch (e) { return 'embed.html'; }
  }

  function meta(prop) {
    var m = document.querySelector('meta[property="' + prop + '"]');
    return m ? (m.getAttribute('content') || '').trim() : '';
  }

  function readConfig(el) {
    var d = (el && el.dataset) || (script && script.dataset) || {};
    var canonical = document.querySelector('link[rel="canonical"]');
    return {
      image: (d.image || meta('og:image') || '').trim(),
      name: (d.name || meta('og:title') || document.title || '').trim(),
      price: (d.price || '').trim(),
      url: (d.url || (canonical && canonical.href) || location.href || '').trim(),
      token: (d.token || '').trim(),
      space: (d.space || '').trim(),
      label: (d.label || '').trim(),
    };
  }

  function configError(cfg) {
    if (!cfg.image) return 'Drape: data-image with the product photo URL is required.';
    try {
      var u = new URL(cfg.image);
      if (!/^https?:$/.test(u.protocol)) return 'Drape: data-image must be an http(s) URL.';
    } catch (e) { return 'Drape: data-image is not a valid URL.'; }
    return '';
  }

  function embedUrl(cfg) {
    var q = [];
    ['image', 'name', 'price', 'url', 'token', 'space'].forEach(function (k) {
      if (cfg[k]) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(cfg[k]));
    });
    return embedBase() + (q.length ? '?' + q.join('&') : '');
  }

  function buttonStyle() {
    return 'display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:0;border-radius:999px;' +
      'padding:12px 22px;font:600 15px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'color:#fff;background:linear-gradient(135deg,#7c3aed,#db2777);box-shadow:0 6px 20px rgba(124,58,237,.35);';
  }

  function makeButton(cfg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'drape-tryon-btn';
    b.setAttribute('style', buttonStyle());
    var svg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.4 14.5 16 10 4 20l4 4h12a1 1 0 0 0 1-1v-8.5z"/><path d="m16 10 3.1-3.1a2 2 0 0 1 0-2.8l-1.3-1.3a2 2 0 0 0-2.8 0L12 6"/></svg>';
    b.innerHTML = svg + '<span>' + escapeHtml(cfg.label || 'Try it on') + '</span>';
    b.addEventListener('click', function () { open(cfg); });
    return b;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function open(raw) {
    var cfg = raw || readConfig();
    var err = configError(cfg);
    if (err) { if (window.console) console.warn(err); return; }
    close();
    overlay = document.createElement('div');
    overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;' +
      'align-items:center;justify-content:center;background:rgba(10,4,14,.72);' +
      'backdrop-filter:blur(6px);padding:16px;box-sizing:border-box;');
    var frame = document.createElement('div');
    frame.setAttribute('style', 'position:relative;width:min(460px,100%);height:min(880px,100%);' +
      'border-radius:20px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.5);background:#1d0f1e;');
    var iframe = document.createElement('iframe');
    iframe.src = embedUrl(cfg);
    iframe.title = 'Drape virtual try-on';
    iframe.setAttribute('style', 'border:0;width:100%;height:100%;display:block;background:#1d0f1e;');
    iframe.setAttribute('allow', 'camera');
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close try-on');
    x.setAttribute('style', 'position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:50%;' +
      'border:0;background:rgba(0,0,0,.55);color:#fff;font-size:18px;line-height:1;cursor:pointer;z-index:2;');
    x.textContent = '\u00d7';
    x.addEventListener('click', close);
    frame.appendChild(iframe);
    frame.appendChild(x);
    overlay.appendChild(frame);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }

  window.DrapeWidget = { open: open, close: close, version: VERSION };

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'drape:tryon' && d.event === 'close') close();
  });

  function init() {
    // Declarative buttons: <button data-drape-tryon data-image="...">Try it on</button>
    var els = document.querySelectorAll('[data-drape-tryon]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.addEventListener('click', function () { open(readConfig(el)); });
      })(els[i]);
    }
    // Snippet mode: render the button where the script tag sits.
    if (script && !script.dataset.manual) {
      var cfg = readConfig();
      var err = configError(cfg);
      if (err) { if (window.console) console.warn(err + ' Button not rendered.'); return; }
      var btn = makeButton(cfg);
      var target = script.dataset.target ? document.querySelector(script.dataset.target) : null;
      if (target) target.appendChild(btn);
      else if (script.parentNode) script.parentNode.insertBefore(btn, script.nextSibling);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
