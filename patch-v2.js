#!/usr/bin/env bun
// Patch script v2: Fix plugins missing, tab key, version tags, MCP restructure, Provider tab, uninstall confirm
import { readFileSync, writeFileSync } from "fs";

var filePath = process.argv[2] || "tui.js";
var src = readFileSync(filePath, "utf-8");
var NL = src.includes("\r\n") ? "\r\n" : "\n";

function replace(old, nw, label) {
  if (!src.includes(old)) {
    console.error("SKIP [" + label + "]: pattern not found");
    return false;
  }
  src = src.replace(old, nw);
  console.log("OK [" + label + "]");
  return true;
}

// =========================================================================
// 1. Fix deployed check - plugins without pluginFile/output are inherently deployed
// =========================================================================
replace(
  '    var deployed = existsSync(join(PLUGINS_DIR, (p.pluginFile || "plugin.js")));',
  '    var deployed = (!p.pluginFile && !p.output) ? true : existsSync(join(PLUGINS_DIR, (p.pluginFile || "plugin.js")));',
  "deployed-check"
);

// =========================================================================
// 2. Fix parseKey - add tab (0x09) and extra chars x, i, m
// =========================================================================
replace(
  '  if (buf[0] === 3) { cleanup(); process.exit(1); }' + NL +
  '  var ch = String.fromCharCode(buf[0]).toLowerCase();' + NL +
  '  if ("wsadqpchouf".indexOf(ch) !== -1) return ch;',

  '  if (buf[0] === 3) { cleanup(); process.exit(1); }' + NL +
  '  if (buf[0] === 9) return "tab";' + NL +
  '  var ch = String.fromCharCode(buf[0]).toLowerCase();' + NL +
  '  if ("wsadqpchofuximy".indexOf(ch) !== -1) return ch;',
  "parseKey-tab"
);

// =========================================================================
// 3. Fix version tag display logic
//    No tag:         just show short hash (be9902a)
//    Tag + commits:  be9902a (v0.0.12)
//    Exact tag:      v0.0.12
// =========================================================================
var oldTagLogic = [
  '      if (installed) {',
  '        localHead = gitText(["git", "rev-parse", "HEAD"], dir);',
  '        subject = gitText(["git", "log", "-1", "--format=%s"], dir);',
  '        ',
  '        var desc = gitText(["git", "describe", "--tags", "--always"], dir);',
  '        var match = desc.match(/^(.*)-\\d+-g([0-9a-f]+)$/);',
  '        latestTag = match ? match[2] + " (" + match[1] + ")" : desc;',
  '      }',
].join(NL);

var newTagLogic = [
  '      if (installed) {',
  '        localHead = gitText(["git", "rev-parse", "HEAD"], dir);',
  '        subject = gitText(["git", "log", "-1", "--format=%s"], dir);',
  '        var desc = gitText(["git", "describe", "--tags", "--always"], dir);',
  '        if (desc && desc.indexOf("-") !== -1) {',
  '          var tmatch = desc.match(/^(.*)-\\d+-g([0-9a-f]+)$/);',
  '          if (tmatch) { latestTag = tmatch[2] + " (" + tmatch[1] + ")"; }',
  '          else { latestTag = desc; }',
  '        } else if (desc && /^v?\\d/.test(desc)) {',
  '          latestTag = desc;',
  '        } else {',
  '          latestTag = "";',
  '        }',
  '      }',
].join(NL);

replace(oldTagLogic, newTagLogic, "version-tag");

// =========================================================================
// 4. Fix version display in render - show short hash when no tag
// =========================================================================
var oldVersionRender = [
  '  var versionStr = pitem.latestTag',
  '    ? (GRAY + pitem.latestTag + RST)',
  '    : (pitem.localHead ? (GRAY + pitem.localHead.substring(0, 7) + RST) : (GRAY + "---" + RST));',
].join(NL);

var newVersionRender = [
  '  var versionStr = pitem.latestTag',
  '    ? (GRAY + pitem.latestTag + RST)',
  '    : (pitem.localHead ? (DIM + pitem.localHead.substring(0, 7) + RST) : (GRAY + "---" + RST));',
].join(NL);

replace(oldVersionRender, newVersionRender, "version-render");

