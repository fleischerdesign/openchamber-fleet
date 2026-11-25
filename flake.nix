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
          # The handshake fixture creates the installation identity in the state root.
          # The Nix sandbox has no writable HOME, so give the test phase its own.
          preCheck = ''
            export FLEET_AGENT_STATE_DIR=$(mktemp -d)
          '';
        };
      packageVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      extensionVersion =
        (builtins.fromJSON (builtins.readFile ./extensions/openchamber/package.json)).version;
      mkExtension =
        pkgs:
        pkgs.runCommand "openchamber-fleet-extension-${extensionVersion}" { } ''
          mkdir -p $out
          cp -R ${./extensions/openchamber}/. $out/
        '';
      mkController =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "openchamber-fleet";
          version = packageVersion;
          src = self;
          npmDepsHash = "sha256-NdQ29t0ShXXKlWphVt4nQpFc++uQMzUOKXKa8TVpwXk=";
          buildPhase = ''
            npm run build
          '';
          installPhase = ''
            mkdir -p $out/lib/node_modules/openchamber-fleet $out/bin
            cp -r package.json dist bin extensions docs README.md LICENSE $out/lib/node_modules/openchamber-fleet/
            cat > $out/bin/fleet <<EOF
            #!${pkgs.runtimeShell}
            export PATH=${pkgs.openssh}/bin:${pkgs.git}/bin:\$PATH
            exec ${pkgs.nodejs}/bin/node $out/lib/node_modules/openchamber-fleet/bin/fleet.js "\$@"
            EOF
            chmod +x $out/bin/fleet
          '';
        };
    in
    {
      packages = each (pkgs: {
        fleet-agent = mkAgent pkgs;
        controller = mkController pkgs;
        extension = mkExtension pkgs;
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
        extension = mkExtension pkgs;
        build-and-test = pkgs.buildNpmPackage {
          pname = "openchamber-fleet-checks";
          version = packageVersion;
          src = self;
          doCheck = true;
          npmDepsHash = "sha256-NdQ29t0ShXXKlWphVt4nQpFc++uQMzUOKXKa8TVpwXk=";
          nativeBuildInputs = with pkgs; [
            openssh
            git
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
