// ---------------------------------------------------------------------------
// Account sync & rate-limit reset (shared between claude-hub and opencode-hub)
// ---------------------------------------------------------------------------
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

var HOME = homedir();

// All known locations for antigravity-accounts.json
function getAccountPaths() {
  var xdgConfig = process.env.XDG_CONFIG_HOME || join(HOME, ".config");
  return [
    join(HOME, ".claude", "config", "antigravity-accounts.json"),
    join(HOME, ".claude", "antigravity-accounts.json"),
    join(xdgConfig, "opencode", "config", "antigravity-accounts.json"),
    join(xdgConfig, "opencode", "antigravity-accounts.json"),
  ];
}

function readAccounts(path) {
  try {
    if (existsSync(path)) {
      var data = JSON.parse(readFileSync(path, "utf-8"));
      if (data && Array.isArray(data.accounts)) return data;
    }
  } catch {}
  return null;
}

function writeAccounts(path, data) {
  try {
    var dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch { return false; }
}

function mergeAccountStorage(existing, incoming) {
  var accountMap = new Map();

  for (var acc of existing.accounts) {
    if (acc.refreshToken) accountMap.set(acc.refreshToken, acc);
  }

  for (var acc of incoming.accounts) {
    if (!acc.refreshToken) continue;
    var prev = accountMap.get(acc.refreshToken);
    if (prev) {
      // Merge rate limits (take max per key)
      var mergedRateLimits = Object.assign({}, prev.rateLimitResetTimes || {});
      var incomingRateLimits = acc.rateLimitResetTimes || {};
      for (var key of Object.keys(incomingRateLimits)) {
        var val = incomingRateLimits[key];
        if (typeof val === "number") {
          mergedRateLimits[key] = Math.max(mergedRateLimits[key] || 0, val);
        }
      }

      var coolingDownUntil = Math.max(prev.coolingDownUntil || 0, acc.coolingDownUntil || 0) || undefined;
      var cooldownReason = coolingDownUntil === acc.coolingDownUntil ? acc.cooldownReason : prev.cooldownReason;

      accountMap.set(acc.refreshToken, Object.assign({}, prev, acc, {
        projectId: acc.projectId ?? prev.projectId,
        managedProjectId: acc.managedProjectId ?? prev.managedProjectId,
        rateLimitResetTimes: mergedRateLimits,
        lastUsed: Math.max(prev.lastUsed || 0, acc.lastUsed || 0),
        coolingDownUntil: coolingDownUntil,
        cooldownReason: cooldownReason,
        enabled: acc.enabled !== undefined ? acc.enabled : prev.enabled,
      }));
    } else {
      accountMap.set(acc.refreshToken, acc);
    }
  }

  return {
    version: Math.max(existing.version || 4, incoming.version || 4),
    accounts: Array.from(accountMap.values()),
    activeIndex: existing.activeIndex || 0,
  };
}

/**
 * Sync accounts across all known config locations.
 * Reads from all paths, merges into one combined set, writes back to all existing paths.
 * Returns { count, source } where count is number of unique accounts and source is the primary path.
 */
export async function syncAccounts() {
  var paths = getAccountPaths();
  var merged = { version: 4, accounts: [], activeIndex: 0 };
  var source = null;
  var existingPaths = [];

  // Read from all known locations
  for (var p of paths) {
    var data = readAccounts(p);
    if (data) {
      if (!source) source = p;
      existingPaths.push(p);
      merged = mergeAccountStorage(merged, data);
    }
  }

  if (merged.accounts.length === 0) {
    return { count: 0, source: "none" };
  }

  // Write merged result back to all existing locations
  var written = 0;
  for (var ep of existingPaths) {
    if (writeAccounts(ep, merged)) written++;
  }

  // Also ensure primary Claude and OpenCode paths exist
  var primaryPaths = [paths[0], paths[2]]; // claude config, opencode config
  for (var pp of primaryPaths) {
    if (existingPaths.indexOf(pp) === -1) {
      if (writeAccounts(pp, merged)) written++;
    }
  }

  return { count: merged.accounts.length, source: source || "merged" };
}

/**
 * Reset rate limits on all accounts across all known config locations.
 * Returns the number of files updated.
 */
export async function resetRateLimits() {
  var paths = getAccountPaths();
  var cleared = 0;

  for (var p of paths) {
    var data = readAccounts(p);
    if (!data) continue;

    var changed = false;
    for (var acc of data.accounts) {
      if (acc.rateLimitResetTimes && Object.keys(acc.rateLimitResetTimes).length > 0) {
        acc.rateLimitResetTimes = {};
        changed = true;
      }
      if (acc.isRateLimited) {
        acc.isRateLimited = false;
        changed = true;
      }
      if (acc.rateLimitResetTime) {
        delete acc.rateLimitResetTime;
        changed = true;
      }
      if (acc.coolingDownUntil) {
        delete acc.coolingDownUntil;
        delete acc.cooldownReason;
        changed = true;
      }
    }

    if (changed) {
      if (writeAccounts(p, data)) cleared++;
    }
  }

  return cleared;
}
