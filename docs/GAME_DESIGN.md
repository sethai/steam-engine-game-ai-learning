# Steam Engine Survival — Game Design Doc (v1 scope)

## One-line pitch
Drive an old steam machine as far as you can by balancing water and coal so the
pressure stays in the machine's happy band — too low and it stalls, too high and
it either wears out or the boiler explodes.

Inspired by an old Atari 8-bit game the designer half-remembers — mechanic reconstructed
from scratch, not a clone.

## Core loop (v1 — no meta-game yet)
1. Player has a **water supply** and a **coal supply**, both finite, both drain as used.
2. Player adds water and/or coal to the boiler at will, and can **vent steam** by hand.
3. The simulation updates every tick (physics below).
4. Pressure drives **the machine**: above `RUN_THRESHOLD` it runs, faster the more
   pressure, and running consumes pressure. `distance` travelled is the score.
5. Player watches the gauges: pressure, machine speed, wear, temperature, boiler water,
   fire, and the two supplies.
6. Game ends when:
   - pressure hits `MAX_PRESSURE` → **explosion**
   - temperature hits `MAX_TEMP` → **meltdown**
   - `wear` hits `WEAR_MAX` (from sustained pressure over `REDLINE_PRESSURE`) → **breakdown**
   - the machine sits stopped for `STALL_TIMEOUT` seconds → **stall**
7. **Score = distance travelled.** (Was survival time — changed in "Fifth pass" so
   idling a barely-alive machine earns nothing and running hot is rewarded.)

Note on "stall": a brief low-pressure dip is not lethal — a "STALL WARNING" label shows
whenever the machine isn't moving (pressure below `RUN_THRESHOLD`). Normally the run only
ends if it stays stopped for `STALL_TIMEOUT` seconds. But if recovery is *impossible* —
the machine has stopped, the fire is out, and both supplies are empty — the run ends
right away rather than making the player watch a 30-second countdown they can't affect.

Deliberately OUT of v1 scope: currency, upgrades, roguelike runs, random events,
different fuel types, multiple machine parts. These come after the core loop is proven fun.

## State variables

| Variable | Range | Meaning |
|---|---|---|
| `waterSupply` | 0–100 (units) | Water left in the external tank, player-refillable in real life but fixed per run in-game |
| `coalSupply` | 0–100 (units) | Coal left in the external bin |
| `boilerWater` | 0–100 (%) | Water currently inside the boiler |
| `temperature` | 0–300 (°C) | Boiler temperature |
| `pressure` | 0–15 (bar) | Steam pressure — drives the machine, and the thing that can kill you three ways |
| `fireCoal` | 0+ (units) | Coal currently burning on the fire. Rises when the player stokes, burns down at `FIRE_BURN_DOWN` per second. Heat scales with it. |
| `machineSpeed` | 0+ (m/s) | Engine speed: `(pressure − RUN_THRESHOLD) × SPEED_PER_BAR`, or 0 when pressure ≤ `RUN_THRESHOLD` |
| `distance` | 0+ (m) | Integral of `machineSpeed`. **The score.** |
| `wear` | 0–`WEAR_MAX` | Mechanical fatigue. Climbs while `pressure > REDLINE_PRESSURE`, recovers slowly below. At `WEAR_MAX` → breakdown. |
| `elapsedTime` | seconds | Shown as a secondary stat, no longer the score |
| `stalledTime` | seconds | Internal: how long the machine has been stopped (`machineSpeed` = 0). Drives the stall timeout; resets the instant it moves. |
| `ventCooldown` | seconds | Internal: time left until "Vent steam" is available again |

## Player actions
- **Add water** — moves a chunk of `waterSupply` into `boilerWater`, and **mixes cold
  (ambient-temperature) water into the boiler, so it also pulls `temperature` down** —
  more so when the boiler was low (less thermal mass to buffer the shock). See "Fourth
  pass".
- **Add coal** — consumes a chunk of `coalSupply`, increases coal currently burning
  (coal burns down over time rather than being an instant temperature jump)
- **Vent steam** — drops `pressure` by `VENT_AMOUNT` immediately. The only cost is the
  wasted steam (the coal + water that went into it). This replaces the old *automatic*
  safety valve — there is no auto-vent now, so runaway pressure is on the player. See
  "Fifth pass".
- All three actions are rate-limited (a cooldown) so the player can't spam-correct
  instantly — this is what makes it a *balancing* game and not a solved reflex-check.

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

