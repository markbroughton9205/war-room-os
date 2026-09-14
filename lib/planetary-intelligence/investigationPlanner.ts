import { googleNewsLocaleForRegion } from '@/lib/research/sourceTerritories'
import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import { isClosedFormKnowledgeQuestion, isSimpleFastPathPrompt } from '@/lib/council/scout-swarm/eligibility'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { FIRST_PASS_DISCOVERY_SEATS, SEAT_ROLES } from './identity'
import type {
  InvestigationPlan,
  InvestigationTask,
  PlanetaryGeography,
  PlanetaryProtocolRound,
  PlanetaryTopic,
  QueryComplexity,
  SourceClass,
} from './types'

const BROAD_PLANETARY = /\b((?:on\s+)?(?:my\s+|the\s+)?planet|on\s+(?:my\s+|the\s+)?earth|breaking news|what happened today|today on (?:my |the )?(?:planet|earth)|worldwide breaking)\b/i
const NARROW_HOURS = /\b(what time|hours|close[sd]?|open(?:ing)? hours|phone number|address of)\b/i

const GEO_LANES: Array<{ geo: PlanetaryGeography; languages: string[]; scoutRegion?: GeographicRegion }> = [
  { geo: 'WEST_AFRICA', languages: ['fr', 'en', 'ha'], scoutRegion: 'AFRICA' },
  { geo: 'EAST_AFRICA', languages: ['sw', 'en', 'am'], scoutRegion: 'AFRICA' },
  { geo: 'LATIN_AMERICA', languages: ['es', 'pt'], scoutRegion: 'LATIN_AMERICA' },
  { geo: 'EAST_ASIA', languages: ['ja', 'zh', 'ko'], scoutRegion: 'EAST_ASIA' },
  { geo: 'SOUTHEAST_ASIA', languages: ['id', 'vi', 'th', 'en'] },
  { geo: 'EUROPE', languages: ['de', 'fr', 'en'], scoutRegion: 'EUROPE' },
  { geo: 'MIDDLE_EAST', languages: ['ar', 'en'], scoutRegion: 'MIDDLE_EAST' },
  { geo: 'SOUTH_ASIA', languages: ['hi', 'bn', 'en'], scoutRegion: 'SOUTH_ASIA' },
  { geo: 'NORTH_AMERICA', languages: ['en', 'es'], scoutRegion: 'NORTH_AMERICA' },
  { geo: 'OCEANIA', languages: ['en'], scoutRegion: 'OCEANIA' },
]

const PULSAR_TOPICS: PlanetaryTopic[] = ['BREAKING_EVENTS', 'LOCAL_GOVERNANCE', 'PUBLIC_SAFETY', 'CONFLICT']
const ORION_TOPICS: PlanetaryTopic[] = ['INFRASTRUCTURE', 'ENERGY', 'TRANSPORT', 'TELECOMMUNICATIONS', 'CYBER', 'TECHNOLOGY']
const NOVA_TOPICS: PlanetaryTopic[] = ['SCIENCE', 'ECONOMICS', 'HEALTH', 'ENVIRONMENT']

function taskId(missionId: string, seat: string, index: number): string {
  return `task-${seat.toLowerCase()}-${String(index + 1).padStart(2, '0')}-${missionId.slice(-8)}`
}

export function classifyQueryComplexity(text: string): QueryComplexity {
  const raw = text.trim()
  const classified = classifyCouncilTurn(raw)
  if (isSimpleFastPathPrompt(raw, classified) || isClosedFormKnowledgeQuestion(raw) || NARROW_HOURS.test(raw)) {
    return 'NARROW_FACTUAL'
  }
  if (BROAD_PLANETARY.test(raw)) return 'BROAD_PLANETARY'
  if (/\bbreaking news\b/i.test(raw) && /\b(today|tonight|this morning|right now)\b/i.test(raw)) return 'BROAD_PLANETARY'
  if (classified.depth === 'FULL' && (classified.shouldResearch || classified.intent === 'RESEARCH_REQUEST' || classified.intent === 'STRATEGIC_ANALYSIS')) {
    return 'SCOPED_RESEARCH'
  }
  return 'SCOPED_RESEARCH'
}

