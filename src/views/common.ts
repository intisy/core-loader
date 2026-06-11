// @ts-nocheck
// Shared view helpers: status message, spinner, hint bar, and the confirm/help
// overlays. flash/scheduleRender drive redraws via render().

import { RST, BOLD, DIM, GRAY, WHITE, GREEN, CYAN, MAGENTA, trunc, pad } from "../format.js";
import { S } from "../state.js";
import { HELP_BINDINGS, SPINNER_FRAMES } from "../env.js";
import { render } from "./render.js";

export function flash(msg) {
  S.message = msg;
  if (S.msgTimeout) clearTimeout(S.msgTimeout);
  S.msgTimeout = setTimeout(function() { S.message = ""; render(); }, 2500);
}

// async catalog fetches arrive in bursts — coalesce their redraws
export function scheduleRender() {
  if (S.renderTimer) return;
  S.renderTimer = setTimeout(function() { S.renderTimer = null; render(); }, 120);
}

export function hints(pairs) {
  return "  " + pairs.map(function(p) { return DIM + p[0] + RST + " " + p[1]; }).join("  ");
}

export function spinnerFrame() { return CYAN + SPINNER_FRAMES[S.spinnerTick % SPINNER_FRAMES.length] + RST; }

export function updateSpinner() {
  var active = S.catalogPending > 0 || (S.message && S.message.indexOf("...") !== -1);
  if (active && !S.spinnerTimer) {
    S.spinnerTimer = setInterval(function() { S.spinnerTick++; render(); }, 120);
  } else if (!active && S.spinnerTimer) {
    clearInterval(S.spinnerTimer);
    S.spinnerTimer = null;
  }
}

export function messageLine(cols) {
  var prefix = S.message.indexOf("...") !== -1 ? spinnerFrame() + " " : "  ";
  return "  " + GREEN + prefix + trunc(S.message, cols - 6) + RST;
}

export function buildConfirm(pushBody, pushFoot, cols, barW) {
  pushBody("  " + MAGENTA + "#" + GRAY + " Confirm" + RST, false);
  pushBody("", false);
  pushBody("  " + BOLD + WHITE + trunc(S.confirmLabel, cols - 4) + RST, false);
  pushBody("", false);
  var opts = ["Yes", "Cancel"];
  for (var i = 0; i < opts.length; i++) {
    if (i === S.confirmCursor) {
      pushBody("    " + GREEN + "  > " + BOLD + opts[i] + RST, true);
    } else {
      pushBody("    " + GRAY + "    " + opts[i] + RST, false);
    }
  }
  pushBody("", false);
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Y", "Yes"], ["N/Esc", "Cancel"]]));
}

export function buildHelp(pushBody, pushFoot, cols, barW) {
  var binds = HELP_BINDINGS[S.page] || [];
  pushBody("  " + MAGENTA + "#" + GRAY + " Keyboard shortcuts" + RST, false);
  pushBody("", false);
  for (var i = 0; i < binds.length; i++) {
    pushBody("    " + BOLD + WHITE + pad(binds[i][0], 16) + RST + GRAY + binds[i][1] + RST, false);
  }
  pushBody("", false);
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  pushFoot(hints([["Any key", "Close"]]));
}
