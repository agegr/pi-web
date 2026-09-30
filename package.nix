{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
  # Source override: the flake passes `self` (the flake source tree). Set to a
  # fetchFromGitHub result to build a pinned upstream release instead.
  src ? lib.cleanSource ./.,
}:

buildNpmPackage rec {
  pname = "pi-web";
  version = (lib.importJSON ./package.json).version;

  inherit src;

  npmDepsHash = "sha256-mC/oqF64y86ppThFI7IOpVw8GmuAWrDfNOOIuV7A+hk=";
  npmDepsFetcherVersion = 2;

  nodejs = nodejs_24;

  env.NEXT_TELEMETRY_DISABLED = "1";

  # app/layout.tsx pulls Noto Sans Mono from Google Fonts at build time, which
  # fails in the sandbox. The stylesheet already falls back through
  # 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace, monospace, so drop
  # the remote font and emit the CSS variable as an empty default instead.
  postPatch = ''
    substituteInPlace app/layout.tsx \
      --replace-fail 'import { Noto_Sans_Mono } from "next/font/google";' "" \
      --replace-fail 'const notoSansMono = Noto_Sans_Mono({' 'const notoSansMono = ((_: unknown) => ({ variable: "" }))({'
  '';

  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    appDir="$out/lib/pi-web"
    mkdir -p "$appDir" "$out/bin"

    cp -r . "$appDir/"
    rm -rf "$appDir/.next/cache" "$appDir/.next/dev"

    makeWrapper ${lib.getExe nodejs} "$out/bin/pi-web" \
      --add-flags "$appDir/bin/pi-web.js"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Web UI for the pi coding agent";
    homepage = "https://github.com/dreadster3/pi-web";
    license = licenses.mit;
    mainProgram = "pi-web";
    platforms = platforms.linux ++ platforms.darwin;
  };
}
