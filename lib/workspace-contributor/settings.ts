const MAX_JSON_BYTES = 8_192
const MAX_JSON_DEPTH = 3
const MAX_JSON_KEYS = 40
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const FORBIDDEN_VALUE_PATTERN = /(sk-|xai-|AIza|service_role|password|secret|token|provider[_-]?key|commander|global|production|supabase|anthropic|openai)/i

const ALLOWED_TOP_LEVEL: Record<string, Set<string>> = {
  layout: new Set(['density', 'defaultView', 'panels']),
  widgets: new Set(['proposalSummary', 'proposalQueue', 'settingsSummary', 'aiAccess']),
  theme: new Set(['mode', 'accent', 'contrast']),
  enabled_tools: new Set(['proposals', 'attachments', 'settings']),
  council_preferences: new Set(['tone', 'summaryDepth', 'reviewStyle']),
}

export type WorkspaceSettingsInput = {
  layout?: Record<string, unknown>
  widgets?: Record<string, unknown>
  theme?: Record<string, unknown>
  enabled_tools?: Record<string, unknown>
  council_preferences?: Record<string, unknown>
}

export type WorkspaceSettingsValidation =
  | { ok: true; value: Required<WorkspaceSettingsInput> }
  | { ok: false; reason: string }

export function validateWorkspaceSettings(input: WorkspaceSettingsInput): WorkspaceSettingsValidation {
  const value = {
    layout: validateSettingsObject('layout', input.layout),
    widgets: validateSettingsObject('widgets', input.widgets),
    theme: validateSettingsObject('theme', input.theme),
    enabled_tools: validateSettingsObject('enabled_tools', input.enabled_tools),
    council_preferences: validateSettingsObject('council_preferences', input.council_preferences),
  }

  if (!value.layout.ok) return { ok: false, reason: `layout_${value.layout.reason}` }
  if (!value.widgets.ok) return { ok: false, reason: `widgets_${value.widgets.reason}` }
  if (!value.theme.ok) return { ok: false, reason: `theme_${value.theme.reason}` }
  if (!value.enabled_tools.ok) return { ok: false, reason: `enabled_tools_${value.enabled_tools.reason}` }
  if (!value.council_preferences.ok) return { ok: false, reason: `council_preferences_${value.council_preferences.reason}` }

  return {
    ok: true,
    value: {
      layout: value.layout.value,
      widgets: value.widgets.value,
      theme: value.theme.value,
      enabled_tools: value.enabled_tools.value,
      council_preferences: value.council_preferences.value,
    },
  }
}

function validateSettingsObject(scope: keyof typeof ALLOWED_TOP_LEVEL, candidate: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (candidate === undefined) return { ok: true, value: {} }
  if (!isPlainObject(candidate)) return { ok: false, reason: 'not_object' }
  if (JSON.stringify(candidate).length > MAX_JSON_BYTES) return { ok: false, reason: 'too_large' }

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_KEYS.has(key)) return { ok: false, reason: 'prototype_pollution_key' }
    if (!ALLOWED_TOP_LEVEL[scope].has(key)) return { ok: false, reason: `unknown_key_${key}` }
    const child = (candidate as Record<string, unknown>)[key]
    const childValidation = validateJsonValue(child, 1, key)
    if (!childValidation.ok) return childValidation
  }

  return { ok: true, value: candidate as Record<string, unknown> }
}

function validateJsonValue(value: unknown, depth: number, path: string): { ok: true } | { ok: false; reason: string } {
  if (depth > MAX_JSON_DEPTH) return { ok: false, reason: `too_deep_${path}` }
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE_PATTERN.test(value)) return { ok: false, reason: `secret_like_value_${path}` }
    if (/^https?:\/\//i.test(value)) return { ok: false, reason: `url_not_allowed_${path}` }
    return { ok: true }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return { ok: true }
  if (Array.isArray(value)) {
    if (value.length > 20) return { ok: false, reason: `too_many_array_items_${path}` }
    for (const [index, child] of value.entries()) {
      const childValidation = validateJsonValue(child, depth + 1, `${path}_${index}`)
      if (!childValidation.ok) return childValidation
    }
    return { ok: true }
  }
  if (!isPlainObject(value)) return { ok: false, reason: `invalid_value_${path}` }
  const keys = Object.keys(value)
  if (keys.length > MAX_JSON_KEYS) return { ok: false, reason: `too_many_keys_${path}` }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) return { ok: false, reason: `prototype_pollution_key_${path}` }
    if (FORBIDDEN_VALUE_PATTERN.test(key)) return { ok: false, reason: `forbidden_key_${path}_${key}` }
    const childValidation = validateJsonValue((value as Record<string, unknown>)[key], depth + 1, `${path}_${key}`)
    if (!childValidation.ok) return childValidation
  }
  return { ok: true }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
