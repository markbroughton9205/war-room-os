"""School 09 NE1 instruction-following on WRIM-INSTRUCTION-TRAIN-v1.1.0.

Trains only the preauthorized NE1 B32 adapter from NE1-000001/step-40.
Does not train on locked Foundation eval or graduation. Canonical remains STEP_400.
"""
from __future__ import annotations

import hashlib
import json
import random
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_env import verify_linux_env
from run000007_preflight import resolve_dump_root, sha256_file
from run000007_vram import ensure_vram_for_training, start_user_ollama
from wrim_arch_uh1_ac1_train import AC1_CTRL_WD, _write, unset_auth
from wrim_arch_uh1_phase_a import _split_loss
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NE1,
    PLACEMENT_B,
    WRIMRA1Model,
    freeze_base_train_ra1,
    frozen_parameter_hash,
    global_weight_l2,
    module_parameter_hash,
)
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    BETAS,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    EPS,
    GRAD_CLIP,
    GRAD_HARD,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_instruction_train_v1 import CORPUS_ID, ROOT as CORPUS_ROOT, encode_instruction
from wrim_ne1_mod03 import EXPECTED_NE1, _ne1_grads, eval_routes, sample_compute
from wrim_plm1_encode import pack_train_stream, prefix_ids_for_inference, slice_batches
from wrim_promptbook.engine import Engine, ReturnBoundary
from wrim_promptbook.identity import EA1_HASH, FROZEN_BASE_HASH, PHRASE_REF, RA1_HASH
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_school08_multiturn import _body
from wrim_school09_instruction import eval_locked_instruction
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_S09_NE1_INSTRUCTION_V1"
BUDGET = 409_600
S09_LR = 2e-4
SEED = 9009
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-NE1-000001" / "step-40"
EA1_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
RUN_ID = "WRIM1-UH1-AC2-NE1-000002"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL09_NE1_INSTRUCTION_REPORT.json"
STATE = Path(DATA_ROOT) / "WRIM_S09_NE1_INSTRUCTION_STATE.json"
SUCCESS_FAMS = ("brief", "list", "json", "code", "classify", "extract", "transform", "compare", "pos", "neg", "combo")


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(obj, default=str)))


def greedy_instruction(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any], entry: str = "ne1", span: str = "bypass") -> dict[str, Any]:
    model.set_entry_route(entry)
    model.set_span_route(span)
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    enc = encode_instruction(tok, rec)
    tgt = [int(x) for x in enc["target_ids"]]
    gen = greedy_from_ids(model, tok, device, prefix, max_new=max(16, len(tgt) + 2))
    body = _body(gen)
    prefix_depth = 0
    for a, b in zip(body, tgt):
        if a != b:
            break
        prefix_depth += 1
    token1 = int(bool(body) and bool(tgt) and body[0] == tgt[0])
    return {
        "exact": int(body == tgt and bool(gen.get("eos"))),
        "text": tok.decode(body, skip_special_tokens=True) if body else "",
        "family": rec.get("family"),
        "id": rec.get("example_id"),
        "token1": token1,
        "prefix_depth": prefix_depth,
        "eos": int(bool(gen.get("eos"))),
        "empty": int(not body),
        "ramble": int(len(body) > len(tgt) + 2 and not gen.get("eos")),
        "n_gen": len(body),
        "n_tgt": len(tgt),
    }


