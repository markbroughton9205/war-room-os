import type { InvestigationTask, RetrievedDocument } from './types'
import { languageTruthFor } from './languageTruth'
import { classifySourceGeography } from './sourceGeography'
import { inferObservedTopic } from './observedTopic'

export function applyEvidenceTruth(doc: RetrievedDocument, task: InvestigationTask): RetrievedDocument {
  const requested = task.requestedLanguage || task.languages[0] || task.queryLanguage || 'und'
  const lang = languageTruthFor({
    requestedLanguage: requested,
    query: doc.query || task.query,
    originalText: `${doc.title}\n${doc.originalText}`,
    translatedText: doc.translatedText,
  })
  const geo = classifySourceGeography({
    url: doc.url,
    title: doc.title,
    outlet: doc.outlet,
    taskGeography: task.geographicScope,
  })
  const observedTopic = doc.observedTopic ?? inferObservedTopic(doc.title, doc.originalText)
  const observedGeo = geo.sourceCoverageGeography ?? geo.eventGeography
  return {
    ...doc,
    requestedLanguage: requested,
    queryLanguage: lang.queryLanguage,
    detectedLanguage: lang.detectedDocumentLanguage,
    detectedLanguageConfidence: lang.detectedLanguageConfidence,
    evidenceLanguageMatch: lang.evidenceLanguageMatch,
    queryLanguageClass: lang.queryClass,
    taskGeography: task.geographicScope,
    eventGeography: geo.eventGeography,
    sourceHeadquartersGeography: geo.sourceHeadquartersGeography,
    sourceCoverageGeography: geo.sourceCoverageGeography,
    datelineGeography: geo.datelineGeography,
    localityClass: geo.localityClass,
    sourceGeographyMatch: geo.sourceGeographyMatch,
    observedTopic,
    geography: observedGeo,
    topic: observedTopic,
  }
}
