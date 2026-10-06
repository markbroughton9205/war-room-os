import { sha256Json, shortId } from './hash'
import { cinematicMass } from './materials'
import { releaseTimeForPiece } from './guides'
import type { FractureArtifact } from './fracture'
import type { HvsDestructionPlan, HvsStructuralGraph, StructuralEdge, StructuralNode, WorldAnchor } from './types'
import { HVS_DESTRUCTION_WORLD } from './types'

const STRENGTH: Record<string, number> = { GENTLE: 0.35, MODERATE: 0.6, STRONG: 0.85 }

export function buildStructuralGraph(input: {
  fracture: FractureArtifact
  plan: HvsDestructionPlan
  sourceGeometryHash: string
}): HvsStructuralGraph {
  const nodes: StructuralNode[] = input.fracture.pieces.map(piece => {
    const volume = piece.size.x * piece.size.y * piece.size.z
    const half = { x: piece.size.x / 2, y: piece.size.y / 2, z: piece.size.z / 2 }
    return {
      id: piece.id,
      assetRef: null,
      chunkRef: piece.id,
      transform: {
        position: piece.position,
        rotation: { x: 0, y: 0, z: 0 },
        size: piece.size,
      },
      materialId: piece.materialId,
      mass: cinematicMass(volume, piece.materialId),
      supportClass: piece.supportClass,
      static: true,
      bounds: {
        min: {
          x: piece.position.x - half.x,
          y: piece.position.y - half.y,
          z: piece.position.z - half.z,
        },
        max: {
          x: piece.position.x + half.x,
          y: piece.position.y + half.y,
          z: piece.position.z + half.z,
        },
      },
      column: piece.column,
      row: piece.row,
    }
  })
  const edges: StructuralEdge[] = []
  const strength = STRENGTH[input.plan.constraintPlan.defaultStrengthClass] ?? 0.6
  for (const node of nodes) {
    if (node.row == null) continue
    const right = nodes.find(other => other.column === node.column + 1 && other.row === node.row)
    const above = nodes.find(other => other.column === node.column && other.row === (node.row ?? 0) + 1)
    for (const other of [right, above]) {
      if (!other) continue
      edges.push({
        id: `edge-${node.id}--${other.id}`,
        a: node.id,
        b: other.id,
        constraintType: 'BOND',
        strength,
        breakThreshold: strength,
        materialId: node.materialId,
      })
    }
  }
  const anchors: WorldAnchor[] = []
  for (const node of nodes) {
    const releaseAt = releaseTimeForPiece({
      column: node.column,
      row: node.row,
      rows: 6,
      columnCount: 10,
      mode: input.plan.simulationConfig.mode,
      guides: input.plan.guidePlan.primitives,
      durationSec: input.plan.simulationConfig.durationSec,
    })
    const onGround = node.row === 0 || node.row == null
    if (!onGround && node.supportClass !== 'RIGHT_SUPPORT' && node.supportClass !== 'LEFT_SUPPORT') continue
    anchors.push({
      id: `anchor-${node.id}`,
      nodeId: node.id,
      anchorType: node.supportClass === 'RIGHT_SUPPORT' || node.supportClass === 'LEFT_SUPPORT' ? 'SUPPORT' : 'GROUND',
      strength,
      releasePolicy: releaseAt == null ? 'HOLD' : node.supportClass === 'LEFT_SUPPORT' ? 'BREAK_FIRST' : 'RELEASE_AT',
      releaseAtSec: releaseAt,
    })
  }
  const graph: HvsStructuralGraph = {
    id: shortId('dgraph', { source: input.sourceGeometryHash, pieces: nodes.map(node => node.id), plan: input.plan.version }),
    version: input.plan.version,
    units: 'meters',
    coordinateSystem: HVS_DESTRUCTION_WORLD.coordinateSystem,
    sourceGeometryHash: input.sourceGeometryHash,
    seed: input.plan.fracturePlan.seed,
    nodes,
    edges,
    anchors,
  }
  return graph
}

export function structuralGraphHash(graph: HvsStructuralGraph): string {
  return sha256Json({
    nodes: graph.nodes.map(node => ({
      id: node.id,
      materialId: node.materialId,
      supportClass: node.supportClass,
      position: node.transform.position,
      size: node.transform.size,
    })),
    edges: graph.edges.map(edge => ({ id: edge.id, a: edge.a, b: edge.b, breakThreshold: edge.breakThreshold })),
    anchors: graph.anchors.map(anchor => ({ id: anchor.id, nodeId: anchor.nodeId, releasePolicy: anchor.releasePolicy, releaseAtSec: anchor.releaseAtSec })),
  })
}