def score_split(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rows: list[dict[str, Any]], *, cap: int | None = None, entry: str = "ne1", span: str = "bypass") -> dict[str, Any]:
    use = rows if cap is None else rows[:cap]
    exact = token1 = empty = ramble = eos = prefix_sum = 0
    skip = 0
    by: dict[str, dict[str, int]] = defaultdict(lambda: {"n": 0, "exact": 0})
    for rec in use:
        fam = str(rec.get("family") or "unk")
        by[fam]["n"] += 1
        try:
            hit = greedy_instruction(model, tok, device, rec, entry=entry, span=span)
        except Exception:
            skip += 1
            continue
        exact += int(hit["exact"])
        token1 += int(hit["token1"])
        empty += int(hit["empty"])
        ramble += int(hit["ramble"])
        eos += int(hit["eos"])
        prefix_sum += int(hit["prefix_depth"])
        by[fam]["exact"] += int(hit["exact"])
    n = max(1, len(use) - skip)
    fams = {k: v["exact"] for k, v in by.items() if v["exact"] > 0}
    return {
        "n": len(use),
        "skip": skip,
        "exact": exact,
        "rate": round(exact / n, 4),
        "token1": token1,
        "prefix_depth_mean": round(prefix_sum / n, 4),
        "eos": eos,
        "empty": empty,
        "ramble": ramble,
        "families_hit": sorted(fams),
        "n_families_hit": len(fams),
        "by_family": {k: dict(v) for k, v in sorted(by.items())},
        "neg_exact": int((by.get("neg") or {}).get("exact") or 0),
    }


def pack_instruction(tokenizer: Tokenizer, train_rows: list[dict[str, Any]], steps: int) -> tuple[np.ndarray, np.ndarray, list, int, int]:
    encoded = []
    failed = 0
    for rec in train_rows:
        try:
            encoded.append(encode_instruction(tokenizer, rec))
        except Exception:
            failed += 1
    if len(encoded) < 200:
        raise RuntimeError(f"too_few_encoded train={len(encoded)} failed={failed}")
    stream, mask = pack_train_stream(encoded, steps=steps)
    batches = slice_batches(stream, mask, steps=steps)
    return stream, mask, batches, failed, len(encoded)


