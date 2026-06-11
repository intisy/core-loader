// @ts-nocheck
// plugin-updater engine discovery and the npm-plugin / repo helpers that wrap it.

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { PLUGINS_DIR, CONFIG_DIR, CACHE_PKG_DIR, REPOS_DIR, tuiLog } from "./env.js";
import { S } from "./state.js";

export function getUpdater() {
  if (S.UPDATER_MODULE !== undefined) return S.UPDATER_MODULE;
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
      S.UPDATER_MODULE = require(updaterPath);
      S.UPDATER_PATH = updaterPath;
      return S.UPDATER_MODULE;
    } catch(e) {
      tuiLog("Failed to load updater plugin from " + updaterPath + ": " + e);
    }
  }
  try {
    S.UPDATER_MODULE = require("plugin-updater");
    return S.UPDATER_MODULE;
  } catch {}
  S.UPDATER_MODULE = null;
  return null;
}

export function getUpdaterVersion() {
  try {
    if (!getUpdater() || !S.UPDATER_PATH) return "";
    var pkgPath = S.UPDATER_PATH.endsWith("index.js")
      ? join(dirname(S.UPDATER_PATH), "package.json")
      : join(S.UPDATER_PATH, "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "";
  } catch { return ""; }
}

export function setupPlugin(repo, done) {
  var updater = getUpdater();
  if (!updater || typeof updater.updatePluginPublic !== "function") {
    done("updater not available");
    return;
  }
  Promise.resolve(updater.updatePluginPublic(repo.name, repo.url, repo.branch))
    .then(function() { done(""); })
    .catch(function(e) { done(String((e && e.message) || e)); });
}

export function getNpmGlobalRoot() {
  if (S.NPM_GLOBAL_ROOT !== null) return S.NPM_GLOBAL_ROOT;
  try { S.NPM_GLOBAL_ROOT = execSync("npm root -g", { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { S.NPM_GLOBAL_ROOT = ""; }
  return S.NPM_GLOBAL_ROOT;
}

export function loadNpmPlugins() {
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

export function getFolderName(plugin) {
  var match = (plugin.url || "").match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (match) {
    var nested = match[1] + "/" + plugin.name;
    if (existsSync(join(REPOS_DIR, nested))) return nested;
  }
  // plugin-updater clones flat into repos/<name>
  return plugin.name;
}
