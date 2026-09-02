# ETA Calculator — Android / mobile web app

This is the mobile version of the ETA Calculator, built as an installable web app
(PWA) rather than a native `.apk`. It's a separate, self-contained copy of the
same calculator that lives in `../desktop-app` — editing one does not affect
the other.

## What's in this folder

- `index.html` — the whole app (same calculator logic as the desktop version,
  with the layout that already adapts to a phone-width screen).
- `manifest.json` — tells Android/Chrome the app's name, icon, and that it
  should open full-screen like a real app when installed.
- `sw.js` — a service worker that caches the app so it keeps working offline
  after the first visit.
- `icons/` — the app icon at the sizes Android needs.

## How to put this online (so people can install it)

This has to be opened through a real URL (not by double-clicking the file) —
browsers only allow "Install app" and offline caching over `http://`/`https://`,
not `file://`. The simplest free option, matching how the desktop `.exe` is
distributed:

1. Put this whole `mobile-app` folder in its own GitHub repository (or a
   `mobile` folder inside the existing one).
2. Turn on **GitHub Pages** for it: repo → Settings → Pages → set the source
   branch → save. GitHub gives you a URL like
   `https://<username>.github.io/<repo>/`.
3. Share that link.

## How someone installs it on their Android phone

1. Open the link in **Chrome**.
2. Chrome shows an **"Install app"** banner, or: tap the **⋮** menu → **"Add to
   Home screen" / "Install app"**.
3. It installs with its own icon and opens full-screen, no browser bar —
   works offline after that first visit.

## Updating it later

Edit `index.html` as needed, then bump the version number in `sw.js`
(`CACHE_NAME`, e.g. `"eta-calculator-v2"`) — that forces phones that already
installed it to pick up the new version instead of serving their old cached
copy.
