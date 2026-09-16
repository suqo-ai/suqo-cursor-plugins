#!/usr/bin/env node
/**
 * Reconcile fields dropped by `acplugin` when converting a Claude Code plugin
 * that is *also its own marketplace* (a `.claude-plugin/plugin.json` sitting
 * next to a `.claude-plugin/marketplace.json` that lists it as a single entry).
 *
 * Root cause (confirmed by reading acplugin's source, not guessed):
 * for a marketplace-shaped repo, acplugin builds the plugin's `PluginMeta`
 * from the marketplace.json *entry* (`scanMarketplace()` in
 * `src/scanner/plugin.ts`), not from the plugin's own `.claude-plugin/plugin.json`.
 * A marketplace entry only ever carries `name`/`description`/`version`/`source`/
 * `category`, so `version`, `author`, `homepage`, `repository`, `license`, and
 * `keywords` from the real plugin.json never reach the generated
 * `.codex-plugin/plugin.json` — `version` silently falls back to acplugin's
 * hardcoded default ("1.0.0"), and the rest are omitted outright.
 *
 * This script re-merges those fields from the real source plugin.json after
 * acplugin has run, so the generated manifest isn't missing real metadata.
 * It never touches acplugin's own output for `name`/`description`/`skills` —
 * those already came through the marketplace entry correctly.
 *
 * Usage:
 *   node tools/reconcile-plugin-manifest.mjs <source-plugin.json> <generated-plugin.json> [--rename-to <name>]
 *
 * --rename-to is a separate, deliberate override, not a "fill a gap from
 * source" fix like the fields above: acplugin always copies `name` straight
 * from the source with no per-target renaming, so every converted plugin
 * would otherwise be called "suqo-claude-plugins" regardless of which tool
 * it's for. Pass --rename-to to force a different, target-specific name -
 * belongs in the pipeline (this script), not a one-off hand-edit of the
 * output, so it survives every future regeneration instead of getting
 * silently reverted by the next one.
 *
 * --rename-to also rewrites `homepage`/`repository` (or `repository.url`)
 * when they embed the old name as a GitHub repo-URL path segment (e.g.
 * https://github.com/suqo-ai/suqo-claude-plugins -> .../suqo-codex-plugins).
 * FIELDS_TO_RECONCILE above copies these straight from the source with no
 * awareness of the rename, so without this a renamed plugin would still
 * ship a homepage link pointing at the source repo instead of its own -
 * a real bug found by review, not hypothetical (confirmed present in the
 * first version of this rename before this fix).
 *
 * Writes the reconciled manifest back to <generated-plugin.json> in place.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FIELDS_TO_RECONCILE = ['version', 'author', 'homepage', 'repository', 'license', 'keywords'];

// Preferred key order for readability, matching Codex's own plugin.json sample
// (openai/codex: codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md).
const FIELD_ORDER = [
  'name', 'version', 'description', 'author', 'homepage', 'repository',
  'license', 'keywords', 'skills', 'hooks', 'mcpServers', 'apps', 'interface',
];

function reorder(manifest) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    if (key in manifest) ordered[key] = manifest[key];
  }
  for (const key of Object.keys(manifest)) {
    if (!(key in ordered)) ordered[key] = manifest[key];
  }
  return ordered;
}

function parseArgs(argv) {
  const positional = [];
  let renameTo;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rename-to') {
      renameTo = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, renameTo };
}

function main() {
  const { positional, renameTo } = parseArgs(process.argv.slice(2));
  const [sourcePath, generatedPath] = positional;
  if (!sourcePath || !generatedPath) {
    console.error('Usage: node tools/reconcile-plugin-manifest.mjs <source-plugin.json> <generated-plugin.json> [--rename-to <name>]');
    process.exit(1);
  }

  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const generated = JSON.parse(readFileSync(generatedPath, 'utf8'));

  const reconciled = { ...generated };
  const changed = [];

  for (const field of FIELDS_TO_RECONCILE) {
    if (source[field] === undefined) continue;
    const before = JSON.stringify(reconciled[field]);
    const after = JSON.stringify(source[field]);
    if (before !== after) {
      reconciled[field] = source[field];
      changed.push(`${field}: ${before ?? '(absent)'} -> ${after}`);
    }
  }

  if (renameTo !== undefined) {
    const oldName = reconciled.name;
    if (oldName !== renameTo) {
      changed.push(`name: ${JSON.stringify(oldName)} -> ${JSON.stringify(renameTo)}`);
      reconciled.name = renameTo;

      const rename = (str) => str.split(oldName).join(renameTo);

      if (typeof reconciled.homepage === 'string' && reconciled.homepage.includes(oldName)) {
        const before = reconciled.homepage;
        reconciled.homepage = rename(before);
        changed.push(`homepage: ${JSON.stringify(before)} -> ${JSON.stringify(reconciled.homepage)}`);
      }
      if (typeof reconciled.repository === 'string' && reconciled.repository.includes(oldName)) {
        const before = reconciled.repository;
        reconciled.repository = rename(before);
        changed.push(`repository: ${JSON.stringify(before)} -> ${JSON.stringify(reconciled.repository)}`);
      } else if (
        reconciled.repository && typeof reconciled.repository === 'object' &&
        typeof reconciled.repository.url === 'string' && reconciled.repository.url.includes(oldName)
      ) {
        const before = reconciled.repository.url;
        reconciled.repository.url = rename(before);
        changed.push(`repository.url: ${JSON.stringify(before)} -> ${JSON.stringify(reconciled.repository.url)}`);
      }
    }
  }

  const finalManifest = reorder(reconciled);
  writeFileSync(generatedPath, JSON.stringify(finalManifest, null, 2) + '\n');

  if (changed.length === 0) {
    console.log('No fields needed reconciling.');
  } else {
    console.log(`Reconciled ${changed.length} field(s) in ${generatedPath}:`);
    for (const line of changed) console.log(`  - ${line}`);
  }
}

main();
