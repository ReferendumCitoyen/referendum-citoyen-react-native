#!/usr/bin/env bash
# Wrapper around `eas build` that logs build context to a local (gitignored)
# audit file before forwarding to EAS. Use instead of `eas build`:
#
#   npm run eas-build -- --profile=production --platform=ios --clear-cache
#
# Or directly:
#
#   ./scripts/eas-build.sh --profile=production --platform=ios --clear-cache

set -e

LOG_FILE="eas-builds.local.log"

ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
short_sha="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
full_sha="$(git rev-parse HEAD 2>/dev/null || echo '?')"
subject="$(git log -1 --pretty=%s 2>/dev/null || echo '?')"
remote_state="$(git rev-list --left-right --count "@{u}...HEAD" 2>/dev/null \
                | awk '{print "behind="$1" ahead="$2}' || echo 'no-upstream')"

# Working tree status — clean or "N modified, M untracked"
status_short="$(git status --porcelain 2>/dev/null || true)"
if [ -z "$status_short" ]; then
  tree_state="clean"
  dirty_files=""
else
  modified=$(echo "$status_short" | grep -c '^.M\|^M' || true)
  untracked=$(echo "$status_short" | grep -c '^??' || true)
  tree_state="dirty (${modified} modified, ${untracked} untracked)"
  # Cap the file list to keep the log scannable
  dirty_files="$(echo "$status_short" | head -20)"
fi

# App version from app.config.ts (best-effort grep). Use [[:space:]] not \s
# for BSD sed (macOS) compatibility.
app_version="$(grep -E "^[[:space:]]+version:[[:space:]]+'" app.config.ts 2>/dev/null \
               | head -1 | sed -E "s/.*version:[[:space:]]+'([^']+)'.*/\1/" || echo '?')"

# Append the log entry
{
  echo "=== ${ts} ==="
  echo "branch:    ${branch}"
  echo "commit:    ${short_sha}  (${full_sha})"
  echo "subject:   ${subject}"
  echo "remote:    ${remote_state}"
  echo "tree:      ${tree_state}"
  echo "app vers:  ${app_version}"
  echo "command:   eas build $*"
  if [ -n "$dirty_files" ]; then
    echo "dirty files:"
    echo "${dirty_files}" | sed 's/^/  /'
  fi
  echo ""
} >> "$LOG_FILE"

echo ""
echo "📝  Logged build context to ${LOG_FILE}:"
echo "    branch=${branch} commit=${short_sha} tree=${tree_state}"
echo ""

# Forward all args to the real eas build
exec eas build "$@"
