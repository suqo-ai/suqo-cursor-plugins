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
 * When --rename-to is given, `homepage`/`repository` (or `repository.url`)
 * get the source's own name rewritten to the new name wherever it appears
 * embedded in the URL (e.g. https://github.com/suqo-ai/suqo-claude-plugins
 * -> .../suqo-codex-plugins), applied as part of pulling the value from
 * source - not as a separate pass afterward. An earlier version applied
 * the rewrite as a second pass keyed off the *generated* manifest's own
 * (post-rewrite) name, which drifted to the new name after the first run;
 * on a second run the rewrite pass silently no-op'd while the plain
 * source-copy above it kept unconditionally overwriting with the raw,
 * unrenamed value - so the script converged on the wrong value and then
 * reported itself clean (found by review, reproduced, fixed). Deriving
 * the renamed value once, from `source.name` (which never changes between
 * runs) and using *that* as the value being reconciled, makes this a true
 * no-op on any run after the first - see the idempotency test.
 *
 * Writes the reconciled manifest back to <generated-plugin.json> in place.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FIELDS_TO_RECONCILE = ['version', 'author', 'homepage', 'repository', 'license', 'keywords'];
const URL_BEARING_FIELDS = new Set(['homepage', 'repository']);
const KNOWN_FLAGS = new Set(['--rename-to']);

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

// Rewrites `oldName` to `newName` wherever it appears embedded in a URL
// string, or in a {url} object's .url, leaving anything else untouched.
function renameInUrlBearingValue(value, oldName, newName) {
  if (typeof value === 'string') return value.split(oldName).join(newName);
  if (value && typeof value === 'object' && typeof value.url === 'string') {
    return { ...value, url: value.url.split(oldName).join(newName) };
  }
  return value;
}

// Strict on purpose: a silently-ignored malformed flag is the same failure
// mode this whole script exists to close (a fix that looks applied but
// isn't) - found by review on an earlier version that accepted `--rename-to`
// only in exact "--flag value" form, so `--rename-to=x`, a missing value, or
// a typo'd flag name all fell through to being ignored positional
// arguments with exit code 0.
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        console.error(`Unsupported "--flag=value" syntax: "${arg}". Use "--flag value" (space-separated).`);
        process.exit(1);
      }
      if (!KNOWN_FLAGS.has(arg)) {
        console.error(`Unrecognized flag: "${arg}".`);
        process.exit(1);
      }
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Flag "${arg}" requires a value.`);
        process.exit(1);
      }
      flags[arg] = value;
    } else {
      positional.push(arg);
    }
  }
  return { positional, renameTo: flags['--rename-to'] };
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

  // renameTo is only ever applied against source.name, the source's own
  // declared identity - constant across every run, unlike anything read
  // from the file this script writes to.
  const oldName = renameTo !== undefined ? source.name : undefined;

  for (const field of FIELDS_TO_RECONCILE) {
    if (source[field] === undefined) continue;
    let sourceValue = source[field];
    if (renameTo !== undefined && oldName !== renameTo && URL_BEARING_FIELDS.has(field)) {
      sourceValue = renameInUrlBearingValue(sourceValue, oldName, renameTo);
    }
    const before = JSON.stringify(reconciled[field]);
    const after = JSON.stringify(sourceValue);
    if (before !== after) {
      reconciled[field] = sourceValue;
      changed.push(`${field}: ${before ?? '(absent)'} -> ${after}`);
    }
  }

  if (renameTo !== undefined && reconciled.name !== renameTo) {
    changed.push(`name: ${JSON.stringify(reconciled.name)} -> ${JSON.stringify(renameTo)}`);
    reconciled.name = renameTo;
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
