// simulation.js — physics/state update for Steam Engine Survival.
//
// This module is deliberately DOM-free and side-effect-free (apart from mutating
// the state object it is handed) so it can be unit-tested and later translated to
// another platform. See CLAUDE.md "Code conventions" and docs/GAME_DESIGN.md
// "Physics model".
//
// Model summary (full pseudocode: docs/GAME_DESIGN.md "Physics model"):
//   - The player stokes coal onto the fire; `fireCoal` burns down over time.
//   - Heat from the fire fights a heat-loss term that depends on how much water
//     is in the boiler (too little -> spikes, too much -> over-cools).
//   - Steam production climbs with temperature up to a plateau (hotter never
//     makes less steam) and peaks in a boiler-water band (a bell — too little
//     water starves it, a flooded boiler boils poorly). The two factors
//     multiply.
//   - Steam raises pressure. Above RUN_THRESHOLD the machine runs (speed scales
//     with pressure) and consumes pressure as it works, up to MAX_WORK_DRAW —
//     past that the machine is saturated and excess steam just builds pressure.
//     A small constant leak also bleeds pressure. The player can manually vent.
//   - `distance` (the score) is the integral of machine speed. Pressure held
//     above REDLINE_PRESSURE accumulates `wear` (it recovers slowly below).
//   - Steam also consumes boiler water; adding cold water mixes the boiler
//     temperature down.
//   - Deaths: explosion (pressure maxed), meltdown (temp maxed), breakdown
//     (wear maxed — ran it too hard too long), stall (machine not moving for
//     STALL_TIMEOUT seconds — ran the supplies dry, or never got it going).

