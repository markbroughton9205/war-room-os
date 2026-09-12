/**
 * HuggingFace tokenizer.json ByteLevel BPE encode/decode for Nebula (Windows / Node 24).
 * Does not train, mutate merges, or add tokens. No Mac python3 runtime path.
 */
import fs from 'node:fs'

export type AddedToken = {
  id: number
  content: string
  special: boolean
}

export type LoadedWrTokenizer = {
  path: string
  version: string
  modelType: string
  unkToken: string
  unkId: number
  vocabSize: number
  vocab: Map<string, number>
  idToToken: string[]
  merges: Array<[string, string]>
  mergeRanks: Map<string, number>
  addedTokens: AddedToken[]
  specialByContent: Map<string, AddedToken>
  addPrefixSpace: boolean
  useRegex: boolean
  byteFallback: boolean
  fuseUnk: boolean
  normalizer: unknown
  preTokenizer: unknown
  decoder: unknown
  postProcessor: unknown
}

const GPT2_PRETOK =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu

function bytesToUnicode(): { encode: string[]; decode: Map<string, number> } {
  const bs: number[] = []
  for (let i = 33; i <= 126; i += 1) bs.push(i)
  for (let i = 161; i <= 172; i += 1) bs.push(i)
  for (let i = 174; i <= 255; i += 1) bs.push(i)
  const cs = bs.slice()
  let n = 0
  for (let b = 0; b < 256; b += 1) {
    if (!bs.includes(b)) {
      bs.push(b)
      cs.push(256 + n)
      n += 1
    }
  }
  const encode = new Array<string>(256)
  const decode = new Map<string, number>()
  for (let i = 0; i < bs.length; i += 1) {
    const ch = String.fromCharCode(cs[i]!)
    encode[bs[i]!] = ch
    decode.set(ch, bs[i]!)
  }
  return { encode, decode }
}

const BYTE_MAP = bytesToUnicode()

function pairKey(a: string, b: string): string {
  return `${a}\0${b}`
}

function getPairs(word: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < word.length - 1; i += 1) pairs.push([word[i]!, word[i + 1]!])
  return pairs
}

function applyBpe(token: string, mergeRanks: Map<string, number>, cache: Map<string, string[]>): string[] {
  const hit = cache.get(token)
  if (hit) return hit
  if (!token) {
    cache.set(token, [])
    return []
  }
  let word = Array.from(token)
  if (word.length === 1) {
    cache.set(token, word)
    return word
  }
  while (word.length > 1) {
    const pairs = getPairs(word)
    let bestRank = Infinity
    let best: [string, string] | null = null
    for (const [a, b] of pairs) {
      const rank = mergeRanks.get(pairKey(a, b))
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank
        best = [a, b]
      }
    }
    if (!best) break
    const [first, second] = best
    const next: string[] = []
    let i = 0
    while (i < word.length) {
      if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
        next.push(first + second)
        i += 2
      } else {
        next.push(word[i]!)
        i += 1
      }
    }
    word = next
  }
  cache.set(token, word)
  return word
}

function utf8ToByteChars(text: string): string {
  const buf = Buffer.from(text, 'utf8')
  let out = ''
  for (const byte of buf) out += BYTE_MAP.encode[byte]
  return out
}

