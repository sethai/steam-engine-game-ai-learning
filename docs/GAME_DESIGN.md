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

Note on "stall": the one-line pitch mentions a stall when pressure drops too low. In v1 a
brief low-pressure dip is **feedback only** — a "STALL WARNING" label shows below
`STALL_WARNING_PRESSURE`. But if the machine sits at *exactly zero* pressure for
`STALL_TIMEOUT` seconds it seizes and the run ends (reported as `starvation`). That one
rule covers both "ran the supplies dry and coasted to a stop" and "never got the engine
lit" — see "First playtest findings" for why it was added.

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
| `fireCoal` | 0+ (units) | Coal currently burning on the fire. Rises when the player stokes, burns down at `FIRE_BURN_DOWN` per second. Heat scales with it. |
| `elapsedTime` | seconds | Score |
| `zeroPressureTime` | seconds | Internal: how long `pressure` has been at zero. Drives the stall timeout; resets the instant pressure goes positive. |

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
// Fire burns itself down (so a stoke is not a one-shot temperature jump)
fireCoal = max(0, fireCoal - FIRE_BURN_DOWN * deltaTime)

// Heat generation
heatFromCoal = fireCoal * COAL_HEAT_CONSTANT

// Base heat loss: water absorbs/moderates heat; too little water = poor heat
// absorption (spikes temperature), too much water = over-cooling.
if boilerWater < LOW_WATER_THRESHOLD:
    heatLoss = LOW_HEAT_LOSS        // little moderation -> temperature swings up fast
else if boilerWater > HIGH_WATER_THRESHOLD:
    heatLoss = HIGH_HEAT_LOSS       // excess water cools the system
else:
    heatLoss = NORMAL_HEAT_LOSS

// Plus radiative/convective loss from the shell, which grows with temperature.
// This gives temperature a natural ceiling: a fixed fire settles at an
// equilibrium instead of climbing forever. (Added after first playtest.)
heatLoss += TEMP_LOSS_COEFF * (temperature - AMBIENT_TEMP)

temperature += (heatFromCoal - heatLoss) * deltaTime
temperature = clamp(temperature, AMBIENT_TEMP, MAX_TEMP)

// Steam production: needs adequate temperature AND adequate water.
//   steamCurve(temperature):        0 below STEAM_TEMP_MIN; an ease-out ramp
//                                   (steep early, flattening) up to 1 at
//                                   STEAM_TEMP_FULL; held at 1 above (a hotter
//                                   boiler never makes less steam). Concretely:
//                                   t = (T - MIN) / (FULL - MIN); 1 - (1 - t)^2.
//   waterAvailabilityCurve(bw):     a bell peaking at WATER_STEAM_PEAK — too
//                                   little water can't raise steam, a flooded
//                                   boiler boils poorly.
steamRate = STEAM_MAX_RATE * steamCurve(temperature) * waterAvailabilityCurve(boilerWater)

pressure += (steamRate - VENT_RATE - LEAKAGE) * deltaTime
pressure = clamp(pressure, 0, MAX_PRESSURE)

// boilerWater is consumed by steam production
boilerWater -= steamRate * WATER_CONSUMPTION_RATE * deltaTime

// Track how long the machine has been fully dead
if pressure <= 0: zeroPressureTime += deltaTime
else:             zeroPressureTime = 0

