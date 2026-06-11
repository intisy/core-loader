// @ts-nocheck
// Plugin list building: git-backed repos + npm plugins + the updater engine
// row, remote-update detection, and the per-plugin action menu.

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { REPOS_DIR, PLUGINS_DIR } from "./env.js";
import { loadPlugins } from "./config.js";
import { getFolderName, loadNpmPlugins, getUpdater, getUpdaterVersion } from "./updater.js";

export function gitText(args, cwd) {
  try {
    var out = execSync(args.join(" "), { cwd: cwd, encoding: "utf-8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch { return ""; }
}

export function buildPluginList() {
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

export function fetchPluginRemotes(pluginItems) {
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

export function buildCombinedPluginList() {
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

export function getPluginActions(pitem) {
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

