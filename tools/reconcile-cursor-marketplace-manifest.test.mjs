import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, writeJson, readJson, readText, runScript } from './test-utils.mjs';

const SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'reconcile-cursor-marketplace-manifest.mjs');

test('reconciles category from the source entry onto the generated entry', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', source: './', description: 'Example.', category: 'sdk' }],
    });
    // What acplugin's Cursor writer actually produces: name/source/description
    // present, category dropped entirely - mirrors the real bug.
    writeJson(generatedPath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', source: 'example-plugin', description: 'Example.' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.category, 'sdk');
  } finally {
    cleanup();
  }
});

test('overwrites category when it is present but wrong, not just when absent', () => {
  // Every other fixture in this file gives the generated entry no
  // `category` at all, so none of them can tell "fills when absent" apart
  // from "overwrites when wrong" - this is the one that can.
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', category: 'productivity' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.category, 'sdk');
  } finally {
    cleanup();
  }
});

test('does not touch fields outside its reconcile list', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    // description genuinely differs between source and generated - if this
    // script touched anything beyond `category`, this would catch it.
    writeJson(sourcePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', description: 'Source description.', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', description: 'Generated description acplugin already got right.' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.category, 'sdk');
    assert.equal(entry.description, 'Generated description acplugin already got right.');
  } finally {
    cleanup();
  }
});

test('targets a specific named entry when the marketplace lists more than one plugin', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'multi-marketplace',
      plugins: [
        { name: 'first-plugin', category: 'productivity' },
        { name: 'second-plugin', category: 'sdk' },
      ],
    });
    writeJson(generatedPath, {
      name: 'multi-marketplace',
      plugins: [
        { name: 'first-plugin' },
        { name: 'second-plugin' },
      ],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'second-plugin']);
    const [first, second] = readJson(generatedPath).plugins;

    assert.equal(first.category, undefined);
    assert.equal(second.category, 'sdk');
  } finally {
    cleanup();
  }
});

test('exits non-zero and leaves the file untouched when no entry matches in the generated marketplace', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin', category: 'sdk' }] });
    const original = { name: 'example-marketplace', plugins: [{ name: 'other-plugin' }] };
    writeJson(generatedPath, original);

    assert.throws(() => runScript(SCRIPT, [sourcePath, generatedPath, 'example-plugin']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /No matching entry found in generated marketplace for "example-plugin"/);
      return true;
    });

    assert.deepEqual(readJson(generatedPath), original);
  } finally {
    cleanup();
  }
});

test('adds a trailing newline even when no field needed reconciling', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin', category: 'sdk' }] });
    writeJson(generatedPath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin', category: 'sdk' }] });

    const { stdout } = runScript(SCRIPT, [sourcePath, generatedPath]);

    assert.match(stdout, /No fields needed reconciling/);
    const text = readText(generatedPath);
    assert.ok(text.endsWith('\n'));
    assert.ok(!text.endsWith('\n\n'));
  } finally {
    cleanup();
  }
});

test('exits non-zero with a usage message when arguments are missing', () => {
  assert.throws(() => runScript(SCRIPT, []), (err) => {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Usage: node tools\/reconcile-cursor-marketplace-manifest\.mjs/);
    return true;
  });
});

test('--rename-to overrides the entry name (source is fixed to "./" separately, not tied to the rename)', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-cursor-plugins']);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.name, 'suqo-cursor-plugins');
    assert.equal(entry.source, './');
  } finally {
    cleanup();
  }
});

test('forces the entry source to "./" and drops metadata.pluginRoot - a real acplugin path-resolution bug, unconditional on --rename-to', () => {
  // Regression test: acplugin sets metadata.pluginRoot: "plugins" and each
  // entry's source to the plugin's bare name. Cursor's marketplace
  // resolver joins the two (stripping "./" from source, then
  // `${pluginRoot}/${source}`), producing a `plugins/<name>` path that
  // doesn't exist in this repo - the plugin lives at the repo root. Found
  // by review (confirmed present in acplugin's raw, unreconciled output,
  // not introduced by this script or --rename-to), reproduced, fixed:
  // source is always forced to "./" and pluginRoot is dropped, regardless
  // of whether --rename-to is used at all.
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      metadata: { description: 'x', version: '0.4.0', pluginRoot: 'plugins' },
      plugins: [{ name: 'example-plugin', source: 'example-plugin', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    assert.equal(result.plugins[0].source, './');
    assert.equal('pluginRoot' in result.metadata, false);
  } finally {
    cleanup();
  }
});

test('--description overrides metadata.description unconditionally', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      metadata: { description: 'SUQO AI marketplace for SUQO Claude plugins and skills.', version: '0.4.0' },
      plugins: [{ name: 'example-plugin', source: 'example-plugin', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, undefined, '--description', 'SUQO AI marketplace for SUQO Cursor plugins and skills.'].filter((a) => a !== undefined));
    const result = readJson(generatedPath);

    assert.equal(result.metadata.description, 'SUQO AI marketplace for SUQO Cursor plugins and skills.');
  } finally {
    cleanup();
  }
});

test('without --description, metadata.description is left exactly as acplugin produced it', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      metadata: { description: 'SUQO AI marketplace for SUQO Claude plugins and skills.', version: '0.4.0' },
      plugins: [{ name: 'example-plugin', source: 'example-plugin', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    assert.equal(result.metadata.description, 'SUQO AI marketplace for SUQO Claude plugins and skills.');
  } finally {
    cleanup();
  }
});

test('--rename-to also rewrites the marketplace top-level name', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-cursor-plugins']);
    const result = readJson(generatedPath);

    assert.equal(result.name, 'suqo-cursor-plugins-marketplace');
    assert.equal(result.plugins[0].name, 'suqo-cursor-plugins');
  } finally {
    cleanup();
  }
});

