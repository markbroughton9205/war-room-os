/** Public-domain / synthetic samples. No secrets, no private Commander data. */
export type DomainSample = { id: string; domain: string; text: string }

export const DOMAIN_SAMPLES: DomainSample[] = [
  {
    id: 'english_prose',
    domain: 'english',
    text: 'The Commander operates War Room as a bounded orchestration platform with explicit approval gates and restart-durable local ownership.',
  },
  {
    id: 'software_code',
    domain: 'code',
    text: 'export function evaluateContinuousEvidence(input: ContinuousEvidenceInput, now = new Date()) {\n  return input.source\n}\n',
  },
  {
    id: 'json_payload',
    domain: 'json',
    text: '{"datasetId":"w5ds_public_fixture","trainingStarted":false,"splits":{"train":5,"validation":2,"test":1}}',
  },
  {
    id: 'markdown',
    domain: 'markdown',
    text: '# WR-CORPUS\n\n- WR-CORPUS-0 is historical WRM-001\n- WR-CORPUS-1 is historical WR-CORPUS-1-HARDENED\n\nDo **not** train WRIM in this pass.',
  },
  {
    id: 'ai_terms',
    domain: 'ai',
    text: 'Byte-pair encoding, transformer embeddings, rotary positional encoding, RAG retrieval, council synthesis, and supervised fine-tuning remain distinct from production WRIM.',
  },
  {
    id: 'cyber',
    domain: 'cybersecurity',
    text: 'Red-team bounds deny credential capture, unsigned privilege escalation, and unauthorized access. Local Core remains loopback-only.',
  },
  {
    id: 'terra_geo',
    domain: 'terra',
    text: 'Latitude 43.6532 longitude -79.3832 bounding box 43.6,-79.4,43.7,-79.3 USGS earthquake GeoJSON feature collection.',
  },
  {
    id: 'maritime_ais',
    domain: 'maritime',
    text: 'MMSI 230994000 vessel Digitraffic marine traffic timestamp 2026-09-12T17:00:00Z course 187.4 speed 12.3 kn.',
  },
  {
    id: 'legal',
    domain: 'legal',
    text: 'Commander-owned private repository. No training may start without explicit Commander authorization. Production remains untouched.',
  },
  {
    id: 'finance',
    domain: 'finance',
    text: 'Nominal GDP growth 2.4 percent, CPI 3.1 percent, Treasury 10-year yield 4.12 percent. No payment routing numbers included.',
  },
  {
    id: 'science',
    domain: 'science',
    text: 'temporal provenance validUntil observationRef predictionRef verificationAt geospatial bounding box E=mc^2 delta-v 9.80665 m/s^2.',
  },
  {
    id: 'medical',
    domain: 'medical',
    text: 'In vitro kinase assay IC50 values are not clinical advice. CRISPR-Cas9 nomenclature remains research terminology only.',
  },
  {
    id: 'math',
    domain: 'mathematics',
    text: 'Let f(x) = sum_{n=0}^{N} a_n x^n. Then integral_0^1 f(x) dx = sum_{n=0}^{N} a_n / (n+1).',
  },
  {
    id: 'governance',
    domain: 'war-room',
    text: 'Commander Council Terra ASTRA agent mission evidence citation memory WR-CORPUS WR-TOKENIZER-0 WRIM-0 Rael denied.',
  },
  {
    id: 'urls',
    domain: 'url',
    text: 'https://warroomos.com/api/search?q=terra+coverage https://docs.github.com/en/rest',
  },
  {
    id: 'identifiers',
    domain: 'identifiers',
    text: 'uuid 550e8400-e29b-41d4-a716-446655440000 path C:\\\\Users\\\\Public\\\\war-room\\\\notes.md MMSI 366973000',
  },
  {
    id: 'proper_names',
    domain: 'names',
    text: 'War Room OS, Commander, Council, Terra, ASTRA, Nebula Genesis, WRIM-0, WR-TOKENIZER-0.',
  },
  {
    id: 'punctuation_numeric',
    domain: 'numeric',
    text: '317338 2048000 19217152 0.003 512 8 500 43.6532,-79.3832',
  },
]

export const MULTILINGUAL_SAMPLES: DomainSample[] = [
  { id: 'es', domain: 'spanish', text: 'El comandante opera la sala de guerra con puertas de aprobación explícitas.' },
  { id: 'fr', domain: 'french', text: 'Le commandant dirige la salle de guerre avec des autorisations explicites.' },
  { id: 'de', domain: 'german', text: 'Der Kommandant betreibt den Kriegsraum mit ausdrücklicher Genehmigung.' },
  { id: 'pt', domain: 'portuguese', text: 'O comandante opera a sala de guerra com autorizações explícitas.' },
  { id: 'zh', domain: 'mandarin', text: '指挥官通过明确授权门控来运行作战室系统。' },
  { id: 'ar', domain: 'arabic', text: 'يشغّل القائد غرفة الحرب وفق بوابات موافقة صريحة.' },
  { id: 'hi', domain: 'hindi', text: 'कमांडर स्पष्ट स्वीकृति द्वारों के साथ वॉर रूम चलाते हैं।' },
  { id: 'ru', domain: 'russian', text: 'Командующий управляет военной комнатой с явными вратами одобрения.' },
  { id: 'ja', domain: 'japanese', text: '指揮官は明示的な承認ゲートで作戦室を運用する。' },
]

export const CHAT_FORMAT_SAMPLES: DomainSample[] = [
  {
    id: 'chat_system',
    domain: 'chat',
    text: '<|system|>You are WRIM research lineage, not production intelligence.<|eos|>',
  },
  {
    id: 'chat_commander',
    domain: 'chat',
    text: '<|commander|>Summarize WR-CORPUS-0 without training.<|eos|>',
  },
  {
    id: 'chat_assistant',
    domain: 'chat',
    text: '<|assistant|>WR-CORPUS-0 is the canonical migrated WRM-001 lineage.<|eos|>',
  },
  {
    id: 'chat_council',
    domain: 'chat',
    text: '<|system|>Council synthesis:<|assistant|>Keep WR-TOKENIZER-0 frozen. Do not train.<|eos|>',
  },
  {
    id: 'chat_evidence',
    domain: 'chat',
    text: '<|evidence|>{"source":"WR-CORPUS-0","claim":"Alice record exists","sha256":"public-fixture"}<|eos|>',
  },
  {
    id: 'chat_tool',
    domain: 'tool',
    text: '<|tool|>{"name":"query_corpus","arguments":{"query":"Alice","corpus":"WR-CORPUS-0"}}<|eos|>',
  },
  {
    id: 'chat_tool_result',
    domain: 'tool',
    text: '<|tool|>result={"ok":true,"hits":1,"record_id":"wrm001-alice-public"}<|eos|>',
  },
]

export const FUTURE_WORLD_SAMPLES: DomainSample[] = [
  {
    id: 'live_research',
    domain: 'world-learning',
    text: 'Live internet research documents will include HTML boilerplate, citation URLs, timestamps, and mixed Markdown/JSON evidence packets.',
  },
  {
    id: 'terra_provider',
    domain: 'terra',
    text: 'OpenSky aircraft icao24 a1b2c3 lat 40.7128 lon -74.0060 baro_altitude 10668.0 on_ground false.',
  },
  {
    id: 'tech_docs',
    domain: 'docs',
    text: 'Node.js 24 accepts HuggingFace tokenizer.json. Windows runtime must not call /usr/bin/python3 or a Mac Developer path.',
  },
]
