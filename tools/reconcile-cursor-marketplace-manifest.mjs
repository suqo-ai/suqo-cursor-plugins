#!/usr/bin/env node
/**
 * Reconcile fields dropped from acplugin's Cursor marketplace.json output.
 *
 * Different bug from the Codex marketplace reconciler (reconcile-marketplace-
 * manifest.mjs): acplugin's `convertMarketplaceForCursor` (converter/
 * pluginManifest.ts) copies only `name`/`source`/`description` onto each
 * plugin entry - `category`, present on the real source
 * `.claude-plugin/marketplace.json` entry, never makes it into the
 * generated Cursor marketplace.json at all. The top-level
 * `metadata.description`/`metadata.version` are NOT affected by this bug
 * (acplugin reads those correctly from the source marketplace's own
 * top-level fields) - only the per-plugin entry fields below are.
 *
 * Usage:
 *   node tools/reconcile-cursor-marketplace-manifest.mjs \
 *     <source-marketplace.json> <generated-cursor-marketplace.json> [plugin-name] [--rename-to <name>]
 *
 * <source-marketplace.json> is the Claude plugin's own
 * .claude-plugin/marketplace.json - this script reads the matching plugin
 * entry's fields back out of it. If the marketplace lists more than one
 * plugin, pass [plugin-name] to target a specific entry; otherwise the
 * first entry in each file is used.
 *
 * --rename-to renames the matched entry's `name` and updates its `source`
 * to match (Cursor's marketplace entry uses a plain string, not an object
 * like Codex's) - a deliberate override, not a "fill a gap" fix. Pass the
 * same --rename-to value given to reconcile-plugin-manifest.mjs so
 * plugin.json and marketplace.json agree on the new name.
 *
 * It also rewrites any occurrence of the entry's pre-rename name inside the
 * marketplace's own top-level `name` (acplugin passes this through
 * unchanged from the source, so it otherwise keeps saying e.g.
 * "suqo-claude-plugins-marketplace" even after the listed plugin has
 * been correctly renamed - exactly the confusing-branding bug this whole
 * rename exists to fix).
 *
 * [plugin-name] doubles as the reliable "pre-rename name" anchor for that
 * rewrite (not `generatedEntry.name`, which becomes the *new* name after
 * the first run) - a real bug, found by review and reproduced: reading the
 * anchor from the file this script writes to meant a second run against an
 * already-renamed marketplace.json couldn't find the entry at all (the
 * generated-side lookup matched on the old name only) and exited with an
 * error. `[plugin-name]` is a CLI argument, not something this script's
 * own output ever changes, so it stays a valid anchor no matter how many
 * times this has already run - and the generated-side lookup below also
 * falls back to matching on `--rename-to` itself, so a second run finds
 * the (already-renamed) entry and correctly reports no further changes
 * needed, rather than failing. See the idempotency test.
 *
 * The marketplace-name rewrite is derived fresh from
 * <source-marketplace.json>'s own top-level `name` every run, rather than
 * by mutating `generatedMarketplace.name` in place - mirroring
 * reconcile-plugin-manifest.mjs's homepage/repository pattern. An earlier
 * version instead edited the generated value in place using
 * substring-presence heuristics ("does this look already renamed?"), and
 * that approach had two real bugs found by review, both reproduced before
 * fixing:
 *
 *   1. Compounding: if --rename-to's value ever itself contained the old
 *      name as a substring (e.g. "suqo-claude-plugins" -> "suqo-claude-
 *      plugins-v2"), the heuristic re-matched on every subsequent run and
 *      kept re-appending: "...-marketplace" -> "...-v2-marketplace" ->
 *      "...-v2-v2-marketplace".
 *   2. False negative: patching (1) by also requiring the new name be
 *      *absent* broke the case where the new name coincidentally already
 *      appeared in the marketplace name for unrelated reasons on a
 *      genuinely first run - the needed rewrite silently never happened.
 *
 * Deriving the expected value from `sourceMarketplace.name` (loaded above,
 * never mutated) instead of asking "does the current value look
 * already-rewritten?" has neither failure mode: the source is identical
 * no matter how many times this has already run.
 *
 * --description <text>: overrides `metadata.description` unconditionally.
 * acplugin passes this through untouched from the source marketplace's own
 * top-level description, which says "...SUQO Claude plugins and skills." -
 * the same confusing-branding bug this whole rename exists to fix, just in
 * a field neither this script nor reconcile-plugin-manifest.mjs previously
 * looked at. Not a "fill a gap" fix (the field is never actually missing) -
 * an explicit override, same shape as --rename-to itself.
 *
 * Also fixes a real, pre-existing acplugin bug found by review (present in
 * acplugin's raw output before this script or --rename-to ever runs, not
 * introduced by either): acplugin sets `metadata.pluginRoot: "plugins"` and
 * each entry's `source` to the plugin's bare name (e.g.
 * "suqo-claude-plugins") - Cursor's marketplace resolver joins the two
 * (stripping "./" from `source`, then `${pluginRoot}/${source}`), which
 * resolves to a `plugins/<name>` path that doesn't exist in this repo -
 * the plugin's actual files live at the repo root (`.cursor-plugin/`,
 * `skills/`), not nested under a `plugins/` folder. `cursor-agent plugin
 * marketplace add` fails to resolve the entry as a result. Fixed
 * unconditionally (not gated on --rename-to, since it's not a renaming
 * concern): `source` is always forced to `"./"` (matching what upstream's
 * own `.claude-plugin/marketplace.json` correctly has before acplugin's
 * conversion breaks it), and `metadata.pluginRoot` is dropped entirely -
 * without it, Cursor's resolver uses `source` directly with no prefix
 * joined on, so `"./"` correctly means "this repo's own root".
 *
 * Writes the reconciled marketplace.json back in place, with a trailing
 * newline.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ENTRY_FIELDS_TO_RECONCILE = ['category'];
const KNOWN_FLAGS = new Set(['--rename-to', '--description']);

function findEntry(marketplace, targetName, renameTo) {
  if (!targetName) return marketplace.plugins?.[0];
  return marketplace.plugins?.find((p) => p.name === targetName)
    ?? (renameTo ? marketplace.plugins?.find((p) => p.name === renameTo) : undefined);
}

// Strict on purpose - see reconcile-plugin-manifest.mjs's identical
// rationale: a silently-ignored malformed flag defeats the whole point of
// this living in the pipeline instead of being a hand-edit.
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
  return { positional, renameTo: flags['--rename-to'], description: flags['--description'] };
}

function main() {
  const { positional, renameTo, description } = parseArgs(process.argv.slice(2));
  const [sourceMarketplacePath, generatedMarketplacePath, targetName] = positional;
  if (!sourceMarketplacePath || !generatedMarketplacePath) {
    console.error('Usage: node tools/reconcile-cursor-marketplace-manifest.mjs <source-marketplace.json> <generated-cursor-marketplace.json> [plugin-name] [--rename-to <name>] [--description <text>]');
    process.exit(1);
  }

  const sourceMarketplace = JSON.parse(readFileSync(sourceMarketplacePath, 'utf8'));
  const generatedMarketplace = JSON.parse(readFileSync(generatedMarketplacePath, 'utf8'));

  // Source never changes across runs, so a plain lookup is fine here.
  const sourceEntry = findEntry(sourceMarketplace, targetName);
  // The generated file is what this script writes to, so its lookup needs
  // the already-renamed fallback to stay idempotent.
  const generatedEntry = findEntry(generatedMarketplace, targetName, renameTo);

  if (!sourceEntry) {
    console.error(`No matching entry found in source marketplace${targetName ? ` for "${targetName}"` : ''}.`);
    process.exit(1);
  }
  if (!generatedEntry) {
    console.error(`No matching entry found in generated marketplace${targetName ? ` for "${targetName}"` : ''}.`);
    process.exit(1);
  }

  const changed = [];
  for (const field of ENTRY_FIELDS_TO_RECONCILE) {
    if (sourceEntry[field] === undefined) continue;
    if (generatedEntry[field] !== sourceEntry[field]) {
      changed.push(`${field}: ${JSON.stringify(generatedEntry[field]) ?? '(absent)'} -> ${JSON.stringify(sourceEntry[field])}`);
      generatedEntry[field] = sourceEntry[field];
    }
  }

  // Fixes acplugin's own path-resolution bug, unconditionally - not a
  // renaming concern, so not gated on --rename-to. See the doc comment
  // above for the full explanation.
  if (generatedMarketplace.metadata && 'pluginRoot' in generatedMarketplace.metadata) {
    changed.push(`metadata.pluginRoot: ${JSON.stringify(generatedMarketplace.metadata.pluginRoot)} -> removed`);
    delete generatedMarketplace.metadata.pluginRoot;
  }
  if (typeof generatedEntry.source === 'string' && generatedEntry.source !== './') {
    changed.push(`source: ${JSON.stringify(generatedEntry.source)} -> ${JSON.stringify('./')}`);
    generatedEntry.source = './';
  }

  if (description !== undefined && generatedMarketplace.metadata && generatedMarketplace.metadata.description !== description) {
    changed.push(`metadata.description: ${JSON.stringify(generatedMarketplace.metadata.description)} -> ${JSON.stringify(description)}`);
    generatedMarketplace.metadata.description = description;
  }

  if (renameTo !== undefined) {
    // Prefer the CLI-supplied pre-rename name (stable across runs) over
    // generatedEntry.name (which becomes the *new* name after the first run).
    const entryOldName = targetName ?? generatedEntry.name;
    if (entryOldName !== renameTo && generatedEntry.name !== renameTo) {
      changed.push(`name: ${JSON.stringify(generatedEntry.name)} -> ${JSON.stringify(renameTo)}`);
      generatedEntry.name = renameTo;
    }

    // Marketplace-level rewrite: always derived fresh from the untouched
    // sourceMarketplace (loaded above), never from generatedMarketplace.name
    // - see the doc comment above for why.
    const sourceMarketplaceName = sourceMarketplace.name;
    if (typeof sourceMarketplaceName === 'string') {
      const expectedName = sourceMarketplaceName.includes(entryOldName)
        ? sourceMarketplaceName.split(entryOldName).join(renameTo)
        : sourceMarketplaceName; // doesn't embed the plugin's name - nothing to rename.

      if (typeof generatedMarketplace.name === 'string' && generatedMarketplace.name !== expectedName) {
        changed.push(`marketplace name: ${JSON.stringify(generatedMarketplace.name)} -> ${JSON.stringify(expectedName)}`);
        generatedMarketplace.name = expectedName;
      }
    }
  }

  writeFileSync(generatedMarketplacePath, JSON.stringify(generatedMarketplace, null, 2) + '\n');

  if (changed.length === 0) {
    console.log('No fields needed reconciling (trailing newline still normalized).');
  } else {
    console.log(`Reconciled ${changed.length} field(s) in ${generatedMarketplacePath}:`);
    for (const line of changed) console.log(`  - ${line}`);
  }
}

main();
