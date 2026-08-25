/**
 * Shared Cesium Entity id convention for every Terra layer (not just earthquakes) — kept generic
 * so TerraGlobe's click-picking logic never has to know which specific layer an entity belongs
 * to, only that it's a Terra-managed feature vs. a bare ground click.
 */
const PREFIX = 'terra-feature:'

export function terraEntityId(featureId: string): string {
  return `${PREFIX}${featureId}`
}

export function featureIdFromTerraEntityId(entityId: unknown): string | null {
  return typeof entityId === 'string' && entityId.startsWith(PREFIX) ? entityId.slice(PREFIX.length) : null
}
