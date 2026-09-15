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
 * Writes the reconciled marketplace.json back in place, with a trailing
 * newline.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ENTRY_FIELDS_TO_RECONCILE = ['category'];

function findEntry(marketplace, targetName) {
  return targetName
    ? marketplace.plugins?.find((p) => p.name === targetName)
    : marketplace.plugins?.[0];
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
  const [sourceMarketplacePath, generatedMarketplacePath, targetName] = positional;
  if (!sourceMarketplacePath || !generatedMarketplacePath) {
    console.error('Usage: node tools/reconcile-cursor-marketplace-manifest.mjs <source-marketplace.json> <generated-cursor-marketplace.json> [plugin-name] [--rename-to <name>]');
    process.exit(1);
  }

  const sourceMarketplace = JSON.parse(readFileSync(sourceMarketplacePath, 'utf8'));
  const generatedMarketplace = JSON.parse(readFileSync(generatedMarketplacePath, 'utf8'));

  const sourceEntry = findEntry(sourceMarketplace, targetName);
  const generatedEntry = findEntry(generatedMarketplace, targetName);

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

  if (renameTo !== undefined && generatedEntry.name !== renameTo) {
    changed.push(`name: ${JSON.stringify(generatedEntry.name)} -> ${JSON.stringify(renameTo)}`);
    generatedEntry.name = renameTo;
    if (typeof generatedEntry.source === 'string') {
      changed.push(`source: ${JSON.stringify(generatedEntry.source)} -> ${JSON.stringify(renameTo)}`);
      generatedEntry.source = renameTo;
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
