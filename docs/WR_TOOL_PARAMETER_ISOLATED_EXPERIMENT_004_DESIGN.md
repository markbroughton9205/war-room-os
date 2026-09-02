# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 004 — DESIGN ONLY

Date: 2026-08-31  
Identity: `WR-TOOL-PI-EXP-004`  
Status: **NOT STARTED. NOT TRAINED.**

This file is **not** authorization to train.

## Primary question (future)

After replacing V3/EVAL-2 **evidence** with V4/EVAL-3, can the **same** r=2 isolated architecture beat keyword/BoW on realistic wording and RESEARCH/WEB boundaries?

## Architecture (unchanged rank)

Held constant from EXP-002 / EXP-003:

- Parent: frozen WRIM-0 (`trainable_parameters=0`)
- LoRA **r=2** on `layers.{0–17}.attn.q` and `attn.v`
- Linear classifier head
- Fresh LoRA + head (do not resume EXP-003 weights unless a later mission says so)
- **Do not raise rank in this experiment**

Changed variable: **dataset / eval only** (`WR-TOOL-CURRICULUM-V4` + `WR-TOOL-EVAL-3`).

## Class space

NO_TOOL, SHA256, LOOKUP_NOTE, ECHO_INT, WEB, MEMORY, FILES, RESEARCH.

## Preconditions (not yet met)

MINIMUM viable V4 real/test gap currently **8** examples (20 target vs 12 gold). Commander may still authorize a scarcity-limited run; default recommendation is **do not train** until that gap is closed with REAL_RUNTIME / more REAL_TEST.

## Forbidden in this design

r=4, argument-extractor training, Recovery-012, WRIM1-RUN-000003, promotion, production, live tool activation, WRIM-0 mutation.

## Isolation proofs required if later executed

Core `max_abs_diff=0`, optimizer LoRA+head only, leak scan 0 vs CAP-EVAL-0 / TOOL-EVAL-1 / EVAL-2 / EVAL-3 train overlap, production untouched.
