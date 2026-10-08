# Drape: a live fitting room

Try clothes on through your camera, from any shop or your gallery, then turn and move to see how they fit.

## Two ways to try on

**Live fit (real time, on your device)**
- Recognises you and guides you into frame.
- Any clothing photo is cut out and warped onto your body as a mesh: the torso follows your shoulders and hips, sleeves bend with your arms, trousers follow your legs.
- Clothes are shaped to your body outline (body segmentation) and your hands stay in front of them.
- When you turn, the garment narrows and the far side falls into shadow. Long hems swing as you move.
- Move test, beat, size estimate, snapshot, bag, and Float mode (desktop Chrome/Edge).

**Real fit (photo-real, AI)**
- Takes three photos as you turn: front, half-turn, side.
- Sends each, with the clothing photo, to a virtual try-on model (IDM-VTON on Hugging Face by default) and shows you wearing it from each angle, with a slider to turn around.
- Works with any product photo, including ones worn by a model.
- Uses Hugging Face's free GPU queue: about 30-90 seconds per view. Add your own Hugging Face token in Real fit settings to raise the daily limit. Upper-body clothes give the best results with the default model.

## Picking clothes from anywhere

- **From gallery**: any saved photo.
- **Paste**: on a shop page (Amazon or any site) right-click or long-press the clothing photo, choose Copy image, then Paste in Drape (or Ctrl+V).
- **Link**: paste an image link. Some sites block live preview of their images; Real fit can still use the link because the try-on service downloads it.
- **Share (Android)**: install Drape from the browser menu, then use Share, Drape from your gallery or browser.

Product pages themselves can't be read automatically (shops block it), so copy the photo rather than the page link.

## Privacy

Live fit never sends video anywhere. Real fit sends the three captured photos and the clothing photo to the try-on Space you choose, only after you press Start real fit. A Hugging Face token you enter is stored only in your browser.

## Run locally

```bash
npm install
npm start          # http://localhost:3000  (or: python3 -m http.server 3000)
```

The camera only works on `https://` or `localhost`, so open it through the server, not by double-clicking the file.

## Test

```bash
npm run check      # lint + unit tests
npm test           # unit tests only
```

Tests use synthetic body poses and synthetic garment shapes to check: positioning prompts (with mirrored left/right), body geometry, every move-test pose, size thresholds, the hem spring, reading a garment photo (sleeves, sleeveless, long dress, trousers), the mesh warp (exact corner mapping, sleeves joined to the torso, sleeves following raised and spread arms, the correct arm per side, narrowing when turning, shorts vs trouser length), real-fit cropping and error messages, the share target, and that every element and button the script uses exists.

## Deploy to GitHub Pages

1. Create a new GitHub repository and push this folder to the `main` branch:
   ```bash
   git init && git add . && git commit -m "Drape fitting room"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the tests, then publishes. Your site appears at `https://<you>.github.io/<repo>/`.

Any push to `main` re-runs tests and redeploys. A failing test blocks the deploy.

## Project layout

```
index.html          page markup
styles.css          styles (dark fitting-room look, mobile rules)
src/main.js         camera, tracking, drawing, UI
src/geometry.js     pure logic: body frame, positioning, sizing, move checks, hem spring
src/catalog.js      products on the rail (replace with your store's feed)
src/garment.js      cut out a clothing photo and find torso, sleeves, hem, legs
src/warp.js         triangle-mesh warp of the photo onto the body, turning
src/realfit.js      photo-real try-on through a Hugging Face Space
sw.js, manifest     installable app + "Share to Drape"
widget/             embeddable store widget: loader snippet + try-on page
tests/              node:test unit tests
```

## Adding your products

Edit `src/catalog.js`. Each item needs an `id`, `name`, `price`, a `type` (`tee`, `kurta`, `jacket`, `dress` for tops, `pants` for bottoms), a `pattern` (`solid`, `stripe`, `check`, `block`, `denim`, `twill`) and one or more `colors`. Run `npm test` after editing; the catalogue tests catch typos.

## Embed on your store

Drop the try-on on any product page (Shopify, WooCommerce, plain HTML).
Full docs in `widget/README.md`:

```html
<script src="https://<your-host>/drape-fitting-room/widget/drape-widget.js"
  data-image="https://your-shop.com/products/everyday-tee.jpg"
  data-name="Everyday tee"
  data-price="Rs 1,450"
  data-url="https://your-shop.com/products/everyday-tee"></script>
```

Shoppers upload their photo, the AI drapes that product on them, and they get
a before/after slider with a Buy button. Or link straight to a per-product
try-on: `widget/embed.html?image=…&name=…&price=…&url=…`.

## Limits

Live fit is a 2D warp of a photo, so it can't show the back of a garment, and very loose or layered clothes won't drape like real fabric. Real fit is photo-real but takes seconds per image, not live video, and depends on the free Space being available. Size estimates are approximate.
