# WR-TOOL CURRICULUM V5 MATERIALIZATION

Identity: `WR-TOOL-CURRICULUM-V5-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_curriculum/design/WR-TOOL-CURRICULUM-V5-CANDIDATE/`  
Does **not** overwrite V4. Class map remains 0–5: NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256. LOOKUP_NOTE / ECHO_INT excluded.

## Numbers

- Raw inspected: 250 new + V4 rows (32 reused after exact/norm skip)
- Gold after quality/dedup/EVAL-4 exclusion: **252**
- Train: **156** hash `f9e1ae99e46fa1bf767f95c246f5aa0ee55a5153e671374859bc30eeb9ffad33`
- Combined bundle `74badd43db4f2e7b1fe16c722d076512adf05c4a6ac0232cf90c5b8f5812ce7b`
- Exact dups removed: 16. Normalized: 1. Family exclusions: 0.
- Train REAL_RUNTIME+REAL_TEST: **87.2%** rows / **87.0%** families
- TEST_FIXTURE train: 20 (MEMORY only, explicit). SYNTHETIC: 0
- Largest family share: **1.28%**
- Families/class train: NO_TOOL 37, WEB 17, MEMORY 22, FILES 32, RESEARCH 29, SHA256 19
- Argument coverage: 1.0 all classes
- EVAL-4 exact/norm/family overlap with train: **0**
- EVAL-5 exact/norm/family overlap with train: **0**
- Deterministic rebuild ×2 identical

## Data readiness A–Q

All **PASS**. See `readiness-gates.json`.

## Verdict

**WR-TOOL CURRICULUM V5 — PASS**
