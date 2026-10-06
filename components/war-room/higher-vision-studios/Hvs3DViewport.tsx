'use client'

import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SpotLight,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Hvs3DScene, HvsSceneNode } from '@/lib/media-command/director3d/types'
import { evaluateScene, samplePath } from '@/lib/media-command/director3d/evaluate'
import { fromSeconds, toSeconds } from '@/lib/media-command/time'
import { probe3DViewportCapability } from '@/lib/media-command/director3d/capability'
import { sampleNode, type PlaybackNode } from '@/lib/media-command/destruction/playback'
import { mapChunkToAlley } from '@/lib/media-command/director/framing'
import { HVS_HUMANOID_RIG_ID } from '@/lib/media-command/digital-human/types'
import {
  poseAtSceneClock,
  type HvsDirectorPerformanceTrack,
} from '@/lib/media-command/digital-human/scene-performance'
import { applyStylizedBodyPose, createHvsStylizedBody } from '@/lib/media-command/digital-human/skinned-body'
import { HVS_VIEWPORT_INSPECT_LIGHT } from '@/lib/media-command/digital-human/viewport-inspect-light'

export type Hvs3DViewportMode = 'DIRECT' | 'CAMERA' | 'TOP' | 'FRONT' | 'SIDE'

function hex(color: string | null, fallback: string) {
  try {
    return new Color(color || fallback)
  } catch {
    return new Color(fallback)
  }
}

function placeholderMesh(node: HvsSceneNode, scene: Hvs3DScene | null): Mesh | Group {
  const color = hex(node.color, node.type === 'CHARACTER' ? '#c9a227' : '#4b5563')
  const mat = new MeshStandardMaterial({
    color,
    metalness: node.placeholder === 'car' ? 0.72 : 0.12,
    roughness: node.placeholder === 'car' ? 0.22 : 0.78,
  })
  const character = scene?.characters.find(item => item.nodeId === node.id)
  if (node.placeholder === 'person' && character?.rigRef === HVS_HUMANOID_RIG_ID) {
    return createHvsStylizedBody('PRODUCTION')
  }
  if (node.placeholder === 'person') {
    const group = new Group()
    const body = new Mesh(new CylinderGeometry(0.22, 0.26, 1.15, 10), mat)
    body.position.y = 0.7
    const head = new Mesh(new SphereGeometry(0.18, 12, 10), mat)
    head.position.y = 1.42
    group.add(body, head)
    group.userData.placeholder = true
    return group
  }
  if (node.placeholder === 'car') {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat)
    mesh.userData.placeholder = true
    return mesh
  }
  if (node.placeholder === 'building') {
    return new Mesh(new BoxGeometry(1, 1, 1), mat)
  }
  if (node.type === 'VOLUME' || node.placeholder === 'sphere') {
    const volume = new Mesh(new SphereGeometry(0.5, 16, 12), new MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      roughness: 1,
      metalness: 0,
    }))
    volume.userData.placeholder = true
    return volume
  }
  if (node.placeholder === 'plane') {
    const mesh = new Mesh(new PlaneGeometry(1, 1, 8, 8), mat)
    mesh.rotation.x = -Math.PI / 2
    return mesh
  }
  return new Mesh(new BoxGeometry(1, 1, 1), mat)
}

function pathLine(points: Array<{ x: number; y: number; z: number }>, color: string): Line {
  const geom = new BufferGeometry()
  const flat: number[] = []
  for (const p of points) flat.push(p.x, p.y, p.z)
  geom.setAttribute('position', new Float32BufferAttribute(flat, 3))
  const line = new Line(geom, new LineBasicMaterial({ color, transparent: true, opacity: 0.85 }))
  line.userData.helper = true
  return line
}

export type AlleyKernelPlayback = {
  cacheManifestId: string
  simulationRuns: number
  collapseStartSec: number
  fps: number
  frameCount: number
  shakeSceneSec: number
  nodes: PlaybackNode[]
}

