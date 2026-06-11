#!/usr/bin/env bun
// @ts-nocheck

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// plugin-updater runs its full update sequence on import and logs to the
// console; library mode limits it to the API so nothing prints over the TUI
process.env.PLUGIN_UPDATER_LIBRARY_MODE = "1";

var HOME = homedir();
var APP_NAME = process.env.HUB_APP_NAME || "OpenCode";
var CLI_CMD = process.env.HUB_CLI_CMD || "opencode";
var NPM_PKG = process.env.HUB_NPM_PKG || "opencode-ai";
var CONFIG_DIR = process.env.HUB_CONFIG_DIR || join(HOME, ".config", "opencode");
var CACHE_PKG_DIR = process.env.HUB_CACHE_PKG_DIR || join(CONFIG_DIR, "cache", "node_modules");

// opencode keeps its session database in the XDG data dir, not the config dir
var DB_PATH = process.env.HUB_DB_PATH || [
  join(HOME, ".local", "share", "opencode", "opencode.db"),
  join(CONFIG_DIR, "opencode.db"),
].find(function(p) { return existsSync(p); }) || join(HOME, ".local", "share", "opencode", "opencode.db");
var globalKeyHandler = null;
var CONFIG_FOLDER = join(CONFIG_DIR, "config");
var CACHE_DIR = join(CONFIG_DIR, "cache");
var CONFIG_PATH = join(CONFIG_FOLDER, "oc-config.json");
var UPDATE_CHECK_PATH = join(CACHE_DIR, "oc-last-update-check");
var PLUGINS_JSON = join(CONFIG_FOLDER, "plugins.json");
var REPOS_DIR = join(CONFIG_DIR, "repos");
var PLUGINS_DIR = join(CONFIG_DIR, "plugin");

// anything printed to the terminal corrupts the TUI — diagnostics go to a file
var TUI_START_TIME = new Date().toISOString().replace(/:/g, "-").split(".")[0];
function tuiLog(msg) {
  try {
    var dateStr = new Date().toISOString().split("T")[0];
    var logsDir = join(CONFIG_DIR, "logs", dateStr);
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    require("fs").appendFileSync(join(logsDir, "loader-tui-" + TUI_START_TIME + ".log"),
      "[" + new Date().toISOString() + "] " + msg + "\n");
  } catch {}
}

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

var UPDATER_MODULE;
var UPDATER_PATH = "";
function getUpdater() {
  if (UPDATER_MODULE !== undefined) return UPDATER_MODULE;
  const fs = require('fs');
  const path = require('path');
  const updaterCandidates = [
    path.join(PLUGINS_DIR, "plugin-updater", "index.js"),
    path.join(CONFIG_DIR, "node_modules", "plugin-updater"),
    path.join(require('os').homedir(), ".cache", "opencode", "packages", "plugin-updater@latest", "node_modules", "plugin-updater"),
  ];
  // under claude the updater arrives via npx, whose cache lives in ~/.npm/_npx
  try {
    const npxRoot = path.join(require('os').homedir(), ".npm", "_npx");
    for (const npxEntry of fs.readdirSync(npxRoot)) {
      const candidate = path.join(npxRoot, npxEntry, "node_modules", "plugin-updater");
      if (fs.existsSync(candidate)) { updaterCandidates.push(candidate); break; }
    }
  } catch {}
  const updaterPath = updaterCandidates.find(function(p) { return fs.existsSync(p); });
  if (updaterPath) {
    try {
      UPDATER_MODULE = require(updaterPath);
      UPDATER_PATH = updaterPath;
      return UPDATER_MODULE;
    } catch(e) {
      tuiLog("Failed to load updater plugin from " + updaterPath + ": " + e);
    }
  }
  try {
    UPDATER_MODULE = require("plugin-updater");
    return UPDATER_MODULE;
  } catch {}
  UPDATER_MODULE = null;
  return null;
}

