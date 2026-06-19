// @ts-nocheck
// MCP page rendering: installed / marketplace sub-pages and the action menu.

import { RST, BOLD, DIM, GRAY, WHITE, YELLOW, GREEN, MAGENTA, CYAN, BG_SEL, stringWidth, pad, trunc } from "../format.js";
import { S } from "../state.js";
import { getInstalledMcpList, buildMcpList, getMcpActions } from "../mcp.js";
import { hints, messageLine } from "./common.js";

export function buildMcp(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(18, cols - 50));

  if (S.mcpMode === "actions") {
    var mitem = S.mcpSubPage === "installed" ? getInstalledMcpList()[S.mcpCursor] : S.mcpItems[S.mcpCursor];
    if (!mitem) { S.mcpMode = "catalog"; return; }
    var acts = getMcpActions(mitem);
    pushBody("  " + BOLD + WHITE + "" + mitem.name + RST, false);
    pushBody("  " + GRAY + (mitem.desc || mitem.command + " " + (mitem.args || []).join(" ")) + RST, false);
    var envKeys = Object.keys(mitem.env || {});
    if (envKeys.length > 0) {
      pushBody("  " + GRAY + "Env: " + envKeys.join(", ") + RST, false);
    }
    pushBody("", false);
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      var aSel = j === S.mcpAcursor;
      if (aSel) {
        pushBody("    " + GREEN + "  > " + BOLD + a.label + RST, true);
      } else {
        pushBody("    " + GRAY + "    " + a.label + RST, false);
      }
    }
    pushBody("", false);
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
    return;
  }

  var mcpInstTab = S.mcpSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);
  var mcpMktTab = S.mcpSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);
  pushBody("  " + mcpInstTab + "  " + mcpMktTab + "    " + DIM + "Tab" + RST + " switch", false);
  pushBody("", false);

  if (S.mcpSubPage === "installed") {
    var installedList = getInstalledMcpList();
    if (installedList.length === 0) {
      pushBody("  " + GRAY + "No MCP servers installed." + RST, false);
      pushBody("  " + GRAY + "Switch to Marketplace to browse and install servers." + RST, false);
    } else {
      pushBody("  " + BOLD + WHITE + "Installed MCP Servers (" + installedList.length + ")" + RST, false);
      for (var i = 0; i < installedList.length; i++) {
        var m = installedList[i];
        var sel = i === S.mcpCursor;
        var arrow = sel ? (YELLOW + " > " + RST) : "   ";
        var bg = sel ? BG_SEL : "";
        var nameStyle = sel ? (BOLD + WHITE) : DIM;
        pushBody("  " + bg + arrow + GREEN + "\u25cf" + RST + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + m.command + " " + (m.args || []).join(" ") + RST, sel);
        if (sel) {
          var ek = Object.keys(m.env || {});
          if (ek.length > 0) pushBody("  " + GRAY + "     env: " + ek.join(", ") + RST, sel);
        }
      }
    }
    pushBody("", false);
    if (S.message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
  } else {
    // Marketplace
    S.mcpItems = buildMcpList("All");
    pushBody("  " + BOLD + WHITE + "MCP Marketplace (" + S.mcpItems.length + " available)" + (S.mode === "search" || S.inputBuf ? " " + BG_SEL + " Search: " + S.inputBuf + (S.mode === "search" ? "_" : "") + " " + RST : " " + DIM + "(press / to search)" + RST) + "  " + CYAN + "✦" + RST + DIM + " = curated" + RST, false);
    for (var i = 0; i < S.mcpItems.length; i++) {
      var m = S.mcpItems[i];
      var sel = i === S.mcpCursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      var statusIcon = m.installed ? (GREEN + "\u25cf" + RST) : (GRAY + "\u25cb" + RST);
      // ✦ marks hand-picked entries; non-curated get 2 spaces to keep columns aligned
      var curatedMark = m.curated ? (CYAN + "✦ " + RST) : "  ";
      var starRaw = m.stars != null ? " ★" + m.stars : "";
      var starVis = starRaw.length;
      var usedW = 2 + 3 + 2 + 2 + nameW + 2 + starVis;
      var descW = Math.max(10, cols - usedW - 2);
      var descText = trunc((m.desc||"").replace(/\r?\n/g, " "), descW);
      var descVis = stringWidth(descText);
      var gapW = Math.max(1, cols - usedW - descVis);
      var starStr = starRaw ? (YELLOW + " ".repeat(gapW) + "★" + m.stars + RST) : "";
      pushBody("  " + bg + arrow + statusIcon + " " + curatedMark + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + descText + RST + starStr + RST, sel);
      if (sel) {
        pushBody("  " + GRAY + "     " + m.command + " " + (m.args || []).join(" ") + RST, sel);
        var ek = Object.keys(m.env || {});
        if (ek.length > 0) pushBody("  " + GRAY + "     env: " + ek.join(", ") + RST, sel);
      }
    }
    pushBody("", false);
    if (S.message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["/", "Search"], ["?", "Help"], ["Q", "Quit"]]));
  }
}

