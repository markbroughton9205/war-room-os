const OS_SWEEP_PATTERNS = [
  /\bwhat\s+needs\s+(?:to\s+be\s+)?fix(?:ed|ing)?\b/i,
  /\bscan\s+(?:the\s+)?war\s*room\b/i,
  /\bwar\s*room\s+os\s+sweep\b/i,
  /\bos\s+sweep\b/i,
  /\brepair\s+sweep\b/i,
  /\bwhat\s+needs\s+(?:to\s+be\s+)?add(?:ed|ing)?\b/i,
  /\bwhat\s+needs\s+(?:to\s+be\s+)?remov(?:ed|ing)?\b/i,
  /\bcheck\s+(?:for\s+)?duplicates?\b/i,
  /\bmisconfigur(?:ed|ation)\b/i,
  /\bmissing\s+config(?:uration)?\b/i,
  /\bwhat(?:'s|\s+is)\s+wrong\s+with\s+(?:the\s+)?war\s*room\b/i,
  /\brun\s+(?:a\s+)?(?:structured\s+)?(?:os\s+)?sweep\b/i,
]

/** True when Ra'el is asking for a structured War Room OS diagnostic sweep. */
export function detectOsSweepIntent(decreeText: string): boolean {
  const text = decreeText.trim()
  if (!text) return false
  return OS_SWEEP_PATTERNS.some(pattern => pattern.test(text))
}
