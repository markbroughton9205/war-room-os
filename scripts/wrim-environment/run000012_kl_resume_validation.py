"""KL WRIM-0 reference must survive resume. Test-only. Does not train RUN-000012."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F


VOCAB = 32
SEQ = 8


class Tiny(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.emb = torch.nn.Embedding(VOCAB, 16)
        self.lin = torch.nn.Linear(16, VOCAB)

    def forward(self, x):
        return self.lin(self.emb(x))


def _logp(model, x, start: int, n: int) -> torch.Tensor:
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
        tlogits = logits[start : start + n].float()
        return F.log_softmax(tlogits, dim=-1).detach().cpu().contiguous().clone()


def _kl(p0: torch.Tensor, logq: torch.Tensor) -> float:
    p0 = p0.to(logq.device)
    return float((p0.exp() * (p0 - logq)).sum(dim=-1).mean().item())


def run_kl_resume_validation(*, tmp: Path | None = None) -> dict[str, Any]:
    from wrim_kl_reference import ensure_wrim0_logp, save_wrim0_logp, simulate_buggy_fill, load_wrim0_logp

    device = torch.device("cpu")
    torch.manual_seed(0)
    parent = Tiny()
    cand = Tiny()
    cand.load_state_dict(parent.state_dict())
    with torch.no_grad():
        for p in cand.parameters():
            p.add_(0.35)

    x = torch.arange(SEQ, dtype=torch.long).unsqueeze(0)
    start, n = 2, 4
    parent_logp = {"it-a": _logp(parent, x, start, n)}
    cand_logp = {"it-a": _logp(cand, x, start, n)}
    true_kl = _kl(parent_logp["it-a"], cand_logp["it-a"])
    buggy = simulate_buggy_fill(cand_logp)
    buggy_kl = _kl(buggy["it-a"], cand_logp["it-a"])

    root = Path(tmp or "/tmp/wrim-kl-resume-000012")
    root.mkdir(parents=True, exist_ok=True)
    art = root / "wrim0-kl-reference.pt"
    save_wrim0_logp(art, parent_logp, parent_hash="parentA", tokenizer_hash="tokA", eval_hash="evalA")
    restored = load_wrim0_logp(art, parent_hash="parentA", tokenizer_hash="tokA", eval_hash="evalA")
    resume_kl = _kl(restored["it-a"], cand_logp["it-a"])

    # Reload parent replica and recompute.
    parent2 = Tiny()
    parent2.load_state_dict(parent.state_dict())
    parent2_logp = {"it-a": _logp(parent2, x, start, n)}
    recompute_kl = _kl(parent2_logp["it-a"], cand_logp["it-a"])

    checks = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    add("bug_confirmed_self_kl_near_zero", abs(buggy_kl) < 1e-8, str(buggy_kl))
    add("true_kl_nonzero", true_kl > 1e-4, str(true_kl))
    add("resume_artifact_matches_true_kl", abs(resume_kl - true_kl) < 1e-6, f"{resume_kl} vs {true_kl}")
    add("reloaded_parent_matches", abs(recompute_kl - true_kl) < 1e-6, f"{recompute_kl} vs {true_kl}")
    add("artifact_not_candidate", not torch.allclose(restored["it-a"], cand_logp["it-a"]), "")
    add("artifact_is_parent", torch.allclose(restored["it-a"], parent_logp["it-a"]), "")

    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "KL_REFERENCE_BUG_CONFIRMED": "YES" if checks[0]["ok"] else "NO",
        "KL_REFERENCE_REPAIRED": "YES" if checks[2]["ok"] and checks[3]["ok"] else "NO",
        "KL_WRIM0_REFERENCE_SURVIVES_RESUME": "PASS" if not failed else "FAIL",
        "true_kl": true_kl,
        "buggy_kl": buggy_kl,
        "resume_kl": resume_kl,
        "checks": checks,
        "failed": failed,
    }


def main() -> int:
    import json

    out = run_kl_resume_validation()
    print(
        json.dumps(
            {
                k: out[k]
                for k in (
                    "ok",
                    "KL_REFERENCE_BUG_CONFIRMED",
                    "KL_REFERENCE_REPAIRED",
                    "KL_WRIM0_REFERENCE_SURVIVES_RESUME",
                    "true_kl",
                    "buggy_kl",
                )
            },
            indent=2,
        )
    )
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
