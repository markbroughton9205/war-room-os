"""DEFICIT_INTERLEAVE_FAMILIES packer for P1 / proposed P2 diagnostic.

Does not overwrite DOCUMENT_MAJOR_CONTIGUOUS. Does not mutate WR-CORPUS.
Does not train. Existing C0+C1 only.
"""
from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from dataclasses import replace
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from sovereignty import classify_source
from stage1_pack import PackedUnit, encode_behavior_units, encode_corpus1_units, encode_rehearsal_units
from stage2_pack import split_bounded_excerpts
from stage3a_corrective_pack import ALICE_MARKERS, backtick_heavy, is_alice_unit

PACKER_MODE = "DEFICIT_INTERLEAVE_FAMILIES"
PACKER_VERSION = "deficit-interleave-families-v1"
SEQ_LEN = 512
MICRO_BATCH = 8
TOKENS_PER_STEP = MICRO_BATCH * SEQ_LEN
P2_STEPS = 1000
P2_TOKENS = P2_STEPS * TOKENS_PER_STEP  # 4_096_000
SEED = 2301
FAMILY_ORDER = ("behavior", "code", "json", "prose", "wr_corpus_0")
P2_MIX = {
    "wr_corpus_0": 0.22,
    "prose": 0.40,
    "code": 0.26,
    "json": 0.09,
    "behavior": 0.03,
}
ALICE_CAP_FRAC = 0.03
MAX_FAMILY_FRAC_PER_STEP = 0.55
MAX_SINGLE_DOC_FRAC = 0.08
MAX_EXCERPT = {
    "wr_corpus_0": 2048,
    "prose": 2048,
    "json": 2048,
    "code": 1024,
    "behavior": 512,
}
EXTRA_EVAL_MARKERS = (
    "WRIM-EVAL-S3A",
    "WRIM-DEV-S3A-COR",
    "WRIM-EVAL-S3-000001",
    "CAP-EVAL-0",
    "WRIM-1.1-CAP-EVAL-0",
    "WRIM-EVAL-S3-",
)


def seeded_shuffle(units: list[PackedUnit], seed: int) -> list[PackedUnit]:
    """Deterministic shuffle without numpy.random (App Control can block _pcg64)."""
    out = list(units)
    rng = random.Random(seed)
    rng.shuffle(out)
    return out


def expand(units: list[PackedUnit], family: str) -> list[PackedUnit]:
    cap = MAX_EXCERPT[family]
    out: list[PackedUnit] = []
    for u in units:
        out.extend(split_bounded_excerpts(u, max_tokens=cap))
    return out


def eval_contaminated(unit: PackedUnit) -> bool:
    blob = f"{unit.unit_id} {unit.source_path} {unit.origin}"
    return any(m in blob for m in EXTRA_EVAL_MARKERS)


def unit_sovereignty(unit: PackedUnit, tokenizer: Tokenizer | None = None) -> dict[str, Any]:
    text = ""
    origin = unit.origin or ""
    path = unit.source_path or ""
    if tokenizer is not None and (not path or origin.startswith("c0") or origin == "WR-CORPUS-0"):
        n = min(int(unit.tokens.size), 1024)
        if n > 0:
            text = tokenizer.decode(unit.tokens[:n].tolist(), skip_special_tokens=True)
    return classify_source(
        source_path=path,
        text=text,
        origin=origin,
        kind="behavior_example" if (unit.bucket == "behavior" or origin.lower().startswith("behavior")) else "",
    )


def sovereignty_blocked(unit: PackedUnit, tokenizer: Tokenizer | None, extra_excluded: set[str] | None) -> bool:
    doc_id = str(unit.unit_id).split("#")[0]
    path = (unit.source_path or "").replace("\\", "/")
    extra = extra_excluded or set()
    extra_l = {p.lower() for p in extra}
    if doc_id in extra or path in extra or path.lower() in extra_l:
        return True
    return not bool(unit_sovereignty(unit, tokenizer).get("foundational_allowed"))


def family_mass(units: list[PackedUnit]) -> int:
    return int(sum(int(u.tokens.size) for u in units))


