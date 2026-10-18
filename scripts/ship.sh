#!/usr/bin/env bash
# Ship a PR: wait for its checks, merge it the moment they are green, then
# promote main to production (ADR 0025).
#
#   pnpm ship            # the PR for the current branch
#   pnpm ship 123        # a specific PR
#
# Replaces "gh pr merge --auto" + "pnpm promote": GitHub's auto-merge takes
# a minute or more to notice green checks, and the promote step no longer
# waits for the push-to-main CI run, so the whole path is bounded by one PR
# CI run plus two Vercel builds. If main moved under the PR, the branch is
# updated first (branch protection requires it) and CI re-runs.
#
# Needs: gh (authenticated), jq, curl. Touches no local branches.
set -euo pipefail

CHECK_WAIT_SECONDS=900
say() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || fail 'gh is not installed'
command -v jq >/dev/null || fail 'jq is not installed'

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
pr="${1-}"
if [ -z "$pr" ]; then
  pr=$(gh pr view --json number --jq .number 2>/dev/null) || fail 'no PR for the current branch — pass a PR number'
fi

read -r state base title < <(gh pr view "$pr" --repo "$repo" --json state,baseRefName,title --jq '"\(.state) \(.baseRefName) \(.title)"')
[ "$state" = OPEN ] || fail "PR #${pr} is ${state}"
[ "$base" = main ] || fail "PR #${pr} targets ${base}, not main"
say "shipping #${pr}: ${title}"

# Bring the branch up to date if main moved; CI must run on the combined tree.
merge_state=$(gh pr view "$pr" --repo "$repo" --json mergeStateStatus --jq .mergeStateStatus)
if [ "$merge_state" = BEHIND ]; then
  say "branch is behind main — updating it (CI will re-run)"
  gh pr update-branch "$pr" --repo "$repo" >/dev/null
  sleep 5
elif [ "$merge_state" = DIRTY ]; then
  fail "PR #${pr} conflicts with main — resolve the conflict and push"
fi

say "waiting for checks on #${pr}"
deadline=$(( $(date +%s) + CHECK_WAIT_SECONDS ))
while :; do
  # Every required check must report success. `statusCheckRollup` lists
  # check runs (CI) and statuses (Vercel) together.
  rollup=$(gh pr view "$pr" --repo "$repo" --json statusCheckRollup \
    --jq '.statusCheckRollup[] | "\(.name // .context)=\(.conclusion // .state // "PENDING")"')
  bad=$(printf '%s\n' "$rollup" | grep -E '=(FAILURE|CANCELLED|TIMED_OUT|ACTION_REQUIRED|ERROR)$' || true)
  [ -z "$bad" ] || fail "check failed on #${pr}: ${bad}"
  missing=0
  for name in 'Typecheck · Lint · Test' 'E2E smoke' 'E2E lifecycle'; do
    printf '%s\n' "$rollup" | grep -qF "${name}=SUCCESS" || missing=1
  done
  [ "$missing" -eq 0 ] && break
  [ "$(date +%s)" -lt "$deadline" ] || fail "checks did not finish within ${CHECK_WAIT_SECONDS}s"
  sleep 10
done
say "checks green"

head_sha=$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)
gh pr merge "$pr" --repo "$repo" --squash >/dev/null || fail "merge failed — is the branch up to date with main?"
say "merged #${pr} (verified head ${head_sha:0:7})"

# Hand promote the head whose checks we just watched: the squash commit's
# tree is identical to it, and GitHub's commit→PR lookup lags after a merge.
PROMOTE_VERIFIED_SHA="$head_sha" exec "$(dirname "$0")/promote.sh" "$title"
