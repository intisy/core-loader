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
