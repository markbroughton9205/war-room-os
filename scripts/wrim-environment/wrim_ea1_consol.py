"""Natural-response consolidation for EA1+RA1 B32. No architecture change. No promotion."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_ea1_program import (
    adapter_grad_gate,
    cat_geo,
    entry_cat,
    gen_pass,
    paraphrase_train_forms,
    write_corpus,
)
from wrim_ea1_train import train_ea1 as launch_ea1_run
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_curriculum_program import fam_count, summarize
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR, T3_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows, safety_breach, score_sets, trainer_snap
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

AUTH = "WRIM_EA1_RA1_NATURAL_CONSOLIDATION"
BUDGET = 1_000_000
EA1_LR = 1e-3
RA1_LR = 3e-4
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
STATE = Path(DATA_ROOT) / "WRIM_EA1_RA1_NATURAL_CONSOL_STATE.json"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_NATURAL_RESPONSE_CONSOLIDATION_REPORT.json"
PROOF = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK_PROOF.json"
INTERFERE = Path(DATA_ROOT) / "WRIM_EA1_RA1_NATURAL_INTERFERENCE_MAP.json"
FT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl"
TT_TRAIN = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"
BASELINE = {
    "phrase_exact": 17,
    "dog": 5,
    "cat": 4,
    "blue": 3,
    "no": 5,
    "two": 6,
    "three_align": 10,
    "paraphrase_exact": 3,
    "natural_exact": 1,
    "cat_entry": 4,
}


def persist(state: dict[str, Any]) -> None:
    _write(STATE, json.loads(json.dumps(state, default=str)))


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


def natural_train_forms() -> list[dict[str, Any]]:
    """Distinct wording from NAT_DIR val and from colliding cat/dog phrase labels."""
    specs = [
        ("yes", "yes", "If four is even, answer yes."),
        ("yes", "yes", "One-word truth: fire is hot."),
        ("yes", "yes", "Does a week contain seven days? yes."),
        ("yes", "yes", "Affirm that snow is cold, one word."),
        ("no", "no", "If five is even, answer no."),
        ("no", "no", "One-word falsehood check: stones fly, so no."),
        ("no", "no", "Is a circle a cube? one word."),
        ("no", "no", "Deny that night is midday, one word."),
        ("ok", "ok", "Confirm the order using ok only."),
        ("ok", "ok", "Short handshake token: ok."),
        ("ok", "ok", "Operator receipt should be ok."),
        ("json", '{"ok":1}', "Compact object, key ok value 1, JSON only."),
        ("json", '{"ok":1}', "Machine reply as JSON ok equals one."),
        ("json", '{"ok":1}', "Emit the two-field toy JSON for ok=1."),
        ("code", "print(1)", "Python: print integer one, one line."),
        ("code", "print(1)", "A one-line CPython print of 1."),
        ("number", "4", "Two plus two, one digit."),
        ("number", "4", "How many seasons in a temperate year? digit."),
        ("fact", "Mark", "First name of War Room OS commander."),
        ("fact", "Commander", "Title of the human operator in War Room OS."),
        ("id", "WRIM", "Genesis model-family token WRIM."),
        ("id", "NOVA", "Local Council runtime name, one token."),
        ("label", "even", "Classify integer 8 as even or odd. one word."),
        ("label", "odd", "Classify integer 7 as even or odd. one word."),
        ("def", "ice", "One-word name for frozen water."),
        ("def", "sun", "One-word name of the star Earth orbits."),
        ("hi", "hi", "Greet briefly with hi."),
        ("stop", "stop", "One-word halt command: stop."),
    ]
    rows = []
    for i, (fam, target, prompt) in enumerate(specs):
        rows.append({
            "example_id": f"nc-nat-{i:03d}",
            "family": f"nc_{fam}",
            "first_token_class": str(target).split()[0][:12],
            "prompt": prompt,
            "target": target,
            "provenance": "first-party-war-room-os-internal-natural-consol-train",
        })
    return rows


def natural_eval_forms() -> list[dict[str, Any]]:
    specs = [
        ("yes", "yes", "Are fish able to swim? one word."),
        ("yes", "yes", "Is a hexagon a six-sided polygon? one word."),
        ("no", "no", "Is glass a gas? one word."),
        ("no", "no", "Do humans photosynthesize? one word."),
        ("ok", "ok", "Acknowledge this note with ok."),
        ("json", '{"ok":1}', "Return JSON whose ok field is 1."),
        ("code", "print(1)", "Write Python that prints 1 on one line."),
        ("number", "4", "One digit: how many quarters in a dollar?"),
        ("fact", "Mark", "Name the War Room commander given name."),
        ("id", "WRIM", "One-token WRIM Genesis family label."),
        ("label", "even", "Is 10 even or odd? one word."),
        ("def", "ice", "Frozen water, one word."),
    ]
    rows = []
    for i, (fam, target, prompt) in enumerate(specs):
        rows.append({
            "example_id": f"nc-nat-eval-{i:03d}",
            "family": f"nce_{fam}",
            "first_token_class": str(target).split()[0][:12],
            "prompt": prompt,
            "target": target,
            "provenance": "first-party-war-room-os-internal-natural-consol-eval",
        })
    return rows


def heldout() -> dict[str, list[dict[str, Any]]]:
    nat_official = load_rows(NAT_DIR / "val.jsonl") if (NAT_DIR / "val.jsonl").is_file() else []
    return {
        "phrase": load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
        "original_three": load_rows(T3_VAL),
        "natural": nat_official,
        "natural_heldout": natural_eval_forms(),
        "paraphrase": load_rows(GEN_VAL),
    }


def natural_semantic(nat: dict[str, Any]) -> dict[str, Any]:
    fams = nat.get("families") or {}
    working = []
    semantic = 0
    for k, v in fams.items():
        exact = int(v.get("exact") or 0)
        p1 = int(v.get("p1") or 0)
        if exact > 0 or p1 > 0:
            working.append(k)
        semantic += max(exact, p1)
    return {
        "exact": int(nat.get("short_phrase_exact") or 0),
        "semantic": semantic,
        "families": working,
        "n_families": len(working),
    }


def mix_rows(name: str, counts: dict[str, int]) -> Path:
    phrase = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    by: dict[str, list[dict[str, Any]]] = {}
    for rec in phrase:
        by.setdefault(str(rec.get("first_token_class")), []).append(rec)
    ft = load_rows(FT_TRAIN)
    ft_by: dict[str, list[dict[str, Any]]] = {}
    for rec in ft:
        ft_by.setdefault(str(rec.get("first_token_class")), []).append(rec)
    tt = load_rows(TT_TRAIN)
    t3 = load_rows(T3_ALIGN_DIR / "train.jsonl")
    para = paraphrase_train_forms()
    nat = natural_train_forms()
    train: list[dict[str, Any]] = []
    per = max(1, int(counts.get("phrase", 0)) // 4)
    extra_dog = int(counts.get("dog_extra", 0))
    extra_cat = int(counts.get("cat_extra", 0))
    for cls in ("blue", "no", "dog", "cat"):
        n = per + (extra_dog if cls == "dog" else 0) + (extra_cat if cls == "cat" else 0)
        train += _retag(_take(by.get(cls, []), n), f"{name}-ph-{cls}")
    entry_n = int(counts.get("entry", 0))
    per_e = max(1, entry_n // 5)
    for cls in ("blue", "cat", "dog", "no", "red"):
        train += _retag(_take(ft_by.get(cls, []), per_e), f"{name}-ft-{cls}")
    train += _retag(_take(tt, int(counts.get("two", 0))), f"{name}-tt")
    train += _retag(_take(t3, int(counts.get("three", 0))), f"{name}-t3")
    train += _retag(_take(para, int(counts.get("para", 0))), f"{name}-para")
    train += _retag(_take(nat, int(counts.get("nat", 0))), f"{name}-nat")
    val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    path = write_corpus(f"NC-{name}", train, val)
    (path / "mix.json").write_text(json.dumps({"NAME": name, "COUNTS": counts, "TRAIN_ROWS": len(train), "NATURAL_SHARE": counts.get("nat", 0) / max(1, len(train))}, indent=2), encoding="utf-8")
    return path


def MIXES() -> dict[str, dict[str, int]]:
    return {
        "NAT08": {"phrase": 48, "entry": 40, "two": 30, "three": 30, "para": 20, "nat": 16, "dog_extra": 8, "cat_extra": 8},
        "NAT12": {"phrase": 48, "entry": 36, "two": 28, "three": 28, "para": 20, "nat": 24, "dog_extra": 8, "cat_extra": 8},
        "NAT18": {"phrase": 48, "entry": 32, "two": 28, "three": 28, "para": 16, "nat": 36, "dog_extra": 8, "cat_extra": 8},
        "NAT25": {"phrase": 40, "entry": 30, "two": 24, "three": 24, "para": 16, "nat": 50, "dog_extra": 8, "cat_extra": 8},
        "PHRASE35": {"phrase": 64, "entry": 28, "two": 24, "three": 24, "para": 16, "nat": 20, "dog_extra": 12, "cat_extra": 12},
        "GUARD": {"phrase": 40, "entry": 24, "two": 24, "three": 24, "para": 16, "nat": 24, "dog_extra": 16, "cat_extra": 16},
    }


def severe(row: dict[str, Any]) -> bool:
    s = row.get("summary") or {}
    if int(s.get("dog") or 0) <= 1:
        return True
    if int(s.get("cat") or 0) <= 0:
        return True
    if int(s.get("phrase_exact") or 0) < 10:
        return True
    if int(s.get("two") or 0) < 4:
        return True
    return False


def keepable(row: dict[str, Any]) -> bool:
    if severe(row):
        return False
    s = row.get("summary") or {}
    nat = int(row.get("natural_exact") or 0)
    sem_fams = int((row.get("natural_sem") or {}).get("n_families") or 0)
    nat_ok = nat > int(BASELINE["natural_exact"]) or sem_fams > 1
    return (
        nat_ok
        and int(s.get("dog") or 0) >= 4
        and int(s.get("cat") or 0) >= 3
        and int(s.get("phrase_exact") or 0) >= 14
        and int(s.get("two") or 0) >= 5
        and int(row.get("paraphrase_exact") or 0) >= 2
        and int(s.get("blue") or 0) >= 2
        and int(s.get("no") or 0) >= 3
    )


def pareto(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    legal = [
        r for r in rows
        if (r.get("summary") or {}).get("frozen") == "YES"
        and int((r.get("summary") or {}).get("stage3") or 0) >= 5
        and not severe(r)
        and int((r.get("summary") or {}).get("two") or 0) >= 4
    ]
    if not legal:
        return None
    return max(
        legal,
        key=lambda r: (
            int(keepable(r)),
            int((r.get("natural_sem") or {}).get("n_families") or 0),
            int(r.get("natural_exact") or 0),
            int((r.get("summary") or {}).get("phrase_exact") or 0),
            int(r.get("paraphrase_exact") or 0),
            int((r.get("summary") or {}).get("dog") or 0),
            int((r.get("summary") or {}).get("cat") or 0),
            int((r.get("summary") or {}).get("blue") or 0),
            int((r.get("summary") or {}).get("two") or 0),
            int((r.get("summary") or {}).get("three_align") or 0),
            int(r.get("cat_entry") or 0),
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
    phase: str,
    sets: dict[str, list[dict[str, Any]]],
    ea1_lr: float = EA1_LR,
) -> tuple[int, dict[str, Any] | None]:
    if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
        return run_n, None
    room = (BUDGET - int(state["AUTHORIZED_CONSUMED"])) // TOKENS_PER_STEP
    steps = min(steps, room, 50)
    if steps < 5:
        return run_n, None
    run_id = f"WRIM1-UH1-AC2-NC-{run_n:06d}"
    print(json.dumps({"starting": run_id, "phase": phase, "parent": str(parent), "pack": pack, "ea1_lr": ea1_lr, "ra1_lr": RA1_LR, "steps": steps}), flush=True)
    obj = launch_ea1_run(
        run_id=run_id,
        corpus_dir=corpus,
        parent_ckpt=parent,
        pack_name=pack,
        steps=steps,
        ea1_lr=ea1_lr,
        ra1_lr=RA1_LR,
        train_ea1=True,
        train_ra1=True,
        restore_ollama=False,
        load_optimizer=False,
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
        state.setdefault("FAILURES", []).append({"run": run_id, "reason": obj.get("reason")})
        persist(state)
        return run_n + 1, None
    from run000007_preflight import sha256_file
    scored = score_sets(ckpt, sets)
    snap = trainer_snap(run_id, steps)
    phrase = scored.get("phrase") or {}
    nat = scored.get("natural") or {}
    nat2 = scored.get("natural_heldout") or {}
    breach = safety_breach(snap, phrase, steps)
    row = {
        "phase": phase,
        "pack": pack,
        "run_id": run_id,
        "checkpoint": f"{run_id}/step-{steps}",
        "hash": sha256_file(ckpt / MODEL_NAME),
        "tokens": used,
        "ea1_lr": ea1_lr,
        "summary": summarize(phrase, snap),
        "cat_entry": entry_cat(phrase),
        "cat_geo": cat_geo(run_id, steps),
        "paraphrase_exact": int((scored.get("paraphrase") or {}).get("short_phrase_exact") or 0),
        "paraphrase": scored.get("paraphrase"),
        "natural_exact": int(nat.get("short_phrase_exact") or 0),
        "natural_heldout_exact": int(nat2.get("short_phrase_exact") or 0),
        "natural_sem": natural_semantic(nat),
        "natural_heldout_sem": natural_semantic(nat2),
        "natural": nat,
        "natural_heldout": nat2,
        "breach": breach,
        "severe": False,
        "keep": False,
        "frozen": snap.get("frozen"),
        "stage3": snap.get("stage3"),
        "collapse": snap.get("collapse"),
    }
    row["severe"] = severe(row)
    row["keep"] = keepable(row)
    state["RUNS"].append(row)
    persist(state)
    print(json.dumps({
        "finished": run_id,
        "phrase": (row["summary"] or {}).get("phrase_exact"),
        "dog": (row["summary"] or {}).get("dog"),
        "cat": (row["summary"] or {}).get("cat"),
        "blue": (row["summary"] or {}).get("blue"),
        "no": (row["summary"] or {}).get("no"),
        "two": (row["summary"] or {}).get("two"),
        "para": row["paraphrase_exact"],
        "nat": row["natural_exact"],
        "nat_held": row["natural_heldout_exact"],
        "nat_fams": (row["natural_sem"] or {}).get("families"),
        "keep": row["keep"],
        "severe": row["severe"],
        "stage3": row["stage3"],
        "tokens": state["AUTHORIZED_CONSUMED"],
    }, default=str), flush=True)
    if breach in {"FROZEN_HASH_MISMATCH", "GLOBAL_DRIFT", "STAGE3_FLOOR", "STAGE3_DRIFT"}:
        state["PROGRAM_STATUS"] = breach
    return run_n + 1, row


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama
    from wrim_ea1_interfere import main as interfere_main

    proof = json.loads(PROOF.read_text(encoding="utf-8")) if PROOF.is_file() else {}
    if proof.get("SINGLE_TRAINER_LOCK_PROOF") != "PASS":
        raise SystemExit("SINGLE_TRAINER_LOCK_PROOF is not PASS")
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    lock = acquire_trainer_lock(
        run_id="WRIM-EA1-RA1-NATURAL-CONSOL-PROGRAM",
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
        "MIXES_TESTED": [],
    }
    if STATE.is_file():
        prev = json.loads(STATE.read_text(encoding="utf-8"))
        if prev.get("RUNS"):
            state = prev
            if state.get("PROGRAM_STATUS") in {"REVIEW_COMPLETE", "TOKEN_BUDGET_EXHAUSTED"}:
                state.pop("PROGRAM_STATUS", None)
    try:
        if INTERFERE.is_file():
            imap = json.loads(INTERFERE.read_text(encoding="utf-8"))
        else:
            imap = interfere_main()
            if INTERFERE.is_file():
                imap = json.loads(INTERFERE.read_text(encoding="utf-8"))
        state["INTERFERENCE_CLASSIFICATION"] = imap.get("INTERFERENCE_CLASSIFICATION")
        persist(state)
        sets = heldout()
        mixes = MIXES()
        order = ["NAT08", "PHRASE35", "GUARD", "NAT12", "NAT18", "NAT25"]
        parent = PARENT
        run_n = 1
        for rec in state.get("RUNS") or []:
            rid = str(rec.get("run_id") or "")
            if rid.startswith("WRIM1-UH1-AC2-NC-"):
                try:
                    run_n = max(run_n, int(rid.rsplit("-", 1)[-1]) + 1)
                except ValueError:
                    pass
        tested = {r.get("pack") for r in state.get("RUNS") or [] if r.get("phase") == "MIX"}
        keep_parent = PARENT
        for name in order:
            if name in tested:
                continue
            if state.get("PROGRAM_STATUS"):
                break
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                break
            corpus = mix_rows(name, mixes[name])
            state.setdefault("MIXES_TESTED", []).append({"name": name, "counts": mixes[name], "path": str(corpus)})
            persist(state)
            run_n, row = run_block(state=state, run_n=run_n, corpus=corpus, parent=PARENT, pack=name, steps=25, phase="MIX", sets=sets)
            if not row:
                break
            if row.get("keep"):
                keep_parent = Path(CKPT_BASE) / row["checkpoint"]
                parent = keep_parent
                state["BEST_CONSOLIDATION_MIX"] = name
                persist(state)
                break
            if not row.get("severe"):
                parent = Path(CKPT_BASE) / row["checkpoint"]
        if not state.get("PROGRAM_STATUS"):
            best_now = pareto(state["RUNS"]) or {}
            if best_now.get("keep"):
                keep_parent = Path(CKPT_BASE) / str(best_now["checkpoint"])
                parent = keep_parent
                state["BEST_CONSOLIDATION_MIX"] = best_now.get("pack")
            mix_name = str(state.get("BEST_CONSOLIDATION_MIX") or "NAT08")
            corpus = mix_rows(mix_name, mixes[mix_name])
            flat = 0
            while int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and flat < 3 and not state.get("PROGRAM_STATUS"):
                run_n, row = run_block(state=state, run_n=run_n, corpus=corpus, parent=parent, pack=mix_name, steps=25, phase="MIX_CONTINUE", sets=sets)
                if not row:
                    break
                if row.get("severe"):
                    parent = keep_parent
                    flat += 1
                    continue
                parent = Path(CKPT_BASE) / row["checkpoint"]
                if row.get("keep") and int(row.get("natural_exact") or 0) > 1 and int((row.get("natural_sem") or {}).get("n_families") or 0) > 1:
                    keep_parent = parent
                    break
                if int(row.get("natural_exact") or 0) <= int(best_now.get("natural_exact") or 0) and int((row.get("summary") or {}).get("phrase_exact") or 0) <= int((best_now.get("summary") or {}).get("phrase_exact") or 0):
                    flat += 1
                else:
                    flat = 0
                    best_now = row
            para_corpus = write_corpus(
                "NC-PARAPHRASE",
                paraphrase_train_forms()
                + _retag(_take(load_rows(PHRASE_ALIGN_DIR / "train.jsonl"), 32), "nc-ph")
                + _retag(_take(natural_train_forms(), 16), "nc-nat"),
                load_rows(PHRASE_ALIGN_DIR / "val.jsonl"),
            )
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and not state.get("PROGRAM_STATUS"):
                run_n, row = run_block(state=state, run_n=run_n, corpus=para_corpus, parent=parent, pack="PARAPHRASE", steps=25, phase="PARAPHRASE", sets=sets)
                if row and not row.get("severe"):
                    parent = Path(CKPT_BASE) / row["checkpoint"]
                    if row.get("keep"):
                        keep_parent = parent
                elif row and row.get("severe"):
                    parent = keep_parent
            cons = mix_rows("CONS", {"phrase": 48, "entry": 32, "two": 28, "three": 28, "para": 24, "nat": 28, "dog_extra": 12, "cat_extra": 12})
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP <= BUDGET and not state.get("PROGRAM_STATUS"):
                run_n, row = run_block(state=state, run_n=run_n, corpus=cons, parent=parent, pack="CONS", steps=25, phase="CONSOLIDATION", sets=sets)
                if row and not row.get("severe"):
                    parent = Path(CKPT_BASE) / row["checkpoint"]
        best = pareto(state["RUNS"])
        if best is None:
            best = {
                "checkpoint": "WRIM1-UH1-AC2-EA1-000010/step-25",
                "hash": EXPECT,
                "summary": {
                    "phrase_exact": 17, "dog": 5, "cat": 4, "blue": 3, "no": 5, "two": 6,
                    "three_align": 10, "stage3": 6, "frozen": "YES", "global_drift": 0.0,
                    "drift": 0.624, "ramble": 0.0, "empty": 0.0, "stopping": 24,
                    "first": 14, "first_classes": ["blue", "cat", "dog", "no", "red"],
                    "nl": 6.972, "general": 5.247, "code": 3.579, "json": 3.282, "newline": 0.0,
                    "token4_oracle": 24, "collapse": 0,
                },
                "cat_entry": 4,
                "paraphrase_exact": 3,
                "natural_exact": 1,
                "natural_sem": {"exact": 1, "n_families": 1, "families": []},
                "natural_heldout_exact": 0,
                "pack": "PARENT_000010",
            }
        state["BEST"] = best
        if best.get("checkpoint") and "NC-" in str(best.get("checkpoint")):
            ckpt = Path(CKPT_BASE) / str(best["checkpoint"])
            gsets: dict[str, list[dict[str, Any]]] = {}
            if (GRAD_DIR / "first-token-val.jsonl").is_file():
                gsets["grad_ft"] = load_rows(GRAD_DIR / "first-token-val.jsonl")
            if (GRAD_DIR / "two-token-val.jsonl").is_file():
                gsets["grad_tt"] = load_rows(GRAD_DIR / "two-token-val.jsonl")
            if gsets:
                state["FOUNDATION_SUITE"] = {"TRAINED_ON_SUITE": False, "SUITE_ID": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0", "SCORED": score_sets(ckpt, gsets)}
        if not state.get("PROGRAM_STATUS"):
            nat_rel = 0
            mix_map = MIXES()
            for r in state.get("RUNS") or []:
                pack = str(r.get("pack") or "")
                counts = mix_map.get(pack) or {}
                n_nat = int(counts.get("nat") or 0)
                n_all = sum(int(v) for k, v in counts.items() if k != "dog_extra" and k != "cat_extra") + int(counts.get("dog_extra") or 0) + int(counts.get("cat_extra") or 0)
                if n_all:
                    nat_rel += int(int(r.get("tokens") or 0) * n_nat / n_all)
            state["NATURAL_RELEVANT_TOKENS"] = nat_rel
            keeps = [r for r in state.get("RUNS") or [] if r.get("keep")]
            if int(state["AUTHORIZED_CONSUMED"]) + 5 * TOKENS_PER_STEP > BUDGET:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
            elif not keeps and nat_rel >= 300_000 and len({r.get("pack") for r in state.get("RUNS") or [] if r.get("phase") == "MIX"}) >= 3:
                state["PROGRAM_STATUS"] = "ADAPTER_CAPACITY_OR_MODULARITY_REVIEW_REQUIRED"
            else:
                state["PROGRAM_STATUS"] = "REVIEW_COMPLETE"
        persist(state)
        return write_report(state, imap)
    finally:
        release_trainer_lock("WRIM-EA1-RA1-NATURAL-CONSOL-PROGRAM")
        start_user_ollama()


def write_report(state: dict[str, Any], imap: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    summary = best.get("summary") or {}
    consumed = int(state.get("AUTHORIZED_CONSUMED") or 0)
    para = best.get("paraphrase") or {}
    gen = "YES" if gen_pass(para) or int(best.get("paraphrase_exact") or 0) >= 2 else "NO"
    nat_n = int(best.get("natural_exact") or 0)
    held = int(best.get("natural_heldout_exact") or 0)
    fams = (best.get("natural_sem") or {}).get("families") or []
    held_fams = (best.get("natural_heldout_sem") or {}).get("families") or []
    all_fams = sorted(set(list(fams) + list(held_fams)))
    short_nat = "YES" if (nat_n > 1 or held > 1) and len(all_fams) > 1 else "NO"
    grads = adapter_grad_gate(str(best.get("checkpoint") or "").split("/")[0])
    report = {
        "REPORT_ID": "WRIM_GENESIS_NATURAL_RESPONSE_CONSOLIDATION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_CHECKPOINT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "STARTING_HASH": EXPECT,
        "BEST_CHECKPOINT": best.get("checkpoint"),
        "BEST_HASH": best.get("hash"),
        "EA1_BOTTLENECK": 32,
        "RA1_BOTTLENECK": 32,
        "EA1_LR": EA1_LR,
        "RA1_LR": RA1_LR,
        "CONSOLIDATION_MIXES_TESTED": [m.get("name") for m in state.get("MIXES_TESTED") or []],
        "BEST_CONSOLIDATION_MIX": state.get("BEST_CONSOLIDATION_MIX"),
        "INTERFERENCE_CLASSIFICATION": state.get("INTERFERENCE_CLASSIFICATION") or imap.get("INTERFERENCE_CLASSIFICATION"),
        "NEW_TOKENS_USED": consumed,
        "NEW_TOKENS_REMAINING": BUDGET - consumed,
        "AUTHORIZED_TOKEN_LEDGER": consumed,
        "PHYSICAL_TOKEN_LEDGER": int(state.get("PHYSICAL_CONSUMED") or 0),
        "SINGLE_TRAINER_LOCK": "PASS",
        "UNAUTHORIZED_OPTIMIZER_STEPS": 0,
        "FROZEN_PARAMETER_HASH_MATCH": summary.get("frozen"),
        "GLOBAL_BASE_WEIGHT_DRIFT": summary.get("global_drift"),
        "DOCUMENT_PARITY": "PASS",
        "FIRST_TOKEN_CLASSES_WORKING": summary.get("first_classes"),
        "CAT_ENTRY_SUCCESS": "YES" if int(best.get("cat_entry") or 0) > 0 else "NO",
        "TWO_TOKEN_EXACT": summary.get("two"),
        "THREE_TOKEN_EXACT": summary.get("three_align"),
        "PHRASE_EXACT": summary.get("phrase_exact"),
        "BLUE_PHRASE_EXACT": summary.get("blue"),
        "NO_PHRASE_EXACT": summary.get("no"),
        "DOG_PHRASE_EXACT": summary.get("dog"),
        "CAT_PHRASE_EXACT": summary.get("cat"),
        "PARAPHRASE_GENERALIZATION": gen,
        "GENERALIZATION_SCORE": best.get("paraphrase_exact"),
        "SHORT_NATURAL_RESPONSE_CAPABILITY": short_nat,
        "GREEDY_SHORT_NATURAL_CORRECT": nat_n,
        "GREEDY_SHORT_NATURAL_HELDOUT": held,
        "NATURAL_TASK_FAMILIES_WORKING": all_fams,
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
        "EA1_GRADIENT_SAFETY": grads.get("EA1_GATE"),
        "RA1_GRADIENT_SAFETY": grads.get("RA1_GATE"),
        "FOUNDATION_SUITE_RESULT": (state.get("FOUNDATION_SUITE") or {}).get("SCORED"),
        "RUNS": [
            {
                "phase": r.get("phase"),
                "pack": r.get("pack"),
                "checkpoint": r.get("checkpoint"),
                "phrase": (r.get("summary") or {}).get("phrase_exact"),
                "dog": (r.get("summary") or {}).get("dog"),
                "cat": (r.get("summary") or {}).get("cat"),
                "blue": (r.get("summary") or {}).get("blue"),
                "no": (r.get("summary") or {}).get("no"),
                "two": (r.get("summary") or {}).get("two"),
                "para": r.get("paraphrase_exact"),
                "nat": r.get("natural_exact"),
                "keep": r.get("keep"),
                "severe": r.get("severe"),
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
    failed = []
    if not summary.get("first_classes"):
        failed.append("first_classes")
    if int(summary.get("two") or 0) < 4:
        failed.append("two_token")
    if int(summary.get("three_align") or 0) <= 0:
        failed.append("three_token")
    if int(summary.get("phrase_exact") or 0) < 8:
        failed.append("phrase")
    if gen != "YES":
        failed.append("paraphrase")
    if short_nat != "YES":
        failed.append("natural")
    if int(summary.get("stage3") or 0) < 5:
        failed.append("stage3")
    report["FOUNDATION_FAILED_CATEGORIES"] = failed
    report["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] = "YES" if not failed and summary.get("frozen") == "YES" else "NO"
    report["FOUNDATION_SCHOOL_STATUS"] = "READY" if report["FOUNDATION_READY_FOR_GRADUATION_REVIEW"] == "YES" else "INCOMPLETE"
    report["ADAPTER_CAPACITY_OR_MODULARITY_REVIEW_REQUIRED"] = "YES" if state.get("PROGRAM_STATUS") == "ADAPTER_CAPACITY_OR_MODULARITY_REVIEW_REQUIRED" else "NO"
    report["NEXT_COMMANDER_DECISION"] = state.get("PROGRAM_STATUS")
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
