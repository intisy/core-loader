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
  // Configure: shown only for plugins that use our core (their bundle answers
  // `config schema`). Probed + cached on the item when the action menu opens.
  if (pitem._cfg && pitem._cfg.items && pitem._cfg.items.length) {
    a.push({ cat: "Configure", key: "configure", label: "Configure settings (" + pitem._cfg.items.length + ")" });
  }
  if (pitem.updateAvail || !pitem.deployed) {
    a.push({ cat: "Update", key: "update", label: "Update now" });
  }
  a.push({ cat: "Update", key: "check-updates", label: "Check for updates" });
  a.push({ cat: "Update", key: "update-all", label: "Update all plugins" });
  a.push({ cat: "Update", key: "update", label: "Force rebuild & deploy" });
  a.push({ cat: "Update", key: "refresh", label: "Refresh list" });
  if (pitem.autoUpdate) {
    a.push({ cat: "Settings", key: "disable-auto", label: "Set to manual update" });
  } else {
    a.push({ cat: "Settings", key: "enable-auto", label: "Enable auto-update" });
  }
  a.push({ cat: "Settings", key: "commits", label: "Select specific commit (Downgrade)" });
  a.push({ cat: "Manage", key: "disable-plugin", label: "Disable plugin" });
  a.push({ cat: "Manage", key: "uninstall-plugin", label: "Uninstall plugin" });
  a.push({ key: "cancel", label: "Cancel" });
  return a;
}

// Probe a deployed plugin bundle for its config schema. A plugin built on our core
// answers `node <bundle> config schema` with {name, defaults, current}; anything else
// (non-core plugins, npm engine row, parse error) yields null -> no Configure action.
export function probeConfigSchema(pitem) {
  if (!pitem || pitem.type === "npm" || !pitem.deployed) return null;
  var bundle = join(PLUGINS_DIR, (pitem.pluginFile || pitem.name + ".js"));
  if (!existsSync(bundle)) return null;
  try {
    var out = execSync('node "' + bundle + '" config schema', { encoding: "utf-8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
    var data = JSON.parse(String(out).trim());
    if (!data || typeof data !== "object") return null;
    var items = buildConfigItems(data);
    if (!items.length) return null;
    return { name: data.name || pitem.name, bundle: bundle, items: items };
  } catch { return null; }
}

// Flatten a schema into editable rows: every key (declared default or on-disk),
// its effective value, whether it is explicitly set, and its inferred type.
export function buildConfigItems(schema) {
  var defaults = (schema && schema.defaults) || {};
  var current = (schema && schema.current) || {};
  var merged = Object.assign({}, defaults, current);
  return Object.keys(merged).map(function (k) {
    var isSet = Object.prototype.hasOwnProperty.call(current, k);
    var value = isSet ? current[k] : defaults[k];
    return { key: k, value: value, def: defaults[k], isSet: isSet, type: typeof value };
  });
}

// Persist one setting by shelling back into the plugin's own config CLI — `config set`
// is the only thing that writes a file, so a config appears only once actually changed.
export function setPluginConfig(bundle, key, valueStr) {
  try {
    execSync('node "' + bundle + '" config set ' + JSON.stringify(key) + ' ' + JSON.stringify(String(valueStr)), { timeout: 8000, stdio: ["ignore", "ignore", "ignore"] });
    return "";
  } catch (e) { return (e && e.message) || "set failed"; }
}

