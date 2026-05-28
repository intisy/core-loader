#!/usr/bin/env bun
// Patch script: injects MCP tab, Marketplace, and 3-tab navigation into tui.js
import { readFileSync, writeFileSync } from "fs";

var filePath = process.argv[2] || "tui.js";
var src = readFileSync(filePath, "utf-8");

// Detect line ending
var NL = src.includes("\r\n") ? "\r\n" : "\n";

// =========================================================================
// 1. Insert MCP catalog + config functions + marketplace after showCur line
// =========================================================================
var MCP_BLOCK = `
// ---------------------------------------------------------------------------
// MCP Server Catalog (curated, verified packages)
// ---------------------------------------------------------------------------

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

var MCP_CATEGORIES = ["All", "Search", "Development", "Files", "Database", "Cloud", "Communication", "Productivity", "Data", "AI"];

// ---------------------------------------------------------------------------
// MCP Config read/write (environment-aware)
// ---------------------------------------------------------------------------

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

function buildMcpList(categoryFilter) {
  var installed = loadMcpConfig().mcpServers || {};
  var list = [];
  for (var entry of MCP_CATALOG) {
    if (categoryFilter && categoryFilter !== "All" && entry.category !== categoryFilter) continue;
    list.push({
      name: entry.name, desc: entry.desc, command: entry.command,
      args: entry.args.slice(), env: Object.assign({}, entry.env),
      category: entry.category, installed: !!(installed[entry.name])
    });
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

// ---------------------------------------------------------------------------
// Plugin Marketplace Catalog
// ---------------------------------------------------------------------------

var MARKETPLACE_CATALOG = [
  { name: "antigravity-auth", desc: "Multi-account auth & proxy failover", author: "intisy", url: "https://github.com/intisy", category: "Auth" },
  { name: "credit-dashboard", desc: "Usage & credit tracking dashboard", author: "intisy", url: "https://github.com/intisy", category: "Analytics" },
  { name: "wakatime", desc: "WakaTime coding time tracker", author: "intisy", url: "https://github.com/intisy", category: "Analytics" },
  { name: "daemons", desc: "Background daemon management", author: "intisy", url: "https://github.com/intisy", category: "System" },
];

function buildMarketplaceList() {
  var installed = loadPlugins();
  var installedNames = installed.map(function(p) { return p.name; });
  return MARKETPLACE_CATALOG.filter(function(m) {
    var prefix = CLI_CMD === "opencode" ? "opencode" : "claude";
    var fullName = prefix + "-" + m.name;
    return installedNames.indexOf(m.name) === -1 && installedNames.indexOf(fullName) === -1;
  });
}

function installMarketplacePlugin(entry) {
  var prefix = CLI_CMD === "opencode" ? "opencode" : "claude";
  var repoName = prefix + "-" + entry.name;
  var url = entry.url + "/" + repoName;
  var plugins = loadPlugins();
  plugins.push({ name: repoName, url: url, autoUpdate: true, enabled: true });
  savePlugins(plugins);
  var folderName = entry.author + "/" + repoName;
  var dir = join(REPOS_DIR, folderName);
  if (!existsSync(dir)) {
    var parentDir = dirname(dir);
    if (!existsSync(parentDir)) try { mkdirSync(parentDir, { recursive: true }); } catch {}
    try {
      execSync("git clone " + url + " " + folderName, { cwd: REPOS_DIR, timeout: 60000, stdio: "ignore" });
      return null;
    } catch (e) { return "Clone failed: " + (e.message || e); }
  }
  return null;
}
`;

// Insert after the showCur line, before "// State"
var stateMarker = "// ---------------------------------------------------------------------------" + NL + "// State" + NL + "// ---------------------------------------------------------------------------";
if (!src.includes(stateMarker)) {
  console.error("ERROR: Could not find State marker");
  process.exit(1);
}
src = src.replace(stateMarker, MCP_BLOCK.split("\n").join(NL) + NL + stateMarker);

