# atskills-codex

`atskills-codex` is a local Codex plugin for loading skills on demand with the
`@skills:` workflow. The repository is being built in small, independently
testable stages.

## Status

PR 7 completes the integration, security, and release-readiness checks for the
`$atskills` management CLI plus prompt and session hooks.

## Prerequisites

- Node.js 20 or newer
- Python 3 for the Codex plugin validator

The checked-in plugin runtime has no `node_modules` requirement and does not
perform installation or network access at runtime.

## Local development

Run these commands from the repository root:

```sh
npm test
npm run build
npm run check
```

Release installation, maintenance, cachebuster, and troubleshooting steps are
in [`RELEASE.md`](RELEASE.md).

`npm run build` verifies the pinned snapshot and regenerates the checked-in
runtime bundle entirely offline. `npm run check` adds release metadata,
available plugin-validator, and full test checks.

Workspace state is written under the current workspace's `.atskills/` only:
saved skill trees carry a two-line `.source` provenance stamp, and the derived
index at `.atskills/.codex/index.json` can be rebuilt without network access.
Saved snapshots are limited to 4 MiB and 64 files.

The only networked maintenance command is the explicit upstream refresh:

```sh
npm run refresh:upstream
```

It fetches the SHA in [`upstream.json`](upstream.json), verifies the resolved
`HEAD`, refreshes `vendor/atskills/`, its integrity manifest, and the complete
third-party notice. Do not use it during ordinary builds or tests.

Validate the plugin manifest directly with the bundled Codex validator:

```sh
REPO_ROOT=/path/to/atskills-codex
python3 /path/to/plugin-creator/scripts/validate_plugin.py \
  "$REPO_ROOT/plugins/atskills-codex"
```

The repository marketplace is intentionally checked in at
`.agents/plugins/marketplace.json`. Its plugin source path is relative to the
repository root, so local installation can use the repository as the
marketplace source when the plugin is ready for manual testing.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json
├── plugins/atskills-codex/
│   ├── .codex-plugin/plugin.json
│   ├── hooks/
│   │   ├── hooks.json
│   │   └── atskills.mjs
│   ├── runtime/atskills.mjs
│   ├── runtime/core.mjs
│   ├── runtime/state.mjs
│   └── skills/
├── scripts/build.mjs
├── scripts/refresh-upstream.mjs
├── test/
├── upstream.json
├── vendor/atskills/
├── vendor/atskills.snapshot.json
├── vendor/ignore/
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── package.json
└── package-lock.json
```

`.atskills/` is workspace-local state and is ignored by Git. Temporary
upstream refresh checkouts and root build output are also ignored. The
`vendor/` snapshot and generated plugin runtime are intentionally checked in.

## Scope and provenance

The runtime adapts the pinned `SylphAI-Inc/atskills` implementation described
in [`upstream.json`](upstream.json). The source snapshot is checked against
[`vendor/atskills.snapshot.json`](vendor/atskills.snapshot.json) before every
build. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the exact
upstream revision and license text.