test('does not compound the marketplace-name rewrite across repeated runs when --rename-to itself contains the old name', () => {
  // Regression test #1 (identical to the one fixed on the sibling
  // suqo-codex-plugins repo): an earlier version anchored the rewrite on
  // the *generated* marketplace's own name, which already reflects any
  // prior run's changes. If --rename-to's value itself embeds the old
  // name as a substring, a second run's marketplace name already contains
  // the old name as a prefix of the *already-rewritten* value, so a naive
  // rewrite fired again and compounded. Fixed by deriving the expected
  // value fresh from sourceMarketplace.name every run (which never
  // changes) instead of mutating the generated value in place.
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    const args = [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-claude-plugins-v2'];
    runScript(SCRIPT, args);
    assert.equal(readJson(generatedPath).name, 'suqo-claude-plugins-v2-marketplace');

    // Three more runs - a naive fix would compound "-v2" onto the name again each time.
    for (let i = 0; i < 3; i++) runScript(SCRIPT, args);
    assert.equal(readJson(generatedPath).name, 'suqo-claude-plugins-v2-marketplace');
  } finally {
    cleanup();
  }
});

test('does not silently skip a needed rewrite just because the new name already appears somewhere unrelated', () => {
  // Regression test #2 (identical to the one fixed on the sibling
  // suqo-codex-plugins repo): the fix for regression #1 above (in an
  // earlier, now-replaced version) added a check that skipped the rewrite
  // whenever the *new* name was already present in the current value -
  // which broke exactly this case: a genuinely first run, where the new
  // name coincidentally already appears in the marketplace name for
  // reasons unrelated to any prior run. Reproduced: renaming "alpha" ->
  // "beta" against a marketplace name "alpha-beta-thing-marketplace"
  // (never touched by this script before) silently left it unchanged
  // instead of producing "beta-beta-thing-marketplace".
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'alpha-beta-thing-marketplace',
      plugins: [{ name: 'alpha' }],
    });
    writeJson(generatedPath, {
      name: 'alpha-beta-thing-marketplace',
      plugins: [{ name: 'alpha', source: 'alpha', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'alpha', '--rename-to', 'beta']);
    const result = readJson(generatedPath);

    assert.equal(result.name, 'beta-beta-thing-marketplace');
  } finally {
    cleanup();
  }
});

test('running --rename-to twice in a row is a true no-op the second time (idempotency)', () => {
  // Regression test for a real bug reported against the sibling
  // suqo-codex-plugins/suqo-antigravity-plugins scripts and reproduced
  // here too: anchoring the rewrite on `generatedEntry.name` (which
  // becomes the *new* name after the first run) meant a second run's
  // generated-side lookup, matching on the old name only, couldn't find
  // the entry and errored out instead of settling cleanly. Using
  // [plugin-name] (a CLI arg, immune to what this script itself writes)
  // as the anchor, plus a lookup fallback onto --rename-to's value, fixes
  // both.
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'suqo-claude-plugins-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    const args = [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-cursor-plugins'];
    runScript(SCRIPT, args);
    const afterFirstRun = readText(generatedPath);

    const { stdout } = runScript(SCRIPT, args);
    const afterSecondRun = readText(generatedPath);

    assert.match(stdout, /No fields needed reconciling/);
    assert.equal(afterSecondRun, afterFirstRun);

    const result = readJson(generatedPath);
    assert.equal(result.name, 'suqo-cursor-plugins-marketplace');
    assert.equal(result.plugins[0].name, 'suqo-cursor-plugins');
    assert.equal(result.plugins[0].source, './');
  } finally {
    cleanup();
  }
});

test('rejects "--flag=value" syntax instead of silently ignoring it', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');
    writeJson(sourcePath, { name: 'm', plugins: [{ name: 'suqo-claude-plugins' }] });
    writeJson(generatedPath, { name: 'm', plugins: [{ name: 'suqo-claude-plugins' }] });

    assert.throws(() => runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to=suqo-cursor-plugins']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /Unsupported "--flag=value" syntax/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test('rejects an unrecognized flag instead of silently treating it as positional', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');
    writeJson(sourcePath, { name: 'm', plugins: [{ name: 'x' }] });
    writeJson(generatedPath, { name: 'm', plugins: [{ name: 'x' }] });

    assert.throws(() => runScript(SCRIPT, [sourcePath, generatedPath, '--rename-two', 'y']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /Unrecognized flag: "--rename-two"/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test('--rename-to leaves an unrelated marketplace name alone', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    // The source marketplace's own name has no relation to the plugin's
    // name either - nothing for this script to derive a rename from.
    writeJson(sourcePath, {
      name: 'acme-tools-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'acme-tools-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-cursor-plugins']);
    const result = readJson(generatedPath);

    assert.equal(result.name, 'acme-tools-marketplace');
  } finally {
    cleanup();
  }
});

test('without --rename-to, name is left exactly as acplugin produced it (source still gets fixed - that bug fix is unconditional)', () => {
  const { dir, cleanup } = makeTempDir('reconcile-cursor-marketplace-');
  try {
    const sourcePath = join(dir, 'source-marketplace.json');
    const generatedPath = join(dir, 'generated-marketplace.json');

    writeJson(sourcePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', category: 'sdk' }],
    });
    writeJson(generatedPath, {
      name: 'example-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: 'suqo-claude-plugins', description: 'x' }],
    });

    runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins']);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.name, 'suqo-claude-plugins');
    assert.equal(entry.source, './');
  } finally {
    cleanup();
  }
});
