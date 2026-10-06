/**
 * One master production → derived variant specs → local output jobs.
 * Does not duplicate originals. Does not create a second project or RenderEngine.
 */
import { newCommandId, type EditCommand, type EditCommandActor } from './edit-commands'
import type { HvsProject, OutputAspect } from './types'
import type { HvsProductionVariant } from './production-ai-types'
import { formatLabelForAspect } from './production-language'

const ACTOR: EditCommandActor = 'ai-director'

function reframeMode(project: HvsProject): 'CINEMATIC_FOLLOW' | 'RULE_OF_THIRDS' {
  return project.timeline.subjects.length ? 'CINEMATIC_FOLLOW' : 'RULE_OF_THIRDS'
}

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function cmd(partial: { kind: EditCommand['kind'] } & Record<string, unknown>): EditCommand {
  return {
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: ACTOR,
    ...partial,
  } as EditCommand
}

export function outputSpecForAspect(aspect: OutputAspect): HvsProductionVariant['outputSpec'] {
  if (aspect === '9:16') return { aspect, width: 1080, height: 1920, format: 'mp4' }
  if (aspect === '1:1') return { aspect, width: 1080, height: 1080, format: 'mp4' }
  return { aspect: '16:9', width: 1920, height: 1080, format: 'mp4' }
}

export function parseRequestedVariantAspects(prompt: string): OutputAspect[] {
  const lower = prompt.toLowerCase()
  const aspects: OutputAspect[] = []
  if (/vertical|tiktok|shorts|9\s*[:x]\s*16|reel/.test(lower)) aspects.push('9:16')
  if (/square|1\s*[:x]\s*1/.test(lower)) aspects.push('1:1')
  if (/widescreen|landscape|16\s*[:x]\s*9|youtube(?!\s*shorts)/.test(lower)) aspects.push('16:9')
  if (/tiktok.*youtube|youtube.*tiktok|versions for|another version|create versions/.test(lower) && !aspects.length) {
    return ['9:16', '16:9', '1:1']
  }
  return [...new Set(aspects)]
}

export function buildProductionVariants(
  project: HvsProject,
  aspects: OutputAspect[],
  targetDuration: number | null,
): HvsProductionVariant[] {
  const mode = reframeMode(project)
  const unique = [...new Set(aspects)]
  return unique.map(aspect => ({
    id: nid('var'),
    name: formatLabelForAspect(aspect),
    aspect,
    targetDuration,
    platformIntent: aspect === '9:16' ? 'vertical' : aspect === '1:1' ? 'square' : 'widescreen',
    reframeMode: mode,
    captionStyle: null,
    outputSpec: outputSpecForAspect(aspect),
    derivedFromVersionId: project.currentVersionId,
    status: 'planned',
    renderJobId: null,
    outputAssetId: null,
    outputPath: null,
  }))
}

export function commandsForVariants(project: HvsProject, variants: HvsProductionVariant[]): EditCommand[] {
  const commands: EditCommand[] = []
  const mode = reframeMode(project)
  for (const variant of variants) {
    commands.push(cmd({ kind: 'autoReframe', outputAspect: variant.aspect, mode }))
  }
  return commands
}

export function renderCommandsForVariants(variants: HvsProductionVariant[]): EditCommand[] {
  return variants.map(variant => cmd({ kind: 'render', aspect: variant.aspect }))
}

export function reframeHonesty(project: HvsProject): string {
  return project.timeline.subjects.length
    ? 'Follows the tracked subject in this project.'
    : 'Uses geometric framing. This is not AI person tracking.'
}

export function commandsToQueueVariants(project: HvsProject, variants: HvsProductionVariant[]): EditCommand[] {
  return [
    cmd({
      kind: 'createVersion',
      versionLabel: 'Before output versions',
      createdBy: 'ai-director',
      description: 'Safety snapshot before derived Vertical / Widescreen / Square outputs.',
    }),
    ...commandsForVariants(project, variants),
    ...renderCommandsForVariants(variants),
  ]
}

export function syncVariantOutputs(project: HvsProject, variants: HvsProductionVariant[]): HvsProductionVariant[] {
  return variants.map(variant => {
    const job = [...project.renderJobs].reverse().find(item => item.target.aspect === variant.aspect)
    const asset = job?.outputAssetId ? project.assets.find(row => row.id === job.outputAssetId) : null
    return {
      ...variant,
      renderJobId: job?.id ?? variant.renderJobId,
      outputAssetId: job?.outputAssetId ?? variant.outputAssetId,
      outputPath: asset?.originalPath ?? variant.outputPath,
      status: job?.status === 'completed' && job.outputAssetId
        ? 'ready'
        : job?.status === 'failed' || job?.status === 'blocked'
          ? 'failed'
          : job
            ? 'queued'
            : variant.status,
    }
  })
}
