/**
 * Bounded global software-knowledge discovery waves.
 * Curated PRIMARY/OFFICIAL URLs only. Not a crawl. Not mastery.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { SourceAuthorityClass, SourceType } from './types'
import { OS_DOC_CORPUS } from './osDocCorpus'
import { AI_ML_REPOSITORY_REGISTRY } from './aiMlRepositoryRegistry'

export type DiscoveryCandidate = {
  sourceId: string
  title: string
  url: string
  sourceType: SourceType
  organization: string
  license: string
  version: string | null
  authorityClass: SourceAuthorityClass
  skillIds: string[]
  notes: string
  rejectReason?: 'blog' | 'incomplete' | 'duplicate-fixture'
}

export type DiscoveryWaveSpec = {
  waveId: string
  scope: string
  taxonomyTargets: string[]
  queries: string[]
  sourceCap: number
  sourcePriorities: SourceAuthorityClass[]
  candidates: DiscoveryCandidate[]
}

function src(
  sourceId: string,
  title: string,
  url: string,
  sourceType: SourceType,
  organization: string,
  license: string,
  authorityClass: SourceAuthorityClass,
  skillIds: string[],
  notes: string,
  version: string | null = null,
): DiscoveryCandidate {
  return { sourceId, title, url, sourceType, organization, license, version, authorityClass, skillIds, notes }
}

const PRIORITY: SourceAuthorityClass[] = ['PRIMARY', 'OFFICIAL', 'STANDARD', 'REFERENCE_IMPLEMENTATION', 'ACADEMIC', 'MAJOR_COMMUNITY', 'SECONDARY']

export const DISCOVERY_WAVE_SOURCE_CAP = 16

export const BLOG_HOST_MARKERS = [
  'medium.com',
  'blogspot.',
  'hashnode.dev',
  'dev.to',
  'substack.com',
  'wordpress.com',
]

export const KIMI_OFFICIAL_HOST_ALLOWLIST = [
  'pypi.org',
  'www.npmjs.com',
  'crates.io',
  'proxy.golang.org',
  'repo.maven.apache.org',
  'api.nuget.org',
  'www.nuget.org',
  'rubygems.org',
  'packagist.org',
  'kernel.org',
  'www.kernel.org',
  'docs.kernel.org',
  'lore.kernel.org',
  'man7.org',
  'nvd.nist.gov',
  'osv.dev',
  'cve.mitre.org',
  'www.cve.org',
  'github.com',
  'rfc-editor.org',
  'www.rfc-editor.org',
  'datatracker.ietf.org',
  'www.w3.org',
  'ecma-international.org',
  'docs.python.org',
  'go.dev',
  'doc.rust-lang.org',
  'nodejs.org',
  'www.postgresql.org',
  'learn.microsoft.com',
  'developer.apple.com',
  'pytorch.org',
  'docs.nvidia.com',
  'huggingface.co',
]

export const DISCOVERY_RELATIONSHIPS: Array<[string, 'REQUIRES' | 'RELATED_TO' | 'SPECIALIZES' | 'APPLIES_TO_PLATFORM', string, string]> = [
  ['frontend.react.performance', 'REQUIRES', 'frontend.react', 'React performance is a specialization of React.'],
  ['ml.cuda.kernel-debugging', 'REQUIRES', 'ml.cuda', 'Kernel debugging requires CUDA.'],
  ['ml.cuda.kernel-debugging', 'RELATED_TO', 'debugging.runtime', 'CUDA-GDB is a runtime debugger.'],
  ['kernel.device-drivers.usb', 'REQUIRES', 'kernel.device-drivers', 'USB drivers specialize device drivers.'],
  ['kernel.device-drivers.usb', 'REQUIRES', 'software.languages.c', 'In-tree USB drivers are C.'],
  ['networking.http3', 'REQUIRES', 'networking.quic', 'HTTP/3 runs on QUIC.'],
  ['networking.http3', 'REQUIRES', 'networking.http', 'HTTP/3 is an HTTP version.'],
  ['compiler.llvm.optimization', 'REQUIRES', 'compiler.llvm', 'LLVM opt is LLVM-specific.'],
  ['compiler.llvm.optimization', 'SPECIALIZES', 'compiler.optimization', 'LLVM passes specialize general optimization.'],
  ['os.linux.man-pages', 'REQUIRES', 'os.linux', 'man-pages document Linux.'],
  ['os.linux.systemd', 'REQUIRES', 'os.linux', 'systemd is a Linux init/service manager.'],
  ['os.linux.systemd', 'RELATED_TO', 'os.system-services', 'systemd implements system services.'],
  ['os.bsd', 'RELATED_TO', 'os.linux', 'BSD family is related, not identical, to Linux.'],
  ['ml.vllm', 'REQUIRES', 'ml.inference', 'vLLM is an inference engine.'],
  ['ml.vllm', 'RELATED_TO', 'ml.serving', 'vLLM is used for model serving.'],
  ['ml.llama-cpp', 'REQUIRES', 'ml.inference', 'llama.cpp is a local inference engine.'],
  ['ml.llama-cpp', 'RELATED_TO', 'ml.quantization', 'GGUF commonly uses quantized weights.'],
  ['ml.huggingface', 'RELATED_TO', 'ml.llm-systems', 'Hub hosts LLM artifacts and docs.'],
  ['ml.rocm', 'RELATED_TO', 'ml.cuda', 'ROCm is an AMD counterpart to CUDA, not a proof of CUDA.'],
  ['database.query-planning', 'REQUIRES', 'database.postgresql', 'Planner docs are commonly exercised on PostgreSQL.'],
  ['os.linux.systemd', 'APPLIES_TO_PLATFORM', 'os.linux', 'systemd applies to Linux.'],
]

export const SKILL_VALIDATION_HINTS: Record<string, { methods: string[]; failures: string[]; security: string[] }> = {
  'frontend.react.performance': {
    methods: ['browser acceptance of hydration', 'React profiler / performance marks', 'unit tests for memo boundaries'],
    failures: ['hydration mismatch', 'unnecessary re-renders', 'client bundle regression'],
    security: ['Do not disable SSR safety checks to hide hydration bugs.'],
  },
  'ml.cuda.kernel-debugging': {
    methods: ['sandbox CUDA-GDB session', 'compiler checks on device code', 'nvidia-smi memory snapshot'],
    failures: ['illegal memory access', 'unaligned shared memory', 'OOM during kernel launch'],
    security: ['Do not execute untrusted CUDA binaries. No weights download in research.'],
  },
  'ml.cuda': {
    methods: ['sandbox device query', 'known-good vector add', 'OOM reproduction under limit'],
    failures: ['CUDA OOM', 'wrong architecture fatbin', 'driver/toolkit mismatch'],
    security: ['Do not treat vendor docs as production authorization.'],
  },
  'os.linux.systemd': {
    methods: ['systemctl cat on a fixture unit', 'journalctl sandbox', 'unit-file syntax check'],
    failures: ['service restart loop', 'After= ordering deadlock', 'Type=simple vs forking mismatch'],
    security: ['Do not enable lingering root units from untrusted unit files.'],
  },
  'os.linux': {
    methods: ['man-page lookup', 'strace on a fixture binary', 'sandbox service failure reproduction'],
    failures: ['permission denied on restricted paths', 'missing capability bounding set'],
    security: ['Do not weaken LSM/AppArmor to make a test pass.'],
  },
  'kernel.device-drivers.usb': {
    methods: ['kernel test harness / kselftest', 'out-of-tree module build in sandbox', 'sparse/checkpatch'],
    failures: ['missing MODULE_LICENSE', 'GFP_KERNEL in atomic', 'USB descriptor parse overflow'],
    security: ['Kernel code remains governed. No exploit corpora as mastery.'],
  },
  'database.query-planning': {
    methods: ['EXPLAIN (ANALYZE, BUFFERS) on a fixture', 'pg_stat_statements snapshot', 'index-only scan assertion'],
    failures: ['seq scan on large selective predicate', 'bad row estimate', 'parameter sniffing'],
    security: ['Do not load untrusted SQL dumps into shared databases.'],
  },
  'networking.http3': {
    methods: ['interop against a known HTTP/3 endpoint in sandbox', 'QUIC packet capture', 'TLS 1.3 handshake log'],
    failures: ['fallback to HTTP/1.1 only', '0-RTT replay', 'certificate mismatch'],
    security: ['Do not disable certificate verification to force HTTP/3.'],
  },
  'compiler.llvm.optimization': {
    methods: ['opt -passes=... on a fixture IR', 'llc compile', 'FileCheck tests'],
    failures: ['miscompile after inlining', 'pass pipeline order change'],
    security: ['Do not run untrusted bitcode through local opt.'],
  },
  'ml.vllm': {
    methods: ['sandbox server health check', 'tiny tokenizer roundtrip', 'KV cache limit test'],
    failures: ['GPU fragmentation', 'preemption thrash', 'tokenizer mismatch'],
    security: ['No production model serving from research. No weight download.'],
  },
}

const WAVE1: DiscoveryWaveSpec = {
  waveId: 'wave-01-languages-runtimes',
  scope: 'Software languages and runtimes',
  taxonomyTargets: ['software.languages', 'software.languages.python', 'software.languages.rust', 'software.languages.go', 'software.languages.java', 'software.languages.c'],
  queries: ['Python language reference', 'Rust book', 'Go spec', 'ECMA-262', 'ISO C', 'Java SE spec'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('python-docs', 'Python documentation', 'https://docs.python.org/3/', 'official_documentation', 'Python Software Foundation', 'PSF License', 'OFFICIAL', ['software.languages.python'], 'Official Python language and library docs.'),
    src('python-reference', 'Python Language Reference', 'https://docs.python.org/3/reference/index.html', 'official_specification', 'Python Software Foundation', 'PSF License', 'PRIMARY', ['software.languages.python'], 'Language reference (not the tutorial).'),
    src('go-spec', 'Go language specification', 'https://go.dev/ref/spec', 'official_specification', 'Go project / Google', 'BSD-3-Clause', 'PRIMARY', ['software.languages.go'], 'Official Go spec.'),
    src('go-docs', 'Go documentation', 'https://go.dev/doc/', 'official_documentation', 'Go project', 'BSD-3-Clause', 'OFFICIAL', ['software.languages.go'], 'Official Go documentation hub.'),
    src('java-se-specs', 'Java SE specifications', 'https://docs.oracle.com/javase/specs/', 'official_specification', 'Oracle', 'Oracle specification license', 'PRIMARY', ['software.languages.java'], 'JLS and JVM spec.'),
    src('cppreference', 'C++ reference', 'https://en.cppreference.com/w/', 'major_community', 'cppreference.com', 'CC-BY-SA', 'MAJOR_COMMUNITY', ['software.languages.cpp', 'software.languages.c'], 'Respected secondary/community C++ reference. Not ISO text.'),
    src('iso-c-open-std', 'open-std WG14', 'https://www.open-std.org/jtc1/sc22/wg14/', 'recognized_standard', 'ISO/IEC JTC1/SC22/WG14', 'ISO (committee pages)', 'STANDARD', ['software.languages.c'], 'C standards committee landing page.'),
    src('ecma-262', 'ECMA-262', 'https://tc39.es/ecma262/', 'official_specification', 'Ecma International / TC39', 'Ecma copyright', 'PRIMARY', ['software.languages.javascript'], 'ECMAScript language specification.'),
    src('php-docs', 'PHP manual', 'https://www.php.net/docs.php', 'official_documentation', 'PHP Group', 'CC-BY-3.0', 'OFFICIAL', ['software.languages.php'], 'Official PHP documentation.'),
    src('ruby-docs', 'Ruby documentation', 'https://www.ruby-lang.org/en/documentation/', 'official_documentation', 'Ruby project', 'Ruby license', 'OFFICIAL', ['software.languages.ruby'], 'Official Ruby documentation hub.'),
    src('csharp-docs', 'C# language docs', 'https://learn.microsoft.com/dotnet/csharp/', 'official_documentation', 'Microsoft', 'Microsoft documentation license', 'OFFICIAL', ['software.languages.csharp'], 'Official C# documentation.'),
    src('kotlin-docs', 'Kotlin docs', 'https://kotlinlang.org/docs/home.html', 'official_documentation', 'JetBrains / Kotlin', 'Apache-2.0 (language site)', 'OFFICIAL', ['software.languages.kotlin'], 'Official Kotlin documentation.'),
    src('swift-docs', 'Swift language guide', 'https://docs.swift.org/swift-book/', 'official_documentation', 'Apple / Swift project', 'Apache-2.0', 'OFFICIAL', ['software.languages.swift'], 'Official Swift book.'),
    src('gnu-bash-manual', 'Bash reference manual', 'https://www.gnu.org/software/bash/manual/bash.html', 'official_documentation', 'Free Software Foundation', 'GFDL', 'OFFICIAL', ['software.languages.bash'], 'Official Bash manual.'),
  ],
}

const WAVE2: DiscoveryWaveSpec = {
  waveId: 'wave-02-frontend-web',
  scope: 'Frontend and web platform',
  taxonomyTargets: ['frontend', 'frontend.react', 'frontend.react.performance', 'frontend.html', 'frontend.css', 'frontend.accessibility'],
  queries: ['HTML living standard', 'CSS snapshots', 'React performance', 'WCAG', 'WebGPU'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('html-living-standard', 'HTML Living Standard', 'https://html.spec.whatwg.org/', 'official_specification', 'WHATWG', 'CC-BY-4.0', 'PRIMARY', ['frontend.html', 'frontend.browser-apis'], 'WHATWG HTML specification.'),
    src('css-snapshot', 'CSS Snapshot', 'https://www.w3.org/TR/CSS/', 'recognized_standard', 'W3C', 'W3C document license', 'STANDARD', ['frontend.css'], 'W3C CSS snapshot.'),
    src('wcag22', 'WCAG 2.2', 'https://www.w3.org/TR/WCAG22/', 'recognized_standard', 'W3C', 'W3C document license', 'STANDARD', ['frontend.accessibility'], 'Web Content Accessibility Guidelines 2.2.'),
    src('react-performance', 'React performance docs', 'https://react.dev/learn/render-and-commit', 'official_documentation', 'Meta Open Source', 'CC-BY-4.0', 'OFFICIAL', ['frontend.react.performance', 'frontend.react'], 'Official React render/commit documentation.'),
    src('react-escape-hatches', 'React escape hatches', 'https://react.dev/learn/escape-hatches', 'official_documentation', 'Meta Open Source', 'CC-BY-4.0', 'OFFICIAL', ['frontend.react.performance', 'frontend.react'], 'Official effects/refs guidance used in performance work.'),
    src('vue-docs', 'Vue.js guide', 'https://vuejs.org/guide/introduction.html', 'official_documentation', 'Vue.js', 'MIT', 'OFFICIAL', ['frontend.vue'], 'Official Vue documentation.'),
    src('svelte-docs', 'Svelte documentation', 'https://svelte.dev/docs', 'official_documentation', 'Svelte', 'MIT', 'OFFICIAL', ['frontend.svelte'], 'Official Svelte docs.'),
    src('angular-docs', 'Angular documentation', 'https://angular.dev/overview', 'official_documentation', 'Google / Angular', 'MIT', 'OFFICIAL', ['frontend.angular'], 'Official Angular docs.'),
    src('webgpu-spec', 'WebGPU specification', 'https://www.w3.org/TR/webgpu/', 'recognized_standard', 'W3C', 'W3C document license', 'STANDARD', ['frontend.webgpu', 'frontend.graphics'], 'WebGPU specification.'),
    src('mdn-performance', 'MDN web performance', 'https://developer.mozilla.org/en-US/docs/Web/Performance', 'official_documentation', 'Mozilla', 'CC-BY-SA-2.5', 'OFFICIAL', ['frontend.react.performance', 'performance.profiling'], 'MDN performance documentation.'),
  ],
}

const WAVE3: DiscoveryWaveSpec = {
  waveId: 'wave-03-backend-apis-databases',
  scope: 'Backend, APIs, and databases',
  taxonomyTargets: ['backend', 'database', 'database.postgresql', 'database.query-planning', 'backend.rest'],
  queries: ['PostgreSQL query planning', 'SQL standard', 'OpenAPI', 'gRPC', 'Redis'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('postgres-performance', 'PostgreSQL performance tips', 'https://www.postgresql.org/docs/current/performance-tips.html', 'official_documentation', 'PostgreSQL Global Development Group', 'PostgreSQL', 'OFFICIAL', ['database.postgresql', 'database.query-planning', 'database.query-optimization'], 'Official planner/performance chapter.'),
    src('postgres-explain', 'EXPLAIN', 'https://www.postgresql.org/docs/current/sql-explain.html', 'official_documentation', 'PostgreSQL Global Development Group', 'PostgreSQL', 'OFFICIAL', ['database.query-planning', 'database.postgresql'], 'Official EXPLAIN command reference.'),
    src('mysql-docs', 'MySQL reference manual', 'https://dev.mysql.com/doc/', 'official_documentation', 'Oracle / MySQL', 'Oracle documentation license', 'OFFICIAL', ['database.mysql'], 'Official MySQL documentation hub.'),
    src('sqlite-docs', 'SQLite documentation', 'https://www.sqlite.org/docs.html', 'official_documentation', 'SQLite Consortium', 'Public domain / blessing', 'OFFICIAL', ['database.sqlite'], 'Official SQLite docs.'),
    src('redis-docs', 'Redis documentation', 'https://redis.io/docs/latest/', 'official_documentation', 'Redis Ltd / Redis project', 'RSALv2 / documentation as published', 'OFFICIAL', ['database.redis'], 'Official Redis documentation.'),
    src('mongodb-docs', 'MongoDB manuals', 'https://www.mongodb.com/docs/manual/', 'official_documentation', 'MongoDB Inc.', 'CC-BY-NC-SA / MongoDB docs license', 'OFFICIAL', ['database.mongodb'], 'Official MongoDB manual.'),
    src('openapi-spec', 'OpenAPI Specification', 'https://spec.openapis.org/oas/latest.html', 'recognized_standard', 'OpenAPI Initiative', 'Apache-2.0', 'STANDARD', ['backend.rest'], 'OpenAPI latest specification.'),
    src('grpc-docs', 'gRPC documentation', 'https://grpc.io/docs/', 'official_documentation', 'CNCF / gRPC', 'Apache-2.0', 'OFFICIAL', ['backend.rpc'], 'Official gRPC docs.'),
    src('http-semantics-rfc9110', 'RFC 9110 HTTP Semantics', 'https://www.rfc-editor.org/rfc/rfc9110', 'recognized_standard', 'IETF', 'RFC copyright', 'STANDARD', ['networking.http', 'backend.rest'], 'HTTP semantics standard.'),
  ],
}

const WAVE4: DiscoveryWaveSpec = {
  waveId: 'wave-04-os-kernel-systems',
  scope: 'Operating systems, kernel, and systems programming',
  taxonomyTargets: ['os', 'os.linux', 'os.windows', 'os.macos', 'os.bsd', 'kernel', 'kernel.device-drivers.usb'],
  queries: ['Linux man-pages', 'systemd', 'Windows drivers', 'Darwin kernel', 'USB drivers', 'kernel.org docs'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    ...OS_DOC_CORPUS,
    src('kernel-usb-docs', 'USB kernel documentation', 'https://www.kernel.org/doc/html/latest/driver-api/usb/index.html', 'kernel_documentation', 'kernel.org', 'GPL-2.0', 'PRIMARY', ['kernel.device-drivers.usb', 'kernel.device-drivers'], 'Official in-tree USB driver API docs.'),
    src('kernel-kbuild', 'Building external modules', 'https://www.kernel.org/doc/html/latest/kbuild/modules.html', 'kernel_documentation', 'kernel.org', 'GPL-2.0', 'PRIMARY', ['kernel.module-build', 'kernel.device-drivers'], 'Official kbuild external-module documentation.'),
    src('linux-syscalls-man', 'syscalls(2)', 'https://man7.org/linux/man-pages/man2/syscalls.2.html', 'operating_system_documentation', 'Linux man-pages project', 'GPL-2.0 / BSD', 'PRIMARY', ['kernel.syscalls', 'os.linux'], 'Syscall list manual page.'),
  ],
}

const WAVE5: DiscoveryWaveSpec = {
  waveId: 'wave-05-networking-distributed-cloud',
  scope: 'Networking, distributed systems, and cloud',
  taxonomyTargets: ['networking', 'networking.http3', 'networking.quic', 'networking.tls', 'cloud'],
  queries: ['HTTP/3 RFC', 'QUIC RFC', 'TLS 1.3', 'DNS RFC', 'Kubernetes docs'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('rfc9114-http3', 'RFC 9114 HTTP/3', 'https://www.rfc-editor.org/rfc/rfc9114', 'recognized_standard', 'IETF', 'RFC copyright', 'STANDARD', ['networking.http3', 'networking.http'], 'HTTP/3 standard.'),
    src('rfc9000-quic', 'RFC 9000 QUIC', 'https://www.rfc-editor.org/rfc/rfc9000', 'recognized_standard', 'IETF', 'RFC copyright', 'STANDARD', ['networking.quic', 'networking.http3'], 'QUIC transport standard.'),
    src('rfc8446-tls13', 'RFC 8446 TLS 1.3', 'https://www.rfc-editor.org/rfc/rfc8446', 'recognized_standard', 'IETF', 'RFC copyright', 'STANDARD', ['networking.tls', 'security.crypto-usage'], 'TLS 1.3 standard.'),
    src('rfc1035-dns', 'RFC 1035 DNS', 'https://www.rfc-editor.org/rfc/rfc1035', 'recognized_standard', 'IETF', 'RFC copyright', 'STANDARD', ['networking.dns'], 'DNS protocol standard.'),
    src('k8s-docs', 'Kubernetes documentation', 'https://kubernetes.io/docs/home/', 'official_documentation', 'CNCF / Kubernetes', 'CC-BY-4.0', 'OFFICIAL', ['cloud.kubernetes', 'cloud.deployment'], 'Official Kubernetes documentation.'),
    src('aws-docs', 'AWS documentation', 'https://docs.aws.amazon.com/', 'vendor_documentation', 'Amazon Web Services', 'Amazon documentation license', 'OFFICIAL', ['cloud.deployment', 'cloud.secrets'], 'Official AWS documentation hub.'),
    src('azure-docs', 'Azure documentation', 'https://learn.microsoft.com/azure/', 'vendor_documentation', 'Microsoft', 'Microsoft documentation license', 'OFFICIAL', ['cloud.deployment'], 'Official Azure documentation.'),
    src('gcp-docs', 'Google Cloud docs', 'https://cloud.google.com/docs', 'vendor_documentation', 'Google', 'Google documentation license', 'OFFICIAL', ['cloud.deployment'], 'Official Google Cloud documentation.'),
  ],
}

const WAVE6: DiscoveryWaveSpec = {
  waveId: 'wave-06-testing-debugging-performance',
  scope: 'Testing, debugging, and performance',
  taxonomyTargets: ['testing', 'debugging', 'performance'],
  queries: ['GDB manual', 'perf wiki', 'Playwright', 'JUnit', 'LLVM sanitizers'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('gdb-manual', 'GDB User Manual', 'https://sourceware.org/gdb/current/onlinedocs/gdb.html', 'official_documentation', 'Free Software Foundation / sourceware', 'GFDL', 'OFFICIAL', ['debugging.runtime', 'debugging.stack-traces'], 'Official GDB documentation.'),
    src('perf-wiki', 'Linux perf wiki', 'https://perf.wiki.kernel.org/index.php/Main_Page', 'kernel_documentation', 'kernel.org wiki', 'GFDL / wiki license', 'PRIMARY', ['performance.profiling', 'os.linux'], 'Kernel perf tooling documentation.'),
    src('llvm-sanitizers', 'LLVM sanitizers', 'https://clang.llvm.org/docs/AddressSanitizer.html', 'official_documentation', 'LLVM Project', 'Apache-2.0 with LLVM exceptions', 'OFFICIAL', ['testing.fuzzing', 'debugging.memory-leaks', 'compiler.llvm'], 'Official ASan documentation.'),
    src('junit5-docs', 'JUnit 5 user guide', 'https://docs.junit.org/current/user-guide/', 'official_documentation', 'JUnit team', 'EPL-2.0', 'OFFICIAL', ['testing.unit', 'software.languages.java'], 'Official JUnit 5 guide.'),
    src('pytest-docs', 'pytest documentation', 'https://docs.pytest.org/en/stable/', 'official_documentation', 'pytest', 'MIT', 'OFFICIAL', ['testing.unit', 'software.languages.python'], 'Official pytest docs.'),
    src('mdn-devtools', 'Firefox DevTools', 'https://firefox-source-docs.mozilla.org/devtools-user/', 'official_documentation', 'Mozilla', 'CC-BY-SA', 'OFFICIAL', ['debugging.browser', 'frontend.browser-apis'], 'Official Firefox DevTools docs.'),
  ],
}

const WAVE7: DiscoveryWaveSpec = {
  waveId: 'wave-07-security-advisories',
  scope: 'Security, advisories, and secure development',
  taxonomyTargets: ['security', 'security.vulnerability-remediation', 'security.auth'],
  queries: ['NVD CVE', 'OSV', 'GitHub Security Advisories', 'CWE', 'kernel CVE'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('nvd-cve', 'National Vulnerability Database', 'https://nvd.nist.gov/vuln', 'security_advisory', 'NIST', 'U.S. public domain (NIST)', 'PRIMARY', ['security.vulnerability-remediation', 'security.dependency-security'], 'Primary CVE database. No exploit payload ingestion.'),
    src('osv-dev', 'OSV', 'https://osv.dev/', 'security_advisory', 'Google / OSV', 'Apache-2.0 / CC', 'PRIMARY', ['security.vulnerability-remediation', 'security.supply-chain'], 'Open Source Vulnerabilities database.'),
    src('ghsa', 'GitHub Advisory Database', 'https://github.com/advisories', 'security_advisory', 'GitHub', 'CC-BY-4.0 (advisory text as published)', 'OFFICIAL', ['security.vulnerability-remediation'], 'GitHub Security Advisories. Governed; no exploit corpora.'),
    src('cwe-mitre', 'CWE', 'https://cwe.mitre.org/', 'recognized_standard', 'MITRE', 'CWE/CAPEC terms', 'STANDARD', ['security.secure-coding'], 'Common Weakness Enumeration.'),
    src('cve-org', 'CVE Program', 'https://www.cve.org/', 'security_advisory', 'CVE Program / MITRE / CISA', 'CVE terms', 'PRIMARY', ['security.vulnerability-remediation'], 'Official CVE program site.'),
    src('kernel-cve', 'Linux kernel CVE announcements', 'https://lore.kernel.org/linux-cve-announce/', 'security_advisory', 'kernel.org', 'kernel list archives', 'PRIMARY', ['kernel.security-boundaries', 'security.vulnerability-remediation', 'os.linux'], 'Official kernel CVE announce list.'),
    src('owasp-asvs', 'OWASP ASVS', 'https://owasp.org/www-project-application-security-verification-standard/', 'major_community', 'OWASP', 'CC-BY-SA', 'MAJOR_COMMUNITY', ['security.secure-coding'], 'Application Security Verification Standard. Community, not a substitute for RFC/NIST.'),
  ],
}

const WAVE8: DiscoveryWaveSpec = {
  waveId: 'wave-08-compilers-packages',
  scope: 'Compilers, build systems, and package ecosystems',
  taxonomyTargets: ['compiler', 'compiler.llvm', 'compiler.llvm.optimization', 'release.packaging'],
  queries: ['LLVM LangRef', 'GCC manuals', 'npm registry', 'PyPI', 'crates.io', 'Go modules', 'Maven', 'NuGet'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('llvm-langref', 'LLVM Language Reference', 'https://llvm.org/docs/LangRef.html', 'official_documentation', 'LLVM Project', 'Apache-2.0 with LLVM exceptions', 'PRIMARY', ['compiler.llvm', 'compiler.ir', 'compiler.llvm.optimization'], 'Official LLVM IR reference.'),
    src('llvm-passes', 'LLVM passes', 'https://llvm.org/docs/Passes.html', 'official_documentation', 'LLVM Project', 'Apache-2.0 with LLVM exceptions', 'OFFICIAL', ['compiler.llvm.optimization', 'compiler.optimization'], 'Official LLVM pass documentation.'),
    src('gcc-manual', 'GCC manuals', 'https://gcc.gnu.org/onlinedocs/', 'official_documentation', 'Free Software Foundation / GCC', 'GFDL', 'OFFICIAL', ['compiler.codegen', 'software.languages.c', 'software.languages.cpp'], 'Official GCC documentation.'),
    src('cmake-docs', 'CMake documentation', 'https://cmake.org/documentation/', 'official_documentation', 'Kitware / CMake', 'BSD-3-Clause', 'OFFICIAL', ['compiler.codegen', 'release.packaging'], 'Official CMake docs.'),
    src('npm-docs', 'npm documentation', 'https://docs.npmjs.com/', 'package_registry', 'npm / GitHub', 'npm docs license', 'OFFICIAL', ['software.languages.javascript', 'release.packaging'], 'Official npm registry documentation. Not a registry mirror.'),
    src('pypi-simple', 'PyPI', 'https://pypi.org/', 'package_registry', 'Python Software Foundation', 'PSF / warehouse', 'OFFICIAL', ['software.languages.python', 'release.packaging'], 'Official Python package index. Metadata only; no full mirror.'),
    src('crates-io', 'crates.io', 'https://crates.io/', 'package_registry', 'Rust Foundation', 'MIT/Apache-2.0 (index policy)', 'OFFICIAL', ['software.languages.rust', 'release.packaging'], 'Official Rust crate registry.'),
    src('go-modules', 'Go modules reference', 'https://go.dev/ref/mod', 'package_registry', 'Go project', 'BSD-3-Clause', 'OFFICIAL', ['software.languages.go', 'release.packaging'], 'Official Go modules reference.'),
    src('maven-central', 'Maven Central', 'https://central.sonatype.org/', 'package_registry', 'Sonatype / Maven Central', 'repository terms', 'OFFICIAL', ['software.languages.java', 'release.packaging'], 'Maven Central landing. Not a full mirror.'),
    src('nuget-docs', 'NuGet documentation', 'https://learn.microsoft.com/nuget/', 'package_registry', 'Microsoft', 'Microsoft documentation license', 'OFFICIAL', ['software.languages.csharp', 'release.packaging'], 'Official NuGet docs.'),
    src('rubygems', 'RubyGems', 'https://guides.rubygems.org/', 'package_registry', 'RubyGems', 'MIT', 'OFFICIAL', ['software.languages.ruby', 'release.packaging'], 'Official RubyGems guides.'),
    src('packagist', 'Packagist', 'https://packagist.org/', 'package_registry', 'Packagist / Composer', 'MIT', 'OFFICIAL', ['software.languages.php', 'release.packaging'], 'Official PHP package registry.'),
    src('conda-docs', 'Conda documentation', 'https://docs.conda.io/en/latest/', 'package_registry', 'Anaconda / conda', 'BSD-3-Clause', 'OFFICIAL', ['software.languages.python', 'ml.datasets', 'release.packaging'], 'Official conda documentation.'),
    src('debian-policy', 'Debian Policy Manual', 'https://www.debian.org/doc/debian-policy/', 'operating_system_documentation', 'Debian Project', 'GPL-2.0', 'OFFICIAL', ['os.linux', 'release.packaging'], 'Linux package ecosystem policy (Debian).'),
  ],
}

const WAVE9: DiscoveryWaveSpec = {
  waveId: 'wave-09-ml-ai-cuda',
  scope: 'ML/AI, CUDA, training, and inference',
  taxonomyTargets: ['ml', 'ml.cuda', 'ml.cuda.kernel-debugging', 'ml.vllm', 'ml.llama-cpp', 'ml.huggingface', 'ml.rocm'],
  queries: ['PyTorch docs', 'CUDA programming guide', 'vLLM', 'llama.cpp', 'Hugging Face Hub', 'ROCm', 'ONNX'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: AI_ML_REPOSITORY_REGISTRY,
}

const WAVE10: DiscoveryWaveSpec = {
  waveId: 'wave-10-graphics-desktop-mobile',
  scope: 'Graphics, desktop, and mobile',
  taxonomyTargets: ['graphics', 'desktop', 'mobile', 'frontend.webgpu'],
  queries: ['Vulkan spec', 'Android docs', 'Apple Human Interface', 'GTK', 'Qt'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('vulkan-spec', 'Vulkan specification', 'https://registry.khronos.org/vulkan/specs/latest/html/vkspec.html', 'official_specification', 'Khronos Group', 'Khronos specification license', 'PRIMARY', ['graphics.rendering', 'graphics.3d-pipelines', 'frontend.graphics'], 'Official Vulkan specification.'),
    src('android-docs', 'Android developer docs', 'https://developer.android.com/docs', 'official_documentation', 'Google / Android', 'CC-BY-2.5 / Apache-2.0 (code samples)', 'OFFICIAL', ['mobile.android-native', 'os.android'], 'Official Android documentation.'),
    src('apple-ios-docs', 'Apple iOS/iPadOS docs', 'https://developer.apple.com/documentation/uikit', 'official_documentation', 'Apple', 'Apple documentation license', 'OFFICIAL', ['mobile.ios-native', 'os.ios'], 'Official UIKit documentation.'),
    src('gtk-docs', 'GTK documentation', 'https://docs.gtk.org/gtk4/', 'official_documentation', 'GNOME / GTK', 'LGPLv2.1 / GFDL', 'OFFICIAL', ['desktop.native', 'desktop.system-integration'], 'Official GTK 4 docs.'),
    src('qt-docs', 'Qt documentation', 'https://doc.qt.io/', 'official_documentation', 'The Qt Company', 'GFDL / Qt commercial docs', 'OFFICIAL', ['desktop.qt'], 'Official Qt documentation hub.'),
  ],
}

const WAVE11: DiscoveryWaveSpec = {
  waveId: 'wave-11-embedded-hardware',
  scope: 'Embedded and hardware-facing software',
  taxonomyTargets: ['embedded', 'os.embedded', 'systems'],
  queries: ['Zephyr RTOS', 'Yocto', 'ARM AAPCS', 'FreeRTOS'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('zephyr-docs', 'Zephyr Project documentation', 'https://docs.zephyrproject.org/latest/', 'official_documentation', 'Zephyr Project / Linux Foundation', 'Apache-2.0', 'OFFICIAL', ['embedded.rtos', 'os.embedded'], 'Official Zephyr RTOS docs.'),
    src('yocto-docs', 'Yocto Project documentation', 'https://docs.yoctoproject.org/', 'official_documentation', 'Yocto Project / Linux Foundation', 'CC-BY-2.0 / MIT (as published)', 'OFFICIAL', ['embedded.firmware', 'os.embedded', 'release.packaging'], 'Official Yocto documentation.'),
    src('freertos-docs', 'FreeRTOS documentation', 'https://www.freertos.org/Documentation/RTOS_book.html', 'official_documentation', 'Amazon / FreeRTOS', 'MIT', 'OFFICIAL', ['embedded.rtos', 'os.embedded'], 'Official FreeRTOS book/docs.'),
    src('arm-aapcs', 'Procedure Call Standard for Arm Architecture', 'https://github.com/ARM-software/abi-aa', 'official_specification', 'Arm Limited', 'Apache-2.0 / Arm ABI license', 'PRIMARY', ['embedded.microcontrollers', 'software.languages.assembly', 'compiler.codegen'], 'Official Arm ABI documents repository (metadata only).'),
  ],
}

const WAVE12: DiscoveryWaveSpec = {
  waveId: 'wave-12-architecture-maintenance-release',
  scope: 'Architecture, maintenance, archaeology, and release engineering',
  taxonomyTargets: ['architecture', 'maintenance', 'archaeology', 'release'],
  queries: ['SemVer', 'Keep a Changelog', 'Software Heritage', 'SPDX', 'SLSA'],
  sourceCap: DISCOVERY_WAVE_SOURCE_CAP,
  sourcePriorities: PRIORITY,
  candidates: [
    src('semver', 'Semantic Versioning', 'https://semver.org/', 'recognized_standard', 'semver.org', 'CC-BY-3.0', 'STANDARD', ['release.versioning', 'release.packaging'], 'SemVer specification.'),
    src('keepachangelog', 'Keep a Changelog', 'https://keepachangelog.com/en/1.1.0/', 'major_community', 'Keep a Changelog', 'MIT', 'MAJOR_COMMUNITY', ['release.versioning', 'archaeology.release-archaeology'], 'Changelog convention. Community, not a language spec.'),
    src('software-heritage', 'Software Heritage', 'https://www.softwareheritage.org/', 'primary_repository', 'Software Heritage / Inria', 'CC-BY-4.0 (site)', 'PRIMARY', ['archaeology.unfamiliar-repositories', 'archaeology.patch-tracing'], 'Source-code archive. Inspection metadata only.'),
    src('spdx', 'SPDX specification', 'https://spdx.github.io/spdx-spec/', 'recognized_standard', 'Linux Foundation / SPDX', 'CC-BY-3.0', 'STANDARD', ['release.artifact-integrity', 'security.supply-chain'], 'Software Package Data Exchange spec.'),
    src('slsa', 'SLSA', 'https://slsa.dev/spec/latest/', 'recognized_standard', 'OpenSSF / SLSA', 'CC-BY-4.0', 'STANDARD', ['release.artifact-integrity', 'security.supply-chain'], 'Supply-chain levels for software artifacts.'),
    src('iso-25010', 'ISO/IEC 25010 overview (secondary pointer)', 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010', 'secondary', 'ISO/IEC (overview site)', 'ISO copyright; overview is secondary', 'SECONDARY', ['architecture.modular', 'maintenance.technical-debt'], 'Secondary overview of ISO 25010. Not a substitute for purchased ISO text.'),
  ],
}

export const DISCOVERY_REJECT_FIXTURES: DiscoveryCandidate[] = [
  {
    sourceId: 'blog-cuda-medium',
    title: 'Random CUDA blog',
    url: 'https://medium.com/p/not-a-primary-cuda-authority',
    sourceType: 'secondary',
    organization: 'Unaffiliated blog',
    license: 'unknown',
    version: null,
    authorityClass: 'SECONDARY',
    skillIds: ['ml.cuda'],
    notes: 'Blog posts are not primary authority.',
    rejectReason: 'blog',
  },
  {
    sourceId: 'incomplete-missing-url',
    title: 'Incomplete source',
    url: '',
    sourceType: 'secondary',
    organization: '',
    license: '',
    version: null,
    authorityClass: 'SECONDARY',
    skillIds: ['ml.cuda'],
    notes: 'Missing URL and organization.',
    rejectReason: 'incomplete',
  },
]

export const DISCOVERY_WAVES: DiscoveryWaveSpec[] = [
  WAVE1,
  WAVE2,
  WAVE3,
  WAVE4,
  WAVE5,
  WAVE6,
  WAVE7,
  WAVE8,
  WAVE9,
  WAVE10,
  WAVE11,
  WAVE12,
]

export function harvestKimiOfficialUrls(limit = 24): string[] {
  const files = [
    'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
    'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/02_bugs_patches.md',
    'docs/earth-knowledge/api-contracts-packages.md',
    'docs/earth-knowledge/api-contracts-swadvisories.md',
  ]
  const found: string[] = []
  const seen = new Set<string>()
  for (const rel of files) {
    const abs = path.join(resolveRepoRoot(), rel)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    const matches = text.match(/https:\/\/[^\s)\]>'"]+/g) ?? []
    for (const raw of matches) {
      const url = raw.replace(/[.,;]+$/, '')
      let host = ''
      try {
        host = new URL(url).hostname.toLowerCase()
      } catch {
        continue
      }
      if (!KIMI_OFFICIAL_HOST_ALLOWLIST.some(item => host === item || host.endsWith(`.${item}`))) continue
      if (seen.has(url)) continue
      seen.add(url)
      found.push(url)
      if (found.length >= limit) return found
    }
  }
  return found
}

export const COMPLETED_DISCOVERY_MISSION = {
  id: 'foundry-coding-capability-atlas-global-software-knowledge-discovery',
  title: 'FOUNDRY CODING CAPABILITY ATLAS — GLOBAL SOFTWARE KNOWLEDGE DISCOVERY',
  startNow: false,
  completed: true,
} as const
