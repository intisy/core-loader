// @ts-nocheck
// Plugins page rendering: plugin rows (git + npm + engine), the installed /
// marketplace / custom sub-pages, and the action/commit menus.

import { RST, BOLD, DIM, GRAY, WHITE, YELLOW, GREEN, CYAN, RED, MAGENTA, BG_SEL, stringWidth, pad, trunc } from "../format.js";
import { S } from "../state.js";
import { loadPlugins } from "../config.js";
import { loadNpmPlugins, getUpdater } from "../updater.js";
import { getPluginActions } from "../plugins.js";
import { hints, messageLine, spinnerFrame } from "./common.js";

export function buildPluginItem(pushBody, i, pitem, nameW, cols, isSelected) {
  var sel = i === S.pcursor;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;

  // NPM plugins: simpler read-only row
  if (pitem.type === "npm") {
    var nvstr = pitem.version ? (GRAY + "v" + pitem.version + RST) : (GRAY + "not installed" + RST);
    var typeLabel = pitem.engine ? (MAGENTA + "engine" + RST) : (CYAN + "npm" + RST);
    pushBody("  " + bg + arrow + nameStyle + pad(trunc(pitem.name, nameW), nameW) + RST + bg + " " + typeLabel + "  " + nvstr + RST, isSelected);
    if (sel) {
      var subInfo = GRAY + "     " + (pitem.engine ? "manages plugin installs and updates" : "managed via npm (opencode.json)") + RST;
      pushBody("  " + subInfo, isSelected);
    }
    return;
  }

  var statusParts = [];
  if (!pitem.enabled) {
    statusParts.push(RED + "disabled" + RST);
  } else if (pitem.autoUpdate) {
    statusParts.push(GREEN + "auto" + RST);
  } else {
    statusParts.push(YELLOW + "manual" + RST);
  }
  if (pitem.enabled) {
    if (pitem.updateAvail) {
      statusParts.push(CYAN + "UPDATE" + RST);
    } else if (pitem.deployed) {
      statusParts.push(GRAY + "ok" + RST);
    } else {
      statusParts.push(RED + "missing" + RST);
    }
  }

  var statusStr = statusParts.join(GRAY + " | " + RST);
  var versionStr = pitem.latestTag
    ? (GRAY + pitem.latestTag + RST)
    : (pitem.localHead ? (DIM + pitem.localHead.substring(0, 7) + RST) : (GRAY + "---" + RST));

  pushBody("  " + bg + arrow + nameStyle + pad(trunc(pitem.name, nameW), nameW) + RST + bg + " " + statusStr + "  " + versionStr + RST, isSelected);

  if (sel) {
    var subInfo = GRAY + "     " + trunc(pitem.subject || pitem.url, cols - 10) + RST;
    pushBody("  " + subInfo, isSelected);
  }

}

