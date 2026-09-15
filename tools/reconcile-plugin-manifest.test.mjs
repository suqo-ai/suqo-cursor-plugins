import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, writeJson, readJson, readText, runScript } from './test-utils.mjs';

const SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'reconcile-plugin-manifest.mjs');

test('merges fields missing from the generated manifest', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, {
      name: 'example-plugin',
      version: '0.4.0',
      description: 'Example plugin.',
      author: { name: 'Example Org', url: 'https://example.com' },
      homepage: 'https://example.com/plugin',
      license: 'Apache-2.0',
      keywords: ['example', 'test'],
    });
    // What acplugin actually produces: name/description/skills present,
    // version defaulted, everything else absent — mirrors the real bug.
    writeJson(generatedPath, {
      name: 'example-plugin',
      version: '1.0.0',
      description: 'Example plugin.',
      skills: './.agents/skills/',
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    assert.equal(result.version, '0.4.0');
    assert.deepEqual(result.author, { name: 'Example Org', url: 'https://example.com' });
    assert.equal(result.homepage, 'https://example.com/plugin');
    assert.equal(result.license, 'Apache-2.0');
    assert.deepEqual(result.keywords, ['example', 'test']);
  } finally {
    cleanup();
  }
});

test('leaves fields alone that already match the source', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    const shared = {
      name: 'example-plugin',
      version: '2.0.0',
      description: 'Example plugin.',
      license: 'MIT',
    };
    writeJson(sourcePath, shared);
    writeJson(generatedPath, { ...shared });

    const { stdout } = runScript(SCRIPT, [sourcePath, generatedPath]);

    assert.match(stdout, /No fields needed reconciling/);
    assert.deepEqual(readJson(generatedPath), shared);
  } finally {
    cleanup();
  }
});

test('does not touch fields outside its reconcile list', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, { name: 'example-plugin', version: '1.2.3' });
    writeJson(generatedPath, {
      name: 'example-plugin',
      version: '1.0.0',
      skills: './.agents/skills/',
      interface: { displayName: 'Example' },
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    // version reconciled...
    assert.equal(result.version, '1.2.3');
    // ...but fields the source doesn't have at all are left exactly as-is.
    assert.equal(result.skills, './.agents/skills/');
    assert.deepEqual(result.interface, { displayName: 'Example' });
  } finally {
    cleanup();
  }
});

test('writes exactly one trailing newline', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, { name: 'x', version: '1.0.0' });
    writeJson(generatedPath, { name: 'x', version: '0.9.0' });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const text = readText(generatedPath);

    assert.ok(text.endsWith('\n'));
    assert.ok(!text.endsWith('\n\n'));
  } finally {
    cleanup();
  }
});

test('orders keys to match the canonical plugin.json field order', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, {
      license: 'MIT',
      name: 'example-plugin',
      keywords: ['a'],
      version: '1.0.0',
    });
    writeJson(generatedPath, { skills: './.agents/skills/', name: 'example-plugin' });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const keys = Object.keys(readJson(generatedPath));

    // name/version/license/keywords/skills, in that relative order.
    assert.ok(keys.indexOf('name') < keys.indexOf('version'));
    assert.ok(keys.indexOf('version') < keys.indexOf('license'));
    assert.ok(keys.indexOf('license') < keys.indexOf('keywords'));
    assert.ok(keys.indexOf('keywords') < keys.indexOf('skills'));
  } finally {
    cleanup();
  }
});

test('leaves description alone even when source disagrees with it', () => {
  // description is deliberately absent from FIELDS_TO_RECONCILE in
  // reconcile-plugin-manifest.mjs, with a comment explaining it already
  // comes through correctly from acplugin. Every other fixture in this
  // file happens to give source and generated the same description, so
  // none of them could ever catch someone undoing that deliberate
  // exclusion — this is the one that actually would.
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, {
      name: 'example-plugin',
      version: '1.0.0',
      description: 'Source description that should NOT overwrite the generated one.',
    });
    writeJson(generatedPath, {
      name: 'example-plugin',
      version: '1.0.0',
      description: 'Generated description acplugin already produced correctly.',
    });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    assert.equal(result.description, 'Generated description acplugin already produced correctly.');
  } finally {
    cleanup();
  }
});

test('exits non-zero with a usage message when arguments are missing', () => {
  assert.throws(() => runScript(SCRIPT, []), (err) => {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Usage: node tools\/reconcile-plugin-manifest\.mjs/);
    return true;
  });
});

test('--rename-to overrides name regardless of what the source calls itself', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, { name: 'suqo-claude-plugins', version: '1.0.0' });
    writeJson(generatedPath, { name: 'suqo-claude-plugins', version: '1.0.0' });

    runScript(SCRIPT, [sourcePath, generatedPath, '--rename-to', 'suqo-codex-plugins']);
    const result = readJson(generatedPath);

    assert.equal(result.name, 'suqo-codex-plugins');
  } finally {
    cleanup();
  }
});

test('without --rename-to, name is left exactly as acplugin produced it', () => {
  const { dir, cleanup } = makeTempDir('reconcile-plugin-');
  try {
    const sourcePath = join(dir, 'source-plugin.json');
    const generatedPath = join(dir, 'generated-plugin.json');

    writeJson(sourcePath, { name: 'suqo-claude-plugins', version: '1.0.0' });
    writeJson(generatedPath, { name: 'suqo-claude-plugins', version: '1.0.0' });

    runScript(SCRIPT, [sourcePath, generatedPath]);
    const result = readJson(generatedPath);

    assert.equal(result.name, 'suqo-claude-plugins');
  } finally {
    cleanup();
  }
});
