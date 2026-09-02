"""Trainable-parameter selection. Future optimizers may only wrap capability leaves."""
from __future__ import annotations

from typing import Any

import mlx.core as mx
import mlx.nn as nn
import mlx.utils

from frozen_core import FrozenWRIMCore, numpy_params  # noqa: F401


class OptimizerIsolationError(ValueError):
    pass


def flatten_keys(tree) -> set[str]:
    return {k for k, v in mlx.utils.tree_flatten(tree) if isinstance(v, mx.array)}


def partition_parameters(core: FrozenWRIMCore, capability: nn.Module) -> dict[str, Any]:
    core_all = mlx.utils.tree_flatten(core.model.parameters())
    core_train = mlx.utils.tree_flatten(core.model.trainable_parameters())
    cap_all = mlx.utils.tree_flatten(capability.parameters())
    cap_train = mlx.utils.tree_flatten(capability.trainable_parameters())
    return {
        "core_parameters": [k for k, _ in core_all],
        "core_trainable_parameters": [k for k, _ in core_train],
        "capability_parameters": [k for k, _ in cap_all],
        "trainable_capability_parameters": [k for k, _ in cap_train],
        "core_total_parameters": int(sum(v.size for _, v in core_all)),
        "core_trainable_count": int(sum(v.size for _, v in core_train)),
        "capability_total_parameters": int(sum(v.size for _, v in cap_all)),
        "capability_trainable_count": int(sum(v.size for _, v in cap_train)),
    }


def assert_optimizer_excludes_core(optimizer_param_keys: set[str], core: FrozenWRIMCore) -> None:
    core_keys = flatten_keys(core.model.parameters())
    overlap = optimizer_param_keys & core_keys
    if overlap:
        raise OptimizerIsolationError(
            f"core parameters entered optimizer: {sorted(overlap)[:12]}"
        )
    if core.core_trainable_parameters() != 0:
        raise OptimizerIsolationError("core trainable_parameters is not empty")


def capability_optimizer(capability: nn.Module, learning_rate: float = 1e-3):
    import mlx.optimizers as optim

    if _count(capability.trainable_parameters()) == 0:
        raise OptimizerIsolationError("capability has no trainable parameters")
    return optim.Adam(learning_rate=learning_rate)


def _count(tree) -> int:
    return int(sum(v.size for _, v in mlx.utils.tree_flatten(tree)))


class IsolatedCapabilityRuntime(nn.Module):
    """Single Module tree so mlx.nn.value_and_grad sees freeze on the core subtree."""

    def __init__(self, core: FrozenWRIMCore, capability: nn.Module):
        super().__init__()
        self.core = core.model
        self.capability = capability

    def __call__(self, idx: mx.array):
        logits, hidden = self.core.forward_hidden(idx)
        return logits, self.capability(hidden[:, -1, :])


def synthetic_isolated_step(
    core: FrozenWRIMCore,
    capability: nn.Module,
    *,
    seed: int = 3,
) -> dict[str, Any]:
    """TEST_ONLY one Adam step on capability only. No language/tool curriculum."""
    import mlx.nn as nn_mod

    before = numpy_params(core.model)
    before_cap = numpy_params(capability)
    runtime = IsolatedCapabilityRuntime(core, capability)
    if core.core_trainable_parameters() != 0:
        raise OptimizerIsolationError("core not frozen at optimizer construction")

    opt_keys = flatten_keys(runtime.trainable_parameters())
    core_keys = flatten_keys(core.model.parameters())
    assert_optimizer_excludes_core(opt_keys, core)

    mx.random.seed(seed)
    idx = mx.array([[1, 2, 3, 4]], dtype=mx.int32)
    target = mx.zeros((1, int(capability.manifest.n_classes or 4)))
    target = target.at[0, 1].add(1.0)

    def loss_fn(tokens):
        _, pred = runtime(tokens)
        return mx.mean((pred - target) ** 2)

    loss_and_grad = nn_mod.value_and_grad(runtime, loss_fn)
    loss, grads = loss_and_grad(idx)
    grad_keys = flatten_keys(grads)
    if grad_keys & core_keys:
        raise OptimizerIsolationError(f"gradients include core keys {sorted(grad_keys & core_keys)[:8]}")
    optimizer = capability_optimizer(capability, learning_rate=1e-2)
    optimizer.update(runtime, grads)
    mx.eval(runtime.parameters())

    after = numpy_params(core.model)
    after_cap = numpy_params(capability)
    from frozen_core import max_abs_diff

    core_diff = max_abs_diff(before, after)
    cap_diff = max_abs_diff(before_cap, after_cap)
    if core_diff != 0.0:
        raise OptimizerIsolationError(f"core max_abs_diff={core_diff} after synthetic step")
    if cap_diff == 0.0:
        raise OptimizerIsolationError("capability parameters did not change; isolation proof is incomplete")
    return {
        "loss": float(loss.item()),
        "core_max_abs_diff": core_diff,
        "capability_max_abs_diff": cap_diff,
        "optimizer_param_keys": sorted(opt_keys),
        "grad_keys": sorted(grad_keys),
        "core_trainable_parameters": core.core_trainable_parameters(),
        "test_only": True,
        "official_lineage": False,
    }
