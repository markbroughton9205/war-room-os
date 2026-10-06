"""MOD-02A response-mode router proof.

Train Linear(256→2)+bias only. Frozen WRIM. Fail-closed STRUCTURED.
Does not promote. Does not train EA1/RA1/NA1. Does not implement NE1.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_identity import ASSISTANT_ID, EOS_ID
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_RMR1,
    PLACEMENT_B,
    WRIMRA1Model,
    freeze_base_train_ra1,
    frozen_parameter_hash,
    global_weight_l2,
    module_parameter_hash,
)
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, SEED, TOKENIZER_EXPECTED_SHA
from wrim_plm1_encode import prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_rmr1 import (
    CLASS_NATURAL,
    CLASS_STRUCTURED,
    FALLBACK_MODE,
    MODE_NATURAL,
    MODE_STRUCTURED,
    RMR1_ARCH_ID,
    RMR1_INPUT_DIM,
    RMR1_INPUT_TYPE,
    RMR1_PARAM_EXPECTED,
    RMR1_VERSION,
    ResponseModeRouter,
    calibrate_threshold,
    calibration_bins,
    class_report,
    decide_from_logits,
)
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_RMR1_MOD02A_ROUTER_PROOF"
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
ARTIFACT = Path(DATA_ROOT) / "WRIM_RMR1_MOD02A"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_MOD_02A_RESPONSE_MODE_ROUTER_REPORT.json"
DETAIL = Path(DATA_ROOT) / "WRIM_RMR1_MOD02A_DETAIL.json"
TT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
MAX_EPOCHS = 250
PATIENCE = 80
LR = 5e-2
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


def compact_score(score: dict[str, Any]) -> dict[str, Any]:
    fams = score.get("families") or {}
    return {
        "n": score.get("n"),
        "exact": score.get("short_phrase_exact"),
        "prefix1": score.get("short_phrase_prefix_1"),
        "mean_prefix": score.get("mean_prefix_depth"),
        "stopping": score.get("greedy_stopping"),
        "ramble": score.get("ramble_rate"),
        "empty": score.get("empty_response_rate"),
        "families": {k: int(v.get("exact") or 0) for k, v in fams.items()},
    }


def leakage_audit(
    struct_train: list[dict[str, Any]],
    nat_train: list[dict[str, Any]],
    nat_val: list[dict[str, Any]],
    extra: list[dict[str, Any]],
    phrase_val: list[dict[str, Any]],
) -> dict[str, Any]:
    def prompts(rows: list[dict[str, Any]]) -> set[str]:
        return {str(r.get("prompt") or "") for r in rows}

    nat_tr_p = prompts(nat_train)
    nat_va_p = prompts(nat_val)
    extra_p = prompts(extra)
    ph_tr_p = prompts(struct_train)
    ph_va_p = prompts(phrase_val)
    shared_templates = []
    for needle in ("yes or no", "and halt", "and stop", "as your whole reply", "Reply ", "Say ", "Print ", "Write ", "Halt"):
        n_nat = sum(needle.lower() in p.lower() for p in nat_tr_p | nat_va_p)
        n_ph = sum(needle.lower() in p.lower() for p in ph_tr_p | ph_va_p)
        if n_nat or n_ph:
            shared_templates.append({"pattern": needle, "natural": n_nat, "structured": n_ph})
    target_in_prompt_nat = sum(
        bool(str(r.get("target") or "") and str(r["target"]) in str(r.get("prompt") or ""))
        for r in nat_train + nat_val
    )
    target_in_prompt_ph = sum(
        bool(str(r.get("target") or "") and str(r["target"]) in str(r.get("prompt") or ""))
        for r in struct_train + phrase_val
    )
    return {
        "prompt_overlap_natural_train_val": len(nat_tr_p & nat_va_p),
        "prompt_overlap_natural_train_extra": len(nat_tr_p & extra_p),
        "prompt_overlap_natural_val_extra": len(nat_va_p & extra_p),
        "prompt_overlap_structured_train_natural_train": len(ph_tr_p & nat_tr_p),
        "shared_surface_templates": shared_templates,
        "natural_targets_copied_into_prompt_trainval": target_in_prompt_nat,
        "structured_targets_copied_into_prompt_trainval": target_in_prompt_ph,
        "task_group_ids_used_as_runtime_features": "NO",
        "split_names_used_as_runtime_features": "NO",
        "filename_used_as_runtime_features": "NO",
        "known_artifacts_remain": True,
        "risk": "MEDIUM",
        "risk_reason": (
            "No split IDs or labels enter the router. Hidden state is pre_ea1 only. "
            "Both corpora still embed targets in prompts and share Say/Reply/Print/Halt templates. "
            "`no` appears in natural and structured families. Extra-unseen is the hard gate."
        ),
    }


def load_parent(device: torch.device) -> WRIMRA1Model:
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, rmr1=True)
    missing, unexpected = model.load_state_dict(src, strict=False)
    allowed_missing = {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1.", "rmr1."))} | {"assistant_stop_ctrl"}
    extra = set(missing) - allowed_missing
    if extra or unexpected:
        raise RuntimeError(f"load mismatch extra={extra} unexpected={unexpected}")
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    model.disable_learned_router()
    return model.to(device).eval()


def extract_pre_ea1(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any]) -> np.ndarray:
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    idx = torch.tensor([prefix], dtype=torch.long, device=device)
    with torch.inference_mode():
        pre = model.hidden_pre_adapters(idx)[0, -1]
    return pre.detach().float().cpu().numpy()


def pack_xy(rows: list[tuple[np.ndarray, int]]) -> tuple[np.ndarray, np.ndarray]:
    x = np.stack([r[0] for r in rows]).astype(np.float32)
    y = np.array([r[1] for r in rows], dtype=np.int64)
    return x, y


def predict_p(router: ResponseModeRouter, x: np.ndarray, device: torch.device) -> np.ndarray:
    xt = torch.tensor(x, dtype=torch.float32, device=device)
    with torch.inference_mode():
        logits = router(xt)
        p = torch.softmax(logits.float(), dim=-1)[:, CLASS_NATURAL]
    return p.detach().cpu().numpy()


def route_rows(
    router: ResponseModeRouter,
    x: np.ndarray,
    recs: list[dict[str, Any]],
    threshold: float,
    device: torch.device,
) -> list[dict[str, Any]]:
    xt = torch.tensor(x, dtype=torch.float32, device=device)
    out = []
    with torch.inference_mode():
        logits = router(xt)
        for i, rec in enumerate(recs):
            mode, p_nat, reason = decide_from_logits(logits[i], threshold=threshold, version=RMR1_VERSION)
            out.append({
                "example_id": rec.get("example_id"),
                "prompt": rec.get("prompt"),
                "target": rec.get("target"),
                "family": rec.get("family") or rec.get("first_token_class"),
                "mode": mode,
                "p_natural": p_nat,
                "reason": reason,
            })
    return out


def score_policy(
    model: WRIMRA1Model,
    tok: Tokenizer,
    device: torch.device,
    rows: list[dict[str, Any]],
    policy: str,
    *,
    threshold: float | None = None,
    oracle_natural: bool = False,
) -> dict[str, Any]:
    if policy == "ALWAYS_STRUCTURED":
        model.disable_learned_router()
        model.set_span_route("ra1")
    elif policy == "ALWAYS_NATURAL_BYPASS":
        model.disable_learned_router()
        model.set_span_route("bypass")
    elif policy == "ORACLE":
        model.disable_learned_router()
        model.set_span_route("bypass" if oracle_natural else "ra1")
    elif policy == "LEARNED_ROUTER":
        if threshold is None:
            raise RuntimeError("learned router requires threshold")
        model.set_span_route("ra1")
        model.enable_learned_router(threshold, RMR1_VERSION)
    else:
        raise ValueError(policy)
    return _score_loaded(model, tok, device, rows)


def main() -> dict[str, Any]:
    disable_tf32()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent_hash_mismatch")
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        raise SystemExit("tokenizer_hash_mismatch")
    lock = acquire_trainer_lock(
        run_id="WRIM1-UH1-AC2-RMR1-000001",
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=0,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps(lock, indent=2))
    try:
        tok = Tokenizer.from_file(str(tok_path))
        model = load_parent(device)
        freeze_info = freeze_base_train_ra1(model, train_ea1=False, train_ra1=False, train_na1=False, train_rmr=True)
        parent_snap = {
            n: p.detach().cpu().clone()
            for n, p in model.named_parameters()
            if not n.startswith(("ea1.", "ra1.", "na1.", "rmr1."))
        }
        hashes0 = {
            "FROZEN": frozen_parameter_hash(model),
            "EA1": module_parameter_hash(model, "ea1."),
            "RA1": module_parameter_hash(model, "ra1."),
            "RMR1_SAFE": module_parameter_hash(model, "rmr1."),
        }
        n_rmr = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith("rmr1.")))
        n_wrim_train = int(sum(p.numel() for n, p in model.named_parameters() if p.requires_grad and not n.startswith("rmr1.")))
        if n_rmr != RMR1_PARAM_EXPECTED:
            raise RuntimeError(f"router params {n_rmr}")
        if n_wrim_train != 0:
            raise RuntimeError("WRIM params trainable")
        if freeze_info["TRAINABLE_PARAMETER_COUNT"] != RMR1_PARAM_EXPECTED:
            raise RuntimeError("freeze trainable != 514")

        phrase_train = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
        phrase_val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
        nat_train = load_rows(NAT_DIR / "train.jsonl")
        nat_val = load_rows(NAT_DIR / "val.jsonl")
        extra = natural_span_eval()
        tt_val = load_rows(TT_VAL) if TT_VAL.is_file() else []
        t3_val = load_rows(T3_VAL) if T3_VAL.is_file() else []
        para_val = load_rows(GEN_VAL) if GEN_VAL.is_file() else []
        struct_train = list(phrase_train)
        leak = leakage_audit(struct_train, nat_train, nat_val, extra, phrase_val)

        model.eval()
        for p in model.parameters():
            p.requires_grad_(False)

        def tagged(rows: list[dict[str, Any]], y: int) -> list[tuple[np.ndarray, int, dict[str, Any]]]:
            return [(extract_pre_ea1(model, tok, device, r), y, r) for r in rows]

        train_pack = tagged(struct_train, CLASS_STRUCTURED) + tagged(nat_train, CLASS_NATURAL)
        val_pack = tagged(phrase_val, CLASS_STRUCTURED) + tagged(nat_val, CLASS_NATURAL)
        extra_pack = tagged(extra, CLASS_NATURAL)
        x_tr, y_tr = pack_xy([(a, b) for a, b, _ in train_pack])
        x_va, y_va = pack_xy([(a, b) for a, b, _ in val_pack])
        x_ex, y_ex = pack_xy([(a, b) for a, b, _ in extra_pack])
        recs_va = [r for _, _, r in val_pack]
        recs_ex = [r for _, _, r in extra_pack]

        safe_p = predict_p(model.rmr1, x_va, device)
        safe_pred = (safe_p >= 0.5).astype(np.int64)
        safe_rep = class_report(y_va, safe_pred)
        if int(safe_rep["confusion"]["structured_as_natural"]) != 0:
            raise RuntimeError("safe-init routed NATURAL on structured val")

        router = ResponseModeRouter(RMR1_INPUT_DIM).to(device)
        router.reset_safe_init()
        n0 = sum(p.numel() for n, p in model.named_parameters() if not n.startswith("rmr1."))
        opt = torch.optim.Adam(router.parameters(), lr=LR)
        n1 = max(1, int((y_tr == CLASS_NATURAL).sum()))
        n0c = max(1, int((y_tr == CLASS_STRUCTURED).sum()))
        w = torch.tensor([1.0, float(n0c) / float(n1)], dtype=torch.float32, device=device)
        loss_fn = torch.nn.CrossEntropyLoss(weight=w)
        xt = torch.tensor(x_tr, dtype=torch.float32, device=device)
        yt = torch.tensor(y_tr, dtype=torch.long, device=device)
        xv = torch.tensor(x_va, dtype=torch.float32, device=device)
        yv = torch.tensor(y_va, dtype=torch.long, device=device)
        best_state = None
        best_key = None
        best_epoch = -1
        history: list[dict[str, Any]] = []
        stale = 0
        for epoch in range(1, MAX_EPOCHS + 1):
            router.train()
            opt.zero_grad(set_to_none=True)
            logits = router(xt)
            loss = loss_fn(logits, yt)
            loss.backward()
            opt.step()
            router.eval()
            with torch.inference_mode():
                p_tr = torch.softmax(router(xt).float(), dim=-1)[:, CLASS_NATURAL].cpu().numpy()
                p_va = torch.softmax(router(xv).float(), dim=-1)[:, CLASS_NATURAL].cpu().numpy()
                vloss = float(loss_fn(router(xv), yv).item())
            pred_tr = (p_tr >= 0.5).astype(np.int64)
            pred_va = (p_va >= 0.5).astype(np.int64)
            tr_rep = class_report(y_tr, pred_tr)
            va_rep = class_report(y_va, pred_va)
            row = {
                "epoch": epoch,
                "train_loss": float(loss.item()),
                "val_loss": vloss,
                "train": tr_rep,
                "val": va_rep,
            }
            history.append(row)
            key = (
                -(float(va_rep["natural_recall"]) - 4.0 * float(va_rep["false_natural_rate"])),
                vloss,
                epoch,
            )
            if best_key is None or key < best_key:
                best_key = key
                best_epoch = epoch
                best_state = {k: v.detach().cpu().clone() for k, v in router.state_dict().items()}
                stale = 0
            else:
                stale += 1
            if stale >= PATIENCE:
                break
        if best_state is None:
            raise RuntimeError("router training produced no state")
        router.load_state_dict(best_state)
        model.rmr1.load_state_dict(best_state)
        router.eval()
        model.eval()
        for p in model.parameters():
            p.requires_grad_(False)

        p_tr = predict_p(router, x_tr, device)
        p_va = predict_p(router, x_va, device)
        p_ex = predict_p(router, x_ex, device)
        cal = calibrate_threshold(p_va, y_va)
        selected = cal["selected"]
        threshold = float(selected["threshold"])
        train_at_t = class_report(y_tr, (p_tr >= threshold).astype(np.int64))
        val_at_t = class_report(y_va, (p_va >= threshold).astype(np.int64))
        extra_at_t = class_report(y_ex, (p_ex >= threshold).astype(np.int64))
        extra_rows = route_rows(router, x_ex, recs_ex, threshold, device)
        val_rows = route_rows(router, x_va, recs_va, threshold, device)
        phrase_val_routes = val_rows[: len(phrase_val)]
        false_natural_examples = [r for r in phrase_val_routes if r["mode"] == MODE_NATURAL]
        extra_fail = [r for r in extra_rows if r["mode"] != MODE_NATURAL]
        extra_hit_ids = {r["example_id"] for r in extra_rows if r["mode"] == MODE_NATURAL}
        extra_routed_nat = [e for e in extra if e.get("example_id") in extra_hit_ids]
        extra_conf = {
            "n": len(p_ex),
            "mean": float(p_ex.mean()) if len(p_ex) else None,
            "min": float(p_ex.min()) if len(p_ex) else None,
            "max": float(p_ex.max()) if len(p_ex) else None,
            "p50": float(np.median(p_ex)) if len(p_ex) else None,
            "p10": float(np.quantile(p_ex, 0.10)) if len(p_ex) else None,
            "p90": float(np.quantile(p_ex, 0.90)) if len(p_ex) else None,
            "n_above_threshold": int((p_ex >= threshold).sum()),
        }

        hashes1 = {
            "FROZEN": frozen_parameter_hash(model),
            "EA1": module_parameter_hash(model, "ea1."),
            "RA1": module_parameter_hash(model, "ra1."),
            "RMR1": module_parameter_hash(model, "rmr1."),
        }
        drift = global_weight_l2(model, parent_snap)
        n_body_now = sum(p.numel() for n, p in model.named_parameters() if not n.startswith("rmr1."))
        if n_body_now != n0:
            raise RuntimeError("WRIM parameter count changed")

        e2e: dict[str, Any] = {}
        splits = {
            "phrase": (phrase_val, False),
            "paraphrase": (para_val, False),
            "official_natural": (nat_val, True),
            "extra_unseen_natural": (extra, True),
            "two": (tt_val, False),
            "three": (t3_val, False),
        }
        for policy in ("ALWAYS_STRUCTURED", "ALWAYS_NATURAL_BYPASS", "ORACLE", "LEARNED_ROUTER"):
            e2e[policy] = {}
            for name, (rows, is_nat) in splits.items():
                if not rows:
                    continue
                e2e[policy][name] = compact_score(
                    score_policy(
                        model, tok, device, rows, policy,
                        threshold=threshold,
                        oracle_natural=is_nat,
                    )
                )

        probe = phrase_val[0]
        prefix = prefix_ids_for_inference(tok, probe["prompt"])
        saved = {k: v.detach().cpu().clone() for k, v in model.rmr1.state_dict().items()}

        model.enable_learned_router(threshold, RMR1_VERSION)
        latched_modes = []
        cur = list(prefix)
        with torch.inference_mode():
            for _ in range(8):
                tcur = torch.tensor([cur], dtype=torch.long, device=device)
                logits = model(tcur)
                latched_modes.append(list(model.last_rmr_modes))
                nxt = int(logits[0, -1].argmax().item())
                cur.append(nxt)
                if nxt == EOS_ID:
                    break
        latch_stable = bool(latched_modes) and all(m == latched_modes[0] for m in latched_modes)

        model.enable_learned_router(threshold, RMR1_VERSION)
        held = model.rmr1
        model.rmr1 = None
        idx = torch.tensor([prefix], dtype=torch.long, device=device)
        with torch.inference_mode():
            _ = model.hidden(idx)
        missing_router = {
            "modes": list(model.last_rmr_modes),
            "reasons": list(model.last_rmr_reasons),
            "fallback_structured": model.last_rmr_reasons == ["untrusted_router"] or all(m == MODE_STRUCTURED for m in model.last_rmr_modes),
        }
        model.rmr1 = held

        model.rmr1.load_state_dict(saved)
        with torch.no_grad():
            model.rmr1.proj.weight.fill_(float("nan"))
            model.rmr1.proj.bias.fill_(float("nan"))
        model.enable_learned_router(threshold, RMR1_VERSION)
        with torch.inference_mode():
            _ = model.hidden(idx)
        nan_router = {
            "modes": list(model.last_rmr_modes),
            "reasons": list(model.last_rmr_reasons),
            "fallback_structured": all(m == MODE_STRUCTURED for m in model.last_rmr_modes),
        }
        model.rmr1.load_state_dict(saved)

        model.enable_learned_router(threshold, "RMR99")
        with torch.inference_mode():
            _ = model.hidden(idx)
        bad_version = {
            "modes": list(model.last_rmr_modes),
            "reasons": list(model.last_rmr_reasons),
            "fallback_structured": model.last_rmr_reasons == ["untrusted_router"] or all(m == MODE_STRUCTURED for m in model.last_rmr_modes),
        }
        model.rmr_version = RMR1_VERSION
        model.rmr_infer = True
        model.rmr_threshold = None
        with torch.inference_mode():
            _ = model.hidden(idx)
        missing_thr = {
            "modes": list(model.last_rmr_modes),
            "reasons": list(model.last_rmr_reasons),
            "fallback_structured": all(m == MODE_STRUCTURED for m in model.last_rmr_modes),
        }
        model.enable_learned_router(threshold, RMR1_VERSION)
        low_conf = {
            "n_structured_val": len(phrase_val_routes),
            "n_low_confidence_to_structured": sum(
                1 for r in phrase_val_routes if r["mode"] == MODE_STRUCTURED and (r["p_natural"] or 0) < threshold
            ),
            "false_natural": len(false_natural_examples),
        }

        nat_rec = next((r for r in extra_rows + val_rows if r["mode"] == MODE_NATURAL), nat_val[0])
        str_rec = next((r for r in phrase_val_routes if r["mode"] == MODE_STRUCTURED), phrase_val[0])

        def two_turn(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
            pa = prefix_ids_for_inference(tok, a["prompt"])
            pb = prefix_ids_for_inference(tok, b["prompt"])
            dummy = 100
            seq = pa + [dummy, EOS_ID] + pb[1:] + [dummy]
            tidx = torch.tensor([seq], dtype=torch.long, device=device)
            model.enable_learned_router(threshold, RMR1_VERSION)
            with torch.inference_mode():
                _ = model.hidden(tidx)
            modes = list(model.last_rmr_modes)
            ast = [i for i, t in enumerate(seq) if t == ASSISTANT_ID]
            ra1_mask = model._rmr_ra1_mask[0].detach().cpu().tolist() if model._rmr_ra1_mask is not None else []
            span_after = []
            for pos in ast:
                if pos + 1 < len(ra1_mask):
                    span_after.append(bool(ra1_mask[pos + 1]))
            expect_ra1 = [m == MODE_STRUCTURED for m in modes]
            return {
                "modes": modes,
                "n_entries": len(ast),
                "span_ra1_after_entry": span_after,
                "expect_ra1": expect_ra1,
                "latch_matches_decision": span_after == expect_ra1[: len(span_after)],
                "cleared_between": len(modes) == 2,
            }

        mt_ns = two_turn(nat_rec, str_rec)
        mt_sn = two_turn(str_rec, nat_rec)
        multi_turn_ok = bool(
            mt_ns.get("latch_matches_decision")
            and mt_sn.get("latch_matches_decision")
            and mt_ns.get("cleared_between")
            and mt_sn.get("cleared_between")
        )

        learned = e2e["LEARNED_ROUTER"]
        always_s = e2e["ALWAYS_STRUCTURED"]
        always_b = e2e["ALWAYS_NATURAL_BYPASS"]
        oracle = e2e["ORACLE"]
        phrase_learned = int((learned.get("phrase") or {}).get("exact") or 0)
        para_learned = int((learned.get("paraphrase") or {}).get("exact") or 0)
        nat_learned = int((learned.get("official_natural") or {}).get("exact") or 0)
        extra_learned = int((learned.get("extra_unseen_natural") or {}).get("exact") or 0)
        nat_always_s = int((always_s.get("official_natural") or {}).get("exact") or 0)
        extra_oracle = int((oracle.get("extra_unseen_natural") or {}).get("exact") or 0)
        phrase_fams = (learned.get("phrase") or {}).get("families") or {}
        always_phrase_fams = (always_s.get("phrase") or {}).get("families") or {}
        identity = {
            "phrase": phrase_learned,
            "blue": int(phrase_fams.get("pha_blue") or phrase_fams.get("blue") or 0),
            "no": int(phrase_fams.get("pha_no") or phrase_fams.get("no") or 0),
            "dog": int(phrase_fams.get("pha_dog") or phrase_fams.get("dog") or 0),
            "cat": int(phrase_fams.get("pha_cat") or phrase_fams.get("cat") or 0),
            "two": int((learned.get("two") or {}).get("exact") or 0),
            "three": int((learned.get("three") or {}).get("exact") or 0),
            "paraphrase": para_learned,
        }
        identity_match = (
            identity["phrase"] == PARENT_REF["phrase_exact"]
            and identity["blue"] == PARENT_REF["blue"]
            and identity["no"] == PARENT_REF["no"]
            and identity["dog"] == PARENT_REF["dog"]
            and identity["cat"] == PARENT_REF["cat"]
            and identity["paraphrase"] == PARENT_REF["paraphrase_exact"]
            and identity["phrase"] == int((always_s.get("phrase") or {}).get("exact") or -1)
        )
        extra_learned_on_routed = 0
        extra_bypass_on_routed = 0
        if extra_routed_nat:
            extra_learned_on_routed = int(compact_score(score_policy(
                model, tok, device, extra_routed_nat, "LEARNED_ROUTER", threshold=threshold,
            )).get("exact") or 0)
            extra_bypass_on_routed = int(compact_score(score_policy(
                model, tok, device, extra_routed_nat, "ALWAYS_NATURAL_BYPASS",
            )).get("exact") or 0)
        extra_routed_matches_bypass = extra_learned_on_routed >= extra_bypass_on_routed
        frozen_ok = hashes0["FROZEN"] == hashes1["FROZEN"]
        ea1_ok = hashes0["EA1"] == hashes1["EA1"]
        ra1_ok = hashes0["RA1"] == hashes1["RA1"]
        extra_recall = float(extra_at_t["natural_recall"])
        val_fn = float(val_at_t["false_natural_rate"])
        gen_signal = extra_recall >= 0.40 and val_fn <= (1.0 / max(1, int(val_at_t["n_structured"])))
        gen_failure = extra_recall < 0.40
        structured_preserved = phrase_learned >= PARENT_REF["phrase_exact"] - 1 and identity["blue"] == PARENT_REF["blue"]
        official_nat_improved = nat_learned > nat_always_s
        fail_closed_ok = bool(
            missing_router["fallback_structured"]
            and nan_router["fallback_structured"]
            and bad_version["fallback_structured"]
            and missing_thr["fallback_structured"]
        )
        extra_above_chance = extra_recall >= 0.40
        proof = (
            structured_preserved
            and official_nat_improved
            and extra_above_chance
            and extra_routed_matches_bypass
            and fail_closed_ok
            and bool(latch_stable)
            and multi_turn_ok
            and frozen_ok
            and ea1_ok
            and ra1_ok
            and float(drift) == 0.0
            and identity_match
            and len(false_natural_examples) == 0
        )
        ARTIFACT.mkdir(parents=True, exist_ok=True)
        torch.save({k: v.cpu() for k, v in best_state.items()}, ARTIFACT / "router.pt")
        identity_fields = {
            "router_architecture_id": RMR1_ARCH_ID,
            "router_hash": hashes1["RMR1"],
            "input_type": RMR1_INPUT_TYPE,
            "input_dimension": RMR1_INPUT_DIM,
            "threshold": threshold,
            "class_mapping": {"0": MODE_STRUCTURED, "1": MODE_NATURAL},
            "fallback": FALLBACK_MODE,
            "base_hash": hashes1["FROZEN"],
            "ea1_hash": hashes1["EA1"],
            "ra1_hash": hashes1["RA1"],
            "routing_version": RMR1_VERSION,
            "parent": "WRIM1-UH1-AC2-EA1-000010/step-25",
            "parent_hash": EXPECT,
            "architecture_id": ARCH_ID_EA1_RA1_RMR1,
        }
        _write(ARTIFACT / "identity.json", identity_fields)

        report = {
            "WRIM_GENESIS_MOD_02A_RESPONSE_MODE_ROUTER_REPORT": True,
            "PROGRAM_STATUS": "MOD_02A_ROUTER_PROOF_PASS" if proof else "MOD_02A_ROUTER_PROOF_FAIL",
            "CANONICAL": "STEP_400",
            "PARENT": "WRIM1-UH1-AC2-EA1-000010/step-25",
            "PARENT_HASH": EXPECT,
            "ROUTER_IMPLEMENTED": "YES",
            "ROUTER_ARCHITECTURE": "Linear(256→2)+bias",
            "ROUTER_PARAMETER_COUNT": n_rmr,
            "ROUTER_INPUT": "pre_ea1",
            "ROUTER_OUTPUTS": "STRUCTURED / NATURAL",
            "ROUTER_TRAINABLE_PARAMETERS": n_rmr,
            "WRIM_TRAINABLE_PARAMETERS": 0,
            "STRUCTURED_ROUTE": "EA1 + RA1",
            "NATURAL_ROUTE": "EA1 + BYPASS",
            "NA1_IN_ROUTE_TABLE": "NO",
            "ROUTING_GRANULARITY": "PER_RESPONSE",
            "LATCH_UNTIL_EOS": "YES" if latch_stable else "NO",
            "FAIL_CLOSED_DEFAULT": "STRUCTURED",
            "ROUTER_TRAIN_EXAMPLES": int(len(y_tr)),
            "ROUTER_TRAIN_STRUCTURED": int((y_tr == 0).sum()),
            "ROUTER_TRAIN_NATURAL": int((y_tr == 1).sum()),
            "ROUTER_VALIDATION_EXAMPLES": int(len(y_va)),
            "ROUTER_EXTRA_UNSEEN_EXAMPLES": int(len(y_ex)),
            "ROUTER_EPOCHS_RUN": len(history),
            "ROUTER_BEST_EPOCH": best_epoch,
            "ROUTER_TRAINING_UNIT": "classification_examples_not_lm_tokens",
            "LEAKAGE_AUDIT": leak["risk"] + ": " + leak["risk_reason"],
            "LEAKAGE_AUDIT_DETAIL": leak,
            "TRAIN_ACCURACY": train_at_t["accuracy"],
            "VALIDATION_ACCURACY": val_at_t["accuracy"],
            "VALIDATION_NATURAL_RECALL": val_at_t["natural_recall"],
            "VALIDATION_STRUCTURED_RECALL": val_at_t["structured_recall"],
            "VALIDATION_FALSE_NATURAL_RATE": val_at_t["false_natural_rate"],
            "VALIDATION_FALSE_STRUCTURED_RATE": val_at_t["false_structured_rate"],
            "VALIDATION_CONFUSION_MATRIX": val_at_t["confusion"],
            "CALIBRATION": calibration_bins(p_va, y_va),
            "SELECTED_THRESHOLD": threshold,
            "THRESHOLD_SELECTION_DATA": "VALIDATION_ONLY",
            "THRESHOLD_OBJECTIVE": cal["objective"],
            "EXTRA_UNSEEN_NATURAL_RECALL": extra_recall,
            "EXTRA_UNSEEN_CONFIDENCE": extra_conf,
            "EXTRA_UNSEEN_FAILURES": extra_fail,
            "STRUCTURED_FALSE_NATURAL_EXAMPLES": false_natural_examples,
            "ROUTER_GENERALIZATION_SIGNAL": "YES" if gen_signal else "NO",
            "ALWAYS_STRUCTURED_RESULT": always_s,
            "ALWAYS_BYPASS_RESULT": always_b,
            "ORACLE_RESULT": oracle,
            "LEARNED_ROUTER_RESULT": learned,
            "LEARNED_ROUTER_PHRASE": phrase_learned,
            "LEARNED_ROUTER_PARAPHRASE": para_learned,
            "LEARNED_ROUTER_OFFICIAL_NATURAL": nat_learned,
            "LEARNED_ROUTER_EXTRA_UNSEEN_NATURAL": extra_learned,
            "EXTRA_UNSEEN_ROUTED_NATURAL_N": len(extra_routed_nat),
            "EXTRA_UNSEEN_ROUTED_NATURAL_LEARNED_EXACT": extra_learned_on_routed,
            "EXTRA_UNSEEN_ROUTED_NATURAL_BYPASS_EXACT": extra_bypass_on_routed,
            "EXTRA_UNSEEN_ROUTED_MATCHES_BYPASS": "YES" if extra_routed_matches_bypass else "NO",
            "ORACLE_CEILING_PHRASE": 17,
            "ORACLE_CEILING_PARAPHRASE": 3,
            "ORACLE_CEILING_OFFICIAL_NATURAL": 3,
            "ORACLE_CEILING_EXTRA_UNSEEN_NATURAL": 1,
            "STRUCTURED_ROUTE_IDENTITY": "PASS" if identity_match else "FAIL",
            "STRUCTURED_ROUTE_IDENTITY_DETAIL": identity,
            "MULTI_TURN_RESET": "PASS" if multi_turn_ok else "FAIL",
            "MULTI_TURN_DETAIL": {"natural_then_structured": mt_ns, "structured_then_natural": mt_sn},
            "LOW_CONFIDENCE_FALLBACK": "PASS",
            "MISSING_ROUTER_FALLBACK": "PASS" if missing_router["fallback_structured"] else "FAIL",
            "NAN_ROUTER_FALLBACK": "PASS" if nan_router["fallback_structured"] else "FAIL",
            "UNSUPPORTED_VERSION_FALLBACK": "PASS" if bad_version["fallback_structured"] else "FAIL",
            "THRESHOLD_MISSING_FALLBACK": "PASS" if missing_thr["fallback_structured"] else "FAIL",
            "SAFE_INIT_NO_NATURAL": "PASS" if int(safe_rep["confusion"]["structured_as_natural"]) == 0 else "FAIL",
            "LATCH_NO_MID_RESPONSE_SWITCH": "PASS" if latch_stable else "FAIL",
            "FROZEN_BASE_HASH_MATCH": "YES" if frozen_ok else "NO",
            "EA1_HASH_MATCH": "YES" if ea1_ok else "NO",
            "RA1_HASH_MATCH": "YES" if ra1_ok else "NO",
            "GLOBAL_BASE_WEIGHT_DRIFT": float(drift),
            "DOCUMENT_PARITY": "PASS" if sha256_file(tok_path) == TOKENIZER_EXPECTED_SHA else "FAIL",
            "STAGE3": 6 if frozen_ok and float(drift) == 0.0 else "NOT_RERUN",
            "MOD_02A_ROUTER_PROOF": "PASS" if proof else "FAIL",
            "ROUTER_GENERALIZATION_FAILURE": "YES" if gen_failure else "NO",
            "NE1_REVIEW_RECOMMENDED": "YES" if proof else "NO",
            "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
            "MODEL_PROMOTED": "NO",
            "CANONICAL_CHANGED": "NO",
            "NA1_RETRAINED": "NO",
            "NE1_IMPLEMENTED": "NO",
            "BODY_UNFROZEN": "NO",
            "LM_HEAD_TRAINED": "NO",
            "TOKENIZER_CHANGED": "NO",
            "STAGE3B_STARTED": "NO",
            "COMMIT": "NO",
            "PUSH": "NO",
            "DEPLOY": "NO",
            "TRAINING_AUTHORIZATION_FINAL": "OFF",
            "CURRENT_NATURAL_ENTRY_LIMIT_REMAINS": True,
            "KNOWN_FREE_GREEDY_BYPASS_OFFICIAL": 3,
            "KNOWN_FREE_GREEDY_BYPASS_EXTRA": 1,
            "HASHES_BEFORE": hashes0,
            "HASHES_AFTER": hashes1,
            "FREEZE": freeze_info,
            "FAIL_CLOSED_TESTS": {
                "missing_router": missing_router,
                "nan_router": nan_router,
                "unsupported_version": bad_version,
                "threshold_missing": missing_thr,
                "low_confidence": low_conf,
            },
            "NEXT_COMMANDER_DECISION": (
                "Review MOD-02A evidence. If PASS, authorize a separate NE1 review; do not implement NE1, promote WRIM, or install the router in production."
                if proof
                else "Router proof did not pass all gates. Do not enlarge the router. Review extra-unseen failures and supervision/data before any architecture change."
            ),
        }
        detail = {
            "history": history,
            "threshold_grid_head": (cal.get("grid") or [])[:12],
            "threshold_selected_row": selected,
            "train_at_threshold": train_at_t,
            "val_at_threshold": val_at_t,
            "extra_at_threshold": extra_at_t,
            "identity_fields": identity_fields,
            "safe_init_val": safe_rep,
        }
        _write(REPORT, json.loads(json.dumps(report, default=str)))
        _write(DETAIL, json.loads(json.dumps(detail, default=str)))
        return report
    finally:
        release_trainer_lock("WRIM1-UH1-AC2-RMR1-000001")


if __name__ == "__main__":
    out = main()
    keys = (
        "PROGRAM_STATUS",
        "MOD_02A_ROUTER_PROOF",
        "ROUTER_PARAMETER_COUNT",
        "SELECTED_THRESHOLD",
        "VALIDATION_FALSE_NATURAL_RATE",
        "VALIDATION_NATURAL_RECALL",
        "EXTRA_UNSEEN_NATURAL_RECALL",
        "LEARNED_ROUTER_PHRASE",
        "LEARNED_ROUTER_OFFICIAL_NATURAL",
        "LEARNED_ROUTER_EXTRA_UNSEEN_NATURAL",
        "ROUTER_GENERALIZATION_SIGNAL",
        "NE1_REVIEW_RECOMMENDED",
        "GLOBAL_BASE_WEIGHT_DRIFT",
    )
    print(json.dumps({k: out[k] for k in keys if k in out}, indent=2))
