#!/usr/bin/env bash
#
# Idempotently configures GitHub Rulesets on this repo to enforce the branch
# model documented in CONTRIBUTING.md:
#
#   - develop: PR with 1 approval required, status checks (PR Validate) must
#     pass, no force-push, no deletion. Admins bypass for emergencies.
#   - master:  push restricted to admins (PR required + admin bypass). Used
#     only for maintainer-driven `git merge --no-ff develop` cuts.
#   - v* tags: creation/update/deletion restricted to admins so only
#     maintainers can cut release tags.
#
# Re-running this script is safe — it deletes existing rulesets with the
# names below before recreating them, so changes here propagate cleanly.
#
# Requires: gh CLI authenticated as a repo admin.

set -euo pipefail

REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Configuring branch protection on $REPO_SLUG"

# RepositoryRole IDs (GitHub built-ins): 1=read, 2=triage, 3=write,
# 4=maintain, 5=admin. We bypass with 5 so emergency hotfixes by admins
# aren't blocked.
ADMIN_ROLE_ID=5

# ---------------------------------------------------------------------------
# Helper: delete a ruleset by name (no-op if it doesn't exist).
# ---------------------------------------------------------------------------
delete_ruleset_if_exists() {
  local name="$1"
  local id
  id=$(gh api "repos/$REPO_SLUG/rulesets" --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)
  if [ -n "$id" ]; then
    echo "  Deleting existing ruleset '$name' (id=$id)"
    gh api -X DELETE "repos/$REPO_SLUG/rulesets/$id" >/dev/null
  fi
}

# ---------------------------------------------------------------------------
# Helper: POST a JSON body (passed on stdin) to create a ruleset.
# ---------------------------------------------------------------------------
create_ruleset() {
  local name="$1"
  gh api -X POST "repos/$REPO_SLUG/rulesets" \
    -H "Accept: application/vnd.github+json" \
    --input - \
    --jq '"  Created '"$name"' (id=" + (.id | tostring) + ")"'
}

# ===========================================================================
# 1. develop — PR + 1 approval + required status checks + anti-force-push
# ===========================================================================

echo
echo "==> Ruleset 1/3: develop"
delete_ruleset_if_exists "develop protection"

create_ruleset "develop protection" <<EOF
{
  "name": "develop protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": $ADMIN_ROLE_ID, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/heads/develop"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "required_status_checks": [
          { "context": "Lint" },
          { "context": "Test" }
        ],
        "strict_required_status_checks_policy": false
      }
    }
  ]
}
EOF

# ===========================================================================
# 2. master — restrict to admins (PR required, admins bypass)
# ===========================================================================
#
# This is the "only maintainers push here" lever. Non-admins literally can't
# push at all because they can't satisfy the PR-with-approval rule on a
# branch nobody else will approve their PRs into. Admins use the bypass to
# do the `git merge --no-ff develop` per CONTRIBUTING.md.

echo
echo "==> Ruleset 2/3: master"
delete_ruleset_if_exists "master protection"

create_ruleset "master protection" <<EOF
{
  "name": "master protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": $ADMIN_ROLE_ID, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/heads/master"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ]
}
EOF

# ===========================================================================
# 3. v* tags — only admins can cut release tags
# ===========================================================================

echo
echo "==> Ruleset 3/3: v* release tags"
delete_ruleset_if_exists "release tag protection"

create_ruleset "release tag protection" <<EOF
{
  "name": "release tag protection",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": $ADMIN_ROLE_ID, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "rules": [
    { "type": "creation" },
    { "type": "update" },
    { "type": "deletion" }
  ]
}
EOF

echo
echo "=========================================================="
echo "Branch protection configured."
echo
echo "Verify in the GitHub UI:"
echo "  https://github.com/$REPO_SLUG/rules"
echo
echo "Listed status check contexts ('Lint', 'Test') won't appear in the UI"
echo "dropdown until the 'PR Validate' workflow has run at least once. The"
echo "API-side rule is already enforced — just open any PR to develop and"
echo "the checks will populate."
echo "=========================================================="
