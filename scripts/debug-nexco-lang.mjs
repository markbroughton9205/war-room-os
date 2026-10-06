import { detectDocumentLanguage } from '../lib/planetary-intelligence/languageTruth.ts'
import { classifyFromLawfulMetadata } from '../lib/planetary-intelligence/observedTopic.ts'
import { qualifyObservedDocument } from '../lib/planetary-intelligence/observedCoverage.ts'

const title = '常磐自動車道 高架橋耐震補強工事'
console.log('lang', detectDocumentLanguage(title))
console.log('topic', classifyFromLawfulMetadata({ title, summary: '高速道路トンネル点検' }))
console.log('mlit', detectDocumentLanguage('道路橋梁の整備について'))
