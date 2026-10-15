#!/usr/bin/env bash
# Promote main to production in one command (ADR 0022).
#
#   pnpm promote                # title derived from the commits being promoted
#   pnpm promote "Some title"   # explicit PR title
#
# What it does:
#   1. Confirms main's head carries a green "Typecheck · Lint · Test" check
#      (from the push-to-main CI run — promote PRs do not re-run CI).
#   2. Confirms staging, which auto-deploys main, answers /api/readyz.
#   3. Opens main -> production and merges it with a merge commit.
#   4. Waits for Vercel's production deployment of that commit to succeed,
#      then checks production /api/healthz and /api/readyz.
#
# Needs: gh (authenticated), curl, jq. Touches no local branches.
set -euo pipefail

REQUIRED_CHECK='Typecheck · Lint · Test'
STAGING_URL='https://chauffeur-staging.vercel.app'
PROD_URL='https://chauffeur-prod.vercel.app'
PROD_ENV_PREFIX='Production – chauffeur-prod'
CHECK_WAIT_SECONDS=300
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

# 1. Required check on main's head.
say "waiting for '${REQUIRED_CHECK}' on ${main_sha:0:7}"
deadline=$(( $(date +%s) + CHECK_WAIT_SECONDS ))
while :; do
  conclusion=$(gh api "repos/${repo}/commits/${main_sha}/check-runs" \
    --jq "[.check_runs[] | select(.name == \"${REQUIRED_CHECK}\")] | map(.conclusion) | first // \"pending\"")
  case "$conclusion" in
    success) break ;;
    failure|cancelled|timed_out|action_required) fail "main CI concluded '${conclusion}' — fix main before promoting" ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || fail "main CI did not finish within ${CHECK_WAIT_SECONDS}s"
  sleep 10
done
say "main CI green"

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

pr_url=$(gh pr create --repo "$repo" --base production --head main --title "$title" --body "$body")
say "opened ${pr_url}"
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

health=$(curl -fsS --max-time 20 "${PROD_URL}/api/healthz") || fail 'production healthz failed'
ready=$(curl -fsS --max-time 30 "${PROD_URL}/api/readyz") || fail 'production readyz failed'
say "healthz ${health}"
say "readyz  ${ready}"
say "production is on ${merge_sha:0:7} (${pr_url})"