export function Hvs3DViewport({
  scene,
  playheadSec,
  playing,
  mode = 'DIRECT',
  showPaths = true,
  destruction = null,
  performanceTracks = [],
}: {
  scene: Hvs3DScene | null
  playheadSec: number
  playing: boolean
  mode?: Hvs3DViewportMode
  showPaths?: boolean
  destruction?: AlleyKernelPlayback | null
  performanceTracks?: HvsDirectorPerformanceTrack[]
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef(scene)
  const playheadRef = useRef(playheadSec)
  const playingRef = useRef(playing)
  const modeRef = useRef(mode)
  const showPathsRef = useRef(showPaths)
  const destructionRef = useRef(destruction)
  const tracksRef = useRef(performanceTracks)
  sceneRef.current = scene
  playingRef.current = playing
  if (!playing) playheadRef.current = playheadSec
  modeRef.current = mode
  showPathsRef.current = showPaths
  destructionRef.current = destruction
  tracksRef.current = performanceTracks

  useEffect(() => {
    const hostElement = hostRef.current
    if (!hostElement) return
    const host: HTMLDivElement = hostElement
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'hvs-3d-canvas'
    host.appendChild(canvas)
    const probeCanvas = document.createElement('canvas')
    const webgl = Boolean(probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl'))
    const capability = probe3DViewportCapability(
      'gpu' in navigator ? (navigator as Navigator & { gpu?: { requestAdapter?: unknown } }).gpu : null,
      webgl,
    )
    host.dataset.renderer = capability.renderer
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    const threeScene = new Scene()
    const camera = new PerspectiveCamera(40, 1, 0.05, 200)
    camera.position.set(8, 5, 10)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.target.set(0, 1, -2)

    const world = new Group()
    const helpers = new Group()
    helpers.userData.helper = true
    const inspectKey = new SpotLight('#ffc89a', HVS_VIEWPORT_INSPECT_LIGHT.wideIntensity, 9, 0.62, 0.55)
    inspectKey.name = HVS_VIEWPORT_INSPECT_LIGHT.id
    inspectKey.userData.execution = true
    inspectKey.userData.role = HVS_VIEWPORT_INSPECT_LIGHT.role
    inspectKey.userData.mutatesCinema = HVS_VIEWPORT_INSPECT_LIGHT.mutatesCinema
    const inspectFill = new PointLight('#8a9bb0', HVS_VIEWPORT_INSPECT_LIGHT.wideIntensity, 6)
    inspectFill.name = HVS_VIEWPORT_INSPECT_LIGHT.fillId
    inspectFill.userData.execution = true
    inspectFill.userData.role = HVS_VIEWPORT_INSPECT_LIGHT.role
    threeScene.add(world, helpers, inspectKey, inspectKey.target, inspectFill)

    const nodeMap = new Map<string, Group>()
    let chunkGroup: Group | null = null
    let chunkKey = ''

    function resize() {
      const w = Math.min(Math.max(host.clientWidth || 640, 1), 4096)
      const h = Math.min(Math.max(host.clientHeight || 360, 1), 4096)
      renderer.setSize(w, h, true)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    function rebuild(next: Hvs3DScene) {
      world.clear()
      helpers.clear()
      nodeMap.clear()
      threeScene.background = hex(next.environment.background, '#05070c')
      for (const node of next.objects) {
        if (node.type === 'GROUP' || node.type === 'CAMERA' || node.type === 'LIGHT' || node.type === 'PATH') continue
        const wrap = new Group()
        wrap.userData.nodeId = node.id
        wrap.add(placeholderMesh(node, next))
        world.add(wrap)
        nodeMap.set(node.id, wrap)
      }
      for (const light of next.lights) {
        const node = next.objects.find(item => item.id === light.nodeId)
        const pos = node?.transform.position ?? { x: 0, y: 3, z: 0 }
        if (light.kind === 'AMBIENT') {
          const l = new AmbientLight(hex(light.color, '#1a2a44'), light.intensity)
          world.add(l)
        } else if (light.kind === 'DIRECTIONAL') {
          const l = new DirectionalLight(hex(light.color, '#8fb4ff'), light.intensity)
          l.position.set(pos.x, pos.y, pos.z)
          l.castShadow = true
          world.add(l)
        } else if (light.kind === 'SPOT') {
          const l = new SpotLight(hex(light.color, '#ffd19a'), light.intensity, light.distance ?? 24, light.angle ?? 0.5)
          l.position.set(pos.x, pos.y, pos.z)
          world.add(l)
        } else {
          const l = new PointLight(hex(light.color, '#66d6ff'), light.intensity, light.distance ?? 16)
          l.position.set(pos.x, pos.y, pos.z)
          world.add(l)
        }
      }
    }

    function sync(next: Hvs3DScene, tSec: number) {
      const time = fromSeconds(Math.max(0, tSec), next.duration.timescale)
      const evald = evaluateScene(next, time)
      for (const [id, wrap] of nodeMap) {
        const node = evald.nodes[id]
        if (!node) continue
        wrap.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z)
        wrap.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z)
        wrap.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z)
        const track = tracksRef.current.find(item => item.nodeId === id)
        const humanoidRoot = wrap.children.find(child => child.userData.humanoid) as Group | undefined
        if (track && humanoidRoot) {
          const sampled = poseAtSceneClock(track, time)
          applyStylizedBodyPose(humanoidRoot, sampled.pose)
          wrap.userData.performance = sampled
          host.dataset.bodyKind = humanoidRoot.userData.humanoid?.kind === 'skinned' ? 'skinned' : 'proxy'
        }
      }
      helpers.clear()
      if (showPathsRef.current) {
        for (const path of next.paths) {
          const samples: Array<{ x: number; y: number; z: number }> = []
          const end = toSeconds(path.points[path.points.length - 1]?.time ?? next.duration)
          for (let i = 0; i <= 32; i++) {
            const sample = samplePath(path, fromSeconds((end * i) / 32, next.duration.timescale))
            if (sample) samples.push(sample)
          }
          if (samples.length > 1) {
            helpers.add(pathLine(samples, path.kind === 'CAMERA' ? '#5ce1ff' : '#e8c872'))
          }
        }
      }
      const cam = next.cameras.find(item => item.id === evald.activeCameraId) ?? next.cameras[0]
      const camNode = cam ? evald.nodes[cam.nodeId] : null
      const modeNow = modeRef.current
      const alley = destructionRef.current
      const buildingWrap = nodeMap.get('node-building')
      if (!alley) {
        if (chunkGroup) chunkGroup.visible = false
        if (buildingWrap) buildingWrap.visible = true
      } else {
        if (chunkKey !== alley.cacheManifestId || !chunkGroup) {
          chunkGroup?.removeFromParent()
          chunkGroup = new Group()
          const material = new MeshStandardMaterial({ color: '#8d8478', roughness: 0.86 })
          for (const node of alley.nodes) {
            if (node.role !== 'PRIMARY_CHUNKS') continue
            const mesh = new Mesh(new BoxGeometry(node.size.x * (8 / 6), node.size.y * (8 / 3), Math.max(0.08, node.size.z)), material)
            mesh.userData.chunk = node
            chunkGroup.add(mesh)
          }
          world.add(chunkGroup)
          chunkKey = alley.cacheManifestId
        }
        const simT = tSec - alley.collapseStartSec
        if (simT < 0) {
          chunkGroup.visible = false
          if (buildingWrap) buildingWrap.visible = true
        } else {
          if (buildingWrap) buildingWrap.visible = false
          chunkGroup.visible = true
          const frame = Math.max(0, Math.min(alley.frameCount - 1, Math.floor(simT * alley.fps)))
          for (const child of chunkGroup.children) {
            const node = (child as Mesh).userData.chunk as PlaybackNode | undefined
            if (!node) continue
            const sample = sampleNode(node, frame)
            const placed = mapChunkToAlley(sample)
            child.position.set(placed.x, placed.y, placed.z)
            child.rotation.z = sample.tilt
          }
        }
      }
      if (modeNow === 'CAMERA' && camNode) {
        camera.position.set(camNode.transform.position.x, camNode.transform.position.y, camNode.transform.position.z)
        if (camNode.lookAt) camera.lookAt(camNode.lookAt.x, camNode.lookAt.y, camNode.lookAt.z)
        const alleyNow = destructionRef.current
        if (alleyNow && tSec >= alleyNow.shakeSceneSec && tSec < alleyNow.shakeSceneSec + 0.8) {
          const kick = Math.sin((tSec - alleyNow.shakeSceneSec) * 48) * 0.06
          camera.position.y += kick
        }
        camera.fov = 2 * Math.atan(18 / Math.max(12, evald.focalLength)) * (180 / Math.PI)
        camera.updateProjectionMatrix()
        controls.enabled = false
      } else {
        controls.enabled = modeNow === 'DIRECT'
        if (modeNow === 'TOP') {
          camera.position.set(0, 22, 0.01)
          camera.lookAt(0, 0, -4)
        } else if (modeNow === 'FRONT') {
          camera.position.set(0, 3, 16)
          camera.lookAt(0, 1, -4)
        } else if (modeNow === 'SIDE') {
          camera.position.set(16, 3, -2)
          camera.lookAt(0, 1, -4)
        }
      }
      const closeUp = evald.focalLength >= HVS_VIEWPORT_INSPECT_LIGHT.closeUpFocalMm
      inspectKey.intensity = closeUp ? HVS_VIEWPORT_INSPECT_LIGHT.keyIntensity : HVS_VIEWPORT_INSPECT_LIGHT.wideIntensity
      inspectFill.intensity = closeUp ? HVS_VIEWPORT_INSPECT_LIGHT.fillIntensity : HVS_VIEWPORT_INSPECT_LIGHT.wideIntensity
      if (camNode) {
        const look = camNode.lookAt ?? { x: 0, y: 1.62, z: 0 }
        inspectKey.position.set(camNode.transform.position.x + 0.32, camNode.transform.position.y + 0.22, camNode.transform.position.z)
        inspectKey.target.position.set(look.x, look.y + 0.06, look.z)
        inspectFill.position.set(look.x - 0.18, look.y + 0.12, look.z + 0.22)
      }
      host.dataset.inspectLight = closeUp ? 'close-up' : 'night-off'
      host.dataset.activeShot = evald.activeShotId ?? ''
      host.dataset.activeCamera = evald.activeCameraId ?? ''
      host.dataset.cameraMode = modeNow === 'CAMERA' ? 'scene' : modeNow === 'DIRECT' ? 'orbit' : modeNow.toLowerCase()
      host.dataset.focal = String(evald.focalLength)
      if (camNode) {
        host.dataset.cameraX = camNode.transform.position.x.toFixed(3)
        host.dataset.cameraY = camNode.transform.position.y.toFixed(3)
        host.dataset.cameraZ = camNode.transform.position.z.toFixed(3)
      }
    }

    let lastId = ''
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      if (playingRef.current) {
        const duration = sceneRef.current ? toSeconds(sceneRef.current.duration) : 8
        playheadRef.current = Math.min(duration, playheadRef.current + dt)
      }
      const next = sceneRef.current
      if (next) {
        if (next.id !== lastId || next.version !== Number(host.dataset.sceneVersion)) {
          rebuild(next)
          lastId = next.id
          host.dataset.sceneVersion = String(next.version)
        }
        sync(next, playheadRef.current)
        host.dataset.playhead = playheadRef.current.toFixed(2)
        const lead = tracksRef.current[0]
        if (lead) {
          const time = fromSeconds(Math.max(0, playheadRef.current), next.duration.timescale)
          const sampled = poseAtSceneClock(lead, time)
          const wrap = nodeMap.get(lead.nodeId)
          const left = sampled.pose.joints.LEFT_WRIST
          const right = sampled.pose.joints.RIGHT_WRIST
          const knee = sampled.pose.joints.LEFT_KNEE
          host.dataset.performanceTake = lead.takeId
          host.dataset.performancePhase = sampled.phase
          host.dataset.performanceTicks = String(sampled.performanceTicks)
          host.dataset.performanceClock = 'scene'
          host.dataset.performanceState = sampled.directorState
          host.dataset.performanceIndex = String(sampled.index)
          host.dataset.blockingX = wrap ? wrap.position.x.toFixed(3) : ''
          host.dataset.rootX = sampled.pose.root[0].toFixed(3)
          host.dataset.worldX = wrap ? (wrap.position.x + sampled.pose.root[0]).toFixed(3) : ''
          host.dataset.leftWristY = left ? left[1].toFixed(3) : ''
          host.dataset.rightWristY = right ? right[1].toFixed(3) : ''
          host.dataset.leftKneeY = knee ? knee[1].toFixed(3) : ''
        }
      }
      if (modeRef.current === 'DIRECT') controls.update()
      renderer.render(threeScene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  void playing

  return (
    <div
      ref={hostRef}
      className="hvs-3d-viewport"
      data-testid="hvs-3d-viewport"
      data-mode={mode}
      data-playing={playing ? '1' : '0'}
      data-playhead={playheadSec.toFixed(2)}
      data-destruction={destruction ? 'real-kernel' : 'proxy'}
      data-sim-runs={destruction?.simulationRuns ?? 0}
      data-cache-id={destruction?.cacheManifestId ?? ''}
      data-performance-clock={performanceTracks.length ? 'scene' : ''}
      data-performance-take={performanceTracks[0]?.takeId ?? ''}
      data-camera-mode={mode === 'CAMERA' ? 'scene' : mode === 'DIRECT' ? 'orbit' : mode.toLowerCase()}
      data-body-kind="skinned"
    />
  )
}
