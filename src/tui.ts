#!/usr/bin/env bun
// @ts-nocheck

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { E, RST, BOLD, DIM, GRAY, WHITE, YELLOW, GREEN, CYAN, RED, BLUE, MAGENTA, BG_SEL, CLR, stringWidth, pad, trunc, timeAgo } from "./format.js";
import { S } from "./state.js";
import { HOME, APP_NAME, CLI_CMD, NPM_PKG, CONFIG_DIR, CACHE_PKG_DIR, DB_PATH, CONFIG_FOLDER, CACHE_DIR, CONFIG_PATH, UPDATE_CHECK_PATH, PLUGINS_JSON, REPOS_DIR, PLUGINS_DIR, MCP_CONFIG_PATH, CATALOG_CACHE_PATH, tuiLog, MCP_CATALOG, SPINNER_FRAMES, HELP_BINDINGS } from "./env.js";
import { hideCur, showCur, cleanup } from "./out.js";
import { getUpdater, getUpdaterVersion, setupPlugin, loadNpmPlugins, getFolderName } from "./updater.js";
import { loadConfig, saveConfig, migrateConfigs, loadPlugins, savePlugins, loadMcpConfig, saveMcpConfig } from "./config.js";
import { flash, scheduleRender, hints, messageLine, spinnerFrame, updateSpinner, buildConfirm, buildHelp } from "./views/common.js";
import { loadProviders } from "./providers.js";
import { getInstalledMcpList, buildMcpList, installMcpServer, uninstallMcpServer, getMcpActions } from "./mcp.js";
import { invalidateCatalogCache, fetchCatalogsAsync, buildMarketplaceList, installMarketplacePlugin } from "./marketplace.js";
import { fetchPluginRemotes, buildCombinedPluginList, getPluginActions } from "./plugins.js";
import { shortPath, buildList, getActions, outputDir, openProject, togglePin, hideItem, unhideAll, changeProjectPath } from "./projects.js";

global.OpenCodeAPI = {
  getReposDir: function() { return REPOS_DIR; },
  getPluginsDir: function() { return PLUGINS_DIR; },
  getConfigDir: function() { return CONFIG_DIR; },
  log: function(msg) { flash(msg); render(); },
  
  // Bidirectional sync for files between Claude and OpenCode environments
  syncFile: function(sourcePath, relativeDestPath) {
    const fs = require('fs');
    const path = require('path');
    const homedir = require('os').homedir();
    
    // Sync to .config/claude and .config/opencode
    const ccDest = path.join(homedir, ".config", "claude", relativeDestPath);
    const ocDest = path.join(homedir, ".config", "opencode", relativeDestPath);
    
    [ccDest, ocDest].forEach(dest => {
      if (sourcePath !== dest) {
        const parentDir = path.dirname(dest);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, dest);
        }
      }
    });
  },
  
  // Deploy a plugin binary/script to the active plugins directory
  deployPlugin: function(pluginName, sourcePath) {
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    
    const pluginFile = pluginName.endsWith('.js') ? pluginName : pluginName + '.js';
    const destPath = path.join(PLUGINS_DIR, pluginFile);
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
    }
  },
  
  // Remove a plugin's deployed files
  removePluginFiles: function(pluginName) {
    const fs = require('fs');
    const path = require('path');
    const pluginFile = pluginName.endsWith('.js') ? pluginName : pluginName + '.js';
    const deployedPath = path.join(PLUGINS_DIR, pluginFile);
    if (fs.existsSync(deployedPath)) {
      try { fs.unlinkSync(deployedPath); } catch {}
    }
    
    const folderName = pluginName.replace(/[^a-zA-Z0-9-]/g, '-');
    const repoDir = path.join(REPOS_DIR, "intisy", folderName);
    if (fs.existsSync(repoDir)) {
      try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch {}
    }
  }
};








migrateConfigs();

function checkForUpdates() {
  try {
    var legacyCheck = join(CONFIG_DIR, "oc-last-update-check");
    if (!existsSync(UPDATE_CHECK_PATH) && existsSync(legacyCheck)) {
      try {
        if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
        copyFileSync(legacyCheck, UPDATE_CHECK_PATH);
      } catch {}
    }
    if (existsSync(UPDATE_CHECK_PATH)) {
      var lastCheck = parseInt(readFileSync(UPDATE_CHECK_PATH, "utf-8").trim(), 10);
      if (Date.now() - lastCheck < 86400000) return;
    }

    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(UPDATE_CHECK_PATH, String(Date.now()));

    exec(CLI_CMD + " --version", { timeout: 15000 }, function(versionError, installedOut) {
      if (versionError) return;
      exec("npm view " + NPM_PKG + " version", { timeout: 20000 }, function(viewError, latestOut) {
        if (viewError) return;
        var installed = (installedOut || "").trim();
        var latest = (latestOut || "").trim();
        if (!latest || !installed || latest === installed) return;
        flash("Updating " + APP_NAME + " " + installed + " -> " + latest + " in the background");
        render();
        exec("npm install -g " + NPM_PKG + "@latest", { timeout: 180000 }, function(installError) {
          tuiLog(installError ? "self-update failed: " + installError.message : "self-updated to " + latest);
          if (!installError) { flash(APP_NAME + " updated to " + latest + " (restart to apply)"); render(); }
        });
      });
    });
  } catch (e) { tuiLog("update check failed: " + e.message); }
}

// deferred so the TUI renders immediately instead of waiting on version checks
setTimeout(checkForUpdates, 1500);





// Plugin data


// Registry Pattern: plugins extend the TUI by exporting a function from tui-extension.js
// The function receives a tuiApi object with registerTab() to add custom tabs
var tuiApi = {
  registerTab: function(tab) {
    if (tab && tab.id && tab.label) {
      S.customTabs.push(tab);
    }
  },
  loadConfig: function() { return loadConfig(); },
  saveConfig: function(cfg) { return saveConfig(cfg); },
  loadPlugins: function() { return loadPlugins(); },
  flash: function(msg) { S.message = msg; messageTimeout = Date.now() + 3000; }
};

function loadCustomTabs() {
  S.customTabs = [];
  // 1. Scan installed plugins for tui-extension.js
  try {
    var pl = loadPlugins();
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i];
      var extPath = join(REPOS_DIR, getFolderName(p), "tui-extension.js");
      if (existsSync(extPath)) {
        try {
          var ext = require(extPath);
          if (typeof ext === "function") {
            ext(tuiApi);
          }
        } catch(e) {}
      }
    }
  } catch(e) {}
  // 2. Scan the launcher's own repo root (parent of core/) for tui-extension.js
  try {
    var scriptDir = dirname(fileURLToPath(import.meta.url));
    var launcherExt = join(scriptDir, "..", "tui-extension.js");
    if (existsSync(launcherExt)) {
      var lext = require(launcherExt);
      if (typeof lext === "function") {
        lext(tuiApi);
      }
    }
  } catch(e) {}
}






