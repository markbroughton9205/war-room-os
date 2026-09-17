/**
 * Mapillary Vistas research lane — evaluation adapter only.
 *
 * RESEARCH_DATASET. Do not bundle dataset files into desktop packages.
 * Do not treat detections as verified infrastructure.
 */
export const MAPILLARY_VISTAS_LANE = 'RESEARCH_DATASET' as const
export const MAPILLARY_VISTAS_REDISTRIBUTE_IN_DESKTOP = false

export const MAPILLARY_VISTAS_LICENSE = 'Mapillary Vistas Research License — research use; redistribution of dataset files is not authorized in War Room desktop packages'
export const MAPILLARY_VISTAS_SOURCE_URL = 'https://www.mapillary.com/dataset/vistas'
export const MAPILLARY_VISTAS_CITATION = 'Neuhold, Ollmann, Rota Bulo, Kontschieder. The Mapillary Vistas Dataset for Semantic Understanding of Street Scenes. ICCV 2017.'

export const MAPILLARY_VISTAS_EXPERIMENT_CLASSES = [
  'semantic_segmentation',
  'traffic_light_recognition',
  'road_sign_recognition',
  'lane_recognition',
  'road_sidewalk_segmentation',
  'vehicle_pedestrian_detection',
  'building_street_object_evaluation',
] as const
export type MapillaryVistasExperimentClass = (typeof MAPILLARY_VISTAS_EXPERIMENT_CLASSES)[number]

export type MapillaryVistasResearchLane = {
  kind: typeof MAPILLARY_VISTAS_LANE
  bundled: typeof MAPILLARY_VISTAS_REDISTRIBUTE_IN_DESKTOP
  license: typeof MAPILLARY_VISTAS_LICENSE
  sourceUrl: typeof MAPILLARY_VISTAS_SOURCE_URL
  citation: typeof MAPILLARY_VISTAS_CITATION
  experiments: readonly MapillaryVistasExperimentClass[]
  runtimeEnabled: false
  honesty: string
}

export function mapillaryVistasResearchLane(): MapillaryVistasResearchLane {
  return {
    kind: MAPILLARY_VISTAS_LANE,
    bundled: false,
    license: MAPILLARY_VISTAS_LICENSE,
    sourceUrl: MAPILLARY_VISTAS_SOURCE_URL,
    citation: MAPILLARY_VISTAS_CITATION,
    experiments: MAPILLARY_VISTAS_EXPERIMENT_CLASSES,
    runtimeEnabled: false,
    honesty:
      'Vistas is a research evaluation adapter. Dataset files are not shipped in desktop packages. Visual detections from this lane are OBSERVED_BY_MODEL until corroborated.',
  }
}
