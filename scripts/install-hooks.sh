#!/bin/sh
# Optional, explicit opt-in: installs the authorization-validation pre-push hook.
# Nothing global is changed — only this repository's .git/hooks/pre-push.
set -eu

ROOT=$(git rev-parse --show-toplevel)
HOOKS="$ROOT/.git/hooks"
TARGET="$HOOKS/pre-push"
SOURCE="$ROOT/scripts/git-hooks/pre-push"

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if ! grep -q "npm run validate" "$TARGET" 2>/dev/null; then
    echo "aal hooks: a pre-push hook already exists at $TARGET — leaving it untouched." >&2
    echo "Append 'npm run validate' to it yourself, or move it and re-run this script." >&2
    exit 1
  fi
fi

mkdir -p "$HOOKS"
cp "$SOURCE" "$TARGET"
chmod +x "$TARGET"
echo "aal hooks: installed pre-push hook at $TARGET (runs 'npm run validate'; delete the file to remove)."
