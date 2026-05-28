var fs = require("fs");
var src = fs.readFileSync("tui.js", "utf-8");
var NL = src.includes("\r\n") ? "\r\n" : "\n";

var startMarker = 'function handlePluginKey(key) {' + NL + '  if (mode === "list") {';
var endMarker = '  } else if (mode === "pactions") {';

var startIdx = src.indexOf(startMarker);
var endIdx = src.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  var before = src.substring(0, startIdx);
  var after = src.substring(endIdx);
  
  var newBlock = `function handlePluginKey(key) {
  if (mode === "list") {
    if (key === "q" || key === "escape") { cleanup(); process.exit(1); return; }
    
    if (key === "tab") {
      if (pluginSubPage === "installed") { pluginSubPage = "marketplace"; marketplaceItems = buildMarketplaceList(); mkCursor = 0; }
      else if (pluginSubPage === "marketplace") { pluginSubPage = "provider"; providerItems = buildProviderList(); providerCursor = 0; }
      else { pluginSubPage = "installed"; }
      return;
    }

    if (pluginSubPage === "marketplace") {
      if (key === "up" || key === "w") { mkCursor = Math.max(0, mkCursor - 1); }
      else if (key === "down" || key === "s") { mkCursor = Math.min(marketplaceItems.length - 1, mkCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (marketplaceItems.length > 0) {
          flash("Installing " + marketplaceItems[mkCursor].name + "...");
          render();
          var merr = installMarketplacePlugin(marketplaceItems[mkCursor]);
          if (merr) flash(merr);
          else { flash("Installed! Restart to activate."); pluginItems = buildCombinedPluginList(); }
          marketplaceItems = buildMarketplaceList();
          if (mkCursor >= marketplaceItems.length) mkCursor = Math.max(0, marketplaceItems.length - 1);
        }
      }
    }
    else if (pluginSubPage === "provider") {
      if (key === "up" || key === "w") { providerCursor = Math.max(0, providerCursor - 1); }
      else if (key === "down" || key === "s") { providerCursor = Math.min(providerItems.length - 1, providerCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (providerItems.length > 0) {
          var prov = providerItems[providerCursor];
          setActiveProvider(prov.id);
          flash("Provider set to: " + prov.name);
        }
      }
    }
    else { // installed
      if (key === "up" || key === "w") { pcursor = Math.max(0, pcursor - 1); }
      else if (key === "down" || key === "s") { pcursor = Math.min(pluginItems.length - 1, pcursor + 1); }
      else if (key === "enter" || key === "space") {
        if (pluginItems.length > 0 && pluginItems[pcursor].type !== "npm") { mode = "pactions"; pacursor = 0; }
        else if (pluginItems.length > 0 && pluginItems[pcursor].type === "npm") { flash(pluginItems[pcursor].name + " is managed via npm"); }
      }
      else if (key === "f") {
        flash("Fetching remotes...");
        render();
        fetchPluginRemotes(pluginItems);
        pluginFetched = true;
        var updateCount = 0;
        for (var p of pluginItems) { if (p.updateAvail) updateCount++; }
        flash(updateCount > 0 ? updateCount + " update(s) available" : "All plugins up to date");
      }
      else if (key === "a") {
        var toUpdate = pluginItems.filter(function(p) { return p.type !== "npm" && (p.updateAvail || !p.deployed); });
        if (toUpdate.length === 0) {
          flash("All plugins are already up to date.");
        } else {
          var errors = [];
          for (var pi of toUpdate) {
            flash("Updating " + pi.name + "...");
            render();
            var e = runPluginUpdate(pi);
            if (e) errors.push(pi.name + ": " + e);
          }
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(errors.length > 0 ? errors.join("; ") : toUpdate.length + " plugin(s) updated. Restart OpenCode to apply.");
        }
      }
      else if (key === "u") {
        if (pluginItems.length > 0 && pluginItems[pcursor].type !== "npm") {
          var p = pluginItems[pcursor];
          flash("Updating " + p.name + "...");
          render();
          var err = runPluginUpdate(p);
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(err ? p.name + ": " + err : p.name + " updated. Restart OpenCode to apply.");
        }
      }
      else if (key === "d") {
        if (pluginItems.length > 0 && pluginItems[pcursor].type !== "npm") {
          var p = pluginItems[pcursor];
          var plugins = loadPlugins();
          var match = plugins.find(function(r) { return r.name === p.name; });
          if (match) { match.enabled = false; savePlugins(plugins); }
          var deployedPath = join(PLUGINS_DIR, (p.pluginFile || "plugin.js"));
          if (existsSync(deployedPath)) { try { unlinkSync(deployedPath); } catch {} }
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(p.name + " disabled. Restart OpenCode to unload.");
        }
      }
    }
`;
  
  fs.writeFileSync("tui.js", before + newBlock + after, "utf-8");
  console.log("OK [handlePluginKey refactored]");
} else {
  console.log("Failed to find markers");
}
