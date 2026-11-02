# Contributing to skarp

## Repo layout

| Path | What |
|---|---|
| `plugin/skarp` | The Claude Code plugin: the hooks config and the bundled hook script |
| `packages/hooks` | Source of the hook handler, bundled into `plugin/skarp` |
| `packages/schema` | JSON Schema for messages and ledger events, and the generated types |
| `packages/kernel` | Pure rules with no I/O (enforced by a test) |
| `packages/core` | Sessions, the agent loop and ports; `handle(message) -> messages` |
| `packages/rpc` | JSON-RPC over stdio (planned) |
| `packages/ui` | React + Tailwind kit, design tokens and Storybook |
| `packages/cli` | `npx skarp-copilot`: Copilot setup, status and remove (published to npm as `skarp-copilot`) |
| `packages/vscode` | The VS Code extension (in progress, not released) |
| `packages/conformance` | A test suite that drives `core` through a scripted host |
| `assets/` | Brand marks |

Dependency direction: `schema` <- `kernel` <- `core` <- `rpc` / `vscode`.

## Develop

```bash
nvm use            # Node 24
npm i -g pnpm      # or: corepack enable
pnpm install
pnpm test          # build + all tests
pnpm lint
```

After changing `packages/hooks`, rebuild the plugin's hook:

```bash
pnpm build && pnpm --filter @skarp/hooks build:plugin
```

To release a fix, raise `version` in `plugin/skarp/.claude-plugin/plugin.json`, in `packages/cli/package.json` and in the version badge at the top of the [README](README.md), then commit, push and tag the same version (for example `v0.2.1-preview`), and publish the CLI with `cd packages/cli && npm publish --tag preview`. Claude Code keeps each installed plugin under its version, so without a new version `claude plugin update` can keep the old copy.