// All tunable numbers live here. Rationale for each value is in
// docs/GAME_DESIGN.md "v1 tuning constants". These are placeholders: expect to
// tune by playtesting (CLAUDE.md "Working agreement").
export const CONSTANTS = Object.freeze({
  // --- Timing -------------------------------------------------------------
  FIXED_DT: 0.1, // seconds per simulation step (10 Hz fixed timestep)

  // --- Starting state ---------------------------------------------------
  START_WATER_SUPPLY: 100, // units in the external tank
  START_COAL_SUPPLY: 100, // units in the external bin
  START_BOILER_WATER: 50, // % — middle of the safe band
  START_TEMPERATURE: 20, // °C — cold start (equals AMBIENT_TEMP)
  START_PRESSURE: 0, // bar
  START_FIRE_COAL: 0, // units of coal currently burning

  // --- Player actions -------------------------------------------------
  WATER_ADD_TO_BOILER: 12, // % added to the boiler per "Add Water" (smaller
  // scoop than before so the cold-water temperature shock per refill is gentler
  // now that mixing is modelled — see addWater and GAME_DESIGN.md "Fourth pass")
  WATER_SUPPLY_COST: 5, // units drained from the tank per "Add Water"
  // Cooldowns cut from 2.0 / 2.5s after hand-play: 2.5s felt like an eternity
  // and left the player unable to add enough water fast enough to pull the
  // temperature back down. Still long enough that you can't just spam-correct.
  WATER_COOLDOWN: 1.2, // seconds before "Add Water" is allowed again
  COAL_ADD_TO_FIRE: 10, // units added to the fire per "Add Coal"
  COAL_SUPPLY_COST: 7, // units drained from the bin per "Add Coal"
  COAL_COOLDOWN: 1.5, // seconds before "Add Coal" is allowed again

  // --- Heat -------------------------------------------------------------
  COAL_HEAT_CONSTANT: 2.2, // °C/s of heat per unit of burning coal
  FIRE_BURN_DOWN: 1.2, // units/s the fire consumes itself
  LOW_WATER_THRESHOLD: 25, // % — below this, poor heat moderation
  HIGH_WATER_THRESHOLD: 75, // % — above this, the system over-cools
  LOW_HEAT_LOSS: 6, // °C/s base heat loss when boiler water is low
  NORMAL_HEAT_LOSS: 20, // °C/s base heat loss in the safe band
  HIGH_HEAT_LOSS: 40, // °C/s base heat loss when the boiler is flooded
  // Extra heat loss per °C above ambient — radiative/convective loss from the
  // boiler shell, which grows the hotter it gets. This gives temperature a
  // natural ceiling so a modest fire settles instead of running away: meltdown
  // now needs real over-firing, and explosion becomes a genuine parallel
  // threat. See docs/GAME_DESIGN.md "First playtest findings".
  TEMP_LOSS_COEFF: 0.06,
  AMBIENT_TEMP: 20, // °C — temperature floor (room temp, not 0)
  MAX_TEMP: 300, // °C — meltdown at or above this

  // --- Steam & pressure ---------------------------------------------
  // Steam vs. temperature is a rising ramp, not a bell: no steam below the
  // boiling point, climbing to full by STEAM_TEMP_FULL, then held flat for any
  // hotter temperature. A hotter boiler never makes LESS steam — overheating
  // punishes you through MAX_TEMP meltdown (and max steam pressure), not by
  // mysteriously losing pressure. The ramp is "ease-out" (steep early, flat
  // near the top) so pressure starts building around 150°C while steam still
  // isn't maxed until ~260°C — a linear ramp can't span both. See GAME_DESIGN.md
  // "Third pass".
  STEAM_TEMP_MIN: 80, // °C — below this, no steam at all
  STEAM_TEMP_FULL: 260, // °C — at/above this, steam output is at its max
  WATER_STEAM_PEAK: 55, // % — centre of the steam boiler-water band (a bell)
  WATER_STEAM_WIDTH: 38, // % — width (sigma) of that band
  STEAM_MAX_RATE: 2.5, // bar/s produced when temp is full and the water curve = 1.0
  LEAKAGE: 0.1, // bar/s bled off by background leaks (the only *constant* bleed)
  WATER_CONSUMPTION_RATE: 1.2, // boiler-water % consumed per unit of steam rate
  MAX_PRESSURE: 15, // bar — explosion at or above this

  // --- The machine (work output) ----------------------------------------
  // Pressure drives the engine. It doesn't move at all until RUN_THRESHOLD;
  // above that, speed scales with pressure. The running engine also consumes
  // pressure (WORK_DRAW_COEFF per bar above RUN_THRESHOLD) but only up to
  // MAX_WORK_DRAW — at max throughput it can't absorb any more steam, so beyond
  // that point extra steam just builds pressure toward explosion. This is the
  // main pressure sink; there is no automatic safety valve (the player vents by
  // hand). See docs/GAME_DESIGN.md "Fifth pass".
  RUN_THRESHOLD: 2.0, // bar — below this the machine is stopped
  SPEED_PER_BAR: 2.0, // speed (score units/s) per bar of pressure above RUN_THRESHOLD
  WORK_DRAW_COEFF: 0.24, // bar/s of pressure consumed per bar above RUN_THRESHOLD
  MAX_WORK_DRAW: 1.9, // bar/s — the engine's *efficient* max throughput (the "knee")
  WORK_DRAW_COEFF_HIGH: 0.08, // shallow draw slope past the knee: the engine still
  // absorbs a little more steam when overpressured, so 11–14 bar is a holdable
  // (if wearing) band rather than an instant runaway to explosion
  REDLINE_PRESSURE: 12, // bar — sustained pressure above this wears the machine
  WEAR_RATE: 0.9, // wear/s per bar of pressure above REDLINE_PRESSURE. Tuned so
  // riding ~13 bar for extra score breaks the machine in ~60-90s, but pushing
  // to ~14.5+ reaches the explosion pressure faster than wear reaches WEAR_MAX —
  // moderate greed -> breakdown, reckless greed -> explosion.
  WEAR_RECOVERY: 0.6, // wear/s shed while pressure is at or below REDLINE_PRESSURE
  WEAR_MAX: 100, // wear at which the machine breaks apart ("breakdown")
  VENT_AMOUNT: 3.0, // bar released per manual vent
  VENT_COOLDOWN: 2.0, // seconds before "Vent" is allowed again

  // How long the machine may sit stopped (speed 0) before the run ends
  // ("stall"). Closes the "do nothing forever" score exploit and doubles as a
  // soft deadline to get the engine going from a cold start.
  STALL_TIMEOUT: 30, // seconds
});

// Keep a numeric value inside [min, max].
export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// A bell curve centred on `peak`, falling off with `width` (a Gaussian sigma).
// Returns 1.0 at the peak and approaches 0 far from it. Used for boiler water:
// "too little OR too much is bad".
function bell(x, peak, width) {
  const offset = (x - peak) / width;
  return Math.exp(-(offset * offset));
}

// Fraction (0..1) of max steam the current temperature allows. Zero below
// STEAM_TEMP_MIN, full at/above STEAM_TEMP_FULL, and in between an "ease-out"
// ramp: t is the linear 0..1 position, and 1 - (1 - t)^2 bends that so output
// rises fast just above the boiling point and flattens as it nears full. That
// shape lets pressure start building near 150°C without steam maxing out until
// ~260°C. A hot boiler never makes less steam.
export function steamCurve(temperature) {
  const min = CONSTANTS.STEAM_TEMP_MIN;
  const full = CONSTANTS.STEAM_TEMP_FULL;
  if (temperature <= min) return 0;
  if (temperature >= full) return 1;
  const t = (temperature - min) / (full - min);
  return 1 - (1 - t) * (1 - t);
}