// runPluginUpdate removed - delegated to updater plugin





// MCP Config read/write (environment-aware)








// Plugin Marketplace Catalog

var { exec } = require("child_process");






S.items = buildList();


// auth plugins declare providers in their package manifest; selecting one
// routes the loader's requests through it

S.pluginItems = buildCombinedPluginList();

// MCP state
S.mcpItems = buildMcpList("All");
// Marketplace state
S.marketplaceItems = buildMarketplaceList();



// async catalog fetches arrive in bursts — coalesce their redraws






// Project actions










// Render: projects page

function buildProjectItem(pushBody, i, item, nameW, cols, isSelected) {
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

function buildOpenHereItem(pushBody) {
  var sel = S.cursor === S.items.length;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;
  pushBody("  " + bg + arrow + nameStyle + "Open " + APP_NAME + " here" + RST + bg + "  " + GRAY + process.cwd() + RST, sel);
}

function buildProjects(pushBody, pushFoot, cols, barW) {
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

// Render: plugins page

function buildPluginItem(pushBody, i, pitem, nameW, cols, isSelected) {
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

function buildPlugins(pushBody, pushFoot, cols, barW) {
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
    for (var pj = 0; pj < pacts.length; pj++) {
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
  var tabProviders = S.pluginSubPage === "providers" ? (BOLD + WHITE + BG_SEL + " Providers " + RST) : (GRAY + " Providers " + RST);
  var tabsLine = "  " + tabInstalled + "  " + tabMarketplace + "  " + tabProviders;
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

  if (S.pluginSubPage === "providers") {
    var providers = loadProviders();
    var selectedProvider = loadConfig().provider || "";
    pushBody("  " + MAGENTA + "#" + GRAY + " Providers (" + providers.length + ")" + RST, false);
    if (providers.length === 0) {
      pushBody("  " + GRAY + "No providers installed." + RST, false);
      pushBody("  " + GRAY + "Auth plugins such as antigravity-auth register providers here." + RST, false);
    }
    for (var pri = 0; pri < providers.length; pri++) {
      var prov = providers[pri];
      var prSel = pri === S.provCursor;
      var prIcon = prov.name === selectedProvider ? (GREEN + "●" + RST) : (GRAY + "○" + RST);
      var prArrow = prSel ? (YELLOW + " > " + RST) : "   ";
      var prBg = prSel ? BG_SEL : "";
      var prStyle = prSel ? (BOLD + WHITE) : DIM;
      pushBody("  " + prBg + prArrow + prIcon + " " + prStyle + pad(trunc(prov.name, nameW), nameW) + RST + prBg + "  " + GRAY + "from " + prov.plugin + RST, prSel);
    }
    pushBody("", false);
    if (S.message) pushFoot(messageLine(cols));
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select provider"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
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

// Main render

export function render() {
  var cols = process.stderr.columns || 80;
  var totalRows = (process.stderr.rows || 24) - 1;
  var barW = Math.min(56, cols - 4);

  var headLines = [];
  var bodyLines = [];
  var footLines = [];
  var selStart = 0;
  var selEnd = 0;

  function pushHead(s) { headLines.push(s); }
  function pushBody(s, isSelLine) { 
    if (isSelLine && selStart === 0) selStart = bodyLines.length;
    bodyLines.push(s); 
    if (isSelLine) selEnd = bodyLines.length;
  }
  function pushFoot(s) { footLines.push(s); }

  // 1. Build Header
  pushHead("");
  pushHead("  " + BOLD + CYAN + " " + APP_NAME + RST + GRAY + "  Loader" + RST);
  pushHead("  " + GRAY + "-".repeat(barW) + RST);
  var showPluginsTab = S.pluginItems.length > 0 || S.MARKETPLACE_CATALOG.length > 0;
  var projTab = S.page === "projects" ? (BOLD + WHITE + BG_SEL + " Projects " + RST) : (GRAY + " Projects " + RST);
  var plugTab = showPluginsTab ? (S.page === "plugins" ? (BOLD + WHITE + BG_SEL + " Plugins " + RST) : (GRAY + " Plugins " + RST)) : "";
  var mcpTab = S.page === "mcp" ? (BOLD + WHITE + BG_SEL + " MCP " + RST) : (GRAY + " MCP " + RST);
  pushHead("  " + projTab + "  " + plugTab + "  " + mcpTab + "    " + DIM + "<- ->" + RST);
  pushHead("");

  if (S.helpOpen) {
    buildHelp(pushBody, pushFoot, cols, barW);
  } else if (S.mode === "confirm") {
    buildConfirm(pushBody, pushFoot, cols, barW);
  } else if (S.page === "projects") {
    buildProjects(pushBody, pushFoot, cols, barW);
  } else if (S.page === "mcp") {
    buildMcp(pushBody, pushFoot, cols, barW);
  } else {
    buildPlugins(pushBody, pushFoot, cols, barW);
  }
  updateSpinner();

  // 3. Viewport calculation
  var maxBody = Math.max(2, totalRows - headLines.length - footLines.length);
  
  var activeScroll = 0;
  if (S.page === "projects") activeScroll = S.scrollOff;
  else if (S.page === "mcp") activeScroll = S.mcpScrollOff;
  else if (S.mode === "pcommits") activeScroll = S.cscrollOff;
  else if (S.page === "plugins" && S.pluginSubPage === "marketplace") activeScroll = S.mkScrollOff;
  else activeScroll = S.pscrollOff;

  if (bodyLines.length > maxBody) {
    // marker rows are always reserved so the geometry never shifts between frames
    var innerH = maxBody - 2;
    var contextLines = 3;
    if (selStart - activeScroll < contextLines) activeScroll = Math.max(0, selStart - contextLines);
    if (selEnd - activeScroll > innerH) activeScroll = selEnd - innerH;
    if (activeScroll > bodyLines.length - innerH) activeScroll = bodyLines.length - innerH;
    if (activeScroll < 0) activeScroll = 0;

    if (S.page === "projects") S.scrollOff = activeScroll;
    else if (S.page === "mcp") S.mcpScrollOff = activeScroll;
    else if (S.mode === "pcommits") S.cscrollOff = activeScroll;
    else if (S.page === "plugins" && S.pluginSubPage === "marketplace") S.mkScrollOff = activeScroll;
    else S.pscrollOff = activeScroll;

    var hiddenAbove = activeScroll;
    var hiddenBelow = bodyLines.length - (activeScroll + innerH);
    var visibleBody = bodyLines.slice(activeScroll, activeScroll + innerH);
    visibleBody.unshift(hiddenAbove > 0 ? "  " + GRAY + "     ^ " + hiddenAbove + " more" + RST : "");
    visibleBody.push(hiddenBelow > 0 ? "  " + GRAY + "     v " + hiddenBelow + " more" + RST : "");
    bodyLines = visibleBody;
  }

  // no newline after the last row: writing into the bottom-right corner would
  // scroll the terminal and shift the whole frame every redraw
  S._buf = "\x1b[?2026h" + E + "H";
  S._buf += headLines.concat(bodyLines, footLines).map(function(l) { return l + CLR; }).join("\n");
  S._buf += E + "J" + "\x1b[?2026l";

  process.stderr.write(S._buf);
  S._buf = "";
}

// Key handling
function handleKey(key) {
  if (S.helpOpen) { S.helpOpen = false; return; }
  if (key === "?" && S.mode === "list") { S.helpOpen = true; return; }
  // Page switching with left/right (only in list mode, not in actions/input)
  if ((S.mode === "list") && (key === "left" || key === "right")) {
    var pages = ["projects", "plugins", "mcp"];
    var pi = pages.indexOf(S.page);
    if (key === "left" && pi > 0) { S.page = pages[pi - 1]; S.mode = "list"; render(); return; }
    if (key === "right" && pi < pages.length - 1) { S.page = pages[pi + 1]; S.mode = "list"; render(); return; }
    return;
  }

  if (S.mode === "confirm") {
    handleConfirmKey(key);
  } else if (S.page === "projects") {
    handleProjectKey(key);
  } else if (S.page === "mcp") {
    handleMcpKey(key);
  } else {
    handlePluginKey(key);
  }
}

function handleProjectKey(key) {
  if (S.mode === "list") {
    if (key === "up" || key === "w") { S.cursor = Math.max(0, S.cursor - 1); }
    else if (key === "down" || key === "s") { S.cursor = Math.min(S.items.length, S.cursor + 1); }
    else if (key === "enter" || key === "space") {
      if (S.cursor === S.items.length) { cleanup(); process.exit(42); }
      else if (S.items.length > 0) { S.mode = "actions"; S.acursor = 0; }
    }
    else if (key === "o") {
      if (S.cursor === S.items.length) { cleanup(); process.exit(42); }
      else if (S.items.length > 0) openProject(S.items[S.cursor]);
    }
    else if (key === "p") { if (S.cursor < S.items.length) togglePin(S.cursor); }
    else if (key === "h") { if (S.cursor < S.items.length) hideItem(S.cursor); }
    else if (key === "u") { unhideAll(); }
    else if (key === "c") { S.mode = "input"; S.inputBuf = ""; }
    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }
  } else if (S.mode === "actions") {
    var acts = getActions(S.items[S.cursor]);
    if (key === "up" || key === "w") { S.acursor = Math.max(0, S.acursor - 1); }
    else if (key === "down" || key === "s") { S.acursor = Math.min(acts.length - 1, S.acursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[S.acursor].key;
      if (action === "open") { openProject(S.items[S.cursor]); }
      else if (action === "pin" || action === "unpin") { togglePin(S.cursor); S.mode = "list"; }
      else if (action === "hide") { hideItem(S.cursor); S.mode = "list"; }
      else if (action === "chpath") { S.mode = "input"; S.chpathDir = S.items[S.cursor].dir; S.inputBuf = S.items[S.cursor].dir; }
      else if (action === "unhide") { unhideAll(); S.mode = "list"; }
      else { S.mode = "list"; }
    }
    else if (key === "escape" || key === "q" || key === "left") { S.mode = "list"; }
  }
}

function handlePluginKey(key) {
  if (S.mode === "list") {
    if (key === "q" || key === "escape") { cleanup(); process.exit(1); return; }
    
    if (key === "tab") {
      S.inputBuf = "";
      if (S.pluginSubPage === "installed") { S.pluginSubPage = "marketplace"; S.marketplaceItems = buildMarketplaceList(); S.mkCursor = 0; S.mkScrollOff = 0; }
      else if (S.pluginSubPage === "marketplace") { S.pluginSubPage = "providers"; S.provCursor = 0; }
      else if (S.pluginSubPage === "providers" && S.customTabs.length > 0) { S.pluginSubPage = S.customTabs[0].id; }
      else {
        var cIdx = S.customTabs.findIndex(function(t) { return t.id === S.pluginSubPage; });
        if (cIdx >= 0 && cIdx < S.customTabs.length - 1) {
          S.pluginSubPage = S.customTabs[cIdx + 1].id;
        } else {
          S.pluginSubPage = "installed";
        }
      }
      return;
    }

    var activeTab = S.customTabs.find(function(t) { return t.id === S.pluginSubPage; });
    if (activeTab && activeTab.handleKey) {
      try {
        activeTab.handleKey(key, {
          pluginSubPage: S.pluginSubPage,
          mode: S.mode
        }, tuiApi);
      } catch(e) {}
      return;
    }

    if (S.pluginSubPage === "providers") {
      var provList = loadProviders();
      if (key === "up" || key === "w") { S.provCursor = Math.max(0, S.provCursor - 1); }
      else if (key === "down" || key === "s") { S.provCursor = Math.min(Math.max(0, provList.length - 1), S.provCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (provList.length > 0 && S.provCursor < provList.length) {
          var providerCfg = loadConfig();
          providerCfg.provider = provList[S.provCursor].name;
          saveConfig(providerCfg);
          flash("Provider set to " + provList[S.provCursor].name);
        }
      }
      return;
    }

    if (S.pluginSubPage === "marketplace") {
      // Actions sub-mode
      if (S.mkMode === "actions") {
        var mitem = S.marketplaceItems[S.mkCursor];
        if (!mitem) { S.mkMode = "browse"; return; }
        var mkActs = mitem.installed ? [] : [{ key: "install", label: "Install" }];
        if (mitem.url) mkActs.push({ key: "browser", label: "Open in browser" });
        mkActs.push({ key: "cancel", label: "Cancel" });
        if (key === "up" || key === "w") { S.mkAcursor = Math.max(0, S.mkAcursor - 1); }
        else if (key === "down" || key === "s") { S.mkAcursor = Math.min(mkActs.length - 1, S.mkAcursor + 1); }
        else if (key === "enter" || key === "space") {
          var action = mkActs[S.mkAcursor].key;
          if (action === "install") {
            flash("Installing " + (mitem.name || mitem.repoName) + "...");
            render();
            var merr = installMarketplacePlugin(mitem);
            if (merr) flash(merr);
            else { flash("Installed! Restart to activate."); S.pluginItems = buildCombinedPluginList(); }
            S.marketplaceItems = buildMarketplaceList();
            if (S.mkCursor >= S.marketplaceItems.length) S.mkCursor = Math.max(0, S.marketplaceItems.length - 1);
          } else if (action === "browser" && mitem.url) {
            try {
              var openCmd = process.platform === "win32" ? "start \"\" \"" + mitem.url + "\"" : process.platform === "darwin" ? "open \"" + mitem.url + "\"" : "xdg-open \"" + mitem.url + "\"";
              execSync(openCmd, { timeout: 5000, stdio: "ignore" });
              flash("Opened in browser");
            } catch(e) { flash("No browser available: " + mitem.url); }
          }
          S.mkMode = "browse";
        }
        else if (key === "escape" || key === "left") { S.mkMode = "browse"; }
        return;
      }
      // Browse mode
      if (key === "up" || key === "w") { S.mkCursor = Math.max(0, S.mkCursor - 1); }
      else if (key === "down" || key === "s") { S.mkCursor = Math.min(S.marketplaceItems.length - 1, S.mkCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (S.marketplaceItems.length > 0) { S.mkMode = "actions"; S.mkAcursor = 0; }
      }
      else if (key === "/") { S.mode = "search"; return; }
      else if (key === "r") {
        invalidateCatalogCache();
        S.catalogFetched = false;
        fetchCatalogsAsync();
        S.marketplaceItems = buildMarketplaceList();
        flash("Refreshing catalog...");
      }
      else if (key === "i") {
        if (S.marketplaceItems.length > 0) {
          var quickItem = S.marketplaceItems[S.mkCursor];
          if (quickItem.installed) { flash(quickItem.name + " is already installed."); return; }
          flash("Installing " + (quickItem.name || quickItem.repoName) + "...");
          render();
          var quickErr = installMarketplacePlugin(quickItem);
          if (quickErr) flash(quickErr);
          else { flash("Installed! Restart to activate."); S.pluginItems = buildCombinedPluginList(); }
          S.marketplaceItems = buildMarketplaceList();
          if (S.mkCursor >= S.marketplaceItems.length) S.mkCursor = Math.max(0, S.marketplaceItems.length - 1);
        }
      }
    } else if (S.pluginSubPage === "installed") {
      if (key === "up" || key === "w") { S.pcursor = Math.max(0, S.pcursor - 1); }
      else if (key === "down" || key === "s") { S.pcursor = Math.min(S.pluginItems.length - 1, S.pcursor + 1); }
      else if (key === "enter" || key === "space") {
        if (S.pluginItems.length > 0) { S.mode = "pactions"; S.pacursor = 0; }
      }
      else if (key === "r") {
        S.pluginItems = buildCombinedPluginList();
        flash("Refreshed.");
      }
      else if (key === "f") {
        flash("Fetching remotes...");
        render();
        fetchPluginRemotes(S.pluginItems);
        S.pluginFetched = true;
        var updateCount = 0;
        for (var p of S.pluginItems) { if (p.updateAvail) updateCount++; }
        flash(updateCount > 0 ? updateCount + " update(s) available" : "All plugins up to date");
      }
      else if (key === "a") {
        var toUpdate = S.pluginItems.filter(function(p) { return p.type !== "npm" && (p.updateAvail || !p.deployed); });
        if (toUpdate.length === 0) {
          flash("All plugins are already up to date.");
        } else {
          var errors = [];
          var remaining = toUpdate.length;
          flash("Updating " + remaining + " plugin(s)...");
          render();
          toUpdate.forEach(function(pi) {
            var repo = loadPlugins().find(function(r) { return r.name === pi.name; });
            setupPlugin(repo || pi, function(e) {
              if (e) errors.push(pi.name + ": " + e);
              remaining--;
              if (remaining <= 0) {
                S.pluginItems = buildCombinedPluginList();
                if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
                flash(errors.length > 0 ? errors.join("; ") : toUpdate.length + " plugin(s) updated. Restart " + APP_NAME + " to apply.");
                render();
              }
            });
          });
        }
      }
      else if (key === "u") {
        if (S.pluginItems.length > 0 && S.pluginItems[S.pcursor].type !== "npm") {
          var p = S.pluginItems[S.pcursor];
          flash("Updating " + p.name + "...");
          render();
          var pRepo = loadPlugins().find(function(r) { return r.name === p.name; });
          setupPlugin(pRepo || p, function(err) {
            S.pluginItems = buildCombinedPluginList();
            if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
            flash(err ? p.name + ": " + err : p.name + " updated. Restart " + APP_NAME + " to apply.");
            render();
          });
        }
      }
      else if (key === "d") {
        if (S.pluginItems.length > 0 && S.pluginItems[S.pcursor].type !== "npm") {
          var p = S.pluginItems[S.pcursor];
          var updater = getUpdater();
          if (updater && updater.disable) {
            updater.disable(p);
          } else {
            // fallback if no updater
            var plugins = loadPlugins();
            var match = plugins.find(function(r) { return r.name === p.name; });
            if (match) { match.enabled = false; savePlugins(plugins); }
            var deployedPath = join(PLUGINS_DIR, (p.pluginFile || p.name + ".js"));
            if (existsSync(deployedPath)) { try { unlinkSync(deployedPath); } catch {} }
          }
          S.pluginItems = buildCombinedPluginList();
          if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
          flash(p.name + " disabled. Restart " + APP_NAME + " to unload.");
        }
      }
    }
  } else if (S.mode === "pactions") {
    var pitem = S.pluginItems[S.pcursor];
    var acts = getPluginActions(pitem);
    if (key === "up" || key === "w") { S.pacursor = Math.max(0, S.pacursor - 1); }
    else if (key === "down" || key === "s") { S.pacursor = Math.min(acts.length - 1, S.pacursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[S.pacursor].key;
      if (action === "updater-update") {
        S.mode = "list";
        if (APP_NAME === "Claude Code") {
          // the SessionStart hook runs npx plugin-updater@latest, so the engine
          // already refreshes every session — npm -g would be a no-op here
          flash("plugin-updater is managed via npx @latest; it updates each session.");
        } else {
          flash("Updating plugin-updater...");
          render();
          var engineModule = getUpdater();
          var engineErr = engineModule && typeof engineModule.updateNpmPlugin === "function"
            ? (engineModule.updateNpmPlugin("plugin-updater", CONFIG_DIR, 0) || "")
            : "updater not available";
          S.pluginItems = buildCombinedPluginList();
          flash(engineErr ? "plugin-updater: " + engineErr : "plugin-updater updated.");
        }
      }
      else if (action === "updater-run") {
        flash("Updating all plugins...");
        S.mode = "list";
        render();
        var runModule = getUpdater();
        if (runModule && typeof runModule.earlyLaunch === "function") {
          Promise.resolve(runModule.earlyLaunch(CONFIG_DIR, loadPlugins())).then(function() {
            S.pluginItems = buildCombinedPluginList();
            flash("All plugins updated. Restart " + APP_NAME + " to apply.");
            render();
          }).catch(function(e) { flash("Update failed: " + e); render(); });
        } else {
          flash("updater not available");
        }
      }
      else if (action === "updater-add") {
        S.inputBuf = "";
        S.mode = "pinput";
      }
      else if (action === "update") {
        flash("Updating " + pitem.name + "...");
        S.mode = "list";
        render();
        var actRepo = loadPlugins().find(function(r) { return r.name === pitem.name; });
        setupPlugin(actRepo || pitem, function(err) {
          S.pluginItems = buildCombinedPluginList();
          if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
          flash(err ? pitem.name + ": " + err : pitem.name + " updated. Restart " + APP_NAME + " to apply.");
          render();
        });
      }
      else if (action === "enable-auto" || action === "disable-auto") {
        var newVal = action === "enable-auto";
        pitem.autoUpdate = newVal;
        var plugins = loadPlugins();
        var match = plugins.find(function(r) { return r.name === pitem.name; });
        if (match) { match.autoUpdate = newVal; savePlugins(plugins); }
        flash(pitem.name + ": auto-update " + (newVal ? "ON" : "OFF"));
        S.mode = "list";
      }
      else if (action === "disable-plugin") {
        var updater = getUpdater();
        if (updater && updater.disable) {
          updater.disable(pitem);
        }
        var plugins = loadPlugins();
        var match = plugins.find(function(r) { return r.name === pitem.name; });
        if (match) { match.enabled = false; } else { plugins.push({ name: pitem.name, enabled: false }); }
        savePlugins(plugins);
        var deployedPath = join(PLUGINS_DIR, (pitem.pluginFile || pitem.name + ".js"));
        if (existsSync(deployedPath)) { try { unlinkSync(deployedPath); } catch {} }
        S.pluginItems = buildCombinedPluginList();
        if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
        flash(pitem.name + " disabled. Restart " + APP_NAME + " to unload.");
        S.mode = "list";
      }
      else if (action === "update-npm") {
        flash("Updating " + pitem.name + "...");
        render();
        var updater = getUpdater();
        var err = "";
        if (updater && typeof updater.updateNpmPlugin === "function") {
          err = updater.updateNpmPlugin(pitem.name, CONFIG_DIR, 0) || "";
        } else {
          try { execSync("npm update -g " + pitem.name, { timeout: 60000, stdio: "ignore" }); }
          catch(e) { err = e.message; }
        }
        S.pluginItems = buildCombinedPluginList();
        if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
        flash(err ? pitem.name + ": " + err : pitem.name + " updated. Restart " + APP_NAME + " to apply.");
        S.mode = "list";
      }
      else if (action === "uninstall-npm") {
        S.confirmAction = { type: "uninstall-npm", target: pitem };
        S.confirmLabel = "Uninstall npm plugin " + pitem.name + "? It is removed from opencode.json.";
        S.confirmCursor = 0;
        S.mode = "confirm";
      }
      else if (action === "uninstall-plugin") {
        S.confirmAction = { type: "uninstall-plugin", target: pitem };
        S.confirmLabel = "Uninstall " + pitem.name + "? This deletes its repo clone.";
        S.confirmCursor = 0;
        S.mode = "confirm";
      }
            else if (action === "enable-plugin") {
        var plugins = loadPlugins();
        var match = plugins.find(function(r) { return r.name === pitem.name; });
        if (match) { delete match.enabled; } else { plugins.push({ name: pitem.name }); }
        savePlugins(plugins);
        flash("Setting up " + pitem.name + "...");
        S.mode = "list";
        render();
        setupPlugin(match || { name: pitem.name, url: pitem.url }, function(setupErr) {
          S.pluginItems = buildCombinedPluginList();
          if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
          flash(setupErr ? pitem.name + ": " + setupErr : pitem.name + " enabled and deployed. Restart " + APP_NAME + " to load.");
          render();
        });
      }
      else if (action === "commits") {
        var dir = join(REPOS_DIR, pitem.folderName);
        if (!existsSync(dir)) { flash("Not installed locally yet"); S.mode = "list"; return; }
        try {
          var log = execSync('git log -20 --format="%h|%s|%ar"', { cwd: dir, encoding: "utf-8", timeout: 5000 });
          var lines = log.trim().split("\n");
          S.commitItems = [];
          for (var i = 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            var parts = lines[i].split("|");
            if (parts.length >= 3) {
              S.commitItems.push({ hash: parts[0], subject: parts.slice(1, -1).join("|"), time: parts[parts.length-1] });
            }
          }
          if (S.commitItems.length > 0) {
            S.ccursor = 0; S.cscrollOff = 0; S.mode = "pcommits";
          } else {
            flash("No commits found"); S.mode = "list";
          }
        } catch (e) {
          flash("Failed to fetch commits"); S.mode = "list";
        }
      }
      else { S.mode = "list"; }
    }
    else if (key === "escape" || key === "q" || key === "left") { S.mode = "list"; }
  } else if (S.mode === "confirm") {
    if (key === "y") {
      if (S.confirmAction && S.confirmAction.type === "uninstall-plugin") {
        var cpitem = S.confirmAction.target;
        var updater = getUpdater();
        if (updater && updater.uninstall) {
          updater.uninstall(cpitem);
        } else {
          var cdir = join(REPOS_DIR, cpitem.folderName);
          var cdeployed = join(PLUGINS_DIR, (cpitem.pluginFile || cpitem.name + ".js"));
          if (existsSync(cdir)) { try { var rmS = require("fs").rmSync; if (rmS) rmS(cdir, {recursive:true,force:true}); } catch(e){} }
          if (existsSync(cdeployed)) { try { unlinkSync(cdeployed); } catch(e){} }
        }
        var cplugins = loadPlugins();
        cplugins = cplugins.filter(function(r) { return r.name !== cpitem.name; });
        savePlugins(cplugins);
        S.pluginItems = buildCombinedPluginList();
        if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
        flash(cpitem.name + " uninstalled.");
      } else if (S.confirmAction && S.confirmAction.type === "uninstall-npm") {
        var cpitem = S.confirmAction.target;
        try {
          var updater = getUpdater();
          if (updater && typeof updater.uninstallNpmPlugin === "function") {
            updater.uninstallNpmPlugin(cpitem.name, CONFIG_DIR);
          } else {
            execSync("npm uninstall -g " + cpitem.name, { timeout: 60000, stdio: "ignore" });
            var cplugins = loadPlugins();
            cplugins = cplugins.filter(function(r) { return r.name !== cpitem.name; });
            savePlugins(cplugins);
          }
          S.pluginItems = buildCombinedPluginList();
          if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
          flash(cpitem.name + " uninstalled. Restart " + APP_NAME + ".");
        } catch(e) {
          flash("Uninstall failed. Try: npm uninstall -g " + cpitem.name);
        }
      }
    } else {
      flash("Cancelled.");
    }
    S.mode = "list";
    S.confirmAction = null;
  } else if (S.mode === "pcommits") {
    if (key === "up" || key === "w") { S.ccursor = Math.max(0, S.ccursor - 1); }
    else if (key === "down" || key === "s") { S.ccursor = Math.min(S.commitItems.length - 1, S.ccursor + 1); }
    else if (key === "escape" || key === "q" || key === "left") { S.mode = "list"; }
    else if (key === "enter" || key === "space") {
      var pitem = S.pluginItems[S.pcursor];
      var citem = S.commitItems[S.ccursor];
      flash("Downgrading " + pitem.name + " to " + citem.hash + "...");
      render();
      
      var err = "Updater plugin not found";
      var updater = getUpdater();
      if (updater) {
        var plugins = loadPlugins();
        var repo = plugins.find(function(r) { return r.name === pitem.name; });
        if (repo) err = updater.downgrade(repo, citem.hash);
      } else {
        // fallback
        var dir = join(REPOS_DIR, pitem.folderName);
        try {
          execSync("git reset --hard", { cwd: dir, timeout: 15000, stdio: "ignore" });
          execSync("git checkout " + citem.hash, { cwd: dir, timeout: 15000, stdio: "ignore" });
        } catch (e) {
          flash("Checkout failed"); S.mode = "list"; return;
        }
      }
      if (err === "Success" || !err) err = "";
      
      S.pluginItems = buildCombinedPluginList();
      flash(err ? pitem.name + ": " + err : pitem.name + " downgraded. Restart " + APP_NAME + " to apply.");
      S.mode = "list";
    }
  }
}


function handleInputData(buf) {
  if (buf[0] === 27) { S.mode = "list"; S.chpathDir = ""; return; }
  if (buf[0] === 3) { cleanup(); process.exit(1); }
  if (buf[0] === 13 || buf[0] === 10) {
    var p = S.inputBuf.trim();
    if (p) {
      if (p.charAt(0) === "~") p = HOME + p.substring(1);
      p = p.replace(/\//g, "\\");
      if (S.chpathDir) {
        if (p === S.chpathDir) { flash("Same path, nothing changed"); S.mode = "list"; S.chpathDir = ""; return; }
        if (existsSync(p)) {
          changeProjectPath(S.chpathDir, p);
        } else {
          flash("Path not found: " + p);
        }
        S.mode = "list"; S.chpathDir = "";
      } else {
        if (existsSync(p)) {
          cleanup();
          outputDir(p);
          process.exit(0);
        } else {
          flash("Path not found: " + p);
          S.mode = "list";
        }
      }
    } else {
      S.mode = "list"; S.chpathDir = "";
    }
    return;
  }
  if (buf[0] === 127 || buf[0] === 8) {
    S.inputBuf = S.inputBuf.substring(0, S.inputBuf.length - 1);
    return;
  }
  if (buf[0] >= 32 && buf[0] < 127) {
    S.inputBuf += String.fromCharCode(buf[0]);
    return;
  }
  var s = buf.toString("utf-8");
  if (s.length > 0) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32) S.inputBuf += s.charAt(i);
    }
  }
}

function parseKey(buf) {
  if (buf[0] === 27) {
    if (buf.length === 1) return "escape";
    if (buf[1] === 91) {
      if (buf[2] === 65) return "up";
      if (buf[2] === 66) return "down";
      if (buf[2] === 67) return "right";
      if (buf[2] === 68) return "left";
    }
    return null;
  }
  if (buf[0] === 13 || buf[0] === 10) return "enter";
  if (buf[0] === 32) return "space";
  if (buf[0] === 3) { cleanup(); process.exit(1); }
  if (buf[0] === 9) return "tab";
  var ch = String.fromCharCode(buf[0]).toLowerCase();
  if ("wsadqpchofuximynr/?".indexOf(ch) !== -1) return ch;
  return null;
}


// Render: MCP page


function buildMcp(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(18, cols - 50));

  if (S.mcpMode === "actions") {
    var mitem = S.mcpSubPage === "installed" ? getInstalledMcpList()[S.mcpCursor] : S.mcpItems[S.mcpCursor];
    if (!mitem) { S.mcpMode = "catalog"; return; }
    var acts = getMcpActions(mitem);
    pushBody("  " + MAGENTA + "#" + GRAY + " " + mitem.name + RST, false);
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
      pushBody("  " + MAGENTA + "#" + GRAY + " Installed MCP Servers (" + installedList.length + ")" + RST, false);
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
    pushBody("  " + MAGENTA + "#" + GRAY + " MCP Marketplace (" + S.mcpItems.length + " available)" + (S.mode === "search" || S.inputBuf ? " " + BG_SEL + " Search: " + S.inputBuf + (S.mode === "search" ? "_" : "") + " " + RST : " " + DIM + "(press / to search)" + RST), false);
    for (var i = 0; i < S.mcpItems.length; i++) {
      var m = S.mcpItems[i];
      var sel = i === S.mcpCursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      var statusIcon = m.installed ? (GREEN + "\u25cf" + RST) : (GRAY + "\u25cb" + RST);
      var starRaw = m.stars != null ? " ★" + m.stars : "";
      var starVis = starRaw.length;
      var usedW = 2 + 3 + 2 + nameW + 2 + starVis;
      var descW = Math.max(10, cols - usedW - 2);
      var descText = trunc((m.desc||"").replace(/\r?\n/g, " "), descW);
      var descVis = stringWidth(descText);
      var gapW = Math.max(1, cols - usedW - descVis);
      var starStr = starRaw ? (YELLOW + " ".repeat(gapW) + "★" + m.stars + RST) : "";
      pushBody("  " + bg + arrow + statusIcon + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + descText + RST + starStr + RST, sel);
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

// MCP key handling

function handleConfirmKey(key) {
  if (key === "up" || key === "w") { S.confirmCursor = 0; return; }
  if (key === "down" || key === "s") { S.confirmCursor = 1; return; }
  var accepted = key === "y" || ((key === "enter" || key === "space") && S.confirmCursor === 0);
  var rejected = key === "escape" || key === "q" || key === "n" || ((key === "enter" || key === "space") && S.confirmCursor === 1);
  if (accepted) {
    if (S.confirmAction && S.confirmAction.type === "uninstall-plugin") {
      var pitem = S.confirmAction.target;
      // Remove from plugins.json
      var plugins = loadPlugins();
      plugins = plugins.filter(function(r) { return r.name !== pitem.name; });
      savePlugins(plugins);
      // Delete deployed file
      var deployedPath = join(PLUGINS_DIR, (pitem.pluginFile || pitem.name + ".js"));
      if (existsSync(deployedPath)) { try { unlinkSync(deployedPath); } catch {} }
      // Delete repo folder
      var repoDir = join(REPOS_DIR, pitem.folderName);
      if (existsSync(repoDir)) {
        try { execSync((process.platform === "win32" ? "rmdir /s /q " : "rm -rf ") + '"' + repoDir + '"', { timeout: 30000, stdio: "ignore" }); } catch {}
      }
      S.pluginItems = buildCombinedPluginList();
      if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
      flash(pitem.name + " uninstalled.");
    } else if (S.confirmAction && S.confirmAction.type === "uninstall-npm") {
      var npmName = S.confirmAction.target.name || S.confirmAction.target;
      var npmUpdater = getUpdater();
      var npmErr = "updater not available";
      if (npmUpdater && typeof npmUpdater.uninstallNpmPlugin === "function") {
        npmErr = npmUpdater.uninstallNpmPlugin(npmName, CONFIG_DIR) || "";
      }
      S.pluginItems = buildCombinedPluginList();
      if (S.pcursor >= S.pluginItems.length) S.pcursor = Math.max(0, S.pluginItems.length - 1);
      flash(npmErr ? npmName + ": " + npmErr : npmName + " removed from opencode.json. Restart " + APP_NAME + " to unload.");
    } else if (S.confirmAction && S.confirmAction.type === "uninstall-mcp") {
      uninstallMcpServer(S.confirmAction.target);
      S.mcpItems = buildMcpList("All");
      if (S.mcpCursor >= S.mcpItems.length) S.mcpCursor = Math.max(0, S.mcpItems.length - 1);
      flash(S.confirmAction.target + " removed.");
    }
    S.confirmAction = null;
    S.confirmLabel = "";
    S.confirmCursor = 0;
    S.mode = "list";
  } else if (rejected) {
    S.confirmAction = null;
    S.confirmLabel = "";
    S.confirmCursor = 0;
    S.mode = "list";
    flash("Cancelled.");
  }
}

function handleMcpKey(key) {
  if (S.mcpMode === "catalog") {
    if (key === "tab") {
      S.inputBuf = "";
      if (S.mcpSubPage === "installed") { S.mcpSubPage = "marketplace"; S.mcpItems = buildMcpList("All"); S.mcpCursor = 0; }
      else { S.mcpSubPage = "installed"; S.mcpCursor = 0; }
      S.mcpScrollOff = 0;
    }
    else if (key === "up" || key === "w") { S.mcpCursor = Math.max(0, S.mcpCursor - 1); }
    else if (key === "down" || key === "s") {
      var maxLen = S.mcpSubPage === "installed" ? getInstalledMcpList().length : S.mcpItems.length;
      S.mcpCursor = Math.min(maxLen - 1, S.mcpCursor + 1);
    }
    else if (key === "enter" || key === "space") {
      var maxLen = S.mcpSubPage === "installed" ? getInstalledMcpList().length : S.mcpItems.length;
      if (maxLen > 0) { S.mcpMode = "actions"; S.mcpAcursor = 0; }
    }
    else if (key === "/" && S.mcpSubPage === "marketplace") { S.mode = "search"; return; }
    else if (key === "i" && S.mcpSubPage === "marketplace") {
      if (S.mcpItems.length > 0 && !S.mcpItems[S.mcpCursor].installed) {
        installMcpServer(S.mcpItems[S.mcpCursor]);
        S.mcpItems = buildMcpList("All");
        flash(S.mcpItems[S.mcpCursor] ? S.mcpItems[S.mcpCursor].name + " installed. Restart " + APP_NAME + " to activate." : "Installed.");
      }
    }
    else if (key === "x" && S.mcpSubPage === "installed") {
      var instList = getInstalledMcpList();
      if (instList.length > 0 && S.mcpCursor < instList.length) {
        S.confirmAction = { type: "uninstall-mcp", target: instList[S.mcpCursor].name };
        S.confirmLabel = "Remove MCP server " + instList[S.mcpCursor].name + "?";
        S.confirmCursor = 0;
        S.mode = "confirm";
      }
    }
    else if (key === "r") {
      invalidateCatalogCache();
      S.catalogFetched = false;
      S.mcpItems = buildMcpList("All");
      flash("Refreshing catalog...");
    }
    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }
  } else if (S.mcpMode === "actions") {
    var activeList = S.mcpSubPage === "installed" ? getInstalledMcpList() : S.mcpItems;
    var mitem = activeList[S.mcpCursor];
    if (!mitem) { S.mcpMode = "catalog"; return; }
    var acts = getMcpActions(mitem);
    if (key === "up" || key === "w") { S.mcpAcursor = Math.max(0, S.mcpAcursor - 1); }
    else if (key === "down" || key === "s") { S.mcpAcursor = Math.min(acts.length - 1, S.mcpAcursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[S.mcpAcursor].key;
      if (action === "install") {
        installMcpServer(mitem);
        S.mcpItems = buildMcpList("All");
        flash(mitem.name + " installed. Restart " + APP_NAME + " to activate.");
        S.mcpMode = "catalog";
      } else if (action === "uninstall") {
        S.confirmAction = { type: "uninstall-mcp", target: mitem.name };
        S.confirmLabel = "Remove MCP server " + mitem.name + "?";
        S.confirmCursor = 0;
        S.mode = "confirm";
        S.mcpMode = "catalog";
      } else if (action === "configure") {
        flash("Set env vars in " + MCP_CONFIG_PATH);
        S.mcpMode = "catalog";
      } else if (action === "browser") {
        var npmPkg = (mitem.args || []).find(function(arg) { return arg.indexOf("@") !== -1 && arg !== "-y"; });
        if (npmPkg) {
          var pkgName = npmPkg.replace(/@latest$/, "").replace(/@\^.*$/, "");
          var npmUrl = "https://www.npmjs.com/package/" + pkgName;
          try {
            var openCmd = process.platform === "win32" ? "start \"\" \"" + npmUrl + "\"" : process.platform === "darwin" ? "open \"" + npmUrl + "\"" : "xdg-open \"" + npmUrl + "\"";
            execSync(openCmd, { timeout: 5000, stdio: "ignore" });
            flash("Opened in browser");
          } catch(e) { flash("No browser available: " + npmUrl); }
        }
        S.mcpMode = "catalog";
      } else {
        S.mcpMode = "catalog";
      }
    }
    else if (key === "escape" || key === "left") { S.mcpMode = "catalog"; }
  }
}

// Cleanup & startup


process.on("exit", function() { showCur(); });
process.on("SIGINT", function() { cleanup(); process.exit(1); });
process.on("SIGTERM", function() { cleanup(); process.exit(1); });
try { process.stderr.on("resize", function() { render(); }); } catch(e) {}




// Direct argument handling (skip TUI)
var arg = process.argv[2];
if (arg) {
  if (arg === "test") {
    console.log("\x1b[36mRunning Loader Tests...\x1b[0m\n");
    var passed = 0, failed = 0;
    
    // Core tests
    console.log("Core Checks:");
    const fs = require('fs');
    if (fs.existsSync(PLUGINS_DIR)) {
      console.log("\x1b[32m  [✓]\x1b[0m Plugin directory exists"); passed++;
    } else {
      console.log("\x1b[31m  [✗]\x1b[0m Plugin directory missing"); failed++;
    }
    
    // Plugin tests
    var testApi = {
      addTest: function(category, name, fn) {
        console.log("\n" + category + " Checks:");
        try {
          var res = fn();
          if (res && res.passed) {
            console.log("\x1b[32m  [✓]\x1b[0m " + name + " (" + res.message + ")");
            passed++;
          } else {
            console.log("\x1b[31m  [✗]\x1b[0m " + name + " (" + (res ? res.message : "Failed") + ")");
            failed++;
          }
        } catch(e) {
          console.log("\x1b[31m  [✗]\x1b[0m " + name + " (Error: " + e.message + ")");
          failed++;
        }
      }
    };
    
    var plugins = loadPlugins();
    plugins.forEach(function(p) {
      if (!p.enabled) return;
      var pluginPath = join(PLUGINS_DIR, p.pluginFile || (p.name + ".js"));
      if (fs.existsSync(pluginPath)) {
        try {
          var mod = require(pluginPath);
          if (mod.registerTests) {
            mod.registerTests(testApi);
          }
        } catch(e) {}
      }
    });
    
    console.log("\n\x1b[36mResults: " + passed + " passed, " + failed + " failed.\x1b[0m");
    process.exit(failed > 0 ? 1 : 0);
  }
  if (/^\d+$/.test(arg)) {
    var idx = parseInt(arg) - 1;
    if (idx >= 0 && idx < S.items.length) {
      outputDir(S.items[idx].dir);
      process.exit(0);
    }
    process.exit(42);
  }
  var match = S.items.find(function(it) { return it.name.toLowerCase().indexOf(arg.toLowerCase()) !== -1; });
  if (!match) match = S.items.find(function(it) { return it.dir.toLowerCase().indexOf(arg.toLowerCase()) !== -1; });
  if (match) {
    outputDir(match.dir);
    process.exit(0);
  }
  process.exit(42);
}

// disable any mouse reporting a previous program left enabled — pointer
// movement otherwise arrives as input bytes and triggers random key handlers
process.stderr.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l");
hideCur();
render();
process.stdin.setRawMode(true);
process.stdin.resume();
function handleSearchData(buf) {
  if (buf[0] === 27) { S.mode = "list"; return; }
  if (buf[0] === 3) { cleanup(); process.exit(1); }
  if (buf[0] === 13 || buf[0] === 10) { S.mode = "list"; return; }
  if (buf[0] === 8 || buf[0] === 127) {
    S.inputBuf = S.inputBuf.slice(0, -1);
    if (S.page === "plugins" || S.page === "mcp") {
    var hasUpdater = loadPlugins().some(function(p) { return p.name.includes("updater") || p.url.includes("updater"); });
    if (!hasUpdater) {
      pushLine("");
      pushBody("  " + BOLD + RED + "Updater Plugin Missing" + RST, false);
      pushBody("  The hub requires an updater plugin to manage installations.", false);
      pushLine("");
      pushBody("  Press " + BOLD + WHITE + "Enter" + RST + " to install the default updater plugin.", false);
      
      // Override key handler for this screen
      if (S.globalKeyHandler !== "updater_install") {
        S.globalKeyHandler = "updater_install";
      }
      return;
    } else {
      if (S.globalKeyHandler === "updater_install") S.globalKeyHandler = null;
    }
  }

  if (S.page === "plugins") { S.marketplaceItems = buildMarketplaceList(); S.mkCursor = 0; }
    else if (S.page === "mcp") { S.mcpItems = buildMcpList("All"); S.mcpCursor = 0; }
    return;
  }
  var ch = String.fromCharCode(buf[0]);
  if (buf[0] >= 32 && buf[0] <= 126) {
    S.inputBuf += ch;
    if (S.page === "plugins") { S.marketplaceItems = buildMarketplaceList(); S.mkCursor = 0; }
    else if (S.page === "mcp") { S.mcpItems = buildMcpList("All"); S.mcpCursor = 0; }
  }
}

function handlePluginInputData(buf) {
  if (buf[0] === 27) { S.inputBuf = ""; S.mode = "list"; return; }
  if (buf[0] === 13 || buf[0] === 10) {
    var url = S.inputBuf.trim().replace(/\.git$/, "");
    S.inputBuf = "";
    S.mode = "list";
    if (!url) return;
    var name = url.split("/").pop() || url;
    var plugins = loadPlugins();
    if (!plugins.some(function(r) { return r.name === name; })) {
      plugins.push({ name: name, url: url, enabled: true, autoUpdate: true });
      savePlugins(plugins);
    }
    flash("Setting up " + name + "...");
    render();
    setupPlugin({ name: name, url: url }, function(err) {
      S.pluginItems = buildCombinedPluginList();
      flash(err ? name + ": " + err : name + " installed. Restart " + APP_NAME + " to load.");
      render();
    });
    return;
  }
  if (buf[0] === 127 || buf[0] === 8) { S.inputBuf = S.inputBuf.slice(0, -1); return; }
  if (buf[0] >= 32 && buf[0] <= 126) S.inputBuf += String.fromCharCode(buf[0]);
}

process.stdin.on("data", function(buf) {
  var key = parseKey(buf);
  
  if (S.globalKeyHandler === "updater_install") {
    if (key === "enter" || key === "space") {
      process.stdout.write("\x1b[?25h\n\x1b[36mInstalling updater plugin...\x1b[0m\n");
      try {
        const { execSync } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        // Install via npm globally
        execSync("npm install -g plugin-updater", { stdio: "inherit" });
        // Add to opencode.json plugin array
        const ocPath = path.join(CONFIG_DIR, "opencode.json");
        var ocData = {};
        if (fs.existsSync(ocPath)) {
          try { ocData = JSON.parse(fs.readFileSync(ocPath, "utf-8").replace(/^\s*\/\/[^\n]*/gm, "")); } catch {}
        }
        if (!Array.isArray(ocData.plugin)) ocData.plugin = [];
        if (!ocData.plugin.includes("plugin-updater")) ocData.plugin.unshift("plugin-updater");
        fs.writeFileSync(ocPath, JSON.stringify(ocData, null, 2), "utf-8");
      } catch(e) {
        tuiLog("Failed to install updater: " + e.message);
        flash("Failed to install updater: " + e.message);
        setTimeout(function(){}, 2000);
      }
      S.globalKeyHandler = null;
      S.pluginItems = buildCombinedPluginList();
      render();
    }
    if (key === "escape" || key === "q" || buf[0] === 3) process.exit(0);
    return;
  }
  
  if (S.mode === "input") { handleInputData(buf); render(); return; }
  if (S.mode === "pinput") { handlePluginInputData(buf); render(); return; }
  if (S.mode === "search") { handleSearchData(buf); render(); return; }
  var key = parseKey(buf);
  if (key) { handleKey(key); render(); }
});
// @ts-nocheck
