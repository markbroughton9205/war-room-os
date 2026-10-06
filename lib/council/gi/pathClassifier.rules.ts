import type { IntentClass, MissionClassHint, PathClassifierResult, ReasoningBudget, RiskClass, ToolNeed } from './types'

export type PathRuleHit = {
  id: string
  path: PathClassifierResult['path']
  mission_class: MissionClassHint
  intent_class: IntentClass
  confidence: number
  risk_class: RiskClass
  tools_needed_est: 0 | 1 | 'many'
  tool_need: ToolNeed
  handoff_target?: PathClassifierResult['handoff_target']
  seats_recommended: string[]
}

const GREETING =
  /^\s*(hi+|hello|hey+|yo+|sup|howdy|what'?s\s+up|whats\s+up|good\s+(morning|afternoon|evening))([\s,!?.]*)((council|team|everyone|everybody|all)([\s,!?.]*))?\s*$/i

const FOLLOW_UP_SHORT =
  /^(why\??|how\??|and then\??|what about .{1,80}|do that|do it|tell me more|are you sure\??|check this out|what happened\??|why did you say that\??|compare it to the other one|would .{1,80} be affected\??|what would that break\??)$/i

const SENTENCE_FIX =
  /\bfix this (sentence|paragraph|message|wording|tone|email|phrasing)\b/i

const AMBIGUOUS_RESEARCH =
  /^(?:please\s+)?research\??$/i

const LOOK_IT_UP =
  /^(?:please\s+)?look it up\??$/i

const META_PRIOR_FAILURE =
  /\b(why did (?:that|the last|this) .{0,80} fail|why did that fail|what went wrong with (?:that|the last)|why did (?:the )?last research fail)\b/i

const SIMPLE_DEFINITION =
  /^(what(?:'s|s|\s+is)|what's|define|explain|tell me about|what's the difference)\s+(?!status\b|(?:the\s+)?war\s*room\b).{1,200}$/i

const CONCEPT_COMPARE =
  /\b(difference between|compare|versus|vs\.?)\b/i

const CODING_EXPLAIN =
  /\b(what does (?:this|the) function do|explain (?:this|the) (?:function|code|snippet)|how does this (?:function|code) work)\b/i

const REWRITE =
  /\b(rewrite|rephrase|edit|tighten|proofread|shorten|more concise|make this (?:clearer|shorter|better|sound professional)|sound professional)\b/i

const BRAINSTORM =
  /\b(what do you think|brainstorm|ideas for|rough thoughts|riff on|smartest move next|what should we do next|that makes sense)\b/i

const ARITHMETIC =
  /(?:what(?:'s|s|\s+is)\s+)?\d+\s*(?:plus|\+|minus|-|times|x|×|\*|divided\s+by|\/)\s*\d+/i

const SYSTEM_STATUS =
  /(?:status\s+(?:on|of|for)\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status|system\s+health|status\s+summary\s+of\s+(?:the\s+)?war\s*room)/i

const LIVE_RESOURCE =
  /\b(how much ram|cpu|memory).{0,40}\b(war room|right now|currently|using)\b|\b(war room|runtime).{0,40}\b(how much ram|using right now)\b/i

const INCIDENT =
  /\b(outage|incident|just broke|is down|degraded|on fire|p[0-9]\s*incident|sev[0-9]|rollback|failed health|not responding|my browser just broke|screenshots crash|chromium crash|browser.{0,24}crash)\b/i

const DEEP_RESEARCH =
  /\b(deep research|primary sources?|current (?:primary )?sources?|with sources|cite (?:sources|primary)|official docs?)\b|\binvestigate\b.{0,80}\b(sources?|current|live)\b|^(?:please\s+)?research\b.{8,}/i

const CURRENT_FACT =
  /\b(current version of|latest version of|what's the current|what is the current)\b/i

const ARCHITECTURE_REVIEW =
  /\b(architecture review|system design review|interface contract|module boundary review)\b/i

const FOUNDRY_MUTATE =
  /\b(fix (?:this )?(?:war room |divine council )?(?:bug|function)|fix .{0,60} in (?:the )?(?:repo|war room)|fix the .{0,80} bug|implement .{0,60} in (?:the )?repo|change .{0,80} in (?:the )?(?:war room )?repo|update .{0,80} in (?:the )?(?:war room )?repo|build (?:me |this |a better |us )|patch this|make the change|commit this|ship this)\b/i

const CODING_QUESTION_NOT_MUTATE =
  /\b(what does|explain|how does|why does|how do i (?:implement|write|read))\b/i

const HVS_MEDIA =
  /\b(capcut|themespec|professional timeline|nle\b|video edit(?:ing)? job)\b/i

const TERRA_WORLD =
  /\b((?:query|inspect|show) (?:the )?(?:cesium|globe)|cesium (?:globe|ion|tileset)|world[- ]state|live sensors?)\b/i

const EMAIL_SEND = /\b(send (?:this |the )?email|email\.send|mail this)\b/i

const DOCUMENT =
  /\b(spreadsheet|csv|schema|normalize this table|document analysis|decision matrix)\b/i

const HTTP_CONCEPT = /^(what is https?\??)$/i

const SCREENSHOT =
  /\b(this screenshot|this image|what does this (?:screenshot|image) show|explain this (?:screenshot|image))\b/i

const CONCEPTUAL =
  /\b(gut take|why might|reasons? not to|explain the practical problem|what should I tell)\b|^if a model needs\b/i

function hit(partial: PathRuleHit): PathRuleHit {
  return partial
}

export function classifyReasoningBudget(text: string): ReasoningBudget {
  const raw = text.toLowerCase()
  if (/\b(deep research|be thorough|double-check|in depth|comprehensive)\b/.test(raw)) return 'DEEP'
  if (/\b(quick|brief|fast|short answer|quick answer)\b/.test(raw)) return 'FAST'
  return 'STANDARD'
}

export function matchPathRules(text: string): PathRuleHit[] {
  const raw = typeof text === 'string' ? text.trim() : ''
  const hits: PathRuleHit[] = []
  if (!raw) {
    hits.push(hit({
      id: 'empty_chitchat',
      path: 'SHORT_PATH',
      mission_class: 'CHITCHAT',
      intent_class: 'CASUAL_CONVERSATION',
      confidence: 0.99,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
    return hits
  }

  if (FOUNDRY_MUTATE.test(raw) && !CODING_QUESTION_NOT_MUTATE.test(raw) && !ARCHITECTURE_REVIEW.test(raw) && !SENTENCE_FIX.test(raw)) {
    hits.push(hit({
      id: 'foundry_mutate',
      path: 'HANDOFF',
      mission_class: 'ENGINEERING',
      intent_class: 'ENGINEERING_HANDOFF',
      confidence: 0.92,
      risk_class: 'HIGH',
      tools_needed_est: 'many',
      tool_need: 'FOUNDRY',
      handoff_target: 'FOUNDRY',
      seats_recommended: [],
    }))
  }
  if (HVS_MEDIA.test(raw)) {
    hits.push(hit({
      id: 'hvs_media',
      path: 'HANDOFF',
      mission_class: 'MEDIA_PROD',
      intent_class: 'ENGINEERING_HANDOFF',
      confidence: 0.86,
      risk_class: 'HIGH',
      tools_needed_est: 'many',
      tool_need: 'NONE',
      handoff_target: 'HVS',
      seats_recommended: [],
    }))
  }
  if (TERRA_WORLD.test(raw)) {
    hits.push(hit({
      id: 'terra_world',
      path: 'HANDOFF',
      mission_class: 'WORLD_QUERY',
      intent_class: 'CURRENT_INTEL',
      confidence: 0.82,
      risk_class: 'MED',
      tools_needed_est: 1,
      tool_need: 'NONE',
      handoff_target: 'TERRA',
      seats_recommended: [],
    }))
  }
  if (SYSTEM_STATUS.test(raw) || LIVE_RESOURCE.test(raw)) {
    hits.push(hit({
      id: 'system_status',
      path: 'AGENT_PATH',
      mission_class: 'SYSTEM_STATUS',
      intent_class: 'SYSTEM_STATUS',
      confidence: 0.94,
      risk_class: 'MED',
      tools_needed_est: 'many',
      tool_need: 'SYSTEM_PROBE',
      seats_recommended: [],
    }))
  }
  if (INCIDENT.test(raw)) {
    hits.push(hit({
      id: 'incident',
      path: 'AGENT_PATH',
      mission_class: 'INCIDENT_RESPONSE',
      intent_class: 'INCIDENT',
      confidence: 0.9,
      risk_class: 'HIGH',
      tools_needed_est: 'many',
      tool_need: 'SYSTEM_PROBE',
      seats_recommended: [],
    }))
  }
  if (DOCUMENT.test(raw) && !FOUNDRY_MUTATE.test(raw)) {
    hits.push(hit({
      id: 'document_analysis',
      path: 'AGENT_PATH',
      mission_class: 'DOCUMENT_ANALYSIS',
      intent_class: 'DOCUMENT_ANALYSIS',
      confidence: 0.88,
      risk_class: 'MED',
      tools_needed_est: 1,
      tool_need: 'DOCUMENT',
      seats_recommended: [],
    }))
  }
  if ((DEEP_RESEARCH.test(raw) || CURRENT_FACT.test(raw)) && !FOUNDRY_MUTATE.test(raw) && !HTTP_CONCEPT.test(raw) && !CODING_EXPLAIN.test(raw) && !META_PRIOR_FAILURE.test(raw)) {
    hits.push(hit({
      id: CURRENT_FACT.test(raw) && !DEEP_RESEARCH.test(raw) ? 'current_fact' : 'deep_research',
      path: 'AGENT_PATH',
      mission_class: CURRENT_FACT.test(raw) && !DEEP_RESEARCH.test(raw) ? 'CURRENT_INTEL' : 'DEEP_RESEARCH',
      intent_class: CURRENT_FACT.test(raw) && !DEEP_RESEARCH.test(raw) ? 'CURRENT_INTEL' : 'DEEP_RESEARCH',
      confidence: 0.9,
      risk_class: 'MED',
      tools_needed_est: 'many',
      tool_need: 'BROWSER_SEARCH',
      seats_recommended: [],
    }))
  }
  if (ARCHITECTURE_REVIEW.test(raw)) {
    hits.push(hit({
      id: 'architecture',
      path: 'AGENT_PATH',
      mission_class: 'ARCHITECTURE_REVIEW',
      intent_class: 'ARCHITECTURE_REVIEW',
      confidence: 0.86,
      risk_class: 'MED',
      tools_needed_est: 'many',
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (EMAIL_SEND.test(raw)) {
    hits.push(hit({
      id: 'email_send_not_short',
      path: 'AGENT_PATH',
      mission_class: 'UNKNOWN',
      intent_class: 'AGENT_REASONING',
      confidence: 0.8,
      risk_class: 'HIGH',
      tools_needed_est: 1,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (GREETING.test(raw)) {
    hits.push(hit({
      id: 'greeting',
      path: 'SHORT_PATH',
      mission_class: 'CHITCHAT',
      intent_class: 'CASUAL_CONVERSATION',
      confidence: 0.97,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (FOLLOW_UP_SHORT.test(raw)) {
    hits.push(hit({
      id: 'follow_up_short',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.7,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (META_PRIOR_FAILURE.test(raw)) {
    hits.push(hit({
      id: 'meta_prior_failure',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.9,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (
    HTTP_CONCEPT.test(raw)
    || CODING_EXPLAIN.test(raw)
    || BRAINSTORM.test(raw)
    || (SIMPLE_DEFINITION.test(raw) && raw.length < 220 && !SYSTEM_STATUS.test(raw) && !DEEP_RESEARCH.test(raw) && !LIVE_RESOURCE.test(raw) && !CURRENT_FACT.test(raw))
    || (CONCEPT_COMPARE.test(raw) && !DEEP_RESEARCH.test(raw) && !CURRENT_FACT.test(raw) && raw.length < 280)
  ) {
    hits.push(hit({
      id: 'simple_qa',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: BRAINSTORM.test(raw) ? 'CASUAL_CONVERSATION' : 'DIRECT_ANSWER',
      confidence: 0.91,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if ((REWRITE.test(raw) || SENTENCE_FIX.test(raw)) && raw.length < 8000 && !(FOUNDRY_MUTATE.test(raw) && !SENTENCE_FIX.test(raw))) {
    hits.push(hit({
      id: 'format_rewrite',
      path: 'SHORT_PATH',
      mission_class: 'FORMAT',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.92,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (SCREENSHOT.test(raw)) {
    hits.push(hit({
      id: 'screenshot_vision',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: 'SIMPLE_TOOL_USE',
      confidence: 0.93,
      risk_class: 'LOW',
      tools_needed_est: 1,
      tool_need: 'VISION',
      seats_recommended: [],
    }))
  }
  if (CONCEPTUAL.test(raw) && !SYSTEM_STATUS.test(raw) && !LIVE_RESOURCE.test(raw) && !CURRENT_FACT.test(raw) && !FOUNDRY_MUTATE.test(raw)) {
    hits.push(hit({
      id: 'conceptual_reasoning',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.86,
      risk_class: 'LOW',
      tools_needed_est: 0,
      tool_need: 'NONE',
      seats_recommended: [],
    }))
  }
  if (ARITHMETIC.test(raw) && raw.length < 160) {
    hits.push(hit({
      id: 'arithmetic',
      path: 'SHORT_PATH',
      mission_class: 'SIMPLE_QA',
      intent_class: 'SIMPLE_TOOL_USE',
      confidence: 0.96,
      risk_class: 'LOW',
      tools_needed_est: 1,
      tool_need: 'CALCULATOR',
      seats_recommended: [],
    }))
  }
  return hits
}

const PATH_RANK: Record<PathClassifierResult['path'], number> = {
  HANDOFF: 3,
  AGENT_PATH: 2,
  SHORT_PATH: 1,
}

export function pickRuleWinner(hits: PathRuleHit[]): PathRuleHit | null {
  if (!hits.length) return null
  return [...hits].sort((a, b) => {
    const pathDelta = PATH_RANK[b.path] - PATH_RANK[a.path]
    if (pathDelta) return pathDelta
    return b.confidence - a.confidence
  })[0]
}
