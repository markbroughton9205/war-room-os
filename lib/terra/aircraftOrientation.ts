/**
 * Pure heading -> Cesium billboard-rotation conversion for Terra's aircraft glyph
 * (components/war-room/terra/TerraFeatureLayer.tsx). Kept framework-free so it runs in a plain
 * Node validation script and so the sign/axis convention is documented and testable in one place
 * rather than buried inline in Cesium entity-construction code.
 *
 * A real-world compass heading increases clockwise from north (0° = north, 90° = east). The
 * aircraft glyph is authored pointing "up" (north) at rotation 0. Cesium's `BillboardGraphics
 * .rotation` is a screen-space angle in radians that increases counter-clockwise. Rotating a
 * north-up glyph to point toward a clockwise compass heading therefore means negating the heading
 * before converting to radians — this is the one piece of that conversion worth a named,
 * independently tested function rather than an inline `-heading * Math.PI / 180` at the call site.
 */
export function terraAircraftBillboardRotationRadians(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180
}
