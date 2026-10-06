# Terra worker and render scheduling

Terra preprocessing uses a bounded pool sized to one quarter of reported logical CPUs, capped at
four. Cesium's internal geometry workers remain responsible for Cesium geometry; this pool only
filters, validates, simplifies and reduces Terra data before Cesium receives it.

Each job carries its view generation, view band, bounding box, layer and priority. A camera settle
increments the generation. Queued jobs from the prior generation are cancelled; an already-running
job may finish, but its result is discarded before it can attach to Cesium.

Geometry limits are derived from reported device memory (`RAM / 4096`, bounded from 512 KiB to
4 MiB) and CPU count. Input is split by feature count, vertex count and estimated allocation before
packing. A single oversized feature is simplified while packing, so Terra does not first allocate
the full unsafe numeric buffer.

Typed arrays are posted with their `ArrayBuffer`s in the transfer list. Transfer changes ownership:
the sender's buffers are detached immediately and must never be read or reused. Worker result
buffers are transferred back under the same rule. Any future buffer reuse must occur only after the
current owner has finished; detached buffers are not pool candidates.

Worker output enters `TerraRenderScheduler`, not Cesium directly. The scheduler integrates bounded
batches per animation frame, lowers its budget under frame pressure, and uses a two-millisecond
budget while Living Orbit or camera flight is active. Low-priority work is rejected as queues move
through `BUSY`, `PRESSURE`, and `CRITICAL`.