export function buildPlugins(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(32, Math.max(20, cols - 44));

  var plugins = loadPlugins();
  var hasUpdater = plugins.some(function(p) { return p.name.includes("updater") || (p.url && p.url.includes("updater")); })
    || loadNpmPlugins().some(function(p) { return p.name.includes("updater"); })
    || !!getUpdater();
  
  if (!hasUpdater) {
    if (process.env.CC_LAUNCHER === "1") {
      pushBody("  " + BOLD + RED + "Updater Plugin Missing" + RST, false);
      pushBody("  The hub requires an updater plugin to manage installations.", false);
      pushBody("", false);
      pushBody("  Press " + BOLD + WHITE + "Enter" + RST + " to install the default updater plugin.", false);
      pushBody("", false);
      pushFoot("  " + GRAY + "-".repeat(barW) + RST);
      pushFoot("  " + DIM + "Enter" + RST + " Install  " + DIM + "Q" + RST + " Quit");
      S.globalKeyHandler = "updater_install";
      return;
    } else {
      // OC mode: same interactive install prompt as CC mode
      pushBody("  " + BOLD + RED + "Updater Plugin Missing" + RST, false);
      pushBody("  The hub requires an updater plugin to manage installations.", false);
      pushBody("", false);
      pushBody("  Press " + BOLD + WHITE + "Enter" + RST + " to install the default updater plugin.", false);
      pushBody("", false);
      pushFoot("  " + GRAY + "-".repeat(barW) + RST);
      pushFoot("  " + DIM + "Enter" + RST + " Install  " + DIM + "Q" + RST + " Quit");
      S.globalKeyHandler = "updater_install";
      return;
    }
  } else {
    if (S.globalKeyHandler === "updater_install") S.globalKeyHandler = null;
  }

  if (S.mode === "pcommits") {
    pushBody("  " + MAGENTA + "#" + GRAY + " Select commit for " + S.pluginItems[S.pcursor].name + RST, false);
    for (var i = 0; i < S.commitItems.length; i++) {
      var c = S.commitItems[i];
      var sel = i === S.ccursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      pushBody("  " + bg + arrow + nameStyle + c.hash + RST + bg + "  " + pad(c.time, 12) + "  " + trunc(c.subject, Math.max(10, cols - 30)) + RST, sel);
    }
    pushBody("", false);
    
    if (S.message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Checkout"], ["Esc", "Cancel"]]));
    return;
  }

  if (S.mode === "pactions" && S.pluginItems.length > 0 && S.pluginItems[S.pcursor]) {
    var ppitem = S.pluginItems[S.pcursor];
    pushBody("  " + MAGENTA + "#" + GRAY + " " + trunc(ppitem.name, cols - 6) + RST, false);
    var pinfo = ppitem.type === "npm"
      ? ("npm  " + (ppitem.version ? "v" + ppitem.version : "not installed"))
      : trunc(ppitem.subject || ppitem.url || "", cols - 6);
    if (pinfo) pushBody("  " + GRAY + pinfo + RST, false);
    pushBody("", false);
    var pacts = getPluginActions(ppitem);
    var lastCat = null;
    for (var pj = 0; pj < pacts.length; pj++) {
      var pcat = pacts[pj].cat;
      if (pcat && pcat !== lastCat) {
        if (lastCat !== null) pushBody("", false);   // blank line between categories
        pushBody("    " + BOLD + CYAN + pcat + RST, false);
        lastCat = pcat;
      }
      if (pj === S.pacursor) {
        pushBody("    " + GREEN + "  > " + BOLD + pacts[pj].label + RST, true);
      } else {
        pushBody("    " + GRAY + "    " + pacts[pj].label + RST, false);
      }
    }
    pushBody("", false);
    if (S.message) pushFoot(messageLine(cols));
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
    return;
  }

  if (S.pluginItems.length === 0) {
    pushBody("  " + GRAY + "No plugins configured." + RST, false);
    pushBody("  " + GRAY + "Add plugins to ~/configDirPlaceholder/config/plugins.json" + RST, false);
    pushBody("", false);
    
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + GRAY + "Q" + RST + " Quit");
    return;
  }

  var tabInstalled = S.pluginSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);
  var tabMarketplace = S.pluginSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);
  var tabsLine = "  " + tabInstalled + "  " + tabMarketplace;
  for (var cti = 0; cti < S.customTabs.length; cti++) {
    var ctab = S.customTabs[cti];
    var ctStr = S.pluginSubPage === ctab.id ? (BOLD + WHITE + BG_SEL + " " + ctab.label + " " + RST) : (GRAY + " " + ctab.label + " " + RST);
    tabsLine += "  " + ctStr;
  }
  tabsLine += "    " + DIM + "Tab" + RST + " switch";
    pushBody(tabsLine, false);
  pushBody("", false);

  // --- Marketplace sub-page ---
  if (S.pluginSubPage === "marketplace") {
    // Actions menu for selected plugin
    if (S.mkMode === "actions" && S.marketplaceItems.length > 0) {
      var mitem = S.marketplaceItems[S.mkCursor];
      if (!mitem) { S.mkMode = "browse"; }
      else {
        pushBody("  " + MAGENTA + "#" + GRAY + " " + trunc(mitem.name, cols - 6) + RST, false);
        pushBody("  " + GRAY + trunc(mitem.desc || mitem.command + " " + (mitem.args || []).join(" "), cols - 6) + RST, false);
        pushBody("", false);
        var mkActs = mitem.installed ? [] : [{ key: "install", label: "Install" }];
        if (mitem.url) mkActs.push({ key: "browser", label: "Open in browser" });
        mkActs.push({ key: "cancel", label: "Cancel" });
        for (var ai = 0; ai < mkActs.length; ai++) {
          var a = mkActs[ai];
          var aSel = ai === S.mkAcursor;
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
    }
    pushBody("  " + MAGENTA + "#" + GRAY + " Marketplace (" + S.marketplaceItems.length + " available)" + (S.mode === "search" || S.inputBuf ? " " + BG_SEL + " Search: " + S.inputBuf + (S.mode === "search" ? "_" : "") + " " + RST : " " + DIM + "(press / to search)" + RST), false);
    if (S.marketplaceItems.length === 0) {
      if (S.inputBuf) {
        pushBody("  " + GRAY + "No results for \"" + S.inputBuf + "\"" + RST, false);
      } else if (S.catalogPending > 0) {
        pushBody("  " + spinnerFrame() + GRAY + " Loading marketplace catalog..." + RST, false);
      } else {
        pushBody("  " + GRAY + "Marketplace catalog is empty. Press R to retry." + RST, false);
      }
    }
    for (var mi = 0; mi < S.marketplaceItems.length; mi++) {
      var mitem = S.marketplaceItems[mi];
      var msel = mi === S.mkCursor;
      var marrow = msel ? (YELLOW + " > " + RST) : "   ";
      var mbg = msel ? BG_SEL : "";
      var mns = msel ? (BOLD + WHITE) : DIM;
      var starRaw = mitem.stars != null ? " ★" + mitem.stars : "";
      var starVis = starRaw.length;
      var mkNameW = Math.min(30, nameW);
      var usedW = 2 + 3 + 2 + mkNameW + 2 + starVis;
      var descW = Math.max(10, cols - usedW - 2);
      var descText = trunc((mitem.desc || "").replace(/\r?\n/g, " "), descW);
      var descVis = stringWidth(descText);
      var gapW = Math.max(1, cols - usedW - descVis);
      var starStr = starRaw ? (YELLOW + " ".repeat(gapW) + "★" + mitem.stars + RST) : "";
      var mIcon = mitem.installed ? (GREEN + "●" + RST) : (GRAY + "○" + RST);
      pushBody("  " + mbg + marrow + mIcon + " " + mns + pad(trunc(mitem.name, mkNameW), mkNameW) + RST + mbg + "  " + GRAY + descText + RST + starStr + RST, msel);
      if (msel && mitem.url) {
        pushBody("  " + GRAY + "     " + trunc(mitem.url, cols - 10) + RST, msel);
      }
    }
    pushBody("", false);
    if (S.message) { pushFoot(messageLine(cols)); }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["/", "Search"], ["?", "Help"], ["Q", "Quit"]]));
    return;
  }

  // --- Custom tab sub-pages (rendered by plugin extensions) ---
  var activeTab = S.customTabs.find(function(t) { return t.id === S.pluginSubPage; });
  if (activeTab && activeTab.render) {
    try {
      activeTab.render({
        pluginSubPage: S.pluginSubPage,
        cols: cols,
        nameW: nameW,
        message: S.message,
        mode: S.mode
      }, {
        pushBody: pushBody,
        pushFoot: pushFoot,
        pad: pad,
        trunc: trunc,
        BOLD: BOLD, WHITE: WHITE, BG_SEL: BG_SEL, RST: RST,
        GRAY: GRAY, DIM: DIM, YELLOW: YELLOW, GREEN: GREEN,
        MAGENTA: MAGENTA, CYAN: CYAN, RED: RED,
        barW: barW
      });
    } catch(e) {}
    return;
  }

  // --- Installed sub-page (existing code) ---
  var autoCount = 0, manualCount = 0, updateCount = 0, disabledCount = 0;
  for (var p of S.pluginItems) {
    if (p.type === "npm") continue;
    if (!p.enabled) disabledCount++;
    else if (p.autoUpdate) autoCount++; else manualCount++;
    if (p.updateAvail) updateCount++;
  }

  var npmCount = S.pluginItems.filter(function(p) { return p.type === "npm"; }).length;
  pushBody("  " + MAGENTA + "#" + GRAY + " Plugins " +
      GRAY + "(" + autoCount + " auto, " + manualCount + " manual, " + disabledCount + " disabled" +
      (updateCount > 0 ? ", " + CYAN + updateCount + " updates" + GRAY : "") +
      (npmCount > 0 ? ", " + GRAY + npmCount + " npm" + GRAY : "") +
      ")" + RST, false);

  if (!S.pluginFetched) {
    pushBody("  " + GRAY + "  Press " + RST + "F" + GRAY + " to check for updates" + RST, false);
  }

  var lastWasGit = false;
  for (var i = 0; i < S.pluginItems.length; i++) {
    var pitem = S.pluginItems[i];
    if (pitem.type === "npm" && (i === 0 || S.pluginItems[i - 1].type !== "npm")) {
      pushBody("", false);
      pushBody("  " + MAGENTA + "#" + GRAY + " npm plugins" + RST, false);
    }
    buildPluginItem(pushBody, i, pitem, nameW, cols, i === S.pcursor);
  }

  pushBody("", false);

  if (S.message) {
    pushFoot(messageLine(cols));
  }
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);

  if (S.mode === "pinput") {
    pushFoot("  " + CYAN + "Plugin git URL: " + RST + S.inputBuf + BOLD + "|" + RST);
    pushFoot(hints([["Enter", "Add"], ["Esc", "Cancel"]]));
  } else {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
  }
}

