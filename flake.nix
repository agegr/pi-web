{
  description = "Web UI for the pi coding agent";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
      pkgsFor = system: import nixpkgs { inherit system; };
      piWebFor = system:
        (pkgsFor system).callPackage ./package.nix { src = self; };
    in
    {
      packages = forAllSystems (system: rec {
        pi-web = piWebFor system;
        default = pi-web;
      });

      apps = forAllSystems (system: rec {
        pi-web = {
          type = "app";
          program = "${self.packages.${system}.pi-web}/bin/pi-web";
          meta = self.packages.${system}.pi-web.meta;
        };
        default = pi-web;
      });

      overlays.default = final: _: {
        pi-web = final.callPackage ./package.nix { src = self; };
      };

      devShells = forAllSystems (system: {
        default = (pkgsFor system).mkShell {
          packages = [
            (pkgsFor system).nodejs_24
          ];
          # next dev telemetry is sandbox-irrelevant here but quiet locally too.
          NEXT_TELEMETRY_DISABLED = "1";
        };
      });
    };
}