// Fraction (0..1) of max steam the current boiler-water level allows. Still a
// bell: you need water present to raise steam, but a flooded boiler boils
// poorly and leaves little steam space.
export function waterAvailabilityCurve(boilerWater) {
  return bell(boilerWater, CONSTANTS.WATER_STEAM_PEAK, CONSTANTS.WATER_STEAM_WIDTH);
}

// A fresh run. Cooldown timers count seconds remaining until the action is
// allowed again; 0 means "ready".
export function createInitialState() {
  const c = CONSTANTS;
  return {
    waterSupply: c.START_WATER_SUPPLY,
    coalSupply: c.START_COAL_SUPPLY,
    boilerWater: c.START_BOILER_WATER,
    temperature: c.START_TEMPERATURE,
    pressure: c.START_PRESSURE,
    fireCoal: c.START_FIRE_COAL,
    machineSpeed: 0, // current engine speed (0 until pressure > RUN_THRESHOLD)
    distance: 0, // integral of machineSpeed over time — this is the score
    wear: 0, // 0..WEAR_MAX; climbs above REDLINE_PRESSURE, recovers below it
    elapsedTime: 0,
    waterCooldown: 0,
    coalCooldown: 0,
    ventCooldown: 0,
    // How long the machine has been stopped (speed 0). Drives the stall
    // timeout (see STALL_TIMEOUT); resets the moment the machine moves again.
    stalledTime: 0,
    gameOver: false,
    causeOfDeath: null,
  };
}

// Is the "Add Water" action currently available?
export function canAddWater(state) {
  return !state.gameOver && state.waterCooldown <= 0 && state.waterSupply > 0;
}

// Is the "Add Coal" action currently available?
export function canAddCoal(state) {
  return !state.gameOver && state.coalCooldown <= 0 && state.coalSupply > 0;
}

// Is the "Vent" action currently available?
export function canVent(state) {
  return !state.gameOver && state.ventCooldown <= 0 && state.pressure > 0;
}

// Move water from the tank into the boiler and start the cooldown. If the tank
// has less than a full scoop left, transfer what remains (scaled), so the last
// dregs are not wasted. Mutates `state`.
export function addWater(state) {
  if (!canAddWater(state)) return;
  const c = CONSTANTS;
  const drawn = Math.min(c.WATER_SUPPLY_COST, state.waterSupply);
  const fraction = drawn / c.WATER_SUPPLY_COST;
  state.waterSupply -= drawn;

  const before = state.boilerWater;
  state.boilerWater = clamp(before + c.WATER_ADD_TO_BOILER * fraction, 0, 100);
  const added = state.boilerWater - before;

  // Cold water mixing in pulls the boiler temperature toward ambient, weighted
  // by how much water was already there — a fuller boiler has more thermal mass
  // to resist the shock. Standard mixing-temperature formula, treating
  // boilerWater % as proportional to water mass. Deliberately ignores the
  // boiler shell's heat capacity and any latent-heat / flashing effects.
  // See docs/GAME_DESIGN.md "Fourth pass".
  if (added > 0) {
    const totalWater = before + added;
    state.temperature =
      (before * state.temperature + added * c.AMBIENT_TEMP) / totalWater;
  }

  state.waterCooldown = c.WATER_COOLDOWN;
}

// Stoke coal onto the fire and start the cooldown. Same partial-scoop handling
// as addWater. Mutates `state`.
export function addCoal(state) {
  if (!canAddCoal(state)) return;
  const c = CONSTANTS;
  const drawn = Math.min(c.COAL_SUPPLY_COST, state.coalSupply);
  const fraction = drawn / c.COAL_SUPPLY_COST;
  state.coalSupply -= drawn;
  state.fireCoal += c.COAL_ADD_TO_FIRE * fraction;
  state.coalCooldown = c.COAL_COOLDOWN;
}

// Manually crack the valve and let steam off: drop the pressure by a fixed
// chunk and start the cooldown. The wasted steam (the coal and water that went
// into it) is the only cost. Mutates `state`.
export function ventSteam(state) {
  if (!canVent(state)) return;
  const c = CONSTANTS;
  state.pressure = Math.max(0, state.pressure - c.VENT_AMOUNT);
  state.ventCooldown = c.VENT_COOLDOWN;
}

