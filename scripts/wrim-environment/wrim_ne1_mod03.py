"""School 05 NE1 B32 natural-entry capacity proof.

Oracle NATURAL: NE1 at token1, BYPASS token2+. Structured EA1+RA1 frozen.
Does not train EA1/RA1/base/RMR1/NA1. Does not promote. Canonical remains STEP_400.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import subprocess
import time
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
from wrim_arch_uh1_ac2_train import pack_rows
from wrim_arch_uh1_phase_a import _split_loss
from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
from wrim_ea1_program import write_corpus
from wrim_entry_bypass_review import summarize_probes, token1_probe
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NE1,
    NE1_PREFIX,
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
    SEED,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import EA1_HASH, FROZEN_BASE_HASH, PARENT_HASH, PHRASE_REF, RA1_HASH
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_NE1_MOD03_CAPACITY_PROOF"
BUDGET0 = 102_400
BUDGET_EXTEND = 204_800
NE1_LR = 3e-4
EXPECTED_NE1 = 16_640
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
RUN_ID = "WRIM1-UH1-AC2-NE1-000001"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL05_NE1_CAPACITY_REPORT.json"
STATE = Path(DATA_ROOT) / "WRIM_NE1_MOD03_STATE.json"
BASELINE = {
    "official_greedy": 3,
    "official_token1": 3,
    "extra_greedy": 1,
    "extra_token1": 1,
}
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(obj, default=str)))


def sample_compute(*, t0: float, tokens: int) -> dict[str, Any]:
    gpu_util = vram_used = None
    try:
        smi = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,utilization.memory", "--format=csv,noheader,nounits"],
            text=True,
        ).strip().split(",")
        gpu_util = float(smi[0])
        vram_used = float(smi[1])
    except (OSError, ValueError, subprocess.CalledProcessError):
        pass
    rss_kib = 0
    try:
        for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                rss_kib = int(line.split()[1])
                break
    except OSError:
        pass
    io_read = io_write = None
    try:
        for line in Path("/proc/self/io").read_text(encoding="utf-8").splitlines():
            if line.startswith("read_bytes:"):
                io_read = int(line.split()[1])
            elif line.startswith("write_bytes:"):
                io_write = int(line.split()[1])
    except OSError:
        pass
    cpu = os.times()
    elapsed = max(1e-6, time.perf_counter() - t0)
    torch_peak = 0.0
    if torch.cuda.is_available():
        torch_peak = float(torch.cuda.max_memory_allocated() / (1024 * 1024))
    return {
        "tokens_per_sec": tokens / elapsed,
        "gpu_util_pct": gpu_util,
        "vram_used_mib": vram_used,
        "torch_vram_peak_mib": torch_peak,
        "cpu_user_s": cpu.user,
        "cpu_system_s": cpu.system,
        "ram_rss_mib": rss_kib / 1024.0,
        "disk_read_bytes": io_read,
        "disk_write_bytes": io_write,
        "wall_s": elapsed,
        "note": "measured during actual WRIM training, not a 1.0 MiB probe",
    }


def _ne1_grads(model: torch.nn.Module) -> dict[str, float]:
    up = down = norm = frozen = 0.0
    train_sq = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if not p.requires_grad:
            frozen += n * n
            continue
        train_sq += n * n
        if name.endswith("up.weight") and name.startswith(NE1_PREFIX):
            up = n
        elif name.endswith("down.weight") and name.startswith(NE1_PREFIX):
            down = n
        elif name.endswith("norm.weight") and name.startswith(NE1_PREFIX):
            norm = n
    return {
        "NE1_UP_GRAD": up,
        "NE1_DOWN_GRAD": down,
        "NE1_NORM_GRAD": norm,
        "NE1_TOTAL_GRAD": float(train_sq ** 0.5),
        "FROZEN_GRAD": float(frozen ** 0.5),
    }


def eval_routes(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, official: list[dict[str, Any]], extra: list[dict[str, Any]], phrase: list[dict[str, Any]]) -> dict[str, Any]:
    model.eval()
    if hasattr(model, "set_iia1_active"):
        model.set_iia1_active(False)
    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    off = summarize_probes([token1_probe(model, tok, device, rec) for rec in official])
    ex = summarize_probes([token1_probe(model, tok, device, rec) for rec in extra])
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    phrase_scored = _score_loaded(model, tok, device, phrase)
    phrase_exact = int(phrase_scored.get("short_phrase_exact") or 0)
    return {
        "official_greedy": int(off["greedy_exact"]),
        "official_token1": int(off["token1_exact"]),
        "official_rank": float(off["mean_rank"]),
        "official_prob": float(off["mean_prob"]),
        "extra_greedy": int(ex["greedy_exact"]),
        "extra_token1": int(ex["token1_exact"]),
        "extra_rank": float(ex["mean_rank"]),
        "extra_prob": float(ex["mean_prob"]),
        "phrase_exact": phrase_exact,
        "structured_identity": phrase_exact == PHRASE_REF["phrase"],
        "official": off,
        "extra": ex,
    }


def train_ne1() -> dict[str, Any]:
    os.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{RUN_ID.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / RUN_ID
    report_path = Path(DATA_ROOT) / f"{RUN_ID}_REPORT.json"
    ollama_stopped = False
    use_steps = BUDGET0 // TOKENS_PER_STEP
    max_tokens = BUDGET0

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
        _write(report_path, json.loads(json.dumps(obj, default=str)))
        return obj

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
    if sha256_file(PARENT / MODEL_NAME) != PARENT_HASH:
        return finish({"ok": False, "reason": "parent_hash_mismatch"})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{use_steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden"})

    train_rows = load_rows(NAT_DIR / "train.jsonl")
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    corpus = write_corpus("NE1-MOD03-NATURAL-ENTRY", train_rows, official)
    stream, mask, batches = pack_rows(tokenizer, corpus, max(BUDGET_EXTEND // TOKENS_PER_STEP, 3))
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
    allowed_missing = {n for n, _ in model.named_parameters() if n.startswith(("ne1.", "na1.", "rmr1."))} | {"assistant_stop_ctrl"}
    extra_missing = set(missing) - allowed_missing
    if extra_missing or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected)})
    if any(k.startswith("ra1.") for k in missing) or any(k.startswith("ea1.") for k in missing):
        return finish({"ok": False, "reason": "warm_parent_missing_adapters"})
    if model.ne1 is None or model.ea1 is None:
        return finish({"ok": False, "reason": "ne1_or_ea1_missing"})
    if any(k.startswith("ne1.") for k in missing):
        model.ne1.reset_zero_init()
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
        split = _split_loss(logits, y, y_mask, first_w=1.0)
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
    preflight = {"N_BATCHES": len(probe), "MAX_NE1_GRAD": max_g, "UNSAFE": unsafe, "NE1_LR": NE1_LR, **mask_info}
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0})

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=NE1_LR, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lr_table = {str(s): NE1_LR for s in range(0, (BUDGET_EXTEND // TOKENS_PER_STEP) + 2)}
    identity = {
        "RUN_ID": RUN_ID,
        "PARENT_MODEL_ID": str(PARENT),
        "PARENT_HASH": PARENT_HASH,
        "ARCHITECTURE_ID": model.architecture_id,
        "NE1_BOTTLENECK": 32,
        "NE1_LR": NE1_LR,
        "TRAIN_NE1": True,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "FROZEN_MODULES": ["base", "tok_emb", "lm_head", "EA1", "RA1", "NA1", "RMR1", "norms", "attention", "ffn"],
        "ROUTING_POLICY": "ORACLE_NATURAL_NE1_THEN_BYPASS",
        "TOKENIZER_HASH": sha256_file(tok_path),
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [corpus.name],
        "TRAIN_DATASET_HASHES": {corpus.name: sha256_file(corpus / "train.jsonl")},
        "VALIDATION_DATASET_IDS": [corpus.name + "-val"],
        "VALIDATION_DATASET_HASHES": {corpus.name + "-val": sha256_file(corpus / "val.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_plm3_encode.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": AC1_CTRL_WD,
            "grad_clip": GRAD_CLIP,
            "lr": NE1_LR,
        },
        "FROZEN_PARAMETER_HASH": frozen_hash0,
        "EA1_HASH": ea1_hash0,
        "RA1_HASH": ra1_hash0,
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
        final = ckpt_root / f"step-{step}"
        if (final / "resume-manifest.json").is_file():
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
            curriculum={"pack": "NE1-MOD03-NATURAL-ENTRY", "ne1_lr": NE1_LR, "train_ne1": True, "oracle": "NE1_THEN_BYPASS"},
            identity={**identity, **dist},
            lr_table=lr_table,
            authorized_max_step=BUDGET_EXTEND // TOKENS_PER_STEP,
            authorized_max_tokens=BUDGET_EXTEND,
        )
        return time.perf_counter() - t_ck

    scored: list[dict[str, Any]] = []
    metrics: list[dict[str, Any]] = []
    tokens_seen = 0
    abort = None
    t_train0 = time.perf_counter()
    compute_samples: list[dict[str, Any]] = []
    ckpt_write_s: list[float] = []
    eval_s: list[float] = []

    def run_eval(step: int) -> dict[str, Any]:
        t_ev = time.perf_counter()
        geo = eval_routes(model, tokenizer, device, official, extra, phrase_rows)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
        dist = hashes_now()
        isolation = dist["FROZEN_PARAMETER_HASH_MATCH"] != "YES" or dist["EA1_HASH_MATCH"] != "YES" or dist["RA1_HASH_MATCH"] != "YES" or dist["GLOBAL_WEIGHT_DRIFT"] > 1e-8
        row = {
            "step": step,
            "tokens": step * TOKENS_PER_STEP,
            **{k: geo[k] for k in ("official_greedy", "official_token1", "official_rank", "official_prob", "extra_greedy", "extra_token1", "extra_rank", "extra_prob", "phrase_exact", "structured_identity")},
            "hashes": dist,
            "isolation_fail": isolation,
            "checkpoint": f"{RUN_ID}/step-{step}",
        }
        scored.append(row)
        eval_s.append(time.perf_counter() - t_ev)
        return row

    persist(0, 0)
    ev0 = run_eval(0)
    if ev0["isolation_fail"]:
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": 0}

    eval_at = {5, 10, 15, 20, 25, 30, 40, 50}
    if abort is None:
        for step in range(1, (BUDGET_EXTEND // TOKENS_PER_STEP) + 1):
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                if max_tokens < BUDGET_EXTEND and scored:
                    last = scored[-1]
                    geo_up = (float(last["extra_rank"]) + 0.5 < float(ev0["extra_rank"])) or (float(last["extra_prob"]) > float(ev0["extra_prob"]) + 0.01) or (int(last["extra_token1"]) > BASELINE["extra_token1"])
                    safe = last["structured_identity"] and not last["isolation_fail"]
                    if geo_up and safe:
                        max_tokens = BUDGET_EXTEND
                        use_steps = BUDGET_EXTEND // TOKENS_PER_STEP
                    else:
                        break
                else:
                    break
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.zero_grad(set_to_none=True)
            freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=True)
            model.set_entry_route("ne1")
            model.set_span_route("bypass")
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
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
            row = {"step": step, "loss": float(loss.item()), "raw_grad": raw, "clipped_grad": clipped, "tokens_seen": tokens_seen, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"], **grads}
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in eval_at or step == use_steps:
                ckpt_write_s.append(persist(step, tokens_seen))
                ev = run_eval(step)
                compute_samples.append(sample_compute(t0=t_train0, tokens=tokens_seen))
                if ev["isolation_fail"]:
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": step}
                    break
    if tokens_seen > 0:
        persist(int(tokens_seen // TOKENS_PER_STEP), tokens_seen)

    legal = [r for r in scored if r.get("structured_identity") and not r.get("isolation_fail") and int(r.get("step") or 0) > 0]
    best = None
    if legal:
        best = max(
            legal,
            key=lambda r: (
                int(r["extra_token1"]),
                int(r["extra_greedy"]),
                int(r["official_token1"]),
                int(r["official_greedy"]),
                -float(r["extra_rank"]),
                -int(r["step"]),
            ),
        )
    extra_t1 = int((best or {}).get("extra_token1") or 0)
    extra_g = int((best or {}).get("extra_greedy") or 0)
    improved = extra_t1 > BASELINE["extra_token1"] and extra_g > BASELINE["extra_greedy"]
    compute = sample_compute(t0=t_train0, tokens=tokens_seen)
    report = {
        "ok": abort is None and best is not None,
        "kind": "WRIM_GENESIS_SCHOOL05_NE1_CAPACITY",
        "RUN_ID": RUN_ID,
        "ARCHITECTURE_ID": ARCH_ID_EA1_RA1_NE1,
        "TOKENS_USED": tokens_seen,
        "OPTIMIZER_STEPS": int(tokens_seen // TOKENS_PER_STEP),
        "OPTIMIZER_CONSTRUCTED": "YES",
        "BUDGET0": BUDGET0,
        "BUDGET_EXTENDED_TO": max_tokens,
        "PREFLIGHT": {k: preflight[k] for k in preflight if k != "TRAINABLE_NAMES"},
        "EVALS": scored,
        "BEST": best,
        "BASELINE": BASELINE,
        "extra_unseen_token1_and_greedy_improve": improved,
        "structured_identity": bool((best or {}).get("structured_identity")),
        "hashes_ok": bool(best) and not bool((best or {}).get("isolation_fail")),
        "best_checkpoint": None if best is None else best.get("checkpoint"),
        "COMPUTE": compute,
        "COMPUTE_SAMPLES": compute_samples,
        "CHECKPOINT_WRITE_S": ckpt_write_s,
        "EVAL_TIME_S": eval_s,
        "METRICS_TAIL": metrics[-5:],
        "WALL_SECONDS": time.perf_counter() - t_train0,
        "abort": abort,
        "RMR1_TWO_TOKEN_REGRESSION_OPEN": True,
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
    if not st.get("NE1_AUTHORIZED"):
        raise SystemExit("ne1_not_authorized")
    if st.get("TRAINING_AUTHORIZATION") != "ON":
        raise SystemExit("training_authorization_off")
    eng.record_strategy("SCHOOL_05_NATURAL_ENTRY", "NE1_B32_ORACLE_NATURAL")
    lock = acquire_trainer_lock(
        run_id=RUN_ID,
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET_EXTEND,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    try:
        train_obj = train_ne1()
        used = int(train_obj.get("TOKENS_USED") or 0)
        if used:
            eng.consume_tokens(school="SCHOOL_05_NATURAL_ENTRY", experiment_id="EXP-SCHOOL05-NE1-CAPACITY", tokens=used)
        rec = eng.record_ne1_capacity({
            "extra_unseen_token1_and_greedy_improve": train_obj.get("extra_unseen_token1_and_greedy_improve"),
            "structured_identity": train_obj.get("structured_identity"),
            "hashes_ok": train_obj.get("hashes_ok"),
            "tokens_used": used,
            "best_checkpoint": train_obj.get("best_checkpoint"),
        })
        out = {**train_obj, "PROMPTBOOK": rec}
        persist_state({"TRAIN": {k: out[k] for k in out if k not in {"METRICS_TAIL", "COMPUTE_SAMPLES", "EVALS"}}, "PROMPTBOOK": rec})
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
        "best": out.get("BEST"),
        "improved": out.get("extra_unseen_token1_and_greedy_improve"),
        "promptbook": out.get("PROMPTBOOK"),
        "compute": out.get("COMPUTE"),
        "abort": out.get("abort"),
        "report": str(REPORT),
    }, indent=2, default=str))
