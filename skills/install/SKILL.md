---
name: install
description: Install (or update) the x-social skill into the current project, so only agents working in this project can post, reply, search and manage tweets on X. Use for "install x-social", "add the X skill to this project", "update x-social in this project".
disable-model-invocation: true
---

# Install x-social into this project

The plugin itself only carries this installer, so X automation is invisible to agents in projects it has not been installed into. This copies the `x-social` skill into the current git project, to be committed with it.

| Host | Installs to |
|------|-------------|
| Claude Code | `.claude/skills/x-social/` |
| Codex | `.agents/skills/x-social/` |

Install for the host you are running in. Install for both only when the user asks for both.

## Locate the installer

Use `$PLUGIN_ROOT`, then `$CLAUDE_PLUGIN_ROOT`; when both are empty, set `SKILL_DIR` to the absolute parent directory of **this loaded `SKILL.md`** (not the project working directory). Define the variable in the same shell call as the commands that use it:

```bash
if [ -n "${PLUGIN_ROOT:-}" ]; then ROOT="$PLUGIN_ROOT"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then ROOT="$CLAUDE_PLUGIN_ROOT"
else ROOT="${SKILL_DIR:?set SKILL_DIR to the parent directory of this SKILL.md}/../.."
fi
INSTALL="$ROOT/skills/install/install.sh"
```

## Steps

1. **Check** (read only), with `<host>` being `claude` or `codex`:

   ```bash
   "$INSTALL" <host> check
   ```

   - Exit 3 (not in a git repository): stop and tell the user; the skill and its accounts belong to a project.
   - Exit 4 (target is a symlink): stop and ask the user how to proceed; do not write through it.
   - `STATUS=same`: report that it is already up to date and stop.
   - `STATUS=differs`: this is a reinstall. The listed paths are what it will overwrite or delete (`node_modules/` is kept). There is no version record, so any of them may be a hand edit — show the list and **ask the user** before writing.
   - `STATUS=new`: go on.
2. **Write**:

   ```bash
   "$INSTALL" <host> write
   ```

3. **Tell the user**:
   - Commit the installed directory so the project keeps it; a project whose `.gitignore` ignores `.claude/` or `.agents/` as a whole needs an exception for it. Its own `.gitignore` keeps `node_modules/` out.
   - Restart Claude Code / start a new Codex session for the skill to load.
   - Next, each account has to log in once: ask the agent to set up X, which runs the skill's setup. Accounts are kept in `.x-social/` at the project root, ignored by git, so teammates log in with their own.
   - After the plugin is updated, run this installer again in each project to bring its copy up to date.
