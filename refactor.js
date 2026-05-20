const fs = require('fs');
let code = fs.readFileSync('C:/Users/finn/.claude/repos/intisy/core-hub/tui.js', 'utf8');

// Insert vars
code = code.replace('var HOME = homedir();', 
  'var HOME = homedir();\n' +
  'var APP_NAME = process.env.HUB_APP_NAME || \"OpenCode\";\n' +
  'var CLI_CMD = process.env.HUB_CLI_CMD || \"opencode\";\n' +
  'var NPM_PKG = process.env.HUB_NPM_PKG || \"opencode-ai\";\n' +
  'var CACHE_PKG_DIR = process.env.HUB_CACHE_PKG_DIR || join(homedir(), \".cache\", \"opencode\", \"node_modules\");\n'
);

// UI Strings
code = code.replace(/\" OpenCode\"/g, '\" \" + APP_NAME');
code = code.replace(/\"OpenCode Launcher\"/g, 'APP_NAME + \" Launcher\"');
code = code.replace(/\"  > Updating OpenCode: \"/g, '\"  > Updating \" + APP_NAME + \": \"');
code = code.replace(/\"Open in OpenCode\"/g, '\"Open in \" + APP_NAME');
code = code.replace(/\"Use OpenCode in a directory first, then come back.\"/g, '\"Use \" + APP_NAME + \" in a directory first, then come back.\"');
code = code.replace(/\"     managed via npm \\(opencode\\.json\\)\"/g, '\"     managed via npm (\" + CLI_CMD + \".json)\"');

// Commands
code = code.replace(/\"opencode --version\"/g, 'CLI_CMD + \" --version\"');
code = code.replace(/\"npm view opencode-ai version\"/g, '\"npm view \" + NPM_PKG + \" version\"');
code = code.replace(/\"npm install -g opencode-ai@latest\"/g, '\"npm install -g \" + NPM_PKG + \"@latest\"');
code = code.replace(/\"opencode\\.json\"/g, 'CLI_CMD + \".json\"');

// Directories
code = code.replace(/join\\(homedir\\(\\), \"\\.cache\", \"opencode\", \"node_modules\"\\)/g, 'CACHE_PKG_DIR');

fs.writeFileSync('C:/Users/finn/.claude/repos/intisy/core-hub/tui.js', code);
