/**
 * Future volumetric cloud mode — design only. Not implemented in Phase 2.
 */
export const VOLUMETRIC_FUTURE_DESIGN = {
  authorizedNow: false,
  renderer: 'CesiumJS remains the globe engine. A future volume pass would be an optional overlay, never a second globe.',
  gpuCost: {
    tier0_off: 'current raster GeoColor/IR only',
    tier1_limbShell: 'cheap skyAtmosphere + one translucent shell · ~1 extra fullscreen pass',
    tier2_viewFrustumVolume: 'raymarch 32-64 steps in camera frustum · estimated 3–8 ms on mid laptop GPU at 1080p',
    tier3_globalVolume: 'full-sphere 3D texture · estimated 12–25 ms and hundreds of MB VRAM · not acceptable as default',
  },
  webRequirements: {
    webgl2: 'minimum for 3D textures / float render targets',
    webgpu: 'preferred later for compute-generated noise that stays presentation-only',
  },
  qualityTiers: ['OFF', 'LIMB_SHELL', 'FRUSTUM_VOLUME', 'GLOBAL_VOLUME'] as const,
  measuredVsProcedural: {
    measured: 'GOES/Himawari/IR frames own location, coverage, time, large-scale structure',
    procedural: 'allowed only for micro-detail / scattering inside a measured silhouette · must never move a storm',
    forbidden: 'noise advection that relocates cloud systems; inventing coverage; mixing latest tiles',
  },
}