// Pressure: steam in, minus the constant leak, minus the work the engine does.
// The engine's draw rises steeply with pressure up to its efficient throughput
// (MAX_WORK_DRAW, the "knee" at overRun = MAX_WORK_DRAW / WORK_DRAW_COEFF),
// then keeps rising on a shallow slope — so an overpressured boiler can be held
// in the redline band for a while (wearing) rather than instantly exploding.
// There is NO automatic vent; the only constant bleed is LEAKAGE.
overRun    = max(0, pressure - RUN_THRESHOLD)
kneeOverRun = MAX_WORK_DRAW / WORK_DRAW_COEFF
workDraw   = overRun <= kneeOverRun
             ? overRun * WORK_DRAW_COEFF
             : MAX_WORK_DRAW + (overRun - kneeOverRun) * WORK_DRAW_COEFF_HIGH
pressure += (steamRate - LEAKAGE - workDraw) * deltaTime
pressure = clamp(pressure, 0, MAX_PRESSURE)

// boilerWater is consumed by steam production
boilerWater -= steamRate * WATER_CONSUMPTION_RATE * deltaTime

// The machine: speed follows pressure, distance (the score) is its integral
machineSpeed = pressure > RUN_THRESHOLD
               ? (pressure - RUN_THRESHOLD) * SPEED_PER_BAR
               : 0
distance += machineSpeed * deltaTime

// Wear builds above the redline, recovers slowly below it
if pressure > REDLINE_PRESSURE:
    wear += (pressure - REDLINE_PRESSURE) * WEAR_RATE * deltaTime
else:
    wear = max(0, wear - WEAR_RECOVERY * deltaTime)

// Track how long the machine has been stopped
if machineSpeed <= 0: stalledTime += deltaTime
else:                 stalledTime = 0

// End conditions
if pressure >= MAX_PRESSURE:          gameOver("explosion")
if temperature >= MAX_TEMP:           gameOver("meltdown")
if wear >= WEAR_MAX:                  gameOver("breakdown")
if stalledTime >= STALL_TIMEOUT:      gameOver("stall")
// ...or end the stall immediately when recovery is impossible: the machine has
// stopped AND fireCoal == 0 AND waterSupply == 0 AND coalSupply == 0. No point
// making the player watch the timeout run down.
if machineSpeed <= 0 and fireCoal <= 0
   and waterSupply <= 0 and coalSupply <= 0:  gameOver("stall")
