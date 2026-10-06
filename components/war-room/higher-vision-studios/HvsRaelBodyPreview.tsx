'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HVS_HUMANOID_SEGMENTS } from '@/lib/media-command/digital-human/humanoid-rig'
import {
  applyStylizedBodyPose,
  bodyBoundsFromPose,
  createHvsStylizedBody,
  type HvsBodyQuality,
} from '@/lib/media-command/digital-human/skinned-body'
import { toSeconds, type MediaTime } from '@/lib/media-command/time'

export type CompactHumanoidPose = {
  ticks: number
  timescale: number
  root: [number, number, number]
  head: [number, number, number]
  joints: Record<string, [number, number, number]>
}

function skeletonLine(a: Vector3, b: Vector3, color: string): Line {
  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3))
  return new Line(geom, new LineBasicMaterial({ color }))
}

export function HvsRaelBodyPreview({
  poses,
  duration,
  takeLabel,
  quality,
  rigReady,
}: {
  poses: CompactHumanoidPose[]
  duration: MediaTime | null
  takeLabel: string | null
  quality: string | null
  rigReady: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const posesRef = useRef(poses)
  posesRef.current = poses
  const [playing, setPlaying] = useState(true)
  const [loop, setLoop] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showLandmarks, setShowLandmarks] = useState(false)
  const [meshQuality, setMeshQuality] = useState<HvsBodyQuality>('PRODUCTION')
  const [stats, setStats] = useState({ fps: 0, frameMs: 0 })
  const playingRef = useRef(playing)
  const loopRef = useRef(loop)
  const skeletonRef = useRef(showSkeleton)
  const landmarksRef = useRef(showLandmarks)
  playingRef.current = playing
  loopRef.current = loop
  skeletonRef.current = showSkeleton
  landmarksRef.current = showLandmarks
  const restartRef = useRef(0)
  const resetViewRef = useRef(0)

  useEffect(() => {
    const hostElement = hostRef.current
    if (!hostElement) return
    const host: HTMLDivElement = hostElement
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'hvs-body-rig-canvas'
    host.appendChild(canvas)
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    const scene = new Scene()
    scene.background = new Color('#0b0a08')
    const camera = new PerspectiveCamera(35, 1, 0.05, 40)
    camera.position.set(2.1, 1.5, 3.4)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.target.set(0, 1.05, 0)
    const key = new DirectionalLight('#fff4dd', 1.35)
    key.position.set(2.2, 3.4, 2.4)
    key.castShadow = true
    const fill = new DirectionalLight('#9bb7d4', 0.45)
    fill.position.set(-2.4, 1.6, 1.2)
    const rim = new SpotLight('#e8d7b0', 0.7, 12, 0.7, 0.4)
    rim.position.set(-0.4, 2.8, -2.2)
    scene.add(new AmbientLight('#241c14', 0.35), key, fill, rim)
    const ground = new Mesh(new PlaneGeometry(6, 6), new MeshStandardMaterial({ color: '#16140f', roughness: 0.92, metalness: 0.05 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const body = createHvsStylizedBody(meshQuality)
    scene.add(body)
    const landmarkDots = new Group()
    scene.add(landmarkDots)
    const skeletonLines = new Group()
    scene.add(skeletonLines)

    function resize() {
      const w = Math.min(Math.max(host.clientWidth || 420, 1), 2048)
      const h = Math.min(Math.max(host.clientHeight || 360, 1), 2048)
      renderer.setSize(w, h, true)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    let frame = 0
    let last = performance.now()
    let fpsWindow = 0
    let fpsCount = 0
    let fpsLast = performance.now()
    let lastRestart = 0
    let lastReset = 0
    const vecA = new Vector3()
    const vecB = new Vector3()
    const target = new Vector3()

    function applyPose(pose: CompactHumanoidPose) {
      applyStylizedBodyPose(body, pose)
      const bounds = bodyBoundsFromPose(pose)
      target.set(bounds.center.x, bounds.center.y, bounds.center.z)
      controls.target.lerp(target, 0.18)
      controls.minDistance = Math.max(1.5, bounds.radius * 1.85)
      const offset = camera.position.clone().sub(controls.target)
      if (offset.length() < bounds.radius * 2.15) {
        offset.setLength(bounds.radius * 2.45)
        camera.position.copy(controls.target).add(offset)
      }
      landmarkDots.clear()
      if (landmarksRef.current) {
        const dotMat = new MeshStandardMaterial({ color: '#34d399', emissive: '#14532d' })
        for (const value of Object.values(pose.joints)) {
          const dot = new Mesh(new SphereGeometry(0.018, 8, 6), dotMat)
          dot.position.set(value[0], value[1], value[2])
          landmarkDots.add(dot)
        }
      }
      skeletonLines.clear()
      if (skeletonRef.current) {
        for (const [start, end] of HVS_HUMANOID_SEGMENTS) {
          const a = pose.joints[start]
          const b = pose.joints[end]
          if (!a || !b) continue
          skeletonLines.add(skeletonLine(vecA.set(a[0], a[1], a[2]), vecB.set(b[0], b[1], b[2]), '#fbbf24'))
        }
      }
      skeletonLines.visible = skeletonRef.current
      host.dataset.bodyKind = body.userData.humanoid?.kind === 'skinned' ? 'skinned' : 'proxy'
      host.dataset.bodyQuality = meshQuality
    }

    const timer = window.setInterval(() => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (restartRef.current !== lastRestart) {
        frame = 0
        lastRestart = restartRef.current
      }
      if (resetViewRef.current !== lastReset) {
        camera.position.set(2.1, 1.5, 3.4)
        controls.target.set(0, 1.05, 0)
        lastReset = resetViewRef.current
      }
      const list = posesRef.current
      if (playingRef.current && list.length) {
        const durationSec = list.length ? toSeconds({ ticks: list[list.length - 1].ticks, timescale: list[list.length - 1].timescale || 24000 }) : 1
        const step = list.length / Math.max(0.001, durationSec)
        frame += dt * step
        if (frame >= list.length) frame = loopRef.current ? 0 : list.length - 1
      }
      const pose = list[Math.max(0, Math.min(list.length - 1, Math.floor(frame)))]
      if (pose) applyPose(pose)
      controls.update()
      renderer.render(scene, camera)
      fpsCount += 1
      fpsWindow += now - fpsLast
      fpsLast = now
      if (fpsCount >= 20) {
        const avg = fpsWindow / fpsCount
        setStats({ fps: avg > 0 ? Math.round(1000 / avg) : 0, frameMs: Math.round(avg * 10) / 10 })
        fpsCount = 0
        fpsWindow = 0
      }
    }, 16)

    return () => {
      window.clearInterval(timer)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [meshQuality])

  const durationLabel = duration ? `${(duration.ticks / duration.timescale).toFixed(2)}s` : '—'

  return (
    <div className="hvs-body-rig" data-testid="hvs-body-rig">
      <div className="hvs-body-rig-meta">
        <strong>RA&apos;EL</strong>
        <span data-testid="hvs-body-rig-state">BODY RIG: {rigReady ? 'READY' : 'NOT READY'}</span>
        <span data-testid="hvs-body-rig-take">PERFORMANCE: {takeLabel ?? '—'}</span>
        <span data-testid="hvs-body-rig-quality">QUALITY: {quality ?? '—'}</span>
        <span>DURATION: {durationLabel}</span>
        <span data-testid="hvs-body-rig-honesty">PRODUCTION BODY PREVIEW</span>
      </div>
      <div ref={hostRef} className="hvs-body-rig-stage" data-testid="hvs-body-mesh" data-kind={meshQuality === 'LOW' ? 'proxy' : 'skinned'} data-quality={meshQuality} />
      <div className="hvs-actor-actions">
        <button type="button" data-testid="hvs-body-play" onClick={() => setPlaying(true)}>Play</button>
        <button type="button" data-testid="hvs-body-pause" onClick={() => setPlaying(false)}>Pause</button>
        <button type="button" data-testid="hvs-body-restart" onClick={() => { restartRef.current += 1; setPlaying(true) }}>Restart</button>
        <button type="button" data-testid="hvs-body-loop" onClick={() => setLoop(value => !value)}>{loop ? 'Loop on' : 'Loop off'}</button>
        <button type="button" data-testid="hvs-body-orbit" title="Drag the viewport to orbit">Orbit</button>
        <button type="button" data-testid="hvs-body-reset-view" onClick={() => { resetViewRef.current += 1 }}>Reset view</button>
        <button type="button" data-testid="hvs-body-skeleton" onClick={() => setShowSkeleton(value => !value)}>{showSkeleton ? 'Hide skeleton' : 'Show skeleton'}</button>
        <button type="button" data-testid="hvs-body-landmarks" onClick={() => setShowLandmarks(value => !value)}>{showLandmarks ? 'Hide landmarks' : 'Show landmarks'}</button>
        <button type="button" data-testid="hvs-body-mesh-toggle" onClick={() => setMeshQuality(value => value === 'LOW' ? 'PRODUCTION' : 'LOW')}>{meshQuality === 'LOW' ? 'Show production mesh' : 'Show rig proxy'}</button>
      </div>
      <p className="hvs-actor-meta" data-testid="hvs-body-rig-stats">Preview {stats.fps} fps · {stats.frameMs} ms · orbit drag · PREVIEW WARDROBE REPRESENTATION · skinned stylized body · not photoreal</p>
    </div>
  )
}
