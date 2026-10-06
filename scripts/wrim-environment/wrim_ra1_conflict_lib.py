"""Shared RA1 task-group packing and PCGrad-style projection. No optimizer."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch

from wrim_arch_uh1_ac1_train import _write
from wrim_arch_uh1_phase_a import _split_loss, load_jsonl
from wrim_ea1_consol import natural_eval_forms, natural_train_forms
from wrim_ea1_program import paraphrase_train_forms, write_corpus
from wrim_g20m_ra1 import RA1_PREFIX, freeze_base_train_ra1
from wrim_hvu_identity import DATA_ROOT, MICRO_BATCH, SEQ_LEN
from wrim_plm3_encode import encode_example, pack_train_stream, slice_batches
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR, T3_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows

GROUP_ORDER = ["natural", "dog", "cat", "no", "blue", "two", "three", "para"]
PROTECTED_ORDER = ["dog", "cat", "no", "blue", "two", "three", "para"]
PRIMARY_PAIRS = [
    ("natural", "dog"),
    ("natural", "cat"),
    ("natural", "no"),
    ("natural", "blue"),
    ("natural", "two"),
    ("natural", "three"),
    ("natural", "para"),
]
TOKENS_PER_GROUP_SEQ = SEQ_LEN
CORPUS_NAME = "GCFL-FIXED-BALANCED"
TT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl"


def _take(rows: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    if not rows:
        return []
    out = []
    i = 0
    while len(out) < n:
        out.append(dict(rows[i % len(rows)]))
        i += 1
    return out


def _retag(rows: list[dict[str, Any]], prefix: str) -> list[dict[str, Any]]:
    out = []
    for i, rec in enumerate(rows):
        row = dict(rec)
        row["example_id"] = f"{prefix}-{i:04d}"
        out.append(row)
    return out


def natural_span_forms() -> list[dict[str, Any]]:
    """2–5 token natural families plus the existing short natural train set."""
    extra = [
        ("yesno", "yes it is", "Answer in three words whether water is wet."),
        ("yesno", "no it is not", "In four words, is fire cold?"),
        ("greet", "hi there", "Greet the operator in two words starting with hi."),
        ("fact", "ice is cold", "State that frozen water is cold, three words."),
        ("fact", "sun is hot", "State that the sun is hot, three words."),
        ("label", "even number", "Classify 8 as even number, two words."),
        ("label", "odd number", "Classify 9 as odd number, two words."),
        ("number", "four", "Spell the result of two plus two."),
        ("def", "frozen water", "Two-word definition of ice."),
        ("instr", "stop now", "Two-word halt instruction."),
        ("xform", "cba", "Reverse the letters abc with no spaces."),
        ("code", "print(1)", "Python one-liner that prints integer one."),
    ]
    rows = list(natural_train_forms())
    for i, (fam, target, prompt) in enumerate(extra):
        rows.append({
            "example_id": f"gcfl-nat-{i:03d}",
            "family": f"gc_{fam}",
            "first_token_class": str(target).split()[0][:12],
            "prompt": prompt,
            "target": target,
            "provenance": "first-party-war-room-os-internal-gcfl-natural-train",
        })
    return rows


def natural_span_eval() -> list[dict[str, Any]]:
    extra = [
        ("yesno", "yes it is", "Three words: is rain wet?"),
        ("greet", "hi there", "Two-word hello starting with hi."),
        ("fact", "ice is cold", "Frozen water temperature, three words."),
        ("number", "four", "Spell two plus two."),
        ("def", "frozen water", "What is ice, two words?"),
        ("instr", "stop now", "Halt in two words."),
        ("xform", "cba", "Reverse abc, no spaces."),
        ("code", "print(1)", "One-line Python print of 1."),
    ]
    rows = list(natural_eval_forms())
    for i, (fam, target, prompt) in enumerate(extra):
        rows.append({
            "example_id": f"gcfl-nat-eval-{i:03d}",
            "family": f"gce_{fam}",
            "first_token_class": str(target).split()[0][:12],
            "prompt": prompt,
            "target": target,
            "provenance": "first-party-war-room-os-internal-gcfl-natural-eval",
        })
    return rows


def build_group_rows() -> dict[str, list[dict[str, Any]]]:
    phrase = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    by: dict[str, list[dict[str, Any]]] = {}
    for rec in phrase:
        by.setdefault(str(rec.get("first_token_class")), []).append(rec)
    tt = load_rows(TT_TRAIN)
    t3 = load_rows(T3_ALIGN_DIR / "train.jsonl")
    nat_official = load_rows(NAT_DIR / "train.jsonl") if (NAT_DIR / "train.jsonl").is_file() else []
    groups = {
        "natural": _retag(natural_span_forms() + _take(nat_official, 8), "gcfl-nat"),
        "dog": _retag(_take(by.get("dog", []), 24), "gcfl-dog"),
        "cat": _retag(_take(by.get("cat", []), 24), "gcfl-cat"),
        "no": _retag(_take(by.get("no", []), 24), "gcfl-no"),
        "blue": _retag(_take(by.get("blue", []), 24), "gcfl-blue"),
        "two": _retag(_take(tt, 24), "gcfl-tt"),
        "three": _retag(_take(t3, 24), "gcfl-t3"),
        "para": _retag(_take(paraphrase_train_forms(), 24), "gcfl-para"),
    }
    for name in GROUP_ORDER:
        if not groups[name]:
            raise RuntimeError(f"empty task group {name}")
    return groups


def write_fixed_corpus() -> Path:
    groups = build_group_rows()
    train: list[dict[str, Any]] = []
    for name in GROUP_ORDER:
        train.extend(groups[name])
    val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    root = write_corpus(CORPUS_NAME, train, val)
    gdir = root / "groups"
    gdir.mkdir(parents=True, exist_ok=True)
    for name, rows in groups.items():
        (gdir / f"{name}.jsonl").write_text("".join(__import__("json").dumps(r) + "\n" for r in rows), encoding="utf-8")
    _write(root / "groups.json", {"ORDER": GROUP_ORDER, "PROTECTED": PROTECTED_ORDER, "COUNTS": {k: len(v) for k, v in groups.items()}})
    return root


def load_group_rows(corpus_dir: Path) -> dict[str, list[dict[str, Any]]]:
    gdir = corpus_dir / "groups"
    if gdir.is_dir():
        out = {}
        for name in GROUP_ORDER:
            out[name] = load_jsonl(gdir / f"{name}.jsonl")
            if not out[name]:
                raise RuntimeError(f"missing packed group {name}")
        return out
    return build_group_rows()


def pack_group_batches(tokenizer: Any, groups: dict[str, list[dict[str, Any]]], steps: int) -> dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]]:
    packed: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]] = {}
    for name in GROUP_ORDER:
        encoded = [encode_example(tokenizer, r) for r in groups[name]]
        mean_len = max(1, int(np.mean([int(e["tokens"].size) for e in encoded])))
        need = steps * MICRO_BATCH * SEQ_LEN + 1
        tiled = list(encoded)
        while len(tiled) * mean_len * 60 < need:
            tiled = tiled + tiled
        stream, mask = pack_train_stream(tiled, steps=steps)
        batches = slice_batches(stream, mask, steps=steps)
        slim = []
        for x, y, m in batches:
            slim.append((x[:1], y[:1], m[:1]))
        packed[name] = slim
    return packed


def ra1_named(model: torch.nn.Module) -> list[tuple[str, torch.nn.Parameter]]:
    return [(n, p) for n, p in model.named_parameters() if n.startswith(RA1_PREFIX)]


def flatten_ra1_grad(model: torch.nn.Module) -> tuple[torch.Tensor, dict[str, float]]:
    chunks = []
    parts: dict[str, float] = {}
    for n, p in ra1_named(model):
        if p.grad is None:
            g = torch.zeros(p.numel(), dtype=torch.float32)
        else:
            g = p.grad.detach().float().reshape(-1).cpu()
        parts[n] = float(g.norm().item())
        if n.endswith("down.weight"):
            parts["W_DOWN_GRAD"] = parts[n]
        elif n.endswith("up.weight"):
            parts["W_UP_GRAD"] = parts[n]
        elif ".norm." in n:
            parts["ADAPTER_NORM_GRAD"] = parts[n]
        chunks.append(g)
    return torch.cat(chunks), parts


def assign_ra1_grad(model: torch.nn.Module, vec: torch.Tensor) -> None:
    off = 0
    for _, p in ra1_named(model):
        n_el = p.numel()
        p.grad = vec[off:off + n_el].to(device=p.device, dtype=p.dtype).view_as(p).clone()
        off += n_el
    if off != int(vec.numel()):
        raise RuntimeError(f"ra1 grad size mismatch {off} vs {vec.numel()}")


def pair_stats(a: torch.Tensor, b: torch.Tensor) -> dict[str, Any]:
    na = float(a.norm().item())
    nb = float(b.norm().item())
    dot = float(torch.dot(a, b).item())
    denom = (na * nb) + 1e-12
    return {
        "COSINE": float(dot / denom),
        "DOT": dot,
        "NORM_A": na,
        "NORM_B": nb,
        "CONFLICT": "YES" if dot < 0 else "NO",
    }


def capture_task_grad(
    model: torch.nn.Module,
    device: torch.device,
    batch: tuple[np.ndarray, np.ndarray, np.ndarray],
) -> tuple[torch.Tensor, dict[str, float], dict[str, Any]]:
    x_np, y_np, m_np = batch
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=True)
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
    logits = model(x)
    split = _split_loss(logits, y, y_mask, first_w=1.0)
    loss = split["loss"]
    info = {
        "loss": float(loss.item()) if torch.isfinite(loss) else None,
        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
        "EOS_CE": split["EOS_CE"],
        "finite": bool(torch.isfinite(loss)),
    }
    if not torch.isfinite(loss):
        vec, parts = flatten_ra1_grad(model)
        return vec, parts, info
    loss.backward()
    vec, parts = flatten_ra1_grad(model)
    return vec, parts, info


def capture_all_tasks(
    model: torch.nn.Module,
    device: torch.device,
    packed: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]],
    step_i: int,
) -> dict[str, Any]:
    grads: dict[str, torch.Tensor] = {}
    parts: dict[str, dict[str, float]] = {}
    infos: dict[str, dict[str, Any]] = {}
    for name in GROUP_ORDER:
        vec, p, info = capture_task_grad(model, device, packed[name][step_i])
        grads[name] = vec
        parts[name] = p
        infos[name] = info
        if not info["finite"]:
            raise RuntimeError(f"non-finite {name} loss at batch {step_i}")
    return {"grads": grads, "parts": parts, "infos": infos}


def pcgrad_project(
    g_nat: torch.Tensor,
    protected: dict[str, torch.Tensor],
    order: list[str],
) -> tuple[torch.Tensor, list[dict[str, Any]]]:
    g = g_nat.clone()
    events: list[dict[str, Any]] = []
    for name in order:
        gp = protected[name]
        n2 = float(gp.dot(gp).item())
        if n2 < 1e-12:
            continue
        d = float(g.dot(gp).item())
        if d < 0:
            g = g - (d / n2) * gp
            events.append({"task": name, "dot": d, "protected_norm": float(n2 ** 0.5)})
    return g, events


def ortho_against_sum(
    g_nat: torch.Tensor,
    protected: dict[str, torch.Tensor],
) -> tuple[torch.Tensor, dict[str, Any]]:
    g_prot = torch.zeros_like(g_nat)
    for name in PROTECTED_ORDER:
        g_prot = g_prot + protected[name]
    n2 = float(g_prot.dot(g_prot).item())
    d = float(g_nat.dot(g_prot).item())
    applied = False
    g = g_nat.clone()
    if n2 >= 1e-12 and d < 0:
        g = g - (d / n2) * g_prot
        applied = True
    return g, {"dot": d, "protected_norm": float(n2 ** 0.5) if n2 > 0 else 0.0, "applied": applied}


def combine_sum(g_nat: torch.Tensor, protected: dict[str, torch.Tensor]) -> torch.Tensor:
    g = g_nat.clone()
    for name in PROTECTED_ORDER:
        g = g + protected[name]
    return g


def conflict_pairs(grads: dict[str, torch.Tensor]) -> list[dict[str, Any]]:
    rows = []
    for a, b in PRIMARY_PAIRS:
        st = pair_stats(grads[a], grads[b])
        rows.append({"TASK_PAIR": f"{a}_vs_{b}", **st})
    return rows