// =========================================================================
// 5. Update plugin state: add pluginSubPage with 3 values + provider state
// =========================================================================
replace(
  'var pluginSubPage = "installed"; // "installed" | "marketplace"',
  'var pluginSubPage = "installed"; // "installed" | "marketplace" | "provider"' + NL +
  '// Provider state' + NL +
  'var providerItems = [];' + NL +
  'var providerCursor = 0;' + NL +
  '// Confirm state' + NL +
  'var confirmAction = null;' + NL +
  'var confirmLabel = "";',
  "plugin-subpage-state"
);

// =========================================================================
// 6. Update MCP state - replace category-based with installed/marketplace sub-tabs
// =========================================================================
replace(
  '// MCP state' + NL +
  'var mcpItems = buildMcpList("All");' + NL +
  'var mcpCursor = 0;' + NL +
  'var mcpScrollOff = 0;' + NL +
  'var mcpCategoryIdx = 0;' + NL +
  'var mcpMode = "catalog"; // "catalog" | "actions"' + NL +
  'var mcpAcursor = 0;',

  '// MCP state' + NL +
  'var mcpItems = buildMcpList("All");' + NL +
  'var mcpCursor = 0;' + NL +
  'var mcpScrollOff = 0;' + NL +
  'var mcpSubPage = "installed"; // "installed" | "marketplace"' + NL +
  'var mcpMode = "catalog"; // "catalog" | "actions"' + NL +
  'var mcpAcursor = 0;',
  "mcp-state"
);

// =========================================================================
// 7. Replace plugin sub-tab header to show 3 tabs: Installed | Marketplace | Provider
// =========================================================================
var oldPluginSubTabs = [
  '  // Sub-tabs: Installed | Marketplace',
  '  var instTab = pluginSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);',
  '  var mktTab = pluginSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);',
  '  pushBody("  " + instTab + "  " + mktTab + "    " + DIM + "Tab" + RST + " switch", false);',
].join(NL);

var newPluginSubTabs = [
  '  // Sub-tabs: Installed | Marketplace | Provider',
  '  var instTab = pluginSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);',
  '  var mktTab = pluginSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);',
  '  var provTab = pluginSubPage === "provider" ? (BOLD + WHITE + BG_SEL + " Provider " + RST) : (GRAY + " Provider " + RST);',
  '  pushBody("  " + instTab + "  " + mktTab + "  " + provTab + "    " + DIM + "Tab" + RST + " switch", false);',
].join(NL);

replace(oldPluginSubTabs, newPluginSubTabs, "plugin-subtabs");

// =========================================================================
// 8. Add Provider sub-page rendering (before marketplace return)
// =========================================================================
var afterMarketplaceReturn = '    return;' + NL + '  }' + NL + NL + '  var npmCount';

var providerRendering = `    return;
  }

  if (pluginSubPage === "provider") {
    providerItems = buildProviderList();
    if (providerItems.length === 0) {
      pushBody("  " + GRAY + "No AI providers found." + RST, false);
      pushBody("  " + GRAY + "Install a plugin with auth capabilities." + RST, false);
    } else {
      pushBody("  " + MAGENTA + "#" + GRAY + " AI Provider" + RST, false);
      for (var pi2 = 0; pi2 < providerItems.length; pi2++) {
        var pv = providerItems[pi2];
        var pvSel = pi2 === providerCursor;
        var pvArrow = pvSel ? (YELLOW + " > " + RST) : "   ";
        var pvBg = pvSel ? BG_SEL : "";
        var pvNameStyle = pvSel ? (BOLD + WHITE) : DIM;
        var pvActive = pv.active ? (GREEN + " ● active" + RST) : (GRAY + " ○" + RST);
        pushBody("  " + pvBg + pvArrow + pvNameStyle + pad(trunc(pv.name, nameW), nameW) + RST + pvBg + pvActive + "  " + GRAY + pv.desc + RST, pvSel);
      }
    }
    pushBody("", false);
    if (message) {
      pushFoot("  " + GREEN + "  " + trunc(message, cols - 5) + RST);
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Select  " +
      DIM + "Tab" + RST + " Switch  " +
      DIM + "Q" + RST + " Quit" + RST);
    return;
  }

  var npmCount`;

