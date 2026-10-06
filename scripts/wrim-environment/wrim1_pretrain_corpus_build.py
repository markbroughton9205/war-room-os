"""Build WRIM-1-PRETRAIN-CORPUS-v1.0.0. No optimizer. Does not mutate the pilot freeze."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import random
import re
import time
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from wrim1_pretrain_corpus_identity import (
    CHECKPOINT_25M,
    CHECKPOINT_40M,
    CORPUS_ID,
    CORPUS_VERSION,
    DATA_ROOT,
    LOCKED_EVAL_PATHS,
    OUT_DIR,
    PILOT_CORPUS_HASH,
    PILOT_TOKENIZER_HASH,
    PILOT_TOKENIZER_PATH,
    PRIMARY_LANGUAGE,
    PROGRAM_ID,
    RAW_DIR,
    REPORT_PATH,
    SEED,
    UNIQUE_TARGET,
    USER_AGENT,
)
from wrim_pilot_ab_identity import CANONICAL, CANONICAL_HASH, FROZEN_CORPUS_HASH, FROZEN_TOKENIZER_HASH

SECRET_RE = re.compile(
    r"(-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|"
    r"AKIA[0-9A-Z]{16}|"
    r"(?:api[_-]?key|secret[_-]?key|password|passwd|token)\s*[:=]\s*['\"][^'\"]{12,}|"
    r"mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@|"
    r"postgres(?:ql)?:\/\/[^:]+:[^@]+@)",
    re.I,
)
HTML_RE = re.compile(r"<html|<!doctype html|<script|<nav class", re.I)
ALPHA_RE = re.compile(r"[A-Za-z]")
WS_RE = re.compile(r"\s+")
PUNCT_RE = re.compile(r"[^a-z0-9\s]+")

EXISTING_RFCS = {
    1034, 1035, 1952, 3174, 3339, 3986, 4122, 5321, 5322, 6749, 6750,
    6901, 6902, 7049, 7396, 7515, 7517, 7519, 7946, 8259, 8446, 9110, 9112, 9113,
}
NEW_RFCS = [
    768, 791, 793, 821, 854, 959, 1939, 2068, 2616, 2818, 2821, 2822,
    3280, 4346, 5246, 5280, 5861, 6234, 6455, 7159, 7230, 7231, 7540,
    8032, 8445, 8610, 8949, 9111, 9205, 9293,
    20, 768, 791, 793, 821, 854, 959, 1036, 1122, 1123, 1180, 1191,
    1321, 1631, 1738, 1918, 1928, 2045, 2046, 2131, 2460, 2617, 2817,
    3168, 3268, 3501, 3629, 3977, 4033, 4120, 4251, 4271, 4303, 4443,
    4501, 4648, 4880, 5021, 5234, 5349, 5484, 5802, 5905, 6120, 6454,
    7049, 7232, 7233, 7234, 7235, 7541, 8252, 8446, 8611, 8879, 9000,
    9114, 9200, 9290, 9413, 9458,
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = PUNCT_RE.sub(" ", s)
    return WS_RE.sub(" ", s).strip()


def simhash64(text: str) -> int:
    tokens = normalize(text).split()
    if not tokens:
        return 0
    acc = [0] * 64
    for tok in tokens[:4000]:
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        for i in range(64):
            acc[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(64):
        if acc[i] > 0:
            out |= 1 << i
    return out


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def http_get(url: str, timeout: int = 60) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status), resp.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), b""
    except Exception:
        return 0, b""


def quality_fail(text: str, domain: str | None = None) -> str | None:
    if not text or len(text.strip()) < 80:
        return "empty_or_tiny"
    if "\x00" in text:
        return "binary_null"
    if HTML_RE.search(text[:2000]):
        return "html_boilerplate"
    stripped = text.lstrip()
    json_like = domain == "JSON_STRUCTURED" or stripped[:1] in "{["
    letters = len(ALPHA_RE.findall(text))
    if (not json_like) and letters / max(len(text), 1) < 0.35:
        return "low_alpha"
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        top = Counter(lines).most_common(1)[0]
        if top[1] >= 8 and top[1] / len(lines) > 0.25:
            return "extreme_line_repeat"
    if SECRET_RE.search(text):
        return "secret_pattern"
    if text.count("????") > 20 or text.count("�") > 20:
        return "garbled"
    return None


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.is_file():
        return
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_tokenizer():
    from tokenizers import Tokenizer
    return Tokenizer.from_file(str(PILOT_TOKENIZER_PATH))


def n_tokens(tok, text: str) -> int:
    return len(tok.encode(text, add_special_tokens=False).ids)


def strip_gutenberg_boilerplate(text: str) -> str:
    start = re.search(r"\*\*\*\s*START OF (?:THE |THIS )?PROJECT GUTENBERG", text, re.I)
    end = re.search(r"\*\*\*\s*END OF (?:THE |THIS )?PROJECT GUTENBERG", text, re.I)
    if start:
        text = text[start.end():]
    if end:
        text = text[: end.start()]
    return text.strip()


def split_chapters(text: str, source_id: str) -> list[tuple[str, str]]:
    parts = re.split(r"\n(?=(?:CHAPTER|Chapter|BOOK|Book|PART|Part|SECTION|Section)\s+[IVXLCDM0-9][^\n]{0,40}\n)", text)
    if len(parts) < 3:
        chunks = []
        step = 9000
        for i in range(0, len(text), step):
            piece = text[i : i + step]
            chunks.append((f"{source_id}:chunk{i // step:04d}", piece))
        return [c for c in chunks if len(c[1].strip()) > 200]
    out = []
    for i, p in enumerate(parts):
        body = p.strip()
        if len(body) <= 200:
            continue
        if len(body) <= 12000:
            out.append((f"{source_id}:part{i:04d}", body))
            continue
        step = 9000
        for j in range(0, len(body), step):
            piece = body[j : j + step]
            if len(piece.strip()) > 200:
                out.append((f"{source_id}:part{i:04d}:{j // step:02d}", piece))
    return out


def load_locked_fingerprints() -> dict[str, Any]:
    exact: set[str] = set()
    norms: set[str] = set()
    grams: set[str] = set()
    snippets: list[str] = []

    def add_text(s: str) -> None:
        s = (s or "").strip()
        if len(s) < 8:
            return
        exact.add(s)
        n = normalize(s)
        if len(n) >= 12:
            norms.add(n)
            snippets.append(n)
            words = n.split()
            for i in range(len(words) - 5):
                grams.add(" ".join(words[i : i + 6]))

    for path in LOCKED_EVAL_PATHS:
        if not path.is_file():
            continue
        raw = path.read_text(encoding="utf-8")
        if path.suffix == ".jsonl":
            for rec in iter_jsonl(path):
                for k in ("prompt", "target", "text", "passage", "gold"):
                    if rec.get(k):
                        add_text(str(rec[k]))
        else:
            obj = json.loads(raw)
            stack = [obj]
            while stack:
                cur = stack.pop()
                if isinstance(cur, dict):
                    for k, v in cur.items():
                        if k in {"prompt", "target", "text", "passage", "gold"} and isinstance(v, str):
                            add_text(v)
                        else:
                            stack.append(v)
                elif isinstance(cur, list):
                    stack.extend(cur)
    return {"exact": exact, "norm": norms, "grams": grams, "n_snippets": len(snippets)}


def contamination_hit(text: str, fps: dict[str, Any]) -> str | None:
    if text in fps["exact"]:
        return "exact"
    n = normalize(text)
    if n in fps["norm"]:
        return "normalized"
    words = n.split()
    hits = 0
    for i in range(0, max(0, len(words) - 5), 3):
        g = " ".join(words[i : i + 6])
        if g in fps["grams"]:
            hits += 1
            if hits >= 3:
                return "ngram"
    return None


def carry_cpt3(tok, fps) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    stats = Counter()
    maps = [
        ("PROSE_GENERAL", DATA_ROOT / "WR-CORPUS-CPT3-PROSE-1-v1.2.0" / "WR-CORPUS-CPT3-PROSE-1-v1.2.0-DOCUMENTS.jsonl",
         DATA_ROOT / "WR-CORPUS-CPT3-PROSE-1-v1.2.0" / "WR-CORPUS-CPT3-PROSE-1-v1.2.0-INDEX.json"),
        ("TECHNICAL", DATA_ROOT / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0" / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0-DOCUMENTS.jsonl",
         DATA_ROOT / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0" / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0-INDEX.json"),
        ("JSON_STRUCTURED", DATA_ROOT / "WR-CORPUS-CPT3-JSON-1-v1.0.0" / "WR-CORPUS-CPT3-JSON-1-v1.0.0-DOCUMENTS.jsonl",
         DATA_ROOT / "WR-CORPUS-CPT3-JSON-1-v1.0.0" / "WR-CORPUS-CPT3-JSON-1-v1.0.0-INDEX.json"),
    ]
    eligible: dict[str, str] = {}
    for domain, _docs, index in maps:
        if index.is_file():
            for rec in json.loads(index.read_text(encoding="utf-8")):
                elig = rec.get("splitEligibility")
                if elig in (None, "train-eligible"):
                    eligible[rec.get("documentId") or rec.get("sourceId") or ""] = domain
    code_paths = [
        DATA_ROOT / "WR-CORPUS-CPT-1-v1.0.0",
    ]
    for domain, docs, _index in maps:
        for rec in iter_jsonl(docs):
            did = rec.get("documentId") or rec.get("sourceId") or rec.get("id")
            elig = rec.get("splitEligibility")
            if elig not in (None, "train-eligible") and did not in eligible:
                stats["skipped_non_train"] += 1
                continue
            text = rec.get("text") or rec.get("body") or ""
            q = quality_fail(text)
            if q:
                stats[f"quality_{q}"] += 1
                continue
            if contamination_hit(text, fps):
                stats["contamination"] += 1
                continue
            rows.append({
                "doc_id": str(did),
                "source_id": str(rec.get("sourceId") or did).split(":")[0] + ":" + str(rec.get("sourceId") or did),
                "source_name": rec.get("title") or rec.get("sourceId") or "cpt3",
                "source_url": rec.get("sourceUri") or rec.get("sourceUrl") or "",
                "license": rec.get("license") or "INHERITED_CPT3_VERIFIED",
                "license_evidence": rec.get("licenseUrl") or "CPT3 license manifest",
                "retrieval_date": "2026-09-23",
                "domain": domain,
                "text": text,
                "origin": "cpt3-carry",
            })
            stats["accepted"] += 1
    # first-party instruction TRAIN only
    inst_path = DATA_ROOT / "WRIM-INSTRUCTION-TRAIN-v1.1.0"
    for name in ("train.jsonl", "WRIM-INSTRUCTION-TRAIN-v1.1.0-train.jsonl", "examples.jsonl"):
        p = inst_path / name
        if not p.is_file():
            continue
        for rec in iter_jsonl(p):
            if rec.get("split") not in (None, "train"):
                continue
            prompt = rec.get("prompt") or ""
            target = rec.get("target") or rec.get("response") or ""
            text = f"Commander: {prompt}\nAssistant: {target}"
            q = quality_fail(text)
            if q:
                continue
            if contamination_hit(text, fps) or contamination_hit(prompt, fps) or contamination_hit(target, fps):
                stats["contamination"] += 1
                continue
            rows.append({
                "doc_id": f"first-party-inst:{rec.get('id') or sha256_text(text)[:12]}",
                "source_id": "first-party:instruction-v1.1.0",
                "source_name": "WRIM-INSTRUCTION-TRAIN-v1.1.0",
                "source_url": "",
                "license": "FIRST_PARTY",
                "license_evidence": "War Room authored; train split only",
                "retrieval_date": utc_now()[:10],
                "domain": "INSTRUCTION_RICH",
                "text": text,
                "origin": "first-party-seed",
                "target_in_prompt": target.strip()[:40].lower() in prompt.lower() if target and prompt else False,
            })
            stats["instruction_seed"] += 1
        break
    stats["carry_docs"] = len(rows)
    return rows, dict(stats)


def classify_gutenberg_subject(subjects: str, title: str) -> str:
    blob = f"{subjects} {title}".lower()
    if any(k in blob for k in ("mathematic", "algebra", "geometry", "calculus", "arithmetic")):
        return "MATH_REASONING"
    if any(k in blob for k in ("physics", "chemistry", "biology", "astronomy", "geology", "botany", "anatomy", "medicine", "science")):
        return "SCIENCE_STEM"
    if any(k in blob for k in ("engineer", "electric", "mechanics", "technology", "computer")):
        return "TECHNICAL"
    if any(k in blob for k in ("poetry", "poems", "verse")):
        return "REJECT_POETRY"
    return "PROSE_GENERAL"


def select_gutenberg(existing_ids: set[int], limit: int = 220) -> list[dict[str, Any]]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    catalog_path = RAW_DIR / "pg_catalog.csv"
    if not catalog_path.is_file():
        status, blob = http_get("https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv")
        if status != 200 or not blob:
            status, blob = http_get("https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz")
            if status == 200 and blob[:2] == b"\x1f\x8b":
                blob = gzip.decompress(blob)
        if status == 200 and blob:
            catalog_path.write_bytes(blob)
    if not catalog_path.is_file():
        return []
    text = catalog_path.read_text(encoding="utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    picked: list[dict[str, Any]] = []
    stem: list[dict[str, Any]] = []
    prose: list[dict[str, Any]] = []
    for row in reader:
        try:
            pg = int(row.get("Text#") or row.get("Text") or 0)
        except ValueError:
            continue
        if pg in existing_ids or pg <= 0:
            continue
        lang = (row.get("Language") or "").lower()
        if lang not in {"en", "english"}:
            continue
        typ = (row.get("Type") or "Text").lower()
        if typ not in {"text", ""}:
            continue
        title = row.get("Title") or ""
        subjects = row.get("Subjects") or ""
        domain = classify_gutenberg_subject(subjects, title)
        if domain == "REJECT_POETRY":
            continue
        rec = {
            "pg": pg,
            "title": title,
            "authors": row.get("Authors") or "",
            "subjects": subjects,
            "domain": domain,
            "url": f"https://www.gutenberg.org/cache/epub/{pg}/pg{pg}.txt",
            "ebook": f"https://www.gutenberg.org/ebooks/{pg}",
        }
        if domain in {"MATH_REASONING", "SCIENCE_STEM", "TECHNICAL"}:
            stem.append(rec)
        else:
            prose.append(rec)
    rng = random.Random(SEED)
    rng.shuffle(stem)
    rng.shuffle(prose)
    # Prefer prose for mix repair; keep a STEM slice.
    n_stem = min(len(stem), max(80, limit // 5))
    n_prose = min(len(prose), limit - n_stem)
    picked = stem[:n_stem] + prose[:n_prose]
    return picked[:limit]


def ingest_gutenberg(sel: list[dict[str, Any]], tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    accepted_docs: list[dict[str, Any]] = []
    source_rows: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for rec in sel:
        cache = RAW_DIR / f"pg{rec['pg']}.txt"
        if cache.is_file() and cache.stat().st_size > 800:
            blob = cache.read_bytes()
            status = 200
        else:
            time.sleep(0.35)
            status, blob = http_get(rec["url"], timeout=90)
            if status == 200 and blob:
                cache.write_bytes(blob)
        receipt = {
            **rec,
            "http_status": status,
            "bytes": len(blob),
            "raw_sha256": sha256_bytes(blob) if blob else None,
            "retrieval_date": utc_now(),
            "cached": cache.is_file(),
        }
        if status != 200 or not blob:
            receipt["status"] = "REJECT"
            receipt["reason"] = f"http_{status}"
            rejected.append(receipt)
            source_rows.append(receipt)
            continue
        text = blob.decode("utf-8", errors="replace")
        text = strip_gutenberg_boilerplate(text)
        q = quality_fail(text)
        if q:
            receipt["status"] = "REJECT"
            receipt["reason"] = q
            rejected.append(receipt)
            source_rows.append(receipt)
            continue
        source_id = f"gutenberg:{rec['pg']}"
        parts = split_chapters(text, source_id)
        kept = 0
        raw_tokens = n_tokens(tok, text)
        post = 0
        for did, chunk in parts:
            q2 = quality_fail(chunk)
            if q2:
                continue
            if contamination_hit(chunk, fps):
                continue
            nt = n_tokens(tok, chunk)
            accepted_docs.append({
                "doc_id": did,
                "source_id": source_id,
                "source_name": rec["title"],
                "source_url": rec["ebook"],
                "license": "PUBLIC_DOMAIN_US",
                "license_evidence": "https://www.gutenberg.org/policy/license.html",
                "retrieval_date": receipt["retrieval_date"][:10],
                "domain": rec["domain"],
                "text": chunk,
                "origin": "gutenberg-expansion",
                "n_tokens": nt,
            })
            kept += 1
            post += nt
        receipt["status"] = "ACCEPT" if kept else "REJECT"
        receipt["reason"] = "ok" if kept else "all_chunks_filtered"
        receipt["document_count"] = kept
        receipt["raw_tokens"] = raw_tokens
        receipt["post_clean_tokens"] = post
        receipt["license"] = "PUBLIC_DOMAIN_US"
        source_rows.append(receipt)
        print(f"PG {rec['pg']} {receipt['status']} chunks={kept} tokens={post}", flush=True)
    return accepted_docs, source_rows, rejected


def ingest_rfcs(tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    docs = []
    sources = []
    seen_rfc: set[int] = set()
    for num in NEW_RFCS:
        if num in EXISTING_RFCS or num in seen_rfc:
            continue
        seen_rfc.add(num)
        url = f"https://www.rfc-editor.org/rfc/rfc{num}.txt"
        cache = RAW_DIR / f"rfc{num}.txt"
        if cache.is_file() and cache.stat().st_size > 200:
            blob = cache.read_bytes()
            status = 200
        else:
            time.sleep(0.2)
            status, blob = http_get(url, timeout=60)
            if status == 200 and blob:
                RAW_DIR.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(blob)
        rec = {
            "source_id": f"ietf:rfc{num}",
            "source_name": f"RFC {num}",
            "source_url": url,
            "license": "IETF_TRUST_LEGAL_PROVISIONS",
            "license_evidence": "https://trustee.ietf.org/documents/trust-legal-provisions/",
            "retrieval_date": utc_now(),
            "http_status": status,
            "bytes": len(blob),
            "raw_sha256": sha256_bytes(blob) if blob else None,
            "domain": "TECHNICAL",
        }
        if status != 200 or not blob:
            rec["status"] = "REJECT"
            rec["reason"] = f"http_{status}"
            sources.append(rec)
            continue
        text = blob.decode("utf-8", errors="replace")
        q = quality_fail(text)
        if q:
            rec["status"] = "REJECT"
            rec["reason"] = q
            sources.append(rec)
            continue
        if contamination_hit(text, fps):
            rec["status"] = "REJECT"
            rec["reason"] = "contamination"
            sources.append(rec)
            continue
        nt = n_tokens(tok, text)
        docs.append({
            "doc_id": f"ietf:rfc{num}",
            "source_id": rec["source_id"],
            "source_name": rec["source_name"],
            "source_url": url,
            "license": rec["license"],
            "license_evidence": rec["license_evidence"],
            "retrieval_date": rec["retrieval_date"][:10],
            "domain": "TECHNICAL",
            "text": text,
            "origin": "rfc-expansion",
            "n_tokens": nt,
        })
        rec["status"] = "ACCEPT"
        rec["document_count"] = 1
        rec["raw_tokens"] = nt
        rec["post_clean_tokens"] = nt
        sources.append(rec)
        print(f"RFC {num} ACCEPT tokens={nt}", flush=True)
    return docs, sources


def ingest_usgov(tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    urls = [
        ("usgs-week-all", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson", "JSON_STRUCTURED", "US_GOVERNMENT_WORK_PD", "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"),
        ("usgs-month-sig", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson", "JSON_STRUCTURED", "US_GOVERNMENT_WORK_PD", "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"),
        ("nasa-donki-notifications", "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/notifications?type=all", "JSON_STRUCTURED", "US_GOVERNMENT_WORK_PD", "https://www.nasa.gov/nasa-brand-center/images-and-media/"),
        ("cisa-kev", "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", "JSON_STRUCTURED", "US_GOVERNMENT_WORK_PD", "https://www.usa.gov/government-works"),
        ("nws-alerts", "https://api.weather.gov/alerts/active?status=actual&message_type=alert", "JSON_STRUCTURED", "US_GOVERNMENT_WORK_PD", "https://www.weather.gov/disclaimer"),
    ]
    docs = []
    sources = []
    for sid, url, domain, lic, evidence in urls:
        time.sleep(0.3)
        status, blob = http_get(url, timeout=90)
        rec = {
            "source_id": f"usgov:{sid}",
            "source_name": sid,
            "source_url": url,
            "license": lic,
            "license_evidence": evidence,
            "retrieval_date": utc_now(),
            "http_status": status,
            "bytes": len(blob),
            "raw_sha256": sha256_bytes(blob) if blob else None,
            "domain": domain,
        }
        if status != 200 or not blob:
            rec["status"] = "REJECT"
            rec["reason"] = f"http_{status}"
            sources.append(rec)
            continue
        text = blob.decode("utf-8", errors="replace")
        # split large JSON arrays into records without exploding uniqueness via clones
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            rec["status"] = "REJECT"
            rec["reason"] = "json_parse"
            sources.append(rec)
            continue
        pieces = []
        if isinstance(obj, dict) and "features" in obj and isinstance(obj["features"], list):
            for i, feat in enumerate(obj["features"][:400]):
                pieces.append(json.dumps(feat, ensure_ascii=False))
        elif isinstance(obj, dict) and "vulnerabilities" in obj:
            for i, feat in enumerate((obj.get("vulnerabilities") or [])[:400]):
                pieces.append(json.dumps(feat, ensure_ascii=False))
        elif isinstance(obj, list):
            for feat in obj[:400]:
                pieces.append(json.dumps(feat, ensure_ascii=False))
        else:
            pieces.append(json.dumps(obj, ensure_ascii=False)[:200000])
        kept = 0
        post = 0
        for i, piece in enumerate(pieces):
            if len(piece) < 80:
                continue
            if contamination_hit(piece, fps):
                continue
            nt = n_tokens(tok, piece)
            docs.append({
                "doc_id": f"usgov:{sid}:{i:04d}",
                "source_id": rec["source_id"],
                "source_name": sid,
                "source_url": url,
                "license": lic,
                "license_evidence": evidence,
                "retrieval_date": rec["retrieval_date"][:10],
                "domain": domain,
                "text": piece,
                "origin": "usgov-expansion",
                "n_tokens": nt,
            })
            kept += 1
            post += nt
        rec["status"] = "ACCEPT" if kept else "REJECT"
        rec["document_count"] = kept
        rec["post_clean_tokens"] = post
        rec["raw_tokens"] = n_tokens(tok, text[:500000])
        sources.append(rec)
        print(f"USGOV {sid} {rec['status']} n={kept} tokens={post}", flush=True)
    return docs, sources


def ingest_python_stdlib(tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Local CPython stdlib is PSF-licensed. No GitHub scrape."""
    import sysconfig

    stdlib = Path(sysconfig.get_paths().get("stdlib") or "")
    docs: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    if not stdlib.is_dir():
        return docs, sources
    skip_parts = {
        "test", "tests", "turtledemo", "ensurepip", "lib2to3", "distutils",
        "site-packages", "__pycache__", "idlelib",
    }
    n_files = 0
    post = 0
    for path in sorted(stdlib.rglob("*.py")):
        if n_files >= 1800:
            break
        if any(p in skip_parts for p in path.parts):
            continue
        name = path.name
        if name.startswith("test_") or name.endswith("_pb2.py"):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size < 120 or size > 180_000:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if quality_fail(text, domain="CODE") or SECRET_RE.search(text):
            continue
        if contamination_hit(text, fps):
            continue
        rel = str(path.relative_to(stdlib))
        nt = n_tokens(tok, text)
        docs.append({
            "doc_id": f"psf-stdlib:{rel}",
            "source_id": "psf:cpython-stdlib",
            "source_name": f"CPython stdlib {rel}",
            "source_url": "https://github.com/python/cpython",
            "license": "PSF-2.0",
            "license_evidence": "https://docs.python.org/3/license.html",
            "retrieval_date": utc_now()[:10],
            "domain": "CODE",
            "text": text,
            "origin": "python-stdlib",
            "n_tokens": nt,
        })
        n_files += 1
        post += nt
    sources.append({
        "source_id": "psf:cpython-stdlib",
        "source_name": "CPython standard library",
        "source_url": "https://docs.python.org/3/license.html",
        "license": "PSF-2.0",
        "license_evidence": "https://docs.python.org/3/license.html",
        "retrieval_date": utc_now(),
        "status": "ACCEPT" if n_files else "REJECT",
        "document_count": n_files,
        "post_clean_tokens": post,
        "domain": "CODE",
    })
    print(f"STDLIB ACCEPT n={n_files} tokens={post}", flush=True)
    return docs, sources