def pick_family(
    *,
    used: dict[str, int],
    target: dict[str, float],
    available: dict[str, bool],
    step_counts: dict[str, int],
    max_family_frac_per_step: float = MAX_FAMILY_FRAC_PER_STEP,
) -> str | None:
    """Select the family with the largest token deficit vs its target allocation.

    deficit(family) = target_share * tokens_so_far - actual_tokens
    When tokens_so_far is 0, rank by target_share so the largest mix starts first.
    Ranking by token deficit is equivalent to ranking by (target_share - actual_share)
    for total > 0. Ties break by FAMILY_ORDER. Within a step, a family may not exceed
    max_family_frac_per_step unless no other family remains.
    """
    total = int(sum(used.values()))
    ranked: list[tuple[float, str]] = []
    for fam in FAMILY_ORDER:
        if not available.get(fam):
            continue
        if total == 0:
            deficit = float(target[fam])
        else:
            deficit = float(target[fam]) * total - float(used[fam])
        ranked.append((deficit, fam))
    ranked.sort(key=lambda x: (-x[0], FAMILY_ORDER.index(x[1])))
    step_filled = int(sum(step_counts.values()))
    for _deficit, fam in ranked:
        if step_filled > 0:
            already = step_counts.get(fam, 0)
            others = any(available.get(g) and g != fam for g in FAMILY_ORDER)
            if others and already / TOKENS_PER_STEP >= max_family_frac_per_step:
                continue
        return fam
    return ranked[0][1] if ranked else None


def classify_epochs(epochs: float | None) -> str:
    if epochs is None:
        return "NO_MASS"
    if epochs < 1.0:
        return "LOW_REUSE"
    if epochs <= 2.0:
        return "CONTROLLED_REUSE"
    if epochs < 4.0:
        return "HIGH_REUSE"
    return "EXCESSIVE_REUSE"


