#!/usr/bin/env bash
# Promote main to production in one command (ADR 0022).
#
#   pnpm promote                # title derived from the commits being promoted
#   pnpm promote "Some title"   # explicit PR title
#
# What it does:
#   1. Confirms main's head carries green verify + smoke + lifecycle checks
#      from the push-to-main CI run — the only run against the combined
#      tree of every merged PR (promote PRs do not re-run CI).
#   2. Confirms staging, which auto-deploys main, answers /api/readyz.
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
CHECK_WAIT_SECONDS=600
DEPLOY_WAIT_SECONDS=480

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

# 1. Every CI check on main's head (from the push-to-main run).
say "waiting for main CI on ${main_sha:0:7}: ${REQUIRED_CHECKS[*]}"
deadline=$(( $(date +%s) + CHECK_WAIT_SECONDS ))
while :; do
  # Newest run per check name wins (a re-run supersedes a cancelled one).
  runs=$(gh api "repos/${repo}/commits/${main_sha}/check-runs?per_page=100" \
    --jq '[.check_runs[] | {name, conclusion}] | group_by(.name) | map(.[0]) | map("\(.name)=\(.conclusion // "pending")") | .[]')
  pending=0
  for name in "${REQUIRED_CHECKS[@]}"; do
    conclusion=$(printf '%s\n' "$runs" | awk -F= -v n="$name" '$1 == n { print $2 }')
    case "${conclusion:-pending}" in
      success) ;;
      failure|cancelled|timed_out|action_required) fail "main CI check '${name}' concluded '${conclusion}' — fix main before promoting" ;;
      *) pending=1 ;;
    esac
  done
  [ "$pending" -eq 0 ] && break
  [ "$(date +%s)" -lt "$deadline" ] || fail "main CI did not finish within ${CHECK_WAIT_SECONDS}s"
  sleep 15
done
say "main CI green (verify, smoke, lifecycle)"

# 2. Staging readiness.
if curl -fsS --max-time 20 "${STAGING_URL}/api/readyz" | jq -e '.ok == true' >/dev/null; then
  say "staging readyz ok"
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
say "waiting for Vercel production deployment of ${merge_sha:0:7}"
deadline=$(( $(date +%s) + DEPLOY_WAIT_SECONDS ))
while :; do
  state=$(gh api "repos/${repo}/deployments?sha=${merge_sha}" \
    --jq "[.[] | select(.environment | startswith(\"${PROD_ENV_PREFIX}\"))] | first | .id // empty" \
    | xargs -I{} gh api "repos/${repo}/deployments/{}/statuses" --jq 'first | .state // "pending"' 2>/dev/null || true)
  case "${state:-pending}" in
    success) break ;;
    failure|error) fail "Vercel production deployment ${state} — check the Vercel dashboard; production still serves the previous build" ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || fail "production deployment did not finish within ${DEPLOY_WAIT_SECONDS}s"
  sleep 15
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
