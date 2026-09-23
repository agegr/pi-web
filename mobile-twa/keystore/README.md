# Release keystore

`piweb-twa-release.keystore` — the signing key for the side-loaded TWA APK.

This is a **private-repo, side-loaded app**, so the keystore is committed
(pi#40 decision): anyone with repo access can build a release APK that
verifies against the committed `public/.well-known/assetlinks.json`.

- alias: `piweb-twa`
- store/key password: `piweb-twa-release` (documented here on purpose — this
  is not a secret worth protecting on its own; the repo itself is the gate)
- subject: `CN=Pi Web TWA, OU=Pi Web, O=silgrid, C=CN`

## Regenerating per machine

If you want your own key (e.g. a personal fork):

```bash
scripts/make-release-keystore.sh          # refuses to overwrite; delete the old file first
scripts/assetlinks.sh --keystore          # regenerate the served statement
git add keystore/ ../../public/.well-known/assetlinks.json
./gradlew assembleRelease                 # rebuild + reinstall the APK
```

Both steps are required together: a regenerated keystore changes the
certificate fingerprint, and until `assetlinks.json` on the site matches it,
the browser shows the address bar instead of verifying the TWA.
