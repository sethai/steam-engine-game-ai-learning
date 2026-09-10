// ui.js — rendering the gauges/dials and wiring player input.
//
// This is the only module that touches the DOM. It reads a simulation state
// object (see simulation.js) and pushes it onto the page; it never mutates the
// state itself. Input handlers just forward to callbacks supplied by main.js.

import { CONSTANTS, canAddWater, canAddCoal, canVent } from "./simulation.js";

// Machine speed's display ceiling: the speed at the explosion pressure.
const MAX_MACHINE_SPEED =
  (CONSTANTS.MAX_PRESSURE - CONSTANTS.RUN_THRESHOLD) * CONSTANTS.SPEED_PER_BAR;

// Pressure at the machine's efficient-throughput "knee" (see WORK_DRAW in
// simulation.js). Below it the engine absorbs steam efficiently; above it extra
// pressure buys little speed and drains supplies faster.
const KNEE_PRESSURE =
  CONSTANTS.RUN_THRESHOLD + CONSTANTS.MAX_WORK_DRAW / CONSTANTS.WORK_DRAW_COEFF;

// Display-only: below this pressure the machine turns over but barely adds
// speed (the low "warn" band on the dial). Not a physics constant.
const PRESSURE_EFFECTIVE = 6;

const speedAt = (bar) => (bar - CONSTANTS.RUN_THRESHOLD) * CONSTANTS.SPEED_PER_BAR;

// --- Analog arc dials (pressure, machine speed) -------------------------------
// Geometry of the dial SVG (viewBox 0 0 120 100). The arc sweeps SWEEP degrees
// starting at START (clockwise, SVG y-down): bottom-left -> top -> bottom-right.
const D = { CX: 60, CY: 55, R: 42, STROKE: 11, START: 140, SWEEP: 260 };

// Each dial: contiguous colour zones given by their upper bound in value units
// (the first starts at 0). `level` maps to the shared ok/warn/danger palette.
const DIALS = {
  pressure: {
    max: CONSTANTS.MAX_PRESSURE,
    unit: "bar",
    format: (v) => v.toFixed(1),
    zones: [
      { to: CONSTANTS.RUN_THRESHOLD, level: "danger" }, // stopped — stall risk
      { to: PRESSURE_EFFECTIVE, level: "warn" }, //          moving but weak
      { to: KNEE_PRESSURE, level: "ok" }, //                 efficient band
      { to: CONSTANTS.REDLINE_PRESSURE, level: "warn" }, //  thirsty, past the knee
      { to: CONSTANTS.MAX_PRESSURE, level: "danger" }, //    wearing / about to blow
    ],
  },
  machineSpeed: {
    max: MAX_MACHINE_SPEED,
    unit: "m/s",
    format: (v) => `${Math.round(v)}`,
    zones: [
      { to: speedAt(KNEE_PRESSURE), level: "ok" }, //        safe working speed
      { to: speedAt(CONSTANTS.REDLINE_PRESSURE), level: "warn" }, // getting fast
      { to: MAX_MACHINE_SPEED, level: "danger" }, //         too fast — will break
    ],
  },
};

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [D.CX + r * Math.cos(a), D.CY + r * Math.sin(a)];
}

