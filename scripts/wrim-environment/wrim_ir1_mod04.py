"""School 09 IR1 B32 instruction-response specialist capacity proof.

Trains only IR1. Parent is WRIM1-UH1-AC2-NE1-000001/step-40 (not the failed NE1 continuation).
Oracle instruction route: IR1 on the full assistant response. Canonical remains STEP_400.
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
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_env import verify_linux_env
from run000007_preflight import resolve_dump_root, sha256_file
from run000007_vram import ensure_vram_for_training, start_user_ollama
from wrim_arch_uh1_ac1_train import AC1_CTRL_WD, _write, unset_auth
from wrim_arch_uh1_phase_a import _split_loss
from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NE1_IR1,
    IR1_PREFIX,
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
from wrim_instruction_train_v1 import CORPUS_ID, ROOT as CORPUS_ROOT
from wrim_ne1_mod03 import eval_routes, sample_compute
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import EA1_HASH, FROZEN_BASE_HASH, PARENT_HASH as EA1_PARENT_HASH, PHRASE_REF, RA1_HASH
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_s09_instruction import greedy_instruction, pack_instruction, score_split
from wrim_school09_instruction import EVAL_PATH, eval_locked_instruction
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_IR1_MOD04_CAPACITY_PROOF"
BUDGET = 204_800
IR1_LR = 5e-4
SEED = 9101
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-NE1-000001" / "step-40"
EA1_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
RUN_ID = "WRIM1-UH1-AC2-IR1-000001"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL09_IR1_CAPACITY_REPORT.json"
STATE = Path(DATA_ROOT) / "WRIM_IR1_MOD04_STATE.json"
S09_VAL_BASELINE = 20
S09_TMPL_BASELINE = 5
ZERO_MAJOR = ("json", "list", "code", "extract", "transform", "compare", "pos", "combo")
SUCCESS_FAMS = ("brief", "explain", "list", "json", "code", "classify", "extract", "transform", "compare", "pos", "neg", "combo")


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(obj, default=str)))


def _ir1_grads(model: torch.nn.Module) -> dict[str, float]:
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
        if name.endswith("up.weight") and name.startswith(IR1_PREFIX):
            up = n
        elif name.endswith("down.weight") and name.startswith(IR1_PREFIX):
            down = n
        elif name.endswith("norm.weight") and name.startswith(IR1_PREFIX):
            norm = n
    return {
        "IR1_UP_GRAD": up,
        "IR1_DOWN_GRAD": down,
        "IR1_NORM_GRAD": norm,
        "IR1_TOTAL_GRAD": float(train_sq ** 0.5),
        "FROZEN_GRAD": float(frozen ** 0.5),
    }


def score_ir1(model, tok, device, rows, *, cap: int | None = None) -> dict[str, Any]:
    return score_split(model, tok, device, rows, cap=cap, entry="ir1", span="ir1")


def union_families(*splits: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for s in splits:
        if s:
            out.update(s.get("families_hit") or [])
    return out


def locked_ir1(model, tok, device) -> dict[str, Any]:
    obj = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    items = [it for it in obj.get("items") or [] if it.get("target")]
    exact = 0
    rows = []
    for it in items:
        rec = {"prompt": it["prompt"], "target": it["target"], "example_id": it.get("item_id"), "family": it.get("family")}
        try:
            hit = greedy_instruction(model, tok, device, rec, entry="ir1", span="ir1")
        except Exception as exc:  # noqa: BLE001
            rows.append({"id": it.get("item_id"), "error": str(exc)})
            continue
        exact += int(hit["exact"])
        rows.append({"id": it.get("item_id"), "family": it.get("family"), "exact": hit["exact"], "text": hit["text"], "target": it["target"]})
    return {"N": len(items), "IR1_EXACT": exact, "ROWS": rows, "TRAINED_ON_EVAL": False}


def train_ir1(*, bottleneck: int = 32, run_id: str = RUN_ID, budget: int = BUDGET, lr: float = IR1_LR) -> dict[str, Any]:
    os.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    use_steps = budget // TOKENS_PER_STEP

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
    if str(build.get("CORPUS_HASH")) != "b1dab3e6c7684bf9eb73cf33981076331481e47dde4ac1a6f786097feccbc320":
        return finish({"ok": False, "reason": "corpus_hash_mismatch", "got": build.get("CORPUS_HASH")})
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
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, ne1=True, ir1=True, ir1_bottleneck=bottleneck, rmr1=False)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    allowed_missing = {n for n, _ in model.named_parameters() if n.startswith(("na1.", "rmr1.", "ir1."))} | {"assistant_stop_ctrl"}
    extra_missing = set(missing) - allowed_missing
    if extra_missing or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected)})
    if any(k.startswith("ne1.") for k in missing) or any(k.startswith("ea1.") for k in missing) or any(k.startswith("ra1.") for k in missing):
        return finish({"ok": False, "reason": "parent_missing_protected_adapters"})
    if model.ir1 is None:
        return finish({"ok": False, "reason": "ir1_missing"})
    if any(k.startswith("ir1.") for k in missing):
        model.ir1.reset_zero_init()
    arch_expect = ARCH_ID_EA1_RA1_NE1_IR1 if bottleneck == 32 else ARCH_ID_EA1_RA1_NE1_IR1 + f"B{bottleneck}"
    if model.architecture_id != arch_expect:
        return finish({"ok": False, "reason": "architecture_id_mismatch", "got": model.architecture_id, "want": arch_expect})
    model.to(device)
    mask_info = freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=False, train_ir1=True)
    ir1_n = int(mask_info["IR1_PARAMETER_COUNT"])
    expected_ir1 = 2 * 256 * bottleneck + 256
    if ir1_n != expected_ir1 or int(mask_info["TRAINABLE_PARAMETER_COUNT"]) != ir1_n:
        return finish({"ok": False, "reason": "trainable_count_mismatch", "PREFLIGHT": mask_info, "expected_ir1": expected_ir1, "OPTIMIZER_CONSTRUCTED": "NO"})
    if any(not n.startswith("ir1.") for n in mask_info["TRAINABLE_NAMES"]):
        return finish({"ok": False, "reason": "non_ir1_trainable", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})
    frozen_hash0 = frozen_parameter_hash(model)
    ea1_hash0 = module_parameter_hash(model, "ea1.")
    ra1_hash0 = module_parameter_hash(model, "ra1.")
    ne1_hash0 = module_parameter_hash(model, "ne1.")
    if frozen_hash0 != FROZEN_BASE_HASH or ea1_hash0 != EA1_HASH or ra1_hash0 != RA1_HASH:
        return finish({"ok": False, "reason": "parent_module_hash_mismatch", "OPTIMIZER_CONSTRUCTED": "NO"})
    frozen_parent = {k: v.detach().cpu().clone() for k, v in model.state_dict().items() if not k.startswith(("ea1.", "ra1.", "na1.", "ne1.", "ir1.", "rmr1."))}

    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")

    model.eval()
    x0 = torch.tensor(batches[0][0][:1], dtype=torch.long, device=device)
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    with torch.inference_mode():
        struct0 = model(x0)
    model.set_instruction_oracle()
    with torch.inference_mode():
        ir1_on0 = model(x0)
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    with torch.inference_mode():
        struct1 = model(x0)
    zero_parity = {
        "structured_route_stable": bool(torch.allclose(struct0, struct1, atol=1e-6)),
        "ir1_zero_delta_max": float((ir1_on0 - struct0).abs().max().item()),
    }

    probe = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=False, train_ir1=True)
        model.set_instruction_oracle()
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=2.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _ir1_grads(model)
        probe.append({"batch": bi, **grads, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"]})
        if (not np.isfinite(grads["IR1_TOTAL_GRAD"])) or grads["IR1_TOTAL_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=False, train_ir1=True)
    max_g = max((float(r.get("IR1_TOTAL_GRAD") or 0) for r in probe), default=0.0)
    preflight = {
        "N_BATCHES": len(probe),
        "MAX_IR1_GRAD": max_g,
        "UNSAFE": unsafe,
        "IR1_LR": lr,
        "IR1_N": ir1_n,
        "ENCODED": enc_n,
        "ENCODE_FAIL": enc_fail,
        "ZERO_PARITY": zero_parity,
        **{k: mask_info[k] for k in mask_info if k != "TRAINABLE_NAMES"},
    }
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0})
    if not zero_parity["structured_route_stable"]:
        return finish({"ok": False, "reason": "zero_init_parity_fail", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0})

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=lr, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lr_table = {str(s): lr for s in range(0, use_steps + 2)}
    identity = {
        "RUN_ID": run_id,
        "PARENT_MODEL_ID": str(PARENT),
        "PARENT_HASH": sha256_file(PARENT / MODEL_NAME),
        "ARCHITECTURE_ID": model.architecture_id,
        "IR1_BOTTLENECK": bottleneck,
        "IR1_LR": lr,
        "TRAIN_IR1": True,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "FROZEN_MODULES": ["base", "tok_emb", "lm_head", "EA1", "RA1", "NE1", "NA1", "RMR1", "norms", "attention", "ffn"],
        "ROUTING_POLICY": "ORACLE_INSTRUCTION_IR1_FULL_RESPONSE",
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
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": AC1_CTRL_WD, "grad_clip": GRAD_CLIP, "lr": lr},
        "FROZEN_PARAMETER_HASH": frozen_hash0,
        "EA1_HASH": ea1_hash0,
        "RA1_HASH": ra1_hash0,
        "NE1_HASH": ne1_hash0,
        "STREAM_SHA": stream_sha,
    }

    def hashes_now() -> dict[str, Any]:
        return {
            "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_parameter_hash(model) == frozen_hash0 else "NO",
            "EA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ea1.") == ea1_hash0 else "NO",
            "RA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ra1.") == ra1_hash0 else "NO",
            "NE1_HASH_MATCH": "YES" if module_parameter_hash(model, "ne1.") == ne1_hash0 else "NO",
            "IR1_HASH": module_parameter_hash(model, "ir1."),
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
            curriculum={"pack": CORPUS_ID, "ir1_lr": lr, "train_ir1": True, "oracle": "IR1_FULL_RESPONSE", "bottleneck": bottleneck},
            identity={**identity, **dist},
            lr_table=lr_table,
            authorized_max_step=use_steps,
            authorized_max_tokens=budget,
        )
        return time.perf_counter() - t_ck

    scored: list[dict[str, Any]] = []
    metrics: list[dict[str, Any]] = []
    tokens_seen = 0
    abort = None
    t_train0 = time.perf_counter()
    stop_early = False

    def run_eval(step: int) -> dict[str, Any]:
        t_ev = time.perf_counter()
        model.eval()
        val = score_ir1(model, tokenizer, device, val_rows)
        fam = score_ir1(model, tokenizer, device, fam_rows, cap=120)
        tmpl = score_ir1(model, tokenizer, device, tmpl_rows, cap=120)
        geo = eval_routes(model, tokenizer, device, official, extra, phrase_rows)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=False, train_ir1=True)
        dist = hashes_now()
        isolation = (
            dist["FROZEN_PARAMETER_HASH_MATCH"] != "YES"
            or dist["EA1_HASH_MATCH"] != "YES"
            or dist["RA1_HASH_MATCH"] != "YES"
            or dist["NE1_HASH_MATCH"] != "YES"
            or dist["GLOBAL_WEIGHT_DRIFT"] > 1e-8
        )
        held = union_families(val, fam, tmpl)
        zero_hit = sorted(held & set(ZERO_MAJOR))
        row = {
            "step": step,
            "tokens": step * TOKENS_PER_STEP,
            "val": val,
            "family_holdout": fam,
            "template_holdout": tmpl,
            "phrase_exact": geo["phrase_exact"],
            "structured_identity": geo["structured_identity"],
            "extra_greedy": geo["extra_greedy"],
            "extra_token1": geo["extra_token1"],
            "official_greedy": geo["official_greedy"],
            "official_token1": geo["official_token1"],
            "hashes": dist,
            "isolation_fail": isolation,
            "checkpoint": f"{run_id}/step-{step}",
            "heldout_families": sorted(held),
            "n_success_families": len(held & set(SUCCESS_FAMS)),
            "zero_major_hit": zero_hit,
            "n_zero_major": len(zero_hit),
            "eval_s": time.perf_counter() - t_ev,
        }
        scored.append(row)
        return row

    persist(0, 0)
    ev0 = run_eval(0)
    if ev0["isolation_fail"]:
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": 0}

    eval_at = {2, 5, 10, 15, 20, 25, 30, 40, 50}

    def gates(row: dict[str, Any]) -> dict[str, bool]:
        val_e = int(row["val"]["exact"])
        fam_e = int(row["family_holdout"]["exact"])
        tmpl_e = int(row["template_holdout"]["exact"])
        return {
            "val_material": val_e >= max(32, int(ev0["val"]["exact"]) + 8) and val_e > S09_VAL_BASELINE,
            "template_material": tmpl_e > max(S09_TMPL_BASELINE, int(ev0["template_holdout"]["exact"])),
            "family_up": fam_e > int(ev0["family_holdout"]["exact"]),
            "multi_family": int(row["n_success_families"]) >= 5,
            "zero_major": int(row["n_zero_major"]) >= 2,
            "phrase": bool(row["structured_identity"]) and int(row["phrase_exact"]) == PHRASE_REF["phrase"],
            "hashes": not bool(row["isolation_fail"]),
            "not_brief_only": len(set(row.get("heldout_families") or []) - {"brief", "classify", "neg"}) >= 2,
        }

    if abort is None:
        for step in range(1, use_steps + 1):
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.zero_grad(set_to_none=True)
            freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_ne1=False, train_ir1=True)
            model.set_instruction_oracle()
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=2.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _ir1_grads(model)
            raw = grads["IR1_TOTAL_GRAD"]
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
                ev = run_eval(step)
                if ev["isolation_fail"]:
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": step}
                    break
                if step >= 10 and all(gates(ev).values()):
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
                int(r["n_zero_major"]),
                int(r["n_success_families"]),
                int(r["val"]["exact"]),
                int(r["template_holdout"]["exact"]),
                int(r["family_holdout"]["exact"]),
                -int(r["step"]),
            ),
        )
    empty_gates = {k: False for k in ("val_material", "template_material", "family_up", "multi_family", "zero_major", "phrase", "hashes", "not_brief_only")}
    ok_gates = gates(best) if best else empty_gates
    proof = bool(best) and all(ok_gates.values()) and abort is None

    holdout_up = bool(best) and (
        int(best["val"]["exact"]) > int(ev0["val"]["exact"])
        or int(best["template_holdout"]["exact"]) > int(ev0["template_holdout"]["exact"])
        or int(best["family_holdout"]["exact"]) > int(ev0["family_holdout"]["exact"])
    )
    new_fams = bool(best) and int(best["n_zero_major"]) >= 1 and int(best["n_success_families"]) >= 2
    losses = [float(m["loss"]) for m in metrics]
    loss_down = bool(losses) and losses[-1] < losses[0] - 0.05
    last_vals = [int(r["val"]["exact"]) for r in scored if int(r["step"]) > 0]
    sat = bool(best) and len(last_vals) >= 3 and last_vals[-1] <= max(last_vals) and last_vals[-1] >= max(last_vals) - 2
    b64_justified = (not proof) and abort is None and holdout_up and new_fams and loss_down and sat and ok_gates.get("phrase") and ok_gates.get("hashes")
    transfer_fail = (not proof) and abort is None and loss_down and (not holdout_up)

    locked = None
    locked_s = None
    if best is not None:
        best_dir = ckpt_root / f"step-{int(best['step'])}"
        cur_step = int(tokens_seen // TOKENS_PER_STEP) if tokens_seen else 0
        if int(best["step"]) != cur_step and (best_dir / MODEL_NAME).is_file():
            src_best = load_safetensors_file(str(best_dir / MODEL_NAME))
            model.load_state_dict(src_best, strict=False)
            model.to(device)
        model.eval()
        best["family_holdout_full"] = score_ir1(model, tokenizer, device, fam_rows)
        best["template_holdout_full"] = score_ir1(model, tokenizer, device, tmpl_rows)
        locked = locked_ir1(model, tokenizer, device)
        locked_s = eval_locked_instruction(model, tokenizer, device)

    compute = sample_compute(t0=t_train0, tokens=tokens_seen)
    report = {
        "ok": proof,
        "kind": "WRIM_GENESIS_SCHOOL09_IR1_CAPACITY",
        "IR1_CAPACITY_PROOF": "PASS" if proof else "FAIL",
        "RUN_ID": run_id,
        "ARCHITECTURE_ID": arch_expect,
        "IR1_BOTTLENECK": bottleneck,
        "IR1_PARAMETER_COUNT": ir1_n,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": build.get("CORPUS_HASH"),
        "PARENT": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "TOKENS_USED": tokens_seen,
        "OPTIMIZER_STEPS": int(tokens_seen // TOKENS_PER_STEP),
        "OPTIMIZER_CONSTRUCTED": "YES",
        "BUDGET": budget,
        "STOP_EARLY": stop_early,
        "PREFLIGHT": preflight,
        "STEP0": ev0,
        "EVALS": scored,
        "BEST": best,
        "GATES": ok_gates,
        "B64_JUSTIFIED": b64_justified,
        "INSTRUCTION_OBJECTIVE_OR_DATA_TRANSFER_FAILURE": transfer_fail,
        "LOCKED_IR1": None if locked is None else {k: locked[k] for k in locked if k != "ROWS"},
        "LOCKED_FOUNDATION_EVAL": None if locked_s is None else {k: locked_s[k] for k in locked_s if k != "ROWS"},
        "hashes_ok": bool(best) and not bool((best or {}).get("isolation_fail")),
        "best_checkpoint": None if best is None else best.get("checkpoint"),
        "NE1_EXPERIMENTAL_PARENT_PRESERVED": "WRIM1-UH1-AC2-NE1-000001/step-40",
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
        report["IR1_CAPACITY_PROOF"] = "FAIL"
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def main() -> dict[str, Any]:
    eng = Engine()
    st = eng.load_state()
    if st.get("CURRENT_SCHOOL") != "SCHOOL_09_INSTRUCTION_FOLLOWING":
        raise SystemExit("not_school_09")
    if st.get("TRAINING_AUTHORIZATION") != "ON":
        raise SystemExit("training_authorization_off")
    eng.resolve_architecture_change(school="SCHOOL_09_INSTRUCTION_FOLLOWING", module_id="IR1", bottleneck=32, token_ceiling=BUDGET)
    eng.record_strategy("SCHOOL_09_INSTRUCTION_FOLLOWING", "IR1_B32_INSTRUCTION_SPECIALIST")
    lock = acquire_trainer_lock(run_id=RUN_ID, authorization_id=AUTH, checkpoint_parent=str(PARENT), token_budget=BUDGET)
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    try:
        train_obj = train_ir1(bottleneck=32, run_id=RUN_ID, budget=BUDGET, lr=IR1_LR)
        used = int(train_obj.get("TOKENS_USED") or 0)
        if used:
            eng.consume_tokens(school="SCHOOL_09_INSTRUCTION_FOLLOWING", experiment_id="EXP-SCHOOL09-IR1-B32", tokens=used)
        rec_cap = eng.record_ir1_capacity(train_obj)
        rec = None
        if train_obj.get("OPTIMIZER_CONSTRUCTED") == "YES":
            if train_obj.get("ok"):
                rec = eng.complete_school(
                    school="SCHOOL_09_INSTRUCTION_FOLLOWING",
                    success=True,
                    evidence={
                        "IR1_CAPACITY_PROOF": "PASS",
                        "gates": train_obj.get("GATES"),
                        "best": train_obj.get("best_checkpoint"),
                        "locked_ir1": (train_obj.get("LOCKED_IR1") or {}).get("IR1_EXACT"),
                        "tokens_used": used,
                        "report": str(REPORT),
                    },
                    experiment_id="EXP-SCHOOL09-IR1-B32",
                )
            elif train_obj.get("B64_JUSTIFIED"):
                persist_state({"B32": train_obj, "PROMPTBOOK": rec_cap})
                _write(REPORT, json.loads(json.dumps({**train_obj, "PROMPTBOOK": rec_cap}, default=str)))
                return {**train_obj, "PROMPTBOOK": rec_cap, "NEXT": "IR1_B64"}
            elif train_obj.get("INSTRUCTION_OBJECTIVE_OR_DATA_TRANSFER_FAILURE"):
                st2 = eng.load_state()
                st2["RETURN_BOUNDARY"] = "DATA_BOUNDARY_REQUIRES_NEW_CORPUS_SOURCE"
                st2["RETURN_DETAIL"] = "IR1 B32 lowered train loss without held-out / family / template transfer. B64 not authorized."
                st2["SCHOOL_09_INSTRUCTION_FOLLOWING_STATUS"] = "FAILED"
                eng.save_state(st2)
                rec = {"success": False, "classification": "INSTRUCTION_OBJECTIVE_OR_DATA_TRANSFER_FAILURE"}
            else:
                rec = eng.complete_school(
                    school="SCHOOL_09_INSTRUCTION_FOLLOWING",
                    success=False,
                    evidence={"IR1_CAPACITY_PROOF": "FAIL", "gates": train_obj.get("GATES"), "tokens_used": used, "report": str(REPORT)},
                    experiment_id="EXP-SCHOOL09-IR1-B32",
                )
        out = {**train_obj, "PROMPTBOOK": rec, "IR1_RECORD": rec_cap}
        persist_state({"TRAIN": {k: out[k] for k in out if k not in {"METRICS_TAIL", "EVALS"}}, "PROMPTBOOK": rec})
        _write(REPORT, json.loads(json.dumps(out, default=str)))
        return out
    finally:
        release_trainer_lock(RUN_ID)
        start_user_ollama()


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": out.get("ok"),
        "proof": out.get("IR1_CAPACITY_PROOF"),
        "tokens_used": out.get("TOKENS_USED"),
        "optimizer_steps": out.get("OPTIMIZER_STEPS"),
        "best": None if not out.get("BEST") else {
            "checkpoint": out["BEST"].get("checkpoint"),
            "val": out["BEST"]["val"]["exact"],
            "family": out["BEST"]["family_holdout"]["exact"],
            "template": out["BEST"]["template_holdout"]["exact"],
            "families": out["BEST"].get("n_success_families"),
            "zero_major": out["BEST"].get("zero_major_hit"),
        },
        "gates": out.get("GATES"),
        "b64_justified": out.get("B64_JUSTIFIED"),
        "transfer_fail": out.get("INSTRUCTION_OBJECTIVE_OR_DATA_TRANSFER_FAILURE"),
        "locked_ir1": (out.get("LOCKED_IR1") or {}).get("IR1_EXACT"),
        "promptbook": out.get("PROMPTBOOK"),
        "abort": out.get("abort"),
        "report": str(REPORT),
        "next": out.get("NEXT"),
    }, indent=2, default=str))
    if out.get("NEXT") == "IR1_B64":
        raise SystemExit(3)
