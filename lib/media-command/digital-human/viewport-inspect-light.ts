/**
 * Derived execution / viewport readability light.
 * Not authored Cinema lighting. Does not mutate CameraSpec or scene lights.
 */
export const HVS_VIEWPORT_INSPECT_LIGHT = {
  id: 'hvs-execution-inspect-key',
  fillId: 'hvs-execution-inspect-fill',
  role: 'EXECUTION_VIEWPORT_READABILITY',
  mutatesCinema: false,
  closeUpFocalMm: 70,
  keyIntensity: 1.55,
  fillIntensity: 0.32,
  wideIntensity: 0,
} as const
