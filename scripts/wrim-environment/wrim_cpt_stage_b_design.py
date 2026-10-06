"""Freeze KEEP_STEP_400 as PROVISIONAL Stage B parent and emit the design packet.

Does not train. Does not construct or restore an optimizer. Does not copy or
rename model weights. Does not build WR-CORPUS-CPT-2. Pointer/manifest only.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000007_preflight import resolve_dump_root
from wrim_cpt_identity import LINUX_CKPT_ROOT, LINUX_DATA_ROOT, PARENT_SHA, TOKENIZER_SHA
from wrim_cpt_stage_b_identity import (
    ARCHITECTURE_ID,
    AUTHORIZE_ENV_NAME,
    CORPUS_BUILD_AUTHORIZED,
    DESIGN_REPORT_FILENAME,
    INDEPENDENT_NL_MANIFEST_HASH,
    INDEPENDENT_NL_PACK_HASH,
    INDEPENDENT_NL_PACK_ID,
    INDEPENDENT_NL_TRAIN_FORBIDDEN,
    PARAMETER_COUNT,
    POINTER_FILENAME,
    PROPOSED_CORPUS_ID,
    PROPOSED_CORPUS_VERSION,
    PROPOSED_STAGE_B_CPT_RUN_ID,
    PROVISIONAL_STAGE_B_PARENT,
    PROVISIONAL_STAGE_B_PARENT_CHECKPOINT,
    PROVISIONAL_STAGE_B_PARENT_HASH,
    RESERVED_SFT_RUN,
    SELECTION_STATUS,
    STAGE_A_CPT_RUN_ID,
    VAL_PACK_FREEZE_FILENAME,
)
from wrim_resumable_checkpoint import MODEL_NAME, sha256_file

EXPECTED_STEP_400 = PROVISIONAL_STAGE_B_PARENT_HASH
STEP_400_DIR = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def verify_live_parent() -> dict[str, Any]:
    weights = STEP_400_DIR / MODEL_NAME
    if not weights.is_file():
        raise FileNotFoundError(f"missing Stage A parent weights: {weights}")
    live = sha256_file(weights)
    dump = resolve_dump_root(None)
    if dump is None:
        raise FileNotFoundError("recovery dump root missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path) if tok_path.is_file() else None
    parent_path = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    wrim0_hash = sha256_file(parent_path) if parent_path.is_file() else None
    val_root = Path(LINUX_DATA_ROOT) / INDEPENDENT_NL_PACK_ID
    passages = val_root / f"{INDEPENDENT_NL_PACK_ID}-PASSAGES.jsonl"
    manifest = val_root / f"{INDEPENDENT_NL_PACK_ID}-MANIFEST.json"
    sha_sidecar = val_root / f"{INDEPENDENT_NL_PACK_ID}-SHA256.json"
    passages_file_hash = sha256_file(passages) if passages.is_file() else None
    man_hash = sha256_file(manifest) if manifest.is_file() else None
    pack_hash = None
    if passages_file_hash:
        pack_hash = hashlib.sha256(
            json.dumps({"passages": passages_file_hash}, sort_keys=True).encode("utf-8")
        ).hexdigest()
    sidecar = json.loads(sha_sidecar.read_text(encoding="utf-8")) if sha_sidecar.is_file() else {}
    expected_passages = (sidecar.get("files") or {}).get("passages")
    return {
        "step_400_path": str(weights),
        "step_400_live_hash": live,
        "step_400_hash_ok": live == EXPECTED_STEP_400,
        "weights_copied": False,
        "weights_renamed": False,
        "optimizer_loaded": False,
        "tokenizer_path": str(tok_path),
        "tokenizer_live_hash": tok_hash,
        "tokenizer_unchanged": tok_hash == TOKENIZER_SHA,
        "wrim0_live_hash": wrim0_hash,
        "wrim0_unchanged": wrim0_hash == PARENT_SHA if wrim0_hash else None,
        "independent_nl_passages_file_hash": passages_file_hash,
        "independent_nl_passages_file_ok": passages_file_hash == expected_passages,
        "independent_nl_pack_live_hash": pack_hash,
        "independent_nl_pack_ok": pack_hash == INDEPENDENT_NL_PACK_HASH,
        "independent_nl_manifest_live_hash": man_hash,
        "independent_nl_manifest_ok": man_hash == INDEPENDENT_NL_MANIFEST_HASH,
        "authorize_env_present": AUTHORIZE_ENV_NAME in os.environ,
        "authorize_env_value": os.environ.get(AUTHORIZE_ENV_NAME),
    }


def parent_pointer(verify: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "WRIM1_CPT_STAGE_B_PARENT_POINTER",
        "immutable": True,
        "pointer_only": True,
        "weights_copied": False,
        "weights_renamed": False,
        "CPT_RUN": STAGE_A_CPT_RUN_ID,
        "selected_checkpoint": PROVISIONAL_STAGE_B_PARENT_CHECKPOINT,
        "checkpoint_hash": EXPECTED_STEP_400,
        "checkpoint_hash_live": verify["step_400_live_hash"],
        "checkpoint_hash_verified": verify["step_400_hash_ok"],
        "checkpoint_path": verify["step_400_path"],
        "selection_status": SELECTION_STATUS,
        "PROVISIONAL_STAGE_B_PARENT": PROVISIONAL_STAGE_B_PARENT,
        "PROVISIONAL_STAGE_B_PARENT_HASH": EXPECTED_STEP_400,
        "selection_basis": [
            "best foundation mean rank",
            "best top-5",
            "best top-10",
            "strongest newline/document attractor suppression",
            "lower repetition than step-1220",
            "independent NL evaluation did not contradict Stage A",
            "step-1220 NLL advantage too small to justify switch",
            "greedy answer/coherent language remains unsolved",
        ],
        "NOT_AUTHORIZED": [
            "STAGE_B_EXECUTE",
            "SFT",
            RESERVED_SFT_RUN,
            "STAGE3B",
            "OPTIMIZER_CREATE",
            "OPTIMIZER_RESTORE",
            "OPTIMIZER_STEP",
            "WEIGHT_COPY",
            "WEIGHT_RENAME",
            "CANONICAL_PROMOTION",
            "RAEL_PROMOTION",
            "CORPUS_CPT_2_BUILD",
        ],
        "independent_nl_validation_pack": {
            "pack_id": INDEPENDENT_NL_PACK_ID,
            "PACK_HASH": INDEPENDENT_NL_PACK_HASH,
            "MANIFEST_HASH": INDEPENDENT_NL_MANIFEST_HASH,
            "TRAIN_FORBIDDEN": INDEPENDENT_NL_TRAIN_FORBIDDEN,
            "must_never_enter_training_stream": True,
            "live_pack_ok": verify["independent_nl_pack_ok"],
            "live_manifest_ok": verify["independent_nl_manifest_ok"],
        },
        "proposed_future_cpt_run_if_authorized": PROPOSED_STAGE_B_CPT_RUN_ID,
        "sft_namespace_not_used": "WRIM1-RUN-*",
        "created_at": utc_now(),
        "TRAINING_PERFORMED": "NO",
        "OPTIMIZER_STEPS": 0,
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "CHECKPOINTS_MODIFIED": "NO",
        "CANONICAL_PROMOTED": "NO",
        "COMMANDER_AUTHORIZATION_REQUIRED": "YES",
    }


def val_pack_freeze(verify: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "WR_VAL_NL_INDEPENDENT_1_TRAIN_FORBIDDEN_FREEZE",
        "pack_id": INDEPENDENT_NL_PACK_ID,
        "PACK_HASH": INDEPENDENT_NL_PACK_HASH,
        "MANIFEST_HASH": INDEPENDENT_NL_MANIFEST_HASH,
        "TRAIN_FORBIDDEN": True,
        "added_to_training_stream": False,
        "must_never_enter_training_stream": True,
        "purpose": "independent natural-language measurement only; not a CPT corpus; not an SFT corpus",
        "live_pack_hash": verify["independent_nl_pack_live_hash"],
        "live_manifest_hash": verify["independent_nl_manifest_live_hash"],
        "verified": bool(verify["independent_nl_pack_ok"] and verify["independent_nl_manifest_ok"]),
        "created_at": utc_now(),
    }


def root_cause_analysis() -> dict[str, Any]:
    return {
        "A_capacity_19_2M": {
            "hypothesis": "19,217,152 parameters cannot represent coherent English continuation.",
            "evidence_supporting": [
                "greedy_exact remained 0 at every Stage A checkpoint including STEP_400",
                "independent NL mean NLL stayed 7.180 at STEP_400 (per-token perplexity ~1310)",
                "WRIM-0 literary mash and CPT code mash are local n-gram imitation, not held-out prose",
                "d_model=256, 4 heads, 18 layers, vocab 15126 is a small decoder",
            ],
            "evidence_against": [
                "foundation mean rank improved 4711.94 → 2101.97, proving the model updates useful next-token rankings",
                "WRIM-0 greedy was locally fluent Alice/Queen literary mash — the model already emits English-like sequences when that is the prior",
                "family NLL dropped sharply (role 8.07→3.93, code 8.26→5.43, json 8.62→4.80) so capacity is sufficient to specialize",
                "independent NL NLL did move WRIM-0 7.459 → 7.180; the distribution can shift, just not enough",
            ],
            "confidence": "MEDIUM as a contributing limit; LOW as the dominant Stage A failure mode",
            "distinguishing_experiment": "Stage B1 probe: train ~0.82M tokens of genuinely diverse prose at low LR from STEP_400. If independent NL NLL drops ≥0.08 and code/markdown intrusion rates fall, capacity was not the blocker. If NLL is flat and greedy remains code/md mash, capacity/tokenizer become leading.",
        },
        "B_corpus_imbalance": {
            "hypothesis": "Stage A mix overweighted code/JSON/War Room operational text relative to genuine prose.",
            "evidence_supporting": [
                "LOCKED_MIX advertised natural 35% / code 25% / technical 15% / json 10% / role 10% / genesis 5%",
                "C1 HARDENED train is 77.67% code tokens, 4.77% JSON, 17.42% document, 0.14% dialogue, and CLASS_RECORD_COUNTS has zero 'natural' records",
                "packer reused genesis excerpts as bucket=natural when natural pool < 8 units",
                "later-step greedy showed const/export, markdown headings, research-engine paths",
            ],
            "evidence_against": [
                "packed stream did hit the advertised 34.98% 'natural' share — the label existed even if the content was genesis reuse",
                "code competence improved (code NLL 8.26→5.43) which is the intended side of the imbalance",
            ],
            "confidence": "HIGH",
            "distinguishing_experiment": "Rebuild mix with unique non-genesis prose ≥50% and code ≤12%; hold LR/objective/parent fixed in B1.",
        },
        "C_insufficient_genuine_natural_prose": {
            "hypothesis": "Unique natural C1 material was too thin; 'natural 35%' was genesis-derived.",
            "evidence_supporting": [
                "wrim_cpt_pack.py: if len(pools['natural']) < 8, genesis units are cloned with bucket=natural",
                "C1 CLASS_RECORD_COUNTS: technical 1470, code 6654, json 256, dialogue 25 — no natural class",
                "GENERAL_VAL_NLL was aliased to GENESIS_VAL_NLL at every Stage A checkpoint",
                "independent NL (operator-authored contemporary prose) stayed high-NLL while genesis NLL fell 5.078→3.950",
            ],
            "evidence_against": [
                "genesis literary English is still English; a 35%+5% genesis-family stream is not zero language",
                "instructional independent-NL category was the lowest NLL at STEP_400 (6.92), so some prose transfer exists",
            ],
            "confidence": "VERY_HIGH",
            "distinguishing_experiment": "Audit token-origin of the Stage A natural bucket (already implied: genesis clone). Stage B must count unique non-genesis prose tokens separately from labeled-natural tokens.",
        },
        "D_excessive_code_json_war_room_ops": {
            "hypothesis": "C1 worktree code + JSON + operational docs taught markdown/path/code intrusion on prose prompts.",
            "evidence_supporting": [
                "C1 format_classes: code 6654 of 8405 kept records",
                "independent NL greedy at STEP_400 included markdown headings and export/function fragments on prose prefixes",
                "foundation later-step interpolations included adj-noun-digit plus code-like pieces",
                "technical bucket is docs/ architecture/policy paths — War Room operational English, not general exposition",
            ],
            "evidence_against": [
                "JSON and code NLL improvements are desirable retention, not automatically harmful",
                "backtick attractor on independent NL was 0.0 at STEP_400 (0.1 at WRIM-0)",
            ],
            "confidence": "HIGH",
            "distinguishing_experiment": "Measure code-keyword and path-intrusion rates on frozen independent NL greedy before/after a prose-heavy B1. Hold code share at 12% vs a 25% control only if Commander later authorizes an A/B; default B1 is the reduced-code mix.",
        },
        "E_synthetic_role_tag_influence": {
            "hypothesis": "10% synthetic role-tag data (adj-noun-NNNN) polluted natural generation.",
            "evidence_supporting": [
                "role share packed ≈10% (499,537 role-delimited tokens)",
                "STEP_400 behavior_counts tag_fragment=4 on foundation greedy; later steps showed adj-noun-digit interpolation",
                "role NLL collapsed 8.07→3.93 — the model strongly learned that template",
            ],
            "evidence_against": [
                "independent NL tag_fragment_rate=0.0 at WRIM-0, 400, 1000, 1220",
                "non_tag_prompt_tag_emissions=0 at STEP_400 and STEP_1220",
                "role tags are the intended boundary teaching signal for later SFT",
            ],
            "confidence": "MEDIUM for foundation interpolation; LOW for independent-NL contamination",
            "distinguishing_experiment": "Stage B role share 1% rehearsal vs 0%. Compare foundation tag_fragment counts and independent NL tag_fragment_rate (must stay 0).",
        },
        "F_sequence_packing_effects": {
            "hypothesis": "Shuffled family concatenation after EOS taught P(code|document_end) and mid-stream family jumps.",
            "evidence_supporting": [
                "packer concat_units after shuffle_unit_order mixes natural/code/json/role/genesis back-to-back",
                "units are BOS+body+EOS then concatenated, so after EOS the next token is BOS of a random family",
                "EOS density 0.00458 ≈ one boundary / 218 tokens inside 512-token windows that often span two families",
                "document_continuation attractor on independent NL rose 0.20 at 400 → 0.225 at 1220 after more packed exposure",
            ],
            "evidence_against": [
                "independent NL prefixes are mid-prose, not post-EOS, yet still emit markdown/code — prior shift is not only boundary-local",
                "wrap_lm_tokens already inserts document EOS; packing is not unlabeled concatenation",
            ],
            "confidence": "MEDIUM",
            "distinguishing_experiment": "B1 packing: (i) homogeneous minibatches by family 50% of steps, (ii) extra EOS between family switches, (iii) sentence-boundary splits instead of 1024-token cuts. Compare intrusion rates at equal token budget.",
        },
        "G_learning_rate_schedule": {
            "hypothesis": "Peak 3e-4 with warmup 60 over-updated past the step-400 optimum.",
            "evidence_supporting": [
                "cosine LR at step 400 is still ≈2.47e-4 (progress 340/1160)",
                "foundation rank best at 400 then worsened 2102→2234→2189→2303→2311",
                "independent NL newline 0.075 at 400 vs 0.15 at 1220; repeat 0.25 vs 0.325",
                "Stage A started from a finished WRIM-0 that already ended at 3e-4; peak equaled the parent's final LR",
            ],
            "evidence_against": [
                "rank also drifted while LR decayed toward 3e-5, so drift is not only high-LR",
                "family NLL kept improving after 400, which is expected specialization rather than instability",
                "grad trajectory max 3.12, last 0.49 — no explosion",
            ],
            "confidence": "HIGH that Stage B must use a lower peak; MEDIUM that LR alone caused the NL failure",
            "distinguishing_experiment": "B1 constant 5e-5 from STEP_400, same new mix. If rank holds and NL improves, Stage A peak was too aggressive for continued pretrain.",
        },
        "H_objective_mismatch": {
            "hypothesis": "Full-stream causal CE is the wrong objective for natural continuation.",
            "evidence_supporting": [
                "CE on a code-heavy packed stream optimally predicts code, not held-out prose",
                "no sentence-level or document-coherence auxiliary",
            ],
            "evidence_against": [
                "causal CE is the correct CPT objective for this decoder; the failure tracks the data, not the loss class",
                "SFT target masking would violate CPT/SFT separation",
                "span corruption / prefix-LM would change the training contract without evidence they fix 19.2M prose",
            ],
            "confidence": "LOW for changing the objective; HIGH that CE + bad mix yields bad priors",
            "distinguishing_experiment": "Keep full_stream_next_token_ce. Change mix first. Only revisit objective if B1 prose mix fails both NLL and intrusion counts.",
        },
        "I_context_length_sample_construction": {
            "hypothesis": "SEQ_LEN 512 and 1024-token excerpt splits cut documents mid-thought and weaken sentence completion.",
            "evidence_supporting": [
                "split_bounded_excerpts max_tokens=1024; sequences trained at 512",
                "independent NL passages are short coherent paragraphs; training windows may start mid-code or mid-heading",
                "newline attractor is a natural consequence of markdown/code line-oriented samples",
            ],
            "evidence_against": [
                "512 is already longer than the independent NL prefixes used for greedy (~24 tokens) and NLL_AT_512 exists",
                "WRIM-0 trained at the same architecture/context and produced literary continuation, so 512 is usable",
            ],
            "confidence": "MEDIUM",
            "distinguishing_experiment": "Pack Stage B prose on sentence/paragraph boundaries; reject windows that begin with a code fence or markdown heading unless the family is code/technical. Keep SEQ_LEN=512 (no architecture change).",
        },
        "J_tokenizer_effects": {
            "hypothesis": "WR-TOKENIZER-0 (code-heavy 15k BPE, NEWLINE_ID=112 Ċ) fragments prose and over-represents code pieces.",
            "evidence_supporting": [
                "NEWLINE_PIECES include 113 and 112; newline is a first-class cheap token",
                "independent NL NLL ~7.2 is consistent with many rare wordpieces",
                "code tokens (Ġconst, export, ĊĠĠ) are cheap to emit after CPT",
            ],
            "evidence_against": [
                "tokenizer is frozen (47ed32ce…) and WRIM-0 already produced English literary tokens with it",
                "TOKENIZER_MODIFIED is forbidden in this packet",
                "instructional category NLL 6.92 shows some prose wordpieces are learnable",
            ],
            "confidence": "MEDIUM as an amplifier; MUST NOT be 'fixed' in Stage B",
            "distinguishing_experiment": "Do not retokenize. Report per-category NLL and unknown/rare-piece rates on independent NL. Tokenizer change is a later Commander architecture decision, not CPT Stage B.",
        },
        "K_undertraining_vs_over_specialization": {
            "hypothesis": "STEP_400 is undertrained on genuine prose and over-specialized on C1/genesis/role by STEP_1220.",
            "evidence_supporting": [
                "≈1.75M labeled-natural tokens were mostly genesis clones — undertraining on held-out contemporary English",
                "post-400: genesis/code/json NLL kept falling while foundation rank and NL attractors worsened — over-specialization",
                "Stage 3 anchor ΔNLL vs WRIM-0 grew 0.85 (400) → 1.01 (1220) as corpus-0 val_loss fell — memorizing/shifting into CPT mix",
                "another 5M tokens of the same mix is the wrong response",
            ],
            "evidence_against": [
                "total Stage A was only 4.997M tokens; a 19.2M model can absorb more tokens if they are the right tokens",
                "STEP_400 itself is not fully 'done' on code/json (those NLL still fell later)",
            ],
            "confidence": "VERY_HIGH",
            "distinguishing_experiment": "Staged B1 probe on a new mix with dense eval. Stop at first rank/NL regression. That separates need-more-tokens from need-different-tokens.",
        },
        "dominant_diagnosis": (
            "STEP_400 still fails natural generation primarily because Stage A 'natural 35%' was genesis reuse "
            "on top of a C1 pool that is ~78% code, plus 10% synthetic role templates, packed across family "
            "boundaries at a still-high LR (~2.5e-4 at the apparent optimum). Capacity is a real ceiling on "
            "fluency quality, but it is not the explanation for code/markdown/path intrusion. Do not run more "
            "Stage A. Do not treat 19.2M as automatically requiring a bigger model before a prose-data probe."
        ),
    }


def corpus_mix_diagnosis() -> dict[str, Any]:
    return {
        "stage_a_advertised_mix": {
            "natural": 0.35,
            "code": 0.25,
            "technical": 0.15,
            "json": 0.10,
            "role": 0.10,
            "genesis": 0.05,
        },
        "stage_a_actual_packed_mix": {
            "natural": 0.3498004150790025,
            "code": 0.24982224765019698,
            "technical": 0.15006620812263702,
            "json": 0.10015807101729175,
            "role": 0.09996495982386658,
            "genesis": 0.05018809830700517,
        },
        "c1_unique_natural_records": 0,
        "c1_class_record_counts": {
            "technical": 1470,
            "code": 6654,
            "json": 256,
            "dialogue": 25,
        },
        "c1_class_token_shares_approx": {
            "code": 0.7767198918075899,
            "json": 0.04770689768258771,
            "dialogue": 0.0013570901322316974,
            "document_technical_plus_natural": 0.17421612037759068,
        },
        "natural_bucket_fill_rule": (
            "If unique C1 natural units < 8, clone genesis excerpts into bucket=natural. "
            "That rule fired. Labeled natural ≠ broad natural language."
        ),
        "general_val_aliased_to_genesis": True,
        "explains": {
            "markdown_headings": "C1 technical markdown docs + code README/docs packed as technical/natural-adjacent.",
            "const_export_fragments": "C1 77.7% code tokens; packed code share 25%; shuffled next to prose units.",
            "research_engine_paths": "first-party worktree paths in C1 technical/code chunks.",
            "json_fragments": "advertised 10% JSON plus C1 structured_json records.",
            "repetition": "short synthetic role targets + code token loops + high LR specialization after step-400.",
            "poor_english_continuation": (
                "held-out contemporary prose was never a majority unique source; genesis literary + War Room ops "
                "are the actual language prior. Independent NL NLL 7.18 confirms the mismatch."
            ),
        },
        "do_not_call_natural_35_broad_nl": True,
    }


def proposed_corpus() -> dict[str, Any]:
    mix = [
        {
            "category": "genuine_general_prose",
            "percent": 22,
            "why": "Sentence-level English continuation that is not genesis Alice/Queen and not War Room docs.",
        },
        {
            "category": "expository_prose",
            "percent": 12,
            "why": "Cause/effect and definition transitions measured as weak on independent NL expository NLL 7.36.",
        },
        {
            "category": "factual_explanation",
            "percent": 10,
            "why": "World/document patterns without repo paths; independent NL factual NLL 7.22 at STEP_400.",
        },
        {
            "category": "instructional_prose",
            "percent": 8,
            "why": "Procedural English (how a process works) as documents, not Commander/Assistant SFT pairs. Best independent-NL category at 6.92 — grow this distribution without turning it into instruction following.",
        },
        {
            "category": "dialogue",
            "percent": 6,
            "why": "Turn-taking language without special role tokens. Independent NL dialogue_like was the worst category at 7.34.",
        },
        {
            "category": "narrative",
            "percent": 6,
            "why": "Multi-sentence coherence distinct from genesis literary clone.",
        },
        {
            "category": "descriptive",
            "percent": 4,
            "why": "Adjective/noun natural transitions; keep small so description does not dominate.",
        },
        {
            "category": "code",
            "percent": 12,
            "why": "Retain code competence (STEP_400 code NLL 5.43). Down from 25% because 25% plus C1's 78% code origin over-shifted greedy priors.",
        },
        {
            "category": "structured_json",
            "percent": 6,
            "why": "Retain JSON competence (STEP_400 json NLL 4.80). Down from 10%.",
        },
        {
            "category": "technical_explanation_non_repo",
            "percent": 8,
            "why": "General technical English. Explicitly exclude War Room operational paths (research-engine, lib/, app/api) unless they appear inside a licensed first-party explanatory paragraph that is not a source dump.",
        },
        {
            "category": "genesis_rehearsal",
            "percent": 5,
            "why": "Same 5% as Stage A to retain WRIM-0 genesis statistics without again using genesis as the natural bucket.",
        },
        {
            "category": "role_boundary_rehearsal",
            "percent": 1,
            "why": "Sharp reduction from 10%. Keep a trace of COMMANDER/ASSISTANT/EOS statistics. Evidence does not justify keeping 10% synthetic adj-noun-NNNN as CPT language.",
        },
    ]
    assert sum(int(x["percent"]) for x in mix) == 100
    language_like = 22 + 12 + 10 + 8 + 6 + 6 + 4 + 8
    return {
        "corpus_id": PROPOSED_CORPUS_ID,
        "version": PROPOSED_CORPUS_VERSION,
        "BUILD_NOW": False,
        "CORPUS_BUILD_AUTHORIZED": CORPUS_BUILD_AUTHORIZED,
        "proposed_mix_percent": {row["category"]: row["percent"] for row in mix},
        "categories": mix,
        "language_like_percent": language_like,
        "code_json_role_genesis_percent": 12 + 6 + 1 + 5,
        "synthetic_role_policy": "REDUCE_TO_1_PERCENT_REHEARSAL_OR_ZERO_IF_B1_TAG_FRAGMENTS_RISE",
        "genesis_is_not_natural": True,
        "unique_non_genesis_prose_must_be_reported_separately": True,
        "source_quality_requirements": [
            "document boundaries with BOS/EOS wrap",
            "EOS discipline: one EOS at true document end; no silent mid-document EOS spam",
            "exact dedup; near-dup audit (minhash) before freeze",
            "per-document source provenance",
            "per-document license/provenance; first-party or public-domain only unless Commander later grants a named license",
            "train/validation separation before packing",
            "no WRIM-FOUNDATION-EVAL-1 leakage",
            "no Stage 3 / addendum leakage",
            "no WR-VAL-NL-INDEPENDENT-1 leakage (TRAIN_FORBIDDEN)",
            "no SFT validation leakage (mode-entry, capability, RUN val packs, Stage 3 keys)",
            "no independent-NL 48-char span overlap",
            "do not ingest C1 worktree dumps as 'natural'",
            "do not relabel genesis as natural",
            "sentence/paragraph packing for prose families",
            "homogeneous family minibatches ≥50% of B1 steps",
        ],
        "forbidden_sources": [
            INDEPENDENT_NL_PACK_ID,
            "WRIM-FOUNDATION-EVAL-1",
            "WR-CORPUS-MODE-ENTRY-1 validation",
            "WR-CORPUS-CAPABILITY-1 validation",
            "Stage 3 suite strings",
            "any SFT validation split",
        ],
    }


def proposed_objective() -> dict[str, Any]:
    return {
        "recommended": "full_stream_next_token_ce",
        "MASK_PROMPT_TOKENS": False,
        "SFT_target_masking": "FORBIDDEN",
        "why": (
            "Stage B remains continued pretraining on a decoder-only causal LM. Full-stream next-token CE is "
            "the architecture-native CPT objective. Stage A failure is explained by mix, packing, and LR, not by "
            "a missing masked-span or instruction-response loss. Prefix-LM / prompt masking would start SFT. "
            "UL2-style corruption is a different pretrain contract and is not justified by Stage A measurements."
        ),
        "rejected_alternatives": [
            {
                "name": "prompt_masked_ce",
                "reason": "SFT objective; forbidden in CPT.",
            },
            {
                "name": "span_corruption",
                "reason": "Not the WRIM-G-20M pretrain contract; no Stage A evidence it would fix NL.",
            },
            {
                "name": "preference_or_rl",
                "reason": "Not CPT; not authorized.",
            },
        ],
    }


def proposed_lr() -> dict[str, Any]:
    return {
        "stage_a": {
            "peak": 3e-4,
            "min": 3e-5,
            "warmup": 60,
            "schedule": "linear warmup then cosine to min",
            "lr_at_step_400_approx": 2.47e-4,
            "note": "Optimum occurred while LR was still ~82% of the way from min to peak.",
        },
        "stage_b1_recommended": {
            "schedule": "constant_low",
            "peak": 5e-5,
            "min": 5e-5,
            "warmup": 10,
            "why": (
                "Lower than Stage A peak by 6×. Avoid re-warming to 3e-4 from an already-adapted STEP_400. "
                "Constant-low makes B1 drift attributable to data, not to a second cosine excursion."
            ),
        },
        "stage_b2_if_authorized": {
            "schedule": "cosine",
            "peak": 5e-5,
            "min": 1e-5,
            "warmup": 0,
            "why": "Only if B1 gates pass. Continue decaying; do not raise LR.",
        },
        "optimizer_creation": "FORBIDDEN_IN_THIS_PACKET",
        "no_optimizer_restore": True,
    }


def proposed_budget() -> dict[str, Any]:
    tokens_per_step = 4096
    b1_steps = 200
    b2_steps = 300
    return {
        "do_not_default_to_5M": True,
        "tokens_per_step": tokens_per_step,
        "B1_probe": {
            "steps": b1_steps,
            "tokens": b1_steps * tokens_per_step,
            "purpose": "Detect rank/NL/repetition drift before millions of unnecessary tokens.",
        },
        "B1_evaluation": "after every 25 steps (102,400 tokens) plus step 0 baseline on STEP_400",
        "B1_hard_stop": {
            "steps": b1_steps,
            "tokens": b1_steps * tokens_per_step,
            "or_first_hard_gate": True,
        },
        "B2_optional_continuation": {
            "requires": "Commander authorization after B1 review",
            "steps": b2_steps,
            "tokens": b2_steps * tokens_per_step,
            "eval_every_steps": 50,
        },
        "maximum_total_stage_b_tokens": (b1_steps + b2_steps) * tokens_per_step,
        "maximum_total_stage_b_steps": b1_steps + b2_steps,
        "early_stop_preferred_over_budget_exhaustion": True,
    }


def proposed_checkpoints() -> dict[str, Any]:
    return {
        "B1_weight_eval_cadence_steps": 25,
        "B1_weight_eval_cadence_tokens": 25 * 4096,
        "B2_weight_eval_cadence_steps": 50,
        "B2_weight_eval_cadence_tokens": 50 * 4096,
        "always_eval_step_zero_parent": True,
        "retain": [
            "STEP_400 parent pointer (immutable)",
            "every B1 eval checkpoint until Commander prunes",
            "running best foundation-rank checkpoint",
            "running best independent-NL NLL checkpoint among those that pass hard gates",
        ],
        "why_dense": "Stage A optimum was at step-400 of 1220. Sparse eval would miss a 100k–400k-token peak.",
        "optimizer_state_writes": "NOT IN THIS PACKET; if later authorized, write optimizer only at B1/B2 eval cadences, never between",
    }


def hard_gates() -> dict[str, Any]:
    parent = {
        "foundation_mean_rank": 2101.96875,
        "foundation_top5": 7,
        "independent_nl_nll": 7.180024635791779,
        "independent_nl_newline": 0.075,
        "independent_nl_doc_cont": 0.2,
        "independent_nl_repeat": 0.25,
        "independent_nl_tag_fragment": 0.0,
        "stage3_historical": "5/6",
        "stage3_delta_nll": 0.8484343801225934,
        "code_nll": 5.428938388824463,
        "json_nll": 4.803139686584473,
        "eos_argmax": 0.5416666666666666,
        "grad_max_stage_a": 3.1187660694122314,
    }
    return {
        "relative_to": "STEP_400_PROVISIONAL_PARENT",
        "parent_baselines": parent,
        "gates": [
            {
                "id": "FOUNDATION_RANK_DEGRADE",
                "stop_if": "mean_target_rank > 2417.26",
                "meaning": "15% worse than STEP_400 2101.97",
            },
            {
                "id": "FOUNDATION_TOP5_COLLAPSE",
                "stop_if": "top5 < 4",
                "meaning": "STEP_400 had 7; losing more than 3 of 40 is competence loss",
            },
            {
                "id": "INDEPENDENT_NL_NLL_WORSE",
                "stop_if": "natural_language_nll_mean > 7.330",
                "meaning": "STEP_400 7.180 + 0.150",
            },
            {
                "id": "INDEPENDENT_NL_NEWLINE",
                "stop_if": "NEWLINE_ATTRACTOR_RATE > 0.20",
                "meaning": "STEP_400 0.075; 1220 already 0.15",
            },
            {
                "id": "INDEPENDENT_NL_DOC_CONT",
                "stop_if": "DOCUMENT_CONTINUATION_ATTRACTOR_RATE > 0.35",
                "meaning": "STEP_400 0.20",
            },
            {
                "id": "REPETITION",
                "stop_if": "repeated_token_rate > 0.35",
                "meaning": "STEP_400 0.25; 1220 0.325",
            },
            {
                "id": "STAGE3_RETENTION",
                "stop_if": "historical_pass_count < 5 OR n_collapsed > 5 OR mean_wrim0_anchor_nll_delta > 1.15",
                "meaning": "STEP_400 was 5/6, collapse 3, delta 0.85; 1220 delta 1.01",
            },
            {
                "id": "NAN_INF",
                "stop_if": "any loss/grad NaN or Inf",
            },
            {
                "id": "GRAD_INSTABILITY",
                "stop_if": "grad_norm > 8.0",
                "meaning": "Stage A max 3.12; 8.0 is a hard ceiling not a target",
            },
            {
                "id": "TAG_CONTAMINATION",
                "stop_if": "independent_nl tag_fragment_rate > 0.0 OR foundation non_tag_prompt_tag_emissions > 1",
            },
            {
                "id": "CODE_COLLAPSE",
                "stop_if": "code_nll > 6.50",
                "meaning": "STEP_400 5.43; allow limited drift, not return toward WRIM-0 8.26",
            },
            {
                "id": "JSON_COLLAPSE",
                "stop_if": "json_nll > 6.00",
                "meaning": "STEP_400 4.80",
            },
            {
                "id": "EOS_COLLAPSE",
                "stop_if": "eos_argmax < 0.35 OR foundation EOS_GREEDY_STOP_COUNT == 0 after step 50",
                "meaning": "STEP_400 eos_argmax 0.542 and 3/4 greedy EOS stops",
            },
            {
                "id": "MEMORIZATION_LEAKAGE",
                "stop_if": "any frozen val pack string or ≥48-char span from independent NL / foundation / Stage3 / SFT val found in proposed train stream",
            },
            {
                "id": "LOSS_EXPLOSION",
                "stop_if": "train_loss > 12.0 after warmup",
            },
        ],
        "warn_not_stop": [
            "foundation mean_target_rank > 2200",
            "independent NL NLL improvement < 0.03 by B1 step 100",
            "code_nll > 5.80",
        ],
    }


def eval_stack() -> dict[str, Any]:
    return {
        "do_not_modify_frozen_eval_sets": True,
        "every_major_checkpoint": [
            "WRIM-FOUNDATION-EVAL-1",
            "WR-VAL-NL-INDEPENDENT-1-v1.0.0 (TRAIN_FORBIDDEN)",
            "Stage 3 observation (observe-only; not Stage3B)",
            "family NLL: role, code, JSON, genesis",
        ],
        "foundation_strategy": (
            "Same frozen WRIM-FOUNDATION-EVAL-1. Track mean_target_rank, top1/5/10, greedy_exact, "
            "newline/document attractors, EOS greedy stop, tag emissions. Compare to STEP_400 not to STEP_1220."
        ),
        "independent_nl_strategy": (
            "Same frozen 40 passages / 4656 tokens. Report mean NLL, NLL_AT_512, per-category NLL, "
            "newline/doc-cont/repeat/tag/tokenizer_loop/eos rates. Never fine-tune on it. Never pack it."
        ),
        "stage3_retention_strategy": (
            "Observe-only at B1 steps 0, 100, 200 and B2 50-step cadence. historical_binary, collapse count, "
            "anchor ΔNLL vs WRIM-0. No Stage3B training. No suite mutation."
        ),
        "family_nll_strategy": (
            "Reuse Stage A val packs for role/code/json/genesis. Do not use GENERAL_VAL as a natural-language "
            "proxy; it was genesis-aliased. Natural quality is independent NL, not genesis NLL."
        ),
        "coherent_continuation_diagnostic": {
            "id": "WR-DIAG-CONTINUE-CPT-B-v1 (DESIGN ONLY; DO NOT BUILD AS TRAIN DATA)",
            "uses_existing_greedy_from": [
                "WRIM-FOUNDATION-EVAL-1 greedy strings",
                "WR-VAL-NL-INDEPENDENT-1 greedy strings",
            ],
            "new_prompts": "optional later; must be TRAIN_FORBIDDEN and disjoint from CPT-2",
            "method": "categorical labels + countable rates; no scalar fake coherence score",
        },
    }


def greedy_probes() -> dict[str, Any]:
    return {
        "decoding": "greedy argmax, temperature=1 deterministic, no sampling, fixed max tokens 32, seed unused",
        "prompts": "frozen independent NL prefixes + foundation items; do not invent a scored rubric",
        "categories": [
            "prose_continuation",
            "code_intrusion",
            "markdown_intrusion",
            "path_intrusion",
            "repetition",
            "premature_eos",
            "document_continuation",
            "role_tag_contamination",
            "tokenizer_loop",
            "mixed",
        ],
        "detectors": {
            "code_intrusion": "count greedy strings containing const|export|function|import |from '|module.exports",
            "markdown_intrusion": "count leading ## or ``` or '* ' after newline in first 8 tokens",
            "path_intrusion": "count research-engine|app/api|lib/|docs/war-room",
            "repetition": "max consecutive identical token ≥8 OR trigram loop ≥4",
            "premature_eos": "EOS in first 4 generated tokens on a mid-sentence prefix",
            "document_continuation": "first generated token is NEWLINE_ID=112 or heading marker",
            "role_tag_contamination": "COMMANDER/ASSISTANT/SYSTEM ids or literal tag fragments",
            "tokenizer_loop": "existing tokenizer_loop_rate definition from independent NL eval",
            "prose_continuation": "none of the intrusion/repeat/tag/path/md detectors fire",
        },
        "reported_as": "counts and rates over 40 independent NL + 40 foundation items",
        "no_subjective_score": True,
    }


def cpt_vs_sft() -> dict[str, Any]:
    return {
        "CPT_STAGE_B_expected_to_learn": [
            "language statistics of diverse English",
            "natural continuation / next-token prose",
            "syntax of sentences and common document structure",
            "general domain structure (expository, narrative, dialogue without special tags)",
            "code structure (reduced share)",
            "JSON/structured syntax (reduced share)",
            "world/document patterns",
            "EOS as document end",
            "trace role-boundary token statistics (1%)",
        ],
        "FUTURE_SFT_expected_to_learn": [
            "instruction following",
            "Commander → assistant mapping as a task",
            "answer style",
            "task following",
            "structured response behavior",
            "tool/mode/capability protocols",
            "refusal/policy behavior",
        ],
        "do_not_mix": True,
        "instructional_prose_in_cpt_is_not_sft": (
            "Instructional documents describe a process in running English. They are not "
            "COMMANDER prompt / ASSISTANT target pairs and must not use SFT templates."
        ),
        "namespace": {
            "continued_pretraining": "WRIM1-CPT-*",
            "supervised_instruction": "WRIM1-RUN-*",
            "stage_b_if_authorized": PROPOSED_STAGE_B_CPT_RUN_ID,
            "do_not_reuse": RESERVED_SFT_RUN,
        },
    }


def success_failure() -> dict[str, Any]:
    return {
        "success_all_required_at_some_gated_checkpoint": [
            "independent NL mean NLL ≤ 7.10 (≤ STEP_400 7.180 − 0.08)",
            "independent NL newline ≤ 0.075",
            "independent NL repeated_token_rate ≤ 0.25",
            "independent NL tag_fragment_rate = 0.0",
            "code_intrusion_rate and markdown_intrusion_rate on independent NL greedy both strictly below STEP_400 measured rates",
            "at least 1/40 independent NL greedy labeled prose_continuation",
            "foundation mean_target_rank ≤ 2200",
            "foundation top5 ≥ 6",
            "Stage 3 historical ≥ 5/6",
            "code_nll ≤ 5.50",
            "json_nll ≤ 4.90",
            "eos_argmax ≥ 0.45",
            "no NaN/Inf",
        ],
        "not_required_for_cpt_success": [
            "greedy_exact > 0 on foundation",
            "instruction following",
            "Commander answer style",
            "canonical promotion",
            "Ra'el promotion",
        ],
        "failure_any": [
            "any hard gate fires",
            "B1 200 steps complete with independent NL NLL improvement < 0.03 AND no drop in code/markdown intrusion counts",
            "foundation rank > 15% worse than STEP_400",
            "independent NL worsens beyond +0.15 NLL",
            "Stage 3 historical < 5/6",
            "tag contamination on independent NL",
            "TRAIN_FORBIDDEN pack found in any proposed train stream",
        ],
        "promotion": "Even on success, parent remains PROVISIONAL until a separate Commander promotion decision. This packet does not promote.",
    }


def nl_targets() -> dict[str, Any]:
    return {
        "non_sft_language_goals": [
            "lower independent NL NLL vs STEP_400 7.180",
            "lower repeated-token rate vs 0.25 (do not regress toward 0.325)",
            "hold or lower newline attractor vs 0.075",
            "hold or lower document-continuation attractor vs 0.20",
            "more greedy strings classified prose_continuation",
            "sentence completion: mid-sentence prefix continues in English rather than heading/code",
            "fewer code/markdown/path intrusions on prose",
            "no tag-template leakage on independent NL",
        ],
        "do_not_require_instruction_following_from_cpt": True,
    }


def capacity_analysis() -> dict[str, Any]:
    return {
        "parameters": PARAMETER_COUNT,
        "architecture": ARCHITECTURE_ID,
        "separate_capacity_from_data": True,
        "data_training_limitation": (
            "Dominant for Stage A failure modes (code/md/path intrusion, genesis-aliased natural, post-400 rank drift). "
            "A 19.2M model already imitates whatever majority stream it sees."
        ),
        "capacity_limitation": (
            "Real ceiling on held-out fluency: independent NL PPL ~1310 at STEP_400; greedy_exact=0. "
            "Do not expect GPT-quality coherence from 19.2M. Do expect n-gram English if trained on n-gram English."
        ),
        "bigger_not_automatically_required": True,
        "dominant_blocker_now": "DATA_AND_TRAINING_MIX_NOT_MODEL_SIZE",
        "when_size_would_become_dominant": (
            "If B1 genuine-prose probe at 5e-5 fails to move independent NL NLL by ≥0.08 and intrusion rates stay flat, "
            "then capacity/tokenizer become the leading Commander question. Not before that measurement."
        ),
        "model_capacity_risk": "MEDIUM_FLUENCY_CEILING; LOW_AS_EXPLANATION_OF_CODE_INTRUSION",
    }


def design_report(verify: dict[str, Any], pointer_path: str, freeze_path: str) -> dict[str, Any]:
    return {
        "kind": "WRIM1_CPT_STAGE_B_DESIGN_REPORT",
        "created_at": utc_now(),
        "1_accepted_provisional_parent": PROVISIONAL_STAGE_B_PARENT,
        "2_parent_hash": EXPECTED_STEP_400,
        "parent_hash_live_verified": verify["step_400_hash_ok"],
        "3_validation_pack_identity_hashes": {
            "pack_id": INDEPENDENT_NL_PACK_ID,
            "PACK_HASH": INDEPENDENT_NL_PACK_HASH,
            "MANIFEST_HASH": INDEPENDENT_NL_MANIFEST_HASH,
            "TRAIN_FORBIDDEN": True,
            "live_pack_ok": verify["independent_nl_pack_ok"],
            "live_manifest_ok": verify["independent_nl_manifest_ok"],
            "freeze_record": freeze_path,
        },
        "4_stage_a_failure_mode_analysis": {
            "after_step_400": [
                "foundation mean rank worsened 2101.97 → 2310.56",
                "newline attractor on independent NL 0.075 → 0.15",
                "repetition 0.25 → 0.325",
                "corpus-style fragments strengthened (code/markdown/path)",
                "independent NL remained incoherent (NLL 7.18→7.15, Δ 0.027 not a language win)",
                "GENERAL_VAL_NLL aliased to genesis and is not an NL metric",
            ],
            "root_cause": root_cause_analysis(),
        },
        "5_capacity_analysis": capacity_analysis(),
        "6_corpus_mix_diagnosis": corpus_mix_diagnosis(),
        "7_proposed_WR_CORPUS_CPT_2_composition": proposed_corpus(),
        "8_proposed_source_quality_requirements": proposed_corpus()["source_quality_requirements"],
        "9_proposed_cpt_objective": proposed_objective(),
        "10_proposed_lr_schedule": proposed_lr(),
        "11_proposed_token_budget": proposed_budget(),
        "12_proposed_checkpoint_schedule": proposed_checkpoints(),
        "13_proposed_hard_stop_gates": hard_gates(),
        "14_foundation_evaluation_strategy": eval_stack()["foundation_strategy"],
        "15_independent_nl_evaluation_strategy": eval_stack()["independent_nl_strategy"],
        "16_stage_3_retention_strategy": eval_stack()["stage3_retention_strategy"],
        "17_repetition_strategy": {
            "metric": "repeated_token_rate on independent NL greedy + foundation heldout_repeated_token",
            "parent": 0.25,
            "warn": 0.30,
            "stop": 0.35,
            "training_mitigations_if_later_authorized": [
                "drop synthetic role from 10% to 1%",
                "dedup / near-dup",
                "constant-low LR",
                "stop at first rise ≥0.05 above parent",
            ],
        },
        "18_coherent_continuation_diagnostics": greedy_probes(),
        "19_tag_contamination_guard": {
            "independent_nl_tag_fragment_rate_must_remain": 0.0,
            "foundation_non_tag_prompt_tag_emissions_stop_if_gt": 1,
            "role_share_proposed": 0.01,
            "role_share_stage_a": 0.10,
        },
        "20_memorization_guard": {
            "pre_pack_leak_scan": True,
            "forbidden_packs": [
                INDEPENDENT_NL_PACK_ID,
                "WRIM-FOUNDATION-EVAL-1",
                "Stage 3 suite/addendum",
                "SFT validation splits",
            ],
            "exact_duplicates": 0,
            "span_window_chars": 48,
            "stop_if_any_hit_in_train_stream": True,
        },
        "21_cpt_vs_sft_boundary": cpt_vs_sft(),
        "22_proposed_stage_b_success_criteria": success_failure()["success_all_required_at_some_gated_checkpoint"],
        "23_proposed_stage_b_failure_criteria": success_failure()["failure_any"],
        "24_model_capacity_risk": capacity_analysis()["model_capacity_risk"],
        "25_training_performed": "NO",
        "26_optimizer_steps": 0,
        "27_checkpoints_modified": "NO",
        "28_canonical_modified": "NO",
        "29_stage_b_executed": "NO",
        "30_commander_authorization_required": "YES",
        "PROVISIONAL_STAGE_B_PARENT": PROVISIONAL_STAGE_B_PARENT,
        "PROVISIONAL_STAGE_B_PARENT_HASH": EXPECTED_STEP_400,
        "TRAINING_PERFORMED": "NO",
        "OPTIMIZER_STEPS": 0,
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "CHECKPOINTS_MODIFIED": "NO",
        "CANONICAL_PROMOTED": "NO",
        "COMMANDER_AUTHORIZATION_REQUIRED": "YES",
        "natural_language_targets": nl_targets(),
        "evaluation_stack": eval_stack(),
        "parent_pointer_path": pointer_path,
        "verify": {
            "step_400_hash_ok": verify["step_400_hash_ok"],
            "tokenizer_unchanged": verify["tokenizer_unchanged"],
            "wrim0_unchanged": verify["wrim0_unchanged"],
            "independent_nl_pack_ok": verify["independent_nl_pack_ok"],
            "independent_nl_manifest_ok": verify["independent_nl_manifest_ok"],
            "weights_copied": False,
            "optimizer_loaded": False,
            "authorize_env_present": verify["authorize_env_present"],
        },
        "governance": {
            "STAGE_B_EXECUTED": "NO",
            "SFT_EXECUTED": "NO",
            "RUN_000013_EXECUTED": "NO",
            "STAGE3B_EXECUTED": "NO",
            "WRIM_TRAINING_AUTHORIZATION": "OFF",
            "WRIM0_MODIFIED": "NO",
            "TOKENIZER_MODIFIED": "NO",
            "ARCHITECTURE_MODIFIED": "NO",
            "CANONICAL_PROMOTED": "NO",
            "CORPUS_CPT_2_BUILT": "NO",
        },
    }


def main() -> dict[str, Any]:
    if os.environ.get(AUTHORIZE_ENV_NAME):
        raise SystemExit(
            f"{AUTHORIZE_ENV_NAME} is set; refuse to run design freeze under a training-authorization env"
        )
    verify = verify_live_parent()
    if not verify["step_400_hash_ok"]:
        raise SystemExit(f"STEP_400 hash mismatch: {verify['step_400_live_hash']}")
    if not verify["tokenizer_unchanged"]:
        raise SystemExit("tokenizer hash changed; abort")
    if verify["wrim0_unchanged"] is False:
        raise SystemExit("WRIM-0 hash changed; abort")
    if (
        not verify["independent_nl_pack_ok"]
        or not verify["independent_nl_manifest_ok"]
        or not verify.get("independent_nl_passages_file_ok")
    ):
        raise SystemExit("independent NL pack/manifest hash mismatch; abort")

    pointer = parent_pointer(verify)
    freeze = val_pack_freeze(verify)
    ckpt_root = Path(LINUX_CKPT_ROOT)
    data_root = Path(LINUX_DATA_ROOT)
    pointer_path = ckpt_root / POINTER_FILENAME
    design_path = ckpt_root / DESIGN_REPORT_FILENAME
    freeze_ckpt = ckpt_root / VAL_PACK_FREEZE_FILENAME
    freeze_data = data_root / INDEPENDENT_NL_PACK_ID / VAL_PACK_FREEZE_FILENAME
    pointer_data = data_root / POINTER_FILENAME

    write_json(pointer_path, pointer)
    write_json(pointer_data, pointer)
    write_json(freeze_ckpt, freeze)
    write_json(freeze_data, freeze)
    report = design_report(verify, str(pointer_path), str(freeze_data))
    write_json(design_path, report)
    report_data = data_root / DESIGN_REPORT_FILENAME
    write_json(report_data, report)

    summary = {
        "ok": True,
        "pointer": str(pointer_path),
        "design_report": str(design_path),
        "val_pack_freeze": str(freeze_data),
        "PROVISIONAL_STAGE_B_PARENT": PROVISIONAL_STAGE_B_PARENT,
        "PROVISIONAL_STAGE_B_PARENT_HASH": EXPECTED_STEP_400,
        "TRAINING_PERFORMED": "NO",
        "OPTIMIZER_STEPS": 0,
        "STAGE_B_EXECUTED": "NO",
        "weights_copied": False,
        "corpus_built": False,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    main()
