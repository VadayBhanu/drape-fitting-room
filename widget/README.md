# Drape embed widget

Put a "Try it on" button on any product page. The shopper uploads their photo,
the AI drapes that product on them, and they get a before/after slider plus a
Buy button back to the product. Works on Shopify (custom liquid / app embed
block), WooCommerce, or plain HTML. No build step; the widget is static files.

## Snippet

```html
<script src="https://<your-host>/drape-fitting-room/widget/drape-widget.js"
  data-image="https://your-shop.com/products/everyday-tee.jpg"
  data-name="Everyday tee"
  data-price="Rs 1,450"
  data-url="https://your-shop.com/products/everyday-tee"></script>
```

Place it where the button should appear. Only `data-image` is required:
`data-name` falls back to the page's `og:title`, `data-url` to the canonical
URL (or page URL).

| Attribute     | Purpose                                              |
|---------------|------------------------------------------------------|
| `data-image`  | Product photo URL the try-on service downloads (required) |
| `data-name`   | Product name shown in the widget                      |
| `data-price`  | Price shown in the widget                             |
| `data-url`    | Buy button target                                     |
| `data-token`  | Hugging Face token to raise the free daily limit      |
| `data-space`  | Override the try-on Space (default `yisol/IDM-VTON`)  |
| `data-label`  | Button text (default "Try it on")                     |
| `data-target` | CSS selector: render the button inside that element   |
| `data-manual` | Don't auto-render; open via `DrapeWidget.open({...})` |

Prefer your own button? `<button data-drape-tryon data-image="…">Try it on</button>`
anywhere on the page — the loader wires it up. Or call it from your theme:

```js
DrapeWidget.open({ image: '…', name: '…', price: '…', url: '…' });
```

## Direct link

The try-on also works as a plain link (handy for Instagram DMs):

```
https://<your-host>/drape-fitting-room/widget/embed.html?image=…&name=…&price=…&url=…
```

## How it works

1. Shopper uploads a photo (front-facing, head to feet works best). It is
   center-cropped to 3:4 in the browser.
2. The photo and the product image URL go to the configured Hugging Face
   try-on Space (`yisol/IDM-VTON` by default, ~30–90s per generation on the
   free queue). Photos leave the device only when the shopper presses
   "Try it on".
3. Result shows as a before/after slider with Save and Buy buttons.

The iframe posts `{ type: 'drape:tryon', event }` messages to the parent page
(`opened`, `photo-ready`, `started`, `done`, `error`, `buy`, `close`) for
analytics. Listen with `window.addEventListener('message', …)`.

## Limits

- Photo-real try-on depends on the free Space being up; errors are explained
  in plain language with a retry path. A Hugging Face token raises the quota.
- The product photo must be publicly downloadable by the try-on service.
- Garment realism varies by photo; upper-body garments on plain backgrounds
  do best.