// =========================================================================
// 2. Add new state variables after existing state vars
// =========================================================================
var stateVarsMarker = "var cscrollOff = 0;";
if (!src.includes(stateVarsMarker)) {
  console.error("ERROR: Could not find cscrollOff marker");
  process.exit(1);
}

var NEW_STATE = `var cscrollOff = 0;

// MCP state
var mcpItems = buildMcpList("All");
var mcpCursor = 0;
var mcpScrollOff = 0;
var mcpCategoryIdx = 0;
var mcpMode = "catalog"; // "catalog" | "actions"
var mcpAcursor = 0;
// Marketplace state
var marketplaceItems = buildMarketplaceList();
var mkCursor = 0;
var mkScrollOff = 0;
var pluginSubPage = "installed"; // "installed" | "marketplace"`;

src = src.replace(stateVarsMarker, NEW_STATE);

// =========================================================================
// 3. Update tab bar to show 3 tabs (Projects, Plugins, MCP) + plugin sub-tabs
// =========================================================================
var tabBarOld = [
  '  var showPluginsTab = pluginItems.length > 0;',
  '  var projTab = page === "projects" ? (BOLD + WHITE + BG_SEL + " Projects " + RST) : (GRAY + " Projects " + RST);',
  '  var plugTab = showPluginsTab ? (page === "plugins" ? (BOLD + WHITE + BG_SEL + " Plugins " + RST) : (GRAY + " Plugins " + RST)) : "";',
  '  pushHead("  " + projTab + (showPluginsTab ? "  " + plugTab + "    " + DIM + "<- ->" + RST : ""));',
].join(NL);

var tabBarNew = [
  '  var showPluginsTab = pluginItems.length > 0 || MARKETPLACE_CATALOG.length > 0;',
  '  var projTab = page === "projects" ? (BOLD + WHITE + BG_SEL + " Projects " + RST) : (GRAY + " Projects " + RST);',
  '  var plugTab = showPluginsTab ? (page === "plugins" ? (BOLD + WHITE + BG_SEL + " Plugins " + RST) : (GRAY + " Plugins " + RST)) : "";',
  '  var mcpTab = page === "mcp" ? (BOLD + WHITE + BG_SEL + " MCP " + RST) : (GRAY + " MCP " + RST);',
  '  pushHead("  " + projTab + "  " + plugTab + "  " + mcpTab + "    " + DIM + "<- ->" + RST);',
].join(NL);

if (!src.includes(tabBarOld)) {
  console.error("ERROR: Could not find tab bar code");
  process.exit(1);
}
src = src.replace(tabBarOld, tabBarNew);

// =========================================================================
// 4. Update page routing in render() to add mcp page + plugins sub-page
// =========================================================================
var renderRouteOld = [
  '  if (page === "projects") {',
  '    buildProjects(pushBody, pushFoot, cols, barW);',
  '  } else {',
  '    buildPlugins(pushBody, pushFoot, cols, barW);',
  '  }',
].join(NL);

var renderRouteNew = [
  '  if (page === "projects") {',
  '    buildProjects(pushBody, pushFoot, cols, barW);',
  '  } else if (page === "mcp") {',
  '    buildMcp(pushBody, pushFoot, cols, barW);',
  '  } else {',
  '    buildPlugins(pushBody, pushFoot, cols, barW);',
  '  }',
].join(NL);

if (!src.includes(renderRouteOld)) {
  console.error("ERROR: Could not find render route code");
  process.exit(1);
}
src = src.replace(renderRouteOld, renderRouteNew);

// =========================================================================
// 5. Update scroll logic in viewport to handle mcp page
// =========================================================================
var scrollOld = [
  '  var activeScroll = 0;',
  '  if (page === "projects") activeScroll = scrollOff;',
  '  else if (mode === "pcommits") activeScroll = cscrollOff;',
  '  else activeScroll = pscrollOff;',
].join(NL);

var scrollNew = [
  '  var activeScroll = 0;',
  '  if (page === "projects") activeScroll = scrollOff;',
  '  else if (page === "mcp") activeScroll = mcpScrollOff;',
  '  else if (mode === "pcommits") activeScroll = cscrollOff;',
  '  else activeScroll = pscrollOff;',
].join(NL);

