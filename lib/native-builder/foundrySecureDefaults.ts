/**
 * SECURE_DEFAULT_WHEN_EQUIVALENT (pure: no filesystem, network or clock).
 *
 * When two supported forms do the same job and one of them can run attacker-controlled code or lets untrusted text through as markup, Foundry writes the
 * safer one. A rule only exists here when the safer form really is equivalent for ordinary data; the tests are still the judge, and when they say the safer
 * form was not enough (the runner names a construct only the unsafe form handles) the rule is switched off for the rest of the mission.
 */
import { languageOf } from './foundryEditForensics'

export type SecureRewrite = { rule: string; from: string; to: string; because: string }

const PY_SAFE_LOADERS: Record<string, string> = { Loader: 'SafeLoader', FullLoader: 'SafeLoader', UnsafeLoader: 'SafeLoader', CLoader: 'CSafeLoader', CFullLoader: 'CSafeLoader', CUnsafeLoader: 'CSafeLoader' }

type Rule = {
  id: string
  because: string
  apply: (text: string) => { text: string; from: string; to: string } | null
}

const RULES: Rule[] = [
  {
    id: 'PARSE_DATA_WITHOUT_CODE_EXECUTION',
    because: 'the unsafe loader can build arbitrary objects from the text; the safe loader reads the same plain data without that risk',
    apply: text => {
      // Loader=yaml.Loader / FullLoader / UnsafeLoader as a keyword or as the second positional argument.
      const keyword = /(\bLoader\s*=\s*)((?:yaml\.)?)(Loader|FullLoader|UnsafeLoader|CLoader|CFullLoader|CUnsafeLoader)\b/.exec(text)
      if (keyword) {
        const safer = PY_SAFE_LOADERS[keyword[3]]
        return { text: text.replace(keyword[0], `${keyword[1]}${keyword[2]}${safer}`), from: `${keyword[2]}${keyword[3]}`, to: `${keyword[2]}${safer}` }
      }
      const positional = /(\byaml\.load\(\s*[^,()]+,\s*)((?:yaml\.)?)(Loader|FullLoader|UnsafeLoader|CLoader|CFullLoader|CUnsafeLoader)(\s*\))/.exec(text)
      if (positional) {
        const safer = PY_SAFE_LOADERS[positional[3]]
        return { text: text.replace(positional[0], `${positional[1]}${positional[2]}${safer}${positional[4]}`), from: `${positional[2]}${positional[3]}`, to: `${positional[2]}${safer}` }
      }
      return null
    },
  },
  {
    id: 'ESCAPE_UNTRUSTED_TEXT_IN_MARKUP',
    because: 'joining text into markup with + passes it through unescaped; formatting it into the markup escapes it and gives the same result for safe text',
    apply: text => {
      // Markup("<h1>" + value + "</h1>") and Markup("<b>" + value): only simple quoted pieces around one plain expression.
      const three = /\b((?:markupsafe\.)?Markup)\(\s*(["'])([^"'{}\n]*)\2\s*\+\s*([A-Za-z_][\w.\[\]"']*(?:\([^()]*\))?)\s*\+\s*(["'])([^"'{}\n]*)\5\s*\)/.exec(text)
      if (three && three[2] === three[5]) {
        const to = `${three[1]}(${three[2]}${three[3]}{}${three[6]}${three[2]}).format(${three[4]})`
        return { text: text.replace(three[0], to), from: three[0], to }
      }
      const two = /\b((?:markupsafe\.)?Markup)\(\s*(["'])([^"'{}\n]*)\2\s*\+\s*([A-Za-z_][\w.\[\]"']*(?:\([^()]*\))?)\s*\)/.exec(text)
      if (two) {
        const to = `${two[1]}(${two[2]}${two[3]}{}${two[2]}).format(${two[4]})`
        return { text: text.replace(two[0], to), from: two[0], to }
      }
      // An f-string interpolates the value before Markup ever sees it: Markup(f"<h1>{x}</h1>") -> Markup("<h1>{}</h1>").format(x).
      const fstring = /\b((?:markupsafe\.)?Markup)\(\s*[fF](["'])([^"'{}\n]*)\{([^{}!:\n]+)\}([^"'{}\n]*)\2\s*\)/.exec(text)
      if (fstring) {
        const to = `${fstring[1]}(${fstring[2]}${fstring[3]}{}${fstring[5]}${fstring[2]}).format(${fstring[4].trim()})`
        return { text: text.replace(fstring[0], to), from: fstring[0], to }
      }
      // Formatting first and wrapping after has the same problem: Markup("<h1>{}</h1>".format(x)) -> Markup("<h1>{}</h1>").format(x).
      const wrapped = /\b((?:markupsafe\.)?Markup)\(\s*(["'])([^"'\n]*\{\}[^"'\n]*)\2\.format\(([^()\n]*)\)\s*\)/.exec(text)
      if (wrapped) {
        const to = `${wrapped[1]}(${wrapped[2]}${wrapped[3]}${wrapped[2]}).format(${wrapped[4]})`
        return { text: text.replace(wrapped[0], to), from: wrapped[0], to }
      }
      return null
    },
  },
]

/** The replacement text with every applicable safer-equivalent rewrite applied. Only Python sources are rewritten. */
export function preferSecureEquivalent(input: { file: string; after: string }): { after: string; rewrites: SecureRewrite[] } {
  if (languageOf(input.file) !== 'python') return { after: input.after, rewrites: [] }
  let text = input.after
  const rewrites: SecureRewrite[] = []
  for (const rule of RULES) {
    for (let pass = 0; pass < 4; pass += 1) {
      const changed = rule.apply(text)
      if (!changed || changed.text === text) break
      text = changed.text
      rewrites.push({ rule: rule.id, from: changed.from.slice(0, 120), to: changed.to.slice(0, 120), because: rule.because })
    }
  }
  return { after: text, rewrites }
}

/** The runner named something only the unsafe form handles: the safer form is not equivalent here, so it is not forced. */
export function saferFormWasNotEnough(failureText: string): boolean {
  return /ConstructorError|could not determine a constructor for the tag|could not construct|unsafe.*(?:tag|object)/i.test(failureText)
}

const HINTS: { root: string; symbol: string | null; hint: string }[] = [
  { root: 'yaml', symbol: 'load', hint: 'If the text is plain data (numbers, strings, lists, mappings), use yaml.safe_load or Loader=yaml.SafeLoader: it does the same job without running arbitrary code.' },
]

/** A sentence added to a research finding when a supported safer equivalent exists for the API the finding is about. */
export function secureHintFor(root: string, symbol: string | null): string {
  return HINTS.find(item => item.root === root && (item.symbol === null || item.symbol === symbol))?.hint ?? ''
}
