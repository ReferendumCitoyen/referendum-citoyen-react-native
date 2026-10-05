#!/usr/bin/env bash
# Wrapper around `eas submit`. Use instead of `eas submit`:
#
#   ./scripts/eas-submit.sh --platform=ios
#
# One repository per app (team decision, 2026-09-14/16): every submit profile in a
# checkout's eas.json points at that checkout's own App Store Connect record
# (the store app's here, the beta's in the beta repository), and app.config.ts
# resolves the EAS project from the origin the same way, so the builds offered
# are this checkout's own. Apple then refuses any binary whose bundle id does
# not match the record, which is the last line. All that is left to refuse
# here is a checkout we cannot place at all; without --profile, `production`
# is used.

set -e

origin_url="$(git remote get-url origin 2>/dev/null || echo '')"
case "$origin_url" in
  *referendum-citoyen-react-native*) repo_app="store" ;;
  *referendum-citoyen-beta*)         repo_app="beta" ;;
  *)
    echo "✗  Unknown checkout (origin: ${origin_url}) — cannot tell which app this submits." >&2
    exit 1 ;;
esac

# The App Store Connect record is not written into eas.json: the four values
# below identify the association's account, so they stay out of the published
# tree and eas-cli substitutes them from the environment. Checked here rather
# than left to eas-cli, whose failure on an unsubstituted "$RC_ASC_APP_ID" is
# an opaque Apple error minutes into an upload.
missing=""
for var in RC_ASC_APP_ID RC_ASC_API_KEY_PATH RC_ASC_API_KEY_ID RC_ASC_API_KEY_ISSUER_ID; do
  eval "value=\${$var:-}"
  [ -n "$value" ] || missing="${missing} ${var}"
done
if [ -n "$missing" ]; then
  echo "✗  App Store Connect submission is not configured. Unset:${missing}" >&2
  echo "   Set them in your shell from the private checkout, then retry:" >&2
  echo "     RC_ASC_APP_ID             the numeric App Store Connect app id" >&2
  echo "     RC_ASC_API_KEY_PATH       path to the Team key .p8, e.g. ./secrets/AuthKey_XXXXXXXXXX.p8" >&2
  echo "     RC_ASC_API_KEY_ID         the key id" >&2
  echo "     RC_ASC_API_KEY_ISSUER_ID  the issuer id" >&2
  exit 1
fi

if [ ! -f "$RC_ASC_API_KEY_PATH" ]; then
  echo "✗  RC_ASC_API_KEY_PATH points at ${RC_ASC_API_KEY_PATH}, which does not exist." >&2
  echo "   The .p8 is never committed: ./secrets is gitignored." >&2
  exit 1
fi

asked="$(printf ' %s ' "$*" | sed -nE 's/.* (--profile[= ]|-e )([^ ]+) .*/\2/p')"
profile="${asked:-production}"

echo "🏷   ${repo_app} app, submit profile ${profile}, from the ${repo_app} checkout"
echo ""
if [ -n "$asked" ]; then
  exec eas submit "$@"
else
  exec eas submit --profile "$profile" "$@"
fi
