# Marketplace Multi-Select + Batch Install — Design Spec

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Home:** `core-loader` (shared TUI; ships to both loaders)

## Goal

Let a user mark several plugins in the marketplace and install them all at once,
without disturbing the existing single-item flow (Enter → action menu; `i` →
quick-install current).

## Scope

Plugin marketplace **browse** mode only. NOT the MCP marketplace, NOT the
installed tab. (Future extension possible; out of scope here.)

## Interaction (approved)

- **Space** — toggle selection of the item under the cursor. Installed items are
  not selectable: Space flashes "already installed" and is a no-op.
- **`i`** — if ≥1 item is selected: batch-install ALL selected (skipping any that
  are already installed), flash a summary, clear the selection, refresh lists. If
  nothing is selected: install the current item (today's `i` behavior, unchanged).
- **Enter** — unchanged (opens the current item's single-item action menu).
- **/**, **r** — unchanged (search, refresh).

## Components

### 1. State — `src/state.ts`
Add `mkSelected: {}` to the shared `S` object: a map keyed by each item's stable
identity `selectionKey(item)` → `true`. Keying by identity (not list index) means
a selection survives search-filtering and `buildMarketplaceList()` refreshes.

`selectionKey(item)` = `item.full_name` || `item.author + "/" + item.repoName` ||
`item.name`. (Defined once and reused by input + render.)

### 2. Selection resolution — `src/marketplace.ts`
Add a small pure helper:
`selectedInstallables(selectedMap): Array<catalogEntry>` — returns the catalog
entries from `S.MARKETPLACE_CATALOG` whose `selectionKey` is in `selectedMap` AND
that are not already installed (reuse the installed check from
`buildMarketplaceList`). Resolving against the full catalog (not the filtered
`S.marketplaceItems`) means selections made before a search still install.

### 3. Input — `src/input.ts` (marketplace browse mode, ~line 145)
- **Space**: let `item = S.marketplaceItems[S.mkCursor]`; if `item.installed`,
  `flash(name + " is already installed.")`; else toggle
  `S.mkSelected[selectionKey(item)]` (delete when unselecting).
- **`i`**: compute `sel = selectedInstallables(S.mkSelected)`.
  - If `sel.length > 0`: `flash("Installing " + sel.length + " plugins...")`,
    render, then loop `installMarketplacePlugin(entry)` collecting failures;
    `flash` a summary (e.g. `Installed 3` or `Installed 2 · 1 failed: name`);
    clear `S.mkSelected` (reset to `{}`); rebuild `S.marketplaceItems` +
    `S.pluginItems`; clamp `S.mkCursor`.
  - Else: the existing single-item quick-install of the current item (unchanged).

### 4. Render — `src/views/plugins.ts` (marketplace loop, ~line 238-258)
- A fixed **4-char selection slot** immediately after the cursor arrow, kept
  aligned on every row: `"[x] "` when selected, `"[ ] "` when selectable
  (not installed), `"    "` (blank) when installed/non-selectable. It precedes the
  existing `●/○` install dot, `◆` official badge, and name; include its width in
  the row's `usedW` so description/star columns stay aligned.
- Footer: when `Object.keys(S.mkSelected).length > 0`, show
  `N selected · Space: toggle · i: install selected`; otherwise the normal hints.

## Data flow

Space mutates `S.mkSelected[key]`. Render reads `S.mkSelected` for the checkbox +
footer count. `i` reads `S.mkSelected`, resolves to catalog entries via
`selectedInstallables`, installs each, clears the map, refreshes.

## Error handling

`installMarketplacePlugin` returns an error string (never throws). The batch loop
collects per-item failures and reports a summary; partial success is fine. Empty
catalog / no current item is guarded (as today). Selecting an already-installed
item is prevented at toggle time; the resolver also skips installed entries defensively.

## Testing

`core-loader` is a private library with no vitest of its own; it is exercised by
the loaders' contract tests (which build core-loader) and manual TUI smoke.
Verification: clean `tsc` build of core-loader (and via a loader build); the pure
`selectedInstallables` helper keeps the batch logic simple and reviewable;
manual smoke of Space-toggle → `i` → summary.

## Rollout

One `core-loader` change → advance both loaders' `core-loader` submodule pointer +
patch release (same shape as the Official-section and README-generator features).
