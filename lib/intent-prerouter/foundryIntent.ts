/** Pure detection for "Foundry, build this" style commands (no imports, so it can be validated anywhere). */
const VERBS = 'build|make|create|add|change|replace|implement|fix|write|develop|update|refactor|remove|rename|redesign|wire|connect|turn|swap|show|hide|improve|speed up|enable|disable|install'
export const ADDRESSED = new RegExp(`^\\s*(?:hey\\s+|ok(?:ay)?\\s+)?(?:foundry\\s*[,:;-]\\s*(?:please\\s+|go\\s+ahead\\s+and\\s+|now\\s+)?(?:${VERBS})\\b|council\\s*[,:;-]\\s*(?:please\\s+)?(?:build|implement|develop|ship)\\s+(?:this|that|it|the\\s+(?:above|feature)|a\\s+|an\\s+|my\\s+))`, 'i')
export const DEICTIC = /^\s*(?:hey\s+|ok(?:ay)?\s+)?(?:foundry|council)\s*[,:;-]\s*(?:please\s+)?(?:build|make|implement|create|do|ship)\s+(?:this|that|it|the above|what we (?:discussed|agreed))(?:\s+(?:feature|change|thing|plan|idea|now))?\s*[.!]?\s*$/i
export const isFoundryCommand = (message: string): boolean => ADDRESSED.test(message.trim())
export const isDeictic = (message: string): boolean => DEICTIC.test(message.trim())
