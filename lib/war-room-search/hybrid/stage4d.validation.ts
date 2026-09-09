import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { attachLocalRetrievalSignals, formatSearchResult } from '../formatSearchResult'
import { collapseToClusterHeads } from '../rankResults'
import { buildSearchHandoffEvidencePacket } from '../councilHandoff'
import { SovereignCorpus } from '../crawler/corpus'
import {
  buildLegacyStrictMatch,
  LEXICAL_MAX_CONTENT_TOKENS,
  LEXICAL_STOP_WORDS,
  planLexicalQuery,
  quoteFtsToken,
} from '../crawler/lexicalPlan'
import { createFakeEmbedder, createUnavailableEmbedder } from './embedder'
import {
  evaluateLegacyStrictFts,
  evaluateRetrievalMode,
  mixedTopicCoverage,
  seedEvalCorpus,
} from './eval'
import { indexCorpusDocuments } from './indexCorpus'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { searchLocalHybrid } from './retrieve'
import { PRODUCTION_RETRIEVAL_PROFILE } from './retrievalProfile'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_REVISION } from './types'
import { SqliteVectorStore } from './vectors'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

function hybridSrc(): string {
  const dir = path.join(process.cwd(), 'lib', 'war-room-search', 'hybrid')
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.includes('.live-'))
    .map(name => readFileSync(path.join(dir, name), 'utf8'))
    .join('\n')
}

function crawlerPlannerSrc(): string {
  return readFileSync(path.join(process.cwd(), 'lib/war-room-search/crawler/lexicalPlan.ts'), 'utf8')
    + readFileSync(path.join(process.cwd(), 'lib/war-room-search/crawler/corpus.ts'), 'utf8')
}

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: overrides.source_id ?? 'war_room_local',
    source_type: overrides.source_type ?? 'search',
    source_label: overrides.source_label ?? 'reuters.com',
    verified_level: 'semi_verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: '2026-09-09T18:00:00.000Z',
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'recent',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'STORED_RESEARCH',
    ...overrides,
  }
}

