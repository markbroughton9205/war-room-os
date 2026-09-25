import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

export type ResearchArtifactStatus = 'EXISTING' | 'NONE_FOUND'

export type ResearchArtifact = {
  category: string
  status: ResearchArtifactStatus
  paths: string[]
  notes: string
}

function repoPath(rel: string): string | null {
  const abs = path.join(resolveRepoRoot(), rel)
  return existsSync(abs) ? rel : null
}

function catalog(category: string, rels: string[], notes: string, noneNotes?: string): ResearchArtifact {
  const paths = rels.map(repoPath).filter((item): item is string => Boolean(item))
  if (!paths.length) {
    return { category, status: 'NONE_FOUND', paths: [], notes: noneNotes ?? 'NONE FOUND' }
  }
  return { category, status: 'EXISTING', paths, notes }
}

export function catalogExistingResearchArtifacts(): ResearchArtifact[] {
  return [
    catalog(
      'Earth Knowledge Source Registry',
      [
        'docs/research/earth-knowledge/earth_knowledge_source_registry.md',
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_integrated/master_registry.md',
        'docs/earth-knowledge/registry-parsed.md',
        'docs/earth-knowledge/gap-matrix.md',
        'lib/earth-knowledge/completionRegistry.generated.ts',
      ],
      'Canonical Earth Knowledge registry plus parsed/gap views. Not a coding-skill atlas.',
    ),
    catalog(
      'Kimi Swarm / KIMI_WAVE research',
      [
        'docs/research/earth-knowledge/KIMI_WAVE_REPORTS_PRESERVATION_MANIFEST.md',
        'docs/research/earth-knowledge/kimi-source-reports/plan_earth_kb.md',
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
        'lib/intelligence/kimiWaves/manifest.ts',
      ],
      'Kimi Wave discovery-swarm corpus. Kimi/Moonshot is not a live War Room model provider.',
    ),
    catalog(
      'Software / coding source discovery',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
        'docs/earth-knowledge/api-contracts-packages.md',
      ],
      'Package registries, forges, code search, standards hosts.',
    ),
    catalog(
      'Bugs / patch databases',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/02_bugs_patches.md',
        'docs/earth-knowledge/api-contracts-swadvisories.md',
      ],
      'OSV, NVD, GHSA and related advisory contracts.',
    ),
    catalog(
      'Cybersecurity databases',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/03_cybersecurity.md',
        'docs/earth-knowledge/api-contracts-cyber.md',
      ],
      'CVE ecosystem, ATT&CK, threat-intel sources.',
    ),
    catalog(
      'Standards',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave2/11_science_engineering_patents.md',
      ],
      'Standards coverage is embedded in coding + engineering reports. No standalone standards-only registry file.',
    ),
    catalog(
      'Package registries',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
        'docs/earth-knowledge/api-contracts-packages.md',
      ],
      'PyPI, npm, crates.io, Maven, RubyGems and live-probed contracts.',
    ),
    catalog(
      'Source repositories',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
      ],
      'GitHub/GitLab/Codeberg and Software Heritage coverage inside the coding wave report.',
    ),
    catalog(
      'Kernel documentation',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave1/01_software_coding.md',
      ],
      'kernel.org / lore.kernel.org recorded in the software coding wave report.',
    ),
    catalog(
      'Operating-system documentation',
      [
        'lib/native-builder/capability-atlas/osDocCorpus.ts',
      ],
      'Primary OS documentation references: Linux man-pages, systemd, Windows, Darwin/macOS, BSD. References only — not full OS source ingestion.',
    ),
    catalog(
      'AI / ML repositories',
      [
        'lib/native-builder/capability-atlas/aiMlRepositoryRegistry.ts',
      ],
      'Official AI/ML framework and inference-engine documentation/repository references (PyTorch, TensorFlow, JAX, CUDA, ROCm, Transformers, vLLM, llama.cpp, ONNX). No model weights. No training.',
    ),
    catalog(
      'Scientific and engineering repositories',
      [
        'docs/research/earth-knowledge/kimi-source-reports/earth_kb_wave2/11_science_engineering_patents.md',
      ],
      'arXiv, HEP, patents, materials, and engineering standards access notes.',
    ),
    catalog(
      'Capability atlas / skill registry research',
      [],
      '',
      'NONE FOUND as an Earth-knowledge discovery artifact. Internal Council/agent capability registries exist but are not this Atlas.',
    ),
  ]
}

export const NEXT_RESEARCH_MISSION = {
  id: 'foundry-coding-capability-atlas-targeted-skill-acquisition',
  title: 'TARGETED SKILL ACQUISITION + SANDBOX EVALUATION',
  startNow: false,
  use: [
    'Capability Atlas source-backed / LEARNABLE skills',
    'sandbox evaluation',
    'existing Foundry validators',
  ],
  doNot: [
    'treat documentation as mastery',
    'auto-promote to PROVEN without evaluation',
    'train WRIM',
    'commit or push',
    'modify Terra',
  ],
} as const
