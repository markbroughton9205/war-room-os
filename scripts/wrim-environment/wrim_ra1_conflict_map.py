"""Read-only RA1 gradient conflict map. No optimizer. EA1 frozen."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model, freeze_base_train_ra1, frozen_parameter_hash
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, SEED, TOKENIZER_EXPECTED_SHA
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import (
    GROUP_ORDER,
    PRIMARY_PAIRS,
    PROTECTED_ORDER,
    capture_all_tasks,
    conflict_pairs,
    load_group_rows,
    pack_group_batches,
    write_fixed_corpus,
)
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
OUT = Path(DATA_ROOT) / "WRIM_RA1_GRADIENT_CONFLICT_MAP.json"
N_BATCHES = 3


def main() -> dict[str, Any]:
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    disable_tf32()
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        raise SystemExit("tokenizer_hash_mismatch")
    tokenizer = Tokenizer.from_file(str(tok_path))
    corpus = write_fixed_corpus()
    groups = load_group_rows(corpus)
    packed = pack_group_batches(tokenizer, groups, max(N_BATCHES, 3))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith("ea1.") or n.startswith("ra1.")} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise SystemExit(f"state_dict_mismatch {missing} {unexpected}")
    model.to(device)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=True)
    frozen = frozen_parameter_hash(model)

    per_batch = []
    acc: dict[str, torch.Tensor] | None = None
    conflict_hits = {f"{a}_vs_{b}": 0 for a, b in PRIMARY_PAIRS}
    matrix_rows = []
    for bi in range(N_BATCHES):
        cap = capture_all_tasks(model, device, packed, bi)
        grads = cap["grads"]
        pairs = conflict_pairs(grads)
        for row in pairs:
            if row["CONFLICT"] == "YES":
                conflict_hits[row["TASK_PAIR"]] += 1
        per_batch.append({
            "batch": bi,
            "pairs": pairs,
            "task_norms": {k: float(v.norm().item()) for k, v in grads.items()},
            "parts": cap["parts"],
            "infos": cap["infos"],
        })
        matrix_rows.append(cap["parts"])
        if acc is None:
            acc = {k: v.clone() for k, v in grads.items()}
        else:
            for k, v in grads.items():
                acc[k] = acc[k] + v
    assert acc is not None
    mean = {k: v / float(N_BATCHES) for k, v in acc.items()}
    mean_pairs = conflict_pairs(mean)
    by_pair = {row["TASK_PAIR"]: row for row in mean_pairs}
    any_conflict = any(row["CONFLICT"] == "YES" for row in mean_pairs) or any(v > 0 for v in conflict_hits.values())
    report = {
        "kind": "WRIM_RA1_GRADIENT_CONFLICT_MAP",
        "PARENT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "PARENT_HASH": EXPECT,
        "OPTIMIZER_CONSTRUCTED": "NO",
        "OPTIMIZER_STEPS": 0,
        "TRAIN_EA1": False,
        "TRAIN_RA1": True,
        "GROUP_ORDER": GROUP_ORDER,
        "PROTECTED_ORDER": PROTECTED_ORDER,
        "N_BATCHES": N_BATCHES,
        "FROZEN_PARAMETER_HASH": frozen,
        "TASK_GRADIENT_CONFLICT": "YES" if any_conflict else "NO",
        "CONFLICT_HIT_RATE": {k: v / float(N_BATCHES) for k, v in conflict_hits.items()},
        "MEAN_PAIRS": mean_pairs,
        "NATURAL_VS_DOG_COSINE": by_pair["natural_vs_dog"]["COSINE"],
        "NATURAL_VS_CAT_COSINE": by_pair["natural_vs_cat"]["COSINE"],
        "NATURAL_VS_NO_COSINE": by_pair["natural_vs_no"]["COSINE"],
        "NATURAL_VS_BLUE_COSINE": by_pair["natural_vs_blue"]["COSINE"],
        "NATURAL_VS_TWO_TOKEN_COSINE": by_pair["natural_vs_two"]["COSINE"],
        "NATURAL_VS_THREE_TOKEN_COSINE": by_pair["natural_vs_three"]["COSINE"],
        "NATURAL_VS_PARAPHRASE_COSINE": by_pair["natural_vs_para"]["COSINE"],
        "MEAN_TASK_NORMS": {k: float(v.norm().item()) for k, v in mean.items()},
        "MEAN_MATRIX": {k: {
            "W_DOWN_GRAD": float((mean[k] if False else 0)),
        } for k in GROUP_ORDER},
        "PER_BATCH": per_batch,
        "CORPUS": str(corpus),
    }
    mean_matrix = {}
    for name in GROUP_ORDER:
        parts_acc = {"W_DOWN_GRAD": 0.0, "W_UP_GRAD": 0.0, "ADAPTER_NORM_GRAD": 0.0}
        for row in matrix_rows:
            p = row[name]
            parts_acc["W_DOWN_GRAD"] += float(p.get("W_DOWN_GRAD") or 0)
            parts_acc["W_UP_GRAD"] += float(p.get("W_UP_GRAD") or 0)
            parts_acc["ADAPTER_NORM_GRAD"] += float(p.get("ADAPTER_NORM_GRAD") or 0)
        mean_matrix[name] = {k: v / float(N_BATCHES) for k, v in parts_acc.items()}
    report["MEAN_MATRIX"] = mean_matrix
    conflicting = [row for row in mean_pairs if row["CONFLICT"] == "YES"]
    report["CONFLICTING_PAIRS"] = conflicting
    _write(OUT, json.loads(json.dumps(report)))
    print(json.dumps({
        "TASK_GRADIENT_CONFLICT": report["TASK_GRADIENT_CONFLICT"],
        "cosines": {k: report[k] for k in report if k.endswith("_COSINE")},
        "hits": report["CONFLICT_HIT_RATE"],
        "conflicting": [r["TASK_PAIR"] for r in conflicting],
    }, indent=2), flush=True)
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return report


if __name__ == "__main__":
    main()
