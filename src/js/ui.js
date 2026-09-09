// ui.js — rendering the gauges and wiring player input.
//
// This is the only module that touches the DOM. It reads a simulation state
// object (see simulation.js) and pushes it onto the page; it never mutates the
// state itself. Input handlers just forward to callbacks supplied by main.js.

import { CONSTANTS, canAddWater, canAddCoal } from "./simulation.js";

// Per-gauge display config. `max` scales the bar to 0..100% width. `format`
// turns the raw number into label text. `level` returns "ok" | "warn" |
// "danger" so the CSS can band it. Thresholds are expressed relative to the
// physics constants so they stay in sync with docs/GAME_DESIGN.md.
const GAUGES = {
  pressure: {
    max: CONSTANTS.MAX_PRESSURE,
    format: (v) => `${v.toFixed(1)} bar`,
    level: (v) => {
      if (v >= CONSTANTS.MAX_PRESSURE * 0.86) return "danger";
      if (v >= CONSTANTS.MAX_PRESSURE * 0.73) return "warn";
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
    detail: "Pressure pushed past the red line and the boiler let go.",
  },
  meltdown: {
    headline: "Meltdown",
    detail: "Temperature pushed past the red line and the engine melted down.",
  },
  starvation: {
    headline: "Stalled out",
    detail: "The machine sat at zero pressure until it seized — out of fuel, or never lit.",
  },
};

// Cache DOM references once. `gauges[key]` holds the elements for one gauge.
const dom = {
  elapsed: document.getElementById("elapsed"),
  stallWarning: document.getElementById("stall-warning"),
  addWaterBtn: document.getElementById("add-water-btn"),
  addCoalBtn: document.getElementById("add-coal-btn"),
  waterCooldown: document.getElementById("water-cooldown"),
  coalCooldown: document.getElementById("coal-cooldown"),
  deathScreen: document.getElementById("death-screen"),
  deathCause: document.getElementById("death-cause"),
  deathDetail: document.getElementById("death-detail"),
  restartBtn: document.getElementById("restart-btn"),
  gauges: {},
};

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

// Push the current state onto all six gauges.
export function renderGauges(state) {
  const values = {
    pressure: state.pressure,
    temperature: state.temperature,
    boilerWater: state.boilerWater,
    fire: state.fireCoal,
    waterSupply: state.waterSupply,
    coalSupply: state.coalSupply,
  };

  for (const [key, config] of Object.entries(GAUGES)) {
    const raw = values[key];
    const els = dom.gauges[key];
    els.fill.style.width = `${clampPercent((raw / config.max) * 100)}%`;
    els.value.textContent = config.format(raw);

    const level = config.level(raw);
    els.container.classList.toggle("warn", level === "warn");
    els.container.classList.toggle("danger", level === "danger");
  }

  // Stall warning. Low pressure on its own is not lethal, but a machine left at
  // exactly zero pressure seizes after STALL_TIMEOUT seconds — once that timer
  // is running, show the countdown (docs/GAME_DESIGN.md "Note on stall").
  const stalling = !state.gameOver && state.pressure < CONSTANTS.STALL_WARNING_PRESSURE;
  dom.stallWarning.hidden = !stalling;
  if (stalling) {
    if (state.zeroPressureTime > 0) {
      const secondsLeft = Math.max(0, CONSTANTS.STALL_TIMEOUT - state.zeroPressureTime);
      dom.stallWarning.textContent = `STALL WARNING — ${Math.ceil(secondsLeft)}s to seize`;
    } else {
      dom.stallWarning.textContent = "STALL WARNING — pressure very low";
    }
  }
}

// Update the clock and the two action buttons (enabled state + cooldown text).
export function renderHUD(state) {
  dom.elapsed.textContent = state.elapsedTime.toFixed(1);

  dom.addWaterBtn.disabled = !canAddWater(state);
  dom.addCoalBtn.disabled = !canAddCoal(state);

  dom.waterCooldown.textContent =
    state.waterCooldown > 0 ? `${state.waterCooldown.toFixed(1)}s` : "";
  dom.coalCooldown.textContent =
    state.coalCooldown > 0 ? `${state.coalCooldown.toFixed(1)}s` : "";
}

export function showDeathScreen(state) {
  const death = DEATHS[state.causeOfDeath] ?? {
    headline: "Game over",
    detail: "",
  };
  dom.deathCause.textContent = death.headline;
  dom.deathDetail.textContent =
    `${death.detail} You kept it running for ${state.elapsedTime.toFixed(1)} seconds.`.trim();
  dom.deathScreen.hidden = false;
}

export function hideDeathScreen() {
  dom.deathScreen.hidden = true;
}

// Wire buttons and the W / C keys to the supplied callbacks. Called once at
// startup by main.js.
export function bindControls({ onAddWater, onAddCoal, onRestart }) {
  dom.addWaterBtn.addEventListener("click", onAddWater);
  dom.addCoalBtn.addEventListener("click", onAddCoal);
  dom.restartBtn.addEventListener("click", onRestart);

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return; // holding the key should not machine-gun the action
    const key = event.key.toLowerCase();
    if (key === "w") onAddWater();
    else if (key === "c") onAddCoal();
  });
}
