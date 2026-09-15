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