// End conditions
if pressure >= MAX_PRESSURE:        gameOver("explosion")
if temperature >= MAX_TEMP:         gameOver("meltdown")
if zeroPressureTime >= STALL_TIMEOUT: gameOver("starvation")
```

The **water** factor is bell-shaped (low at both extremes, peak in a safe band) — that's
the "too little OR too much water is bad" tension. The **temperature** factor was
originally a bell too, but hand-play showed that made pushing the boiler hot *reduce*
pressure, which read as backwards; it's now a ramp that plateaus at full (see "Third
pass"). Overheating is punished by meltdown, not by losing steam. Exact numbers are
tuning, not design — expect to playtest and adjust.

## v1 tuning constants (first pass — all placeholders)

These live in one exported `CONSTANTS` object in `src/js/simulation.js`. Tuning = editing
that block. Target feel: a careless player dies in ~10–15s; an attentive player lasts
~90–150s before supplies force a starvation spiral. `VENT_RATE` and `STEAM_MAX_RATE` are
the first knobs to touch if pressure feels wrong.

`fireCoal` below = units of coal currently burning (distinct from `coalSupply`). It rises
when the player stokes and burns down over time; heat scales with it.

### Timing & starting state

| Name | Value | Meaning / why |
|---|---|---|
| `FIXED_DT` | 0.1 s (10 Hz) | Fixed sim step; smooth enough, easy to reason about, deterministic. |
| `START_WATER_SUPPLY` | 100 units | Design range. |
| `START_COAL_SUPPLY` | 100 units | Design range. |
| `START_BOILER_WATER` | 50 % | Middle of the safe band. |
| `START_TEMPERATURE` | 20 °C | Cold start (= `AMBIENT_TEMP`); first ~10s teach the loop. |
| `START_PRESSURE` | 0 bar | Nothing running yet. |
| `START_FIRE_COAL` | 0 units | Player must build the fire. |

### Player actions

| Name | Value | Meaning / why |
|---|---|---|
| `WATER_ADD_TO_BOILER` | 18 % | ~2 adds cross the whole safe band; responsive but not a one-tap fix. |
| `WATER_SUPPLY_COST` | 8 units | ~12 refills per run; decoupled from boiler gain (tank is "bigger" than boiler). Lowered from 10 to offset the shorter cooldown. |
| `WATER_COOLDOWN` | 1.2 s | Cut from 2.0s after hand-play — 2.0s felt like an eternity and made it hard to add enough water in time to pull the temperature back down. Still not spammable. |
| `COAL_ADD_TO_FIRE` | 10 units | Down from 12 for finer fire control (a stoke was a big fraction of the ~14-unit equilibrium fire). |
| `COAL_SUPPLY_COST` | 7 units | ~14 stokes per run; lowered from 9 to offset the shorter cooldown. |
| `COAL_COOLDOWN` | 1.5 s | Cut from 2.5s alongside `WATER_COOLDOWN`; still a touch longer than water since coal drives both temp and pressure. |

### Heat

| Name | Value | Meaning / why |
|---|---|---|
| `COAL_HEAT_CONSTANT` | 2.2 °C/s per `fireCoal` unit | Raised from 2.0 alongside `TEMP_LOSS_COEFF` so a cold boiler still warms up fast enough to beat the stall timer. With the radiative term, a steady fire of ~14 balances heat at 200°C. |
| `FIRE_BURN_DOWN` | 1.2 units/s | 12-unit stoke lasts ~10s → stoke rhythm every ~8–10s. |
| `TEMP_LOSS_COEFF` | 0.06 °C/s per °C above ambient | Radiative/convective shell loss. Gives temperature a natural ceiling so meltdown needs real over-firing and explosion becomes a parallel threat. Design proposed ~0.08; 0.06 keeps warm-up under the stall timeout. Added after first playtest. |
| `LOW_WATER_THRESHOLD` | 25 % | Below → `LOW_HEAT_LOSS` (temp spikes). |
| `HIGH_WATER_THRESHOLD` | 75 % | Above → `HIGH_HEAT_LOSS` (over-cooling). Safe band 25–75. |
| `LOW_HEAT_LOSS` | 6 °C/s | Base loss when neglecting water; combined with the radiative term still trends to a meltdown if the fire stays lit. |
| `NORMAL_HEAT_LOSS` | 20 °C/s | Base loss the fire is tuned against. |
| `HIGH_HEAT_LOSS` | 40 °C/s | Flooding kills steam and wastes coal. |
| `AMBIENT_TEMP` | 20 °C | Temperature clamps to `[AMBIENT_TEMP, MAX_TEMP]` (cooling floors at room temp, not 0). |
| `MAX_TEMP` | 300 °C | Design range max → meltdown. Danger styling above ~260. |

### Steam & pressure

| Name | Value | Meaning / why |
|---|---|---|
| `STEAM_TEMP_MIN` / `STEAM_TEMP_FULL` | 80 / 260 °C | `steamCurve(T)`: 0 at/below 80°C, an ease-out ramp `1-(1-t)^2` to 1 at 260°C, held at 1 above. Replaced the old temperature bell (see "Third pass"). Ease-out (not linear) so pressure starts building near ~150°C with a mid boiler while steam still isn't maxed until ~260°C. |
| `WATER_STEAM_PEAK` / `WATER_STEAM_WIDTH` | 55 / 38 % | `waterAvailabilityCurve(bw) = exp(-((bw-55)/38)^2)`; widened from 30 after hand-play. Running the boiler toward ~30% (or flooding it) is a secondary lever for *bleeding* pressure. |
| `STEAM_MAX_RATE` | 2.5 bar/s | Rate when temperature is full and the water curve = 1.0. |
| `VENT_RATE` | 1.5 bar/s | Constant safety valve. Wandered 1.5 → 2.0 → 1.6 → 1.2 → 1.7 → 1.5 across passes. With the ease-out steam curve: pressure is break-even around ~152°C (mid boiler), builds ~+0.6 bar/s at 200°C, ~+0.9 bar/s on the plateau. Bleed by letting the fire ease so temperature sags below ~150°C, or run the boiler lean/flooded. Still the first knob to tune. |
| `LEAKAGE` | 0.1 bar/s | Small constant loss. Could later scale with pressure; kept constant for v1 readability. |
| `WATER_CONSUMPTION_RATE` | 1.2 | `boilerWater -= steamRate * 1.2 * dt` → ~−3 %/s at peak steam; an 18% add lasts ~6s of hard steaming. |
| `STALL_WARNING_PRESSURE` | 1.0 bar | Below this, show the "STALL WARNING" label. The label alone is not lethal — see `STALL_TIMEOUT`. |
| `STALL_TIMEOUT` | 30 s | Pressure at exactly zero for this long ends the run (`starvation`). Closes the "do nothing forever" score exploit; also a soft deadline to get the engine lit. 30s (design proposed 20) leaves a fumbling first-timer room to warm up from cold. |
| `MAX_PRESSURE` | 15 bar | Design range max → explosion. Danger styling above ~12. |

## First playtest findings (headless, before hand-play)

Ran the simulation headlessly with a handful of scripted "operators"
(`tests`-style, not committed). What we learned:

- **Core loop works.** A careful operator (nurse temp toward ~200 with a
  sawtooth fire, keep boiler water mid-band, back off when pressure climbs)
  lasts ~110s and then dies to **starvation** exactly as designed — both
  supplies empty, pressure bleeds to zero.
- **Meltdown is the common death.** Any fire a bit too eager runs the
  temperature away to 300 before pressure becomes a problem. Neglecting boiler
  water (drops below `LOW_WATER_THRESHOLD`) also causes a runaway meltdown, as
  intended.
- **Explosion is currently hard to trigger.** Because temperature has no
  self-limiting term (heat loss doesn't grow as it gets hotter) but pressure
  has strong negative feedback (`VENT_RATE` + steam falling off as temp leaves
  the band), a too-big fire melts down before it can over-pressurise. Explosion
  needs a *deliberately* held in-band temperature with a full boiler and the
  pressure gauge ignored.
- **Idle is un-losable.** Doing nothing at all (cold engine, full supplies)
  never ends the run — starvation needs *both* supplies empty. Sitting at a
  dead machine to pad the survival-time score is currently possible.

### Tuning changes applied after that pass (2026-09-09)

1. **Temperature self-limiting term** — added `heatLoss += TEMP_LOSS_COEFF *
   (temperature - AMBIENT_TEMP)`. Landed `TEMP_LOSS_COEFF` at 0.06 (not the
   proposed 0.08 — 0.08 slowed the cold-start warm-up enough to trip the new
   stall timer) and nudged `COAL_HEAT_CONSTANT` 2.0 → 2.2 to keep warm-up snappy.
2. **Idle exploit closed** — `zeroPressureTime` accumulates while `pressure` is
   at zero; at `STALL_TIMEOUT` (30s) the run ends as `starvation`. One rule
   covers both "never lit" and "ran dry and coasted to a stop".
3. **`VENT_RATE` 2.0 → 1.6** — with the radiative term also damping the system,
   2.0 made pressure inert. 1.6 restores pressure as a gauge you actively tend.

Re-run of the headless operators after these changes:

| Operator | Outcome |
|---|---|
| idle (no input) | `starvation` at 30s ✓ |
| spam coal / over-fire | `meltdown` at ~10s ✓ |
| run cool, ignore the pressure gauge | `explosion` at ~40s ✓ (explosion now reachable) |
| skilled (hold sweet spot, run boiler lean to shed pressure) | `starvation` at ~135s, pressure genuinely managed ✓ |

### Second pass — first hand-play (2026-09-09)

Two problems reported from actually playing:

- **Pressure never built.** At a human operating point (bouncing ~150–190°C,
  boiler drifting off its 55% peak) the narrow steam curves produced ~1.3 bar/s
  — below the 1.7 bar/s bleed — so the gauge could never climb. The scripted
  operators had missed this by holding the setpoint tighter than a person can.
- **Cooldowns too long.** 2.5s between stokes / 2.0s between water adds felt
  glacial, and the water delay made it genuinely hard to cool a hot boiler in
  time.

Changes:

1. `WATER_COOLDOWN` 2.0 → 1.2s, `COAL_COOLDOWN` 2.5 → 1.5s. Supply costs cut
   (`WATER_SUPPLY_COST` 10 → 8, `COAL_SUPPLY_COST` 9 → 7) and `COAL_ADD_TO_FIRE`
   12 → 10 so run length and fire control stay sane with the faster cadence.
2. `STEAM_TEMP_WIDTH` 60 → 78, `WATER_STEAM_WIDTH` 30 → 38 so a loosely-held
   setpoint still makes real steam.
3. `VENT_RATE` 1.6 → 1.7 to keep the now-livelier pressure from running away.

Headless re-run after this pass:

| Operator | Outcome |
|---|---|
| idle | `starvation` at 30s ✓ |
| spam coal / over-fire | `meltdown` at ~8s ✓ |
| ignore the pressure gauge | `explosion` at ~58s ✓ |
| skilled (bleed pressure by easing the fire when it climbs) | `starvation` at ~146s ✓ |
| conservative (run cool throughout) | `starvation` at ~143s ✓ |

### Third pass — temperature vs. pressure made monotonic (2026-09-09)

Player noticed two things while playing: past ~230°C the pressure gauge started
*falling*, and adding boiler water never seemed to affect pressure. Both were
real:

- The old `steamCurve` was a **bell** centred on 200°C, so a hotter boiler made
  *less* steam and therefore less pressure — backwards from how a real boiler
  reads.
- Boiler water only ever touched pressure indirectly (through its own bell and
  the heat-loss bands); it's effectively a separate vessel in this model.

Fix (option "B" from the discussion): `steamCurve` is now a **rising ramp that
plateaus** — nothing below `STEAM_TEMP_MIN`, climbing to full at
`STEAM_TEMP_FULL`, then flat. A hotter boiler never makes less steam;
overheating is punished by `MAX_TEMP` meltdown (and by pegging steam at max, so
pressure climbs too). The water factor stays a bell. `VENT_RATE` 1.7 → 1.5.

First try used a **linear** ramp (`STEAM_TEMP_MIN/FULL` 100 / 240) — pressure
only started building above ~190°C, and the player asked to bring that down to
~150°C. A linear ramp can't do that and still plateau near 240°C (150°C is only
~36% of the way up but needs ~65% steam to beat the vent). So the ramp is now
**ease-out**, `1 - (1 - t)^2`, with `STEAM_TEMP_MIN/FULL` = 80 / 260: steep just
above boiling, flattening toward the top. Pressure now breaks even around
~152°C.

Resulting shape of play: a cool ~160–175°C cruise builds pressure gently; you
bleed by easing the fire so temperature sags below ~150°C, or by running the
boiler water lean/flooded. Running hot (200°C+) builds pressure fast — fine if
you watch the gauge, fatal if you don't. Headless re-run:

| Operator | Outcome |
|---|---|
| idle | `starvation` at 30s ✓ |
| spam coal / over-fire | `meltdown` at ~8s ✓ |
| hold ~200°C+, ignore the pressure gauge | `explosion` at ~35s ✓ |
| skilled (cool cruise, ease the fire before pressure passes ~10) | `starvation` at ~142s ✓ |

Known edge: parking the boiler below ~150°C makes too little steam to hold any
pressure, so it bleeds to zero and you eventually stall out — "keep it warm
enough to drive the engine" is part of the challenge.

## Rendering decision (v1)
Gauges are **DOM + CSS bars**, not HTML5 canvas. Rationale: easier to read line-by-line
for a learning project, and "value mapped to a fill %" ports cleanly. Canvas dials are a
later visual pass. (Recorded here per CLAUDE.md's "note the choice once made".)

## Win/lose framing
There's no "win" in v1 — it's an endless-survival high-score loop, which matches your
"try to make the machine work as long as possible" framing. A clear, readable death
screen (cause of death + survival time) is important for the loop to feel good.

## Controls (v1, web/keyboard+mouse)
- Click/tap "Add water" button (or `W` key)
- Click/tap "Add coal" button (or `C` key)
- Gauges rendered as DOM + CSS bars (see "Rendering decision (v1)")

## Roadmap (post-v1, not built yet)
- Gold earned per run based on survival time
- Meta-progression: upgrade pressure tolerance band, durability, storage capacity,
  better fuel types
- Random events (e.g. sudden cold draft, coal shortage delivery)
- Roguelike run structure (die → shop → next run)

## Open questions to resolve during build
- Exact numeric constants (all placeholders above — tune by playtesting)
- ~~Tick rate / whether to use fixed timestep or real delta time~~ — resolved:
  fixed 10 Hz timestep (`FIXED_DT = 0.1`) with a real-time accumulator in `main.js`
- ~~Visual style~~ — resolved for v1: DOM + CSS bars (thematic dials later)
- The two "Proposed tuning changes" above (temperature self-limiting term; idle
  exploit)
