#!/usr/bin/env bash
# Promote main to production in one command (ADR 0022).
#
#   pnpm promote                # title derived from the commits being promoted
#   pnpm promote "Some title"   # explicit PR title
#
# What it does:
#   1. Confirms verify + smoke + lifecycle are green for main's tree: on
#      main's head, or on the PR head it was squash-merged from when the two
#      trees are identical (they are, under strict up-to-date — ADR 0025).
#   2. Waits for the staging deployment of main's head, then /api/readyz.
#   3. Opens main -> production and merges it with a merge commit.
#   4. Waits for Vercel's production deployment of that commit to succeed,
#      then checks production /api/healthz and /api/readyz. On a failed
#      check it prints the exact rollback command for the previous build.
#
# Needs: gh (authenticated), curl, jq. Touches no local branches.
set -euo pipefail

REQUIRED_CHECKS=('Typecheck · Lint · Test' 'E2E smoke' 'E2E lifecycle')
STAGING_URL='https://chauffeur-staging.vercel.app'
PROD_URL='https://chauffeur-prod.vercel.app'
PROD_ENV_PREFIX='Production – chauffeur-prod'
STAGING_ENV_PREFIX='Production – chauffeur-staging'
CHECK_WAIT_SECONDS=600
DEPLOY_WAIT_SECONDS=480
DEPLOY_TRIGGER_AFTER_SECONDS=75

say() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || fail 'gh is not installed'
command -v jq >/dev/null || fail 'jq is not installed'

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
git fetch -q origin main production
main_sha=$(git rev-parse origin/main)
prod_sha=$(git rev-parse origin/production)
ahead=$(git rev-list --count "origin/production..origin/main")

if [ "$ahead" -eq 0 ]; then
  say "production already contains main (${main_sha:0:7}); nothing to promote"
  exit 0
fi
say "promoting ${ahead} commit(s): ${prod_sha:0:7}..${main_sha:0:7}"
git log --oneline "origin/production..origin/main" | sed 's/^/    /'

# 1. Every required check must be green for main's *tree*.
#
# Branch protection requires PRs to be up to date with main (ADR 0024), so
# a squash-merged PR produces a main commit whose tree is byte-identical to
# the PR head that CI already verified. Waiting for the push-to-main run to
# repeat that verification cost ~3.5 min per promote (ADR 0025). So: accept
# the checks on main's head itself, or on any PR head whose tree equals
# main's tree. Any other main commit (a direct push, a non-squash merge)
# still has to wait for its own run.
checks_state() { # <sha> -> prints "success" | "pending" | "failed <name> <conclusion>"
  local runs
  runs=$(gh api "repos/${repo}/commits/$1/check-runs?per_page=100" \
    --jq '[.check_runs[] | {name, conclusion}] | group_by(.name) | map(.[0]) | map("\(.name)=\(.conclusion // "pending")") | .[]')
  local name conclusion pending=0
  for name in "${REQUIRED_CHECKS[@]}"; do
    conclusion=$(printf '%s\n' "$runs" | awk -F= -v n="$name" '$1 == n { print $2 }')
    case "${conclusion:-pending}" in
      success) ;;
      failure|cancelled|timed_out|action_required) printf 'failed %s %s\n' "$name" "$conclusion"; return ;;
      *) pending=1 ;;
    esac
  done
  [ "$pending" -eq 0 ] && printf 'success\n' || printf 'pending\n'
}

tree_of() { gh api "repos/${repo}/git/commits/$1" --jq .tree.sha; }

# Candidate commits whose checks count: main's head, then the heads of the
# PRs that produced it, provided their tree matches main's tree.
main_tree=$(tree_of "$main_sha")
candidates=("$main_sha")
# ship.sh passes the PR head it just merged: GitHub's commit→PR association
# can lag a minute or more right after the merge, which made the lookup
# below miss and the promote wait for the push-to-main run anyway.
if [ -n "${PROMOTE_VERIFIED_SHA-}" ] && [ "$(tree_of "$PROMOTE_VERIFIED_SHA")" = "$main_tree" ]; then
  candidates+=("$PROMOTE_VERIFIED_SHA")
  say "main's tree equals verified head ${PROMOTE_VERIFIED_SHA:0:7}; its checks count"
fi
while read -r pr_number pr_head; do
  [ -n "$pr_head" ] || continue
  if [ "$(tree_of "$pr_head")" = "$main_tree" ]; then
    candidates+=("$pr_head")
    say "main's tree equals PR #${pr_number} head ${pr_head:0:7}; its checks count"
  fi
done < <(gh api "repos/${repo}/commits/${main_sha}/pulls" --jq '.[] | "\(.number) \(.head.sha)"' 2>/dev/null || true)

say "waiting for CI on ${main_sha:0:7}: ${REQUIRED_CHECKS[*]}"
deadline=$(( $(date +%s) + CHECK_WAIT_SECONDS ))
while :; do
  verified=''
  for sha in "${candidates[@]}"; do
    state=$(checks_state "$sha")
    case "$state" in
      success) verified="$sha"; break ;;
      failed*) read -r _ name conclusion <<<"$state"; fail "CI check '${name}' concluded '${conclusion}' on ${sha:0:7} — fix main before promoting" ;;
    esac
  done
  [ -n "$verified" ] && break
  [ "$(date +%s)" -lt "$deadline" ] || fail "CI did not finish within ${CHECK_WAIT_SECONDS}s"
  sleep 10
done
say "CI green on ${verified:0:7} (verify, smoke, lifecycle)"