// Advance the simulation by `dt` seconds. Mutates and returns `state`.
// Order of operations follows docs/GAME_DESIGN.md "Physics model".
export function step(state, dt) {
  if (state.gameOver) return state;
  const c = CONSTANTS;

  // Cooldown timers tick toward zero (= ready).
  state.waterCooldown = Math.max(0, state.waterCooldown - dt);
  state.coalCooldown = Math.max(0, state.coalCooldown - dt);
  state.ventCooldown = Math.max(0, state.ventCooldown - dt);

  // The fire consumes itself, so heat is not a one-shot jump per stoke.
  state.fireCoal = Math.max(0, state.fireCoal - c.FIRE_BURN_DOWN * dt);

  // Heat generation vs. heat loss. The base loss depends on boiler water: too
  // little water moderates poorly (temp runs up), too much water over-cools.
  const heatFromCoal = state.fireCoal * c.COAL_HEAT_CONSTANT;
  let heatLoss;
  if (state.boilerWater < c.LOW_WATER_THRESHOLD) {
    heatLoss = c.LOW_HEAT_LOSS;
  } else if (state.boilerWater > c.HIGH_WATER_THRESHOLD) {
    heatLoss = c.HIGH_HEAT_LOSS;
  } else {
    heatLoss = c.NORMAL_HEAT_LOSS;
  }
  // Radiative/convective loss from the shell grows with temperature, so a fixed
  // fire settles at an equilibrium instead of climbing forever.
  heatLoss += c.TEMP_LOSS_COEFF * (state.temperature - c.AMBIENT_TEMP);

  state.temperature += (heatFromCoal - heatLoss) * dt;
  state.temperature = clamp(state.temperature, c.AMBIENT_TEMP, c.MAX_TEMP);

  // Steam needs BOTH an adequate temperature and adequate boiler water; each
  // contributes a 0..1 bell factor.
  const steamRate =
    c.STEAM_MAX_RATE *
    steamCurve(state.temperature) *
    waterAvailabilityCurve(state.boilerWater);

  // Pressure: steam in, minus the constant leak, minus the work the running
  // engine does. The engine's draw grows steeply with pressure up to its
  // efficient throughput (MAX_WORK_DRAW, the "knee"), then keeps rising on a
  // much shallower slope — so an overpressured boiler can be held in the
  // redline band for a while (wearing the machine) instead of instantly
  // running away to explosion.
  const overRun = Math.max(0, state.pressure - c.RUN_THRESHOLD);
  const kneeOverRun = c.MAX_WORK_DRAW / c.WORK_DRAW_COEFF;
  const workDraw =
    overRun <= kneeOverRun
      ? overRun * c.WORK_DRAW_COEFF
      : c.MAX_WORK_DRAW + (overRun - kneeOverRun) * c.WORK_DRAW_COEFF_HIGH;
  state.pressure += (steamRate - c.LEAKAGE - workDraw) * dt;
  state.pressure = clamp(state.pressure, 0, c.MAX_PRESSURE);

  // Producing steam draws down the water in the boiler.
  state.boilerWater = clamp(
    state.boilerWater - steamRate * c.WATER_CONSUMPTION_RATE * dt,
    0,
    100,
  );

  // Machine speed follows pressure above the run threshold; distance (the
  // score) is its integral.
  state.machineSpeed =
    state.pressure > c.RUN_THRESHOLD
      ? (state.pressure - c.RUN_THRESHOLD) * c.SPEED_PER_BAR
      : 0;
  state.distance += state.machineSpeed * dt;

  // Wear builds while pressure is over the redline and recovers slowly below.
  if (state.pressure > c.REDLINE_PRESSURE) {
    state.wear += (state.pressure - c.REDLINE_PRESSURE) * c.WEAR_RATE * dt;
  } else {
    state.wear = Math.max(0, state.wear - c.WEAR_RECOVERY * dt);
  }

  // Track how long the machine has been stopped. Any movement resets it.
  if (state.machineSpeed <= 0) {
    state.stalledTime += dt;
  } else {
    state.stalledTime = 0;
  }

  state.elapsedTime += dt;

  // End conditions. Checked after the update so the killing tick still counts
  // toward the score.
  if (state.pressure >= c.MAX_PRESSURE) {
    state.gameOver = true;
    state.causeOfDeath = "explosion";
  } else if (state.temperature >= c.MAX_TEMP) {
    state.gameOver = true;
    state.causeOfDeath = "meltdown";
  } else if (state.wear >= c.WEAR_MAX) {
    // Ran it too hard for too long — the machine shakes itself apart even
    // though pressure never reached the explosion point.
    state.gameOver = true;
    state.causeOfDeath = "breakdown";
  } else if (state.stalledTime >= c.STALL_TIMEOUT) {
    // The machine sat stopped too long: never got going, or ran its supplies
    // dry and coasted to a halt.
    state.gameOver = true;
    state.causeOfDeath = "stall";
  }

  return state;
}
