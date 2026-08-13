import { mitreAttackAdapter } from '../lib/research-engine/providers/mitreAttack.ts'
import { gleifAdapter } from '../lib/research-engine/providers/gleif.ts'
import { IMPLEMENTED_PROVIDER_ADAPTERS } from '../lib/research-engine/providers/registry.ts'
import { RESEARCH_PROVIDER_ENV } from '../lib/research-engine/config/providerEnv.ts'
import { isAllowedHost } from '../lib/research-engine/security/hostAllowlist.ts'

const checks = []
function check(id, condition, detail) { checks.push({ id, pass: Boolean(condition), detail }) }

check('phase21_registry', IMPLEMENTED_PROVIDER_ADAPTERS.mitre_attack === mitreAttackAdapter && IMPLEMENTED_PROVIDER_ADAPTERS.gleif === gleifAdapter, 'both real adapters registered')
check('phase21_descriptors', RESEARCH_PROVIDER_ENV.find(p => p.id === 'mitre_attack')?.implemented && RESEARCH_PROVIDER_ENV.find(p => p.id === 'gleif')?.implemented, 'both descriptors implemented without credentials')
check('phase21_allowlist', isAllowedHost('mitre_attack', 'attack-taxii.mitre.org') && isAllowedHost('gleif', 'api.gleif.org') && !isAllowedHost('gleif', 'example.com'), 'official hosts only')

const mitre = await mitreAttackAdapter.run({ text: 'T1059', maxResults: 1 })
check('phase21_mitre_live_normalization', mitre.ok && mitre.documents[0]?.identifiers.attack_external_id === 'T1059' && mitre.documents[0]?.provenance.provider === 'mitre_attack', mitre.ok ? 'real TAXII object normalized with provenance' : `MITRE request failed: ${mitre.error?.message ?? 'unknown error'}`)

const gleif = await gleifAdapter.run({ text: '529900T8BM49AURSDO55', maxResults: 1 })
check('phase21_gleif_live_normalization', gleif.ok && gleif.documents[0]?.identifiers.lei === '529900T8BM49AURSDO55' && gleif.documents[0]?.provenance.provider === 'gleif', gleif.ok ? 'real LEI record normalized with provenance' : `GLEIF request failed: ${gleif.error?.message ?? 'unknown error'}`)

for (const result of checks) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: ${result.detail}`)
if (checks.some(result => !result.pass)) process.exitCode = 1