```

The player's manual **Vent steam** action (outside this tick loop) just does
`pressure = max(0, pressure - VENT_AMOUNT)` and starts `ventCooldown`.

The **water** factor is bell-shaped (low at both extremes, peak in a safe band) — that's
the "too little OR too much water is bad" tension. The **temperature** factor was
originally a bell too, but hand-play showed that made pushing the boiler hot *reduce*
pressure, which read as backwards; it's now a ramp that plateaus at full (see "Third
pass"). Overheating is punished by meltdown, not by losing steam. Exact numbers are
tuning, not design — expect to playtest and adjust.

## v1 tuning constants (first pass — all placeholders)

These live in one exported `CONSTANTS` object in `src/js/simulation.js`. Tuning = editing
that block. Target feel (as of the Fifth pass): a careless player dies in ~10–20s; a
safe "cruise + vent" run lasts ~150s and ~1300 m before supplies run out; a greedy
"ride the redline" run scores higher (~1600–2000 m) but breaks the machine at ~60–100s.
`WORK_DRAW_COEFF_HIGH`, `WEAR_RATE` and `STEAM_MAX_RATE` are the knobs to touch if the
pressure / wear / explosion balance feels wrong.

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
| `WATER_ADD_TO_BOILER` | 12 % | Cut from 18 in the "Fourth pass" — now that a refill also mixes cold water in and drops `temperature`, a smaller scoop keeps that shock manageable (~27–35°C mid-boiler, more when near-empty). |
| `WATER_SUPPLY_COST` | 5 units | ~20 refills per run; cut from 8 to match the smaller scoop so total water economy is roughly unchanged. |
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
| `STEAM_MAX_RATE` | 2.5 bar/s | Rate when temperature is full and the water curve = 1.0. Explosion needs steam sustained above ~2.42 (roughly T ≥ 226 °C with a full boiler). |
| `LEAKAGE` | 0.1 bar/s | Small constant loss — now the *only* automatic pressure bleed (the auto safety valve was removed in "Fifth pass"). |
| `WATER_CONSUMPTION_RATE` | 1.2 | `boilerWater -= steamRate * 1.2 * dt` → ~−3 %/s at peak steam; a 12% add lasts ~4s of hard steaming. |
| `STALL_TIMEOUT` | 30 s | Machine stopped (speed 0) for this long ends the run (`stall`). Closes the "do nothing forever" exploit; also a soft deadline to get going from cold. 30s leaves a fumbling first-timer room to warm up. |

### The machine (Fifth pass)

| Name | Value | Meaning / why |
|---|---|---|
| `RUN_THRESHOLD` | 2.0 bar | Below this the machine is stopped (speed 0, `stalledTime` accrues). |
| `SPEED_PER_BAR` | 2.0 (m/s)/bar | `machineSpeed = (pressure − 2) × 2`. Pure score scaling — safe to retune for feel. |
| `WORK_DRAW_COEFF` | 0.24 (bar/s)/bar | Steep pre-knee draw slope. A steam rate of ~1.6 parks pressure at ~8 bar, ~1.9 at ~9.5 bar. |
| `MAX_WORK_DRAW` | 1.9 bar/s | The engine's efficient throughput (the "knee", at ~9.9 bar). |
| `WORK_DRAW_COEFF_HIGH` | 0.08 (bar/s)/bar | Shallow post-knee slope. Makes 11–15 bar a *holdable* (wearing) band: steam ~2.1 → ~11 bar, ~2.25 → ~13 bar, ~2.4 → ~15 bar, ~2.5 → explodes. |
| `REDLINE_PRESSURE` | 12 bar | Above this, `wear` accumulates. |
| `WEAR_RATE` | 0.9 wear/s per bar over redline | Tuned so riding ~13 bar for score breaks the machine in ~60–90s, but pushing to ~14.5+ reaches explosion first. Moderate greed → breakdown; reckless greed → explosion. |
| `WEAR_RECOVERY` | 0.6 wear/s | Shed while at/below the redline. Wear is a real resource, not a one-spike death. |
| `WEAR_MAX` | 100 | `wear` at which the machine breaks apart (`breakdown`). |
| `VENT_AMOUNT` | 3.0 bar | Dropped per manual "Vent steam". |
| `VENT_COOLDOWN` | 2.0 s | Between vents. Long enough that venting is a real decision, short enough to save a spike. |
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

### Fourth pass — cold-water mixing (2026-09-10)

Player point: adding water *should* lower the boiler temperature — you're mixing
room-temperature water into hotter water. Until now `addWater` only changed
`boilerWater` and `waterSupply`; temperature was untouched except via the
heat-loss bands.

`addWater` now mixes by mass (treating `boilerWater` % as ∝ mass):

```
added   = actual rise in boilerWater from the scoop
temperature = (boilerWater_before * temperature + added * AMBIENT_TEMP)
              / (boilerWater_before + added)