def build_p2_diagnostic_stream(
    *,
    dump_root,
    tokenizer: Tokenizer,
    seed: int = SEED,
    mix: dict[str, float] | None = None,
    max_single_doc_frac: float = MAX_SINGLE_DOC_FRAC,
    max_doc_hard_ceiling: float = 0.15,
    raise_doc_cap_to_hit_mix: bool = True,
    max_epochs: dict[str, float] | None = None,
    code_ceiling_frac: float | None = None,
    mix_is_ranking_only: bool = False,
    progress_tag: str = "p1",
    document_group_by: str = "lineage",
    sovereignty_filter: bool = False,
    extra_excluded_paths: set[str] | None = None,
) -> dict[str, Any]:
    mix = dict(mix or P2_MIX)
    mix_intent = dict(mix)
    c1 = encode_corpus1_units(tokenizer, dump_root, group_by=document_group_by)
    reh = encode_rehearsal_units(tokenizer, dump_root)
    beh = encode_behavior_units(tokenizer, dump_root)
    alice_flags = [is_alice_unit(tokenizer, u) for u in reh]
    alice = [replace(u, origin="c0_alice") for u, flag in zip(reh, alice_flags) if flag]
    non_alice = [replace(u, origin="c0_non_alice") for u, flag in zip(reh, alice_flags) if not flag]
    code_raw = [u for u in (c1.get("code") or []) if not backtick_heavy(tokenizer, u)]
    pools: dict[str, list[PackedUnit]] = {
        "wr_corpus_0": expand(seeded_shuffle(non_alice + alice, seed), "wr_corpus_0"),
        "prose": expand(seeded_shuffle(c1.get("prose") or [], seed + 2), "prose"),
        "code": expand(seeded_shuffle(code_raw, seed + 3), "code"),
        "json": expand(seeded_shuffle(c1.get("json") or [], seed + 4), "json"),
        "behavior": expand(seeded_shuffle(beh, seed + 5), "behavior"),
    }
    for fam in list(pools):
        pools[fam] = [u for u in pools[fam] if not eval_contaminated(u)]
    sovereignty_dropped = 0
    if sovereignty_filter:
        filtered: dict[str, list[PackedUnit]] = {}
        for fam, units in pools.items():
            keep: list[PackedUnit] = []
            for u in units:
                if sovereignty_blocked(u, tokenizer, extra_excluded_paths):
                    sovereignty_dropped += 1
                    continue
                keep.append(u)
            filtered[fam] = keep
        pools = filtered

    mass = {fam: family_mass(pools[fam]) for fam in FAMILY_ORDER}
    docs_available = {fam: len({str(u.unit_id).split("#")[0] for u in pools[fam]}) for fam in FAMILY_ORDER}
    doc_unique: dict[str, int] = defaultdict(int)
    doc_family: dict[str, str] = {}
    doc_paths: dict[str, str] = {}
    for fam, units in pools.items():
        for u in units:
            doc_id = str(u.unit_id).split("#")[0]
            doc_unique[doc_id] += int(u.tokens.size)
            doc_family[doc_id] = fam
            doc_paths[doc_id] = u.source_path
    cursor = {fam: 0 for fam in FAMILY_ORDER}
    used = {fam: 0 for fam in FAMILY_ORDER}
    alice_used = 0
    alice_budget = int(P2_TOKENS * ALICE_CAP_FRAC)
    doc_tokens: dict[str, int] = defaultdict(int)
    doc_takes: dict[str, int] = defaultdict(int)
    max_doc_tokens_by_fam: dict[str, int] = {}
    global_doc_cap = int(P2_TOKENS * max_single_doc_frac)
    hard_doc_cap = int(P2_TOKENS * max_doc_hard_ceiling)
    for fam in FAMILY_ORDER:
        if raise_doc_cap_to_hit_mix:
            n_docs = max(1, docs_available[fam])
            sibling = n_docs - 1 if n_docs > 1 else 1
            needed = int(P2_TOKENS * mix[fam] / sibling * 1.02)
            max_doc_tokens_by_fam[fam] = min(hard_doc_cap, max(global_doc_cap, needed))
        else:
            max_doc_tokens_by_fam[fam] = min(hard_doc_cap, global_doc_cap)
    family_ceiling: dict[str, int] = {}
    ranking_mix = dict(mix)
    packable_report: dict[str, int] | None = None
    code_ceiling_raised_to_fill = False
    if mix_is_ranking_only and max_epochs:
        packable: dict[str, int] = {}
        cap_doc = min(hard_doc_cap, global_doc_cap)
        for fam in FAMILY_ORDER:
            max_ep = float(max_epochs.get(fam, 1.0))
            fam_mass_cap = int(max_ep * mass[fam]) if mass[fam] else 0
            by_doc: dict[str, int] = defaultdict(int)
            for u in pools[fam]:
                by_doc[str(u.unit_id).split("#")[0]] += int(u.tokens.size)
            per_doc = sum(min(cap_doc, int(uniq * max_ep)) for uniq in by_doc.values())
            packable[fam] = min(fam_mass_cap, per_doc) if fam != "code" else fam_mass_cap
        nl = sum(packable[f] for f in FAMILY_ORDER if f != "code")
        code_room = min(int(P2_TOKENS * (code_ceiling_frac or 1.0)), mass["code"], max(0, P2_TOKENS - nl))
        packable["code"] = code_room
        total_packable = int(sum(packable.values()))
        if total_packable < P2_TOKENS:
            extra = P2_TOKENS - total_packable
            room = min(max(0, mass["code"] - packable["code"]), extra)
            if room > 0:
                packable["code"] += room
                code_ceiling_raised_to_fill = packable["code"] > int(P2_TOKENS * (code_ceiling_frac or 1.0))
        packable_report = dict(packable)
        ranking_mix = {fam: packable[fam] / P2_TOKENS for fam in FAMILY_ORDER}
        family_ceiling = dict(packable)
        mix = ranking_mix
        rounded_mix = {k: round(v, 4) for k, v in ranking_mix.items()}
        print(
            f"[{progress_tag}] packable={packable} ranking_mix={rounded_mix} "
            f"code_ceiling_raised_to_fill={code_ceiling_raised_to_fill}",
            flush=True,
        )
    else:
        for fam in FAMILY_ORDER:
            if mix_is_ranking_only:
                cap = P2_TOKENS
                if max_epochs and fam in max_epochs and mass[fam] > 0:
                    cap = min(cap, int(max_epochs[fam] * mass[fam]))
                if fam == "code" and code_ceiling_frac is not None:
                    cap = min(cap, int(P2_TOKENS * code_ceiling_frac))
            else:
                cap = int(P2_TOKENS * mix[fam] * 1.02)
                if max_epochs and fam in max_epochs and mass[fam] > 0:
                    cap = min(cap, int(max_epochs[fam] * mass[fam]))
                if fam == "code" and code_ceiling_frac is not None:
                    cap = min(cap, int(P2_TOKENS * code_ceiling_frac))
            family_ceiling[fam] = cap
    disabled = {fam: False for fam in FAMILY_ORDER}
    spans: list[dict[str, Any]] = []
    packed_chunks: list[np.ndarray] = []
    packed = 0
    skipped_alice = 0
    skipped_doc_cap = 0
    exhausted_rounds = 0
    last_progress = 0
    tail_start = int(P2_TOKENS * 0.90)
    tail_hold = 0.10 if mix_is_ranking_only else 0.0

    def ceiling_now(fam: str) -> int:
        base = int(family_ceiling[fam])
        if packed < tail_start and fam != "code" and tail_hold > 0:
            return int(base * (1.0 - tail_hold))
        return base

    def doc_token_cap(doc_id: str, fam: str) -> int:
        cap = min(max_doc_tokens_by_fam[fam], hard_doc_cap)
        if max_epochs and fam in max_epochs:
            cap = min(cap, int(doc_unique[doc_id] * float(max_epochs[fam])))
        return cap

    def excerpt_allowed(u: PackedUnit, fam: str) -> bool:
        nonlocal skipped_alice, skipped_doc_cap
        doc_id = str(u.unit_id).split("#")[0]
        is_alice = u.origin == "c0_alice"
        if is_alice and alice_used >= alice_budget:
            skipped_alice += 1
            return False
        if doc_tokens[doc_id] >= doc_token_cap(doc_id, fam):
            skipped_doc_cap += 1
            return False
        return True

    def available_map() -> dict[str, bool]:
        out = {}
        for fam in FAMILY_ORDER:
            if disabled[fam] or not pools[fam]:
                out[fam] = False
                continue
            over_ceiling = used[fam] >= ceiling_now(fam)
            others = any((not disabled[g] and pools[g] and used[g] < ceiling_now(g) and g != fam) for g in FAMILY_ORDER)
            if over_ceiling and others:
                out[fam] = False
                continue
            out[fam] = used[fam] < ceiling_now(fam) or not others
        if not any(out.values()):
            for fam in FAMILY_ORDER:
                if pools[fam] and not disabled[fam] and used[fam] < ceiling_now(fam):
                    out[fam] = True
        return out

    step_counts: dict[str, int] = defaultdict(int)
    current_step = 0
    safety = 0
    while packed < P2_TOKENS:
        safety += 1
        if safety > P2_TOKENS * 8:
            raise RuntimeError("packer failed to fill diagnostic stream")
        if packed - last_progress >= 250_000:
            print(f"[{progress_tag}] packed {packed}/{P2_TOKENS} used={dict(used)}", flush=True)
            last_progress = packed
        step_idx = packed // TOKENS_PER_STEP
        if step_idx != current_step:
            current_step = step_idx
            step_counts = defaultdict(int)
        avail = available_map()
        fam = pick_family(used=used, target=ranking_mix, available=avail, step_counts=step_counts)
        if fam is None:
            exhausted_rounds += 1
            break
        n_pool = len(pools[fam])
        took = None
        for _try in range(n_pool):
            u = pools[fam][cursor[fam] % n_pool]
            cursor[fam] += 1
            if excerpt_allowed(u, fam):
                took = u
                break
        if took is None:
            disabled[fam] = True
            exhausted_rounds += 1
            continue
        n = int(took.tokens.size)
        remain_stream = P2_TOKENS - packed
        remain_step = TOKENS_PER_STEP - (packed % TOKENS_PER_STEP)
        remain_fam = ceiling_now(fam) - used[fam]
        others_open = any(avail.get(g) for g in FAMILY_ORDER if g != fam)
        if remain_fam <= 0 and others_open:
            continue
        take = min(n, remain_stream, remain_step)
        if remain_fam > 0:
            take = min(take, remain_fam)
        doc_id = str(took.unit_id).split("#")[0]
        cap = doc_token_cap(doc_id, fam)
        remain_doc = cap - doc_tokens[doc_id]
        if remain_doc <= 0:
            continue
        take = min(take, remain_doc)
        if take <= 0:
            continue
        packed_chunks.append(np.asarray(took.tokens[:take], dtype=np.int32))
        packed += take
        used[fam] += take
        step_counts[fam] += take
        doc_tokens[doc_id] += take
        doc_takes[doc_id] += 1
        if took.origin == "c0_alice":
            alice_used += take
        spans.append(
            {
                "bucket": fam,
                "origin": took.origin,
                "n": take,
                "unit_id": doc_id,
                "source_path": took.source_path,
            }
        )

    if packed < P2_TOKENS:
        raise ValueError(f"P2 diagnostic stream short: {packed} < {P2_TOKENS}")
    stream = np.concatenate(packed_chunks)[:P2_TOKENS].astype(np.int32)
    reuse_by_family = {}
    for fam in FAMILY_ORDER:
        epochs = (used[fam] / mass[fam]) if mass[fam] else None
        reuse_by_family[fam] = {
            "pool_tokens": mass[fam],
            "packed_tokens": used[fam],
            "target_tokens": int(P2_TOKENS * mix[fam]),
            "unique_exposure_est": min(mass[fam], used[fam]),
            "repeated_exposure_est": max(0, used[fam] - mass[fam]),
            "reuse_epochs_est": round(epochs, 4) if epochs is not None else None,
            "recommended_max_epochs": (max_epochs or {}).get(fam),
            "exceeds_recommended_max_epochs": bool(max_epochs and fam in max_epochs and epochs is not None and epochs > max_epochs[fam] + 1e-9),
            "repeat_class": classify_epochs(epochs),
        }
    documents = []
    for doc_id, packed_n in doc_tokens.items():
        uniq = int(doc_unique.get(doc_id, 0))
        frac = packed_n / P2_TOKENS
        ep = (packed_n / uniq) if uniq else None
        documents.append(
            {
                "document_id": doc_id,
                "source_path": doc_paths.get(doc_id),
                "family": doc_family.get(doc_id),
                "unique_tokens": uniq,
                "packed_tokens": packed_n,
                "stream_pct": round(100.0 * frac, 4),
                "effective_reuse": round(ep, 4) if ep is not None else None,
                "n_excerpts": int(doc_takes.get(doc_id, 0)),
                "high_dominance": frac >= max_single_doc_frac - 1e-12,
            }
        )
    documents.sort(key=lambda d: d["packed_tokens"], reverse=True)
    return {
        "packing": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "seed": seed,
        "steps": P2_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "target_tokens": P2_TOKENS,
        "mix_intent": mix_intent,
        "mix_target": dict(mix),
        "alice_cap_frac": ALICE_CAP_FRAC,
        "max_family_frac_per_step": MAX_FAMILY_FRAC_PER_STEP,
        "max_single_doc_frac": max_single_doc_frac,
        "max_doc_hard_ceiling": max_doc_hard_ceiling,
        "raise_doc_cap_to_hit_mix": raise_doc_cap_to_hit_mix,
        "max_epochs": dict(max_epochs) if max_epochs else None,
        "code_ceiling_frac": code_ceiling_frac,
        "code_ceiling_raised_to_fill": code_ceiling_raised_to_fill,
        "document_group_by": document_group_by,
        "packable_tokens": packable_report,
        "max_doc_tokens_by_family": max_doc_tokens_by_fam,
        "algorithm": (
            "DEFICIT_INTERLEAVE_FAMILIES: each next excerpt is taken from the family with the largest "
            "token deficit (target_share * tokens_so_far - actual_tokens). At step 0, rank by target_share. "
            "Ties break by FAMILY_ORDER. Within a 4096-token step, a family may not exceed "
            f"{MAX_FAMILY_FRAC_PER_STEP:.0%} of the step unless no other family remains (mathematically unavoidable). "
            "A family that has reached its mix/epoch ceiling is skipped while any other family "
            "still has takeable excerpts. Excerpts are unit-level (not DOCUMENT_MAJOR_CONTIGUOUS). "
            "Queues wrap for epoch reuse until the family epoch cap. "
            f"Alice tokens capped at {ALICE_CAP_FRAC:.0%} of the stream. A single document may not exceed "
            f"{max_single_doc_frac:.0%} of the stream"
            + ("" if raise_doc_cap_to_hit_mix else " (hard cap; mix is not allowed to raise it).")
        ),
        "family_order": list(FAMILY_ORDER),
        "pool_tokens": mass,
        "docs_available": docs_available,
        "n_c0_docs": len(reh),
        "n_alice_docs": len(alice),
        "packed_token_counts": dict(used),
        "alice_tokens_packed": alice_used,
        "alice_frac_packed": round(alice_used / P2_TOKENS, 4),
        "skipped_alice": skipped_alice,
        "skipped_doc_cap": skipped_doc_cap,
        "exhausted_rounds": exhausted_rounds,
        "family_ceiling": family_ceiling,
        "reuse_by_family": reuse_by_family,
        "documents": documents,
        "doc_tokens": dict(doc_tokens),
        "doc_takes": dict(doc_takes),
        "unit_spans": spans,
        "stream": stream,
        "stream_n_tokens": int(stream.size),
        "stream_sha256": hashlib.sha256(stream.tobytes()).hexdigest(),
        "packed_source_ids": sorted({s["unit_id"] for s in spans}),
        "corpus_mutated": False,
        "eval_markers_checked": list(EXTRA_EVAL_MARKERS),
        "sovereignty_filter": sovereignty_filter,
        "sovereignty_dropped_units": sovereignty_dropped,
        "extra_excluded_paths": sorted(extra_excluded_paths) if extra_excluded_paths else [],
    }


