# HANDOFF

Branch: `grokbuild/repo/agentwall-tests`
Base: `79827db` (local `main`, merge of `repsecure/integration/phase1`)
Repo: `github.com/repsecure/agentwall` checked out at `repos/agentwall`
Not pushed. Not merged.

## Done

- Reused the existing clone. The named branch already pointed at the same commit as `main` and had no handoff, so the work below is the first commit on it.
- Installed and tested with Node 22.23.3. The package `engines` field requires Node `>=22.12.0`. The default `node` on this machine is 20.19.2 and is too old.
- `npm ci`, `npm run lint` (`tsc --noEmit`), and `npm run build` (`tsc`) succeed.
- `npm test` on a fresh tree, before `npm run build`, fails. Eight tests spawn `dist/cli.js` or require `dist/index.js` to exist (`tests/fleet-evidence.test.ts`, `tests/mcp-wrap-durability.test.ts`, `tests/bootstrap-ui.test.ts`, `tests/capture-health.integration.test.ts`). That is the documented CI order (install, lint, build, test), not a product defect. After a build those eight pass except for the capture-health bug below.
- Fixed `tests/capture-health.integration.test.ts`. `doctor()` concatenated stderr onto stdout and then `JSON.parse`d the result. `agentwall doctor --json` already prints one JSON document on stdout. Node writes a warning to stderr when `NO_COLOR` and `FORCE_COLOR` are both set (`NO_COLOR is ignored due to the FORCE_COLOR env being set`). That warning made `JSON.parse` throw. The next test then asserted against `baselineTotal` still at 0, so it looked like a counting bug (`expected 1, received 5`). The text-mode run never parsed JSON and already passed. The helper now keeps the streams apart, parses stdout only, forces both color variables so the regression does not depend on the parent environment, and includes stderr in the thrown error when stdout is not JSON.
- Final `npm test`: 86 suites, 1416 tests, all passed.
- Also green: `npm run check:readme`, `npm run check:public-copy`, `npm run check:brand`, `node scripts/check-workflow-pins.js`.
- Go verifier (`verifier/`): `gofmt` clean, `go vet` clean, `go test ./...` passed, `go list -m all` is one module, `go build` succeeded. Go 1.24.4 against `go 1.22` in `go.mod`.
- Python verifier (`verifier-py/`): 136 pytest tests passed on Python 3.13 with pytest 9.1.1. Imports stay inside the standard library. `pyproject.toml` declares no dependencies.
- Rust verifier (`verifier-rs/`): rustc 1.90.0 as pinned by `rust-toolchain.toml`. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test --locked` passed (61 unit tests, 6 corpus tests). `cargo tree --locked` is one line. `#![forbid(unsafe_code)]` is present and no `unsafe` remains.
- `node scripts/conformance.js`: 27 corpus cases, 4 implementations (TypeScript, Go, Rust, Python), 27 agreed, 0 failures. `npm run gen:corpus` reproduced `verifier/testdata/corpus` with a clean `git status`.

## Next

- The CI test job also runs `npm audit --audit-level=high`. That command fails on this lockfile and was not changed here. Direct pins: `fastify` 5.11.0 (patched in 5.12.7) and `js-yaml` 5.2.3 (patched in 5.5.0). High or critical transitive findings: `fast-uri` (via fastify), `handlebars` 4.7.9 (via ts-jest), `brace-expansion` (via jest / minimatch). Moderate findings (`ip-address`, `argparse`, `sprintf-js`) do not trip `--audit-level=high` by themselves.
- Do not push this branch and do not merge it to `main` from this handoff.

## How to run / test

Use Node 22.12 or newer.

```bash
npm ci
npm run lint
npm run build
npm test
```

`npm test` is Jest (`tests/**/*.test.ts`) with `tests/setup-env.ts`. Build first. The suites that exec `dist/cli.js` fail without it.

Verifier checks, from the repo root:

```bash
# Go. Point GOCACHE at a writable directory if the default cache is not.
(cd verifier && gofmt -l . && go vet ./... && go test ./... && go build -o /tmp/agentwall-verify .)

# Rust. Needs rustc 1.90.0 (verifier-rs/rust-toolchain.toml).
(cd verifier-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --locked)
cargo build --release --locked --manifest-path verifier-rs/Cargo.toml

# Python. CI installs pytest==9.1.1. The verifier itself has no dependencies.
python3 -m pip install "pytest==9.1.1"
(cd verifier-py && python3 -m pytest -q)

# Cross-implementation corpus. Defaults:
#   verifier/agentwall-verify
#   verifier-rs/target/release/agentwall-verify
#   verifier-py/agentwall-verify-py
node scripts/conformance.js
npm run gen:corpus
git status --porcelain -- verifier/testdata/corpus
```

Copy and workflow checks:

```bash
npm run check:readme
npm run check:public-copy
npm run check:brand
node scripts/check-workflow-pins.js
```

## Open questions

- Should `npm test` build first, or should a missing `dist/cli.js` fail with one explicit message instead of eight subprocess failures?
- Should the next change bump `fastify` and `js-yaml` inside the same major, and then clear the dev-tree audit findings, or is that a separate dependency PR?
- `npm audit fix` will not move the exact `fastify` and `js-yaml` pins. Those two lines in `package.json` have to change on purpose.
