cd /d C:\Users\finn\.claude\repos\intisy\core-hub
git status
git add .
git commit -m "Refactor plugin key handling, add dynamic GitHub catalog fetching"
git push
cd /d C:\Users\finn\.claude\repos\intisy\claude-hub\core
git pull origin master
cd ..
git add core
git commit -m "Update core submodule for dynamic fetching"
git push
cd /d C:\Users\finn\.config\opencode\repos\intisy\opencode-hub\core
git pull origin master
cd ..
git add core
git commit -m "Update core submodule for dynamic fetching"
git push
