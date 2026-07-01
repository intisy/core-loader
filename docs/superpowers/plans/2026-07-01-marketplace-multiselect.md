# Marketplace Multi-Select + Batch Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark several marketplace plugins and install them all at once, without disturbing the existing single-item flow.

**Architecture:** A pure selection module (`selectionKey` + `selectedInstallables`) holds the testable logic; shared `S.mkSelected` (identity-keyed map) holds the selection; input adds Space-toggle + `i`-batch-install; the marketplace render gains a checkbox slot + a selection footer. Ships in `core-loader`, then both loaders.

**Tech Stack:** TypeScript compiled with `tsc` (ES5-style `// @ts-nocheck` modules), the shell-based `core-loader` TUI, git submodules.

## Global Constraints

- `core-loader` modules use `// @ts-nocheck`, `var`, function declarations, 2-space indent — match the existing files (`input.ts`, `state.ts`, `views/plugins.ts`, `marketplace.ts`). Do NOT modernize.
- Shared mutable state lives on the single exported `S` object in `state.ts`; mutate its properties (reassigning `S.mkSelected = {}` is fine — it's a property, not the ESM module binding).
- `core-loader` has NO vitest. Task 1's pure module is verified by a standalone `node` assertion script; the UI integration (Tasks 2) is verified by a clean `tsc` build + explicit reasoning; end-to-end by the loaders' contract tests at release.
- Scope: the plugin marketplace **browse** mode only (`S.pluginSubPage === "marketplace"`, `S.mkMode === "browse"`). Do NOT touch MCP, the installed tab, or the action-menu (`mkMode === "actions"`) flow.
- Selection is keyed by identity: `selectionKey(item)` = `item.full_name` || (`item.author` + "/" + `item.repoName`) || `item.name`.
- Enter is unchanged (opens the single-item action menu). Space toggles selection. `i` installs all selected, or the current item if none selected. Installed items are not selectable.
- Never delete unrelated code. Comment only non-obvious logic.

---

## File Structure

- `src/selection.ts` — NEW. Pure, dependency-free: `selectionKey(item)` and `selectedInstallables(catalog, installedNames, selectedMap)`. The only unit-testable logic.
- `test/selection.test.mjs` — NEW. Standalone node assertions for `src/selection.ts` (no test framework).
- `src/state.ts` — MODIFY. Add `mkSelected: {}` to `S`.
- `src/input.ts` — MODIFY. Marketplace browse mode: Space toggles; `i` batch-installs selected (or current).
- `src/views/plugins.ts` — MODIFY. Marketplace loop: checkbox slot + selection footer.

---

### Task 1: Pure selection module + node assertion

**Files:**
- Create: `src/selection.ts`
- Create: `test/selection.test.mjs`

**Interfaces:**
- Produces: `selectionKey(item: any): string`; `selectedInstallables(catalog: any[], installedNames: string[], selectedMap: Record<string, boolean>): any[]` — returns catalog entries whose `selectionKey` is truthy in `selectedMap` AND not present in `installedNames` (by `name` or `repoName || name`).

- [ ] **Step 1: Write the failing assertion test**

Create `test/selection.test.mjs`:

```js
import assert from "node:assert";
import { selectionKey, selectedInstallables } from "../dist/selection.js";

// selectionKey precedence
assert.equal(selectionKey({ full_name: "o/r", name: "r" }), "o/r");
assert.equal(selectionKey({ author: "o", repoName: "r", name: "r" }), "o/r");
assert.equal(selectionKey({ name: "solo" }), "solo");

const catalog = [
  { full_name: "intisy-ai/a", name: "a", repoName: "a" },
  { full_name: "intisy-ai/b", name: "b", repoName: "b" },
  { full_name: "intisy-ai/c", name: "c", repoName: "c" },
];
const selected = { "intisy-ai/a": true, "intisy-ai/c": true };
// b is not selected; a is selected+installed -> only c is installable
const out = selectedInstallables(catalog, ["a"], selected);
assert.deepEqual(out.map((m) => m.name), ["c"]);
// empty selection -> nothing
assert.deepEqual(selectedInstallables(catalog, [], {}), []);

console.log("selection.test.mjs OK");
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd F:/Documents/GitHub/javascript/libs/core-loader && node test/selection.test.mjs`
Expected: FAIL — `Cannot find module '../dist/selection.js'` (module not built yet).

- [ ] **Step 3: Implement `src/selection.ts`**

```ts
// @ts-nocheck
// Pure helpers for marketplace multi-select. Kept dependency-free so the batch
// logic is unit-testable without the TUI/config side effects.

// stable identity for a catalog entry, so a selection survives search filtering
// and list refreshes (which reorder/rebuild S.marketplaceItems)
export function selectionKey(item) {
  if (item.full_name) return item.full_name;
  if (item.author && item.repoName) return item.author + "/" + item.repoName;
  return item.name;
}

// catalog entries the user selected that are NOT already installed. installedNames
// is the list of installed plugin names; an entry counts as installed if its name
// or repoName matches (mirrors buildMarketplaceList's installed check).
export function selectedInstallables(catalog, installedNames, selectedMap) {
  var res = [];
  for (var i = 0; i < catalog.length; i++) {
    var m = catalog[i];
    if (!selectedMap[selectionKey(m)]) continue;
    var repoName = m.repoName || m.name;
    if (installedNames.indexOf(m.name) !== -1 || installedNames.indexOf(repoName) !== -1) continue;
    res.push(m);
  }
  return res;
}
```

- [ ] **Step 4: Build + run the assertion**

Run: `cd F:/Documents/GitHub/javascript/libs/core-loader && npx tsc && node test/selection.test.mjs`
Expected: build clean; prints `selection.test.mjs OK`.

- [ ] **Step 5: Commit**

```bash
git -C F:/Documents/GitHub/javascript/libs/core-loader add src/selection.ts test/selection.test.mjs
git -C F:/Documents/GitHub/javascript/libs/core-loader commit -m "feat(marketplace): pure selection helpers (selectionKey, selectedInstallables)"
```

---

### Task 2: Wire selection into state, input, and render

**Files:**
- Modify: `src/state.ts` (add `mkSelected`)
- Modify: `src/input.ts` (marketplace browse mode: Space toggle, `i` batch)
- Modify: `src/views/plugins.ts` (checkbox slot + footer)

**Interfaces:**
- Consumes: `selectionKey`, `selectedInstallables` from `./selection.js` (Task 1); existing `installMarketplacePlugin`, `buildMarketplaceList`, `loadPlugins`, `buildCombinedPluginList`, `flash`, `render`.

- [ ] **Step 1: Add `mkSelected` to state**

In `src/state.ts`, in the `mk*` block (after `mkAcursor: 0,` ~line 68), add:

```js
  mkSelected: {},
```

- [ ] **Step 2: Space toggles selection (input.ts, browse mode)**

In `src/input.ts`, import the helpers — add to the existing `./marketplace.js` import line a new import near it:

```js
import { selectionKey, selectedInstallables } from "./selection.js";
```

In the marketplace **browse mode** block (the `// Browse mode` section, currently starting ~line 145), change the `enter`/`space` handler so Space toggles instead of opening the menu. Replace:

```js
      else if (key === "enter" || key === "space") {
        if (S.marketplaceItems.length > 0) { S.mkMode = "actions"; S.mkAcursor = 0; }
      }
```

with:

```js
      else if (key === "enter") {
        if (S.marketplaceItems.length > 0) { S.mkMode = "actions"; S.mkAcursor = 0; }
      }
      else if (key === "space") {
        var selItem = S.marketplaceItems[S.mkCursor];
        if (selItem) {
          if (selItem.installed) { flash((selItem.name || selItem.repoName) + " is already installed."); }
          else {
            var sk = selectionKey(selItem);
            if (S.mkSelected[sk]) delete S.mkSelected[sk];
            else S.mkSelected[sk] = true;
          }
        }
      }
```

- [ ] **Step 3: `i` installs selected (or current) — input.ts**

Replace the existing `else if (key === "i") { ... }` block in browse mode (currently ~line 159-171, the single-item quick-install) with:

```js
      else if (key === "i") {
        var batch = selectedInstallables(S.MARKETPLACE_CATALOG, loadPlugins().map(function(p) { return p.name; }), S.mkSelected);
        if (batch.length > 0) {
          flash("Installing " + batch.length + " plugins...");
          render();
          var failed = [];
          for (var bi = 0; bi < batch.length; bi++) {
            var berr = installMarketplacePlugin(batch[bi]);
            if (berr) failed.push(batch[bi].name || batch[bi].repoName);
          }
          var okCount = batch.length - failed.length;
          flash(failed.length
            ? ("Installed " + okCount + " · " + failed.length + " failed: " + failed.join(", ") + ". Restart to activate.")
            : ("Installed " + okCount + "! Restart to activate."));
          S.mkSelected = {};
          S.pluginItems = buildCombinedPluginList();
          S.marketplaceItems = buildMarketplaceList();
          if (S.mkCursor >= S.marketplaceItems.length) S.mkCursor = Math.max(0, S.marketplaceItems.length - 1);
        } else if (S.marketplaceItems.length > 0) {
          var quickItem = S.marketplaceItems[S.mkCursor];
          if (quickItem.installed) { flash(quickItem.name + " is already installed."); return; }
          flash("Installing " + (quickItem.name || quickItem.repoName) + "...");
          render();
          var quickErr = installMarketplacePlugin(quickItem);
          if (quickErr) flash(quickErr);
          else { flash("Installed! Restart to activate."); S.pluginItems = buildCombinedPluginList(); }
          S.marketplaceItems = buildMarketplaceList();
          if (S.mkCursor >= S.marketplaceItems.length) S.mkCursor = Math.max(0, S.marketplaceItems.length - 1);
        }
      }
```

(`loadPlugins` is already imported in input.ts via `./config.js`; if not, add it to that import.)

- [ ] **Step 4: Checkbox slot in the render loop (views/plugins.ts)**

In `src/views/plugins.ts`, import the helper at the top (with the other imports). `views/` is one level under `src/`, so the path is `../selection.js`:

```js
import { selectionKey } from "../selection.js";
```

In the marketplace render loop, after the `officialBadge` line and before `usedW` is computed, add the checkbox and include its width. Change:

```js
      var officialBadge = mitem.official ? (MAGENTA + "◆ " + RST) : "  ";
      var officialBadgeW = 2;
      var usedW = 2 + 3 + 2 + officialBadgeW + mkNameW + 2 + starVis;
```

to:

```js
      var officialBadge = mitem.official ? (MAGENTA + "◆ " + RST) : "  ";
      var officialBadgeW = 2;
      // 4-char selection slot, kept aligned on every row
      var checkbox = mitem.installed ? "    "
        : (S.mkSelected[selectionKey(mitem)] ? (GREEN + "[x] " + RST) : (GRAY + "[ ] " + RST));
      var checkboxW = 4;
      var usedW = 2 + 3 + checkboxW + 2 + officialBadgeW + mkNameW + 2 + starVis;
```

Then insert `checkbox` into the row string, right after `marrow` and before `mIcon`. Change the `pushBody(...)` row line:

```js
      pushBody("  " + mbg + marrow + mIcon + " " + officialBadge + mns + pad(trunc(mitem.name, mkNameW), mkNameW) + RST + mbg + "  " + GRAY + descText + RST + starStr + RST, msel);
```

to:

```js
      pushBody("  " + mbg + marrow + checkbox + mIcon + " " + officialBadge + mns + pad(trunc(mitem.name, mkNameW), mkNameW) + RST + mbg + "  " + GRAY + descText + RST + starStr + RST, msel);
```

- [ ] **Step 5: Selection footer (views/plugins.ts)**

Immediately before the marketplace browse-mode footer `hints([...])` call (the `pushFoot(hints(...))` near the end of the marketplace branch, ~line 262), add a selection-count line:

```js
    var selCount = Object.keys(S.mkSelected).length;
    if (selCount > 0) {
      pushFoot("  " + BOLD + GREEN + selCount + " selected" + RST + GRAY + " · Space: toggle · i: install selected" + RST);
    }
```

(Leave the existing `hints([...])` call as-is; also add `["Space", "Select"]` to that hints array so the key is discoverable.)

- [ ] **Step 6: Build + verify**

Run: `cd F:/Documents/GitHub/javascript/libs/core-loader && npx tsc && node test/selection.test.mjs`
Expected: clean build; `selection.test.mjs OK`.
Reason through: Space on a not-installed item toggles its `[ ]`↔`[x]`; footer shows the count; `i` with selections installs them then clears; `i` with no selection installs the current item; Enter still opens the action menu; installed rows show a blank slot and can't be selected.

- [ ] **Step 7: Commit**

```bash
git -C F:/Documents/GitHub/javascript/libs/core-loader add src/state.ts src/input.ts src/views/plugins.ts
git -C F:/Documents/GitHub/javascript/libs/core-loader commit -m "feat(marketplace): multi-select (Space) + batch install (i)"
```

---

### Task 3: Propagate to both loaders + patch release

**Files:** `loaders/opencode-loader`, `loaders/claude-code-loader` (submodule pointer + version).

- [ ] **Step 1:** Push `core-loader` master (controller does this — requires default-branch push authorization). Record the pushed commit SHA.
- [ ] **Step 2:** For each loader: advance the `core-loader` submodule to origin/master (the new commit), leave the top-level `core` submodule as-is; `npm install && npm run build` (regenerates README via the postbuild readme step — confirm no unrelated drift, `git diff --exit-code -- README.md`).
- [ ] **Step 3:** For each loader: bump patch version (`npm version <next-patch> --no-git-tag-version --allow-same-version`), `git add -A`, commit `chore(release): v<ver>` (advance core-loader submodule: marketplace multi-select), tag `v<ver>`.
- [ ] **Step 4:** Push each branch + tag (opencode-loader `main`, claude-code-loader `master`). CI builds → README drift-check → tests → publish.
- [ ] **Step 5:** Verify both tags on origin and that a CI "Publish to npm" run is green.

---

## Self-Review

**Spec coverage:**
- Space toggles, installed non-selectable → Task 2 Step 2. ✅
- `i` batch-installs selected, else current; summary; clear; refresh → Task 2 Step 3. ✅
- Enter unchanged → Task 2 Step 2 (split `enter` from `space`). ✅
- Identity-keyed selection surviving filter/refresh → Task 1 `selectionKey` + `S.mkSelected`. ✅
- `selectedInstallables` resolves against full catalog, skips installed → Task 1. ✅
- Checkbox slot (aligned) + footer count → Task 2 Steps 4-5. ✅
- Pure/testable logic; core-loader has no vitest → Task 1 node assertion. ✅
- Propagate to both loaders + patch release → Task 3. ✅
- MCP / installed tab / action-menu untouched → constrained; only browse-mode edited. ✅

**Placeholder scan:** No TBD/TODO. All code steps show complete code with exact before/after.

**Type consistency:** `selectionKey(item)` and `selectedInstallables(catalog, installedNames, selectedMap)` signatures match between Task 1 (definition + test) and Task 2 (callers). `S.mkSelected` is a `Record<string, boolean>` written in state.ts and read in input.ts + views/plugins.ts. `checkboxW = 4` matches the 4-char strings `"[x] "`/`"[ ] "`/`"    "`.
