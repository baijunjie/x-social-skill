#!/bin/sh
# Install the x-social skill into the current git project.
# Usage: install.sh <claude|codex> <check|write>
#   check  prints STATUS=new|same|differs (and the differing paths) without writing
#   write  copies the skill in, keeping an existing node_modules
set -eu

host=${1:-}
mode=${2:-}
case $host in
  claude) rel=.claude/skills/x-social ;;
  codex) rel=.agents/skills/x-social ;;
  *) echo "Usage: $0 <claude|codex> <check|write>" >&2; exit 2 ;;
esac

src=$(cd "$(dirname "$0")/template/x-social" && pwd)
top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not inside a git repository" >&2; exit 3; }
dst=$top/$rel

# tests/ and tsconfig.json are for developing the skill, not running it
render() {
  mkdir -p "$1"
  rsync -a --delete --exclude node_modules --exclude tests --exclude tsconfig.json \
    --exclude SKILL.template.md "$src/" "$1/"
  cp "$src/SKILL.template.md" "$1/SKILL.md"
}

if [ -L "$dst" ]; then
  echo "$dst is a symlink; refusing to write through it" >&2
  exit 4
fi

case $mode in
  check)
    echo "TARGET=$dst"
    if [ ! -e "$dst" ]; then
      echo "STATUS=new"
      exit 0
    fi
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    render "$tmp/x-social"
    if diff -rq -x node_modules "$tmp/x-social" "$dst" >"$tmp/diff"; then
      echo "STATUS=same"
    else
      echo "STATUS=differs"
      sed "s|$tmp/x-social|<template>|g; s|$dst|$rel|g" "$tmp/diff"
    fi
    ;;
  write)
    render "$dst"
    echo "Installed to $dst"
    ;;
  *)
    echo "Usage: $0 <claude|codex> <check|write>" >&2
    exit 2
    ;;
esac