replace(afterMarketplaceReturn, providerRendering, "provider-rendering");

// =========================================================================
// 9. Add provider list builder + selector function before State section
// =========================================================================
var beforeState = '// ---------------------------------------------------------------------------' + NL + '// State' + NL + '// ---------------------------------------------------------------------------';

var providerFunctions = `function buildProviderList() {
  var list = [];
  // Builtin provider (always available)
  var config = loadConfig();
  var activeProvider = (config && config.activeProvider) || "builtin";
  list.push({ name: "Built-in " + APP_NAME, desc: "Default " + APP_NAME + " authentication", active: activeProvider === "builtin", id: "builtin" });
  // Scan installed plugins for auth providers
  var plugins = loadPlugins();
  for (var p of plugins) {
    if (p.name.indexOf("antigravity-auth") !== -1) {
      list.push({ name: p.name, desc: "Multi-account auth & proxy failover", active: activeProvider === p.name, id: p.name });
    }
  }
  return list;
}

function setActiveProvider(providerId) {
  var config = loadConfig();
  config.activeProvider = providerId;
  saveConfig(config);
  // Update all provider items
  providerItems = buildProviderList();
}

` + beforeState;

replace(beforeState, providerFunctions, "provider-functions");

// =========================================================================
// 10. Update plugin Tab handler to cycle through 3 sub-pages
// =========================================================================
replace(
  '      if (pluginSubPage === "installed") { pluginSubPage = "marketplace"; marketplaceItems = buildMarketplaceList(); mkCursor = 0; }' + NL +
  '      else { pluginSubPage = "installed"; }',

  '      if (pluginSubPage === "installed") { pluginSubPage = "marketplace"; marketplaceItems = buildMarketplaceList(); mkCursor = 0; }' + NL +
  '      else if (pluginSubPage === "marketplace") { pluginSubPage = "provider"; providerItems = buildProviderList(); providerCursor = 0; }' + NL +
  '      else { pluginSubPage = "installed"; }',
  "plugin-tab-cycle"
);

// =========================================================================
// 11. Add provider key handling in plugin handler (enter to select provider)
// =========================================================================
// Find the marketplace enter handler and add provider handling before it
var marketplaceEnter = '    else if (pluginSubPage === "marketplace" && (key === "enter" || key === "space")) {';

var providerEnter = `    else if (pluginSubPage === "provider" && (key === "enter" || key === "space")) {
      if (providerItems.length > 0) {
        var prov = providerItems[providerCursor];
        setActiveProvider(prov.id);
        flash("Provider set to: " + prov.name);
      }
    }
    else if (pluginSubPage === "provider" && (key === "up" || key === "w")) {
      providerCursor = Math.max(0, providerCursor - 1);
    }
    else if (pluginSubPage === "provider" && (key === "down" || key === "s")) {
      providerCursor = Math.min(providerItems.length - 1, providerCursor + 1);
    }
    ` + marketplaceEnter;

replace(marketplaceEnter, providerEnter, "provider-keys");

// =========================================================================
// 12. Add "uninstall" action to plugin actions menu + confirm mode
// =========================================================================
var oldPluginActions = '  a.push({ key: "disable-plugin", label: "Disable plugin" });' + NL +
  '  a.push({ key: "cancel", label: "Cancel" });';

var newPluginActions = '  a.push({ key: "disable-plugin", label: "Disable plugin" });' + NL +
  '  a.push({ key: "uninstall-plugin", label: "Uninstall plugin" });' + NL +
  '  a.push({ key: "cancel", label: "Cancel" });';

replace(oldPluginActions, newPluginActions, "plugin-uninstall-action");

// =========================================================================
// 13. Add uninstall handler in plugin action execution
// =========================================================================
var afterEnablePlugin = '      else if (action === "enable-plugin") {';

// Find the block and add uninstall before it
var uninstallHandler = `      else if (action === "uninstall-plugin") {
        confirmAction = { type: "uninstall-plugin", target: pitem };
        confirmLabel = "Uninstall " + pitem.name + "? This will delete the repo. (Y to confirm)";
        flash(confirmLabel);
        mode = "confirm";
      }
      ` + afterEnablePlugin;

replace(afterEnablePlugin, uninstallHandler, "plugin-uninstall-handler");

