# Release readiness

Outside users should follow [`Integration.md`](Integration.md) to install the
plugin from GitHub. The local workflow below is for repository maintainers.

## Install locally

From the repository root:

```sh
REPO_ROOT=/path/to/atskills-codex

codex plugin marketplace add "$REPO_ROOT"
codex plugin marketplace list
codex plugin add atskills-codex@atskills-local
```

Confirm that `atskills-local` points at `$REPO_ROOT`. Reload Codex, review and
trust the plugin hooks through `/hooks`, then validate in a fresh task.

## Verify before release

```sh
npm run check
```

This runs the available plugin validator plus the unit, integration, and
security tests. The tests also reproduce the bundled runtime from the
checked-in upstream snapshot.

The normal build reads only the checked-in `vendor/atskills/` snapshot. The
only command allowed to fetch upstream is:

```sh
npm run refresh:upstream
```

## Maintenance and cachebuster updates

Keep `upstream.json`, `vendor/atskills.snapshot.json`, `vendor/atskills/`, the
generated runtime, and `THIRD_PARTY_NOTICES.md` synchronized. Do not update
the upstream SHA without a deliberate compatibility review.

After changing plugin files, refresh the local install cache:

```sh
python3 /path/to/plugin-creator/scripts/update_plugin_cachebuster.py \
  "$REPO_ROOT/plugins/atskills-codex"
python3 /path/to/plugin-creator/scripts/read_marketplace_name.py \
  --marketplace-path "$REPO_ROOT/.agents/plugins/marketplace.json"
codex plugin add atskills-codex@atskills-local
```

Do not hand-edit marketplace metadata during that update loop. This project
does not publish, commit, push, or alter Git remotes automatically.

## Troubleshooting

- `npm run check` fails during the offline build: restore the checked-in
  snapshot and run `npm run build`; do not run the refresh command unless the
  upstream revision is intentionally changing.
- The plugin validator is unavailable: install its documented Python
  dependencies or set `ATSKILLS_PLUGIN_VALIDATOR` and `ATSKILLS_PYTHON`; the
  repository-local quick validator still runs as part of `npm run check`.
- Hooks produce no context: verify the plugin is trusted through `/hooks`, the
  hook command uses `PLUGIN_ROOT`, and the prompt contains `@skills:` or
  `@workflow:`.
- A GitHub skill cannot resolve: check that Git is installed and that
  `GIT_TERMINAL_PROMPT=0` is compatible with the configured credentials. Bare
  skill IDs remain local-only; use `gh:owner/repo/path` for GitHub.
- A hostile or oversized skill is rejected: that is expected. Skills are
  untrusted metadata, are never executed by this plugin, and `SKILL.md` is
  capped at 256 KiB.

## Security boundary

Hooks inject only canonical metadata and absolute `SKILL.md` paths. They do
not inject skill bodies or execute files from a skill directory. Saved state is
kept under the workspace `.atskills/` directory, is ignored by Git, and is
bounded to 4 MiB and 64 files.
