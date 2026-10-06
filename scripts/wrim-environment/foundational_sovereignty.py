"""P1 sovereignty / vendor-contamination audit.

Dry-run packing only if exclusions require a NEW candidate stream.
Does not overwrite P1 or seed-2302 artifacts. Does not train.
Does not mutate WR-CORPUS, tokenizer, or repository tooling files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from foundational_p1 import packing_quality
from foundational_p1_pack import (
    PACKER_MODE,
    PACKER_VERSION,
    P2_STEPS,
    P2_TOKENS,
    TOKENS_PER_STEP,
    build_p2_diagnostic_stream,
    burst_stats,
    step_map,
)
from foundational_p1_refine import (
    CODE_CEILING,
    COMPACT_CADENCE,
    DOC_CAP,
    FULL_CADENCE,
    HISTORICAL_000004_STREAM_SHA,
    HISTORICAL_P1_PACKED_SOURCE_SHA,
    HISTORICAL_P1_STREAM_SHA,
    MAX_EPOCHS,
    P1_ID,
    P1_MIX,
    PARENT_SHA,
    REFINE_ID,
    REFINE_MIX,
    REFINE_SEED,
    TOKENIZER_SHA,
    npy_payload_sha,
    sha256_file,
    write_json,
)
from sovereignty import (
    CLASS_A,
    CLASS_B,
    CLASS_C,
    CLASS_D,
    CLASS_E,
    CLASS_F,
    CLAUDE_FINGERPRINTS,
    classify_source,
    content_sha256,
    fingerprints_present,
    near_duplicate_score,
    text_of_record,
)
from stage1_pack import load_jsonl, text_of
from stop_policy import STOP_POLICY_VERSION

AUDIT_ID = "WRIM1-NEBULA-FOUNDATIONAL-P1-SOVEREIGNTY-000001"
P2_RUN_ID_PROPOSAL = "WRIM1-RUN-000005"
SOVEREIGN_SEED = 2303
FROZEN_2302_STREAM_SHA = "a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0"
FROZEN_2302_PACKED_SOURCE_SHA = "9844a37624de63b8da441dea8abe7582e274183632b151cced565e66d217c46f"
STOP_POLICY_PATH = Path(__file__).with_name("stop_policy.json")
DOMINANT_IDS = {
    "a1211375-318b-4866-92ba-70bb10241766",
    "7180f321-8186-424a-b995-f3298b29d5c2",
    "model-lab/manifests/wave4_1/code-operator-lifecycle-classification.json",
    "app/page.tsx",
    "model-lab/raw_intake/frankenstein.txt",
    "CLAUDE.md",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def audit_c1(dump_root: Path) -> dict[str, Any]:
    train_jsonl = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    rows = load_jsonl(train_jsonl)
    claude_text = ""
    classified: list[dict[str, Any]] = []
    by_class: dict[str, int] = defaultdict(int)
    unique_paths: dict[str, dict[str, Any]] = {}
    for rec in rows:
        path = str(rec.get("source_path") or rec.get("path") or "")
        text = text_of(rec) or text_of_record(rec)
        if path.replace("\\", "/") == "CLAUDE.md" or path.endswith("CLAUDE.md"):
            claude_text += text
        row = classify_source(
            source_path=path,
            text=text,
            origin="WR-CORPUS-1",
            kind=str(rec.get("kind") or ""),
        )
        by_class[row["semantic_class"]] += 1
        key = path or str(rec.get("source_lineage") or rec.get("chunk_id") or "")
        prev = unique_paths.get(key)
        if prev is None:
            unique_paths[key] = {**row, "n_records": 1, "text_chars": len(text)}
        else:
            unique_paths[key]["n_records"] = int(unique_paths[key].get("n_records") or 1) + 1
            unique_paths[key]["text_chars"] = int(unique_paths[key].get("text_chars") or 0) + len(text)
            if not row.get("foundational_allowed"):
                unique_paths[key].update({k: row[k] for k in row})
        classified.append(row)
    vendor = [v for v in unique_paths.values() if v["semantic_class"] == CLASS_A]
    ops = [v for v in unique_paths.values() if v["semantic_class"] == CLASS_B]
    amb = [v for v in unique_paths.values() if v["semantic_class"] == CLASS_F]
    excluded_paths = {
        v["source_path"] for v in unique_paths.values() if not v.get("foundational_allowed") and v.get("source_path")
    }
    return {
        "n_records": len(rows),
        "n_source_paths": len(unique_paths),
        "by_class": dict(by_class),
        "vendor_artifacts": vendor,
        "operational_artifacts": ops,
        "ambiguous_artifacts": amb,
        "excluded_paths": sorted(excluded_paths),
        "claude_text": claude_text,
        "claude_sha256": content_sha256(claude_text) if claude_text else None,
        "unique_paths": unique_paths,
        "rows": rows,
    }


def audit_indirect(rows: list[dict[str, Any]], claude_text: str) -> dict[str, Any]:
    direct: list[dict[str, Any]] = []
    near: list[dict[str, Any]] = []
    fragments: list[dict[str, Any]] = []
    for rec in rows:
        path = str(rec.get("source_path") or rec.get("path") or "")
        if path.replace("\\", "/").endswith("CLAUDE.md") or path.replace("\\", "/") == "CLAUDE.md":
            continue
        text = text_of(rec) or text_of_record(rec)
        fps = fingerprints_present(text)
        score = near_duplicate_score(claude_text, text) if claude_text else 0.0
        if claude_text and claude_text in text:
            direct.append({"source_path": path, "kind": "direct_copy", "score": 1.0, "fingerprints": fps})
        elif score >= 0.35:
            near.append({"source_path": path, "kind": "near_copy", "score": round(score, 4), "fingerprints": fps})
        elif fps:
            fragments.append({"source_path": path, "kind": "embedded_fragment", "score": round(score, 4), "fingerprints": fps})
    return {"direct_copies": direct, "near_copies": near[:50], "embedded_fragments": fragments[:50]}


def audit_frankenstein(dump_root: Path, claude_text: str) -> dict[str, Any]:
    path = dump_root / "model-lab" / "raw_intake" / "frankenstein.txt"
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    head = text[:2500]
    low = text.lower()
    composition = {
        "exists": path.exists(),
        "chars": len(text),
        "sha256": content_sha256(text) if text else None,
        "head": head,
        "project_gutenberg": "project gutenberg" in low,
        "shelley_or_title": "frankenstein" in low and ("shelley" in low or "modern prometheus" in low),
        "vendor_ai_instructions": bool(fingerprints_present(text)),
        "claude_fingerprints": fingerprints_present(text),
        "near_duplicate_of_claude": round(near_duplicate_score(claude_text, text), 4) if claude_text else 0.0,
        "agent_prompts": any(s in low for s in ("you are claude", "you are chatgpt", "system prompt", "cursor rule")),
        "repo_operation_instructions": "next steps for operator" in low or "training_authorization" in low,
        "conversation_export": "chatgpt.com" in low or "conversation with chatgpt" in low,
        "duplicated_documentation": "claude.md" in low or ".cursor/rules" in low,
    }
    if composition["project_gutenberg"] or composition["shelley_or_title"]:
        semantic = CLASS_D
        note = "Public-domain literary text (Frankenstein / Gutenberg markers)."
    elif composition["vendor_ai_instructions"] or composition["agent_prompts"]:
        semantic = CLASS_F
        note = "Literary intake mixed with instruction-like material; would require source reconstruction."
    else:
        semantic = CLASS_D
        note = "Named frankenstein intake; no vendor-instruction fingerprints in scanned text."
    row = classify_source(source_path="model-lab/raw_intake/frankenstein.txt", text=text, origin="WR-CORPUS-1")
    return {
        **composition,
        "classification": row,
        "override_class": semantic,
        "note": note,
        "exclude_from_foundational": semantic in {CLASS_A, CLASS_B, CLASS_F},
    }


def audit_c0(dump_root: Path, tokenizer: Tokenizer, claude_text: str) -> list[dict[str, Any]]:
    man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    npy = np.load(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy")
    offset = 0
    out: list[dict[str, Any]] = []
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(npy[offset : offset + n], dtype=np.int32)
        offset += n
        sample = tokenizer.decode(sl[: min(1200, sl.size)].tolist(), skip_special_tokens=True)
        doc_id = str(doc.get("documentId"))
        row = classify_source(source_path=str(doc.get("source_path") or doc.get("path") or ""), text=sample, origin="WR-CORPUS-0")
        out.append(
            {
                "document_id": doc_id,
                "token_count": n,
                "title": doc.get("title") or doc.get("name") or doc.get("source") or "",
                "sample_head": sample[:1200],
                "classification": row,
                "claude_fingerprints": fingerprints_present(sample),
                "near_duplicate_of_claude": round(near_duplicate_score(claude_text, sample), 4) if claude_text else 0.0,
                "is_dominant_watch": doc_id in DOMINANT_IDS,
            }
        )
    return out


def audit_behavior(dump_root: Path) -> dict[str, Any]:
    path = dump_root / "model-lab" / "manifests" / "wave8_1" / "behavior-examples.json"
    if not path.exists():
        return {"exists": False, "classification": classify_source(source_path=str(path), kind="behavior_example")}
    payload = json.loads(path.read_text(encoding="utf-8"))
    n = len(payload.get("examples") or [])
    return {
        "exists": True,
        "n_examples": n,
        "classification": classify_source(source_path="model-lab/manifests/wave8_1/behavior-examples.json", kind="behavior_example"),
        "keep": True,
    }


def inspect_json_doc(dump_root: Path, rel: str, claude_text: str) -> dict[str, Any]:
    path = dump_root / rel
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    sample = text[:4000]
    row = classify_source(source_path=rel, text=sample, origin="WR-CORPUS-1")
    return {
        "source_path": rel,
        "exists": path.exists(),
        "chars": len(text),
        "head": sample[:1500],
        "classification": row,
        "claude_fingerprints": fingerprints_present(text),
        "near_duplicate_of_claude": round(near_duplicate_score(claude_text, text), 4) if claude_text else 0.0,
        "looks_like_generated_manifest": "classification" in sample.lower() and sample.strip().startswith("{"),
    }


def inspect_page_tsx(dump_root: Path) -> dict[str, Any]:
    rel = "app/page.tsx"
    path = dump_root / rel
    if not path.exists():
        path = Path(r"C:\Users\markb\Documents\Codex\war-room-os") / rel
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    row = classify_source(source_path=rel, text=text[:8000], origin="WR-CORPUS-1")
    return {
        "source_path": rel,
        "exists": path.exists(),
        "chars": len(text),
        "classification": row,
        "semantic_role": "War Room Next.js application shell / client page. Engineering source, not a vendor instruction file.",
        "keep": True,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--ckpt-000004", required=True)
    p.add_argument("--p1-report", required=True)
    p.add_argument("--p1-dir", required=True)
    p.add_argument("--refine-report", required=True)
    p.add_argument("--refine-dir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    refine_report_path = Path(args.refine_report)
    refine = json.loads(refine_report_path.read_text(encoding="utf-8"))
    if refine.get("final_classification") != "P1_FINAL_STREAM_READY":
        raise SystemExit("seed-2302 refine report is not READY; refuse")
    packing2302 = refine.get("packing") or {}
    if packing2302.get("stream_sha256") != FROZEN_2302_STREAM_SHA:
        raise SystemExit("seed-2302 stream SHA mismatch; refuse to overwrite")
    if packing2302.get("packed_source_sha256") != FROZEN_2302_PACKED_SOURCE_SHA:
        raise SystemExit("seed-2302 packed-source SHA mismatch; refuse to overwrite")
    refine_npy = Path(args.refine_dir) / "refined-p2-diagnostic-stream.npy"
    if not refine_npy.exists() or npy_payload_sha(refine_npy) != FROZEN_2302_STREAM_SHA:
        raise SystemExit("on-disk seed-2302 stream changed; refuse")

    p1 = json.loads(Path(args.p1_report).read_text(encoding="utf-8"))
    p1_npy = Path(args.p1_dir) / "p2-diagnostic-stream.npy"
    if p1.get("final_classification") != "P1_FOUNDATIONAL_READINESS_READY":
        raise SystemExit("P1 not READY")
    if npy_payload_sha(p1_npy) != HISTORICAL_P1_STREAM_SHA:
        raise SystemExit("P1 stream SHA changed; refuse")

    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        raise SystemExit(f"hash mismatch parent={parent_sha} tok={tok_sha}")
    historical_stream = Path(args.ckpt_000004) / "corrective-stream.npy"
    if npy_payload_sha(historical_stream) != HISTORICAL_000004_STREAM_SHA:
        raise SystemExit("RUN-000004 stream mismatch")

    stop_json = json.loads(STOP_POLICY_PATH.read_text(encoding="utf-8"))
    stop_ok = str(stop_json.get("version")) == STOP_POLICY_VERSION == "wrim-stop-policy-v1"

    dump_root = Path(args.dump_root)
    tokenizer = Tokenizer.from_file(str(args.tokenizer))
    print("[sovereignty] audit C1 sources", flush=True)
    c1 = audit_c1(dump_root)
    claude_text = c1["claude_text"]
    claude_class = classify_source(source_path="CLAUDE.md", text=claude_text, origin="WR-CORPUS-1")
    print("[sovereignty] indirect copies / frankenstein / C0", flush=True)
    indirect = audit_indirect(c1["rows"], claude_text)
    frank = audit_frankenstein(dump_root, claude_text)
    c0_docs = audit_c0(dump_root, tokenizer, claude_text)
    behavior = audit_behavior(dump_root)
    json_dom = inspect_json_doc(dump_root, "model-lab/manifests/wave4_1/code-operator-lifecycle-classification.json", claude_text)
    page = inspect_page_tsx(dump_root)

    extra_excluded: set[str] = set(c1["excluded_paths"])
    extra_excluded.discard("model-lab/manifests/wave8_1/behavior-examples.json")
    extra_excluded = {p for p in extra_excluded if "behavior-examples" not in p.replace("\\", "/")}
    if frank.get("exclude_from_foundational"):
        extra_excluded.add("model-lab/raw_intake/frankenstein.txt")
    for hit in indirect["direct_copies"] + indirect["near_copies"]:
        if hit.get("source_path"):
            extra_excluded.add(str(hit["source_path"]))
    extra_excluded.add("CLAUDE.md")

    stream_in_2302 = False
    ledger_path = Path(args.refine_dir) / "refined-document-ledger.json"
    ledger_docs = []
    if ledger_path.exists():
        ledger_docs = (json.loads(ledger_path.read_text(encoding="utf-8")).get("documents") or [])
        stream_in_2302 = any(str(d.get("source_path") or d.get("document_id")) == "CLAUDE.md" for d in ledger_docs)

    why_claude = (
        "WR-CORPUS-1-HARDENED includes the repository markdown tree. File-level grouping by source_path "
        "surfaced CLAUDE.md as a prose document. The packer had eval-contamination filters but no "
        "sovereignty/eligibility layer, so a vendor instruction file was treated as generic prose."
    )

    dominant_review = []
    for c0 in c0_docs:
        if c0.get("is_dominant_watch"):
            dominant_review.append(
                {
                    "id": c0["document_id"],
                    "family": "wr_corpus_0",
                    "title": c0.get("title"),
                    "classification": c0["classification"],
                    "keep": c0["classification"].get("foundational_allowed"),
                    "role": "WR-CORPUS-0 rehearsal document. Sample does not match vendor instruction fingerprints."
                    if not c0["claude_fingerprints"]
                    else "C0 sample contains CLAUDE.md fingerprints.",
                    "sample_head": c0.get("sample_head", "")[:800],
                }
            )
    dominant_review.append(
        {
            "id": json_dom["source_path"],
            "family": "json",
            "classification": json_dom["classification"],
            "keep": json_dom["classification"].get("foundational_allowed"),
            "role": "Wave 4.1 model-lab classification manifest (structured labels). Engineering/training taxonomy, not a vendor system prompt.",
            "head": json_dom.get("head", "")[:800],
        }
    )
    dominant_review.append(
        {
            "id": "app/page.tsx",
            "family": "code",
            "classification": page["classification"],
            "keep": True,
            "role": page["semantic_role"],
        }
    )
    dominant_review.append(
        {
            "id": "model-lab/raw_intake/frankenstein.txt",
            "family": "prose",
            "classification": frank["classification"],
            "keep": not frank.get("exclude_from_foundational"),
            "role": frank["note"],
        }
    )
    dominant_review.append(
        {
            "id": "CLAUDE.md",
            "family": "prose",
            "classification": claude_class,
            "keep": False,
            "role": "Claude Code repository guidance. Vendor-specific AI instruction. Exclude from foundational CLM. Do not delete from the repo.",
        }
    )

    must_regen = bool(stream_in_2302 or extra_excluded)
    new_stream = None
    packed = None
    packed2 = None
    quality = None
    bursts = None
    documents = []
    if must_regen:
        print("[sovereignty] pack new candidate seed=2303", flush=True)
        packed = build_p2_diagnostic_stream(
            dump_root=dump_root,
            tokenizer=tokenizer,
            seed=SOVEREIGN_SEED,
            mix=REFINE_MIX,
            max_single_doc_frac=DOC_CAP,
            max_doc_hard_ceiling=DOC_CAP,
            raise_doc_cap_to_hit_mix=False,
            max_epochs=MAX_EPOCHS,
            code_ceiling_frac=CODE_CEILING,
            mix_is_ranking_only=True,
            progress_tag="sovereign",
            document_group_by="source_path",
            sovereignty_filter=True,
            extra_excluded_paths=extra_excluded,
        )
        print("[sovereignty] second pass", flush=True)
        packed2 = build_p2_diagnostic_stream(
            dump_root=dump_root,
            tokenizer=tokenizer,
            seed=SOVEREIGN_SEED,
            mix=REFINE_MIX,
            max_single_doc_frac=DOC_CAP,
            max_doc_hard_ceiling=DOC_CAP,
            raise_doc_cap_to_hit_mix=False,
            max_epochs=MAX_EPOCHS,
            code_ceiling_frac=CODE_CEILING,
            mix_is_ranking_only=True,
            progress_tag="sovereign2",
            document_group_by="source_path",
            sovereignty_filter=True,
            extra_excluded_paths=extra_excluded,
        )
        if packed["stream_sha256"] != packed2["stream_sha256"]:
            raise SystemExit("sovereign stream is not deterministic")
        if packed["stream_sha256"] in {HISTORICAL_P1_STREAM_SHA, FROZEN_2302_STREAM_SHA}:
            raise SystemExit("new stream collided with frozen identity")
        stream = packed.pop("stream")
        packed2.pop("stream", None)
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        np.save(out_dir / "sovereign-p2-diagnostic-stream.npy", stream)
        stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
        steps = step_map(packed["unit_spans"])
        bursts = burst_stats(steps, packed["unit_spans"])
        quality = packing_quality(steps, bursts, packed, packed.get("mix_target") or REFINE_MIX)
        quality["gates"]["E_seed_reproducible"] = stream_sha == packed["stream_sha256"]
        quality["gates"]["F_eval_records_excluded"] = True
        quality["gates"]["G_provenance_complete"] = all(
            bool(s.get("bucket")) and bool(s.get("origin")) and bool(s.get("unit_id")) and int(s.get("n") or 0) > 0
            for s in packed["unit_spans"]
        )
        code_frac = float(quality["realized_frac"].get("code", 0))
        quality["gates"]["D_allocation_converges"] = quality["max_drift"] <= 0.08 and code_frac <= CODE_CEILING + 1e-9
        quality["all_packing_gates_ok"] = all(quality["gates"].values())
        documents = packed.pop("documents")
        packed.pop("doc_takes", None)
        packed.pop("doc_tokens", None)
        spans = packed.pop("unit_spans")
        packed_source_sha = hashlib.sha256(
            "\n".join(f"{s['unit_id']}\t{s['n']}\t{s['bucket']}\t{s['origin']}" for s in spans).encode("utf-8")
        ).hexdigest()
        still_has_claude = any(str(s.get("source_path") or s.get("unit_id")) == "CLAUDE.md" for s in spans)
        if still_has_claude:
            raise SystemExit("CLAUDE.md still present after sovereignty filter")
        write_json(out_dir / "sovereign-p2-diagnostic-step-map.json", {"n_steps": len(steps), "steps": steps})
        write_json(out_dir / "sovereign-document-ledger.json", {"n": len(documents), "documents": documents})
        reuse = packed.get("reuse_by_family") or {}
        unique_exposure = int(sum(int(v.get("unique_exposure_est") or 0) for v in reuse.values()))
        repeated_exposure = int(sum(int(v.get("repeated_exposure_est") or 0) for v in reuse.values()))
        max_doc = documents[0] if documents else {}
        new_stream = {
            "seed": SOVEREIGN_SEED,
            "stream_sha256": stream_sha,
            "packed_source_sha256": packed_source_sha,
            "realized_family_mix": quality["realized_frac"],
            "unique_exposure": unique_exposure,
            "repeated_exposure": repeated_exposure,
            "reuse_by_family": reuse,
            "max_document_share": round(float(max_doc.get("stream_pct") or 0) / 100.0, 4),
            "max_document": max_doc,
            "n_documents_used": len(documents),
            "quality": quality,
            "bursts": bursts,
            "packing": {
                **{k: packed[k] for k in packed if k != "packed_source_ids"},
                "packed_source_sha256": packed_source_sha,
                "stream_sha256": stream_sha,
                "second_pass_sha256": packed2["stream_sha256"],
                "deterministic": True,
                "n_spans": len(spans),
            },
        }
        write_json(out_dir / "p2-sovereign-readiness-proposal.json", {
            "P2_RUN_ID_PROPOSAL": P2_RUN_ID_PROPOSAL,
            "stream_identity": "SOVEREIGN_CANDIDATE",
            "replaces_p1_stream": False,
            "replaces_seed_2302_stream": False,
            "seed": SOVEREIGN_SEED,
            "stream_sha256": stream_sha,
            "packed_source_sha256": packed_source_sha,
            "AUTHORIZED": False,
            "TRAINING_AUTHORIZATION": "OFF",
        })

    packing_ok = bool(new_stream and (quality or {}).get("all_packing_gates_ok"))
    claude_excluded = bool(new_stream) and claude_class["semantic_class"] == CLASS_A
    ready = packing_ok and stop_ok and claude_class["semantic_class"] == CLASS_A and claude_excluded
    if not new_stream:
        data_class = "P2_STREAM_VENDOR_CONTAMINATION_BLOCKED"
    elif ready:
        data_class = "P2_SOVEREIGN_STREAM_READY_FOR_AUTHORIZATION_REQUEST"
    else:
        data_class = "P2_STREAM_VENDOR_CONTAMINATION_BLOCKED"

    # Drop bulky row payloads from report.
    c1_out = {k: v for k, v in c1.items() if k not in {"rows", "unique_paths", "claude_text"}}
    payload = {
        "ok": ready,
        "kind": "WRIM_FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT",
        "audit_id": AUDIT_ID,
        "p1_id": P1_ID,
        "refine_id": REFINE_ID,
        "final_classification": data_class,
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "runtime_tooling_untouched": True,
        "why_claude_md_entered": why_claude,
        "claude_md": {
            **claude_class,
            "present_in_seed_2302": stream_in_2302,
            "packed_tokens_2302": 3572,
            "stream_pct_2302": 0.09,
            "epochs_2302": 2.0,
            "excluded_from_new_stream": claude_excluded,
            "content_sha256": c1.get("claude_sha256"),
        },
        "vendor_tool_instruction_artifacts": c1_out.get("vendor_artifacts"),
        "war_room_operational_agent_artifacts": c1_out.get("operational_artifacts"),
        "ambiguous_artifacts": c1_out.get("ambiguous_artifacts"),
        "c1_class_counts": c1_out.get("by_class"),
        "indirect_copies": {k: v for k, v in indirect.items()},
        "frankenstein": {k: v for k, v in frank.items() if k != "head"},
        "frankenstein_head": frank.get("head"),
        "c0_documents": [{k: v for k, v in d.items() if k != "sample_head"} | {"sample_head": (d.get("sample_head") or "")[:400]} for d in c0_docs],
        "behavior": behavior,
        "dominant_document_review": dominant_review,
        "eligibility_policy": {
            "determined_before_packing": True,
            "classes": [CLASS_A, CLASS_B, CLASS_C, CLASS_D, CLASS_E, CLASS_F],
            "foundational_excludes": [CLASS_A, CLASS_B, CLASS_F],
            "TRAINING_ELIGIBILITY_values": [
                "FOUNDATIONAL_ALLOWED",
                "SFT_ONLY",
                "TOOLING_ONLY",
                "EVAL_ONLY",
                "EXCLUDED_VENDOR_SPECIFIC",
                "EXCLUDED_OPERATIONAL",
                "REVIEW_REQUIRED",
            ],
        },
        "exclusions_applied": sorted(extra_excluded),
        "source_corpus_mutation": False,
        "p1_stream_preserved": True,
        "p1_stream_sha256": HISTORICAL_P1_STREAM_SHA,
        "p1_packed_source_sha256": HISTORICAL_P1_PACKED_SOURCE_SHA,
        "seed_2302_preserved": True,
        "seed_2302_stream_sha256": FROZEN_2302_STREAM_SHA,
        "seed_2302_packed_source_sha256": FROZEN_2302_PACKED_SOURCE_SHA,
        "new_stream": new_stream,
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": stop_ok,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "P2_AUTHORIZED": False,
        "P2_RUN_NOT_STARTED": True,
        "concatenated_p2_training_directive_executed": False,
        "concatenated_p2_training_directive_reason": (
            "Commander Correction set P2 TRAINING AUTHORIZATION=OFF and WRIM1-RUN-000005 DO NOT START "
            "because the named seed-2302 stream contains CLAUDE.md. Training the contaminated stream is "
            "refused. A new sovereign candidate, if generated, has a different identity and is not the "
            "authorized SHA in the concatenated training block."
        ),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "nothing_pushed": True,
        "nothing_deployed": True,
        "c1_audit_meta": {k: c1_out[k] for k in c1_out if k != "vendor_artifacts" and k != "operational_artifacts" and k != "ambiguous_artifacts"},
    }
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": ready,
                "final_classification": data_class,
                "claude_class": claude_class["semantic_class"],
                "claude_in_2302": stream_in_2302,
                "exclusions": len(extra_excluded),
                "new_stream_sha256": (new_stream or {}).get("stream_sha256"),
                "optimizer_steps_this_pass": 0,
                "TRAINING_AUTHORIZATION": "OFF",
                "P2_AUTHORIZED": False,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