function matchLooksSafe(match: string | null): boolean {
  if (!match) return true
  if (/^AND|OR|NEAR|\*|^\(|[^)"]\*/i.test(match) && !/"[^"]*"/.test(match)) return false
  const unquoted = match.replace(/"[^"]*"/g, ' ').replace(/\(|\)/g, ' ').trim()
  return !unquoted || /^(AND|OR)(\s+(AND|OR))*$/.test(unquoted)
}

export async function runStage4dValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4d-'))
  const corpus = new SovereignCorpus(tmp)
  const store = new SqliteVectorStore(path.join(tmp, 'vectors.sqlite'))
  const embedder = createFakeEmbedder()

  try {
    const docs = seedEvalCorpus(corpus)
    await indexCorpusDocuments({ corpus, store, embedder })

    const exact = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd01_existing_strict_exact_unchanged',
      exact.hits[0]?.document.canonicalUrl.includes('zxqplorbit') === true
        && exact.lexicalPlan.planUsed === 'STRICT'
        && exact.lexicalPlan.relaxationApplied === false,
      JSON.stringify({ top: exact.hits.map(hit => hit.document.canonicalUrl), plan: exact.lexicalPlan }),
    ))

    const reserved = await searchLocalHybrid('reserved DNS names', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd02_strict_used_when_sufficient',
      reserved.lexicalPlan.planUsed === 'STRICT'
        && reserved.lexicalPlan.relaxationApplied === false
        && reserved.lexicalHits >= 1
        && reserved.hits.some(hit => hit.document.canonicalUrl.includes('iana.org')),
      JSON.stringify({ plan: reserved.lexicalPlan, top: reserved.hits.map(hit => hit.document.canonicalUrl) }),
    ))

    const mixedFts = await searchLocalHybrid('reserved DNS names and LIV Golf', { corpus, store, embedder, retrievalMode: 'fts', limit: 8 })
    const mixedLegacy = corpus.searchFtsLegacyStrict('reserved DNS names and LIV Golf', 8)
    cases.push(check(
      'd03_relaxed_after_strict_miss',
      mixedLegacy.length === 0
        && mixedFts.lexicalPlan.planUsed === 'RELAXED'
        && mixedFts.lexicalPlan.relaxationApplied === true
        && mixedFts.lexicalPlan.strictCandidateCount === 0
        && mixedFts.lexicalHits >= 1,
      JSON.stringify({ legacy: mixedLegacy.length, plan: mixedFts.lexicalPlan, top: mixedFts.hits.map(hit => hit.document.canonicalUrl) }),
    ))

    const subset = await searchLocalHybrid('reserved domains', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd04_meaningful_subset_retrieved',
      subset.hits.some(hit => hit.document.canonicalUrl.includes('iana.org')) && subset.lexicalPlan.planUsed === 'STRICT',
      JSON.stringify({ top: subset.hits.map(hit => hit.document.canonicalUrl), plan: subset.lexicalPlan }),
    ))

    const mixedUrls = mixedFts.hits.map(hit => hit.document.canonicalUrl)
    const mixedCoverage = mixedTopicCoverage(mixedUrls, [
      'https://iana.org/domains/reserved',
      'https://dw.com/en/liv-golf-fixture',
    ])
    cases.push(check(
      'd05_mixed_topic_retrieves_both',
      mixedCoverage === 1
        && mixedUrls.some(url => url.includes('iana.org'))
        && mixedUrls.some(url => url.includes('dw.com')),
      JSON.stringify({ coverage: mixedCoverage, top: mixedUrls, plan: mixedFts.lexicalPlan }),
    ))

    const connector = await searchLocalHybrid('the controls and system', { corpus, store, embedder, retrievalMode: 'fts', limit: 8 })
    const connectorPlan = planLexicalQuery('the controls and system')
    cases.push(check(
      'd06_connectors_do_not_flood',
      connector.hits.length <= 1
        && connectorPlan.canRelax === false
        && connectorPlan.termsUsed.includes('controls')
        && connectorPlan.termsUsed.includes('system')
        && !connectorPlan.termsUsed.includes('the')
        && !connectorPlan.termsUsed.includes('and'),
      JSON.stringify({ hits: connector.hits.map(hit => hit.document.canonicalUrl), plan: connector.lexicalPlan, built: connectorPlan }),
    ))

    const phrase = await searchLocalHybrid('LIV Golf', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    const phraseBuilt = planLexicalQuery('LIV Golf')
    cases.push(check(
      'd07_phrase_entity_preserved',
      phrase.hits.some(hit => hit.document.canonicalUrl.includes('liv-golf'))
        && phraseBuilt.phrasesUsed.some(item => /liv golf/i.test(item)),
      JSON.stringify({ top: phrase.hits.map(hit => hit.document.canonicalUrl), phrases: phraseBuilt.phrasesUsed }),
    ))

    const punct = await searchLocalHybrid('reserved DNS names.', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd08_punctuation_safe',
      punct.hits.some(hit => hit.document.canonicalUrl.includes('iana.org')),
      JSON.stringify({ top: punct.hits.map(hit => hit.document.canonicalUrl), built: planLexicalQuery('reserved DNS names.') }),
    ))

    const malformedQuery = 'NEAR(penguin, census) OR * AND ("foo":bar) -minus'
    let malformedThrew = false
    let malformed = mixedFts
    try {
      malformed = await searchLocalHybrid(malformedQuery, { corpus, store, embedder, retrievalMode: 'fts', limit: 8 })
    } catch {
      malformedThrew = true
    }
    const malformedBuilt = planLexicalQuery(malformedQuery)
    cases.push(check(
      'd09_fts_operators_escaped',
      malformedThrew === false
        && matchLooksSafe(malformedBuilt.strictMatch)
        && matchLooksSafe(malformedBuilt.relaxedMatch)
        && !/\bNEAR\b/.test(malformedBuilt.strictMatch ?? '')
        && !(malformedBuilt.strictMatch ?? '').includes('*')
        && malformed.hits.length === 0,
      JSON.stringify({ threw: malformedThrew, built: malformedBuilt, hits: malformed.hits.length }),
    ))

    const longQuery = 'ZXQPLORBIT alpha bravo charlie delta echo foxtrot hotel india juliet kilo lima'
    const longBuilt = planLexicalQuery(longQuery)
    const longResult = await searchLocalHybrid(longQuery, { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd10_long_query_bounded',
      longBuilt.truncated === true
        && longBuilt.termsUsed.length === LEXICAL_MAX_CONTENT_TOKENS
        && longResult.lexicalPlan.truncated === true,
      JSON.stringify({ terms: longBuilt.termsUsed, truncated: longBuilt.truncated, match: longBuilt.strictMatch }),
    ))

    const penguinFts = await searchLocalHybrid('antarctic penguin census 1994', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'd11_no_hit_remains_no_hit',
      penguinFts.hits.length === 0 && penguinFts.lexicalPlan.planUsed === 'STRICT',
      JSON.stringify({ hits: penguinFts.hits.length, plan: penguinFts.lexicalPlan }),
    ))

    const penguin = await searchLocalHybrid('antarctic penguin census 1994', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5 })
    cases.push(check(
      'd12_stage4c_semantic_gate_unchanged',
      PRODUCTION_RETRIEVAL_PROFILE.profileVersion === 'wr-retrieval-v4c.1'
        && PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold === 0.61
        && PRODUCTION_RETRIEVAL_PROFILE.semanticAdmissionStrategy === 'min_cosine'
        && penguin.semanticAdmission.threshold === 0.61
        && penguin.semanticAdmission.profileVersion === 'wr-retrieval-v4c.1',
      JSON.stringify({ profile: PRODUCTION_RETRIEVAL_PROFILE, admission: penguin.semanticAdmission }),
    ))

    const paraphrase = await searchLocalHybrid('cash trouble for a gulf-backed breakaway golf circuit', {
      corpus, store, embedder, retrievalMode: 'semantic', limit: 5,
    })
    cases.push(check(
      'd13_liv_semantic_paraphrase_retained',
      paraphrase.hits[0]?.document.canonicalUrl.includes('liv-golf') === true
        && paraphrase.semanticAdmission.admitted === true
        && (paraphrase.semanticAdmission.candidateScore ?? 0) >= PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold,
      JSON.stringify({ top: paraphrase.hits.map(hit => hit.document.canonicalUrl), admission: paraphrase.semanticAdmission }),
    ))

    cases.push(check(
      'd14_penguin_abstains',
      penguin.hits.length === 0 && penguin.semanticAdmission.abstained === true && penguin.semanticAvailable === true,
      JSON.stringify({ hits: penguin.hits.length, admission: penguin.semanticAdmission }),
    ))

    const biology = await searchLocalHybrid('protein domains in eukaryotic genomes', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5 })
    cases.push(check(
      'd15_biology_hard_negative_abstains',
      biology.hits.length === 0 && biology.semanticAdmission.abstained === true && biology.lexicalHits === 0,
      JSON.stringify({ hits: biology.hits.map(hit => hit.document.canonicalUrl), admission: biology.semanticAdmission, plan: biology.lexicalPlan }),
    ))

    const mixedIds = mixedFts.hits.map(hit => hit.document.id)
    cases.push(check(
      'd16_strict_relaxed_duplicate_collapses',
      mixedIds.length === new Set(mixedIds).size && mixedFts.lexicalHits === mixedFts.hits.length,
      JSON.stringify({ ids: mixedIds, lexicalHits: mixedFts.lexicalHits }),
    ))

    const mixedHybrid = await searchLocalHybrid('reserved DNS names and LIV Golf', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 8 })
    const hybridIds = mixedHybrid.hits.map(hit => hit.document.id)
    const ianaHit = mixedHybrid.hits.find(hit => hit.document.canonicalUrl.includes('iana.org'))
    cases.push(check(
      'd17_lexical_semantic_same_document_collapses',
      hybridIds.length === new Set(hybridIds).size
        && (!ianaHit || !(ianaHit.lexicalRank != null && ianaHit.semanticRank != null) || mixedHybrid.hits.filter(hit => hit.document.canonicalUrl.includes('iana.org')).length === 1),
      JSON.stringify(mixedHybrid.hits.map(hit => ({
        url: hit.document.canonicalUrl,
        lex: hit.lexicalRank,
        sem: hit.semanticRank,
        fusion: hit.fusionScore,
      }))),
    ))

    const live = evidence({
      id: 'g-reuters',
      title: docs[0]!.title || 'Chip export controls widen',
      content: docs[0]!.contentText,
      url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=google',
      canonical_url: canonicalizeUrl('https://www.reuters.com/world/asia/chip-export-2026') || docs[0]!.canonicalUrl,
      source_id: 'google_web_search',
      source_label: 'reuters.com',
      origin_type: 'LIVE_WEB',
      discovered_via: 'GOOGLE',
    })
    const local = evidence({
      id: 'wr-reuters',
      title: docs[0]!.title || 'Chip export controls widen',
      content: docs[0]!.contentText,
      url: docs[0]!.originalUrl,
      canonical_url: docs[0]!.canonicalUrl,
      source_label: docs[0]!.publisher,
      discovered_via: 'WAR_ROOM_LOCAL',
      storage_origin: 'WAR_ROOM_CORPUS',
      content_hash: docs[0]!.contentHash,
    })
    const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(stampDiscoveryProvenance([live, local]), {
      region: null,
      queryLanguage: 'en',
      fallbackUsed: false,
      fallbackReason: null,
    }))
    const { heads } = collapseToClusterHeads(clustered.items)
    cases.push(check(
      'd18_build6_unchanged',
      heads.length === 1 && clustered.items.every(item => item.independence_key === heads[0]?.independence_key),
      JSON.stringify({ heads: heads.map(item => item.id), key: heads[0]?.independence_key, via: clustered.items.map(item => item.discovered_via) }),
    ))

    const mixedHandoff = buildSearchHandoffEvidencePacket({
      query: 'reserved DNS names and LIV Golf',
      results: attachLocalRetrievalSignals(
        mixedHybrid.hits.map(hit => formatSearchResult({
          item: evidence({
            id: `local-${hit.document.id}`,
            title: hit.document.title || hit.document.publisher,
            content: hit.snippet,
            url: hit.document.originalUrl,
            canonical_url: hit.document.canonicalUrl,
            source_label: hit.document.publisher,
            discovered_via: 'WAR_ROOM_LOCAL',
            storage_origin: 'WAR_ROOM_CORPUS',
          }),
          score: hit.fusionScore,
          rankBreakdown: { relevance: 0.1, authority: 0.2, freshness: 0.5, primary: 0, independence: 1, regional: 0, duplicatePenalty: 0 },
        })),
        mixedHybrid.hits.map(hit => ({
          canonicalUrl: hit.document.canonicalUrl,
          localRetrievalSignals: {
            lexicalRank: hit.lexicalRank,
            lexicalScore: hit.lexicalScore,
            semanticRank: hit.semanticRank,
            semanticScore: hit.semanticScore,
            fusionRank: hit.fusionRank,
            fusionScore: hit.fusionScore,
            matchedChunkId: hit.matchedChunkId,
            mode: mixedHybrid.retrievalMode,
          },
        })),
      ),
    })
    const mixedEvidence = mixedHandoff.intelligencePacket?.evidence ?? []
    cases.push(check(
      'd19_council_evidence_unchanged',
      mixedEvidence.every(item => item.source_label !== 'STRICT' && item.source_label !== 'RELAXED' && item.discovered_via === 'WAR_ROOM_LOCAL')
        && mixedEvidence.every(item => item.storage_origin === 'WAR_ROOM_CORPUS')
        && !JSON.stringify(mixedEvidence).includes('"publisher":"STRICT"'),
      JSON.stringify({ labels: mixedEvidence.map(item => item.source_label), via: mixedEvidence.map(item => item.discovered_via) }),
    ))

    cases.push(check(
      'd20_diagnostics_present',
      mixedFts.lexicalPlan.planUsed === 'RELAXED'
        && Array.isArray(mixedFts.lexicalPlan.termsUsed)
        && Array.isArray(mixedFts.lexicalPlan.phrasesUsed)
        && typeof mixedFts.lexicalPlan.strictCandidateCount === 'number'
        && typeof mixedFts.lexicalPlan.relaxedCandidateCount === 'number'
        && typeof mixedFts.lexicalPlan.relaxationApplied === 'boolean'
        && !JSON.stringify(mixedFts.lexicalPlan).includes('INSERT')
        && !JSON.stringify(mixedFts.lexicalPlan).includes('crawl_fts'),
      JSON.stringify(mixedFts.lexicalPlan),
    ))

    const retrieveSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/retrieve.ts'), 'utf8')
    const embedderSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/embedder.ts'), 'utf8')
    const src = `${hybridSrc()}\n${crawlerPlannerSrc()}`
    cases.push(check(
      'd21_no_model_download',
      !/allowDownload:\s*true/.test(retrieveSrc) && /Query-time model download is forbidden/.test(embedderSrc),
      'query path forbids download',
    ))
    cases.push(check(
      'd22_no_re_embedding',
      !/indexCorpusDocuments\(/.test(retrieveSrc),
      'retrieve does not re-embed',
    ))
    cases.push(check(
      'd23_no_crawl_authority_change',
      !/\b(crawlApprovedUrl|followLinks|maxDepth|recursiveCrawl|spider)\b/i.test(src),
      'planner does not change crawl authority',
    ))
    cases.push(check(
      'd24_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|periodic corpus refresh|automatic re-embed|automatic calibration)\b/i.test(src),
      'no Stage 5 scheduler',
    ))

    const stopList = [...LEXICAL_STOP_WORDS].sort().join(',')
    cases.push(check(
      'd25_stop_words_explicit',
      stopList === 'and,for,in,of,or,the,to' && quoteFtsToken('NEAR') === '' && buildLegacyStrictMatch('foo bar') === '"foo" AND "bar"',
      JSON.stringify({ stopList, near: quoteFtsToken('NEAR') }),
    ))

    const commonOnly = await searchLocalHybrid('the and of in to for', { corpus, store, embedder, retrievalMode: 'fts', limit: 8 })
    cases.push(check(
      'd26_common_word_only_empty',
      commonOnly.hits.length === 0 && commonOnly.lexicalPlan.planUsed === 'NONE',
      JSON.stringify({ plan: commonOnly.lexicalPlan, hits: commonOnly.hits.length }),
    ))

    const missingModel = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: createUnavailableEmbedder('SEMANTIC_UNAVAILABLE'), limit: 5 })
    cases.push(check(
      'd27_fts_fallback_keeps_plan',
      missingModel.usedFallback === 'fts' && missingModel.lexicalPlan.planUsed === 'STRICT' && missingModel.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify({ fallback: missingModel.usedFallback, plan: missingModel.lexicalPlan }),
    ))

    const legacyEval = await evaluateLegacyStrictFts({ corpus })
    const plannedEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'fts' })
    const semanticEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'semantic' })
    const hybridEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'hybrid' })
    const mixedLegacyRow = legacyEval.rows.find(row => row.id === 'mixed_topic')
    const mixedPlannedRow = plannedEval.rows.find(row => row.id === 'mixed_topic')
    cases.push(check(
      'd28_planned_beats_legacy_mixed_coverage',
      (legacyEval.metrics.mixedTopicCoverage ?? 0) < 1
        && (plannedEval.metrics.mixedTopicCoverage ?? 0) === 1
        && (mixedLegacyRow?.top.length ?? 0) === 0
        && (mixedPlannedRow?.top.length ?? 0) >= 2
        && plannedEval.rows.find(row => row.id === 'exact_lexical')?.rank === 1
        && hybridEval.rows.find(row => row.id === 'no_relevant')?.admitted === false,
      JSON.stringify({
        legacy: legacyEval.metrics,
        planned: plannedEval.metrics,
        semantic: semanticEval.metrics,
        hybrid: hybridEval.metrics,
        mixedLegacy: mixedLegacyRow,
        mixedPlanned: mixedPlannedRow,
      }),
    ))

    const health = inspectLocalSemanticHealth({ corpusRoot: tmp, queryResult: penguin })
    cases.push(check(
      'd29_health_available_while_abstaining',
      penguin.semanticAvailable === true && health.status !== 'error' && penguin.semanticAdmission.embeddingModel === LOCAL_EMBEDDING_MODEL_ID && penguin.semanticAdmission.embeddingRevision === LOCAL_EMBEDDING_REVISION && penguin.semanticAdmission.chunkingVersion === CHUNKING_VERSION,
      JSON.stringify({ status: health.status, admission: penguin.semanticAdmission }),
    ))
  } finally {
    store.close()
    corpus.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage4dValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4D validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
