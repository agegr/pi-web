#!/usr/bin/env bash
# Regenerate the Pi Web TWA release keystore (mobile-twa/keystore/).
#
# The committed keystore is for this private, side-loaded app (see
# keystore/README.md). Regenerating is the per-machine path: after running
# this you MUST also regenerate public/.well-known/assetlinks.json
# (scripts/assetlinks.sh --keystore) and rebuild + reinstall the APK, or the
# browser verification fails (URL bar shows) because the served statement
# still names the old certificate.
#
# Env overrides:
#   PIWEB_KEYSTORE   output path   (default: keystore/piweb-twa-release.keystore)
#   PIWEB_ALIAS      key alias     (default: piweb-twa)
#   PIWEB_STOREPASS  store/key password (default: piweb-twa-release)
#   PIWEB_KEY_DN     distinguished name (default: CN=Pi Web TWA, OU=Pi Web, O=silgrid, C=CN)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
keystore="${PIWEB_KEYSTORE:-$here/../keystore/piweb-twa-release.keystore}"
alias="${PIWEB_ALIAS:-piweb-twa}"
storepass="${PIWEB_STOREPASS:-piweb-twa-release}"
dn="${PIWEB_KEY_DN:-CN=Pi Web TWA, OU=Pi Web, O=silgrid, C=CN}"

if [ -f "$keystore" ]; then
  echo "refusing to overwrite existing keystore: $keystore" >&2
  echo "delete it first if you really mean to replace it" >&2
  exit 1
fi

mkdir -p "$(dirname "$keystore")"
keytool -genkeypair -v \
  -keystore "$keystore" \
  -alias "$alias" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$storepass" -keypass "$storepass" \
  -dname "$dn"

echo
echo "keystore written: $keystore"
echo "next: regenerate the assetlinks statement so the served fingerprint matches:"
echo "  scripts/assetlinks.sh --keystore $keystore"
