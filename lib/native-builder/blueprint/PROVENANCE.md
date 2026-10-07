# Provenance: blueprint-to-build adapter

These `.mjs` modules are the REVIEWED isolated implementation (isolated workspace `Documents/Codex/2026-10-07/task/blueprint-adapter-isolated`,
Steps 0-7; 164 tests: 163 pass, 0 fail, 1 opt-in skip in isolation; full design/seam docs and patches live in that workspace and in the
preservation archive `Seagate/war-room-backups/evidence/blueprint-live-preservation-*/blueprint-adapter-isolated-164tests.tar.gz`).
They were copied verbatim; only the lint-only edits listed below were made on import. Behavior is unchanged and the ported suite
(`tests/blueprint/`) passes with identical results. No stale intermediate drafts (`core.codex-draft`, `*.step*.mjs`) are included.

Trust model (unchanged): the core is deterministic and authority-free; the HOST adapters in the sibling `.ts` files supply authentication,
locks, base identity, mission/assignment authority, recipes, dependency evidence and the Phase 9 sink. HMAC signatures on stored records are
tamper-evidence, not authentication.

| module | isolated sha256 | live sha256 | status |
|---|---|---|---|
| adapters.mjs | `4cc5928f4a68d063` | `4cc5928f4a68d063` | identical |
| artifacts.mjs | `4200306f199bce2b` | `4200306f199bce2b` | identical |
| authbridge.mjs | `be53c87da30e34f0` | `be53c87da30e34f0` | identical |
| base.mjs | `85ff3ab068fb5d58` | `85ff3ab068fb5d58` | identical |
| baseid.mjs | `3bfdaf3f4f7c5276` | `3bfdaf3f4f7c5276` | identical |
| broker.mjs | `c06caf5a73f27d05` | `bd813aae5193841b` | lint-only cleanup (unused names); behavior unchanged |
| buildexec.mjs | `1facd9de2f6fb9b3` | `5e6212576221a966` | lint-only cleanup (unused names); behavior unchanged |
| control.mjs | `6265914ae5a96d89` | `6265914ae5a96d89` | identical |
| core.mjs | `b3d4ccded0b2abbd` | `dd1f4d56a9b89b2d` | lint-only cleanup (unused names); behavior unchanged |
| depplan.mjs | `dcb71025b7e7672e` | `dcb71025b7e7672e` | identical |
| depprobe.mjs | `51816fe1b1a037aa` | `dfd0623b335a6188` | lint-only cleanup (unused names); behavior unchanged |
| depverify.mjs | `e485a06c74597a44` | `e485a06c74597a44` | identical |
| envid.mjs | `03fe35f4f9becf87` | `03fe35f4f9becf87` | identical |
| ownership.mjs | `f6cf3d67755f11c6` | `d55b9c7a9095df82` | lint-only cleanup (unused names); behavior unchanged |
| phase9.mjs | `8cbb38a9e595df5d` | `8cbb38a9e595df5d` | identical |
| quality.mjs | `b14d168fba4434a9` | `b14d168fba4434a9` | identical |
| reslock.mjs | `e0312d790c18b4cd` | `e0312d790c18b4cd` | identical |
| stages.mjs | `1605c3d7287aec34` | `fafdc2db968c5c25` | lint-only cleanup (unused names); behavior unchanged |


## Post-import modifications (supersede the table above for these files)

The table records the state at import. These modules were later changed in this branch and are NOT verbatim copies of the reviewed isolated implementation:

- `broker.mjs`: `list()`, `approvalState()` (current inputs exposed pre-approval), `artifactManifest()`, session-liveness poll for stages (`isSessionLive`), per-execution recovery errors, mission-root vs registry-root match, historical preview keeps declared dependencies; claim label/claim prefix per scope.
- `buildexec.mjs` / `artifacts.mjs`: symlinked build inputs are refused (`findInputSymlink`, `INPUT_SYMLINK`).
- `phase9.mjs`: failure-class codes `SESSION_REVOKED`, `INPUT_SYMLINK`.
- `depverify.mjs` / `depprobe.mjs`: hybrid verification (static first; probe confined to `node_modules` + root `package.json`; reads are cache-only and never execute dependency code; cache keyed by a digest of every file in the dependency directory; the host recomputes entry/package/bin hashes itself and requires probe exit code 0).
- `envid.mjs`, `quality.mjs`, `depverify.mjs` (options): per-tool env, workspace verifier options.

Each change has regression coverage in `blueprint.live.validation.ts`; the 164-test reference suite still passes. Network confinement remains policy-only (Node has no network permission flag).
