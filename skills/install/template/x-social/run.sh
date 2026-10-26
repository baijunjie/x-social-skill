#!/bin/sh
# Run a script by name: echo '<json>' | ./run.sh post
# The skill is installed without node_modules, so dependencies are installed here on
# first run, and again whenever a reinstall brings a different package-lock.json. npm
# output goes to stderr to keep stdout a single JSON line.
set -e
dir=$(cd "$(dirname "$0")" && pwd)
if [ -z "$1" ] || [ ! -f "$dir/scripts/$1.ts" ]; then
  echo "Usage: $0 <script>  (scripts: $(cd "$dir/scripts" && ls *.ts | sed 's/\.ts$//' | tr '\n' ' '))" >&2
  exit 2
fi
stamp="$dir/node_modules/.x-social-lock.json"
if [ ! -x "$dir/node_modules/.bin/tsx" ] || ! cmp -s "$dir/package-lock.json" "$stamp"; then
  (cd "$dir" && npm ci --omit=dev --no-audit --no-fund >&2)
  cp "$dir/package-lock.json" "$stamp"
fi
# Start tsx through node rather than its #!/usr/bin/env node shim: under launchd, macOS
# refuses (EPERM) node scripts on an external volume that are executed via the shebang.
exec node "$dir/node_modules/tsx/dist/cli.mjs" "$dir/scripts/$1.ts"
