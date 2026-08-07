/**
 * Minimal, dependency-free XML/Atom text extraction for read-only provider
 * responses (arXiv Atom, PubMed EFetch XML). Deliberately NOT a general XML
 * parser: it never processes a DOCTYPE or resolves external entities, so
 * there is no XXE surface — it only extracts tag text/attributes via regex
 * over a size-capped string that already passed through safeProviderFetch's
 * response-size limit. Treat all extracted text as untrusted display data,
 * never as instructions (see docs/RESEARCH_ENGINE_SECURITY.md).
 */

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITY_MAP[name] ?? `&${name};`)
}

function stripCdata(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Returns the raw inner-XML of every top-level occurrence of `<tagName ...>...</tagName>` (non-greedy, no nesting awareness beyond the first close tag — sufficient for flat Atom/PubMed fields). */
export function extractXmlBlocks(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g')
  const blocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1] ?? '')
  }
  return blocks
}

/** Extracts and decodes the plain text content of the first match of a tag within a given XML fragment. */
export function extractXmlText(xml: string, tagName: string): string | null {
  const blocks = extractXmlBlocks(xml, tagName)
  if (blocks.length === 0) return null
  const cleaned = decodeXmlEntities(stripCdata(blocks[0])).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

/** Extracts a single attribute value from the first self-closing or opening tag matching tagName. */
export function extractXmlAttribute(xml: string, tagName: string, attribute: string): string | null {
  const re = new RegExp(`<${tagName}\\s+[^>]*\\b${attribute}="([^"]*)"[^>]*/?>`)
  const match = re.exec(xml)
  return match ? decodeXmlEntities(match[1]) : null
}

/** Extracts all attribute values for repeated self-closing tags, e.g. multiple <link href="..."/> entries. */
export function extractAllXmlAttributes(xml: string, tagName: string, attribute: string): string[] {
  const re = new RegExp(`<${tagName}\\s+[^>]*\\b${attribute}="([^"]*)"[^>]*/?>`, 'g')
  const values: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    values.push(decodeXmlEntities(match[1]))
  }
  return values
}