// SVG path for the arc between two 0..1 fractions of the sweep.
function arcPath(r, f1, f2) {
  const [x1, y1] = polar(r, D.START + f1 * D.SWEEP);
  const [x2, y2] = polar(r, D.START + f2 * D.SWEEP);
  const large = (f2 - f1) * D.SWEEP > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function buildDialSvg(config) {
  let f0 = 0;
  const arcs = config.zones
    .map((z) => {
      const seg = `<path class="dial-zone level-${z.level}" fill="none" stroke-width="${D.STROKE}" d="${arcPath(D.R, f0, z.to / config.max)}" />`;
      f0 = z.to / config.max;
      return seg;
    })
    .join("");

  const bounds = [0, ...config.zones.map((z) => z.to / config.max)];
  const ticks = bounds
    .map((f) => {
      const [x1, y1] = polar(D.R + D.STROKE / 2, D.START + f * D.SWEEP);
      const [x2, y2] = polar(D.R - D.STROKE / 2, D.START + f * D.SWEEP);
      return `<line class="dial-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`;
    })
    .join("");

  const [lx, ly] = polar(D.R + 9, D.START);
  const [hx, hy] = polar(D.R + 9, D.START + D.SWEEP);

  return `<svg viewBox="0 0 120 100" class="dial-face" role="img">
    ${arcs}${ticks}
    <text class="dial-end" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">0</text>
    <text class="dial-end" x="${hx.toFixed(1)}" y="${hy.toFixed(1)}">${config.max}</text>
    <line class="dial-needle level-ok" x1="${D.CX}" y1="${D.CY}" x2="${D.CX + D.R - 6}" y2="${D.CY}" transform="rotate(${D.START} ${D.CX} ${D.CY})" />
    <circle class="dial-hub" cx="${D.CX}" cy="${D.CY}" r="3.5" />
    <text class="dial-num level-ok" x="${D.CX}" y="${D.CY + 13}" text-anchor="middle">0</text>
    <text class="dial-unit" x="${D.CX}" y="${D.CY + 23}" text-anchor="middle">${config.unit}</text>
  </svg>`;
}

// Which zone's level applies to `value` (first zone whose upper bound covers it).
function levelOf(config, value) {
  for (const z of config.zones) {
    if (value <= z.to) return z.level;
  }
  return config.zones[config.zones.length - 1].level;
}

// --- Bar gauges (everything else) -------------------------------------------
const GAUGES = {
  wear: {
    max: CONSTANTS.WEAR_MAX,
    format: (v) => `${Math.round((v / CONSTANTS.WEAR_MAX) * 100)}%`,
    level: (v) => {
      if (v >= CONSTANTS.WEAR_MAX * 0.75) return "danger";
      if (v >= CONSTANTS.WEAR_MAX * 0.4) return "warn";
      return "ok";
    },
  },
  temperature: {
    max: CONSTANTS.MAX_TEMP,
    format: (v) => `${Math.round(v)} °C`,
    level: (v) => {
      if (v >= CONSTANTS.MAX_TEMP * 0.92) return "danger";
      if (v >= CONSTANTS.MAX_TEMP * 0.8) return "warn";
      return "ok";
    },
  },
  boilerWater: {
    max: 100,
    format: (v) => `${Math.round(v)}%`,
    // Two-sided: both a near-empty and a flooded boiler are bad (they push the
    // heat-loss term out of its normal band and choke steam production).
    level: (v) => {
      if (v < 10 || v > 92) return "danger";
      if (v < CONSTANTS.LOW_WATER_THRESHOLD || v > CONSTANTS.HIGH_WATER_THRESHOLD) {
        return "warn";
      }
      return "ok";
    },
  },
  fire: {
    // No hard max in the model; pick a display ceiling that a healthy fire sits
    // comfortably under. Fire is not a death gauge, so it never bands red.
    max: 40,
    format: (v) => `${Math.round(v)}`,
    level: () => "ok",
  },
  waterSupply: {
    max: CONSTANTS.START_WATER_SUPPLY,
    format: (v) => `${Math.round(v)}`,
    level: (v) => (v <= 10 ? "danger" : v <= 25 ? "warn" : "ok"),
  },
  coalSupply: {
    max: CONSTANTS.START_COAL_SUPPLY,
    format: (v) => `${Math.round(v)}`,
    level: (v) => (v <= 10 ? "danger" : v <= 25 ? "warn" : "ok"),
  },
};

// Human-readable death screens, keyed by state.causeOfDeath.
const DEATHS = {
  explosion: {
    headline: "Explosion",
    detail: "Pressure hit the top of the gauge and the boiler let go.",
  },
  meltdown: {
    headline: "Meltdown",
    detail: "Temperature pushed past the red line and the engine melted down.",
  },
  breakdown: {
    headline: "Breakdown",
    detail: "You ran it too hard for too long — the machine shook itself apart.",
  },
  stall: {
    headline: "Stalled out",
    detail: "The machine sat still too long and seized up — out of fuel, or never got going.",
  },
};

// Cache DOM references once.
const dom = {
  distance: document.getElementById("distance"),
  elapsed: document.getElementById("elapsed"),
  stallWarning: document.getElementById("stall-warning"),
  addWaterBtn: document.getElementById("add-water-btn"),
  addCoalBtn: document.getElementById("add-coal-btn"),
  ventBtn: document.getElementById("vent-btn"),
  waterCooldown: document.getElementById("water-cooldown"),
  coalCooldown: document.getElementById("coal-cooldown"),
  ventCooldown: document.getElementById("vent-cooldown"),
  deathScreen: document.getElementById("death-screen"),
  deathCause: document.getElementById("death-cause"),
  deathDetail: document.getElementById("death-detail"),
  restartBtn: document.getElementById("restart-btn"),
  dials: {},
  gauges: {},
};

for (const [key, config] of Object.entries(DIALS)) {
  const host = document.querySelector(`#dial-${key} .dial-svg`);
  host.innerHTML = buildDialSvg(config);
  dom.dials[key] = {
    config,
    needle: host.querySelector(".dial-needle"),
    num: host.querySelector(".dial-num"),
  };
}

for (const key of Object.keys(GAUGES)) {
  const container = document.getElementById(`gauge-${key}`);
  dom.gauges[key] = {
    container,
    fill: container.querySelector(".gauge-fill"),
    value: container.querySelector(".gauge-value"),
  };
}

function clampPercent(n) {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

// Push the current state onto the dials and bar gauges.
export function renderGauges(state) {
  const dialValues = {
    pressure: state.pressure,
    machineSpeed: state.machineSpeed,
  };
  for (const [key, d] of Object.entries(dom.dials)) {
    const v = dialValues[key];
    const frac = Math.max(0, Math.min(1, v / d.config.max));
    const deg = D.START + frac * D.SWEEP;
    const level = levelOf(d.config, v);
    d.needle.setAttribute("transform", `rotate(${deg.toFixed(2)} ${D.CX} ${D.CY})`);
    d.needle.setAttribute("class", `dial-needle level-${level}`);
    d.num.textContent = d.config.format(v);
    d.num.setAttribute("class", `dial-num level-${level}`);
  }

  const barValues = {
    wear: state.wear,
    temperature: state.temperature,
    boilerWater: state.boilerWater,
    fire: state.fireCoal,
    waterSupply: state.waterSupply,
    coalSupply: state.coalSupply,
  };
  for (const [key, config] of Object.entries(GAUGES)) {
    const raw = barValues[key];
    const els = dom.gauges[key];
    els.fill.style.width = `${clampPercent((raw / config.max) * 100)}%`;
    els.value.textContent = config.format(raw);

    const level = config.level(raw);
    els.container.classList.toggle("warn", level === "warn");
    els.container.classList.toggle("danger", level === "danger");
  }

  // Stall warning: the machine isn't moving (pressure below RUN_THRESHOLD). Not
  // lethal on its own, but if it stays stopped for STALL_TIMEOUT seconds the run
  // ends — show the countdown once that timer is running.
  const stalling = !state.gameOver && state.machineSpeed <= 0;
  dom.stallWarning.hidden = !stalling;
  if (stalling) {
    if (state.stalledTime > 0) {
      const secondsLeft = Math.max(0, CONSTANTS.STALL_TIMEOUT - state.stalledTime);
      dom.stallWarning.textContent = `STALL WARNING — ${Math.ceil(secondsLeft)}s to seize`;
    } else {
      dom.stallWarning.textContent = "STALL WARNING — machine stopped";
    }
  }
}

// Update the score line and the action buttons (enabled state + cooldown text).
export function renderHUD(state) {
  dom.distance.textContent = Math.round(state.distance).toLocaleString();
  dom.elapsed.textContent = state.elapsedTime.toFixed(1);

  dom.addWaterBtn.disabled = !canAddWater(state);
  dom.addCoalBtn.disabled = !canAddCoal(state);
  dom.ventBtn.disabled = !canVent(state);

  dom.waterCooldown.textContent =
    state.waterCooldown > 0 ? `${state.waterCooldown.toFixed(1)}s` : "";
  dom.coalCooldown.textContent =
    state.coalCooldown > 0 ? `${state.coalCooldown.toFixed(1)}s` : "";
  dom.ventCooldown.textContent =
    state.ventCooldown > 0 ? `${state.ventCooldown.toFixed(1)}s` : "";
}

export function showDeathScreen(state) {
  const death = DEATHS[state.causeOfDeath] ?? { headline: "Game over", detail: "" };
  dom.deathCause.textContent = death.headline;
  dom.deathDetail.textContent =
    `${death.detail} You travelled ${Math.round(state.distance).toLocaleString()} m ` +
    `in ${state.elapsedTime.toFixed(0)} seconds.`;
  dom.deathScreen.hidden = false;
}

export function hideDeathScreen() {
  dom.deathScreen.hidden = true;
}

// Wire buttons and the W / C / V keys to the supplied callbacks. Called once at
// startup by main.js.
export function bindControls({ onAddWater, onAddCoal, onVent, onRestart }) {
  dom.addWaterBtn.addEventListener("click", onAddWater);
  dom.addCoalBtn.addEventListener("click", onAddCoal);
  dom.ventBtn.addEventListener("click", onVent);
  dom.restartBtn.addEventListener("click", onRestart);

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return; // holding the key should not machine-gun the action
    const key = event.key.toLowerCase();
    if (key === "w") onAddWater();
    else if (key === "c") onAddCoal();
    else if (key === "v") onVent();
  });
}