def step_map(spans: list[dict[str, Any]], *, n_steps: int = P2_STEPS) -> list[dict[str, Any]]:
    cursor_span = 0
    span_used = 0
    doc_seen: dict[str, int] = defaultdict(int)
    steps = []
    for step in range(1, n_steps + 1):
        need = TOKENS_PER_STEP
        mix: dict[str, int] = defaultdict(int)
        docs: dict[str, int] = defaultdict(int)
        while need > 0 and cursor_span < len(spans):
            sp = spans[cursor_span]
            avail = int(sp["n"]) - span_used
            take = min(need, avail)
            mix[str(sp["bucket"])] += take
            docs[str(sp["unit_id"])] += take
            doc_seen[str(sp["unit_id"])] += take
            need -= take
            span_used += take
            if span_used >= int(sp["n"]):
                cursor_span += 1
                span_used = 0
        total = int(sum(mix.values())) or 1
        mix_pct = {k: round(100.0 * v / total, 1) for k, v in sorted(mix.items())}
        dominant = max(mix.items(), key=lambda kv: kv[1])[0] if mix else None
        steps.append(
            {
                "step": step,
                "tokens": TOKENS_PER_STEP,
                "mix": dict(mix),
                "mix_pct": mix_pct,
                "dominant": dominant,
                "document_ids": sorted(docs.keys()),
                "source_ids": sorted(docs.keys()),
                "reuse_counts": {k: doc_seen[k] for k in docs},
                "n_docs": len(docs),
                "hundred_pct_json": mix_pct.get("json", 0) >= 99.95,
                "hundred_pct_c0": mix_pct.get("wr_corpus_0", 0) >= 99.95,
            }
        )
    return steps


