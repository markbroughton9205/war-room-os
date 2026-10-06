# Terra volumetric clouds — future design (not implemented)

Phase 2 does **not** add full-global volumetric raymarching.

## GPU cost (order-of-magnitude)

- Current raster GeoColor/IR: imagery layers only.
- Limb/altitude shell: ~1 extra atmosphere pass. Acceptable default later.
- View-frustum volume (32–64 steps): roughly 3–8 ms on a mid laptop GPU at 1080p.
- Full-sphere 3D texture: roughly 12–25 ms plus hundreds of MB VRAM. Not a default.

## WebGL / WebGPU

- WebGL2 is the floor (3D textures, float targets).
- WebGPU is preferred later for compute that stays presentation-only.

## Quality tiers

`OFF` → `LIMB_SHELL` → `FRUSTUM_VOLUME` → `GLOBAL_VOLUME`

## Measured vs procedural

Measured GOES / Himawari / IR frames still own location, coverage, time, and large-scale structure. Procedural detail may only live *inside* a measured silhouette. Noise must never move a storm or invent coverage.
