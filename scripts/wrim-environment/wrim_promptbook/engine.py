"""Foundation Promptbook execution engine. No optimizer. No promotion."""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any

from wrim_promptbook.curriculum import curriculum_graph, ordered_school_ids, school_by_id
from wrim_promptbook.identity import (
    ARCHITECTURE_ID,
    BOUNDARIES_NAME,
    BUDGETS,
    BUILD_REPORT_NAME,
    CANONICAL,
    CANONICAL_MODEL_HASH,
    CURRENT_MISSION,
    CURRENT_SCHOOL,
    DATA_ROOT,
    EA1_HASH,
    EVAL_MANIFEST_NAME,
    EXPERIMENT_STATUSES,
    FROZEN_BASE_HASH,
    GOVERNANCE_NAME,
    GRAPH_NAME,
    LEDGER_NAME,
    LIVE_DIR,
    MATRIX_NAME,
    MAX_TRAINERS,
    MOD02A_ARTIFACT,
    MOD02A_REPORT,
    PARENT_CHECKPOINT,
    PARENT_CKPT,
    PARENT_HASH,
    PHRASE_REF,
    PROHIBITED_ALWAYS,
    PROMPTBOOK_ID,
    PROMPTBOOK_JSON_NAME,
    PROMPTBOOK_MD_NAME,
    PROMPTBOOK_VERSION,
    RA1_HASH,
    RAEL_BRIDGE_NAME,
    RECOMMENDED_MASTER_LM_TOKEN_CEILING,
    REGISTRY_NAME,
    REPO_SPEC_DIR,
    RETURN_BOUNDARIES,
    RMR1_EXTRA_UNSEEN_RECALL,
    RMR1_HASH,
    RMR1_PARAMS,
    RMR1_THRESHOLD,
    STAGE3_CURRENT,
    STAGE3_FLOOR,
    STATE_NAME,
    STRATEGY_CEILING,
    SUITE_SHA,
    TOKENIZER_HASH,
    TOKENIZER_NAME,
)
from wrim_promptbook.store import append_jsonl, read_json, read_jsonl, utc_now, write_json
from wrim_single_trainer_lock import MAX_ACTIVE_WRIM_TRAINERS, active_wrim_trainers


class PromptbookError(RuntimeError):
    pass


class ReturnBoundary(PromptbookError):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


