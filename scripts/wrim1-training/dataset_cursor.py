from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass
class DatasetCursor:
    epoch: int
    token_offset: int
    sample_position: int
    batch_position: int
    tokens_consumed: int
    stream_length: int
    seq_len: int
    batch_size: int
    shuffle_epoch_seed: int
    permutation_epoch: int

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "DatasetCursor":
        fields = {k: data[k] for k in cls.__dataclass_fields__}
        return cls(**fields)


def legacy_token_permutation_stream(data: np.ndarray, seed: int, epoch: int) -> np.ndarray:
    """WRIM-1 collapse path. Do not use for training. Permutes individual tokens."""
    if data.size == 0:
        return data
    rng = np.random.default_rng((int(seed) + int(epoch) * 1_000_003) & 0xFFFFFFFF)
    return data[rng.permutation(data.size)]


def epoch_stream(data: np.ndarray, seed: int, epoch: int) -> np.ndarray:
    """Contiguous causal stream. Does not shuffle individual tokens.

    Sequence/document mixing belongs in permute_unit_order, applied before
    concatenation. `seed`/`epoch` are retained for cursor identity only.
    """
    del seed, epoch
    return np.asarray(data)


def permute_unit_order(units: list, seed: int, epoch: int) -> list:
    """Shuffle independent units. Token order inside each unit is unchanged."""
    if len(units) <= 1:
        return list(units)
    rng = np.random.default_rng((int(seed) + int(epoch) * 1_000_003) & 0xFFFFFFFF)
    order = rng.permutation(len(units))
    return [units[int(i)] for i in order]


def concatenate_units(units: list[np.ndarray], dtype=np.int32) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=dtype)
    return np.concatenate([np.asarray(u, dtype=dtype) for u in units])


def next_batch(
    stream: np.ndarray,
    cursor: DatasetCursor,
    loss_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, DatasetCursor] | tuple[np.ndarray, np.ndarray, np.ndarray, DatasetCursor]:
    seq = cursor.seq_len
    bs = cursor.batch_size
    usable = stream.size - seq - 1
    if usable <= 0:
        raise ValueError("stream too short for context")
    epoch = cursor.epoch
    offset = cursor.token_offset
    samples = cursor.sample_position
    xs = []
    ys = []
    ms = []
    work = epoch_stream(stream, cursor.shuffle_epoch_seed, epoch)
    mask_work = None if loss_mask is None else np.asarray(loss_mask)
    if mask_work is not None and mask_work.size != work.size:
        raise ValueError("loss_mask length must match stream")
    for _ in range(bs):
        if offset > usable:
            epoch += 1
            offset = 0
            work = epoch_stream(stream, cursor.shuffle_epoch_seed, epoch)
        start = offset
        xs.append(work[start:start + seq])
        ys.append(work[start + 1:start + seq + 1])
        if mask_work is not None:
            ms.append(mask_work[start + 1:start + seq + 1])
        offset += seq
        samples += 1
    tokens = bs * seq
    nxt = DatasetCursor(
        epoch=epoch,
        token_offset=offset,
        sample_position=samples,
        batch_position=cursor.batch_position + 1,
        tokens_consumed=cursor.tokens_consumed + tokens,
        stream_length=stream.size,
        seq_len=seq,
        batch_size=bs,
        shuffle_epoch_seed=cursor.shuffle_epoch_seed,
        permutation_epoch=epoch,
    )
    x_out = np.stack(xs).astype(np.int32)
    y_out = np.stack(ys).astype(np.int32)
    if mask_work is None:
        return x_out, y_out, nxt
    return x_out, y_out, np.stack(ms).astype(np.float32), nxt


def initial_cursor(stream_length: int, seq_len: int, batch_size: int, seed: int) -> DatasetCursor:
    return DatasetCursor(
        epoch=0,
        token_offset=0,
        sample_position=0,
        batch_position=0,
        tokens_consumed=0,
        stream_length=stream_length,
        seq_len=seq_len,
        batch_size=batch_size,
        shuffle_epoch_seed=seed,
        permutation_epoch=0,
    )
