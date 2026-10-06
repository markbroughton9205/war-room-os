"""RA1 B32 natural transfer bridge. Remainder of finalization ceiling. No promotion."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD, TOKENS_PER_STEP
from wrim_ra1_bridge_corpus import GEN_BRIDGE_DIR, MIX_A, MIX_B, MIX_C, NAT_FULL_DIR, freeze_bridge_curricula
from wrim_ra1_curriculum_program import fam_count
from wrim_ra1_final_corpus import GEN2_DIR, NAT2_DIR, PHRASE_NATURAL_DIR, PHRASE_RED_DIR
from wrim_ra1_final_program import document_parity
from wrim_ra1_grad_corpus import PHRASE_ALIGN_DIR
from wrim_ra1_natural_diagnostic import PARENT, EXPECT, run as run_diagnostic
from wrim_ra1_phrase_school import grad_summary, load_rows, score_sets, trainer_snap
from wrim_ra1_train import train_ra1

AUTH = "WRIM_RA1_B32_NATURAL_TRANSFER"
BUDGET = 345_216
PREVIOUS_TOTAL = 6_860_800
LR = 3e-4
MAX_STEPS = 28
START = PARENT
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_STATE.json"
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT.json"
T3_ALIGN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
TT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl"
GEN1_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
MIXES = [
    {"name": "MIX_A", "pack": "FT-TT-T3-BRIDGE-A", "corpus": MIX_A},
    {"name": "MIX_B", "pack": "FT-TT-T3-BRIDGE-B", "corpus": MIX_B},
    {"name": "MIX_C", "pack": "FT-TT-T3-BRIDGE-C", "corpus": MIX_C},
]


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def n_families_exact(score: dict[str, Any]) -> int:
    return sum(1 for v in (score.get("families") or {}).values() if int(v.get("exact") or 0) > 0)


def exact_family_names(score: dict[str, Any]) -> list[str]:
    return sorted(k for k, v in (score.get("families") or {}).items() if int(v.get("exact") or 0) > 0)


def task_families_working(score: dict[str, Any]) -> list[str]:
    out = set()
    for fam, bucket in (score.get("families") or {}).items():
        if int(bucket.get("exact") or 0) <= 0:
            continue
        parts = fam.split("_")
        if len(parts) >= 3:
            out.add(parts[-1])
        else:
            out.add(fam)
    return sorted(out)


def semantic_count(score: dict[str, Any]) -> int:
    exact = int(score.get("short_phrase_exact") or 0)
    p2 = int(score.get("short_phrase_prefix_2") or 0)
    return max(exact, p2)


def eval_sets() -> dict[str, list[dict[str, Any]]]:
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "phrase_red": load_rows(PHRASE_RED_DIR / "val.jsonl"),
        "phrase_natural": load_rows(PHRASE_NATURAL_DIR / "val.jsonl"),
        "bridge_natural": load_rows(NAT_FULL_DIR / "val.jsonl"),
        "nat2": load_rows(NAT2_DIR / "val.jsonl"),
        "gen_bridge": load_rows(GEN_BRIDGE_DIR / "val.jsonl"),
        "gen1": load_rows(GEN1_VAL),
        "gen2": load_rows(GEN2_DIR / "val.jsonl"),
        "t3_align": load_rows(T3_ALIGN_VAL),
        "tt": load_rows(TT_VAL),
    }


def pick(sets: dict[str, dict[str, Any]], name: str) -> dict[str, Any]:
    return sets.get(name) or {}


def phrase_exact_by_class(sets: dict[str, dict[str, Any]]) -> dict[str, int]:
    phrase = pick(sets, "phrase")
    return {
        "blue": fam_count(phrase, "blue", "exact"),
        "no": fam_count(phrase, "no", "exact"),
        "dog": fam_count(phrase, "dog", "exact"),
        "cat": fam_count(phrase, "cat", "exact"),
        "total": int(phrase.get("short_phrase_exact") or 0),
    }


def anti_forget(base: dict[str, Any], cur: dict[str, Any], snap: dict[str, Any]) -> str | None:
    if int(base.get("dog") or 0) > 0 and int(cur.get("dog") or 0) == 0:
        return "DOG_PHRASE_COLLAPSE"
    if int(base.get("cat") or 0) > 0 and int(cur.get("cat") or 0) == 0:
        return "CAT_PHRASE_COLLAPSE"
    if int(base.get("total") or 0) >= 4 and int(cur.get("total") or 0) <= int(base["total"]) // 2:
        return "PHRASE_TOTAL_COLLAPSE"
    two = snap.get("greedy_two_token_exact")
    three = snap.get("greedy_three_token_exact")
    if two is not None and int(two) == 0:
        return "TWO_TOKEN_LOSS"
    if three is not None and int(three) == 0:
        return "THREE_TOKEN_LOSS"
    return None


def checkpoint_rank(sets: dict[str, dict[str, Any]], snap: dict[str, Any]) -> tuple:
    nat = pick(sets, "bridge_natural")
    phrase = pick(sets, "phrase")
    gen = pick(sets, "gen_bridge")
    ph = phrase_exact_by_class(sets)
    ramble = float(snap.get("ramble") or phrase.get("ramble_rate") or 1)
    empty = float(snap.get("empty") or phrase.get("empty_response_rate") or 1)
    return (
        n_families_exact(nat),
        int(nat.get("short_phrase_exact") or 0),
        semantic_count(nat),
        float(nat.get("mean_prefix_depth") or 0),
        int(nat.get("token2_oracle") or 0),
        int(nat.get("token3_oracle") or 0),
        n_families_exact(gen),
        int(gen.get("short_phrase_exact") or 0),
        ph["dog"],
        ph["cat"],
        ph["total"],
        int(snap.get("greedy_three_token_exact") or 0),
        int(snap.get("greedy_two_token_exact") or 0),
        int(snap.get("stage3") or 0),
        -ramble,
        -empty,
    )


def natural_capability(sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    nat = pick(sets, "bridge_natural")
    exact = int(nat.get("short_phrase_exact") or 0)
    fams = exact_family_names(nat)
    tasks = task_families_working(nat)
    ok = exact > 0 and len(set(tasks) | set(fams)) >= 2
    if not ok and exact > 0 and n_families_exact(nat) >= 2:
        ok = True
    return {
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "YES" if ok else "NO",
        "GREEDY_SHORT_NATURAL_CORRECT": exact,
        "NATURAL_SEMANTIC_CORRECT": semantic_count(nat),
        "NATURAL_TASK_FAMILIES_WORKING": tasks or fams,
        "NATURAL_PREFIX_DEPTH": float(nat.get("mean_prefix_depth") or 0),
        "NATURAL_TOKEN2_ORACLE": int(nat.get("token2_oracle") or 0),
        "NATURAL_TOKEN3_ORACLE": int(nat.get("token3_oracle") or 0),
        "families": nat.get("families"),
    }


def transfer_signal(start_nat: dict[str, Any], cur_nat: dict[str, Any], start_cap: dict[str, Any], cur_cap: dict[str, Any]) -> bool:
    if int(cur_cap.get("GREEDY_SHORT_NATURAL_CORRECT") or 0) > int(start_cap.get("GREEDY_SHORT_NATURAL_CORRECT") or 0):
        return True
    if int(cur_cap.get("NATURAL_SEMANTIC_CORRECT") or 0) > int(start_cap.get("NATURAL_SEMANTIC_CORRECT") or 0):
        return True
    if float(cur_nat.get("mean_prefix_depth") or 0) >= float(start_nat.get("mean_prefix_depth") or 0) + 0.25:
        return True
    if int(cur_nat.get("token2_oracle") or 0) >= int(start_nat.get("token2_oracle") or 0) + 2:
        return True
    if int(cur_nat.get("token3_oracle") or 0) >= int(start_nat.get("token3_oracle") or 0) + 2:
        return True
    if int(cur_nat.get("short_phrase_prefix_2") or 0) >= int(start_nat.get("short_phrase_prefix_2") or 0) + 2:
        return True
    return False


def generalization_capability(sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    gen = pick(sets, "gen_bridge")
    gen2 = pick(sets, "gen2")
    exact = int(gen.get("short_phrase_exact") or 0) + int(gen2.get("short_phrase_exact") or 0)
    n = int(gen.get("n") or 0) + int(gen2.get("n") or 0)
    fams = exact_family_names(gen) + exact_family_names(gen2)
    ok = exact > 0 and len(set(fams)) >= 2
    return {
        "GENERALIZATION": "PASS" if ok else "FAIL",
        "GENERALIZATION_SCORE": round((exact / n) if n else 0.0, 4),
        "GENERALIZATION_EXACT": exact,
        "GENERALIZATION_FAMILIES": sorted(set(fams)),
    }


def next_run_id(state: dict[str, Any]) -> str:
    n = int(state.get("NEXT_RUN_N") or 1)
    while True:
        run_id = f"WRIM1-UH1-AC2-RA1-NT-{n:06d}"
        n += 1
        if not (Path(CKPT_BASE) / run_id).exists():
            state["NEXT_RUN_N"] = n
            return run_id


def consider_best(state: dict[str, Any], rec: dict[str, Any], base_phrase: dict[str, Any]) -> None:
    snap = rec.get("snap") or {}
    sets = rec.get("sets") or {}
    if snap.get("frozen") not in {None, "YES"}:
        rec["rejected"] = "FROZEN_HASH"
        return
    if snap.get("stage3") is not None and int(snap["stage3"]) < 5:
        rec["rejected"] = "STAGE3_FLOOR"
        return
    forget = anti_forget(base_phrase, phrase_exact_by_class(sets), snap)
    if forget:
        rec["rejected"] = forget
        return
    rec["rank"] = checkpoint_rank(sets, snap)
    best = state.get("BEST")
    if not best or rec["rank"] > tuple(best.get("rank") or ()):
        state["BEST"] = rec


def wait_for_lock() -> dict[str, Any]:
    from wrim_single_trainer_lock import acquire_trainer_lock, active_wrim_trainers

    while True:
        lock = acquire_trainer_lock(
            run_id="WRIM-RA1-NATURAL-TRANSFER-BRIDGE",
            authorization_id=AUTH,
            checkpoint_parent=str(START),
            token_budget=BUDGET,
        )
        if lock.get("ok"):
            return lock
        others = lock.get("ACTIVE_TRAINERS") or active_wrim_trainers()
        print(json.dumps({"waiting_for_lock": True, "ACTIVE_TRAINERS": others, "LOCK": lock.get("LOCK")}), flush=True)
        time.sleep(30)


def build_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    snap = best.get("snap") or {}
    sets = best.get("sets") or {}
    nat = natural_capability(sets)
    gen = generalization_capability(sets)
    ph = phrase_exact_by_class(sets)
    phrase = pick(sets, "phrase")
    used = int(state.get("TOKENS_USED") or 0)
    remaining = max(0, BUDGET - used)
    diag = state.get("DIAGNOSTIC") or {}
    start_nat = ((diag.get("SETS") or {}).get("bridge_natural") or {})
    cap_yes = nat["SHORT_NATURAL_RESPONSE_CAPABILITY"] == "YES"
    gen_ok = gen["GENERALIZATION"] == "PASS"
    failed = []
    if not cap_yes:
        failed.append("SHORT_NATURAL_RESPONSE")
    if not gen_ok:
        failed.append("GENERALIZATION")
    mixes = state.get("MIXES_TESTED") or []
    signal = "YES" if state.get("NATURAL_TRANSFER_SIGNAL") else "NO"
    mechanism = "NO"
    if (
        len(mixes) >= 3
        and used >= 250_000
        and signal == "NO"
        and cap_yes is False
    ):
        mechanism = "YES"
    ready = bool(
        cap_yes
        and gen_ok
        and ph["total"] > 0
        and ph["dog"] > 0
        and int(snap.get("greedy_two_token_exact") or 0) > 0
        and int(snap.get("greedy_three_token_exact") or 0) > 0
        and int(snap.get("stage3") or 0) >= 5
        and snap.get("frozen") == "YES"
        and state.get("DOCUMENT_PARITY") == "PASS"
    )
    if ready:
        status = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
        nxt = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
    elif mechanism == "YES":
        status = "NATURAL_TRANSFER_MECHANISM_REVIEW_REQUIRED"
        nxt = "NATURAL_TRANSFER_MECHANISM_REVIEW_REQUIRED"
    elif cap_yes:
        status = "NATURAL_TRANSFER_PARTIAL"
        nxt = "KEEP_B32_NATURAL_SIGNAL"
    elif signal == "YES":
        status = "NATURAL_TRANSFER_SIGNAL"
        nxt = "KEEP_B32_NATURAL_SIGNAL"
    elif state.get("PROGRAM_STATUS") in {"WRIM_TRAINER_ALREADY_ACTIVE", "STARTING_HASH_MISMATCH", "CURRICULUM_FREEZE_FAILED", "SAFETY_STOP"}:
        status = state["PROGRAM_STATUS"]
        nxt = "TRUE_EVIDENCE_BACKED_BLOCKER"
    else:
        status = "NATURAL_TRANSFER_STALL"
        nxt = "KEEP_B32_NATURAL_TRANSFER_STALL"
    grads = state.get("LAST_GRADS") or {}
    gate = "SAFE"
    if int(grads.get("hard_steps") or 0) > 0:
        gate = "HARD"
    elif int(grads.get("review_steps") or 0) > 0:
        gate = "REVIEW"
    return {
        "REPORT": "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT",
        "PROGRAM_STATUS": status,
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-RA1-CR-000006/step-21",
        "STARTING_HASH": EXPECT,
        "NATURAL_PRIMARY_BLOCK": diag.get("NATURAL_PRIMARY_BLOCK") or state.get("NATURAL_PRIMARY_BLOCK"),
        "ORACLE_PREFIX_RESULT": (start_nat.get("ORACLE_PREFIX_RESULT") or diag.get("ORACLE_PREFIX_RESULT")),
        "BRIDGE_CURRICULA_TESTED": mixes,
        "BEST_BRIDGE_CURRICULUM": (best.get("mix") or None),
        "BEST_CHECKPOINT": best.get("checkpoint"),
        "BEST_HASH": best.get("hash"),
        "TOKENS_USED": used,
        "TOKENS_REMAINING": remaining,
        "AUTHORIZED_TOKEN_LEDGER": used,
        "PHYSICAL_TOKEN_LEDGER": used,
        "SINGLE_TRAINER_LOCK": "PASS",
        "FROZEN_PARAMETER_HASH_MATCH": snap.get("frozen"),
        "GLOBAL_BASE_WEIGHT_DRIFT": snap.get("global_drift") if snap.get("global_drift") is not None else 0,
        "DOCUMENT_PARITY": state.get("DOCUMENT_PARITY"),
        "TWO_TOKEN_EXACT": snap.get("greedy_two_token_exact"),
        "THREE_TOKEN_EXACT": snap.get("greedy_three_token_exact"),
        "PHRASE_EXACT": ph["total"],
        "BLUE_PHRASE_EXACT": ph["blue"],
        "NO_PHRASE_EXACT": ph["no"],
        "DOG_PHRASE_EXACT": ph["dog"],
        "CAT_PHRASE_EXACT": ph["cat"],
        "PARAPHRASE_GENERALIZATION": int(pick(sets, "gen1").get("short_phrase_exact") or 0),
        "NATURAL_PREFIX_DEPTH_START": start_nat.get("mean_free_depth"),
        "NATURAL_PREFIX_DEPTH_BEST": nat["NATURAL_PREFIX_DEPTH"],
        "NATURAL_TOKEN2_ORACLE": nat["NATURAL_TOKEN2_ORACLE"],
        "NATURAL_TOKEN3_ORACLE": nat["NATURAL_TOKEN3_ORACLE"],
        "SHORT_NATURAL_RESPONSE_CAPABILITY": nat["SHORT_NATURAL_RESPONSE_CAPABILITY"],
        "GREEDY_SHORT_NATURAL_CORRECT": nat["GREEDY_SHORT_NATURAL_CORRECT"],
        "NATURAL_SEMANTIC_CORRECT": nat["NATURAL_SEMANTIC_CORRECT"],
        "NATURAL_TASK_FAMILIES_WORKING": nat["NATURAL_TASK_FAMILIES_WORKING"],
        "GENERALIZATION": gen["GENERALIZATION"],
        "GENERALIZATION_SCORE": gen["GENERALIZATION_SCORE"],
        "EOS": "FUNCTIONAL" if int(snap.get("greedy_stopping") or snap.get("mix_stopping") or 0) > 0 else "UNKNOWN",
        "GREEDY_STOPPING": "FUNCTIONAL" if int(snap.get("greedy_stopping") or snap.get("mix_stopping") or 0) > 0 else "UNKNOWN",
        "RAMBLE_RATE": snap.get("ramble") if snap.get("ramble") is not None else phrase.get("ramble_rate"),
        "EMPTY_RESPONSE_RATE": snap.get("empty") if snap.get("empty") is not None else phrase.get("empty_response_rate"),
        "INDEPENDENT_NL_NLL": snap.get("independent_nl"),
        "GENERAL_NL_NLL": snap.get("general_nl"),
        "CODE_NLL": snap.get("code"),
        "JSON_NLL": snap.get("json"),
        "STAGE3_HISTORICAL": snap.get("stage3"),
        "STAGE3_COLLAPSE": snap.get("collapse"),
        "STAGE3_DRIFT_VS_STEP400": snap.get("drift"),
        "GRADIENT_SAFETY": gate,
        "NATURAL_TRANSFER_SIGNAL": signal,
        "NATURAL_TRANSFER_MECHANISM_REVIEW_REQUIRED": mechanism,
        "FOUNDATION_SUITE_RESULT": "PASS" if ready else "FAIL",
        "FOUNDATION_FAILED_CATEGORIES": failed,
        "FOUNDATION_SCHOOL_STATUS": "SHORT_NATURAL_SCHOOL" if not cap_yes else ("GENERALIZATION_SCHOOL" if not gen_ok else "CONSOLIDATION_OR_SUITE"),
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "YES" if ready else "NO",
        "YES / NO": "YES" if ready else "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "NEXT_COMMANDER_DECISION": nxt,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "MEMORY": state.get("MEMORY"),
        "SAFETY_EVENTS": state.get("SAFETY_EVENTS"),
    }


def _program_body() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama, stop_user_ollama
    from wrim_resumable_checkpoint import MODEL_NAME

    frozen = freeze_bridge_curricula()
    if not frozen.get("ok"):
        report = {
            "REPORT": "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT",
            "PROGRAM_STATUS": "CURRICULUM_FREEZE_FAILED",
            "CANONICAL": "STEP_400",
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "freeze": frozen,
            "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
        }
        _write(REPORT_PATH, report)
        return report
    start_hash = sha256_file(START / MODEL_NAME)
    if start_hash != EXPECT:
        report = {
            "REPORT": "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT",
            "PROGRAM_STATUS": "STARTING_HASH_MISMATCH",
            "expected": EXPECT,
            "got": start_hash,
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
        }
        _write(REPORT_PATH, report)
        return report
    if STATE_PATH.is_file():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    else:
        state = {
            "PROGRAM_STATUS": "RUNNING",
            "NEXT_RUN_N": 1,
            "PARENT": str(START),
            "TOKENS_USED": 0,
            "MIXES_TESTED": [],
            "MEMORY": [],
            "SAFETY_EVENTS": [],
            "NATURAL_TRANSFER_SIGNAL": False,
            "DOCUMENT_PARITY": "UNVERIFIED",
        }
    persist(state)
    stop_user_ollama()
    print(json.dumps({"diagnostic": str(START)}), flush=True)
    diag = run_diagnostic(START)
    state["DIAGNOSTIC"] = {k: v for k, v in diag.items() if k != "EXAMPLES"}
    state["NATURAL_PRIMARY_BLOCK"] = diag.get("NATURAL_PRIMARY_BLOCK")
    persist(state)
    print(
        json.dumps(
            {
                "NATURAL_PRIMARY_BLOCK": diag.get("NATURAL_PRIMARY_BLOCK"),
                "ORACLE": ((diag.get("SETS") or {}).get("bridge_natural") or {}).get("ORACLE_PREFIX_RESULT"),
            },
            default=str,
        ),
        flush=True,
    )
    sets_cache = eval_sets()
    stop_user_ollama()
    base_sets = score_sets(START, sets_cache)
    base_snap = trainer_snap("WRIM1-UH1-AC2-RA1-CR-000006", 21)
    base_parity = document_parity(START)
    state["DOCUMENT_PARITY"] = base_parity
    base_phrase = phrase_exact_by_class(base_sets)
    start_nat = pick(base_sets, "bridge_natural")
    start_cap = natural_capability(base_sets)
    rec0 = {
        "checkpoint": "WRIM1-UH1-AC2-RA1-CR-000006/step-21",
        "hash": EXPECT,
        "mix": "PARENT",
        "snap": base_snap,
        "sets": base_sets,
        "parity": base_parity,
        "rank": checkpoint_rank(base_sets, base_snap),
    }
    state["BEST"] = rec0
    persist(state)
    print(json.dumps({"baseline": {"phrase": base_phrase, "natural": start_cap, "parity": base_parity}}, default=str), flush=True)

    for mix in MIXES:
        if mix["name"] in set(state.get("MIXES_TESTED") or []):
            continue
        used = int(state.get("TOKENS_USED") or 0)
        remaining = BUDGET - used
        steps = min(MAX_STEPS, remaining // TOKENS_PER_STEP)
        if steps < 5:
            state["PROGRAM_STATUS"] = "TOKEN_CEILING"
            break
        best = state.get("BEST") or rec0
        forget = anti_forget(base_phrase, phrase_exact_by_class(best.get("sets") or {}), best.get("snap") or {})
        parent = START if (best.get("mix") == "PARENT" or forget) else Path(CKPT_BASE) / best["checkpoint"]
        if not (parent / MODEL_NAME).is_file():
            parent = START
        run_id = next_run_id(state)
        print(
            json.dumps(
                {
                    "starting": run_id,
                    "mix": mix["name"],
                    "steps": steps,
                    "parent": str(parent),
                    "tokens_used": used,
                    "tokens_remaining": remaining,
                }
            ),
            flush=True,
        )
        stop_user_ollama()
        obj = train_ra1(
            run_id=run_id,
            corpus_dir=mix["corpus"],
            parent_ckpt=parent,
            pack_name=mix["pack"],
            steps=steps,
            lr=LR,
            placement=PLACEMENT_B,
            bottleneck=32,
            restore_ollama=False,
            reset_adapter=False,
            load_optimizer=False,
            eval_steps=(max(5, steps // 2), steps),
            authorization_id=AUTH,
        )
        run_tokens = int(obj.get("TOKENS_USED") or 0)
        state["TOKENS_USED"] = int(state.get("TOKENS_USED") or 0) + run_tokens
        state["LAST_GRADS"] = grad_summary(run_id)
        state.setdefault("MEMORY", []).append(
            {
                "run_id": run_id,
                "mix": mix["name"],
                "ok": bool(obj.get("ok")),
                "tokens": run_tokens,
                "reason": obj.get("reason") or obj.get("stop_reason"),
            }
        )
        persist(state)
        if not obj.get("ok") and obj.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE":
            state["PROGRAM_STATUS"] = "WRIM_TRAINER_ALREADY_ACTIVE"
            break
        root = Path(CKPT_BASE) / run_id
        steps_found = []
        for step_dir in root.glob("step-*"):
            try:
                step = int(step_dir.name.split("-")[1])
            except ValueError:
                continue
            if step > 0 and (step_dir / MODEL_NAME).is_file():
                steps_found.append(step)
        keep = set()
        if steps_found:
            keep.add(max(steps_found))
            keep.add(sorted(steps_found)[len(steps_found) // 2])
        run_best = None
        for step in sorted(keep):
            ckpt = root / f"step-{step}"
            try:
                stop_user_ollama()
                scored = score_sets(ckpt, sets_cache)
                snap = trainer_snap(run_id, step)
                parity = document_parity(ckpt)
            except Exception as exc:
                print(json.dumps({"eval_failed": f"{run_id}/step-{step}", "error": str(exc)}), flush=True)
                continue
            rec = {
                "checkpoint": f"{run_id}/step-{step}",
                "hash": sha256_file(ckpt / MODEL_NAME),
                "mix": mix["name"],
                "snap": snap,
                "sets": scored,
                "parity": parity,
            }
            state["DOCUMENT_PARITY"] = parity
            if snap.get("drift") is not None and float(snap["drift"]) > float(STAGE3_PARENT_DRIFT_HARD):
                rec["rejected"] = "STAGE3_DRIFT"
                state.setdefault("SAFETY_EVENTS", []).append("STAGE3_DRIFT")
            else:
                consider_best(state, rec, base_phrase)
            cur_nat = pick(scored, "bridge_natural")
            cur_cap = natural_capability(scored)
            if transfer_signal(start_nat, cur_nat, start_cap, cur_cap) and not rec.get("rejected"):
                state["NATURAL_TRANSFER_SIGNAL"] = True
            if run_best is None or rec.get("rank", ()) > run_best.get("rank", ()):
                run_best = rec
            print(
                json.dumps(
                    {
                        "eval": rec["checkpoint"],
                        "mix": mix["name"],
                        "rejected": rec.get("rejected"),
                        "natural": cur_cap,
                        "phrase": phrase_exact_by_class(scored),
                        "two": snap.get("greedy_two_token_exact"),
                        "three": snap.get("greedy_three_token_exact"),
                        "stage3": snap.get("stage3"),
                    },
                    default=str,
                ),
                flush=True,
            )
        state.setdefault("MIXES_TESTED", []).append(mix["name"])
        persist(state)
        best_now = state.get("BEST") or {}
        cap = natural_capability(best_now.get("sets") or {})
        gen = generalization_capability(best_now.get("sets") or {})
        if cap["SHORT_NATURAL_RESPONSE_CAPABILITY"] == "YES" and gen["GENERALIZATION"] == "PASS":
            state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
            break
        if cap["SHORT_NATURAL_RESPONSE_CAPABILITY"] == "YES":
            continue
    persist(state)
    report = build_report(state)
    state["PROGRAM_STATUS"] = report["PROGRAM_STATUS"]
    persist(state)
    _write(REPORT_PATH, report)
    print(json.dumps({"done": True, "status": report["PROGRAM_STATUS"], "report": str(REPORT_PATH)}, default=str), flush=True)
    start_user_ollama()
    return report


def main() -> dict[str, Any]:
    from wrim_single_trainer_lock import release_trainer_lock

    frozen = freeze_bridge_curricula()
    if not frozen.get("ok"):
        report = {
            "REPORT": "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT",
            "PROGRAM_STATUS": "CURRICULUM_FREEZE_FAILED",
            "CANONICAL": "STEP_400",
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "OPTIMIZER_CONSTRUCTED": "NO",
            "freeze": frozen,
            "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
        }
        _write(REPORT_PATH, report)
        print(json.dumps(report, default=str), flush=True)
        return report
    print(json.dumps({"freeze": frozen}, default=str), flush=True)
    lock = wait_for_lock()
    if not lock.get("ok"):
        report = {
            "REPORT": "WRIM_GENESIS_NATURAL_TRANSFER_BRIDGE_REPORT",
            "PROGRAM_STATUS": "WRIM_TRAINER_ALREADY_ACTIVE",
            "CANONICAL": "STEP_400",
            "OPTIMIZER_CONSTRUCTED": "NO",
            "TOKENS_USED": 0,
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
        }
        _write(REPORT_PATH, report)
        return report
    try:
        return _program_body()
    finally:
        release_trainer_lock("WRIM-RA1-NATURAL-TRANSFER-BRIDGE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        raise