export function shouldBypassDivergentProtocol(text: string): boolean {
  return classifyQueryComplexity(text) === 'NARROW_FACTUAL'
}

export function shouldRunDivergentPlanetaryProtocol(text: string): boolean {
  return classifyQueryComplexity(text) === 'BROAD_PLANETARY'
}

function nativeQuery(topic: PlanetaryTopic, geo: PlanetaryGeography, language: string, timeRange: string): string {
  const topicLabel = topic.replace(/_/g, ' ').toLowerCase()
  const geoLabel = geo.replace(/_/g, ' ').toLowerCase()
  if (language === 'es') return `noticias de última hora ${topicLabel} en ${geoLabel} ${timeRange}`
  if (language === 'pt') return `notícias urgentes ${topicLabel} na ${geoLabel} ${timeRange}`
  if (language === 'fr') return `actualités urgentes ${topicLabel} en ${geoLabel} ${timeRange}`
  if (language === 'ar') return `${topicLabel} ${geoLabel} ${timeRange}`
  if (language === 'ja') return `${geoLabel} の ${topicLabel} 速報 ${timeRange}`
  if (language === 'de') return `aktuelle meldungen ${topicLabel} ${geoLabel} ${timeRange}`
  if (language === 'hi') return `${geoLabel} ${topicLabel} ताज़ा ख़बर ${timeRange}`
  if (language === 'sw') return `habari za haraka ${topicLabel} ${geoLabel} ${timeRange}`
  if (language === 'id') return `berita terbaru ${topicLabel} di ${geoLabel} ${timeRange}`
  return `${topicLabel} breaking local reporting ${geoLabel} ${timeRange}`
}

function pulsarQuery(geo: PlanetaryGeography, language: string): string {
  const geoLabel = geo.replace(/_/g, ' ').toLowerCase()
  const locale = geo === 'EAST_ASIA' || geo === 'EUROPE' || geo === 'LATIN_AMERICA' || geo === 'AFRICA' || geo === 'MIDDLE_EAST' || geo === 'SOUTH_ASIA' || geo === 'NORTH_AMERICA' || geo === 'OCEANIA'
    ? googleNewsLocaleForRegion(geo as GeographicRegion)
    : null
  const lang = language
  if (lang === 'fr') return `reportages locaux et signaux faibles aujourd'hui ${geoLabel} journalisme régional RSS`
  if (lang === 'es') return `reportes locales emergentes hoy ${geoLabel} periodismo regional RSS`
  if (lang === 'pt') return `reportagens locais emergentes hoje ${geoLabel} jornalismo regional RSS`
  if (lang === 'ar') return `تقارير محلية عاجلة اليوم ${geoLabel}`
  if (lang === 'ja') return `${geoLabel} 地域報道 速報 今日 ローカルジャーナリズム`
  return `breaking local and regional reporting today ${geoLabel} emerging stories under-covered RSS live feeds${locale ? ` query_language=${locale.queryLanguage}` : ''}`
}

function orionQuery(topic: PlanetaryTopic, geo: PlanetaryGeography): string {
  const topicLabel = topic.replace(/_/g, ' ').toLowerCase()
  const geoLabel = geo.replace(/_/g, ' ').toLowerCase()
  return `${topicLabel} incident reports standards outages operational consequences ${geoLabel} today technical documentation`
}

function novaQuery(topic: PlanetaryTopic, geo: PlanetaryGeography, language: string): string {
  const topicLabel = topic.replace(/_/g, ' ').toLowerCase()
  const geoLabel = geo.replace(/_/g, ' ').toLowerCase()
  if (language === 'es' || language === 'pt') {
    return `${language === 'pt' ? 'ciência economia pesquisa acadêmica' : 'ciencia economía investigación académica'} ${geoLabel} hoy fuentes especializadas`
  }
  return `science economics academic research under-covered ${topicLabel} ${geoLabel} specialist publications ${language}`
}