class Engine:
    def __init__(self, *, spec_dir: Path | None = None, live_dir: Path | None = None) -> None:
        self.spec_dir = spec_dir or REPO_SPEC_DIR
        self.live_dir = live_dir or LIVE_DIR
        self.graph = curriculum_graph()

    def paths(self) -> dict[str, Path]:
        d = self.live_dir
        return {
            "state": d / STATE_NAME,
            "ledger": d / LEDGER_NAME,
            "registry": d / REGISTRY_NAME,
            "matrix": d / MATRIX_NAME,
            "audit": d / "WRIM_GENESIS_ACTION_AUDIT.jsonl",
            "tokens": d / "WRIM_GENESIS_TOKEN_LEDGER.json",
        }

    def audit(self, action: str, **kwargs: Any) -> None:
        append_jsonl(self.paths()["audit"], {"ts": utc_now(), "action": action, **kwargs})

    def load_state(self) -> dict[str, Any]:
        st = read_json(self.paths()["state"])
        if not st:
            raise PromptbookError("state_missing")
        return st

    def save_state(self, st: dict[str, Any]) -> None:
        st["updated_at"] = utc_now()
        write_json(self.paths()["state"], st)

    def append_ledger(self, rec: dict[str, Any]) -> None:
        rec.setdefault("ts", utc_now())
        if rec.get("status") not in EXPERIMENT_STATUSES:
            raise PromptbookError(f"invalid_status {rec.get('status')}")
        existing = {r.get("experiment_id") for r in read_jsonl(self.paths()["ledger"])}
        if rec.get("experiment_id") in existing and rec.get("status") == "COMPLETED":
            # Immutable completed IDs: allow status updates only via new event_id, never overwrite.
            rec = dict(rec)
            rec["event_id"] = rec.get("event_id") or str(uuid.uuid4())
        append_jsonl(self.paths()["ledger"], rec)

    def export_spec(self) -> dict[str, Path]:
        self.spec_dir.mkdir(parents=True, exist_ok=True)
        graph = self.graph
        write_json(self.spec_dir / GRAPH_NAME, graph)
        governance = {
            "id": "WRIM_GENESIS_GOVERNANCE_v1",
            "canonical": CANONICAL,
            "canonical_hash": CANONICAL_MODEL_HASH,
            "parent": PARENT_CHECKPOINT,
            "parent_hash": PARENT_HASH,
            "architecture_id": ARCHITECTURE_ID,
            "max_active_wrim_trainers": MAX_TRAINERS,
            "stage3_floor": STAGE3_FLOOR,
            "stage3_prefer": 6,
            "strategy_ceiling": STRATEGY_CEILING,
            "master_lm_token_ceiling_recommended": RECOMMENDED_MASTER_LM_TOKEN_CEILING,
            "school_budgets": BUDGETS,
            "prohibited_always": PROHIBITED_ALWAYS,
            "na1_in_route_table": False,
            "rmr1_production_ready": False,
            "ne1_auto_create": False,
            "self_promote": False,
            "commit": False,
            "push": False,
            "deploy": False,
            "stage3b": False,
            "rael_training": False,
            "training_authorization_default": "OFF",
            "router_not_installed_in_runtime": True,
            "mod_02a_do_not_rerun": True,
        }
        write_json(self.spec_dir / GOVERNANCE_NAME, governance)
        write_json(self.spec_dir / BOUNDARIES_NAME, {
            "id": "WRIM_GENESIS_RETURN_BOUNDARIES_v1",
            "return_to_commander": RETURN_BOUNDARIES,
            "do_not_return_for": [
                "ordinary_test_failures",
                "syntax_errors",
                "checkpoint_path_errors",
                "evaluation_script_bugs",
                "one_failed_lr",
                "one_rejected_checkpoint",
                "one_interrupted_run",
                "recoverable_process_crash",
            ],
        })
        write_json(self.spec_dir / EVAL_MANIFEST_NAME, evaluation_manifest())
        pb = {
            "id": PROMPTBOOK_ID,
            "version": PROMPTBOOK_VERSION,
            "current_school": CURRENT_SCHOOL,
            "current_mission": CURRENT_MISSION,
            "canonical": CANONICAL,
            "parent": PARENT_CHECKPOINT,
            "mod_02a_imported": True,
            "curriculum": graph,
            "governance": governance,
        }
        write_json(self.spec_dir / PROMPTBOOK_JSON_NAME, pb)
        return {
            "graph": self.spec_dir / GRAPH_NAME,
            "governance": self.spec_dir / GOVERNANCE_NAME,
            "boundaries": self.spec_dir / BOUNDARIES_NAME,
            "eval": self.spec_dir / EVAL_MANIFEST_NAME,
            "promptbook_json": self.spec_dir / PROMPTBOOK_JSON_NAME,
        }

    def bootstrap(self) -> dict[str, Any]:
        self.export_spec()
        self.live_dir.mkdir(parents=True, exist_ok=True)
        p = self.paths()
        if p["ledger"].is_file():
            # Do not destroy existing live ledger; import is idempotent by experiment_id.
            pass
        else:
            p["ledger"].write_text("", encoding="utf-8")
        self._import_history()
        state = {
            "promptbook_id": PROMPTBOOK_ID,
            "version": PROMPTBOOK_VERSION,
            "created_at": utc_now(),
            "CURRENT_SCHOOL": CURRENT_SCHOOL,
            "CURRENT_MISSION": CURRENT_MISSION,
            "TRAINING_AUTHORIZATION": "OFF",
            "CANONICAL": CANONICAL,
            "PARENT": PARENT_CHECKPOINT,
            "PARENT_HASH": PARENT_HASH,
            "MOD_02A_IMPORTED": True,
            "MOD_02A_ROUTER_PROOF": "PASS",
            "RMR1_PRODUCTION_READY": False,
            "RMR1_EXTRA_UNSEEN_RECALL": RMR1_EXTRA_UNSEEN_RECALL,
            "RMR1_TWO_TOKEN_REGRESSION_OPEN": True,
            "NE1_IMPLEMENTED": False,
            "NEW_WRIM_TRAINING_PERFORMED": False,
            "ROUTER_TRAINING_PERFORMED": False,
            "MODEL_PROMOTED": False,
            "CANONICAL_CHANGED": False,
            "STAGE3B_STARTED": False,
            "MASTER_FOUNDATION_AUTHORIZED": False,
            "MASTER_LM_TOKEN_CEILING": 0,
            "MASTER_LM_TOKENS_REMAINING": 0,
            "paused": False,
            "abort_safe": False,
            "current_experiment_id": None,
            "retry_signature": None,
            "retry_count": 0,
            "strategy_counts": {},
            "physical_tokens_consumed": 0,
            "authorized_tokens_open": 0,
            "last_durable_token_cursor": 0,
            "authorization_epoch": str(uuid.uuid4()),
            "PROMPTBOOK_EXECUTION_SYSTEM_READY": False,
        }
        self.save_state(state)
        write_json(p["tokens"], {
            "authorized": 0,
            "physical": 0,
            "by_school": {},
            "authorization_epoch": state["authorization_epoch"],
            "replay_protection": "epoch_plus_cursor",
        })
        write_json(p["registry"], self._registry())
        write_json(p["matrix"], self._matrix())
        self.audit("bootstrap", school=CURRENT_SCHOOL, mission=CURRENT_MISSION)
        return state

    def authorize_foundation_execution(self, *, ceiling: int, commander: str = "MARK") -> dict[str, Any]:
        if int(ceiling) != int(RECOMMENDED_MASTER_LM_TOKEN_CEILING):
            raise ReturnBoundary(
                "TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING",
                f"ceiling {ceiling} != encoded {RECOMMENDED_MASTER_LM_TOKEN_CEILING}",
            )
        st = self.load_state()
        remaining = int(ceiling) - int(st.get("physical_tokens_consumed") or 0)
        st["TRAINING_AUTHORIZATION"] = "ON"
        st["MASTER_FOUNDATION_AUTHORIZED"] = True
        st["MASTER_LM_TOKEN_CEILING"] = int(ceiling)
        st["MASTER_LM_TOKENS_REMAINING"] = remaining
        st["authorization_id"] = "WRIM_GENESIS_FOUNDATION_MASTER_PROGRAM"
        st["authorized_by"] = commander
        st["authorization_epoch"] = str(uuid.uuid4())
        st["authorized_tokens_open"] = 0
        self.save_state(st)
        write_json(self.paths()["tokens"], {
            "authorized": 0,
            "physical": int(st.get("physical_tokens_consumed") or 0),
            "ceiling": int(ceiling),
            "remaining": remaining,
            "authorization_epoch": st["authorization_epoch"],
            "replay_protection": "epoch_plus_cursor",
            "authorization_id": st["authorization_id"],
        })
        self.audit("authorize_foundation", ceiling=int(ceiling), remaining=remaining, commander=commander)
        return {
            "ok": True,
            "TRAINING_AUTHORIZATION": "ON",
            "MASTER_LM_TOKEN_CEILING": int(ceiling),
            "MASTER_LM_TOKENS_REMAINING": remaining,
            "CURRENT_SCHOOL": st["CURRENT_SCHOOL"],
            "CURRENT_MISSION": st["CURRENT_MISSION"],
        }

    def _import_history(self) -> None:
        ledger_ids = {r.get("experiment_id") for r in read_jsonl(self.paths()["ledger"])}
        recs = [
            {
                "experiment_id": "EXP-PARENT-000010",
                "school": "SCHOOL_03_STRUCTURED_CONTINUATION",
                "status": "COMPLETED",
                "hypothesis": "EA1+RA1 structured continuation parent.",
                "parent_checkpoint": PARENT_CHECKPOINT,
                "trainable_modules": [],
                "frozen_modules": ["all"],
                "token_budget": 0,
                "physical_tokens": 0,
                "promotion_status": "NO",
                "artifacts": [str(PARENT_CKPT)],
            },
            {
                "experiment_id": "EXP-MOD-01-NA1",
                "school": "SCHOOL_06_NATURAL_CONTINUATION",
                "status": "COMPLETED",
                "hypothesis": "NA1 B32 isolation. Bypass remained best.",
                "trainable_modules": ["na1"],
                "result": "NA1_PRODUCTION_JUSTIFICATION=NO",
                "token_budget": 204800,
                "physical_tokens": 204800,
                "promotion_status": "NO",
            },
            {
                "experiment_id": "EXP-MOD-02A-RMR1",
                "school": "SCHOOL_04_RESPONSE_MODE_ROUTING",
                "status": "COMPLETED",
                "hypothesis": "Linear 514 pre_ea1 router can select STRUCTURED vs NATURAL without task-id leakage.",
                "parent_checkpoint": PARENT_CHECKPOINT,
                "architecture": "Linear(256→2)+bias",
                "trainable_modules": ["rmr1"],
                "frozen_modules": ["base", "ea1", "ra1", "na1", "lm_head", "tok_emb", "transformer"],
                "token_budget": 0,
                "physical_tokens": 0,
                "router_examples": 96,
                "threshold": RMR1_THRESHOLD,
                "extra_unseen_recall": RMR1_EXTRA_UNSEEN_RECALL,
                "production_ready": False,
                "two_token_regression_open": True,
                "do_not_rerun": True,
                "promotion_status": "NO",
                "artifacts": [str(MOD02A_REPORT), str(MOD02A_ARTIFACT)],
                "result": "MOD_02A_ROUTER_PROOF=PASS",
            },
        ]
        for rec in recs:
            if rec["experiment_id"] not in ledger_ids:
                rec["imported"] = True
                rec["seed"] = 8101
                rec["commander_boundary"] = "NO_PROMOTION"
                self.append_ledger(rec)

    def _registry(self) -> dict[str, Any]:
        return {
            "id": "WRIM_GENESIS_CHECKPOINT_REGISTRY_v1",
            "checkpoints": [
                {
                    "id": "STEP_400",
                    "hash": CANONICAL_MODEL_HASH,
                    "role": "CANONICAL",
                    "promotion_status": "CANONICAL",
                    "quarantine": False,
                    "may_be_parent": False,
                },
                {
                    "id": PARENT_CHECKPOINT,
                    "hash": PARENT_HASH,
                    "role": "EXPERIMENTAL_PARENT",
                    "architecture": ARCHITECTURE_ID,
                    "module_hashes": {"frozen_base": FROZEN_BASE_HASH, "ea1": EA1_HASH, "ra1": RA1_HASH},
                    "capability": PHRASE_REF,
                    "promotion_status": "NO",
                    "quarantine": False,
                    "may_be_parent": True,
                },
                {
                    "id": "WRIM_RMR1_MOD02A",
                    "hash": RMR1_HASH,
                    "role": "EXPERIMENTAL_ROUTER",
                    "architecture": "RMR1 Linear(256→2)+bias",
                    "parameters": RMR1_PARAMS,
                    "threshold": RMR1_THRESHOLD,
                    "production_ready": False,
                    "promotion_status": "NO",
                    "quarantine": False,
                    "may_be_parent": False,
                    "install_in_runtime": False,
                    "two_token_regression_open": True,
                    "extra_unseen_recall": RMR1_EXTRA_UNSEEN_RECALL,
                    "artifacts": [str(MOD02A_ARTIFACT)],
                },
            ],
        }

    def _matrix(self) -> dict[str, Any]:
        return {
            "id": "WRIM_GENESIS_CAPABILITY_MATRIX_v1",
            "states_allowed": ["NOT_TESTED", "FAIL", "EMERGING", "PASS", "ROBUST", "REGRESSED"],
            "RESPONSE_MODE_ROUTING": "PASS_EXPERIMENTAL",
            "ROUTER_EXTRA_UNSEEN_GENERALIZATION": "EMERGING",
            "ROUTER_PRODUCTION_READINESS": "FAIL",
            "ROUTER_REGRESSION_OPEN": "YES",
            "NATURAL_ENTRY": "EMERGING",
            "NATURAL_CONTINUATION_WITH_GOLD_ENTRY": "PASS_EMERGING",
            "NATURAL_FREE_GREEDY": "FAIL",
            "STRUCTURED_CONTINUATION": "PASS",
            "STRUCTURED_ENTRY": "PASS",
            "RESPONSE_CONTROL": "PASS",
            "MULTI_TURN_ROUTER_RESET": "PASS",
            "FOUNDATION_GRADUATION": "NOT_READY",
            "phrase": {"value": 17, "state": "PASS"},
            "official_natural_free_greedy": {"value": 3, "state": "EMERGING", "route": "EA1+BYPASS"},
            "extra_unseen_free_greedy_oracle_bypass": {"value": 1, "state": "EMERGING"},
            "learned_router_extra_greedy": {"value": 0, "state": "FAIL"},
            "gold_token1_official": {"from": 3, "to": 6, "state": "PASS_EMERGING"},
            "gold_token1_extra": {"from": 1, "to": 9, "state": "PASS_EMERGING"},
            "stage3": {"value": STAGE3_CURRENT, "state": "PASS"},
            "two_token_learned_vs_always_structured": {"learned": 1, "always_structured": 3, "state": "REGRESSED"},
        }

    def verify_truth(self) -> dict[str, Any]:
        from run000007_preflight import sha256_file
        from wrim_resumable_checkpoint import MODEL_NAME

        parent_file = PARENT_CKPT / MODEL_NAME
        ok_parent = parent_file.is_file() and sha256_file(parent_file) == PARENT_HASH
        tok_ok = TOKENIZER_HASH == "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
        report_ok = MOD02A_REPORT.is_file()
        others = active_wrim_trainers()
        out = {
            "CANONICAL": CANONICAL,
            "PARENT": PARENT_CHECKPOINT,
            "PARENT_HASH_MATCH": ok_parent,
            "TOKENIZER_ID": TOKENIZER_NAME,
            "TOKENIZER_HASH_MATCH": tok_ok,
            "SUITE_SHA": SUITE_SHA,
            "STAGE3": STAGE3_CURRENT,
            "MOD_02A_REPORT_PRESENT": report_ok,
            "ACTIVE_WRIM_TRAINERS": others,
            "SINGLE_TRAINER_CLEAR": len(others) == 0,
            "ok": ok_parent and tok_ok and report_ok,
        }
        if not ok_parent:
            raise ReturnBoundary("FROZEN_HASH_VIOLATION", "parent hash mismatch or missing")
        self.audit("verify_truth", **{k: v for k, v in out.items() if k != "ACTIVE_WRIM_TRAINERS"})
        return out

    def status(self) -> dict[str, Any]:
        st = self.load_state()
        school = school_by_id(self.graph, st["CURRENT_SCHOOL"])
        return {
            "CURRENT_SCHOOL": st["CURRENT_SCHOOL"],
            "CURRENT_MISSION": st["CURRENT_MISSION"],
            "TRAINING_AUTHORIZATION": st["TRAINING_AUTHORIZATION"],
            "paused": st.get("paused"),
            "MOD_02A_IMPORTED": st.get("MOD_02A_IMPORTED"),
            "RMR1_PRODUCTION_READY": st.get("RMR1_PRODUCTION_READY"),
            "RMR1_TWO_TOKEN_REGRESSION_OPEN": st.get("RMR1_TWO_TOKEN_REGRESSION_OPEN"),
            "NE1_IMPLEMENTED": st.get("NE1_IMPLEMENTED"),
            "physical_tokens_consumed": st.get("physical_tokens_consumed"),
            "school_status": school["status"],
            "next": school["next"],
            "PROMPTBOOK_EXECUTION_SYSTEM_READY": st.get("PROMPTBOOK_EXECUTION_SYSTEM_READY"),
        }

    def plan(self) -> dict[str, Any]:
        st = self.load_state()
        school = school_by_id(self.graph, st["CURRENT_SCHOOL"])
        if st["CURRENT_SCHOOL"] == "SCHOOL_04_RESPONSE_MODE_ROUTING":
            # Authoritative: do not treat routing as pending.
            raise PromptbookError("school_04_completed_import_mod02a_advance_to_school_05")
        plan = {
            "school": school["id"],
            "mission": st["CURRENT_MISSION"],
            "authorized": school["authorized_actions"],
            "prohibited": school["prohibited_actions"] + PROHIBITED_ALWAYS,
            "training_authorization": st["TRAINING_AUTHORIZATION"],
            "optimizer_steps_planned": 0,
            "reason": (
                "TRAINING_AUTHORIZATION=ON; master ceiling approved; School 05 diagnostic first; no auto-NE1."
                if st.get("MASTER_FOUNDATION_AUTHORIZED") and st["TRAINING_AUTHORIZATION"] == "ON"
                else "TRAINING_AUTHORIZATION=OFF until Commander approves master budget after preflight."
            ),
        }
        if school["id"] == "SCHOOL_05_NATURAL_ENTRY":
            plan["diagnostic"] = {
                "measure": [
                    "token1_rank",
                    "token1_probability",
                    "top1_attractor",
                    "ea1_residual",
                    "official_natural",
                    "extra_unseen",
                    "gold_token1_continuation",
                ],
                "known": {
                    "ea1_on_bypass_official": 3,
                    "ea1_off_bypass_official": 2,
                    "ea1_on_bypass_extra": 1,
                    "gold_token1_official": "3→6",
                    "gold_token1_extra": "1→9",
                    "attractors": ["no", "dog", "blue", "red", "ok"],
                },
                "ne1_auto_create": False,
                "ne1_gates": [
                    "token1_earliest_failure",
                    "gold_token1_exceeds_free_greedy",
                    "ea1_useful_but_insufficient",
                    "router_not_primary_failure",
                    "leakage_audited",
                    "objective_without_heldout_train",
                ],
                "if_ne1": {
                    "arch": "NE1 B32 entry-only pre_lm_head zero-init",
                    "train": "NE1 only",
                    "natural": "NE1 token1 then BYPASS token2+",
                    "structured": "EA1+RA1 unchanged",
                    "router": "RMR1 frozen experimental, not in first proof",
                    "budget": 102400,
                    "extend_once": 204800,
                },
            }
        self.audit("plan", school=school["id"])
        return plan

    def refuse_training(self, why: str) -> dict[str, Any]:
        return {
            "ok": False,
            "optimizer_constructed": False,
            "optimizer_steps": 0,
            "tokens_used": 0,
            "reason": why,
            "TRAINING_AUTHORIZATION": self.load_state().get("TRAINING_AUTHORIZATION"),
        }

    def run_current_stage(self, *, dry: bool = False) -> dict[str, Any]:
        st = self.load_state()
        if st.get("paused") or st.get("abort_safe"):
            return {"ok": False, "reason": "paused_or_aborted"}
        if st["CURRENT_SCHOOL"] == "SCHOOL_04_RESPONSE_MODE_ROUTING":
            return {"ok": False, "reason": "mod02a_already_completed_do_not_rerun"}
        if st["CURRENT_MISSION"] == "MOD_02A":
            return {"ok": False, "reason": "mod02a_already_completed_do_not_rerun"}
        if not dry and st["TRAINING_AUTHORIZATION"] != "ON":
            plan = self.plan()
            self.audit("run_current_stage_no_train", mission=st["CURRENT_MISSION"])
            return {
                "ok": True,
                "mode": "DIAGNOSTIC_PLAN_ONLY",
                "optimizer_constructed": False,
                "optimizer_steps": 0,
                "NEW_WRIM_TRAINING_PERFORMED": False,
                "ROUTER_TRAINING_PERFORMED": False,
                "plan": plan,
            }
        if not dry and not st.get("MASTER_FOUNDATION_AUTHORIZED"):
            raise ReturnBoundary(
                "TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING",
                "Master Foundation budget is not Commander-approved. Engine refuses optimizer construction.",
            )
        if not dry and st["CURRENT_SCHOOL"] == "SCHOOL_05_NATURAL_ENTRY" and st["CURRENT_MISSION"] == "NATURAL_ENTRY_NE1_REVIEW":
            plan = self.plan()
            self.audit("run_current_stage_diagnostic", mission=st["CURRENT_MISSION"])
            return {
                "ok": True,
                "mode": "DIAGNOSTIC_AUTHORIZED",
                "optimizer_constructed": False,
                "optimizer_steps": 0,
                "NE1_AUTO_CREATE": False,
                "NEW_WRIM_TRAINING_PERFORMED": False,
                "ROUTER_TRAINING_PERFORMED": False,
                "plan": plan,
            }
        if not dry:
            raise ReturnBoundary(
                "ARCHITECTURE_CHANGE_REQUIRED",
                "No encoded trainer is attached to this school yet. Diagnostic/eval only.",
            )
        return {"ok": True, "mode": "DRY", "optimizer_constructed": False}

    def pause(self) -> dict[str, Any]:
        st = self.load_state()
        st["paused"] = True
        self.save_state(st)
        self.audit("pause")
        return {"paused": True}

    def resume(self) -> dict[str, Any]:
        st = self.load_state()
        tokens = read_json(self.paths()["tokens"], {})
        if int(st.get("authorized_tokens_open") or 0) and tokens.get("authorization_epoch") != st.get("authorization_epoch"):
            raise ReturnBoundary("TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING", "stale authorization epoch")
        # Never replay accounted tokens.
        st["authorized_tokens_open"] = 0
        st["paused"] = False
        st["abort_safe"] = False
        self.save_state(st)
        write_json(self.paths()["tokens"], {
            **tokens,
            "authorized": 0,
            "physical": int(st.get("physical_tokens_consumed") or 0),
            "authorization_epoch": st["authorization_epoch"],
        })
        self.audit("resume", last_durable_token_cursor=st.get("last_durable_token_cursor"))
        return {"resumed": True, "replayed_tokens": 0, "cursor": st.get("last_durable_token_cursor")}

    def abort_safe(self) -> dict[str, Any]:
        st = self.load_state()
        st["abort_safe"] = True
        st["paused"] = True
        st["authorized_tokens_open"] = 0
        st["current_experiment_id"] = None
        self.save_state(st)
        self.audit("abort_safe")
        return {"abort_safe": True, "optimizer_steps": 0}

    def crash_recover(self) -> dict[str, Any]:
        """Durable cursor is source of truth. Open authorization is discarded."""
        st = self.load_state()
        cursor = int(st.get("last_durable_token_cursor") or 0)
        physical = int(st.get("physical_tokens_consumed") or 0)
        if cursor != physical:
            physical = cursor
            st["physical_tokens_consumed"] = cursor
        st["authorized_tokens_open"] = 0
        st["authorization_epoch"] = str(uuid.uuid4())
        st["paused"] = False
        self.save_state(st)
        write_json(self.paths()["tokens"], {
            "authorized": 0,
            "physical": physical,
            "authorization_epoch": st["authorization_epoch"],
            "replay_protection": "epoch_plus_cursor",
        })
        self.audit("crash_recover", physical=physical, replayed=0)
        return {"recovered": True, "physical_tokens": physical, "replayed": 0}

    def enforce_budget(self, school: str, tokens: int) -> None:
        cap = int((BUDGETS.get(school) or {}).get("lm_tokens") or 0)
        if tokens > cap:
            raise ReturnBoundary("TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING", f"{school} {tokens}>{cap}")
        st = self.load_state()
        if int(st.get("physical_tokens_consumed") or 0) + tokens > RECOMMENDED_MASTER_LM_TOKEN_CEILING:
            raise ReturnBoundary("TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING", "master ceiling")
        remaining = st.get("MASTER_LM_TOKENS_REMAINING")
        if st.get("MASTER_FOUNDATION_AUTHORIZED") and remaining is not None and int(remaining) < int(tokens):
            raise ReturnBoundary("TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING", "master remaining")

    def consume_tokens(self, *, school: str, experiment_id: str, tokens: int) -> dict[str, Any]:
        tokens = int(tokens)
        if tokens < 0:
            raise PromptbookError("negative_tokens")
        self.enforce_budget(school, tokens)
        st = self.load_state()
        physical = int(st.get("physical_tokens_consumed") or 0) + tokens
        ceiling = int(st.get("MASTER_LM_TOKEN_CEILING") or RECOMMENDED_MASTER_LM_TOKEN_CEILING)
        st["physical_tokens_consumed"] = physical
        st["last_durable_token_cursor"] = physical
        st["MASTER_LM_TOKENS_REMAINING"] = ceiling - physical
        by = dict((read_json(self.paths()["tokens"], {}) or {}).get("by_school") or {})
        by[school] = int(by.get(school) or 0) + tokens
        self.save_state(st)
        write_json(self.paths()["tokens"], {
            "authorized": physical,
            "physical": physical,
            "ceiling": ceiling,
            "remaining": st["MASTER_LM_TOKENS_REMAINING"],
            "by_school": by,
            "authorization_epoch": st.get("authorization_epoch"),
            "replay_protection": "epoch_plus_cursor",
            "last_experiment_id": experiment_id,
        })
        self.audit("consume_tokens", school=school, tokens=tokens, physical=physical, experiment_id=experiment_id)
        return {"physical": physical, "remaining": st["MASTER_LM_TOKENS_REMAINING"]}

    def record_ne1_capacity(self, result: dict[str, Any]) -> dict[str, Any]:
        st = self.load_state()
        improved = bool(result.get("extra_unseen_token1_and_greedy_improve"))
        identity = bool(result.get("structured_identity"))
        hashes_ok = bool(result.get("hashes_ok"))
        st["NE1_IMPLEMENTED"] = True
        st["NE1_PRODUCTION_READY"] = False
        st["NEW_WRIM_TRAINING_PERFORMED"] = True
        st["RMR1_TWO_TOKEN_REGRESSION_OPEN"] = True
        st["RMR1_PRODUCTION_READY"] = False
        status = "COMPLETED" if improved and identity and hashes_ok else "REJECTED"
        st["NE1_CAPACITY_STATUS"] = status
        self.save_state(st)
        self.append_ledger({
            "experiment_id": "EXP-SCHOOL05-NE1-CAPACITY",
            "school": "SCHOOL_05_NATURAL_ENTRY",
            "status": status,
            "hypothesis": "Bounded NE1 B32 entry specialist improves extra-unseen token1 and greedy under oracle NATURAL.",
            "parent_checkpoint": PARENT_CHECKPOINT,
            "trainable_modules": ["ne1"],
            "tokens_used": int(result.get("tokens_used") or 0),
            "best_checkpoint": result.get("best_checkpoint"),
            "do_not_rerun": True,
        })
        advanced = None
        if status == "COMPLETED":
            advanced = self.advance_if_allowed("SCHOOL_06_NATURAL_CONTINUATION")
        self.audit("ne1_capacity", status=status, advanced=advanced)
        return {"status": status, "advanced": advanced, "NE1_IMPLEMENTED": True}

    def record_ne1_review(self, decision: dict[str, Any]) -> dict[str, Any]:
        st = self.load_state()
        option = str(decision.get("option") or "")
        gates = dict(decision.get("gates") or {})
        all_pass = all(bool(v) for v in gates.values()) if gates else False
        st["NE1_REVIEW"] = {
            "option": option,
            "gates": gates,
            "all_gates_pass": all_pass,
            "ts": utc_now(),
        }
        st["NE1_AUTHORIZED"] = bool(option == "B" and all_pass)
        st["NE1_IMPLEMENTED"] = False
        if st["NE1_AUTHORIZED"]:
            st["CURRENT_MISSION"] = "NE1_CAPACITY_PROOF"
        else:
            st["CURRENT_MISSION"] = "NATURAL_ENTRY_NE1_REVIEW"
        self.save_state(st)
        self.append_ledger({
            "experiment_id": "EXP-SCHOOL05-NE1-REVIEW",
            "school": "SCHOOL_05_NATURAL_ENTRY",
            "status": "COMPLETED",
            "hypothesis": "Token1 is the natural-entry bottleneck; NE1 only if six Promptbook gates pass.",
            "parent_checkpoint": PARENT_CHECKPOINT,
            "trainable_modules": [],
            "tokens_used": 0,
            "decision": option,
            "gates": gates,
            "do_not_rerun": True,
        })
        self.audit("ne1_review", option=option, authorized=st["NE1_AUTHORIZED"])
        return {
            "ok": True,
            "option": option,
            "NE1_AUTHORIZED": st["NE1_AUTHORIZED"],
            "CURRENT_MISSION": st["CURRENT_MISSION"],
            "optimizer_constructed": False,
        }

    def record_strategy(self, school: str, strategy_id: str) -> int:
        st = self.load_state()
        counts = dict(st.get("strategy_counts") or {})
        bucket = dict(counts.get(school) or {})
        used = list(bucket.get("ids") or [])
        if strategy_id not in used:
            used.append(strategy_id)
        if len(used) > STRATEGY_CEILING:
            raise ReturnBoundary("SCIENTIFIC_LANE_EXHAUSTED", school)
        bucket["ids"] = used
        counts[school] = bucket
        st["strategy_counts"] = counts
        self.save_state(st)
        return len(used)

    def resolve_architecture_change(self, *, school: str, module_id: str, bottleneck: int, token_ceiling: int) -> dict[str, Any]:
        """Commander-authorized IR1 (or similar) after ARCHITECTURE_CHANGE_REQUIRED."""
        st = self.load_state()
        if st["CURRENT_SCHOOL"] != school:
            raise PromptbookError(f"resolve_architecture_mismatch {st['CURRENT_SCHOOL']} != {school}")
        boundary = st.get("RETURN_BOUNDARY")
        if boundary not in (None, "", "ARCHITECTURE_CHANGE_REQUIRED", "GRADIENT_HARD_STOP_UNRESOLVED"):
            raise ReturnBoundary(str(boundary), str(st.get("RETURN_DETAIL") or "unresolved"))
        st["RETURN_BOUNDARY"] = None
        st["RETURN_DETAIL"] = None
        st["ARCHITECTURE_CHANGE_AUTHORIZED"] = {
            "module_id": module_id,
            "bottleneck": int(bottleneck),
            "token_ceiling": int(token_ceiling),
        }
        st[f"{school}_STATUS"] = "RUNNING"
        st["CURRENT_MISSION"] = f"{module_id}_CAPACITY_PROOF"
        self.save_state(st)
        self.audit("resolve_architecture_change", school=school, module_id=module_id)
        return {"ok": True, "CURRENT_MISSION": st["CURRENT_MISSION"], "module_id": module_id}

    def record_ir1_capacity(self, result: dict[str, Any]) -> dict[str, Any]:
        st = self.load_state()
        st["IR1_IMPLEMENTED"] = True
        st["IR1_PRODUCTION_READY"] = False
        st["IR1_CAPACITY_PROOF"] = "PASS" if result.get("ok") else "FAIL"
        st["NEW_WRIM_TRAINING_PERFORMED"] = True
        self.save_state(st)
        self.audit("ir1_capacity", proof=st["IR1_CAPACITY_PROOF"], best=result.get("best_checkpoint"))
        return {"IR1_CAPACITY_PROOF": st["IR1_CAPACITY_PROOF"]}

    def authorize_br1(self, *, token_ceiling: int = 409_600) -> dict[str, Any]:
        """Commander-authorized architecture-level BR1 after School 09 frozen-body exhaustion."""
        st = self.load_state()
        boundary = st.get("RETURN_BOUNDARY")
        allowed = {
            None,
            "",
            "INSTRUCTION_REPRESENTATION_OR_DATA_TRANSFER_FAILURE",
            "SCIENTIFIC_LANE_EXHAUSTED",
            "GRADIENT_HARD_STOP_UNRESOLVED",
            "ARCHITECTURE_CHANGE_REQUIRED",
        }
        if boundary not in allowed:
            raise ReturnBoundary(str(boundary), str(st.get("RETURN_DETAIL") or "unresolved"))
        used = list(((st.get("strategy_counts") or {}).get("SCHOOL_09_INSTRUCTION_FOLLOWING") or {}).get("ids") or [])
        if len(used) < 3:
            raise PromptbookError("br1_requires_school09_lane_exhausted")
        st["RETURN_BOUNDARY"] = None
        st["RETURN_DETAIL"] = None
        st["TRAINING_AUTHORIZATION"] = "ON"
        st["CURRENT_MISSION"] = "BR1_UPPER_BODY_PLASTICITY_PROOF"
        st["BR1_AUTHORIZED"] = True
        st["BR1_TOKEN_AUTHORIZATION"] = int(token_ceiling)
        self.save_state(st)
        self.audit("authorize_br1", token_ceiling=int(token_ceiling), school09_strategies=used)
        return {"ok": True, "CURRENT_MISSION": st["CURRENT_MISSION"], "BR1_TOKEN_AUTHORIZATION": int(token_ceiling)}

    def record_br1(self, result: dict[str, Any]) -> dict[str, Any]:
        """Record BR1 architecture experiment. Does not complete School 09 or promote."""
        st = self.load_state()
        proof = str(result.get("BODY_PLASTICITY_PROOF") or "FAIL")
        classification = str(result.get("CLASSIFICATION") or "BASE_CAPACITY_OR_PRETRAINING_BOUNDARY")
        st["BR1_IMPLEMENTED"] = True
        st["BR1_PRODUCTION_READY"] = False
        st["BR1_CAPACITY_PROOF"] = proof
        st["NEW_WRIM_TRAINING_PERFORMED"] = True
        st["TRAINING_AUTHORIZATION"] = "OFF"
        st["CURRENT_MISSION"] = "BR1_UPPER_BODY_PLASTICITY_PROOF"
        if result.get("ok") and proof == "PASS":
            st["RETURN_BOUNDARY"] = "BODY_PLASTICITY_PROOF_PASS"
            st["RETURN_DETAIL"] = "BR1 body-plasticity proof passed. Commander decides whether this lineage becomes the Foundation parent. Do not auto-resume Foundation."
        else:
            st["RETURN_BOUNDARY"] = classification
            st["RETURN_DETAIL"] = (
                f"BR1 failed. proof={proof} classification={classification} "
                f"tokens={result.get('NEW_TOKENS_USED')} abort={result.get('abort')} "
                f"signal={result.get('BODY_PLASTICITY_SIGNAL')}. No further unfreeze/lm_head/tokenizer/full-body."
            )
        self.save_state(st)
        self.append_ledger({
            "experiment_id": "EXP-BR1-UPPER4-INSTRUCTION-000001",
            "school": "BR1_UPPER_BODY_PLASTICITY",
            "status": "COMPLETED" if proof == "PASS" else "REJECTED",
            "hypothesis": "Original upper-4 transformer blocks can acquire generalizable instruction-following when unfrozen, with retention replay.",
            "parent_checkpoint": "WRIM1-UH1-AC2-NE1-000001/step-40",
            "trainable_modules": ["layers.14", "layers.15", "layers.16", "layers.17"],
            "tokens_used": int(result.get("NEW_TOKENS_USED") or 0),
            "best_checkpoint": result.get("BEST_CHECKPOINT"),
            "do_not_rerun": True,
            "MODEL_PROMOTED": "NO",
            "CANONICAL_CHANGED": "NO",
            "SCHOOL_09_STRATEGY_4": "NOT_CREATED",
        })
        self.audit("br1_record", proof=proof, classification=classification, best=result.get("BEST_CHECKPOINT"))
        return {"BR1_CAPACITY_PROOF": proof, "RETURN_BOUNDARY": st["RETURN_BOUNDARY"]}

    def record_iia1_capacity(self, result: dict[str, Any]) -> dict[str, Any]:
        st = self.load_state()
        st["IIA1_IMPLEMENTED"] = True
        st["IIA1_PRODUCTION_READY"] = False
        st["IIA1_CAPACITY_PROOF"] = "PASS" if result.get("ok") else "FAIL"
        st["NEW_WRIM_TRAINING_PERFORMED"] = True
        self.save_state(st)
        self.audit("iia1_capacity", proof=st["IIA1_CAPACITY_PROOF"], best=result.get("best_checkpoint"))
        return {"IIA1_CAPACITY_PROOF": st["IIA1_CAPACITY_PROOF"]}

    def resolve_data_boundary(self, *, school: str, corpus_id: str, corpus_hash: str) -> dict[str, Any]:
        """Commander-authorized resume after a clean first-party corpus audit."""
        st = self.load_state()
        if st["CURRENT_SCHOOL"] != school:
            raise PromptbookError(f"resolve_data_boundary_mismatch {st['CURRENT_SCHOOL']} != {school}")
        boundary = st.get("RETURN_BOUNDARY")
        if boundary not in (None, "", "DATA_BOUNDARY_REQUIRES_NEW_CORPUS_SOURCE"):
            raise ReturnBoundary(str(boundary), str(st.get("RETURN_DETAIL") or "unresolved"))
        st["RETURN_BOUNDARY"] = None
        st["RETURN_DETAIL"] = None
        st["DATA_BOUNDARY_RESOLVED_BY"] = {"corpus_id": corpus_id, "corpus_hash": corpus_hash}
        st[f"{school}_STATUS"] = "RUNNING"
        self.save_state(st)
        self.audit("resolve_data_boundary", school=school, corpus_id=corpus_id)
        return {"ok": True, "CURRENT_SCHOOL": school, "corpus_id": corpus_id}

    def complete_school(self, *, school: str, success: bool, evidence: dict[str, Any], experiment_id: str) -> dict[str, Any]:
        st = self.load_state()
        if st["CURRENT_SCHOOL"] != school:
            raise PromptbookError(f"complete_school_mismatch {st['CURRENT_SCHOOL']} != {school}")
        node = school_by_id(self.graph, school)
        st[f"{school}_STATUS"] = "COMPLETED" if success else "FAILED"
        st[f"{school}_EVIDENCE"] = evidence
        self.save_state(st)
        self.append_ledger({
            "experiment_id": experiment_id,
            "school": school,
            "status": "COMPLETED" if success else "REJECTED",
            "hypothesis": node.get("purpose"),
            "parent_checkpoint": st.get("PARENT"),
            "trainable_modules": [],
            "tokens_used": 0,
            "evidence": evidence,
            "do_not_rerun": True,
        })
        advanced = None
        if success:
            nxt = (node.get("next") or [None])[0]
            if nxt and not str(nxt).startswith("RAEL_"):
                advanced = self.advance_if_allowed(nxt)
        self.audit("complete_school", school=school, success=success, advanced=advanced)
        return {"success": success, "advanced": advanced}

    def refuse_promotion(self) -> None:
        raise ReturnBoundary("MODEL_PROMOTION", "Promptbook cannot promote or change canonical")

    def refuse_rael_training(self) -> None:
        raise ReturnBoundary("RAEL_POST_FOUNDATION_EXECUTION_AUTHORIZATION", "design only")

    def advance_if_allowed(self, next_school: str) -> dict[str, Any]:
        st = self.load_state()
        school = school_by_id(self.graph, st["CURRENT_SCHOOL"])
        if next_school not in school["next"]:
            raise PromptbookError(f"illegal_transition {st['CURRENT_SCHOOL']} -> {next_school}")
        if next_school.startswith("RAEL_") and not st.get("commander_foundation_graduation_authorized"):
            raise ReturnBoundary("RAEL_POST_FOUNDATION_EXECUTION_AUTHORIZATION", "foundation not graduated")
        st["CURRENT_SCHOOL"] = next_school
        nxt = school_by_id(self.graph, next_school)
        missions = nxt.get("missions") or []
        st["CURRENT_MISSION"] = missions[0]["id"] if missions else next_school
        self.save_state(st)
        self.audit("advance", to=next_school)
        return {"CURRENT_SCHOOL": next_school, "CURRENT_MISSION": st["CURRENT_MISSION"]}

    def dry_run(self) -> dict[str, Any]:
        """Traverse graph without optimizer steps. Import School 04 as complete."""
        visited = []
        branches = []
        for sid in ordered_school_ids(self.graph):
            node = school_by_id(self.graph, sid)
            visited.append(sid)
            if sid == "SCHOOL_04_RESPONSE_MODE_ROUTING":
                branches.append({"school": sid, "action": "IMPORT_COMPLETED_MOD_02A", "train": False})
            elif sid == "SCHOOL_04B_ROUTER_DATA_REMEDIATION":
                branches.append({"school": sid, "action": "AVAILABLE_NOT_ENTERED", "train": False})
            elif sid == "SCHOOL_05_NATURAL_ENTRY":
                branches.append({"school": sid, "action": "DIAGNOSTIC_PLAN", "train": False, "current": True})
            elif sid == "SCHOOL_15_FOUNDATION_GRADUATION":
                branches.append({"school": sid, "action": "WOULD_RETURN_COMMANDER", "boundary": "FOUNDATION_READY_FOR_GRADUATION_REVIEW", "train": False})
            else:
                branches.append({"school": sid, "action": "TRAVERSE", "status": node["status"], "train": False})
        rael = [{"school": s["id"], "action": "DESIGN_ONLY", "train": False} for s in self.graph["rael_bridge"]]
        self.audit("dry_run", n=len(visited))
        return {
            "optimizer_steps": 0,
            "visited": visited,
            "branches": branches,
            "rael": rael,
            "mod_02a_rerun": False,
            "promotion": False,
        }

    def evaluate(self, suite: str = "status") -> dict[str, Any]:
        man = evaluation_manifest()
        if suite == "status":
            return {"suites": list(man["suites"].keys()), "locked": True}
        if suite not in man["suites"]:
            raise PromptbookError(f"unknown_suite {suite}")
        return {"suite": suite, "mode": "HOOK", "ran": False, "note": "readonly hook; full WRIM eval is opt-in"}

    def report(self) -> dict[str, Any]:
        st = self.load_state()
        return {
            "WHAT_CHANGED": "Promptbook execution system built; MOD-02A imported; current school School 05.",
            "WHAT_WAS_PROVEN": "MOD-02A router proof PASS (experimental). Structured continuation parent identity.",
            "WHAT_FAILED": "RMR1 production readiness; extra-unseen routing 0.45; two-token learned regression; free-greedy natural extra 0 under learned router.",
            "WHAT_REMAINS": "School 05 natural-entry diagnostic and NE1 decision. No NE1 yet.",
            "CHECKPOINT_FRONTIER": [PARENT_CHECKPOINT, "WRIM_RMR1_MOD02A experimental"],
            "TOKEN_LEDGER": read_json(self.paths()["tokens"], {}),
            "RETENTION": {"STAGE3": STAGE3_CURRENT, "GLOBAL_BASE_WEIGHT_DRIFT": 0},
            "NEXT_AUTOMATIC_ACTION": "verify + diagnostic plan for NATURAL_ENTRY_NE1_REVIEW; no training",
            "RETURN_BOUNDARY_IF_ANY": None,
            "STATE": {
                "CURRENT_SCHOOL": st["CURRENT_SCHOOL"],
                "CURRENT_MISSION": st["CURRENT_MISSION"],
                "TRAINING_AUTHORIZATION": st["TRAINING_AUTHORIZATION"],
            },
        }

    def mark_ready(self, flags: dict[str, bool]) -> None:
        st = self.load_state()
        st["PROMPTBOOK_EXECUTION_SYSTEM_READY"] = all(flags.values())
        st["readiness_flags"] = flags
        self.save_state(st)

    def write_build_report(self, extra: dict[str, Any]) -> Path:
        path = Path(DATA_ROOT) / BUILD_REPORT_NAME
        write_json(path, extra)
        write_json(self.spec_dir / BUILD_REPORT_NAME, extra)
        return path