```

Ignores the boiler shell's own heat capacity and any latent-heat / flashing —
right level of detail for v1.

Effects:

- A refill now costs you temperature: ~27°C into a full boiler, ~35°C mid,
  ~80°C into a near-empty hot one (less water = less thermal mass to buffer).
- Running the boiler **fuller** is now a real strategy — gentler refill shocks —
  traded against the steam sweet spot (~55%) and the flood penalty (>75%).
- The low-fuel death spiral is real: forced to top up water with little coal →
  temperature craters → can't recover → steam stops → stall.

Re-tune: `WATER_ADD_TO_BOILER` 18 → 12 and `WATER_SUPPLY_COST` 8 → 5 (smaller,
cheaper scoops; gentler shock, similar total water). Headless re-run:

| Operator | Outcome |
|---|---|
| idle | `starvation` at 30s ✓ |
| spam coal / over-fire | `meltdown` at ~8s ✓ |
| hold ~205°C, ignore the pressure gauge | `explosion` at ~40s ✓ |
| skilled (~185°C, ease the fire before pressure passes ~10) | `starvation` at ~141s, pressure peaked ~11 bar ✓ |

### Fifth pass — the running machine (2026-09-10)

Until now the "machine" was abstract: pressure was just an "are you alive"
number with no purpose. This pass makes pressure actually *drive* something, and
adds the two ideas the player raised — a **manual vent** and a machine that
**breaks from sustained overpressure** (not just from a full explosion).

New subsystem (see the physics pseudocode and "The machine" constants):

- **`machineSpeed`** = `(pressure − RUN_THRESHOLD) × SPEED_PER_BAR`, zero below
  the threshold.
- **`distance`** = integral of speed. **This replaces survival time as the
  score.** Idling a barely-alive machine now earns almost nothing; running hot
  is rewarded.
- The running engine **consumes pressure** (`workDraw`), steeply up to a knee
  (`MAX_WORK_DRAW`) then shallowly past it. This is the *only* real pressure
  sink now — the automatic safety valve is gone (`VENT_RATE` deleted). The
  shallow post-knee slope is what makes 11–15 bar a holdable band instead of an
  instant runaway.
- **`wear`** builds while `pressure > REDLINE_PRESSURE` (12 bar) and recovers
  slowly below. At `WEAR_MAX` → **breakdown**, a new death distinct from
  explosion.
- **Vent steam** (`V`): manual `pressure −= VENT_AMOUNT`, on a cooldown. The
  wasted coal + water is the cost.
- The stall death is renamed `starvation` → **`stall`** and now triggers on
  "machine stopped (speed 0) for `STALL_TIMEOUT`s" rather than "pressure at 0".

Resulting strategy spectrum (headless operators):

| Operator | Outcome |
|---|---|
| idle | `stall` at 30s, 0 m ✓ |
| spam coal / over-fire | `meltdown` at ~8s, ~7 m ✓ |
| hold ~210°C, never vent | `explosion` at ~69s, ~1300 m ✓ |
| ride ~14 bar for score, never vent | `breakdown` at ~87s, ~1700 m ✓ |
| ride just under the 12-bar redline | survives to supply exhaustion, ~2000 m (highest — but needs precision) |
| safe cruise ~8 bar + vent when it climbs | `stall` (out of coal) at ~154s, ~1300 m ✓ |

All four deaths reachable; safe play and greedy play both viable with different
score ceilings and risk. Numbers are first-pass — expect hand-tuning.

## Rendering decision (v1)
Most readouts are **DOM + CSS bars** — easy to read line-by-line, and "value mapped to a
fill %" ports cleanly. **Pressure and machine speed** are **inline-SVG analog arc dials**
(built by `ui.js` from the physics constants, needle rotated per frame) — still
declarative DOM, no canvas. Zones: pressure red/orange/**green**/orange/red (both ends
bad — stall vs. wear/explosion); speed green/orange/red (only the fast end is bad). The
green edges are the machine's efficient "knee" (`MAX_WORK_DRAW / WORK_DRAW_COEFF`) and
`REDLINE_PRESSURE`, so the colours track the model. (Recorded per CLAUDE.md's "note the
choice once made".)

## Win/lose framing
There's no "win" in v1 — it's an endless high-score loop. Score is **distance
travelled** (Fifth pass; was survival time). The death screen shows cause of death plus
distance and elapsed time. A clear, readable death screen is important for the loop to
feel good.

## Controls (v1, web/keyboard+mouse)
- Click/tap "Add water" button (or `W` key)
- Click/tap "Add coal" button (or `C` key)
- Click/tap "Vent steam" button (or `V` key)
- Gauges rendered as DOM + CSS bars (see "Rendering decision (v1)")

## Roadmap (post-v1, not built yet)
- Gold earned per run based on distance travelled
- Meta-progression: buy better machines — wider safe pressure band, slower wear at high
  pressure, bigger supply capacity, better fuel. (The current machine's constants —
  `REDLINE_PRESSURE`, `WEAR_RATE`, `MAX_WORK_DRAW`, `SPEED_PER_BAR`, supply sizes —
  become per-machine stats.)
- Random events (e.g. sudden cold draft, coal shortage delivery)
- Roguelike run structure (die → shop → next run)

## Open questions to resolve during build
- Exact numeric constants (all placeholders above — tune by playtesting)
- ~~Tick rate / whether to use fixed timestep or real delta time~~ — resolved:
  fixed 10 Hz timestep (`FIXED_DT = 0.1`) with a real-time accumulator in `main.js`
- ~~Visual style~~ — resolved for v1: DOM + CSS bars (thematic dials later)
- The two "Proposed tuning changes" above (temperature self-limiting term; idle
  exploit)
