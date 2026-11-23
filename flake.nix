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
    in
    {
      packages = each (pkgs: {
        fleet-agent = mkAgent pkgs;
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
          version = "0.1.0";
          src = self;
          npmDepsHash = "sha256-2thyxRbFnCXNapQQoVslurjy3bF2o3mTd5LYk8NsxCA=";
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
