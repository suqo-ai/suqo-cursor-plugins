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
 * The marketplace-name rewrite is also guarded against compounding: it
 * only fires when the current value contains the old name but NOT the new
 * one already. This rewrite edits a value that's already been through
 * this same script before, so if --rename-to's value ever itself contains
 * the old name as a substring (e.g. renaming "suqo-claude-plugins" to
 * "suqo-claude-plugins-v2"), a naive unconditional split/join would
 * re-match on a second run and compound: "...-marketplace" ->
 * "...-v2-marketplace" -> "...-v2-v2-marketplace". Found by review,
 * reproduced with exactly that pair on the sibling suqo-codex-plugins
 * repo (identical rewrite shape), fixed the same way here.
 *
 * Writes the reconciled marketplace.json back in place, with a trailing
 * newline.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ENTRY_FIELDS_TO_RECONCILE = ['category'];
const KNOWN_FLAGS = new Set(['--rename-to']);

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
  return { positional, renameTo: flags['--rename-to'] };
}

function main() {
  const { positional, renameTo } = parseArgs(process.argv.slice(2));
  const [sourceMarketplacePath, generatedMarketplacePath, targetName] = positional;
  if (!sourceMarketplacePath || !generatedMarketplacePath) {
    console.error('Usage: node tools/reconcile-cursor-marketplace-manifest.mjs <source-marketplace.json> <generated-cursor-marketplace.json> [plugin-name] [--rename-to <name>]');
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

  if (renameTo !== undefined) {
    // Prefer the CLI-supplied pre-rename name (stable across runs) over
    // generatedEntry.name (which becomes the *new* name after the first run).
    const oldName = targetName ?? generatedEntry.name;
    if (oldName !== renameTo) {
      if (generatedEntry.name !== renameTo) {
        changed.push(`name: ${JSON.stringify(generatedEntry.name)} -> ${JSON.stringify(renameTo)}`);
        generatedEntry.name = renameTo;
      }
      if (typeof generatedEntry.source === 'string' && generatedEntry.source !== renameTo) {
        changed.push(`source: ${JSON.stringify(generatedEntry.source)} -> ${JSON.stringify(renameTo)}`);
        generatedEntry.source = renameTo;
      }

      // Only rewrite a value that still contains the old name and does NOT
      // already contain the new one - see the doc comment above for why
      // the second half of that check exists.
      if (
        typeof generatedMarketplace.name === 'string' &&
        generatedMarketplace.name.includes(oldName) && !generatedMarketplace.name.includes(renameTo)
      ) {
        const before = generatedMarketplace.name;
        generatedMarketplace.name = before.split(oldName).join(renameTo);
        changed.push(`marketplace name: ${JSON.stringify(before)} -> ${JSON.stringify(generatedMarketplace.name)}`);
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
