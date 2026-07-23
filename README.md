# Neon Drift

**The city moves with you.**

Neon Drift is a portrait-first endless runner prototype built around one action: spend rechargeable Drift energy to transform the road before a reality gate reaches you. The game runs in a responsive canvas with React-powered menus and local progression.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. To verify a production build:

```bash
npm run build
npm test
```

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move | Swipe left/right or tap arrow controls | Left/Right arrows or A/D |
| Jump | Swipe up or tap ↑ | Up arrow, W, or Space |
| Slide | Swipe down | Down arrow or S |
| Drift | Tap the DRIFT control | Shift or E |
| Pause | Pause button | Escape or P |

## Gameplay loop

- Run automatically and move between three lanes.
- Jump coral barriers, slide under overhead gates, and collect cyan shards.
- Watch for violet transformation gates and trigger Drift before crossing them.
- Clean obstacle passes, near misses, and successful transformations raise the Flow multiplier.
- Speed rises throughout the run. A collision ends the run and offers an immediate retry.

The first section favors shard trails and readable movement choices before introducing rotating-road, shifting-platform, and portal transformation modules.

## Project structure

```text
app/
  game-config.ts    Tunable movement, scoring, accessibility, and skin values
  neon-drift.tsx    Game loop, renderer, input, audio hooks, UI, and persistence
  globals.css       Portrait layout, HUD, menus, effects, and responsive styling
  page.tsx          Application entry
  layout.tsx        Metadata and mobile viewport configuration
tests/
  rendered-html.test.mjs
```

The gameplay implementation is organized internally into input, procedural spawning, movement, collision, scoring, rendering/effects, audio, and persistence sections. Frequently spawned entities and particles use compact reusable arrays; procedural modules are assembled from deterministic choices and cleared after leaving the track.

## Adding content

- Add or tune balancing values in `app/game-config.ts`.
- Add handcrafted obstacle modules in `spawnModule()` in `app/neon-drift.tsx`.
- Add a transformation pattern to the gate pattern list, its renderer branch, and its successful-crossing response.
- Replace the procedural `ToneBank` sounds with production audio without changing game event calls (`collect`, `jump`, `land`, `drift`, `hit`, `ui`).
- Future leaderboards, cloud saves, and event passes should consume the final run result and persisted `Progress` shape; no backend is required by this prototype.

## Persistence and accessibility

Best score, lifetime distance, shards, selected/unlocked skins, achievements, audio levels, reduced shake, reduced effects, high-contrast hazards, and haptics preferences are stored in `localStorage`. The game pauses when its tab loses focus and respects the operating system’s reduced-motion preference.