// =========================================================================
// 14. Add confirm mode handling in handlePluginKey
// =========================================================================
var pluginKeyEnd = 'function handleMcpKey(key) {';

var confirmHandler = `function handleConfirmKey(key) {
  if (key === "y") {
    if (confirmAction && confirmAction.type === "uninstall-plugin") {
      var pitem = confirmAction.target;
      // Remove from plugins.json
      var plugins = loadPlugins();
      plugins = plugins.filter(function(r) { return r.name !== pitem.name; });
      savePlugins(plugins);
      // Delete deployed file
      var deployedPath = join(PLUGINS_DIR, (pitem.pluginFile || "plugin.js"));
      if (existsSync(deployedPath)) { try { unlinkSync(deployedPath); } catch {} }
      // Delete repo folder
      var repoDir = join(REPOS_DIR, pitem.folderName);
      if (existsSync(repoDir)) {
        try { execSync((process.platform === "win32" ? "rmdir /s /q " : "rm -rf ") + '"' + repoDir + '"', { timeout: 30000, stdio: "ignore" }); } catch {}
      }
      pluginItems = buildCombinedPluginList();
      if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
      flash(pitem.name + " uninstalled.");
    } else if (confirmAction && confirmAction.type === "uninstall-mcp") {
      uninstallMcpServer(confirmAction.target);
      mcpItems = buildMcpList("All");
      if (mcpCursor >= mcpItems.length) mcpCursor = Math.max(0, mcpItems.length - 1);
      flash(confirmAction.target + " removed.");
    }
    confirmAction = null;
    confirmLabel = "";
    mode = "list";
  } else if (key === "escape" || key === "q") {
    confirmAction = null;
    confirmLabel = "";
    mode = "list";
    flash("Cancelled.");
  }
}

` + pluginKeyEnd;

replace(pluginKeyEnd, confirmHandler, "confirm-handler");

// =========================================================================
// 15. Add confirm mode to key routing
// =========================================================================
replace(
  '  if (page === "projects") {' + NL +
  '    handleProjectKey(key);' + NL +
  '  } else if (page === "mcp") {' + NL +
  '    handleMcpKey(key);' + NL +
  '  } else {' + NL +
  '    handlePluginKey(key);' + NL +
  '  }',

  '  if (mode === "confirm") {' + NL +
  '    handleConfirmKey(key);' + NL +
  '  } else if (page === "projects") {' + NL +
  '    handleProjectKey(key);' + NL +
  '  } else if (page === "mcp") {' + NL +
  '    handleMcpKey(key);' + NL +
  '  } else {' + NL +
  '    handlePluginKey(key);' + NL +
  '  }',
  "confirm-routing"
);

// =========================================================================
// 16. Restructure MCP page - replace category tabs with Installed/Marketplace
// =========================================================================
// Replace the entire buildMcp function
var oldBuildMcpStart = 'function buildMcp(pushBody, pushFoot, cols, barW) {';
var oldBuildMcpEnd = '  pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +' + NL +
  '    DIM + "Enter" + RST + " Select  " +' + NL +
  '    DIM + "I" + RST + " Install  " +' + NL +
  '    DIM + "X" + RST + " Uninstall  " +' + NL +
  '    DIM + "<>" + RST + " Category  " +' + NL +
  '    DIM + "Q" + RST + " Quit" + RST);' + NL +
  '}';

var buildMcpStartIdx = src.indexOf(oldBuildMcpStart);
var buildMcpEndIdx = src.indexOf(oldBuildMcpEnd);

