{
  description = "Local-first language acquisition dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f (import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      }));
    in
    {
      devShells = forEachSystem (pkgs: {
        default =
          let
            railwayCli = pkgs.writeShellScriptBin "railway" ''
              exec ${pkgs.nodejs_22}/bin/npx -y @railway/cli@latest "$@"
            '';
          in
          pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            bashInteractive
            pkg-config
          ];

          buildInputs = with pkgs; [
            nodejs_22
            bun
            esbuild
            chromium
            unzip
            curl
            railwayCli
            python3
          ];

          shellHook = ''
            echo "🚀 Bedrock Language App Development Environment Loaded"
            echo "Bun: $(bun --version)"
            echo "Node: $(node --version)"
            echo "Railway: available via npx @railway/cli wrapper"
            
            # Playwright Configurations
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
          '';
        };
      });
    };
}
