cd /d C:\Users\finn\.claude\repos\intisy\core-hub
git status
git add .
git commit -m "Fix TUI navigation, version display, plugin providers, mcp restructuring"
git push
cd /d C:\Users\finn\.claude\repos\intisy\claude-hub
git add .
git commit -m "Sync core tui.js"
git push
cd /d C:\Users\finn\.config\opencode\repos\intisy\opencode-hub
git add .
git commit -m "Sync core tui.js"
git push