if (buildMcpStartIdx !== -1 && buildMcpEndIdx !== -1) {
  var before = src.substring(0, buildMcpStartIdx);
  var after = src.substring(buildMcpEndIdx + oldBuildMcpEnd.length);

  var newBuildMcp = `function buildMcp(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(18, cols - 50));

  if (mcpMode === "actions") {
    var mitem = mcpSubPage === "installed" ? getInstalledMcpList()[mcpCursor] : mcpItems[mcpCursor];
    if (!mitem) { mcpMode = "catalog"; return; }
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
      var aSel = j === mcpAcursor;
      if (aSel) {
        pushBody("    " + GREEN + "  > " + BOLD + a.label + RST, true);
      } else {
        pushBody("    " + GRAY + "    " + a.label + RST, false);
      }
    }
    pushBody("", false);
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Confirm  " +
      DIM + "Esc" + RST + " Back" + RST);
    return;
  }

  // Sub-tabs: Installed | Marketplace
  var mcpInstTab = mcpSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);
  var mcpMktTab = mcpSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);
  pushBody("  " + mcpInstTab + "  " + mcpMktTab + "    " + DIM + "Tab" + RST + " switch", false);
  pushBody("", false);

  if (mcpSubPage === "installed") {
    var installedList = getInstalledMcpList();
    if (installedList.length === 0) {
      pushBody("  " + GRAY + "No MCP servers installed." + RST, false);
      pushBody("  " + GRAY + "Switch to Marketplace to browse and install servers." + RST, false);
    } else {
      pushBody("  " + MAGENTA + "#" + GRAY + " Installed MCP Servers (" + installedList.length + ")" + RST, false);
      for (var i = 0; i < installedList.length; i++) {
        var m = installedList[i];
        var sel = i === mcpCursor;
        var arrow = sel ? (YELLOW + " > " + RST) : "   ";
        var bg = sel ? BG_SEL : "";
        var nameStyle = sel ? (BOLD + WHITE) : DIM;
        pushBody("  " + bg + arrow + GREEN + "\\u25cf" + RST + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + m.command + " " + (m.args || []).join(" ") + RST, sel);
        if (sel) {
          var ek = Object.keys(m.env || {});
          if (ek.length > 0) pushBody("  " + GRAY + "     env: " + ek.join(", ") + RST, sel);
        }
      }
    }
    pushBody("", false);
    if (message) {
      pushFoot("  " + GREEN + "  " + trunc(message, cols - 5) + RST);
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Actions  " +
      DIM + "X" + RST + " Uninstall  " +
      DIM + "Tab" + RST + " Switch  " +
      DIM + "Q" + RST + " Quit" + RST);
  } else {
    // Marketplace
    mcpItems = buildMcpList("All");
    pushBody("  " + MAGENTA + "#" + GRAY + " MCP Marketplace (" + mcpItems.length + " available)" + RST, false);
    for (var i = 0; i < mcpItems.length; i++) {
      var m = mcpItems[i];
      var sel = i === mcpCursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      var statusIcon = m.installed ? (GREEN + "\\u25cf" + RST) : (GRAY + "\\u25cb" + RST);
      pushBody("  " + bg + arrow + statusIcon + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + trunc(m.desc, Math.max(10, cols - nameW - 20)) + RST, sel);
      if (sel) {
        pushBody("  " + GRAY + "     " + m.command + " " + (m.args || []).join(" ") + RST, sel);
        var ek = Object.keys(m.env || {});
        if (ek.length > 0) pushBody("  " + GRAY + "     env: " + ek.join(", ") + RST, sel);
      }
    }
    pushBody("", false);
    if (message) {
      pushFoot("  " + GREEN + "  " + trunc(message, cols - 5) + RST);
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Select  " +
      DIM + "I" + RST + " Install  " +
      DIM + "Tab" + RST + " Switch  " +
      DIM + "Q" + RST + " Quit" + RST);
  }
}`;

  src = before + newBuildMcp + after;
  console.log("OK [buildMcp-restructure]");
} else {
  console.error("SKIP [buildMcp-restructure]: markers not found");
}

// =========================================================================
// 17. Add getInstalledMcpList helper near other MCP functions
// =========================================================================
var mcpListMarker = 'function buildMcpList(categoryFilter) {';
if (src.includes(mcpListMarker)) {
  src = src.replace(mcpListMarker,
    `function getInstalledMcpList() {
  var config = loadMcpConfig();
  var servers = config.mcpServers || {};
  var list = [];
  for (var name of Object.keys(servers)) {
    var s = servers[name];
    list.push({ name: name, command: s.command || "", args: s.args || [], env: s.env || {}, installed: true });
  }
  return list;
}

` + mcpListMarker);
  console.log("OK [getInstalledMcpList]");
}

