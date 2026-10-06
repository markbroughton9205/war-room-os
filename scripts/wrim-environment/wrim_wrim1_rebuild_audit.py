"""Read-only WRIM-1 rebuild audit. No optimizer. No WRIM-1 training."""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_hvu_identity import DATA_ROOT

OUT = Path(DATA_ROOT) / "WRIM1_FOUNDATION_REBUILD_AUDIT.json"

SAMPLES = {
    "english_prose": "The commander asked whether the model could follow instructions across held-out wording without collapsing structured phrase identity.",
    "instruction": "Return a JSON object with keys ok, n, and id. Set ok true, n 7, and id willow.",
    "json": '{"ok": true, "n": 7, "id": "willow", "items": [1, 2, 3]}',
    "code": "def add(a, b):\n    return a + b\nprint(add(2, 3))\n",
    "numbers": "The values are 0, 1, 2, 12, 64, 256, 1024, 3.14159, and -18.",
    "whitespace": "line one\n\nline two\ttabbed  double  space",
    "contractions": "don't can't it's we're they'll I've that's won't",
    "domain": "tokenizer vocabulary residual adapter lm_head RMSNorm SwiGLU pretraining checkpoint",
    "role": "<|commander|>\nGive a short answer.<|assistant|>ok",
}


def count_params(*, vocab: int, d: int, layers: int, d_ff: int, untied: bool) -> dict[str, int]:
    emb = vocab * d
    head = vocab * d if untied else 0
    block = 4 * d * d + 3 * d * d_ff + 2 * d
    body = layers * block + d
    total = emb + head + body
    return {"tok_emb": emb, "lm_head": head, "per_block": block, "body_plus_norm": body, "total": total}


def tok_stats(tokenizer, text: str) -> dict[str, Any]:
    ids = tokenizer.encode(text, add_special_tokens=False).ids
    words = [w for w in text.replace("\n", " ").replace("\t", " ").split(" ") if w]
    chars = len(text)
    pieces = [tokenizer.decode([i]) for i in ids]
    return {
        "n_tokens": len(ids),
        "n_words": len(words),
        "n_chars": chars,
        "tokens_per_word": round(len(ids) / max(1, len(words)), 4),
        "tokens_per_char": round(len(ids) / max(1, chars), 4),
        "ids_head": ids[:24],
        "pieces_head": pieces[:24],
    }