function byteCharsToUtf8(text: string): string {
  const bytes: number[] = []
  for (const ch of text) {
    const b = BYTE_MAP.decode.get(ch)
    if (b === undefined) {
      const code = ch.charCodeAt(0)
      bytes.push(code > 255 ? 63 : code)
    } else {
      bytes.push(b)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

export function loadHfTokenizerJson(filePath: string): LoadedWrTokenizer {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    version?: string
    model?: {
      type?: string
      unk_token?: string
      vocab?: Record<string, number>
      merges?: Array<string | [string, string]>
      byte_fallback?: boolean
      fuse_unk?: boolean
    }
    added_tokens?: AddedToken[]
    normalizer?: unknown
    pre_tokenizer?: { type?: string; add_prefix_space?: boolean; use_regex?: boolean }
    decoder?: unknown
    post_processor?: unknown
  }
  const vocabObj = raw.model?.vocab ?? {}
  const vocab = new Map<string, number>()
  let maxId = -1
  for (const [tok, id] of Object.entries(vocabObj)) {
    vocab.set(tok, id)
    if (id > maxId) maxId = id
  }
  const addedTokens = (raw.added_tokens ?? []).map(t => ({
    id: t.id,
    content: t.content,
    special: Boolean(t.special),
  }))
  const specialByContent = new Map<string, AddedToken>()
  for (const tok of addedTokens) {
    specialByContent.set(tok.content, tok)
    if (!vocab.has(tok.content)) vocab.set(tok.content, tok.id)
    if (tok.id > maxId) maxId = tok.id
  }
  const idToToken = new Array<string>(maxId + 1).fill('')
  for (const [tok, id] of vocab.entries()) idToToken[id] = tok

  const merges: Array<[string, string]> = []
  const mergeRanks = new Map<string, number>()
  for (const merge of raw.model?.merges ?? []) {
    const pair: [string, string] = Array.isArray(merge)
      ? [String(merge[0]), String(merge[1])]
      : (String(merge).split(' ') as [string, string])
    mergeRanks.set(pairKey(pair[0], pair[1]), merges.length)
    merges.push(pair)
  }

  const unkToken = raw.model?.unk_token ?? '<|unk|>'
  const unkId = vocab.get(unkToken) ?? 3
  const pre = raw.pre_tokenizer ?? { type: 'ByteLevel', add_prefix_space: true, use_regex: true }

  return {
    path: filePath,
    version: String(raw.version ?? '1.0'),
    modelType: String(raw.model?.type ?? 'BPE'),
    unkToken,
    unkId,
    vocabSize: vocab.size,
    vocab,
    idToToken,
    merges,
    mergeRanks,
    addedTokens,
    specialByContent,
    addPrefixSpace: pre.add_prefix_space !== false,
    useRegex: pre.use_regex !== false,
    byteFallback: Boolean(raw.model?.byte_fallback),
    fuseUnk: Boolean(raw.model?.fuse_unk),
    normalizer: raw.normalizer ?? null,
    preTokenizer: raw.pre_tokenizer ?? null,
    decoder: raw.decoder ?? null,
    postProcessor: raw.post_processor ?? null,
  }
}

export type EncodeResult = {
  ids: number[]
  tokens: string[]
  unknownCount: number
}

const loadedCache = new Map<string, LoadedWrTokenizer>()
const bpeCaches = new Map<string, Map<string, string[]>>()

export function getLoadedTokenizer(filePath: string): LoadedWrTokenizer {
  const hit = loadedCache.get(filePath)
  if (hit) return hit
  const loaded = loadHfTokenizerJson(filePath)
  loadedCache.set(filePath, loaded)
  bpeCaches.set(filePath, new Map())
  return loaded
}

function splitSpecials(text: string, specials: AddedToken[]): string[] {
  if (!specials.length) return [text]
  const sorted = [...specials].sort((a, b) => b.content.length - a.content.length)
  const pattern = sorted.map(t => t.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (!pattern) return [text]
  return text.split(new RegExp(`(${pattern})`, 'g')).filter(part => part.length > 0)
}

function pretokPiece(piece: string, tok: LoadedWrTokenizer, cache: Map<string, string[]>): EncodeResult {
  const ids: number[] = []
  const tokens: string[] = []
  let unknownCount = 0
  const matches = tok.useRegex ? piece.match(GPT2_PRETOK) ?? (piece ? [piece] : []) : piece ? [piece] : []
  for (const m of matches) {
    const mapped = utf8ToByteChars(m)
    const parts = applyBpe(mapped, tok.mergeRanks, cache)
    for (const part of parts) {
      const id = tok.vocab.get(part)
      if (id === undefined) {
        ids.push(tok.unkId)
        tokens.push(tok.unkToken)
        unknownCount += 1
      } else {
        ids.push(id)
        tokens.push(part)
      }
    }
  }
  return { ids, tokens, unknownCount }
}

export function encodeText(text: string, filePath: string): EncodeResult {
  const tok = getLoadedTokenizer(filePath)
  const cache = bpeCaches.get(filePath) ?? new Map<string, string[]>()
  bpeCaches.set(filePath, cache)
  let source = text
  if (tok.addPrefixSpace && source.length > 0 && !source.startsWith(' ')) source = ` ${source}`
  const ids: number[] = []
  const tokens: string[] = []
  let unknownCount = 0
  for (const piece of splitSpecials(source, tok.addedTokens)) {
    const special = tok.specialByContent.get(piece)
    if (special) {
      ids.push(special.id)
      tokens.push(special.content)
      continue
    }
    const encoded = pretokPiece(piece, tok, cache)
    for (const id of encoded.ids) ids.push(id)
    for (const token of encoded.tokens) tokens.push(token)
    unknownCount += encoded.unknownCount
  }
  return { ids, tokens, unknownCount }
}

export function decodeIds(ids: number[], filePath: string, skipSpecials = false): string {
  const tok = getLoadedTokenizer(filePath)
  let joined = ''
  for (const id of ids) {
    const token = tok.idToToken[id] ?? tok.unkToken
    const special = tok.specialByContent.get(token)
    if (skipSpecials && special) continue
    joined += token
  }
  return byteCharsToUtf8(joined)
}

export function roundTripOk(text: string, filePath: string): boolean {
  const encoded = encodeText(text, filePath)
  const decoded = decodeIds(encoded.ids, filePath)
  const expected = text.length > 0 && !text.startsWith(' ') ? ` ${text}` : text
  return decoded === expected || decoded.trim() === text.trim()
}

export function byteAlphabetCoverage(filePath: string): { present: number; missing: number } {
  const tok = getLoadedTokenizer(filePath)
  let present = 0
  for (let b = 0; b < 256; b += 1) {
    if (tok.vocab.has(BYTE_MAP.encode[b]!)) present += 1
  }
  return { present, missing: 256 - present }
}
