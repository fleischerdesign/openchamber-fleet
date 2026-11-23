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
        build-and-test = pkgs.runCommand "openchamber-fleet-checks" {
          nativeBuildInputs = with pkgs; [
            nodejs_22
            typescript
            rsync
            openssh
            bash
            coreutils
          ];
        } ''
          cp -r ${self} source
          chmod -R u+w source
          cd source
          tsc -p tsconfig.json
          node --test 'test/**/*.test.js'
          touch $out
        '';
      });

      formatter = each (pkgs: pkgs.nixfmt);
    };
}
