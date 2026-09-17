import { PLANETARY_TOPICS, type PlanetaryTopic } from './types'

const TOPIC_MARKERS: Array<{ topic: PlanetaryTopic; pattern: RegExp }> = [
  { topic: 'WEATHER', pattern: /\b(weather|storm|flood|hurricane|typhoon|earthquake|cyclone|severe weather|heatwave|gale|tsunami|fire weather|marine wind warning|wind warning|sheep graziers|heavy rain|rain watch|weather warning|weather watch)\b|天気|台風|警報|注意報|cuaca|hali ya hewa|طقس|إنذار جوي|Wetterwarnung|मौसम/i },
  { topic: 'HEALTH', pattern: /\b(health|hospital|measles|outbreak|vaccine|who\b|public health|clinic)\b|健康|医療|afya|hospitali|chanjo|magonjwa|wahudumu wa afya|صحة|Gesundheit|स्वास्थ्य|टीका/i },
  { topic: 'ENERGY', pattern: /\b(energy|oil|gas|grid|power outage|electric|energiewende|renewable|solar|wind power|strom|photovoltaik|windkraft|windenergie|batterie|megawatt|kilowatt|wärmepumpe|umspann|erneuerbare)\b|エネルギー|電力|energi|listrik|طاقة|Energie|Stromnetz|ऊर्जा|सौर/i },
  { topic: 'INFRASTRUCTURE', pattern: /\b(infrastructure|bridge|dam|construction|utility|public works|rail|railway|port|ports|road|roads|highway|airport|telecom infrastructure|water infrastructure|power infrastructure|jembatan|tol|pelabuhan|bandara|bendungan|kereta|stasiun|flyover|underpass)\b|インフラ|工事|道路|橋梁|港湾|鉄道|空港|ダム|下水道|自動車道|高架橋|トンネル|耐震|高速道路|点検|infrastruktur|jalan tol|بنية تحتية|Infrastruktur|अवसंरचना|पुल|सड़क/i },
  { topic: 'TRANSPORT', pattern: /\b(transport|shipping|traffic delay|commute)\b|交通|遅延|運休|نقل|Verkehr/i },
  { topic: 'SCIENCE', pattern: /\b(science|research|arxiv|study|climate|científico|científic|investigaci[oó]n|investigaciones|scielo|paper|journal|revistas)\b|科学|研究|ciencia|wissenschaft|विज्ञान|علم|investigación|científico|científica/i },
  { topic: 'ECONOMICS', pattern: /\b(econom|market|inflation|trade|gdp|fiscal|monetary|employment|industry output|sensex|nifty)\b|経済|ekonomi|اقتصاد|Wirtschaft|अर्थव्यवस्था|महंगाई|मुद्रास्फीति|रोजगार|बाजार|वित्त|शेयर|जीडीपी/i },
  { topic: 'PUBLIC_SAFETY', pattern: /\b(police|crime|attack|mutiny|election|safety|emergency|civil defence|civil defense|hazard bulletin|warning)\b|防災|警察|keselamatan|أمن|طوارئ|دفاع مدني|إنذار|تحذير|Sicherheit|सुरक्षा/i },
  { topic: 'TELECOMMUNICATIONS', pattern: /\b(telecom|broadband|5g|outage|network)\b/i },
  { topic: 'CYBER', pattern: /\b(cyber|ransomware|hack|malware)\b/i },
  { topic: 'TECHNOLOGY', pattern: /\b(technology|ai\b|semiconductor|software)\b/i },
  { topic: 'CONFLICT', pattern: /\b(war|conflict|strike|gaza|military)\b/i },
  { topic: 'LOCAL_GOVERNANCE', pattern: /\b(mayor|municipal|council|governance|parliament)\b/i },
  { topic: 'ENVIRONMENT', pattern: /\b(environment|emissions|pollution|wildlife)\b/i },
  { topic: 'BREAKING_EVENTS', pattern: /\b(breaking|urgent|live updates)\b/i },
]

export function inferObservedTopic(title: string, text: string): PlanetaryTopic | null {
  const blob = `${title}\n${text}`
  const hit = TOPIC_MARKERS.find(entry => entry.pattern.test(blob))
  return hit?.topic ?? null
}

export function isPlanetaryTopic(value: string | null | undefined): value is PlanetaryTopic {
  return Boolean(value && (PLANETARY_TOPICS as readonly string[]).includes(value))
}

/** Document topic is observed from title/text. Gap keys like ja-infra are source specialties, not document topics. */
export function resolveObservedTopic(title: string, stored: string | null | undefined, originalText = ''): PlanetaryTopic | null {
  return inferObservedTopic(title, originalText) ?? (isPlanetaryTopic(stored) ? stored : null)
}

export function classifyFromLawfulMetadata(input: {
  title: string
  summary?: string | null
  categories?: string[]
  ogDescription?: string | null
  transientExcerpt?: string | null
}): { topic: PlanetaryTopic | null; source: 'title' | 'rss_summary' | 'category' | 'og_description' | 'transient_excerpt' | 'none' } {
  const titleHit = inferObservedTopic(input.title, '')
  if (titleHit) return { topic: titleHit, source: 'title' }
  const summaryHit = inferObservedTopic(input.title, input.summary ?? '')
  if (summaryHit) return { topic: summaryHit, source: 'rss_summary' }
  const categoryBlob = (input.categories ?? []).join(' ')
  const categoryHit = inferObservedTopic(categoryBlob, categoryBlob)
  if (categoryHit) return { topic: categoryHit, source: 'category' }
  const ogHit = inferObservedTopic(input.title, input.ogDescription ?? '')
  if (ogHit) return { topic: ogHit, source: 'og_description' }
  const excerptHit = inferObservedTopic(input.title, input.transientExcerpt ?? '')
  if (excerptHit) return { topic: excerptHit, source: 'transient_excerpt' }
  return { topic: null, source: 'none' }
}
