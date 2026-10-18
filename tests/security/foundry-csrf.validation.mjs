import { requireCommanderMutationOrigin as gate } from '../../lib/security/commanderSession.ts'
const cases = [
 ['legitimate', { method:'POST', headers:{origin:'http://127.0.0.1:3848',host:'127.0.0.1:3848'} }, false],
 ['cross-site', { method:'POST', headers:{origin:'https://attacker.example',host:'127.0.0.1:3848'} }, true],
 ['other-local-port', { method:'POST', headers:{origin:'http://127.0.0.1:3001',host:'127.0.0.1:3848'} }, true],
 ['no-origin-cookie', { method:'POST', headers:{cookie:'wr_local_session=test',host:'127.0.0.1:3848'} }, true],
 ['bearer-native', { method:'POST', headers:{authorization:'Bearer local-token',host:'127.0.0.1:3848'} }, false],
 ['evil-origin-with-bearer', { method:'POST', headers:{origin:'https://evil.example',authorization:'Bearer local-token',host:'127.0.0.1:3848'} }, true],
 ['read-allowed', { method:'GET', headers:{origin:'https://other.example'} }, false],
]
let failed=0
for (const [name, init, reject] of cases) {
 const req=new Request('http://127.0.0.1:3848/api/foundry/autonomy',init)
 const result=gate(req)
 const ok=reject ? result?.status===403 : result===null
 console.log((ok?'PASS':'FAIL')+' '+name)
 if(!ok)failed++
}
process.exitCode=failed?1:0