// =========================================================================
// 18. Rewrite handleMcpKey for installed/marketplace sub-tabs
// =========================================================================
var oldMcpKeyStart = 'function handleMcpKey(key) {';
var oldMcpKeyEnd = '    else if (key === "escape" || key === "left") { mcpMode = "catalog"; }' + NL + '  }' + NL + '}';

var mcpKeyStartIdx = src.indexOf(oldMcpKeyStart);
var mcpKeyEndIdx = src.indexOf(oldMcpKeyEnd);

if (mcpKeyStartIdx !== -1 && mcpKeyEndIdx !== -1) {
  var before = src.substring(0, mcpKeyStartIdx);
  var after = src.substring(mcpKeyEndIdx + oldMcpKeyEnd.length);

  var newMcpKey = `function handleMcpKey(key) {
  if (mcpMode === "catalog") {
    if (key === "tab") {
      if (mcpSubPage === "installed") { mcpSubPage = "marketplace"; mcpItems = buildMcpList("All"); mcpCursor = 0; }
      else { mcpSubPage = "installed"; mcpCursor = 0; }
      mcpScrollOff = 0;
    }
    else if (key === "up" || key === "w") { mcpCursor = Math.max(0, mcpCursor - 1); }
    else if (key === "down" || key === "s") {
      var maxLen = mcpSubPage === "installed" ? getInstalledMcpList().length : mcpItems.length;
      mcpCursor = Math.min(maxLen - 1, mcpCursor + 1);
    }
    else if (key === "enter" || key === "space") {
      var maxLen = mcpSubPage === "installed" ? getInstalledMcpList().length : mcpItems.length;
      if (maxLen > 0) { mcpMode = "actions"; mcpAcursor = 0; }
    }
    else if (key === "i" && mcpSubPage === "marketplace") {
      if (mcpItems.length > 0 && !mcpItems[mcpCursor].installed) {
        installMcpServer(mcpItems[mcpCursor]);
        mcpItems = buildMcpList("All");
        flash(mcpItems[mcpCursor] ? mcpItems[mcpCursor].name + " installed. Restart " + APP_NAME + " to activate." : "Installed.");
      }
    }
    else if (key === "x" && mcpSubPage === "installed") {
      var instList = getInstalledMcpList();
      if (instList.length > 0 && mcpCursor < instList.length) {
        confirmAction = { type: "uninstall-mcp", target: instList[mcpCursor].name };
        confirmLabel = "Remove " + instList[mcpCursor].name + "? (Y to confirm)";
        flash(confirmLabel);
        mode = "confirm";
      }
    }
    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }
  } else if (mcpMode === "actions") {
    var activeList = mcpSubPage === "installed" ? getInstalledMcpList() : mcpItems;
    var mitem = activeList[mcpCursor];
    if (!mitem) { mcpMode = "catalog"; return; }
    var acts = getMcpActions(mitem);
    if (key === "up" || key === "w") { mcpAcursor = Math.max(0, mcpAcursor - 1); }
    else if (key === "down" || key === "s") { mcpAcursor = Math.min(acts.length - 1, mcpAcursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[mcpAcursor].key;
      if (action === "install") {
        installMcpServer(mitem);
        mcpItems = buildMcpList("All");
        flash(mitem.name + " installed. Restart " + APP_NAME + " to activate.");
        mcpMode = "catalog";
      } else if (action === "uninstall") {
        confirmAction = { type: "uninstall-mcp", target: mitem.name };
        confirmLabel = "Remove " + mitem.name + "? (Y to confirm)";
        flash(confirmLabel);
        mode = "confirm";
        mcpMode = "catalog";
      } else if (action === "configure") {
        flash("Set env vars in " + MCP_CONFIG_PATH);
        mcpMode = "catalog";
      } else {
        mcpMode = "catalog";
      }
    }
    else if (key === "escape" || key === "left") { mcpMode = "catalog"; }
  }
}`;

  src = before + newMcpKey + after;
  console.log("OK [handleMcpKey-restructure]");
} else {
  console.error("SKIP [handleMcpKey-restructure]: markers not found (start=" + (mcpKeyStartIdx !== -1) + ", end=" + (mcpKeyEndIdx !== -1) + ")");
}

// =========================================================================
// Write result
// =========================================================================
writeFileSync(filePath, src, "utf-8");
console.log("\nDone. Lines: " + src.split(NL).length);
