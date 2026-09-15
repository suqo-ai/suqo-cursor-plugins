/**
 * Small shared helpers for the reconcile-script tests. Zero external
 * dependencies on purpose (only Node built-ins) — tests must stay inside the
 * same zero-dependency rule as everything else in this repo.
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Creates a fresh temp directory, auto-cleaned when the returned handle's `cleanup()` runs. */
export function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Writes a JS object as pretty JSON to `path`. */
export function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

/** Reads and parses a JSON file. */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a file's raw text (for checking trailing-newline behavior). */
export function readText(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Runs one of the reconcile scripts exactly as it runs in production
 * (a real `node <script> <args>` child process, not an imported function) —
 * so the tests exercise the actual deployed script, not a refactored copy.
 * Returns { stdout, status } on a normal exit; throws (with .status set) on
 * a non-zero exit, matching execFileSync's own behavior.
 */
export function runScript(scriptPath, args) {
  const stdout = execFileSync('node', [scriptPath, ...args], { encoding: 'utf8' });
  return { stdout, status: 0 };
}