export function planInvestigation(input: {
  commanderIntent: string
  missionId: string
  nowIso?: string
}): InvestigationPlan {
  const createdAt = input.nowIso ?? new Date().toISOString()
  const complexity = classifyQueryComplexity(input.commanderIntent)
  if (complexity === 'NARROW_FACTUAL') {
    return {
      missionId: input.missionId,
      commanderIntent: input.commanderIntent,
      complexity,
      createdAt,
      protocol: 'NARROW_BYPASS',
      tasks: [],
      skippedRounds: PLANETARY_ROUNDS_AFTER_INTENT,
      executedRounds: ['ROUND_0_COMMANDER_INTENT'],
      notes: ['Narrow factual request bypasses divergent collection. Do not spin PULSAR/ORION/NOVA/PHOENIX/LUMEN/AURORA unless complexity requires them.'],
    }
  }

  const timeRange = 'today'
  const tasks: InvestigationTask[] = []

  const pulsarGeos = GEO_LANES.slice(0, 6)
  pulsarGeos.forEach((lane, index) => {
    const language = lane.languages[0]!
    tasks.push({
      taskId: taskId(input.missionId, 'PULSAR', index),
      missionId: input.missionId,
      seat: 'PULSAR',
      timeRange,
      geographicScope: lane.geo,
      topic: PULSAR_TOPICS[index % PULSAR_TOPICS.length]!,
      languages: lane.languages,
      sourceTypes: ['JOURNALISM', 'COMMUNITY_SOURCE', 'ALERT_FEED', 'PRIMARY_PUBLIC_SIGNAL'],
      evidenceTypes: ['LOCAL_REPORTING', 'REGIONAL_REPORTING', 'ALERT'],
      noveltyObjective: 'MAXIMIZE_DISCOVERY',
      verificationDepth: 'NONE',
      searchBudget: 6,
      priority: 10 - index,
      query: pulsarQuery(lane.geo, language),
      queryLanguage: language,
      preferredProviders: ['public_news_rss', 'tavily', 'searxng'],
    })
  })

  ORION_TOPICS.slice(0, 4).forEach((topic, index) => {
    const lane = GEO_LANES[(index + 2) % GEO_LANES.length]!
    tasks.push({
      taskId: taskId(input.missionId, 'ORION', index),
      missionId: input.missionId,
      seat: 'ORION',
      timeRange,
      geographicScope: lane.geo,
      topic,
      languages: ['en', ...lane.languages.slice(0, 1)],
      sourceTypes: ['TRADE_SOURCE', 'OFFICIAL_RECORD', 'GOVERNMENT'],
      evidenceTypes: ['TECHNICAL_DOCUMENT', 'PRIMARY_EVIDENCE', 'DATASET'],
      noveltyObjective: 'SYSTEMS_CONSEQUENCE',
      verificationDepth: 'LIGHT',
      searchBudget: 5,
      priority: 8 - index,
      query: orionQuery(topic, lane.geo),
      queryLanguage: 'en',
      preferredProviders: ['federal_register', 'arxiv', 'tavily'],
    })
  })

  const novaLanes = [GEO_LANES[1]!, GEO_LANES[2]!, GEO_LANES[3]!, GEO_LANES[4]!]
  novaLanes.forEach((lane, index) => {
    const topic = NOVA_TOPICS[index % NOVA_TOPICS.length]!
    const language = lane.languages[0]!
    tasks.push({
      taskId: taskId(input.missionId, 'NOVA', index),
      missionId: input.missionId,
      seat: 'NOVA',
      timeRange,
      geographicScope: lane.geo,
      topic,
      languages: lane.languages,
      sourceTypes: ['SCIENTIFIC_SOURCE', 'ACADEMIC_SOURCE', 'JOURNALISM'],
      evidenceTypes: ['RESEARCH_PAPER', 'LOCAL_REPORTING', 'DATASET'],
      noveltyObjective: 'LONG_TAIL',
      verificationDepth: 'LIGHT',
      searchBudget: 5,
      priority: 7 - index,
      query: novaQuery(topic, lane.geo, language),
      queryLanguage: language,
      preferredProviders: ['arxiv', 'jstage', 'eclac_cepalstat', 'tavily'],
    })
  })

  if (complexity !== 'BROAD_PLANETARY') {
    const keepSeats = new Set(['PULSAR', 'ORION', 'NOVA'])
    const scoped = tasks.filter(task => keepSeats.has(task.seat)).slice(0, 6)
    return {
      missionId: input.missionId,
      commanderIntent: input.commanderIntent,
      complexity,
      createdAt,
      protocol: 'DIVERGENT_BROAD',
      tasks: scoped,
      skippedRounds: [],
      executedRounds: ['ROUND_0_COMMANDER_INTENT', 'ROUND_1_INVESTIGATION_PLAN'],
      notes: [
        'Scoped research still partitions TIME × GEOGRAPHY × TOPIC × LANGUAGE × SOURCE CLASS × EVIDENCE CLASS.',
        `AURORA first-pass retrieval is ${SEAT_ROLES.AURORA.firstPassRetrieval}.`,
        `First-pass seats: ${FIRST_PASS_DISCOVERY_SEATS.join(', ')}.`,
      ],
    }
  }

  return {
    missionId: input.missionId,
    commanderIntent: input.commanderIntent,
    complexity,
    createdAt,
    protocol: 'DIVERGENT_BROAD',
    tasks,
    skippedRounds: [],
    executedRounds: ['ROUND_0_COMMANDER_INTENT', 'ROUND_1_INVESTIGATION_PLAN'],
    notes: [
      'Broad query decomposed across TIME × GEOGRAPHY × TOPIC × LANGUAGE × SOURCE CLASS × EVIDENCE CLASS.',
      'Tasks are not six rewordings of "what happened today".',
      `PULSAR discovery languages: ${[...new Set(tasks.filter(task => task.seat === 'PULSAR').flatMap(task => task.languages))].join(', ')}.`,
    ],
  }
}

