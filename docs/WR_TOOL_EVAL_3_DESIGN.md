# WR-TOOL-EVAL-3 — DESIGN

Date: 2026-08-31  
Identity: `WR-TOOL-EVAL-3`  
Path: `model-lab/eval-only/WR-TOOL-EVAL-3/`  
`EXCLUDE_FROM_TRAINING=true`  
Does **not** overwrite `WR-TOOL-EVAL-2`, `WRIM-1.1-TOOL-EVAL-1`, or `WRIM-1.1-CAP-EVAL-0`.

## Purpose

Test generalization under **realistic wording and tool boundaries**, not V3 template memorization.

## Size

**13** designed items (seeded from the trajectory pool). Small on purpose: the real/test holdout set is small. Do not inflate with unlabeled synthetic.

Real/test wording share among these 13: **92.3%** (one gym/sha holdout uses gym objective prose; boundary items are labeled SYNTHETIC where they are).

## Coverage

| section | present |
|---|---|
| WEB vs RESEARCH (same topic UTC) | yes |
| FILES vs MEMORY (Wave 4.2 hash) | yes |
| NO_TOOL vs WEB | yes |
| NO_TOOL vs MEMORY | yes |
| unsupported curl | yes |
| ambiguous / missing context | yes |
| RESEARCH gym corroborated (family holdout) | yes |
| sha256 wave-8-1-hardening family | yes |

## Isolation

Held-out families (must not appear in V4 train):

`fam.research.gauges-corroborated`, `fam.sha256.wave-8-1-hardening`, `fam.boundary.web-vs-research.utc`, `fam.boundary.files-vs-memory.wave42`, `fam.boundary.notool-vs-web.search-engine`, `fam.boundary.notool-vs-memory.define`, `fam.boundary.ambiguous.look-into`, `fam.boundary.missing-context.hash-previous`, `fam.notool.unsupported.curl`.

## Scoring (when a future experiment runs)

Macro F1 and per-class recall, TOOL vs NO_TOOL, boundary subset, RESEARCH recall, real-wording subset. Compact `TOOL=` is the router target, not free JSON generation.

EVAL-2 remains the historical EXP-003 scorecard.

## Class-diverse collection leak check (2026-08-31)

Ledger `REAL-RUNTIME-CLASS-DIVERSITY-V1` was reviewed against this suite.

- EVAL-3 `suite.json` **not overwritten** (still 13 items, identity `WR-TOOL-EVAL-3`).
- EVAL-2 **not overwritten**.
- Exact request overlap with EVAL-3 inputs: **0**.
- New family ids use `fam.runtime.*` / `fam.boundary.runtime.*` prefixes, not the EVAL-3 holdout ids listed above.
- Do not copy class-diverse training candidates into EVAL-3. If a future eval needs live WEB/RESEARCH/FILES items, design EVAL-4 as a separate holdout.

