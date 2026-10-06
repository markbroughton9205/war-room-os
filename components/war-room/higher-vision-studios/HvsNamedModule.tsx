'use client'

import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'

const MODULES: Record<string, { title: string; kicker: string; status: 'live' | 'boundary'; body: string[] }> = {
  'ai-video': {
    title: 'AI Video',
    kicker: 'Provider-neutral generation',
    status: 'boundary',
    body: [
      'Capabilities reserved: text-to-video, image-to-video, video-to-video, reference, character reference, shot extension, background replacement, B-roll, camera-controlled generation, style transform.',
      'Creative request → Media Provider Router → Provider Job → AssetRecord + provenance → optional EditOp insert.',
      'No provider owns .hvsproj state. Beauty identity morphing remains OFF unless explicitly authorized.',
    ],
  },
  'ai-images': {
    title: 'AI Images',
    kicker: 'Generated images become ordinary Assets',
    status: 'boundary',
    body: [
      'text-to-image, image editing, storyboard frames, thumbnails, product shots, key art, backgrounds, ads, characters, concept art.',
      'Jobs resolve through the Media Provider Router with provenance (provider, model, prompt, seed, commercial-use state).',
    ],
  },
  storyboards: {
    title: 'Storyboards',
    kicker: 'Shot plan frames',
    status: 'boundary',
    body: ['StoryboardFrame records live on the .hvsproj. The luxury-beauty demo ships a five-board commercial plan. Frames may later bind generated stills as Assets.'],
  },
  scripts: {
    title: 'Scripts',
    kicker: 'Production copy',
    status: 'boundary',
    body: ['ScriptDocument is first-class project state. AI Director may read scripts; it still emits EditOps, not prose tips, when cutting.'],
  },
  characters: {
    title: 'Characters',
    kicker: 'Talent authority',
    status: 'boundary',
    body: ['CharacterRecord tracks talent, stylist, and generated non-identity stand-ins. identityMorphing defaults to off. Real talent remains authoritative.'],
  },
  camera: {
    title: 'Camera',
    kicker: 'Three concepts, never conflated',
    status: 'live',
    body: [
      'MULTICAM = real multiple cameras.',
      'CAMERASPEC = generated shot intent (size, angle, movement, lens, DOF, trajectory).',
      'VIRTUAL CAMERA / FOLLOW = reframing existing footage from TrackSubject. Proving case: 16:9 → intelligent 9:16.',
    ],
  },
  tracking: {
    title: 'Tracking',
    kicker: 'Follow this person',
    status: 'live',
    body: [
      'TrackSubject V1: selected person, single-shot, confidence, lost-target, reacquisition, human correction.',
      'Detect → TrackSubject → TrackData → VirtualCamera → framing (CENTER LOCK / RULE OF THIRDS / FACE LOCK / UPPER BODY / FULL BODY / DYNAMIC / CINEMATIC) → keyframes.',
      'Not a center-crop.',
    ],
  },
  effects: {
    title: 'Effects',
    kicker: 'Extensible kind registry',
    status: 'boundary',
    body: ['dissolve, wipe, slide, push, zoom, blur, glitch, camera/mask/light transitions, film, glow, motion blur, shake, grain, distortion, overlays. Slice-0 registers the model; OpenFX is not hosted.'],
  },
  filters: {
    title: 'Filters',
    kicker: 'Non-destructive looks',
    status: 'live',
    body: ['Luxury Gold, Clean Beauty, Cinematic, Warm Lifestyle, Dark Luxury, Commercial Clean, Film, Dream, Vintage, Street, Gaming Neon. Amount 0–1, applied through applyFilter EditOp.'],
  },
  themes: {
    title: 'Themes',
    kicker: 'ThemeSpec engine · no CapCut runtime',
    status: 'live',
    body: ['Versioned ThemeSpecs package typography, captions, color, transitions, effects, pacing, music behavior, logo, overlays, motion, camera hints. Initial theme: luxury_beauty_v1 (Higher Vision luxury beauty demo).'],
  },
  color: {
    title: 'Color',
    kicker: 'Initial grade only',
    status: 'live',
    body: ['exposure, contrast, saturation, temperature, look/filter. Architecture reserved for curves, wheels, masks, scopes, LUT, OCIO, HDR, ACES — not in slice-0.'],
  },
  audio: {
    title: 'Audio',
    kicker: 'Waveform · volume · fade · duck',
    status: 'live',
    body: ['Initial: waveform, volume, fade, music, voiceover, captions, simple ducking. Reserved: EQ, compression, isolation, noise reduction, beat detection.'],
  },
  voice: {
    title: 'Voice',
    kicker: 'Provider-routed TTS / VO',
    status: 'boundary',
    body: ['VOICE and TTS categories on the Media Provider Router. Results become Assets. No auto-publish to business accounts.'],
  },
  music: {
    title: 'Music / SFX',
    kicker: 'Beds, hits, ducking',
    status: 'live',
    body: ['addMusic / addVoice / duckMusic EditOps. Beat markers reserved for cut-on-beat Director commands.'],
  },
}

export function HvsNamedModule({ id }: { id: keyof typeof MODULES }) {
  const mod = MODULES[id]
  return (
    <HvsModuleSurface title={mod.title} kicker={mod.kicker} status={mod.status}>
      <div className="foundry-glass space-y-2 rounded-lg border border-amber-900/40 p-4 text-sm text-slate-300">
        {mod.body.map(p => <p key={p}>{p}</p>)}
      </div>
    </HvsModuleSurface>
  )
}
