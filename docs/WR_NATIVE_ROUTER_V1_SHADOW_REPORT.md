# War Room Native Router V1 Shadow Report

Identity: `WR-NATIVE-ROUTER-V1-CANDIDATE`  
Flag: `WR_NATIVE_ROUTER_V1_SHADOW` default **OFF**. Production `NODE_ENV` always off.

Development only. Reuses `observeToolRouterResult` / `captureRuntimeTrajectory`. No parallel ledger. `alters_routing` is always false.

## Traffic

Offline shadow over EVAL-6 test (112) plus three compact `TOOL=` fixtures (**115** observations). No fabricated live runtime provenance.

| Metric | Value |
|---|---|
| Observations | 115 |
| Agreement / verified accuracy vs labeled current route | 0.939 |
| Abstention rate | 0.122 |
| Alters routing | false |
| Observer routing overhead | ~0.15 ms/row (decision only; WRIM extract amortized ~47 ms/text if included) |

Per-request TypeScript spawn uses `--skip-wrim` so the observer does not load WRIM on every chat turn. Offline EVAL-6 still scored WRIM in batch.

TypeScript validator: `lib/modular-intelligence/nativeRouterV1Shadow.validation.ts`.

## Latency (offline batch)

| Stage | Mean |
|---|---|
| Deterministic | 0.17 ms |
| Lexical | 0.14 ms |
| Hybrid decision | 0.15 ms |
| WRIM L10 extract (amortized) | 47.2 ms |
| Total with WRIM features | 47.6 ms |

WRIM feature extraction dominates. It is practical for batch eval, not for naive per-request spawn of a full WRIM forward.
