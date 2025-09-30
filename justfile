set shell := ["bash", "-lc"]

alias d := dev
alias b := build
alias l := lint

default:
    @just dev

dev:
    pnpm tauri dev

build:
    pnpm tauri build

lint:
    cargo fmt --all -- --check
    if command -v cc >/dev/null 2>&1; then \
        cargo clippy -p reader-core --all-targets -- -D warnings; \
    else \
        echo "skipping cargo clippy (system linker 'cc' not found)"; \
    fi
    pnpm --filter ui lint
