'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'
import { HVS_CANONICAL_PATH } from '@/lib/media-command/navigation'
import { DESTRUCTION_CAMERAS, sampleNode, type HvsDestructionPlayback } from '@/lib/media-command/destruction/playback'
import Link from 'next/link'
import './hvs-destruction-previs.css'

type Payload = {
  playback: HvsDestructionPlayback
  steps: string[]
  simulationRuns: number
}

export function HvsDestructionPrevisScreen({ projectId }: { projectId: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [cameraId, setCameraId] = useState<'front' | 'three-quarter'>('front')
  const frameRef = useRef(0)
  const playingRef = useRef(false)
  const meshesRef = useRef<Mesh[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/media-command/destruction?projectId=${encodeURIComponent(projectId)}`)
      .then(async res => {
        const body = await res.json() as Payload & { error?: string }
        if (!res.ok) throw new Error(body.error ?? 'No destruction previs yet.')
        if (!cancelled) setPayload(body)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No destruction previs yet.')
      })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    const nodes = payload?.playback.nodes
    if (!nodes) return
    nodes.forEach((node, index) => {
      const mesh = meshesRef.current[index]
      if (!mesh) return
      const sample = sampleNode(node, frame)
      mesh.position.set(sample.x, sample.y, sample.z)
      mesh.rotation.z = sample.tilt
      mesh.visible = sample.y > -1
    })
  }, [frame, payload])

  useEffect(() => {
    const host = mountRef.current
    if (!host || !payload) return
    const playback = payload.playback
    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth || 960, 540)
    renderer.setClearColor(new Color('#0e1014'))
    host.appendChild(renderer.domElement)
    const scene = new Scene()
    const camera = new PerspectiveCamera(playback.camera.fov, (host.clientWidth || 960) / 540, 0.1, 80)
    const applyCamera = (id: 'front' | 'three-quarter') => {
      const spec = DESTRUCTION_CAMERAS[id]
      camera.position.set(spec.position.x, spec.position.y, spec.position.z)
      camera.lookAt(spec.lookAt.x, spec.lookAt.y, spec.lookAt.z)
      camera.fov = spec.fov
      camera.updateProjectionMatrix()
    }
    applyCamera(cameraId)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.3, 0)
    controls.update()
    scene.add(new AmbientLight('#f2efe6', 0.7))
    const sun = new DirectionalLight('#fff4d2', 1.4)
    sun.position.set(4, 8, 6)
    scene.add(sun)
    const ground = new Mesh(
      new BoxGeometry(14, 0.08, 8),
      new MeshStandardMaterial({ color: '#3a3c36', roughness: 0.95 }),
    )
    ground.position.y = 0.04
    scene.add(ground)
    const meshes = playback.nodes.map(node => {
      const mesh = new Mesh(
        new BoxGeometry(node.size.x, node.size.y, node.size.z),
        new MeshStandardMaterial({
          color: node.role === 'SECONDARY_DEBRIS' ? '#6e655b' : node.supportClass === 'RIGHT_SUPPORT' ? '#c6b080' : '#a8a49c',
          roughness: 0.86,
        }),
      )
      const sample = sampleNode(node, frameRef.current)
      mesh.position.set(sample.x, sample.y, sample.z)
      mesh.rotation.z = sample.tilt
      scene.add(mesh)
      return mesh
    })
    meshesRef.current = meshes
    let raf = 0
    let last = performance.now()
    const draw = (now: number) => {
      if (playingRef.current && now - last > 1000 / playback.fps) {
        last = now
        const next = (frameRef.current + 1) % playback.frameCount
        frameRef.current = next
        setFrame(next)
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    const onResize = () => {
      const width = host.clientWidth || 960
      camera.aspect = width / 540
      camera.updateProjectionMatrix()
      renderer.setSize(width, 540)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [payload, cameraId])

  const summary = payload?.playback.summary ?? 'Destruction previs'
  return (
    <main className="hvs-destruct" data-testid="hvs-destruction-previs" data-sim-runs={payload?.simulationRuns ?? 0}>
      <div className="hvs-destruct-top">
        <WarRoomBackControl />
        <Link href={HVS_CANONICAL_PATH}>Higher Vision Studios</Link>
      </div>
      <p className="hvs-destruct-kicker">DESTRUCTION PREVIS</p>
      <h1>{summary}</h1>
      {error ? <p>{error}</p> : null}
      <div ref={mountRef} className="hvs-destruct-stage" data-testid="hvs-destruction-stage" />
      <div className="hvs-destruct-row">
        <button type="button" data-testid="hvs-destruction-play" data-playing={playing ? 'yes' : 'no'} onClick={() => setPlaying(value => !value)}>PLAY</button>
        <button type="button" data-testid="hvs-destruction-restart" onClick={() => { frameRef.current = 0; setFrame(0); setPlaying(false) }}>RESTART</button>
        <button type="button" data-testid="hvs-destruction-camera" onClick={() => setCameraId(value => value === 'front' ? 'three-quarter' : 'front')}>
          {cameraId === 'front' ? 'FRONT' : 'THREE-QUARTER'}
        </button>
        <input
          data-testid="hvs-destruction-scrub"
          type="range"
          min={0}
          max={Math.max(0, (payload?.playback.frameCount ?? 1) - 1)}
          value={frame}
          onChange={event => {
            const next = Number(event.target.value)
            frameRef.current = next
            setFrame(next)
          }}
        />
      </div>
      {payload?.steps?.length ? (
        <ul>
          {payload.steps.map(step => <li key={step}>{step}</li>)}
        </ul>
      ) : null}
    </main>
  )
}
