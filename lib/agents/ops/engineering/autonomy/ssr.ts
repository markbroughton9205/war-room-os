/**
 * Server-render hazards in client components. `next build` prerenders pages on the server, where window, document, localStorage and matchMedia do not exist. The type checker cannot see
 * this, the builder model often writes it (state initialised from localStorage, refs initialised from window.matchMedia), and the build log names the page, not the line. This scan names the line,
 * so a repair is told exactly what to change instead of re-reading a whole file and guessing.
 */
export type SsrHazard = { path: string; line: number; text: string; why: string }

const GLOBALS = /\b(window|document|localStorage|sessionStorage|navigator|matchMedia|requestAnimationFrame|innerWidth|innerHeight)\b/
const INIT_HOOKS = /\buse(State|Ref|Memo|Reducer)\s*\(/

export function findSsrHazards(files: { path: string; text: string }[]): SsrHazard[] {
  const out: SsrHazard[] = []
  for (const f of files) {
    if (!/\.(tsx|jsx)$/.test(f.path) || !/^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/.test(f.text)) continue
    const lines = f.text.split('\n')
    // depth of nested effect / handler callbacks: code inside them only runs in the browser
    let browserOnlyDepth = 0
    const stack: number[] = []
    let braceDepth = 0
    lines.forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, '')
      const opensBrowserOnly = /\buse(Layout)?Effect\s*\(|\buse(Callback|ImperativeHandle)\s*\(|=>\s*\{\s*$|function\s+\w+\s*\([^)]*\)\s*\{\s*$/.test(line) && /\buse(Layout)?Effect\s*\(|\bon[A-Z]\w*\s*=|\bhandle\w*\s*=|\buseCallback\s*\(/.test(line)
      if (opensBrowserOnly) { stack.push(braceDepth); browserOnlyDepth++ }
      if (GLOBALS.test(line) && !/typeof\s+(window|document|localStorage|sessionStorage|navigator)\b/.test(line)) { // a line that tests for the global first is the safe pattern
        // an initializer argument that reads a browser global runs during the server render
        const init = INIT_HOOKS.test(line) || (i > 0 && INIT_HOOKS.test(lines[i - 1].replace(/\/\/.*$/, '')) && /=>\s*\{?\s*$/.test(lines[i - 1])) || (i > 1 && INIT_HOOKS.test(lines[i - 2]) && /=>\s*\{\s*$/.test(lines[i - 2].trim()) )
        const before = line.slice(0, line.search(GLOBALS))
        const bodyLevel = /^ {2}\S/.test(raw) && browserOnlyDepth === 0 && /^\s*(const|let|var)\b/.test(raw) && !/=>|\bfunction\b/.test(before) // a direct statement of the component body
        if ((init || bodyLevel) && browserOnlyDepth === 0) out.push({ path: f.path, line: i + 1, text: raw.trim().slice(0, 160), why: init ? 'a state/ref initializer reads a browser global; initializers also run during the server render' : 'a statement in the component body reads a browser global; the component body runs during the server render' })
      }
      for (const ch of line) { if (ch === '{') braceDepth++; else if (ch === '}') { braceDepth--; while (stack.length && braceDepth <= stack[stack.length - 1]) { stack.pop(); browserOnlyDepth-- } } }
    })
  }
  return out
}

export const ssrAdvice = (h: SsrHazard[]): string =>
  h.length
    ? `Server-render hazards found by static analysis (each line runs during the server render, where window/document/localStorage/matchMedia do not exist):\n${h.slice(0, 8).map((x) => `- ${x.path}:${x.line}  ${x.text}   → ${x.why}. Start with a safe server value (for example true/false/null), and read the browser global inside useEffect, then set state there.`).join('\n')}`
    : ''
