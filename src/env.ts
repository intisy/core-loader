// @ts-nocheck
// Environment: app identity, filesystem paths, static catalogs, and the file
// logger. All values here are read-only constants shared across modules.

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// plugin-updater runs its full update sequence on import and logs to the
// console; library mode limits it to the API so nothing prints over the TUI
process.env.PLUGIN_UPDATER_LIBRARY_MODE = "1";

export const HOME = homedir();
export const APP_NAME = process.env.HUB_APP_NAME || "OpenCode";
export const CLI_CMD = process.env.HUB_CLI_CMD || "opencode";
export const NPM_PKG = process.env.HUB_NPM_PKG || "opencode-ai";
export const CONFIG_DIR = process.env.HUB_CONFIG_DIR || join(HOME, ".config", "opencode");
export const CACHE_PKG_DIR = process.env.HUB_CACHE_PKG_DIR || join(CONFIG_DIR, "cache", "node_modules");

// opencode keeps its session database in the XDG data dir, not the config dir
export const DB_PATH = process.env.HUB_DB_PATH || [
  join(HOME, ".local", "share", "opencode", "opencode.db"),
  join(CONFIG_DIR, "opencode.db"),
].find(function(p) { return existsSync(p); }) || join(HOME, ".local", "share", "opencode", "opencode.db");
export const CONFIG_FOLDER = join(CONFIG_DIR, "config");
export const CACHE_DIR = join(CONFIG_DIR, "cache");
export const CONFIG_PATH = join(CONFIG_FOLDER, "oc-config.json");
export const UPDATE_CHECK_PATH = join(CACHE_DIR, "oc-last-update-check");
export const PLUGINS_JSON = join(CONFIG_FOLDER, "plugins.json");
export const REPOS_DIR = join(CONFIG_DIR, "repos");
export const PLUGINS_DIR = join(CONFIG_DIR, "plugin");
export const MCP_CONFIG_PATH = join(CONFIG_DIR, ".mcp.json");
export const CATALOG_CACHE_PATH = join(CACHE_DIR, "marketplace-catalog.json");

// anything printed to the terminal corrupts the TUI — diagnostics go to a file
export const TUI_START_TIME = new Date().toISOString().replace(/:/g, "-").split(".")[0];
export function tuiLog(msg) {
  try {
    var dateStr = new Date().toISOString().split("T")[0];
    var logsDir = join(CONFIG_DIR, "logs", dateStr);
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    require("fs").appendFileSync(join(logsDir, "loader-tui-" + TUI_START_TIME + ".log"),
      "[" + new Date().toISOString() + "] " + msg + "\n");
  } catch {}
}

// MCP Server Catalog (curated, verified packages)
export const MCP_CATALOG = [
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

// these are hand-picked, verified packages; the flag drives the marketplace
// curated marker and the npm->repo->stars enrichment. registry entries pushed
// in at runtime carry no curated flag, which is correct.
MCP_CATALOG.forEach(function (e) { e.curated = true; });

export const MCP_CATEGORIES = ["All", "Search", "Development", "Files", "Database", "Cloud", "Communication", "Productivity", "Data", "AI", "Plugin"];

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const HELP_BINDINGS = {
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
