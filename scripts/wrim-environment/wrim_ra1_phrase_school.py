"""RA1 B32 short-phrase school. No promotion. Canonical remains STEP_400."""
from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD, TOKENS_PER_STEP
from wrim_ra1_grad_corpus import MIX_PHRASE_ALIGN, NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_train import train_ra1

START = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-GC-000010" / "step-46"
EXPECT_HASH = "1f87d5734ddd66071a5961851b9282ad3fd6087a1f8be104bf74562cc434253a"
LEDGER_START = 1_499_136
DUPLICATE_PRIOR = 4_096
REVIEW_TOKENS = 200_000
CEILING = 500_000
LR = 3e-4
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
STATE_PATH = Path(DATA_ROOT) / "WRIM_RA1_B32_PHRASE_SCHOOL_STATE.json"
REPORT_PATH = Path(DATA_ROOT) / "WRIM_RA1_B32_PHRASE_SCHOOL_200K_REVIEW.json"
TT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def one_trainer() -> list[str]:
    import os

    me = os.getpid()
    parent = os.getppid()
    scripts = {
        "wrim_ra1_train.py",
        "wrim_ra1_phrase_school.py",
        "wrim_ra1_grad_program.py",
        "wrim_ra1_continue.py",
        "wrim_ra1_continue2.py",
        "wrim_ra1_program.py",
        "wrim_ra1_final_program.py",
    }
    hits = []
    for pid_s in Path("/proc").iterdir():
        if not pid_s.name.isdigit():
            continue
        pid = int(pid_s.name)
        if pid in {me, parent}:
            continue
        try:
            parts = (pid_s / "cmdline").read_bytes().split(b"\x00")
        except OSError:
            continue
        args = [p.decode("utf-8", "replace") for p in parts if p]
        if not args or "python" not in Path(args[0]).name:
            continue
        names = {Path(a).name for a in args}
        if names & scripts:
            hits.append(f"{pid} {' '.join(args)[:180]}")
    return hits


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _score_loaded(model: Any, tok: Any, device: Any, rows: list[dict[str, Any]]) -> dict[str, Any]:
    import torch

    from wrim_cpt_eval import greedy_from_ids
    from wrim_plm1_encode import encode_example, prefix_ids_for_inference

    exact = 0
    prefixes = {1: 0, 2: 0, 3: 0, 4: 0}
    depths: list[int] = []
    oracle = {2: 0, 3: 0, 4: 0}
    oracle_n = {2: 0, 3: 0, 4: 0}
    families: dict[str, dict[str, int]] = {}
    stopped = 0
    ramble = 0
    empty = 0
    for rec in rows:
        enc = encode_example(tok, rec)
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        gen = greedy_from_ids(model, tok, device, prefix, max_new=16)
        tgt = [int(x) for x in enc["target_ids"]]
        new = list(gen.get("new_ids") or [])
        eos = bool(gen.get("eos"))
        body = new[:-1] if eos else new
        depth = 0
        for a, b in zip(body, tgt):
            if a != b:
                break
            depth += 1
        depths.append(depth)
        hit = int(body == tgt and eos)
        exact += hit
        for k in (1, 2, 3, 4):
            if depth >= k:
                prefixes[k] += 1
        stopped += int(eos)
        empty += int(not body)
        ramble += int((not eos and len(new) >= 16) or (len(body) >= 12 and not hit))
        fam = str(rec.get("family") or rec.get("first_token_class") or "unk")
        bucket = families.setdefault(fam, {"n": 0, "exact": 0, "p1": 0, "p2": 0, "p3": 0, "p4": 0})
        bucket["n"] += 1
        bucket["exact"] += hit
        bucket["p1"] += int(depth >= 1)
        bucket["p2"] += int(depth >= 2)
        bucket["p3"] += int(depth >= 3)
        bucket["p4"] += int(depth >= 4)
        gold = list(prefix)
        for k in (2, 3, 4):
            if len(tgt) < k:
                continue
            oracle_n[k] += 1
            ctx = gold + tgt[: k - 1]
            with torch.inference_mode():
                nxt = int(model(torch.tensor([ctx], dtype=torch.long, device=device))[0, -1].argmax().item())
            oracle[k] += int(nxt == tgt[k - 1])
    n = max(1, len(rows))
    return {
        "n": len(rows),
        "short_phrase_exact": exact,
        "greedy_three_token_exact": exact,
        "short_phrase_prefix_1": prefixes[1],
        "short_phrase_prefix_2": prefixes[2],
        "short_phrase_prefix_3": prefixes[3],
        "short_phrase_prefix_4+": prefixes[4],
        "mean_prefix_depth": (sum(depths) / len(depths)) if depths else 0.0,
        "token2_oracle": oracle[2],
        "token3_oracle": oracle[3],
        "token4_oracle": oracle[4],
        "token2_oracle_n": oracle_n[2],
        "token3_oracle_n": oracle_n[3],
        "token4_oracle_n": oracle_n[4],
        "greedy_stopping": stopped,
        "ramble_rate": ramble / n,
        "empty_response_rate": empty / n,
        "families": families,
    }


