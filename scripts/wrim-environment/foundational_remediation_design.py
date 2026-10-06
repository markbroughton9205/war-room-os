"""WRIM foundational remediation DESIGN compiler.

Zero optimizer steps. Does not train. Does not mutate WR-CORPUS or the tokenizer.
Source of truth: successful third-run foundational-root-cause.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DESIGN_ID = "WRIM1-NEBULA-FOUNDATIONAL-REMEDIATION-DESIGN-000001"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
AUDIT_ID = "WRIM1-NEBULA-FOUNDATIONAL-ROOT-CAUSE-000001"
TOKENS_PER_STEP = 4096
MINIMUM_DIAGNOSTIC = 4_096_000
PRACTICAL_DEVELOPMENT = 16_384_000
TARGET_FOUNDATION = 65_536_000
CHINCHILLA_20TPP = 384_343_040
PARAM_COUNT = 19_217_152


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def require_successful_audit(audit: dict[str, Any]) -> None:
    if audit.get("kind") != "WRIM_FOUNDATIONAL_GENERATION_ROOT_CAUSE_AUDIT":
        raise SystemExit("audit is not WRIM_FOUNDATIONAL_GENERATION_ROOT_CAUSE_AUDIT")
    if audit.get("final_classification") != "FOUNDATIONAL_ROOT_CAUSE_IDENTIFIED":
        raise SystemExit("refuses to design from a non-IDENTIFIED audit")
    if audit.get("readiness_class") != "F. MULTIPLE_FOUNDATIONAL_BLOCKERS":
        raise SystemExit("refuses to design from a mismatched readiness class")
    if audit.get("optimizer_steps_this_pass") != 0:
        raise SystemExit("source audit is not zero-step")
    if audit.get("sha_ok") is not True:
        raise SystemExit("source audit hashes not ok")
    if audit.get("scorer_oracle", {}).get("ok") is not True:
        raise SystemExit("source audit scorer oracle did not pass")


def measure_throughput(metrics_path: Path) -> dict[str, Any]:
    rows = []
    for line in metrics_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rows.append(json.loads(line))
    elapsed = [float(r["elapsed_s"]) for r in rows if "elapsed_s" in r]
    if not elapsed:
        raise SystemExit("RUN-000004 metrics.jsonl has no elapsed_s")
    steady = elapsed[1:] if len(elapsed) > 1 else elapsed
    median = statistics.median(steady)
    mean = statistics.mean(steady)
    ts = [r.get("timestamp") for r in rows]
    wall_s = None
    if ts and ts[0] and ts[-1]:
        t0 = datetime.fromisoformat(str(ts[0]).replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(str(ts[-1]).replace("Z", "+00:00"))
        wall_s = (t1 - t0).total_seconds()
    eval_gaps = []
    for a, b in zip(rows, rows[1:]):
        if not a.get("timestamp") or not b.get("timestamp"):
            continue
        gap = (
            datetime.fromisoformat(str(b["timestamp"]).replace("Z", "+00:00"))
            - datetime.fromisoformat(str(a["timestamp"]).replace("Z", "+00:00"))
        ).total_seconds()
        if gap > 20:
            eval_gaps.append(gap)
    eval_s = statistics.median(eval_gaps) if eval_gaps else None
    return {
        "source": str(metrics_path),
        "n_steps": len(rows),
        "tokens_trained": int(rows[-1]["tokens"]) if rows else 0,
        "elapsed_s_including_first": elapsed,
        "steady_elapsed_s_median": round(median, 4),
        "steady_elapsed_s_mean": round(mean, 4),
        "first_step_elapsed_s": round(elapsed[0], 4),
        "train_tokens_per_sec_median": round(TOKENS_PER_STEP / median, 1),
        "wall_clock_s_including_evals": wall_s,
        "compact_eval_gap_s_median": round(eval_s, 1) if eval_s is not None else None,
        "note": "elapsed_s is optimizer-step compute only. Timestamp gaps >20s are compact generation evals every 5 steps on RUN-000004.",
        "estimate": True,
    }


def blocker(
    blocker_id: str,
    category: str,
    evidence: str,
    severity: str,
    confidence: str,
    dependencies: list[str],
    must_fix_before_training: bool,
    can_fix_without_weight_update: bool,
    validation_required: str,
    ledger: str,
) -> dict[str, Any]:
    return {
        "BLOCKER_ID": blocker_id,
        "CATEGORY": category,
        "EVIDENCE": evidence,
        "SEVERITY": severity,
        "ROOT_CAUSE_CONFIDENCE": confidence,
        "DEPENDENCIES": dependencies,
        "MUST_FIX_BEFORE_TRAINING": must_fix_before_training,
        "CAN_FIX_WITHOUT_WEIGHT_UPDATE": can_fix_without_weight_update,
        "VALIDATION_REQUIRED": validation_required,
        "ledger": ledger,
    }


def build_ledger(audit: dict[str, Any]) -> dict[str, Any]:
    scale = audit["scale"]
    data = audit["data_format"]
    json_data = data["json"]
    packing = audit["packing"]
    decode = audit["decoding"]
    soft = audit["soft_stop"]
    oracle = audit["scorer_oracle"]
    readiness = audit["readiness"]
    step10 = audit["step10"]
    primary = [
        blocker(
            "B-FND-001",
            "FOUNDATIONAL_SCALE",
            f"WRIM-0 {scale['wrim0_training_tokens']} tokens / {scale['parameter_count']} params = {scale['tokens_per_parameter']} TPP; unique C0 {scale['wr_corpus_0_unique_train_tokens']}; {scale['corpus_equivalent_passes']} corpus-equivalent passes. Audit: enough_for_coherent_multi_sentence/instruction/json/stable_128/stable_256 all false.",
            "CRITICAL",
            "HIGH",
            [],
            False,
            False,
            "Recompute TPP and unique-token exposure after any future authorized run; do not use val loss as capability.",
            "PRIMARY",
        ),
        blocker(
            "B-OBJ-001",
            "OBJECTIVE",
            f"Predominant objective {data['predominant_objective']}. Record counts {data['objective_record_counts']}. Teacher-forced NLL can fall while generation stays non-JSON/non-instruction.",
            "CRITICAL",
            "HIGH",
            ["B-FND-001"],
            False,
            False,
            "Keep document-LM vs prompt-masked SFT as separate phases. Do not SFT-first.",
            "PRIMARY",
        ),
        blocker(
            "B-FMT-001",
            "INSTRUCTION_FORMAT",
            f"INSTRUCTION_RESPONSE records = {data['objective_record_counts'].get('INSTRUCTION_RESPONSE')}; behavior family 28/8477. Prompt→response is not the training majority.",
            "HIGH",
            "HIGH",
            ["B-OBJ-001"],
            False,
            False,
            "SFT dataset must be classified PROPOSED_TRAINING_DATA and leak-scanned; not merged into WR-CORPUS in this program without a later Commander pass.",
            "PRIMARY",
        ),
        blocker(
            "B-FMT-002",
            "STRUCTURED_OUTPUT",
            f"instruction_conditioned_json_records = {json_data['instruction_conditioned_json_records']}. JSON family records are raw documents. Greedy json_valid false on WRIM-0/STEP10/STEP25. Sampling did not produce valid JSON.",
            "HIGH",
            "HIGH",
            ["B-OBJ-001", "B-FMT-001"],
            False,
            False,
            "JSON capability gate only after instruction-conditioned examples exist and F1 generation uniqueness/looping gate passes.",
            "PRIMARY",
        ),
        blocker(
            "B-PCK-001",
            "PACKING",
            f"DOCUMENT_MAJOR_CONTIGUOUS produced domain bursts; stream sha match {packing.get('stream_sha_match_persisted')}. Loss 8.054 prose → 8.897 json 100% → 4.220 WR-CORPUS-0 100%. Low loss is literary rehearsal, not generation skill.",
            "HIGH",
            "HIGH",
            [],
            True,
            True,
            "Next official packer must be deficit-interleave. Rebuild stream SHA before any authorized step. Do not mutate the frozen 000004 stream.",
            "PRIMARY",
        ),
        blocker(
            "B-CTL-001",
            "TRAINING_CONTROL",
            f"Soft-stop class {soft['implementation_class']}. Coded rule ignored unique256; floor-at-zero JSON/instruction/entity cannot fire. Step 15 spirit would stop; coded did not. Validator coverage failed.",
            "HIGH",
            "HIGH",
            [],
            True,
            True,
            "Machine-enforce unique256, no silent continue, validator recomputes hits from checkpoint evals before declaring abort_occurred.",
            "PRIMARY",
        ),
    ]
    secondary = [
        blocker(
            "B-CUR-001",
            "CURRICULUM",
            "Domain-order / document-major bursts are the mechanism behind STEP10's one-axis looping wiggle and later looping rise on C0 binge. Secondary to packing.",
            "MEDIUM",
            "HIGH",
            ["B-PCK-001"],
            True,
            True,
            "Interleave families; Alice cap remains; source caps on easy C0 rehearsal.",
            "SECONDARY",
        ),
        blocker(
            "B-REP-001",
            "OTHER",
            f"Parent looping=14 unique128=0.267 unique256=0.171; STEP25 looping=17 unique128=0.234 unique256=0.147. Instruction greedy degenerates to {decode['cross_checkpoint']['instruction_first_words']['WRIM-0']}. Encoded in weights.",
            "HIGH",
            "HIGH",
            ["B-FND-001", "B-OBJ-001", "B-PCK-001"],
            False,
            False,
            "Long-form/repetition gates on unique128/256, looping, collapse, repeated n-grams. Decoding tricks are not the fix.",
            "SECONDARY",
        ),
        blocker(
            "B-COR-001",
            "CORPUS_SCALE",
            f"WR-CORPUS-0 unique train tokens {scale['wr_corpus_0_unique_train_tokens']} with {scale['repeated_token_exposure']} repeated exposure. WR-CORPUS-1-HARDENED train records {scale['wr_corpus_1_train_records']}. Existing unique mass cannot reach Chinchilla 20 TPP.",
            "MEDIUM",
            "HIGH",
            ["B-FND-001"],
            False,
            True,
            "F1/F-diagnostic may reuse existing C0+C1. Target foundation requires separately classified PROPOSED_TRAINING_DATA. No silent WR-CORPUS merge.",
            "SECONDARY",
        ),
    ]
    non_blockers = [
        blocker(
            "N-EVAL-001",
            "EVALUATION",
            f"Scorer oracle {oracle['n_pass']}/{oracle['n_cases']} pass. Audit: F_SCORER_NOT_THE_BOTTLENECK. Do not retune thresholds because WRIM fails.",
            "INFO",
            "HIGH",
            [],
            False,
            True,
            "Keep frozen DEV/S3A scorers. Add axis separation, do not loosen JSON/instruction zeros.",
            "NON_BLOCKER",
        ),
        blocker(
            "N-DEC-001",
            "DECODING",
            decode["cross_checkpoint"]["finding"],
            "INFO",
            "HIGH",
            [],
            False,
            True,
            "Official eval decoder remains greedy. Sampling diagnostic only.",
            "NON_BLOCKER",
        ),
        blocker(
            "N-ARC-001",
            "ARCHITECTURE",
            readiness["architecture_note"],
            "INFO",
            "HIGH",
            [],
            False,
            True,
            "Keep WRIM-G-20M-v1-option-A. No sparse experts. No Qwen replacement.",
            "NON_BLOCKER",
        ),
        blocker(
            "N-STP-001",
            "OTHER",
            f"STEP10 promotion={step10['promotion']}. {step10['explanation']}",
            "INFO",
            "HIGH",
            ["B-PCK-001"],
            False,
            True,
            "Do not promote STEP10/STEP25/interpolants.",
            "NON_BLOCKER",
        ),
        blocker(
            "N-TOOL-001",
            "OTHER",
            "First two audit attempts failed as tooling: CUDA multinomial with CPU generator; then checkpoint key mismatch (WRIM-0 dump uses model.* keys; 000004 checkpoints use raw torch keys). Not model outcomes.",
            "INFO",
            "HIGH",
            [],
            False,
            True,
            "Keep CPU multinomial for CUDA sampling diagnostics; dual key-loader remains inference-only.",
            "NON_BLOCKER",
        ),
        blocker(
            "N-TOK-001",
            "OTHER",
            "Tokenizer SHA frozen. Audit measured JSON punctuation token probabilities (lbrace/rbrace/quote/colon) so those tokens exist. JSON=0 is not a missing-token problem. Vocab 15126 is small for world/technical coverage.",
            "INFO",
            "MEDIUM",
            [],
            False,
            True,
            "No tokenizer mutation this program. Future redesign is optional and unauthorized now.",
            "NON_BLOCKER",
        ),
    ]
    return {
        "PRIMARY": primary,
        "SECONDARY": secondary,
        "NON_BLOCKERS": non_blockers,
        "must_fix_before_any_optimizer_step": ["B-PCK-001", "B-CTL-001"],
        "must_exist_as_design_before_auth_but_need_weights_to_clear": ["B-FND-001", "B-OBJ-001", "B-FMT-001", "B-FMT-002", "B-REP-001"],
        "evidence_backed": True,
        "source_audit_id": AUDIT_ID,
        "source_readiness_blockers": readiness.get("blockers"),
    }


def corpus_requirements() -> dict[str, Any]:
    foundational = [
        {
            "category": "coherent_natural_prose",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.25,
            "approx_tokens_at_target_foundation": int(0.25 * TARGET_FOUNDATION),
            "format": "document continuation; paragraph/chapter boundaries preserved; no chat wrapper required",
            "quality": "grammatical multi-sentence English; no boilerplate dump loops",
            "duplication_limit": "no document >3 epoch-equivalent exposures per 16M-token window; Alice-class literary cap 3%",
            "contamination_exclusions": ["WRIM-EVAL-S3-*", "WRIM-EVAL-S3A-*", "WRIM-DEV-S3A-COR-000001", "CAP-EVAL-0"],
            "provenance": "existing WR-CORPUS-0/C1 or later PROPOSED_TRAINING_DATA with recorded source path; not silently merged",
        },
        {
            "category": "technical_prose",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.15,
            "approx_tokens_at_target_foundation": int(0.15 * TARGET_FOUNDATION),
            "format": "manuals, design notes, specs as documents",
            "quality": "complete sentences; headings allowed; not token-shuffled",
            "duplication_limit": "same as prose",
            "contamination_exclusions": ["held-out eval items"],
            "provenance": "PROPOSED_TRAINING_DATA if beyond C1",
        },
        {
            "category": "code",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.20,
            "approx_tokens_at_target_foundation": int(0.20 * TARGET_FOUNDATION),
            "format": "contiguous file/function excerpts; language-modeling, not instruction",
            "quality": "parseable; skip minified one-liners as majority mass",
            "duplication_limit": "near-duplicate file cap 2%",
            "contamination_exclusions": ["eval code prompts"],
            "provenance": "C1 code family for F1; additional code is PROPOSED_TRAINING_DATA",
        },
        {
            "category": "dialogue_question_answer_documents",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.08,
            "approx_tokens_at_target_foundation": int(0.08 * TARGET_FOUNDATION),
            "format": "natural Q/A or dialogue as documents, NOT prompt-masked SFT",
            "quality": "question and answer both present in the same document",
            "duplication_limit": "template-clone cap 1%",
            "contamination_exclusions": ["held-out instruction eval"],
            "provenance": "PROPOSED_TRAINING_DATA; existing C1 has almost none",
        },
        {
            "category": "raw_structured_json_csv_as_documents",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.08,
            "approx_tokens_at_target_foundation": int(0.08 * TARGET_FOUNDATION),
            "format": "raw JSON/CSV documents for syntax familiarity only",
            "quality": "valid JSON/CSV; not JSX mis-tagged as JSON",
            "duplication_limit": "do not binge 100% JSON steps",
            "contamination_exclusions": ["instruction JSON eval items"],
            "provenance": "C1 json family for F1 after heuristic cleanup in a later data pass; not this pass",
        },
        {
            "category": "long_form_continuity",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.12,
            "approx_tokens_at_target_foundation": int(0.12 * TARGET_FOUNDATION),
            "format": "documents >=256 tokens with low n-gram repetition",
            "quality": "unique-ratio of source text itself high; no copy-loop pages",
            "duplication_limit": "excerpt overlap <0.2 Jaccard across packed units",
            "contamination_exclusions": ["long-form eval stems"],
            "provenance": "C0 literary + later proposed long documents",
        },
        {
            "category": "scientific_technical_knowledge",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.07,
            "approx_tokens_at_target_foundation": int(0.07 * TARGET_FOUNDATION),
            "format": "expository documents",
            "quality": "source-attributed; not eval-set paraphrases",
            "duplication_limit": "standard",
            "contamination_exclusions": ["factual probe items once authored"],
            "provenance": "PROPOSED_TRAINING_DATA only",
        },
        {
            "category": "general_world_knowledge",
            "class": "FOUNDATIONAL_PRETRAINING_DATA",
            "target_proportion": 0.05,
            "approx_tokens_at_target_foundation": int(0.05 * TARGET_FOUNDATION),
            "format": "expository documents",
            "quality": "non-fictional; dated where relevant",
            "duplication_limit": "standard",
            "contamination_exclusions": ["factual probe items once authored"],
            "provenance": "PROPOSED_TRAINING_DATA only",
        },
    ]
    sft = [
        {
            "category": "instructions",
            "class": "SUPERVISED_INSTRUCTION_DATA",
            "target_proportion": 0.35,
            "approx_tokens_at_sft_pilot": 200_000,
            "format": "prompt→response with explicit boundary tokens; loss masked on prompt",
            "quality": "single clear constraint; short gold responses for early SFT",
            "duplication_limit": "no eval-item paraphrase",
            "contamination_exclusions": ["WRIM-EVAL-S3A-*", "WRIM-DEV-S3A-COR-000001"],
            "provenance": "PROPOSED_TRAINING_DATA; not merged into WR-CORPUS",
        },
        {
            "category": "instruction_conditioned_json",
            "class": "SUPERVISED_INSTRUCTION_DATA",
            "target_proportion": 0.25,
            "approx_tokens_at_sft_pilot": 150_000,
            "format": "SCHEMA / CONSTRAINT then VALID JSON RESPONSE",
            "quality": "parseable JSON; required keys present",
            "duplication_limit": "schema-clone cap 5%",
            "contamination_exclusions": ["dev-json-* eval items"],
            "provenance": "PROPOSED_TRAINING_DATA",
        },
        {
            "category": "kv_list_csv",
            "class": "SUPERVISED_INSTRUCTION_DATA",
            "target_proportion": 0.15,
            "approx_tokens_at_sft_pilot": 90_000,
            "format": "TASK then constrained KV/list/CSV",
            "quality": "scorer-oracle-positive gold",
            "duplication_limit": "standard",
            "contamination_exclusions": ["dev-kv / list / csv oracles"],
            "provenance": "PROPOSED_TRAINING_DATA",
        },
        {
            "category": "long_form_anti_repetition_sft",
            "class": "SUPERVISED_INSTRUCTION_DATA",
            "target_proportion": 0.15,
            "approx_tokens_at_sft_pilot": 90_000,
            "format": "write N tokens without looping; gold unique-ratio high",
            "quality": "non-looping 128 and 256 gold",
            "duplication_limit": "standard",
            "contamination_exclusions": ["long-form eval stems"],
            "provenance": "PROPOSED_TRAINING_DATA",
        },
        {
            "category": "reasoning_style_task_examples",
            "class": "SUPERVISED_INSTRUCTION_DATA",
            "target_proportion": 0.10,
            "approx_tokens_at_sft_pilot": 60_000,
            "format": "QUESTION / ANSWER; no hidden chain-of-thought dump if policy forbids it",
            "quality": "answer-final; brief supporting prose allowed",
            "duplication_limit": "standard",
            "contamination_exclusions": ["instruction eval"],
            "provenance": "PROPOSED_TRAINING_DATA",
        },
    ]
    return {
        "wr_corpus_mutation_authorized": False,
        "foundational_vs_sft": "NOT_INTERCHANGEABLE",
        "f1_uses_existing_c0_c1_only": True,
        "target_foundation_requires_proposed_training_data": True,
        "FOUNDATIONAL_PRETRAINING_DATA": foundational,
        "SUPERVISED_INSTRUCTION_DATA": sft,
        "existing_c1_is_not_an_instruction_curriculum": True,
        "raw_json_documents_are_not_json_instruction": True,
    }


def sft_format_spec() -> dict[str, Any]:
    return {
        "authorized_this_pass": False,
        "dataset_generated": False,
        "merged_into_wr_corpus": False,
        "response_only_loss_masking": True,
        "boundary_tokens": {
            "bos": "<|bos|>",
            "system": "<|system|>",
            "user": "<|commander|>",
            "assistant": "<|assistant|>",
            "eos": "<|eos|>",
            "note": "Match existing behavior_example wrappers already present in C1 behavior (28 records). Do not invent a second chat dialect.",
        },
        "examples_design_only": [
            {
                "kind": "USER_REQUEST / ASSISTANT_RESPONSE",
                "prompt": "<|bos|>\n<|system|>\nYou are WRIM. Answer only from the request.\n<|commander|>\nName the river in one word.\n<|assistant|>\n",
                "response": "Thames\n<|eos|>",
                "loss_on": "response tokens only",
            },
            {
                "kind": "QUESTION / ANSWER",
                "prompt": "<|commander|>\nHow many eights are in forty? Answer with one English number-word.\n<|assistant|>\n",
                "response": "five\n<|eos|>",
                "loss_on": "response tokens only",
            },
            {
                "kind": "TASK / RESPONSE",
                "prompt": "<|commander|>\nList three quay tags as a bullet list.\n<|assistant|>\n",
                "response": "- north-lamp\n- crate-blue\n- piling-2\n<|eos|>",
                "loss_on": "response tokens only",
            },
            {
                "kind": "SCHEMA / VALID_JSON",
                "prompt": "<|commander|>\nReturn a single JSON object with keys quay_tag and crate_mass. No other keys.\n<|assistant|>\n",
                "response": "{\"quay_tag\":\"north-lamp\",\"crate_mass\":12}\n<|eos|>",
                "loss_on": "response tokens only",
            },
            {
                "kind": "CONSTRAINT / COMPLIANT_RESPONSE",
                "prompt": "<|commander|>\nUse colon lines only.\nquay_tag:\ncrate_mass:\n<|assistant|>\n",
                "response": "quay_tag: north-lamp\ncrate_mass: 12\n<|eos|>",
                "loss_on": "response tokens only",
            },
        ],
        "held_out_instruction_eval": "Frozen WRIM-EVAL-S3A-* and WRIM-DEV-S3A-COR-000001 remain evaluation-only. New SFT items leak-scan against them. Do not train on oracle fixtures.",
        "starts_only_after": "F1/practical generation uniqueness/looping gate, not after val-loss improvement alone",
    }


def packing_design() -> dict[str, Any]:
    return {
        "frozen_000004_stream_untouched": True,
        "document_major_contiguous": "REPLACE_FOR_NEXT_OFFICIAL_RUN",
        "next_official_packing": "DEFICIT_INTERLEAVE_FAMILIES",
        "document_major_allowed_later": "Only as an optional long-document phase AFTER interleaved packing has passed the diagnostic generation gate. Not the default.",
        "rules": {
            "document_boundaries": "pack contiguous excerpts; do not token-shuffle; preserve unit spans for step→domain maps",
            "domain_interleaving": "deficit-interleave wr_corpus_0 / prose / code / json / behavior each step toward target mix",
            "randomized_ordering": "seeded family pick, not a single-document binge",
            "source_caps": "Alice-class literary <=3%; no 100% json or 100% C0 steps in F1",
            "repetition_caps": "epoch reuse of existing unique tokens allowed; log corpus-equivalent passes",
            "curriculum_staging": "F-diagnostic and F-practical: interleaved CLM. SFT examples appear only in the SFT phase, not sprinkled as 4% behavior hoping JSON appears.",
            "long_document_handling": "bounded contiguous excerpts up to context 512; remainder queued, not dropped silently",
            "code_prose_balance": "avoid 100% code bursts that snap loss without teaching generation",
            "instruction_example_placement": "F1 may include existing 28 behavior records at <=4% interleaved; that is not an SFT curriculum",
            "structured_output_placement": "raw JSON documents interleaved at a cap, never as a 100% domain binge",
        },
    }


def phases() -> list[dict[str, Any]]:
    def phase(**kwargs: Any) -> dict[str, Any]:
        return kwargs

    return [
        phase(
            id="P0_FOUNDATION_REMEDIATION_DESIGN",
            purpose="Lock evidence-backed remediation design. No optimizer.",
            input="Successful third-run foundational audit",
            authorized_changes="Design artifacts and validators only",
            token_budget_range="0",
            checkpoint_cadence="n/a",
            evaluations="ingest audit + scorer oracle already PASS",
            success_gates="FOUNDATIONAL_REMEDIATION_DESIGN_READY; TRAINING_AUTHORIZATION remains OFF",
            abort_gates="If source audit classification is not IDENTIFIED",
            output="This design report",
            next_gate_condition="Commander authorization still required before P2",
            status="THIS_PASS",
        ),
        phase(
            id="P1_DATA_READINESS_GATE",
            purpose="Inventory existing C0+C1; classify any new mass as PROPOSED_TRAINING_DATA; implement deficit-interleave packer without mutating WR-CORPUS records",
            input="WR-CORPUS-0 + WR-CORPUS-1-HARDENED + this design",
            authorized_changes="Packer/code/validators only unless a later Commander pass authorizes proposed-data import",
            token_budget_range="0 training tokens",
            checkpoint_cadence="n/a",
            evaluations="packer mix vs target; leakage scan; stream SHA; unit_spans present",
            success_gates="No 100% domain binge in a 25-step dry reconstruction; eval exclusions intact; WR-CORPUS hashes unchanged",
            abort_gates="Any WR-CORPUS or tokenizer mutation; packing still DOCUMENT_MAJOR_CONTIGUOUS as default",
            output="Packer ready + data ledger (no merge)",
            next_gate_condition="P2 requires separate Commander training authorization",
        ),
        phase(
            id="P2_BASE_PRETRAINING_PILOT",
            purpose="MINIMUM DIAGNOSTIC SCALE: test whether interleaved CLM from WRIM-0 moves looping/unique128 without claiming JSON",
            input="WRIM-0 frozen parent; existing C0+C1; new packer",
            authorized_changes="Optimizer only after Commander auth. Fresh AdamW. Parent WRIM-0 only.",
            token_budget_range=f"{MINIMUM_DIAGNOSTIC} tokens (~{MINIMUM_DIAGNOSTIC // TOKENS_PER_STEP} steps)",
            checkpoint_cadence="every 100 steps; compact gen every 200",
            evaluations="val NLL, KL/retention, looping, unique128/256, collapse, JSON/instruction recorded but JSON not required to leave 0",
            success_gates="Retention bands hold; looping <= parent-2 OR unique128 +>=0.03; unique256 does not drop >=0.05 with looping increase",
            abort_gates="Hard: ΔNLL>0.105, KL>0.018, val0>parent, CAP<=3, special-token rate. Soft: >=2 generation degradations including unique256; halt after checkpoint",
            output="TEST_ONLY diagnostic checkpoints",
            next_gate_condition="P3 generation gate on the diagnostic ckpt, not val-loss alone",
        ),
        phase(
            id="P3_FOUNDATIONAL_GENERATION_GATE",
            purpose="Decide whether diagnostic CLM produced a real generation movement",
            input="P2 checkpoints + frozen evals",
            authorized_changes="Eval/report only",
            token_budget_range="0",
            checkpoint_cadence="n/a",
            evaluations="Same DEV compact suite; greedy decoder",
            success_gates="Two-axis generation movement vs WRIM-0; JSON may remain 0",
            abort_gates="Only val improved; or STEP-like one-axis wiggle; or JSON treated as success",
            output="GO/NO-GO for P4",
            next_gate_condition="GO required before expansion",
        ),
        phase(
            id="P4_FOUNDATIONAL_TRAINING_EXPANSION",
            purpose="PRACTICAL DEVELOPMENT SCALE on existing C0+C1 interleaved CLM",
            input="Winning P2/P3 parent (or WRIM-0 if P2 was only a packer smoke and Commander restarts from WRIM-0)",
            authorized_changes="Optimizer after a new Commander auth",
            token_budget_range=f"{PRACTICAL_DEVELOPMENT} tokens (~{PRACTICAL_DEVELOPMENT // TOKENS_PER_STEP} steps)",
            checkpoint_cadence="every 100 steps; compact gen every 200",
            evaluations="retention + generation uniqueness/looping/collapse; JSON still not required to leave 0",
            success_gates="Stable 128 unique-ratio improvement vs WRIM-0; looping reduced; retention holds",
            abort_gates="Same hard/soft as P2; silent continue forbidden",
            output="TEST_ONLY expanded base",
            next_gate_condition="Generation gate pass before any SFT",
        ),
        phase(
            id="P5_INSTRUCTION_SFT_PILOT",
            purpose="Prompt-masked SFT on PROPOSED_TRAINING_DATA after a mature-enough base",
            input="P4 parent that passed generation uniqueness/looping",
            authorized_changes="Optimizer after Commander auth; proposed SFT data still not merged into WR-CORPUS",
            token_budget_range="50k–400k response tokens (design range; not authorized)",
            checkpoint_cadence="every 50 steps",
            evaluations="instruction scorer, JSON/KV/list/CSV, retention",
            success_gates="Instruction >0 on held-out DEV; retention holds",
            abort_gates="Retention break; collapse; eval leakage",
            output="TEST_ONLY SFT ckpt",
            next_gate_condition="P6 structured-output gate",
        ),
        phase(
            id="P6_STRUCTURED_OUTPUT_GATE",
            purpose="Require instruction-conditioned JSON/KV/list/CSV success",
            input="P5 ckpt",
            authorized_changes="Eval only unless a later SFT continuation is authorized",
            token_budget_range="0 unless continuation authorized",
            checkpoint_cadence="n/a",
            evaluations="json_valid, required keys, array length, KV, list, CSV oracles",
            success_gates="Held-out JSON valid >0 with required keys; scorers unchanged",
            abort_gates="JSON still 0 after a completed SFT pilot that actually contained instruction-conditioned JSON",
            output="GO/NO-GO",
            next_gate_condition="P7",
        ),
        phase(
            id="P7_LONGFORM_REPETITION_GATE",
            purpose="128/256/512 continuity and anti-loop",
            input="SFT or expanded-base ckpt that passed P6 or a documented exception",
            authorized_changes="Eval; optional later anti-rep SFT continuation",
            token_budget_range="0 unless continuation authorized",
            checkpoint_cadence="n/a",
            evaluations="unique128/256/512, looping, collapse, repeated n-grams",
            success_gates="unique128 and unique256 improved vs WRIM-0; looping <= parent-2; collapse not worsened",
            abort_gates="512-only tricks; decoding penalty used as official eval",
            output="GO/NO-GO",
            next_gate_condition="Only then consider STAGE3B under a separate Commander pass",
        ),
        phase(
            id="P8_STAGE3B_CONSIDERATION",
            purpose="Not a design to run STAGE3B. Placeholder gate only.",
            input="P3–P7 all GO",
            authorized_changes="NONE this program",
            token_budget_range="0",
            checkpoint_cadence="n/a",
            evaluations="n/a",
            success_gates="n/a",
            abort_gates="STAGE3B remains NO until a future Commander authorization",
            output="STAGE3B still NO",
            next_gate_condition="Separate roadmap authorization",
        ),
    ]


def compute_estimates(tp: dict[str, Any]) -> dict[str, Any]:
    step_s = float(tp["steady_elapsed_s_median"])
    eval_s = float(tp["compact_eval_gap_s_median"] or 56.0)
    ckpt_bytes_est = PARAM_COUNT * 4  # fp32 weights only
    def scale_block(name: str, tokens: int, eval_every: int) -> dict[str, Any]:
        steps = tokens // TOKENS_PER_STEP
        train_s = steps * step_s
        n_eval = max(0, steps // eval_every)
        eval_total = n_eval * eval_s
        return {
            "name": name,
            "tokens": tokens,
            "optimizer_steps": steps,
            "train_wall_s_est": round(train_s, 1),
            "eval_count_est": n_eval,
            "eval_wall_s_est": round(eval_total, 1),
            "total_wall_min_est": round((train_s + eval_total) / 60.0, 1),
            "checkpoint_fp32_mb_each_est": round(ckpt_bytes_est / 1e6, 1),
            "checkpoint_count_if_every_100": steps // 100,
            "checkpoint_storage_mb_est": round((steps // 100) * ckpt_bytes_est / 1e6, 1),
            "temporary_stream_mb_est": round(tokens * 2 / 1e6, 1),
            "estimate": True,
        }
    return {
        "measured_from": "WRIM1-RUN-000004 metrics.jsonl elapsed_s + timestamp eval gaps",
        "tokens_per_step": TOKENS_PER_STEP,
        "steady_step_s_median": step_s,
        "train_tokens_per_sec_median": tp["train_tokens_per_sec_median"],
        "compact_eval_s_median": eval_s,
        "scales": [
            scale_block("MINIMUM_DIAGNOSTIC", MINIMUM_DIAGNOSTIC, 200),
            scale_block("PRACTICAL_DEVELOPMENT", PRACTICAL_DEVELOPMENT, 200),
            scale_block("TARGET_FOUNDATION", TARGET_FOUNDATION, 200),
        ],
        "none_authorized": True,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audit", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--metrics", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()
    audit_path = Path(args.audit)
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    require_successful_audit(audit)
    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    sha_ok = parent_sha == PARENT_SHA and tok_sha == TOKENIZER_SHA
    if not sha_ok:
        raise SystemExit(f"hash mismatch parent={parent_sha} tok={tok_sha}")
    tp = measure_throughput(Path(args.metrics))
    scale = audit["scale"]
    ledger = build_ledger(audit)
    strategy = audit.get("strategy") or {}
    payload = {
        "ok": True,
        "kind": "WRIM_FOUNDATIONAL_REMEDIATION_DESIGN",
        "design_id": DESIGN_ID,
        "final_classification": "FOUNDATIONAL_REMEDIATION_DESIGN_READY",
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "source_of_truth": {
            "audit_id": audit.get("audit_id"),
            "audit_kind": audit.get("kind"),
            "audit_final_classification": audit.get("final_classification"),
            "readiness_class": audit.get("readiness_class"),
            "audit_path": str(audit_path),
            "audit_start": audit.get("start_timestamp"),
            "audit_end": audit.get("end_timestamp"),
            "ignored_failed_attempts": [
                {
                    "attempt": 1,
                    "class": "AUDIT_TOOLING_DEFECT",
                    "error": "RuntimeError: Expected a 'cuda' device type for generator but found 'cpu'",
                    "not_a_model_outcome": True,
                },
                {
                    "attempt": 2,
                    "class": "AUDIT_TOOLING_DEFECT",
                    "error": "RuntimeError: architecture key mismatch",
                    "not_a_model_outcome": True,
                },
            ],
            "successful_attempt": 3,
        },
        "extracted_findings": {
            "parameter_count": scale["parameter_count"],
            "wrim0_optimizer_steps": scale["wrim0_optimizer_steps"],
            "wrim0_training_tokens": scale["wrim0_training_tokens"],
            "tokens_per_parameter": scale["tokens_per_parameter"],
            "unique_train_tokens_c0": scale["wr_corpus_0_unique_train_tokens"],
            "repeated_token_exposure": scale["repeated_token_exposure"],
            "corpus_equivalent_passes": scale["corpus_equivalent_passes"],
            "wr_corpus_1_train_records": scale["wr_corpus_1_train_records"],
            "can_predict_tokens": scale["can_predict_tokens"],
            "can_generate_useful_responses": scale["can_generate_useful_responses"],
            "enough_for_coherent_multi_sentence": scale["enough_for_coherent_multi_sentence"],
            "enough_for_instruction_following": scale["enough_for_instruction_following"],
            "enough_for_json_generation": scale["enough_for_json_generation"],
            "enough_for_stable_128": scale["enough_for_stable_128"],
            "enough_for_stable_256": scale["enough_for_stable_256"],
            "predominant_objective": audit["data_format"]["predominant_objective"],
            "instruction_response_records": audit["data_format"]["objective_record_counts"].get("INSTRUCTION_RESPONSE"),
            "instruction_conditioned_json_records": audit["data_format"]["json"]["instruction_conditioned_json_records"],
            "packing": "DOCUMENT_MAJOR_CONTIGUOUS",
            "packing_finding": audit["packing"].get("finding"),
            "decoding_finding": audit["decoding"]["cross_checkpoint"]["finding"],
            "json_valid_greedy": audit["decoding"]["cross_checkpoint"]["json_valid_greedy"],
            "scorer_oracle_ok": audit["scorer_oracle"]["ok"],
            "scorer_n_pass": audit["scorer_oracle"]["n_pass"],
            "soft_stop_class": audit["soft_stop"]["implementation_class"],
            "step15_coded_would_stop": audit["soft_stop"]["step15_coded_would_stop"],
            "step15_spirit_would_stop": audit["soft_stop"]["step15_spirit_would_stop"],
            "step10_promotion": audit["step10"]["promotion"],
            "architecture_limited_primary": audit["readiness"]["architecture_limited_primary"],
            "audit_strategy_direction": strategy.get("direction"),
        },
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "sha_ok": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "blocker_ledger": ledger,
        "training_scale": {
            "materially_undertrained_as_base": True,
            "parameter_count": PARAM_COUNT,
            "wrim0_training_tokens": scale["wrim0_training_tokens"],
            "tokens_per_parameter": scale["tokens_per_parameter"],
            "unique_token_exposure": scale["wr_corpus_0_unique_train_tokens"],
            "repeated_exposure": scale["repeated_token_exposure"],
            "current_corpus_size": {
                "wr_corpus_0_unique_train_tokens": scale["wr_corpus_0_unique_train_tokens"],
                "wr_corpus_1_train_records": scale["wr_corpus_1_train_records"],
            },
            "corpus_equivalent_passes": scale["corpus_equivalent_passes"],
            "realistic_capability_expectation": "Token prediction on repeated literary/code documents. Not coherent multi-sentence generation, instruction following, JSON, or stable 128/256 generation.",
            "MINIMUM_DIAGNOSTIC_SCALE": {
                "tokens": MINIMUM_DIAGNOSTIC,
                "steps_at_4096": MINIMUM_DIAGNOSTIC // TOKENS_PER_STEP,
                "tpp_this_run": round(MINIMUM_DIAGNOSTIC / PARAM_COUNT, 3),
                "cumulative_tpp_if_added_to_wrim0": round((scale["wrim0_training_tokens"] + MINIMUM_DIAGNOSTIC) / PARAM_COUNT, 3),
                "intended_capability_test": "Does interleaved packing + continued CLM move looping/unique128 at all? JSON not required to leave zero.",
                "authorized": False,
            },
            "PRACTICAL_DEVELOPMENT_SCALE": {
                "tokens": PRACTICAL_DEVELOPMENT,
                "steps_at_4096": PRACTICAL_DEVELOPMENT // TOKENS_PER_STEP,
                "tpp_this_run": round(PRACTICAL_DEVELOPMENT / PARAM_COUNT, 3),
                "cumulative_tpp_if_added_to_wrim0": round((scale["wrim0_training_tokens"] + PRACTICAL_DEVELOPMENT) / PARAM_COUNT, 3),
                "intended_capability_test": "On existing C0+C1 only: can unique128/looping/collapse move enough to justify later SFT? Still not a JSON/instruction claim. Matches audit F1 headline 16,384,000.",
                "authorized": False,
            },
            "TARGET_FOUNDATION_SCALE": {
                "tokens": TARGET_FOUNDATION,
                "steps_at_4096": TARGET_FOUNDATION // TOKENS_PER_STEP,
                "tpp_this_run": round(TARGET_FOUNDATION / PARAM_COUNT, 3),
                "cumulative_tpp_if_added_to_wrim0": round((scale["wrim0_training_tokens"] + TARGET_FOUNDATION) / PARAM_COUNT, 3),
                "intended_capability_test": "Coherent multi-sentence and more stable 128/256 on expanded PROPOSED_TRAINING_DATA. Still below Chinchilla 20 TPP (~384M). JSON/instruction remain SFT.",
                "requires_proposed_training_data": True,
                "authorized": False,
            },
            "chinchilla_20tpp_tokens": CHINCHILLA_20TPP,
            "chinchilla_not_available_on_existing_unique_mass": True,
            "none_authorized": True,
        },
        "corpus_requirements": corpus_requirements(),
        "objective": {
            "recommendation": "C. STAGED_PRETRAINING_THEN_SFT",
            "not": ["SFT-first", "another 25-step Stage3A", "STAGE3B"],
            "foundation_learning": "Causal LM document continuation on interleaved C0+C1 (then proposed foundational data at target scale).",
            "behavior_instruction_specialization": "Prompt-masked SFT on PROPOSED_TRAINING_DATA only after a generation uniqueness/looping gate. Instruction tuning is not a substitute for an immature base.",
            "follows_audit_strategy_direction": strategy.get("direction") == "STAGED_COMBINATION",
        },
        "instruction_sft": sft_format_spec(),
        "structured_output": {
            "json_remained_zero": True,
            "must_exist_before_expecting_json": [
                "instruction-conditioned JSON examples (currently 0)",
                "prompt→JSON objective with response-only loss",
                "a base that does not immediately degenerate (F1 generation gate)",
                "unchanged JSON scorer (already can recognize success)",
            ],
            "seeing_raw_json_documents": "C1 json family / 21.84% packed JSON in RUN-000004",
            "learning_to_respond_with_json": "NOT present in current training data",
            "future_example_kinds": ["JSON", "key/value", "lists", "CSV", "schema-constrained output"],
            "validation_gates": {
                "json_valid": True,
                "required_keys": True,
                "json_array_len_when_specified": True,
                "kv_colon_lines": True,
                "list_ok": True,
                "csv_ok": True,
                "do_not_retune_because_wrim_fails": True,
            },
        },
        "packing_curriculum": packing_design(),
        "repetition_longform": {
            "address_primarily_through": ["better_base_training", "better_data", "improved_packing"],
            "not_primarily": ["decoding", "architecture"],
            "combination": True,
            "gates": {
                "looping": "abort if looping >= parent+2; success if looping <= parent-2",
                "collapse": "abort if collapsed >= parent+2",
                "unique128": "success +>=0.03 vs parent; abort if unique128 <= parent-0.05",
                "unique256": "MUST be in the coded rule. Abort if unique256 drop >=0.05 with looping increase.",
                "repeated_ngrams": "record; abort if collapse detector fires",
                "continuity_128": "required at F-diagnostic and later",
                "continuity_256": "required at F-practical and later",
                "continuity_512": "record at expansion; required at P7",
            },
            "decoding_alone_does_not_fix_weight_level_degeneration": True,
        },
        "decoding_policy": {
            "official_eval_decoder": "GREEDY",
            "temperature": None,
            "top_p": None,
            "repetition_penalty": False,
            "max_new_tokens_compact": 32,
            "max_new_tokens_longform": 256,
            "stop_conditions": ["EOS", "max_new_tokens"],
            "diagnostic_only": ["temperature 0.3", "temperature 0.8", "top-p"],
            "do_not_hide_bad_weights": True,
            "rationale": audit["decoding"]["cross_checkpoint"]["finding"],
        },
        "architecture_classification": "ARCHITECTURE_ACCEPTABLE_FOR_NEXT_FOUNDATIONAL_PASS",
        "architecture_why": audit["readiness"]["architecture_note"],
        "tokenizer_classification": "CONSTRAINING_BUT_USABLE",
        "tokenizer_why": "JSON punctuation/code/English tokens exist (audit measured brace/quote/colon probs). JSON=0 is objective/weights. Vocab 15126 limits technical/world-knowledge efficiency later. No mutation authorized.",
        "tokenizer_eval": {
            "code": "USABLE (C1 code majority trained as documents)",
            "json_punctuation": "PRESENT",
            "whitespace_newlines": "PRESENT (newline_prob measured; degeneration still occurs)",
            "common_english": "USABLE (literary C0)",
            "technical_vocabulary": "CONSTRAINING at 15126",
            "long_form_efficiency": "CONSTRAINING but not the looping cause",
        },
        "development_phases": phases(),
        "compute_storage": compute_estimates(tp),
        "evaluation_stack": {
            "separate_axes": [
                "TOKEN_PREDICTION_QUALITY",
                "GENERATION_QUALITY",
                "INSTRUCTION_FOLLOWING",
                "STRUCTURED_OUTPUT",
                "LONG_FORM_STABILITY",
            ],
            "categories": [
                "validation NLL",
                "KL / retention",
                "short generation",
                "long generation",
                "instruction following",
                "JSON",
                "KV",
                "list",
                "CSV",
                "repetition",
                "collapse",
                "semantic coherence",
                "code generation",
                "factual/knowledge probes",
            ],
            "masking_rule": "A strong val-NLL or CAP score cannot mark the run successful if JSON/instruction/long-form fail.",
            "do_not_retune_scorers_because_wrim_fails": True,
        },
        "soft_stop_governance": {
            "HARD_ABORT": "Immediate halt. Write ABORT.json. No next step. Triggers: ΔNLL>0.105, KL>0.018, val0 worse than parent band, CAP<=3, special-token rate abort.",
            "SOFT_STOP": "Halt after the current checkpoint eval flush. Do not start the next optimizer step. Triggers: >=2 generation-axis degradations. Axes include unique256. Floor-at-zero metrics use remain-zero vs worsen-from-nonzero: a metric already at 0 cannot count as a degradation, and also cannot count as an improvement.",
            "REVIEW_REQUIRED": "Any SOFT_STOP or one-axis-only movement (STEP10-class) requires Commander review. Runner must not auto-continue.",
            "SUCCESS": "Retention holds AND two-axis generation movement (looping or unique128/256 per phase gates). JSON leaving zero is not required until SFT.",
            "silent_continue_forbidden": True,
            "validator_must_recompute_hits": True,
            "machine_enforceable": True,
            "testable": "Replay checkpoint evals through the same hit function the runner uses; mismatch fails validation.",
        },
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "ready_to_run_optimizer": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "ROADMAP_22_STATUS": "CLOSED",
        "ROADMAP_23_STATUS": "ACTIVE",
        "promotion_candidate": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "PROPOSED_TRAINING_DATA": "Target-foundation and SFT corpora are proposed only; not merged into WR-CORPUS",
    }
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": payload["final_classification"],
                "optimizer_steps_this_pass": 0,
                "sha_ok": True,
                "TRAINING_AUTHORIZATION": "OFF",
                "objective": payload["objective"]["recommendation"],
                "architecture_classification": payload["architecture_classification"],
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