def main() -> dict[str, Any]:
    from tokenizers import Tokenizer

    dump = resolve_dump_root(None)
    tok_path = None if dump is None else dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok = Tokenizer.from_file(str(tok_path)) if tok_path and tok_path.is_file() else None
    vocab = tok.get_vocab_size() if tok else None
    specials = {}
    if tok:
        for name in ("<|bos|>", "<|eos|>", "<|pad|>", "<|system|>", "<|commander|>", "<|assistant|>", "Ċ"):
            tid = tok.token_to_id(name)
            specials[name] = tid
        # also try known IDs
        specials_by_id = {i: tok.decode([i]) for i in range(0, 8)}
    else:
        specials_by_id = {}

    frag = {k: tok_stats(tok, v) for k, v in SAMPLES.items()} if tok else {}

    shards = None
    if dump is not None:
        man = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json"
        if man.is_file():
            shards = json.loads(man.read_text(encoding="utf-8"))

    gpu = {}
    try:
        import subprocess
        smi = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,memory.free,driver_version,utilization.gpu", "--format=csv,noheader,nounits"],
            text=True,
        ).strip()
        parts = [p.strip() for p in smi.split(",")]
        gpu = {
            "name": parts[0],
            "memory_total_mib": float(parts[1]),
            "memory_used_mib": float(parts[2]),
            "memory_free_mib": float(parts[3]),
            "driver": parts[4],
            "util_pct": float(parts[5]) if len(parts) > 5 else None,
        }
    except Exception as exc:  # noqa: BLE001
        gpu = {"error": str(exc)}

    mem_kib = int(Path("/proc/meminfo").read_text().split("MemTotal:")[1].split("kB")[0])
    avail_kib = int(Path("/proc/meminfo").read_text().split("MemAvailable:")[1].split("kB")[0])
    disk = os.statvfs("/")
    disk_free_g = disk.f_bavail * disk.f_frsize / (1024 ** 3)

    sizes = {
        "A_23M_current_uh1_untied": {
            **count_params(vocab=15126, d=256, layers=18, d_ff=768, untied=True),
            "d_model": 256, "n_layers": 18, "n_heads": 4, "d_ff": 768, "head_dim": 64, "untied": True,
        },
        "A_tied_wrim0": {
            **count_params(vocab=15126, d=256, layers=18, d_ff=768, untied=False),
            "d_model": 256, "n_layers": 18, "n_heads": 4, "d_ff": 768, "head_dim": 64, "untied": False,
        },
        "B_50M": {
            **count_params(vocab=15126, d=384, layers=20, d_ff=1152, untied=True),
            "d_model": 384, "n_layers": 20, "n_heads": 6, "d_ff": 1152, "head_dim": 64, "untied": True,
        },
        "C_100M": {
            **count_params(vocab=15126, d=512, layers=24, d_ff=1536, untied=True),
            "d_model": 512, "n_layers": 24, "n_heads": 8, "d_ff": 1536, "head_dim": 64, "untied": True,
        },
    }
    for k, v in sizes.items():
        n = v["total"]
        v["param_bytes_fp32"] = n * 4
        v["adamw_state_bytes"] = n * 4 * 2
        v["ckpt_mib_fp32"] = round(n * 4 / (1024 * 1024), 2)
        v["optimizer_mib"] = round(n * 4 * 2 / (1024 * 1024), 2)
        v["params_plus_opt_mib"] = round(n * 4 * 3 / (1024 * 1024), 2)

    vram_probe = []
    try:
        import torch
        import torch.nn as nn
        from wrim_g20m import Block, RMSNorm, VOCAB_SIZE, ROPE_THETA

        class Probe(nn.Module):
            def __init__(self, d, layers, heads, d_ff, vocab, untied):
                super().__init__()
                self.tok_emb = nn.Embedding(vocab, d)
                hd = d // heads
                self.layers = nn.ModuleList([Block(d, heads, hd, d_ff, ROPE_THETA) for _ in range(layers)])
                self.norm_f = RMSNorm(d)
                self.lm_head = nn.Linear(d, vocab, bias=False) if untied else None

            def forward(self, idx):
                x = self.tok_emb(idx)
                for layer in self.layers:
                    x = layer(x)
                x = self.norm_f(x)
                if self.lm_head is None:
                    return torch.nn.functional.linear(x, self.tok_emb.weight)
                return self.lm_head(x)

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        specs = [
            ("A_23M", 256, 18, 4, 768, True),
            ("B_50M", 384, 20, 6, 1152, True),
            ("C_100M", 512, 24, 8, 1536, True),
        ]
        for name, d, L, H, ff, untied in specs:
            if device.type == "cuda":
                torch.cuda.reset_peak_memory_stats()
                torch.cuda.empty_cache()
            m = Probe(d, L, H, ff, 15126, untied).to(device)
            n = int(sum(p.numel() for p in m.parameters()))
            x = torch.randint(1, 15126, (8, 512), device=device)
            t0 = time.perf_counter()
            logits = m(x)
            loss = logits[:, :-1].float().reshape(-1, 15126).mean() * 0.0 + torch.nn.functional.cross_entropy(
                logits[:, :-1].reshape(-1, 15126), x[:, 1:].reshape(-1)
            )
            loss.backward()
            if device.type == "cuda":
                torch.cuda.synchronize()
            dt = time.perf_counter() - t0
            peak = float(torch.cuda.max_memory_allocated() / (1024 * 1024)) if device.type == "cuda" else None
            vram_probe.append({
                "name": name,
                "params": n,
                "device": str(device),
                "fwd_bwd_s": round(dt, 4),
                "tokens": 8 * 512,
                "tokens_per_sec": round((8 * 512) / max(dt, 1e-6), 1),
                "torch_peak_mib": peak,
                "optimizer": "NONE",
                "note": "single dummy fwd+bwd, no AdamW, not WRIM-1 training",
            })
            del m, x, logits, loss
            if device.type == "cuda":
                torch.cuda.empty_cache()
    except Exception as exc:  # noqa: BLE001
        vram_probe.append({"error": str(exc)})

    # corpus inventory from manifests
    root = Path(DATA_ROOT)
    inventory = []
    for man in sorted(root.glob("**/WR-CORPUS-*-MANIFEST.json")) + sorted(root.glob("**/manifest.json")):
        try:
            obj = json.loads(man.read_text(encoding="utf-8"))
        except Exception:
            continue
        inventory.append({
            "path": str(man.relative_to(root)),
            "corpus_id": obj.get("corpus_id") or obj.get("CORPUS_ID") or obj.get("CORPUS_NAME"),
            "hash": obj.get("CORPUS_HASH") or obj.get("hash"),
            "docs": obj.get("document_count") or obj.get("TRAIN_DOCS") or obj.get("TRAIN_EXAMPLES") or obj.get("RECORD_COUNT"),
            "tokens": obj.get("token_count") or obj.get("TRAIN_TOKENS") or obj.get("TOTAL_TOKENS") or obj.get("TOKEN_COUNT"),
            "kind": obj.get("kind") or obj.get("PROVENANCE"),
        })

    report = {
        "kind": "WRIM1_FOUNDATION_REBUILD_AUDIT",
        "host": "Nebula-Genesis",
        "gpu": gpu,
        "ram_total_gib": round(mem_kib / (1024 * 1024), 2),
        "ram_available_gib": round(avail_kib / (1024 * 1024), 2),
        "disk_free_gib": round(disk_free_g, 1),
        "cpu_nproc": os.cpu_count(),
        "tokenizer_path": str(tok_path) if tok_path else None,
        "tokenizer_sha": sha256_file(tok_path) if tok_path and tok_path.is_file() else None,
        "vocab_size": vocab,
        "specials": specials,
        "specials_by_id": specials_by_id,
        "fragmentation": frag,
        "wrim0_shard_manifest": shards,
        "model_size_math": sizes,
        "vram_probe": vram_probe,
        "corpus_manifest_index": inventory,
        "dump_root": str(dump) if dump else None,
    }
    OUT.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({
        "out": str(OUT),
        "gpu": gpu,
        "vocab": vocab,
        "frag": {k: {kk: vv for kk, vv in v.items() if kk in {"n_tokens", "tokens_per_word", "tokens_per_char"}} for k, v in frag.items()},
        "sizes": {k: v["total"] for k, v in sizes.items()},
        "vram_probe": vram_probe,
        "n_corpora": len(inventory),
        "c0_tokens": None if not shards else shards.get("trainTokenCount"),
    }, indent=2, default=str))
    return report


if __name__ == "__main__":
    main()