def burst_stats(steps: list[dict[str, Any]], spans: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    longest_family = 0
    longest_family_label = None
    run = 0
    run_label = None
    hundred_json = [s["step"] for s in steps if s.get("hundred_pct_json")]
    hundred_c0 = [s["step"] for s in steps if s.get("hundred_pct_c0")]
    ge90_run = 0
    ge90_lab = None
    longest_ge90 = 0
    longest_ge90_lab = None
    longest_source_run = 0
    longest_source_id = None
    src_run = 0
    src_lab = None
    for s in steps:
        lab = s.get("dominant")
        if lab == run_label:
            run += 1
        else:
            if run > longest_family:
                longest_family = run
                longest_family_label = run_label
            run = 1
            run_label = lab
        mix_pct = s.get("mix_pct") or {}
        high = lab if lab and float(mix_pct.get(lab, 0)) >= 90.0 else None
        if high == ge90_lab and high is not None:
            ge90_run += 1
        else:
            if ge90_run > longest_ge90:
                longest_ge90 = ge90_run
                longest_ge90_lab = ge90_lab
            ge90_run = 1 if high is not None else 0
            ge90_lab = high
        docs = s.get("document_ids") or []
        src = docs[0] if len(docs) == 1 else None
        if src == src_lab and src is not None:
            src_run += 1
        else:
            if src_run > longest_source_run:
                longest_source_run = src_run
                longest_source_id = src_lab
            src_run = 1 if src is not None else 0
            src_lab = src
    if run > longest_family:
        longest_family = run
        longest_family_label = run_label
    if ge90_run > longest_ge90:
        longest_ge90 = ge90_run
        longest_ge90_lab = ge90_lab
    if src_run > longest_source_run:
        longest_source_run = src_run
        longest_source_id = src_lab

    excerpt_family_tokens = 0
    excerpt_family_lab = None
    longest_excerpt_family_tokens = 0
    longest_excerpt_family = None
    excerpt_source_tokens = 0
    excerpt_source_lab = None
    longest_excerpt_source_tokens = 0
    longest_excerpt_source = None
    for sp in spans or []:
        fam = str(sp.get("bucket"))
        n = int(sp.get("n") or 0)
        if fam == excerpt_family_lab:
            excerpt_family_tokens += n
        else:
            if excerpt_family_tokens > longest_excerpt_family_tokens:
                longest_excerpt_family_tokens = excerpt_family_tokens
                longest_excerpt_family = excerpt_family_lab
            excerpt_family_lab = fam
            excerpt_family_tokens = n
        src = str(sp.get("unit_id"))
        if src == excerpt_source_lab:
            excerpt_source_tokens += n
        else:
            if excerpt_source_tokens > longest_excerpt_source_tokens:
                longest_excerpt_source_tokens = excerpt_source_tokens
                longest_excerpt_source = excerpt_source_lab
            excerpt_source_lab = src
            excerpt_source_tokens = n
    if excerpt_family_tokens > longest_excerpt_family_tokens:
        longest_excerpt_family_tokens = excerpt_family_tokens
        longest_excerpt_family = excerpt_family_lab
    if excerpt_source_tokens > longest_excerpt_source_tokens:
        longest_excerpt_source_tokens = excerpt_source_tokens
        longest_excerpt_source = excerpt_source_lab

    def window(a: int, b: int) -> dict[str, float]:
        mix: dict[str, int] = defaultdict(int)
        for s in steps[a:b]:
            for k, v in (s.get("mix") or {}).items():
                mix[k] += int(v)
        tot = int(sum(mix.values())) or 1
        return {k: round(100.0 * v / tot, 2) for k, v in sorted(mix.items())}

    last100 = window(900, 1000)
    return {
        "longest_dominant_family_run_steps": longest_family,
        "longest_dominant_family": longest_family_label,
        "longest_ge90_family_run_steps": longest_ge90,
        "longest_ge90_family": longest_ge90_lab,
        "longest_single_source_step_run": longest_source_run,
        "longest_single_source_id": longest_source_id,
        "longest_same_family_excerpt_tokens": longest_excerpt_family_tokens,
        "longest_same_family_excerpt": longest_excerpt_family,
        "longest_same_source_excerpt_tokens": longest_excerpt_source_tokens,
        "longest_same_source_excerpt": longest_excerpt_source,
        "steps_100pct_json": hundred_json,
        "steps_100pct_c0": hundred_c0,
        "n_100pct_json": len(hundred_json),
        "n_100pct_c0": len(hundred_c0),
        "first_100_mix_pct": window(0, 100),
        "middle_100_mix_pct": window(450, 550),
        "last_100_mix_pct": last100,
        "late_run_json_binge_like_000004": len(hundred_json) > 0 or (longest_ge90 >= 20 and longest_ge90_lab == "json"),
        "late_run_mono_family_binge": (max(last100.values()) if last100 else 0) >= 80.0 or longest_ge90 >= 20,
    }