const PLANETARY_ROUNDS_AFTER_INTENT: PlanetaryProtocolRound[] = [
  'ROUND_1_INVESTIGATION_PLAN',
  'ROUND_2_BLIND_DIVERGENT_COLLECTION',
  'ROUND_3_CPU_DEDUP_ORIGIN_COVERAGE',
  'ROUND_4_CONDITIONAL_GAP_FILL',
  'ROUND_5_PHOENIX_ADVERSARIAL',
  'ROUND_6_LUMEN_VERIFICATION',
  'ROUND_7_EVIDENCE_ORIGIN_FUSION',
  'ROUND_8_AURORA_SYNTHESIS',
]

export function tasksArePartitioned(tasks: InvestigationTask[]): boolean {
  if (tasks.length < 2) return false
  const signatures = tasks.map(task => `${task.seat}|${task.geographicScope}|${task.topic}|${task.queryLanguage}|${task.sourceTypes.join(',')}|${task.query}`)
  return new Set(signatures).size === signatures.length
}

export function tasksAreNotRewordings(tasks: InvestigationTask[], commanderIntent: string): boolean {
  const base = commanderIntent.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  return tasks.every(task => {
    const tokens = task.query.toLowerCase().split(/\s+/)
    const overlap = tokens.filter(token => base.includes(token)).length
    return overlap / Math.max(tokens.length, 1) < 0.72
  })
}

export function sourceClassFor(_class: SourceClass): SourceClass {
  return _class
}

export { nativeQuery }
