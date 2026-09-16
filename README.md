# suqo-cursor-plugins

A Cursor plugin providing [SUQO](https://github.com/suqo-ai)'s SDK-usage skills — automatically kept in sync with [`suqo-ai/suqo-claude-plugins`](https://github.com/suqo-ai/suqo-claude-plugins), the source of truth.

This repo isn't hand-written. Its content is generated from the Claude plugin and converted into Cursor's plugin format; see [How this stays in sync](#how-this-stays-in-sync) below.

## Install

Requires the [Cursor Agent CLI](https://cursor.com/install) (`agent` / `cursor-agent`) installed first.

```bash
git clone https://github.com/suqo-ai/suqo-cursor-plugins.git
agent --plugin-dir ./suqo-cursor-plugins
```

`--plugin-dir` loads the plugin directly for that session — confirmed working end to end (both skills register, and a real task with no mention of skills still pulled in `ts-sdk-usage`'s webhook rules).

To add it as a standing marketplace instead:

```bash
agent plugin marketplace add https://github.com/suqo-ai/suqo-cursor-plugins
```

Cursor's CLI manages marketplaces directly, but installs an individual plugin from one through the interactive `/plugins` command inside a session, not a separate CLI flag (`agent plugin --help` lists only `marketplace` under `plugin`) — add the marketplace above, then run `/plugins` and install `suqo-cursor-plugins` from the list.

Once loaded, Cursor has the SUQO PHP and TypeScript SDK usage skills built in — correct method signatures, common pitfalls, and webhook-handling patterns, without needing to explain any of it per session.

## What's included

| Skill | Covers |
|---|---|
| `php-sdk-usage` | The SUQO PHP SDK (`suqo/suqo-php`, namespace `Suqo\`) — products, subscriptions, billing cycles, paging, webhook verification, and wiring the client into Laravel, Symfony, Slim or plain PHP. |
| `ts-sdk-usage` | The SUQO TypeScript SDK (`@suqo/sdk`) — products, customers, subscriptions, paging, webhook verification, and wiring the client into Express, Fastify, Next.js or plain Node. |

## Structure

```
suqo-cursor-plugins/
  .cursor-plugin/
    plugin.json                  # plugin manifest
    marketplace.json             # marketplace listing (this repo's own entry)
  skills/
    php-sdk-usage/               # SUQO PHP SDK skill
    ts-sdk-usage/                # SUQO TypeScript SDK skill
  tools/                         # scripts used to (re)generate the above - see below
  .github/workflows/             # CI that verifies the above stays in sync - see below
  .source-sync                   # the suqo-claude-plugins commit this repo was last synced from
```

## How this stays in sync

1. **[`acplugin`](https://github.com/TokenRollAI/acplugin)** (MIT, pinned to `1.7.0`) converts the Claude plugin's skills and manifest into Cursor's format.
2. **`tools/reconcile-plugin-manifest.mjs`** (shared with `suqo-codex-plugins`) patches `plugin.json` gaps (`acplugin` drops `version`/`author`/`homepage`/`license`/`keywords`) and applies this repo's own identity via `--rename-to`.
3. **`tools/reconcile-cursor-marketplace-manifest.mjs`** patches `marketplace.json` — different gaps from the Codex port, since Cursor's `acplugin` writer has its own bugs:
   - drops the per-plugin entry's `category` entirely (`--source`/`description`/`name` come through fine);
   - sets `metadata.pluginRoot: "plugins"` and each entry's `source` to the plugin's bare name — Cursor's marketplace resolver joins the two into a `plugins/<name>` path that doesn't exist in this repo (the plugin lives at the repo root, flat, not nested under a `plugins/` folder), which broke `agent plugin marketplace add` outright until this was found and fixed;
   - passes `metadata.description` through from source untouched, which says "...SUQO **Claude** plugins and skills." — fixed the same way the plugin's own rename is, via an explicit `--description` override, not a copy from source.

   Unlike Codex's marketplace entry (an object with a `source.path`), Cursor's entry `source` is a **bare string** — `"./"` for a plugin living at the repo root.
4. Every regeneration is verified with a real `agent --plugin-dir` load before being committed (marketplace-add verification is still pending a working Cursor CLI in this machine's environment — see the note in the reconcile script's own commit history).

### CI

- **`.github/workflows/verify-sync.yml`** — on every PR *and* every push to `main`: runs `tools/*.test.mjs`, then re-runs the conversion above against `suqo-claude-plugins` pinned to the commit recorded in `.source-sync`, and fails if the result doesn't match what's committed.
- **`.github/workflows/check-source-drift.yml`** — weekly: checks whether `suqo-claude-plugins` has moved past `.source-sync`, and opens (or refreshes) a GitHub issue if so. Doesn't block anything - a human decides when to re-sync.

### Manually re-syncing

```bash
npx --yes @disdjj/acplugin@1.7.0 convert <path-to-suqo-claude-plugins> --all --to cursor -o <scratch-dir>
node tools/reconcile-plugin-manifest.mjs <path-to-suqo-claude-plugins>/.claude-plugin/plugin.json <scratch-dir>/.cursor-plugin/plugin.json --rename-to suqo-cursor-plugins
node tools/reconcile-cursor-marketplace-manifest.mjs <path-to-suqo-claude-plugins>/.claude-plugin/marketplace.json <scratch-dir>/.cursor-plugin/marketplace.json suqo-claude-plugins --rename-to suqo-cursor-plugins --description "SUQO AI marketplace for SUQO Cursor plugins and skills."
```

`acplugin` always names the plugin after the source ("suqo-claude-plugins") regardless of target tool - `--rename-to` overrides that to match this repo's own identity; see [why](#how-this-stays-in-sync) above and in the reconcile scripts' own doc comments.

Copy the result into `.cursor-plugin/` and `skills/`, verify with a real `agent --plugin-dir`, and update `.source-sync` to the commit you converted from.

## License

Apache-2.0 (see [LICENSE](LICENSE)). This repo, and the plugin it ships, have zero dependencies — `tools/` uses only Node's built-ins plus `npx` at conversion time, never installed as a project dependency.
