"""Phase D: WRIM1-UH1-AC1-ROLE-000001 control-vector-only role-control training.

Body frozen. Train assistant_ctrl only. 10 steps × 4096 tokens.
Does not promote canonical. Unsets training authorization on every exit.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch

from wrim_arch_uh1_phase_a import _module_grads, _sha_file, _split_loss, load_jsonl
from wrim_arch_uh1_ac1_phase_c import CONVERT_ID as AC1_CONVERT_ID
from wrim_g20m_uh1 import (
    ARCH_ID_UH1_AC1,
    UH1_AC1_PARAM_COUNT,
    WRIMUH1Model,
    freeze_body_train_ctrl,
)
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    BETAS,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    EPS,
    EVAL_SEED,
    EVAL_STEPS,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    GRAD_WARN,
    MICRO_BATCH,
    NEWLINE_TOKEN_ID,
    PARENT_STAGE3_DELTA_VS_WRIM0,
    PARENT_STAGE3_DRIFT_VS_STEP400,
    ROLE_MAX_TOKENS,
    ROLE_STEPS,
    SEED,
    SEQ_LEN,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
    WEIGHT_DECAY,
)
from wrim_plm1_gates import hard_hits
from wrim_plm3_encode import encode_example, pack_train_stream, prefix_ids_for_inference, slice_batches


RUN_ID = "WRIM1-UH1-AC1-ROLE-000002"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_UH1_AC1_ROLE_000002_ONLY"
CORPUS_DIR = Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0"
AC1_CKPT = Path(CKPT_BASE) / AC1_CONVERT_ID
CKPT_ROOT = Path(CKPT_BASE) / RUN_ID
REPORT_NAME = "WRIM1_UH1_AC1_ROLE_000002_REPORT.json"
PARENT_MODEL_ID = "WRIM1-ARCH-UH1-AC1-CONVERTED"
KIND = "WRIM1_UH1_AC1_ROLE_000002_REPORT"
PACK_NAME = "C1_easy_unigram"

if os.environ.get("WRIM_ARCH_PHASE") == "E":
    RUN_ID = "WRIM1-UH1-AC1-FT-000001"
    AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_UH1_AC1_FT_000001_ONLY"
    CORPUS_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0"
    AC1_CKPT = Path(CKPT_BASE) / "WRIM1-UH1-AC1-ROLE-000002" / "step-10"
    CKPT_ROOT = Path(CKPT_BASE) / RUN_ID
    REPORT_NAME = "WRIM1_UH1_AC1_FT_000001_REPORT.json"
    PARENT_MODEL_ID = "WRIM1-UH1-AC1-ROLE-000002/step-10"
    KIND = "WRIM1_UH1_AC1_FT_000001_REPORT"
    PACK_NAME = "PLM_FIRST_TOKEN_1_unweighted"
elif os.environ.get("WRIM_ARCH_PHASE") == "E2":
    RUN_ID = "WRIM1-UH1-AC1-ROLE-000003"
    AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_UH1_AC1_ROLE_000003_ONLY"
    CORPUS_DIR = Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0"
    AC1_CKPT = Path(CKPT_BASE) / "WRIM1-UH1-AC1-ROLE-000002" / "step-10"
    CKPT_ROOT = Path(CKPT_BASE) / RUN_ID
    REPORT_NAME = "WRIM1_UH1_AC1_ROLE_000003_REPORT.json"
    PARENT_MODEL_ID = "WRIM1-UH1-AC1-ROLE-000002/step-10"
    KIND = "WRIM1_UH1_AC1_ROLE_000003_REPORT"
    PACK_NAME = "C1_easy_unigram_continue"

# Architecture-specific LR for the 256-param control vector. Not a silent full-model LR change.
# Adam per-step ||Δctrl|| ≈ lr * sqrt(256). lr=1e-2 → ~0.16/step, O(1) in 10 steps —
# the scale needed to move a ~9-nat target-newline gap. Unclipped ctrl grad is 0.63 << 6.5.
AC1_CTRL_LR = 1e-2
AC1_CTRL_WD = 0.0  # L2 toward zero would fight the zero-init control direction


def unset_auth() -> None:
    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    os.environ.pop(AUTHORIZE_ENV_NAME, None)
    os.environ[AUTHORIZE_ENV_NAME] = "OFF"


def _write(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def role_geometry(model, tokenizer, device, rows: list[dict]) -> dict[str, Any]:
    nl_argmax = 0
    nl_probs = []
    tgt_probs = []
    tgt_logits = []
    nl_logits = []
    greedy_first = 0
    cos_nl = []
    cos_cluster = []
    h_norm = []
    W = model.lm_head.weight.detach()
    nl_vec = W[NEWLINE_TOKEN_ID]
    cluster_ids = []
    for rec in rows:
        ids = tokenizer.encode(str(rec["target"]), add_special_tokens=False).ids
        if ids:
            cluster_ids.append(int(ids[0]))
    cluster = W[list(set(cluster_ids))].mean(dim=0) if cluster_ids else nl_vec
    class_hits: dict[str, dict[str, int]] = {}
    with torch.inference_mode():
        for rec in rows:
            pref = prefix_ids_for_inference(tokenizer, rec["prompt"])
            x = torch.tensor([pref], dtype=torch.long, device=device)
            h = model.hidden(x)[0, -1].float()
            lg = torch.nn.functional.linear(h, W.float())
            pr = torch.softmax(lg, dim=-1)
            tid = tokenizer.encode(str(rec["target"]), add_special_tokens=False).ids
            tid0 = int(tid[0]) if tid else NEWLINE_TOKEN_ID
            nl_logits.append(float(lg[NEWLINE_TOKEN_ID].item()))
            tgt_logits.append(float(lg[tid0].item()))
            nl_probs.append(float(pr[NEWLINE_TOKEN_ID].item()))
            tgt_probs.append(float(pr[tid0].item()))
            argmax = int(lg.argmax())
            if argmax == NEWLINE_TOKEN_ID:
                nl_argmax += 1
            if argmax == tid0:
                greedy_first += 1
            hn = torch.nn.functional.normalize(h.unsqueeze(0), dim=-1)
            cos_nl.append(float((hn * torch.nn.functional.normalize(nl_vec.float().unsqueeze(0), dim=-1)).sum().item()))
            cos_cluster.append(float((hn * torch.nn.functional.normalize(cluster.float().unsqueeze(0), dim=-1)).sum().item()))
            h_norm.append(float(h.norm(2).item()))
            cls = str(rec.get("first_token_class") or rec.get("target") or "unk")
            order = torch.argsort(lg, descending=True)
            hit = torch.nonzero(order == tid0, as_tuple=False)
            rank = int(hit[0].item()) + 1 if hit.numel() else None
            top_id = int(order[0].item())
            if top_id == tid0 and order.numel() > 1:
                competitor = int(order[1].item())
            else:
                competitor = top_id
            gap_comp = float((lg[tid0] - lg[competitor]).item())
            bucket = class_hits.setdefault(
                cls, {"n": 0, "nl": 0, "gf": 0, "rank": [], "prob": [], "gap": [], "argmax": []}
            )
            bucket["n"] += 1
            bucket["nl"] += int(argmax == NEWLINE_TOKEN_ID)
            bucket["gf"] += int(argmax == tid0)
            if rank is not None:
                bucket["rank"].append(rank)
            bucket["prob"].append(float(pr[tid0].item()))
            bucket["gap"].append(gap_comp)
            bucket["argmax"].append(tokenizer.id_to_token(argmax) or str(argmax))
    n = max(1, len(rows))
    by_class = {
        k: {
            "n": v["n"],
            "NEWLINE_ARGMAX_RATE": v["nl"] / max(1, v["n"]),
            "GREEDY_FIRST_TOKEN_MATCH": v["gf"],
            "GREEDY_FIRST_TOKEN_MATCH_RATE": v["gf"] / max(1, v["n"]),
            "TARGET_RANK": (sum(v["rank"]) / len(v["rank"])) if v.get("rank") else None,
            "TARGET_PROBABILITY": (sum(v["prob"]) / len(v["prob"])) if v.get("prob") else None,
            "LOGIT_GAP_TO_COMPETITOR": (sum(v["gap"]) / len(v["gap"])) if v.get("gap") else None,
            "ARGMAX_TOKENS": v.get("argmax") or [],
        }
        for k, v in sorted(class_hits.items())
    }
    n_classes_nl_lt_1 = sum(1 for v in by_class.values() if v["NEWLINE_ARGMAX_RATE"] < 1.0)
    n_classes_gf = sum(1 for v in by_class.values() if v["GREEDY_FIRST_TOKEN_MATCH"] > 0)
    return {
        "n": len(rows),
        "NEWLINE_ARGMAX_RATE": nl_argmax / n,
        "NEWLINE_PROBABILITY": float(sum(nl_probs) / n),
        "NEWLINE_LOGIT": float(sum(nl_logits) / n),
        "TARGET_LOGIT": float(sum(tgt_logits) / n),
        "TARGET_NEWLINE_GAP": float(sum(t - n_ for t, n_ in zip(tgt_logits, nl_logits)) / n),
        "TARGET_TOKEN_MASS": float(sum(tgt_probs) / n),
        "GREEDY_FIRST_TOKEN_MATCH": greedy_first,
        "GREEDY_FIRST_TOKEN_MATCH_RATE": greedy_first / n,
        "ASSISTANT_HIDDEN_NORM": float(sum(h_norm) / n),
        "COSINE_TO_NEWLINE": float(sum(cos_nl) / n),
        "COSINE_TO_RESPONSE_CLUSTER": float(sum(cos_cluster) / n),
        "ASSISTANT_STATE_DISTINGUISHABLE": float(sum(cos_cluster) / n) > float(sum(cos_nl) / n),
        "BY_CLASS": by_class,
        "N_CLASSES_NEWLINE_LT_1": n_classes_nl_lt_1,
        "N_CLASSES_GREEDY_FIRST": n_classes_gf,
    }


def pack_c1(tokenizer) -> tuple[np.ndarray, np.ndarray, list]:
    train_rows = load_jsonl(CORPUS_DIR / "train.jsonl")
    encoded = [encode_example(tokenizer, r) for r in train_rows]
    mean_len = max(1, int(np.mean([int(e["tokens"].size) for e in encoded])))
    need = ROLE_STEPS * MICRO_BATCH * SEQ_LEN + 1
    tiled = list(encoded)
    while len(tiled) * mean_len * 60 < need:
        tiled = tiled + tiled
    stream, mask = pack_train_stream(tiled)
    batches = slice_batches(stream, mask)
    return stream, mask, batches


def classify_role_signal(parent: dict, final: dict, val_held: dict) -> str:
    nl_drop = final["NEWLINE_ARGMAX_RATE"] < parent["NEWLINE_ARGMAX_RATE"] - 1e-9
    mass_up = final["TARGET_TOKEN_MASS"] > parent["TARGET_TOKEN_MASS"] + 1e-4
    gap_up = final["TARGET_NEWLINE_GAP"] > parent["TARGET_NEWLINE_GAP"] + 0.05
    held = (
        val_held["NEWLINE_ARGMAX_RATE"] < parent["NEWLINE_ARGMAX_RATE"] - 1e-9
        and val_held["TARGET_TOKEN_MASS"] > parent["TARGET_TOKEN_MASS"] * 0.5
    )
    if nl_drop and mass_up and gap_up and held:
        return "PRESENT"
    if nl_drop or mass_up or gap_up:
        return "WEAK"
    return "ABSENT"


def main() -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from stage3_runtime import write_json
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_plm1_eval import evaluate_prefix_heldout
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
    from wrim_val_nl_independent import eval_candidate

    os.environ[AUTHORIZE_ENV_NAME] = AUTHORIZE_ENV_VALUE
    t0 = datetime.now(timezone.utc).isoformat()
    report_path = Path(DATA_ROOT) / REPORT_NAME
    ollama_stopped = False

    def finish(obj: dict[str, Any]) -> dict[str, Any]:
        obj.setdefault("TRAINING_AUTHORIZATION_FINAL", "OFF")
        obj.setdefault("MODEL_PROMOTED", "NO")
        obj.setdefault("CANONICAL_CHANGED", "NO")
        obj.setdefault("TOKENIZER_CHANGED", "NO")
        obj.setdefault("STAGE3B_STARTED", "NO")
        obj.setdefault("COMMIT", "NO")
        obj.setdefault("PUSH", "NO")
        obj.setdefault("DEPLOY", "NO")
        unset_auth()
        if ollama_stopped:
            start_user_ollama()
        _write(report_path, obj)
        return obj

    dump = resolve_dump_root(None)
    if dump is None:
        return finish({"ok": False, "reason": "dump_root_missing", "TRAINING_AUTHORIZATION": "OFF"})
    env = verify_linux_env()
    vram = ensure_vram_for_training()
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not env.get("ok"):
        return finish({"ok": False, "reason": "env_fail", "env": env, "TRAINING_AUTHORIZATION": "OFF"})

    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        return finish({"ok": False, "reason": "tokenizer_hash_mismatch", "TRAINING_AUTHORIZATION": "OFF"})
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return finish({"ok": False, "reason": "canonical_hash_changed", "TRAINING_AUTHORIZATION": "OFF"})
    parent_hash = sha256_file(Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME)
    if parent_hash != EXPECTED_PARENT_MODEL_HASH:
        return finish({"ok": False, "reason": "parent_hash_mismatch", "TRAINING_AUTHORIZATION": "OFF"})
    ac1_path = AC1_CKPT / MODEL_NAME
    if not ac1_path.is_file():
        return finish({"ok": False, "reason": "ac1_converted_missing", "TRAINING_AUTHORIZATION": "OFF"})
    if CKPT_ROOT.is_dir() and (CKPT_ROOT / "step-10" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden", "TRAINING_AUTHORIZATION": "OFF"})

    stream, mask, batches = pack_c1(tokenizer)
    train_rows = load_jsonl(CORPUS_DIR / "train.jsonl")
    val_rows = load_jsonl(CORPUS_DIR / "val.jsonl")

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    model = WRIMUH1Model(assistant_control=True)
    model.load_state_dict(load_safetensors_file(str(ac1_path)), strict=True)
    model.to(device)
    freeze_body_train_ctrl(model)
    from wrim_arch_uh1_phase_a import probe_pack
    preflight = probe_pack(model, tokenizer, train_rows, device)
    freeze_body_train_ctrl(model)
    if float(preflight.get("CONTROL_VECTOR_GRAD") or 0) < 1e-8:
        return finish({"ok": False, "reason": "ac1_not_connected_to_loss", "preflight": preflight, "TRAINING_AUTHORIZATION": "OFF"})
    if float(preflight["TOTAL_GRAD"]) >= GRAD_HARD:
        return finish({"ok": False, "reason": "ac1_preflight_unsafe", "preflight": preflight, "TRAINING_AUTHORIZATION": "OFF"})
    n_train = sum(int(p.requires_grad) for p in model.parameters())
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != UH1_AC1_PARAM_COUNT:
        return finish({"ok": False, "reason": "param_count", "n": n_params, "TRAINING_AUTHORIZATION": "OFF"})
    optimizer = torch.optim.AdamW(
        [model.assistant_ctrl],
        lr=AC1_CTRL_LR,
        betas=BETAS,
        eps=EPS,
        weight_decay=AC1_CTRL_WD,
        fused=False,
    )

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_root = Path(DATA_ROOT) / INDEPENDENT_NL_PACK
    nl_rows = load_jsonl(nl_root / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    suite_path = locate_suite()
    baseline_path = locate_baseline(Path(DATA_ROOT))
    from stage3a_run import load_baseline, load_suite, evaluate_candidate

    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    CKPT_ROOT.mkdir(parents=True, exist_ok=True)
    evals_dir = CKPT_ROOT / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    identity = {
        "RUN_ID": RUN_ID,
        "PARENT_MODEL_ID": PARENT_MODEL_ID,
        "PARENT_HASH": sha256_file(ac1_path),
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [CORPUS_DIR.name],
        "TRAIN_DATASET_HASHES": {"C1": sha256_file(CORPUS_DIR / "train.jsonl")},
        "VALIDATION_DATASET_IDS": ["C1-val", "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {"C1-val": sha256_file(CORPUS_DIR / "val.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_plm3_encode.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": AC1_CTRL_WD,
            "grad_clip": GRAD_CLIP,
            "lr": AC1_CTRL_LR,
        },
        "ARCHITECTURE_ID": ARCH_ID_UH1_AC1,
        "TRAIN_SCOPE": "CONTROL_VECTOR_ONLY",
        "BODY_FROZEN": True,
        "PACK": PACK_NAME,
        "AC1_CTRL_LR": AC1_CTRL_LR,
        "WHY_LR": "256-param zero-init control vector; Adam Δ ≈ lr*sqrt(256); not a silent full-model LR change",
        "SOURCE_PARENT": "WRIM1-CPT-000005/step-75",
        "SOURCE_PARENT_HASH": parent_hash,
        "AC1_CONVERTED_HASH": sha256_file(ac1_path),
        "CANONICAL_HASH": CANONICAL_HASH,
        "AC1_ENTRY_SITE": "hidden[idx==ASSISTANT]",
        "PREFLIGHT": preflight,
    }
    _write(CKPT_ROOT / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): AC1_CTRL_LR for s in range(0, ROLE_STEPS + 2)}
    metrics = []
    geo_by_step = {}
    stage3_by_step = {}
    found_by_step = {}
    prefix_by_step = {}
    abort = None
    tokens_seen = 0
    t_train0 = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    def persist(step: int, tokens: int) -> None:
        save_resumable_checkpoint(
            run_root=CKPT_ROOT,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={
                "stage": "UH1_AC1_ROLE_CONTROL",
                "pack": PACK_NAME,
                "train_scope": "CONTROL_VECTOR_ONLY",
                "lr": AC1_CTRL_LR,
            },
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=ROLE_STEPS,
            authorized_max_tokens=ROLE_MAX_TOKENS,
        )

    def run_eval(step: int, loss: float | None, tokens: int, grad: float | None) -> dict[str, Any]:
        model.eval()
        geo_val = role_geometry(model, tokenizer, device, val_rows)
        geo_train = role_geometry(model, tokenizer, device, train_rows)
        prefix = evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=val_rows)
        found = evaluate_foundation(model=model, tokenizer=tokenizer, device=device)
        nlls = family_nll(model=model, device=device, packs=val_packs)
        nl = eval_candidate(name=f"{RUN_ID}-step-{step}", model=model, tokenizer=tokenizer, device=device, rows=nl_rows)
        s3_obs = None
        ev = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump,
            suite_items=suite["obj"]["items"],
            frozen_items=baseline["obj"]["items"],
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=np.array(val_packs.get("genesis") or [1, 2, 3], dtype=np.int32),
            c1=np.array(val_packs.get("general") or [1, 2, 3], dtype=np.int32),
            greedy_256=False,
            step=step,
            train_loss=loss,
            tokens=tokens,
            lr=AC1_CTRL_LR,
        )
        freeze_body_train_ctrl(model)
        delta = ev.get("mean_wrim0_anchor_nll_delta")
        drift = None if delta is None else float(delta) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
        s3_obs = {
            "step": step,
            "mean_wrim0_anchor_nll_delta": delta,
            "historical_pass_count": ev.get("historical_pass_count"),
            "n_collapsed": ev.get("n_collapsed"),
            "STAGE3_DRIFT_VS_STEP400": drift,
            "STAGE3_NLL_REVIEW": bool(delta is not None and float(delta) >= STAGE3_REVIEW_DELTA),
        }
        slim_prefix = {k: v for k, v in prefix.items() if k != "items"}
        slim_found = {k: v for k, v in found.items() if k != "items"}
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": geo_val, "train": geo_train})
        _write(evals_dir / f"prefix-step-{step}.json", slim_prefix)
        _write(evals_dir / f"foundation-step-{step}.json", slim_found)
        _write(evals_dir / f"val-nll-step-{step}.json", nlls)
        _write(evals_dir / f"independent-nl-step-{step}.json", {k: v for k, v in nl.items() if k != "generations"})
        _write(evals_dir / f"stage3-step-{step}.json", s3_obs)
        geo_by_step[str(step)] = {"val": geo_val, "train": geo_train}
        prefix_by_step[str(step)] = slim_prefix
        found_by_step[str(step)] = slim_found
        stage3_by_step[str(step)] = s3_obs
        bundle = {
            "stage3_historical": s3_obs.get("historical_pass_count"),
            "stage3_collapse": s3_obs.get("n_collapsed"),
            "stage3_delta_nll": s3_obs.get("mean_wrim0_anchor_nll_delta"),
            "grad_norm": grad,
            "nan": False,
        }
        return {"hard_gate_hits": hard_hits(bundle), "geo_val": geo_val, "prefix": slim_prefix, "stage3": s3_obs, "foundation": slim_found, "nl": nl, "nlls": nlls}

    ev0 = run_eval(0, None, 0, None)
    persist(0, 0)
    parent_geo = ev0["geo_val"]
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}

    if abort is None:
        for step in range(1, ROLE_STEPS + 1):
            if tokens_seen + TOKENS_PER_STEP > ROLE_MAX_TOKENS:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = AC1_CTRL_LR
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _module_grads(model)
            raw = grads["TOTAL_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step, "grads": grads}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_([model.assistant_ctrl], GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {
                "step": step,
                "loss": float(loss.item()),
                "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                "EOS_CE": split["EOS_CE"],
                "raw_grad": raw,
                "clipped_grad": clipped,
                "CONTROL_VECTOR_GRAD": grads["CONTROL_VECTOR_GRAD"],
                "ctrl_l2": float(model.assistant_ctrl.detach().float().norm(2).item()),
                "tokens_seen": tokens_seen,
                "lr": AC1_CTRL_LR,
                "grad_gate": "WARN" if raw >= GRAD_WARN else ("REVIEW" if raw >= GRAD_REVIEW else "SAFE"),
            }
            metrics.append(row)
            with (CKPT_ROOT / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in EVAL_STEPS:
                persist(step, tokens_seen)
                ev = run_eval(step, row["loss"], tokens_seen, raw)
                if ev.get("hard_gate_hits"):
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev["hard_gate_hits"]), "step": step}
                    break

    train_s = time.perf_counter() - t_train0
    peak_vram = int(torch.cuda.max_memory_allocated()) if torch.cuda.is_available() else None
    final_step = max([int(k) for k in geo_by_step], default=0)
    final_geo = geo_by_step.get(str(final_step), {}).get("val") or parent_geo
    signal = classify_role_signal(parent_geo, final_geo, final_geo)
    s0 = stage3_by_step.get("0") or {}
    sN = stage3_by_step.get(str(final_step)) or {}
    p0 = prefix_by_step.get("0") or {}
    pN = prefix_by_step.get(str(final_step)) or {}
    complete = abort is None and final_step >= ROLE_STEPS
    best_hash = None
    if (CKPT_ROOT / f"step-{final_step}" / MODEL_NAME).is_file():
        best_hash = _sha_file(CKPT_ROOT / f"step-{final_step}" / MODEL_NAME)
    phase = os.environ.get("WRIM_ARCH_PHASE") or "D"
    e_ok = (
        int(final_geo.get("GREEDY_FIRST_TOKEN_MATCH") or 0) > 0
        and float(final_geo.get("NEWLINE_ARGMAX_RATE") or 1) < 1.0
        and int(final_geo.get("N_CLASSES_GREEDY_FIRST") or 0) >= 1
        and int(final_geo.get("N_CLASSES_NEWLINE_LT_1") or 0) >= 2
    )
    if phase in {"E", "E2"}:
        proceed = "PHASE_F" if complete and e_ok else "STOP_FIRST_TOKEN_NO_ENTRY"
    else:
        proceed = "PHASE_E" if complete and signal in {"PRESENT", "WEAK"} else "STOP_NO_ROLE_SIGNAL"

    report = {
        "ok": complete,
        "kind": KIND,
        "RUN_ID": RUN_ID,
        "ARCHITECTURE_ID": ARCH_ID_UH1_AC1,
        "TRAIN_SCOPE": "CONTROL_VECTOR_ONLY",
        "PACK": PACK_NAME,
        "STEPS": ROLE_STEPS if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "AC1_CTRL_LR": AC1_CTRL_LR,
        "ROLE_CONTROL_STATE_SIGNAL": signal,
        "PARENT_ROLE_GEOMETRY": parent_geo,
        "FINAL_ROLE_GEOMETRY": final_geo,
        "GEO_BY_STEP": geo_by_step,
        "PREFIX_PARENT": p0,
        "PREFIX_FINAL": pN,
        "STAGE3_BY_STEP": stage3_by_step,
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed")},
        "STAGE3_DRIFT_VS_STEP400": sN.get("STAGE3_DRIFT_VS_STEP400"),
        "FOUNDATION_BY_STEP": {k: {kk: vv for kk, vv in v.items() if kk != "items"} for k, v in found_by_step.items()},
        "METRICS": metrics,
        "PARAMETER_COUNT": n_params,
        "TRAINABLE_TENSORS": n_train,
        "PEAK_VRAM_BYTES": peak_vram,
        "WALL_SECONDS": train_s,
        "TOKENS_PER_SECOND": (tokens_seen / train_s) if train_s > 0 and tokens_seen else None,
        "BEST_EXPERIMENTAL_CHECKPOINT": f"{RUN_ID}/step-{final_step}",
        "BEST_EXPERIMENTAL_HASH": best_hash,
        "abort": abort,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
        "PROCEED": proceed,
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
        report["PROCEED"] = "STOP_SAFETY"
    return finish(report)


if __name__ == "__main__":
    obj = main()
    keys = (
        "ok", "ROLE_CONTROL_STATE_SIGNAL", "PROCEED", "TOKENS_USED", "STEPS",
        "PARENT_ROLE_GEOMETRY", "FINAL_ROLE_GEOMETRY", "STAGE3_HISTORICAL",
        "STAGE3_COLLAPSE", "STAGE3_DRIFT_VS_STEP400", "BEST_EXPERIMENTAL_CHECKPOINT",
        "BEST_EXPERIMENTAL_HASH", "abort",
    )
    print(json.dumps({k: obj.get(k) for k in keys}, indent=2))
