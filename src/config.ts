// @ts-nocheck
// Read/write for loader config, the plugins list, and the MCP server config.
// All three prefer the config/ subdir and fall back to legacy top-level files.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { CONFIG_PATH, CONFIG_FOLDER, CONFIG_DIR, PLUGINS_JSON, MCP_CONFIG_PATH } from "./env.js";
import { getUpdater } from "./updater.js";

export function loadConfig() {
  try { if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); } catch {}
  var legacy = join(CONFIG_DIR, "oc-config.json");
  try { if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf-8")); } catch {}
  return { pinned: [], hidden: [] };
}

export function saveConfig(cfg) {
  try {
    if (!existsSync(CONFIG_FOLDER)) mkdirSync(CONFIG_FOLDER, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch {}
}

export function migrateConfigs() {
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

export function loadPlugins() {
  var updater = getUpdater();
  if (updater && typeof updater.getPlugins === "function") {
    try { return updater.getPlugins(CONFIG_DIR); } catch {}
  }
  try { if (existsSync(PLUGINS_JSON)) return JSON.parse(readFileSync(PLUGINS_JSON, "utf-8")); } catch {}
  var legacy = join(CONFIG_DIR, "plugins.json");
  try { if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf-8")); } catch {}
  return [];
}

export function savePlugins(plugins) {
  if (!existsSync(CONFIG_FOLDER)) try { mkdirSync(CONFIG_FOLDER, { recursive: true }); } catch {}
  // config/ is always preferred; the top-level file only when config/ cannot exist
  var target = existsSync(CONFIG_FOLDER) ? PLUGINS_JSON : join(CONFIG_DIR, "plugins.json");
  writeFileSync(target, JSON.stringify(plugins, null, 2), "utf-8");
}

export function loadMcpConfig() {
  try {
    if (existsSync(MCP_CONFIG_PATH)) return JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
  } catch {}
  return { mcpServers: {} };
}

export function saveMcpConfig(config) {
  try {
    if (!existsSync(dirname(MCP_CONFIG_PATH))) mkdirSync(dirname(MCP_CONFIG_PATH), { recursive: true });
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {}
}
