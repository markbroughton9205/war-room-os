export const TERRA_JOB_PRIORITIES = {
  P0_CORE_RENDER: 0,
  P1_CURRENT_VIEW: 1,
  P2_NEAR_VIEW: 2,
  P3_PREDICTIVE: 3,
  P4_BACKGROUND: 4,
} as const

export type TerraJobPriority = (typeof TERRA_JOB_PRIORITIES)[keyof typeof TERRA_JOB_PRIORITIES]

export type TerraWorkerTask =
  | 'GEOMETRY_SIMPLIFY'
  | 'FEATURE_FILTER'
  | 'CLUSTER'
  | 'COORDINATE_PROJECT'
  | 'ADMIN_LOD_BUILD'
  | 'ROAD_LOD_BUILD'
  | 'LABEL_CANDIDATE_BUILD'
  | 'CAMERA_CLUSTER'
  | 'VEHICLE_CLUSTER'
  | 'HAZARD_CLUSTER'
  | 'DATA_NORMALIZE'

export type TerraBackpressure = 'NORMAL' | 'BUSY' | 'PRESSURE' | 'CRITICAL'

export type TerraViewBandName = 'SPACE' | 'GLOBAL' | 'CONTINENTAL' | 'REGIONAL' | 'CITY' | 'STREET' | 'BUILDING'

export type TerraJobContext = {
  generation: number
  viewBand: TerraViewBandName
  bbox: { west: number; south: number; east: number; north: number } | null
  layerId: string
  priority: TerraJobPriority
}

export type TerraGeometryBudget = {
  maxFeatures: number
  maxVertices: number
  maxEstimatedBytes: number
  maxIntegrationMs: number
  source: string
}

export type TerraPackedGeometry = {
  coordinates: Float64Array
  offsets: Uint32Array
  lengths: Uint32Array
  featureIndices: Uint32Array
  geometryKinds: Uint8Array
  clusterCounts: Uint32Array
}

export type TerraWorkerRequest = {
  type: 'RUN_JOB'
  jobId: string
  task: TerraWorkerTask
  context: TerraJobContext
  payload: TerraPackedGeometry
  simplifyStride: number
}

export type TerraWorkerCancel =
  | { type: 'CANCEL_JOB'; jobId: string }
  | { type: 'CANCEL_GENERATION'; generation: number }
  | { type: 'CANCEL_LAYER'; layerId: string }

export type TerraWorkerSuccess = {
  type: 'JOB_COMPLETE'
  jobId: string
  context: TerraJobContext
  payload: TerraPackedGeometry
  durationMs: number
}

export type TerraWorkerFailure = {
  type: 'JOB_FAILED'
  jobId: string
  context: TerraJobContext
  error: { name: string; message: string; retryable: boolean }
}

export type TerraWorkerCancelled = {
  type: 'JOB_CANCELLED'
  jobId: string
  context: TerraJobContext
}

export type TerraWorkerResponse = TerraWorkerSuccess | TerraWorkerFailure | TerraWorkerCancelled

export type TerraWorkerMetrics = {
  active: boolean
  workerCount: number
  queuedJobs: number
  runningJobs: number
  cancelledJobs: number
  completedJobs: number
  failedJobs: number
  droppedStaleResults: number
  droppedBackpressureJobs: number
  largestJobBytes: number
  largestVertexCount: number
  integrationQueue: number
  backpressure: TerraBackpressure
  generation: number
  frameTimeMs: number | null
  p95FrameTimeMs: number | null
  longFrameCount: number
  longTaskCount: number
  transferableBuffers: boolean
  smoothMode: boolean
}
