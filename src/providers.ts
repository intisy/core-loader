// @ts-nocheck
// Auth providers declared by installed plugins (claudeHub.authProviders in
// their package.json). Selecting one routes loader requests through it.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { REPOS_DIR } from "./env.js";

export function loadProviders() {
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