function getUpdaterVersion() {
  try {
    if (!getUpdater() || !UPDATER_PATH) return "";
    var pkgPath = UPDATER_PATH.endsWith("index.js")
      ? join(dirname(UPDATER_PATH), "package.json")
      : join(UPDATER_PATH, "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "";
  } catch { return ""; }
}

function setupPlugin(repo, done) {
  var updater = getUpdater();
  if (!updater || typeof updater.updatePluginPublic !== "function") {
    done("updater not available");
    return;
  }
  Promise.resolve(updater.updatePluginPublic(repo.name, repo.url, repo.branch))
    .then(function() { done(""); })
    .catch(function(e) { done(String((e && e.message) || e)); });
}

var NPM_GLOBAL_ROOT = null;
function getNpmGlobalRoot() {
  if (NPM_GLOBAL_ROOT !== null) return NPM_GLOBAL_ROOT;
  try { NPM_GLOBAL_ROOT = execSync("npm root -g", { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { NPM_GLOBAL_ROOT = ""; }
  return NPM_GLOBAL_ROOT;
}

function loadNpmPlugins() {
  // Delegate to updater API when available; fall back to direct read
  var updater = getUpdater();
  if (updater && typeof updater.getNpmPlugins === "function") {
    try {
      return updater.getNpmPlugins(CONFIG_DIR);
    } catch(e) { /* fall through to direct read */ }
  }
  var ocPath = join(CONFIG_DIR, "opencode.json");
  if (!existsSync(ocPath)) return [];
  try {
    var raw = readFileSync(ocPath, "utf-8");
    var stripped = raw.replace(/^\s*\/\/[^\n]*/gm, "");
    var oc = JSON.parse(stripped);
    var plugins = oc.plugin || [];
    return plugins
      .filter(function(p) { return typeof p === "string"; })
      .map(function(p) {
        var name = p.replace(/@[^@\/]+$/, "") || p;
        var version = "";
        try {
          // opencode installs npm plugins into ~/.cache/opencode/packages/<name>@<spec>/
          var pkgCache = join(homedir(), ".cache", "opencode", "packages");
          if (existsSync(pkgCache)) {
            var cacheEntries = require("fs").readdirSync(pkgCache);
            for (var entry of cacheEntries) {
              if (entry !== name && entry.indexOf(name + "@") !== 0) continue;
              var cachedPkg = join(pkgCache, entry, "node_modules", name, "package.json");
              if (existsSync(cachedPkg)) {
                version = JSON.parse(readFileSync(cachedPkg, "utf-8")).version || "";
                break;
              }
            }
          }
          if (!version) {
            var roots = [CACHE_PKG_DIR, join(CONFIG_DIR, "node_modules"), getNpmGlobalRoot()];
            for (var root of roots) {
              if (!root) continue;
              var pkgPath = join(root, name, "package.json");
              if (existsSync(pkgPath)) {
                version = JSON.parse(readFileSync(pkgPath, "utf-8")).version || "";
                break;
              }
            }
          }
        } catch {}
        return { name: name, version: version, installed: version !== "", raw: p };
      });
  } catch { return []; }
}

function getFolderName(plugin) {
  var match = (plugin.url || "").match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (match) {
    var nested = match[1] + "/" + plugin.name;
    if (existsSync(join(REPOS_DIR, nested))) return nested;
  }
  // plugin-updater clones flat into repos/<name>
  return plugin.name;
}

function migrateConfigs() {
  if (!existsSync(CONFIG_FOLDER)) try { mkdirSync(CONFIG_FOLDER, { recursive: true }); } catch {}
  var legacyConfig = join(CONFIG_DIR, "oc-config.json");
  if (existsSync(legacyConfig) && !existsSync(CONFIG_PATH)) {
    try { copyFileSync(legacyConfig, CONFIG_PATH); } catch {}
  }
  var legacyPlugins = join(CONFIG_DIR, "plugins.json");
  if (existsSync(legacyPlugins) && !existsSync(PLUGINS_JSON)) {
    try { copyFileSync(legacyPlugins, PLUGINS_JSON); try { unlinkSync(legacyPlugins); } catch {} } catch {}
  }
}

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

function loadConfig() {
  try { if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); } catch {}
  var legacy = join(CONFIG_DIR, "oc-config.json");
  try { if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf-8")); } catch {}
  return { pinned: [], hidden: [] };
}
function saveConfig(cfg) {
  try {
    if (!existsSync(CONFIG_FOLDER)) mkdirSync(CONFIG_FOLDER, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch {}
}

function queryProjects() {
  if (APP_NAME === "Claude Code") {
    var historyPath = join(CONFIG_DIR, "history.jsonl");
    if (!existsSync(historyPath)) return [];
    try {
      var lines = readFileSync(historyPath, "utf8").split("\n").filter(Boolean);
      var projects = {};
      for (var line of lines) {
        try {
          var parsed = JSON.parse(line);
          if (parsed.project) {
            if (!projects[parsed.project]) {
              projects[parsed.project] = { last_used: 0, sessions: new Set() };
            }
            if (parsed.timestamp > projects[parsed.project].last_used) {
              projects[parsed.project].last_used = parsed.timestamp;
            }
            if (parsed.sessionId) {
              projects[parsed.project].sessions.add(parsed.sessionId);
            }
          }
        } catch (e) {}
      }
      return Object.keys(projects).map(function(dir) {
        return {
          directory: dir,
          last_used: projects[dir].last_used,
          sessions: projects[dir].sessions.size
        };
      }).sort(function(a, b) { return b.last_used - a.last_used; }).slice(0, 30);
    } catch (e) { return []; }
  }

  if (!existsSync(DB_PATH)) return [];
  try {
    var db = new Database(DB_PATH, { readonly: true });
    var rows = db.query(
      "SELECT directory, MAX(time_updated) as last_used, COUNT(*) as sessions " +
      "FROM session WHERE parent_id IS NULL GROUP BY directory ORDER BY last_used DESC LIMIT 30"
    ).all();
    db.close();
    return rows;
  } catch (e) { return []; }
}

function timeAgo(ts) {
  if (!ts) return "--";
  var d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}

function shortPath(dir) {
  var h = HOME.replace(/\\/g, "/");
  var d = dir.replace(/\\/g, "/");
  if (d.startsWith(h)) d = "~" + d.substring(h.length);
  return d;
}

function stringWidth(str) {
  var w = 0;
  str = String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0x1100 && c <= 0xD7AF || c >= 0x3040 && c <= 0x313F || c >= 0xF900 && c <= 0xFAFF || c >= 0xFF00 && c <= 0xFFEF) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function pad(s, len) {
  s = String(s || "");
  var w = stringWidth(s);
  var padStr = "";
  while (w < len) { padStr += " "; w++; }
  return s + padStr;
}

function trunc(s, len) {
  s = String(s || "");
  if (stringWidth(s) <= len) return s;
  var res = "";
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var cw = stringWidth(s[i]);
    if (w + cw > len - 3) break;
    w += cw;
    res += s[i];
  }
  return res + "...";
}

function buildList() {
  var cfg = loadConfig();
  var rows = queryProjects();
  var list = [];

  var pinnedItems = [];
  for (var dir of cfg.pinned) {
    var row = rows.find(function(r) { return r.directory === dir; });
    if (cfg.hidden.indexOf(dir) !== -1) continue;
    pinnedItems.push({
      dir: dir,
      name: dir.split(/[\\/]/).pop() || dir,
      sessions: row ? row.sessions : 0,
      lastUsed: row ? row.last_used : 0,
      pinned: true
    });
  }
  pinnedItems.sort(function(a, b) { return (b.lastUsed || 0) - (a.lastUsed || 0); });
  for (var pi = 0; pi < pinnedItems.length; pi++) { list.push(pinnedItems[pi]); }

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (cfg.pinned.indexOf(r.directory) !== -1) continue;
    if (cfg.hidden.indexOf(r.directory) !== -1) continue;
    list.push({
      dir: r.directory,
      name: r.directory.split(/[\\/]/).pop() || r.directory,
      sessions: r.sessions,
      lastUsed: r.last_used,
      pinned: false
    });
  }
  if (inputBuf) {
    var q = inputBuf.toLowerCase();
    list = list.filter(function(m) { return (m.name||"").toLowerCase().indexOf(q) !== -1 || (m.desc||"").toLowerCase().indexOf(q) !== -1; });
  }
  return list;
}

// Plugin data

var customTabs = [];

// Registry Pattern: plugins extend the TUI by exporting a function from tui-extension.js
// The function receives a tuiApi object with registerTab() to add custom tabs
var tuiApi = {
  registerTab: function(tab) {
    if (tab && tab.id && tab.label) {
      customTabs.push(tab);
    }
  },
  loadConfig: function() { return loadConfig(); },
  saveConfig: function(cfg) { return saveConfig(cfg); },
  loadPlugins: function() { return loadPlugins(); },
  flash: function(msg) { message = msg; messageTimeout = Date.now() + 3000; }
};

function loadCustomTabs() {
  customTabs = [];
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

function loadPlugins() {
  var updater = getUpdater();
  if (updater && typeof updater.getPlugins === "function") {
    try { return updater.getPlugins(CONFIG_DIR); } catch {}
  }
  try { if (existsSync(PLUGINS_JSON)) return JSON.parse(readFileSync(PLUGINS_JSON, "utf-8")); } catch {}
  var legacy = join(CONFIG_DIR, "plugins.json");
  try { if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf-8")); } catch {}
  return [];
}

function savePlugins(plugins) {
  if (!existsSync(CONFIG_FOLDER)) try { mkdirSync(CONFIG_FOLDER, { recursive: true }); } catch {}
  // config/ is always preferred; the top-level file only when config/ cannot exist
  var target = existsSync(CONFIG_FOLDER) ? PLUGINS_JSON : join(CONFIG_DIR, "plugins.json");
  writeFileSync(target, JSON.stringify(plugins, null, 2), "utf-8");
}

function gitText(args, cwd) {
  try {
    var out = execSync(args.join(" "), { cwd: cwd, encoding: "utf-8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch { return ""; }
}

function buildPluginList() {
  var plugins = loadPlugins();
  var list = [];
  for (var p of plugins) {
    var folderName = getFolderName(p);
    var dir = join(REPOS_DIR, folderName);
    var installed = existsSync(dir);
    var deployed = existsSync(join(PLUGINS_DIR, (p.pluginFile || p.name + ".js")));
    var localHead = "";
    var remoteHead = "";
    var subject = "";
    var updateAvail = false;
    var latestTag = "";
    var enabled = p.enabled !== false;

      if (installed) {
        localHead = gitText(["git", "rev-parse", "HEAD"], dir);
        subject = gitText(["git", "log", "-1", "--format=%s"], dir);
        var desc = gitText(["git", "describe", "--tags", "--always"], dir);
        if (!desc || /^[0-9a-f]+$/.test(desc)) {
          latestTag = ""; // no tags in repo — row falls back to the sha
        } else {
          var tmatch = desc.match(/^(.*)-\d+-g[0-9a-f]+$/);
          latestTag = tmatch ? tmatch[1] + " (" + localHead.substring(0, 7) + ")" : desc;
        }
      }

    list.push({
      name: p.name,
      folderName: folderName,
      url: p.url,
      autoUpdate: p.autoUpdate !== false,
      enabled: enabled,
      installed: installed,
      deployed: deployed,
      localHead: localHead,
      remoteHead: remoteHead,
      latestTag: latestTag,
      subject: subject,
      updateAvail: updateAvail,
      hasBuild: !!(p.build || p.bundle),
      pluginFile: p.pluginFile,
      _raw: p
    });
  }
  return list;
}

function fetchPluginRemotes(pluginItems) {
  for (var p of pluginItems) {
    if (p.type === "npm" || !p.installed) continue;
    var dir = join(REPOS_DIR, p.folderName);
    gitText(["git", "fetch", "origin"], dir);
    for (var ref of ["origin/HEAD", "origin/main", "origin/master"]) {
      var h = gitText(["git", "rev-parse", ref], dir);
      if (h) { p.remoteHead = h; break; }
    }
    p.updateAvail = !!(p.localHead && p.remoteHead && p.localHead !== p.remoteHead);
  }
}

// runPluginUpdate removed - delegated to updater plugin



// ANSI

var E = "\x1b[";
var RST = E + "0m";
var BOLD = E + "1m";
var DIM = E + "2m";
var GRAY = E + "90m";
var WHITE = E + "37m";
var YELLOW = E + "33m";
var GREEN = E + "32m";
var CYAN = E + "36m";
var RED = E + "31m";
var BLUE = E + "34m";
var MAGENTA = E + "35m";
var BG_SEL = E + "48;5;236m";
var CLR = E + "K";

var _buf = "";
function b(s) { _buf += s; }
function flush() { process.stderr.write(_buf); _buf = ""; }
function hideCur() { process.stderr.write(E + "?25l"); }
function showCur() { process.stderr.write(E + "?25h"); }


// MCP Server Catalog (curated, verified packages)

var MARKETPLACE_CATALOG = [];
var MCP_CATALOG = [
  // Search & Research
  { name: "brave-search", desc: "Web search via Brave API", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], env: { BRAVE_API_KEY: "" }, category: "Search" },
  { name: "exa", desc: "AI-powered semantic search", command: "npx", args: ["-y", "exa-mcp-server"], env: { EXA_API_KEY: "" }, category: "Search" },
  { name: "tavily", desc: "AI search engine for agents", command: "npx", args: ["-y", "tavily-mcp"], env: { TAVILY_API_KEY: "" }, category: "Search" },
  { name: "fetch", desc: "HTTP fetch and URL reading", command: "npx", args: ["-y", "@modelcontextprotocol/server-fetch"], env: {}, category: "Search" },
  // Development
  { name: "context7", desc: "Up-to-date docs for any library", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, category: "Development" },
  { name: "playwright", desc: "Browser automation & testing", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-playwright"], env: {}, category: "Development" },
  { name: "puppeteer", desc: "Chrome browser automation", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-puppeteer"], env: {}, category: "Development" },
  { name: "git", desc: "Git repository operations", command: "uvx", args: ["mcp-server-git"], env: {}, category: "Development" },
  { name: "sequential-thinking", desc: "Dynamic problem-solving chains", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-sequential-thinking"], env: {}, category: "Development" },
  // Files & System
  { name: "filesystem", desc: "Secure local file access", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], env: {}, category: "Files" },
  { name: "memory", desc: "Persistent knowledge graph", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: {}, category: "Files" },
  // Database
  { name: "postgres", desc: "PostgreSQL database access", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"], env: {}, category: "Database" },
  { name: "sqlite", desc: "SQLite database operations", command: "npx", args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./db.sqlite"], env: {}, category: "Database" },
  { name: "redis", desc: "Redis cache & data store", command: "npx", args: ["-y", "@modelcontextprotocol/server-redis", "redis://localhost:6379"], env: {}, category: "Database" },
  { name: "supabase", desc: "Supabase backend platform", command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest"], env: { SUPABASE_ACCESS_TOKEN: "" }, category: "Database" },
  // Cloud & DevOps
  { name: "cloudflare", desc: "Cloudflare Workers & KV", command: "npx", args: ["-y", "@cloudflare/mcp-server-cloudflare"], env: {}, category: "Cloud" },
  { name: "vercel", desc: "Vercel deployment platform", command: "npx", args: ["-y", "vercel-mcp-server"], env: { VERCEL_TOKEN: "" }, category: "Cloud" },
  { name: "aws-kb-retrieval", desc: "AWS Bedrock knowledge bases", command: "npx", args: ["-y", "@modelcontextprotocol/server-aws-kb-retrieval"], env: { AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" }, category: "Cloud" },
  { name: "docker", desc: "Docker container management", command: "npx", args: ["-y", "mcp-server-docker"], env: {}, category: "Cloud" },
  // Communication
  { name: "slack", desc: "Slack workspace integration", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-slack"], env: { SLACK_BOT_TOKEN: "" }, category: "Communication" },
  // Productivity
  { name: "github", desc: "GitHub repos, issues, PRs", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" }, category: "Productivity" },
  { name: "linear", desc: "Linear issue tracking", command: "npx", args: ["-y", "mcp-linear"], env: { LINEAR_API_KEY: "" }, category: "Productivity" },
  { name: "notion", desc: "Notion workspace access", command: "npx", args: ["-y", "@notionhq/mcp-server-notion"], env: { NOTION_API_KEY: "" }, category: "Productivity" },
  { name: "google-maps", desc: "Google Maps & Places API", command: "npx", args: ["-y", "@modelcontextprotocol/server-google-maps"], env: { GOOGLE_MAPS_API_KEY: "" }, category: "Productivity" },
  { name: "todoist", desc: "Todoist task management", command: "npx", args: ["-y", "todoist-mcp-server"], env: { TODOIST_API_TOKEN: "" }, category: "Productivity" },
  // Data & Analytics
  { name: "sentry", desc: "Sentry error tracking", command: "npx", args: ["-y", "@modelcontextprotocol/server-sentry"], env: { SENTRY_AUTH_TOKEN: "" }, category: "Data" },
  // AI & Generation
  { name: "everart", desc: "AI image generation", command: "npx", args: ["-y", "@modelcontextprotocol/server-everart"], env: { EVERART_API_KEY: "" }, category: "AI" },
];

var MCP_CATEGORIES = ["All", "Search", "Development", "Files", "Database", "Cloud", "Communication", "Productivity", "Data", "AI", "Plugin"];

// MCP Config read/write (environment-aware)

var MCP_CONFIG_PATH = join(CONFIG_DIR, ".mcp.json");

function loadMcpConfig() {
  try {
    if (existsSync(MCP_CONFIG_PATH)) return JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
  } catch {}
  return { mcpServers: {} };
}

function saveMcpConfig(config) {
  try {
    if (!existsSync(dirname(MCP_CONFIG_PATH))) mkdirSync(dirname(MCP_CONFIG_PATH), { recursive: true });
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {}
}

function scanPluginEmbeddedMcps() {
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

function getInstalledMcpList() {
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

function buildMcpList(categoryFilter) {
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

function installMcpServer(entry) {
  var config = loadMcpConfig();
  var serverConfig = { command: entry.command, args: entry.args.slice() };
  var envKeys = Object.keys(entry.env || {});
  if (envKeys.length > 0) serverConfig.env = Object.assign({}, entry.env);
  config.mcpServers[entry.name] = serverConfig;
  saveMcpConfig(config);
}

function uninstallMcpServer(name) {
  var config = loadMcpConfig();
  delete config.mcpServers[name];
  saveMcpConfig(config);
}

// Plugin Marketplace Catalog

var { exec } = require("child_process");
var catalogFetched = false;
var catalogPending = 0;
var CATALOG_CACHE_PATH = join(CACHE_DIR, "marketplace-catalog.json");

function invalidateCatalogCache() {
  try { unlinkSync(CATALOG_CACHE_PATH); } catch {}
}

function loadCatalogCache() {
  try {
    if (!existsSync(CATALOG_CACHE_PATH)) return false;
    var cached = JSON.parse(readFileSync(CATALOG_CACHE_PATH, "utf-8"));
    if (!cached || Date.now() - cached.time > 6 * 3600000) return false;
    if (!Array.isArray(cached.marketplace) || cached.marketplace.length === 0) return false;
    for (var ce of cached.marketplace) MARKETPLACE_CATALOG.push(ce);
    for (var me of (cached.mcp || [])) {
      if (!MCP_CATALOG.find(function(x) { return x.name === me.name; })) MCP_CATALOG.push(me);
    }
    tuiLog("marketplace catalog loaded from cache");
    return true;
  } catch { return false; }
}

function fetchCatalogsAsync() {
  if (catalogFetched) return;
  catalogFetched = true;
  if (loadCatalogCache()) return;

  var curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
  var enrichedOnce = false;

  function saveCatalog() {
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CATALOG_CACHE_PATH, JSON.stringify({ time: Date.now(), marketplace: MARKETPLACE_CATALOG, mcp: MCP_CATALOG }));
      tuiLog("marketplace catalog cached (" + MARKETPLACE_CATALOG.length + " plugins)");
    } catch {}
  }

  // search-API star matching breaks on renamed repos and rate limits; per-repo
  // lookups use the larger core API budget and follow renames, then the result
  // is cached on disk so the budget is spent once, not per TUI open
  function enrichCuratedStars() {
    var missing = MARKETPLACE_CATALOG.filter(function(e) { return e.stars == null && e.full_name; }).slice(0, 40);
    tuiLog("enriching stars for " + missing.length + " catalog entries");
    for (var entry of missing) {
      (function(target) {
        catalogPending++;
        exec(curlCmd + ' -sL -H "User-Agent: OpenCode" "https://api.github.com/repos/' + target.full_name + '"', function(err, stdout) {
          if (!err && stdout) {
            try {
              var repo = JSON.parse(stdout);
              if (repo && typeof repo.stargazers_count === "number") {
                target.stars = repo.stargazers_count;
                if (!target.desc && repo.description) target.desc = repo.description;
              } else if (repo && repo.message) {
                tuiLog("github repos api (" + target.full_name + "): " + repo.message);
              }
            } catch {}
          }
          refreshMarketplace();
          fetchDone();
        });
      })(entry);
    }
  }

  function fetchDone() {
    catalogPending = Math.max(0, catalogPending - 1);
    if (catalogPending > 0) return;
    scheduleRender();
    if (!enrichedOnce) {
      enrichedOnce = true;
      enrichCuratedStars();
      if (catalogPending > 0) return;
    }
    saveCatalog();
  }
  function searchGH(query, catalog, pageNum) {
    catalogPending++;
    exec(curlCmd + ' -s -H "User-Agent: OpenCode" "https://api.github.com/search/repositories?q=' + query + '&sort=stars&order=desc&per_page=100&page=' + pageNum + '"', function(err, stdout) {
      fetchDone();
      if (!err && stdout) {
        try {
          var json = JSON.parse(stdout);
          if (json.message) tuiLog("github search: " + json.message);
          if (json.items) {
            for (var i = 0; i < json.items.length; i++) {
              var it = json.items[i];
              var cleanName = it.name.replace(/^claude-|^opencode-/, "");
              var exists = catalog.find(function(m) { return m.name === (catalog === MARKETPLACE_CATALOG ? cleanName : it.name); });
              if (!exists) {
                var newItem = {
                  name: catalog === MARKETPLACE_CATALOG ? cleanName : it.name,
                  desc: it.description || "",
                  category: "Community",
                  stars: it.stargazers_count
                };
                if (catalog === MARKETPLACE_CATALOG) {
                  newItem.author = it.owner.login;
                  newItem.repoName = it.name;
                  newItem.full_name = it.full_name;
                  newItem.url = "https://github.com/" + it.full_name + ".git";
                } else {
                  newItem.command = "npx";
                  newItem.args = ["-y", it.full_name];
                  newItem.env = {};
                }
                catalog.push(newItem);
              } else {
                exists.stars = it.stargazers_count;
              }
            }
            catalog.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); });
            if (catalog === MARKETPLACE_CATALOG && pluginSubPage === "marketplace") {
               marketplaceItems = buildMarketplaceList();
               scheduleRender();
            } else if (catalog === MCP_CATALOG && page === "mcp" && mcpSubPage === "marketplace") {
               mcpItems = buildMcpList("All");
               scheduleRender();
            }
          }
        } catch(e) {}
      }
    });
  }

  function searchNpm(keyword) {
    catalogPending++;
    exec(curlCmd + ' -s "https://registry.npmjs.org/-/v1/search?text=keywords:' + keyword + '&size=100"', function(err, stdout) {
      fetchDone();
      if (err || !stdout) return;
      try {
        var json = JSON.parse(stdout);
        for (var obj of (json.objects || [])) {
          var pkg = obj.package || {};
          var repoUrl = ((pkg.links && pkg.links.repository) || "").replace(/^git\+/, "");
          if (!repoUrl) continue;
          var repoMatch = repoUrl.match(/([^\/]+)\/([^\/]+?)(\.git)?$/);
          if (!repoMatch) continue;
          var author = repoMatch[1];
          var repoName = repoMatch[2];
          var shortName = pkg.name.replace(/^@[^\/]+\//, "");
          var exists = MARKETPLACE_CATALOG.find(function(e) {
            return e.name === shortName || (e.repoName || e.name) === repoName;
          });
          if (exists) continue;
          MARKETPLACE_CATALOG.push({
            name: shortName,
            desc: pkg.description || "",
            category: "Community",
            author: author,
            repoName: repoName,
            full_name: author + "/" + repoName,
            url: repoUrl.endsWith(".git") ? repoUrl : repoUrl + ".git",
          });
        }
        MARKETPLACE_CATALOG.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); });
        if (pluginSubPage === "marketplace") {
          marketplaceItems = buildMarketplaceList();
          scheduleRender();
        }
      } catch(e) {}
    });
  }

  // the awesome-opencode list is the curated membership oracle: the fuzzy
  // starred search may only contribute repos that the community list contains,
  // which keeps popular plugins in and look-alike repos out
  var awesomeSet = null;
  function refreshMarketplace() {
    MARKETPLACE_CATALOG.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); });
    if (pluginSubPage === "marketplace") {
      marketplaceItems = buildMarketplaceList();
      scheduleRender();
    }
  }

  function catalogHas(fullName) {
    var key = fullName.toLowerCase();
    return MARKETPLACE_CATALOG.find(function(e) { return (e.full_name || "").toLowerCase() === key; });
  }

  function searchPopular(pageNum) {
    catalogPending++;
    exec(curlCmd + ' -s -H "User-Agent: OpenCode" "https://api.github.com/search/repositories?q=opencode&sort=stars&order=desc&per_page=100&page=' + pageNum + '"', function(err, stdout) {
      fetchDone();
      if (err || !stdout) return;
      try {
        var json = JSON.parse(stdout);
        if (json.message) tuiLog("github search: " + json.message);
        for (var it of (json.items || [])) {
          var existing = catalogHas(it.full_name || "");
          if (existing) {
            existing.stars = it.stargazers_count;
            if (!existing.desc) existing.desc = it.description || "";
            continue;
          }
          if (!awesomeSet || !awesomeSet[(it.full_name || "").toLowerCase()]) continue;
          MARKETPLACE_CATALOG.push({
            name: it.name, desc: it.description || "", category: "Community",
            stars: it.stargazers_count, author: it.owner.login, repoName: it.name,
            full_name: it.full_name, url: "https://github.com/" + it.full_name + ".git",
          });
        }
        refreshMarketplace();
      } catch(e) {}
    });
  }

  function fetchAwesomeList() {
    catalogPending++;
    exec(curlCmd + ' -s "https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md"', { maxBuffer: 4 * 1024 * 1024 }, function(err, stdout) {
      fetchDone();
      if (!err && stdout) {
        try {
          var section = stdout;
          var pStart = stdout.indexOf("PLUGINS</strong>");
          var pEnd = stdout.indexOf("THEMES</strong>");
          if (pStart !== -1 && pEnd > pStart) section = stdout.substring(pStart, pEnd);
          awesomeSet = {};
          var badgeRe = /badgen\.net\/github\/stars\/([^"\/\s]+)\/([^"\/\s]+)/g;
          var m;
          while ((m = badgeRe.exec(section))) {
            var author = m[1];
            var repoName = m[2];
            awesomeSet[(author + "/" + repoName).toLowerCase()] = true;
            if (catalogHas(author + "/" + repoName)) continue;
            var descMatch = section.substring(m.index, m.index + 400).match(/<i>([^<]*)<\/i>/);
            MARKETPLACE_CATALOG.push({
              name: repoName, desc: descMatch ? descMatch[1] : "", category: "Curated",
              author: author, repoName: repoName, full_name: author + "/" + repoName,
              url: "https://github.com/" + author + "/" + repoName + ".git",
            });
          }
          refreshMarketplace();
        } catch(e) {}
      }
      // the broad starred search supplies star counts for the curated entries,
      // whose badge images carry no numbers; membership keeps it precise
      searchPopular(1);
      searchPopular(2);
    });
  }

  var pluginTopic = APP_NAME === "Claude Code" ? "claude-code-plugin" : "opencode-plugin";
  searchGH("topic:" + pluginTopic, MARKETPLACE_CATALOG, 1);
  searchGH("topic:" + pluginTopic, MARKETPLACE_CATALOG, 2);
  searchNpm(pluginTopic);
  if (APP_NAME !== "Claude Code") fetchAwesomeList();
  searchGH("topic:mcp-server", MCP_CATALOG, 1);
  searchGH("topic:mcp-server", MCP_CATALOG, 2);
}

function buildMarketplaceList() {
  fetchCatalogsAsync();
  var installed = loadPlugins();
  var installedNames = installed.map(function(p) { return p.name; });
  var res = MARKETPLACE_CATALOG.map(function(m) {
    var repoName = m.repoName || m.name;
    var isInstalled = installedNames.indexOf(m.name) !== -1 || installedNames.indexOf(repoName) !== -1;
    return Object.assign({}, m, { installed: isInstalled });
  });
  if (inputBuf) {
    var q = inputBuf.toLowerCase();
    res = res.filter(function(m) { return (m.name||'').toLowerCase().indexOf(q) !== -1 || (m.desc||'').toLowerCase().indexOf(q) !== -1; });
  }
  return res;
}

function installMarketplacePlugin(entry) {
  var repoName = entry.repoName || entry.name;
  var url = entry.url;
  var plugins = loadPlugins();
  plugins.push({ name: repoName, url: url, autoUpdate: true, enabled: true });
  savePlugins(plugins);
  var folderName = entry.full_name || (entry.author + "/" + repoName);
  var dir = join(REPOS_DIR, folderName);
  if (!existsSync(dir)) {
    var parentDir = dirname(dir);
    if (!existsSync(parentDir)) try { mkdirSync(parentDir, { recursive: true }); } catch {}
    try {
      execSync("git clone --recurse-submodules " + url + " " + folderName, { cwd: REPOS_DIR, timeout: 60000, stdio: "ignore" });
      return null;
    } catch (e) { return "Clone failed: " + (e.message || e); }
  }
  return null;
}

var items = buildList();

function buildCombinedPluginList() {
  var git = buildPluginList();
  var savedPlugins = loadPlugins();
  var npm = loadNpmPlugins().map(function(np) {
    return {
      type: "npm",
      name: np.name,
      version: np.version,
      raw: np.raw,
      // npm plugins have no disable state — the app loads whatever opencode.json lists
      enabled: true,
      autoUpdate: false,
      installed: !!np.version,
      deployed: !!np.version,
      updateAvail: false,
      localHead: "",
      remoteHead: "",
      latestTag: np.version || "",
      subject: "npm plugin",
      folderName: "",
      url: "",
      hasBuild: false,
      pluginFile: ""
    };
  });
  if (getUpdater() && !npm.some(function(p) { return p.name === "plugin-updater"; })) {
    npm.push({
      type: "npm",
      engine: true,
      name: "plugin-updater",
      version: getUpdaterVersion(),
      raw: "plugin-updater",
      enabled: true,
      autoUpdate: true,
      installed: true,
      deployed: true,
      updateAvail: false,
      localHead: "",
      remoteHead: "",
      latestTag: "",
      subject: "plugin engine",
      folderName: "",
      url: "",
      hasBuild: false,
      pluginFile: ""
    });
  }
  return git.concat(npm);
}

// auth plugins declare providers in their package manifest; selecting one
// routes the loader's requests through it
function loadProviders() {
  var providers = [];
  try {
    for (var repoName of readdirSync(REPOS_DIR)) {
      try {
        var pkg = JSON.parse(readFileSync(join(REPOS_DIR, repoName, "package.json"), "utf-8"));
        var declared = (pkg.claudeHub && pkg.claudeHub.authProviders) || pkg.authProviders || [];
        for (var provider of declared) {
          providers.push({ name: provider.name || repoName, plugin: repoName });
        }
      } catch {}
    }
  } catch {}
  return providers;
}

var pluginItems = buildCombinedPluginList();
var cursor = 0;
var pcursor = 0; // plugin page cursor
var provCursor = 0;
var mode = "list"; // "list" | "actions" | "input" | "pactions"
var page = "projects"; // "projects" | "plugins"
var acursor = 0;
var pacursor = 0; // plugin action cursor
var message = "";
var msgTimeout = null;
var scrollOff = 0;
var pscrollOff = 0;
var inputBuf = "";
var chpathDir = "";
var pluginFetched = false;
var pluginUpdating = "";
var commitItems = [];
var ccursor = 0;
var cscrollOff = 0;

// MCP state
var mcpItems = buildMcpList("All");
var mcpCursor = 0;
var mcpScrollOff = 0;
var mcpSubPage = "installed"; // "installed" | "marketplace"
var mcpMode = "catalog"; // "catalog" | "actions"
var mcpAcursor = 0;
// Marketplace state
var marketplaceItems = buildMarketplaceList();
var mkCursor = 0;
var mkScrollOff = 0;
var mkMode = "browse"; // "browse" | "actions"
var mkAcursor = 0;
var pluginSubPage = "installed"; // "installed" | "marketplace" | custom tab ids
var confirmAction = null;
var confirmLabel = "";
var confirmCursor = 0;

function buildConfirm(pushBody, pushFoot, cols, barW) {
  pushBody("  " + MAGENTA + "#" + GRAY + " Confirm" + RST, false);
  pushBody("", false);
  pushBody("  " + BOLD + WHITE + trunc(confirmLabel, cols - 4) + RST, false);
  pushBody("", false);
  var opts = ["Yes", "Cancel"];
  for (var i = 0; i < opts.length; i++) {
    if (i === confirmCursor) {
      pushBody("    " + GREEN + "  > " + BOLD + opts[i] + RST, true);
    } else {
      pushBody("    " + GRAY + "    " + opts[i] + RST, false);
    }
  }
  pushBody("", false);
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Y", "Yes"], ["N/Esc", "Cancel"]]));
}

function flash(msg) {
  message = msg;
  if (msgTimeout) clearTimeout(msgTimeout);
  msgTimeout = setTimeout(function() { message = ""; render(); }, 2500);
}

// async catalog fetches arrive in bursts — coalesce their redraws
var renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(function() { renderTimer = null; render(); }, 120);
}

function hints(pairs) {
  return "  " + pairs.map(function(p) { return DIM + p[0] + RST + " " + p[1]; }).join("  ");
}

var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var spinnerTick = 0;
var spinnerTimer = null;
function spinnerFrame() { return CYAN + SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length] + RST; }
function updateSpinner() {
  var active = catalogPending > 0 || (message && message.indexOf("...") !== -1);
  if (active && !spinnerTimer) {
    spinnerTimer = setInterval(function() { spinnerTick++; render(); }, 120);
  } else if (!active && spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

function messageLine(cols) {
  var prefix = message.indexOf("...") !== -1 ? spinnerFrame() + " " : "  ";
  return "  " + GREEN + prefix + trunc(message, cols - 6) + RST;
}

var helpOpen = false;
var HELP_BINDINGS = {
  projects: [
    ["^v / WS", "Move"], ["Enter / Space", "Open actions"], ["O", "Open project"],
    ["P", "Pin / unpin"], ["H", "Hide project"], ["U", "Unhide all"],
    ["C", "Open custom path"], ["<- ->", "Switch page"], ["Q / Esc", "Quit"],
  ],
  plugins: [
    ["^v / WS", "Move"], ["Enter", "Plugin actions"], ["Tab", "Installed / Marketplace / Providers"],
    ["F", "Check for updates"], ["R", "Refresh list / catalog"], ["U", "Update selected"],
    ["A", "Update all"], ["D", "Disable selected"], ["I", "Quick install (marketplace)"],
    ["/", "Search (marketplace)"], ["<- ->", "Switch page"], ["Q / Esc", "Quit"],
  ],
  mcp: [
    ["^v / WS", "Move"], ["Enter", "Server actions"], ["Tab", "Installed / Marketplace"],
    ["I", "Install selected"], ["X", "Uninstall selected"], ["R", "Refresh catalog"],
    ["/", "Search"], ["<- ->", "Switch page"], ["Q / Esc", "Quit"],
  ],
};

function buildHelp(pushBody, pushFoot, cols, barW) {
  var binds = HELP_BINDINGS[page] || [];
  pushBody("  " + MAGENTA + "#" + GRAY + " Keyboard shortcuts" + RST, false);
  pushBody("", false);
  for (var i = 0; i < binds.length; i++) {
    pushBody("    " + BOLD + WHITE + pad(binds[i][0], 16) + RST + GRAY + binds[i][1] + RST, false);
  }
  pushBody("", false);
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  pushFoot(hints([["Any key", "Close"]]));
}

// Project actions

function getActions(item) {
  var a = [
    { key: "open", label: "Open in " + APP_NAME, icon: ">" },
  ];
  if (item.pinned) {
    a.push({ key: "unpin", label: "Unpin from favorites", icon: "x" });
  } else {
    a.push({ key: "pin", label: "Pin to favorites", icon: "*" });
  }
  a.push({ key: "hide", label: "Hide from list", icon: "-" });
  a.push({ key: "chpath", label: "Change path", icon: "~" });
  a.push({ key: "unhide", label: "Show hidden projects", icon: "+" });
  a.push({ key: "cancel", label: "Cancel", icon: "<" });
  return a;
}

function getPluginActions(pitem) {
  var a = [];
  if (pitem.engine) {
    a.push({ key: "updater-update", label: "Update plugin-updater" });
    a.push({ key: "updater-run", label: "Update all plugins (early launch)" });
    a.push({ key: "updater-add", label: "Add plugin from git URL" });
    a.push({ key: "cancel", label: "Cancel" });
    return a;
  }
  if (pitem.type === "npm") {
    // managed via opencode.json — no disable state, only update or uninstall
    a.push({ key: "update-npm", label: "Update npm plugin" });
    a.push({ key: "uninstall-npm", label: "Uninstall npm plugin (removes from opencode.json)" });
    a.push({ key: "cancel", label: "Cancel" });
    return a;
  }
  if (!pitem.enabled) {
    a.push({ key: "enable-plugin", label: "Enable plugin" });
    a.push({ key: "cancel", label: "Cancel" });
    return a;
  }
  if (pitem.updateAvail || !pitem.deployed) {
    a.push({ key: "update", label: "Update now" });
  }
  if (pitem.autoUpdate) {
    a.push({ key: "disable-auto", label: "Set to manual update" });
  } else {
    a.push({ key: "enable-auto", label: "Enable auto-update" });
  }
  a.push({ key: "update", label: "Force rebuild & deploy" });
  a.push({ key: "commits", label: "Select specific commit (Downgrade)" });
  a.push({ key: "disable-plugin", label: "Disable plugin" });
  a.push({ key: "uninstall-plugin", label: "Uninstall plugin" });
  a.push({ key: "cancel", label: "Cancel" });
  return a;
}

function outputDir(dir) {
  var outFile = process.env.HUB_OUTPUT || process.env.OC_OUTPUT || process.env.CC_OUTPUT;
  if (outFile) {
    writeFileSync(outFile, dir, "utf-8");
  } else {
    process.stdout.write(dir);
  }
}

function openProject(item) {
  cleanup();
  outputDir(item.dir);
  process.exit(0);
}

function togglePin(idx) {
  var item = items[idx];
  var cfg = loadConfig();
  if (item.pinned) {
    cfg.pinned = cfg.pinned.filter(function(d) { return d !== item.dir; });
    flash("Unpinned: " + item.name);
  } else {
    cfg.pinned.push(item.dir);
    flash("Pinned: " + item.name);
  }
  saveConfig(cfg);
  items = buildList();
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
}

function hideItem(idx) {
  var item = items[idx];
  var cfg = loadConfig();
  if (cfg.hidden.indexOf(item.dir) === -1) cfg.hidden.push(item.dir);
  cfg.pinned = cfg.pinned.filter(function(d) { return d !== item.dir; });
  saveConfig(cfg);
  flash("Hidden: " + item.name);
  items = buildList();
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
}

function unhideAll() {
  var cfg = loadConfig();
  var count = cfg.hidden.length;
  cfg.hidden = [];
  saveConfig(cfg);
  flash("Restored " + count + " hidden project(s)");
  items = buildList();
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
}

function getProjectId(dir) {
  try {
    var root = execSync("git rev-list --max-parents=0 HEAD", { cwd: dir, encoding: "utf-8", timeout: 5000 });
    var lines = root.trim().split("\n").filter(Boolean).map(function(x) { return x.trim(); }).sort();
    return lines[0] || null;
  } catch (e) { return null; }
}

function changeProjectPath(oldDir, newDir) {
  if (!existsSync(DB_PATH)) { flash("DB not found"); return; }
  try {
    var db = new Database(DB_PATH);
    var count = db.query("SELECT COUNT(*) as c FROM session WHERE directory = ?").get(oldDir);
    if (!count || count.c === 0) { db.close(); flash("No sessions at old path"); return; }

    var oldSess = db.query("SELECT project_id FROM session WHERE directory = ? LIMIT 1").get(oldDir);
    var oldPid = oldSess.project_id;
    var newPid = getProjectId(newDir);

    if (newPid) {
      var existing = db.query("SELECT id FROM project WHERE id = ?").get(newPid);
      if (existing) {
        db.run("UPDATE session SET project_id = ?, directory = ? WHERE directory = ?", [newPid, newDir, oldDir]);
      } else if (oldPid !== "global") {
        db.run("UPDATE project SET id = ?, worktree = ? WHERE id = ?", [newPid, newDir, oldPid]);
        db.run("UPDATE session SET project_id = ?, directory = ? WHERE directory = ?", [newPid, newDir, oldDir]);
      } else {
        var now = Date.now();
        db.run("INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, '[]')", [newPid, newDir, now, now]);
        db.run("UPDATE session SET project_id = ?, directory = ? WHERE directory = ?", [newPid, newDir, oldDir]);
      }
      try {
        var gitDir = join(newDir, ".git");
        if (existsSync(gitDir)) writeFileSync(join(gitDir, "opencode"), newPid);
      } catch (e) {}
    } else {
      db.run("UPDATE session SET project_id = 'global', directory = ? WHERE directory = ?", [newDir, oldDir]);
    }

    if (oldPid !== "global" && oldPid !== newPid) {
      var rem = db.query("SELECT COUNT(*) as c FROM session WHERE project_id = ?").get(oldPid);
      if (!rem || rem.c === 0) db.run("DELETE FROM project WHERE id = ?", [oldPid]);
    }

    db.close();
    var cfg = loadConfig();
    var pidx = cfg.pinned.indexOf(oldDir);
    if (pidx !== -1) cfg.pinned[pidx] = newDir;
    var hidx = cfg.hidden.indexOf(oldDir);
    if (hidx !== -1) cfg.hidden[hidx] = newDir;
    saveConfig(cfg);
    flash("Moved " + count.c + " sessions to new path");
    items = buildList();
    if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
  } catch (e) {
    flash("Error: " + (e.message || e));
  }
}

// Render: projects page

function buildProjectItem(pushBody, i, item, nameW, cols, isSelected) {
  var sel = i === cursor;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;
  var sessStr = GRAY + pad(item.sessions + " sess", 8) + RST;
  var timeStr = GRAY + pad(timeAgo(item.lastUsed), 9) + RST;
  var pinMark = item.pinned ? (YELLOW + " *" + RST) : "";

  pushBody("  " + bg + arrow + nameStyle + pad(trunc(item.name, nameW), nameW) + RST + bg + sessStr + timeStr + pinMark + RST, isSelected);

  if (sel && (mode === "list" || mode === "actions")) {
    pushBody("  " + GRAY + "     " + trunc(shortPath(item.dir), cols - 10) + RST, isSelected);
  }

  if (sel && mode === "actions") {
    pushBody("", isSelected);
    var acts = getActions(item);
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      var aSel = j === acursor;
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
  var sel = cursor === items.length;
  var arrow = sel ? (YELLOW + " > " + RST) : "   ";
  var bg = sel ? BG_SEL : "";
  var nameStyle = sel ? (BOLD + WHITE) : DIM;
  pushBody("  " + bg + arrow + nameStyle + "Open " + APP_NAME + " here" + RST + bg + "  " + GRAY + process.cwd() + RST, sel);
}

function buildProjects(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(16, cols - 36));

  if (items.length === 0) {
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
  for (var i = 0; i < items.length; i++) { if (items[i].pinned) pinnedCount++; }
  var recentCount = items.length - pinnedCount;

  if (pinnedCount > 0) {
    pushBody("  " + YELLOW + "*" + GRAY + " Pinned" + RST, false);
    for (var i = 0; i < pinnedCount; i++) {
      buildProjectItem(pushBody, i, items[i], nameW, cols, i === cursor);
    }
  }

  if (pinnedCount > 0 && recentCount > 0) pushBody("", false);

  if (recentCount > 0) {
    var countLabel = recentCount > 0 ? " (" + recentCount + ")" : "";
    pushBody("  " + BLUE + "~" + GRAY + " Recent" + countLabel + RST, false);
    for (var i = pinnedCount; i < items.length; i++) {
      buildProjectItem(pushBody, i, items[i], nameW, cols, i === cursor);
    }
  }

  pushBody("", false);
  buildOpenHereItem(pushBody);
  pushBody("", false);

  if (message) {
    pushFoot(messageLine(cols));
  }
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  
  if (mode === "input") {
    var inputLabel = chpathDir ? "New path: " : "Path: ";
    var maxInput = Math.max(10, cols - 15 - inputLabel.length);
    var displayInput = inputBuf.length > maxInput ? "…" + inputBuf.substring(inputBuf.length - maxInput + 1) : inputBuf;
    pushFoot("  " + CYAN + inputLabel + RST + displayInput + BOLD + "|" + RST);
    pushFoot(hints([["Enter", "Confirm"], ["Esc", "Cancel"]]));
  } else if (mode === "list") {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["O", "Open"], ["?", "Help"], ["Q", "Quit"]]));
  } else {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
  }
}

// Render: plugins page

function buildPluginItem(pushBody, i, pitem, nameW, cols, isSelected) {
  var sel = i === pcursor;
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
      globalKeyHandler = "updater_install";
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
      globalKeyHandler = "updater_install";
      return;
    }
  } else {
    if (globalKeyHandler === "updater_install") globalKeyHandler = null;
  }

  if (mode === "pcommits") {
    pushBody("  " + MAGENTA + "#" + GRAY + " Select commit for " + pluginItems[pcursor].name + RST, false);
    for (var i = 0; i < commitItems.length; i++) {
      var c = commitItems[i];
      var sel = i === ccursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      pushBody("  " + bg + arrow + nameStyle + c.hash + RST + bg + "  " + pad(c.time, 12) + "  " + trunc(c.subject, Math.max(10, cols - 30)) + RST, sel);
    }
    pushBody("", false);
    
    if (message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Checkout"], ["Esc", "Cancel"]]));
    return;
  }

  if (mode === "pactions" && pluginItems.length > 0 && pluginItems[pcursor]) {
    var ppitem = pluginItems[pcursor];
    pushBody("  " + MAGENTA + "#" + GRAY + " " + trunc(ppitem.name, cols - 6) + RST, false);
    var pinfo = ppitem.type === "npm"
      ? ("npm  " + (ppitem.version ? "v" + ppitem.version : "not installed"))
      : trunc(ppitem.subject || ppitem.url || "", cols - 6);
    if (pinfo) pushBody("  " + GRAY + pinfo + RST, false);
    pushBody("", false);
    var pacts = getPluginActions(ppitem);
    for (var pj = 0; pj < pacts.length; pj++) {
      if (pj === pacursor) {
        pushBody("    " + GREEN + "  > " + BOLD + pacts[pj].label + RST, true);
      } else {
        pushBody("    " + GRAY + "    " + pacts[pj].label + RST, false);
      }
    }
    pushBody("", false);
    if (message) pushFoot(messageLine(cols));
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
    return;
  }

  if (pluginItems.length === 0) {
    pushBody("  " + GRAY + "No plugins configured." + RST, false);
    pushBody("  " + GRAY + "Add plugins to ~/configDirPlaceholder/config/plugins.json" + RST, false);
    pushBody("", false);
    
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + GRAY + "Q" + RST + " Quit");
    return;
  }

  var tabInstalled = pluginSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);
  var tabMarketplace = pluginSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);
  var tabProviders = pluginSubPage === "providers" ? (BOLD + WHITE + BG_SEL + " Providers " + RST) : (GRAY + " Providers " + RST);
  var tabsLine = "  " + tabInstalled + "  " + tabMarketplace + "  " + tabProviders;
  for (var cti = 0; cti < customTabs.length; cti++) {
    var ctab = customTabs[cti];
    var ctStr = pluginSubPage === ctab.id ? (BOLD + WHITE + BG_SEL + " " + ctab.label + " " + RST) : (GRAY + " " + ctab.label + " " + RST);
    tabsLine += "  " + ctStr;
  }
  tabsLine += "    " + DIM + "Tab" + RST + " switch";
    pushBody(tabsLine, false);
  pushBody("", false);

  // --- Marketplace sub-page ---
  if (pluginSubPage === "marketplace") {
    // Actions menu for selected plugin
    if (mkMode === "actions" && marketplaceItems.length > 0) {
      var mitem = marketplaceItems[mkCursor];
      if (!mitem) { mkMode = "browse"; }
      else {
        pushBody("  " + MAGENTA + "#" + GRAY + " " + trunc(mitem.name, cols - 6) + RST, false);
        pushBody("  " + GRAY + trunc(mitem.desc || mitem.command + " " + (mitem.args || []).join(" "), cols - 6) + RST, false);
        pushBody("", false);
        var mkActs = mitem.installed ? [] : [{ key: "install", label: "Install" }];
        if (mitem.url) mkActs.push({ key: "browser", label: "Open in browser" });
        mkActs.push({ key: "cancel", label: "Cancel" });
        for (var ai = 0; ai < mkActs.length; ai++) {
          var a = mkActs[ai];
          var aSel = ai === mkAcursor;
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
    pushBody("  " + MAGENTA + "#" + GRAY + " Marketplace (" + marketplaceItems.length + " available)" + (mode === "search" || inputBuf ? " " + BG_SEL + " Search: " + inputBuf + (mode === "search" ? "_" : "") + " " + RST : " " + DIM + "(press / to search)" + RST), false);
    if (marketplaceItems.length === 0) {
      if (inputBuf) {
        pushBody("  " + GRAY + "No results for \"" + inputBuf + "\"" + RST, false);
      } else if (catalogPending > 0) {
        pushBody("  " + spinnerFrame() + GRAY + " Loading marketplace catalog..." + RST, false);
      } else {
        pushBody("  " + GRAY + "Marketplace catalog is empty. Press R to retry." + RST, false);
      }
    }
    for (var mi = 0; mi < marketplaceItems.length; mi++) {
      var mitem = marketplaceItems[mi];
      var msel = mi === mkCursor;
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
    if (message) { pushFoot(messageLine(cols)); }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["/", "Search"], ["?", "Help"], ["Q", "Quit"]]));
    return;
  }

  if (pluginSubPage === "providers") {
    var providers = loadProviders();
    var selectedProvider = loadConfig().provider || "";
    pushBody("  " + MAGENTA + "#" + GRAY + " Providers (" + providers.length + ")" + RST, false);
    if (providers.length === 0) {
      pushBody("  " + GRAY + "No providers installed." + RST, false);
      pushBody("  " + GRAY + "Auth plugins such as antigravity-auth register providers here." + RST, false);
    }
    for (var pri = 0; pri < providers.length; pri++) {
      var prov = providers[pri];
      var prSel = pri === provCursor;
      var prIcon = prov.name === selectedProvider ? (GREEN + "●" + RST) : (GRAY + "○" + RST);
      var prArrow = prSel ? (YELLOW + " > " + RST) : "   ";
      var prBg = prSel ? BG_SEL : "";
      var prStyle = prSel ? (BOLD + WHITE) : DIM;
      pushBody("  " + prBg + prArrow + prIcon + " " + prStyle + pad(trunc(prov.name, nameW), nameW) + RST + prBg + "  " + GRAY + "from " + prov.plugin + RST, prSel);
    }
    pushBody("", false);
    if (message) pushFoot(messageLine(cols));
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select provider"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
    return;
  }

  // --- Custom tab sub-pages (rendered by plugin extensions) ---
  var activeTab = customTabs.find(function(t) { return t.id === pluginSubPage; });
  if (activeTab && activeTab.render) {
    try {
      activeTab.render({
        pluginSubPage: pluginSubPage,
        cols: cols,
        nameW: nameW,
        message: message,
        mode: mode
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
  for (var p of pluginItems) {
    if (p.type === "npm") continue;
    if (!p.enabled) disabledCount++;
    else if (p.autoUpdate) autoCount++; else manualCount++;
    if (p.updateAvail) updateCount++;
  }

  var npmCount = pluginItems.filter(function(p) { return p.type === "npm"; }).length;
  pushBody("  " + MAGENTA + "#" + GRAY + " Plugins " +
      GRAY + "(" + autoCount + " auto, " + manualCount + " manual, " + disabledCount + " disabled" +
      (updateCount > 0 ? ", " + CYAN + updateCount + " updates" + GRAY : "") +
      (npmCount > 0 ? ", " + GRAY + npmCount + " npm" + GRAY : "") +
      ")" + RST, false);

  if (!pluginFetched) {
    pushBody("  " + GRAY + "  Press " + RST + "F" + GRAY + " to check for updates" + RST, false);
  }

  var lastWasGit = false;
  for (var i = 0; i < pluginItems.length; i++) {
    var pitem = pluginItems[i];
    if (pitem.type === "npm" && (i === 0 || pluginItems[i - 1].type !== "npm")) {
      pushBody("", false);
      pushBody("  " + MAGENTA + "#" + GRAY + " npm plugins" + RST, false);
    }
    buildPluginItem(pushBody, i, pitem, nameW, cols, i === pcursor);
  }

  pushBody("", false);

  if (message) {
    pushFoot(messageLine(cols));
  }
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);

  if (mode === "pinput") {
    pushFoot("  " + CYAN + "Plugin git URL: " + RST + inputBuf + BOLD + "|" + RST);
    pushFoot(hints([["Enter", "Add"], ["Esc", "Cancel"]]));
  } else {
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
  }
}

// Main render

function render() {
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
  var showPluginsTab = pluginItems.length > 0 || MARKETPLACE_CATALOG.length > 0;
  var projTab = page === "projects" ? (BOLD + WHITE + BG_SEL + " Projects " + RST) : (GRAY + " Projects " + RST);
  var plugTab = showPluginsTab ? (page === "plugins" ? (BOLD + WHITE + BG_SEL + " Plugins " + RST) : (GRAY + " Plugins " + RST)) : "";
  var mcpTab = page === "mcp" ? (BOLD + WHITE + BG_SEL + " MCP " + RST) : (GRAY + " MCP " + RST);
  pushHead("  " + projTab + "  " + plugTab + "  " + mcpTab + "    " + DIM + "<- ->" + RST);
  pushHead("");

  if (helpOpen) {
    buildHelp(pushBody, pushFoot, cols, barW);
  } else if (mode === "confirm") {
    buildConfirm(pushBody, pushFoot, cols, barW);
  } else if (page === "projects") {
    buildProjects(pushBody, pushFoot, cols, barW);
  } else if (page === "mcp") {
    buildMcp(pushBody, pushFoot, cols, barW);
  } else {
    buildPlugins(pushBody, pushFoot, cols, barW);
  }
  updateSpinner();

  // 3. Viewport calculation
  var maxBody = Math.max(2, totalRows - headLines.length - footLines.length);
  
  var activeScroll = 0;
  if (page === "projects") activeScroll = scrollOff;
  else if (page === "mcp") activeScroll = mcpScrollOff;
  else if (mode === "pcommits") activeScroll = cscrollOff;
  else if (page === "plugins" && pluginSubPage === "marketplace") activeScroll = mkScrollOff;
  else activeScroll = pscrollOff;

  if (bodyLines.length > maxBody) {
    // marker rows are always reserved so the geometry never shifts between frames
    var innerH = maxBody - 2;
    var contextLines = 3;
    if (selStart - activeScroll < contextLines) activeScroll = Math.max(0, selStart - contextLines);
    if (selEnd - activeScroll > innerH) activeScroll = selEnd - innerH;
    if (activeScroll > bodyLines.length - innerH) activeScroll = bodyLines.length - innerH;
    if (activeScroll < 0) activeScroll = 0;

    if (page === "projects") scrollOff = activeScroll;
    else if (page === "mcp") mcpScrollOff = activeScroll;
    else if (mode === "pcommits") cscrollOff = activeScroll;
    else if (page === "plugins" && pluginSubPage === "marketplace") mkScrollOff = activeScroll;
    else pscrollOff = activeScroll;

    var hiddenAbove = activeScroll;
    var hiddenBelow = bodyLines.length - (activeScroll + innerH);
    var visibleBody = bodyLines.slice(activeScroll, activeScroll + innerH);
    visibleBody.unshift(hiddenAbove > 0 ? "  " + GRAY + "     ^ " + hiddenAbove + " more" + RST : "");
    visibleBody.push(hiddenBelow > 0 ? "  " + GRAY + "     v " + hiddenBelow + " more" + RST : "");
    bodyLines = visibleBody;
  }

  // no newline after the last row: writing into the bottom-right corner would
  // scroll the terminal and shift the whole frame every redraw
  _buf = "\x1b[?2026h" + E + "H";
  _buf += headLines.concat(bodyLines, footLines).map(function(l) { return l + CLR; }).join("\n");
  _buf += E + "J" + "\x1b[?2026l";

  process.stderr.write(_buf);
  _buf = "";
}

// Key handling
function handleKey(key) {
  if (helpOpen) { helpOpen = false; return; }
  if (key === "?" && mode === "list") { helpOpen = true; return; }
  // Page switching with left/right (only in list mode, not in actions/input)
  if ((mode === "list") && (key === "left" || key === "right")) {
    var pages = ["projects", "plugins", "mcp"];
    var pi = pages.indexOf(page);
    if (key === "left" && pi > 0) { page = pages[pi - 1]; mode = "list"; render(); return; }
    if (key === "right" && pi < pages.length - 1) { page = pages[pi + 1]; mode = "list"; render(); return; }
    return;
  }

  if (mode === "confirm") {
    handleConfirmKey(key);
  } else if (page === "projects") {
    handleProjectKey(key);
  } else if (page === "mcp") {
    handleMcpKey(key);
  } else {
    handlePluginKey(key);
  }
}

function handleProjectKey(key) {
  if (mode === "list") {
    if (key === "up" || key === "w") { cursor = Math.max(0, cursor - 1); }
    else if (key === "down" || key === "s") { cursor = Math.min(items.length, cursor + 1); }
    else if (key === "enter" || key === "space") {
      if (cursor === items.length) { cleanup(); process.exit(42); }
      else if (items.length > 0) { mode = "actions"; acursor = 0; }
    }
    else if (key === "o") {
      if (cursor === items.length) { cleanup(); process.exit(42); }
      else if (items.length > 0) openProject(items[cursor]);
    }
    else if (key === "p") { if (cursor < items.length) togglePin(cursor); }
    else if (key === "h") { if (cursor < items.length) hideItem(cursor); }
    else if (key === "u") { unhideAll(); }
    else if (key === "c") { mode = "input"; inputBuf = ""; }
    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }
  } else if (mode === "actions") {
    var acts = getActions(items[cursor]);
    if (key === "up" || key === "w") { acursor = Math.max(0, acursor - 1); }
    else if (key === "down" || key === "s") { acursor = Math.min(acts.length - 1, acursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[acursor].key;
      if (action === "open") { openProject(items[cursor]); }
      else if (action === "pin" || action === "unpin") { togglePin(cursor); mode = "list"; }
      else if (action === "hide") { hideItem(cursor); mode = "list"; }
      else if (action === "chpath") { mode = "input"; chpathDir = items[cursor].dir; inputBuf = items[cursor].dir; }
      else if (action === "unhide") { unhideAll(); mode = "list"; }
      else { mode = "list"; }
    }
    else if (key === "escape" || key === "q" || key === "left") { mode = "list"; }
  }
}

function handlePluginKey(key) {
  if (mode === "list") {
    if (key === "q" || key === "escape") { cleanup(); process.exit(1); return; }
    
    if (key === "tab") {
      inputBuf = "";
      if (pluginSubPage === "installed") { pluginSubPage = "marketplace"; marketplaceItems = buildMarketplaceList(); mkCursor = 0; mkScrollOff = 0; }
      else if (pluginSubPage === "marketplace") { pluginSubPage = "providers"; provCursor = 0; }
      else if (pluginSubPage === "providers" && customTabs.length > 0) { pluginSubPage = customTabs[0].id; }
      else {
        var cIdx = customTabs.findIndex(function(t) { return t.id === pluginSubPage; });
        if (cIdx >= 0 && cIdx < customTabs.length - 1) {
          pluginSubPage = customTabs[cIdx + 1].id;
        } else {
          pluginSubPage = "installed";
        }
      }
      return;
    }

    var activeTab = customTabs.find(function(t) { return t.id === pluginSubPage; });
    if (activeTab && activeTab.handleKey) {
      try {
        activeTab.handleKey(key, {
          pluginSubPage: pluginSubPage,
          mode: mode
        }, tuiApi);
      } catch(e) {}
      return;
    }

    if (pluginSubPage === "providers") {
      var provList = loadProviders();
      if (key === "up" || key === "w") { provCursor = Math.max(0, provCursor - 1); }
      else if (key === "down" || key === "s") { provCursor = Math.min(Math.max(0, provList.length - 1), provCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (provList.length > 0 && provCursor < provList.length) {
          var providerCfg = loadConfig();
          providerCfg.provider = provList[provCursor].name;
          saveConfig(providerCfg);
          flash("Provider set to " + provList[provCursor].name);
        }
      }
      return;
    }

    if (pluginSubPage === "marketplace") {
      // Actions sub-mode
      if (mkMode === "actions") {
        var mitem = marketplaceItems[mkCursor];
        if (!mitem) { mkMode = "browse"; return; }
        var mkActs = mitem.installed ? [] : [{ key: "install", label: "Install" }];
        if (mitem.url) mkActs.push({ key: "browser", label: "Open in browser" });
        mkActs.push({ key: "cancel", label: "Cancel" });
        if (key === "up" || key === "w") { mkAcursor = Math.max(0, mkAcursor - 1); }
        else if (key === "down" || key === "s") { mkAcursor = Math.min(mkActs.length - 1, mkAcursor + 1); }
        else if (key === "enter" || key === "space") {
          var action = mkActs[mkAcursor].key;
          if (action === "install") {
            flash("Installing " + (mitem.name || mitem.repoName) + "...");
            render();
            var merr = installMarketplacePlugin(mitem);
            if (merr) flash(merr);
            else { flash("Installed! Restart to activate."); pluginItems = buildCombinedPluginList(); }
            marketplaceItems = buildMarketplaceList();
            if (mkCursor >= marketplaceItems.length) mkCursor = Math.max(0, marketplaceItems.length - 1);
          } else if (action === "browser" && mitem.url) {
            try {
              var openCmd = process.platform === "win32" ? "start \"\" \"" + mitem.url + "\"" : process.platform === "darwin" ? "open \"" + mitem.url + "\"" : "xdg-open \"" + mitem.url + "\"";
              execSync(openCmd, { timeout: 5000, stdio: "ignore" });
              flash("Opened in browser");
            } catch(e) { flash("No browser available: " + mitem.url); }
          }
          mkMode = "browse";
        }
        else if (key === "escape" || key === "left") { mkMode = "browse"; }
        return;
      }
      // Browse mode
      if (key === "up" || key === "w") { mkCursor = Math.max(0, mkCursor - 1); }
      else if (key === "down" || key === "s") { mkCursor = Math.min(marketplaceItems.length - 1, mkCursor + 1); }
      else if (key === "enter" || key === "space") {
        if (marketplaceItems.length > 0) { mkMode = "actions"; mkAcursor = 0; }
      }
      else if (key === "/") { mode = "search"; return; }
      else if (key === "r") {
        invalidateCatalogCache();
        catalogFetched = false;
        fetchCatalogsAsync();
        marketplaceItems = buildMarketplaceList();
        flash("Refreshing catalog...");
      }
      else if (key === "i") {
        if (marketplaceItems.length > 0) {
          var quickItem = marketplaceItems[mkCursor];
          if (quickItem.installed) { flash(quickItem.name + " is already installed."); return; }
          flash("Installing " + (quickItem.name || quickItem.repoName) + "...");
          render();
          var quickErr = installMarketplacePlugin(quickItem);
          if (quickErr) flash(quickErr);
          else { flash("Installed! Restart to activate."); pluginItems = buildCombinedPluginList(); }
          marketplaceItems = buildMarketplaceList();
          if (mkCursor >= marketplaceItems.length) mkCursor = Math.max(0, marketplaceItems.length - 1);
        }
      }
    } else if (pluginSubPage === "installed") {
      if (key === "up" || key === "w") { pcursor = Math.max(0, pcursor - 1); }
      else if (key === "down" || key === "s") { pcursor = Math.min(pluginItems.length - 1, pcursor + 1); }
      else if (key === "enter" || key === "space") {
        if (pluginItems.length > 0) { mode = "pactions"; pacursor = 0; }
      }
      else if (key === "r") {
        pluginItems = buildCombinedPluginList();
        flash("Refreshed.");
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
          var remaining = toUpdate.length;
          flash("Updating " + remaining + " plugin(s)...");
          render();
          toUpdate.forEach(function(pi) {
            var repo = loadPlugins().find(function(r) { return r.name === pi.name; });
            setupPlugin(repo || pi, function(e) {
              if (e) errors.push(pi.name + ": " + e);
              remaining--;
              if (remaining <= 0) {
                pluginItems = buildCombinedPluginList();
                if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
                flash(errors.length > 0 ? errors.join("; ") : toUpdate.length + " plugin(s) updated. Restart " + APP_NAME + " to apply.");
                render();
              }
            });
          });
        }
      }
      else if (key === "u") {
        if (pluginItems.length > 0 && pluginItems[pcursor].type !== "npm") {
          var p = pluginItems[pcursor];
          flash("Updating " + p.name + "...");
          render();
          var pRepo = loadPlugins().find(function(r) { return r.name === p.name; });
          setupPlugin(pRepo || p, function(err) {
            pluginItems = buildCombinedPluginList();
            if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
            flash(err ? p.name + ": " + err : p.name + " updated. Restart " + APP_NAME + " to apply.");
            render();
          });
        }
      }
      else if (key === "d") {
        if (pluginItems.length > 0 && pluginItems[pcursor].type !== "npm") {
          var p = pluginItems[pcursor];
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
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(p.name + " disabled. Restart " + APP_NAME + " to unload.");
        }
      }
    }
  } else if (mode === "pactions") {
    var pitem = pluginItems[pcursor];
    var acts = getPluginActions(pitem);
    if (key === "up" || key === "w") { pacursor = Math.max(0, pacursor - 1); }
    else if (key === "down" || key === "s") { pacursor = Math.min(acts.length - 1, pacursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[pacursor].key;
      if (action === "updater-update") {
        mode = "list";
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
          pluginItems = buildCombinedPluginList();
          flash(engineErr ? "plugin-updater: " + engineErr : "plugin-updater updated.");
        }
      }
      else if (action === "updater-run") {
        flash("Updating all plugins...");
        mode = "list";
        render();
        var runModule = getUpdater();
        if (runModule && typeof runModule.earlyLaunch === "function") {
          Promise.resolve(runModule.earlyLaunch(CONFIG_DIR, loadPlugins())).then(function() {
            pluginItems = buildCombinedPluginList();
            flash("All plugins updated. Restart " + APP_NAME + " to apply.");
            render();
          }).catch(function(e) { flash("Update failed: " + e); render(); });
        } else {
          flash("updater not available");
        }
      }
      else if (action === "updater-add") {
        inputBuf = "";
        mode = "pinput";
      }
      else if (action === "update") {
        flash("Updating " + pitem.name + "...");
        mode = "list";
        render();
        var actRepo = loadPlugins().find(function(r) { return r.name === pitem.name; });
        setupPlugin(actRepo || pitem, function(err) {
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
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
        mode = "list";
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
        pluginItems = buildCombinedPluginList();
        if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
        flash(pitem.name + " disabled. Restart " + APP_NAME + " to unload.");
        mode = "list";
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
        pluginItems = buildCombinedPluginList();
        if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
        flash(err ? pitem.name + ": " + err : pitem.name + " updated. Restart " + APP_NAME + " to apply.");
        mode = "list";
      }
      else if (action === "uninstall-npm") {
        confirmAction = { type: "uninstall-npm", target: pitem };
        confirmLabel = "Uninstall npm plugin " + pitem.name + "? It is removed from opencode.json.";
        confirmCursor = 0;
        mode = "confirm";
      }
      else if (action === "uninstall-plugin") {
        confirmAction = { type: "uninstall-plugin", target: pitem };
        confirmLabel = "Uninstall " + pitem.name + "? This deletes its repo clone.";
        confirmCursor = 0;
        mode = "confirm";
      }
            else if (action === "enable-plugin") {
        var plugins = loadPlugins();
        var match = plugins.find(function(r) { return r.name === pitem.name; });
        if (match) { delete match.enabled; } else { plugins.push({ name: pitem.name }); }
        savePlugins(plugins);
        flash("Setting up " + pitem.name + "...");
        mode = "list";
        render();
        setupPlugin(match || { name: pitem.name, url: pitem.url }, function(setupErr) {
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(setupErr ? pitem.name + ": " + setupErr : pitem.name + " enabled and deployed. Restart " + APP_NAME + " to load.");
          render();
        });
      }
      else if (action === "commits") {
        var dir = join(REPOS_DIR, pitem.folderName);
        if (!existsSync(dir)) { flash("Not installed locally yet"); mode = "list"; return; }
        try {
          var log = execSync('git log -20 --format="%h|%s|%ar"', { cwd: dir, encoding: "utf-8", timeout: 5000 });
          var lines = log.trim().split("\n");
          commitItems = [];
          for (var i = 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            var parts = lines[i].split("|");
            if (parts.length >= 3) {
              commitItems.push({ hash: parts[0], subject: parts.slice(1, -1).join("|"), time: parts[parts.length-1] });
            }
          }
          if (commitItems.length > 0) {
            ccursor = 0; cscrollOff = 0; mode = "pcommits";
          } else {
            flash("No commits found"); mode = "list";
          }
        } catch (e) {
          flash("Failed to fetch commits"); mode = "list";
        }
      }
      else { mode = "list"; }
    }
    else if (key === "escape" || key === "q" || key === "left") { mode = "list"; }
  } else if (mode === "confirm") {
    if (key === "y") {
      if (confirmAction && confirmAction.type === "uninstall-plugin") {
        var cpitem = confirmAction.target;
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
        pluginItems = buildCombinedPluginList();
        if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
        flash(cpitem.name + " uninstalled.");
      } else if (confirmAction && confirmAction.type === "uninstall-npm") {
        var cpitem = confirmAction.target;
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
          pluginItems = buildCombinedPluginList();
          if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
          flash(cpitem.name + " uninstalled. Restart " + APP_NAME + ".");
        } catch(e) {
          flash("Uninstall failed. Try: npm uninstall -g " + cpitem.name);
        }
      }
    } else {
      flash("Cancelled.");
    }
    mode = "list";
    confirmAction = null;
  } else if (mode === "pcommits") {
    if (key === "up" || key === "w") { ccursor = Math.max(0, ccursor - 1); }
    else if (key === "down" || key === "s") { ccursor = Math.min(commitItems.length - 1, ccursor + 1); }
    else if (key === "escape" || key === "q" || key === "left") { mode = "list"; }
    else if (key === "enter" || key === "space") {
      var pitem = pluginItems[pcursor];
      var citem = commitItems[ccursor];
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
          flash("Checkout failed"); mode = "list"; return;
        }
      }
      if (err === "Success" || !err) err = "";
      
      pluginItems = buildCombinedPluginList();
      flash(err ? pitem.name + ": " + err : pitem.name + " downgraded. Restart " + APP_NAME + " to apply.");
      mode = "list";
    }
  }
}


function handleInputData(buf) {
  if (buf[0] === 27) { mode = "list"; chpathDir = ""; return; }
  if (buf[0] === 3) { cleanup(); process.exit(1); }
  if (buf[0] === 13 || buf[0] === 10) {
    var p = inputBuf.trim();
    if (p) {
      if (p.charAt(0) === "~") p = HOME + p.substring(1);
      p = p.replace(/\//g, "\\");
      if (chpathDir) {
        if (p === chpathDir) { flash("Same path, nothing changed"); mode = "list"; chpathDir = ""; return; }
        if (existsSync(p)) {
          changeProjectPath(chpathDir, p);
        } else {
          flash("Path not found: " + p);
        }
        mode = "list"; chpathDir = "";
      } else {
        if (existsSync(p)) {
          cleanup();
          outputDir(p);
          process.exit(0);
        } else {
          flash("Path not found: " + p);
          mode = "list";
        }
      }
    } else {
      mode = "list"; chpathDir = "";
    }
    return;
  }
  if (buf[0] === 127 || buf[0] === 8) {
    inputBuf = inputBuf.substring(0, inputBuf.length - 1);
    return;
  }
  if (buf[0] >= 32 && buf[0] < 127) {
    inputBuf += String.fromCharCode(buf[0]);
    return;
  }
  var s = buf.toString("utf-8");
  if (s.length > 0) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32) inputBuf += s.charAt(i);
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

function getMcpActions(mitem) {
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

function buildMcp(pushBody, pushFoot, cols, barW) {
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
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Confirm"], ["Esc", "Back"]]));
    return;
  }

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
        pushBody("  " + bg + arrow + GREEN + "\u25cf" + RST + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + m.command + " " + (m.args || []).join(" ") + RST, sel);
        if (sel) {
          var ek = Object.keys(m.env || {});
          if (ek.length > 0) pushBody("  " + GRAY + "     env: " + ek.join(", ") + RST, sel);
        }
      }
    }
    pushBody("", false);
    if (message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["Tab", "Switch"], ["?", "Help"], ["Q", "Quit"]]));
  } else {
    // Marketplace
    mcpItems = buildMcpList("All");
    pushBody("  " + MAGENTA + "#" + GRAY + " MCP Marketplace (" + mcpItems.length + " available)" + (mode === "search" || inputBuf ? " " + BG_SEL + " Search: " + inputBuf + (mode === "search" ? "_" : "") + " " + RST : " " + DIM + "(press / to search)" + RST), false);
    for (var i = 0; i < mcpItems.length; i++) {
      var m = mcpItems[i];
      var sel = i === mcpCursor;
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
    if (message) {
      pushFoot(messageLine(cols));
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot(hints([["^v/WS", "Move"], ["Enter", "Select"], ["/", "Search"], ["?", "Help"], ["Q", "Quit"]]));
  }
}

// MCP key handling

function handleConfirmKey(key) {
  if (key === "up" || key === "w") { confirmCursor = 0; return; }
  if (key === "down" || key === "s") { confirmCursor = 1; return; }
  var accepted = key === "y" || ((key === "enter" || key === "space") && confirmCursor === 0);
  var rejected = key === "escape" || key === "q" || key === "n" || ((key === "enter" || key === "space") && confirmCursor === 1);
  if (accepted) {
    if (confirmAction && confirmAction.type === "uninstall-plugin") {
      var pitem = confirmAction.target;
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
      pluginItems = buildCombinedPluginList();
      if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
      flash(pitem.name + " uninstalled.");
    } else if (confirmAction && confirmAction.type === "uninstall-npm") {
      var npmName = confirmAction.target.name || confirmAction.target;
      var npmUpdater = getUpdater();
      var npmErr = "updater not available";
      if (npmUpdater && typeof npmUpdater.uninstallNpmPlugin === "function") {
        npmErr = npmUpdater.uninstallNpmPlugin(npmName, CONFIG_DIR) || "";
      }
      pluginItems = buildCombinedPluginList();
      if (pcursor >= pluginItems.length) pcursor = Math.max(0, pluginItems.length - 1);
      flash(npmErr ? npmName + ": " + npmErr : npmName + " removed from opencode.json. Restart " + APP_NAME + " to unload.");
    } else if (confirmAction && confirmAction.type === "uninstall-mcp") {
      uninstallMcpServer(confirmAction.target);
      mcpItems = buildMcpList("All");
      if (mcpCursor >= mcpItems.length) mcpCursor = Math.max(0, mcpItems.length - 1);
      flash(confirmAction.target + " removed.");
    }
    confirmAction = null;
    confirmLabel = "";
    confirmCursor = 0;
    mode = "list";
  } else if (rejected) {
    confirmAction = null;
    confirmLabel = "";
    confirmCursor = 0;
    mode = "list";
    flash("Cancelled.");
  }
}

function handleMcpKey(key) {
  if (mcpMode === "catalog") {
    if (key === "tab") {
      inputBuf = "";
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
    else if (key === "/" && mcpSubPage === "marketplace") { mode = "search"; return; }
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
        confirmLabel = "Remove MCP server " + instList[mcpCursor].name + "?";
        confirmCursor = 0;
        mode = "confirm";
      }
    }
    else if (key === "r") {
      invalidateCatalogCache();
      catalogFetched = false;
      mcpItems = buildMcpList("All");
      flash("Refreshing catalog...");
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
        confirmLabel = "Remove MCP server " + mitem.name + "?";
        confirmCursor = 0;
        mode = "confirm";
        mcpMode = "catalog";
      } else if (action === "configure") {
        flash("Set env vars in " + MCP_CONFIG_PATH);
        mcpMode = "catalog";
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
        mcpMode = "catalog";
      } else {
        mcpMode = "catalog";
      }
    }
    else if (key === "escape" || key === "left") { mcpMode = "catalog"; }
  }
}

// Cleanup & startup

function cleanup() {
  showCur();
  process.stderr.write(E + "H" + E + "2J");
  try { process.stdin.setRawMode(false); } catch {}
}

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
    if (idx >= 0 && idx < items.length) {
      outputDir(items[idx].dir);
      process.exit(0);
    }
    process.exit(42);
  }
  var match = items.find(function(it) { return it.name.toLowerCase().indexOf(arg.toLowerCase()) !== -1; });
  if (!match) match = items.find(function(it) { return it.dir.toLowerCase().indexOf(arg.toLowerCase()) !== -1; });
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
  if (buf[0] === 27) { mode = "list"; return; }
  if (buf[0] === 3) { cleanup(); process.exit(1); }
  if (buf[0] === 13 || buf[0] === 10) { mode = "list"; return; }
  if (buf[0] === 8 || buf[0] === 127) {
    inputBuf = inputBuf.slice(0, -1);
    if (page === "plugins" || page === "mcp") {
    var hasUpdater = loadPlugins().some(function(p) { return p.name.includes("updater") || p.url.includes("updater"); });
    if (!hasUpdater) {
      pushLine("");
      pushBody("  " + BOLD + RED + "Updater Plugin Missing" + RST, false);
      pushBody("  The hub requires an updater plugin to manage installations.", false);
      pushLine("");
      pushBody("  Press " + BOLD + WHITE + "Enter" + RST + " to install the default updater plugin.", false);
      
      // Override key handler for this screen
      if (globalKeyHandler !== "updater_install") {
        globalKeyHandler = "updater_install";
      }
      return;
    } else {
      if (globalKeyHandler === "updater_install") globalKeyHandler = null;
    }
  }

  if (page === "plugins") { marketplaceItems = buildMarketplaceList(); mkCursor = 0; }
    else if (page === "mcp") { mcpItems = buildMcpList("All"); mcpCursor = 0; }
    return;
  }
  var ch = String.fromCharCode(buf[0]);
  if (buf[0] >= 32 && buf[0] <= 126) {
    inputBuf += ch;
    if (page === "plugins") { marketplaceItems = buildMarketplaceList(); mkCursor = 0; }
    else if (page === "mcp") { mcpItems = buildMcpList("All"); mcpCursor = 0; }
  }
}

function handlePluginInputData(buf) {
  if (buf[0] === 27) { inputBuf = ""; mode = "list"; return; }
  if (buf[0] === 13 || buf[0] === 10) {
    var url = inputBuf.trim().replace(/\.git$/, "");
    inputBuf = "";
    mode = "list";
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
      pluginItems = buildCombinedPluginList();
      flash(err ? name + ": " + err : name + " installed. Restart " + APP_NAME + " to load.");
      render();
    });
    return;
  }
  if (buf[0] === 127 || buf[0] === 8) { inputBuf = inputBuf.slice(0, -1); return; }
  if (buf[0] >= 32 && buf[0] <= 126) inputBuf += String.fromCharCode(buf[0]);
}

process.stdin.on("data", function(buf) {
  var key = parseKey(buf);
  
  if (globalKeyHandler === "updater_install") {
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
      globalKeyHandler = null;
      pluginItems = buildCombinedPluginList();
      render();
    }
    if (key === "escape" || key === "q" || buf[0] === 3) process.exit(0);
    return;
  }
  
  if (mode === "input") { handleInputData(buf); render(); return; }
  if (mode === "pinput") { handlePluginInputData(buf); render(); return; }
  if (mode === "search") { handleSearchData(buf); render(); return; }
  var key = parseKey(buf);
  if (key) { handleKey(key); render(); }
});
// @ts-nocheck
