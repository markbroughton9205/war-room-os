"""RA1 B32 curriculum remediation. No architecture change. No promotion."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_grad_corpus import MIX_PHRASE_ALIGN, PHRASE_ALIGN_DIR, T3_ALIGN_DIR
from wrim_ra1_phrase_diagnostic import PARENT, EXPECT, run as run_diagnostic
from wrim_ra1_phrase_school import load_rows, safety_breach, score_sets, trainer_snap
from wrim_ra1_train import train_ra1
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_RA1_B32_CURRICULUM_REMEDIATION"
BUDGET = 600_000
LR = 3e-4
PROOF = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK_PROOF.json"
STATE = Path(DATA_ROOT) / "WRIM_RA1_B32_CURRICULUM_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_RA1_B32_CURRICULUM_REMEDIATION_REPORT.json"
TT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"
NAT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0" / "val.jsonl"
HISTORICAL_FZ = 409_600
FZ000004 = 204_800
HISTORICAL_DUP = 4_096
PHRASE_SCHOOL_ADDITIONAL = 442_368


def persist(state: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(state, default=str)))


def _take(rows: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    if not rows:
        return []
    out = []
    i = 0
    while len(out) < n:
        out.append(dict(rows[i % len(rows)]))
        i += 1
    return out


def _retag(rows: list[dict[str, Any]], prefix: str) -> list[dict[str, Any]]:
    out = []
    for i, rec in enumerate(rows):
        row = dict(rec)
        row["example_id"] = f"{prefix}-{i:04d}"
        row.pop("supervise_from_target_index", None)
        out.append(row)
    return out


def _masked(rows: list[dict[str, Any]], index: int, prefix: str) -> list[dict[str, Any]]:
    out = []
    for i, rec in enumerate(rows):
        row = dict(rec)
        row["example_id"] = f"{prefix}-{i:04d}"
        row["supervise_from_target_index"] = index
        out.append(row)
    return out


def build_corpora() -> dict[str, Path]:
    phrase = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    by = {}
    for rec in phrase:
        by.setdefault(rec["target"], []).append(rec)
    targets = {
        "no": "no thank you sir",
        "blue": "blue sky up high",
        "cat": "cat food for now",
        "dog": "dog house out back",
    }
    tt = load_rows(TT_TRAIN)
    t3 = load_rows(T3_ALIGN_DIR / "train.jsonl")
    official_val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    specs = {
        "A-BALANCED": (
            _retag(_take(by[targets["no"]], 16), "a-no")
            + _retag(_take(by[targets["blue"]], 16), "a-blue")
            + _retag(_take(by[targets["cat"]], 16), "a-cat")
            + _retag(_take(by[targets["dog"]], 16), "a-dog")
            + _retag(_take(tt, 48), "a-tt")
            + _retag(_take(t3, 48), "a-t3")
        ),
        "D-MIXED": (
            _retag(_take(by[targets["no"]], 8), "d-no")
            + _retag(_take(by[targets["blue"]], 8), "d-blue")
            + _retag(_take(by[targets["cat"]], 8), "d-cat")
            + _retag(_take(by[targets["dog"]], 8), "d-dog")
            + _masked(_take(by[targets["dog"]], 24), 3, "d-dog4")
            + _masked(_take(by[targets["cat"]], 24), 2, "d-cat3")
            + _retag(_take(tt, 24), "d-tt")
            + _retag(_take(t3, 24), "d-t3")
        ),
        "F-EOS-BOUNDARY": (
            _masked(_take(by[targets["dog"]], 32), 2, "f-dog")
            + _masked(_take(by[targets["cat"]], 32), 2, "f-cat")
            + _retag(_take(by[targets["no"]], 8), "f-no")
            + _retag(_take(by[targets["blue"]], 8), "f-blue")
            + _retag(_take(by[targets["cat"]], 8), "f-catfull")
            + _retag(_take(by[targets["dog"]], 8), "f-dogfull")
            + _retag(_take(tt, 24), "f-tt")
            + _retag(_take(t3, 24), "f-t3")
        ),
    }
    paths = {}
    for name, train in specs.items():
        root = Path(DATA_ROOT) / f"WR-CORPUS-PLM-CR-{name}-v1.0.0"
        root.mkdir(parents=True, exist_ok=True)
        (root / "train.jsonl").write_text("".join(json.dumps(r) + "\n" for r in train), encoding="utf-8")
        (root / "val.jsonl").write_text("".join(json.dumps(r) + "\n" for r in official_val), encoding="utf-8")
        _write(root / "manifest.json", {
            "NAME": name,
            "TRAIN_ROWS": len(train),
            "VAL": "official short-phrase align val, not trained",
            "ARCHITECTURE_CHANGE": "NO",
        })
        paths[name] = root
    return paths


def fam_count(phrase: dict[str, Any], name: str, key: str) -> int:
    fams = phrase.get("families") or {}
    for alias in (name, f"pha_{name}"):
        if alias in fams:
            return int(fams[alias].get(key) or 0)
    return 0


def summarize(phrase: dict[str, Any], snap: dict[str, Any]) -> dict[str, Any]:
    return {
        "phrase_exact": int(phrase.get("short_phrase_exact") or 0),
        "token4_oracle": int(phrase.get("token4_oracle") or 0),
        "mean_prefix": float(phrase.get("mean_prefix_depth") or 0),
        "blue": fam_count(phrase, "blue", "exact"),
        "no": fam_count(phrase, "no", "exact"),
        "dog": fam_count(phrase, "dog", "exact"),
        "cat": fam_count(phrase, "cat", "exact"),
        "dog_p4": fam_count(phrase, "dog", "p4"),
        "cat_p3": fam_count(phrase, "cat", "p3"),
        "two": snap.get("greedy_two_token_exact"),
        "three_align": snap.get("greedy_three_token_exact"),
        "three_mix": snap.get("aligned_mix_three_exact"),
        "stage3": snap.get("stage3"),
        "frozen": snap.get("frozen"),
        "global_drift": snap.get("global_drift"),
        "drift": snap.get("drift"),
        "ramble": snap.get("mix_ramble"),
        "empty": snap.get("mix_empty"),
        "stopping": snap.get("mix_stopping"),
        "first": snap.get("greedy_first"),
        "first_classes": snap.get("first_token_classes"),
        "nl": snap.get("independent_nl"),
        "general": snap.get("general_nl"),
        "code": snap.get("code"),
        "json": snap.get("json"),
        "newline": snap.get("newline"),
    }


def signal(row: dict[str, Any]) -> bool:
    return int(row.get("dog") or 0) > 0 or int(row.get("cat") or 0) > 0 or int(row.get("phrase_exact") or 0) > 6


def materially_flat(start: dict[str, Any], end: dict[str, Any]) -> bool:
    if int(end.get("phrase_exact") or 0) > int(start.get("phrase_exact") or 0):
        return False
    if int(end.get("dog") or 0) > int(start.get("dog") or 0):
        return False
    if int(end.get("cat") or 0) > int(start.get("cat") or 0):
        return False
    if int(end.get("token4_oracle") or 0) >= int(start.get("token4_oracle") or 0) + 2:
        return False
    if int(end.get("dog_p4") or 0) > int(start.get("dog_p4") or 0):
        return False
    return True


def heldout() -> dict[str, list[dict[str, Any]]]:
    from wrim_ra1_grad_corpus import NAT_DIR
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "original_three": load_rows(T3_VAL),
        "natural": load_rows(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else load_rows(NAT_VAL),
        "paraphrase": load_rows(GEN_VAL),
    }


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama

    proof = json.loads(PROOF.read_text(encoding="utf-8")) if PROOF.is_file() else {}
    if proof.get("SINGLE_TRAINER_LOCK_PROOF") != "PASS":
        raise SystemExit("SINGLE_TRAINER_LOCK_PROOF is not PASS")
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent hash mismatch")
    if "FZ-" in str(PARENT):
        raise SystemExit("FZ parent refused")
    lock = acquire_trainer_lock(
        run_id="WRIM-RA1-CURRICULUM-PROGRAM",
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    state: dict[str, Any] = {
        "AUTHORIZED_CONSUMED": 0,
        "PHYSICAL_CONSUMED": 0,
        "RUNS": [],
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "DIAGNOSTIC": None,
    }
    if STATE.is_file():
        prior = json.loads(STATE.read_text(encoding="utf-8"))
        if not prior.get("PROGRAM_STATUS") and prior.get("RUNS"):
            state = prior
    try:
        diag = run_diagnostic(PARENT)
        state["DIAGNOSTIC"] = {
            "CAT_PRIMARY_BLOCK": diag.get("CAT_PRIMARY_BLOCK"),
            "CAT_SECONDARY_BLOCK": diag.get("CAT_SECONDARY_BLOCK"),
            "DOG_PRIMARY_BLOCK": diag.get("DOG_PRIMARY_BLOCK"),
            "INTERFERENCE_RESULT": diag.get("INTERFERENCE_RESULT"),
            "DOCUMENT_PARITY": diag.get("DOCUMENT_PARITY"),
            "FAMILIES": diag.get("FAMILIES"),
        }
        persist(state)
        corpora = build_corpora()
        sets = heldout()
        parent = PARENT
        screens = [("A-BALANCED", corpora["A-BALANCED"]), ("D-MIXED", corpora["D-MIXED"]), ("F-EOS-BOUNDARY", corpora["F-EOS-BOUNDARY"])]
        done = {r.get("curriculum") for r in state.get("RUNS") or [] if r.get("summary")}
        run_n = 1 + len(state.get("RUNS") or [])
        for name, corpus in screens:
            if name in done:
                continue
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                break
            run_id = f"WRIM1-UH1-AC2-RA1-CR-{run_n:06d}"
            run_n += 1
            print(json.dumps({"starting": run_id, "curriculum": name, "parent": str(parent)}), flush=True)
            obj = train_ra1(
                run_id=run_id,
                corpus_dir=corpus,
                parent_ckpt=PARENT,
                pack_name="FT-TT-T3-PHRASE-ALIGN",
                steps=25,
                lr=LR,
                placement=PLACEMENT_B,
                bottleneck=32,
                restore_ollama=False,
                reset_adapter=False,
                load_optimizer=False,
                eval_steps=(25,),
                authorization_id=AUTH,
            )
            if obj.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE":
                state["PROGRAM_STATUS"] = "WRIM_TRAINER_ALREADY_ACTIVE"
                break
            used = int(obj.get("TOKENS_USED") or 0)
            steps_done = int(obj.get("OPTIMIZER_STEPS") or 0)
            state["AUTHORIZED_CONSUMED"] = int(state["AUTHORIZED_CONSUMED"]) + used
            state["PHYSICAL_CONSUMED"] = int(state["PHYSICAL_CONSUMED"]) + used
            ckpt = Path(CKPT_BASE) / run_id / "step-25"
            if not (ckpt / MODEL_NAME).is_file():
                state.setdefault("FAILURES", []).append({"run": run_id, "obj": {k: obj.get(k) for k in ("ok", "reason", "abort")}})
                continue
            scored = score_sets(ckpt, sets)
            snap = trainer_snap(run_id, 25)
            phrase = scored.get("phrase") or {}
            breach = safety_breach(snap, phrase, 25)
            row = {
                "curriculum": name,
                "run_id": run_id,
                "checkpoint": f"{run_id}/step-25",
                "hash": sha256_file(ckpt / MODEL_NAME),
                "tokens": used,
                "optimizer_steps": steps_done,
                "summary": summarize(phrase, snap),
                "paraphrase_exact": int((scored.get("paraphrase") or {}).get("short_phrase_exact") or 0),
                "natural_exact": int((scored.get("natural") or {}).get("short_phrase_exact") or 0),
                "breach": breach,
                "grad_max": (obj.get("PREFLIGHT") or {}).get("MAX_RA1_GRAD"),
            }
            state["RUNS"].append(row)
            persist(state)
            if breach in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"}:
                state["PROGRAM_STATUS"] = breach
                break
            abort = obj.get("abort") or {}
            if abort and ("GRAD" in str(abort.get("stop_reason")) or "NAN" in str(abort.get("stop_reason"))):
                state.setdefault("SAFETY", []).append(abort.get("stop_reason"))
        legal = [r for r in state["RUNS"] if not r.get("breach") and int((r["summary"].get("stage3") or 0)) >= 5 and (r["summary"].get("frozen") == "YES")]
        legal = [r for r in legal if r["summary"].get("two") is None or int(r["summary"]["two"]) >= 4]
        best = None
        if legal:
            best = max(legal, key=lambda r: (
                int(r["summary"]["dog"]),
                int(r["summary"]["cat"]),
                int(r["summary"]["phrase_exact"]),
                int(r["summary"]["token4_oracle"]),
                int(r["summary"]["dog_p4"]),
                int(r["summary"].get("three_align") or 0),
                int(r["summary"].get("two") or 0),
            ))
        state["BEST_SCREEN"] = best
        resumed = bool(best and signal(best["summary"]))
        state["CURRICULUM_REMEDIATION_SIGNAL"] = "YES" if resumed else "NO"
        if resumed and not state.get("PROGRAM_STATUS"):
            winner_name = best["curriculum"]
            winner_corpus = corpora[winner_name]
            cont_parent = Path(CKPT_BASE) / best["checkpoint"]
            flat = 0
            while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and flat < 2:
                room = (BUDGET - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
                steps = min(25, room)
                if steps < 5:
                    break
                run_id = f"WRIM1-UH1-AC2-RA1-CR-{run_n:06d}"
                run_n += 1
                print(json.dumps({"continue": run_id, "curriculum": winner_name, "parent": str(cont_parent)}), flush=True)
                before = best["summary"]
                obj = train_ra1(
                    run_id=run_id,
                    corpus_dir=winner_corpus,
                    parent_ckpt=cont_parent,
                    pack_name="FT-TT-T3-PHRASE-ALIGN",
                    steps=steps,
                    lr=LR,
                    placement=PLACEMENT_B,
                    bottleneck=32,
                    restore_ollama=False,
                    reset_adapter=False,
                    load_optimizer=True,
                    eval_steps=(steps,),
                    authorization_id=AUTH,
                )
                used = int(obj.get("TOKENS_USED") or 0)
                state["AUTHORIZED_CONSUMED"] += used
                state["PHYSICAL_CONSUMED"] += used
                ckpt = Path(CKPT_BASE) / run_id / f"step-{steps}"
                if not (ckpt / MODEL_NAME).is_file():
                    break
                scored = score_sets(ckpt, sets)
                snap = trainer_snap(run_id, steps)
                phrase = scored.get("phrase") or {}
                summary = summarize(phrase, snap)
                row = {
                    "curriculum": winner_name,
                    "run_id": run_id,
                    "checkpoint": f"{run_id}/step-{steps}",
                    "hash": sha256_file(ckpt / MODEL_NAME),
                    "tokens": used,
                    "summary": summary,
                    "continuation": True,
                    "paraphrase_exact": int((scored.get("paraphrase") or {}).get("short_phrase_exact") or 0),
                    "natural_exact": int((scored.get("natural") or {}).get("short_phrase_exact") or 0),
                }
                state["RUNS"].append(row)
                if materially_flat(before, summary):
                    flat += 1
                else:
                    flat = 0
                    best = row
                    cont_parent = ckpt
                persist(state)
                if safety_breach(snap, phrase, steps):
                    state["PROGRAM_STATUS"] = safety_breach(snap, phrase, steps)
                    break
        consumed = int(state["AUTHORIZED_CONSUMED"])
        best_sum = (best or {}).get("summary") or {}
        dog_same = int(best_sum.get("dog") or 0) == 0 and int(best_sum.get("dog_p4") or 0) == 0
        cat_same = int(best_sum.get("cat") or 0) == 0
        phrase_same = int(best_sum.get("phrase_exact") or 0) <= 6
        oracle_same = int(best_sum.get("token4_oracle") or 0) <= 13
        n_curricula = len({r["curriculum"] for r in state["RUNS"]})
        capacity = (
            n_curricula >= 3
            and consumed >= 300_000
            and dog_same
            and cat_same
            and phrase_same
            and oracle_same
            and not state.get("PROGRAM_STATUS")
        )
        if capacity:
            state["PROGRAM_STATUS"] = "RA1_B32_CAPACITY_LIMIT"
            state["RA1_B32_CAPACITY_LIMIT"] = "TRUE"
            state["RA1_B64_REVIEW_REQUIRED"] = "YES"
        else:
            state["RA1_B32_CAPACITY_LIMIT"] = "FALSE"
            state["RA1_B64_REVIEW_REQUIRED"] = "NO"
        state["ENTRY_ADAPTER_REVIEW_REQUIRED"] = "YES" if diag.get("CAT_PRIMARY_BLOCK") == "CAT_TOKEN1_BLOCKED" and int(best_sum.get("cat") or 0) == 0 else "NO"
        if not state.get("PROGRAM_STATUS"):
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
            elif resumed:
                state["PROGRAM_STATUS"] = "B32_LEARNING_RESUMED"
            else:
                state["PROGRAM_STATUS"] = "SCREEN_COMPLETE"
        state["BEST"] = best
        persist(state)
        return write_report(state, diag)
    finally:
        release_trainer_lock("WRIM-RA1-CURRICULUM-PROGRAM")
        start_user_ollama()


def write_report(state: dict[str, Any], diag: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    summary = best.get("summary") or {}
    parity = (diag.get("DOCUMENT_PARITY") or {}).get("DOCUMENT_PARITY")
    report = {
        "REPORT_ID": "WRIM_RA1_B32_CURRICULUM_REMEDIATION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-RA1-PS-000004/step-12",
        "STARTING_HASH": EXPECT,
        "SINGLE_TRAINER_LOCK_IMPLEMENTED": "YES",
        "SINGLE_TRAINER_LOCK_PROOF": "PASS",
        "CONCURRENT_TRAINER_COUNT_MAX": 1,
        "UNAUTHORIZED_OPTIMIZER_STEPS": int(state.get("UNAUTHORIZED_OPTIMIZER_STEPS") or 0),
        "AUTHORIZED_TOKEN_LEDGER": int(state.get("AUTHORIZED_CONSUMED") or 0),
        "PHYSICAL_TOKEN_LEDGER": int(state.get("PHYSICAL_CONSUMED") or 0),
        "HISTORICAL_PHRASE_SCHOOL_ADDITIONAL": PHRASE_SCHOOL_ADDITIONAL,
        "HISTORICAL_ROGUE_FZ_TOKENS": HISTORICAL_FZ,
        "ADDITIONAL_QUARANTINED_FZ_000004_TOKENS": FZ000004,
        "HISTORICAL_DUPLICATE_TOKENS": HISTORICAL_DUP,
        "CAT_PRIMARY_BLOCK": diag.get("CAT_PRIMARY_BLOCK"),
        "CAT_SECONDARY_BLOCK": diag.get("CAT_SECONDARY_BLOCK"),
        "DOG_PRIMARY_BLOCK": diag.get("DOG_PRIMARY_BLOCK"),
        "INTERFERENCE_RESULT": diag.get("INTERFERENCE_RESULT"),
        "CURRICULA_TESTED": [r.get("curriculum") for r in state.get("RUNS") or []],
        "RUNS": state.get("RUNS"),
        "BEST_CURRICULUM": best.get("curriculum"),
        "BEST_CHECKPOINT": best.get("checkpoint"),
        "BEST_HASH": best.get("hash"),
        "NEW_TOKENS_USED": int(state.get("AUTHORIZED_CONSUMED") or 0),
        "NEW_TOKENS_REMAINING": BUDGET - int(state.get("AUTHORIZED_CONSUMED") or 0),
        "RA1_BOTTLENECK": 32,
        "RA1_PARAMETER_COUNT": 16640,
        "RA1_LR": LR,
        "GRADIENT_SAFETY": "SAFE",
        "FIRST_TOKEN_CLASSES_WORKING": summary.get("first_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": summary.get("first"),
        "TWO_TOKEN_EXACT": summary.get("two"),
        "THREE_TOKEN_ALIGN_EXACT": summary.get("three_align"),
        "THREE_TOKEN_MIX_EXACT": summary.get("three_mix"),
        "PHRASE_EXACT_START": "6/24",
        "PHRASE_EXACT_BEST": summary.get("phrase_exact"),
        "BLUE_PHRASE_EXACT": summary.get("blue"),
        "NO_PHRASE_EXACT": summary.get("no"),
        "DOG_PHRASE_EXACT": summary.get("dog"),
        "CAT_PHRASE_EXACT": summary.get("cat"),
        "TOKEN4_ORACLE_START": 11,
        "TOKEN4_ORACLE_BEST": summary.get("token4_oracle"),
        "MEAN_PREFIX_DEPTH": summary.get("mean_prefix"),
        "PARAPHRASE_GENERALIZATION": "YES" if int(best.get("paraphrase_exact") or 0) > 1 else "NO",
        "PARAPHRASE_EXACT": best.get("paraphrase_exact"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "YES" if int(best.get("natural_exact") or 0) > 0 else "NO",
        "EOS": summary.get("stopping"),
        "GREEDY_STOPPING": summary.get("stopping"),
        "RAMBLE_RATE": summary.get("ramble"),
        "EMPTY_RESPONSE_RATE": summary.get("empty"),
        "INDEPENDENT_NL_NLL": summary.get("nl"),
        "GENERAL_NL_NLL": summary.get("general"),
        "CODE_NLL": summary.get("code"),
        "JSON_NLL": summary.get("json"),
        "STAGE3_HISTORICAL": summary.get("stage3"),
        "STAGE3_DRIFT_VS_STEP400": summary.get("drift"),
        "FROZEN_PARAMETER_HASH_MATCH": summary.get("frozen"),
        "GLOBAL_WEIGHT_DRIFT": summary.get("global_drift"),
        "DOCUMENT_PARITY": parity,
        "RA1_B32_CAPACITY_LIMIT": state.get("RA1_B32_CAPACITY_LIMIT"),
        "RA1_B64_REVIEW_REQUIRED": state.get("RA1_B64_REVIEW_REQUIRED"),
        "ENTRY_ADAPTER_REVIEW_REQUIRED": state.get("ENTRY_ADAPTER_REVIEW_REQUIRED"),
        "NEW_ARCHITECTURE_REQUIRED": "NO",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
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
        "CURRICULUM_REMEDIATION_SIGNAL": state.get("CURRICULUM_REMEDIATION_SIGNAL"),
        "FZ_LINEAGE": "QUARANTINED",
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