# 2. Staging readiness — of *this* commit. Vercel builds staging on every push
# to main and applies migrations during that build, so this is the one place
# a migration is exercised against real Postgres before production sees it.
deployment_state() { # <sha> <env prefix> -> success | failure | error | pending
  gh api "repos/${repo}/deployments?sha=$1" \
    --jq "[.[] | select(.environment | startswith(\"$2\"))] | first | .id // empty" \
    | xargs -I{} gh api "repos/${repo}/deployments/{}/statuses" --jq 'first | .state // "pending"' 2>/dev/null || true
}
say "waiting for Vercel staging deployment of ${main_sha:0:7}"
deadline=$(( $(date +%s) + DEPLOY_WAIT_SECONDS ))
while :; do
  state=$(deployment_state "$main_sha" "$STAGING_ENV_PREFIX")
  case "${state:-pending}" in
    success) break ;;
    failure|error) fail "Vercel staging deployment ${state} — fix main before promoting" ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || fail "staging deployment did not finish within ${DEPLOY_WAIT_SECONDS}s"
  sleep 10
done
if curl -fsS --max-time 20 "${STAGING_URL}/api/readyz" | jq -e '.ok == true' >/dev/null; then
  say "staging deployed + readyz ok"
else
  fail "staging readyz is not ok — look at ${STAGING_URL} before promoting"
fi

# 3. Open and merge the promote PR.
if [ "${1-}" != "" ]; then
  title="Promote to production: $1"
else
  subjects=$(git log --format='%s' "origin/production..origin/main" \
    | sed -E 's/^[a-z]+(\([^)]*\))?: //' | head -3 | paste -sd ';' - | sed 's/;/; /g')
  title="Promote to production: ${subjects}"
fi
body=$(printf 'Promotes main (%s) to production.\n\n%s\n\nCI for these commits ran on their PRs and on the push to main; promote PRs reuse that check (ADR 0022).' \
  "${main_sha:0:7}" "$(git log --format='- %s' "origin/production..origin/main")")

# Another session (or an earlier aborted run) may already have the PR open;
# GitHub allows one open PR per head/base pair, so reuse it.
pr_url=$(gh pr list --repo "$repo" --base production --head main --state open --json url --jq 'first | .url // empty')
if [ -n "$pr_url" ]; then
  say "reusing open promote PR ${pr_url}"
else
  pr_url=$(gh pr create --repo "$repo" --base production --head main --title "$title" --body "$body")
  say "opened ${pr_url}"
fi
gh pr merge "$pr_url" --repo "$repo" --merge >/dev/null
say "merged"
merge_sha=$(git fetch -q origin production && git rev-parse origin/production)

# 4. Wait for the production deployment of the merge commit.
#
# Vercel occasionally never receives the push webhook (2026-10-18: the
# production branch moved, no deployment was ever created, production kept
# serving the previous build). If nothing has appeared after
# DEPLOY_TRIGGER_AFTER_SECONDS, fire the production Deploy Hook once — it
# builds the branch head, which is exactly this merge commit. The hook URL
# is a secret: read from the environment or the gitignored .env.
say "waiting for Vercel production deployment of ${merge_sha:0:7}"
deadline=$(( $(date +%s) + DEPLOY_WAIT_SECONDS ))
trigger_at=$(( $(date +%s) + DEPLOY_TRIGGER_AFTER_SECONDS ))
triggered=0
while :; do
  state=$(deployment_state "$merge_sha" "$PROD_ENV_PREFIX")
  case "${state:-pending}" in
    success) break ;;
    failure|error) fail "Vercel production deployment ${state} — check the Vercel dashboard; production still serves the previous build" ;;
  esac
  if [ -z "$state" ] && [ "$triggered" -eq 0 ] && [ "$(date +%s)" -ge "$trigger_at" ]; then
    triggered=1
    hook="${VERCEL_PROD_DEPLOY_HOOK_URL:-$(grep -s '^VERCEL_PROD_DEPLOY_HOOK_URL=' "$(git rev-parse --show-toplevel)/.env" | cut -d= -f2- | tr -d '"')}"
    if [ -n "$hook" ]; then
      say "no deployment after ${DEPLOY_TRIGGER_AFTER_SECONDS}s — Vercel missed the push; firing the production deploy hook"
      curl -fsS --max-time 20 -X POST "$hook" >/dev/null || say "deploy hook call failed; will keep waiting"
    else
      say "no deployment after ${DEPLOY_TRIGGER_AFTER_SECONDS}s and no VERCEL_PROD_DEPLOY_HOOK_URL set — trigger it from the Vercel dashboard (Deployments → Redeploy on branch production)"
    fi
  fi
  [ "$(date +%s)" -lt "$deadline" ] || fail "production deployment did not finish within ${DEPLOY_WAIT_SECONDS}s"
  sleep 10
done
say "deployed"

rollback_hint() {
  printf '  Roll back: open https://vercel.com/yousufs-projects-f64707ce/chauffeur-prod and promote the previous Ready deployment\n' >&2
  printf '  (or: cd a scratch dir, `vercel link --project chauffeur-prod`, `vercel rollback`). Production previously served %s.\n' "${prod_sha:0:7}" >&2
}
health=$(curl -fsS --max-time 20 "${PROD_URL}/api/healthz") || { rollback_hint; fail 'production healthz failed'; }
ready=$(curl -fsS --max-time 30 "${PROD_URL}/api/readyz") || { rollback_hint; fail 'production readyz failed'; }
printf '%s' "$ready" | jq -e '.ok == true' >/dev/null || { rollback_hint; fail "production readyz not ok: ${ready}"; }
say "healthz ${health}"
say "readyz  ${ready}"

# Lead time for the oldest commit in this promotion (commit -> production).
oldest_ts=$(git log --format='%ct' --reverse "${prod_sha}..${main_sha}" | head -1)
say "lead time: $(( ($(date +%s) - oldest_ts) / 60 )) min from oldest commit to production"
say "production is on ${merge_sha:0:7} (${pr_url})"
