import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('.war-room/planetary-intelligence/registry.sqlite', { readOnly: true })
const all = (sql, params = []) => db.prepare(sql).all(...params)
const get = (sql, params = []) => db.prepare(sql).get(...params)

console.log('COUNTS', get(`
  SELECT
    (SELECT count(*) FROM sources) sources,
    (SELECT count(*) FROM endpoints) endpoints,
    (SELECT count(*) FROM documents) documents,
    (SELECT count(*) FROM endpoints WHERE activation_state = 'LIVE') live
`))

console.log('JA_OFFICIAL_INFRA', all(`
  SELECT d.title, d.detected_language, d.topic, d.source_class, d.published_at, s.canonical_name, s.source_type, s.canonical_domain
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE d.detected_language = 'ja' AND d.topic = 'INFRASTRUCTURE' AND d.source_class = 'OFFICIAL_RECORD'
  LIMIT 12
`))

console.log('NEXCO_SOURCES', all(`
  SELECT canonical_name, source_type, canonical_domain, gap_priority
  FROM sources
  WHERE canonical_domain LIKE '%nexco%' OR canonical_name LIKE '%NEXCO%'
`))

console.log('NEXCO_EPS', all(`
  SELECT e.url, e.activation_state, e.endpoint_type
  FROM endpoints e JOIN sources s ON s.source_id = e.source_id
  WHERE s.canonical_domain LIKE '%nexco%'
`))

console.log('NEXCO_DOCS', all(`
  SELECT title, detected_language, topic, source_class, published_at
  FROM documents
  WHERE source_id IN (SELECT source_id FROM sources WHERE canonical_domain LIKE '%nexco%')
  LIMIT 8
`))

console.log('ID_INTERSECT', all(`
  SELECT d.title, d.detected_language, d.topic, d.source_class, s.canonical_name
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE s.region = 'SOUTHEAST_ASIA' AND d.detected_language = 'id' AND d.source_class = 'JOURNALISM' AND d.topic = 'INFRASTRUCTURE'
  LIMIT 15
`))

console.log('ID_FEED_TOPICS', all(`
  SELECT s.canonical_name, d.topic, d.detected_language, count(*) c
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE s.canonical_domain LIKE '%antara%' OR s.canonical_domain LIKE '%tempo%' OR s.canonical_domain LIKE '%cnbcindonesia%'
  GROUP BY s.canonical_name, d.topic, d.detected_language
`))

console.log('ID_SAMPLE_TITLES', all(`
  SELECT s.canonical_name, d.title, d.topic, d.detected_language, d.published_at
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE s.canonical_domain LIKE '%antara%' OR s.canonical_domain LIKE '%tempo%' OR s.canonical_domain LIKE '%cnbcindonesia%'
  ORDER BY d.retrieved_at DESC
  LIMIT 25
`))

console.log('LANG_COUNTS', all(`SELECT detected_language, count(*) c FROM documents GROUP BY detected_language ORDER BY c DESC`))

console.log('SW_COMMUNITY', all(`
  SELECT d.title, d.detected_language, d.topic, d.source_class, s.canonical_name
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE s.source_type = 'COMMUNITY_SOURCE' OR s.canonical_name LIKE '%Red Cross%' OR s.canonical_name LIKE '%Makueni%'
     OR s.canonical_name LIKE '%CCBRT%' OR s.canonical_name LIKE '%Sikika%' OR s.canonical_name LIKE '%LVCT%' OR s.canonical_name LIKE '%MDH%'
  LIMIT 20
`))

console.log('DE_ENERGY_TRADE', all(`
  SELECT s.canonical_name, d.title, d.detected_language, d.topic, d.source_class
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE d.detected_language = 'de' AND d.topic = 'ENERGY' AND d.source_class = 'TRADE_SOURCE'
  LIMIT 12
`))

console.log('ES_SCIENCE', all(`
  SELECT s.canonical_name, d.title, d.detected_language, d.topic, d.source_class
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE d.detected_language = 'es' AND d.topic = 'SCIENCE' AND d.source_class = 'SCIENTIFIC_SOURCE'
  LIMIT 12
`))

console.log('OCEANIA_ALERT', all(`
  SELECT s.canonical_name, d.title, d.detected_language, d.topic, d.source_class, d.published_at
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE d.topic = 'WEATHER' AND d.source_class = 'ALERT_FEED'
    AND (s.canonical_domain LIKE '%bom.gov%' OR s.canonical_domain LIKE '%metservice%')
  LIMIT 12
`))

console.log('AR_PRIMARY', all(`
  SELECT d.title, d.detected_language, d.topic, d.source_class, s.canonical_name, d.published_at
  FROM documents d JOIN sources s ON s.source_id = d.source_id
  WHERE d.source_class = 'PRIMARY_PUBLIC_SIGNAL'
  LIMIT 12
`))

console.log('WAVE4_SOURCES', all(`
  SELECT canonical_name, source_type, canonical_domain, primary_language, gap_priority
  FROM sources
  WHERE gap_priority IN ('ja-infra','sw-health','id-infra','ar-safety','de-energy','es-science','oceania-weather')
     OR canonical_domain LIKE '%nexco%'
     OR canonical_domain LIKE '%solarserver%'
     OR canonical_domain LIKE '%cnbcindonesia%'
     OR canonical_domain LIKE '%redcross%'
     OR canonical_domain LIKE '%ccbrt%'
     OR canonical_domain LIKE '%sikika%'
     OR canonical_domain LIKE '%lvct%'
     OR canonical_domain LIKE '%mdh.or%'
     OR canonical_domain LIKE '%ncm.gov%'
     OR canonical_domain LIKE '%cdd.gov%'
     OR canonical_domain LIKE '%met.gov.kw%'
     OR canonical_name LIKE '%Civil Defence%'
`))

console.log('AR_NEW_EPS', all(`
  SELECT s.canonical_name, e.url, e.activation_state, e.http_status
  FROM endpoints e JOIN sources s ON s.source_id = e.source_id
  WHERE s.gap_priority = 'ar-safety' OR s.canonical_name LIKE '%Civil Defence%' OR s.canonical_name LIKE '%NCM%'
     OR s.canonical_name LIKE '%Kuwait%' OR s.canonical_name LIKE '%NCEMA%' OR s.canonical_name LIKE '%Jordan%'
`))

console.log('SW_NEW_EPS', all(`
  SELECT s.canonical_name, e.url, e.activation_state, e.http_status
  FROM endpoints e JOIN sources s ON s.source_id = e.source_id
  WHERE s.gap_priority = 'sw-health' OR s.canonical_name LIKE '%Red Cross%' OR s.canonical_name LIKE '%CCBRT%'
     OR s.canonical_name LIKE '%Sikika%' OR s.canonical_name LIKE '%LVCT%' OR s.canonical_name LIKE '%MDH%'
`))
