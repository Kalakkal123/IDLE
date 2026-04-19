# Idle Business Tycoon (Web Prototype)

Playable idle/tycoon prototype built with **HTML + CSS + JavaScript** and rendered in **Three.js** (Chrome).

## Run locally

Recommended (local server) - required for model loading / ES modules:

1. Open a terminal in the repo
2. Start a static server on port 8080 (pick one):
   - `py -m http.server 8080`
   - `python -m http.server 8080`
   - `npx serve -l 8080`
3. Open `http://localhost:8080`

Quick (no server):

- Open `index.html` directly in Chrome (saving may be limited on `file://`).

## How to play

- Bots automatically harvest and deliver resources to the **Port** (port storage).
- The **Ship 0** loads from port storage, travels, then returns and sells cargo for **Money**.
- Use **Buy Bot** to hire more bots and **Upgrade Ship** to increase ship capacity.
- Gems have a small random chance to drop when the ship returns.
- Unlock the **Gold Mine** with gems (requires 5 bots). Gold can be sold for money.
- Click the map to move the **Port**.
- `Shift+Click` to plant a **Tree** (wood).
- `Alt+Click` to place **Stone**.
- Pricing: Wood = `$5` each, Stone = `$12` each.

## GitHub Pages

1. Push this repo to GitHub
2. Repo Settings -> Pages -> "Deploy from a branch"
3. Select branch `main` (or `master`) and folder `/ (root)`

## Files

- `index.html` - UI + canvas
- `style.css` - styling
- `script.js` - game logic + Three.js rendering
- `assets/models/` - 3D models used in-game