if (!src.includes(scrollOld)) {
  console.error("ERROR: Could not find scroll logic");
  process.exit(1);
}
src = src.replace(scrollOld, scrollNew);

var scrollSaveOld = [
  '    if (page === "projects") scrollOff = activeScroll;',
  '    else if (mode === "pcommits") cscrollOff = activeScroll;',
  '    else pscrollOff = activeScroll;',
].join(NL);

var scrollSaveNew = [
  '    if (page === "projects") scrollOff = activeScroll;',
  '    else if (page === "mcp") mcpScrollOff = activeScroll;',
  '    else if (mode === "pcommits") cscrollOff = activeScroll;',
  '    else pscrollOff = activeScroll;',
].join(NL);

if (!src.includes(scrollSaveOld)) {
  console.error("ERROR: Could not find scroll save logic");
  process.exit(1);
}
src = src.replace(scrollSaveOld, scrollSaveNew);

// =========================================================================
// 6. Update page switching (left/right arrow) to support 3 pages
// =========================================================================
var pageSwitchOld = [
  '    var showPluginsTab = pluginItems.length > 0;',
  '    if (key === "left" && page === "plugins") { page = "projects"; mode = "list"; render(); return; }',
  '    if (key === "right" && page === "projects" && showPluginsTab) { page = "plugins"; mode = "list"; render(); return; }',
].join(NL);

var pageSwitchNew = [
  '    var pages = ["projects", "plugins", "mcp"];',
  '    var pi = pages.indexOf(page);',
  '    if (key === "left" && pi > 0) { page = pages[pi - 1]; mode = "list"; render(); return; }',
  '    if (key === "right" && pi < pages.length - 1) { page = pages[pi + 1]; mode = "list"; render(); return; }',
].join(NL);

if (!src.includes(pageSwitchOld)) {
  console.error("ERROR: Could not find page switch code");
  process.exit(1);
}
src = src.replace(pageSwitchOld, pageSwitchNew);

// =========================================================================
// 7. Update key routing to add mcp page handler
// =========================================================================
var keyRouteOld = [
  '  if (page === "projects") {',
  '    handleProjectKey(key);',
  '  } else {',
  '    handlePluginKey(key);',
  '  }',
].join(NL);

var keyRouteNew = [
  '  if (page === "projects") {',
  '    handleProjectKey(key);',
  '  } else if (page === "mcp") {',
  '    handleMcpKey(key);',
  '  } else {',
  '    handlePluginKey(key);',
  '  }',
].join(NL);

if (!src.includes(keyRouteOld)) {
  console.error("ERROR: Could not find key route code");
  process.exit(1);
}
src = src.replace(keyRouteOld, keyRouteNew);

// =========================================================================
// 8. Add sub-tab header to buildPlugins + marketplace browsing
// =========================================================================
var pluginsHeaderOld = '  var npmCount = pluginItems.filter(function(p) { return p.type === "npm"; }).length;';

if (!src.includes(pluginsHeaderOld)) {
  console.error("ERROR: Could not find plugins header");
  process.exit(1);
}

