{
  description = "openchamber-fleet — replicate a workspace to a node and run one command there";

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
    in
    {
      devShells = each (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            typescript
            rsync
            openssh
            git
            coreutils
          ];
        };
      });

      checks = each (pkgs: {
        build-and-test = pkgs.buildNpmPackage {
          pname = "openchamber-fleet-checks";
          version = "0.1.0";
          src = self;
          npmDepsHash = "sha256-2thyxRbFnCXNapQQoVslurjy3bF2o3mTd5LYk8NsxCA=";
          nativeBuildInputs = with pkgs; [
            rsync
            openssh
            bash
            coreutils
          ];
          checkPhase = ''
            node --test 'test/**/*.test.js'
          '';
          installPhase = ''
            mkdir -p $out
          '';
        };
      });

      formatter = each (pkgs: pkgs.nixfmt);
    };
}
