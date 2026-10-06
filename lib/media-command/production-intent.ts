/**
 * Client-safe prompt parsing. No filesystem, no project mutation.
 */
import type { OutputAspect } from './types'
import type { HvsProductionIntent, HvsProductionStyleId } from './production-ai-types'

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function parseProductionIntent(input: {
  projectId: string
  prompt: string
  sourceAssetIds?: string[]
  now?: string
}): HvsProductionIntent {
  const prompt = input.prompt.trim()
  const lower = prompt.toLowerCase()
  const durationMatch = lower.match(/(\d+)\s*(?:-)?\s*seconds?/)
  const durationSec = durationMatch
    ? Number(durationMatch[1])
    : /short/.test(lower)
      ? 15
      : /promo|trailer/.test(lower)
        ? 30
        : 15

  let aspect: OutputAspect | null = null
  if (/vertical|tiktok|shorts|9\s*[:x]\s*16|reel|phone/.test(lower)) aspect = '9:16'
  else if (/square|1\s*[:x]\s*1/.test(lower)) aspect = '1:1'
  else if (/landscape|16\s*[:x]\s*9|youtube/.test(lower)) aspect = '16:9'

  let style: HvsProductionStyleId | null = null
  if (/cinematic/.test(lower)) style = 'CINEMATIC'
  else if (/energetic|powerful|hype/.test(lower)) style = 'ENERGETIC'
  else if (/documentary/.test(lower)) style = 'DOCUMENTARY'
  else if (/luxury/.test(lower)) style = 'LUXURY'
  else if (/warm/.test(lower)) style = 'WARM'
  else if (/cool|colder/.test(lower)) style = 'COOL'
  else if (/bright/.test(lower)) style = 'BRIGHT'
  else if (/dark/.test(lower)) style = 'DARK'
  else if (/dramatic/.test(lower)) style = 'DRAMATIC'
  else if (/social|tiktok|shorts|instagram/.test(lower)) style = 'SOCIAL'
  else if (/clean|natural/.test(lower)) style = 'CLEAN'

  let goal: HvsProductionIntent['goal'] = 'SHORT_FROM_CLIPS'
  if (/promo/.test(lower)) goal = 'PROMO'
  else if (/trailer/.test(lower)) goal = 'TRAILER'
  else if (/clean up|cleanup/.test(lower) && /short|promo|trailer/.test(lower) === false) goal = 'CLEANUP'
  else if (/version|tiktok|shorts|instagram/.test(lower)) goal = 'SOCIAL_VARIANT'

  let platform: string | null = null
  if (/tiktok/.test(lower)) platform = 'tiktok'
  else if (/shorts/.test(lower)) platform = 'youtube-shorts'
  else if (/instagram/.test(lower)) platform = 'instagram'
  else if (/youtube/.test(lower)) platform = 'youtube'

  const constraints: string[] = []
  if (/best moments|strongest|usable shots/.test(lower)) constraints.push('prefer-strong-moments')
  if (/dead|weak|silence/.test(lower)) constraints.push('remove-dead-space')
  if (/three versions|versions for|tiktok and|vertical and square|square version too|youtube shorts/.test(lower)) {
    constraints.push('social-variants')
  }

  return {
    id: nid('intent'),
    projectId: input.projectId,
    prompt,
    sourceAssetIds: input.sourceAssetIds ?? [],
    goal,
    durationSec: Number.isFinite(durationSec) ? durationSec : 15,
    aspect,
    style,
    tone: /powerful|dramatic/.test(lower) ? 'powerful' : /warm/.test(lower) ? 'warm' : null,
    platform,
    captions: /caption|subtitle/.test(lower),
    music: /music louder/.test(lower) ? 'louder' : /no music/.test(lower) ? 'none' : 'keep',
    voice: /voice clearer|clean (the )?dialogue|clean (the )?voice/.test(lower) ? 'clearer' : 'keep',
    constraints,
    createdAt: input.now ?? new Date().toISOString(),
  }
}

export type HvsUnderstandingCard = {
  id: string
  label: string
  value: string
}

