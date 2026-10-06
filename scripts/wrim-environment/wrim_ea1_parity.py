"""Zero-init EA1 parity against the current RA1 checkpoint. No optimizer."""
from __future__ import annotations

import json
from pathlib import Path

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model, frozen_parameter_hash
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-CR-000006" / "step-21"
EXPECT = "a1e6de9965f93134261fa6586aa5629233eafbf426a6802cb67dc85788cfc9ec"
OUT = Path(DATA_ROOT) / "WRIM_EA1_ZERO_INIT_PARITY.json"
PHRASE_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0" / "val.jsonl"


def main() -> dict:
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent hash mismatch")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    parent = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=False)
    missing, unexpected = parent.load_state_dict(src, strict=False)
    extra = set(missing) - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise SystemExit(f"parent load mismatch {missing} {unexpected}")
    child = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = child.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in child.named_parameters() if n.startswith("ea1.")} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise SystemExit(f"child load mismatch extra={extra} unexpected={unexpected}")
    if child.ea1 is None:
        raise SystemExit("ea1 missing")
    child.ea1.reset_zero_init()
    parent.to(device).eval()
    child.to(device).eval()
    n_ea1 = child.ea1.param_count()
    frozen_match = frozen_parameter_hash(parent) == frozen_parameter_hash(child)
    idx_doc = torch.tensor([[BOS_ID, COMMANDER_ID, 9, 10, 11, 12, EOS_ID]], dtype=torch.long, device=device)
    idx_resp = torch.tensor([[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, 12, EOS_ID]], dtype=torch.long, device=device)
    with torch.inference_mode():
        d_parent = parent(idx_doc)
        d_child = child(idx_doc)
        r_parent = parent(idx_resp)
        r_child = child(idx_resp)
        span_any = bool(child.control_masks(idx_doc)["span"].any().item())
        entry_any = bool(child.control_masks(idx_resp)["entry"].any().item())
        up_zero = float(child.ea1.up.weight.abs().max().item())
    max_doc = float((d_parent - d_child).abs().max().item())
    max_resp = float((r_parent - r_child).abs().max().item())
    greedy_ok = True
    rows = [json.loads(line) for line in PHRASE_VAL.read_text(encoding="utf-8").splitlines() if line.strip()]
    from wrim_cpt_eval import greedy_from_ids
    for rec in rows:
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        a = greedy_from_ids(parent, tok, device, prefix, max_new=8)
        b = greedy_from_ids(child, tok, device, prefix, max_new=8)
        if list(a.get("new_ids") or []) != list(b.get("new_ids") or []):
            greedy_ok = False
            break
    report = {
        "PARENT": str(PARENT),
        "PARENT_HASH": EXPECT,
        "ARCHITECTURE_ID": child.architecture_id,
        "EA1_PLACEMENT": "assistant_entry_pre_lm_head",
        "EA1_BOTTLENECK": child.ea1.bottleneck,
        "EA1_PARAMETER_COUNT": n_ea1,
        "EA1_W_UP_MAX_ABS": up_zero,
        "MAX_ABS_LOGIT_DIFF_DOCUMENT": max_doc,
        "MAX_ABS_LOGIT_DIFF_RESPONSE": max_resp,
        "DOCUMENT_SPAN_ANY": span_any,
        "RESPONSE_ENTRY_ANY": entry_any,
        "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_match else "NO",
        "GREEDY_PARITY": "PASS" if greedy_ok else "FAIL",
        "EA1_ZERO_INIT_PARITY": "PASS" if max_doc < 1e-6 and max_resp < 1e-6 and greedy_ok and frozen_match and n_ea1 <= 40000 and up_zero == 0.0 else "FAIL",
        "OPTIMIZER_STEPS": 0,
    }
    _write(OUT, report)
    print(json.dumps(report, indent=2))
    if report["EA1_ZERO_INIT_PARITY"] != "PASS":
        raise SystemExit(1)
    return report


if __name__ == "__main__":
    main()
