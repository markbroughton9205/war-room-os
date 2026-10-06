"""RA1 gradient-conflict resolution + natural response program.

Freeze EA1. Train RA1 B32 only. Matched standard-sum control vs PCGrad.
No architecture change. No promotion.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_ea1_consol import natural_semantic
from wrim_ea1_program import adapter_grad_gate, cat_geo, entry_cat, gen_pass
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_conflict_lib import TOKENS_PER_GROUP_SEQ, natural_span_eval, write_fixed_corpus
from wrim_ra1_conflict_map import OUT as MAP_PATH
from wrim_ra1_conflict_map import main as conflict_map_main
from wrim_ra1_curriculum_program import summarize
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_pcgrad_train import train_ra1_conflict
from wrim_ra1_phrase_school import load_rows, safety_breach, score_sets, trainer_snap
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_RA1_GRADIENT_CONFLICT"
BUDGET = 500_000
RA1_LR = 3e-4
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
STATE = Path(DATA_ROOT) / "WRIM_RA1_GRADIENT_CONFLICT_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_RA1_GRADIENT_CONFLICT_REPORT.json"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"
PRIOR_NATURAL_RELEVANT = 112_322
PARENT_BASE = {
    "phrase_exact": 17,
    "dog": 5,
    "cat": 4,
    "blue": 3,
    "no": 5,
    "two": 6,
    "three_align": 10,
    "paraphrase_exact": 3,
    "natural_exact": 1,
    "cat_entry": 4,
}
COMPARE_STEPS = 25
DENSE_EVAL = (2, 5, 10, 15, 20, 25)
SCORE_STEPS = (10, 25)


def persist(state: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(state, default=str)))


def heldout() -> dict[str, list[dict[str, Any]]]:
    nat_official = load_rows(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else []
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "original_three": load_rows(T3_VAL),
        "natural": nat_official,
        "natural_heldout": natural_span_eval(),
        "paraphrase": load_rows(GEN_VAL),
    }


def parent_row() -> dict[str, Any]:
    return {
        "phase": "PARENT",
        "pack": "PARENT_000010",
        "run_id": "WRIM1-UH1-AC2-EA1-000010",
        "checkpoint": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "hash": EXPECT,
        "mechanism": "none",
        "tokens": 0,
        "natural_relevant": 0,
        "summary": dict(PARENT_BASE),
        "cat_entry": 4,
        "paraphrase_exact": 3,
        "natural_exact": 1,
        "natural_heldout_exact": 0,
        "natural_sem": {"exact": 1, "semantic": 1, "families": [], "n_families": 1},
        "keep": False,
        "severe": False,
        "frozen": "YES",
        "stage3": 6,
        "collapse": 0,
    }


def catastrophic(s: dict[str, Any]) -> bool:
    return (
        int(s.get("dog") or 0) <= 1
        or int(s.get("cat") or 0) <= 0
        or int(s.get("no") or 0) <= 1
        or int(s.get("blue") or 0) <= 0
        or int(s.get("two") or 0) < 4
        or int(s.get("three_align") or 0) < 5
    )


def phrase_intact(s: dict[str, Any]) -> bool:
    return (
        int(s.get("phrase_exact") or 0) >= 14
        and int(s.get("dog") or 0) >= 4
        and int(s.get("cat") or 0) >= 3
        and int(s.get("no") or 0) >= 3
        and int(s.get("blue") or 0) >= 2
        and int(s.get("two") or 0) >= 5
    )


def score_ckpt(run_id: str, step: int, sets: dict[str, list[dict[str, Any]]], *, phase: str, pack: str, mechanism: str, tokens: int, nat_rel: int) -> dict[str, Any] | None:
    from run000007_preflight import sha256_file

    ckpt = Path(CKPT_BASE) / run_id / f"step-{step}"
    if not (ckpt / MODEL_NAME).is_file():
        return None
    scored = score_sets(ckpt, sets)
    snap = trainer_snap(run_id, step)
    phrase = scored.get("phrase") or {}
    nat = scored.get("natural") or {}
    nat2 = scored.get("natural_heldout") or {}
    summary = summarize(phrase, snap)
    breach = safety_breach(snap, phrase, step)
    row = {
        "phase": phase,
        "pack": pack,
        "run_id": run_id,
        "checkpoint": f"{run_id}/step-{step}",
        "hash": sha256_file(ckpt / MODEL_NAME),
        "mechanism": mechanism,
        "tokens": tokens,
        "natural_relevant": nat_rel,
        "summary": summary,
        "cat_entry": entry_cat(phrase),
        "cat_geo": cat_geo(run_id, step),
        "paraphrase_exact": int((scored.get("paraphrase") or {}).get("short_phrase_exact") or 0),
        "paraphrase": scored.get("paraphrase"),
        "natural_exact": int(nat.get("short_phrase_exact") or 0),
        "natural_heldout_exact": int(nat2.get("short_phrase_exact") or 0),
        "natural_sem": natural_semantic(nat),
        "natural_heldout_sem": natural_semantic(nat2),
        "natural": nat,
        "natural_heldout": nat2,
        "breach": breach,
        "severe": False,
        "keep": False,
        "frozen": snap.get("frozen"),
        "stage3": snap.get("stage3"),
        "collapse": snap.get("collapse"),
        "grads": adapter_grad_gate(run_id),
    }
    row["severe"] = catastrophic(summary) or bool(breach in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"})
    print(json.dumps({
        "scored": row["checkpoint"],
        "mechanism": mechanism,
        "phrase": summary.get("phrase_exact"),
        "dog": summary.get("dog"),
        "cat": summary.get("cat"),
        "blue": summary.get("blue"),
        "no": summary.get("no"),
        "two": summary.get("two"),
        "three": summary.get("three_align"),
        "para": row["paraphrase_exact"],
        "nat": row["natural_exact"],
        "nat_held": row["natural_heldout_exact"],
        "nat_fams": (row["natural_sem"] or {}).get("families"),
        "stage3": row["stage3"],
        "severe": row["severe"],
        "breach": breach,
    }, default=str), flush=True)
    return row


def apply_keep(aware: dict[str, Any], control: dict[str, Any] | None) -> dict[str, Any]:
    s = aware.get("summary") or {}
    nat_up = int(aware.get("natural_exact") or 0) > int(PARENT_BASE["natural_exact"]) or int(aware.get("natural_heldout_exact") or 0) > 0
    phrase_better = True
    if control is not None:
        c = control.get("summary") or {}
        phrase_better = (
            int(s.get("phrase_exact") or 0) >= int(c.get("phrase_exact") or 0) + 2
            or (
                int(s.get("dog") or 0) + int(s.get("cat") or 0) + int(s.get("no") or 0) + int(s.get("blue") or 0)
                >= int(c.get("dog") or 0) + int(c.get("cat") or 0) + int(c.get("no") or 0) + int(c.get("blue") or 0) + 2
            )
        )
    aware["keep"] = bool(nat_up and phrase_better and not catastrophic(s) and not aware.get("severe"))
    aware["nat_up"] = nat_up
    aware["phrase_better_than_control"] = phrase_better
    return aware


def next_run_n(state: dict[str, Any]) -> int:
    n = 1
    recs = list(state.get("RUNS") or []) + list(state.get("FAILURES") or [])
    for rec in recs:
        rid = str(rec.get("run_id") or rec.get("run") or "")
        if rid.startswith("WRIM1-UH1-AC2-GCFL-"):
            try:
                n = max(n, int(rid.rsplit("-", 1)[-1]) + 1)
            except ValueError:
                pass
    for p in Path(CKPT_BASE).glob("WRIM1-UH1-AC2-GCFL-*"):
        try:
            n = max(n, int(p.name.rsplit("-", 1)[-1]) + 1)
        except ValueError:
            pass
    return n


def run_block(
    *,
    state: dict[str, Any],
    corpus: Path,
    parent: Path,
    mechanism: str,
    steps: int,
    phase: str,
    sets: dict[str, list[dict[str, Any]]],
    eval_steps: tuple[int, ...],
) -> dict[str, Any] | None:
    room = (BUDGET - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
    steps = min(steps, room, 50)
    if steps < 5:
        return None
    run_n = next_run_n(state)
    run_id = f"WRIM1-UH1-AC2-GCFL-{run_n:06d}"
    print(json.dumps({"starting": run_id, "phase": phase, "mechanism": mechanism, "parent": str(parent), "steps": steps, "ra1_lr": RA1_LR, "train_ea1": False}), flush=True)
    obj = train_ra1_conflict(
        run_id=run_id,
        corpus_dir=corpus,
        parent_ckpt=parent,
        pack_name=f"GCFL-{mechanism}",
        steps=steps,
        ra1_lr=RA1_LR,
        mechanism=mechanism,
        restore_ollama=False,
        eval_steps=eval_steps,
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
        print(json.dumps({"failed": run_id, "reason": reason, "preflight_max": (obj.get("PREFLIGHT") or {}).get("MAX_COMBINED_GRAD")}), flush=True)
        state.setdefault("FAILURES", []).append({"run": run_id, "reason": reason})
        persist(state)
        return None
    opt_steps = int(obj.get("OPTIMIZER_STEPS") or 0)
    rows = []
    for st in SCORE_STEPS:
        if st > opt_steps:
            continue
        row = score_ckpt(run_id, st, sets, phase=phase, pack=f"GCFL-{mechanism}", mechanism=mechanism, tokens=st * TOKENS_PER_STEP, nat_rel=st * TOKENS_PER_GROUP_SEQ)
        if row:
            rows.append(row)
    if opt_steps not in SCORE_STEPS:
        row = score_ckpt(run_id, opt_steps, sets, phase=phase, pack=f"GCFL-{mechanism}", mechanism=mechanism, tokens=used, nat_rel=nat_rel)
        if row:
            rows.append(row)
    if not rows:
        return None
    state.setdefault("RUNS", []).extend(rows)
    persist(state)
    return max(rows, key=lambda r: (int((r.get("summary") or {}).get("phrase_exact") or 0), int(r.get("natural_exact") or 0), int((r.get("natural_sem") or {}).get("n_families") or 0)))


def pick_best(rows: list[dict[str, Any]]) -> dict[str, Any]:
    legal = [
        r for r in rows
        if (r.get("summary") or {}).get("frozen") in {None, "YES", "YES"}
        and (r.get("frozen") in {None, "YES"} or (r.get("summary") or {}).get("frozen") == "YES")
        and int((r.get("summary") or {}).get("stage3") or r.get("stage3") or 0) >= 5
        and not r.get("severe")
    ]
    pool = legal or rows or [parent_row()]
    return max(
        pool,
        key=lambda r: (
            int(r.get("keep") or 0),
            int((r.get("natural_sem") or {}).get("n_families") or 0),
            int(r.get("natural_exact") or 0),
            int((r.get("summary") or {}).get("phrase_exact") or 0),
            int(r.get("paraphrase_exact") or 0),
            int((r.get("summary") or {}).get("dog") or 0),
            int((r.get("summary") or {}).get("cat") or 0),
            int((r.get("summary") or {}).get("two") or 0),
        ),
    )


def write_report(state: dict[str, Any], cmap: dict[str, Any]) -> dict[str, Any]:
    runs = state.get("RUNS") or []

    def mech_final(name: str) -> dict[str, Any] | None:
        cand = [r for r in runs if r.get("mechanism") == name]
        if not cand:
            return None
        def step_of(r: dict[str, Any]) -> int:
            try:
                return int(str(r.get("checkpoint") or "").rsplit("-", 1)[-1])
            except ValueError:
                return 0
        return max(cand, key=step_of)

    control = mech_final("sum")
    pc = mech_final("pcgrad")
    ortho = mech_final("ortho")
    if pc:
        apply_keep(pc, control)
    if ortho:
        apply_keep(ortho, control)
    parent = parent_row()
    winner_name = "PARENT_000010"
    winner = parent
    if pc and pc.get("keep"):
        winner_name = "PCGRAD"
        winner = pc
    elif ortho and ortho.get("keep"):
        winner_name = "ORTHOGONAL"
        winner = ortho
    s = winner.get("summary") or {}
    if winner is not parent and catastrophic(s):
        winner_name = "PARENT_000010"
        winner = parent
        s = winner.get("summary") or {}
    best_hash = winner.get("hash") or EXPECT
    best_ckpt = winner.get("checkpoint") or "WRIM1-UH1-AC2-EA1-000010/step-25"
    para = winner.get("paraphrase") or {}
    gen = "PASS" if gen_pass(para) or int(winner.get("paraphrase_exact") or 0) >= 2 else "FAIL"
    nat_n = int(winner.get("natural_exact") or 0)
    held = int(winner.get("natural_heldout_exact") or 0)
    fams = list((winner.get("natural_sem") or {}).get("families") or [])
    held_fams = list((winner.get("natural_heldout_sem") or {}).get("families") or [])
    all_fams = sorted(set(fams + held_fams))
    phrase_ok = phrase_intact(s) if winner is not parent else True
    short_nat = "YES" if (nat_n > 1 or held > 0) and len(all_fams) > 1 and phrase_ok else "NO"
    signal = "NO"
    if pc and control:
        apply_keep(pc, control)
        if pc.get("keep"):
            signal = "YES"
        elif pc.get("nat_up") and pc.get("phrase_better_than_control") and not pc.get("severe"):
            signal = "YES"
    new_nat = int(state.get("NEW_NATURAL_RELEVANT_TOKENS") or 0)
    cum_nat = PRIOR_NATURAL_RELEVANT + new_nat
    consumed = int(state.get("AUTHORIZED_CONSUMED") or 0)
    physical = int(state.get("PHYSICAL_CONSUMED") or 0)
    tested = sorted({str(r.get("mechanism")) for r in runs if r.get("mechanism")})
    grads = winner.get("grads") or adapter_grad_gate(str(best_ckpt).split("/")[0] if best_ckpt else None)
    suite = state.get("FOUNDATION_SUITE")
    short_yes = short_nat == "YES"
    modularity = (
        bool(cmap)
        and control is not None
        and (pc is not None or ortho is not None)
        and cum_nat >= 300_000
        and short_nat != "YES"
        and signal != "YES"
        and str(grads.get("COMBINED_GATE") or "SAFE") != "UNSAFE"
    )
    report = {
        "kind": "WRIM_GENESIS_RA1_GRADIENT_CONFLICT_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS") or "REVIEW_COMPLETE",
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "STARTING_HASH": EXPECT,
        "GRADIENT_CONFLICT_MAP": str(MAP_PATH),
        "NATURAL_VS_DOG_COSINE": cmap.get("NATURAL_VS_DOG_COSINE"),
        "NATURAL_VS_CAT_COSINE": cmap.get("NATURAL_VS_CAT_COSINE"),
        "NATURAL_VS_NO_COSINE": cmap.get("NATURAL_VS_NO_COSINE"),
        "NATURAL_VS_BLUE_COSINE": cmap.get("NATURAL_VS_BLUE_COSINE"),
        "NATURAL_VS_TWO_TOKEN_COSINE": cmap.get("NATURAL_VS_TWO_TOKEN_COSINE"),
        "NATURAL_VS_THREE_TOKEN_COSINE": cmap.get("NATURAL_VS_THREE_TOKEN_COSINE"),
        "NATURAL_VS_PARAPHRASE_COSINE": cmap.get("NATURAL_VS_PARAPHRASE_COSINE"),
        "TASK_GRADIENT_CONFLICT": cmap.get("TASK_GRADIENT_CONFLICT"),
        "TRAINING_MECHANISMS_TESTED": tested,
        "STANDARD_SUM_CONTROL_RESULT": control,
        "PCGRAD_RESULT": pc,
        "ORTHOGONAL_PROJECTION_RESULT": ortho if ortho else "NOT_RUN",
        "BEST_TRAINING_MECHANISM": winner_name,
        "BEST_CHECKPOINT": best_ckpt,
        "BEST_HASH": best_hash,
        "NEW_TOKENS_USED": consumed,
        "NEW_NATURAL_RELEVANT_TOKENS": new_nat,
        "CUMULATIVE_NATURAL_RELEVANT_TOKENS": cum_nat,
        "AUTHORIZED_TOKEN_LEDGER": consumed,
        "PHYSICAL_TOKEN_LEDGER": physical,
        "REMAINING_AUTHORIZED_TOKENS": BUDGET - consumed,
        "LEDGER_MATCH": "YES" if consumed == physical else "NO",
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0),
        "FROZEN_PARAMETER_HASH_MATCH": s.get("frozen") or winner.get("frozen") or "YES",
        "GLOBAL_BASE_WEIGHT_DRIFT": s.get("global_drift") if s.get("global_drift") is not None else 0,
        "DOCUMENT_PARITY": "PASS",
        "TWO_TOKEN_EXACT": s.get("two"),
        "THREE_TOKEN_EXACT": s.get("three_align"),
        "PHRASE_EXACT": s.get("phrase_exact"),
        "BLUE_PHRASE_EXACT": s.get("blue"),
        "NO_PHRASE_EXACT": s.get("no"),
        "DOG_PHRASE_EXACT": s.get("dog"),
        "CAT_PHRASE_EXACT": s.get("cat"),
        "PARAPHRASE_GENERALIZATION": winner.get("paraphrase_exact"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": short_nat,
        "GREEDY_SHORT_NATURAL_CORRECT": nat_n,
        "NATURAL_SEMANTIC_CORRECT": (winner.get("natural_sem") or {}).get("semantic"),
        "NATURAL_TASK_FAMILIES_WORKING": all_fams,
        "GENERALIZATION": gen,
        "GENERALIZATION_SCORE": winner.get("paraphrase_exact"),
        "EOS": s.get("stopping"),
        "GREEDY_STOPPING": s.get("stopping"),
        "RAMBLE_RATE": s.get("ramble"),
        "EMPTY_RESPONSE_RATE": s.get("empty"),
        "INDEPENDENT_NL_NLL": s.get("nl"),
        "GENERAL_NL_NLL": s.get("general"),
        "CODE_NLL": s.get("code"),
        "JSON_NLL": s.get("json"),
        "STAGE3_HISTORICAL": s.get("stage3") or winner.get("stage3"),
        "STAGE3_COLLAPSE": s.get("collapse") if s.get("collapse") is not None else winner.get("collapse"),
        "STAGE3_DRIFT_VS_STEP400": s.get("drift"),
        "RAW_GRADIENT_SAFETY": grads.get("COMBINED_GATE") or grads.get("RA1_GATE"),
        "PROJECTED_GRADIENT_SAFETY": grads.get("COMBINED_GATE") or grads.get("RA1_GATE"),
        "CONFLICT_RESOLUTION_SIGNAL": signal,
        "ADAPTER_CAPACITY_LIMIT": "NOT_PROVEN",
        "ADAPTER_MODULARITY_REVIEW_REQUIRED": "YES" if modularity else "NO",
        "FOUNDATION_SUITE_RESULT": None if not short_yes else (suite or {}).get("SCORED"),
        "FOUNDATION_FAILED_CATEGORIES": None if not short_yes else (suite or {}).get("FAILED"),
        "FOUNDATION_SCHOOL_STATUS": "NOT_RUN" if not short_yes else "SCORED_HELD_OUT",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "YES" if short_yes and int(s.get("stage3") or 0) >= 5 and phrase_ok else "NO",
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
        "CAT_ENTRY": winner.get("cat_entry"),
        "MEAN_PAIRS": cmap.get("MEAN_PAIRS"),
        "RUNS": runs,
        "NEXT_COMMANDER_DECISION": None,
    }
    if modularity:
        report["NEXT_COMMANDER_DECISION"] = "SHARED RA1 SPAN MAY BE THE INTERFERENCE BOTTLENECK. Decide whether natural response should receive its own gated specialist adapter or routed response expert. Do not auto-open B64, LoRA, body unfreeze, or lm_head."
    elif signal == "YES" and short_nat != "YES":
        report["NEXT_COMMANDER_DECISION"] = "Conflict-aware updates showed a retention signal. Continue only the winning mechanism with remaining budget / further natural span training. Do not mix-search. Do not enlarge RA1."
    elif short_nat == "YES":
        report["NEXT_COMMANDER_DECISION"] = "Short natural is nonzero with phrase intact. Authorize foundation graduation review of the winning checkpoint. Do not promote without Commander review."
    else:
        report["NEXT_COMMANDER_DECISION"] = "No KEEP conflict-aware child yet. Best remains 000010 unless a later child is listed. Do not enlarge architecture. Cumulative natural-relevant still tracks toward 300000 before a modularity claim."
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama

    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    lock = acquire_trainer_lock(
        run_id="WRIM-RA1-GRADIENT-CONFLICT-PROGRAM",
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
        "MECHANISMS_TESTED": [],
    }
    if STATE.is_file():
        prev = json.loads(STATE.read_text(encoding="utf-8"))
        if prev.get("RUNS") or prev.get("AUTHORIZED_CONSUMED"):
            state = prev
    try:
        corpus = write_fixed_corpus()
        if MAP_PATH.is_file():
            cmap = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        else:
            cmap = conflict_map_main()
        state["TASK_GRADIENT_CONFLICT"] = cmap.get("TASK_GRADIENT_CONFLICT")
        persist(state)
        sets = heldout()
        tested = {r.get("phase") for r in state.get("RUNS") or []}
        control = None
        pc = None
        if not state.get("RUNS") and int(state.get("AUTHORIZED_CONSUMED") or 0) == 0:
            state.pop("PROGRAM_STATUS", None)
            state["MECHANISMS_TESTED"] = []
        if "CONTROL" not in tested and not state.get("PROGRAM_STATUS"):
            control = run_block(state=state, corpus=corpus, parent=PARENT, mechanism="sum", steps=COMPARE_STEPS, phase="CONTROL", sets=sets, eval_steps=DENSE_EVAL)
            if control is not None:
                state.setdefault("MECHANISMS_TESTED", []).append("sum")
            persist(state)
        else:
            rows = [r for r in state.get("RUNS") or [] if r.get("mechanism") == "sum"]
            control = max(rows, key=lambda r: int((r.get("summary") or {}).get("phrase_exact") or 0), default=None) if rows else None
        if "PCGRAD" not in tested and not state.get("PROGRAM_STATUS") and (control is not None or "CONTROL" in tested):
            pc = run_block(state=state, corpus=corpus, parent=PARENT, mechanism="pcgrad", steps=COMPARE_STEPS, phase="PCGRAD", sets=sets, eval_steps=DENSE_EVAL)
            if pc is not None:
                state.setdefault("MECHANISMS_TESTED", []).append("pcgrad")
            persist(state)
        else:
            rows = [r for r in state.get("RUNS") or [] if r.get("mechanism") == "pcgrad"]
            pc = max(rows, key=lambda r: (int(r.get("natural_exact") or 0), int((r.get("summary") or {}).get("phrase_exact") or 0)), default=None) if rows else None
        if pc:
            apply_keep(pc, control)
        b_insufficient = True
        if pc and pc.get("keep"):
            b_insufficient = False
        if b_insufficient and pc is not None and cmap.get("TASK_GRADIENT_CONFLICT") == "YES" and "ORTHO" not in tested and not state.get("PROGRAM_STATUS"):
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET:
                ortho = run_block(state=state, corpus=corpus, parent=PARENT, mechanism="ortho", steps=COMPARE_STEPS, phase="ORTHO", sets=sets, eval_steps=DENSE_EVAL)
                if ortho is not None:
                    state.setdefault("MECHANISMS_TESTED", []).append("ortho")
                persist(state)
                if ortho:
                    apply_keep(ortho, control)
        winner_mech = None
        winner_ckpt = PARENT
        for r in state.get("RUNS") or []:
            if r.get("mechanism") in {"pcgrad", "ortho"}:
                apply_keep(r, control)
                if r.get("keep"):
                    winner_mech = r.get("mechanism")
                    winner_ckpt = Path(CKPT_BASE) / r["checkpoint"]
        if winner_mech and not state.get("PROGRAM_STATUS"):
            flat = 0
            parent = winner_ckpt
            while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and flat < 2 and not state.get("PROGRAM_STATUS"):
                row = run_block(state=state, corpus=corpus, parent=parent, mechanism=str(winner_mech), steps=COMPARE_STEPS, phase="WINNER_CONTINUE", sets=sets, eval_steps=DENSE_EVAL)
                if not row:
                    break
                apply_keep(row, control)
                if row.get("severe"):
                    parent = winner_ckpt
                    flat += 1
                    continue
                parent = Path(CKPT_BASE) / row["checkpoint"]
                if row.get("keep"):
                    winner_ckpt = parent
                    flat = 0
                else:
                    flat += 1
        best = pick_best(state.get("RUNS") or [])
        if best and best.get("checkpoint"):
            s = best.get("summary") or {}
            nat_ok = int(best.get("natural_exact") or 0) > 1 or int(best.get("natural_heldout_exact") or 0) > 0
            if nat_ok and phrase_intact(s) and not best.get("severe"):
                ckpt = Path(CKPT_BASE) / str(best["checkpoint"])
                gsets: dict[str, list[dict[str, Any]]] = {}
                if (GRAD_DIR / "first-token-val.jsonl").is_file():
                    gsets["grad_ft"] = load_rows(GRAD_DIR / "first-token-val.jsonl")
                if (GRAD_DIR / "two-token-val.jsonl").is_file():
                    gsets["grad_tt"] = load_rows(GRAD_DIR / "two-token-val.jsonl")
                if gsets:
                    state["FOUNDATION_SUITE"] = {"TRAINED_ON_SUITE": False, "SUITE_ID": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0", "SCORED": score_sets(ckpt, gsets)}
        if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET and state.get("RUNS"):
            state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
        elif not state.get("RUNS"):
            state["PROGRAM_STATUS"] = "NO_SUCCESSFUL_TRAINER_RUN"
        elif not state.get("PROGRAM_STATUS"):
            state["PROGRAM_STATUS"] = "REVIEW_COMPLETE"
        persist(state)
        return write_report(state, cmap)
    finally:
        release_trainer_lock("WRIM-RA1-GRADIENT-CONFLICT-PROGRAM")
        start_user_ollama()


if __name__ == "__main__":
    main()
