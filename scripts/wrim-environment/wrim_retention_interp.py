"""Phase 1 read-only interpolation between 000014 and TT-000007/step-40.

No optimizer. No backward. Interpolates only lm_head + control vectors.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

from wrim_arch_uh1_ac1_train import _write, unset_auth
from wrim_g20m_uh1 import UH1_AC2_PARAM_COUNT, WRIMUH1Model
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_retention_eval import RESPONSE_KEYS, body_keys, eval_retention_bundle, tensor_sha


PARENT_A = Path(CKPT_BASE) / "WRIM1-UH1-AC2-LMH-000014" / "step-10"
PARENT_B = Path(CKPT_BASE) / "WRIM1-UH1-AC2-TT-000007" / "step-40"
EXPECT_A = "3bca426498c1deb970c56c9ac8c460531d7484de15c764cb3559ba4d70636718"
EXPECT_B = "f4317371663a2e0dbb67c0bc51bf1e572f7ca62be8c060941ebe36093b3ee4fe"
ALPHAS = (0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00)
RUN_ID = "WRIM1-UH1-AC2-INT-000001"
TOKEN2_CE_REF = 26.50


def interpolate_response(a: dict[str, torch.Tensor], b: dict[str, torch.Tensor], alpha: float) -> dict[str, torch.Tensor]:
    out = {}
    for k, va in a.items():
        vb = b[k]
        if k in RESPONSE_KEYS:
            out[k] = ((1.0 - alpha) * va.float() + alpha * vb.float()).to(dtype=va.dtype)
        else:
            out[k] = va.clone()
    return out


def run_interp() -> dict[str, Any]:
    import os

    from safetensors.torch import load_file as load_safetensors_file
    from safetensors.torch import save_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_arch_uh1_phase_a import load_jsonl
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK
    from wrim_cpt_identity import LINUX_CKPT_ROOT
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_proven_load import disable_tf32
    from stage3a_run import load_baseline, load_suite

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    out_root = Path(CKPT_BASE) / RUN_ID
    report_path = Path(DATA_ROOT) / "WRIM_GENESIS_INTERP_000001_REPORT.json"
    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    env = verify_linux_env()
    if not env.get("ok"):
        return {"ok": False, "reason": "env_fail", "env": env}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        return {"ok": False, "reason": "tokenizer_hash_mismatch"}
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return {"ok": False, "reason": "canonical_hash_changed"}
    path_a = PARENT_A / MODEL_NAME
    path_b = PARENT_B / MODEL_NAME
    ha = sha256_file(path_a)
    hb = sha256_file(path_b)
    if ha != EXPECT_A:
        return {"ok": False, "reason": "parent_a_hash_mismatch", "got": ha, "want": EXPECT_A}
    if hb != EXPECT_B:
        return {"ok": False, "reason": "parent_b_hash_mismatch", "got": hb, "want": EXPECT_B}

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    state_a = load_safetensors_file(str(path_a))
    state_b = load_safetensors_file(str(path_b))
    if set(state_a) != set(state_b):
        return {"ok": False, "reason": "state_keys_differ", "a": sorted(state_a), "b": sorted(state_b)}

    body_diag = []
    body_mismatch = []
    for k in body_keys(state_a):
        same = bool(torch.equal(state_a[k].cpu(), state_b[k].cpu()))
        row = {"key": k, "equal": same, "sha_a": tensor_sha(state_a[k]), "sha_b": tensor_sha(state_b[k])}
        body_diag.append(row)
        if not same:
            body_mismatch.append(k)
    ctrl_diag = {}
    for k in RESPONSE_KEYS:
        if k not in state_a:
            continue
        va, vb = state_a[k].float().cpu(), state_b[k].float().cpu()
        diff = float((va - vb).norm(2).item())
        ctrl_diag[k] = {
            "l2_delta": diff,
            "equal": bool(torch.equal(state_a[k].cpu(), state_b[k].cpu())),
            "sha_a": tensor_sha(state_a[k]),
            "sha_b": tensor_sha(state_b[k]),
        }
    identity = {
        "RUN_ID": RUN_ID,
        "KIND": "READ_ONLY_RESPONSE_INTERPOLATION",
        "PARENT_A": str(PARENT_A),
        "PARENT_B": str(PARENT_B),
        "PARENT_A_HASH": ha,
        "PARENT_B_HASH": hb,
        "BODY_MISMATCH_KEYS": body_mismatch,
        "CTRL_DIAG": ctrl_diag,
        "ALPHAS": list(ALPHAS),
        "OPTIMIZER": None,
        "BACKWARD": False,
    }
    if body_mismatch:
        identity["ok"] = False
        identity["reason"] = "body_hash_mismatch_stop"
        _write(report_path, identity)
        return identity

    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    mix_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0" / "val.jsonl")
    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    suite = load_suite(locate_suite())
    baseline = load_baseline(locate_baseline(Path(DATA_ROOT)))
    wrim0_logp: dict[str, torch.Tensor] = {}

    model = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=False)
    model.load_state_dict(state_a, strict=True)
    model.to(device)
    model.freeze_inference()
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != UH1_AC2_PARAM_COUNT:
        return {"ok": False, "reason": "param_count", "n": n_params}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    out_root.mkdir(parents=True, exist_ok=True)
    evals_dir = out_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    _write(out_root / "run-identity.json", identity)

    rows = []
    for alpha in ALPHAS:
        blended = interpolate_response(state_a, state_b, float(alpha))
        missing, unexpected = model.load_state_dict(blended, strict=True)
        if missing or unexpected:
            return {"ok": False, "reason": "interp_load", "missing": list(missing), "unexpected": list(unexpected), "alpha": alpha}
        model.to(device)
        model.freeze_inference()
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
            step=int(round(alpha * 100)),
            name=f"{RUN_ID}-a{alpha:.2f}",
        )
        tag = f"{alpha:.2f}"
        rec = {
            "alpha": alpha,
            "STAGE3_HISTORICAL": bundle["stage3"]["historical_pass_count"],
            "STAGE3_COLLAPSE": bundle["stage3"]["n_collapsed"],
            "STAGE3_DRIFT_VS_STEP400": bundle["stage3"]["STAGE3_DRIFT_VS_STEP400"],
            "TOKEN2_CE": bundle["TOKEN2_CE"],
            "TOKEN2_RANK": bundle["TOKEN2_RANK"],
            "TOKEN2_PROBABILITY": bundle["TOKEN2_PROBABILITY"],
            "TOKEN2_ORACLE_SUCCESS": bundle["TOKEN2_ORACLE_SUCCESS"],
            "GREEDY_TWO_TOKEN_EXACT": bundle["GREEDY_TWO_TOKEN_EXACT"],
            "N_CLASSES_GREEDY_TWO_TOKEN": bundle["N_CLASSES_GREEDY_TWO_TOKEN"],
            "FIRST_TOKEN_CLASSES_WORKING": bundle["FIRST_TOKEN_CLASSES_WORKING"],
            "N_FIRST_TOKEN_CLASSES_WORKING": bundle["N_FIRST_TOKEN_CLASSES_WORKING"],
            "GREEDY_FIRST_TOKEN_MATCH_FT": bundle["GREEDY_FIRST_TOKEN_MATCH_FT"],
            "GREEDY_FIRST_TOKEN_MATCH_MIX": bundle["GREEDY_FIRST_TOKEN_MATCH_MIX"],
            "NEWLINE_ARGMAX_RATE": bundle["NEWLINE_ARGMAX_RATE"],
            "NEWLINE_PROBABILITY": bundle["NEWLINE_PROBABILITY"],
            "EOS_MEAN_RANK": bundle["EOS_MEAN_RANK"],
            "GREEDY_STOPPING": bundle["GREEDY_STOPPING"],
            "RAMBLE_RATE": bundle["RAMBLE_RATE"],
            "EMPTY_RESPONSE_RATE": bundle["EMPTY_RESPONSE_RATE"],
            "GREEDY_SHORT_ANSWER_CORRECT": bundle["GREEDY_SHORT_ANSWER_CORRECT"],
            "INDEPENDENT_NL_NLL": bundle["INDEPENDENT_NL_NLL"],
            "GENERAL_NL_NLL": bundle["GENERAL_NL_NLL"],
            "CODE_NLL": bundle["CODE_NLL"],
            "JSON_NLL": bundle["JSON_NLL"],
        }
        _write(evals_dir / f"interp-alpha-{tag}.json", {"row": rec, "bundle": bundle})
        rows.append(rec)
        _write(out_root / "grid.json", {"rows": rows, "identity": identity})
        print(json.dumps(rec), flush=True)

        keep = (
            int(rec["STAGE3_HISTORICAL"] or 0) == 6
            and rec["TOKEN2_CE"] is not None
            and float(rec["TOKEN2_CE"]) < TOKEN2_CE_REF
        )
        if keep or alpha in (0.00, 1.00):
            step_dir = out_root / f"alpha-{tag}"
            step_dir.mkdir(parents=True, exist_ok=True)
            cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
            save_file(cpu, str(step_dir / MODEL_NAME))
            _write(step_dir / "hashes.json", {MODEL_NAME: sha256_file(step_dir / MODEL_NAME)})
            _write(step_dir / "alpha.json", {"alpha": alpha, "keep_stage3_6": keep, **rec})

    stage3_6 = [r for r in rows if int(r.get("STAGE3_HISTORICAL") or 0) == 6]
    improved = [r for r in stage3_6 if r.get("TOKEN2_CE") is not None and float(r["TOKEN2_CE"]) < TOKEN2_CE_REF]
    best = None
    if improved:
        best = sorted(improved, key=lambda r: (float(r["TOKEN2_CE"]), float(r.get("TOKEN2_RANK") or 1e9)))[0]
    elif stage3_6:
        best = sorted(stage3_6, key=lambda r: (float(r.get("TOKEN2_CE") or 1e9), -float(r["alpha"])))[0]

    report = {
        "ok": True,
        "kind": "WRIM_GENESIS_INTERP_000001_REPORT",
        "RUN_ID": RUN_ID,
        "BODY_IDENTICAL": True,
        "CTRL_DIAG": ctrl_diag,
        "GRID": rows,
        "BEST_INTERPOLATED_STAGE3_6": best,
        "BEST_INTERPOLATION_ALPHA": None if best is None else best["alpha"],
        "INTERPOLATION_STAGE3": None if best is None else best["STAGE3_HISTORICAL"],
        "INTERPOLATION_TOKEN2_CE": None if best is None else best["TOKEN2_CE"],
        "FOUND_BETTER_STAGE3_6": bool(improved),
        "RETENTION_RECOVERY_PARENT": (
            f"{RUN_ID}/alpha-{best['alpha']:.2f}" if improved and best is not None else "WRIM1-UH1-AC2-LMH-000014/step-10"
        ),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
    }
    unset_auth()
    _write(report_path, report)
    _write(out_root / "report.json", report)
    return report


if __name__ == "__main__":
    obj = run_interp()
    print(json.dumps({k: obj.get(k) for k in (
        "ok", "reason", "BODY_IDENTICAL", "BEST_INTERPOLATION_ALPHA", "INTERPOLATION_STAGE3",
        "INTERPOLATION_TOKEN2_CE", "FOUND_BETTER_STAGE3_6", "RETENTION_RECOVERY_PARENT",
        "BEST_INTERPOLATED_STAGE3_6", "GRID",
    ) if k in obj or True}, indent=2, default=str))