/** Honest prompt parse for the Create-with-AI understanding panel. Does not invent facts. */
export function parseCreateUnderstanding(prompt: string): HvsUnderstandingCard[] {
  const text = prompt.trim()
  if (!text) return []
  const lower = text.toLowerCase()
  const cards: HvsUnderstandingCard[] = []

  const durationMatch = lower.match(/(\d+)\s*(?:-)?\s*seconds?/)
  let kind = ''
  if (/commercial|\bad\b/.test(lower)) kind = 'commercial'
  else if (/trailer/.test(lower)) kind = 'trailer'
  else if (/movie sequence|movie scene|\bshow\b/.test(lower)) kind = 'movie sequence'
  else if (/action scene/.test(lower)) kind = 'action scene'
  else if (/\bscene\b/.test(lower)) kind = 'scene'
  else if (/\bvideo\b/.test(lower)) kind = 'video'
  else if (/\bspot\b/.test(lower)) kind = 'spot'
  if (kind) {
    cards.push({
      id: 'type',
      label: 'TYPE',
      value: kind.replace(/\b[a-z]/g, char => char.toUpperCase()),
    })
  }
  const cast: string[] = []
  if (/ra'?el/.test(lower)) cast.push("Ra'el")
  if (/fictional/.test(lower)) cast.push('Fictional actors')
  if (/\bcrowd\b|background (actors|people|population)/.test(lower)) cast.push('Crowd')
  if (cast.length) cards.push({ id: 'cast', label: 'CAST', value: cast.join(' · ') })

  const setting: string[] = []
  if (/night/.test(lower)) setting.push('Night')
  if (/downtown/.test(lower)) setting.push('Downtown')
  else if (/\bcity\b/.test(lower)) setting.push('City')
  if (/alley/.test(lower)) setting.push('Alley')
  if (/restaurant/.test(lower)) setting.push('Restaurant')
  if (/train station/.test(lower)) setting.push('Train station')
  if (setting.length) cards.push({ id: 'setting', label: 'SETTING', value: setting.join(' · ') })

  if (durationMatch) {
    cards.push({
      id: 'length',
      label: 'LENGTH',
      value: `${durationMatch[1]} seconds`,
    })
  }

  let style = ''
  if (/cinematic/.test(lower)) style = 'Cinematic'
  else if (/luxury/.test(lower)) style = 'Luxury'
  else if (/funny/.test(lower)) style = 'Funny'
  else if (/dramatic/.test(lower)) style = 'Dramatic'
  else if (/tense|tension/.test(lower)) style = 'Tense'
  if (style) cards.push({ id: 'style', label: 'STYLE', value: style })

  if (/vertical|tiktok|9\s*[:x]\s*16/.test(lower)) {
    cards.push({ id: 'format', label: 'FORMAT', value: 'Vertical' })
  } else if (/widescreen|16\s*[:x]\s*9|landscape/.test(lower)) {
    cards.push({ id: 'format', label: 'FORMAT', value: 'Widescreen' })
  }

  const mm = Array.from(lower.matchAll(/(\d{2,3})\s*mm/g)).map(match => `${match[1]}mm`)
  const cameraBits: string[] = [...mm]
  if (/\bwide\b|establishing/.test(lower)) cameraBits.push('wide')
  if (/close-?up/.test(lower)) cameraBits.push('close-up')
  if (kind || durationMatch || cameraBits.length) {
    cards.push({
      id: 'camera',
      label: 'CAMERA',
      value: cameraBits.length ? [...new Set(cameraBits)].join(' · ') : 'Director planned',
    })
  }

  const sound: string[] = []
  if (/ambience|ambient/.test(lower)) sound.push('Ambience')
  if (/engine/.test(lower)) sound.push('Engine')
  if (/\bscore\b|\bmusic\b/.test(lower)) sound.push('Score')
  if (/\bsound\b/.test(lower) && !sound.length) sound.push('Planned')
  if (sound.length) cards.push({ id: 'sound', label: 'SOUND', value: sound.join(' · ') })

  if (/caption|subtitle/.test(lower)) {
    cards.push({ id: 'captions', label: 'CAPTIONS', value: 'Yes, if words exist' })
  }

  return cards
}
