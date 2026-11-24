{
  description = "openchamber-fleet — run work on a machine that has the cores";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      each = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      mkAgent =
        pkgs:
        pkgs.rustPlatform.buildRustPackage {
          pname = "fleet-agent";
          version = "0.1.0";
          src = ./agent;
          cargoLock.lockFile = ./agent/Cargo.lock;
        };
      mkController =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "openchamber-fleet";
          version = "0.2.0";
          src = self;
          npmDepsHash = "sha256-9FOy0zeJsIb+P4AkqzhCLLsMedVY/rkOIlMQmN+0uDA=";
          buildPhase = ''
            npm run build
          '';
          installPhase = ''
            mkdir -p $out/lib/node_modules/openchamber-fleet $out/bin
            cp -r package.json dist bin extensions docs README.md LICENSE $out/lib/node_modules/openchamber-fleet/
            ln -s $out/lib/node_modules/openchamber-fleet/bin/fleet.js $out/bin/fleet
          '';
        };
    in
    {
      packages = each (pkgs: {
        fleet-agent = mkAgent pkgs;
        controller = mkController pkgs;
        default = mkAgent pkgs;
      });

      devShells = each (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            typescript
            cargo
            rustc
            rustfmt
            gcc
            openssh
            git
            coreutils
          ];
        };
      });

      checks = each (pkgs: {
        agent = mkAgent pkgs;
        build-and-test = pkgs.buildNpmPackage {
          pname = "openchamber-fleet-checks";
          version = "0.2.0";
          src = self;
          doCheck = true;
          npmDepsHash = "sha256-9FOy0zeJsIb+P4AkqzhCLLsMedVY/rkOIlMQmN+0uDA=";
          nativeBuildInputs = with pkgs; [
            openssh
            bash
            coreutils
          ];
          checkPhase = ''
            FLEET_AGENT_BIN=${mkAgent pkgs}/bin/fleet-agent node --test 'test/**/*.test.js'
          '';
          installPhase = ''
            mkdir -p $out
          '';
        };
      });

      formatter = each (pkgs: pkgs.nixfmt);
    };
}
