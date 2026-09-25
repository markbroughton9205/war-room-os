/**
 * GI-ENG-04B packaging boundaries. Walks client import graphs; does not execute Next.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function stripTypeImports(text: string): string {
  return text
    .replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace(/import\s+\{\s*(?:type\s+[A-Za-z0-9_]+(?:\s*,\s*)?)+\}\s+from\s+['"][^'"]+['"]/g, '')
    .replace(/import\(['"][^'"]+['"]\)\.[A-Za-z0-9_]+/g, '')
}

function resolveImport(fromRel: string, spec: string): string | null {
  if (spec.startsWith('node:')) return spec
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null
  const root = resolveRepoRoot()
  const fromDir = path.dirname(path.join(root, fromRel))
  const raw = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec)
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    path.join(raw, 'index.ts'),
    path.join(raw, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      return path.relative(root, candidate).replace(/\\/g, '/')
    }
  }
  return path.relative(root, raw).replace(/\\/g, '/')
}

function walkClientGraph(entryRel: string): { files: string[]; nodeSpecs: string[]; apiRoutes: string[] } {
  const root = resolveRepoRoot()
  const files = new Set<string>()
  const nodeSpecs = new Set<string>()
  const apiRoutes = new Set<string>()
  const queue = [entryRel]
  while (queue.length) {
    const rel = queue.pop()!
    if (files.has(rel)) continue
    const abs = path.join(root, rel)
    if (!existsSync(abs)) continue
    files.add(rel)
    const text = stripTypeImports(readFileSync(abs, 'utf8'))
    const specs: string[] = []
    for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(text))) specs.push(match[1])
    }
    for (const spec of specs) {
      if (spec.startsWith('node:')) {
        nodeSpecs.add(`${rel} → ${spec}`)
        continue
      }
      const resolved = resolveImport(rel, spec)
      if (!resolved) continue
      if (resolved.startsWith('app/api/')) apiRoutes.add(`${rel} → ${resolved}`)
      if (resolved.endsWith('.ts') || resolved.endsWith('.tsx') || resolved.endsWith('.js') || resolved.endsWith('.mjs') || resolved.endsWith('.cjs')) {
        queue.push(resolved)
      }
    }
  }
  return { files: [...files], nodeSpecs: [...nodeSpecs], apiRoutes: [...apiRoutes] }
}

function graphHas(files: string[], needle: string): boolean {
  return files.some(file => file.replace(/\\/g, '/').includes(needle))
}

async function run() {
  const foundry = walkClientGraph('components/war-room/foundry/FoundryShell.tsx')
  const hvs = walkClientGraph('components/war-room/higher-vision-studios/HvsProjectPageRoute.tsx')
  const mediaClients = [
    'components/war-room/higher-vision-studios/HvsEditorShell.tsx',
    'components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx',
    'components/war-room/higher-vision-studios/HvsLaneWorkspaces.tsx',
  ].map(walkClientGraph)
  const mediaFiles = [...new Set(mediaClients.flatMap(item => item.files))]
  const mediaApi = mediaClients.flatMap(item => item.apiRoutes)
  const mediaNode = mediaClients.flatMap(item => item.nodeSpecs)

  const workbenchRoute = source('app/api/foundry/workbench/route.ts')
  const host = source('lib/native-builder/foundryWorkbenchW0.host.ts')
  const mediaRoute = source('app/api/media-command/assets/[id]/file/route.ts')
  const shell = source('components/war-room/foundry/FoundryShell.tsx')
  const hvsWorkspace = source('components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx')
  const experience = source('lib/native-builder/foundryCommanderExperience.ts')
  const commanderState = source('lib/native-builder/foundryCommanderState.ts')
  const unified = source('lib/media-command/unified-render-plan.ts')
  const unifiedServer = source('lib/media-command/unified-render-plan.server.ts')
  const store = source('lib/media-command/store.ts')
  const verdictView = source('lib/native-builder/foundryContractVerdictView.ts')

  const results: CaseResult[] = []
  results.push(check(
    'BOUNDARY-1',
    !foundry.nodeSpecs.some(item => item.includes('node:fs')) && !graphHas(foundry.files, 'foundryContractStore.ts') && !graphHas(foundry.files, 'foundryPaths.ts'),
    foundry.nodeSpecs.filter(item => item.includes('node:fs')).join(' | ') || 'no node:fs in Foundry client graph',
  ))
  results.push(check(
    'BOUNDARY-2',
    !foundry.nodeSpecs.some(item => item.includes('node:crypto')) && !/from ['"]node:crypto['"]/.test(commanderState) && !/foundryContractStore/.test(experience),
    foundry.nodeSpecs.filter(item => item.includes('node:crypto')).join(' | ') || 'no node:crypto in Foundry client graph',
  ))
  results.push(check(
    'BOUNDARY-3',
    !hvs.nodeSpecs.some(item => item.includes('node:fs')) && !graphHas(hvs.files, 'lut-cube.ts') && !graphHas(hvs.files, 'unified-render-plan.server.ts') && !graphHas(hvs.files, 'media-command/paths.ts') && !graphHas(hvs.files, 'media-command/store.ts'),
    hvs.nodeSpecs.filter(item => item.includes('node:fs')).join(' | ') || 'no node:fs in HVS client graph',
  ))
  results.push(check(
    'BOUNDARY-4',
    mediaApi.length === 0 && !mediaFiles.some(file => file.startsWith('app/api/media-command')) && !mediaNode.some(item => item.includes('node:fs')),
    mediaApi.join(' | ') || 'media clients do not import route/server implementation',
  ))
  results.push(check(
    'BOUNDARY-5',
    /foundryWorkbenchW0\.host/.test(workbenchRoute) && /require\('\.\.\/\.\.\/desktop\/workbench-host\/index\.cjs'\)/.test(host) && /loadProject/.test(mediaRoute) && /loadAcceptanceContract/.test(verdictView) && /validateCubeFile/.test(unifiedServer) && /writeFile/.test(store),
    'server routes still call host/store/verdict/LUT compile',
  ))
  results.push(check(
    'BOUNDARY-6',
    /commanderProgressFromMission/.test(shell) && /commanderResultFromMission/.test(shell) && /FoundryContractVerdictPanel/.test(shell) && /\/api\/foundry\/missions/.test(shell) && /contractVerdict: view\.contractVerdict/.test(shell),
    'FoundryShell still projects mission JSON through the existing API',
  ))
  results.push(check(
    'BOUNDARY-7',
    /\/api\/media-command\/projects\/\$\{projectId\}/.test(hvsWorkspace) && /activeUnifiedLanes/.test(hvsWorkspace) && /from '@\/lib\/media-command\/unified-render-plan'/.test(hvsWorkspace) && !/unified-render-plan\.server/.test(hvsWorkspace) && !/from 'node:fs'/.test(unified),
    'HVS workspace still fetches project JSON; lane projection is browser-safe',
  ))
  results.push(check(
    'BOUNDARY-8',
    /export const runtime = 'nodejs'/.test(mediaRoute) && /export async function GET/.test(mediaRoute) && /createReadStream/.test(mediaRoute) && /mediaCommandDataHierarchy/.test(mediaRoute),
    'media asset GET route remains Node filesystem streaming',
  ))
  const desktopPkg = JSON.parse(source('desktop/package.json')) as { build?: { files?: string[] } }
  const desktopFiles = desktopPkg.build?.files ?? []
  results.push(check(
    'BOUNDARY-9',
    desktopFiles.includes('workbench-host/**/*') && /require\('\.\.\/workbench-host\/constants\.cjs'\)/.test(source('desktop/src/foundryWorkbench.cjs')) && /require\('\.\.\/workbench-host\/index\.cjs'\)/.test(source('desktop/src/main.cjs')),
    'Electron asar files include workbench-host so packaged main can require constants.cjs',
  ))

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`GI_ENG_04B_BOUNDARY failed ${failed.length}`)
    process.exit(1)
  }
  console.log(`GI_ENG_04B_BOUNDARY ${results.length}/${results.length} PASS`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runGiEng04bBoundaryValidation }
