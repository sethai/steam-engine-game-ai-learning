# Steam Engine Survival — Game Design Doc (v1 scope)

## One-line pitch
Keep an old steam machine running as long as possible by balancing water and coal
input against a pressure gauge that will kill you if it goes too low (stall) or
too high (explosion).

Inspired by an old Atari 8-bit game the designer half-remembers — mechanic reconstructed
from scratch, not a clone.

## Core loop (v1 — no meta-game yet)
1. Player has a **water supply** and a **coal supply**, both finite, both drain as used.
2. Player adds water and/or coal to the boiler at will (button press / keypress).
3. The simulation updates every tick (physics below).
4. Player watches four gauges: boiler water level, temperature, pressure, and remaining
   supply of each resource.
5. Game ends when: pressure exceeds max (explosion), temperature exceeds max (meltdown),
   or the player runs out of both supplies AND pressure drops to zero (starvation).
6. Score = survival time in seconds.

Deliberately OUT of v1 scope: currency, upgrades, roguelike runs, random events,
different fuel types, multiple machine parts. These come after the core loop is proven fun.

## State variables

| Variable | Range | Meaning |
|---|---|---|
| `waterSupply` | 0–100 (units) | Water left in the external tank, player-refillable in real life but fixed per run in-game |
| `coalSupply` | 0–100 (units) | Coal left in the external bin |
| `boilerWater` | 0–100 (%) | Water currently inside the boiler |
| `temperature` | 0–300 (°C) | Boiler temperature |
| `pressure` | 0–15 (bar) | Steam pressure — the main "are you alive" gauge |
| `elapsedTime` | seconds | Score |

## Player actions
- **Add water** — moves a chunk of `waterSupply` into `boilerWater` (instant or short delay,
  decide by feel in playtesting)
- **Add coal** — consumes a chunk of `coalSupply`, increases coal currently burning
  (coal burns down over time rather than being an instant temperature jump)
- Both actions are rate-limited (a cooldown) so the player can't spam-correct instantly —
  this is what makes it a *balancing* game and not a solved reflex-check.

## Physics model (first pass — expect to tune by playtesting)

Run this update once per tick (e.g. every 200ms, or per animation frame with delta time):

```
// Heat generation
heatFromCoal = burningCoalRate * COAL_HEAT_CONSTANT

// Heat loss: water absorbs/moderates heat; too little water = poor heat absorption
// (spikes temperature), too much water = over-cooling (suppresses temperature)
if boilerWater < LOW_WATER_THRESHOLD:
    heatLoss = LOW_HEAT_LOSS        // little moderation -> temperature swings up fast
else if boilerWater > HIGH_WATER_THRESHOLD:
    heatLoss = HIGH_HEAT_LOSS       // excess water cools the system
else:
    heatLoss = NORMAL_HEAT_LOSS

temperature += (heatFromCoal - heatLoss) * deltaTime
temperature = clamp(temperature, 0, MAX_TEMP)

// Steam production: needs BOTH adequate temperature AND adequate water.
// Peaks in a "sweet spot" band for each.
steamRate = steamCurve(temperature) * waterAvailabilityCurve(boilerWater)

pressure += (steamRate - VENT_RATE - leakage) * deltaTime
pressure = clamp(pressure, 0, MAX_PRESSURE)

// boilerWater is consumed by steam production
boilerWater -= steamRate * WATER_CONSUMPTION_RATE * deltaTime

// End conditions
if pressure >= MAX_PRESSURE: gameOver("explosion")
if temperature >= MAX_TEMP: gameOver("meltdown")
if waterSupply <= 0 and coalSupply <= 0 and pressure <= 0: gameOver("starvation")
```

`steamCurve` and `waterAvailabilityCurve` should be bell-shaped (low at the extremes,
peak in a "safe operating band" in the middle) — that's what creates the "too little OR
too much is bad" tension you described for both water and coal. Exact numbers are tuning,
not design — expect to playtest and adjust constants rather than get them right up front.

## Win/lose framing
There's no "win" in v1 — it's an endless-survival high-score loop, which matches your
"try to make the machine work as long as possible" framing. A clear, readable death
screen (cause of death + survival time) is important for the loop to feel good.

## Controls (v1, web/keyboard+mouse)
- Click/tap "Add Water" button (or `W` key)
- Click/tap "Add Coal" button (or `C` key)
- Gauges rendered as simple bars or dials on an HTML5 canvas

## Roadmap (post-v1, not built yet)
- Gold earned per run based on survival time
- Meta-progression: upgrade pressure tolerance band, durability, storage capacity,
  better fuel types
- Random events (e.g. sudden cold draft, coal shortage delivery)
- Roguelike run structure (die → shop → next run)

## Open questions to resolve during build
- Exact numeric constants (all placeholders above — tune by playtesting)
- Tick rate / whether to use fixed timestep or real delta time
- Visual style (gauges/dials vs. bars vs. something more thematic)
