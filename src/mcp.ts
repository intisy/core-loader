// @ts-nocheck
// MCP server catalog, install/uninstall, and the per-server action menu.
// Merges the curated MCP_CATALOG with plugin-embedded .mcp.json servers.

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { HOME, MCP_CATALOG } from "./env.js";
import { loadMcpConfig, saveMcpConfig } from "./config.js";
import { fetchCatalogsAsync } from "./marketplace.js";

export function scanPluginEmbeddedMcps() {
  var embedded = {};
  var baseMcpNames = {};

  function scanReposDir(reposDir) {
    if (!existsSync(reposDir)) return;
    try {
      var authors = readdirSync(reposDir);
      for (var author of authors) {
        var authorDir = join(reposDir, author);
        try {
          var repos = readdirSync(authorDir);
          for (var repo of repos) {
            var candidates = [
              join(authorDir, repo, ".mcp.json"),
              join(authorDir, repo, "plugin", ".mcp.json")
            ];
            for (var mcpFile of candidates) {
              if (existsSync(mcpFile)) {
                try {
                  var data = JSON.parse(readFileSync(mcpFile, "utf-8"));
                  var servers = data.mcpServers || {};
                  for (var sname of Object.keys(servers)) {
                    var key = "plugin:" + repo.toLowerCase() + ":" + sname;
                    if (!embedded[key]) {
                      embedded[key] = Object.assign({ _pluginSource: repo }, servers[sname]);
                      baseMcpNames[sname] = true;
                    }
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  function scanPluginCache(cacheDir) {
    if (!existsSync(cacheDir)) return;
    try {
      var orgs = readdirSync(cacheDir);
      for (var org of orgs) {
        var orgDir = join(cacheDir, org);
        try {
          var names = readdirSync(orgDir);
          for (var pname of names) {
            var pnameDir = join(orgDir, pname);
            try {
              var versions = readdirSync(pnameDir);
              versions.sort();
              var latest = versions[versions.length - 1];
              if (latest) {
                var candidates = [
                  join(pnameDir, latest, ".mcp.json"),
                  join(pnameDir, latest, "plugin", ".mcp.json")
                ];
                for (var mcpFile of candidates) {
                  if (existsSync(mcpFile)) {
                    try {
                      var data = JSON.parse(readFileSync(mcpFile, "utf-8"));
                      var servers = data.mcpServers || {};
                      for (var sname of Object.keys(servers)) {
                        var key = "plugin:" + pname.toLowerCase() + ":" + sname;
                        if (!embedded[key]) {
                          embedded[key] = Object.assign({ _pluginSource: pname }, servers[sname]);
                          baseMcpNames[sname] = true;
                        }
                      }
                    } catch {}
                  }
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  // Always scan both Claude and OpenCode directories
  var claudeDir = join(HOME, ".config", "claude");
  var ocDir = join(HOME, ".config", "opencode");
  scanReposDir(join(claudeDir, "repos"));
  scanReposDir(join(ocDir, "repos"));
  scanPluginCache(join(claudeDir, "plugins", "cache"));
  scanPluginCache(join(ocDir, "plugins", "cache"));

  embedded._baseMcpNames = baseMcpNames;
  return embedded;
}

export function getInstalledMcpList() {
  var config = loadMcpConfig();
  var servers = config.mcpServers || {};
  var list = [];
  for (var name of Object.keys(servers)) {
    var s = servers[name];
    list.push({ name: name, command: s.command || "", args: s.args || [], env: s.env || {}, installed: true });
  }
  // Merge plugin-embedded MCPs
  var embedded = scanPluginEmbeddedMcps();
  for (var ename of Object.keys(embedded)) {
    if (ename === "_baseMcpNames") continue;
    if (!servers[ename]) {
      var e = embedded[ename];
      list.push({ name: ename, command: e.command || "", args: e.args || [], env: e.env || {}, installed: true, pluginSource: e._pluginSource, embedded: true });
    }
  }
  return list;
}

export function buildMcpList(categoryFilter) {
  fetchCatalogsAsync();
  var installed = loadMcpConfig().mcpServers || {};
  var embedded = scanPluginEmbeddedMcps();
  var baseMcpNames = embedded._baseMcpNames || {};
  var list = [];
  var seen = {};
  for (var entry of MCP_CATALOG) {
    if (categoryFilter && categoryFilter !== "All" && entry.category !== categoryFilter) continue;
    list.push({
      name: entry.name, desc: entry.desc, command: entry.command,
      args: entry.args.slice(), env: Object.assign({}, entry.env),
      category: entry.category, installed: !!(installed[entry.name] || baseMcpNames[entry.name]),
      stars: entry.stars
    });
    seen[entry.name] = true;
  }
  // Append plugin-embedded MCPs that aren't in the catalog
  if (!categoryFilter || categoryFilter === "All") {
    for (var ename of Object.keys(embedded)) {
      if (ename === "_baseMcpNames") continue;
      if (!seen[ename] && !installed[ename]) {
        var e = embedded[ename];
        list.push({
          name: ename, desc: "Plugin MCP (" + (e._pluginSource || "unknown") + ")",
          command: e.command || "", args: e.args || [], env: e.env || {},
          category: "Plugin", installed: true, embedded: true, pluginSource: e._pluginSource
        });
      }
    }
  }
  return list;
}

export function installMcpServer(entry) {
  var config = loadMcpConfig();
  var serverConfig = { command: entry.command, args: entry.args.slice() };
  var envKeys = Object.keys(entry.env || {});
  if (envKeys.length > 0) serverConfig.env = Object.assign({}, entry.env);
  config.mcpServers[entry.name] = serverConfig;
  saveMcpConfig(config);
}

export function uninstallMcpServer(name) {
  var config = loadMcpConfig();
  delete config.mcpServers[name];
  saveMcpConfig(config);
}

export function getMcpActions(mitem) {
  var a = [];
  if (mitem.installed) {
    a.push({ key: "uninstall", label: "Uninstall" });
  } else {
    a.push({ key: "install", label: "Install" });
  }
  var envKeys = Object.keys(mitem.env || {});
  if (envKeys.length > 0) {
    a.push({ key: "configure", label: "Configure API keys" });
  }
  // Derive npm URL from package name in args
  var npmPkg = (mitem.args || []).find(function(arg) { return arg.indexOf("@") !== -1 && arg !== "-y"; });
  if (npmPkg) {
    a.push({ key: "browser", label: "Open in browser" });
  }
  a.push({ key: "cancel", label: "Cancel" });
  return a;
}

