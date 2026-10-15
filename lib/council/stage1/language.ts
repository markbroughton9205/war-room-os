/**
 * Natural-language understanding for Commander turns. Deterministic, no model call:
 * slang + misspelling normalisation, correction/follow-up/continuation detection,
 * reference resolution against the thread, question-vs-command separation.
 */
import type { DialogueAct, HistoryTurn, TurnReference, TurnUnderstanding } from './types'

const SLANG: Array<[RegExp, string]> = [
  [/\bwhat'?s\b/g, 'what is'],
  [/\bwhats\b/g, 'what is'],
  [/\bwhatz\b|\bwuts?\b|\bwut\b|\bwats\b/g, 'what is'],
  [/\bwat\b/g, 'what'],
  [/\bwha\b/g, 'what'],
  [/\bhow'?s\b/g, 'how is'],
  [/\bthat'?s\b/g, 'that is'],
  [/\bgonna\b/g, 'going to'],
  [/\bwanna\b/g, 'want to'],
  [/\bgotta\b/g, 'got to'],
  [/\bkinda\b/g, 'kind of'],
  [/\bimma\b/g, 'i am going to'],
  [/\by'?all\b/g, 'you all'],
  [/\bu\b/g, 'you'],
  [/\bur\b/g, 'your'],
  [/\bpls\b|\bplz\b/g, 'please'],
  [/\bthx\b|\bty\b/g, 'thanks'],
  [/\babt\b/g, 'about'],
  [/\brn\b/g, 'right now'],
  [/\bidk\b/g, 'i do not know'],
  [/\bimo\b/g, 'in my opinion'],
  [/\btho\b/g, 'though'],
  [/\bya\b/g, 'you'],
  [/\bcuz\b|\bcos\b/g, 'because'],
  [/\b'bout\b|\bbout\b/g, 'about'],
  [/\bdoin\b/g, 'doing'],
  [/\bwatcha\b/g, 'what are you'],
  [/\bwtf\b/g, 'what'],
  [/\bbtw\b/g, 'by the way'],
]

/** Domain vocabulary used for typo repair (edit distance). Canonical lower-case forms. */
const DOMAIN_WORDS = [
  'council', 'foundry', 'terra', 'research', 'purpose', 'mission', 'session', 'conversation',
  'architecture', 'studios', 'higher', 'vision', 'installed', 'capability', 'capabilities',
  'member', 'members', 'agent', 'agents', 'model', 'models', 'memory', 'remember', 'continue',
  'explain', 'current', 'status', 'running', 'engineering', 'conversation', 'orchestration',
]

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
    cur = []
  }
  return prev[b.length]
}

function repairWord(word: string): string | null {
  if (word.length < 5) return null
  if (DOMAIN_WORDS.includes(word)) return null
  // A typo almost never changes the first letter; one edit for ordinary words, two only for long ones.
  // (An unrestricted distance turned "boundary" into "foundry" and silently changed the Commander's meaning.)
  const max = word.length >= 10 ? 2 : 1
  let best: string | null = null
  let bestD = max + 1
  for (const cand of DOMAIN_WORDS) {
    if (cand[0] !== word[0]) continue
    const d = editDistance(word, cand, max)
    if (d < bestD) { bestD = d; best = cand }
  }
  return bestD <= max ? best : null
}

export function normalizeCommanderText(raw: string): { text: string; notes: string[] } {
  const notes: string[] = []
  let text = raw.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
  // glued product names
  text = text.replace(/\bwarroom\b/g, () => { notes.push('warroom -> war room'); return 'war room' })
  text = text.replace(/\bwar[ -]+(?:rom|romm|rooom|roomm|rm|rum|roon|rrom)\b/g, m => { notes.push(`${m} -> war room`); return 'war room' })
  text = text.replace(/\bhvs\b/g, () => { notes.push('hvs -> higher vision studios'); return 'higher vision studios' })
  for (const [re, rep] of SLANG) {
    text = text.replace(re, m => { if (m !== rep) notes.push(`${m} -> ${rep}`); return rep })
  }
  text = text.replace(/[a-z]+/g, w => {
    const fixed = repairWord(w)
    if (fixed && fixed !== w) { notes.push(`${w} -> ${fixed}`); return fixed }
    return w
  })
  return { text, notes: Array.from(new Set(notes)) }
}

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ['war room', /\bwar room\b/],
  ['divine rising council', /\b(divine rising council|council)\b/],
  ['foundry', /\bfoundry\b/],
  ['terra', /\bterra\b/],
  ['higher vision studios', /\bhigher vision studios\b/],
  ['research', /\bresearch\b/],
  ['memory', /\b(memory|remember)\b/],
  ['architecture', /\barchitecture\b/],
  ['sandbox', /\bsandbox(?:es|ed|ing)?\b/],
]
/** Topics that name a War Room subject on their own (a modifier like "sandbox" does not). */
const PRIMARY_TOPICS = new Set(['war room', 'divine rising council', 'foundry', 'terra', 'higher vision studios', 'research', 'memory', 'architecture'])

const CORRECTION_RE = [
  /^(no|nope|nah|wrong|not quite|incorrect)\b[\s,.!:;-]*/,
  /\b(that'?s|that is|thats) (not|wrong|incorrect)\b/,
  /\bnot what i (meant|said|asked)\b/,
  /\bi (meant|mean|said|was asking)\b/,
  /\bno,? i (meant|mean)\b/,
  /\bactually[, ]/,
  /\bscratch that\b|\bforget that\b|\bnever ?mind that\b/,
  /\bnot (the )?(that|this) one\b/,
]
const CONTINUATION_RE = [
  /\b(continue|resume|pick up|carry on|keep going)\b.*\b(where|from|left|stopped|off|earlier|last)\b/,
  /^(continue|keep going|carry on|go on|resume)\b/,
  /\bwhere (we|i) (left|stopped|were)\b/,
]
const QUESTION_START_RE = /^(what|why|how|when|where|who|which|whose|is|are|do|does|did|can|could|would|should|will|am|was|were|tell me|explain|describe|define)\b/
const COMMAND_VERB_RE = /^(please |now |go ahead and |just )?(build|run|start|launch|execute|deploy|install|create|make|fix|delete|remove|stop|cancel|kill|restart|push|commit|merge|write|generate|implement|set up|setup|promote|pull|download|send|email|schedule|apply|patch|refactor|rename)\b/
const FOLLOW_STARTER_RE = /^(why|how so|and|but|so|what about|how about|really|then|also|meaning|which one|more|elaborate|go on)\b/
/** Only these bare phrasings are recovered deterministically; anything with more content passes through. */
export const BARE_CONTINUATION_RE = /^(please )?(continue|resume|pick up|carry on|keep going)( (where|from where) (we|i) (left off|stopped|were|left)| from (earlier|last time))?[\s.!?]*$/i
const SOCIAL_RE = /^(hi+|hello|hey+|yo+|sup|good (morning|afternoon|evening)|thanks|thank you|thanks a lot|cool|nice|ok(ay)?|got it|gm)\b[\s!.?]*$/
/** Leading filler that carries no meaning ("yo", "ok so", "hey"); stripped only for act detection. */
const FILLER_RE = /^(?:(?:yo+|hey+|hi+|hello|ok(?:ay)?|so|well|um+|uh+|hmm+|bro|dude|man|alright|like|also|and)[\s,!.:;-]+)+/
/** The Commander asks what Council said earlier in this conversation. */
const RECALL_RE = /\b(?:what (?:did|have|had|were) (?:you|we|aurora|orion|lumen|pulsar|nova|phoenix)(?: all)? (?:say|said|tell|told|mention|mentioned|answer|answered|discuss|discussed|cover|covered|suggest|suggested)(?:\b.*\b(?:before|earlier|previously|so far|about (?:it|that|this|them))|\b)|what (?:was|were) (?:you|they) (?:saying|talking)(?:\b.*\b(?:before|earlier|about))?|(?:remind me|recap)\b.*\b(?:earlier|before|previously|you said|we said|in this (?:conversation|session|thread))|repeat (?:that|what you said)|say (?:that|it) again|(?:earlier|before|previously|last time)(?: you| they)? (?:said|told|mentioned)|what (?:was|were) (?:the|your) (?:last|previous|earlier) (?:answer|reply|response))\b/
const REFERENCE_RE = /\b(the other one|the other|that one|this one|those|these|that|it|them|the same|same thing|the first one|the second one|the last one|former|latter)\b/

function topicsIn(text: string): string[] {
  const out: string[] = []
  for (const [name, re] of TOPIC_PATTERNS) if (re.test(text)) out.push(name)
  return out
}

function lastWhere<T>(arr: T[], pred: (t: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i]
  return undefined
}

/** Items a member message enumerated ("Foundry and Terra", "1. x 2. y"). Used for "the other one". */
function enumeratedOptions(text: string): string[] {
  const found: string[] = []
  const t = text.toLowerCase()
  for (const [name, re] of TOPIC_PATTERNS) if (re.test(t)) found.push(name)
  return found.filter(x => x !== 'war room')
}

/** Topics of the most recent Commander turn that named one: the subject the thread is about. */
function threadTopics(history: HistoryTurn[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.role !== 'commander') continue
    const t = topicsIn(normalizeCommanderText(h.text).text)
    if (t.some(x => PRIMARY_TOPICS.has(x) && x !== 'war room')) return t.filter(x => x !== 'war room' || t.length === 1)
  }
  return []
}

function resolveReferences(norm: string, history: HistoryTurn[]): TurnReference[] {
  const refs: TurnReference[] = []
  const m = norm.match(REFERENCE_RE)
  if (!m) return refs
  const phrase = m[0]
  const prevCommander = lastWhere(history, h => h.role === 'commander')
  const prevMember = lastWhere(history, h => h.role === 'member')
  if (/the other( one)?/.test(phrase)) {
    const options = prevMember ? enumeratedOptions(prevMember.text) : []
    const discussed = prevCommander ? topicsIn(normalizeCommanderText(prevCommander.text).text) : []
    const alt = options.filter(o => !discussed.includes(o))
    if (options.length >= 2 && alt.length >= 1) {
      refs.push({ phrase, resolvedTo: alt[0], basis: 'previous_member_options' })
      return refs
    }
    // Fall back: the other of the last two distinct topics seen in the thread.
    const seen: string[] = []
    for (const h of [...history].reverse()) {
      for (const t of topicsIn(normalizeCommanderText(h.text).text)) if (!seen.includes(t) && t !== 'war room') seen.push(t)
      if (seen.length >= 2) break
    }
    refs.push({ phrase, resolvedTo: seen.length >= 2 ? seen[1] : null, basis: seen.length >= 2 ? 'previous_commander_topic' : 'none' })
    return refs
  }
  const cmdTopics = prevCommander ? topicsIn(normalizeCommanderText(prevCommander.text).text).filter(t => t !== 'war room' && PRIMARY_TOPICS.has(t)) : []
  if (cmdTopics.length) {
    refs.push({ phrase, resolvedTo: cmdTopics[0], basis: 'previous_commander_topic' })
    return refs
  }
  // The latest Commander turn named no subject (a correction, a bare follow-up): the thread's subject still holds.
  const threadSubject = threadTopics(history).filter(t => t !== 'war room' && PRIMARY_TOPICS.has(t))
  if (threadSubject.length) {
    refs.push({ phrase, resolvedTo: threadSubject[0], basis: 'previous_commander_topic' })
    return refs
  }
  const memTopics = prevMember ? topicsIn(normalizeCommanderText(prevMember.text).text).filter(t => t !== 'war room') : []
  refs.push({ phrase, resolvedTo: memTopics[0] ?? null, basis: memTopics.length ? 'previous_member_topic' : 'none' })
  return refs
}

export function understandTurn(input: { text: string; history?: HistoryTurn[] }): TurnUnderstanding {
  const history = input.history ?? []
  const { text: norm, notes } = normalizeCommanderText(input.text)
  const words = norm.split(' ').filter(Boolean)
  const isCorrection = CORRECTION_RE.some(r => r.test(norm))
  const continuation = CONTINUATION_RE.some(r => r.test(norm))
  const bareContinuation = BARE_CONTINUATION_RE.test(norm) || /^(continue|resume|pick up|carry on|keep going) where (we|i) (left off|stopped|were|left)[\s.!?]*$/.test(norm)
  const correctionRemainder = norm.replace(/^(no|nope|nah|wrong|not quite|incorrect)\b[\s,.!:;-]*/, '')
  const correctionCarriesCommand = isCorrection && COMMAND_VERB_RE.test(correctionRemainder)
  const hasQuestionMark = /\?\s*$/.test(input.text.trim())
  const stripped = norm.replace(FILLER_RE, '')
  const core = stripped.length >= 3 ? stripped : norm
  const questionLike = hasQuestionMark || QUESTION_START_RE.test(core)
  const commandLike = COMMAND_VERB_RE.test(core) && !hasQuestionMark
  const recall = RECALL_RE.test(norm) && history.length > 0 && !COMMAND_VERB_RE.test(core)
  const hasRef = REFERENCE_RE.test(norm)
  const ownTopics = topicsIn(norm)
  const shortTurn = words.length <= 6

  let act: DialogueAct
  if (SOCIAL_RE.test(norm)) act = 'social'
  else if (correctionCarriesCommand) act = 'command'
  else if (isCorrection) act = 'correction'
  else if (continuation && bareContinuation) act = 'continuation'
  else if (commandLike) act = 'command'
  else if (recall && !commandLike) act = 'question'
  else if (shortTurn && !ownTopics.some(t => PRIMARY_TOPICS.has(t)) && (hasRef || FOLLOW_STARTER_RE.test(norm) || words.length <= 2)) act = 'follow_up'
  else if (questionLike) act = 'question'
  else if (shortTurn && history.length > 0 && !ownTopics.some(t => PRIMARY_TOPICS.has(t))) act = 'follow_up'
  else act = 'statement'

  const references = hasRef && history.length ? resolveReferences(norm, history) : []

  let correction: TurnUnderstanding['correction'] = null
  if (act === 'correction' || correctionCarriesCommand) {
    const prevCommander = lastWhere(history, h => h.role === 'commander')
    const rep = norm.match(/.*\b(?:i meant|i mean|i said|i was asking(?: about)?|actually)\b[\s,:]*(.+)$/)
    correction = {
      supersedes: prevCommander ? prevCommander.text : null,
      replacement: rep ? rep[1].trim() || null : null,
    }
  }

  let topics = ownTopics
  // A correction refines the subject the thread is already on; it only replaces it when it names another subject itself.
  if (act === 'correction' && !ownTopics.some(t => PRIMARY_TOPICS.has(t))) {
    const subject = threadTopics(history)
    if (subject.length) topics = Array.from(new Set([...subject, ...ownTopics]))
  }
  // A short turn that only names a modifier ("and the sandbox part?") stays on the thread's subject.
  if ((act === 'follow_up' || (act === 'question' && hasRef)) && shortTurn && !ownTopics.some(t => PRIMARY_TOPICS.has(t)) && history.length && !references.some(r => r.resolvedTo)) {
    const subject = threadTopics(history)
    if (subject.length) topics = Array.from(new Set([...subject, ...ownTopics]))
  }
  if (!topics.length) {
    const resolved = references.map(r => r.resolvedTo).filter((x): x is string => Boolean(x))
    if (resolved.length) topics = resolved
    else if (act === 'follow_up' || act === 'continuation' || (act === 'correction' && !correction?.replacement)) {
      const prev = lastWhere(history, h => h.role === 'commander')
      if (prev) topics = topicsIn(normalizeCommanderText(prev.text).text)
    }
  }

  const executionRequested = act === 'command'
  let clarification: string | null = null
  if (executionRequested && ownTopics.length === 0 && !references.some(r => r.resolvedTo)) {
    if (!/\b(file|repo|branch|mission|build|test|session|conversation|install)\b/.test(norm) || words.length <= 2) {
      clarification = 'What should I run that on? Name the target (mission, repository, or session) and I will proceed.'
    }
  }
  if (act === 'follow_up' && !topics.length && !references.length) {
    clarification = 'I do not have a prior topic in this session to attach that to. What are you referring to?'
  }
  if (references.length && references.every(r => !r.resolvedTo) && history.length) {
    clarification = `I could not tell what "${references[0].phrase}" refers to. Which one do you mean?`
  }

  return {
    raw: input.text,
    normalized: norm,
    act,
    executionRequested,
    topics,
    references,
    correction,
    continuation: bareContinuation,
    recall,
    clarification,
    normalizationNotes: notes,
  }
}
