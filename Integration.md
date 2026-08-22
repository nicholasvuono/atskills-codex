# Install AtSkills for Codex

This guide is for users installing `atskills-codex` from GitHub. You do not
need to clone the repository, run `npm install`, or build the plugin yourself.

## Requirements

- Codex CLI installed and available as `codex`.
- Node.js 20 or newer:

  ```sh
  node --version
  ```

- Git installed and available as `git` if you will load GitHub-hosted skills:

  ```sh
  git --version
  ```

- Network access to GitHub for the initial marketplace install and GitHub
  skill resolution.

## Install from GitHub

Run these commands in a terminal:

```sh
codex plugin marketplace add nicholasvuono/atskills-codex --ref main
codex plugin marketplace list
codex plugin add atskills-codex@atskills-local
codex plugin list
```

The marketplace name is `atskills-local` and the plugin name is
`atskills-codex`. `codex plugin marketplace list` should show the GitHub-backed
marketplace snapshot. `codex plugin list` should show the plugin as
`installed, enabled`.

Codex downloads the repository marketplace and installs the plugin into its
local plugin cache. The installed plugin is self-contained; no project
dependencies or runtime installation step are required.

For a reproducible installation from a specific commit, replace `main` with a
commit SHA or another Git ref:

```sh
codex plugin marketplace add nicholasvuono/atskills-codex \
  --ref 9c20d4f97960e1accde174119aba473d7430098a
```

The `--ref` option is supported by the Codex marketplace CLI for Git-backed
marketplaces. See the [official OpenAI plugin packaging documentation](https://developers.openai.com/plugins/build/plugins).

## Trust the hooks and start a task

Restart Codex or start a new task after installation. In the new task:

1. Open `/hooks`.
2. Review the `atskills-codex` hooks.
3. Trust the hooks only if the marketplace and plugin source are the expected
   GitHub repository.
4. Start a fresh task after changing the trust decision.

The plugin uses `UserPromptSubmit` to resolve `@skills:` references and
`SessionStart` to restore saved local metadata.

## Verify the installation

In a fresh task, ask Codex:

```text
Use $atskills to list the available skills in this workspace.
```

To test a GitHub-hosted skill reference without executing files from it, use a
public fixture:

```text
Process @skills:gh:SylphAI-Inc/atskills/examples/simple-tdd.
Do not execute files from the resolved skill; report only whether it resolved.
```

GitHub references use this form:

```text
@skills:gh:OWNER/REPOSITORY/PATH
```

The hook should provide an absolute `SKILL.md` path and trust instructions.
Skill bodies are not injected into hook context, and skill-provided scripts are
not executed by this plugin.

Workspace state is kept in the workspace where Codex is running:

```text
.atskills/
```

It is separate from the installed plugin and is ignored by Git.

## Update the installation

To fetch the latest `main` marketplace snapshot and reinstall the plugin:

```sh
codex plugin marketplace upgrade atskills-local
codex plugin add atskills-codex@atskills-local
```

Start a new task after updating. To change to a different ref, remove the
configured marketplace and add it again with the new ref:

```sh
codex plugin marketplace remove atskills-local
codex plugin marketplace add nicholasvuono/atskills-codex --ref <ref>
codex plugin add atskills-codex@atskills-local
```

## Remove the plugin

To remove the installed plugin and its marketplace registration:

```sh
codex plugin remove atskills-codex@atskills-local
codex plugin marketplace remove atskills-local
```

This removes the plugin installation from Codex. It does not delete
workspace-local `.atskills/` data; remove that directory separately only if you
also want to delete saved skills and triggers from a workspace.

## Troubleshooting

- **Marketplace already exists:** run `codex plugin marketplace list`, remove
  only the stale `atskills-local` registration, and repeat the GitHub install.
- **Plugin is not listed:** confirm the marketplace root is GitHub-backed and
  run `codex plugin add atskills-codex@atskills-local` again.
- **Hooks produce no context:** start a new task, review `/hooks`, trust the
  plugin hooks, and make sure the prompt contains `@skills:`.
- **A GitHub skill cannot resolve:** check `git --version`, network access,
  repository/path spelling, and existing Git credentials. Noninteractive Git
  access uses `GIT_TERMINAL_PROMPT=0`.
- **Node runtime error:** install Node.js 20 or newer and retry the task.
