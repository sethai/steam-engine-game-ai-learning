// main.js — entry point and game loop.
//
// Owns the single mutable state object, runs a fixed-timestep simulation loop
// driven by requestAnimationFrame, and hands rendering + input off to ui.js.

import {
  CONSTANTS,
  createInitialState,
  step,
  addWater,
  addCoal,
} from "./simulation.js";
import {
  renderGauges,
  renderHUD,
  showDeathScreen,
  hideDeathScreen,
  bindControls,
} from "./ui.js";

let state = createInitialState();

// Fixed-timestep bookkeeping. We accumulate real elapsed time and spend it in
// whole FIXED_DT chunks, so the physics always advances by the same step
// regardless of frame rate (docs/GAME_DESIGN.md "Open questions": fixed timestep).
let accumulator = 0;
let lastFrameTime = null;
let deathScreenVisible = false;

function startRun() {
  state = createInitialState();
  accumulator = 0;
  lastFrameTime = null; // let the next frame re-establish the time baseline
  deathScreenVisible = false;
  hideDeathScreen();
}

function frame(now) {
  if (lastFrameTime === null) lastFrameTime = now;
  let frameSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  // If the tab was backgrounded (or we paused on a breakpoint) the gap can be
  // huge; clamp it so we don't fast-forward the whole run in one frame.
  if (frameSeconds > 0.25) frameSeconds = 0.25;

  accumulator += frameSeconds;
  while (accumulator >= CONSTANTS.FIXED_DT) {
    step(state, CONSTANTS.FIXED_DT);
    accumulator -= CONSTANTS.FIXED_DT;
    if (state.gameOver) {
      accumulator = 0;
      break;
    }
  }

  renderGauges(state);
  renderHUD(state);

  if (state.gameOver && !deathScreenVisible) {
    showDeathScreen(state);
    deathScreenVisible = true;
  }

  requestAnimationFrame(frame);
}

bindControls({
  onAddWater: () => addWater(state),
  onAddCoal: () => addCoal(state),
  onRestart: startRun,
});

requestAnimationFrame(frame);
