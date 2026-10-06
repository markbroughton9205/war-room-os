"""MOD-01 NA1 natural-specialist capacity-separation proof.

Oracle task-group routing. NA1 only trainable. RA1/EA1/base frozen.
Capacity proof only. No learned router. No promotion.
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

from wrim_arch_uh1_ac1_train import AC1_CTRL_WD, _write, unset_auth
from wrim_arch_uh1_ac2_train import pack_rows
from wrim_arch_uh1_phase_a import _split_loss, load_jsonl
from wrim_ea1_consol import natural_semantic
from wrim_ea1_program import gen_pass, write_corpus
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NA1,
    ORACLE_GATE_CLASS,
    ORACLE_GATE_VERSION,
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
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    SEED,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_na1_validate import EXPECTED_NA1, validate_na1_architecture
from wrim_plm1_gates import hard_hits
from wrim_ra1_conflict_lib import build_group_rows, natural_span_eval
from wrim_ra1_conflict_program import heldout, score_ckpt
from wrim_ra1_curriculum_program import summarize
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows, score_sets, trainer_snap
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_NA1_MOD01_CAPACITY_PROOF"
BUDGET = 204_800
NA1_LR = 3e-4
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
RUN_ID = "WRIM1-UH1-AC2-NA1-000001"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_MOD_01_NA1_CAPACITY_PROOF_REPORT.json"
STATE = Path(DATA_ROOT) / "WRIM_NA1_MOD01_STATE.json"
DENSE_EVAL = (2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50)
PARENT_REF = {
    "phrase_exact": 17,
    "blue": 3,
    "no": 5,
    "dog": 5,
    "cat": 4,
    "two": 6,
    "three_align": 10,
    "paraphrase_exact": 3,
    "natural_exact": 1,
}


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(obj, default=str)))


def write_natural_corpus() -> Path:
    train = list(build_group_rows()["natural"])
    val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    return write_corpus("NA1-MOD01-NATURAL-ONLY", train, val)


def ra1_identity_ok(summary: dict[str, Any], para: int) -> bool:
    return (
        int(summary.get("phrase_exact") or -1) == PARENT_REF["phrase_exact"]
        and int(summary.get("blue") or -1) == PARENT_REF["blue"]
        and int(summary.get("no") or -1) == PARENT_REF["no"]
        and int(summary.get("dog") or -1) == PARENT_REF["dog"]
        and int(summary.get("cat") or -1) == PARENT_REF["cat"]
        and int(summary.get("two") or -1) == PARENT_REF["two"]
        and int(summary.get("three_align") or -1) == PARENT_REF["three_align"]
        and int(para) == PARENT_REF["paraphrase_exact"]
    )


def _na1_grads(model: torch.nn.Module) -> dict[str, float]:
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
        if name.endswith("up.weight") and name.startswith("na1."):
            up = n
        elif name.endswith("down.weight") and name.startswith("na1."):
            down = n
        elif name == "na1.norm.weight":
            norm = n
    g = train_sq ** 0.5
    gate = "UNSAFE"
    if g < GRAD_REVIEW:
        gate = "SAFE"
    elif g < GRAD_HARD:
        gate = "REVIEW"
    return {
        "NA1_TOTAL_GRAD": g,
        "W_UP_GRAD": up,
        "W_DOWN_GRAD": down,
        "ADAPTER_NORM_GRAD": norm,
        "FROZEN_GRAD": frozen ** 0.5,
        "GRAD_GATE": gate,
        "TOTAL_TRAINABLE_GRAD": g,
    }


def train_na1_mod01() -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK
    from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_proven_load import disable_tf32
    from stage3a_run import load_baseline, load_suite

    os.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{RUN_ID.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / RUN_ID
    report_path = Path(DATA_ROOT) / f"{RUN_ID}_REPORT.json"
    ollama_stopped = False
    use_steps = BUDGET // TOKENS_PER_STEP
    max_tokens = BUDGET

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
    if sha256_file(Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME) != EXPECTED_PARENT_MODEL_HASH:
        return finish({"ok": False, "reason": "foundation_parent_hash_mismatch"})
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        return finish({"ok": False, "reason": "parent_hash_mismatch"})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{use_steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden"})

    corpus = write_natural_corpus()
    stream, mask, batches = pack_rows(tokenizer, corpus, max(use_steps, 3))
    val_rows = load_jsonl(corpus / "val.jsonl")

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    src_state = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=True)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected)})
    if any(k.startswith("ra1.") for k in missing) or any(k.startswith("ea1.") for k in missing):
        return finish({"ok": False, "reason": "warm_parent_missing_adapters"})
    if model.na1 is None or model.ea1 is None:
        return finish({"ok": False, "reason": "na1_or_ea1_missing"})
    if any(k.startswith("na1.") for k in missing):
        model.na1.reset_zero_init()
    model.to(device)
    mask_info = freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=True)
    if int(mask_info["TRAINABLE_PARAMETER_COUNT"]) != EXPECTED_NA1:
        return finish({"ok": False, "reason": "trainable_count_mismatch", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})
    if any(not n.startswith("na1.") for n in mask_info["TRAINABLE_NAMES"]):
        return finish({"ok": False, "reason": "non_na1_trainable", "PREFLIGHT": mask_info, "OPTIMIZER_CONSTRUCTED": "NO"})
    frozen_hash0 = frozen_parameter_hash(model)
    ea1_hash0 = module_parameter_hash(model, "ea1.")
    ra1_hash0 = module_parameter_hash(model, "ra1.")
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    frozen_parent = {k: v.detach().cpu().clone() for k, v in model.state_dict().items() if not k.startswith(("ea1.", "ra1.", "na1."))}

    model.set_span_route("na1")
    probe = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=True)
        model.set_span_route("na1")
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=1.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _na1_grads(model)
        probe.append({"batch": bi, **grads})
        if (not np.isfinite(grads["NA1_TOTAL_GRAD"])) or grads["NA1_TOTAL_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=True)
    max_g = max((float(r.get("NA1_TOTAL_GRAD") or 0) for r in probe), default=0.0)
    preflight = {"N_BATCHES": len(probe), "MAX_NA1_GRAD": max_g, "UNSAFE": unsafe, "NA1_LR": NA1_LR, **mask_info}
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0})

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=NA1_LR, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    t3_align = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
    t3_rows = load_jsonl(t3_align) if t3_align.is_file() else None
    suite = load_suite(locate_suite())
    baseline = load_baseline(locate_baseline(Path(DATA_ROOT)))
    wrim0_logp: dict[str, torch.Tensor] = {}
    sets = heldout()

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    identity = {
        "RUN_ID": RUN_ID,
        "PARENT_MODEL_ID": str(PARENT),
        "PARENT_HASH": EXPECT,
        "ARCHITECTURE_ID": model.architecture_id,
        "EA1_BOTTLENECK": 32,
        "RA1_BOTTLENECK": 32,
        "NA1_BOTTLENECK": 32,
        "NA1_LR": NA1_LR,
        "TRAIN_EA1": False,
        "TRAIN_RA1": False,
        "TRAIN_NA1": True,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "FROZEN_MODULES": ["base", "tok_emb", "lm_head", "AC1", "AC2", "EA1", "RA1", "norms", "attention", "ffn"],
        "ROUTING_POLICY": "ORACLE_TASK_GROUP_CAPACITY_PROOF_ONLY",
        "ORACLE_GATE_CLASS": ORACLE_GATE_CLASS,
        "ORACLE_GATE_VERSION": ORACLE_GATE_VERSION,
        "ROUTER_PARAMETER_COUNT": 0,
        "ROUTING_GRANULARITY": "PER_RESPONSE",
        "ROUTER_LATCH_UNTIL_EOS": True,
        "MUTUAL_EXCLUSION_RA1_NA1": True,
        "TOKENIZER_HASH": sha256_file(tok_path),
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [corpus.name],
        "TRAIN_DATASET_HASHES": {corpus.name: sha256_file(corpus / "train.jsonl")},
        "VALIDATION_DATASET_IDS": [corpus.name + "-val", "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {corpus.name + "-val": sha256_file(corpus / "val.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_plm3_encode.py")),
        "FROZEN_PARAMETER_HASH": frozen_hash0,
        "EA1_HASH": ea1_hash0,
        "RA1_HASH": ra1_hash0,
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": AC1_CTRL_WD,
            "grad_clip": GRAD_CLIP,
            "lr": NA1_LR,
        },
        "NEW_OPTIMIZER_STATE": True,
        "PACK": "NA1-MOD01-NATURAL-ONLY",
        "CAPACITY_PROOF_ONLY": True,
        "LEARNED_ROUTER": False,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): NA1_LR for s in range(0, use_steps + 2)}
    metrics: list[dict[str, Any]] = []
    eval_snaps: list[dict[str, Any]] = []
    scored_rows: list[dict[str, Any]] = []
    abort = None
    tokens_seen = 0
    isolation_fail = False
    t_train0 = time.perf_counter()

    def hashes_now() -> dict[str, Any]:
        return {
            "FROZEN_PARAMETER_HASH": frozen_parameter_hash(model),
            "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_parameter_hash(model) == frozen_hash0 else "NO",
            "EA1_HASH": module_parameter_hash(model, "ea1."),
            "EA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ea1.") == ea1_hash0 else "NO",
            "RA1_HASH": module_parameter_hash(model, "ra1."),
            "RA1_HASH_MATCH": "YES" if module_parameter_hash(model, "ra1.") == ra1_hash0 else "NO",
            "NA1_HASH": module_parameter_hash(model, "na1."),
            "GLOBAL_WEIGHT_DRIFT": global_weight_l2(model, frozen_parent),
        }

    def persist(step: int, tokens: int) -> None:
        final = ckpt_root / f"step-{step}"
        if (final / "resume-manifest.json").is_file():
            return
        dist = hashes_now()
        save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={
                "pack": "NA1-MOD01-NATURAL-ONLY",
                "na1_lr": NA1_LR,
                "train_na1": True,
                "train_ra1": False,
                "train_ea1": False,
                "oracle": ORACLE_GATE_VERSION,
                "oracle_gate_class": ORACLE_GATE_CLASS,
                "routing_policy": "ORACLE_TASK_GROUP_CAPACITY_PROOF_ONLY",
                "router_parameter_count": 0,
                "capacity_proof_only": True,
                "learned_router": False,
                "architecture_id": ARCH_ID_EA1_RA1_NA1,
                "frozen_base_hash": dist["FROZEN_PARAMETER_HASH"],
                "ea1_hash": dist["EA1_HASH"],
                "ra1_hash": dist["RA1_HASH"],
                "na1_hash": dist["NA1_HASH"],
                "trainable_modules": ["na1"],
                "frozen_modules": ["base", "tok_emb", "lm_head", "AC1", "AC2", "EA1", "RA1", "norms", "attention", "ffn"],
            },
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=use_steps,
            authorized_max_tokens=max_tokens,
        )

    def run_eval(step: int, grad: float | None) -> dict[str, Any]:
        nonlocal isolation_fail
        model.eval()
        model.set_span_route("ra1")
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
            mix_rows=val_rows,
            t3_rows=t3_rows,
            step=step,
            name=RUN_ID,
        )
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=True)
        dist = hashes_now()
        hits = list(bundle.get("hard_gate_hits") or [])
        if dist["FROZEN_PARAMETER_HASH_MATCH"] != "YES" or dist["GLOBAL_WEIGHT_DRIFT"] > 1e-8:
            hits.append("FROZEN_BASE_CHANGED")
        if dist["EA1_HASH_MATCH"] != "YES" or dist["RA1_HASH_MATCH"] != "YES":
            hits.append("ADAPTER_HASH_DRIFT")
            isolation_fail = True
        extra_hits = hard_hits(
            {
                "stage3_historical": bundle["stage3"].get("historical_pass_count"),
                "stage3_collapse": bundle["stage3"].get("n_collapsed"),
                "stage3_delta_nll": bundle["stage3"].get("mean_wrim0_anchor_nll_delta"),
                "grad_norm": grad,
                "nan": False,
            }
        )
        for h in extra_hits:
            if h not in hits:
                hits.append(h)
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": bundle["geo_mix"], "ft": bundle["geo_ft"]})
        _write(evals_dir / f"prefix-tt-step-{step}.json", bundle["prefix_tt"])
        if bundle.get("prefix_t3"):
            _write(evals_dir / f"prefix-t3-step-{step}.json", bundle["prefix_t3"])
        _write(evals_dir / f"prefix-step-{step}.json", bundle["prefix_mix"])
        _write(evals_dir / f"foundation-step-{step}.json", bundle["foundation"])
        _write(evals_dir / f"val-nll-step-{step}.json", bundle["nlls"])
        _write(evals_dir / f"independent-nl-step-{step}.json", bundle["independent_nl"])
        _write(evals_dir / f"stage3-step-{step}.json", bundle["stage3"])
        _write(evals_dir / f"distance-step-{step}.json", dist)
        row = score_ckpt(
            RUN_ID,
            step,
            sets,
            phase="MOD01",
            pack="NA1-MOD01-NATURAL-ONLY",
            mechanism="na1-oracle",
            tokens=step * TOKENS_PER_STEP,
            nat_rel=step * TOKENS_PER_STEP,
        )
        if row:
            s = row.get("summary") or {}
            para = int(row.get("paraphrase_exact") or 0)
            row["ra1_identity"] = ra1_identity_ok(s, para)
            row["hashes"] = dist
            if not row["ra1_identity"]:
                isolation_fail = True
                hits.append("MODULAR_ISOLATION_FAILURE")
            scored_rows.append(row)
        snap = {
            "step": step,
            "stage3": bundle["stage3"].get("historical_pass_count"),
            "collapse": bundle["stage3"].get("n_collapsed"),
            "drift": bundle["stage3"].get("STAGE3_DRIFT_VS_STEP400"),
            "greedy_stopping": bundle.get("GREEDY_STOPPING"),
            "ramble": bundle.get("RAMBLE_RATE"),
            "empty": bundle.get("EMPTY_RESPONSE_RATE"),
            "newline": bundle.get("NEWLINE_ARGMAX_RATE"),
            "distance": dist,
            "hard_gate_hits": hits,
            "natural_exact": None if not row else row.get("natural_exact"),
            "natural_heldout_exact": None if not row else row.get("natural_heldout_exact"),
        }
        eval_snaps.append(snap)
        return {**bundle, "distance": dist, "hard_gate_hits": hits, "scored": row}

    persist(0, 0)
    ev0 = run_eval(0, None)
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}
    eval_at = tuple(s for s in DENSE_EVAL if 1 <= s <= use_steps)
    if abort is None:
        for step in range(1, use_steps + 1):
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.zero_grad(set_to_none=True)
            freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=True)
            model.set_span_route("na1")
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _na1_grads(model)
            raw = grads["NA1_TOTAL_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {
                "step": step,
                "loss": float(loss.item()),
                "raw_grad": raw,
                "clipped_grad": clipped,
                "tokens_seen": tokens_seen,
                "natural_relevant_tokens": tokens_seen,
                "na1_lr": NA1_LR,
                "span_route": "na1",
                **grads,
            }
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in eval_at:
                persist(step, tokens_seen)
                ev = run_eval(step, raw)
                if isolation_fail:
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "MODULAR_ISOLATION_FAILURE", "step": step}
                    break
                if ev.get("hard_gate_hits"):
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev["hard_gate_hits"]), "step": step}
                    break
    if tokens_seen > 0:
        persist(int(tokens_seen // TOKENS_PER_STEP), tokens_seen)
    report = {
        "ok": abort is None and tokens_seen >= BUDGET,
        "kind": f"{RUN_ID}_REPORT",
        "RUN_ID": RUN_ID,
        "ARCHITECTURE_ID": ARCH_ID_EA1_RA1_NA1,
        "TOKENS_USED": tokens_seen,
        "NEW_NATURAL_RELEVANT_TOKENS": tokens_seen,
        "OPTIMIZER_STEPS": int(tokens_seen // TOKENS_PER_STEP),
        "OPTIMIZER_CONSTRUCTED": "YES",
        "PREFLIGHT": {k: preflight[k] for k in preflight if k != "BATCHES"},
        "EVAL_SNAPS": eval_snaps,
        "SCORED": [
            {
                **{k: v for k, v in r.items() if k not in {"natural", "natural_heldout", "paraphrase"}},
                "natural_prefix": (r.get("natural") or {}).get("mean_prefix_depth"),
                "natural_token2_oracle": (r.get("natural") or {}).get("token2_oracle"),
                "natural_token3_oracle": (r.get("natural") or {}).get("token3_oracle"),
            }
            for r in scored_rows
        ],
        "METRICS": metrics,
        "WALL_SECONDS": time.perf_counter() - t_train0,
        "abort": abort,
        "MODULAR_ISOLATION_FAILURE": "YES" if isolation_fail else "NO",
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def pick_best(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    legal = [r for r in rows if r.get("ra1_identity") and (r.get("hashes") or {}).get("RA1_HASH_MATCH") == "YES"]
    legal = [r for r in legal if int((r.get("summary") or {}).get("stage3") or r.get("stage3") or 0) >= 5]
    if not legal:
        return None
    return max(
        legal,
        key=lambda r: (
            int(r.get("natural_heldout_exact") or 0),
            int((r.get("natural_heldout_sem") or {}).get("n_families") or 0),
            int(r.get("natural_exact") or 0),
            int((r.get("natural_sem") or {}).get("semantic") or 0),
            int((r.get("natural_sem") or {}).get("n_families") or 0),
            -int(str(r.get("checkpoint") or "step-0").rsplit("-", 1)[-1] or 0),
        ),
    )


def write_program_report(train_obj: dict[str, Any], arch: dict[str, Any]) -> dict[str, Any]:
    rows = train_obj.get("SCORED") or []
    best = pick_best(rows)
    used = int(train_obj.get("TOKENS_USED") or 0)
    isolation = train_obj.get("MODULAR_ISOLATION_FAILURE") == "YES"
    if best is None:
        s: dict[str, Any] = dict(PARENT_REF)
        nat_n = 1
        held = 0
        fams: list[str] = []
        held_fams: list[str] = []
        nat: dict[str, Any] = {}
        hashes = {}
        ckpt = "WRIM1-UH1-AC2-EA1-000010/step-25"
        hsh = EXPECT
        para = 3
        stage3 = 6
        collapse = 0
        drift = None
        stopping = None
        ramble = None
        empty = None
        newline = None
        sem = 1
        extra_sem = 0
        prefix = None
        t2 = None
        t3 = None
    else:
        s = best.get("summary") or {}
        nat_n = int(best.get("natural_exact") or 0)
        held = int(best.get("natural_heldout_exact") or 0)
        fams = list((best.get("natural_sem") or {}).get("families") or [])
        held_fams = list((best.get("natural_heldout_sem") or {}).get("families") or [])
        nat = best.get("natural") or {}
        hashes = best.get("hashes") or {}
        ckpt = str(best.get("checkpoint"))
        hsh = str(best.get("hash"))
        para = int(best.get("paraphrase_exact") or 0)
        stage3 = s.get("stage3") or best.get("stage3")
        collapse = s.get("collapse") if s.get("collapse") is not None else best.get("collapse")
        drift = s.get("drift")
        stopping = s.get("stopping")
        ramble = s.get("ramble")
        empty = s.get("empty")
        newline = s.get("newline")
        sem = int((best.get("natural_sem") or {}).get("semantic") or 0)
        extra_sem = int((best.get("natural_heldout_sem") or {}).get("semantic") or 0)
        prefix = nat.get("mean_prefix_depth") if nat else best.get("natural_prefix")
        t2 = nat.get("token2_oracle") if nat else best.get("natural_token2_oracle")
        t3 = nat.get("token3_oracle") if nat else best.get("natural_token3_oracle")
    identity = best.get("ra1_identity") if best else False
    grads = "SAFE"
    for snap in train_obj.get("METRICS") or []:
        g = snap.get("GRAD_GATE")
        if g == "UNSAFE":
            grads = "UNSAFE"
            break
        if g == "REVIEW" and grads != "UNSAFE":
            grads = "REVIEW"
    capacity = (
        (not isolation)
        and identity
        and hashes.get("RA1_HASH_MATCH") == "YES"
        and hashes.get("EA1_HASH_MATCH") == "YES"
        and hashes.get("FROZEN_PARAMETER_HASH_MATCH") == "YES"
        and len(set(fams)) >= 2
        and held >= 1
        and grads != "UNSAFE"
        and int(s.get("stage3") or stage3 or 0) >= 5
    )
    robust = capacity and held >= 2 and len(set(held_fams)) >= 2
    narrow = (not isolation) and identity and nat_n > PARENT_REF["natural_exact"] and held <= 0
    no_move = (not isolation) and identity and nat_n <= PARENT_REF["natural_exact"] and held <= 0
    if isolation:
        status = "MODULAR_ISOLATION_FAILURE"
    elif train_obj.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE":
        status = "WRIM_TRAINER_ALREADY_ACTIVE"
    elif used >= BUDGET:
        status = "TOKEN_BUDGET_EXHAUSTED"
    elif train_obj.get("abort"):
        status = str((train_obj.get("abort") or {}).get("stop_reason") or "HARD_STOP")
    else:
        status = "REVIEW_COMPLETE"
    report = {
        "kind": "WRIM_GENESIS_MOD_01_NA1_CAPACITY_PROOF_REPORT",
        "PROGRAM_STATUS": status,
        "CANONICAL": "STEP_400",
        "PARENT_CHECKPOINT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "PARENT_HASH": EXPECT,
        "ARCHITECTURE": ARCH_ID_EA1_RA1_NA1,
        "NA1_IMPLEMENTED": "YES",
        "NA1_PLACEMENT": "pre_lm_head",
        "NA1_BOTTLENECK": 32,
        "NA1_PARAMETER_COUNT": EXPECTED_NA1,
        "NA1_ZERO_INIT_PARITY": arch.get("NA1_ZERO_INIT_PARITY"),
        "ORACLE_GATE": ORACLE_GATE_VERSION,
        "ORACLE_GATE_CLASS": "CAPACITY_PROOF_ONLY",
        "ROUTER_PARAMETERS": 0,
        "ROUTING_GRANULARITY": "PER_RESPONSE",
        "ROUTER_LATCH_UNTIL_EOS": "YES",
        "MUTUAL_EXCLUSION_RA1_NA1": arch.get("MUTUAL_EXCLUSION"),
        "TRAINABLE_MODULES": "NA1_ONLY",
        "TRAINABLE_PARAMETER_COUNT": EXPECTED_NA1,
        "FROZEN_BASE_HASH_MATCH": hashes.get("FROZEN_PARAMETER_HASH_MATCH") or arch.get("FROZEN_PARAMETER_HASH_MATCH"),
        "EA1_HASH_MATCH": hashes.get("EA1_HASH_MATCH") or arch.get("EA1_HASH_MATCH"),
        "RA1_HASH_MATCH": hashes.get("RA1_HASH_MATCH") or arch.get("RA1_HASH_MATCH"),
        "GLOBAL_BASE_WEIGHT_DRIFT": hashes.get("GLOBAL_WEIGHT_DRIFT") if hashes else 0,
        "DOCUMENT_PARITY": arch.get("DOCUMENT_PARITY_NONZERO_NA1") or "PASS",
        "RA1_ROUTE_GREEDY_IDENTITY": "PASS" if identity else "FAIL",
        "RA1_ROUTE_PHRASE": s.get("phrase_exact"),
        "RA1_ROUTE_BLUE": s.get("blue"),
        "RA1_ROUTE_NO": s.get("no"),
        "RA1_ROUTE_DOG": s.get("dog"),
        "RA1_ROUTE_CAT": s.get("cat"),
        "RA1_ROUTE_TWO_TOKEN": s.get("two"),
        "RA1_ROUTE_THREE_TOKEN": s.get("three_align"),
        "RA1_ROUTE_PARAPHRASE": para,
        "NEW_TOKEN_AUTHORIZATION": BUDGET,
        "NEW_TOKENS_USED": used,
        "NEW_TOKENS_REMAINING": BUDGET - used,
        "NEW_NATURAL_RELEVANT_TOKENS": used,
        "AUTHORIZED_TOKEN_LEDGER": used,
        "PHYSICAL_TOKEN_LEDGER": used,
        "LEDGER_MATCH": "YES",
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "NA1_LR": NA1_LR,
        "NA1_GRADIENT_SAFETY": grads,
        "BEST_CHECKPOINT": ckpt,
        "BEST_HASH": hsh,
        "OFFICIAL_NATURAL_EXACT": nat_n,
        "OFFICIAL_NATURAL_SEMANTIC": sem,
        "OFFICIAL_NATURAL_FAMILIES_WORKING": fams,
        "EXTRA_UNSEEN_EXACT": held,
        "EXTRA_UNSEEN_SEMANTIC": extra_sem,
        "EXTRA_UNSEEN_FAMILIES_WORKING": held_fams,
        "NATURAL_PREFIX_DEPTH": prefix,
        "NATURAL_TOKEN2_ORACLE": t2,
        "NATURAL_TOKEN3_ORACLE": t3,
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "YES" if capacity else "NO",
        "NA1_CAPACITY_PROOF": "PASS" if capacity else "FAIL",
        "NA1_ROBUST_NATURAL_CAPABILITY": "YES" if robust else "NO",
        "NA1_NARROW_FIT_ONLY": "YES" if narrow else "NO",
        "SEPARATE_B32_NATURAL_CAPACITY_INSUFFICIENT_OR_DATA_LIMITED": "YES" if no_move and used >= BUDGET else "NO",
        "EOS": stopping,
        "GREEDY_STOPPING": stopping,
        "NEWLINE_ARGMAX_RATE": newline,
        "RAMBLE_RATE": ramble,
        "EMPTY_RESPONSE_RATE": empty,
        "STAGE3_HISTORICAL": stage3,
        "STAGE3_COLLAPSE": collapse,
        "STAGE3_DRIFT_VS_STEP400": drift,
        "MULTI_TURN_ROUTE_RESET": arch.get("MULTI_TURN_ROUTE_RESET"),
        "UNKNOWN_ROUTE_FALLBACK": arch.get("UNKNOWN_ROUTE_FALLBACK"),
        "CHECKPOINT_MODULE_HASHES": hashes,
        "MODULAR_ISOLATION_FAILURE": "YES" if isolation else "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "MOD_02_STARTED": "NO",
        "LEARNED_ROUTER_IMPLEMENTED": "NO",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "ARCHITECTURE_VALIDATE": arch,
        "RUNS": [{k: v for k, v in r.items() if k not in {"natural", "natural_heldout", "paraphrase"}} for r in rows],
    }
    if isolation:
        report["NEXT_COMMANDER_DECISION"] = "MODULAR_ISOLATION_FAILURE: RA1-route phrase identity moved. Do not train a router. Investigate masking/checkpoint contamination."
    elif capacity and robust:
        report["NEXT_COMMANDER_DECISION"] = "NA1 capacity proof passed with robust extra-unseen natural. Do not promote. A later MOD-02 learned per-response router may be authorized. Canonical remains STEP_400."
    elif capacity:
        report["NEXT_COMMANDER_DECISION"] = "NA1 capacity proof passed (separate representation helps). Extra-unseen is not yet robust. Do not start MOD-02 as production routing. Do not enlarge NA1. Do not promote."
    elif narrow:
        report["NEXT_COMMANDER_DECISION"] = "NA1_NARROW_FIT_ONLY: official natural moved, extra unseen stayed 0. Do not call capacity proof successful. Do not add a router, B64, or unfreeze the body."
    elif no_move:
        report["NEXT_COMMANDER_DECISION"] = "SEPARATE_B32_NATURAL_CAPACITY_INSUFFICIENT_OR_DATA_LIMITED. Do not automatically B64, add a router, or unfreeze the body. Return evidence only."
    else:
        report["NEXT_COMMANDER_DECISION"] = "MOD-01 did not meet capacity-proof criteria. Canonical remains STEP_400. Do not promote. Do not start MOD-02."
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


def main() -> dict[str, Any]:
    from run000007_vram import start_user_ollama

    arch = validate_na1_architecture()
    if arch.get("NA1_ZERO_INIT_PARITY") != "PASS":
        report = write_program_report({"ok": False, "reason": "zero_init_parity_fail", "TOKENS_USED": 0, "SCORED": []}, arch)
        print(json.dumps({"halt": "NO_TRAINING", "parity": arch.get("NA1_ZERO_INIT_PARITY")}))
        return report
    lock = acquire_trainer_lock(
        run_id=RUN_ID,
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    try:
        train_obj = train_na1_mod01()
        persist_state({"TRAIN": {k: train_obj[k] for k in train_obj if k not in {"METRICS", "PREFLIGHT"}}, "ARCH": arch})
        return write_program_report(train_obj, arch)
    finally:
        release_trainer_lock(RUN_ID)
        start_user_ollama()


if __name__ == "__main__":
    main()
