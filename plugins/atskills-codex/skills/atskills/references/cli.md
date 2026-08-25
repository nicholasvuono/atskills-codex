# AtSkills CLI

The script is `scripts/atskills.js` in this skill directory. It uses the
plugin's shared resolver and workspace state; it does not run files stored in
skills.

Commands:

```text
get <id>
save <id> [--force]
install <id>
uninstall <id>
remove <id> --yes
list
triggers
provenance <id>
```

Every command accepts `--cwd <absolute-path>` and `--json`. `get` prints a
skill body or collection menu. `save` creates a detached `.atskills/` copy;
`install` and `uninstall` edit `.atskills/.autotrigger`; `remove` deletes only
a saved copy. `list`, `triggers`, and `provenance` are local-only reads.

JSON mode emits exactly one object on stdout and sends diagnostics to stderr.
Successful objects have `ok: true` and a `command` field. Failures have
`ok: false`, `code`, and `error`. The resolver uses `INVALID_REF`, `NOT_FOUND`,
`NETWORK`, `CONFLICT`, and `TOO_LARGE`; removal without `--yes` returns
`CONFIRMATION_REQUIRED` without changing the workspace.
