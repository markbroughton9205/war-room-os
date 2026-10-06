/**
 * Deliver preflight. Fail before expensive render where possible.
 * Does not mutate .hvsproj.
 */
import { existsSync, statfsSync } from 'node:fs'
import path from 'node:path'
import type { HvsProject } from './types'
import { findAsset } from './types'
import { validateEffectGraph, WAVE9_EXECUTABLE_EFFECT_NODES } from './effect-graph'
import { validateColorPipeline, WAVE9_EXECUTABLE_COLOR_NODES } from './color-pipeline'
import { validateAudioGraph } from './audio-graph'
import { validateCubeFile } from './lut-cube'
import { mediaCommandDataHierarchy } from './paths'

export type PreflightIssue = {
  code: string
  message: string
  fatal: boolean
}

export type PreflightResult = {
  ok: boolean
  issues: PreflightIssue[]
  outputDir: string
  freeBytes: number | null
}

export function preflightDeliver(project: HvsProject, outputPath?: string): PreflightResult {
  const issues: PreflightIssue[] = []
  const assetIds = new Set(project.assets.map(a => a.id))
  const subjectIds = new Set(project.timeline.subjects.map(s => s.id))
  const trackIds = new Set(project.timeline.tracks.map(t => t.id))

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips.filter(c => c.enabled)) {
      const asset = findAsset(project, clip.assetId)
      if (!asset) issues.push({ code: 'missing_asset', message: `Clip ${clip.id} references missing asset ${clip.assetId}.`, fatal: true })
      else if (!existsSync(asset.originalPath)) issues.push({ code: 'missing_media', message: `Original missing for ${asset.name}.`, fatal: true })
    }
  }

  for (const graph of project.effectGraphs ?? []) {
    const check = validateEffectGraph(graph, { assetIds, subjectIds })
    if (!check.ok) issues.push({ code: 'invalid_graph', message: `EffectGraph ${graph.id}: ${check.errors.join('; ')}`, fatal: true })
    for (const node of graph.nodes.filter(n => n.enabled !== false)) {
      if (!WAVE9_EXECUTABLE_EFFECT_NODES.includes(node.kind)) {
        issues.push({ code: 'unsupported_node', message: `EffectGraph node ${node.id} kind ${node.kind} is unsupported.`, fatal: true })
      }
    }
  }

  const color = validateColorPipeline(project.colorPipeline, assetIds)
  if (!color.ok) issues.push({ code: 'invalid_color', message: color.errors.join('; '), fatal: true })
  for (const node of project.colorPipeline.nodes.filter(n => n.enabled)) {
    if (!WAVE9_EXECUTABLE_COLOR_NODES.includes(node.type)) {
      issues.push({ code: 'unsupported_node', message: `Color node ${node.id} type ${node.type} unsupported.`, fatal: true })
    }
    if (node.type === 'lut') {
      const file = typeof node.params.file === 'string' ? node.params.file : null
      if (!file) issues.push({ code: 'invalid_lut', message: `LUT node ${node.id} has no file.`, fatal: true })
      else {
        const cube = validateCubeFile(file)
        if (!cube.ok) issues.push({ code: 'invalid_lut', message: cube.errors.join('; '), fatal: true })
      }
    }
  }

  const audio = validateAudioGraph(project.audioGraph, trackIds)
  if (!audio.ok) issues.push({ code: 'invalid_audiograph', message: audio.errors.join('; '), fatal: true })

  const dir = outputPath ? path.dirname(outputPath) : mediaCommandDataHierarchy().renders
  let freeBytes: number | null = null
  try {
    const fs = statfsSync(dir)
    freeBytes = Number(fs.bavail) * Number(fs.bsize)
    if (freeBytes < 50 * 1024 * 1024) {
      issues.push({ code: 'disk_space', message: `Free disk ${freeBytes} bytes is below 50 MiB.`, fatal: true })
    }
  } catch {
    issues.push({ code: 'output_path', message: `Cannot stat output directory ${dir}.`, fatal: true })
  }

  if (outputPath && outputPath.includes('..')) {
    issues.push({ code: 'output_path', message: 'Unsafe output path.', fatal: true })
  }

  return { ok: issues.filter(i => i.fatal).length === 0, issues, outputDir: dir, freeBytes }
}
