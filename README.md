# atskills-codex

`atskills-codex` is a local Codex plugin for loading skills on demand with the
`@skills:` workflow. The repository is being built in small, independently
testable stages.

## Status

PR 1 provides the repository, plugin manifest, repo-local marketplace, and
offline development checks. The resolver, bundled runtime, workspace state,
management skill, and hooks are added by later implementation stages.

## Prerequisites

- Node.js 20 or newer
- Python 3 for the Codex plugin validator

The plugin is designed to be self-contained when complete. The foundation has
no runtime dependencies and does not require network access.

## Local development

Run these commands from the repository root:

```sh
npm test
npm run build
npm run check
```

`npm run build` currently checks the packaging foundation and its required
paths. It will become the offline runtime bundle build in the upstream-runtime
stage. `npm run check` runs the build check and tests together.

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
│   ├── runtime/
│   └── skills/
├── scripts/build.mjs
├── test/foundation.test.mjs
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── package.json
└── package-lock.json
```

`.atskills/` is workspace-local state and is ignored by Git. Temporary
upstream refresh checkouts and generated build output are also ignored; the
checked-in runtime artifacts will be introduced in the later runtime stage.

## Scope and provenance

The eventual runtime will adapt the pinned
`SylphAI-Inc/atskills` implementation at commit
`858802c58636e43d04edae51d4ac5d7c3819decf`. No upstream source or third-party
runtime is bundled in this foundation stage; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the current notice.