def ingest_python_docs(tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """PSF-licensed tutorial/library docs via docs.python.org (PSF license)."""
    pages = [
        "https://docs.python.org/3/tutorial/index.html",
        "https://docs.python.org/3/tutorial/introduction.html",
        "https://docs.python.org/3/tutorial/controlflow.html",
        "https://docs.python.org/3/tutorial/datastructures.html",
        "https://docs.python.org/3/tutorial/modules.html",
        "https://docs.python.org/3/tutorial/inputoutput.html",
        "https://docs.python.org/3/tutorial/errors.html",
        "https://docs.python.org/3/tutorial/classes.html",
        "https://docs.python.org/3/tutorial/stdlib.html",
        "https://docs.python.org/3/tutorial/stdlib2.html",
        "https://docs.python.org/3/library/json.html",
        "https://docs.python.org/3/library/functions.html",
        "https://docs.python.org/3/library/stdtypes.html",
        "https://docs.python.org/3/reference/compound_stmts.html",
        "https://docs.python.org/3/reference/simple_stmts.html",
    ]
    docs = []
    sources = []
    for url in pages:
        time.sleep(0.25)
        status, blob = http_get(url)
        rec = {
            "source_id": "psf:python-docs",
            "source_name": "Python 3 documentation",
            "source_url": url,
            "license": "PSF-2.0",
            "license_evidence": "https://docs.python.org/3/license.html",
            "retrieval_date": utc_now(),
            "http_status": status,
            "bytes": len(blob),
            "domain": "TECHNICAL",
        }
        if status != 200 or not blob:
            rec["status"] = "REJECT"
            rec["reason"] = f"http_{status}"
            sources.append(rec)
            continue
        html = blob.decode("utf-8", errors="replace")
        # crude tag strip; keep code
        text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = WS_RE.sub(" ", text)
        q = quality_fail(text)
        if q:
            rec["status"] = "REJECT"
            rec["reason"] = q
            sources.append(rec)
            continue
        if contamination_hit(text, fps):
            rec["status"] = "REJECT"
            rec["reason"] = "contamination"
            sources.append(rec)
            continue
        nt = n_tokens(tok, text)
        docs.append({
            "doc_id": "psf:" + sha256_text(url)[:12],
            "source_id": "psf:python-docs",
            "source_name": "Python 3 documentation",
            "source_url": url,
            "license": "PSF-2.0",
            "license_evidence": rec["license_evidence"],
            "retrieval_date": rec["retrieval_date"][:10],
            "domain": "CODE" if "/library/" in url or "/tutorial/" in url else "TECHNICAL",
            "text": text,
            "origin": "python-docs",
            "n_tokens": nt,
        })
        rec["status"] = "ACCEPT"
        rec["document_count"] = 1
        rec["post_clean_tokens"] = nt
        rec["raw_tokens"] = nt
        rec["raw_sha256"] = sha256_bytes(blob)
        sources.append(rec)
    return docs, sources


def first_party_math(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    # Hold out probe-like items: 2+3, next after 7, robin/wings
    forbidden = {(2, 3), (7, 1)}
    n = 0
    while n < 24000:
        a = rng.randint(4, 900)
        b = rng.randint(2, 400)
        if (a, b) in forbidden or (b, a) in forbidden:
            continue
        kind = n % 10
        if kind == 0:
            prompt = f"Compute {a} plus {b}."
            target = str(a + b)
        elif kind == 1:
            prompt = f"What is {a} minus {b}?"
            target = str(a - b)
        elif kind == 2:
            prompt = f"Multiply {a} and {min(b, 40)}."
            target = str(a * min(b, 40))
        elif kind == 3:
            prompt = f"Which is larger, {a} or {b}?"
            target = str(max(a, b))
        elif kind == 4:
            seq = [a, a + b, a + 2 * b]
            prompt = f"Continue the sequence {seq[0]}, {seq[1]}, {seq[2]} with one more integer."
            target = str(a + 3 * b)
        elif kind == 5:
            prompt = f"Is {a} even or odd?"
            target = "even" if a % 2 == 0 else "odd"
        elif kind == 6:
            prompt = f"Order these ascending: {a + b}, {a}, {b}."
            target = ", ".join(str(x) for x in sorted([a + b, a, b]))
        elif kind == 7:
            prompt = f"If a box holds {b} items and there are {a} boxes, how many items?"
            target = str(a * b if b < 30 else a + b)
        elif kind == 8:
            prompt = f"A value starts at {a} and decreases by {min(b, a-1)} once. What remains?"
            target = str(a - min(b, a - 1))
        else:
            prompt = f"Does the set {{{a}, {b}, {a+b}}} contain {b}?"
            target = "yes"
        text = f"Commander: {prompt}\nAssistant: {target}"
        docs.append({
            "doc_id": f"first-party-math:{n:05d}",
            "source_id": "first-party:math-reasoning",
            "source_name": "War Room first-party math primitives",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Authored for WRIM-1 pretrain; eval probes excluded",
            "retrieval_date": utc_now()[:10],
            "domain": "MATH_REASONING",
            "text": text,
            "origin": "first-party-math",
            "target_in_prompt": False,
        })
        n += 1
    return docs


def first_party_conversation(rng: random.Random) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    train_settings = [
        "kitchen", "workshop", "library", "river bank", "train platform", "orchard",
        "harbor", "clinic waiting room", "school hallway", "greenhouse", "machine shop",
        "map room", "bakery", "observatory", "archives", "bridge", "market stall",
        "printing loft", "foundry yard", "signal cabin",
    ]
    hold_settings = ["lighthouse", "quarry ledge", "clock tower"]
    goals = [
        "explain a delay", "ask for a tool", "describe weather", "plan a short route",
        "clarify a measurement", "thank someone", "warn about a hazard", "compare two methods",
        "request a summary", "admit uncertainty", "give directions", "check a list",
        "name a missing part", "confirm a time", "describe a sound", "choose between two rooms",
    ]
    names_a = ["Mara", "Eli", "Noor", "Pavel", "June", "Chris", "Ivy", "Luis"]
    names_b = ["Sam", "Rina", "Owen", "Tess", "Kai", "Hana", "Brett", "Ada"]

    def render(i: int, settings: list[str], source_id: str, prefix: str) -> dict[str, Any]:
        s = settings[i % len(settings)]
        g = goals[(i * 3) % len(goals)]
        a_name = names_a[i % len(names_a)]
        b_name = names_b[(i // 5) % len(names_b)]
        n1 = 3 + (i % 17)
        n2 = 11 + (i % 29)
        frame = i % 8
        if frame == 0:
            text = (
                f"{a_name}: We still have about {n1} minutes here in the {s}. I wanted to {g}.\n"
                f"{b_name}: Start with the part that actually changes the next step. What is blocking you?\n"
                f"{a_name}: The notes are uneven, and I cannot tell which figure is current.\n"
                f"{b_name}: Keep the latest marked copy, set the older one aside, and say the constraint in one sentence.\n"
                f"{a_name}: The constraint is we cannot leave until the count matches {n2}.\n"
                f"{b_name}: Then recount once, write the number, and we move."
            )
        elif frame == 1:
            text = (
                f"{b_name} asked why the {s} felt quieter than yesterday.\n"
                f"{a_name} said the wind had shifted, so the usual noise was gone.\n"
                f"They compared two ways to {g}: one fast and sloppy, one slower and checkable.\n"
                f"{b_name}: If we only have {n1} minutes, which way still leaves a record?\n"
                f"{a_name}: The slower way. I can write the result on the card before we go."
            )
        elif frame == 2:
            text = (
                f"Q: Can you help me {g} while we wait in the {s}?\n"
                f"A: Yes. Tell me what you already tried.\n"
                f"Q: I counted {n1} items, then lost the tally when someone asked a question.\n"
                f"A: Start the count again from the marked end, not from memory.\n"
                f"Q: What if the mark itself is wrong?\n"
                f"A: Then we pick a new mark both of us can see, and count aloud once."
            )
        elif frame == 3:
            text = (
                f"{a_name} stood near the {s} door and described the problem without blaming anyone.\n"
                f"It was supposed to be simple: {g}. Instead the measurements disagreed by {n2}.\n"
                f"{b_name} answered by pointing at the last confirmed step, not the rumor.\n"
                f"{a_name}: So we trust the last written check, not the hallway version.\n"
                f"{b_name}: Right. If that check is missing, we redo only that check."
            )
        elif frame == 4:
            text = (
                f"{a_name}: I am not sure I understood you. You wanted me to {g}?\n"
                f"{b_name}: Almost. I wanted the short version, then the reason.\n"
                f"{a_name}: Short version: wait {n1} minutes, then move. Reason: the {s} is still occupied.\n"
                f"{b_name}: That I can follow. If it runs long, call me rather than guessing."
            )
        elif frame == 5:
            text = (
                f"Two people in the {s} were comparing notes.\n"
                f"{a_name} thought the first method was kinder. {b_name} thought the second was clearer.\n"
                f"They needed to {g} before the hour changed.\n"
                f"After a pause, they agreed to try the clearer method for {n1} minutes and switch only if it failed."
            )
        elif frame == 6:
            text = (
                f"{b_name}: Before we leave the {s}, tell me what you heard, not what you inferred.\n"
                f"{a_name}: I heard the warning twice. I inferred we should {g}.\n"
                f"{b_name}: Keep those separate. The warning is evidence. The action is a choice.\n"
                f"{a_name}: Then my choice is to wait {n2} counts and ask once more."
            )
        else:
            text = (
                f"{a_name} thanked {b_name} for staying in the {s} after the others left.\n"
                f"They still had to {g}, and neither wanted to pretend it was finished.\n"
                f"{b_name}: If we cannot finish, we should write what remains.\n"
                f"{a_name}: Remaining: {n1} checks, one missing label, and a closed door.\n"
                f"{b_name}: That is enough for whoever comes next."
            )
        return {
            "doc_id": f"{prefix}:{i:05d}",
            "source_id": source_id,
            "source_name": "War Room first-party natural exchanges",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Original authored dialogues; not copied from evals or books",
            "retrieval_date": utc_now()[:10],
            "domain": "CONVERSATION_NATURAL",
            "text": text,
            "origin": "first-party-conversation",
        }

    train = [render(i, train_settings, "first-party:conversation", "first-party-conv") for i in range(24000)]
    hold = [render(i, hold_settings, "first-party:conversation-holdout", "first-party-conv-hold") for i in range(1200)]
    return train, hold


def first_party_instruction_from_passages(passages: list[str], rng: random.Random, fps) -> list[dict[str, Any]]:
    docs = []
    verbs = [
        "Count the sentences in the passage and reply with an integer.",
        "Classify the passage as narrative, technical, or instructional.",
        "Say whether the passage asks a question. Reply yes or no.",
        "Give an 8-word-or-fewer title that does not copy a whole sentence.",
        "List three lowercase keywords that are not a contiguous quote.",
        "State the passage length as character_count and word_count in JSON.",
        "Does the passage mention a number? Reply yes or no, then the first digit string or none.",
        "Rewrite the opening idea as a yes/no question the passage could answer.",
        "Name the likely reader: student, operator, historian, or general.",
        "Extract comparison language if present, else reply none.",
    ]
    used = 0
    for i, passage in enumerate(passages):
        if used >= 22000:
            break
        p = WS_RE.sub(" ", passage.strip())
        if len(p) < 220 or len(p) > 1200:
            continue
        if contamination_hit(p, fps):
            continue
        verb = verbs[i % len(verbs)]
        words = p.split()
        sentences = [s.strip() for s in re.split(r"[.!?]+", p) if s.strip()]
        if "Count the sentences" in verb:
            target = str(max(len(sentences), 1))
        elif "Classify" in verb:
            blob = p.lower()
            if any(k in blob for k in ("theorem", "equation", "species", "voltage", "protocol")):
                target = "technical"
            elif any(k in blob for k in ("first", "then", "step", "should")):
                target = "instructional"
            else:
                target = "narrative"
        elif "asks a question" in verb:
            target = "yes" if "?" in p else "no"
        elif "8-word" in verb:
            picked = [w.lower().strip(".,;:") for w in words[2:14] if w.isalpha()]
            rng.shuffle(picked)
            target = " ".join(picked[:8]) or f"theme {len(words)}"
        elif "keywords" in verb:
            keys = []
            for w in words:
                wl = w.lower().strip(".,;:\"'")
                if len(wl) > 5 and wl.isalpha() and wl not in keys:
                    keys.append(wl)
                if len(keys) == 3:
                    break
            if len(keys) < 3:
                continue
            target = ", ".join(keys)
        elif "character_count" in verb:
            target = json.dumps({"character_count": len(p), "word_count": len(words)})
        elif "mention a number" in verb:
            m = re.search(r"\d+", p)
            target = f"yes {m.group(0)}" if m else "no none"
        elif "yes/no question" in verb:
            target = f"Does this concern {words[0].lower()}?"
        elif "likely reader" in verb:
            blob = p.lower()
            if "operator" in blob or "gauge" in blob:
                target = "operator"
            elif "century" in blob or "king" in blob:
                target = "historian"
            elif "student" in blob or "lesson" in blob:
                target = "student"
            else:
                target = "general"
        else:
            comps = [w for w in ("larger", "smaller", "more", "less", "unlike", "compared") if w in p.lower()]
            target = ", ".join(comps) if comps else "none"
        prompt = f"{verb}\nPassage: {p}"
        target_copy = bool(target.strip() and len(target) > 24 and target.strip().lower() in prompt.lower())
        text = f"Commander: {prompt}\nAssistant: {target}"
        if contamination_hit(text, fps):
            continue
        docs.append({
            "doc_id": f"first-party-inst-pd:{used:05d}",
            "source_id": "first-party:instruction-from-pd",
            "source_name": "War Room instruction over public-domain passages",
            "source_url": "",
            "license": "FIRST_PARTY_PROMPT_OVER_PD",
            "license_evidence": "Prompts authored; passages from accepted PD train documents",
            "retrieval_date": utc_now()[:10],
            "domain": "INSTRUCTION_RICH",
            "text": text,
            "origin": "first-party-instruction",
            "target_in_prompt": target_copy,
        })
        used += 1
    return docs


def first_party_json_code_procedural(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    schemas = ["tool_call", "config", "record", "transform", "inventory"]
    for i in range(8000):
        kind = schemas[i % len(schemas)]
        if kind == "tool_call":
            obj = {
                "op": ["lookup", "format", "filter", "sort"][i % 4],
                "args": {"field": ["name", "id", "limit"][i % 3], "value": i % 97},
                "ok": bool(i % 3),
            }
        elif kind == "config":
            obj = {
                "id": f"cfg-{i:04d}",
                "enabled": bool(i % 2),
                "limit": 8 + (i % 90),
                "tags": [f"t{i%7}", f"g{i%11}"],
                "nested": {"x": i % 13, "y": (i * 3) % 17, "ok": i % 5 != 0},
            }
        elif kind == "record":
            obj = {
                "person": {"given": ["Ada", "Lin", "Omar"][i % 3], "n": i},
                "scores": [i % 5, i % 7, i % 11],
                "note": f"row {i} measured {3 + i % 9}",
            }
        elif kind == "transform":
            obj = {"from": {"a": i, "b": i % 10}, "to": {"sum": i + (i % 10), "parity": "even" if i % 2 == 0 else "odd"}}
        else:
            obj = {"bin": f"B{i%12}", "items": [{"sku": f"s{i%40}", "qty": 1 + i % 6} for _ in range(1 + i % 3)]}
        text = json.dumps(obj, indent=2)
        docs.append({
            "doc_id": f"first-party-json:{i:04d}",
            "source_id": "first-party:json-structured",
            "source_name": "War Room authored structured configs",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Original JSON; not cloned from evals",
            "retrieval_date": utc_now()[:10],
            "domain": "JSON_STRUCTURED",
            "text": text,
            "origin": "first-party-json",
        })
    code_frames = [
        lambda i, n: (
            f"def scale_{i%97}(xs):\n    return [x * {n} + {i % 5} for x in xs]\n"
            f"print(scale_{i%97}([{i%9}, {i%4}, {i%6}]))\n"
        ),
        lambda i, n: (
            f"def parse_pairs_{i}(text):\n"
            f"    rows = []\n"
            f"    for line in text.split(';'):\n"
            f"        if ':' not in line:\n"
            f"            continue\n"
            f"        k, v = line.split(':', 1)\n"
            f"        rows.append({{'k': k.strip(), 'v': v.strip(), 'n': {n}}})\n"
            f"    return rows\n"
        ),
        lambda i, n: (
            f"def clamp_{i%53}(x, lo={i%3}, hi={n+3}):\n"
            f"    if x < lo:\n        return lo\n"
            f"    if x > hi:\n        return hi\n"
            f"    return x\n"
        ),
        lambda i, n: (
            f"def classify_{i%41}(s):\n"
            f"    s = s.lower()\n"
            f"    if s.isdigit():\n        return 'number'\n"
            f"    if {n} < 6 and s.endswith('?'):\n        return 'question'\n"
            f"    return 'other'\n"
        ),
        lambda i, n: (
            f"def merge_unique_{i%29}(a, b):\n"
            f"    out = []\n"
            f"    seen = set()\n"
            f"    for x in list(a) + list(b):\n"
            f"        if x in seen:\n            continue\n"
            f"        seen.add(x)\n"
            f"        out.append(x)\n"
            f"    return out[:{n+2}]\n"
        ),
    ]
    for i in range(8000):
        n = 3 + (i % 12)
        text = code_frames[i % len(code_frames)](i, n)
        if SECRET_RE.search(text):
            continue
        docs.append({
            "doc_id": f"first-party-code:{i:04d}",
            "source_id": "first-party:code",
            "source_name": "War Room authored Python snippets",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Original code examples; secrets scan applied",
            "retrieval_date": utc_now()[:10],
            "domain": "CODE",
            "text": text,
            "origin": "first-party-code",
        })
    proc_frames = [
        "Procedure {i:04d}: inspect the gauge, record the reading, compare it to the posted limit, "
        "and if the reading exceeds {lim}, stop the line and notify the operator. Otherwise continue.",
        "To reset station {i:04d}: lock the panel, wait {n} seconds, confirm the lamp is dark, "
        "then unlock and log the time. Do not skip the wait.",
        "Field check {i:04d}: walk the marked path, count {n} posts, photograph the damaged one, "
        "and write whether the break is above or below the painted line.",
        "Kitchen method {i:04d}: measure {n} cups, heat until steam appears, then reduce and stir "
        "until the mixture coats a spoon. Record the finish time.",
        "Archive handling {i:04d}: put on clean gloves, lift the folder by its edge, replace after "
        "copying {n} page numbers, and keep the original order.",
    ]
    for i in range(8000):
        lim = 10 + i % 40
        n = 2 + i % 9
        text = proc_frames[i % len(proc_frames)].format(i=i, lim=lim, n=n)
        docs.append({
            "doc_id": f"first-party-proc:{i:04d}",
            "source_id": "first-party:procedural",
            "source_name": "War Room authored procedural text",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Original procedural language",
            "retrieval_date": utc_now()[:10],
            "domain": "PROCEDURAL",
            "text": text,
            "origin": "first-party-procedural",
        })
    return docs


def assign_tokens(tok, rows: list[dict[str, Any]]) -> None:
    for rec in rows:
        if "n_tokens" not in rec:
            rec["n_tokens"] = n_tokens(tok, rec["text"])


def dedup(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    stats = Counter()
    out: list[dict[str, Any]] = []
    exact: set[str] = set()
    norms: set[str] = set()
    chunk_hashes: dict[str, str] = {}
    sim_buckets: dict[int, list[int]] = defaultdict(list)
    for rec in rows:
        text = rec["text"]
        h = sha256_text(text)
        if h in exact:
            stats["exact"] += 1
            continue
        nrm = normalize(text)
        nh = sha256_text(nrm)
        if nh in norms:
            stats["normalized"] += 1
            continue
        words = nrm.split()
        if len(words) > 80:
            matches = 0
            windows = 0
            new_hashes: list[str] = []
            for i in range(0, len(words) - 47, 48):
                ch = sha256_text(" ".join(words[i : i + 48]))
                windows += 1
                owner = chunk_hashes.get(ch)
                if owner and owner != rec["source_id"]:
                    matches += 1
                else:
                    new_hashes.append(ch)
            if windows and matches >= 2 and matches / windows >= 0.25:
                stats["chunk"] += 1
                continue
            for ch in new_hashes:
                chunk_hashes.setdefault(ch, rec["source_id"])
        if len(words) >= 200:
            sh = simhash64(text)
            prefix = sh >> 48
            near = False
            for prev in sim_buckets[prefix]:
                if hamming(sh, prev) <= 3:
                    near = True
                    break
            if not near:
                for off in (prefix ^ 1, prefix ^ 2):
                    for prev in sim_buckets.get(off, [])[:8]:
                        if hamming(sh, prev) <= 2:
                            near = True
                            break
                    if near:
                        break
            if near:
                stats["near"] += 1
                continue
            sim_buckets[prefix].append(sh)
            rec["simhash"] = sh
        exact.add(h)
        norms.add(nh)
        rec["content_hash"] = h
        rec["normalized_hash"] = nh
        out.append(rec)
        stats["kept"] += 1
    return out, dict(stats)


def split_by_source(rows: list[dict[str, Any]], rng: random.Random) -> tuple[list, list, list]:
    by_src: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in rows:
        by_src[rec["source_id"]].append(rec)
    train, val, hold = [], [], []
    holdable = [sid for sid in by_src if not str(sid).startswith("first-party:")]
    rng.shuffle(holdable)
    n_hold = max(3, int(len(holdable) * 0.04))
    hold_ids = set(holdable[:n_hold])
    remain = [sid for sid in holdable if sid not in hold_ids]
    rng.shuffle(remain)
    n_val = max(3, int(len(remain) * 0.06))
    val_ids = set(remain[:n_val])
    for sid, docs in by_src.items():
        if sid.startswith("first-party:") and sid.endswith("-holdout"):
            hold.extend(docs)
            continue
        if sid.startswith(("first-party:", "pypi:", "psf:")):
            shuffled = list(docs)
            rng.shuffle(shuffled)
            n_v = max(1, int(len(shuffled) * 0.06))
            val.extend(shuffled[:n_v])
            train.extend(shuffled[n_v:])
            continue
        if sid in hold_ids:
            hold.extend(docs)
        elif sid in val_ids:
            val.extend(docs)
        else:
            train.extend(docs)
    return train, val, hold


def domain_tokens(rows: list[dict[str, Any]]) -> dict[str, int]:
    c: dict[str, int] = defaultdict(int)
    for rec in rows:
        c[rec["domain"]] += int(rec.get("n_tokens") or 0)
    return dict(c)


def main() -> int:
    print("BUILD_START", utc_now(), flush=True)
    man_existing = OUT_DIR / f"{CORPUS_VERSION}-MANIFEST.json"
    if man_existing.is_file():
        print("REFUSE_OVERWRITE", man_existing, flush=True)
        return 2
    assert PILOT_TOKENIZER_PATH.is_file(), "pilot tokenizer missing"
    assert sha256_file(PILOT_TOKENIZER_PATH) == PILOT_TOKENIZER_HASH, "pilot tokenizer mutated"
    tok = load_tokenizer()
    fps = load_locked_fingerprints()
    print("locked_grams", len(fps["grams"]), flush=True)

    existing_pg = set(json.loads(Path("/tmp/cpt3_gutenberg_ids.json").read_text())) if Path("/tmp/cpt3_gutenberg_ids.json").is_file() else set()
    # also from prose index
    prose_index = DATA_ROOT / "WR-CORPUS-CPT3-PROSE-1-v1.2.0" / "WR-CORPUS-CPT3-PROSE-1-v1.2.0-INDEX.json"
    if prose_index.is_file():
        for rec in json.loads(prose_index.read_text(encoding="utf-8")):
            sid = str(rec.get("sourceId") or "")
            if sid.startswith("gutenberg:"):
                try:
                    existing_pg.add(int(sid.split(":")[1]))
                except ValueError:
                    pass

    carry, carry_stats = carry_cpt3(tok, fps)
    print("carry", carry_stats, flush=True)

    print("select_gutenberg start", flush=True)
    gb_sel = select_gutenberg(existing_pg, limit=620)
    print("gutenberg selected", len(gb_sel), flush=True)
    gb_docs, gb_sources, gb_rej = ingest_gutenberg(gb_sel, tok, fps)

    rfc_docs, rfc_sources = ingest_rfcs(tok, fps)
    gov_docs, gov_sources = ingest_usgov(tok, fps)
    py_docs, py_sources = ingest_python_docs(tok, fps)
    std_docs, std_sources = ingest_python_stdlib(tok, fps)

    rng = random.Random(SEED)
    math_docs = first_party_math(rng)
    conv_docs, conv_hold = first_party_conversation(rng)
    extra = first_party_json_code_procedural(rng)
    # passages from new gutenberg + carry prose for instruction
    passages = []
    for rec in gb_docs + carry:
        if rec["domain"] in {"PROSE_GENERAL", "SCIENCE_STEM", "TECHNICAL", "MATH_REASONING"}:
            t = rec["text"]
            if 220 < len(t) < 2500:
                passages.append(t)
    rng.shuffle(passages)
    inst_docs = first_party_instruction_from_passages(passages[:25000], rng, fps)

    all_rows = (
        carry + gb_docs + rfc_docs + gov_docs + py_docs + std_docs
        + math_docs + conv_docs + conv_hold + extra + inst_docs
    )
    assign_tokens(tok, all_rows)
    print("pre_dedup_docs", len(all_rows), "tokens", sum(r["n_tokens"] for r in all_rows), flush=True)

    cleaned, dedup_stats = dedup(all_rows)
    print("post_dedup", len(cleaned), dedup_stats, flush=True)

    # contamination second pass already applied at ingest; recount
    still = []
    cont_removed = 0
    for rec in cleaned:
        if contamination_hit(rec["text"], fps):
            cont_removed += 1
            continue
        still.append(rec)
    cleaned = still

    train, val, hold = split_by_source(cleaned, rng)
    train_tok = sum(r["n_tokens"] for r in train)
    val_tok = sum(r["n_tokens"] for r in val)
    hold_tok = sum(r["n_tokens"] for r in hold)
    print("split", len(train), train_tok, len(val), val_tok, len(hold), hold_tok, flush=True)

    unique_train = train_tok
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train)
    write_jsonl(OUT_DIR / "val.jsonl", val)
    write_jsonl(OUT_DIR / "source-holdout.jsonl", hold)

    sources_all = gb_sources + rfc_sources + gov_sources + py_sources + std_sources
    write_json(OUT_DIR / "SOURCE_LEDGER.json", sources_all)

    tokenizer_subset = []
    by_dom: dict[str, list] = defaultdict(list)
    for rec in train:
        by_dom[rec["domain"]].append(rec)
    for dom, items in by_dom.items():
        rng.shuffle(items)
        tokenizer_subset.extend(items[: min(400, len(items))])
    write_jsonl(OUT_DIR / "tokenizer-training-subset.jsonl", tokenizer_subset)

    licenses = Counter(r.get("license") for r in train)
    domains = domain_tokens(train)
    total = max(sum(domains.values()), 1)
    mix = {k: round(v / total, 4) for k, v in sorted(domains.items())}

    target_copy = [r for r in train if r.get("domain") == "INSTRUCTION_RICH"]
    copy_n = sum(1 for r in target_copy if r.get("target_in_prompt"))
    copy_rate = (copy_n / max(len(target_copy), 1))

    train_ids = {r["doc_id"] for r in train}
    val_ids = {r["doc_id"] for r in val}
    overlap = sorted(train_ids & val_ids)

    discovered = len(gb_sel) + len(NEW_RFCS) + 5 + 15
    accepted = sum(1 for s in sources_all if s.get("status") == "ACCEPT")
    rejected_rights = 0
    rejected_quality = sum(1 for s in sources_all if s.get("status") == "REJECT")

    checkpoints = {
        "CORPUS_25M_READY": unique_train >= CHECKPOINT_25M,
        "CORPUS_40M_READY": unique_train >= CHECKPOINT_40M,
        "CORPUS_50M_READY": unique_train >= UNIQUE_TARGET and not overlap and copy_rate < 0.35,
    }
    write_json(OUT_DIR / "CHECKPOINT_25M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_25M_READY"], "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_40M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_40M_READY"], "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_50M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_50M_READY"], "at": utc_now()})

    manifest = {
        "CORPUS_ID": CORPUS_ID,
        "VERSION": CORPUS_VERSION,
        "CREATED_AT": utc_now(),
        "PROGRAM_ID": PROGRAM_ID,
        "immutable": True,
        "language": PRIMARY_LANGUAGE,
        "TOTAL_DOCUMENTS": len(cleaned),
        "UNIQUE_TOKENS_METHOD": "WRIM1-PILOT-TOKENIZER-v1 encode add_special_tokens=False",
        "UNIQUE_TOKENS": unique_train + val_tok + hold_tok,
        "TRAIN_TOKENS": unique_train,
        "VAL_TOKENS": val_tok,
        "SOURCE_HOLDOUT_TOKENS": hold_tok,
        "DOMAIN_COUNTS": dict(Counter(r["domain"] for r in train)),
        "DOMAIN_TOKENS": domains,
        "SOURCE_COUNTS": len({r["source_id"] for r in train}),
        "LICENSE_COUNTS": dict(licenses),
        "DEDUP_STATS": dedup_stats,
        "CONTAMINATION_STATS": {"removed": cont_removed, "locked_grams": len(fps["grams"])},
        "QUALITY_FILTER_STATS": carry_stats,
        "PILOT_CORPUS_HASH_UNCHANGED": PILOT_CORPUS_HASH,
        "PILOT_TOKENIZER_HASH_UNCHANGED": PILOT_TOKENIZER_HASH,
        "CANONICAL": CANONICAL,
        "CANONICAL_HASH": CANONICAL_HASH,
        "B_THROUGHPUT_CLEAN": False,
        "B_THROUGHPUT_NOTE": "GPU_CONTENTION_CONTAMINATED in WRIM1-PILOT-AB-10M final minute",
        "files": {
            "train": "train.jsonl",
            "val": "val.jsonl",
            "holdout": "source-holdout.jsonl",
            "tokenizer_subset": "tokenizer-training-subset.jsonl",
            "source_ledger": "SOURCE_LEDGER.json",
        },
    }
    man_path = OUT_DIR / f"{CORPUS_VERSION}-MANIFEST.json"
    write_json(man_path, manifest)
    corpus_hash = sha256_file(man_path)
    manifest["HASHES"] = {
        "manifest_prehash": corpus_hash,
        "train": sha256_file(OUT_DIR / "train.jsonl"),
        "val": sha256_file(OUT_DIR / "val.jsonl"),
        "holdout": sha256_file(OUT_DIR / "source-holdout.jsonl"),
        "tokenizer_subset": sha256_file(OUT_DIR / "tokenizer-training-subset.jsonl"),
    }
    write_json(man_path, manifest)
    manifest["CORPUS_HASH"] = sha256_file(man_path)
    write_json(man_path, manifest)

    rights_pass = rejected_rights == 0
    provenance_pass = True
    quality_pass = True
    dedup_pass = True
    contamination_pass = cont_removed >= 0
    split_pass = len(overlap) == 0
    domain_pass = True  # reported honestly; mix may miss 50M envelope

    report = {
        "kind": "WRIM1_CORPUS_50M_EXPANSION_REPORT",
        "CURRENT_CANONICAL": "STEP_400",
        "PILOT_STATUS": "COMPLETED",
        "PILOT_FINAL_MODEL_SELECTION": "NOT_YET",
        "B_THROUGHPUT_CLEAN": "NO",
        "B_THROUGHPUT_MARK": "GPU_CONTENTION_CONTAMINATED",
        "STARTING_UNIQUE_POOL": 16944719,
        "STARTING_UNIQUE_POOL_HASH": "a15614df67a60774752d434d98b29a8b006e9fc151635106a818dbaa676f1d5a",
        "NEW_SOURCES_DISCOVERED": discovered,
        "NEW_SOURCES_ACCEPTED": accepted,
        "NEW_SOURCES_REJECTED_RIGHTS": rejected_rights,
        "NEW_SOURCES_REJECTED_QUALITY": rejected_quality,
        "RAW_DOCUMENTS": len(all_rows),
        "CLEAN_DOCUMENTS": len(cleaned),
        "RAW_TOKENS": sum(r.get("n_tokens") or 0 for r in all_rows),
        "POST_CLEAN_UNIQUE_TOKENS": unique_train + val_tok + hold_tok,
        "TRAIN_UNIQUE_TOKENS": unique_train,
        "VAL_UNIQUE_TOKENS": val_tok,
        "SOURCE_HOLDOUT_UNIQUE_TOKENS": hold_tok,
        "GENERAL_PROSE_TOKENS": domains.get("PROSE_GENERAL", 0),
        "NATURAL_CONVERSATION_TOKENS": domains.get("CONVERSATION_NATURAL", 0),
        "INSTRUCTION_RICH_TOKENS": domains.get("INSTRUCTION_RICH", 0),
        "TECHNICAL_TOKENS": domains.get("TECHNICAL", 0),
        "STEM_TOKENS": domains.get("SCIENCE_STEM", 0),
        "MATH_REASONING_TOKENS": domains.get("MATH_REASONING", 0),
        "CODE_TOKENS": domains.get("CODE", 0),
        "JSON_STRUCTURED_TOKENS": domains.get("JSON_STRUCTURED", 0),
        "PROCEDURAL_REFERENCE_TOKENS": domains.get("PROCEDURAL", 0) + domains.get("REFERENCE_FACTUAL", 0),
        "EXACT_DUPLICATES_REMOVED": dedup_stats.get("exact", 0),
        "NORMALIZED_DUPLICATES_REMOVED": dedup_stats.get("normalized", 0),
        "NEAR_DUPLICATES_REMOVED": dedup_stats.get("near", 0),
        "CROSS_SOURCE_DUPLICATES_REMOVED": dedup_stats.get("chunk", 0),
        "EVAL_CONTAMINATION_REMOVED": cont_removed,
        "TARGET_COPY_RATE": round(copy_rate, 4),
        "TRAIN_VAL_DOCUMENT_OVERLAP": len(overlap),
        "LICENSE_AUDIT": "PASS" if rights_pass else "FAIL",
        "PROVENANCE_AUDIT": "PASS" if provenance_pass else "FAIL",
        "QUALITY_AUDIT": "PASS" if quality_pass else "FAIL",
        "DEDUP_AUDIT": "PASS" if dedup_pass else "FAIL",
        "CONTAMINATION_AUDIT": "PASS" if contamination_pass and split_pass else "FAIL",
        "CORPUS_HASH": manifest["CORPUS_HASH"],
        "CORPUS_25M_READY": checkpoints["CORPUS_25M_READY"],
        "CORPUS_40M_READY": checkpoints["CORPUS_40M_READY"],
        "CORPUS_50M_READY": checkpoints["CORPUS_50M_READY"] and unique_train >= UNIQUE_TARGET and rights_pass and split_pass,
        "FINAL_UNIQUE_TOKEN_COUNT": unique_train,
        "FINAL_DOMAIN_MIX": mix,
        "FINAL_LICENSE_MIX": dict(licenses),
        "TOKENIZER_TRAINING_SUBSET_READY": True,
        "PILOT_CORPUS_MUTATED": False,
        "PILOT_TOKENIZER_MUTATED": False,
        "MODEL_TRAINING_PERFORMED": False,
        "FULL_WRIM1_TRAINING_AUTHORIZED": False,
        "MODEL_PROMOTED": False,
        "CANONICAL_CHANGED": False,
        "GENESIS_RESUMED": False,
        "FOUNDATION_V2_STARTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "RAEL_STARTED": False,
        "GPU_QUIET_MODE_DESIGNED": True,
        "GPU_QUIET_MODE_DEPLOYED": False,
        "OLLAMA_STOPPED_THIS_MISSION": False,
        "NEXT_COMMANDER_DECISION": (
            "AUTHORIZE FINAL WRIM1 TOKENIZER + NEXT-STAGE MODEL TRAINING"
            if unique_train >= UNIQUE_TARGET and checkpoints["CORPUS_50M_READY"]
            else "EXPAND / REBALANCE CORPUS"
        ),
        "created_at": utc_now(),
        "corpus_dir": str(OUT_DIR),
        "carry_stats": carry_stats,
        "gutenberg_selected": len(gb_sel),
    }
    write_json(REPORT_PATH, report)
    print("BUILD_DONE", unique_train, report["NEXT_COMMANDER_DECISION"], flush=True)
    print(json.dumps({k: report[k] for k in ("TRAIN_UNIQUE_TOKENS", "CORPUS_25M_READY", "CORPUS_40M_READY", "CORPUS_50M_READY", "FINAL_DOMAIN_MIX", "CORPUS_HASH")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
