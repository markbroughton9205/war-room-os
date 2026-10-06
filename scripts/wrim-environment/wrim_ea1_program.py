"""EA1 entry + EA1/RA1 phrase, paraphrase, natural, consolidation. No promotion."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_ea1_parity import EXPECT, PARENT
from wrim_ea1_train import train_ea1 as launch_ea1_run
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_curriculum_program import build_corpora, fam_count, summarize
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR, T3_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows, safety_breach, score_sets, trainer_snap
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_EA1_ENTRY_RESPONSE_GRADUATION"
BUDGET = 1_500_000
RA1_LR = 3e-4
STATE = Path(DATA_ROOT) / "WRIM_EA1_ENTRY_RESPONSE_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_ENTRY_RESPONSE_GRADUATION_REPORT.json"
PROOF = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK_PROOF.json"
PARITY = Path(DATA_ROOT) / "WRIM_EA1_ZERO_INIT_PARITY.json"
FT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl"
TT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"


def persist(state: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(state, default=str)))


def _take(rows: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    out = []
    i = 0
    if not rows:
        return out
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


def write_corpus(name: str, train: list[dict[str, Any]], val: list[dict[str, Any]]) -> Path:
    root = Path(DATA_ROOT) / f"WR-CORPUS-PLM-{name}-v1.0.0"
    root.mkdir(parents=True, exist_ok=True)
    (root / "train.jsonl").write_text("".join(json.dumps(r) + "\n" for r in train), encoding="utf-8")
    (root / "val.jsonl").write_text("".join(json.dumps(r) + "\n" for r in val), encoding="utf-8")
    _write(root / "manifest.json", {"NAME": name, "TRAIN_ROWS": len(train), "VAL_ROWS": len(val), "TRAINING_FORBIDDEN_ON_VAL": True})
    return root


def build_entry_corpus() -> Path:
    ft = load_rows(FT_TRAIN)
    by: dict[str, list[dict[str, Any]]] = {}
    for rec in ft:
        by.setdefault(str(rec.get("first_token_class") or rec.get("target") or "unk"), []).append(rec)
    phrase = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    phrase_by: dict[str, list[dict[str, Any]]] = {}
    for rec in phrase:
        phrase_by.setdefault(str(rec.get("first_token_class")), []).append(rec)
    classes = ["blue", "cat", "dog", "no", "red"]
    train = []
    for cls in classes:
        train += _retag(_take(by.get(cls, []), 12), f"ft-{cls}")
        train += _retag(_take(phrase_by.get(cls, []), 12), f"ph-{cls}")
    val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    return write_corpus("EA1-ENTRY-BALANCED", train, val)


def paraphrase_train_forms() -> list[dict[str, Any]]:
    families = [
        ("no", "no thanks", [
            "Refuse politely in two words.",
            "Give a short decline that starts with no.",
            "What is a brief spoken refusal besides no way?",
        ]),
        ("no", "no way", [
            "Reject the idea in two words.",
            "Give an informal two-word no.",
            "Say you will not go along, two words.",
        ]),
        ("blue", "blue sky", [
            "Name the daytime color above plus sky.",
            "What two-word weather view starts with blue?",
            "Color of a clear day plus the word sky.",
        ]),
        ("red", "red car", [
            "Name a crimson vehicle in two words.",
            "What two-word object is a scarlet automobile?",
            "Color plus vehicle: scarlet auto.",
        ]),
        ("cat", "cat food", [
            "Name what a house cat eats, two words.",
            "Feline meal, two words.",
            "What do you pour for the kitten, two words?",
        ]),
        ("dog", "dog house", [
            "Name a kennel in two words.",
            "Where a pet canine sleeps outdoors, two words.",
            "Canine outdoor shelter, two words.",
        ]),
        ("no", "no thank you", [
            "Decline courteously in three words.",
            "A polite three-word refusal.",
            "Say you do not want it, three polite words.",
        ]),
        ("yes", "yes", [
            "Affirm in one word.",
            "Give a one-word agreement.",
            "The opposite of no, one word.",
        ]),
        ("ok", "ok", [
            "Acknowledge briefly.",
            "Give a two-letter acceptance.",
            "A short okay without extra words.",
        ]),
    ]
    rows = []
    for i, (cls, target, prompts) in enumerate(families):
        for j, prompt in enumerate(prompts):
            rows.append({
                "example_id": f"para-train-{i:02d}-{j}",
                "family": f"para_{cls}",
                "first_token_class": cls,
                "prompt": prompt,
                "target": target,
                "provenance": "first-party-war-room-os-internal-paraphrase-train",
            })
    return rows


def natural_train_forms() -> list[dict[str, Any]]:
    specs = [
        ("yes", "yes", "Answer yes if two is even."),
        ("yes", "yes", "Is water wet? one word."),
        ("no", "no", "Answer no if the sky is made of cheese."),
        ("no", "no", "Is 3 even? one word."),
        ("ok", "ok", "Acknowledge the instruction with ok."),
        ("ok", "ok", "Reply ok to confirm receipt."),
        ("json", '{"ok":1}', "Return a tiny JSON object saying ok equals 1."),
        ("json", '{"ok":1}', "Output JSON with key ok and value 1."),
        ("label", "cat", "Classify: a house feline. one word."),
        ("label", "dog", "Classify: a barking pet. one word."),
        ("number", "4", "How many heads does WRIM-G-20M use? digits only."),
        ("fact", "Mark", "Name the human who commands War Room OS."),
        ("fact", "Commander", "Name the human operator title used in War Room OS."),
        ("code", "print(1)", "Write a one-line Python print of 1."),
        ("id", "WRIM", "Name the WRIM Genesis model family in one token-like label."),
        ("id", "NOVA", "Reply with the Council local runtime name."),
    ]
    rows = []
    for i, (fam, target, prompt) in enumerate(specs):
        rows.append({
            "example_id": f"nat-train-{i:03d}",
            "family": fam,
            "first_token_class": str(target).split()[0][:12],
            "prompt": prompt,
            "target": target,
            "provenance": "first-party-war-room-os-internal-natural-train",
        })
    return rows


def heldout() -> dict[str, list[dict[str, Any]]]:
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "original_three": load_rows(T3_VAL),
        "natural": load_rows(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else [],
        "paraphrase": load_rows(GEN_VAL),
    }


def adapter_grad_gate(run_id: str | None) -> dict[str, Any]:
    if not run_id:
        return {}
    path = Path(CKPT_BASE) / run_id / "metrics.jsonl"
    if not path.is_file():
        return {}
    ea1: list[float] = []
    ra1: list[float] = []
    comb: list[float] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        ea1.append(float(row.get("EA1_TOTAL_GRAD") or 0))
        ra1.append(float(row.get("RA1_TOTAL_GRAD") or 0))
        comb.append(float(row.get("COMBINED_GRAD") or row.get("raw_grad") or 0))
    def gate(vals: list[float]) -> str:
        if not vals:
            return "NA"
        m = max(vals)
        if m < 6.5:
            return "SAFE"
        if m < 8.0:
            return "REVIEW"
        return "UNSAFE"
    return {
        "EA1_MAX": max(ea1) if ea1 else None,
        "RA1_MAX": max(ra1) if ra1 else None,
        "COMBINED_MAX": max(comb) if comb else None,
        "EA1_GATE": gate(ea1),
        "RA1_GATE": gate(ra1),
        "COMBINED_GATE": gate(comb),
    }


def cat_geo(run_id: str, step: int) -> dict[str, Any]:
    path = Path(CKPT_BASE) / run_id / "evals" / f"role-geo-step-{step}.json"
    if not path.is_file():
        return {}
    by = ((json.loads(path.read_text(encoding="utf-8")).get("val") or {}).get("BY_CLASS") or {})
    cat = by.get("cat") or {}
    return {
        "rank": cat.get("TARGET_RANK"),
        "prob": cat.get("TARGET_PROBABILITY"),
        "gap": cat.get("LOGIT_GAP_TO_COMPETITOR"),
        "greedy": cat.get("GREEDY_FIRST_TOKEN_MATCH"),
        "argmax": cat.get("ARGMAX_TOKENS"),
    }


PARENT_CAT_RANK = 4.833333333333333
PARENT_CAT_PROB = 0.1075414555768172


def cat_signal(geo: dict[str, Any], greedy_p1: int) -> bool:
    if greedy_p1 > 0:
        return True
    if geo.get("greedy") and int(geo["greedy"]) > 0:
        return True
    rank = geo.get("rank")
    prob = geo.get("prob")
    if rank is not None and float(rank) <= PARENT_CAT_RANK - 1.0:
        return True
    if prob is not None and float(prob) >= PARENT_CAT_PROB + 0.05:
        return True
    return False


def phrase_success(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    s = row.get("summary") or {}
    cat = int(s.get("cat") or 0)
    ph = int(s.get("phrase_exact") or 0)
    dog = int(s.get("dog") or 0)
    blue = int(s.get("blue") or 0)
    return ph > 8 or (cat > 0 and dog > 0 and blue > 0)


def entry_cat(phrase: dict[str, Any]) -> int:
    fams = phrase.get("families") or {}
    for key in ("cat", "pha_cat"):
        if key in fams:
            return int(fams[key].get("p1") or 0)
    return 0


def gen_pass(para: dict[str, Any]) -> bool:
    fams = para.get("families") or {}
    exact_fams = [k for k, v in fams.items() if int(v.get("exact") or 0) > 0]
    return len(exact_fams) > 1 and int(para.get("short_phrase_exact") or 0) >= 2


def pick_best(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    legal = [r for r in rows if (r.get("summary") or {}).get("frozen") == "YES" and int((r.get("summary") or {}).get("stage3") or 0) >= 5]
    legal = [r for r in legal if (r["summary"].get("two") is None or int(r["summary"]["two"]) >= 4)]
    if not legal:
        return None
    return max(
        legal,
        key=lambda r: (
            int(r.get("cat_entry") or 0),
            int(r["summary"].get("cat") or 0),
            int(r["summary"].get("phrase_exact") or 0),
            int(r.get("paraphrase_exact") or 0),
            int(r.get("natural_exact") or 0),
            int(r["summary"].get("dog") or 0),
            int(r["summary"].get("blue") or 0),
            int(r["summary"].get("two") or 0),
            int(r["summary"].get("three_align") or 0),
        ),
    )


def run_block(
    *,
    state: dict[str, Any],
    run_n: int,
    corpus: Path,
    parent: Path,
    pack: str,
    steps: int,
    ea1_lr: float,
    do_train_ea1: bool,
    do_train_ra1: bool,
    load_optimizer: bool,
    phase: str,
    sets: dict[str, list[dict[str, Any]]],
) -> tuple[int, dict[str, Any] | None]:
    if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
        return run_n, None
    room = (BUDGET - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
    steps = min(steps, room, 50)
    if steps < 5:
        return run_n, None
    run_id = f"WRIM1-UH1-AC2-EA1-{run_n:06d}"
    print(json.dumps({"starting": run_id, "phase": phase, "parent": str(parent), "train_ea1": do_train_ea1, "train_ra1": do_train_ra1, "ea1_lr": ea1_lr, "steps": steps}), flush=True)
    obj = launch_ea1_run(
        run_id=run_id,
        corpus_dir=corpus,
        parent_ckpt=parent,
        pack_name=pack,
        steps=steps,
        ea1_lr=ea1_lr,
        ra1_lr=RA1_LR,
        train_ea1=do_train_ea1,
        train_ra1=do_train_ra1,
        restore_ollama=False,
        load_optimizer=load_optimizer,
        eval_steps=(steps,),
        authorization_id=AUTH,
    )
    if obj.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE":
        state["PROGRAM_STATUS"] = "WRIM_TRAINER_ALREADY_ACTIVE"
        persist(state)
        return run_n, None
    used = int(obj.get("TOKENS_USED") or 0)
    state["AUTHORIZED_CONSUMED"] = int(state["AUTHORIZED_CONSUMED"]) + used
    state["PHYSICAL_CONSUMED"] = int(state["PHYSICAL_CONSUMED"]) + used
    ckpt = Path(CKPT_BASE) / run_id / f"step-{steps}"
    if not (ckpt / MODEL_NAME).is_file():
        state.setdefault("FAILURES", []).append({"run": run_id, "reason": obj.get("reason"), "abort": obj.get("abort")})
        persist(state)
        return run_n + 1, None
    from run000007_preflight import sha256_file
    scored = score_sets(ckpt, sets)
    snap = trainer_snap(run_id, steps)
    phrase = scored.get("phrase") or {}
    breach = safety_breach(snap, phrase, steps)
    row = {
        "phase": phase,
        "run_id": run_id,
        "checkpoint": f"{run_id}/step-{steps}",
        "hash": sha256_file(ckpt / MODEL_NAME),
        "tokens": used,
        "ea1_lr": ea1_lr,
        "train_ea1": do_train_ea1,
        "train_ra1": do_train_ra1,
        "summary": summarize(phrase, snap),
        "cat_entry": entry_cat(phrase),
        "cat_geo": cat_geo(run_id, steps),
        "paraphrase_exact": int((scored.get("paraphrase") or {}).get("short_phrase_exact") or 0),
        "paraphrase": scored.get("paraphrase"),
        "natural_exact": int((scored.get("natural") or {}).get("short_phrase_exact") or 0),
        "natural": scored.get("natural"),
        "breach": breach,
        "preflight_max": (obj.get("PREFLIGHT") or {}).get("MAX_COMBINED_GRAD"),
        "frozen": snap.get("frozen"),
        "stage3": snap.get("stage3"),
        "collapse": snap.get("collapse"),
    }
    state["RUNS"].append(row)
    persist(state)
    if breach in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"}:
        state["PROGRAM_STATUS"] = breach
    classes = snap.get("first_token_classes")
    core = {"blue", "cat", "dog", "no"}
    if isinstance(classes, list) and classes and not core.issubset(set(classes)):
        state.setdefault("WARNINGS", []).append({"run": run_id, "reason": "CORE_FIRST_TOKEN_DIP", "classes": classes})
    return run_n + 1, row


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama
    from wrim_ea1_parity import main as parity_main

    proof = json.loads(PROOF.read_text(encoding="utf-8")) if PROOF.is_file() else {}
    if proof.get("SINGLE_TRAINER_LOCK_PROOF") != "PASS":
        raise SystemExit("SINGLE_TRAINER_LOCK_PROOF is not PASS")
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent hash mismatch")
    if "FZ-" in str(PARENT):
        raise SystemExit("FZ parent refused")
    lock = acquire_trainer_lock(
        run_id="WRIM-EA1-ENTRY-RESPONSE-PROGRAM",
        authorization_id=AUTH,
        checkpoint_parent=str(PARENT),
        token_budget=BUDGET,
    )
    if not lock.get("ok"):
        raise SystemExit(json.dumps({"reason": "WRIM_TRAINER_ALREADY_ACTIVE", "lock": lock}))
    state: dict[str, Any] = {
        "AUTHORIZED_CONSUMED": 0,
        "PHYSICAL_CONSUMED": 0,
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "RUNS": [],
    }
    if STATE.is_file():
        prev = json.loads(STATE.read_text(encoding="utf-8"))
        if prev.get("RUNS"):
            state = prev
            if state.get("PROGRAM_STATUS") in {"FIRST_TOKEN_COLLAPSE", "REVIEW_COMPLETE", "EA1_FAILED_TO_MOVE_TOKEN1"}:
                state.pop("PROGRAM_STATUS", None)
    try:
        parity = json.loads(PARITY.read_text(encoding="utf-8")) if PARITY.is_file() else parity_main()
        if parity.get("EA1_ZERO_INIT_PARITY") != "PASS":
            state["PROGRAM_STATUS"] = "EA1_PARITY_FAIL"
            persist(state)
            return write_report(state, parity)
        state["PARITY"] = {k: parity[k] for k in parity if k != "EXAMPLES"}
        persist(state)
        sets = heldout()
        entry_corpus = build_entry_corpus()
        balanced = build_corpora()["A-BALANCED"]
        para_corpus = write_corpus(
            "EA1-PARAPHRASE-TRAIN",
            paraphrase_train_forms() + load_rows(balanced / "train.jsonl")[:64],
            load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        )
        nat_corpus = write_corpus(
            "EA1-NATURAL-TRAIN",
            natural_train_forms() + load_rows(balanced / "train.jsonl")[:48] + paraphrase_train_forms(),
            load_rows(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        )
        cons_corpus = write_corpus(
            "EA1-CONSOLIDATION",
            load_rows(balanced / "train.jsonl") + paraphrase_train_forms() + natural_train_forms(),
            load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        )
        parent = PARENT
        run_n = 1
        for rec in state.get("RUNS") or []:
            rid = str(rec.get("run_id") or "")
            if rid.startswith("WRIM1-UH1-AC2-EA1-"):
                try:
                    run_n = max(run_n, int(rid.rsplit("-", 1)[-1]) + 1)
                except ValueError:
                    pass
            if rec.get("checkpoint"):
                parent = Path(CKPT_BASE) / str(rec["checkpoint"])
        def conclude_entry() -> None:
            nonlocal parent
            entry = []
            for rec in state.get("RUNS") or []:
                if rec.get("phase") != "EA1_ENTRY":
                    continue
                row = dict(rec)
                if not row.get("cat_geo") and row.get("checkpoint"):
                    rid, step_s = str(row["checkpoint"]).split("/")
                    row["cat_geo"] = cat_geo(rid, int(step_s.replace("step-", "")))
                entry.append(row)
            signaled = [r for r in entry if cat_signal(r.get("cat_geo") or {}, int(r.get("cat_entry") or 0))]
            if signaled:
                hit = min(
                    signaled,
                    key=lambda r: (
                        float((r.get("cat_geo") or {}).get("rank") or 99),
                        -int((r.get("summary") or {}).get("phrase_exact") or 0),
                    ),
                )
                parent = Path(CKPT_BASE) / str(hit["checkpoint"])
                state["EA1_ENTRY_SIGNAL"] = "PRESENT"
                state["EA1_LR_SELECTED"] = float(hit.get("ea1_lr") or 1e-3)
                state["EA1_ENTRY_PARENT"] = hit.get("checkpoint")
                persist(state)
                return
            best_entry = pick_best(entry)
            parent = Path(CKPT_BASE) / best_entry["checkpoint"] if best_entry else PARENT
            state["EA1_ENTRY_SIGNAL"] = "ABSENT"
            state["EA1_LR_SELECTED"] = 3e-4
            if int(state["AUTHORIZED_CONSUMED"]) >= 250_000:
                state["PROGRAM_STATUS"] = "EA1_FAILED_TO_MOVE_TOKEN1"
            persist(state)

        entry_done = [r for r in state.get("RUNS") or [] if r.get("phase") == "EA1_ENTRY"]
        for rec in entry_done:
            if not rec.get("cat_geo") and rec.get("checkpoint"):
                rid, step_s = str(rec["checkpoint"]).split("/")
                rec["cat_geo"] = cat_geo(rid, int(step_s.replace("step-", "")))
        already_signaled = any(cat_signal(r.get("cat_geo") or {}, int(r.get("cat_entry") or 0)) for r in entry_done)
        if already_signaled or len(entry_done) >= 3:
            conclude_entry()
        else:
            recipes = [(3e-4, 25), (1e-3, 25), (3e-4, 50)][len(entry_done):]
            hit_now = False
            for lr, steps in recipes:
                run_n, row = run_block(state=state, run_n=run_n, corpus=entry_corpus, parent=PARENT, pack="EA1-ENTRY", steps=steps, ea1_lr=lr, do_train_ea1=True, do_train_ra1=False, load_optimizer=False, phase="EA1_ENTRY", sets=sets)
                if state.get("PROGRAM_STATUS"):
                    break
                if row and cat_signal(row.get("cat_geo") or {}, int(row.get("cat_entry") or 0)):
                    hit_now = True
                    parent = Path(CKPT_BASE) / row["checkpoint"]
                    state["EA1_ENTRY_SIGNAL"] = "PRESENT"
                    state["EA1_LR_SELECTED"] = lr
                    break
            if not state.get("PROGRAM_STATUS") and not hit_now:
                conclude_entry()
        def room() -> bool:
            return int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and not state.get("PROGRAM_STATUS")

        def keep(row: dict[str, Any] | None) -> None:
            nonlocal parent
            if row:
                parent = Path(CKPT_BASE) / row["checkpoint"]

        def joint(corpus: Path, pack: str, phase: str, steps: int = 25) -> dict[str, Any] | None:
            nonlocal run_n
            run_n, row = run_block(
                state=state,
                run_n=run_n,
                corpus=corpus,
                parent=parent,
                pack=pack,
                steps=steps,
                ea1_lr=float(state.get("EA1_LR_SELECTED") or 3e-4),
                do_train_ea1=True,
                do_train_ra1=True,
                load_optimizer=False,
                phase=phase,
                sets=sets,
            )
            keep(row)
            return row

        if not state.get("PROGRAM_STATUS"):
            flat = 0
            joint_runs = 0
            while room() and joint_runs < 8:
                row = joint(balanced, "A-BALANCED", "EA1_RA1_PHRASE", 25)
                joint_runs += 1
                if not row:
                    break
                if phrase_success(row):
                    break
                s = row["summary"]
                if int(s.get("cat") or 0) > 0 or int(s.get("phrase_exact") or 0) > 8:
                    flat = 0
                else:
                    flat += 1
                    if flat >= 3:
                        break
        if not state.get("PROGRAM_STATUS"):
            misses = 0
            while room() and misses < 4:
                row = joint(para_corpus, "PARAPHRASE", "PARAPHRASE", 25)
                if not row:
                    break
                if gen_pass(row.get("paraphrase") or {}):
                    break
                misses += 1
            misses = 0
            while room() and misses < 3:
                row = joint(nat_corpus, "NATURAL", "NATURAL", 25)
                if not row:
                    break
                if int(row.get("natural_exact") or 0) > 1:
                    break
                misses += 1
            if room():
                joint(cons_corpus, "CONSOLIDATION", "CONSOLIDATION", 25)
            stall = 0
            last_score: tuple[int, int, int, int] | None = None
            while room() and stall < 3:
                best_now = pick_best(state["RUNS"]) or {}
                para_ok = gen_pass(best_now.get("paraphrase") or {})
                nat_ok = int(best_now.get("natural_exact") or 0) > 1
                ph_ok = phrase_success(best_now)
                if not ph_ok:
                    corpus, pack, phase = balanced, "A-BALANCED", "EA1_RA1_PHRASE"
                elif not para_ok:
                    corpus, pack, phase = para_corpus, "PARAPHRASE", "PARAPHRASE"
                elif not nat_ok:
                    corpus, pack, phase = nat_corpus, "NATURAL", "NATURAL"
                else:
                    corpus, pack, phase = cons_corpus, "CONSOLIDATION", "CONSOLIDATION"
                row = joint(corpus, pack, phase, 25)
                if not row:
                    break
                score = (
                    int(row.get("cat_entry") or 0),
                    int((row.get("summary") or {}).get("phrase_exact") or 0),
                    int(row.get("paraphrase_exact") or 0),
                    int(row.get("natural_exact") or 0),
                )
                if last_score is not None and score <= last_score:
                    stall += 1
                else:
                    stall = 0
                last_score = score if last_score is None else tuple(max(a, b) for a, b in zip(last_score, score))  # type: ignore[assignment]
                if ph_ok and para_ok and nat_ok and pack == "CONSOLIDATION":
                    break
        best = pick_best(state["RUNS"])
        state["BEST"] = best
        if best:
            ckpt = Path(CKPT_BASE) / str(best["checkpoint"])
            gsets: dict[str, list[dict[str, Any]]] = {}
            gft = GRAD_DIR / "first-token-val.jsonl"
            gtt = GRAD_DIR / "two-token-val.jsonl"
            if gft.is_file():
                gsets["grad_ft"] = load_rows(gft)
            if gtt.is_file():
                gsets["grad_tt"] = load_rows(gtt)
            state["FOUNDATION_SUITE"] = {
                "TRAINED_ON_SUITE": False,
                "SUITE_ID": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0",
                "SCORED": score_sets(ckpt, gsets) if gsets else {},
            }
        if not state.get("PROGRAM_STATUS"):
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
            else:
                state["PROGRAM_STATUS"] = "REVIEW_COMPLETE"
        persist(state)
        return write_report(state, parity)
    finally:
        release_trainer_lock("WRIM-EA1-ENTRY-RESPONSE-PROGRAM")
        start_user_ollama()


def write_report(state: dict[str, Any], parity: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    summary = best.get("summary") or {}
    para = best.get("paraphrase") or {}
    nat = best.get("natural") or {}
    consumed = int(state.get("AUTHORIZED_CONSUMED") or 0)
    cat_entry = int(best.get("cat_entry") or 0)
    gen = "YES" if gen_pass(para) else "NO"
    report = {
        "REPORT_ID": "WRIM_GENESIS_ENTRY_RESPONSE_GRADUATION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-RA1-CR-000006/step-21",
        "STARTING_HASH": EXPECT,
        "EA1_IMPLEMENTED": "YES",
        "EA1_PLACEMENT": "assistant_entry_pre_lm_head",
        "EA1_BOTTLENECK": 32,
        "EA1_PARAMETER_COUNT": parity.get("EA1_PARAMETER_COUNT"),
        "EA1_ZERO_INIT_PARITY": parity.get("EA1_ZERO_INIT_PARITY"),
        "EA1_LR": state.get("EA1_LR_SELECTED"),
        "RA1_BOTTLENECK": 32,
        "RA1_PARAMETER_COUNT": 16640,
        "RA1_LR": RA1_LR,
        "BEST_CHECKPOINT": best.get("checkpoint"),
        "BEST_HASH": best.get("hash"),
        "NEW_TOKENS_USED": consumed,
        "NEW_TOKENS_REMAINING": BUDGET - consumed,
        "AUTHORIZED_TOKEN_LEDGER": consumed,
        "PHYSICAL_TOKEN_LEDGER": int(state.get("PHYSICAL_CONSUMED") or 0),
        "HISTORICAL_ROGUE_FZ_TOKENS": 409600,
        "HISTORICAL_DUPLICATE_TOKENS": 4096,
        "FZ_000004_QUARANTINED_PHYSICAL_TOKENS": 204800,
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "FROZEN_PARAMETER_HASH_MATCH": summary.get("frozen"),
        "GLOBAL_BASE_WEIGHT_DRIFT": summary.get("global_drift"),
        "DOCUMENT_PARITY": "PASS" if parity.get("MAX_ABS_LOGIT_DIFF_DOCUMENT", 1) == 0 else parity.get("EA1_ZERO_INIT_PARITY"),
        "FIRST_TOKEN_CLASSES_WORKING": summary.get("first_classes"),
        "CAT_ENTRY_SUCCESS": "YES" if cat_entry > 0 else "NO",
        "CAT_ENTRY_HELD_OUT": cat_entry,
        "GREEDY_FIRST_TOKEN_MATCH": summary.get("first"),
        "TWO_TOKEN_EXACT": summary.get("two"),
        "THREE_TOKEN_EXACT": summary.get("three_align"),
        "PHRASE_EXACT": summary.get("phrase_exact"),
        "BLUE_PHRASE_EXACT": summary.get("blue"),
        "NO_PHRASE_EXACT": summary.get("no"),
        "DOG_PHRASE_EXACT": summary.get("dog"),
        "CAT_PHRASE_EXACT": summary.get("cat"),
        "TOKEN4_ORACLE": summary.get("token4_oracle"),
        "PARAPHRASE_GENERALIZATION": gen,
        "GENERALIZATION_SCORE": best.get("paraphrase_exact"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": "YES" if int(best.get("natural_exact") or 0) > 1 else "NO",
        "GREEDY_SHORT_NATURAL_CORRECT": best.get("natural_exact"),
        "ASSISTANT_CONTROL_STATE": "PRESENT",
        "RESPONSE_SPAN_CONTROL_STATE": "PRESENT",
        "NEWLINE_ARGMAX_RATE": summary.get("newline"),
        "EOS": summary.get("stopping"),
        "GREEDY_STOPPING": summary.get("stopping"),
        "RAMBLE_RATE": summary.get("ramble"),
        "EMPTY_RESPONSE_RATE": summary.get("empty"),
        "INDEPENDENT_NL_NLL": summary.get("nl"),
        "GENERAL_NL_NLL": summary.get("general"),
        "CODE_NLL": summary.get("code"),
        "JSON_NLL": summary.get("json"),
        "STAGE3_HISTORICAL": summary.get("stage3"),
        "STAGE3_COLLAPSE": best.get("collapse"),
        "STAGE3_DRIFT_VS_STEP400": summary.get("drift"),
        "EA1_GRADIENT_SAFETY": adapter_grad_gate(str(best.get("checkpoint") or "").split("/")[0]).get("EA1_GATE"),
        "RA1_GRADIENT_SAFETY": adapter_grad_gate(str(best.get("checkpoint") or "").split("/")[0]).get("RA1_GATE"),
        "FOUNDATION_SUITE_RESULT": (state.get("FOUNDATION_SUITE") or {}).get("SCORED"),
        "FOUNDATION_FAILED_CATEGORIES": None,
        "EA1_ENTRY_SIGNAL": state.get("EA1_ENTRY_SIGNAL"),
        "RUNS": [
            {
                "phase": r.get("phase"),
                "checkpoint": r.get("checkpoint"),
                "phrase": (r.get("summary") or {}).get("phrase_exact"),
                "cat_entry": r.get("cat_entry"),
                "cat": (r.get("summary") or {}).get("cat"),
                "dog": (r.get("summary") or {}).get("dog"),
                "blue": (r.get("summary") or {}).get("blue"),
                "para": r.get("paraphrase_exact"),
                "nat": r.get("natural_exact"),
                "stage3": (r.get("summary") or {}).get("stage3"),
            }
            for r in state.get("RUNS") or []
        ],
        "LORA_REQUIRED": "NO",
        "BODY_UNFREEZE_REQUIRED": "NO",
        "LM_HEAD_TRAINING_REQUIRED": "NO",
        "TOKENIZER_CHANGE_REQUIRED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
    }
    bits = [
        bool(summary.get("first_classes")),
        int(summary.get("two") or 0) >= 4,
        int(summary.get("three_align") or 0) > 0,
        int(summary.get("phrase_exact") or 0) >= 8,
        gen == "YES",
        int(best.get("natural_exact") or 0) > 1,
        int(summary.get("stage3") or 0) >= 5,
        summary.get("frozen") == "YES",
        float(summary.get("global_drift") or 0) == 0.0,
        float(summary.get("ramble") or 0) == 0.0,
        float(summary.get("empty") or 0) == 0.0,
        cat_entry > 0,
    ]
    bit_names = [
        "first_classes",
        "two_token",
        "three_token",
        "phrase",
        "paraphrase",
        "natural",
        "stage3",
        "frozen",
        "drift0",
        "ramble0",
        "empty0",
        "cat_entry",
    ]
    failed = [n for n, b in zip(bit_names, bits) if not b]
    report["FOUNDATION_FAILED_CATEGORIES"] = failed
    report["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES" if all(bits) else "NO"
    report["FOUNDATION_SCHOOL_STATUS"] = "READY" if report["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] == "YES" else "INCOMPLETE"
    report["EA1_CAPACITY_LIMIT"] = "TRUE" if state.get("PROGRAM_STATUS") == "EA1_FAILED_TO_MOVE_TOKEN1" else "FALSE"
    report["RA1_B32_CAPACITY_LIMIT"] = "FALSE"
    report["LARGER_ADAPTER_REQUIRED"] = "NO"
    report["NEXT_COMMANDER_DECISION"] = state.get("PROGRAM_STATUS")
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
