#!/usr/bin/env bash
# Create an isolated worktree for one session (CLAUDE.md §7, ADR 0024).
#
#   pnpm worktree:new <slug> [type]     # type defaults to feat
#   e.g. pnpm worktree:new driver-notes fix
#
# Fetches origin, branches <type>/<slug> off the freshest origin/main into
# ../<repo>-<slug>, installs deps from the shared pnpm store, copies .env and
# points APP_URL at a free dev port so `next dev -p <port>` and the lifecycle
# E2E agree with each other. Prints the commands to run next.
set -euo pipefail

slug="${1-}"
type="${2:-feat}"
[ -n "$slug" ] || { echo "usage: $0 <slug> [feat|fix|chore|docs|ci|refactor]" >&2; exit 1; }
[[ "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "slug must be lowercase letters, digits and dashes" >&2; exit 1; }
[[ "$type" =~ ^(feat|fix|chore|docs|ci|refactor|test|perf)$ ]] || { echo "unknown type: $type" >&2; exit 1; }

# The primary checkout, even when this runs from inside another worktree:
# --git-common-dir resolves to the shared .git directory.
root=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
repo_name=$(basename "$root")
target="$(dirname "$root")/${repo_name}-${slug}"
branch="${type}/${slug}"

[ ! -e "$target" ] || { echo "✗ $target already exists" >&2; exit 1; }
if git -C "$root" show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "✗ local branch ${branch} already exists — pick another slug or delete it" >&2; exit 1
fi

echo "→ fetching origin"
git -C "$root" fetch -q origin

echo "→ creating ${target} on ${branch} from origin/main ($(git -C "$root" rev-parse --short origin/main))"
git -C "$root" worktree add -q "$target" -b "$branch" origin/main

echo "→ installing dependencies"
(cd "$target" && pnpm install --prefer-offline --silent)

port=3100
while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done

if [ -f "$root/.env" ]; then
  echo "→ copying .env with APP_URL=http://localhost:${port}"
  # Rewrite APP_URL in the copy only; the primary checkout's .env is untouched.
  sed -E "s#^APP_URL=.*#APP_URL=http://localhost:${port}#" "$root/.env" > "$target/.env"
else
  echo "! no .env in ${root}; copy one into ${target} before running the app"
fi

cat <<MSG

✓ worktree ready

  cd ${target}
  pnpm exec next dev -p ${port}              # dev server on a free port
  E2E_BASE_URL=http://localhost:${port} pnpm test:e2e:lifecycle

When the PR is merged (the remote branch is deleted automatically):
  git -C ${root} worktree remove ${target}
MSG
