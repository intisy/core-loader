var fs = require("fs");
var src = fs.readFileSync("tui.js", "utf-8");
var NL = src.includes("\r\n") ? "\r\n" : "\n";

var searchStr = 'var MARKETPLACE_CATALOG = [';
var idx = src.indexOf(searchStr);

if (idx !== -1) {
  var before = src.substring(0, idx);
  var after = src.substring(idx);
  
  var asyncCode = `var { exec } = require("child_process");
var catalogFetched = false;
function fetchCatalogsAsync() {
  if (catalogFetched) return;
  catalogFetched = true;
  
  var curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
  
  // Fetch plugins
  exec(curlCmd + ' -s -H "User-Agent: OpenCode" "https://api.github.com/search/repositories?q=topic:claude-code-plugin&sort=stars&order=desc"', function(err, stdout) {
    if (!err && stdout) {
      try {
        var json = JSON.parse(stdout);
        if (json.items) {
          for (var i = 0; i < json.items.length; i++) {
            var it = json.items[i];
            var cleanName = it.name.replace(/^claude-|^opencode-/, "");
            var exists = MARKETPLACE_CATALOG.find(function(m) { return m.name === cleanName; });
            if (!exists) {
              MARKETPLACE_CATALOG.push({
                name: cleanName,
                desc: it.description || "",
                author: it.owner.login,
                url: "https://github.com/" + it.owner.login,
                category: "Community",
                stars: it.stargazers_count
              });
            } else {
              exists.stars = it.stargazers_count;
            }
          }
          MARKETPLACE_CATALOG.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); });
          if (pluginSubPage === "marketplace") {
             marketplaceItems = buildMarketplaceList();
             render();
          }
        }
      } catch(e) {}
    }
  });

  // Fetch MCPs
  exec(curlCmd + ' -s -H "User-Agent: OpenCode" "https://api.github.com/search/repositories?q=topic:mcp-server&sort=stars&order=desc"', function(err, stdout) {
    if (!err && stdout) {
      try {
        var json = JSON.parse(stdout);
        if (json.items) {
          for (var i = 0; i < json.items.length; i++) {
            var it = json.items[i];
            var exists = MCP_CATALOG.find(function(m) { return m.name === it.name; });
            if (!exists) {
              MCP_CATALOG.push({
                name: it.name,
                desc: it.description || "",
                command: "npx",
                args: ["-y", it.full_name],
                env: {},
                category: "Community",
                stars: it.stargazers_count
              });
            } else {
              exists.stars = it.stargazers_count;
            }
          }
          MCP_CATALOG.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); });
          if (page === "mcp" && mcpSubPage === "marketplace") {
             mcpItems = buildMcpList("All");
             render();
          }
        }
      } catch(e) {}
    }
  });
}

`;
  
  src = before + asyncCode + after;
  
  // Now inject call to fetchCatalogsAsync inside buildMarketplaceList
  var buildPluginMarker = 'function buildMarketplaceList() {';
  src = src.replace(buildPluginMarker, buildPluginMarker + NL + '  fetchCatalogsAsync();');
  
  var buildMcpMarker = 'function buildMcpList(categoryFilter) {';
  src = src.replace(buildMcpMarker, buildMcpMarker + NL + '  fetchCatalogsAsync();');
  
  fs.writeFileSync("tui.js", src, "utf-8");
  console.log("OK [Dynamic Fetching Injected]");
} else {
  console.log("Failed to find MARKETPLACE_CATALOG");
}