// Add plugin sub-tab and marketplace rendering before the existing plugins header
var pluginsSubTabBlock = `  // Sub-tabs: Installed | Marketplace
  var instTab = pluginSubPage === "installed" ? (BOLD + WHITE + BG_SEL + " Installed " + RST) : (GRAY + " Installed " + RST);
  var mktTab = pluginSubPage === "marketplace" ? (BOLD + WHITE + BG_SEL + " Marketplace " + RST) : (GRAY + " Marketplace " + RST);
  pushBody("  " + instTab + "  " + mktTab + "    " + DIM + "Tab" + RST + " switch", false);
  pushBody("", false);

  if (pluginSubPage === "marketplace") {
    if (marketplaceItems.length === 0) {
      pushBody("  " + GRAY + "All available plugins are already installed." + RST, false);
      pushBody("", false);
    } else {
      pushBody("  " + MAGENTA + "#" + GRAY + " Community Plugins" + RST, false);
      for (var mi = 0; mi < marketplaceItems.length; mi++) {
        var mk = marketplaceItems[mi];
        var mSel = mi === mkCursor;
        var mArrow = mSel ? (YELLOW + " > " + RST) : "   ";
        var mBg = mSel ? BG_SEL : "";
        var mNameStyle = mSel ? (BOLD + WHITE) : DIM;
        pushBody("  " + mBg + mArrow + mNameStyle + pad(trunc(mk.name, nameW), nameW) + RST + mBg + "  " + GRAY + mk.desc + RST, mSel);
        if (mSel) {
          pushBody("  " + GRAY + "     by " + mk.author + " | " + mk.category + RST, mSel);
        }
      }
    }
    pushBody("", false);
    if (message) {
      pushFoot("  " + GREEN + "  " + trunc(message, cols - 5) + RST);
    }
    pushFoot("  " + GRAY + "-".repeat(barW) + RST);
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Install  " +
      DIM + "Tab" + RST + " Switch  " +
      DIM + "Q" + RST + " Quit" + RST);
    return;
  }

`;
src = src.replace(pluginsHeaderOld, pluginsSubTabBlock + pluginsHeaderOld);

// =========================================================================
// 9. Add Tab key to plugin key handler for sub-page switching
// =========================================================================
var pluginKeyListBlock = '    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }';
// Find the one inside handlePluginKey (there are multiple, we need the plugin one)
// The plugin one is followed by pactions handling
var pluginKeyMarker = '  } else if (mode === "pactions") {';

// We need to add tab handling before the escape handler in handlePluginKey's list mode
// Find: else if (key === "d") { ... block in plugins, then after the "q" exit
var pluginTabInsert = `    else if (key === "tab") {
      if (pluginSubPage === "installed") { pluginSubPage = "marketplace"; marketplaceItems = buildMarketplaceList(); mkCursor = 0; }
      else { pluginSubPage = "installed"; }
    }`;

// Insert the tab handler. We need to find the right spot.
// In handlePluginKey, mode === "list", before the "q" exit
var pluginQuitInList = '    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }' + NL + '  } else if (mode === "pactions") {';
if (!src.includes(pluginQuitInList)) {
  console.error("ERROR: Could not find plugin quit+pactions marker");
  process.exit(1);
}
src = src.replace(pluginQuitInList, 
  pluginTabInsert + NL +
  '    else if (pluginSubPage === "marketplace" && (key === "enter" || key === "space")) {' + NL +
  '      if (marketplaceItems.length > 0) {' + NL +
  '        flash("Installing " + marketplaceItems[mkCursor].name + "...");' + NL +
  '        render();' + NL +
  '        var merr = installMarketplacePlugin(marketplaceItems[mkCursor]);' + NL +
  '        if (merr) flash(merr);' + NL +
  '        else { flash("Installed! Restart to activate."); pluginItems = buildCombinedPluginList(); }' + NL +
  '        marketplaceItems = buildMarketplaceList();' + NL +
  '        if (mkCursor >= marketplaceItems.length) mkCursor = Math.max(0, marketplaceItems.length - 1);' + NL +
  '      }' + NL +
  '    }' + NL +
  '    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }' + NL +
  '  } else if (mode === "pactions") {'
);

// Fix: marketplace cursor navigation - need to override up/down when in marketplace
var pluginUpDown = '    if (key === "up" || key === "w") { pcursor = Math.max(0, pcursor - 1); }' + NL +
  '    else if (key === "down" || key === "s") { pcursor = Math.min(pluginItems.length - 1, pcursor + 1); }';
  
var pluginUpDownNew = '    if (pluginSubPage === "marketplace") {' + NL +
  '      if (key === "up" || key === "w") { mkCursor = Math.max(0, mkCursor - 1); }' + NL +
  '      else if (key === "down" || key === "s") { mkCursor = Math.min(marketplaceItems.length - 1, mkCursor + 1); }' + NL +
  '    }' + NL +
  '    else if (key === "up" || key === "w") { pcursor = Math.max(0, pcursor - 1); }' + NL +
  '    else if (key === "down" || key === "s") { pcursor = Math.min(pluginItems.length - 1, pcursor + 1); }';

