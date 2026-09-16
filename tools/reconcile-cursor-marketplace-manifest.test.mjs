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

test('--rename-to overrides the entry name and updates the bare-string source to match', () => {
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

    runScript(SCRIPT, [sourcePath, generatedPath, 'suqo-claude-plugins', '--rename-to', 'suqo-cursor-plugins']);
    const entry = readJson(generatedPath).plugins[0];

    assert.equal(entry.name, 'suqo-cursor-plugins');
    assert.equal(entry.source, 'suqo-cursor-plugins');
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
      name: 'example-marketplace',
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
      name: 'example-marketplace',
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
    assert.equal(result.plugins[0].source, 'suqo-cursor-plugins');
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

    writeJson(sourcePath, {
      name: 'example-marketplace',
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

test('without --rename-to, name and source are left exactly as acplugin produced them', () => {
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
    assert.equal(entry.source, 'suqo-claude-plugins');
  } finally {
    cleanup();
  }
});
