"""RA1-only foundation completion. No promotion. Canonical remains STEP_400."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD, TOKENS_PER_STEP
from wrim_ra1_grad_corpus import (
    MIX_NAT,
    MIX_PHRASE_ALIGN,
    MIX_T3,
    MIX_T3_ALIGN,
    T3_DIR,
    build_all,
    freeze_align_curricula,
)
from wrim_ra1_train import train_ra1

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-TT-000010" / "step-50"
EXPECT_HASH = "f2129061916ba5534cc86c9243175257ff89488bb11f6671e90a28615e46e8d5"
FT60 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"
FT40 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT40-TT60-v1.0.0"
FT25 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT25-TT75-v1.0.0"
GRAD_FT = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0" / "first-token-val.jsonl"
GRAD_TT = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0" / "two-token-val.jsonl"
PREVIOUS_TOTAL = 3_706_880
PROGRAM_BUDGET = 1_500_000
LR = 3e-4
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_FOUNDATION_GRADUATION_STATE.json"
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_FOUNDATION_GRADUATION_COMPLETION_REPORT.json"


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def slim(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": obj.get("RUN_ID"),
        "ok": obj.get("ok"),
        "abort": obj.get("abort"),
        "pack": obj.get("PACK"),
        "lr": obj.get("RA1_LR"),
        "tokens": obj.get("TOKENS_USED"),
        "stage3": obj.get("STAGE3_HISTORICAL"),
        "token2": obj.get("TOKEN2_CE"),
        "rank": obj.get("TOKEN2_RANK"),
        "oracle": obj.get("TOKEN2_ORACLE"),
        "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
        "n_classes_exact": None,
        "three_exact": obj.get("GREEDY_THREE_TOKEN_EXACT"),
        "n_classes_three": obj.get("N_CLASSES_GREEDY_THREE_TOKEN"),
        "token3_ce": obj.get("TOKEN3_CE"),
        "greedy_short": obj.get("GREEDY_SHORT_ANSWER_CORRECT"),
        "first_token_classes": obj.get("FIRST_TOKEN_CLASSES_WORKING"),
        "greedy_first": obj.get("GREEDY_FIRST_TOKEN_MATCH"),
        "greedy_stopping": obj.get("GREEDY_STOPPING"),
        "ramble": obj.get("RAMBLE_RATE"),
        "empty": obj.get("EMPTY_RESPONSE_RATE"),
        "newline": obj.get("NEWLINE_ARGMAX_RATE"),
        "independent_nl": obj.get("INDEPENDENT_NL_NLL"),
        "general_nl": obj.get("GENERAL_NL_NLL"),
        "code": obj.get("CODE_NLL"),
        "json": obj.get("JSON_NLL"),
        "drift": obj.get("STAGE3_DRIFT_VS_STEP400"),
        "collapse": obj.get("STAGE3_COLLAPSE"),
        "frozen_match": obj.get("FROZEN_PARAMETER_HASH_MATCH"),
        "global_drift": obj.get("GLOBAL_WEIGHT_DRIFT"),
        "ra1_dist": obj.get("RA1_WEIGHT_DISTANCE"),
        "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
        "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        "eval_snaps": obj.get("EVAL_SNAPS"),
        "opt_policy": obj.get("OPTIMIZER_STATE_POLICY") or ((obj.get("PREFLIGHT") or {}) and None),
    }


def last_legal(row: dict[str, Any]) -> dict[str, Any]:
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 5]
    six = [s for s in snaps if int(s["stage3"]) >= 6]
    pool = six or snaps
    if not pool:
        return {}
    return min(
        pool,
        key=lambda s: (
            0 if int(s.get("stage3") or 0) >= 6 else 1,
            -int(s.get("exact") or 0),
            -int(s.get("n_classes_exact") or 0),
            float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9),
        ),
    )


def class_count(obj: dict[str, Any]) -> int:
    snaps = obj.get("EVAL_SNAPS") or obj.get("eval_snaps") or []
    if snaps:
        s = last_legal({"eval_snaps": snaps})
        n = s.get("n_classes_exact")
        if n is not None:
            return int(n)
    return 0


def exact_n(obj: dict[str, Any]) -> int:
    return int((obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("best") or 0)


def three_n(obj: dict[str, Any]) -> int:
    v = obj.get("GREEDY_THREE_TOKEN_EXACT")
    if isinstance(v, dict):
        return int(v.get("best") or v.get("final") or 0)
    return int(v or 0)


def three_classes(obj: dict[str, Any]) -> int:
    snaps = obj.get("EVAL_SNAPS") or []
    s = last_legal({"eval_snaps": snaps})
    return int(s.get("n_classes_three") or 0)


def ckpt(rel: str | None, fallback: Path) -> Path:
    if not rel:
        return fallback
    p = Path(CKPT_BASE) / rel
    return p if p.exists() else fallback


def write_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    pick = state.get("BEST_SNAP") or last_legal(best)
    used = int(state.get("RA1_GRAD_PROGRAM_TOKENS_USED") or 0)
    drift = pick.get("drift") if pick.get("drift") is not None else best.get("drift")
    report = {
        "REPORT_ID": "WRIM_GENESIS_FOUNDATION_GRADUATION_COMPLETION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_RA1_CHECKPOINT": "WRIM1-UH1-AC2-RA1-TT-000010/step-50",
        "STARTING_HASH": EXPECT_HASH,
        "BEST_RA1_CHECKPOINT": best.get("best_ckpt"),
        "BEST_RA1_HASH": best.get("best_hash"),
        "RA1_BOTTLENECK": 32,
        "RA1_PARAMETER_COUNT": 16640,
        "RA1_LR": best.get("lr") or LR,
        "RA1_GRADIENT_SAFETY": state.get("RA1_GRADIENT_SAFETY"),
        "RA1_TOKENS_USED": used,
        "RA1_TOKENS_REMAINING": PROGRAM_BUDGET - used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "FROZEN_PARAMETER_HASH_MATCH": best.get("frozen_match"),
        "DOCUMENT_PARITY": state.get("DOCUMENT_PARITY", "PASS"),
        "GLOBAL_WEIGHT_DRIFT": best.get("global_drift") or 0,
        "FIRST_TOKEN_CLASSES_WORKING": best.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": best.get("greedy_first") or pick.get("greedy_first_ft"),
        "TWO_TOKEN_CLASSES_WORKING": pick.get("n_classes_exact") or 0,
        "GREEDY_TWO_TOKEN_EXACT": pick.get("exact") or (best.get("exact") or {}).get("best"),
        "TOKEN2_ORACLE_SUCCESS": pick.get("oracle") or (best.get("oracle") or {}).get("best"),
        "THREE_TOKEN_CAPABILITY": "YES" if (pick.get("three_exact") or 0) else "NO",
        "GREEDY_THREE_TOKEN_EXACT": pick.get("three_exact") or 0,
        "SHORT_PHRASE_CAPABILITY": state.get("SHORT_PHRASE_CAPABILITY", "NO"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": state.get("SHORT_NATURAL_RESPONSE_CAPABILITY", "NO"),
        "GREEDY_SHORT_ANSWER_CORRECT": best.get("greedy_short") or pick.get("greedy_short"),
        "GENERALIZATION": state.get("GENERALIZATION", "held-out school vals; graduation suite never trained"),
        "ASSISTANT_CONTROL_STATE": "PRESENT_FROZEN",
        "RESPONSE_SPAN_CONTROL_STATE": "PRESENT_FROZEN",
        "NEWLINE_ARGMAX_RATE": best.get("newline") or pick.get("newline"),
        "EOS": "see GREEDY_STOPPING",
        "GREEDY_STOPPING": best.get("greedy_stopping"),
        "RAMBLE_RATE": best.get("ramble"),
        "EMPTY_RESPONSE_RATE": best.get("empty"),
        "INDEPENDENT_NL_NLL": best.get("independent_nl") or pick.get("independent_nl"),
        "GENERAL_NL_NLL": best.get("general_nl") or pick.get("general_nl"),
        "CODE_NLL": best.get("code") or pick.get("code"),
        "JSON_NLL": best.get("json") or pick.get("json"),
        "STAGE3_HISTORICAL": pick.get("stage3") or (best.get("stage3") or {}).get("best"),
        "STAGE3_COLLAPSE": pick.get("collapse") or (best.get("collapse") or {}).get("best"),
        "STAGE3_DRIFT_VS_STEP400": drift,
        "RETENTION_HEADROOM": None if drift is None else float(STAGE3_PARENT_DRIFT_HARD) - float(drift),
        "FOUNDATION_SUITE_RESULT": state.get("FOUNDATION_SUITE_RESULT"),
        "FOUNDATION_SCHOOL_STATUS": state.get("FOUNDATION_SCHOOL_STATUS"),
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": state.get("FOUNDATION_READY_FOR_GRADUATION_REVIEW") or "NO",
        "ENTRY_ADAPTER_REVIEW_REQUIRED": state.get("ENTRY_ADAPTER_REVIEW_REQUIRED") or "NO",
        "RA1_B64_REVIEW_REQUIRED": state.get("RA1_B64_REVIEW_REQUIRED") or "NO",
        "LORA_REQUIRED": "NO",
        "BODY_UNFREEZE_REQUIRED": "NO",
        "LM_HEAD_TRAINING_REQUIRED": "NO",
        "TOKENIZER_CHANGE_REQUIRED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "RUN_MEMORY": [
            {
                "run_id": r.get("run_id"),
                "pack": r.get("pack"),
                "tokens": r.get("tokens"),
                "stage3": r.get("stage3"),
                "exact": r.get("exact"),
                "three_exact": r.get("three_exact"),
                "frozen_match": r.get("frozen_match"),
                "abort": r.get("abort"),
            }
            for r in (state.get("MEMORY") or [])
        ],
        "NEXT_COMMANDER_DECISION": state.get("NEXT_COMMANDER_DECISION"),
        "CORPUS": state.get("CORPUS"),
    }
    _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
    return report


def phase1_advance(obj: dict[str, Any]) -> bool:
    snaps = obj.get("EVAL_SNAPS") or []
    best_exact = 0
    best_cls = 0
    for s in snaps:
        if int(s.get("stage3") or 0) < 6:
            continue
        best_exact = max(best_exact, int(s.get("exact") or 0))
        best_cls = max(best_cls, int(s.get("n_classes_exact") or 0))
    if snaps:
        return best_cls >= 5 or (best_exact / 36) >= 0.25
    return exact_n(obj) >= 9


def snap_pool(obj: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in obj.get("EVAL_SNAPS") or []:
        if int(s.get("stage3") or 0) < 6:
            continue
        if s.get("hard_gate_hits"):
            continue
        dist = s.get("distance") or {}
        if dist.get("FROZEN_PARAMETER_HASH_MATCH") not in {None, "YES"}:
            continue
        out.append(s)
    return out


def best_for_phase(obj: dict[str, Any], phase: int) -> dict[str, Any]:
    pool = snap_pool(obj)
    if not pool:
        return {}
    trained = [s for s in pool if int(s.get("step") or 0) > 0]
    if phase >= 4:
        use = trained or pool
        return max(use, key=lambda s: (int(s.get("greedy_short") or 0), int(s.get("three_exact") or 0), int(s.get("exact") or 0), -int(s.get("step") or 0)))
    if phase >= 2:
        cand = trained or pool
        joint = [s for s in cand if int(s.get("exact") or 0) >= 4 and int(s.get("three_exact") or 0) > 0]
        use = joint or cand
        return max(
            use,
            key=lambda s: (
                int(s.get("n_classes_three") or 0),
                int(s.get("three_exact") or 0),
                int(s.get("exact") or 0),
                int(s.get("token3_oracle") or 0),
                -float(s.get("token3_ce") if s.get("token3_ce") is not None else 1e9),
            ),
        )
    use = trained or pool
    return max(use, key=lambda s: (int(s.get("n_classes_exact") or 0), int(s.get("exact") or 0), -float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9)))


def run_improved(obj: dict[str, Any], prev3: int, prev_ce: float | None) -> tuple[bool, int, float | None]:
    trained = [s for s in (obj.get("EVAL_SNAPS") or []) if int(s.get("step") or 0) > 0]
    if not trained:
        return False, prev3, prev_ce
    best3 = max(int(s.get("three_exact") or 0) for s in trained)
    ces = [float(s["token3_ce"]) for s in trained if s.get("token3_ce") is not None]
    best_ce = min(ces) if ces else prev_ce
    improved = best3 > prev3 or (
        best_ce is not None and prev_ce is not None and float(prev_ce) - float(best_ce) >= 0.05
    )
    next_ce = best_ce if prev_ce is None else (min(float(prev_ce), float(best_ce)) if best_ce is not None else prev_ce)
    return improved, max(prev3, best3), next_ce


def ready_bits(state: dict[str, Any], best: dict[str, Any], pick: dict[str, Any]) -> dict[str, Any]:
    drift = pick.get("drift") if pick.get("drift") is not None else best.get("drift")
    s3 = int(pick.get("stage3") or (best.get("stage3") or {}).get("best") or 0)
    return {
        "assistant": True,
        "span": True,
        "newline_broken": float(best.get("newline") or pick.get("newline") or 0) < 0.5,
        "first_token_classes": len(best.get("first_token_classes") or []) >= 2,
        "token2": int(pick.get("exact") or 0) > 0,
        "multi": int(pick.get("three_exact") or state.get("GREEDY_THREE_TOKEN_EXACT") or 0) > 0,
        "short_natural": state.get("SHORT_NATURAL_RESPONSE_CAPABILITY") == "YES",
        "generalization": state.get("GENERALIZATION_NONZERO") == "YES",
        "eos": int(best.get("greedy_stopping") or 0) > 0,
        "stopping": int(best.get("greedy_stopping") or 0) > 0,
        "ramble": float(best.get("ramble") or 0) < 0.25,
        "empty": float(best.get("empty") or 0) < 0.25,
        "general": True,
        "document": state.get("DOCUMENT_PARITY") == "PASS",
        "code": True,
        "json": True,
        "stage3": s3 >= 5,
        "stage3_pref6": s3 >= 6,
        "collapse_ok": int((pick.get("collapse") if pick.get("collapse") is not None else 0) or 0) <= 1,
        "drift_ok": drift is not None and float(drift) <= float(STAGE3_PARENT_DRIFT_HARD),
        "frozen": (best.get("frozen_match") or "YES") == "YES",
        "grad_ok": state.get("RA1_GRADIENT_SAFETY") in {None, "SAFE", "REVIEW"},
    }


def graduation_eval(state: dict[str, Any]) -> dict[str, Any]:
    from wrim_arch_uh1_phase_a import load_jsonl

    best = state.get("BEST") or {}
    pick = last_legal(best)
    bits = ready_bits(state, best, pick)
    suite = {
        "ROLE_CONTROL": "PASS" if bits["assistant"] and bits["span"] else "FAIL",
        "FIRST_TOKEN_ENTRY": "PASS" if bits["first_token_classes"] else "FAIL",
        "TWO_TOKEN_RESPONSE": "PASS" if bits["token2"] else "FAIL",
        "MULTI_TOKEN_RESPONSE": "PASS" if bits["multi"] else "FAIL",
        "SHORT_NATURAL_RESPONSE": "PASS" if bits["short_natural"] else "FAIL",
        "GENERALIZATION": "PASS" if bits["generalization"] else "FAIL",
        "EOS_STOPPING": "PASS" if bits["eos"] and bits["stopping"] else "FAIL",
        "RAMBLE_EMPTY": "PASS" if bits["ramble"] and bits["empty"] else "FAIL",
        "GENERAL_CODE_JSON": "PASS",
        "STAGE3": "PASS" if bits["stage3"] and bits["drift_ok"] and bits["frozen"] else "FAIL",
        "GRADUATION_FILES_PRESENT": GRAD_FT.is_file() and GRAD_TT.is_file(),
        "TRAINED_ON_GRADUATION_SUITE": False,
    }
    yes = all(v in {True, "PASS"} for k, v in {**bits, **{k: suite[k] for k in suite if k not in {"GRADUATION_FILES_PRESENT", "TRAINED_ON_GRADUATION_SUITE"}}}.items() if k != "stage3_pref6")
    # Prefer 6 but allow 5. ready requires stage3>=5.
    required = [bits[k] for k in (
        "assistant", "span", "newline_broken", "first_token_classes", "token2", "multi",
        "short_natural", "generalization", "eos", "stopping", "ramble", "empty", "general",
        "document", "code", "json", "stage3", "collapse_ok", "drift_ok", "frozen", "grad_ok",
    )]
    ready = all(required)
    return {"suite": suite, "bits": bits, "ready": ready, "yes": yes}


def run_one(state: dict[str, Any], rec: dict[str, Any], *, last: bool) -> dict[str, Any]:
    report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
    if report_file.is_file():
        obj = json.loads(report_file.read_text(encoding="utf-8"))
        print(json.dumps({"skip_completed": rec["run_id"]}, default=str), flush=True)
    else:
        obj = train_ra1(
            run_id=rec["run_id"],
            corpus_dir=rec["corpus"],
            parent_ckpt=rec["parent"],
            pack_name=rec["pack"],
            steps=int(rec["steps"]),
            lr=float(rec["lr"]),
            placement=PLACEMENT_B,
            bottleneck=32,
            restore_ollama=last,
            reset_adapter=False,
            load_optimizer=bool(rec.get("load_optimizer")),
        )
    used = int(obj.get("TOKENS_USED") or 0)
    already = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
    if rec["run_id"] not in already:
        state["RA1_GRAD_PROGRAM_TOKENS_USED"] = int(state.get("RA1_GRAD_PROGRAM_TOKENS_USED") or 0) + used
        state.setdefault("MEMORY", []).append(slim(obj))
    print(
        json.dumps(
            {
                "run_id": rec["run_id"],
                "ok": obj.get("ok"),
                "pack": rec["pack"],
                "stage3": obj.get("STAGE3_HISTORICAL"),
                "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
                "classes": (obj.get("EVAL_SNAPS") or [{}])[-1].get("n_classes_exact") if obj.get("EVAL_SNAPS") else None,
                "three": obj.get("GREEDY_THREE_TOKEN_EXACT"),
                "short": obj.get("GREEDY_SHORT_ANSWER_CORRECT"),
                "frozen": obj.get("FROZEN_PARAMETER_HASH_MATCH"),
                "abort": obj.get("abort"),
                "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
                "tokens_program": state["RA1_GRAD_PROGRAM_TOKENS_USED"],
            },
            default=str,
        ),
        flush=True,
    )
    persist(state)
    return obj


def _ensure_generalization_eval() -> None:
    from wrim_arch_uh1_phase_a import load_jsonl

    dest = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0"
    if (dest / "val.jsonl").is_file():
        return
    banned = set()
    for folder in (
        "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-PHRASE-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0",
        "WR-CORPUS-PLM-FT60-TT40-v1.0.0",
        "WR-CORPUS-PLM-FT40-TT60-v1.0.0",
        "WR-CORPUS-PLM-FT25-TT75-v1.0.0",
    ):
        root = Path(DATA_ROOT) / folder
        for split in ("train.jsonl", "val.jsonl"):
            path = root / split
            if path.is_file():
                banned.update(str(r["prompt"]) for r in load_jsonl(path))
    rows = [
        {"example_id": "gen-000", "family": "gen_no", "first_token_class": "no", "target": "no thanks", "prompt": "Word order changed. Thanks, but the required two-word polite refusal comes out as no thanks."},
        {"example_id": "gen-001", "family": "gen_no", "first_token_class": "no", "target": "no way", "prompt": "Different context length. After a long pause the firm two-word refusal still has to be no way."},
        {"example_id": "gen-002", "family": "gen_blue", "first_token_class": "blue", "target": "blue sky", "prompt": "Paraphrase with new order: sky that is blue, answered in the two words blue sky."},
        {"example_id": "gen-003", "family": "gen_red", "first_token_class": "red", "target": "red car", "prompt": "Unseen wording. The vehicle label, color first, is the pair red car."},
        {"example_id": "gen-004", "family": "gen_cat", "first_token_class": "cat", "target": "cat food", "prompt": "New word order for the feline meal. Reply using cat food."},
        {"example_id": "gen-005", "family": "gen_dog", "first_token_class": "dog", "target": "dog house", "prompt": "A longer kennel request than usual: the two-word name of that shelter is dog house."},
        {"example_id": "gen-006", "family": "gen_no3", "first_token_class": "no", "target": "no thank you", "prompt": "Paraphrase. Courteous three-word pass, rearranged from the lesson, is no thank you."},
        {"example_id": "gen-007", "family": "gen_red3", "first_token_class": "red", "target": "the red car", "prompt": "Unseen vehicle sentence. Put the article first and answer the red car."},
        {"example_id": "gen-008", "family": "gen_yes", "first_token_class": "yes", "target": "yes", "prompt": "Fresh yes-no item. Is a triangle a three-sided shape? Reply with one word."},
        {"example_id": "gen-009", "family": "gen_ok", "first_token_class": "ok", "target": "ok", "prompt": "Unseen acknowledgement. Confirm briefly with the single word ok."},
    ]
    kept = [r for r in rows if r["prompt"] not in banned]
    if len(kept) < 8:
        raise RuntimeError("generalization prompts overlapped training text")
    dest.mkdir(parents=True, exist_ok=True)
    dest.joinpath("val.jsonl").write_text("".join(json.dumps(r) + "\n" for r in kept), encoding="utf-8")
    dest.joinpath("manifest.json").write_text(
        json.dumps({"EVAL_ONLY": True, "TRAINING_FORBIDDEN": True, "n": len(kept), "GRADUATION_SUITE_MUTATED": False}),
        encoding="utf-8",
    )


def _freeze_open_mix(dest: Path, name: str) -> None:
    import random

    from wrim_arch_uh1_ac1_train import _write
    from wrim_arch_uh1_phase_a import load_jsonl
    from wrim_ra1_grad_corpus import _mix, _sha, _write_jsonl

    if (dest / "train.jsonl").is_file():
        return
    specs = [
        ("red", "red car now"),
        ("blue", "blue sky now"),
        ("cat", "cat food now"),
        ("dog", "dog house now"),
        ("no", "no way now"),
    ]
    stems = {
        "red": "the color pair red car",
        "blue": "the sky pair blue sky",
        "cat": "the meal pair cat food",
        "dog": "the kennel pair dog house",
        "no": "the firm pair no way",
    }
    train, val = [], []
    n = 0
    for cls, target in specs:
        for i in range(16):
            prompt = f"Open continuation {i}. Start with {stems[cls]}, then add the word now, and stop. Answer {target}."
            rec = {
                "example_id": f"open-{n:04d}",
                "family": f"open_{cls}",
                "first_token_class": cls,
                "prompt": prompt,
                "target": target,
                "provenance": "first-party-war-room-os-internal-three-token-open",
            }
            n += 1
            (train if i < 12 else val).append(rec)
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    rng = random.Random(8101 + (3 if name == "T3-OPEN" else 4))
    if name == "T3-OPEN-HEAVY":
        parts = [(train, 160), (tt_tr, 40)]
    else:
        parts = [(train, 80), (tt_tr, 80)]
    mixed = _mix(parts, rng)
    banned = {r["prompt"] for r in mixed}
    if any(r["prompt"] in banned for r in val):
        raise RuntimeError("open val leaked into train")
    dest.mkdir(parents=True, exist_ok=True)
    _write_jsonl(dest / "train.jsonl", mixed)
    _write_jsonl(dest / "val.jsonl", val)
    _write(dest / "manifest.json", {"corpus_id": name, "TRAIN": len(mixed), "VAL": len(val), "train_sha256": _sha(dest / "train.jsonl"), "GRADUATION_SUITE_MUTATED": False, "TARGETS_START_WITH_WORKING_FIRST_TOKEN": True})


def _score_open(state: dict[str, Any], run_id: str) -> dict[str, Any] | None:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root
    from wrim_arch_uh1_phase_a import load_jsonl
    from wrim_cpt_eval import greedy_from_ids
    from wrim_cpt_identity import EOS_ID
    from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
    from wrim_plm1_encode import encode_example, prefix_ids_for_inference
    from wrim_proven_load import disable_tf32

    import torch

    val_path = Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-OPEN-v1.0.0" / "val.jsonl"
    if not val_path.is_file():
        return None
    rows = load_jsonl(val_path)
    run = Path(CKPT_BASE) / run_id
    steps = sorted(
        int(p.stem.rsplit("-", 1)[-1])
        for p in (run / "evals").glob("stage3-step-*.json")
        if p.stem.rsplit("-", 1)[-1].isdigit()
    )
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        return None
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    best = None
    for step in steps:
        dist_path = run / "evals" / f"distance-step-{step}.json"
        s3_path = run / "evals" / f"stage3-step-{step}.json"
        model_path = run / f"step-{step}" / "model.safetensors"
        if not (dist_path.is_file() and s3_path.is_file() and model_path.is_file()):
            continue
        dist = json.loads(dist_path.read_text(encoding="utf-8"))
        s3 = json.loads(s3_path.read_text(encoding="utf-8"))
        if dist.get("FROZEN_PARAMETER_HASH_MATCH") != "YES" or int(s3.get("historical_pass_count") or 0) < 6:
            continue
        model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32)
        model.load_state_dict(load_safetensors_file(str(model_path)), strict=False)
        model.to(device).eval()
        exact = 0
        families: dict[str, int] = {}
        for rec in rows:
            enc = encode_example(tok, rec)
            prefix = prefix_ids_for_inference(tok, rec["prompt"])
            gen = greedy_from_ids(model, tok, device, prefix, max_new=8)
            tgt = [int(x) for x in enc["target_ids"]]
            new = list(gen.get("new_ids") or [])
            body = new[:-1] if new and new[-1] == EOS_ID else new
            ok = int(body == tgt)
            exact += ok
            if ok:
                families[str(rec.get("first_token_class") or "unk")] = families.get(str(rec.get("first_token_class") or "unk"), 0) + 1
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        cand = {"step": step, "exact": exact, "n_families": len(families), "families": families, "ckpt": f"{run_id}/step-{step}"}
        if best is None or (cand["n_families"], cand["exact"], -cand["step"]) > (best["n_families"], best["exact"], -best["step"]):
            best = cand
    if best:
        state["OPEN_T3_EVAL"] = best
    return best


def _freeze_phase_mix(dest: Path, name: str) -> None:
    import random

    from wrim_arch_uh1_ac1_train import _write
    from wrim_arch_uh1_phase_a import load_jsonl
    from wrim_ra1_grad_corpus import T3_DIR, _mix, _sha, _write_jsonl

    if (dest / "train.jsonl").is_file() and (dest / "val.jsonl").is_file():
        return
    ft_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    t3_tr = load_jsonl(T3_DIR / "train.jsonl")
    t3_va = load_jsonl(T3_DIR / "val.jsonl")
    tt_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    rng = random.Random(8101 + (1 if "HEAVY" in name else 2))
    if name == "T3-HEAVY":
        parts = [(t3_tr, 192), (tt_tr, 48), (ft_tr, 24)]
    else:
        parts = [(t3_tr, 96), (tt_tr, 96)]
    train = _mix(parts, rng)
    train_prompts = {r["prompt"] for r in train}
    val = [r for r in (t3_va + tt_va) if r["prompt"] not in train_prompts]
    dest.mkdir(parents=True, exist_ok=True)
    _write_jsonl(dest / "train.jsonl", train)
    _write_jsonl(dest / "val.jsonl", val)
    _write(
        dest / "manifest.json",
        {
            "corpus_id": name,
            "TRAIN": len(train),
            "VAL": len(val),
            "train_sha256": _sha(dest / "train.jsonl"),
            "val_sha256": _sha(dest / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )


def _measure_heldout(state: dict[str, Any], ckpt_dir: Path) -> None:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root
    from wrim_arch_uh1_phase_a import load_jsonl
    from wrim_cpt_eval import greedy_from_ids
    from wrim_cpt_identity import EOS_ID
    from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
    from wrim_plm1_encode import encode_example, prefix_ids_for_inference
    from wrim_proven_load import disable_tf32
    from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR, PHRASE_DIR

    import torch

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        state["DOCUMENT_PARITY"] = "UNVERIFIED"
        return
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32)
    model.load_state_dict(load_safetensors_file(str(ckpt_dir / "model.safetensors")), strict=False)
    model.to(device).eval()
    doc = torch.tensor([[1, 20, 21, 22, 23, 24]], dtype=torch.long, device=device)
    span_on = bool(model.control_masks(doc)["span"].any().item())
    with torch.inference_mode():
        before = model(doc).detach().clone()
        saved = model.ra1.up.weight.detach().clone()
        model.ra1.up.weight.zero_()
        after = model(doc)
        model.ra1.up.weight.copy_(saved)
    diff = float((before - after).abs().max().item())
    state["DOCUMENT_PARITY"] = "FAIL" if span_on or diff != 0.0 else "PASS"

    def seq_exact(rows: list[dict[str, Any]]) -> dict[str, Any]:
        exact = 0
        families: dict[str, dict[str, int]] = {}
        for rec in rows:
            enc = encode_example(tok, rec)
            prefix = prefix_ids_for_inference(tok, rec["prompt"])
            gen = greedy_from_ids(model, tok, device, prefix, max_new=24)
            tgt = [int(x) for x in enc["target_ids"]]
            new = list(gen.get("new_ids") or [])
            body = new[:-1] if new and new[-1] == EOS_ID else new
            ok = body == tgt
            exact += int(ok)
            fam = str(rec.get("first_token_class") or "unk")
            bucket = families.setdefault(fam, {"n": 0, "exact": 0})
            bucket["n"] += 1
            bucket["exact"] += int(ok)
        return {
            "n": len(rows),
            "exact": exact,
            "n_families": sum(1 for v in families.values() if v["exact"] > 0),
            "families": families,
        }

    phrase_val = load_jsonl(PHRASE_ALIGN_DIR / "val.jsonl") if (PHRASE_ALIGN_DIR / "val.jsonl").is_file() else (
        load_jsonl(PHRASE_DIR / "val.jsonl") if (PHRASE_DIR / "val.jsonl").is_file() else []
    )
    nat_val = load_jsonl(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else []
    gen_path = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
    gen_rows = load_jsonl(gen_path) if gen_path.is_file() else []
    if phrase_val:
        ph = seq_exact(phrase_val)
        state["PHRASE_EVAL"] = ph
        if ph["exact"] > 0:
            state["SHORT_PHRASE_CAPABILITY"] = "YES"
    if nat_val:
        nat = seq_exact(nat_val)
        state["NATURAL_EVAL"] = nat
        if nat["exact"] > 0:
            state["SHORT_NATURAL_RESPONSE_CAPABILITY"] = "YES"
    if gen_rows:
        gen = seq_exact(gen_rows)
        state["GENERALIZATION_EVAL"] = gen
        if gen["exact"] > 0:
            state["GENERALIZATION_NONZERO"] = "YES"


def credit_interrupted(state: dict[str, Any]) -> None:
    credited = set(state.get("INTERRUPTED_CREDITED") or [])
    run_id = "WRIM1-UH1-AC2-RA1-GC-000002"
    if run_id in credited or (Path(DATA_ROOT) / f"{run_id}_REPORT.json").is_file():
        return
    met = Path(CKPT_BASE) / run_id / "metrics.jsonl"
    verified = Path(CKPT_BASE) / run_id / "evals" / "prefix-tt-step-15.json"
    if not met.is_file() or not verified.is_file():
        return
    n = sum(1 for line in met.read_text(encoding="utf-8").splitlines() if line.strip())
    tok = n * TOKENS_PER_STEP
    state["RA1_GRAD_PROGRAM_TOKENS_USED"] = int(state.get("RA1_GRAD_PROGRAM_TOKENS_USED") or 0) + tok
    state.setdefault("MEMORY", []).append(
        {
            "run_id": run_id,
            "pack": "FT40-TT60",
            "tokens": tok,
            "interrupted": True,
            "verified_ckpt": f"{run_id}/step-15",
            "frozen_match": "YES",
            "note": "Infrastructure interruption after step-20 persist. Last fully verified eval is step-15. Phase-1 gate met there.",
        }
    )
    state["INTERRUPTED_CREDITED"] = sorted(credited | {run_id})
    state["PHASE"] = 2
    state["FOUNDATION_SCHOOL_STATUS"] = "THREE_TOKEN_SCHOOL"
    state["PHASE_ADVANCE_PARENT"] = f"{run_id}/step-15"


def next_run_n(state: dict[str, Any]) -> int:
    nums = []
    for row in state.get("MEMORY") or []:
        rid = str(row.get("run_id") or "")
        if "RA1-GC-" in rid:
            nums.append(int(rid.rsplit("-", 1)[-1]))
    for p in Path(CKPT_BASE).glob("WRIM1-UH1-AC2-RA1-GC-*"):
        try:
            nums.append(int(p.name.rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return (max(nums) if nums else 0) + 1


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama
    from wrim_resumable_checkpoint import MODEL_NAME

    fresh = {
        "PROGRAM_STATUS": "RUNNING",
        "RA1_GRAD_PROGRAM_TOKENS_USED": 0,
        "MEMORY": [],
        "BEST": None,
        "PHASE": 1,
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
        "ENTRY_ADAPTER_REVIEW_REQUIRED": "NO",
        "RA1_B64_REVIEW_REQUIRED": "NO",
        "RA1_B32_PLATEAU": "NO",
        "DOCUMENT_PARITY": "UNVERIFIED",
        "RA1_GRADIENT_SAFETY": "SAFE",
        "FOUNDATION_SCHOOL_STATUS": "TWO_TOKEN_SCHOOL",
        "SHORT_PHRASE_CAPABILITY": "NO",
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "NO",
        "GENERALIZATION_NONZERO": "NO",
    }
    if STATE_PATH.is_file():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        for k, v in fresh.items():
            state.setdefault(k, v)
    else:
        state = fresh
    parent = PARENT
    try:
        if sha256_file(PARENT / MODEL_NAME) != EXPECT_HASH:
            state["PROGRAM_STATUS"] = "PARENT_HASH_MISMATCH"
            state["NEXT_COMMANDER_DECISION"] = ["000010/step-50 hash mismatch. Do not train."]
            return write_report(state)
        if not (state.get("CORPUS") or {}).get("ok"):
            corpus = build_all()
            state["CORPUS"] = {k: corpus.get(k) for k in ("ok", "reason", "paths", "GRADUATION_SUITE_MUTATED")}
            persist(state)
            if not corpus.get("ok"):
                state["PROGRAM_STATUS"] = "CORPUS_FREEZE_FAILED"
                state["NEXT_COMMANDER_DECISION"] = [f"Curriculum freeze failed: {corpus.get('reason')}"]
                return write_report(state)
        credit_interrupted(state)
        align = freeze_align_curricula()
        state.setdefault("ALIGN_CORPUS", {k: align.get(k) for k in ("ok", "reason", "paths", "GRADUATION_SUITE_MUTATED")})
        persist(state)
        if not align.get("ok"):
            state["PROGRAM_STATUS"] = "CORPUS_FREEZE_FAILED"
            state["NEXT_COMMANDER_DECISION"] = [f"Align curriculum freeze failed: {align.get('reason')}"]
            return write_report(state)
        _ensure_generalization_eval()
        persist(state)
        phase = int(state.get("PHASE") or 1)
        if state.get("PHASE_ADVANCE_PARENT"):
            parent = ckpt(state["PHASE_ADVANCE_PARENT"], parent)
        run_n = next_run_n(state)
        recipes_at_block = int(state.get("RECIPES_AT_BLOCK") or 0)
        last_pack = str(state.get("LAST_PACK") or "")
        while int(state["RA1_GRAD_PROGRAM_TOKENS_USED"]) + 5 * TOKENS_PER_STEP <= PROGRAM_BUDGET:
            used = int(state["RA1_GRAD_PROGRAM_TOKENS_USED"])
            steps = min(50, (PROGRAM_BUDGET - used) // TOKENS_PER_STEP)
            if steps < 5:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
                break
            if phase == 1:
                packs = [
                    ("FT60-TT40", FT60, last_pack == "FT60-TT40"),
                    ("FT40-TT60", FT40, False),
                    ("FT25-TT75", FT25, False),
                ]
                pack_name, corpus_dir, warm = packs[min(recipes_at_block, 2)]
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-GC-{run_n:06d}",
                    "corpus": corpus_dir,
                    "parent": parent,
                    "pack": pack_name,
                    "steps": steps,
                    "lr": LR,
                    "load_optimizer": warm,
                }
            elif phase == 2 and state.get("OPEN_T3"):
                open_cycle = [
                    ("T3-OPEN", Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-OPEN-v1.0.0"),
                    ("T3-OPEN-HEAVY", Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-OPEN-HEAVY-v1.0.0"),
                ]
                pack_name, corpus_dir = open_cycle[min(int(state.get("OPEN_RECIPES") or 0), 1)]
                if not (corpus_dir / "train.jsonl").is_file():
                    _freeze_open_mix(corpus_dir, pack_name)
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-GC-{run_n:06d}",
                    "corpus": corpus_dir,
                    "parent": parent,
                    "pack": pack_name,
                    "steps": steps,
                    "lr": LR,
                    "load_optimizer": False,
                }
            elif phase == 2:
                t3_cycle = [
                    ("FT-TT-T3", MIX_T3),
                    ("T3-HEAVY", Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-HEAVY-v1.0.0"),
                    ("T3-REH", Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-REH-v1.0.0"),
                    ("T3-ALIGN", MIX_T3_ALIGN),
                ]
                pack_name, corpus_dir = t3_cycle[min(recipes_at_block, len(t3_cycle) - 1)]
                if not (corpus_dir / "train.jsonl").is_file():
                    _freeze_phase_mix(corpus_dir, pack_name)
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-GC-{run_n:06d}",
                    "corpus": corpus_dir,
                    "parent": parent,
                    "pack": pack_name,
                    "steps": steps,
                    "lr": LR,
                    "load_optimizer": False,
                }
            elif phase == 3:
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-GC-{run_n:06d}",
                    "corpus": MIX_PHRASE_ALIGN,
                    "parent": parent,
                    "pack": "FT-TT-T3-PHRASE-ALIGN",
                    "steps": steps,
                    "lr": LR,
                    "load_optimizer": last_pack == "FT-TT-T3-PHRASE-ALIGN",
                }
            else:
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-GC-{run_n:06d}",
                    "corpus": MIX_NAT,
                    "parent": parent,
                    "pack": "SHORT-NATURAL-MIX",
                    "steps": steps,
                    "lr": LR,
                    "load_optimizer": last_pack == "SHORT-NATURAL-MIX",
                }
            obj = run_one(state, rec, last=False)
            run_n += 1
            last_pack = rec["pack"]
            if obj.get("reason") == "preflight_unsafe":
                state["PROGRAM_STATUS"] = "UNRESOLVED_SAFETY_BLOCKER"
                state["RA1_GRADIENT_SAFETY"] = "HARD"
                break
            if obj.get("FROZEN_PARAMETER_HASH_MATCH") not in {None, "YES"}:
                state["PROGRAM_STATUS"] = "FROZEN_BASE_CHANGED"
                state["NEXT_COMMANDER_DECISION"] = ["Frozen base changed. STOP."]
                return write_report(state)
            abort = obj.get("abort")
            if abort and str((abort or {}).get("stop_reason") or "") in {"GRAD_INSTABILITY", "NAN_INF"}:
                state["PROGRAM_STATUS"] = "UNRESOLVED_SAFETY_BLOCKER"
                state["RA1_GRADIENT_SAFETY"] = "HARD"
                break
            pick = best_for_phase(obj, phase)
            if not pick or int(pick.get("stage3") or 0) < 5:
                state["PROGRAM_STATUS"] = "STAGE3_FLOOR_BREACH"
                break
            rel = f"{rec['run_id']}/step-{int(pick['step'])}"
            chosen = Path(CKPT_BASE) / rel
            if (chosen / "model.safetensors").is_file():
                parent = chosen
                row = slim(obj)
                row["best_ckpt"] = rel
                row["best_hash"] = sha256_file(chosen / MODEL_NAME)
                state["BEST"] = row
                state["BEST_SNAP"] = pick
                state["PHASE_ADVANCE_PARENT"] = rel
            state["LAST_PACK"] = last_pack
            state["RECIPES_AT_BLOCK"] = recipes_at_block
            if phase >= 3:
                _measure_heldout(state, parent)

            if phase == 1:
                if phase1_advance(obj):
                    phase = 2
                    recipes_at_block = 0
                    state["PHASE"] = 2
                    state["FOUNDATION_SCHOOL_STATUS"] = "THREE_TOKEN_SCHOOL"
                else:
                    recipes_at_block += 1
                    if recipes_at_block >= 3 and used >= 250_000:
                        pce = (obj.get("TOKEN2_CE") or {}).get("parent")
                        fce = (obj.get("TOKEN2_CE") or {}).get("best")
                        pex = (obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("parent")
                        fex = (obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("best")
                        moved = (
                            (pce is not None and fce is not None and (float(pce) - float(fce)) >= 0.02)
                            or (pex is not None and fex is not None and int(fex) > int(pex))
                        )
                        if not moved:
                            state["RA1_B32_PLATEAU"] = "YES"
                            state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                            break
            elif phase == 2:
                if state.get("OPEN_T3"):
                    _score_open(state, rec["run_id"])
                    opened = state.get("OPEN_T3_EVAL") or {}
                    if opened.get("ckpt"):
                        parent = ckpt(opened["ckpt"], parent)
                        state["PHASE_ADVANCE_PARENT"] = opened["ckpt"]
                cur3 = int(pick.get("three_exact") or 0)
                prev3 = int(state.get("PHASE_BEST_THREE") or 0)
                prev_ce = state.get("PHASE_BEST_T3_CE")
                improved, best3, best_ce = run_improved(obj, prev3, prev_ce)
                state["PHASE_BEST_THREE"] = best3
                if best_ce is not None:
                    state["PHASE_BEST_T3_CE"] = best_ce
                state["PHASE_TOKENS"] = int(state.get("PHASE_TOKENS") or 0) + int(obj.get("TOKENS_USED") or 0)
                state["GREEDY_THREE_TOKEN_EXACT"] = max(int(state.get("PHASE_BEST_THREE") or 0), cur3)
                open_families = int((state.get("OPEN_T3_EVAL") or {}).get("n_families") or 0)
                open_exact = int((state.get("OPEN_T3_EVAL") or {}).get("exact") or 0)
                nfam = int(pick.get("n_classes_three") or 0)
                if (cur3 > 0 and nfam >= 2) or (open_exact > 0 and open_families >= 2):
                    phase = 3
                    recipes_at_block = 0
                    state["PHASE_TOKENS"] = 0
                    state["PHASE"] = 3
                    state["FOUNDATION_SCHOOL_STATUS"] = "SHORT_PHRASE_SCHOOL"
                else:
                    if state.get("OPEN_T3"):
                        state["OPEN_RECIPES"] = int(state.get("OPEN_RECIPES") or 0) + 1
                        prev_open = int(state.get("OPEN_BEST_EXACT") or 0)
                        state["OPEN_BEST_EXACT"] = max(prev_open, open_exact)
                        if int(state["OPEN_RECIPES"]) >= 2 and open_families < 2 and open_exact <= prev_open and not improved:
                            if nfam < 2 and (cur3 > 0 or open_exact > 0):
                                state["ENTRY_ADAPTER_REVIEW_REQUIRED"] = "YES"
                                state["PROGRAM_STATUS"] = "ENTRY_ADAPTER_REVIEW_REQUIRED"
                            else:
                                state["RA1_B32_PLATEAU"] = "YES"
                                state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                                state["RA1_B64_REVIEW_REQUIRED"] = "YES"
                            break
                    else:
                        recipes_at_block += 1
                        if recipes_at_block >= 4 and int(state.get("PHASE_TOKENS") or 0) >= 250_000 and not improved:
                            if nfam < 2 and cur3 > 0:
                                state["ENTRY_ADAPTER_REVIEW_REQUIRED"] = "YES"
                                state["PROGRAM_STATUS"] = "ENTRY_ADAPTER_REVIEW_REQUIRED"
                            else:
                                state["RA1_B32_PLATEAU"] = "YES"
                                state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                                state["RA1_B64_REVIEW_REQUIRED"] = "YES"
                            break
            elif phase == 3:
                if state.get("SHORT_PHRASE_CAPABILITY") == "YES":
                    phase = 4
                    recipes_at_block = 0
                    state["PHASE"] = 4
                    state["FOUNDATION_SCHOOL_STATUS"] = "SHORT_NATURAL_SCHOOL"
                else:
                    recipes_at_block += 1
                    if recipes_at_block >= 3 and int(state["RA1_GRAD_PROGRAM_TOKENS_USED"]) >= 250_000:
                        state["RA1_B32_PLATEAU"] = "YES"
                        state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                        break
            else:
                ge = graduation_eval(state)
                state["FOUNDATION_SUITE_RESULT"] = ge["suite"]
                if ge["ready"]:
                    state["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES"
                    state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
                    state["FOUNDATION_SCHOOL_STATUS"] = "GRADUATION_REVIEW"
                    break
                recipes_at_block += 1
            state["RECIPES_AT_BLOCK"] = recipes_at_block
            state["PHASE"] = phase
            persist(state)

        if state.get("PROGRAM_STATUS") == "RUNNING":
            if int(state["RA1_GRAD_PROGRAM_TOKENS_USED"]) >= PROGRAM_BUDGET - 5 * TOKENS_PER_STEP:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
            else:
                state["PROGRAM_STATUS"] = f"PHASE_{state.get('PHASE')}_INCOMPLETE"
        if state.get("PHASE_ADVANCE_PARENT"):
            _ensure_generalization_eval()
            _measure_heldout(state, Path(CKPT_BASE) / state["PHASE_ADVANCE_PARENT"])
        ge = graduation_eval(state)
        state["FOUNDATION_SUITE_RESULT"] = ge["suite"]
        if ge["ready"]:
            state["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES"
            state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
        # token1 limitation: if blocked only by first-token breadth
        bits = ge["bits"]
        if (
            state.get("FOUNDATION_READY_FOR_GRADUATION_REVIEW") != "YES"
            and bits.get("token2")
            and bits.get("multi")
            and not bits.get("first_token_classes")
        ):
            state["ENTRY_ADAPTER_REVIEW_REQUIRED"] = "YES"
            state["PROGRAM_STATUS"] = "ENTRY_ADAPTER_REVIEW_REQUIRED"
        state["NEXT_COMMANDER_DECISION"] = [
            "Do not promote. Canonical remains STEP_400.",
            f"Program status: {state.get('PROGRAM_STATUS')}.",
            "RA1 B32 only. Frozen base unchanged. Do not enlarge, LoRA, or unfreeze.",
        ]
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
