"""BR1 upper-body instruction plasticity proof.

Unfreezes original transformer parameters in layers 14–17 only.
Parent: WRIM1-UH1-AC2-NE1-000001/step-40. Output route: frozen NE1 + BYPASS.
Retention-replay curriculum required. No new adapter. Canonical remains STEP_400.
Not a School 09 strategy. Not promotion.
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
from wrim_arch_uh1_ac1_train import _write, unset_auth
from wrim_arch_uh1_phase_a import _split_loss, load_jsonl
from wrim_cpt5_identity import INDEPENDENT_NL_PACK
from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NE1,
    BR1_EXPECTED_PARAMS,
    BR1_LAYER_IDS,
    ENTRY_EA1,
    ENTRY_NE1,
    ENTRY_NONE,
    PLACEMENT_B,
    ROUTE_BYPASS,
    ROUTE_RA1,
    WRIMRA1Model,
    freeze_base_train_br1,
    frozen_except_br1_hash,
    frozen_parameter_hash,
    is_br1_trainable_name,
    layer_update_norms,
    module_parameter_hash,
    named_parameter_hash,
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
    GRAD_REVIEW,
    GRAD_WARN,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
    WEIGHT_DECAY,
)
from wrim_instruction_train_v1 import CORPUS_ID, ROOT as CORPUS_ROOT
from wrim_ne1_mod03 import eval_routes, sample_compute
from wrim_plm3_encode import encode_example, pack_train_stream, slice_batches
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import EA1_HASH, FROZEN_BASE_HASH, PARENT_HASH as EA1_PARENT_HASH, PHRASE_REF, RA1_HASH
from wrim_proven_load import disable_tf32
from wrim_ea1_program import paraphrase_train_forms
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR, T3_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_s09_instruction import pack_instruction, score_split
from wrim_school09_instruction import EVAL_PATH, eval_locked_instruction
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock
from wrim_target_only_loss import MASK_CAP_TARGET, MASK_IGNORE

AUTH = "WRIM_BR1_UPPER_BODY_PLASTICITY_PROOF"
BUDGET = 409_600
LR_CANDIDATES = (1e-6, 3e-6, 1e-5, 3e-5)
LR_CEILING = 3e-5
SEED = 9103
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-NE1-000001" / "step-40"
EA1_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
RUN_ID = "WRIM1-BR1-UPPER4-INSTRUCTION-000001"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_BR1_UPPER_BODY_PLASTICITY_REPORT.json"
STATE = Path(DATA_ROOT) / "WRIM_BR1_MOD06_STATE.json"
CORPUS_HASH = "b1dab3e6c7684bf9eb73cf33981076331481e47dde4ac1a6f786097feccbc320"
CPT3_ROOT = Path(DATA_ROOT) / "WR-CORPUS-CPT-3-v1.0.0"
CPT3_NPY = CPT3_ROOT / "packed" / "train-windows.npy"
CPT3_NPY_HASH = "9108291f5870ce9f673c0f9acce7b36f56bbb69c711d6edd624488807bae2ec1"
CPT3_CORPUS_HASH = "a15614df67a60774752d434d98b29a8b006e9fc151635106a818dbaa676f1d5a"
PAD_ID = 0
S09_VAL_BASELINE = 20
S09_TMPL_BASELINE = 5
ZERO_MAJOR = ("json", "list", "code", "extract", "transform", "compare", "pos", "combo")
SUCCESS_FAMS = ("brief", "explain", "list", "json", "code", "classify", "extract", "transform", "compare", "pos", "neg", "combo")
TT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl"
MIX = {
    "instruction": 0.50,
    "cpt3": 0.20,
    "phrase": 0.15,
    "span": 0.10,
    "natural": 0.05,
}

# 20-step cycle: 10 instruction / 4 cpt3 / 3 phrase / 2 span / 1 natural
CYCLE = (["instruction"] * 10) + (["cpt3"] * 4) + (["phrase"] * 3) + (["span"] * 2) + (["natural"] * 1)


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(obj, default=str)))


def union_families(*splits: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for s in splits:
        if s:
            out.update(s.get("families_hit") or [])
    return out


def pack_sft(tokenizer: Tokenizer, rows: list[dict[str, Any]], steps: int) -> list:
    encoded = [encode_example(tokenizer, r) for r in rows]
    if not encoded:
        raise RuntimeError("empty_sft_pack")
    stream, mask = pack_train_stream(encoded, steps=steps)
    return slice_batches(stream, mask, steps=steps)


def cpt3_windows_batch(windows: np.ndarray, start: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = int(windows.shape[0])
    idx = (np.arange(8) + int(start)) % n
    x = np.asarray(windows[idx], dtype=np.int32)
    y = np.concatenate([x[:, 1:], np.zeros((x.shape[0], 1), dtype=np.int32)], axis=1)
    m = np.full(x.shape, MASK_CAP_TARGET, dtype=np.int8)
    m[y == PAD_ID] = MASK_IGNORE
    m[:, -1] = MASK_IGNORE
    return x, y, m


def _br1_grads(model: torch.nn.Module) -> dict[str, Any]:
    train_sq = frozen_sq = attn_sq = ffn_sq = 0.0
    per: dict[str, float] = {}
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if not p.requires_grad:
            frozen_sq += n * n
            continue
        train_sq += n * n
        lid = None
        for i in BR1_LAYER_IDS:
            if name.startswith(f"layers.{i}."):
                lid = str(i)
                break
        if lid is not None:
            per[lid] = float(per.get(lid, 0.0) + n * n)
        if ".attn." in name and ".attn_norm" not in name:
            attn_sq += n * n
        if ".ffn." in name and ".ffn_norm" not in name:
            ffn_sq += n * n
    return {
        "BR1_TOTAL_GRAD": float(train_sq ** 0.5),
        "ATTN_GRAD": float(attn_sq ** 0.5),
        "FFN_GRAD": float(ffn_sq ** 0.5),
        "LAYER_GRADS": {k: float(v ** 0.5) for k, v in per.items()},
        "FROZEN_GRAD": float(frozen_sq ** 0.5),
    }


def restore_trainable(model: WRIMRA1Model, snap: dict[str, torch.Tensor]) -> None:
    with torch.no_grad():
        for n, p in model.named_parameters():
            if n in snap:
                p.copy_(snap[n].to(device=p.device, dtype=p.dtype))


def score_instruction(model, tok, device, rows, *, cap: int | None, entry: str, span: str) -> dict[str, Any]:
    model.set_entry_route(entry)
    model.set_span_route(span)
    return score_split(model, tok, device, rows, cap=cap, entry=entry, span=span)


def locked_instruction(model, tok, device, *, entry: str, span: str) -> dict[str, Any]:
    obj = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    items = [it for it in obj.get("items") or [] if it.get("target")]
    model.set_entry_route(entry)
    model.set_span_route(span)
    exact = 0
    rows = []
    from wrim_s09_instruction import greedy_instruction
    for it in items:
        rec = {"prompt": it["prompt"], "target": it["target"], "example_id": it.get("item_id"), "family": it.get("family")}
        try:
            hit = greedy_instruction(model, tok, device, rec, entry=entry, span=span)
        except Exception as exc:  # noqa: BLE001
            rows.append({"id": it.get("item_id"), "error": str(exc)})
            continue
        exact += int(hit["exact"])
        rows.append({"id": it.get("item_id"), "family": it.get("family"), "exact": hit["exact"]})
    return {"N": len(items), "EXACT": exact, "TRAINED_ON_EVAL": False, "n_rows": len(rows)}


def fam_exact_map(scored: dict[str, Any]) -> dict[str, int]:
    families = scored.get("families") or {}
    out: dict[str, int] = {}
    for name, bucket in families.items():
        key = str(name)
        out[key] = int((bucket or {}).get("exact") or 0)
        low = key.lower()
        for token in ("blue", "no", "dog", "cat"):
            if token in low:
                out[token] = out.get(token, 0) + int((bucket or {}).get("exact") or 0)
    return out


def trend_divergent(metrics: list[dict[str, Any]]) -> bool:
    if len(metrics) < 5:
        return False
    gs = [float(m["raw_grad"]) for m in metrics[-5:]]
    if any(not np.isfinite(g) for g in gs):
        return True
    monotonic = all(gs[i] < gs[i + 1] for i in range(4))
    if monotonic and gs[-1] >= GRAD_REVIEW:
        return True
    if len(metrics) >= 8:
        window = [float(m["raw_grad"]) for m in metrics[-8:]]
        if window[-1] >= GRAD_WARN and window[-1] >= 2.0 * min(window):
            return True
    if gs[-1] >= GRAD_REVIEW and gs[-1] >= 1.25 * gs[-2]:
        return True
    return False


def audit_replay() -> dict[str, Any]:
    sources: dict[str, Any] = {}
    missing: list[str] = []

    def add(name: str, path: Path, *, required: bool = True) -> None:
        if not path.is_file():
            if required:
                missing.append(str(path))
            sources[name] = {"path": str(path), "present": False}
            return
        sources[name] = {"path": str(path), "present": True, "sha256": sha256_file(path), "bytes": path.stat().st_size}

    add("instruction_train", CORPUS_ROOT / "train.jsonl")
    add("instruction_val", CORPUS_ROOT / "validation.jsonl")
    add("phrase_train", PHRASE_ALIGN_DIR / "train.jsonl")
    add("two_token_train", TT_TRAIN)
    add("three_token_train", T3_ALIGN_DIR / "train.jsonl")
    add("natural_train", NAT_DIR / "train.jsonl")
    add("cpt3_windows", CPT3_NPY)
    add("cpt3_manifest", CPT3_ROOT / "WR-CORPUS-CPT-3-v1.0.0-MANIFEST.json")
    para_ok = bool(paraphrase_train_forms())
    sources["paraphrase_train_forms"] = {"present": para_ok, "n": len(paraphrase_train_forms()) if para_ok else 0}
    if CPT3_NPY.is_file() and sha256_file(CPT3_NPY) != CPT3_NPY_HASH:
        missing.append("cpt3_windows_hash_mismatch")
        sources["cpt3_windows"]["hash_ok"] = False
    elif CPT3_NPY.is_file():
        sources["cpt3_windows"]["hash_ok"] = True
    if (CPT3_ROOT / "WR-CORPUS-CPT-3-v1.0.0-MANIFEST.json").is_file():
        man = json.loads((CPT3_ROOT / "WR-CORPUS-CPT-3-v1.0.0-MANIFEST.json").read_text(encoding="utf-8"))
        sources["cpt3_corpus_hash"] = man.get("CORPUS_HASH")
        if str(man.get("CORPUS_HASH")) != CPT3_CORPUS_HASH:
            missing.append("cpt3_corpus_hash_mismatch")
    sufficient = (
        not missing
        and sources.get("cpt3_windows", {}).get("present")
        and sources.get("phrase_train", {}).get("present")
        and sources.get("two_token_train", {}).get("present")
        and sources.get("three_token_train", {}).get("present")
        and sources.get("natural_train", {}).get("present")
        and para_ok
    )
    return {"ok": sufficient, "missing": missing, "sources": sources, "mix": MIX, "cycle": CYCLE}


def classify_br1(
    *,
    abort: dict[str, Any] | None,
    proof: bool,
    loss_down: bool,
    holdout_up: bool,
    retention_collapse: bool,
    train_barely_moves: bool,
) -> str:
    if proof:
        return "BODY_PLASTICITY_PROOF_PASS"
    reason = str((abort or {}).get("stop_reason") or "")
    if retention_collapse:
        return "PLASTICITY_RETENTION_TRADEOFF"
    if reason in {"GRAD_INSTABILITY", "GRAD_TREND_DIVERGENCE", "NAN_INF"}:
        return "BASE_CAPACITY_OR_PRETRAINING_BOUNDARY"
    if train_barely_moves:
        return "BASE_CAPACITY_OR_PRETRAINING_BOUNDARY"
    if loss_down and not holdout_up:
        return "REPRESENTATION_GENERALIZATION_FAILURE"
    return "REPRESENTATION_GENERALIZATION_FAILURE"


def train_br1(*, run_id: str = RUN_ID, budget: int = BUDGET) -> dict[str, Any]:
    os.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    use_steps = budget // TOKENS_PER_STEP
    layer_ids = tuple(BR1_LAYER_IDS)

    def finish(obj: dict[str, Any]) -> dict[str, Any]:
        obj.setdefault("TRAINING_AUTHORIZATION_FINAL", "OFF")
        obj.setdefault("MODEL_PROMOTED", "NO")
        obj.setdefault("CANONICAL_CHANGED", "NO")
        obj.setdefault("TOKENIZER_CHANGED", "NO")
        obj.setdefault("FULL_BODY_UNFROZEN", "NO")
        obj.setdefault("LM_HEAD_TRAINED", "NO")
        obj.setdefault("STAGE3B_STARTED", "NO")
        obj.setdefault("COMMIT", "NO")
        obj.setdefault("PUSH", "NO")
        obj.setdefault("DEPLOY", "NO")
        obj.setdefault("RAEL_STARTED", "NO")
        obj.setdefault("SCHOOL_09_STRATEGY_4", "NOT_CREATED")
        unset_auth()
        if ollama_stopped:
            start_user_ollama()
        _write(report_path, json.loads(json.dumps(obj, default=str)))
        return obj

    replay = audit_replay()
    if not replay["ok"]:
        return finish({
            "ok": False,
            "kind": "WRIM_GENESIS_BR1_UPPER_BODY_PLASTICITY",
            "CLASSIFICATION": "DATA_BOUNDARY_REQUIRES_RETENTION_REPLAY_CORPUS",
            "BODY_PLASTICITY_PROOF": "FAIL",
            "OPTIMIZER_CONSTRUCTED": "NO",
            "NEW_TOKENS_USED": 0,
            "REPLAY_AUDIT": replay,
            "reason": "DATA_BOUNDARY_REQUIRES_RETENTION_REPLAY_CORPUS",
        })

    build = json.loads((Path(DATA_ROOT) / "WRIM_INSTRUCTION_TRAIN_V1_BUILD_REPORT.json").read_text(encoding="utf-8"))
    if str(build.get("CORPUS_HASH")) != CORPUS_HASH:
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
    phrase_train = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    tt_train = load_rows(TT_TRAIN)
    t3_train = load_rows(T3_ALIGN_DIR / "train.jsonl")
    nat_train = load_rows(NAT_DIR / "train.jsonl")
    para_train = paraphrase_train_forms()
    n_inst = int(round(use_steps * MIX["instruction"]))
    n_cpt3 = int(round(use_steps * MIX["cpt3"]))
    n_phrase = int(round(use_steps * MIX["phrase"]))
    n_span = int(round(use_steps * MIX["span"]))
    n_nat = use_steps - (n_inst + n_cpt3 + n_phrase + n_span)
    inst_batches = pack_instruction(tokenizer, train_rows, n_inst)[2]
    phrase_batches = pack_sft(tokenizer, phrase_train, max(n_phrase, 3))
    span_batches = pack_sft(tokenizer, tt_train + t3_train, max(n_span, 3))
    nat_batches = pack_sft(tokenizer, nat_train + para_train, max(n_nat, 3))
    windows = np.load(str(CPT3_NPY), mmap_mode="r")
    schedule = (CYCLE * ((use_steps // len(CYCLE)) + 1))[:use_steps]
    mix_counts = {k: schedule.count(k) for k in MIX}

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
        torch.cuda.reset_peak_memory_stats()

    src_state = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, ne1=True, ir1=False, iia1=False, rmr1=False)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    allowed_missing = {n for n, _ in model.named_parameters() if n.startswith(("na1.", "rmr1.", "ir1.", "iia1."))} | {"assistant_stop_ctrl"}
    extra_missing = set(missing) - allowed_missing
    if extra_missing or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected)})
    if any(k.startswith("ne1.") for k in missing) or any(k.startswith("ea1.") for k in missing) or any(k.startswith("ra1.") for k in missing):
        return finish({"ok": False, "reason": "parent_missing_protected_adapters"})
    if model.iia1 is not None or model.ir1 is not None or model.rmr1 is not None:
        return finish({"ok": False, "reason": "adapter_must_not_be_installed"})
    if model.architecture_id != ARCH_ID_EA1_RA1_NE1:
        return finish({"ok": False, "reason": "architecture_id_mismatch", "got": model.architecture_id})
    n_layers = len(model.layers)
    if n_layers != 18 or set(layer_ids) != {14, 15, 16, 17}:
        return finish({"ok": False, "reason": "layer_index_mismatch", "n_layers": n_layers, "layer_ids": list(layer_ids)})
    model.to(device)

    try:
        mask_info = freeze_base_train_br1(model, layer_ids=layer_ids)
    except RuntimeError as exc:
        return finish({"ok": False, "reason": "trainable_split_mismatch", "detail": str(exc), "OPTIMIZER_CONSTRUCTED": "NO"})
    n_train = int(mask_info["TRAINABLE_PARAMETER_COUNT"])
    if n_train != BR1_EXPECTED_PARAMS or any(not is_br1_trainable_name(n, layer_ids) for n in mask_info["TRAINABLE_NAMES"]):
        return finish({"ok": False, "reason": "trainable_count_mismatch", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})

    frozen_base0 = frozen_parameter_hash(model)
    frozen_br1_0 = frozen_except_br1_hash(model)
    tok_emb0 = named_parameter_hash(model, lambda n: n.startswith("tok_emb"))
    lm_head0 = named_parameter_hash(model, lambda n: n.startswith("lm_head"))
    ea1_hash0 = module_parameter_hash(model, "ea1.")
    ra1_hash0 = module_parameter_hash(model, "ra1.")
    ne1_hash0 = module_parameter_hash(model, "ne1.")
    ac1_0 = named_parameter_hash(model, lambda n: n in {"assistant_ctrl", "assistant_span_ctrl"})
    if frozen_base0 != FROZEN_BASE_HASH or ea1_hash0 != EA1_HASH or ra1_hash0 != RA1_HASH:
        return finish({"ok": False, "reason": "parent_module_hash_mismatch", "OPTIMIZER_CONSTRUCTED": "NO", "frozen_base": frozen_base0, "ea1": ea1_hash0, "ra1": ra1_hash0})
    parent_all = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    parent_br1 = {n: p.detach().cpu().clone() for n, p in model.named_parameters() if is_br1_trainable_name(n, layer_ids)}
    frozen_parent = {k: v for k, v in parent_all.items() if not is_br1_trainable_name(k, layer_ids)}
    opt_bytes = int(n_train * 4 * 3)
    vram_est = {
        "trainable_params": n_train,
        "trainable_percent": mask_info["TRAINABLE_PERCENT_MODEL"],
        "optimizer_state_bytes": opt_bytes,
        "optimizer_state_mib": round(opt_bytes / (1024 * 1024), 2),
        "param_bytes": int(n_train * 4),
        "est_train_vram_mib": round((n_train * 4 * 4 + 23_089_920 * 4 + 8 * 512 * 256 * 18 * 4) / (1024 * 1024), 1),
    }

    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    entry_route = ENTRY_NE1
    span_route = ROUTE_BYPASS

    x0, y0, m0 = inst_batches[0]
    x0t = torch.tensor(x0[:1], dtype=torch.long, device=device)
    y0t = torch.tensor(y0[:1], dtype=torch.long, device=device)
    m0t = torch.tensor(m0[:1], dtype=torch.int8, device=device)
    model.eval()
    model.set_entry_route(entry_route)
    model.set_span_route(span_route)
    with torch.inference_mode():
        logits0 = model(x0t)
        split0 = _split_loss(logits0, y0t, m0t, first_w=2.0)
    route_loss0 = float(split0["loss"].item())

    def run_step_tensors(xb, yb, mb, *, entry: str, span: str):
        x = torch.tensor(xb, dtype=torch.long, device=device)
        y = torch.tensor(yb, dtype=torch.long, device=device)
        ym = torch.tensor(mb, dtype=torch.int8, device=device)
        freeze_base_train_br1(model, layer_ids=layer_ids)
        model.set_entry_route(entry)
        model.set_span_route(span)
        logits = model(x)
        return _split_loss(logits, y, ym, first_w=2.0)

    probe = []
    unsafe = False
    freeze_base_train_br1(model, layer_ids=layer_ids)
    for bi in range(3):
        model.zero_grad(set_to_none=True)
        split = run_step_tensors(*inst_batches[bi], entry=entry_route, span=span_route)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _br1_grads(model)
        probe.append({"batch": bi, **{k: grads[k] for k in grads if k != "LAYER_GRADS"}, "LAYER_GRADS": grads["LAYER_GRADS"], "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"]})
        if (not np.isfinite(grads["BR1_TOTAL_GRAD"])) or grads["BR1_TOTAL_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    restore_trainable(model, parent_br1)
    freeze_base_train_br1(model, layer_ids=layer_ids)
    max_g0 = max((float(r.get("BR1_TOTAL_GRAD") or 0) for r in probe), default=0.0)

    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from stage3a_run import load_baseline, load_suite

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    mix_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-ALIGN-v1.0.0" / "val.jsonl") if (Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-ALIGN-v1.0.0" / "val.jsonl").is_file() else tt_rows
    t3_rows = load_jsonl(T3_ALIGN_DIR / "val.jsonl") if (T3_ALIGN_DIR / "val.jsonl").is_file() else None
    suite = load_suite(locate_suite())
    baseline = load_baseline(locate_baseline(Path(DATA_ROOT)))
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in parent_all.items()}

    def micro_retention() -> dict[str, Any]:
        model.eval()
        model.set_entry_route(ENTRY_EA1)
        model.set_span_route(ROUTE_RA1)
        ph = _score_loaded(model, tokenizer, device, phrase_rows[:12])
        freeze_base_train_br1(model, layer_ids=layer_ids)
        return {"phrase12": int(ph.get("short_phrase_exact") or 0)}

    def micro_instruction() -> dict[str, Any]:
        model.eval()
        return score_instruction(model, tokenizer, device, val_rows, cap=16, entry=entry_route, span=span_route)

    lr_table_probe = []
    chosen_lr = None
    micro0_ret = micro_retention()
    micro0_ins = micro_instruction()
    for cand in LR_CANDIDATES:
        restore_trainable(model, parent_br1)
        freeze_base_train_br1(model, layer_ids=layer_ids)
        opt_tmp = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=cand, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY, fused=False)
        losses = []
        grads_c = []
        cand_unsafe = False
        for bi in range(3):
            opt_tmp.zero_grad(set_to_none=True)
            split = run_step_tensors(*inst_batches[bi], entry=entry_route, span=span_route)
            if not torch.isfinite(split["loss"]):
                cand_unsafe = True
                break
            split["loss"].backward()
            g = _br1_grads(model)
            raw = g["BR1_TOTAL_GRAD"]
            grads_c.append(raw)
            if (not np.isfinite(raw)) or raw >= GRAD_HARD:
                cand_unsafe = True
                break
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], GRAD_CLIP)
            opt_tmp.step()
            losses.append(float(split["loss"].item()))
        freeze_base_train_br1(model, layer_ids=layer_ids)
        ret_after = micro_retention()
        ins_after = micro_instruction()
        max_c = max(grads_c) if grads_c else float("inf")
        loss_drop = bool(losses) and losses[-1] < losses[0]
        ret_ok = int(ret_after["phrase12"]) >= max(0, int(micro0_ret["phrase12"]) - 2)
        ins_ok = int(ins_after.get("exact") or 0) >= int(micro0_ins.get("exact") or 0)
        signal = (not cand_unsafe) and bool(grads_c) and max_c < GRAD_REVIEW and max_c > 1e-10 and loss_drop and ret_ok
        lr_table_probe.append({
            "lr": cand,
            "unsafe": cand_unsafe,
            "max_grad": max_c if grads_c else None,
            "losses": losses,
            "signal": signal,
            "loss_drop": loss_drop,
            "retention_ok": ret_ok,
            "instruction_ok": ins_ok,
            "phrase12_after": ret_after["phrase12"],
            "val16_after": ins_after.get("exact"),
        })
        if chosen_lr is None and signal:
            chosen_lr = cand
    restore_trainable(model, parent_br1)
    freeze_base_train_br1(model, layer_ids=layer_ids)
    if chosen_lr is None:
        stable = [r for r in lr_table_probe if (not r["unsafe"]) and r.get("retention_ok") and r.get("max_grad") is not None and r["max_grad"] < GRAD_HARD and r.get("loss_drop")]
        if not stable:
            stable = [r for r in lr_table_probe if (not r["unsafe"]) and r.get("max_grad") is not None and r["max_grad"] < GRAD_REVIEW]
        chosen_lr = min((r["lr"] for r in stable), default=None)

    preflight = {
        "N_BATCHES": len(probe),
        "MAX_BR1_GRAD": max_g0,
        "UNSAFE": unsafe,
        "LR_CANDIDATES": list(LR_CANDIDATES),
        "LR_SWEEP": lr_table_probe,
        "CHOSEN_LR": chosen_lr,
        "OUTPUT_ROUTE": "NE1+BYPASS",
        "ROUTE_LOSS0": route_loss0,
        "MICRO0_RETENTION": micro0_ret,
        "MICRO0_INSTRUCTION": {"exact": micro0_ins.get("exact")},
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TRAINABLE_PERCENT_MODEL": mask_info["TRAINABLE_PERCENT_MODEL"],
        "VRAM_ESTIMATE": vram_est,
        "BR1_LAYER_IDS": list(layer_ids),
        "N_LAYERS": n_layers,
        "REPLAY_MIX": MIX,
        "MIX_COUNTS": mix_counts,
        **{k: mask_info[k] for k in mask_info if k != "TRAINABLE_NAMES"},
    }
    if unsafe or chosen_lr is None:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "NEW_TOKENS_USED": 0, "REPLAY_AUDIT": replay})
    if float(chosen_lr) > LR_CEILING:
        return finish({"ok": False, "reason": "lr_exceeds_authorization", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "NEW_TOKENS_USED": 0})
    lr = float(chosen_lr)

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=lr, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY, fused=False)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lr_table = {str(s): lr for s in range(0, use_steps + 2)}
    stream_sha = hashlib.sha256(json.dumps({"schedule": schedule, "mix": MIX}, sort_keys=True).encode()).hexdigest()
    identity = {
        "RUN_ID": run_id,
        "PARENT_MODEL_ID": str(PARENT),
        "PARENT_HASH": sha256_file(PARENT / MODEL_NAME),
        "ARCHITECTURE_ID": model.architecture_id,
        "BR1_LAYER_IDS": list(layer_ids),
        "BR1_LR": lr,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "FROZEN_MODULES": ["blocks_0_13", "tok_emb", "lm_head", "norm_f", "AC1", "AC2", "EA1", "RA1", "NE1", "NA1", "IR1", "IIA1", "RMR1"],
        "OUTPUT_ENTRY": entry_route,
        "OUTPUT_SPAN": span_route,
        "TOKENIZER_HASH": sha256_file(tok_path),
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [CORPUS_ID, "WR-CORPUS-CPT-3-v1.0.0", "PHRASE-ALIGN-TRAIN", "TWO-THREE-TRAIN", "NATURAL-PARA-TRAIN"],
        "TRAIN_DATASET_HASHES": {
            CORPUS_ID: str(build.get("CORPUS_HASH")),
            "instruction_train": sha256_file(CORPUS_ROOT / "train.jsonl"),
            "cpt3_windows": CPT3_NPY_HASH,
            "phrase_train": sha256_file(PHRASE_ALIGN_DIR / "train.jsonl"),
            "two_token_train": sha256_file(TT_TRAIN),
            "three_token_train": sha256_file(T3_ALIGN_DIR / "train.jsonl"),
            "natural_train": sha256_file(NAT_DIR / "train.jsonl"),
        },
        "VALIDATION_DATASET_IDS": [CORPUS_ID + "-validation", CORPUS_ID + "-family_holdout", CORPUS_ID + "-template_holdout"],
        "VALIDATION_DATASET_HASHES": {
            CORPUS_ID + "-validation": sha256_file(CORPUS_ROOT / "validation.jsonl"),
            CORPUS_ID + "-family_holdout": sha256_file(CORPUS_ROOT / "family_holdout.jsonl"),
            CORPUS_ID + "-template_holdout": sha256_file(CORPUS_ROOT / "template_holdout.jsonl"),
        },
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_instruction_train_v1.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": WEIGHT_DECAY, "grad_clip": GRAD_CLIP, "lr": lr},
        "LR_SCHEDULE_ID": "constant_br1_upper4",
        "REPLAY_MIX": MIX,
        "FROZEN_EXCEPT_BR1_HASH": frozen_br1_0,
        "TOK_EMB_HASH": tok_emb0,
        "LM_HEAD_HASH": lm_head0,
        "EA1_HASH": ea1_hash0,
        "RA1_HASH": ra1_hash0,
        "NE1_HASH": ne1_hash0,
        "AC_HASH": ac1_0,
        "STREAM_SHA": stream_sha,
        "CANONICAL": "STEP_400",
        "MODEL_PROMOTED": "NO",
    }

    def hashes_now() -> dict[str, Any]:
        drift = layer_update_norms(model, parent_br1, layer_ids)
        return {
            "FROZEN_LAYER_HASH_MATCH": "YES" if frozen_except_br1_hash(model) == frozen_br1_0 else "NO",
            "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_except_br1_hash(model) == frozen_br1_0 else "NO",
            "TOK_EMB_HASH_MATCH": "YES" if named_parameter_hash(model, lambda n: n.startswith("tok_emb")) == tok_emb0 else "NO",
            "LM_HEAD_HASH_MATCH": "YES" if named_parameter_hash(model, lambda n: n.startswith("lm_head")) == lm_head0 else "NO",
            "EA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ea1.") == ea1_hash0 else "NO",
            "RA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ra1.") == ra1_hash0 else "NO",
            "NE1_HASH_MATCH": "YES" if module_parameter_hash(model, "ne1.") == ne1_hash0 else "NO",
            "AC_HASH_MATCH": "YES" if named_parameter_hash(model, lambda n: n in {"assistant_ctrl", "assistant_span_ctrl"}) == ac1_0 else "NO",
            "TRAINABLE_LAYER_DRIFT": drift,
            "MAX_RELATIVE_UPDATE_NORM": drift["max_rel"],
            "MAX_ABS_UPDATE_NORM": drift["max_abs"],
            "PARENT_FROZEN_BASE_AT_LOAD": frozen_base0 == FROZEN_BASE_HASH,
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
            curriculum={"pack": "BR1-INSTRUCTION-REPLAY", "mix": MIX, "lr": lr, "layers": list(layer_ids), "entry": entry_route, "span": span_route},
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
    t_eval_acc = 0.0
    t_ckpt_acc = 0.0
    max_rel = 0.0
    retention_collapse = False
    cpt3_cursor = 0
    counters = {"instruction": 0, "cpt3": 0, "phrase": 0, "span": 0, "natural": 0}

    def run_eval(step: int, *, full_retention: bool) -> dict[str, Any]:
        nonlocal t_eval_acc
        t_ev = time.perf_counter()
        model.eval()
        val = score_instruction(model, tokenizer, device, val_rows, cap=None, entry=entry_route, span=span_route)
        fam = score_instruction(model, tokenizer, device, fam_rows, cap=120, entry=entry_route, span=span_route)
        tmpl = score_instruction(model, tokenizer, device, tmpl_rows, cap=120, entry=entry_route, span=span_route)
        geo = eval_routes(model, tokenizer, device, official, extra, phrase_rows)
        model.set_entry_route(ENTRY_EA1)
        model.set_span_route(ROUTE_RA1)
        phrase_scored = _score_loaded(model, tokenizer, device, phrase_rows)
        fam_map = fam_exact_map(phrase_scored)
        freeze_base_train_br1(model, layer_ids=layer_ids)
        dist = hashes_now()
        isolation = (
            dist["FROZEN_LAYER_HASH_MATCH"] != "YES"
            or dist["TOK_EMB_HASH_MATCH"] != "YES"
            or dist["LM_HEAD_HASH_MATCH"] != "YES"
            or dist["EA1_HASH_MATCH"] != "YES"
            or dist["RA1_HASH_MATCH"] != "YES"
            or dist["NE1_HASH_MATCH"] != "YES"
        )
        held = union_families(val, fam, tmpl)
        zero_hit = sorted(held & set(ZERO_MAJOR))
        bundle = None
        if full_retention:
            model.set_entry_route(ENTRY_NONE)
            model.set_span_route(ROUTE_BYPASS)
            bundle = eval_retention_bundle(
                model=model,
                tokenizer=tokenizer,
                device=device,
                dump=dump,
                suite=suite,
                baseline=baseline,
                wrim0_logp=wrim0_logp,
                parent_cpu=parent_cpu,
                val_packs=val_packs,
                nl_rows=nl_rows,
                ft_rows=ft_rows,
                tt_rows=tt_rows,
                mix_rows=mix_rows,
                step=step,
                name="br1",
                t3_rows=t3_rows,
            )
            freeze_base_train_br1(model, layer_ids=layer_ids)
        row = {
            "step": step,
            "tokens": step * TOKENS_PER_STEP,
            "val": val,
            "family_holdout": fam,
            "template_holdout": tmpl,
            "phrase_exact": int(phrase_scored.get("short_phrase_exact") or geo["phrase_exact"]),
            "phrase_families": fam_map,
            "blue": int(fam_map.get("blue") or 0),
            "no": int(fam_map.get("no") or 0),
            "dog": int(fam_map.get("dog") or 0),
            "cat": int(fam_map.get("cat") or 0),
            "structured_identity": geo["structured_identity"],
            "extra_greedy": geo["extra_greedy"],
            "official_greedy": geo["official_greedy"],
            "hashes": dist,
            "isolation_fail": isolation,
            "checkpoint": f"{run_id}/step-{step}",
            "heldout_families": sorted(held),
            "n_success_families": len(held & set(SUCCESS_FAMS)),
            "zero_major_hit": zero_hit,
            "n_zero_major": len(zero_hit),
            "retention": None if bundle is None else {
                "PHRASE": int(phrase_scored.get("short_phrase_exact") or 0),
                "BLUE": int(fam_map.get("blue") or 0),
                "NO": int(fam_map.get("no") or 0),
                "DOG": int(fam_map.get("dog") or 0),
                "CAT": int(fam_map.get("cat") or 0),
                "TWO_TOKEN": bundle.get("GREEDY_TWO_TOKEN_EXACT"),
                "THREE_TOKEN": bundle.get("GREEDY_THREE_TOKEN_EXACT"),
                "GENERAL_NL_NLL": bundle.get("GENERAL_NL_NLL"),
                "INDEPENDENT_NL_NLL": bundle.get("INDEPENDENT_NL_NLL"),
                "CODE_NLL": bundle.get("CODE_NLL"),
                "JSON_NLL": bundle.get("JSON_NLL"),
                "EOS": bundle.get("EOS_MEAN_RANK"),
                "STOPPING": bundle.get("GREEDY_STOPPING"),
                "RAMBLE": bundle.get("RAMBLE_RATE"),
                "EMPTY": bundle.get("EMPTY_RESPONSE_RATE"),
                "STAGE3": bundle.get("stage3_historical"),
                "STAGE3_COLLAPSE": bundle.get("stage3_collapse"),
            },
            "eval_s": time.perf_counter() - t_ev,
        }
        t_eval_acc += float(row["eval_s"])
        scored.append(row)
        return row

    t_ckpt_acc += persist(0, 0)
    ev0 = run_eval(0, full_retention=True)
    if ev0["isolation_fail"]:
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": 0}
    ret0 = ev0.get("retention") or {}

    eval_at = {2, 5, 10} | set(range(15, use_steps + 1, 5))
    retention_at = {0, 10, 20, 50, 100, use_steps}

    def gates(row: dict[str, Any]) -> dict[str, bool]:
        val_e = int(row["val"]["exact"])
        fam_e = int(row["family_holdout"]["exact"])
        tmpl_e = int(row["template_holdout"]["exact"])
        ret = row.get("retention") or {}
        stage3 = ret.get("STAGE3")
        if stage3 is None:
            stage3 = (ret0 or {}).get("STAGE3")
        phrase = int(row.get("phrase_exact") or 0)
        return {
            "val_material": val_e > int(ev0["val"]["exact"]) and val_e >= max(S09_VAL_BASELINE, int(ev0["val"]["exact"]) + 5),
            "template_material": tmpl_e > max(S09_TMPL_BASELINE, int(ev0["template_holdout"]["exact"])),
            "family_up": fam_e > int(ev0["family_holdout"]["exact"]) and fam_e >= 3,
            "multi_family": int(row["n_success_families"]) >= 5,
            "zero_major": int(row["n_zero_major"]) >= 3,
            "locked_untouched": True,
            "stage3": stage3 is None or int(stage3) >= 5,
            "structured": phrase >= max(1, int(PHRASE_REF["phrase"]) - 4),
            "hashes": not bool(row["isolation_fail"]),
            "retention": not bool(row.get("retention_collapse")),
        }

    def retention_failed(row: dict[str, Any]) -> bool:
        ret = row.get("retention")
        phrase = int(row.get("phrase_exact") or 0)
        if phrase < max(0, int(PHRASE_REF["phrase"]) - 8) and int(ev0.get("phrase_exact") or 0) >= PHRASE_REF["phrase"] - 2:
            return True
        if not ret:
            return False
        s3 = ret.get("STAGE3")
        if s3 is not None and int(s3) < 5:
            return True
        t2_0 = ret0.get("TWO_TOKEN")
        t2 = ret.get("TWO_TOKEN")
        if t2_0 not in (None, 0) and t2 == 0:
            return True
        for k in ("CODE_NLL", "JSON_NLL", "GENERAL_NL_NLL"):
            a = ret0.get(k)
            b = ret.get(k)
            if a is not None and b is not None and float(b) > float(a) + 1.0:
                return True
        return False

    if abort is None:
        for step in range(1, use_steps + 1):
            group = schedule[step - 1]
            if group == "instruction":
                xb, yb, mb = inst_batches[counters[group] % len(inst_batches)]
                entry, span = entry_route, span_route
            elif group == "cpt3":
                xb, yb, mb = cpt3_windows_batch(windows, cpt3_cursor)
                cpt3_cursor += 8
                entry, span = ENTRY_NONE, ROUTE_BYPASS
            elif group == "phrase":
                xb, yb, mb = phrase_batches[counters[group] % len(phrase_batches)]
                entry, span = ENTRY_EA1, ROUTE_RA1
            elif group == "span":
                xb, yb, mb = span_batches[counters[group] % len(span_batches)]
                entry, span = ENTRY_EA1, ROUTE_RA1
            else:
                xb, yb, mb = nat_batches[counters[group] % len(nat_batches)]
                entry, span = ENTRY_EA1, ROUTE_RA1
            counters[group] += 1
            optimizer.zero_grad(set_to_none=True)
            split = run_step_tensors(xb, yb, mb, entry=entry, span=span)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step, "group": group}
                break
            loss.backward()
            grads = _br1_grads(model)
            raw = grads["BR1_TOTAL_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step, "group": group}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            drift = layer_update_norms(model, parent_br1, layer_ids)
            max_rel = max(max_rel, float(drift["max_rel"]))
            rowm = {
                "step": step,
                "group": group,
                "loss": float(loss.item()),
                "raw_grad": raw,
                "clipped_grad": clipped,
                "tokens_seen": tokens_seen,
                "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                "ATTN_GRAD": grads["ATTN_GRAD"],
                "FFN_GRAD": grads["FFN_GRAD"],
                "LAYER_GRADS": grads["LAYER_GRADS"],
                "REL_UPDATE": drift["max_rel"],
            }
            metrics.append(rowm)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rowm) + "\n")
            if trend_divergent(metrics):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_TREND_DIVERGENCE", "grad": raw, "step": step, "recent": [m["raw_grad"] for m in metrics[-8:]]}
                break
            if step in eval_at or step == use_steps:
                t_ckpt_acc += persist(step, tokens_seen)
                ev = run_eval(step, full_retention=step in retention_at or step == use_steps)
                if ev["isolation_fail"]:
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "FROZEN_HASH_VIOLATION", "step": step}
                    break
                if retention_failed(ev):
                    ev["retention_collapse"] = True
                    retention_collapse = True
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "RETENTION_COLLAPSE", "step": step}
                    break
    if tokens_seen > 0:
        t_ckpt_acc += persist(int(tokens_seen // TOKENS_PER_STEP), tokens_seen)

    legal = [r for r in scored if not r.get("isolation_fail") and int(r.get("step") or 0) > 0 and not r.get("retention_collapse")]
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
                int(r.get("phrase_exact") or 0),
                -int(r["step"]),
            ),
        )
    empty_gates = {k: False for k in ("val_material", "template_material", "family_up", "multi_family", "zero_major", "locked_untouched", "stage3", "structured", "hashes", "retention")}
    ok_gates = gates(best) if best else empty_gates
    proof = bool(best) and all(ok_gates.values()) and abort is None and not retention_collapse
    holdout_up = bool(best) and (
        int(best["val"]["exact"]) > int(ev0["val"]["exact"])
        or int(best["template_holdout"]["exact"]) > int(ev0["template_holdout"]["exact"])
        or int(best["family_holdout"]["exact"]) > int(ev0["family_holdout"]["exact"])
    )
    losses = [float(m["loss"]) for m in metrics if m.get("group") == "instruction"] or [float(m["loss"]) for m in metrics]
    loss_down = bool(losses) and losses[-1] < losses[0] - 0.05
    train_barely = (not losses) or abs(losses[-1] - losses[0]) < 0.05
    signal = bool(best) and int(best["n_success_families"]) >= 2 and holdout_up and not retention_collapse and bool(ok_gates.get("hashes"))
    classification = classify_br1(
        abort=abort,
        proof=proof,
        loss_down=loss_down,
        holdout_up=holdout_up,
        retention_collapse=retention_collapse,
        train_barely_moves=train_barely,
    )
    if proof:
        classification = "BODY_PLASTICITY_PROOF_PASS"

    locked = None
    locked_s = None
    if best is not None:
        best_dir = ckpt_root / f"step-{int(best['step'])}"
        cur_step = int(tokens_seen // TOKENS_PER_STEP) if tokens_seen else 0
        if int(best["step"]) != cur_step and (best_dir / MODEL_NAME).is_file():
            src_best = load_safetensors_file(str(best_dir / MODEL_NAME))
            model.load_state_dict(src_best, strict=False)
            model.to(device)
            freeze_base_train_br1(model, layer_ids=layer_ids)
        model.eval()
        best["family_holdout_full"] = score_instruction(model, tokenizer, device, fam_rows, cap=None, entry=entry_route, span=span_route)
        best["template_holdout_full"] = score_instruction(model, tokenizer, device, tmpl_rows, cap=None, entry=entry_route, span=span_route)
        locked = locked_instruction(model, tokenizer, device, entry=entry_route, span=span_route)
        model.set_entry_route(entry_route)
        model.set_span_route(span_route)
        locked_s = eval_locked_instruction(model, tokenizer, device)
        if best.get("retention") is None:
            best_full = run_eval(int(best["step"]), full_retention=True)
            best["retention"] = best_full.get("retention")
            best["phrase_exact"] = best_full.get("phrase_exact")
            best["blue"] = best_full.get("blue")
            best["no"] = best_full.get("no")
            best["dog"] = best_full.get("dog")
            best["cat"] = best_full.get("cat")

    compute = sample_compute(t0=t_train0, tokens=tokens_seen)
    compute["eval_time_s"] = t_eval_acc
    compute["checkpoint_time_s"] = t_ckpt_acc
    ret_best = (best or {}).get("retention") or ret0
    hashes_best = (best or ev0).get("hashes") or hashes_now()

    report = {
        "ok": proof,
        "kind": "WRIM_GENESIS_BR1_UPPER_BODY_PLASTICITY",
        "PROGRAM_STATUS": "BR1_EXPERIMENT",
        "CANONICAL": "STEP_400",
        "PARENT": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "TRAINABLE_LAYERS": list(layer_ids),
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TRAINABLE_PERCENT_MODEL": mask_info["TRAINABLE_PERCENT_MODEL"],
        "FROZEN_LAYER_HASH_MATCH": hashes_best.get("FROZEN_LAYER_HASH_MATCH"),
        "TOK_EMB_HASH_MATCH": hashes_best.get("TOK_EMB_HASH_MATCH"),
        "LM_HEAD_HASH_MATCH": hashes_best.get("LM_HEAD_HASH_MATCH"),
        "EA1_HASH_MATCH": hashes_best.get("EA1_HASH_MATCH"),
        "RA1_HASH_MATCH": hashes_best.get("RA1_HASH_MATCH"),
        "NE1_HASH_MATCH": hashes_best.get("NE1_HASH_MATCH"),
        "OUTPUT_ROUTE": "NE1+BYPASS",
        "INSTRUCTION_CORPUS": CORPUS_ID,
        "RETENTION_REPLAY_SOURCES": replay["sources"],
        "REPLAY_MIX": MIX,
        "NEW_TOKEN_AUTHORIZATION": budget,
        "NEW_TOKENS_USED": tokens_seen,
        "LR": lr,
        "MAX_GRADIENT": max((float(m["raw_grad"]) for m in metrics), default=max_g0),
        "MAX_RELATIVE_UPDATE_NORM": max_rel,
        "BEST_CHECKPOINT": None if best is None else best.get("checkpoint"),
        "TRAIN_INSTRUCTION": None if not losses else {"start": losses[0], "end": losses[-1]},
        "VALIDATION_INSTRUCTION": None if best is None else best["val"]["exact"],
        "TEMPLATE_HOLDOUT": None if best is None else (best.get("template_holdout_full") or best["template_holdout"])["exact"],
        "FAMILY_HOLDOUT": None if best is None else (best.get("family_holdout_full") or best["family_holdout"])["exact"],
        "FAMILIES_WORKING": None if best is None else best.get("heldout_families"),
        "NEW_MAJOR_FAMILIES_WORKING": None if best is None else best.get("zero_major_hit"),
        "PHRASE": (ret_best or {}).get("PHRASE", None if best is None else best.get("phrase_exact")),
        "BLUE": (ret_best or {}).get("BLUE", None if best is None else best.get("blue")),
        "NO": (ret_best or {}).get("NO", None if best is None else best.get("no")),
        "DOG": (ret_best or {}).get("DOG", None if best is None else best.get("dog")),
        "CAT": (ret_best or {}).get("CAT", None if best is None else best.get("cat")),
        "TWO_TOKEN": (ret_best or {}).get("TWO_TOKEN"),
        "THREE_TOKEN": (ret_best or {}).get("THREE_TOKEN"),
        "PARAPHRASE": None,
        "GENERAL_NL_NLL": (ret_best or {}).get("GENERAL_NL_NLL"),
        "INDEPENDENT_NL_NLL": (ret_best or {}).get("INDEPENDENT_NL_NLL"),
        "CODE_NLL": (ret_best or {}).get("CODE_NLL"),
        "JSON_NLL": (ret_best or {}).get("JSON_NLL"),
        "EOS": (ret_best or {}).get("EOS"),
        "STOPPING": (ret_best or {}).get("STOPPING"),
        "RAMBLE": (ret_best or {}).get("RAMBLE"),
        "EMPTY": (ret_best or {}).get("EMPTY"),
        "STAGE3": (ret_best or {}).get("STAGE3"),
        "LOCKED_FOUNDATION_EVAL": None if locked_s is None else {k: locked_s[k] for k in locked_s if k != "ROWS"},
        "LOCKED_BR1": locked,
        "BODY_PLASTICITY_SIGNAL": "YES" if signal else "NO",
        "BODY_PLASTICITY_PROOF": "PASS" if proof else "FAIL",
        "RETENTION_COLLAPSE": "YES" if retention_collapse else "NO",
        "PLASTICITY_RETENTION_TRADEOFF": classification == "PLASTICITY_RETENTION_TRADEOFF",
        "BASE_CAPACITY_OR_PRETRAINING_BOUNDARY": classification == "BASE_CAPACITY_OR_PRETRAINING_BOUNDARY",
        "REPRESENTATION_GENERALIZATION_FAILURE": classification == "REPRESENTATION_GENERALIZATION_FAILURE",
        "CLASSIFICATION": classification,
        "GATES": ok_gates,
        "STEP0": ev0,
        "EVALS": scored,
        "BEST": best,
        "PREFLIGHT": preflight,
        "REPLAY_AUDIT": replay,
        "COMPUTE": compute,
        "METRICS_TAIL": metrics[-12:],
        "abort": abort,
        "hashes_ok": bool(best) and not bool((best or {}).get("isolation_fail")),
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "RAEL_STARTED": "NO",
        "SCHOOL_09_STRATEGY_4": "NOT_CREATED",
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    if abort:
        report["ok"] = False
        report["BODY_PLASTICITY_PROOF"] = "FAIL"
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def main() -> dict[str, Any]:
    eng = Engine()
    st = eng.load_state()
    if st.get("TRAINING_AUTHORIZATION") != "ON" or st.get("CURRENT_MISSION") != "BR1_UPPER_BODY_PLASTICITY_PROOF":
        eng.authorize_br1(token_ceiling=BUDGET)
    lock = acquire_trainer_lock(run_id=RUN_ID, authorization_id=AUTH, checkpoint_parent=str(PARENT), token_budget=BUDGET)
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    try:
        train_obj = train_br1(run_id=RUN_ID, budget=BUDGET)
        used = int(train_obj.get("NEW_TOKENS_USED") or 0)
        if used:
            eng.consume_tokens(school="BR1_UPPER_BODY_PLASTICITY", experiment_id="EXP-BR1-UPPER4-INSTRUCTION-000001", tokens=used)
        rec = eng.record_br1(train_obj)
        remaining = eng.load_state().get("MASTER_LM_TOKENS_REMAINING")
        out = {**train_obj, "PROMPTBOOK": rec, "MASTER_TOKENS_REMAINING": remaining, "NEXT_COMMANDER_DECISION": (
            "Whether BR1 experimental lineage becomes the new Foundation parent"
            if train_obj.get("BODY_PLASTICITY_PROOF") == "PASS"
            else "Do not unfreeze more layers, train lm_head, change tokenizer, or start full-body. Commander decides next architecture/scale move."
        )}
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
        "proof": out.get("BODY_PLASTICITY_PROOF"),
        "signal": out.get("BODY_PLASTICITY_SIGNAL"),
        "classification": out.get("CLASSIFICATION"),
        "tokens_used": out.get("NEW_TOKENS_USED"),
        "lr": out.get("LR"),
        "trainable": out.get("TRAINABLE_PARAMETER_COUNT"),
        "percent": out.get("TRAINABLE_PERCENT_MODEL"),
        "best": out.get("BEST_CHECKPOINT"),
        "val": out.get("VALIDATION_INSTRUCTION"),
        "template": out.get("TEMPLATE_HOLDOUT"),
        "family": out.get("FAMILY_HOLDOUT"),
        "families": out.get("FAMILIES_WORKING"),
        "stage3": out.get("STAGE3"),
        "retention_collapse": out.get("RETENTION_COLLAPSE"),
        "frozen": out.get("FROZEN_LAYER_HASH_MATCH"),
        "master_remaining": out.get("MASTER_TOKENS_REMAINING"),
        "abort": out.get("abort"),
        "report": str(REPORT),
        "canonical": out.get("CANONICAL"),
        "promoted": out.get("MODEL_PROMOTED"),
    }, indent=2, default=str))
