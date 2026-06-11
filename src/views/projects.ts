// @ts-nocheck
// Projects page rendering: each project row, the "open here" row, and the
// full projects view with its action menu and footer.

import { RST, BOLD, DIM, GRAY, WHITE, YELLOW, GREEN, CYAN, BLUE, BG_SEL, pad, trunc, timeAgo } from "../format.js";
import { S } from "../state.js";
import { APP_NAME } from "../env.js";
import { getActions, shortPath } from "../projects.js";
import { hints, messageLine } from "./common.js";

export function buildProjectItem(pushBody, i, item, nameW, cols, isSelected) {
  var sel = i === S.cursor;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;
  var sessStr = GRAY + pad(item.sessions + " sess", 8) + RST;
  var timeStr = GRAY + pad(timeAgo(item.lastUsed), 9) + RST;
  var pinMark = item.pinned ? (YELLOW + " *" + RST) : "";

  pushBody("  " + bg + arrow + nameStyle + pad(trunc(item.name, nameW), nameW) + RST + bg + sessStr + timeStr + pinMark + RST, isSelected);

  if (sel && (S.mode === "list" || S.mode === "actions")) {
    pushBody("  " + GRAY + "     " + trunc(shortPath(item.dir), cols - 10) + RST, isSelected);
  }

  if (sel && S.mode === "actions") {
    pushBody("", isSelected);
    var acts = getActions(item);
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      var aSel = j === S.acursor;
      var lbl = trunc(a.label, cols - 12);
      if (aSel) {
        pushBody("    " + GREEN + "  > " + BOLD + lbl + RST, isSelected);
      } else {
        pushBody("    " + GRAY + "    " + lbl + RST, isSelected);
      }
    }
    pushBody("", isSelected);
  }
}

export function buildOpenHereItem(pushBody) {
  var sel = S.cursor === S.items.length;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;
  pushBody("  " + bg + arrow + nameStyle + "Open " + APP_NAME + " here" + RST + bg + "  " + GRAY + process.cwd() + RST, sel);
}

export function buildProjects(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(16, cols - 36));

  if (S.items.length === 0) {
    pushBody("  " + GRAY + "No projects found." + RST, false);
    pushBody("  " + GRAY + "Use " + APP_NAME + " in a directory first, then come back." + RST, false);
    pushBody("", false);
    buildOpenHereItem(pushBody);
    pushBody("", false);

    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["Enter", "Select"], ["U", "Unhide all"], ["Q", "Quit"]]));
    return;
  }

  var pinnedCount = 0;
  for (var i = 0; i < S.items.length; i++) { if (S.items[i].pinned) pinnedCount++; }
  var recentCount = S.items.length - pinnedCount;

  if (pinnedCount > 0) {
    pushBody("  " + YELLOW + "*" + GRAY + " Pinned" + RST, false);
    for (var i = 0; i < pinnedCount; i++) {
      buildProjectItem(pushBody, i, S.items[i], nameW, cols, i === S.cursor);
    }
  }

  if (pinnedCount > 0 && recentCount > 0) pushBody("", false);

  if (recentCount > 0) {
    var countLabel = recentCount > 0 ? " (" + recentCount + ")" : "";
    pushBody("  " + BLUE + "~" + GRAY + " Recent" + countLabel + RST, false);
    for (var i = pinnedCount; i < S.items.length; i++) {
      buildProjectItem(pushBody, i, S.items[i], nameW, cols, i === S.cursor);
    }
  }

  pushBody("", false);
  buildOpenHereItem(pushBody);
  pushBody("", false);

  if (S.message) {
    pushFoot(messageLine(cols));
  }
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  
  if (S.mode === "input") {
    var inputLabel = S.chpathDir ? "New path: " : "Path: ";
    var maxInput = Math.max(10, cols - 15 - inputLabel.length);
    var displayInput = S.inputBuf.length > maxInput ? "…" + S.inputBuf.substring(S.inputBuf.length - maxInput + 1) : S.inputBuf;
    pushFoot("  " + CYAN + inputLabel + RST + displayInput + BOLD + "|" + RST);
    pushFoot(hints([["Enter", "Confirm"], ["Esc", "Cancel"]]));
  } else if (S.mode === "list") {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["O", "Open"], ["?", "Help"], ["Q", "Quit"]]));
  } else {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
  }
}

