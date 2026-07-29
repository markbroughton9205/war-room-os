'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CorpusManifest,
  DatasetAccessStatus,
  DatasetManifest,
  HardwareCapabilityReport,
  ProgramProjection,
  SovereignDatasetSourceFamily,
  SovereignDocumentRecord,
  SovereignModelLabProgram,
  TokenizerAlgorithm,
  TokenizerEnvironmentReport,
  TokenizerExperiment,
  TokenizerJobStatus,
  TrainingExperiment,
  TrainingScaleClass,
} from '@/lib/sovereign-model-lab/types'

type StatusResponse = {
  programs: SovereignModelLabProgram[]
  counts: { documents: number; sources: number; datasets: number; tokenizers: number; trainingPlans: number; checkpoints: number; models: number }
}

type ProgramDetail = {
  program: SovereignModelLabProgram
  hardware: HardwareCapabilityReport | null
  documents: SovereignDocumentRecord[]
  datasetManifest: DatasetManifest | null
  corpusManifest: CorpusManifest | null
  tokenizer: TokenizerExperiment | null
  trainingPlan: TrainingExperiment | null
  projection: ProgramProjection
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function bytesLabel(n: number | null): string {
  if (n === null) return 'unknown'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${n} B`
}

const ACCESS_STATUSES: DatasetAccessStatus[] = ['public', 'public_domain', 'open_license', 'commander_owned', 'commander_licensed', 'restricted', 'paywalled', 'authentication_required', 'robots_restricted', 'unknown', 'unavailable']
const SOURCE_FAMILIES: SovereignDatasetSourceFamily[] = ['government', 'international_organization', 'university', 'scientific_archive', 'legal_archive', 'historical_archive', 'encyclopedia', 'news_rss', 'public_api', 'direct_web', 'commander_library']

export function SovereignModelLabPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProgramDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])

  const [ingestPath, setIngestPath] = useState('')
  const [ingestAccess, setIngestAccess] = useState<DatasetAccessStatus>('commander_owned')

  const [tokenizerEnvironment, setTokenizerEnvironment] = useState<TokenizerEnvironmentReport | null>(null)
  const [tokenizerAlgorithm, setTokenizerAlgorithm] = useState<TokenizerAlgorithm>('bpe')
  const [tokenizerVocabSize, setTokenizerVocabSize] = useState(8192)
  const [tokenizerJobStatus, setTokenizerJobStatus] = useState<TokenizerJobStatus | null>(null)

  const refreshStatus = useCallback(async () => {
    const res = await fetch('/api/sovereign-model-lab/status').then(r => r.json()).catch(() => null)
    if (res) setStatus(res)
  }, [])

  const refreshDetail = useCallback(async (programId: string) => {
    const res = await fetch(`/api/sovereign-model-lab/programs/${programId}`).then(r => r.json()).catch(() => null)
    if (res?.program) setDetail(res)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshStatus])

  useEffect(() => {
    if (!selectedProgramId) return
    const timer = window.setTimeout(() => void refreshDetail(selectedProgramId), 0)
    return () => window.clearTimeout(timer)
  }, [selectedProgramId, refreshDetail])

  const runAction = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label)
      setError(null)
      try {
        await fn()
        await refreshStatus()
        if (selectedProgramId) await refreshDetail(selectedProgramId)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [refreshStatus, refreshDetail, selectedProgramId],
  )

  const beginProgram = () => {
    void runAction('begin', async () => {
      const result = await postJson<{ program: SovereignModelLabProgram; missing: string[] }>('/api/sovereign-model-lab/begin', { name: 'WRM-001' })
      if (!result.ok) throw new Error(result.error)
      if (result.data) {
        setSelectedProgramId(result.data.program.programId)
        setMissing(result.data.missing)
      }
    })
  }

  const ingestDocument = () => {
    if (!selectedProgramId || !ingestPath.trim()) return
    void runAction('ingest', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${selectedProgramId}/ingest`, {
        localPath: ingestPath,
        sourceType: 'commander_library',
        publisher: 'Commander',
        title: ingestPath,
        accessStatus: ingestAccess,
        license: { licenseId: null, licenseName: null, licenseUrl: null, permitsTrainingUse: ingestAccess === 'commander_owned' ? true : null, recordedBy: ingestAccess === 'commander_owned' ? 'commander_declared' : 'unknown', recordedAt: new Date().toISOString(), notes: '' },
        authorshipDocumented: ingestAccess === 'commander_owned',
      })
      if (!result.ok) throw new Error(result.error)
      setIngestPath('')
    })
  }

  const program = detail?.program
  const projection = detail?.projection

  // TOKENIZER LIVE PROGRESS — simple interval poll while training is actually running, matching
  // this subsystem's existing plain-fetch convention (no SSE). Reconciles real subprocess outcome
  // server-side on every tick; never trusts a client-side claim of completion.
  useEffect(() => {
    if (!selectedProgramId || program?.state !== 'tokenizer_training') {
      const timer = window.setTimeout(() => setTokenizerJobStatus(null), 0)
      return () => window.clearTimeout(timer)
    }
    const poll = () => {
      void fetch(`/api/sovereign-model-lab/programs/${selectedProgramId}/tokenizer-progress`)
        .then(r => r.json())
        .then((data: { jobStatus?: TokenizerJobStatus }) => {
          if (data.jobStatus) setTokenizerJobStatus(data.jobStatus)
          void refreshDetail(selectedProgramId)
          void refreshStatus()
        })
        .catch(() => {})
    }
    poll()
    const interval = window.setInterval(poll, 2000)
    return () => window.clearInterval(interval)
  }, [selectedProgramId, program?.state, refreshDetail, refreshStatus])

  const recheckProgramTruth = () => {
    if (!selectedProgramId) return
    void runAction('recheck-truth', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${selectedProgramId}/recheck-truth`, {})
      if (!result.ok) throw new Error(result.error)
    })
  }

  const buildCorpus = () => {
    if (!program) return
    void runAction('build-corpus', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/corpus`, {})
      if (!result.ok) throw new Error(result.error)
    })
  }

  const inspectTokenizerEnvironment = () => {
    if (!program) return
    void runAction('inspect-tokenizer-env', async () => {
      const result = await postJson<{ program: SovereignModelLabProgram; environment: TokenizerEnvironmentReport }>(
        `/api/sovereign-model-lab/programs/${program.programId}/tokenizer-environment`,
        {},
      )
      if (!result.ok) throw new Error(result.error)
      if (result.data) setTokenizerEnvironment(result.data.environment)
    })
  }

  const createTokenizerPlan = () => {
    if (!program) return
    void runAction('create-tokenizer-plan', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/tokenizer-plan`, {
        algorithm: tokenizerAlgorithm,
        vocabSize: tokenizerVocabSize,
      })
      if (!result.ok) throw new Error(result.error)
    })
  }

  const approveTokenizer = () => {
    if (!program) return
    void runAction('approve-tokenizer', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/tokenizer-approval`, {})
      if (!result.ok) throw new Error(result.error)
    })
  }

  const trainTokenizer = () => {
    if (!program) return
    const planHash = detail?.tokenizer?.plan?.planHash
    if (!planHash) return
    void runAction('train-tokenizer', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/tokenizer-train`, {
        tokenizerExecutionApproval: {
          kind: 'sovereign_model_lab_tokenizer_execution',
          granted: true,
          programId: program.programId,
          planHash,
          action: 'start_tokenizer_training',
        },
      })
      if (!result.ok) throw new Error(result.error)
    })
  }

  const cancelTokenizerJob = () => {
    if (!program) return
    void runAction('cancel-tokenizer', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/tokenizer-cancel`, {})
      if (!result.ok) throw new Error(result.error)
    })
  }

  const verifyTokenizer = () => {
    if (!program) return
    void runAction('verify-tokenizer', async () => {
      const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/tokenizer-verify`, {})
      if (!result.ok) throw new Error(result.error)
    })
  }

  return (
    <div className="space-y-4 text-[11px] text-slate-300">
      <section className="rounded border border-emerald-500/20 bg-black/25 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Sovereign Model Lab — Phase 1</p>
        <p className="mt-1 text-slate-500">
          Programs: {status?.programs.length ?? '—'} · Documents: {status?.counts.documents ?? '—'} · Sources: {status?.counts.sources ?? '—'} · Datasets: {status?.counts.datasets ?? '—'} · Tokenizer experiments: {status?.counts.tokenizers ?? '—'} · Training plans: {status?.counts.trainingPlans ?? '—'} · Checkpoints: {status?.counts.checkpoints ?? '—'} · Models: {status?.counts.models ?? '—'}
        </p>
        <button
          type="button"
          disabled={busy !== null}
          className="mt-3 rounded border border-emerald-400/60 bg-emerald-950/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-40"
          onClick={beginProgram}
        >
          {busy === 'begin' ? 'Running hardware audit…' : '[ BEGIN WAR ROOM MODEL 001 ]'}
        </button>
        {missing.length ? (
          <ul className="mt-2 list-disc pl-4 text-amber-400">
            {missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        ) : null}
        {error ? <p className="mt-2 text-red-400">{error}</p> : null}
      </section>

      {status && status.programs.length > 0 ? (
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Programs</p>
          <ul className="mt-2 space-y-1">
            {status.programs.map(p => (
              <li key={p.programId}>
                <button type="button" className={`w-full rounded border px-2 py-1 text-left ${selectedProgramId === p.programId ? 'border-emerald-400/60 bg-emerald-950/20' : 'border-white/10'}`} onClick={() => setSelectedProgramId(p.programId)}>
                  <span className="font-bold text-white">{p.name}</span>
                  <span className="ml-2 text-slate-500">{p.state}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {program && detail && projection ? (
        <>
          <section className={`rounded border p-3 ${projection.integrityContradictions.length ? 'border-rose-500/35 bg-rose-950/30' : 'border-white/10 bg-black/25'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Program State Integrity</p>
              <button type="button" disabled={busy !== null} className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40" onClick={recheckProgramTruth}>
                [ RECHECK PROGRAM TRUTH ]
              </button>
            </div>
            <p className="mt-1 text-white">Reported state: {projection.reportedState}{projection.migrationRequired ? ` (effective: ${projection.effectiveState})` : ''}</p>
            {projection.migrationRequired ? (
              <p className="mt-1 text-amber-300">Reported state is not backed by verified evidence. Click RECHECK PROGRAM TRUTH to reconcile the persisted record — this app never auto-corrects it.</p>
            ) : null}
            {projection.integrityContradictions.length ? (
              <div className="mt-2">
                <p className="font-bold uppercase tracking-widest text-rose-200">STATE INTEGRITY FAILURE</p>
                <ul className="mt-1 list-disc pl-4 text-rose-100">
                  {projection.integrityContradictions.map((c, i) => <li key={i}>{c.kind}: {c.detail}</li>)}
                </ul>
              </div>
            ) : (
              <p className="mt-1 text-emerald-400">No contradictions detected.</p>
            )}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Machine</p>
            {detail.hardware ? (
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                <div>OS: {detail.hardware.operatingSystem ?? 'unknown'}</div>
                <div>CPU: {detail.hardware.cpuModel ?? 'unknown'} ({detail.hardware.logicalCpuCount ?? '?'} cores)</div>
                <div>RAM: {bytesLabel(detail.hardware.totalRamBytes)}</div>
                <div>GPU: {detail.hardware.gpuName ?? 'not detected'}</div>
                <div>CUDA: {String(detail.hardware.cudaAvailable)}</div>
                <div>DirectML: {String(detail.hardware.directMlAvailable)}</div>
                <div>Free disk: {bytesLabel(detail.hardware.freeDiskBytes)}</div>
                <div>Python: {detail.hardware.pythonAvailable ? detail.hardware.pythonVersion : 'not detected'}</div>
                <div>Node: {detail.hardware.nodeVersion}</div>
                <div>Git: {detail.hardware.gitVersion ?? 'not detected'}</div>
                <div>WSL: {String(detail.hardware.wslAvailable)}</div>
              </div>
            ) : <p className="text-slate-500">No hardware report.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Local Training Capability</p>
            <p className="mt-1 text-white">{detail.hardware?.capabilityClasses.join(', ') ?? 'unknown'}</p>
            <p className="text-slate-500">{detail.hardware?.honestyNote}</p>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Data Sources</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SOURCE_FAMILIES.slice(0, 3).map(f => (
                <button
                  key={f}
                  type="button"
                  disabled={busy !== null}
                  className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40"
                  onClick={() => runAction('register-source', async () => {
                    const result = await postJson(`/api/sovereign-model-lab/sources`, {
                      programId: program.programId, family: f, label: `${f} source`, acquisitionMethod: 'manual_registration',
                      licenseOrTermsLocation: 'unspecified', updateFrequency: 'manual', supportedLanguages: ['en'],
                      expectedContentFormat: 'text', trainingEligibleByDefault: false, citationRequirements: 'cite publisher and retrieval date',
                    })
                    if (!result.ok) throw new Error(result.error)
                  })}
                >
                  Register {f}
                </button>
              ))}
            </div>
            <p className="mt-1 text-slate-500">Registered: {program.registeredSourceIds.length}</p>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Provenance Status / Document Ingest</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="flex-1 rounded border border-white/10 bg-black/40 p-1.5 text-white" placeholder="repo-relative local file path (no URLs)" value={ingestPath} onChange={e => setIngestPath(e.target.value)} />
              <select className="rounded border border-white/10 bg-black/40 p-1.5 text-white" value={ingestAccess} onChange={e => setIngestAccess(e.target.value as DatasetAccessStatus)}>
                {ACCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" disabled={busy !== null} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={ingestDocument}>Ingest</button>
              <button type="button" disabled={busy !== null} className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40" onClick={() => runAction('verify-provenance', async () => {
                const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/verify-provenance`, {})
                if (!result.ok) throw new Error(result.error)
              })}>Verify provenance</button>
            </div>
            <ul className="mt-2 space-y-1">
              {detail.documents.map(d => (
                <li key={d.id} className={d.allowedForTraining ? 'text-emerald-400' : 'text-amber-400'}>
                  {d.title} — {d.accessStatus} — {d.allowedForTraining ? 'admitted' : `excluded: ${d.exclusionReason}`}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dataset Candidates</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy !== null} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={() => runAction('build-dataset', async () => {
                const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/dataset-candidate`, {})
                if (!result.ok) throw new Error(result.error)
              })}>Build dataset candidate</button>
              <button type="button" disabled={busy !== null || program.state !== 'awaiting_commander_dataset_approval'} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={() => runAction('approve-dataset', async () => {
                const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/dataset-approval`, { approved: true })
                if (!result.ok) throw new Error(result.error)
              })}>Approve dataset</button>
            </div>
            {detail.datasetManifest ? (
              <div className="mt-2 text-slate-400">
                <p>Manifest {detail.datasetManifest.manifestId} — {detail.datasetManifest.documentCount} documents, ~{detail.datasetManifest.estimatedTokens.toLocaleString()} tokens, {detail.datasetManifest.duplicateCount} duplicates, {detail.datasetManifest.excluded.length} excluded.</p>
                <p>Commander approved: {String(detail.datasetManifest.commanderApproved)}</p>
              </div>
            ) : <p className="mt-1 text-slate-500">No dataset candidate yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Corpus</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy !== null || !detail.datasetManifest?.commanderApproved} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={buildCorpus}>
                [ BUILD CORPUS ARTIFACT ]
              </button>
            </div>
            {detail.corpusManifest ? (
              <div className="mt-2 text-slate-400">
                <p>Corpus {detail.corpusManifest.corpusId}/{detail.corpusManifest.version} — {detail.corpusManifest.documentCount} documents, {bytesLabel(detail.corpusManifest.byteCount)}, ~{detail.corpusManifest.estimatedTokenCount.toLocaleString()} estimated tokens, {detail.corpusManifest.duplicateCount} duplicates, {detail.corpusManifest.excludedCount} excluded.</p>
                <p>Record checksum: {detail.corpusManifest.recordChecksum.slice(0, 16)}… · Manifest checksum: {detail.corpusManifest.manifestChecksum.slice(0, 16)}…</p>
              </div>
            ) : <p className="mt-1 text-slate-500">No corpus artifact built yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Corpus Classification</p>
            {detail.corpusManifest ? (
              <p className={`mt-1 font-bold ${detail.corpusManifest.classification === 'validation_only' ? 'text-amber-300' : 'text-emerald-400'}`}>
                {detail.corpusManifest.classification.toUpperCase()}
                {detail.corpusManifest.classification === 'validation_only' ? ' — proves the pipeline only, not a meaningful training corpus.' : ''}
              </p>
            ) : <p className="mt-1 text-slate-500">No corpus built yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokenizer Environment</p>
              <button type="button" disabled={busy !== null} className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40" onClick={inspectTokenizerEnvironment}>
                [ INSPECT TOKENIZER ENVIRONMENT ]
              </button>
            </div>
            {tokenizerEnvironment ? (
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div>Status: <span className="font-bold text-white">{tokenizerEnvironment.status}</span></div>
                <div>Python: {tokenizerEnvironment.pythonExecutablePath ?? 'not detected'} ({tokenizerEnvironment.pythonVersion ?? 'unknown'})</div>
                <div>Architecture: {tokenizerEnvironment.architecture ?? 'unknown'}</div>
                <div>CPU count: {tokenizerEnvironment.cpuCount ?? 'unknown'}</div>
                <div>Available RAM: {bytesLabel(tokenizerEnvironment.availableRamBytes)}</div>
                <div>Free disk: {bytesLabel(tokenizerEnvironment.freeDiskBytes)}</div>
                <div>Writable output dir: {String(tokenizerEnvironment.writableOutputDir)}</div>
                <div>Network isolation enforceable: {String(tokenizerEnvironment.networkIsolationEnforceable)}</div>
                {tokenizerEnvironment.libraries.map(lib => (
                  <div key={lib.library}>{lib.library}: {lib.importable ? `v${lib.version} (py3.14: ${lib.python314Support})` : 'not importable'}</div>
                ))}
              </div>
            ) : <p className="mt-1 text-slate-500">Not inspected yet this session.</p>}
            {program.state === 'tokenizer_environment_blocked' ? (
              <div className="mt-2 rounded border border-rose-500/35 bg-rose-950/30 p-2">
                <p className="font-bold uppercase tracking-widest text-rose-200">Tokenizer Training Blocked</p>
                <p className="text-rose-100">Compatible local tokenizer library not installed.</p>
              </div>
            ) : null}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokenizer Execution Plan</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="rounded border border-white/10 bg-black/40 p-1.5 text-white" value={tokenizerAlgorithm} onChange={e => setTokenizerAlgorithm(e.target.value as TokenizerAlgorithm)}>
                <option value="bpe">bpe</option>
                <option value="unigram">unigram</option>
                <option value="wordpiece">wordpiece</option>
              </select>
              <input type="number" className="w-28 rounded border border-white/10 bg-black/40 p-1.5 text-white" value={tokenizerVocabSize} onChange={e => setTokenizerVocabSize(Number(e.target.value) || 8192)} />
              <button type="button" disabled={busy !== null || program.state !== 'tokenizer_environment_unverified'} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={createTokenizerPlan}>
                [ CREATE TOKENIZER PLAN ]
              </button>
              <button type="button" disabled={busy !== null || program.state !== 'tokenizer_plan_ready'} className="rounded border border-amber-500/40 px-2 py-1 text-amber-300 disabled:opacity-40" onClick={approveTokenizer}>
                [ APPROVE TOKENIZER TRAINING ]
              </button>
              <button type="button" disabled={busy !== null || program.state !== 'awaiting_commander_tokenizer_approval'} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40" onClick={trainTokenizer}>
                [ TRAIN WAR ROOM TOKENIZER ]
              </button>
              <button type="button" disabled={busy !== null || program.state !== 'tokenizer_training'} className="rounded border border-rose-500/40 px-2 py-1 text-rose-300 disabled:opacity-40" onClick={cancelTokenizerJob}>
                [ CANCEL TOKENIZER JOB ]
              </button>
              <button type="button" disabled={busy !== null || program.state !== 'tokenizer_verification'} className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40" onClick={verifyTokenizer}>
                [ VERIFY TOKENIZER ]
              </button>
            </div>
            {detail.tokenizer?.plan ? (
              <div className="mt-2 text-slate-400">
                <p>Algorithm: {detail.tokenizer.plan.algorithm} · Requested vocab: {detail.tokenizer.plan.requestedVocabSize} · Recommended vocab: {detail.tokenizer.plan.recommendedVocabSize}</p>
                {detail.tokenizer.plan.vocabSizeAdjustedReason ? <p className="text-amber-300">{detail.tokenizer.plan.vocabSizeAdjustedReason}</p> : null}
                <p>Corpus: {detail.tokenizer.plan.corpusManifestId}/{detail.tokenizer.plan.corpusVersion} ({detail.tokenizer.plan.corpusClassification})</p>
                <p>Executable: {detail.tokenizer.plan.executablePath}</p>
                <p className="break-all">Argv: {detail.tokenizer.plan.argv.join(' ')}</p>
                <p>Output dir: {detail.tokenizer.plan.outputDir}</p>
                <p>Max runtime: {Math.round(detail.tokenizer.plan.maxRuntimeMs / 1000)}s · Network policy: {detail.tokenizer.plan.networkPolicy}</p>
                <p>Plan hash: {detail.tokenizer.plan.planHash.slice(0, 16)}…</p>
                <p>Approval: {detail.tokenizer.approval ? `${detail.tokenizer.approval.approvalId} (consumed: ${String(Boolean(detail.tokenizer.approval.consumedAt))})` : 'not yet approved'}</p>
              </div>
            ) : <p className="mt-1 text-slate-500">No tokenizer plan yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokenizer Live Progress</p>
            {tokenizerJobStatus || detail.tokenizer?.jobStatus ? (
              (() => {
                const job = tokenizerJobStatus ?? detail.tokenizer!.jobStatus!
                return (
                  <div className="mt-1 text-slate-400">
                    <p>Job {job.jobId} — status: <span className="font-bold text-white">{job.status}</span> · exit code: {job.exitCode ?? 'n/a'}</p>
                    <p>Started: {job.startedAt} · Ended: {job.endedAt ?? 'in progress'}</p>
                    {job.stdoutTail ? <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-1 text-[10px]">{job.stdoutTail}</pre> : null}
                  </div>
                )
              })()
            ) : <p className="mt-1 text-slate-500">No tokenizer job running.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokenizer Artifacts</p>
            {detail.tokenizer?.artifactFiles.length ? (
              <ul className="mt-1 space-y-1">
                {detail.tokenizer.artifactFiles.map(f => (
                  <li key={f.fileName}>{f.fileName} — {bytesLabel(f.byteCount)} — sha256:{f.sha256.slice(0, 16)}…</li>
                ))}
              </ul>
            ) : <p className="mt-1 text-slate-500">No tokenizer artifacts yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokenizer Verification</p>
            {detail.tokenizer?.verification ? (
              <div className="mt-1">
                <p className={detail.tokenizer.verification.allMandatoryChecksPassed ? 'text-emerald-400' : 'text-rose-300'}>
                  All mandatory checks passed: {String(detail.tokenizer.verification.allMandatoryChecksPassed)}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {detail.tokenizer.verification.checks.map(c => (
                    <li key={c.id} className={c.passed ? 'text-emerald-400' : 'text-rose-300'}>{c.passed ? '✓' : '✗'} {c.label} — {c.detail}</li>
                  ))}
                </ul>
              </div>
            ) : <p className="mt-1 text-slate-500">Not verified yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Training Plans</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(['micro', 'tiny', 'small', 'research'] as TrainingScaleClass[]).map(scale => (
                <button key={scale} type="button" disabled={busy !== null || program.state !== 'tokenizer_ready'} className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40" onClick={() => runAction('plan-training', async () => {
                  const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/training-plan`, { scaleClass: scale, purpose: 'Phase 1 planning demonstration' })
                  if (!result.ok) throw new Error(result.error)
                })}>{scale}</button>
              ))}
              <button type="button" disabled={busy !== null || program.state !== 'training_plan_ready'} className="rounded border border-amber-500/40 px-2 py-1 text-amber-300 disabled:opacity-40" onClick={() => runAction('request-approval', async () => {
                const result = await postJson(`/api/sovereign-model-lab/programs/${program.programId}/request-training-approval`, {})
                if (!result.ok) throw new Error(result.error)
              })}>Request Commander training approval</button>
            </div>
            {detail.trainingPlan ? (
              <div className="mt-2 text-slate-400">
                <p>{detail.trainingPlan.scaleClass}: ~{detail.trainingPlan.estimatedParameterCount.toLocaleString()} params, ~{detail.trainingPlan.estimatedTrainingTokens.toLocaleString()} tokens</p>
                <p>Checkpoint size: {bytesLabel(detail.trainingPlan.estimatedCheckpointBytes)} · RAM required (recommended safe estimate): {bytesLabel(detail.trainingPlan.estimatedRamBytesRequired)}</p>
                <p>Runtime class: {detail.trainingPlan.estimatedRuntimeClass} · Current hardware can execute: {String(detail.trainingPlan.currentHardwareCanExecute)} · External compute required: {String(detail.trainingPlan.externalComputeRequired)}</p>
              </div>
            ) : <p className="mt-1 text-slate-500">No training plan yet.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Training Memory Estimate</p>
            {detail.trainingPlan?.memoryEstimate ? (
              <div className="mt-1 text-slate-400">
                <p>Precision: {detail.trainingPlan.memoryEstimate.precision} · Optimizer: {detail.trainingPlan.memoryEstimate.optimizer ?? 'n/a'} · Activation checkpointing: {String(detail.trainingPlan.memoryEstimate.activationCheckpointing)}</p>
                <ul className="mt-1 space-y-0.5">
                  {detail.trainingPlan.memoryEstimate.lineItems.map((item, i) => (
                    <li key={i}>{item.label}: {bytesLabel(item.bytes)} — {item.formula}</li>
                  ))}
                </ul>
                <p className="mt-1 text-white">Minimum estimate: {bytesLabel(detail.trainingPlan.memoryEstimate.minimumEstimateBytes)} · Recommended safe estimate: {bytesLabel(detail.trainingPlan.memoryEstimate.recommendedSafeEstimateBytes)}</p>
                <p>Uncertainty class: {detail.trainingPlan.memoryEstimate.uncertaintyClass}</p>
                <p className="text-slate-500">Known omissions: {detail.trainingPlan.memoryEstimate.knownOmissions.join(' ')}</p>
              </div>
            ) : <p className="mt-1 text-slate-500">No training plan yet — create one to see the itemized memory estimate.</p>}
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Checkpoint Vault</p>
            <p className="text-slate-500">{status?.counts.checkpoints ?? 0} checkpoint(s) — Phase 1 never produces a real trained checkpoint, so this is expected to stay at 0 in this phase.</p>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Model Registry</p>
            <p className="text-slate-500">{status?.counts.models ?? 0} model manifest(s) — none can be ownershipClass &quot;war_room_native&quot; without a real from-scratch training run, which Phase 1 does not perform.</p>
          </section>
        </>
      ) : null}
    </div>
  )
}
