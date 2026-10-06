/**
 * ORION hypothesis engine for diagnosis / investigation.
 * A hypothesis is not a VERIFIED fact until EBC supports it.
 */

import type { Hypothesis } from './orchestrationTypes'

const SCREENSHOT = /\bscreenshot/i
const CRASH = /\bcrash/i

export function generateHypotheses(text: string): Hypothesis[] {
  if (SCREENSHOT.test(text) && CRASH.test(text)) {
    return [
      h('H1', 'tmp quota / Playwright tmpdir on a quota-limited filesystem', ['wrb tmp path', 'df of XDG_RUNTIME_DIR'], ['screenshot succeeds after tmp move']),
      h('H2', 'Chromium profile corruption', ['profile store diagnostics'], ['ephemeral session still crashes']),
      h('H3', 'DOM / document pixel size exceeds capture budget', ['page metrics', 'pixel_memory_safety_limit'], ['viewport capture works while full-page fails']),
      h('H4', 'sandbox / Electron library path leak into Chromium', ['chromium_strips_electron_library_path'], ['broker Chromium env is clean and still crashes']),
    ]
  }
  if (/\bollama|local (?:general|backend)|unreachable/i.test(text)) {
    return [
      h('H1', 'Ollama user service is not running', ['systemctl --user is-active ollama'], ['probeOllama succeeds after start']),
      h('H2', 'GENERAL model not pulled', ['GET /api/tags'], ['huihui_ai/qwen3-abliterated:14b present']),
      h('H3', 'OLLAMA_HOST/BASE_URL not visible to the UI process', ['launcher env'], ['probe from 3848 matches 127.0.0.1:11434']),
    ]
  }
  if (/\bdiagnos|investigat|likely cause|root cause/i.test(text)) {
    return [
      h('H1', 'Primary suspected component is misconfigured', ['live probe'], ['probe falsifies config']),
      h('H2', 'Dependency unavailable', ['health of dependency'], ['dependency returns healthy']),
      h('H3', 'Recent change introduced the failure', ['temporal install/runtime evidence'], ['reproduced on prior install']),
    ]
  }
  return []
}

function h(id: string, statement: string, tests: string[], falsifiers: string[]): Hypothesis {
  return Object.freeze({
    id,
    statement,
    supporting_evidence: [],
    contradicting_evidence: [],
    tests,
    falsifiers,
    status: 'OPEN',
  })
}

export function applyHypothesisEvidence(hypotheses: readonly Hypothesis[], evidenceSummaries: readonly string[]): Hypothesis[] {
  return hypotheses.map(row => {
    const support = evidenceSummaries.filter(text => row.tests.some(test => text.toLowerCase().includes(test.toLowerCase().slice(0, 12))))
    const contra = evidenceSummaries.filter(text => row.falsifiers.some(f => text.toLowerCase().includes(f.toLowerCase().slice(0, 12))))
    let status = row.status
    if (contra.length && !support.length) status = 'FALSIFIED'
    else if (support.length && contra.length) status = 'WEAKENED'
    else if (support.length >= 2) status = 'CONFIRMED_AS_CAUSAL_CANDIDATE'
    else if (support.length) status = 'SUPPORTED'
    return { ...row, supporting_evidence: support, contradicting_evidence: contra, status }
  })
}

export function hypothesisIsNotVerifiedFact(_row: Hypothesis): boolean {
  return true
}
