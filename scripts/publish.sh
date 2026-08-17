#!/usr/bin/env bash
# One-command publish: create a public GitHub repository and push oh-my-dsh.
# Requires: gh CLI (https://cli.github.com/) authenticated via `gh auth login`.
# Usage:   ./scripts/publish.sh [repo-name]
#          (default repo name: oh-my-dsh)
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-oh-my-dsh}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install from https://cli.github.com/ then run: gh auth login" >&2
  exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not authenticated. Run: gh auth login" >&2
  exit 2
fi

if [[ ! -d .git ]]; then
  echo "No .git directory yet. Run: git init -b main" >&2
  exit 2
fi

echo "==> Creating public repo $NAME and pushing (use --private to change)"
gh repo create "$NAME" --public --source . --remote origin --push

OWNER="$(gh api user --jq .login)"
echo "==> Published: https://github.com/$OWNER/$NAME"