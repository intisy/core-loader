const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runPluginUpdate(pluginItem, reposDir, pluginsDir) {
  var folderName = pluginItem.name.replace(/[^a-zA-Z0-9-]/g, '-');
  var dir = path.join(reposDir, folderName);

  if (!fs.existsSync(dir)) {
    var parentDir = path.dirname(dir);
    if (!fs.existsSync(parentDir)) try { fs.mkdirSync(parentDir, { recursive: true }); } catch {}
    try {
      var cloneCmd = "git clone --recurse-submodules " + pluginItem.url + (pluginItem.branch ? " --branch " + pluginItem.branch : "") + " " + folderName;
      execSync(cloneCmd, { cwd: reposDir, timeout: 60000, stdio: "ignore" });
    } catch (e) { return "Clone failed: " + (e.message || e); }
  } else {
    try {
      if (pluginItem.branch) {
        execSync("git fetch origin", { cwd: dir, timeout: 30000, stdio: "ignore" });
        execSync("git checkout " + pluginItem.branch, { cwd: dir, timeout: 10000, stdio: "ignore" });
        execSync("git pull --ff-only origin " + pluginItem.branch, { cwd: dir, timeout: 30000, stdio: "ignore" });
      } else {
        execSync("git pull --ff-only", { cwd: dir, timeout: 30000, stdio: "ignore" });
      }
      execSync("git submodule update --init --recursive", { cwd: dir, timeout: 30000, stdio: "ignore" });
    } catch {}
  }

  if (pluginItem.install) {
    try { execSync(pluginItem.install.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
    catch (e) { return "Install failed"; }
  }
  if (pluginItem.postInstall) {
    try { execSync(pluginItem.postInstall.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
    catch (e) { return "Post-install failed"; }
  }
  if (pluginItem.build) {
    try { execSync(pluginItem.build.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
    catch (e) { return "Build failed"; }
  }
  if (pluginItem.bundle) {
    try { execSync(pluginItem.bundle.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
    catch (e) { return "Bundle failed"; }
  }

  var outputPath = path.join(dir, pluginItem.output || pluginItem.pluginFile || '');
  var destPath = path.join(pluginsDir, pluginItem.pluginFile || pluginItem.name + '.js');

  if (!fs.existsSync(pluginsDir)) try { fs.mkdirSync(pluginsDir, { recursive: true }); } catch {}

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isFile()) {
    try { fs.copyFileSync(outputPath, destPath); }
    catch (e) { return "Copy failed"; }
  } else if (pluginItem.output || pluginItem.pluginFile) {
    // If it doesn't exist but was specified, that's an error. 
    // If not specified, we just rely on the repo structure (e.g. MCP servers just use `command: "npx"`).
  }

  return null; // success
}

module.exports = {
  runPluginUpdate
};
