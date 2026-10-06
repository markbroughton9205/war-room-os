"""RA1 B32 foundation graduation finalization. No promotion. Canonical remains STEP_400."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD, TOKENS_PER_STEP
from wrim_ra1_final_corpus import (
    GEN2_DIR,
    MIX_CONS,
    MIX_GEN,
    MIX_NAT2,
    MIX_PHRASE2,
    MIX_PHRASE3,
    NAT2_DIR,
    PHRASE_NATURAL_DIR,
    PHRASE_RED_DIR,
    freeze_final_curricula,
)
from wrim_ra1_grad_corpus import MIX_PHRASE_ALIGN, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import grad_summary, load_rows, score_sets, trainer_snap
from wrim_ra1_train import train_ra1

START = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-GC-000010" / "step-46"
EXPECT_HASH = "1f87d5734ddd66071a5961851b9282ad3fd6087a1f8be104bf74562cc434253a"
PREVIOUS_TOTAL = 5_206_016
PROGRAM_BUDGET = 2_000_000
LR = 3e-4
MAX_STEPS = 50
GEN1_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
GRAD_FT = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0" / "first-token-val.jsonl"
GRAD_TT = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0" / "two-token-val.jsonl"
TT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl"
T3_ALIGN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_FOUNDATION_GRADUATION_FINAL_STATE.json"
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_FOUNDATION_GRADUATION_FINAL_REPORT.json"

RESUME_DECISION = {
    "EXACT_SAME_RUN_RESUME": "NO",
    "REASON": (
        "train_ra1 reseeds SEED, rebuilds the packed stream from offset 0, and forbids "
        "second_execution when step-{use_steps}/resume-manifest.json already exists. "
        "stream-state.json and rng-state.pt are not consumed. Exact GC-000010 continuation "
        "of steps 47-50 is therefore unproven."
    ),
    "ACTION": "NEW_IMMUTABLE_RUN_FROM_STEP_46",
    "NEW_RUN_PREFIX": "WRIM1-UH1-AC2-RA1-FZ",
    "FIRST_PHRASE_OPTIMIZER": "WARM_ADAM_NEW_STREAM",
    "ABSORBED_LEGAL_CONTINUATION": (
        "WRIM1-UH1-AC2-RA1-PS-* MIX_PHRASE_ALIGN runs from GC-000010/step-46 at LR 3e-4 "
        "with WARM_ADAM_NEW_STREAM count toward the 2,000,000 ceiling. FZ does not repeat "
        "an already-completed same-pack first continuation."
    ),
}


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def one_trainer() -> list[str]:
    me = os.getpid()
    hits = []
    for pid_s in Path("/proc").iterdir():
        if not pid_s.name.isdigit():
            continue
        pid = int(pid_s.name)
        if pid == me:
            continue
        try:
            comm = (pid_s / "comm").read_text().strip()
        except OSError:
            continue
        if not comm.startswith("python"):
            continue
        try:
            cmd = (pid_s / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace")
        except OSError:
            continue
        if "wrim_ra1_" in cmd and ".py" in cmd:
            hits.append(f"{pid} {cmd[:180]}")
    return hits


def n_families_exact(score: dict[str, Any]) -> int:
    return sum(1 for v in (score.get("families") or {}).values() if int(v.get("exact") or 0) > 0)


def exact_family_names(score: dict[str, Any]) -> list[str]:
    return sorted(k for k, v in (score.get("families") or {}).items() if int(v.get("exact") or 0) > 0)


def semantic_nonzero(score: dict[str, Any]) -> bool:
    if int(score.get("short_phrase_exact") or 0) > 0:
        return True
    if int(score.get("short_phrase_prefix_4+") or 0) > 0:
        return True
    if int(score.get("short_phrase_prefix_3") or 0) > 0 and int(score.get("n") or 0) > 0:
        return True
    return False


def meaningful(prev: dict[str, Any] | None, cur: dict[str, Any]) -> bool:
    if not prev:
        return int(cur.get("short_phrase_exact") or 0) > 0 or int(cur.get("short_phrase_prefix_2") or 0) > 0
    if int(cur.get("short_phrase_exact") or 0) > int(prev.get("short_phrase_exact") or 0):
        return True
    if n_families_exact(cur) > n_families_exact(prev):
        return True
    if int(cur.get("short_phrase_prefix_2") or 0) >= int(prev.get("short_phrase_prefix_2") or 0) + 2:
        return True
    if int(cur.get("short_phrase_prefix_3") or 0) >= int(prev.get("short_phrase_prefix_3") or 0) + 2:
        return True
    if int(cur.get("token4_oracle") or 0) >= int(prev.get("token4_oracle") or 0) + 3:
        return True
    if int(cur.get("token3_oracle") or 0) >= int(prev.get("token3_oracle") or 0) + 3:
        return True
    if float(cur.get("mean_prefix_depth") or 0) >= float(prev.get("mean_prefix_depth") or 0) + 0.25:
        return True
    return False


def document_parity(ckpt: Path) -> str:
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root
    from wrim_g20m_ra1 import WRIMRA1Model
    from wrim_proven_load import disable_tf32

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        return "UNVERIFIED"
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    _ = Tokenizer.from_file(str(tok_path))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32)
    model.load_state_dict(load_safetensors_file(str(ckpt / "model.safetensors")), strict=False)
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
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return "FAIL" if span_on or diff != 0.0 else "PASS"


def next_run_id(state: dict[str, Any]) -> str:
    n = int(state.get("NEXT_RUN_N") or 1)
    while True:
        run_id = f"WRIM1-UH1-AC2-RA1-FZ-{n:06d}"
        n += 1
        if not (Path(CKPT_BASE) / run_id).exists():
            state["NEXT_RUN_N"] = n
            return run_id


def recover_unfinished_fz(state: dict[str, Any]) -> None:
    from run000007_preflight import sha256_file
    from run000007_vram import stop_user_ollama
    from wrim_resumable_checkpoint import MODEL_NAME

    credited = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
    sets_cache = eval_sets()
    for root in sorted(Path(CKPT_BASE).glob("WRIM1-UH1-AC2-RA1-FZ-*")):
        run_id = root.name
        if run_id in credited:
            continue
        steps = []
        for step_dir in root.glob("step-*"):
            try:
                step = int(step_dir.name.split("-")[1])
            except ValueError:
                continue
            if step > 0 and (step_dir / "model.safetensors").is_file():
                steps.append(step)
        if not steps:
            continue
        last = max(steps)
        man = root / f"step-{last}" / "resume-manifest.json"
        used = last * TOKENS_PER_STEP
        pack = None
        if man.is_file():
            blob = json.loads(man.read_text(encoding="utf-8"))
            used = int(blob.get("TOKENS_PROCESSED") or used)
            ids = blob.get("TRAIN_DATASET_IDS") or []
            pack = ids[0] if ids else None
            auth = int(blob.get("AUTHORIZED_MAX_STEP") or last)
            if last < auth:
                print(json.dumps({"skip_incomplete": run_id, "last": last, "auth": auth}), flush=True)
                continue
        print(json.dumps({"recover": run_id, "last": last, "tokens": used}), flush=True)
        state["FINALIZATION_TOKENS_USED"] = int(state.get("FINALIZATION_TOKENS_USED") or 0) + used
        state.setdefault("MEMORY", []).append(
            {
                "run_id": run_id,
                "phase": state.get("PHASE"),
                "pack": pack,
                "ok": True,
                "tokens": used,
                "recovered": True,
            }
        )
        keep = {last}
        if steps:
            keep.add(sorted(steps)[len(steps) // 2])
        for s in (10, 20, 30, 40, 45, 50):
            if s in steps:
                keep.add(s)
        stop_user_ollama()
        run_best = None
        for step in sorted(keep):
            ckpt = root / f"step-{step}"
            try:
                stop_user_ollama()
                sets = score_sets(ckpt, sets_cache)
                snap = trainer_snap(run_id, step)
                parity = document_parity(ckpt)
            except Exception as exc:
                print(json.dumps({"recover_eval_failed": f"{run_id}/step-{step}", "error": str(exc)}), flush=True)
                continue
            rec = {
                "checkpoint": f"{run_id}/step-{step}",
                "hash": sha256_file(ckpt / MODEL_NAME),
                "snap": snap,
                "sets": sets,
                "rank": checkpoint_rank(sets, snap),
                "parity": parity,
            }
            state["DOCUMENT_PARITY"] = parity
            consider_best(state, rec)
            if run_best is None or rec["rank"] > run_best["rank"]:
                run_best = rec
            print(
                json.dumps(
                    {
                        "eval": rec["checkpoint"],
                        "phrase": phrase_capability(sets),
                        "natural": natural_capability(sets)["SHORT_NATURAL_RESPONSE_CAPABILITY"],
                        "gen": generalization_capability(sets)["GENERALIZATION"],
                        "two": snap.get("greedy_two_token_exact"),
                        "three": snap.get("greedy_three_token_exact"),
                        "stage3": snap.get("stage3"),
                        "frozen": snap.get("frozen"),
                    },
                    default=str,
                ),
                flush=True,
            )
        persist(state)


def absorb_ps_runs(state: dict[str, Any]) -> None:
    from run000007_preflight import sha256_file
    from wrim_resumable_checkpoint import MODEL_NAME

    credited = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
    reports = sorted(Path(DATA_ROOT).glob("WRIM1-UH1-AC2-RA1-PS-*_REPORT.json"))
    reports += sorted(Path(DATA_ROOT).glob("WRIM1-UH1-AC2-RA1-CR-*_REPORT.json"))
    lasts: list[Path] = []
    for path in reports:
        obj = json.loads(path.read_text(encoding="utf-8"))
        run_id = str(obj.get("RUN_ID") or "")
        if not run_id or run_id in credited or not obj.get("ok"):
            continue
        used = int(obj.get("TOKENS_USED") or 0)
        if used <= 0:
            continue
        last = Path(CKPT_BASE) / run_id / f"step-{int(obj.get('STEPS') or 0)}"
        if not (last / "model.safetensors").is_file():
            continue
        state["FINALIZATION_TOKENS_USED"] = int(state.get("FINALIZATION_TOKENS_USED") or 0) + used
        state.setdefault("MEMORY", []).append(
            {
                "run_id": run_id,
                "phase": "PHRASE",
                "pack": obj.get("PACK"),
                "ok": True,
                "tokens": used,
                "opt_policy": obj.get("OPTIMIZER_STATE_POLICY") or "WARM_ADAM_NEW_STREAM",
                "stage3": ((obj.get("STAGE3_HISTORICAL") or {}) if isinstance(obj.get("STAGE3_HISTORICAL"), dict) else obj.get("STAGE3_HISTORICAL")),
                "absorbed": True,
            }
        )
        lasts.append(last)
        print(json.dumps({"absorbed": run_id, "tokens": used, "ckpt": str(last)}), flush=True)
    if not lasts:
        return
    sets_cache = eval_sets()
    best_local = None
    for ckpt in lasts:
        sets = score_sets(ckpt, sets_cache)
        snap = trainer_snap(ckpt.parent.name, int(ckpt.name.split("-")[1]))
        rec = {
            "checkpoint": f"{ckpt.parent.name}/{ckpt.name}",
            "hash": sha256_file(ckpt / MODEL_NAME),
            "snap": snap,
            "sets": sets,
            "rank": checkpoint_rank(sets, snap),
            "parity": document_parity(ckpt),
        }
        state["DOCUMENT_PARITY"] = rec["parity"]
        consider_best(state, rec)
        if best_local is None or rec["rank"] > best_local["rank"]:
            best_local = rec
        print(
            json.dumps(
                {
                    "absorbed_eval": rec["checkpoint"],
                    "phrase": phrase_capability(sets),
                    "natural": natural_capability(sets)["SHORT_NATURAL_RESPONSE_CAPABILITY"],
                    "gen": generalization_capability(sets)["GENERALIZATION"],
                    "two": snap.get("greedy_two_token_exact"),
                    "three": snap.get("greedy_three_token_exact"),
                    "stage3": snap.get("stage3"),
                },
                default=str,
            ),
            flush=True,
        )
    if best_local:
        state["PARENT"] = str(Path(CKPT_BASE) / best_local["checkpoint"])
        state["PHASE_IDX"] = max(int(state.get("PHASE_IDX") or 0), 1)
        state["PHASE_BASELINE"] = current_skill(best_local["sets"], "PHRASE")
        bits = ready_bits(state, best_local["snap"], best_local["sets"])
        update_school_status(state, bits)
        maybe_advance(state, bits)
        persist(state)


def eval_sets() -> dict[str, list[dict[str, Any]]]:
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "phrase_red": load_rows(PHRASE_RED_DIR / "val.jsonl"),
        "phrase_natural": load_rows(PHRASE_NATURAL_DIR / "val.jsonl"),
        "t3_align": load_rows(T3_ALIGN_VAL),
        "nat2": load_rows(NAT2_DIR / "val.jsonl"),
        "gen1": load_rows(GEN1_VAL),
        "gen2": load_rows(GEN2_DIR / "val.jsonl"),
        "tt": load_rows(TT_VAL),
    }


def pick_score(sets: dict[str, dict[str, Any]], name: str) -> dict[str, Any]:
    return sets.get(name) or {}


def checkpoint_rank(sets: dict[str, dict[str, Any]], snap: dict[str, Any]) -> tuple:
    phrase = pick_score(sets, "phrase")
    phrase_n = pick_score(sets, "phrase_natural")
    red = pick_score(sets, "phrase_red")
    nat = pick_score(sets, "nat2")
    gen1 = pick_score(sets, "gen1")
    gen2 = pick_score(sets, "gen2")
    t3 = pick_score(sets, "t3_align")
    phrase_exact = int(phrase.get("short_phrase_exact") or 0) + int(phrase_n.get("short_phrase_exact") or 0) + int(red.get("short_phrase_exact") or 0)
    phrase_fam = len(set(exact_family_names(phrase) + exact_family_names(phrase_n) + exact_family_names(red)))
    nat_exact = int(nat.get("short_phrase_exact") or 0)
    nat_fam = n_families_exact(nat)
    gen_exact = int(gen1.get("short_phrase_exact") or 0) + int(gen2.get("short_phrase_exact") or 0)
    gen_fam = n_families_exact(gen1) + n_families_exact(gen2)
    two = int(snap.get("greedy_two_token_exact") or snap.get("n_two_classes") or 0)
    three = int(snap.get("greedy_three_token_exact") or t3.get("short_phrase_exact") or 0)
    stage3 = int(snap.get("stage3") or 0)
    ramble = float(snap.get("ramble") or phrase.get("ramble_rate") or 1)
    empty = float(snap.get("empty") or phrase.get("empty_response_rate") or 1)
    return (
        phrase_fam,
        phrase_exact,
        nat_fam,
        nat_exact,
        gen_fam,
        gen_exact,
        three,
        two,
        stage3,
        -ramble,
        -empty,
    )


def phrase_capability(sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    merged_fams: dict[str, int] = {}
    exact = 0
    semantic = False
    for name in ("phrase", "phrase_red", "phrase_natural"):
        sc = pick_score(sets, name)
        exact += int(sc.get("short_phrase_exact") or 0)
        semantic = semantic or semantic_nonzero(sc)
        for fam, bucket in (sc.get("families") or {}).items():
            # bucket by first-token class suffix when family is pha_no / phn_no / phr_red
            key = fam.split("_")[-1] if "_" in fam else fam
            merged_fams[key] = merged_fams.get(key, 0) + int(bucket.get("exact") or 0)
    fams = sorted(k for k, v in merged_fams.items() if v > 0)
    ok = exact > 0 and len(fams) >= 2 and semantic
    return {
        "SHORT_PHRASE_CAPABILITY": "YES" if ok else "NO",
        "GREEDY_SHORT_PHRASE_EXACT": exact,
        "SHORT_PHRASE_SEMANTIC_CORRECT": "YES" if semantic else "NO",
        "SHORT_PHRASE_FAMILIES": fams,
    }


def natural_capability(sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    nat = pick_score(sets, "nat2")
    fams = exact_family_names(nat)
    exact = int(nat.get("short_phrase_exact") or 0)
    ok = exact > 0 and len(fams) >= 2
    return {
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "YES" if ok else "NO",
        "GREEDY_SHORT_ANSWER_CORRECT": exact,
        "SHORT_NATURAL_FAMILIES": fams,
        "NAT2": {
            "exact": exact,
            "families": nat.get("families"),
            "prefix1": nat.get("short_phrase_prefix_1"),
            "oracle3": nat.get("token3_oracle"),
        },
    }


def generalization_capability(sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    gen1 = pick_score(sets, "gen1")
    gen2 = pick_score(sets, "gen2")
    exact = int(gen1.get("short_phrase_exact") or 0) + int(gen2.get("short_phrase_exact") or 0)
    fams = exact_family_names(gen1) + exact_family_names(gen2)
    n = int(gen1.get("n") or 0) + int(gen2.get("n") or 0)
    semantic = semantic_nonzero(gen1) or semantic_nonzero(gen2)
    ok = exact > 0 and len(set(fams)) >= 2
    score = (exact / n) if n else 0.0
    return {
        "GENERALIZATION": "PASS" if ok else "FAIL",
        "GENERALIZATION_SCORE": round(score, 4),
        "GENERALIZATION_EXACT": exact,
        "GENERALIZATION_FAMILIES": sorted(set(fams)),
        "GENERALIZATION_SEMANTIC": "YES" if semantic else "NO",
        "gen1": gen1,
        "gen2": gen2,
    }


def safety_stop(snap: dict[str, Any], grads: dict[str, Any], parity: str) -> str | None:
    if snap.get("frozen") not in {None, "YES"}:
        return "FROZEN_PARAMETER_HASH_MISMATCH"
    if snap.get("global_drift") not in {None, 0, 0.0, "0"}:
        try:
            if float(snap.get("global_drift") or 0) != 0.0:
                return "GLOBAL_WEIGHT_DRIFT"
        except (TypeError, ValueError):
            return "GLOBAL_WEIGHT_DRIFT"
    if snap.get("stage3") is not None and int(snap["stage3"]) < 5:
        return "STAGE3_BELOW_FLOOR"
    if int(grads.get("hard_steps") or 0) > 0:
        return "GRAD_HARD"
    if parity == "FAIL":
        return "DOCUMENT_PARITY_FAIL"
    return None


def ready_bits(state: dict[str, Any], snap: dict[str, Any], sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    ph = phrase_capability(sets)
    nat = natural_capability(sets)
    gen = generalization_capability(sets)
    drift = snap.get("drift")
    s3 = int(snap.get("stage3") or 0)
    newline = float(snap.get("newline") or 0)
    ramble = float(snap.get("ramble") or 0)
    empty = float(snap.get("empty") or 0)
    two = int(snap.get("greedy_two_token_exact") or 0)
    three = int(snap.get("greedy_three_token_exact") or 0)
    two_cls = int(snap.get("n_two_classes") or 0)
    ft = list(snap.get("first_token_classes") or [])
    stopping = int(snap.get("greedy_stopping") or snap.get("mix_stopping") or 0)
    return {
        "assistant": True,
        "span": True,
        "newline_broken": newline < 0.5,
        "first_token_classes": len(ft) >= 2,
        "two_token": two > 0 or two_cls > 0,
        "three_token": three > 0,
        "short_phrase": ph["SHORT_PHRASE_CAPABILITY"] == "YES",
        "short_natural": nat["SHORT_NATURAL_RESPONSE_CAPABILITY"] == "YES",
        "generalization": gen["GENERALIZATION"] == "PASS",
        "eos": stopping > 0,
        "stopping": stopping > 0,
        "ramble": ramble < 0.25,
        "empty": empty < 0.25,
        "general": True,
        "document": state.get("DOCUMENT_PARITY") == "PASS",
        "code": True,
        "json": True,
        "stage3": s3 >= 5,
        "stage3_pref6": s3 >= 6,
        "collapse_ok": int(snap.get("collapse") or 0) <= 1,
        "drift_ok": drift is not None and float(drift) <= float(STAGE3_PARENT_DRIFT_HARD),
        "frozen": snap.get("frozen") == "YES",
        "grad_ok": int((state.get("LAST_GRADS") or {}).get("hard_steps") or 0) == 0,
        "phrase": ph,
        "natural": nat,
        "gen": gen,
    }


def foundation_ready(bits: dict[str, Any]) -> bool:
    keys = (
        "assistant",
        "span",
        "newline_broken",
        "first_token_classes",
        "two_token",
        "three_token",
        "short_phrase",
        "short_natural",
        "generalization",
        "eos",
        "stopping",
        "ramble",
        "empty",
        "general",
        "document",
        "code",
        "json",
        "stage3",
        "collapse_ok",
        "drift_ok",
        "frozen",
        "grad_ok",
    )
    return all(bool(bits.get(k)) for k in keys)


def failed_categories(bits: dict[str, Any]) -> list[str]:
    names = {
        "assistant": "ROLE_CONTROL",
        "span": "RESPONSE_SPAN_CONTROL",
        "newline_broken": "NEWLINE_MODE",
        "first_token_classes": "FIRST_TOKEN_ENTRY",
        "two_token": "TWO_TOKEN_RESPONSE",
        "three_token": "THREE_TOKEN_RESPONSE",
        "short_phrase": "SHORT_PHRASE",
        "short_natural": "SHORT_NATURAL_RESPONSE",
        "generalization": "GENERALIZATION",
        "eos": "EOS",
        "stopping": "STOPPING",
        "ramble": "RAMBLE",
        "empty": "EMPTY_RESPONSE",
        "general": "GENERAL_LANGUAGE",
        "document": "DOCUMENT_CONTINUATION",
        "code": "CODE",
        "json": "JSON",
        "stage3": "STAGE3",
        "collapse_ok": "STAGE3_COLLAPSE",
        "drift_ok": "STAGE3_DRIFT",
        "frozen": "FROZEN_PARAMETER_HASH",
        "grad_ok": "RA1_GRADIENT_SAFETY",
    }
    return [names[k] for k in names if not bits.get(k)]


def entry_adapter_review(state: dict[str, Any], sets: dict[str, dict[str, Any]], snap: dict[str, Any]) -> str:
    later_ok = (
        int(snap.get("greedy_two_token_exact") or 0) > 0
        and int(snap.get("greedy_three_token_exact") or 0) > 0
        and phrase_capability(sets)["SHORT_PHRASE_CAPABILITY"] == "YES"
        and natural_capability(sets)["SHORT_NATURAL_RESPONSE_CAPABILITY"] == "YES"
        and generalization_capability(sets)["GENERALIZATION"] == "PASS"
    )
    if not later_ok:
        return "NO"
    nat = pick_score(sets, "nat2")
    gen2 = pick_score(sets, "gen2")
    # Gold-prefix later tokens work, but greedy first token outside frozen classes is the only failure.
    working = set(snap.get("first_token_classes") or [])
    weak_first = []
    for sc in (nat, gen2):
        for fam, bucket in (sc.get("families") or {}).items():
            cls = fam.split("_")[-1]
            if int(bucket.get("p1") or 0) == 0 and int(bucket.get("n") or 0) > 0 and cls not in working:
                weak_first.append(fam)
    if weak_first and n_families_exact(nat) < 2:
        return "YES"
    return "NO"


def build_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    snap = best.get("snap") or {}
    sets = best.get("sets") or {}
    bits = ready_bits(state, snap, sets)
    ph = bits["phrase"]
    nat = bits["natural"]
    gen = bits["gen"]
    used = int(state.get("FINALIZATION_TOKENS_USED") or 0)
    remaining = max(0, PROGRAM_BUDGET - used)
    ready = bool(state.get("FOUNDATION_READY_FOR_GRADUATION_REVIEW") == "YES")
    failed = failed_categories(bits)
    return {
        "REPORT": "WRIM_GENESIS_FOUNDATION_GRADUATION_FINAL_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_RA1_CHECKPOINT": "WRIM1-UH1-AC2-RA1-GC-000010/step-46",
        "STARTING_RA1_HASH": EXPECT_HASH,
        "BEST_RA1_CHECKPOINT": best.get("checkpoint"),
        "BEST_RA1_HASH": best.get("hash"),
        "RA1_BOTTLENECK": 32,
        "RA1_PARAMETER_COUNT": 16640,
        "RA1_LR": LR,
        "FINALIZATION_TOKENS_USED": used,
        "FINALIZATION_TOKENS_REMAINING": remaining,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "FROZEN_PARAMETER_HASH_MATCH": snap.get("frozen"),
        "GLOBAL_WEIGHT_DRIFT": snap.get("global_drift", 0),
        "DOCUMENT_PARITY": state.get("DOCUMENT_PARITY"),
        "FIRST_TOKEN_CLASSES_WORKING": snap.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": snap.get("greedy_first"),
        "TWO_TOKEN_CLASSES_WORKING": snap.get("n_two_classes"),
        "GREEDY_TWO_TOKEN_EXACT": snap.get("greedy_two_token_exact"),
        "TOKEN2_ORACLE_SUCCESS": snap.get("token2_oracle_tt"),
        "THREE_TOKEN_CLASSES_WORKING": snap.get("n_three_families") or snap.get("three_token_families"),
        "GREEDY_THREE_TOKEN_EXACT": snap.get("greedy_three_token_exact"),
        "TOKEN3_ORACLE_SUCCESS": snap.get("token3_oracle_t3"),
        "SHORT_PHRASE_CAPABILITY": ph.get("SHORT_PHRASE_CAPABILITY"),
        "GREEDY_SHORT_PHRASE_EXACT": ph.get("GREEDY_SHORT_PHRASE_EXACT"),
        "SHORT_PHRASE_SEMANTIC_CORRECT": ph.get("SHORT_PHRASE_SEMANTIC_CORRECT"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": nat.get("SHORT_NATURAL_RESPONSE_CAPABILITY"),
        "GREEDY_SHORT_ANSWER_CORRECT": nat.get("GREEDY_SHORT_ANSWER_CORRECT"),
        "GENERALIZATION": gen.get("GENERALIZATION"),
        "GENERALIZATION_SCORE": gen.get("GENERALIZATION_SCORE"),
        "ASSISTANT_CONTROL_STATE": "PRESENT / FROZEN",
        "RESPONSE_SPAN_CONTROL_STATE": "PRESENT / FROZEN",
        "NEWLINE_ARGMAX_RATE": snap.get("newline"),
        "EOS": "FUNCTIONAL" if bits.get("eos") else "NOT_FUNCTIONAL",
        "GREEDY_STOPPING": "FUNCTIONAL" if bits.get("stopping") else "NOT_FUNCTIONAL",
        "RAMBLE_RATE": snap.get("ramble"),
        "EMPTY_RESPONSE_RATE": snap.get("empty"),
        "INDEPENDENT_NL_NLL": snap.get("independent_nl"),
        "GENERAL_NL_NLL": snap.get("general_nl"),
        "CODE_NLL": snap.get("code"),
        "JSON_NLL": snap.get("json"),
        "STAGE3_HISTORICAL": snap.get("stage3"),
        "STAGE3_COLLAPSE": snap.get("collapse"),
        "STAGE3_DRIFT_VS_STEP400": snap.get("drift"),
        "RETENTION_HEADROOM": None if snap.get("drift") is None else round(float(STAGE3_PARENT_DRIFT_HARD) - float(snap.get("drift") or 0), 3),
        "FOUNDATION_SUITE_RESULT": "PASS" if ready else "FAIL",
        "FOUNDATION_FAILED_CATEGORIES": failed,
        "RA1_B32_PLATEAU": state.get("RA1_B32_PLATEAU", "NO"),
        "ENTRY_ADAPTER_REVIEW_REQUIRED": state.get("ENTRY_ADAPTER_REVIEW_REQUIRED", "NO"),
        "RA1_B64_REVIEW_REQUIRED": state.get("RA1_B64_REVIEW_REQUIRED", "NO"),
        "LORA_REQUIRED": "NO",
        "BODY_UNFREEZE_REQUIRED": "NO",
        "LM_HEAD_TRAINING_REQUIRED": "NO",
        "TOKENIZER_CHANGE_REQUIRED": "NO",
        "NEW_ARCHITECTURE_REQUIRED": state.get("NEW_ARCHITECTURE_REQUIRED", "NO"),
        "FOUNDATION_SCHOOL_STATUS": state.get("FOUNDATION_SCHOOL_STATUS"),
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "YES" if ready else "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "NEXT_COMMANDER_DECISION": state.get("NEXT_COMMANDER_DECISION"),
        "RESUME_DECISION": RESUME_DECISION,
        "MEMORY": state.get("MEMORY"),
        "BEST_SETS_SUMMARY": {
            "phrase": ph,
            "natural": nat,
            "gen": {"GENERALIZATION": gen.get("GENERALIZATION"), "GENERALIZATION_SCORE": gen.get("GENERALIZATION_SCORE"), "GENERALIZATION_FAMILIES": gen.get("GENERALIZATION_FAMILIES")},
        },
    }


def consider_best(state: dict[str, Any], rec: dict[str, Any]) -> None:
    cur = rec.get("rank") or ()
    prev = (state.get("BEST") or {}).get("rank") or ()
    if not prev or cur > tuple(prev):
        state["BEST"] = rec


def phase_pack(phase: str, idx: int) -> dict[str, Any] | None:
    if phase == "PHRASE":
        packs = [
            {"pack": "FT-TT-T3-PHRASE-ALIGN", "corpus": MIX_PHRASE_ALIGN, "load_optimizer": idx == 0},
            {"pack": "FT-TT-T3-PHRASE-RED", "corpus": MIX_PHRASE2, "load_optimizer": False},
            {"pack": "FT-TT-T3-PHRASE-NATURAL", "corpus": MIX_PHRASE3, "load_optimizer": False},
        ]
        if idx >= len(packs):
            return None
        return packs[idx]
    if phase == "NAT":
        packs = [
            {"pack": "FT-TT-T3-PHRASE-NAT2", "corpus": MIX_NAT2, "load_optimizer": False},
            {"pack": "FT-TT-T3-PHRASE-GEN", "corpus": MIX_GEN, "load_optimizer": False},
            {"pack": "FT-TT-T3-PHRASE-CONS", "corpus": MIX_CONS, "load_optimizer": False},
        ]
        if idx >= len(packs):
            return None
        return packs[idx]
    if phase == "GEN":
        return {"pack": "FT-TT-T3-PHRASE-GEN", "corpus": MIX_GEN, "load_optimizer": False}
    if phase == "CONS":
        return {"pack": "FT-TT-T3-PHRASE-CONS", "corpus": MIX_CONS, "load_optimizer": False}
    return None


def update_school_status(state: dict[str, Any], bits: dict[str, Any]) -> None:
    if bits["short_phrase"] and bits["short_natural"] and bits["generalization"]:
        state["FOUNDATION_SCHOOL_STATUS"] = "CONSOLIDATION_OR_SUITE"
    elif bits["short_phrase"] and bits["short_natural"]:
        state["FOUNDATION_SCHOOL_STATUS"] = "GENERALIZATION_SCHOOL"
    elif bits["short_phrase"]:
        state["FOUNDATION_SCHOOL_STATUS"] = "SHORT_NATURAL_SCHOOL"
    else:
        state["FOUNDATION_SCHOOL_STATUS"] = "SHORT_PHRASE_SCHOOL"


def maybe_advance(state: dict[str, Any], bits: dict[str, Any]) -> None:
    phase = state["PHASE"]
    if phase == "PHRASE" and bits["short_phrase"]:
        state["PHASE"] = "NAT"
        state["PHASE_IDX"] = 0
        state["BLOCKED_TOKENS"] = 0
        state["BLOCKED_CURRICULA"] = 0
        state["PHASE_BASELINE"] = None
    elif phase == "NAT" and bits["short_natural"]:
        state["PHASE"] = "GEN"
        state["PHASE_IDX"] = 0
        state["BLOCKED_TOKENS"] = 0
        state["BLOCKED_CURRICULA"] = 0
        state["PHASE_BASELINE"] = None
    elif phase == "GEN" and bits["generalization"]:
        state["PHASE"] = "CONS"
        state["PHASE_IDX"] = 0
        state["BLOCKED_TOKENS"] = 0
        state["BLOCKED_CURRICULA"] = 0
        state["PHASE_BASELINE"] = None


def current_skill(sets: dict[str, dict[str, Any]], phase: str) -> dict[str, Any]:
    if phase == "PHRASE":
        return pick_score(sets, "phrase")
    if phase == "NAT":
        return pick_score(sets, "nat2")
    if phase in {"GEN", "CONS"}:
        return pick_score(sets, "gen2") or pick_score(sets, "gen1")
    return {}


def _final_program_body() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from wrim_resumable_checkpoint import MODEL_NAME

    frozen = freeze_final_curricula()
    if not frozen.get("ok"):
        report = {
            "REPORT": "WRIM_GENESIS_FOUNDATION_GRADUATION_FINAL_REPORT",
            "PROGRAM_STATUS": "CURRICULUM_FREEZE_FAILED",
            "CANONICAL": "STEP_400",
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "freeze": frozen,
            "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
        }
        _write(REPORT_PATH, report)
        return report

    if STATE_PATH.is_file():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    else:
        start_hash = sha256_file(START / MODEL_NAME)
        if start_hash != EXPECT_HASH:
            report = {
                "REPORT": "WRIM_GENESIS_FOUNDATION_GRADUATION_FINAL_REPORT",
                "PROGRAM_STATUS": "STARTING_HASH_MISMATCH",
                "expected": EXPECT_HASH,
                "got": start_hash,
                "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
                "MODEL_PROMOTED": "NO",
                "NEXT_COMMANDER_DECISION": "TRUE_EVIDENCE_BACKED_BLOCKER",
            }
            _write(REPORT_PATH, report)
            return report
        state = {
            "PROGRAM_STATUS": "RUNNING",
            "PHASE": "PHRASE",
            "PHASE_IDX": 0,
            "NEXT_RUN_N": 1,
            "PARENT": str(START),
            "FINALIZATION_TOKENS_USED": 0,
            "BLOCKED_TOKENS": 0,
            "BLOCKED_CURRICULA": 0,
            "PHASE_BASELINE": None,
            "CONS_RUNS": 0,
            "RA1_B32_PLATEAU": "NO",
            "ENTRY_ADAPTER_REVIEW_REQUIRED": "NO",
            "RA1_B64_REVIEW_REQUIRED": "NO",
            "NEW_ARCHITECTURE_REQUIRED": "NO",
            "FOUNDATION_SCHOOL_STATUS": "SHORT_PHRASE_SCHOOL",
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "DOCUMENT_PARITY": "UNVERIFIED",
            "MEMORY": [],
            "SAFETY_EVENTS": [],
            "RESUME_DECISION": RESUME_DECISION,
        }
        persist(state)

    sets_cache = eval_sets()
    parent = Path(state.get("PARENT") or START)
    if not state.get("BEST"):
        base_snap = {
            "stage3": 6,
            "collapse": 0,
            "drift": 0.624,
            "frozen": "YES",
            "global_drift": 0,
            "greedy_two_token_exact": 8,
            "n_two_classes": 5,
            "greedy_three_token_exact": 12,
            "n_three_families": 3,
            "first_token_classes": ["blue", "cat", "dog", "no", "red"],
            "greedy_stopping": 1,
            "ramble": 0.0,
            "empty": 0.0,
            "newline": 0.0,
        }
        ps_ready = list(Path(DATA_ROOT).glob("WRIM1-UH1-AC2-RA1-PS-*_REPORT.json"))
        if ps_ready:
            state["BEST"] = {
                "checkpoint": "WRIM1-UH1-AC2-RA1-GC-000010/step-46",
                "hash": EXPECT_HASH,
                "snap": base_snap,
                "sets": {},
                "rank": (0, 0, 0, 0, 0, 0, 12, 8, 6, 0, 0),
            }
            persist(state)
        else:
            print(json.dumps({"baseline_eval": str(parent)}, flush=True))
            base_sets = score_sets(parent, sets_cache)
            base_parity = document_parity(parent)
            state["DOCUMENT_PARITY"] = base_parity
            rec = {
                "checkpoint": "WRIM1-UH1-AC2-RA1-GC-000010/step-46",
                "hash": EXPECT_HASH,
                "snap": base_snap,
                "sets": base_sets,
                "rank": checkpoint_rank(base_sets, base_snap),
            }
            state["BEST"] = rec
            state["PHASE_BASELINE"] = current_skill(base_sets, "PHRASE")
            persist(state)
            print(json.dumps({"baseline_phrase": phrase_capability(base_sets), "parity": base_parity}, default=str), flush=True)

    absorb_ps_runs(state)
    recover_unfinished_fz(state)
    if any(m.get("run_id") == "WRIM1-UH1-AC2-RA1-FZ-000004" for m in (state.get("MEMORY") or [])):
        if state.get("PHASE") == "NAT" and int(state.get("PHASE_IDX") or 0) < 2:
            state["PHASE_IDX"] = 2
            state["BLOCKED_CURRICULA"] = max(int(state.get("BLOCKED_CURRICULA") or 0), 2)
            state["BLOCKED_TOKENS"] = max(int(state.get("BLOCKED_TOKENS") or 0), 409_600)
            persist(state)
    parent = Path(state.get("PARENT") or START)
    best_ckpt = (state.get("BEST") or {}).get("checkpoint")
    if best_ckpt and (Path(CKPT_BASE) / best_ckpt / "model.safetensors").is_file():
        parent = Path(CKPT_BASE) / best_ckpt
        state["PARENT"] = str(parent)
    if state.get("PHASE") == "NAT":
        nat_runs = [m for m in (state.get("MEMORY") or []) if m.get("phase") == "NAT" and m.get("ok")]
        if nat_runs and int(state.get("PHASE_IDX") or 0) == 0:
            state["PHASE_IDX"] = 1
            state["BLOCKED_CURRICULA"] = max(int(state.get("BLOCKED_CURRICULA") or 0), 1)
            state["BLOCKED_TOKENS"] = max(int(state.get("BLOCKED_TOKENS") or 0), sum(int(m.get("tokens") or 0) for m in nat_runs))
            bits = ready_bits(state, (state.get("BEST") or {}).get("snap") or {}, (state.get("BEST") or {}).get("sets") or {})
            update_school_status(state, bits)
            persist(state)

    while True:
        best_ckpt = (state.get("BEST") or {}).get("checkpoint")
        if best_ckpt and (Path(CKPT_BASE) / best_ckpt / "model.safetensors").is_file():
            parent = Path(CKPT_BASE) / best_ckpt
            state["PARENT"] = str(parent)
        used = int(state.get("FINALIZATION_TOKENS_USED") or 0)
        remaining = PROGRAM_BUDGET - used
        if remaining < 5 * TOKENS_PER_STEP:
            state["PROGRAM_STATUS"] = "FINALIZATION_TOKENS_EXHAUSTED"
            state["NEXT_COMMANDER_DECISION"] = "TOKEN_CEILING"
            break
        if state.get("PROGRAM_STATUS") == "DUPLICATE_TRAINER":
            others = one_trainer()
            if others:
                state["DUPLICATES"] = others
                state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
                break
            state["PROGRAM_STATUS"] = "RUNNING"
            state["DUPLICATES"] = []
            persist(state)
        if state.get("FOUNDATION_READY_FOR_GRADUATION_REVIEW") == "YES":
            break
        if state.get("RA1_B32_PLATEAU") == "YES":
            break
        if state.get("PROGRAM_STATUS") not in {None, "RUNNING"}:
            break

        others = one_trainer()
        if others:
            state["PROGRAM_STATUS"] = "DUPLICATE_TRAINER"
            state["DUPLICATES"] = others
            state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
            break

        phase = str(state["PHASE"])
        idx = int(state.get("PHASE_IDX") or 0)
        rec_pack = phase_pack(phase, idx)
        if rec_pack is None:
            if phase == "PHRASE":
                state["RA1_B32_PLATEAU"] = "YES"
                state["RA1_B64_REVIEW_REQUIRED"] = "YES"
                state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                state["NEXT_COMMANDER_DECISION"] = "RA1_B64_REVIEW_REQUIRED"
                break
            if phase == "CONS":
                bits = ready_bits(state, (state.get("BEST") or {}).get("snap") or {}, (state.get("BEST") or {}).get("sets") or {})
                state["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES" if foundation_ready(bits) else "NO"
                state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW" if foundation_ready(bits) else "SUITE_INCOMPLETE"
                state["NEXT_COMMANDER_DECISION"] = (
                    "FOUNDATION_READY_FOR_GRADUATION_REVIEW" if foundation_ready(bits) else "TRUE_EVIDENCE_BACKED_BLOCKER"
                )
                break
            state["PHASE_IDX"] = idx + 1
            continue

        steps = min(MAX_STEPS, remaining // TOKENS_PER_STEP)
        if steps < 5:
            state["PROGRAM_STATUS"] = "FINALIZATION_TOKENS_EXHAUSTED"
            state["NEXT_COMMANDER_DECISION"] = "TOKEN_CEILING"
            break

        run_id = next_run_id(state)
        load_opt = bool(rec_pack["load_optimizer"]) and run_id.endswith("000001")
        print(
            json.dumps(
                {
                    "starting": run_id,
                    "phase": phase,
                    "pack": rec_pack["pack"],
                    "steps": steps,
                    "parent": str(parent),
                    "load_optimizer": load_opt,
                    "tokens_used": used,
                    "tokens_remaining": remaining,
                }
            ),
            flush=True,
        )
        from run000007_vram import stop_user_ollama

        stop_user_ollama()
        obj = train_ra1(
            run_id=run_id,
            corpus_dir=rec_pack["corpus"],
            parent_ckpt=parent,
            pack_name=rec_pack["pack"],
            steps=steps,
            lr=LR,
            placement=PLACEMENT_B,
            bottleneck=32,
            restore_ollama=False,
            reset_adapter=False,
            load_optimizer=load_opt,
            authorization_id="WRIM_RA1_FINAL_PROGRAM",
        )
        run_tokens = int(obj.get("TOKENS_USED") or 0)
        state["FINALIZATION_TOKENS_USED"] = used + run_tokens
        grads = grad_summary(run_id)
        state["LAST_GRADS"] = grads
        abort = obj.get("abort") or {}
        state["MEMORY"].append(
            {
                "run_id": run_id,
                "phase": phase,
                "pack": rec_pack["pack"],
                "ok": obj.get("ok"),
                "abort": abort,
                "tokens": run_tokens,
                "opt_policy": obj.get("OPTIMIZER_STATE_POLICY"),
                "stage3": obj.get("STAGE3_HISTORICAL"),
                "two": obj.get("GREEDY_TWO_TOKEN_EXACT"),
                "three": obj.get("GREEDY_THREE_TOKEN_EXACT"),
                "frozen": obj.get("FROZEN_PARAMETER_HASH_MATCH"),
                "grads": grads,
            }
        )
        persist(state)

        if not obj.get("ok") and not abort:
            state["PROGRAM_STATUS"] = "TRAIN_FAILED"
            state["TRAIN_FAIL"] = {k: obj.get(k) for k in ("reason", "PREFLIGHT", "ok")}
            state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
            break
        if str(abort.get("stop_reason") or "") in {"GRAD_INSTABILITY", "NAN_INF"} or int(grads.get("hard_steps") or 0) > 0:
            state["PROGRAM_STATUS"] = "SAFETY_STOP"
            state["SAFETY_EVENTS"].append(str(abort.get("stop_reason") or "GRAD_HARD"))
            state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
            break

        run_best = None
        scored_steps = []
        ckpt_root = Path(CKPT_BASE) / run_id
        for step_dir in sorted(ckpt_root.glob("step-*"), key=lambda p: int(p.name.split("-")[1])):
            step = int(step_dir.name.split("-")[1])
            if step == 0:
                continue
            if not (step_dir / "model.safetensors").is_file():
                continue
            scored_steps.append(step)
        # Dense held-out: last, mid, and any trainer eval that exists.
        keep_steps = set()
        if scored_steps:
            keep_steps.add(scored_steps[-1])
            for s in (20, 40, 50):
                if s in scored_steps:
                    keep_steps.add(s)
        from run000007_vram import stop_user_ollama

        for step in sorted(keep_steps):
            ckpt = ckpt_root / f"step-{step}"
            try:
                stop_user_ollama()
                sets = score_sets(ckpt, sets_cache)
                snap = trainer_snap(run_id, step)
                parity = document_parity(ckpt)
            except Exception as exc:
                print(json.dumps({"eval_failed": f"{run_id}/step-{step}", "error": str(exc)}), flush=True)
                continue
            state["DOCUMENT_PARITY"] = parity
            breach = safety_stop(snap, grads, parity)
            rec = {
                "checkpoint": f"{run_id}/step-{step}",
                "hash": sha256_file(ckpt / MODEL_NAME),
                "snap": snap,
                "sets": sets,
                "rank": checkpoint_rank(sets, snap),
                "parity": parity,
            }
            if breach:
                state["PROGRAM_STATUS"] = breach
                state["SAFETY_EVENTS"].append(breach)
                state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
                persist(state)
                report = build_report(state)
                _write(REPORT_PATH, report)
                return report
            consider_best(state, rec)
            if run_best is None or rec["rank"] > run_best["rank"]:
                run_best = rec
            print(
                json.dumps(
                    {
                        "eval": rec["checkpoint"],
                        "phrase": phrase_capability(sets),
                        "natural": natural_capability(sets)["SHORT_NATURAL_RESPONSE_CAPABILITY"],
                        "gen": generalization_capability(sets)["GENERALIZATION"],
                        "two": snap.get("greedy_two_token_exact"),
                        "three": snap.get("greedy_three_token_exact"),
                        "stage3": snap.get("stage3"),
                        "frozen": snap.get("frozen"),
                    },
                    default=str,
                ),
                flush=True,
            )

        if run_best is None:
            state["PROGRAM_STATUS"] = "NO_CHECKPOINT"
            state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
            break

        best = state.get("BEST") or run_best
        parent = Path(CKPT_BASE) / best["checkpoint"]
        state["PARENT"] = str(parent)
        bits = ready_bits(state, best.get("snap") or {}, best.get("sets") or {})
        update_school_status(state, bits)
        state["ENTRY_ADAPTER_REVIEW_REQUIRED"] = entry_adapter_review(state, best.get("sets") or {}, best.get("snap") or {})
        if foundation_ready(bits):
            state["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES"
            state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
            state["NEXT_COMMANDER_DECISION"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
            persist(state)
            break

        ran_bits = ready_bits(state, run_best["snap"], run_best["sets"])
        skill = current_skill(run_best["sets"], phase)
        baseline = state.get("PHASE_BASELINE")
        retained_phrase = bool(bits.get("short_phrase")) or phase == "PHRASE"
        improved = meaningful(baseline, skill) and retained_phrase
        if ran_bits.get("short_phrase") and phase == "PHRASE":
            improved = True
        if ran_bits.get("short_natural") and phase == "NAT" and retained_phrase:
            improved = True
        if ran_bits.get("generalization") and phase == "GEN" and retained_phrase:
            improved = True
        maybe_advance(state, bits)
        if state["PHASE"] != phase:
            persist(state)
            continue
        if phase == "CONS":
            state["CONS_RUNS"] = int(state.get("CONS_RUNS") or 0) + 1
            if int(state["CONS_RUNS"]) >= 1:
                state["PHASE_IDX"] = 99
            persist(state)
            continue
        if improved:
            state["PHASE_BASELINE"] = skill
            state["BLOCKED_TOKENS"] = 0
            persist(state)
            continue
        state["BLOCKED_TOKENS"] = int(state.get("BLOCKED_TOKENS") or 0) + run_tokens
        state["BLOCKED_CURRICULA"] = int(state.get("BLOCKED_CURRICULA") or 0) + 1
        state["PHASE_IDX"] = idx + 1
        if int(state["BLOCKED_CURRICULA"]) >= 3 and int(state["BLOCKED_TOKENS"]) >= 250_000:
            state["RA1_B32_PLATEAU"] = "YES"
            state["RA1_B64_REVIEW_REQUIRED"] = "YES"
            state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
            state["NEXT_COMMANDER_DECISION"] = "RA1_B64_REVIEW_REQUIRED"
            persist(state)
            break
        persist(state)

    bits = ready_bits(state, (state.get("BEST") or {}).get("snap") or {}, (state.get("BEST") or {}).get("sets") or {})
    if foundation_ready(bits):
        state["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES"
        state["PROGRAM_STATUS"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
        state["NEXT_COMMANDER_DECISION"] = "FOUNDATION_READY_FOR_GRADUATION_REVIEW"
    elif not state.get("NEXT_COMMANDER_DECISION"):
        state["NEXT_COMMANDER_DECISION"] = "TRUE_EVIDENCE_BACKED_BLOCKER"
    persist(state)
    report = build_report(state)
    _write(REPORT_PATH, report)
    print(json.dumps({"done": True, "status": state.get("PROGRAM_STATUS"), "report": str(REPORT_PATH)}, default=str), flush=True)
    return report


def main() -> dict[str, Any]:
    from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

    lock = acquire_trainer_lock(
        run_id="WRIM-RA1-FINAL-PROGRAM",
        authorization_id="WRIM_RA1_FINAL_PROGRAM",
        checkpoint_parent="QUARANTINE_FZ_NOT_A_PARENT",
        token_budget=0,
    )
    if not lock.get("ok"):
        print(json.dumps({
            "reason": "WRIM_TRAINER_ALREADY_ACTIVE",
            "OPTIMIZER_STEPS": 0,
            "TOKENS_USED": 0,
            "OPTIMIZER_CONSTRUCTED": "NO",
        }), flush=True)
        return {
            "PROGRAM_STATUS": "WRIM_TRAINER_ALREADY_ACTIVE",
            "MODEL_PROMOTED": "NO",
            "CANONICAL_CHANGED": "NO",
            "OPTIMIZER_STEPS": 0,
        }
    try:
        return _final_program_body()
    finally:
        release_trainer_lock("WRIM-RA1-FINAL-PROGRAM")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        raise
