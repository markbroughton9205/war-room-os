import type { TaxonomyNode } from './types'

type Spec = {
  id: string
  name: string
  aliases?: string[]
  keywords?: string[]
  description?: string
  children?: Spec[]
}

const TREE: Spec[] = [
  {
    id: 'software',
    name: 'Software',
    keywords: ['coding', 'programming', 'engineering'],
    children: [
      {
        id: 'software.languages',
        name: 'Programming Languages',
        children: [
          { id: 'software.languages.c', name: 'C', aliases: ['c language'] },
          { id: 'software.languages.cpp', name: 'C++', aliases: ['cplusplus', 'c++'] },
          { id: 'software.languages.csharp', name: 'C#', aliases: ['csharp', 'dotnet'] },
          { id: 'software.languages.rust', name: 'Rust', aliases: ['cargo'] },
          { id: 'software.languages.go', name: 'Go', aliases: ['golang'] },
          { id: 'software.languages.java', name: 'Java' },
          { id: 'software.languages.kotlin', name: 'Kotlin' },
          { id: 'software.languages.swift', name: 'Swift' },
          { id: 'software.languages.objective-c', name: 'Objective-C', aliases: ['objc'] },
          { id: 'software.languages.python', name: 'Python' },
          { id: 'software.languages.javascript', name: 'JavaScript', aliases: ['js', 'ecmascript', 'node'] },
          { id: 'software.languages.typescript', name: 'TypeScript', aliases: ['ts'] },
          { id: 'software.languages.php', name: 'PHP' },
          { id: 'software.languages.ruby', name: 'Ruby' },
          { id: 'software.languages.lua', name: 'Lua' },
          { id: 'software.languages.r', name: 'R' },
          { id: 'software.languages.julia', name: 'Julia' },
          { id: 'software.languages.matlab', name: 'MATLAB' },
          { id: 'software.languages.bash', name: 'Bash', aliases: ['shell', 'sh'] },
          { id: 'software.languages.powershell', name: 'PowerShell', aliases: ['pwsh'] },
          { id: 'software.languages.sql', name: 'SQL' },
          { id: 'software.languages.assembly', name: 'Assembly', aliases: ['asm'] },
          { id: 'software.languages.webassembly', name: 'WebAssembly', aliases: ['wasm'] },
          {
            id: 'software.languages.functional',
            name: 'Functional Languages',
            children: [
              { id: 'software.languages.functional.haskell', name: 'Haskell' },
              { id: 'software.languages.functional.ocaml', name: 'OCaml' },
              { id: 'software.languages.functional.elixir', name: 'Elixir' },
              { id: 'software.languages.functional.erlang', name: 'Erlang' },
              { id: 'software.languages.functional.clojure', name: 'Clojure' },
              { id: 'software.languages.functional.fsharp', name: 'F#', aliases: ['fsharp'] },
              { id: 'software.languages.functional.scala', name: 'Scala' },
              { id: 'software.languages.functional.lisp', name: 'Lisp' },
            ],
          },
          {
            id: 'software.languages.scripting',
            name: 'Scripting Languages',
            children: [
              { id: 'software.languages.scripting.perl', name: 'Perl' },
              { id: 'software.languages.scripting.awk', name: 'Awk' },
              { id: 'software.languages.scripting.tcl', name: 'Tcl' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'frontend',
    name: 'Frontend',
    aliases: ['ui', 'web ui'],
    children: [
      { id: 'frontend.html', name: 'HTML' },
      { id: 'frontend.css', name: 'CSS', aliases: ['stylesheets'] },
      { id: 'frontend.react', name: 'React', aliases: ['jsx', 'tsx'] },
      { id: 'frontend.nextjs', name: 'Next.js', aliases: ['next', 'app router'] },
      { id: 'frontend.vue', name: 'Vue' },
      { id: 'frontend.svelte', name: 'Svelte' },
      { id: 'frontend.angular', name: 'Angular' },
      { id: 'frontend.accessibility', name: 'Accessibility', aliases: ['a11y', 'aria', 'wcag'] },
      { id: 'frontend.responsive', name: 'Responsive UI', aliases: ['mobile layout'] },
      { id: 'frontend.browser-apis', name: 'Browser APIs', aliases: ['dom', 'fetch'] },
      { id: 'frontend.webgl', name: 'WebGL' },
      { id: 'frontend.webgpu', name: 'WebGPU' },
      { id: 'frontend.canvas', name: 'Canvas' },
      { id: 'frontend.graphics', name: 'Graphics' },
      { id: 'frontend.react.performance', name: 'React Performance', aliases: ['react render', 'hydration'] },
    ],
  },
  {
    id: 'backend',
    name: 'Backend',
    children: [
      { id: 'backend.rest', name: 'REST', aliases: ['http api'] },
      { id: 'backend.graphql', name: 'GraphQL' },
      { id: 'backend.websocket', name: 'WebSockets', aliases: ['ws'] },
      { id: 'backend.rpc', name: 'RPC', aliases: ['grpc', 'json-rpc'] },
      { id: 'backend.queues', name: 'Queues' },
      { id: 'backend.workers', name: 'Workers' },
      { id: 'backend.distributed-systems', name: 'Distributed Systems' },
      { id: 'backend.caching', name: 'Caching' },
      { id: 'backend.sessions', name: 'Sessions' },
      { id: 'backend.authentication', name: 'Authentication', aliases: ['authn', 'login'] },
      { id: 'backend.authorization', name: 'Authorization', aliases: ['authz', 'rbac'] },
      { id: 'backend.rate-limiting', name: 'Rate Limiting' },
    ],
  },
  {
    id: 'database',
    name: 'Databases',
    aliases: ['data stores'],
    children: [
      { id: 'database.postgresql', name: 'PostgreSQL', aliases: ['postgres', 'psql'] },
      { id: 'database.mysql', name: 'MySQL' },
      { id: 'database.sqlite', name: 'SQLite' },
      { id: 'database.redis', name: 'Redis' },
      { id: 'database.mongodb', name: 'MongoDB' },
      { id: 'database.graph', name: 'Graph Databases', aliases: ['neo4j'] },
      { id: 'database.vector', name: 'Vector Databases', aliases: ['embeddings'] },
      { id: 'database.search', name: 'Search Engines', aliases: ['elasticsearch', 'opensearch'] },
      { id: 'database.migrations', name: 'Migrations' },
      { id: 'database.transactions', name: 'Transactions' },
      { id: 'database.indexing', name: 'Indexing' },
      { id: 'database.query-planning', name: 'Query Planning', aliases: ['explain'] },
      { id: 'database.query-optimization', name: 'Query Optimization' },
    ],
  },
  {
    id: 'systems',
    name: 'Systems',
    children: [
      { id: 'systems.memory', name: 'Memory Management', aliases: ['alloc', 'heap'] },
      { id: 'systems.threads', name: 'Threads' },
      { id: 'systems.processes', name: 'Processes', aliases: ['process-management', 'linux.process-management'] },
      { id: 'systems.ipc', name: 'IPC' },
      { id: 'systems.filesystems', name: 'Filesystems' },
      { id: 'systems.networking', name: 'Networking' },
      { id: 'systems.sockets', name: 'Sockets' },
      { id: 'systems.signals', name: 'Signals' },
      { id: 'systems.concurrency', name: 'Concurrency' },
      { id: 'systems.synchronization', name: 'Synchronization' },
      { id: 'systems.shared-memory', name: 'Shared Memory' },
      { id: 'systems.runtime', name: 'Runtime Systems' },
      { id: 'systems.interrupts', name: 'Interrupts' },
    ],
  },
  {
    id: 'os',
    name: 'Operating Systems',
    children: [
      { id: 'os.linux', name: 'Linux' },
      { id: 'os.windows', name: 'Windows' },
      { id: 'os.macos', name: 'macOS', aliases: ['osx', 'darwin'] },
      { id: 'os.android', name: 'Android' },
      { id: 'os.ios', name: 'iOS' },
      { id: 'os.embedded', name: 'Embedded Systems' },
      { id: 'os.bootloaders', name: 'Bootloaders' },
      { id: 'os.kernels', name: 'Kernels' },
      { id: 'os.drivers', name: 'Drivers' },
      { id: 'os.system-services', name: 'System Services', aliases: ['systemd', 'daemons'] },
      { id: 'os.bsd', name: 'BSD', aliases: ['freebsd', 'openbsd', 'netbsd'] },
      { id: 'os.linux.man-pages', name: 'Linux Manual Pages', aliases: ['man7', 'man-pages'] },
      { id: 'os.linux.systemd', name: 'systemd' },
    ],
  },
  {
    id: 'kernel',
    name: 'Kernel Engineering',
    children: [
      { id: 'kernel.architecture', name: 'Architecture Support' },
      { id: 'kernel.scheduler', name: 'Scheduler' },
      { id: 'kernel.memory-management', name: 'Virtual Memory', aliases: ['mm', 'vmm'] },
      { id: 'kernel.syscalls', name: 'Syscalls' },
      { id: 'kernel.interrupts', name: 'Interrupts' },
      { id: 'kernel.device-drivers', name: 'Device Drivers', aliases: ['drivers'] },
      { id: 'kernel.filesystems', name: 'Kernel Filesystems' },
      { id: 'kernel.network-stacks', name: 'Network Stacks' },
      { id: 'kernel.security-boundaries', name: 'Security Boundaries' },
      { id: 'kernel.boot', name: 'Boot' },
      { id: 'kernel.module-build', name: 'Kernel Module Build', aliases: ['kbuild', 'out-of-tree'] },
      { id: 'kernel.device-drivers.usb', name: 'USB Device Drivers', aliases: ['usb'] },
    ],
  },
  {
    id: 'cloud',
    name: 'Cloud / Infrastructure',
    children: [
      { id: 'cloud.docker', name: 'Docker', aliases: ['containers'] },
      { id: 'cloud.kubernetes', name: 'Kubernetes', aliases: ['k8s'] },
      { id: 'cloud.terraform', name: 'Terraform' },
      { id: 'cloud.cicd', name: 'CI/CD' },
      { id: 'cloud.observability', name: 'Observability' },
      { id: 'cloud.logging', name: 'Logging' },
      { id: 'cloud.metrics', name: 'Metrics' },
      { id: 'cloud.tracing', name: 'Tracing' },
      { id: 'cloud.load-balancing', name: 'Load Balancing' },
      { id: 'cloud.deployment', name: 'Deployment' },
      { id: 'cloud.secrets', name: 'Secrets' },
      { id: 'cloud.backups', name: 'Backups' },
      { id: 'cloud.recovery', name: 'Recovery' },
    ],
  },
  {
    id: 'testing',
    name: 'Testing',
    children: [
      { id: 'testing.unit', name: 'Unit Testing' },
      { id: 'testing.integration', name: 'Integration Testing' },
      { id: 'testing.e2e', name: 'E2E Testing' },
      { id: 'testing.property', name: 'Property Testing' },
      { id: 'testing.fuzzing', name: 'Fuzzing' },
      { id: 'testing.regression', name: 'Regression Testing' },
      { id: 'testing.load', name: 'Load Testing' },
      { id: 'testing.performance', name: 'Performance Testing' },
      { id: 'testing.browser-automation', name: 'Browser Automation', aliases: ['playwright', 'cypress', 'selenium'] },
      { id: 'testing.mutation', name: 'Mutation Testing' },
      { id: 'testing.targeted', name: 'Targeted Testing' },
    ],
  },
  {
    id: 'debugging',
    name: 'Debugging',
    children: [
      { id: 'debugging.stack-traces', name: 'Stack Traces' },
      { id: 'debugging.profiling', name: 'Profiling' },
      { id: 'debugging.memory-leaks', name: 'Memory Leaks' },
      { id: 'debugging.deadlocks', name: 'Deadlocks' },
      { id: 'debugging.race-conditions', name: 'Race Conditions' },
      { id: 'debugging.network-faults', name: 'Network Faults' },
      { id: 'debugging.database-faults', name: 'Database Faults' },
      { id: 'debugging.browser', name: 'Browser Debugging' },
      { id: 'debugging.distributed-tracing', name: 'Distributed Tracing' },
      { id: 'debugging.runtime', name: 'Runtime Debugging', aliases: ['oom', 'crash'] },
    ],
  },
  {
    id: 'security',
    name: 'Security Engineering',
    children: [
      { id: 'security.secure-coding', name: 'Secure Coding' },
      { id: 'security.auth', name: 'Authentication' },
      { id: 'security.authorization', name: 'Authorization' },
      { id: 'security.crypto-usage', name: 'Cryptography Usage', aliases: ['crypto'] },
      { id: 'security.secrets', name: 'Secrets' },
      { id: 'security.permissions', name: 'Permissions' },
      { id: 'security.sandboxing', name: 'Sandboxing' },
      { id: 'security.dependency-security', name: 'Dependency Security' },
      { id: 'security.vulnerability-remediation', name: 'Vulnerability Remediation' },
      { id: 'security.supply-chain', name: 'Supply-Chain Security' },
    ],
  },
  {
    id: 'ml',
    name: 'AI / ML',
    aliases: ['machine learning', 'ai'],
    children: [
      { id: 'ml.pytorch', name: 'PyTorch', aliases: ['torch'] },
      { id: 'ml.jax', name: 'JAX' },
      { id: 'ml.tensorflow', name: 'TensorFlow' },
      { id: 'ml.training', name: 'Training', keywords: ['wrim', 'finetune'] },
      { id: 'ml.training.memory', name: 'Training Memory', aliases: ['oom', 'batch size'] },
      { id: 'ml.datasets', name: 'Datasets' },
      { id: 'ml.tokenization', name: 'Tokenizers', aliases: ['tokenizer'] },
      { id: 'ml.evaluation', name: 'Evaluation' },
      { id: 'ml.quantization', name: 'Quantization' },
      { id: 'ml.cuda', name: 'CUDA', aliases: ['gpu', 'nvidia'] },
      { id: 'ml.distributed-training', name: 'Distributed Training' },
      { id: 'ml.inference', name: 'Inference' },
      { id: 'ml.serving', name: 'Serving' },
      { id: 'ml.onnx', name: 'ONNX' },
      { id: 'ml.model-optimization', name: 'Model Optimization' },
      { id: 'ml.llm-systems', name: 'LLM Systems', aliases: ['wrim', 'ollama'] },
      { id: 'ml.cuda.kernel-debugging', name: 'CUDA Kernel Debugging', aliases: ['cuda-gdb', 'nsight'] },
      { id: 'ml.vllm', name: 'vLLM' },
      { id: 'ml.llama-cpp', name: 'llama.cpp', aliases: ['gguf'] },
      { id: 'ml.huggingface', name: 'Hugging Face Hub', aliases: ['transformers', 'hf'] },
      { id: 'ml.rocm', name: 'ROCm', aliases: ['amd gpu'] },
    ],
  },
  {
    id: 'compiler',
    name: 'Compilers',
    children: [
      { id: 'compiler.lexing', name: 'Lexers', aliases: ['lexer', 'tokenizer'] },
      { id: 'compiler.parsing', name: 'Parsers' },
      { id: 'compiler.ast', name: 'AST' },
      { id: 'compiler.ast.symbol-resolution', name: 'Symbol Resolution', aliases: ['bindings'] },
      { id: 'compiler.type-checking', name: 'Type Checking' },
      { id: 'compiler.ir', name: 'IR' },
      { id: 'compiler.optimization', name: 'Optimization' },
      { id: 'compiler.codegen', name: 'Code Generation' },
      { id: 'compiler.interpreters', name: 'Interpreters' },
      { id: 'compiler.jit', name: 'JIT' },
      { id: 'compiler.aot', name: 'AOT' },
      { id: 'compiler.llvm', name: 'LLVM' },
      { id: 'compiler.llvm.optimization', name: 'LLVM Optimization' },
    ],
  },
  {
    id: 'graphics',
    name: 'Graphics / Game / 3D',
    children: [
      { id: 'graphics.rendering', name: 'Rendering' },
      { id: 'graphics.shaders', name: 'Shaders' },
      { id: 'graphics.gpu-compute', name: 'GPU Compute' },
      { id: 'graphics.physics', name: 'Physics' },
      { id: 'graphics.animation', name: 'Animation' },
      { id: 'graphics.engines', name: 'Engines' },
      { id: 'graphics.spatial-math', name: 'Spatial Math' },
      { id: 'graphics.3d-pipelines', name: '3D Pipelines' },
    ],
  },
  {
    id: 'mobile',
    name: 'Mobile',
    children: [
      { id: 'mobile.android-native', name: 'Android Native' },
      { id: 'mobile.ios-native', name: 'iOS Native' },
      { id: 'mobile.react-native', name: 'React Native' },
      { id: 'mobile.flutter', name: 'Flutter' },
      { id: 'mobile.networking', name: 'Mobile Networking' },
      { id: 'mobile.storage', name: 'Mobile Storage' },
      { id: 'mobile.packaging', name: 'Mobile Packaging' },
    ],
  },
  {
    id: 'desktop',
    name: 'Desktop',
    children: [
      { id: 'desktop.electron', name: 'Electron' },
      { id: 'desktop.tauri', name: 'Tauri' },
      { id: 'desktop.qt', name: 'Qt' },
      { id: 'desktop.native', name: 'Native Desktop' },
      { id: 'desktop.installers', name: 'Installers' },
      { id: 'desktop.updates', name: 'Updates' },
      { id: 'desktop.system-integration', name: 'System Integration', aliases: ['at-spi', 'accessibility tree'] },
    ],
  },
  {
    id: 'data-engineering',
    name: 'Data Engineering',
    children: [
      { id: 'data-engineering.etl', name: 'ETL' },
      { id: 'data-engineering.elt', name: 'ELT' },
      { id: 'data-engineering.streaming', name: 'Streaming' },
      { id: 'data-engineering.arrow', name: 'Arrow' },
      { id: 'data-engineering.parquet', name: 'Parquet' },
      { id: 'data-engineering.data-lakes', name: 'Data Lakes' },
      { id: 'data-engineering.warehouses', name: 'Warehouses' },
      { id: 'data-engineering.pipelines', name: 'Pipelines' },
      { id: 'data-engineering.schema-evolution', name: 'Schema Evolution' },
    ],
  },
  {
    id: 'networking',
    name: 'Networking',
    children: [
      { id: 'networking.tcpip', name: 'TCP/IP', aliases: ['tcp', 'ip'] },
      { id: 'networking.udp', name: 'UDP' },
      { id: 'networking.dns', name: 'DNS' },
      { id: 'networking.http', name: 'HTTP' },
      { id: 'networking.http3', name: 'HTTP/3', aliases: ['h3'] },
      { id: 'networking.tls', name: 'TLS', aliases: ['ssl'] },
      { id: 'networking.quic', name: 'QUIC' },
      { id: 'networking.webrtc', name: 'WebRTC' },
      { id: 'networking.proxies', name: 'Proxies' },
      { id: 'networking.routing', name: 'Routing' },
      { id: 'networking.diagnostics', name: 'Network Diagnostics' },
    ],
  },
  {
    id: 'embedded',
    name: 'Embedded / Robotics',
    children: [
      { id: 'embedded.microcontrollers', name: 'Microcontrollers', aliases: ['mcu'] },
      { id: 'embedded.rtos', name: 'RTOS' },
      { id: 'embedded.gpio', name: 'GPIO' },
      { id: 'embedded.serial', name: 'Serial' },
      { id: 'embedded.can', name: 'CAN' },
      { id: 'embedded.sensors', name: 'Sensors' },
      { id: 'embedded.actuators', name: 'Actuators' },
      { id: 'embedded.firmware', name: 'Firmware' },
      { id: 'embedded.robot-control', name: 'Robot Control' },
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    children: [
      { id: 'performance.cpu', name: 'CPU' },
      { id: 'performance.gpu', name: 'GPU' },
      { id: 'performance.gpu-memory', name: 'GPU Memory', aliases: ['vram', 'cuda oom'] },
      { id: 'performance.memory', name: 'Memory' },
      { id: 'performance.io', name: 'IO' },
      { id: 'performance.latency', name: 'Latency' },
      { id: 'performance.throughput', name: 'Throughput' },
      { id: 'performance.benchmarking', name: 'Benchmarking' },
      { id: 'performance.profiling', name: 'Profiling' },
      { id: 'performance.vectorization', name: 'Vectorization' },
      { id: 'performance.parallelism', name: 'Parallelism' },
    ],
  },
  {
    id: 'architecture',
    name: 'Architecture',
    children: [
      { id: 'architecture.monoliths', name: 'Monoliths' },
      { id: 'architecture.modular', name: 'Modular Systems' },
      { id: 'architecture.services', name: 'Services' },
      { id: 'architecture.event-driven', name: 'Event-Driven Systems' },
      { id: 'architecture.plugins', name: 'Plugins' },
      { id: 'architecture.domain-modeling', name: 'Domain Modeling' },
      { id: 'architecture.message-driven', name: 'Message-Driven Systems' },
    ],
  },
  {
    id: 'maintenance',
    name: 'Software Maintenance',
    children: [
      { id: 'maintenance.refactoring', name: 'Refactoring' },
      { id: 'maintenance.migration', name: 'Migration' },
      { id: 'maintenance.compatibility', name: 'Compatibility' },
      { id: 'maintenance.deprecation', name: 'Deprecation' },
      { id: 'maintenance.dependency-upgrades', name: 'Dependency Upgrades' },
      { id: 'maintenance.legacy', name: 'Legacy Systems' },
      { id: 'maintenance.technical-debt', name: 'Technical Debt' },
    ],
  },
  {
    id: 'archaeology',
    name: 'Software Archaeology',
    children: [
      { id: 'archaeology.unfamiliar-repositories', name: 'Unfamiliar Repositories' },
      { id: 'archaeology.ownership-discovery', name: 'Ownership Discovery' },
      { id: 'archaeology.dependency-mapping', name: 'Dependency Mapping' },
      { id: 'archaeology.bug-history', name: 'Bug-History Reconstruction' },
      { id: 'archaeology.release-archaeology', name: 'Release Archaeology' },
      { id: 'archaeology.patch-tracing', name: 'Patch Tracing' },
    ],
  },
  {
    id: 'release',
    name: 'Release Engineering',
    children: [
      { id: 'release.versioning', name: 'Versioning' },
      { id: 'release.packaging', name: 'Packaging' },
      { id: 'release.installers', name: 'Installers' },
      { id: 'release.code-signing', name: 'Code Signing' },
      { id: 'release.channels', name: 'Release Channels' },
      { id: 'release.rollback', name: 'Rollback' },
      { id: 'release.updates', name: 'Updates' },
      { id: 'release.artifact-integrity', name: 'Artifact Integrity' },
      { id: 'release.production-activation', name: 'Production Activation' },
    ],
  },
  {
    id: 'foundry',
    name: 'Foundry Native',
    description: 'War Room Foundry-specific engineering capabilities. General coding skills live outside this domain.',
    children: [
      { id: 'foundry.tool-broker-governance', name: 'Tool Broker Governance' },
      { id: 'foundry.code-intelligence', name: 'Code Intelligence' },
      { id: 'foundry.engineering-memory', name: 'Engineering Memory' },
      { id: 'foundry.bounded-edit', name: 'Bounded Edit' },
      { id: 'foundry.binding-protection', name: 'Binding Protection' },
      { id: 'foundry.production-lease', name: 'Production Lease' },
      { id: 'foundry.computer-use-atspi', name: 'Computer Use AT-SPI' },
      { id: 'foundry.browser-playwright', name: 'Browser Playwright' },
      { id: 'foundry.application-builder', name: 'Application Builder' },
    ],
  },
]

function flatten(spec: Spec, parentId: string | null, depth: number, into: TaxonomyNode[]): void {
  const id = parentId ? (spec.id.includes('.') ? spec.id : `${parentId}.${spec.id}`) : spec.id
  const keywords = Array.from(new Set([
    spec.name.toLowerCase(),
    id.split('.').pop() ?? '',
    ...(spec.aliases ?? []).map(item => item.toLowerCase()),
    ...(spec.keywords ?? []).map(item => item.toLowerCase()),
  ].filter(Boolean)))
  into.push({
    id,
    name: spec.name,
    parentId,
    depth,
    aliases: spec.aliases ?? [],
    keywords,
    description: spec.description ?? spec.name,
    extensible: true,
  })
  for (const child of spec.children ?? []) flatten(child, id, depth + 1, into)
}

let cached: TaxonomyNode[] | null = null

export function loadTaxonomy(): TaxonomyNode[] {
  if (cached) return cached
  const nodes: TaxonomyNode[] = []
  for (const root of TREE) flatten(root, null, 0, nodes)
  cached = nodes
  return nodes
}

export function taxonomyById(): Map<string, TaxonomyNode> {
  return new Map(loadTaxonomy().map(node => [node.id, node]))
}

export function taxonomyChildren(id: string): TaxonomyNode[] {
  return loadTaxonomy().filter(node => node.parentId === id)
}

export function taxonomyLeaves(): TaxonomyNode[] {
  const nodes = loadTaxonomy()
  const parents = new Set(nodes.map(node => node.parentId).filter(Boolean) as string[])
  return nodes.filter(node => !parents.has(node.id) && node.depth > 0)
}

export function findTaxonomyNodes(query: string): TaxonomyNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const tokens = needle.split(/[^a-z0-9.+#/-]+/i).filter(token => token.length >= 2)
  return loadTaxonomy().filter(node => {
    const hay = `${node.id} ${node.name} ${node.aliases.join(' ')} ${node.keywords.join(' ')}`.toLowerCase()
    return tokens.some(token => hay.includes(token) || node.id === token)
  })
}