// Only replace the FIRST occurrence (in handlePluginKey list mode)
var pluginUpDownIdx = src.indexOf(pluginUpDown);
if (pluginUpDownIdx === -1) {
  console.error("ERROR: Could not find plugin up/down nav");
  process.exit(1);
}
// Make sure it's in handlePluginKey, not handleProjectKey
var handlePluginKeyIdx = src.indexOf("function handlePluginKey(key)");
if (pluginUpDownIdx > handlePluginKeyIdx) {
  src = src.substring(0, pluginUpDownIdx) + pluginUpDownNew + src.substring(pluginUpDownIdx + pluginUpDown.length);
}

// =========================================================================
// 10. Add MCP page render + key handler before "// Cleanup & startup"
// =========================================================================
var cleanupMarker = "// ---------------------------------------------------------------------------" + NL + "// Cleanup & startup" + NL + "// ---------------------------------------------------------------------------";

if (!src.includes(cleanupMarker)) {
  console.error("ERROR: Could not find cleanup marker");
  process.exit(1);
}

var MCP_RENDER_AND_KEYS = `
// ---------------------------------------------------------------------------
// Render: MCP page
// ---------------------------------------------------------------------------

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
  a.push({ key: "cancel", label: "Cancel" });
  return a;
}

function buildMcp(pushBody, pushFoot, cols, barW) {
  var nameW = Math.min(28, Math.max(18, cols - 50));

  if (mcpMode === "actions") {
    var mitem = mcpItems[mcpCursor];
    var acts = getMcpActions(mitem);
    pushBody("  " + MAGENTA + "#" + GRAY + " " + mitem.name + RST, false);
    pushBody("  " + GRAY + mitem.desc + RST, false);
    pushBody("  " + GRAY + mitem.command + " " + (mitem.args || []).join(" ") + RST, false);
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
    pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
      DIM + "Enter" + RST + " Confirm  " +
      DIM + "Esc" + RST + " Back" + RST);
    return;
  }

  // Category filter tabs
  var catLine = "  ";
  for (var ci = 0; ci < MCP_CATEGORIES.length; ci++) {
    var cat = MCP_CATEGORIES[ci];
    if (ci === mcpCategoryIdx) {
      catLine += BOLD + CYAN + BG_SEL + " " + cat + " " + RST + " ";
    } else {
      catLine += GRAY + " " + cat + " " + RST + " ";
    }
  }
  pushBody(catLine, false);
  pushBody("", false);

  var installedCount = 0;
  for (var e of mcpItems) { if (e.installed) installedCount++; }
  pushBody("  " + MAGENTA + "#" + GRAY + " MCP Servers " +
    GRAY + "(" + installedCount + " installed, " + mcpItems.length + " available)" + RST, false);

  if (mcpItems.length === 0) {
    pushBody("  " + GRAY + "No servers in this category." + RST, false);
  } else {
    for (var i = 0; i < mcpItems.length; i++) {
      var m = mcpItems[i];
      var sel = i === mcpCursor;
      var arrow = sel ? (YELLOW + " > " + RST) : "   ";
      var bg = sel ? BG_SEL : "";
      var nameStyle = sel ? (BOLD + WHITE) : DIM;
      var statusIcon = m.installed ? (GREEN + "●" + RST) : (GRAY + "○" + RST);
      var catTag = GRAY + "[" + m.category + "]" + RST;
      pushBody("  " + bg + arrow + statusIcon + " " + nameStyle + pad(trunc(m.name, nameW), nameW) + RST + bg + "  " + GRAY + trunc(m.desc, Math.max(10, cols - nameW - 20)) + RST + "  " + catTag, sel);
      if (sel) {
        pushBody("  " + GRAY + "     " + m.command + " " + (m.args || []).join(" ") + RST, sel);
      }
    }
  }

  pushBody("", false);
  if (message) {
    pushFoot("  " + GREEN + "  " + trunc(message, cols - 5) + RST);
  }
  pushFoot("  " + GRAY + "-".repeat(barW) + RST);
  pushFoot("  " + DIM + "^v" + RST + "/" + DIM + "WS" + RST + " Move  " +
    DIM + "Enter" + RST + " Select  " +
    DIM + "I" + RST + " Install  " +
    DIM + "X" + RST + " Uninstall  " +
    DIM + "<>" + RST + " Category  " +
    DIM + "Q" + RST + " Quit" + RST);
}

// ---------------------------------------------------------------------------
// MCP key handling
// ---------------------------------------------------------------------------

function handleMcpKey(key) {
  if (mcpMode === "catalog") {
    if (key === "up" || key === "w") { mcpCursor = Math.max(0, mcpCursor - 1); }
    else if (key === "down" || key === "s") { mcpCursor = Math.min(mcpItems.length - 1, mcpCursor + 1); }
    else if (key === "enter" || key === "space") {
      if (mcpItems.length > 0) { mcpMode = "actions"; mcpAcursor = 0; }
    }
    else if (key === "i") {
      if (mcpItems.length > 0 && !mcpItems[mcpCursor].installed) {
        installMcpServer(mcpItems[mcpCursor]);
        mcpItems = buildMcpList(MCP_CATEGORIES[mcpCategoryIdx]);
        flash(mcpItems[mcpCursor].name + " installed. Restart " + APP_NAME + " to activate.");
      }
    }
    else if (key === "x") {
      if (mcpItems.length > 0 && mcpItems[mcpCursor].installed) {
        uninstallMcpServer(mcpItems[mcpCursor].name);
        mcpItems = buildMcpList(MCP_CATEGORIES[mcpCategoryIdx]);
        flash(mcpItems[mcpCursor].name + " uninstalled.");
      }
    }
    else if (key === "tab") {
      mcpCategoryIdx = (mcpCategoryIdx + 1) % MCP_CATEGORIES.length;
      mcpItems = buildMcpList(MCP_CATEGORIES[mcpCategoryIdx]);
      mcpCursor = 0;
      mcpScrollOff = 0;
    }
    else if (key === "q" || key === "escape") { cleanup(); process.exit(1); }
  } else if (mcpMode === "actions") {
    var mitem = mcpItems[mcpCursor];
    var acts = getMcpActions(mitem);
    if (key === "up" || key === "w") { mcpAcursor = Math.max(0, mcpAcursor - 1); }
    else if (key === "down" || key === "s") { mcpAcursor = Math.min(acts.length - 1, mcpAcursor + 1); }
    else if (key === "enter" || key === "space") {
      var action = acts[mcpAcursor].key;
      if (action === "install") {
        installMcpServer(mitem);
        mcpItems = buildMcpList(MCP_CATEGORIES[mcpCategoryIdx]);
        flash(mitem.name + " installed. Restart " + APP_NAME + " to activate.");
        mcpMode = "catalog";
      } else if (action === "uninstall") {
        uninstallMcpServer(mitem.name);
        mcpItems = buildMcpList(MCP_CATEGORIES[mcpCategoryIdx]);
        flash(mitem.name + " uninstalled.");
        mcpMode = "catalog";
      } else if (action === "configure") {
        flash("Set env vars in " + MCP_CONFIG_PATH);
        mcpMode = "catalog";
      } else {
        mcpMode = "catalog";
      }
    }
    else if (key === "escape" || key === "left") { mcpMode = "catalog"; }
  }
}

`;

src = src.replace(cleanupMarker, MCP_RENDER_AND_KEYS + cleanupMarker);

// =========================================================================
// 11. Add "tab" to parseKey if missing
// =========================================================================
if (!src.includes('"tab"') && !src.includes("'tab'")) {
  // Find parseKey function and add tab support
  var parseReturn = 'if (s === "\\x1b[A") return "up";';
  if (src.includes(parseReturn)) {
    src = src.replace(parseReturn, 'if (s === "\\t") return "tab";' + NL + '  ' + parseReturn);
  }
}

// =========================================================================
// Write result
// =========================================================================
writeFileSync(filePath, src, "utf-8");
console.log("OK: Patched " + filePath);
console.log("Lines: " + src.split(NL).length);
