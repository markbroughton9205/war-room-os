import {
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'

import {
  ATMOSPHERE_INNER_RADIUS,
  ATMOSPHERE_OUTER_RADIUS,
  CLOUD_RADIUS,
  CLOUD_SPIN_PERIOD_SEC,
  EARTH_AXIAL_TILT_RAD,
  EARTH_CLOUD_OPACITY,
  EARTH_HOME_PITCH_RAD,
  EARTH_HOME_YAW_RAD,
  EARTH_RADIUS,
  EARTH_SPIN_PERIOD_SEC,
  boundDevicePixelRatio,
  homeEarthQualityConfig,
  type HomeEarthQuality,
} from './earthQuality'
import {
  createAtmosphereMaterial,
  createCloudMaterial,
  createEarthMaterial,
} from './earthMaterials'

export type HomeEarthMetrics = {
  fps: number
  frameMs: number
  dpr: number
  quality: HomeEarthQuality
}

export type HomeEarthRendererHandle = {
  setActive: (active: boolean) => void
  setReducedMotion: (reduced: boolean) => void
  setDragging: (dragging: boolean) => void
  setIdleHold: (idleHold: boolean) => void
  applyDrag: (dx: number, dy: number, width: number, height: number) => void
  applyZoom: (deltaY: number) => void
  notifyInteraction: () => void
  resize: (width: number, height: number) => void
  getMetrics: () => HomeEarthMetrics
  dispose: () => void
}

type LoadableTexture = {
  url: string
  colorSpace: typeof SRGBColorSpace | typeof LinearSRGBColorSpace
}

function dummyMap(): Texture {
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}

function configureTexture(texture: Texture, colorSpace: LoadableTexture['colorSpace'], anisotropy: number) {
  texture.colorSpace = colorSpace
  texture.anisotropy = anisotropy
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

async function loadTexture(loader: TextureLoader, spec: LoadableTexture, anisotropy: number): Promise<Texture> {
  const texture = await loader.loadAsync(spec.url)
  return configureTexture(texture, spec.colorSpace, anisotropy)
}

export async function createHomeEarthRenderer(input: {
  canvas: HTMLCanvasElement
  quality: HomeEarthQuality
  reducedMotion: boolean
}): Promise<HomeEarthRendererHandle> {
  const config = homeEarthQualityConfig(input.quality)
  const renderer = new WebGLRenderer({
    canvas: input.canvas,
    alpha: true,
    antialias: config.antialias,
    depth: true,
    stencil: false,
    powerPreference: config.quality === 'CINEMATIC' ? 'default' : 'low-power',
    preserveDrawingBuffer: false,
  })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.autoClear = true

  const scene = new Scene()
  scene.background = null
  const camera = new PerspectiveCamera(42, 1, 0.1, 20)
  camera.position.set(0, 0.08, 2.72)
  camera.lookAt(0, 0, 0)

  const sunDirection = new Vector3(0.38, 0.22, 0.90).normalize()
  const loader = new TextureLoader()
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())

  const dayMap = await loadTexture(loader, { url: config.dayUrl, colorSpace: SRGBColorSpace }, anisotropy)
  const [cloudMap, nightMap, specularMap, normalMap] = await Promise.all([
    config.clouds
      ? loadTexture(loader, { url: config.cloudUrl, colorSpace: SRGBColorSpace }, anisotropy)
      : Promise.resolve(null),
    config.nightLights
      ? loadTexture(loader, { url: config.nightUrl, colorSpace: SRGBColorSpace }, anisotropy)
      : Promise.resolve(null),
    loadTexture(loader, { url: config.specularUrl, colorSpace: LinearSRGBColorSpace }, anisotropy).catch(() => null),
    config.bump
      ? loadTexture(loader, { url: config.normalUrl, colorSpace: LinearSRGBColorSpace }, anisotropy).catch(() => null)
      : Promise.resolve(null),
  ])

  const earthGeometry = new SphereGeometry(EARTH_RADIUS, config.segments, config.segments)
  const cloudGeometry = config.clouds
    ? new SphereGeometry(CLOUD_RADIUS, Math.max(24, config.segments - 8), Math.max(24, config.segments - 8))
    : null
  const innerAtmoGeometry = config.atmosphere
    ? new SphereGeometry(ATMOSPHERE_INNER_RADIUS, 32, 32)
    : null
  const outerAtmoGeometry = config.atmosphere
    ? new SphereGeometry(ATMOSPHERE_OUTER_RADIUS, 32, 32)
    : null

  const earthMaterial = createEarthMaterial({
    dayMap,
    nightMap: nightMap ?? dummyMap(),
    specularMap: specularMap ?? dummyMap(),
    normalMap: normalMap ?? dummyMap(),
    sunDirection,
  })
  earthMaterial.uniforms.useNight.value = nightMap ? 1 : 0
  earthMaterial.uniforms.useBump.value = normalMap ? 1 : 0
  earthMaterial.uniforms.useSpecular.value = specularMap ? 1 : 0
  const cloudMaterial = cloudMap
    ? createCloudMaterial({ cloudMap, sunDirection, opacity: EARTH_CLOUD_OPACITY })
    : null
  const innerAtmoMaterial = config.atmosphere ? createAtmosphereMaterial({ side: 'front', sunDirection }) : null
  const outerAtmoMaterial = config.atmosphere ? createAtmosphereMaterial({ side: 'back', sunDirection }) : null

  const pivot = new Group()
  pivot.rotation.z = EARTH_AXIAL_TILT_RAD
  const earth = new Mesh(earthGeometry, earthMaterial)
  earth.frustumCulled = true
  pivot.add(earth)

  let clouds: Mesh | null = null
  if (cloudGeometry && cloudMaterial) {
    clouds = new Mesh(cloudGeometry, cloudMaterial)
    clouds.renderOrder = 1
    clouds.frustumCulled = true
    pivot.add(clouds)
  }

  const atmosphereGroup = new Group()
  atmosphereGroup.rotation.z = EARTH_AXIAL_TILT_RAD
  if (innerAtmoGeometry && innerAtmoMaterial) {
    const inner = new Mesh(innerAtmoGeometry, innerAtmoMaterial)
    inner.renderOrder = 2
    atmosphereGroup.add(inner)
  }
  if (outerAtmoGeometry && outerAtmoMaterial) {
    const outer = new Mesh(outerAtmoGeometry, outerAtmoMaterial)
    outer.renderOrder = 3
    atmosphereGroup.add(outer)
  }

  scene.add(pivot)
  scene.add(atmosphereGroup)

  const textures = [dayMap, cloudMap, nightMap, specularMap, normalMap].filter((item): item is Texture => Boolean(item))
  if (!nightMap) textures.push(earthMaterial.uniforms.nightMap.value as Texture)
  if (!specularMap) textures.push(earthMaterial.uniforms.specularMap.value as Texture)
  if (!normalMap) textures.push(earthMaterial.uniforms.normalMap.value as Texture)
  const geometries = [earthGeometry, cloudGeometry, innerAtmoGeometry, outerAtmoGeometry].filter(
    (item): item is SphereGeometry => Boolean(item),
  )
  const materials = [earthMaterial, cloudMaterial, innerAtmoMaterial, outerAtmoMaterial].filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  )

  let disposed = false
  let active = true
  let reducedMotion = input.reducedMotion
  let dragging = false
  let idleHold = false
  let userSpin = EARTH_HOME_YAW_RAD
  let userPitch = EARTH_HOME_PITCH_RAD
  let cameraZ = 2.72
  let autoSpin = 0
  let cloudSpin = 0.12
  let raf = 0
  let lastTime = 0
  let frameMs = 16
  let fps = config.targetFps
  let frames = 0
  let fpsWindowStart = 0
  let dpr = boundDevicePixelRatio(config.maxDpr)
  renderer.setPixelRatio(dpr)

  const earthSpinRate = (Math.PI * 2) / EARTH_SPIN_PERIOD_SEC
  const cloudSpinRate = (Math.PI * 2) / CLOUD_SPIN_PERIOD_SEC
  const minDt = 1 / config.targetFps

  function applyPose() {
    pivot.rotation.x = userPitch
    pivot.rotation.z = EARTH_AXIAL_TILT_RAD
    earth.rotation.y = autoSpin + userSpin
    if (clouds) clouds.rotation.y = cloudSpin + userSpin
  }

  function renderFrame(now: number) {
    if (disposed) return
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : minDt
    lastTime = now
    const rotating = active && !reducedMotion && !dragging && !idleHold
    if (rotating) {
      autoSpin += earthSpinRate * dt
      cloudSpin += cloudSpinRate * dt
    }
    applyPose()
    camera.position.z = cameraZ
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    frameMs = dt * 1000
    frames += 1
    if (!fpsWindowStart) fpsWindowStart = now
    if (now - fpsWindowStart >= 1000) {
      fps = frames * 1000 / Math.max(1, now - fpsWindowStart)
      frames = 0
      fpsWindowStart = now
      input.canvas.dataset.earthFps = String(Math.round(fps))
      input.canvas.dataset.earthDpr = String(dpr)
    }
  }

  function loop(now: number) {
    raf = 0
    if (disposed || !active) return
    if (lastTime && now - lastTime < minDt * 900) {
      raf = window.requestAnimationFrame(loop)
      return
    }
    renderFrame(now)
    const keepRunning = active && (dragging || (!reducedMotion && !idleHold))
    if (keepRunning) raf = window.requestAnimationFrame(loop)
  }

  function wake() {
    if (disposed || raf || !active) return
    lastTime = 0
    raf = window.requestAnimationFrame(loop)
  }

  function stopLoop() {
    if (raf) {
      window.cancelAnimationFrame(raf)
      raf = 0
    }
  }

  applyPose()
  renderer.render(scene, camera)

  if (!reducedMotion) wake()

  return {
    setActive(nextActive) {
      if (disposed) return
      active = nextActive
      if (nextActive) wake()
      else stopLoop()
    },
    setReducedMotion(nextReduced) {
      if (disposed) return
      reducedMotion = nextReduced
      if (nextReduced && !dragging) stopLoop()
      else wake()
    },
    setDragging(nextDragging) {
      if (disposed) return
      dragging = nextDragging
      if (nextDragging) wake()
    },
    setIdleHold(nextIdleHold) {
      if (disposed) return
      idleHold = nextIdleHold
      if (!nextIdleHold) wake()
    },
    applyDrag(dx, dy, width, height) {
      if (disposed) return
      userSpin += (dx / Math.max(1, width)) * Math.PI
      userPitch = Math.max(-0.32, Math.min(0.32, userPitch + (dy / Math.max(1, height)) * 0.9))
      applyPose()
      if (active) renderer.render(scene, camera)
    },
    applyZoom(deltaY) {
      if (disposed) return
      cameraZ = Math.max(2.35, Math.min(3.35, cameraZ + deltaY * 0.0016))
      camera.position.z = cameraZ
      if (active) renderer.render(scene, camera)
    },
    notifyInteraction() {
      if (disposed) return
      wake()
    },
    resize(width, height) {
      if (disposed || width <= 0 || height <= 0) return
      dpr = boundDevicePixelRatio(config.maxDpr)
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      if (active) renderer.render(scene, camera)
    },
    getMetrics() {
      return { fps, frameMs, dpr, quality: config.quality }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopLoop()
      for (const material of materials) material.dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const texture of textures) texture.dispose()
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

export function detectHomeEarthWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
