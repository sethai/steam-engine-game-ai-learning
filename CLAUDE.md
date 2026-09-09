# Steam Engine Survival

A browser-based physics/balancing survival game. Full game design is in
`docs/GAME_DESIGN.md` — read that file before implementing or changing any
gameplay mechanic, and keep it updated if mechanics change during development.

## Tech stack (v1 — web)
- Plain HTML5 + CSS + vanilla JavaScript (ES modules). No framework, no build tool,
  no npm dependencies for v1 — keep it runnable by just opening `src/index.html`
  or serving the folder with any static server.
- Rendering: HTML5 Canvas for gauges/dials, or DOM+CSS if simpler — decide during
  implementation, note the choice here once made.
- No backend. Everything runs client-side. No user accounts, no persistence beyond
  `localStorage` if we add high scores later.

This is intentionally minimal so a beginner (me) can read every line, and so a
future port to iOS/Swift has a clean, dependency-light reference implementation
to translate from.

## Project structure
```
steam-engine-game/
├── CLAUDE.md              # this file
├── README.md              # human-facing project overview
├── docs/
│   └── GAME_DESIGN.md      # mechanics, physics model, roadmap — source of truth
├── src/
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── main.js         # entry point, game loop
│       ├── simulation.js   # physics/state update logic (pure functions, no DOM)
│       └── ui.js            # rendering gauges, handling input
├── assets/                  # images/sounds if/when added
└── tests/                   # test files, if/when added
```

## Code conventions
- Keep simulation logic (`simulation.js`) free of DOM/rendering code, so it can be
  unit-tested and later reused if we port to another platform.
- Use plain, readable JS — no clever one-liners. This project is a learning vehicle.
- Comment *why*, not *what*, especially around the physics constants — link back to
  the relevant section of `docs/GAME_DESIGN.md`.
- Prefer small, focused commits. After each meaningful change, propose a commit
  message rather than leaving changes uncommitted.

## How to run
Open `src/index.html` directly in a browser, or serve the folder locally, e.g.:
```
npx serve src
```
(No build step in v1 — if we later add a bundler, update this section.)

## Working agreement
- This is a learning project for the human. Before making non-trivial changes,
  briefly explain the approach/plan first rather than silently writing a lot of code.
- Prefer proposing a plan for anything that touches the physics model or adds a new
  file, and wait for confirmation before large refactors.
- Constants in the physics model are placeholders (see GAME_DESIGN.md) — expect to
  tune them iteratively; don't treat them as fixed requirements.
- Out of scope for now: upgrades, roguelike meta-loop, random events, multiple
  fuel types. Don't build these unless explicitly asked — v1 is the core survival
  loop only.
