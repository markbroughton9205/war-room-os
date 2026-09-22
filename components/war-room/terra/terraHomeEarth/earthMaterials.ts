import {
  AdditiveBlending,
  BackSide,
  FrontSide,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three'

const EARTH_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const EARTH_FRAGMENT = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specularMap;
uniform sampler2D normalMap;
uniform vec3 sunDirection;
uniform float nightStrength;
uniform float bumpStrength;
uniform float specularScale;
uniform float exposure;
uniform float useNight;
uniform float useBump;
uniform float useSpecular;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

vec3 perturbNormal(vec3 N) {
  vec3 mapN = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= bumpStrength;
  vec3 reference = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(reference, N));
  vec3 B = normalize(cross(N, T));
  return normalize(mat3(T, B, N) * mapN);
}

vec3 gradeEarth(vec3 albedo) {
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  float oceanBlue = smoothstep(0.28, 0.06, luma) * smoothstep(-0.02, 0.10, albedo.b - albedo.r);
  float vegTeal = smoothstep(0.01, 0.14, albedo.g - albedo.r) * smoothstep(-0.02, 0.10, albedo.g - albedo.b);
  float desert = smoothstep(0.02, 0.16, albedo.r - albedo.g) * smoothstep(0.16, 0.48, luma);
  float ice = smoothstep(0.58, 0.82, luma);

  vec3 color = albedo;
  color = mix(color, vec3(0.02, 0.18, 0.46) + albedo * vec3(0.12, 0.32, 0.78), oceanBlue * 0.80);
  color = mix(color, color * vec3(0.32, 1.48, 0.70) + vec3(0.03, 0.20, 0.07), vegTeal * 0.88);
  color = mix(color, color * vec3(1.05, 0.94, 0.72), desert * 0.22);
  color = mix(color, vec3(0.72, 0.82, 0.88), ice * 0.42);
  return color;
}

void main() {
  vec3 albedo = gradeEarth(texture2D(dayMap, vUv).rgb);
  vec3 N = normalize(vWorldNormal);
  if (useBump > 0.5) N = perturbNormal(N);
  vec3 L = normalize(sunDirection);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  float ndotl = dot(N, L);
  float day = smoothstep(-0.16, 0.28, ndotl);
  float night = 1.0 - smoothstep(-0.10, 0.22, ndotl);
  float wrap = clamp(ndotl * 0.62 + 0.40, 0.0, 1.0);

  vec3 color = albedo * (0.16 + wrap * 1.08) * exposure;
  vec3 nightTint = vec3(0.012, 0.035, 0.08);
  color = mix(color, albedo * 0.07 + nightTint, night * 0.88);

  if (useNight > 0.5) {
    vec3 nightTex = texture2D(nightMap, vUv).rgb;
    float city = smoothstep(0.22, 0.55, max(nightTex.r, max(nightTex.g, nightTex.b)));
    color += nightTex * city * night * nightStrength;
  }

  if (useSpecular > 0.5) {
    float specMask = texture2D(specularMap, vUv).r;
    float spec = pow(max(dot(N, H), 0.0), 32.0) * specMask * day * specularScale;
    color += vec3(0.45, 0.78, 1.0) * spec;
  }

  float limb = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  color += vec3(0.18, 0.62, 0.92) * limb * 0.18 * day;
  color += vec3(0.08, 0.22, 0.18) * limb * 0.06;

  gl_FragColor = vec4(color, 1.0);
}
`

const CLOUD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDirection;
uniform float opacity;

varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vec3 cloud = texture2D(cloudMap, vUv).rgb;
  float luma = max(cloud.r, max(cloud.g, cloud.b));
  float alpha = smoothstep(0.28, 0.72, luma) * opacity;
  float pole = smoothstep(0.16, 0.02, vUv.y) + smoothstep(0.84, 0.98, vUv.y);
  alpha *= 1.0 - pole * 0.88;
  if (alpha < 0.012) discard;
  float day = smoothstep(-0.12, 0.28, dot(normalize(vWorldNormal), normalize(sunDirection)));
  vec3 color = mix(vec3(0.22, 0.28, 0.34), vec3(0.93, 0.95, 0.97), 0.40 + 0.60 * day);
  gl_FragColor = vec4(color, alpha);
}
`

const ATMOSPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorldNormal;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}
`

const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform vec3 glowColor;
uniform vec3 sunDirection;
uniform float coefficient;
uniform float power;
uniform float intensity;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorldNormal;

void main() {
  float glow = pow(coefficient - dot(normalize(vNormal), normalize(vView)), power);
  float lit = smoothstep(-0.15, 0.55, dot(normalize(vWorldNormal), normalize(sunDirection)));
  float rim = glow * mix(0.42, 1.0, lit);
  gl_FragColor = vec4(glowColor, 1.0) * rim * intensity;
}
`

export function createEarthMaterial(input: {
  dayMap: Texture
  nightMap: Texture
  specularMap: Texture
  normalMap: Texture
  sunDirection: Vector3
}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      dayMap: { value: input.dayMap },
      nightMap: { value: input.nightMap },
      specularMap: { value: input.specularMap },
      normalMap: { value: input.normalMap },
      sunDirection: { value: input.sunDirection },
      nightStrength: { value: 0.72 },
      bumpStrength: { value: 0.12 },
      specularScale: { value: 0.28 },
      exposure: { value: 1.28 },
      useNight: { value: 0 },
      useBump: { value: 0 },
      useSpecular: { value: 0 },
    },
    vertexShader: EARTH_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
    lights: false,
    toneMapped: false,
  })
}

export function createCloudMaterial(input: {
  cloudMap: Texture
  sunDirection: Vector3
  opacity: number
}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      cloudMap: { value: input.cloudMap },
      sunDirection: { value: input.sunDirection },
      opacity: { value: input.opacity },
    },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

export function createAtmosphereMaterial(input: {
  side: 'front' | 'back'
  sunDirection: Vector3
}): ShaderMaterial {
  const inner = input.side === 'front'
  return new ShaderMaterial({
    uniforms: {
      glowColor: { value: new Vector3(inner ? 0.32 : 0.22, inner ? 0.78 : 0.62, inner ? 0.98 : 0.95) },
      sunDirection: { value: input.sunDirection },
      coefficient: { value: inner ? 1.04 : 0.62 },
      power: { value: inner ? 3.4 : 5.6 },
      intensity: { value: inner ? 0.48 : 0.62 },
    },
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    blending: AdditiveBlending,
    side: inner ? FrontSide : BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}
