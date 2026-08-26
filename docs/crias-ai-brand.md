# CRIAs AI brand system

CRIAs AI uses a restrained dark workspace and the Jade Horizon palette.

| Token | Value | Purpose |
| --- | --- | --- |
| Jade light | `#B7E5BA` | luminous brand surfaces and chart range |
| Jade medium | `#5CA87C` | secondary states and data series |
| Jade accent | `#288760` | actions, focus, links, selection, and progress |
| Jade deep | `#1A5140` | tinted surfaces and high-contrast brand fields |
| Background | `#181818` | primary dark workspace |
| Surface | `#212121` | cards and panels |

The owner-facing product name is **CRIAs AI**. Stable internal identifiers remain unchanged so upgrades preserve sessions, VPN profiles, phone pairing, permissions, and controller compatibility. That includes the bundle ID, `LOCAL_STUDIO_*` environment variables, API routes, and the existing macOS user-data directory.

The source assets are:

- `frontend/public/icons/crias-ai-mark.svg` for vector brand work;
- `frontend/desktop/resources/crias-ai-icon.png` and `icon.icns` for macOS;
- `frontend/public/icons/apple-touch-icon.png`, `icon-192.png`, and `icon-512.png` for the PWA;
- `frontend/src/app/favicon.ico` for browser chrome.

Use the same macOS icon composition for the Dock, Finder, notifications, favicon, and PWA. Use the transparent vector mark for documents. Do not reconstruct the dot pattern, stretch it, add per-dot shadows, or replace semantic warning/error colors with Jade.

The full working brand kit is mirrored under `iCloud Drive/CRIAs IA`, including the received AI, PNG, and SVG originals, transparent artwork, macOS icon, and usage guidance. Its repository copy lives under a `.nosync` directory so iCloud does not attempt to synchronize development dependencies.
