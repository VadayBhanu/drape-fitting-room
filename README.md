# Drape: a live fitting room

Try clothes on through your camera, then move in them to see how they hang.

1. **Stand in the frame.** Tape-measure guides and spoken-style prompts get your whole body in view, then it recognises you.
2. **Try things on.** Garments are fitted to 33 tracked body points every frame. Sleeves go in front of or behind the body, patterns follow your angle, and hems swing when you move. Upload your own product photo to try it on.
3. **Move in them.** A guided move test (arms up, arms out, hands on hips, turn, sway, lift a knee) with an optional beat.

Also: size estimate from your height, snapshot, bag, and a **Float** mode that keeps the mirror on top of other tabs (desktop Chrome/Edge).

Everything runs in the browser. Camera frames never leave the device.

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

Tests use synthetic body poses to check positioning prompts (including mirrored left/right), body geometry, every move-test pose, size thresholds, the hem spring, the catalogue, and that every element and button the script uses exists in the page.

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
tests/              node:test unit tests
```

## Adding your products

Edit `src/catalog.js`. Each item needs an `id`, `name`, `price`, a `type` (`tee`, `kurta`, `jacket`, `dress` for tops, `pants` for bottoms), a `pattern` (`solid`, `stripe`, `check`, `block`, `denim`, `twill`) and one or more `colors`. Run `npm test` after editing; the catalogue tests catch typos.

## Limits

Clothes are drawn as 2D shapes on top of the camera image, not simulated 3D cloth. Hands can't appear in front of a garment yet, and the size estimate is approximate.