def score_sets(ckpt: Path, sets: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root
    from wrim_g20m_ra1 import WRIMRA1Model
    from wrim_proven_load import disable_tf32

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    src = load_safetensors_file(str(ckpt / "model.safetensors"))
    has_na1 = any(str(k).startswith("na1.") for k in src)
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=has_na1)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"score load mismatch extra={extra} unexpected={unexpected}")
    model.to(device).eval()
    natural_sets = {"natural", "natural_heldout"}
    out: dict[str, dict[str, Any]] = {}
    for name, rows in sets.items():
        if not rows:
            continue
        if has_na1 and hasattr(model, "set_span_route"):
            model.set_span_route("na1" if name in natural_sets else "ra1")
        out[name] = _score_loaded(model, tok, device, rows)
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return out


def score_rows(ckpt: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return score_sets(ckpt, {"rows": rows}).get("rows", {})


def trainer_snap(run_id: str, step: int) -> dict[str, Any]:
    ev = Path(CKPT_BASE) / run_id / "evals"
    out: dict[str, Any] = {"step": step}
    tt = ev / f"prefix-tt-step-{step}.json"
    t3 = ev / f"prefix-t3-step-{step}.json"
    dist = ev / f"distance-step-{step}.json"
    s3 = ev / f"stage3-step-{step}.json"
    nll = ev / f"val-nll-step-{step}.json"
    nl = ev / f"independent-nl-step-{step}.json"
    geo = ev / f"role-geo-step-{step}.json"
    mix = ev / f"prefix-step-{step}.json"
    if tt.is_file():
        o = json.loads(tt.read_text(encoding="utf-8"))
        out["greedy_two_token_exact"] = o.get("GREEDY_TWO_TOKEN_EXACT")
        out["token2_oracle_tt"] = o.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT")
        out["two_token_families"] = {
            k: v.get("TWO_TOKEN_EXACT") for k, v in (o.get("TWO_TOKEN_BY_CLASS") or {}).items()
        }
        out["n_two_classes"] = o.get("N_CLASSES_GREEDY_TWO_TOKEN")
    if t3.is_file():
        o = json.loads(t3.read_text(encoding="utf-8"))
        out["greedy_three_token_exact"] = o.get("GREEDY_THREE_TOKEN_EXACT")
        out["token3_oracle_t3"] = o.get("TOKEN3_GIVEN_GOLD_PREFIX")
        out["n_three_families"] = o.get("N_CLASSES_GREEDY_THREE_TOKEN")
        out["three_token_families"] = {
            k: v.get("THREE_TOKEN_EXACT") for k, v in (o.get("THREE_TOKEN_BY_CLASS") or {}).items()
        }
        out["three_token_n"] = o.get("N_THREE_TOKEN")
    if mix.is_file():
        o = json.loads(mix.read_text(encoding="utf-8"))
        out["aligned_mix_three_exact"] = o.get("GREEDY_THREE_TOKEN_EXACT")
        out["aligned_mix_three_families"] = {
            k: v.get("THREE_TOKEN_EXACT") for k, v in (o.get("THREE_TOKEN_BY_CLASS") or {}).items()
        }
        out["aligned_mix_n"] = o.get("n")
        out["mix_stopping"] = o.get("GREEDY_STOPPING")
        out["mix_ramble"] = o.get("RAMBLE_RATE")
        out["mix_empty"] = o.get("EMPTY_RESPONSE_RATE")
        out["mix_eos_argmax"] = o.get("EOS_ARGMAX")
    if dist.is_file():
        o = json.loads(dist.read_text(encoding="utf-8"))
        out["frozen"] = o.get("FROZEN_PARAMETER_HASH_MATCH")
        out["global_drift"] = o.get("GLOBAL_WEIGHT_DRIFT")
    if s3.is_file():
        o = json.loads(s3.read_text(encoding="utf-8"))
        out["stage3"] = o.get("historical_pass_count")
        out["collapse"] = o.get("n_collapsed")
        out["drift"] = o.get("STAGE3_DRIFT_VS_STEP400")
    if nll.is_file():
        o = json.loads(nll.read_text(encoding="utf-8"))
        out["general_nl"] = o.get("general")
        out["code"] = o.get("code")
        out["json"] = o.get("json")
    if nl.is_file():
        o = json.loads(nl.read_text(encoding="utf-8"))
        out["independent_nl"] = o.get("natural_language_nll_mean")
    if geo.is_file():
        o = json.loads(geo.read_text(encoding="utf-8"))
        ft = o.get("ft") or {}
        out["greedy_first"] = ft.get("GREEDY_FIRST_TOKEN_MATCH")
        by = ft.get("BY_CLASS") or {}
        out["first_token_classes"] = [k for k, v in by.items() if int(v.get("GREEDY_FIRST_TOKEN_MATCH") or 0) > 0]
        out["newline"] = (o.get("val") or {}).get("NEWLINE_ARGMAX_RATE")
    return out


def grad_summary(run_id: str) -> dict[str, Any]:
    path = Path(CKPT_BASE) / run_id / "metrics.jsonl"
    if not path.is_file():
        return {}
    grads = []
    review = 0
    hard = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        g = float(row.get("raw_grad") or 0)
        grads.append(g)
        gate = str(row.get("GRAD_GATE") or "")
        if gate == "REVIEW" or g >= 6.5:
            review += 1
        if gate == "UNSAFE" or g >= 8.0:
            hard += 1
    if not grads:
        return {}
    return {
        "n": len(grads),
        "max": max(grads),
        "median": statistics.median(grads),
        "review_steps": review,
        "hard_steps": hard,
    }


def meaningful(start: dict[str, Any], end: dict[str, Any]) -> bool:
    if int(end.get("short_phrase_prefix_1") or 0) >= int(start.get("short_phrase_prefix_1") or 0) + 3:
        return True
    if int(end.get("short_phrase_prefix_2") or 0) >= int(start.get("short_phrase_prefix_2") or 0) + 2:
        return True
    if int(end.get("short_phrase_prefix_3") or 0) >= int(start.get("short_phrase_prefix_3") or 0) + 2:
        return True
    if float(end.get("mean_prefix_depth") or 0) >= float(start.get("mean_prefix_depth") or 0) + 0.25:
        return True
    if int(end.get("token3_oracle") or 0) >= int(start.get("token3_oracle") or 0) + 3:
        return True
    if int(end.get("token4_oracle") or 0) >= int(start.get("token4_oracle") or 0) + 3:
        return True
    return False


def safety_breach(snap: dict[str, Any], phrase: dict[str, Any], step: int = 1) -> str | None:
    if snap.get("frozen") not in {None, "YES"}:
        return "FROZEN_HASH_MISMATCH"
    if snap.get("global_drift") not in {None, 0, 0.0} and float(snap.get("global_drift") or 0) > 1e-8:
        return "GLOBAL_DRIFT"
    if snap.get("stage3") is not None and int(snap["stage3"]) < 5:
        return "STAGE3_FLOOR"
    if snap.get("drift") is not None and float(snap["drift"]) > float(STAGE3_PARENT_DRIFT_HARD):
        return "STAGE3_DRIFT"
    if step <= 0:
        return None
    if snap.get("mix_ramble") is not None and float(snap["mix_ramble"]) > 0:
        return "RAMBLE"
    if snap.get("mix_empty") is not None and float(snap["mix_empty"]) > 0:
        return "EMPTY"
    if snap.get("mix_stopping") is not None and snap.get("aligned_mix_n") is not None:
        if int(snap["mix_stopping"]) < int(snap["aligned_mix_n"]):
            return "EOS_FAILURE"
    if snap.get("greedy_two_token_exact") is not None and int(snap["greedy_two_token_exact"]) < 4:
        return "TWO_TOKEN_RETENTION"
    if snap.get("n_two_classes") is not None and int(snap["n_two_classes"]) < 3:
        return "TWO_TOKEN_CLASS_RETENTION"
    if float(phrase.get("ramble_rate") or 0) > 0:
        return "PHRASE_RAMBLE"
    if float(phrase.get("empty_response_rate") or 0) > 0:
        return "PHRASE_EMPTY"
    return None


def classify(start: dict[str, Any], end: dict[str, Any]) -> str:
    if int(end.get("short_phrase_exact") or 0) > 0:
        return "A"
    if meaningful(start, end):
        return "B"
    return "C"


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama
    from wrim_resumable_checkpoint import MODEL_NAME

    dup = one_trainer()
    state: dict[str, Any] = {
        "LEDGER_START": LEDGER_START,
        "DUPLICATE_PRIOR": DUPLICATE_PRIOR,
        "AUTHORIZED_CONSUMED": 0,
        "PHYSICAL_THIS_PROGRAM": 0,
        "CHECKPOINTS": [],
        "GRADIENTS": [],
        "SAFETY_EVENTS": [],
    }
    try:
        if dup:
            state["PROGRAM_STATUS"] = "DUPLICATE_TRAINER"
            state["DUPLICATES"] = dup
            persist(state)
            return state
        if sha256_file(START / MODEL_NAME) != EXPECT_HASH:
            state["PROGRAM_STATUS"] = "PARENT_HASH_MISMATCH"
            persist(state)
            return state
        phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
        nat_rows = load_rows(NAT_DIR / "val.jsonl")
        gen_rows = load_rows(GEN_VAL)
        legacy_rows = load_rows(T3_VAL)
        heldout_sets = {
            "phrase": phrase_rows,
            "original_three": legacy_rows,
            "natural": nat_rows,
            "paraphrase": gen_rows,
        }
        parent = START
        load_opt = True
        run_n = 1
        # First block reaches the 200k review. Later blocks are 12 steps (~49k) if A or B.
        plan = [{"steps": 48, "eval": (12, 24, 36, 48), "pack": "FT-TT-T3-PHRASE-ALIGN", "corpus": MIX_PHRASE_ALIGN, "gate": True}]
        gate = None
        if STATE_PATH.is_file():
            prior = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            last = (prior.get("CHECKPOINTS") or [None])[-1]
            last_path = Path(CKPT_BASE) / str((last or {}).get("checkpoint") or "")
            if (
                prior.get("GATE") in {"A", "B"}
                and not prior.get("PROGRAM_STATUS")
                and last
                and int(prior.get("AUTHORIZED_CONSUMED") or 0) > 0
                and (last_path / MODEL_NAME).is_file()
                and sha256_file(last_path / MODEL_NAME) == last.get("hash")
            ):
                state = prior
                state["RESUME_NOTE"] = "Resumed after an external interrupt. PS-000004 wrote no steps and added no ledger tokens."
                parent = last_path
                load_opt = True
                gate = str(prior.get("GATE"))
                plan = []
                nums = []
                for c in state.get("CHECKPOINTS") or []:
                    rid = str(c.get("checkpoint") or "").split("/")[0]
                    if rid.startswith("WRIM1-UH1-AC2-RA1-PS-"):
                        nums.append(int(rid.rsplit("-", 1)[-1]))
                run_n = (max(nums) + 1) if nums else 1
                print(json.dumps({"resume": True, "parent": str(parent), "run_n": run_n, "consumed": state.get("AUTHORIZED_CONSUMED"), "gate": gate}), flush=True)
        while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= CEILING:
            if gate == "C":
                break
            if not plan:
                if gate not in {"A", "B"}:
                    break
                # Keep the same phrase objective while prefix/exact is still the open question.
                plan.append({"steps": 12, "eval": (12,), "pack": "FT-TT-T3-PHRASE-ALIGN", "corpus": MIX_PHRASE_ALIGN, "gate": False})
            rec = plan.pop(0)
            steps = int(rec["steps"])
            room = (CEILING - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
            steps = min(steps, room)
            if steps < 5:
                break
            others = one_trainer()
            if others:
                state["PROGRAM_STATUS"] = "DUPLICATE_TRAINER"
                state["DUPLICATES"] = others
                break
            run_id = f"WRIM1-UH1-AC2-RA1-PS-{run_n:06d}"
            run_n += 1
            print(json.dumps({"starting": run_id, "steps": steps, "parent": str(parent), "load_optimizer": load_opt}), flush=True)
            obj = train_ra1(
                run_id=run_id,
                corpus_dir=rec["corpus"],
                parent_ckpt=parent,
                pack_name=rec["pack"],
                steps=steps,
                lr=LR,
                placement=PLACEMENT_B,
                bottleneck=32,
                restore_ollama=False,
                reset_adapter=False,
                load_optimizer=load_opt,
                eval_steps=tuple(rec["eval"]),
            )
            if obj.get("ok") is False and obj.get("reason"):
                state["SAFETY_EVENTS"].append(str(obj.get("reason")))
                state["PROGRAM_STATUS"] = str(obj.get("reason"))
                state["LAST_TRAIN"] = {"run_id": run_id, "reason": obj.get("reason"), "preflight": obj.get("PREFLIGHT")}
                break
            used = int(obj.get("TOKENS_USED") or 0)
            state["AUTHORIZED_CONSUMED"] = int(state["AUTHORIZED_CONSUMED"]) + used
            state["PHYSICAL_THIS_PROGRAM"] = int(state["PHYSICAL_THIS_PROGRAM"]) + used
            grads = grad_summary(run_id)
            pre = obj.get("PREFLIGHT") or {}
            grads["preflight_max"] = pre.get("MAX_RA1_GRAD")
            state["GRADIENTS"].append({"run_id": run_id, **grads})
            if obj.get("FROZEN_PARAMETER_HASH_MATCH") not in {None, "YES"}:
                state["SAFETY_EVENTS"].append("FROZEN_HASH_MISMATCH")
                state["PROGRAM_STATUS"] = "FROZEN_HASH_MISMATCH"
                break
            abort = obj.get("abort") or {}
            if abort:
                state["SAFETY_EVENTS"].append(str(abort.get("stop_reason")))
                if str(abort.get("stop_reason")) in {"GRAD_INSTABILITY", "NAN_INF"} or "GRAD" in str(abort.get("stop_reason")) or "NAN" in str(abort.get("stop_reason")):
                    state["PROGRAM_STATUS"] = "SAFETY_STOP"
                    break
            saved = [0] + [s for s in rec["eval"] if s <= steps]
            if steps not in saved:
                saved.append(steps)
            start_phrase = None
            end_phrase = None
            end_snap = None
            for step in saved:
                ckpt = Path(CKPT_BASE) / run_id / f"step-{step}"
                if not (ckpt / "model.safetensors").is_file():
                    continue
                scored = score_sets(ckpt, heldout_sets)
                phrase = scored.get("phrase") or {}
                snap = trainer_snap(run_id, step)
                breach = safety_breach(snap, phrase, step)
                row = {
                    "checkpoint": f"{run_id}/step-{step}",
                    "hash": sha256_file(ckpt / MODEL_NAME),
                    "token_delta": step * TOKENS_PER_STEP,
                    "ledger_tokens": LEDGER_START + int(state["AUTHORIZED_CONSUMED"]) - used + step * TOKENS_PER_STEP,
                    "physical_trainer_tokens": DUPLICATE_PRIOR + int(state["PHYSICAL_THIS_PROGRAM"]) - used + step * TOKENS_PER_STEP,
                    "phrase": phrase,
                    "original_three": scored.get("original_three"),
                    "natural": scored.get("natural"),
                    "paraphrase": scored.get("paraphrase"),
                    "retention": snap,
                    "gradient": grads,
                }
                state["CHECKPOINTS"].append(row)
                if step == 0 and start_phrase is None:
                    start_phrase = phrase
                end_phrase = phrase
                end_snap = snap
                if breach:
                    state["SAFETY_EVENTS"].append(breach)
                    state["PROGRAM_STATUS"] = "SAFETY_STOP"
                    parent = ckpt
                    break
            if state.get("PROGRAM_STATUS") == "SAFETY_STOP":
                break
            if end_snap and (end_snap.get("stage3") or 0) >= 6 and end_phrase is not None:
                parent = Path(CKPT_BASE) / run_id / f"step-{steps}"
                load_opt = True
            if rec["gate"] and start_phrase is not None and end_phrase is not None:
                gate = classify(start_phrase, end_phrase)
                state["GATE"] = gate
                state["GATE_START"] = start_phrase
                state["GATE_END"] = end_phrase
                if gate == "C":
                    state["PROGRAM_STATUS"] = "RA1_B32_PHRASE_PLATEAU_REVIEW_REQUIRED"
                    break
            # After the gate, stop if two reviewed chunks add no phrase exact and no prefix movement.
            if gate in {"A", "B"} and not rec["gate"] and start_phrase is not None and end_phrase is not None:
                gained = int(end_phrase.get("short_phrase_exact") or 0) > int(start_phrase.get("short_phrase_exact") or 0) or meaningful(start_phrase, end_phrase)
                if not gained:
                    state["FLAT_CHUNKS"] = int(state.get("FLAT_CHUNKS") or 0) + 1
                    if int(state["FLAT_CHUNKS"]) >= 2:
                        state["PROGRAM_STATUS"] = "PHRASE_PROGRESS_STALLED"
                        break
                else:
                    state["FLAT_CHUNKS"] = 0
            persist(state)
        if state.get("PROGRAM_STATUS") is None:
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > CEILING:
                state["PROGRAM_STATUS"] = "CEILING_REACHED"
            else:
                state["PROGRAM_STATUS"] = state.get("PROGRAM_STATUS") or "REVIEW_COMPLETE"
        # Held-out generalization and natural on the retained parent.
        final_ckpt = parent if (parent / "model.safetensors").is_file() else START
        state["FINAL_CHECKPOINT"] = str(final_ckpt)
        state["FINAL_HASH"] = sha256_file(final_ckpt / MODEL_NAME)
        already = next((c for c in reversed(state["CHECKPOINTS"]) if c.get("hash") == state["FINAL_HASH"]), None)
        if already:
            state["NATURAL_EVAL"] = already.get("natural") or {}
            state["PARAPHRASE_EVAL"] = already.get("paraphrase") or {}
            state["PHRASE_EVAL_FINAL"] = already.get("phrase") or {}
            state["ORIGINAL_THREE_FINAL"] = already.get("original_three") or {}
        else:
            final_scored = score_sets(final_ckpt, heldout_sets)
            state["NATURAL_EVAL"] = final_scored.get("natural") or {}
            state["PARAPHRASE_EVAL"] = final_scored.get("paraphrase") or {}
            state["PHRASE_EVAL_FINAL"] = final_scored.get("phrase") or {}
            state["ORIGINAL_THREE_FINAL"] = final_scored.get("original_three") or {}
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


def write_report(state: dict[str, Any]) -> dict[str, Any]:
    hist = state.get("CHECKPOINTS") or []
    last = hist[-1] if hist else {}
    phrase = state.get("PHRASE_EVAL_FINAL") or last.get("phrase") or {}
    ret = last.get("retention") or {}
    start_p = state.get("GATE_START") or (hist[0].get("phrase") if hist else {})
    end_p = state.get("GATE_END") or phrase
    gate = state.get("GATE")
    consumed = int(state.get("AUTHORIZED_CONSUMED") or 0)
    exact = int(phrase.get("short_phrase_exact") or 0)
    natural = int((state.get("NATURAL_EVAL") or {}).get("short_phrase_exact") or 0)
    para = int((state.get("PARAPHRASE_EVAL") or {}).get("short_phrase_exact") or 0)
    learning = "UNCLEAR"
    if gate == "C":
        learning = "NO"
    elif gate in {"A", "B"} and (exact > int(start_p.get("short_phrase_exact") or 0) or meaningful(start_p, end_p)):
        learning = "YES"
    grads = state.get("GRADIENTS") or []
    max_g = max((float(g.get("max") or 0) for g in grads), default=0)
    review_n = sum(int(g.get("review_steps") or 0) for g in grads)
    hard_n = sum(int(g.get("hard_steps") or 0) for g in grads)
    grad_label = "STOP" if hard_n else ("REVIEW" if review_n else "SAFE")
    if state.get("PROGRAM_STATUS") == "SAFETY_STOP":
        grad_label = "STOP" if hard_n or any("GRAD" in str(x) or "NAN" in str(x) for x in state.get("SAFETY_EVENTS") or []) else grad_label
    continue_flag = "NO"
    if state.get("PROGRAM_STATUS") == "RA1_B32_PHRASE_PLATEAU_REVIEW_REQUIRED":
        continue_flag = "COMMANDER REVIEW"
    elif gate in {"A", "B"} and consumed < CEILING - 5 * TOKENS_PER_STEP and state.get("PROGRAM_STATUS") not in {"SAFETY_STOP", "PHRASE_PROGRESS_STALLED", "CEILING_REACHED"}:
        continue_flag = "YES"
    elif gate in {"A", "B"}:
        continue_flag = "NO"
    report = {
        "REPORT_ID": "WRIM_RA1_B32_PHRASE_SCHOOL_200K_REVIEW",
        "1_STARTING_CHECKPOINT": "WRIM1-UH1-AC2-RA1-GC-000010/step-46",
        "2_STARTING_HASH": EXPECT_HASH,
        "3_TOKENS_AUTHORIZED": CEILING,
        "4_TOKENS_CONSUMED": consumed,
        "5_PHYSICAL_TRAINER_CONSUMPTION": DUPLICATE_PRIOR + int(state.get("PHYSICAL_THIS_PROGRAM") or 0),
        "5_NOTE": "Physical total includes the prior 4096 duplicate-run tokens. Those tokens are not in the authorized ledger.",
        "LEDGER_START": LEDGER_START,
        "LEDGER_NOW": LEDGER_START + consumed,
        "DUPLICATE_PRIOR_SEPARATE": DUPLICATE_PRIOR,
        "6_CHECKPOINT_HISTORY": [
            {
                "checkpoint": c.get("checkpoint"),
                "hash": c.get("hash"),
                "token_delta": c.get("token_delta"),
                "ledger_tokens": c.get("ledger_tokens"),
                "physical_trainer_tokens": c.get("physical_trainer_tokens"),
                "phrase_exact": (c.get("phrase") or {}).get("short_phrase_exact"),
                "prefix": {
                    "p1": (c.get("phrase") or {}).get("short_phrase_prefix_1"),
                    "p2": (c.get("phrase") or {}).get("short_phrase_prefix_2"),
                    "p3": (c.get("phrase") or {}).get("short_phrase_prefix_3"),
                    "p4": (c.get("phrase") or {}).get("short_phrase_prefix_4+"),
                    "mean": (c.get("phrase") or {}).get("mean_prefix_depth"),
                },
                "families": (c.get("phrase") or {}).get("families"),
                "two_token": (c.get("retention") or {}).get("greedy_two_token_exact"),
                "three_token_align": (c.get("retention") or {}).get("greedy_three_token_exact"),
                "aligned_mix_three": (c.get("retention") or {}).get("aligned_mix_three_exact"),
                "original_three_exact": (c.get("original_three") or {}).get("short_phrase_exact"),
                "natural_exact": (c.get("natural") or {}).get("short_phrase_exact"),
                "paraphrase_exact": (c.get("paraphrase") or {}).get("short_phrase_exact"),
                "stage3": (c.get("retention") or {}).get("stage3"),
                "drift": (c.get("retention") or {}).get("drift"),
                "frozen": (c.get("retention") or {}).get("frozen"),
                "global_drift": (c.get("retention") or {}).get("global_drift"),
            }
            for c in hist
        ],
        "7_GRADIENT_HISTORY": grads,
        "8_FIRST_TOKEN": {"match": ret.get("greedy_first"), "classes": ret.get("first_token_classes")},
        "9_TWO_TOKEN": {"exact": ret.get("greedy_two_token_exact"), "oracle": ret.get("token2_oracle_tt"), "families": ret.get("two_token_families"), "classes": ret.get("n_two_classes")},
        "10_THREE_TOKEN": {"exact": ret.get("greedy_three_token_exact"), "oracle": ret.get("token3_oracle_t3"), "families": ret.get("three_token_families"), "n_families": ret.get("n_three_families")},
        "11_PHRASE_PREFIX_PROGRESSION": {"start": start_p, "end": end_p},
        "12_SHORT_PHRASE_EXACT": exact,
        "12_FAMILIES": phrase.get("families"),
        "13_SHORT_NATURAL_ANSWERS": natural,
        "14_PARAPHRASE_GENERALIZATION": "YES" if para > 0 else "NO",
        "14_PARAPHRASE_EXACT": para,
        "15_EOS_STOPPING": phrase.get("greedy_stopping"),
        "16_RAMBLE": phrase.get("ramble_rate"),
        "16_EMPTY": phrase.get("empty_response_rate"),
        "17_NL_RETENTION": {"independent": ret.get("independent_nl"), "general": ret.get("general_nl")},
        "18_CODE_RETENTION": ret.get("code"),
        "19_JSON_RETENTION": ret.get("json"),
        "20_STAGE3": ret.get("stage3"),
        "21_GLOBAL_DRIFT": ret.get("global_drift"),
        "22_FROZEN_HASH": ret.get("frozen"),
        "23_SAFETY_EVENTS": state.get("SAFETY_EVENTS"),
        "24_LEARNING_CURVE": [
            {
                "checkpoint": c.get("checkpoint"),
                "exact": (c.get("phrase") or {}).get("short_phrase_exact"),
                "mean_prefix": (c.get("phrase") or {}).get("mean_prefix_depth"),
                "p1": (c.get("phrase") or {}).get("short_phrase_prefix_1"),
                "p2": (c.get("phrase") or {}).get("short_phrase_prefix_2"),
                "p3": (c.get("phrase") or {}).get("short_phrase_prefix_3"),
                "p4": (c.get("phrase") or {}).get("short_phrase_prefix_4+"),
                "t4_oracle": (c.get("phrase") or {}).get("token4_oracle"),
            }
            for c in hist
        ],
        "25_GATE": gate,
        "25_CONTINUE_OR_STOP": continue_flag,
        "B32_STILL_LEARNING": learning,
        "SHORT_PHRASE_EMERGED": "YES" if exact > 0 else "NO",
        "SHORT_NATURAL_RESPONSE_EMERGED": "YES" if natural > 0 else "NO",
        "PARAPHRASE_GENERALIZATION": "YES" if para > 0 else "NO",
        "STAGE3_STATUS": "PASS" if int(ret.get("stage3") or 0) >= 5 else "FAIL",
        "FROZEN_HASH_STATUS": "MATCH" if ret.get("frozen") == "YES" else "MISMATCH",
        "GLOBAL_DRIFT_VALUE": ret.get("global_drift"),
        "GRADIENT_SAFETY": grad_label,
        "GRADIENT_MAX": max_g,
        "RAMBLE_RATE": phrase.get("ramble_rate"),
        "EMPTY_RESPONSE_RATE": phrase.get("empty_response_rate"),
        "ADDITIONAL_TOKENS_USED": consumed,
        "ADDITIONAL_TOKENS_REMAINING": CEILING - consumed,
        "CONTINUE_WITHIN_500K_AUTHORIZATION": continue_flag,
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "FINAL_CHECKPOINT": state.get("FINAL_CHECKPOINT"),
        "FINAL_HASH": state.get("FINAL_HASH"),
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "CANONICAL": "STEP_400",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "RA1_BOTTLENECK": 32,
        "RA1_LR": LR,
        "WRIM_TRAINING_AUTHORIZATION": "OFF",
    }
    _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
