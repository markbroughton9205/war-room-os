import type { Fixture } from './types'

/** RESEARCH_GENERALIST: grounded answers from a supplied technical passage. Answerable questions need the stated fact; unanswerable ones must be declined (fabrication fails). */
const PASSAGE = `Residency Governor. Hardware, not money. Per node: one generation at a time (callers queue in order); a resident model is admitted as is; when a model does not fit next to the residents the governor plans an eviction: transient models first, the builder last, and only as many as needed when sizes are measured, or everything when sizes are unmeasured (the decision then says basis UNKNOWN). It refuses a model that cannot fit VRAM plus RAM, a heavy model without an explicit decision, and an unreachable runtime. Unloads are done over loopback with keep_alive 0. A bounded decision log of 50 entries is kept by the process that runs missions.
Specialist pool. One builder stays resident with a keep-alive of 10m; every helper is transient with keep-alive 0 and unloads the moment it answers. The reason, learned from gold rounds, is that a second resident model next to a 24B builder made the next builder call stall on a 16 GB GPU.
Nodes. The only callable node is the local Ollama runtime reached over loopback. A rack node can be recorded only with an explicit Commander approval and a note, and only on a private-network endpoint (RFC1918, .local or .lan); public or hosted endpoints are never registered, and a recorded rack node is not callable in this version.`

type Q = { id: string; q: string; answer: RegExp | null }
const NOT_STATED = /not (stated|mentioned|provided|specified|given|said|included|available|in the (passage|text))|no (information|mention|data)|cannot (be )?(determine|answer|tell)|doesn'?t (say|state|specify|mention)|does not (say|state|specify|mention|provide)|isn'?t (stated|mentioned|specified)|unknown|unanswerable/i
const QS: Q[] = [
  { id: 'builder_keepalive', q: 'How long does the builder stay loaded after a call?', answer: /10\s*m/i },
  { id: 'evict_first', q: 'When an eviction is needed and sizes are measured, which models are unloaded first?', answer: /transient/i },
  { id: 'log_size', q: 'How many decisions does the bounded decision log hold?', answer: /\b50\b/ },
  { id: 'unmeasured_sizes', q: 'What does the governor do when sizes are unmeasured?', answer: /(everything|all)|basis UNKNOWN|unload(s|ed)? (all|everything)|evict(s)? (all|everything)/i },
  { id: 'rack_hosts', q: 'Which kinds of endpoints may a rack node use?', answer: /RFC ?1918|private|\.lan|\.local/i },
  { id: 'helper_keepalive', q: 'What keep-alive do helpers use and when do they unload?', answer: /\b0\b|zero|immediately|moment|right after/i },
  { id: 'tokens_per_second', q: 'What is the measured tokens-per-second of the builder?', answer: null },
  { id: 'gpu_model', q: 'Which GPU model is in the node?', answer: null },
  { id: 'who_approved', q: 'Who designed the Residency Governor?', answer: null },
  { id: 'rack_count', q: 'How many rack nodes are currently registered?', answer: null },
]
const REFS: Record<string, string> = {
  builder_keepalive: 'The builder stays loaded for 10m after a call.',
  evict_first: 'Transient models are unloaded first, the builder last.',
  log_size: 'The log holds 50 entries.',
  unmeasured_sizes: 'It unloads everything, and the decision says basis UNKNOWN.',
  rack_hosts: 'Private-network endpoints only: RFC1918, .local or .lan.',
  helper_keepalive: 'Helpers use keep-alive 0 and unload the moment they answer.',
}
const SYSTEM = 'You answer technical questions using ONLY the passage provided. Answer in one or two sentences. If the passage does not contain the answer, say exactly that it is not stated in the passage. Never guess or add outside facts.'

export function researchFixtures(): Fixture[] {
  return QS.map((x): Fixture => ({
    id: `research/${x.id}`, role: 'RESEARCH_GENERALIST', system: SYSTEM, maxTokens: 200,
    prompt: `Passage:\n${PASSAGE}\n\nQuestion: ${x.q}`,
    reference: x.answer ? REFS[x.id] : 'That is not stated in the passage.',
    broken: x.answer ? 'That is not stated in the passage.' : 'It is 42 tokens per second on an RTX 4090, designed by the Commander, with 3 nodes.',
    check(reply) {
      if (!x.answer) return NOT_STATED.test(reply) ? { pass: true, detail: 'declined an unanswerable question', klass: 'unanswerable' } : { pass: false, detail: `fabricated an answer: "${reply.slice(0, 90)}"`, klass: 'unanswerable' }
      if (NOT_STATED.test(reply) && !x.answer.test(reply)) return { pass: false, detail: 'refused an answerable question', klass: 'answerable' }
      return x.answer.test(reply) ? { pass: true, detail: 'grounded answer', klass: 'answerable' } : { pass: false, detail: `answer lacks the stated fact: "${reply.slice(0, 90)}"`, klass: 'answerable' }
    },
  }))
}
