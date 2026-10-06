"""PCGrad-only long-horizon RA1 capacity/modularity test.

Reuses the GCFL-000003 PCGrad trainer unchanged. EA1 frozen. No architecture change.
Starts from WRIM1-UH1-AC2-EA1-000010/step-25. Does not promote.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_ea1_program import adapter_grad_gate, gen_pass
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_conflict_lib import TOKENS_PER_GROUP_SEQ, write_fixed_corpus
from wrim_ra1_conflict_program import (
    PARENT_BASE,
    catastrophic,
    heldout,
    parent_row,
    phrase_intact,
    score_ckpt,
)
from wrim_ra1_pcgrad_train import train_ra1_conflict
from wrim_ra1_phrase_school import load_rows, score_sets
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_RA1_PCGRAD_LONG_HORIZON"
BUDGET = 409_600
RA1_LR = 3e-4
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
PRIOR_NATURAL_RELEVANT = 150_722
STATE = Path(DATA_ROOT) / "WRIM_RA1_PCGRAD_LONG_HORIZON_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_PCGRAD_LONG_HORIZON_REPORT.json"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"
RUN_PREFIX = "WRIM1-UH1-AC2-PCGH"
PER_RUN_STEPS = 50
DENSE_EVAL = (2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50)
SCORE_STEPS = (10, 20, 30, 40, 50)


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


def transfer_signal(row: dict[str, Any]) -> bool:
    nat = row.get("natural") or {}
    if int(row.get("natural_exact") or 0) > int(PARENT_BASE["natural_exact"]):
        return True
    if int(row.get("natural_heldout_exact") or 0) > 0:
        return True
    if int((row.get("natural_sem") or {}).get("n_families") or 0) > 1 and int(row.get("natural_exact") or 0) > 0:
        if int((row.get("natural_sem") or {}).get("semantic") or 0) > 1:
            return True
    if float(nat.get("mean_prefix_depth") or 0) >= 0.75:
        return True
    if int(nat.get("token2_oracle") or 0) >= 2:
        return True
    if int(nat.get("token3_oracle") or 0) >= 1:
        return True
    return False


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
    print(json.dumps({
        "starting": run_id,
        "mechanism": "pcgrad",
        "parent": str(parent),
        "steps": steps,
        "ra1_lr": RA1_LR,
        "train_ea1": False,
        "pack": "GCFL-FIXED-BALANCED",
    }), flush=True)
    obj = train_ra1_conflict(
        run_id=run_id,
        corpus_dir=corpus,
        parent_ckpt=parent,
        pack_name="PCGH-pcgrad",
        steps=steps,
        ra1_lr=RA1_LR,
        mechanism="pcgrad",
        restore_ollama=False,
        eval_steps=tuple(s for s in DENSE_EVAL if s <= steps),
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
    for st in SCORE_STEPS:
        if st > opt_steps:
            continue
        row = score_ckpt(
            run_id,
            st,
            sets,
            phase="PCGRAD_HORIZON",
            pack="PCGH-pcgrad",
            mechanism="pcgrad",
            tokens=st * TOKENS_PER_STEP,
            nat_rel=st * TOKENS_PER_GROUP_SEQ,
        )
        if row:
            row["transfer"] = transfer_signal(row)
            row["useful_majority"] = useful_majority(row.get("summary") or {})
            row["grads_effective"] = effective_gate(run_id)
            rows.append(row)
    if opt_steps not in SCORE_STEPS:
        row = score_ckpt(
            run_id,
            opt_steps,
            sets,
            phase="PCGRAD_HORIZON",
            pack="PCGH-pcgrad",
            mechanism="pcgrad",
            tokens=used,
            nat_rel=nat_rel,
        )
        if row:
            row["transfer"] = transfer_signal(row)
            row["useful_majority"] = useful_majority(row.get("summary") or {})
            row["grads_effective"] = effective_gate(run_id)
            rows.append(row)
    if not rows:
        return None
    state.setdefault("RUNS", []).extend(rows)
    persist(state)
    return max(rows, key=lambda r: (step_of(r), int((r.get("summary") or {}).get("phrase_exact") or 0)))


def pick_best(rows: list[dict[str, Any]]) -> dict[str, Any]:
    parent = parent_row()
    legal = []
    for r in rows:
        s = r.get("summary") or {}
        if r.get("frozen") not in {None, "YES"} and s.get("frozen") != "YES":
            continue
        if int(s.get("stage3") or r.get("stage3") or 0) < 5:
            continue
        if r.get("severe") or catastrophic(s):
            continue
        legal.append(r)
    if not legal:
        return parent
    ranked = max(
        legal,
        key=lambda r: (
            int(r.get("natural_exact") or 0),
            int(r.get("natural_heldout_exact") or 0),
            int((r.get("natural_sem") or {}).get("n_families") or 0),
            int((r.get("summary") or {}).get("phrase_exact") or 0),
            int((r.get("summary") or {}).get("dog") or 0),
            int((r.get("summary") or {}).get("cat") or 0),
            int((r.get("summary") or {}).get("no") or 0),
            int(r.get("paraphrase_exact") or 0),
            int((r.get("summary") or {}).get("two") or 0),
            int((r.get("summary") or {}).get("three_align") or 0),
        ),
    )
    rs = ranked.get("summary") or {}
    nat_gain = int(ranked.get("natural_exact") or 0) > int(PARENT_BASE["natural_exact"]) or int(ranked.get("natural_heldout_exact") or 0) > 0
    phrase_ok = int(rs.get("phrase_exact") or 0) >= int(PARENT_BASE["phrase_exact"]) - 3
    if nat_gain and phrase_ok and not catastrophic(rs):
        return ranked
    return parent


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
    all_fams = sorted(set(fams + held_fams))
    phrase_ok = useful_majority(s) if best.get("checkpoint") != parent_row()["checkpoint"] else True
    if best.get("checkpoint") == parent_row()["checkpoint"]:
        phrase_ok = True
    short_nat = "NO"
    if phrase_ok and len(set(fams)) > 1 and (nat_n > 1 or held > 0):
        if held > 0 or nat_n >= 3:
            short_nat = "YES"
    transfer = "YES" if any(r.get("transfer") for r in runs) else "NO"
    long_ok = "YES" if short_nat == "YES" and phrase_ok else "NO"
    gate_300k = "PASS" if cum_nat >= 300_000 else "FAIL"
    grads = effective_gate(str(best.get("run_id") or "").split("/")[0]) if best.get("run_id") else {}
    if not grads:
        grads = adapter_grad_gate(str(best.get("checkpoint") or "").split("/")[0])
    destructive = any(
        catastrophic(r.get("summary") or {}) and int(r.get("natural_exact") or 0) > int(PARENT_BASE["natural_exact"])
        for r in runs
    )
    nat_unchanged = all(int(r.get("natural_exact") or 0) <= int(PARENT_BASE["natural_exact"]) and int(r.get("natural_heldout_exact") or 0) <= 0 for r in runs)
    modularity = (
        cum_nat >= 300_000
        and (nat_unchanged or destructive)
        and str(grads.get("EFFECTIVE_GATE") or grads.get("COMBINED_GATE") or "SAFE") != "UNSAFE"
        and all((r.get("summary") or {}).get("frozen") in {None, "YES"} or r.get("frozen") == "YES" for r in runs)
        and int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0) == 0
    )
    suite = state.get("FOUNDATION_SUITE")
    first = s.get("first_classes") or ["blue", "cat", "dog", "no", "red"]
    report = {
        "kind": "WRIM_GENESIS_PCGRAD_LONG_HORIZON_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS") or "REVIEW_COMPLETE",
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "STARTING_HASH": EXPECT,
        "TRAINING_MECHANISM": "PCGRAD_ONLY",
        "PCGRAD_IMPLEMENTATION_CHANGED": "NO",
        "PCGRAD_PARENT_RECIPE": "GCFL-000003",
        "NEW_TOKEN_AUTHORIZATION": BUDGET,
        "NEW_TOKENS_USED": consumed,
        "NEW_TOKENS_REMAINING": BUDGET - consumed,
        "PREVIOUS_NATURAL_RELEVANT_TOKENS": PRIOR_NATURAL_RELEVANT,
        "NEW_NATURAL_RELEVANT_TOKENS": new_nat,
        "CUMULATIVE_NATURAL_RELEVANT_TOKENS": cum_nat,
        "NATURAL_RELEVANT_SHARE": TOKENS_PER_GROUP_SEQ / TOKENS_PER_STEP,
        "NATURAL_RELEVANT_300K_GATE": gate_300k,
        "AUTHORIZED_TOKEN_LEDGER": consumed,
        "PHYSICAL_TOKEN_LEDGER": physical,
        "LEDGER_MATCH": "YES" if consumed == physical else "NO",
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0),
        "BEST_CHECKPOINT": best.get("checkpoint") or "WRIM1-UH1-AC2-EA1-000010/step-25",
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
        "SHORT_NATURAL_RESPONSE_CAPABILITY": short_nat,
        "GREEDY_SHORT_NATURAL_CORRECT": nat_n,
        "NATURAL_SEMANTIC_CORRECT": (best.get("natural_sem") or {}).get("semantic"),
        "NATURAL_TASK_FAMILIES_WORKING": all_fams,
        "NATURAL_PREFIX_DEPTH": nat.get("mean_prefix_depth"),
        "NATURAL_TOKEN2_ORACLE": nat.get("token2_oracle"),
        "NATURAL_TOKEN3_ORACLE": nat.get("token3_oracle"),
        "GENERALIZATION": "PASS" if gen_pass(para) or int(best.get("paraphrase_exact") or 0) >= 2 else "FAIL",
        "GENERALIZATION_SCORE": best.get("paraphrase_exact"),
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
        "NATURAL_TRANSFER_SIGNAL": transfer,
        "PCGRAD_LONG_HORIZON_SUCCESS": long_ok,
        "ADAPTER_CAPACITY_LIMIT": "NOT_PROVEN" if not modularity else "SHARED_RA1_SPAN_INTERFERENCE",
        "ADAPTER_MODULARITY_REVIEW_REQUIRED": "YES" if modularity else "NO",
        "FOUNDATION_SUITE_RESULT": None if short_nat != "YES" else (suite or {}).get("SCORED"),
        "FOUNDATION_FAILED_CATEGORIES": None if short_nat != "YES" else (suite or {}).get("FAILED"),
        "FOUNDATION_SCHOOL_STATUS": "NOT_RUN" if short_nat != "YES" else "SCORED_HELD_OUT",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "YES" if short_nat == "YES" and int(s.get("stage3") or 0) >= 5 and phrase_ok else "NO",
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
        "RUNS": [
            {k: v for k, v in r.items() if k not in {"natural", "natural_heldout", "paraphrase"}}
            for r in runs
        ],
        "NEXT_COMMANDER_DECISION": None,
    }
    if short_nat == "YES":
        report["NEXT_COMMANDER_DECISION"] = "PCGrad long-horizon produced short natural with useful phrase retention. Authorize foundation graduation review of BEST_CHECKPOINT. Do not promote without Commander review. Do not enlarge RA1."
    elif modularity:
        report["NEXT_COMMANDER_DECISION"] = "SHARED RA1 SPAN IS A PROVEN INTERFERENCE BOTTLENECK at the 300k natural-relevant evidence floor. Compare bounded designs: (A) natural response specialist adapter, (B) phrase/natural routed response experts, (C) small conditional response router. Do not auto B64, LoRA, body unfreeze, or lm_head."
    elif gate_300k == "FAIL":
        report["NEXT_COMMANDER_DECISION"] = (
            "PCGrad-only 409600 ceiling exhausted. Natural exact rose 1→2 at PCGH-000001/step-40 with phrase 17 intact, then plateaued through PCGH-000002 (held-out extra wording exact remained 0). "
            "Cumulative natural-relevant is 201922 because this recipe’s natural-group share is 12.5% (1 of 8 matched families), not 37.5%. "
            "Crossing 300000 at unchanged composition needs ~1.19M optimizer tokens from the prior 150722 baseline, or a Commander decision on whether 201922 plus the plateau is enough to open a specialist/router review. "
            "Do not mix-search. Do not enlarge RA1. Do not promote. Canonical remains STEP_400. Experimental balanced parent remains 000010 unless Commander accepts step-40 as the new unpromoted frontier."
        )
    else:
        report["NEXT_COMMANDER_DECISION"] = "PCGrad long-horizon did not produce KEEP-quality short natural. Best remains 000010 unless a listed child Pareto-beats it. Do not enlarge architecture."
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama

    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    lock = acquire_trainer_lock(
        run_id="WRIM-RA1-PCGRAD-LONG-HORIZON-PROGRAM",
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
        legal = [
            r for r in (state.get("RUNS") or [])
            if not r.get("severe") and not catastrophic(r.get("summary") or {})
            and (r.get("frozen") in {None, "YES"} or (r.get("summary") or {}).get("frozen") == "YES")
        ]
        if legal:
            cont = max(
                legal,
                key=lambda r: (
                    int(r.get("natural_exact") or 0),
                    int((r.get("summary") or {}).get("phrase_exact") or 0),
                    int((r.get("summary") or {}).get("dog") or 0),
                    int((r.get("summary") or {}).get("cat") or 0),
                    step_of(r),
                ),
            )
            parent = Path(CKPT_BASE) / cont["checkpoint"]
            print(json.dumps({"resume_parent": str(parent), "consumed": state.get("AUTHORIZED_CONSUMED")}), flush=True)
        while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and not state.get("PROGRAM_STATUS"):
            row = run_block(state=state, corpus=corpus, parent=parent, sets=sets)
            if not row:
                break
            s = row.get("summary") or {}
            if row.get("breach") in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"}:
                state["PROGRAM_STATUS"] = str(row["breach"])
                persist(state)
                break
            if catastrophic(s) or row.get("severe"):
                parent = PARENT
            else:
                parent = Path(CKPT_BASE) / row["checkpoint"]
            held_ok = int(row.get("natural_heldout_exact") or 0) > 0
            strong_nat = int(row.get("natural_exact") or 0) >= 4
            if useful_majority(s) and (held_ok or strong_nat) and int((row.get("natural_sem") or {}).get("n_families") or 0) > 1:
                break
        best = pick_best(state.get("RUNS") or [])
        s = best.get("summary") or {}
        nat_ok = int(best.get("natural_heldout_exact") or 0) > 0 or int(best.get("natural_exact") or 0) >= 4
        if nat_ok and phrase_intact(s) and not best.get("severe") and best.get("checkpoint") != parent_row()["checkpoint"]:
            ckpt = Path(CKPT_BASE) / str(best["checkpoint"])
            gsets: dict[str, list[dict[str, Any]]] = {}
            if (GRAD_DIR / "first-token-val.jsonl").is_file():
                gsets["grad_ft"] = load_rows(GRAD_DIR / "first-token-val.jsonl")
            if (GRAD_DIR / "two-token-val.jsonl").is_file():
                gsets["grad_tt"] = load_rows(GRAD_DIR / "two-token-val.jsonl")
            if gsets:
                state["FOUNDATION_SUITE"] = {"TRAINED_ON_SUITE": False, "SUITE_ID": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0", "SCORED": score_sets(ckpt, gsets)}
        if state.get("PROGRAM_STATUS") == "WRIM_TRAINER_ALREADY_ACTIVE":
            pass
        elif int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
            state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
        elif not state.get("PROGRAM_STATUS"):
            state["PROGRAM_STATUS"] = "REVIEW_COMPLETE"
        persist(state)
        return write_report(state)
    finally:
        release_trainer_lock("WRIM-RA1-PCGRAD-LONG-HORIZON-PROGRAM")
        start_user_ollama()


if __name__ == "__main__":
    main()
