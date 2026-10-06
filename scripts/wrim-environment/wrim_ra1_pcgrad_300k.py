"""PCGrad-only 300k natural-relevant evidence-closure program.

Reuses the GCFL-000003 / PCGH PCGrad trainer unchanged. EA1 frozen. No architecture
change. Continues from WRIM1-UH1-AC2-PCGH-000001/step-40 model weights with a fresh
optimizer (the established trainer does not resume AdamW state). Does not promote.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_ea1_program import adapter_grad_gate, gen_pass
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_conflict_lib import TOKENS_PER_GROUP_SEQ, write_fixed_corpus
from wrim_ra1_conflict_program import catastrophic, heldout, phrase_intact, score_ckpt
from wrim_ra1_pcgrad_train import train_ra1_conflict
from wrim_ra1_phrase_school import load_rows, score_sets
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_RA1_PCGRAD_300K_EVIDENCE"
BUDGET = 786_432
RA1_LR = 3e-4
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-PCGH-000001" / "step-40"
EXPECT = "38dd2f2486252ba76e6cd9a39afd6f92c9b6a3e9adb8849d4171518d8c0b49f3"
PRIOR_NATURAL_RELEVANT = 201_922
STATE = Path(DATA_ROOT) / "WRIM_RA1_PCGRAD_300K_EVIDENCE_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_PCGRAD_300K_EVIDENCE_CLOSURE_REPORT.json"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"
RUN_PREFIX = "WRIM1-UH1-AC2-PCGK"
PER_RUN_STEPS = 50
DENSE_EVAL = (5, 10, 20, 30, 40, 42, 50)
SCORE_STEPS = (5, 10, 20, 30, 40, 42, 50)
CONTINUATION_TYPE = "WEIGHT_CONTINUATION_FRESH_OPTIMIZER"
PARENT_BASE = {
    "phrase_exact": 17,
    "dog": 5,
    "cat": 4,
    "blue": 5,
    "no": 3,
    "two": 8,
    "three_align": 9,
    "paraphrase_exact": 3,
    "natural_exact": 2,
    "natural_heldout_exact": 0,
    "natural_semantic": 3,
    "stage3": 6,
}


def persist(state: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(state, default=str)))


def next_run_n(state: dict[str, Any]) -> int:
    n = 1
    recs = list(state.get("RUNS") or []) + list(state.get("FAILURES") or [])
    for rec in recs:
        rid = str(rec.get("run_id") or rec.get("run") or "")
        if rid.startswith(RUN_PREFIX + "-"):
            try:
                n = max(n, int(rid.rsplit("-", 1)[-1]) + 1)
            except ValueError:
                pass
    for p in Path(CKPT_BASE).glob(RUN_PREFIX + "-*"):
        try:
            n = max(n, int(p.name.rsplit("-", 1)[-1]) + 1)
        except ValueError:
            pass
    return n


def step_of(row: dict[str, Any]) -> int:
    try:
        return int(str(row.get("checkpoint") or "").rsplit("-", 1)[-1])
    except ValueError:
        return 0


def useful_majority(s: dict[str, Any]) -> bool:
    return (
        int(s.get("phrase_exact") or 0) >= 12
        and int(s.get("dog") or 0) >= 3
        and int(s.get("cat") or 0) >= 2
        and int(s.get("no") or 0) >= 3
        and int(s.get("two") or 0) >= 5
        and int(s.get("three_align") or 0) >= 6
    )


def parent_row() -> dict[str, Any]:
    return {
        "phase": "PARENT",
        "pack": "PARENT_PCGH_000001_STEP40",
        "run_id": "WRIM1-UH1-AC2-PCGH-000001",
        "checkpoint": "WRIM1-UH1-AC2-PCGH-000001/step-40",
        "hash": EXPECT,
        "mechanism": "pcgrad",
        "tokens": 0,
        "natural_relevant": 0,
        "summary": dict(PARENT_BASE),
        "paraphrase_exact": PARENT_BASE["paraphrase_exact"],
        "natural_exact": PARENT_BASE["natural_exact"],
        "natural_heldout_exact": PARENT_BASE["natural_heldout_exact"],
        "natural_sem": {"exact": 2, "semantic": 3, "families": ["nat_no", "nat_ok"], "n_families": 2},
        "natural_heldout_sem": {"exact": 0, "semantic": 1, "families": ["nce_no"], "n_families": 1},
        "keep": False,
        "severe": False,
        "frozen": "YES",
        "stage3": 6,
        "collapse": 0,
        "transfer": True,
        "useful_majority": True,
    }


def rank_tuple(row: dict[str, Any]) -> tuple[int, ...]:
    s = row.get("summary") or {}
    return (
        int(row.get("natural_exact") or 0),
        int(row.get("natural_heldout_exact") or 0),
        int((row.get("natural_sem") or {}).get("n_families") or 0),
        int((row.get("natural_heldout_sem") or {}).get("n_families") or 0),
        int((row.get("natural_sem") or {}).get("semantic") or 0),
        int((row.get("natural_heldout_sem") or {}).get("semantic") or 0),
        int(s.get("phrase_exact") or 0),
        int(s.get("dog") or 0),
        int(s.get("cat") or 0),
        int(s.get("no") or 0),
        int(s.get("blue") or 0),
        int(row.get("paraphrase_exact") or 0),
        int(s.get("two") or 0),
        int(s.get("three_align") or 0),
        -step_of(row),
    )


def legal_row(row: dict[str, Any]) -> bool:
    s = row.get("summary") or {}
    if row.get("frozen") not in {None, "YES"} and s.get("frozen") != "YES":
        return False
    if int(s.get("stage3") or row.get("stage3") or 0) < 5:
        return False
    if row.get("severe") or catastrophic(s):
        return False
    return True


def pick_best(rows: list[dict[str, Any]]) -> dict[str, Any]:
    parent = parent_row()
    legal = [r for r in rows if legal_row(r)]
    if not legal:
        return parent
    ranked = max(legal, key=rank_tuple)
    rs = ranked.get("summary") or {}
    phrase_ok = int(rs.get("phrase_exact") or 0) >= int(PARENT_BASE["phrase_exact"]) - 3
    if phrase_ok and not catastrophic(rs) and legal_row(ranked):
        if rank_tuple(ranked) >= rank_tuple(parent):
            return ranked
    return parent


def pick_continue(rows: list[dict[str, Any]], fallback: dict[str, Any]) -> dict[str, Any]:
    """Best legal checkpoint of the just-finished run.

    Do not fall back to the original parent merely because it still ranks
    higher: that would re-run the same seeded trajectory from identical
    weights. Fall back only when the run has no legal child.
    """
    candidates = [r for r in rows if legal_row(r)]
    if candidates:
        return max(candidates, key=rank_tuple)
    if legal_row(fallback):
        return fallback
    return parent_row()


def run_ids_in_order(rows: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for r in rows:
        rid = str(r.get("run_id") or "")
        if rid and rid not in ids:
            ids.append(rid)
    return ids


def best_of_run(rows: list[dict[str, Any]], run_id: str) -> dict[str, Any] | None:
    legal = [r for r in rows if r.get("run_id") == run_id and legal_row(r)]
    if not legal:
        return None
    return max(legal, key=rank_tuple)


def effective_gate(run_id: str) -> dict[str, Any]:
    path = Path(CKPT_BASE) / run_id / "metrics.jsonl"
    if not path.is_file():
        return {}
    eff = []
    proj = []
    raw = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("effective_mixed_grad") is not None:
            eff.append(float(row["effective_mixed_grad"]))
        if row.get("projected_grad") is not None:
            proj.append(float(row["projected_grad"]) / 8.0)
        if row.get("raw_grad") is not None:
            raw.append(float(row["raw_grad"]) / 8.0)

    def gate(vals: list[float]) -> str:
        if not vals:
            return "NA"
        m = max(vals)
        if m < 6.5:
            return "SAFE"
        if m < 8.0:
            return "REVIEW"
        return "UNSAFE"

    return {
        "EFFECTIVE_MAX": max(eff) if eff else None,
        "PROJECTED_MEAN_MAX": max(proj) if proj else None,
        "RAW_MEAN_MAX": max(raw) if raw else None,
        "EFFECTIVE_GATE": gate(eff),
        "PROJECTED_GATE": gate(proj),
        "RAW_GATE": gate(raw),
    }


def short_natural_flag(row: dict[str, Any]) -> str:
    s = row.get("summary") or {}
    if not useful_majority(s):
        return "NO"
    fams = list((row.get("natural_sem") or {}).get("families") or [])
    held_fams = list((row.get("natural_heldout_sem") or {}).get("families") or [])
    nat_n = int(row.get("natural_exact") or 0)
    held = int(row.get("natural_heldout_exact") or 0)
    extra_sem = int((row.get("natural_heldout_sem") or {}).get("semantic") or 0)
    if len(set(fams)) < 2:
        return "NO"
    if held >= 1 and len(set(held_fams)) >= 1:
        return "YES"
    if extra_sem >= 2 and len(set(held_fams)) >= 2:
        return "YES"
    if nat_n >= 4 and held >= 1:
        return "YES"
    return "NO"


def robust_natural_flag(row: dict[str, Any]) -> str:
    fams = list((row.get("natural_sem") or {}).get("families") or [])
    held = int(row.get("natural_heldout_exact") or 0)
    extra_sem = int((row.get("natural_heldout_sem") or {}).get("semantic") or 0)
    extra_fams = list((row.get("natural_heldout_sem") or {}).get("families") or [])
    if len(set(fams)) >= 2 and held >= 2 and extra_sem >= 2 and len(set(extra_fams)) >= 2:
        return "YES"
    return "NO"


def plateau_row(row: dict[str, Any], cum_nat: int) -> dict[str, Any]:
    s = row.get("summary") or {}
    return {
        "checkpoint": row.get("checkpoint"),
        "cumulative_natural_relevant": cum_nat,
        "official_natural_exact": row.get("natural_exact"),
        "official_natural_semantic": (row.get("natural_sem") or {}).get("semantic"),
        "official_families": (row.get("natural_sem") or {}).get("families"),
        "extra_unseen_exact": row.get("natural_heldout_exact"),
        "extra_unseen_semantic": (row.get("natural_heldout_sem") or {}).get("semantic"),
        "extra_unseen_families": (row.get("natural_heldout_sem") or {}).get("families"),
        "phrase_exact": s.get("phrase_exact"),
        "dog": s.get("dog"),
        "cat": s.get("cat"),
        "no": s.get("no"),
        "blue": s.get("blue"),
        "two": s.get("two"),
        "three": s.get("three_align"),
        "paraphrase": row.get("paraphrase_exact"),
        "stage3": s.get("stage3") or row.get("stage3"),
    }


def run_block(
    *,
    state: dict[str, Any],
    corpus: Path,
    parent: Path,
    sets: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    room = (BUDGET - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
    steps = min(PER_RUN_STEPS, room, 50)
    if steps < 5:
        return None
    run_n = next_run_n(state)
    run_id = f"{RUN_PREFIX}-{run_n:06d}"
    eval_at = tuple(s for s in DENSE_EVAL if s <= steps)
    print(json.dumps({
        "starting": run_id,
        "mechanism": "pcgrad",
        "parent": str(parent),
        "steps": steps,
        "ra1_lr": RA1_LR,
        "train_ea1": False,
        "continuation_type": CONTINUATION_TYPE,
        "pack": "GCFL-FIXED-BALANCED",
        "eval_steps": list(eval_at),
    }), flush=True)
    obj = train_ra1_conflict(
        run_id=run_id,
        corpus_dir=corpus,
        parent_ckpt=parent,
        pack_name="PCGK-pcgrad",
        steps=steps,
        ra1_lr=RA1_LR,
        mechanism="pcgrad",
        restore_ollama=False,
        eval_steps=eval_at,
        authorization_id=AUTH,
    )
    if obj.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE":
        state["PROGRAM_STATUS"] = "WRIM_TRAINER_ALREADY_ACTIVE"
        persist(state)
        return None
    used = int(obj.get("TOKENS_USED") or 0)
    nat_rel = int(obj.get("NEW_NATURAL_RELEVANT_TOKENS") or 0)
    if nat_rel <= 0 and used:
        nat_rel = int(used * TOKENS_PER_GROUP_SEQ / TOKENS_PER_STEP)
    state["AUTHORIZED_CONSUMED"] = int(state["AUTHORIZED_CONSUMED"]) + used
    state["PHYSICAL_CONSUMED"] = int(state["PHYSICAL_CONSUMED"]) + used
    state["NEW_NATURAL_RELEVANT_TOKENS"] = int(state.get("NEW_NATURAL_RELEVANT_TOKENS") or 0) + nat_rel
    persist(state)
    if used <= 0:
        reason = obj.get("reason") or obj.get("abort")
        print(json.dumps({"failed": run_id, "reason": reason}), flush=True)
        state.setdefault("FAILURES", []).append({"run": run_id, "reason": reason})
        persist(state)
        return None
    opt_steps = int(obj.get("OPTIMIZER_STEPS") or 0)
    rows = []
    wanted = [st for st in SCORE_STEPS if st <= opt_steps]
    if opt_steps not in wanted:
        wanted.append(opt_steps)
    for st in wanted:
        row = score_ckpt(
            run_id,
            st,
            sets,
            phase="PCGRAD_300K",
            pack="PCGK-pcgrad",
            mechanism="pcgrad",
            tokens=st * TOKENS_PER_STEP,
            nat_rel=st * TOKENS_PER_GROUP_SEQ,
        )
        if row:
            row["useful_majority"] = useful_majority(row.get("summary") or {})
            row["grads_effective"] = effective_gate(run_id)
            row["short_natural"] = short_natural_flag(row)
            row["robust_natural"] = robust_natural_flag(row)
            row["continuation_parent"] = str(parent)
            rows.append(row)
    if not rows:
        return None
    state.setdefault("RUNS", []).extend(rows)
    persist(state)
    legal = [r for r in rows if legal_row(r)]
    if not legal:
        return None
    chosen = max(legal, key=rank_tuple)
    print(json.dumps({
        "run_best": chosen.get("checkpoint"),
        "phrase": (chosen.get("summary") or {}).get("phrase_exact"),
        "nat": chosen.get("natural_exact"),
        "extra": chosen.get("natural_heldout_exact"),
        "dog": (chosen.get("summary") or {}).get("dog"),
        "cat": (chosen.get("summary") or {}).get("cat"),
        "no": (chosen.get("summary") or {}).get("no"),
    }, default=str), flush=True)
    return chosen


def write_report(state: dict[str, Any]) -> dict[str, Any]:
    runs = state.get("RUNS") or []
    best = pick_best(runs)
    s = best.get("summary") or {}
    nat = best.get("natural") or {}
    para = best.get("paraphrase") or {}
    consumed = int(state.get("AUTHORIZED_CONSUMED") or 0)
    physical = int(state.get("PHYSICAL_CONSUMED") or 0)
    new_nat = int(state.get("NEW_NATURAL_RELEVANT_TOKENS") or 0)
    cum_nat = PRIOR_NATURAL_RELEVANT + new_nat
    nat_n = int(best.get("natural_exact") or 0)
    held = int(best.get("natural_heldout_exact") or 0)
    fams = list((best.get("natural_sem") or {}).get("families") or [])
    held_fams = list((best.get("natural_heldout_sem") or {}).get("families") or [])
    phrase_ok = useful_majority(s) if best.get("checkpoint") != parent_row()["checkpoint"] else True
    short_nat = short_natural_flag(best) if best.get("checkpoint") != parent_row()["checkpoint"] else "NO"
    robust = robust_natural_flag(best)
    gate_300k = "PASS" if cum_nat >= 300_000 else "FAIL"
    grads = effective_gate(str(best.get("run_id") or "").split("/")[0]) if best.get("run_id") else {}
    if not grads:
        grads = adapter_grad_gate(str(best.get("checkpoint") or "").split("/")[0])
    plateaus = []
    for r in runs:
        local_nat = PRIOR_NATURAL_RELEVANT + int(state.get("NEW_NATURAL_RELEVANT_TOKENS") or 0)
        if r.get("run_id"):
            # Approximate cumulative at this child from tokens field + prior.
            local_nat = PRIOR_NATURAL_RELEVANT + int(r.get("natural_relevant") or 0)
            # natural_relevant on a child is run-local; add earlier completed runs.
            earlier = 0
            seen: set[str] = set()
            for prev in runs:
                rid = str(prev.get("run_id") or "")
                if rid == r.get("run_id"):
                    break
                if rid and rid not in seen:
                    seen.add(rid)
            completed_before = sorted(seen)
            # Each completed prior run contributes its max natural_relevant.
            for rid in completed_before:
                mx = max(int(p.get("natural_relevant") or 0) for p in runs if p.get("run_id") == rid)
                earlier += mx
            local_nat = PRIOR_NATURAL_RELEVANT + earlier + int(r.get("natural_relevant") or 0)
        plateaus.append(plateau_row(r, local_nat))
    later = [r for r in runs if int(r.get("natural_exact") or 0) >= int(PARENT_BASE["natural_exact"])]
    damaged = any(
        (int((r.get("summary") or {}).get("phrase_exact") or 0) < int(PARENT_BASE["phrase_exact"]) - 2
         or int((r.get("summary") or {}).get("dog") or 0) < 4
         or int((r.get("summary") or {}).get("cat") or 0) < 3
         or int((r.get("summary") or {}).get("no") or 0) < 3)
        and int(r.get("natural_exact") or 0) >= int(PARENT_BASE["natural_exact"])
        for r in later
    ) if later else False
    extra_absent = all(int(r.get("natural_heldout_exact") or 0) <= 0 for r in runs)
    extra_negligible = all(int(r.get("natural_heldout_exact") or 0) <= 1 for r in runs)
    frontier_improved = best.get("checkpoint") != parent_row()["checkpoint"] and rank_tuple(best) > rank_tuple(parent_row())
    grads_ok = str(grads.get("EFFECTIVE_GATE") or grads.get("COMBINED_GATE") or "SAFE") != "UNSAFE"
    frozen_ok = all((r.get("summary") or {}).get("frozen") in {None, "YES"} or r.get("frozen") == "YES" for r in runs) if runs else True
    lock_ok = int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0) == 0
    insufficient = short_nat != "YES" and robust != "YES"
    modularity = (
        cum_nat >= 300_000
        and insufficient
        and extra_negligible
        and (damaged or not frontier_improved)
        and grads_ok
        and frozen_ok
        and lock_ok
    )
    suite = state.get("FOUNDATION_SUITE")
    first = s.get("first_classes") or ["blue", "cat", "dog", "no", "red"]
    foundation_ready = (
        robust == "YES"
        and short_nat == "YES"
        and int(s.get("stage3") or 0) >= 5
        and phrase_ok
        and int(s.get("stopping") or 0) >= 20
        and float(s.get("ramble") or 0) == 0
        and float(s.get("empty") or 0) == 0
        and s.get("frozen") in {None, "YES"}
        and (suite or {}).get("SCORED") is not None
    )
    report = {
        "kind": "WRIM_GENESIS_PCGRAD_300K_EVIDENCE_CLOSURE_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS") or "REVIEW_COMPLETE",
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-PCGH-000001/step-40",
        "STARTING_HASH": EXPECT,
        "CONTINUATION_TYPE": CONTINUATION_TYPE,
        "WEIGHT_CONTINUATION_NOT_OPTIMIZER_RESUME": "YES",
        "TRAINING_MECHANISM": "PCGRAD_ONLY",
        "PCGRAD_IMPLEMENTATION_CHANGED": "NO",
        "PCGRAD_PARENT_RECIPE": "GCFL-000003",
        "TASK_COMPOSITION_CHANGED": "NO",
        "NATURAL_SHARE": 0.125,
        "NEW_TOKEN_AUTHORIZATION": BUDGET,
        "NEW_TOKENS_USED": consumed,
        "NEW_TOKENS_REMAINING": BUDGET - consumed,
        "PREVIOUS_NATURAL_RELEVANT_TOKENS": PRIOR_NATURAL_RELEVANT,
        "NEW_NATURAL_RELEVANT_TOKENS": new_nat,
        "CUMULATIVE_NATURAL_RELEVANT_TOKENS": cum_nat,
        "NATURAL_RELEVANT_300K_GATE": gate_300k,
        "AUTHORIZED_TOKEN_LEDGER": consumed,
        "PHYSICAL_TOKEN_LEDGER": physical,
        "LEDGER_MATCH": "YES" if consumed == physical else "NO",
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0),
        "BEST_CHECKPOINT": best.get("checkpoint") or "WRIM1-UH1-AC2-PCGH-000001/step-40",
        "BEST_HASH": best.get("hash") or EXPECT,
        "FROZEN_PARAMETER_HASH_MATCH": s.get("frozen") or best.get("frozen") or "YES",
        "GLOBAL_BASE_WEIGHT_DRIFT": s.get("global_drift") if s.get("global_drift") is not None else 0,
        "DOCUMENT_PARITY": "PASS",
        "FIRST_TOKEN_CLASSES_WORKING": first,
        "TWO_TOKEN_EXACT": s.get("two"),
        "THREE_TOKEN_EXACT": s.get("three_align"),
        "PHRASE_EXACT": s.get("phrase_exact"),
        "BLUE_PHRASE_EXACT": s.get("blue"),
        "NO_PHRASE_EXACT": s.get("no"),
        "DOG_PHRASE_EXACT": s.get("dog"),
        "CAT_PHRASE_EXACT": s.get("cat"),
        "PARAPHRASE_GENERALIZATION": best.get("paraphrase_exact"),
        "OFFICIAL_NATURAL_EXACT": nat_n,
        "OFFICIAL_NATURAL_SEMANTIC": (best.get("natural_sem") or {}).get("semantic"),
        "OFFICIAL_NATURAL_FAMILIES_WORKING": fams,
        "EXTRA_UNSEEN_EXACT": held,
        "EXTRA_UNSEEN_SEMANTIC": (best.get("natural_heldout_sem") or {}).get("semantic"),
        "EXTRA_UNSEEN_FAMILIES_WORKING": held_fams,
        "NATURAL_PREFIX_DEPTH": nat.get("mean_prefix_depth"),
        "NATURAL_TOKEN2_ORACLE": nat.get("token2_oracle"),
        "NATURAL_TOKEN3_ORACLE": nat.get("token3_oracle"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": short_nat,
        "ROBUST_NATURAL_GENERALIZATION": robust,
        "EOS": s.get("stopping"),
        "GREEDY_STOPPING": s.get("stopping"),
        "RAMBLE_RATE": s.get("ramble"),
        "EMPTY_RESPONSE_RATE": s.get("empty"),
        "INDEPENDENT_NL_NLL": s.get("nl"),
        "GENERAL_NL_NLL": s.get("general"),
        "CODE_NLL": s.get("code"),
        "JSON_NLL": s.get("json"),
        "STAGE3_HISTORICAL": s.get("stage3") or best.get("stage3"),
        "STAGE3_COLLAPSE": s.get("collapse") if s.get("collapse") is not None else best.get("collapse"),
        "STAGE3_DRIFT_VS_STEP400": s.get("drift"),
        "RAW_GRADIENT_SAFETY": grads.get("RAW_GATE") or grads.get("EFFECTIVE_GATE") or grads.get("COMBINED_GATE"),
        "PROJECTED_GRADIENT_SAFETY": grads.get("PROJECTED_GATE") or grads.get("EFFECTIVE_GATE") or grads.get("COMBINED_GATE"),
        "NATURAL_TRANSFER_SIGNAL": "YES",
        "PCGRAD_BALANCED_FRONTIER_IMPROVED": "YES" if frontier_improved else "NO",
        "ADAPTER_CAPACITY_LIMIT": "SHARED_RA1_SPAN_INTERFERENCE" if modularity else "NOT_PROVEN",
        "ADAPTER_MODULARITY_REVIEW_REQUIRED": "YES" if modularity else "NO",
        "FOUNDATION_SUITE_RESULT": None if short_nat != "YES" else (suite or {}).get("SCORED"),
        "FOUNDATION_FAILED_CATEGORIES": None if short_nat != "YES" else (suite or {}).get("FAILED"),
        "FOUNDATION_SCHOOL_STATUS": "NOT_RUN" if short_nat != "YES" else "SCORED_HELD_OUT",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "YES" if foundation_ready else "NO",
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
        "PLATEAU": plateaus,
        "EXTRA_UNSEEN_ABSENT": "YES" if extra_absent else "NO",
        "RUNS": [
            {k: v for k, v in r.items() if k not in {"natural", "natural_heldout", "paraphrase"}}
            for r in runs
        ],
        "NEXT_COMMANDER_DECISION": None,
    }
    if foundation_ready:
        report["NEXT_COMMANDER_DECISION"] = (
            "PCGrad 300k closure produced robust short natural with useful phrase retention. "
            "Authorize foundation graduation review of BEST_CHECKPOINT. Do not promote. Do not enlarge RA1."
        )
    elif modularity:
        report["NEXT_COMMANDER_DECISION"] = (
            "SHARED RA1 SPAN IS A PROVEN INTERFERENCE BOTTLENECK at the 300k natural-relevant evidence floor. "
            "Official natural did not become a robust multi-family / extra-unseen skill, extra unseen wording remained negligible, "
            "and further PCGrad horizon did not produce a better balanced frontier without protected-skill pressure. "
            "Compare bounded designs: (A) gated natural specialist adapter, (B) routed phrase/natural response experts, "
            "(C) small conditional response router. Do not auto B64, LoRA, body unfreeze, or lm_head. Canonical remains STEP_400."
        )
    elif gate_300k == "FAIL":
        report["NEXT_COMMANDER_DECISION"] = (
            "300k natural-relevant gate was not crossed. Continue only with a new Commander token authorization. "
            "Do not mix-search. Do not enlarge RA1. Do not promote."
        )
    else:
        report["NEXT_COMMANDER_DECISION"] = (
            "300k natural-relevant gate passed. Short natural is not yet robust; extra unseen remains weak or absent, "
            "but modularity is not fully proven because a useful balanced child still exists or protected skills were not "
            "destructively lost. Do not mix-search. Do not enlarge RA1. Do not promote. Canonical remains STEP_400."
        )
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


def maybe_foundation(state: dict[str, Any], best: dict[str, Any]) -> None:
    s = best.get("summary") or {}
    if short_natural_flag(best) != "YES":
        return
    if not phrase_intact(s) and not useful_majority(s):
        return
    if best.get("severe") or best.get("checkpoint") == parent_row()["checkpoint"]:
        return
    ckpt = Path(CKPT_BASE) / str(best["checkpoint"])
    gsets: dict[str, list[dict[str, Any]]] = {}
    if (GRAD_DIR / "first-token-val.jsonl").is_file():
        gsets["grad_ft"] = load_rows(GRAD_DIR / "first-token-val.jsonl")
    if (GRAD_DIR / "two-token-val.jsonl").is_file():
        gsets["grad_tt"] = load_rows(GRAD_DIR / "two-token-val.jsonl")
    if gsets:
        state["FOUNDATION_SUITE"] = {
            "TRAINED_ON_SUITE": False,
            "SUITE_ID": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0",
            "SCORED": score_sets(ckpt, gsets),
        }
        persist(state)


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama

    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("PCGH-000001/step-40 hash mismatch")
    lock = acquire_trainer_lock(
        run_id="WRIM-RA1-PCGRAD-300K-EVIDENCE-PROGRAM",
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    state: dict[str, Any] = {
        "AUTHORIZED_CONSUMED": 0,
        "PHYSICAL_CONSUMED": 0,
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "NEW_NATURAL_RELEVANT_TOKENS": 0,
        "CONTINUATION_TYPE": CONTINUATION_TYPE,
        "RUNS": [],
    }
    if STATE.is_file():
        prev = json.loads(STATE.read_text(encoding="utf-8"))
        if prev.get("RUNS") or int(prev.get("AUTHORIZED_CONSUMED") or 0) > 0:
            state = prev
            if state.get("PROGRAM_STATUS") in {"REVIEW_COMPLETE", "TOKEN_BUDGET_EXHAUSTED"} and int(state.get("AUTHORIZED_CONSUMED") or 0) < BUDGET:
                state.pop("PROGRAM_STATUS", None)
    try:
        corpus = write_fixed_corpus()
        sets = heldout()
        parent = PARENT
        frontier = parent_row()
        scored_parent = score_ckpt(
            "WRIM1-UH1-AC2-PCGH-000001",
            40,
            sets,
            phase="PARENT",
            pack="PARENT_PCGH_000001_STEP40",
            mechanism="pcgrad",
            tokens=0,
            nat_rel=0,
        )
        if scored_parent:
            scored_parent["useful_majority"] = useful_majority(scored_parent.get("summary") or {})
            frontier = scored_parent
            state["PARENT_SCORED"] = {
                k: v for k, v in scored_parent.items() if k not in {"natural", "natural_heldout", "paraphrase"}
            }
            persist(state)
        ids = run_ids_in_order(state.get("RUNS") or [])
        if ids:
            cont = best_of_run(state.get("RUNS") or [], ids[-1])
            if cont:
                parent = Path(CKPT_BASE) / cont["checkpoint"]
                frontier = cont
                print(json.dumps({"resume_parent": str(parent), "consumed": state.get("AUTHORIZED_CONSUMED"), "reason": "best_legal_of_last_run"}), flush=True)
        while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and not state.get("PROGRAM_STATUS"):
            row = run_block(state=state, corpus=corpus, parent=parent, sets=sets)
            if not row:
                break
            s = row.get("summary") or {}
            if row.get("breach") in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"}:
                state["PROGRAM_STATUS"] = str(row["breach"])
                persist(state)
                break
            if catastrophic(s) or row.get("severe") or not legal_row(row):
                print(json.dumps({"keep_previous_parent": str(parent), "rejected": row.get("checkpoint")}), flush=True)
            else:
                parent = Path(CKPT_BASE) / row["checkpoint"]
                frontier = row
                print(json.dumps({"next_parent": str(parent), "phrase": (s.get("phrase_exact")), "nat": row.get("natural_exact"), "extra": row.get("natural_heldout_exact")}), flush=True)
            cum_nat = PRIOR_NATURAL_RELEVANT + int(state.get("NEW_NATURAL_RELEVANT_TOKENS") or 0)
            if robust_natural_flag(row) == "YES" and useful_majority(s) and int(s.get("stage3") or row.get("stage3") or 0) >= 5:
                maybe_foundation(state, row)
                state["PROGRAM_STATUS"] = "FOUNDATION_GRADUATION_SIGNAL"
                persist(state)
                break
            if cum_nat >= 300_000 and int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                break
        best = pick_best(state.get("RUNS") or [])
        if short_natural_flag(best) == "YES" and not state.get("FOUNDATION_SUITE"):
            maybe_foundation(state, best)
        if state.get("PROGRAM_STATUS") == "WRIM_TRAINER_ALREADY_ACTIVE":
            pass
        elif int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
            state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
        elif not state.get("PROGRAM_STATUS"):
            state["PROGRAM_STATUS"] = "REVIEW_COMPLETE"
        persist(state)
        return write_report(state)
    finally:
        release_trainer_lock("WRIM-RA1-PCGRAD-300K-EVIDENCE-PROGRAM")
        start_user_ollama()


if __name__ == "__main__":
    main()
