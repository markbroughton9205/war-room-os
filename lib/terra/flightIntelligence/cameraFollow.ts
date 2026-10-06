import type { Viewer as CesiumViewer, Entity } from 'cesium'

export function assignTrackedAircraft(viewer: CesiumViewer, entity: Entity | undefined): void {
  viewer.trackedEntity = entity
}