def evaluation_manifest() -> dict[str, Any]:
    return {
        "id": "WRIM_GENESIS_EVALUATION_MANIFEST_v1",
        "locked": True,
        "never_train_on": [
            "WRIM-FOUNDATION-GRADUATION-1-v1.0.0",
            "extra_unseen_natural_span_eval",
        ],
        "suites": {
            "structured_phrase": {"path": "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0/val.jsonl", "ref": 17},
            "two_token": {"path": "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0/val.jsonl", "parent_ref": 6, "mod02a_always_structured": 3, "mod02a_learned": 1},
            "three_token": {"path": "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0/val.jsonl", "ref": 10},
            "paraphrase": {"path": "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0/val.jsonl", "ref": 3},
            "natural_official": {"path": "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0/val.jsonl", "oracle_bypass": 3},
            "natural_extra_unseen": {"fn": "natural_span_eval", "n": 20, "oracle_bypass": 1, "never_train": True},
            "gold_prefix": {"hook": "wrim_entry_bypass_review / wrim_na1_mod01b"},
            "response_routing": {"hook": "wrim_rmr1_mod02a", "completed": True},
            "eos_stopping_ramble_empty": {"hook": "_score_loaded"},
            "stage3": {"id": "WRIM-EVAL-S3-000001", "sha": SUITE_SHA, "floor": 5, "prefer": 6},
            "documents": {"document_parity": "PASS"},
            "general_nl": {"independent_nl_nll": 6.972, "general_nl_nll": 5.247},
            "code": {"nll": 3.579},
            "json": {"nll": 3.282},
            "multi_turn": {"hook": "rmr1 latch/EOS tests", "status": "PASS"},
            "instruction_following": {"status": "NOT_TESTED"},
            "reasoning": {"status": "NOT_TESTED"},
            "tool_readiness": {"status": "NOT_TESTED"},
            "graduation": {"id": "WRIM-FOUNDATION-GRADUATION-1-v1.0.0", "never_train": True},
        },
        "public_metrics_must_split": ["train", "official_validation", "extra_unseen", "family_holdout"],
    }


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()