def train_s09() -> dict[str, Any]:
    os_env = __import__("os")
    os_env.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{RUN_ID.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / RUN_ID
    report_path = Path(DATA_ROOT) / f"{RUN_ID}_REPORT.json"
    ollama_stopped = False
    max_tokens = BUDGET
    use_steps = BUDGET // TOKENS_PER_STEP

    def finish(obj: dict[str, Any]) -> dict[str, Any]:
        obj.setdefault("TRAINING_AUTHORIZATION_FINAL", "OFF")
        obj.setdefault("MODEL_PROMOTED", "NO")
        obj.setdefault("CANONICAL_CHANGED", "NO")
        obj.setdefault("TOKENIZER_CHANGED", "NO")
        obj.setdefault("FULL_BODY_UNFROZEN", "NO")
        obj.setdefault("STAGE3B_STARTED", "NO")
        obj.setdefault("COMMIT", "NO")
        obj.setdefault("PUSH", "NO")
        obj.setdefault("DEPLOY", "NO")
        obj.setdefault("RMR1_INSTALLED", "NO")
        obj.setdefault("NA1_RETRAIN", "NO")
        unset_auth()
        if ollama_stopped:
            start_user_ollama()
        _write(report_path, json.loads(json.dumps(obj, default=str)))
        return obj

    build = json.loads((Path(DATA_ROOT) / "WRIM_INSTRUCTION_TRAIN_V1_BUILD_REPORT.json").read_text(encoding="utf-8"))
    if str(build.get("SCHOOL_09_READY") or "") != "YES" or str(build.get("DATA_LEAKAGE_AUDIT") or "") != "PASS":
        return finish({"ok": False, "reason": "corpus_not_ready", "BUILD": {k: build.get(k) for k in ("CORPUS_ID", "SCHOOL_09_READY", "DATA_LEAKAGE_AUDIT")}})
    dump = resolve_dump_root(None)
    if dump is None:
        return finish({"ok": False, "reason": "dump_root_missing"})
    env = verify_linux_env()
    vram = ensure_vram_for_training(required_free_mib=10000.0)
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not env.get("ok"):
        return finish({"ok": False, "reason": "env_fail", "env": env})
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return finish({"ok": False, "reason": "tokenizer_hash_mismatch"})
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return finish({"ok": False, "reason": "canonical_hash_changed"})
    from wrim_promptbook.identity import PARENT_HASH as EA1_PARENT_HASH
    if sha256_file(EA1_PARENT / MODEL_NAME) != EA1_PARENT_HASH:
        return finish({"ok": False, "reason": "ea1_parent_hash_mismatch"})
    if not (PARENT / MODEL_NAME).is_file():
        return finish({"ok": False, "reason": "ne1_parent_missing"})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{use_steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden"})

    train_rows = load_rows(CORPUS_ROOT / "train.jsonl")
    val_rows = load_rows(CORPUS_ROOT / "validation.jsonl")
    fam_rows = load_rows(CORPUS_ROOT / "family_holdout.jsonl")
    tmpl_rows = load_rows(CORPUS_ROOT / "template_holdout.jsonl")
    stream, mask, batches, enc_fail, enc_n = pack_instruction(tokenizer, train_rows, use_steps)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
        torch.cuda.reset_peak_memory_stats()

    src_state = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, ne1=True, rmr1=False)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    allowed_missing = {n for n, _ in model.named_parameters() if n.startswith(("na1.", "rmr1."))} | {"assistant_stop_ctrl"}
    extra_missing = set(missing) - allowed_missing
    if extra_missing or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected)})
    if any(k.startswith("ne1.") for k in missing):
        return finish({"ok": False, "reason": "ne1_parent_missing_weights"})
    model.to(device)
    mask_info = freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
    if int(mask_info["TRAINABLE_PARAMETER_COUNT"]) != EXPECTED_NE1:
        return finish({"ok": False, "reason": "trainable_count_mismatch", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})
    if any(not n.startswith("ne1.") for n in mask_info["TRAINABLE_NAMES"]):
        return finish({"ok": False, "reason": "non_ne1_trainable", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})
    frozen_hash0 = frozen_parameter_hash(model)
    ea1_hash0 = module_parameter_hash(model, "ea1.")
    ra1_hash0 = module_parameter_hash(model, "ra1.")
    if frozen_hash0 != FROZEN_BASE_HASH or ea1_hash0 != EA1_HASH or ra1_hash0 != RA1_HASH:
        return finish({"ok": False, "reason": "parent_module_hash_mismatch", "OPTIMIZER_CONSTRUCTED": "NO"})
    frozen_parent = {k: v.detach().cpu().clone() for k, v in model.state_dict().items() if not k.startswith(("ea1.", "ra1.", "na1.", "ne1.", "rmr1."))}

    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")

    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    probe = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
        model.set_entry_route("ne1")
        model.set_span_route("bypass")
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=2.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _ne1_grads(model)
        probe.append({"batch": bi, **grads, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"]})
        if (not np.isfinite(grads["NE1_TOTAL_GRAD"])) or grads["NE1_TOTAL_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
    max_g = max((float(r.get("NE1_TOTAL_GRAD") or 0) for r in probe), default=0.0)
    preflight = {"N_BATCHES": len(probe), "MAX_NE1_GRAD": max_g, "UNSAFE": unsafe, "NE1_LR": S09_LR, "ENCODED": enc_n, "ENCODE_FAIL": enc_fail, **mask_info}
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0})

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=S09_LR, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lr_table = {str(s): S09_LR for s in range(0, use_steps + 2)}
    identity = {
        "RUN_ID": RUN_ID,
        "PARENT_MODEL_ID": str(PARENT),
        "PARENT_HASH": sha256_file(PARENT / MODEL_NAME),
        "ARCHITECTURE_ID": model.architecture_id,
        "NE1_BOTTLENECK": 32,
        "NE1_LR": S09_LR,
        "TRAIN_NE1": True,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "FROZEN_MODULES": ["base", "tok_emb", "lm_head", "EA1", "RA1", "NA1", "RMR1", "norms", "attention", "ffn"],
        "ROUTING_POLICY": "ORACLE_NATURAL_NE1_THEN_BYPASS",
        "TOKENIZER_HASH": sha256_file(tok_path),
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [CORPUS_ID],
        "TRAIN_DATASET_HASHES": {CORPUS_ID: str(build.get("CORPUS_HASH")), "train": sha256_file(CORPUS_ROOT / "train.jsonl")},
        "VALIDATION_DATASET_IDS": [CORPUS_ID + "-validation"],
        "VALIDATION_DATASET_HASHES": {CORPUS_ID + "-validation": sha256_file(CORPUS_ROOT / "validation.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_instruction_train_v1.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": AC1_CTRL_WD, "grad_clip": GRAD_CLIP, "lr": S09_LR},
        "FROZEN_PARAMETER_HASH": frozen_hash0,
        "EA1_HASH": ea1_hash0,
        "RA1_HASH": ra1_hash0,
        "STREAM_SHA": stream_sha,
    }

    def hashes_now() -> dict[str, Any]:
        return {
            "FROZEN_PARAMETER_HASH": frozen_parameter_hash(model),
            "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_parameter_hash(model) == frozen_hash0 else "NO",
            "EA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ea1.") == ea1_hash0 else "NO",
            "RA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ra1.") == ra1_hash0 else "NO",
            "NE1_HASH": module_parameter_hash(model, "ne1."),
            "GLOBAL_WEIGHT_DRIFT": global_weight_l2(model, frozen_parent),
        }

    def persist(step: int, tokens: int) -> float:
        t_ck = time.perf_counter()
        if (ckpt_root / f"step-{step}" / "resume-manifest.json").is_file():
            return 0.0
        dist = hashes_now()
        save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={"pack": CORPUS_ID, "ne1_lr": S09_LR, "train_ne1": True, "oracle": "NE1_THEN_BYPASS"},
            identity={**identity, **dist},
            lr_table=lr_table,
            authorized_max_step=use_steps,
            authorized_max_tokens=BUDGET,
        )
        return time.perf_counter() - t_ck

    scored: list[dict[str, Any]] = []
    metrics: list[dict[str, Any]] = []
    tokens_seen = 0
    abort = None
    t_train0 = time.perf_counter()
    stop_early = False

    def run_eval(step: int, *, full: bool) -> dict[str, Any]:
        t_ev = time.perf_counter()
        model.eval()
        val = score_split(model, tokenizer, device, val_rows)
        fam = score_split(model, tokenizer, device, fam_rows, cap=120)
        tmpl = score_split(model, tokenizer, device, tmpl_rows, cap=120)
        fam_full = score_split(model, tokenizer, device, fam_rows) if full else None
        tmpl_full = score_split(model, tokenizer, device, tmpl_rows) if full else None
        geo = eval_routes(model, tokenizer, device, official, extra, phrase_rows)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
        dist = hashes_now()
        isolation = dist["FROZEN_PARAMETER_HASH_MATCH"] != "YES" or dist["EA1_HASH_MATCH"] != "YES" or dist["RA1_HASH_MATCH"] != "YES" or dist["GLOBAL_WEIGHT_DRIFT"] > 1e-8
        val_fams = set(val["families_hit"])
        row = {
            "step": step,
            "tokens": step * TOKENS_PER_STEP,
            "val": val,
            "family_holdout": fam,
            "template_holdout": tmpl,
            "family_holdout_full": fam_full,
            "template_holdout_full": tmpl_full,
            "phrase_exact": geo["phrase_exact"],
            "structured_identity": geo["structured_identity"],
            "extra_greedy": geo["extra_greedy"],
            "extra_token1": geo["extra_token1"],
            "official_greedy": geo["official_greedy"],
            "official_token1": geo["official_token1"],
            "hashes": dist,
            "isolation_fail": isolation,
            "checkpoint": f"{RUN_ID}/step-{step}",
            "n_success_families": len(val_fams & set(SUCCESS_FAMS)),
            "eval_s": time.perf_counter() - t_ev,
        }
        scored.append(row)
        return row

    persist(0, 0)
    ev0 = run_eval(0, full=False)
    if ev0["isolation_fail"]:
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": 0}

    eval_at = {10, 20, 40, 60, 80, 100}

    def gates(row: dict[str, Any]) -> dict[str, bool]:
        return {
            "val_up": int(row["val"]["exact"]) > int(ev0["val"]["exact"]),
            "family_up": int(row["family_holdout"]["exact"]) > int(ev0["family_holdout"]["exact"]),
            "template_up": int(row["template_holdout"]["exact"]) > int(ev0["template_holdout"]["exact"]),
            "multi_family": int(row["n_success_families"]) >= 6,
            "neg": int(row["val"]["neg_exact"]) + int(row["family_holdout"]["neg_exact"]) + int(row["template_holdout"]["neg_exact"]) >= 1,
            "phrase": bool(row["structured_identity"]) and int(row["phrase_exact"]) == PHRASE_REF["phrase"],
            "hashes": not bool(row["isolation_fail"]),
        }

    if abort is None:
        for step in range(1, use_steps + 1):
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.zero_grad(set_to_none=True)
            freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
            model.set_entry_route("ne1")
            model.set_span_route("bypass")
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=2.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _ne1_grads(model)
            raw = grads["NE1_TOTAL_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            rowm = {"step": step, "loss": float(loss.item()), "raw_grad": raw, "clipped_grad": clipped, "tokens_seen": tokens_seen, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"], **grads}
            metrics.append(rowm)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rowm) + "\n")
            if step in eval_at or step == use_steps:
                persist(step, tokens_seen)
                ev = run_eval(step, full=False)
                if ev["isolation_fail"]:
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": step}
                    break
                g = gates(ev)
                if step >= 40 and all(g.values()):
                    stop_early = True
                    break
    if tokens_seen > 0:
        persist(int(tokens_seen // TOKENS_PER_STEP), tokens_seen)

    legal = [r for r in scored if r.get("structured_identity") and not r.get("isolation_fail") and int(r.get("step") or 0) > 0]
    best = None
    if legal:
        best = max(
            legal,
            key=lambda r: (
                int(r["val"]["exact"]),
                int(r["template_holdout"]["exact"]),
                int(r["family_holdout"]["exact"]),
                int(r["n_success_families"]),
                -int(r["step"]),
            ),
        )
    ok_gates = gates(best) if best else {k: False for k in ("val_up", "family_up", "template_up", "multi_family", "neg", "phrase", "hashes")}
    success = bool(best) and all(ok_gates.values()) and abort is None

    locked = None
    if best is not None:
        best_dir = ckpt_root / f"step-{int(best['step'])}"
        cur_step = int(tokens_seen // TOKENS_PER_STEP) if tokens_seen else 0
        if int(best["step"]) != cur_step and (best_dir / MODEL_NAME).is_file():
            src_best = load_safetensors_file(str(best_dir / MODEL_NAME))
            model.load_state_dict(src_best, strict=False)
            model.to(device)
        model.eval()
        best["family_holdout_full"] = score_split(model, tokenizer, device, fam_rows)
        best["template_holdout_full"] = score_split(model, tokenizer, device, tmpl_rows)
        locked = eval_locked_instruction(model, tokenizer, device)

    compute = sample_compute(t0=t_train0, tokens=tokens_seen)
    report = {
        "ok": success,
        "kind": "WRIM_GENESIS_SCHOOL09_NE1_INSTRUCTION",
        "RUN_ID": RUN_ID,
        "ARCHITECTURE_ID": ARCH_ID_EA1_RA1_NE1,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": build.get("CORPUS_HASH"),
        "PARENT": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "TOKENS_USED": tokens_seen,
        "OPTIMIZER_STEPS": int(tokens_seen // TOKENS_PER_STEP),
        "OPTIMIZER_CONSTRUCTED": "YES",
        "BUDGET": BUDGET,
        "STOP_EARLY": stop_early,
        "PREFLIGHT": {k: preflight[k] for k in preflight if k != "TRAINABLE_NAMES"},
        "STEP0": ev0,
        "EVALS": scored,
        "BEST": best,
        "GATES": ok_gates,
        "LOCKED_FOUNDATION_EVAL": None if locked is None else {k: locked[k] for k in locked if k != "ROWS"},
        "LOCKED_EVAL_ROWS": None if locked is None else locked.get("ROWS"),
        "hashes_ok": bool(best) and not bool((best or {}).get("isolation_fail")),
        "best_checkpoint": None if best is None else best.get("checkpoint"),
        "NE1_EXPERIMENTAL_PARENT_PRESERVED": "WRIM1-UH1-AC2-NE1-000001/step-40 extra greedy 2 token1 3 phrase 17",
        "RMR1_TWO_TOKEN_REGRESSION_OPEN": True,
        "TRAINED_ON_EVAL": False,
        "TRAINED_ON_GRADUATION": False,
        "COMPUTE": compute,
        "METRICS_TAIL": metrics[-5:],
        "WALL_SECONDS": time.perf_counter() - t_train0,
        "abort": abort,
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def main() -> dict[str, Any]:
    eng = Engine()
    st = eng.load_state()
    if st.get("CURRENT_SCHOOL") != "SCHOOL_09_INSTRUCTION_FOLLOWING":
        raise SystemExit("not_school_09")
    if st.get("TRAINING_AUTHORIZATION") != "ON":
        raise SystemExit("training_authorization_off")
    build = json.loads((Path(DATA_ROOT) / "WRIM_INSTRUCTION_TRAIN_V1_BUILD_REPORT.json").read_text(encoding="utf-8"))
    if str(build.get("SCHOOL_09_READY") or "") != "YES":
        raise ReturnBoundary("DATA_BOUNDARY_REQUIRES_NEW_CORPUS_SOURCE", "instruction corpus audit not ready")
    eng.resolve_data_boundary(school="SCHOOL_09_INSTRUCTION_FOLLOWING", corpus_id=str(build.get("CORPUS_ID")), corpus_hash=str(build.get("CORPUS_HASH")))
    eng.record_strategy("SCHOOL_09_INSTRUCTION_FOLLOWING", "NE1_INSTRUCTION_TRAIN_V1")
    lock = acquire_trainer_lock(
        run_id=RUN_ID,
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    try:
        train_obj = train_s09()
        used = int(train_obj.get("TOKENS_USED") or 0)
        if used:
            eng.consume_tokens(school="SCHOOL_09_INSTRUCTION_FOLLOWING", experiment_id="EXP-SCHOOL09-NE1-INSTRUCTION-V1", tokens=used)
        rec = None
        if train_obj.get("OPTIMIZER_CONSTRUCTED") == "YES" or used:
            rec = eng.complete_school(
                school="SCHOOL_09_INSTRUCTION_FOLLOWING",
                success=bool(train_obj.get("ok")),
                evidence={
                    "gates": train_obj.get("GATES"),
                    "best": None if not train_obj.get("BEST") else {
                        "checkpoint": train_obj["BEST"].get("checkpoint"),
                        "val_exact": train_obj["BEST"]["val"]["exact"],
                        "family_exact": train_obj["BEST"]["family_holdout"]["exact"],
                        "template_exact": train_obj["BEST"]["template_holdout"]["exact"],
                        "n_success_families": train_obj["BEST"].get("n_success_families"),
                    },
                    "locked_oracle_exact": (train_obj.get("LOCKED_FOUNDATION_EVAL") or {}).get("ORACLE_EXACT"),
                    "tokens_used": used,
                    "report": str(REPORT),
                },
                experiment_id="EXP-SCHOOL09-NE1-INSTRUCTION-V1",
            )
        out = {**train_obj, "PROMPTBOOK": rec}
        persist_state({"TRAIN": {k: out[k] for k in out if k not in {"METRICS_TAIL", "EVALS", "LOCKED_EVAL_ROWS"}}, "PROMPTBOOK": rec})
        _write(REPORT, json.loads(json.dumps(out, default=str)))
        return out
    finally:
        release_trainer_lock(RUN_ID)
        start_user_ollama()


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": out.get("ok"),
        "tokens_used": out.get("TOKENS_USED"),
        "optimizer_steps": out.get("OPTIMIZER_STEPS"),
        "best": None if not out.get("BEST") else {
            "checkpoint": out["BEST"].get("checkpoint"),
            "val": out["BEST"]["val"]["exact"],
            "family": out["BEST"]["family_holdout"]["exact"],
            "template": out["BEST"]["template_holdout"]["exact"],
            "families": out["BEST"].get("n_success_families"),
        },
        "gates": out.get("GATES"),
        "locked_oracle_exact": (out.get("LOCKED_FOUNDATION_EVAL") or {}).get("ORACLE_EXACT"),
        "promptbook": out.get("PROMPTBOOK"),
        "abort": out.get("abort"),
        "report": str(REPORT),
    }, indent=2, default=str))
