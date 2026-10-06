import { assertIdentityAuthority } from './authority'
import {
  RAEL_CHARACTER_ID,
  dhId,
  emptyAppearance,
  emptyBody,
  emptyContinuity,
  emptyPerformanceProfile,
  emptyRig,
  type HvsAuthorityActor,
  type HvsCharacterBible,
  type HvsDigitalHuman,
  type HvsDigitalHumanStore,
  type HvsWardrobeSet,
} from './types'

export const RAEL_DISPLAY_NAME = "Ra'el"

const BIBLE_SECTIONS: HvsCharacterBible['sections'] = {
  identity: "Ra'el is the Commander's authorized digital-human identity inside Higher Vision Studios. Fictional characters are not Ra'el.",
  appearance: 'Appearance stays unset until the Commander supplies it. Do not infer traits from reference images.',
  body: 'Body measurements stay unset until the Commander supplies them. Do not invent measurements.',
  hair: 'Hair stays unset until the Commander supplies it.',
  wardrobe: 'Named sets: RAEL_BLACK_SUIT, RAEL_CASUAL, RAEL_STREETWEAR. No generated garments in this slice.',
  voice: 'Voice is not enrolled. Voice cloning is not authorized.',
  mannerisms: 'Reserved, measured, direct. Creative direction may use these without redefining identity.',
  posture: 'Upright. Subtle defaults.',
  gait: 'Even walk. No invented gait measurements.',
  gestureTendencies: 'Low frequency, small amplitude, unless a performance reference says otherwise.',
  expressionTendencies: 'Calm baseline. Serious and confident are allowed variations.',
  speakingStyle: 'Measured tempo. Answer after a beat when the direction calls for hesitation.',
  continuityNotes: 'Same character id, wardrobe set, body profile, and identity lock across shots.',
  allowedVariations: 'Wardrobe set changes by explicit proposal. Emotional performance may vary by shot.',
  lockedTraits: 'Face, body, and voice identity stay locked. Director may not replace who Ra\'el is.',
}

export function raelWardrobeSets(): HvsWardrobeSet[] {
  return [
    { id: 'rael-black-suit', name: 'RAEL_BLACK_SUIT', garmentRefs: [], footwearRefs: [], accessoryRefs: [], colorIntent: 'black', styleIntent: 'tailored', continuityLocked: false },
    { id: 'rael-casual', name: 'RAEL_CASUAL', garmentRefs: [], footwearRefs: [], accessoryRefs: [], colorIntent: null, styleIntent: 'casual', continuityLocked: false },
    { id: 'rael-streetwear', name: 'RAEL_STREETWEAR', garmentRefs: [], footwearRefs: [], accessoryRefs: [], colorIntent: null, styleIntent: 'streetwear', continuityLocked: false },
  ]
}

export function createRaelRecord(actor: HvsAuthorityActor, now = new Date().toISOString()): { human: HvsDigitalHuman; bible: HvsCharacterBible } {
  assertIdentityAuthority(actor, 'NEW_IDENTITY_REFERENCE')
  const wardrobe = raelWardrobeSets()
  const human: HvsDigitalHuman = {
    id: RAEL_CHARACTER_ID,
    projectScope: null,
    globalCharacterId: 'commander.rael',
    name: 'rael',
    displayName: RAEL_DISPLAY_NAME,
    characterClass: 'COMMANDER_DIGITAL_HUMAN',
    identityClass: 'COMMANDER',
    appearanceProfile: emptyAppearance(),
    bodyProfile: emptyBody(),
    faceProfile: { notes: [], referenceAssetIds: [] },
    hairProfile: { style: null, color: null, locked: true },
    wardrobeSets: wardrobe,
    activeWardrobeSetId: wardrobe[0]?.id ?? null,
    performanceProfile: emptyPerformanceProfile('AUTHORITATIVE'),
    voiceBinding: null,
    rigBinding: emptyRig(),
    generatorBindings: [],
    representations: [],
    referenceAssetIds: [],
    referenceSetVersion: 'rael-unset',
    continuityState: {
      ...emptyContinuity(),
      wardrobeSetId: wardrobe[0]?.id ?? null,
    },
    identityLock: {
      characterId: RAEL_CHARACTER_ID,
      faceLocked: true,
      bodyLocked: true,
      voiceLocked: false,
      hairLocked: true,
      wardrobeLocked: false,
      providerConsistencyRequired: true,
    },
    consentState: 'COMMANDER_SELF_AUTHORIZED',
    authorityState: 'COMMANDER_ONLY',
    persistence: 'PERSISTENT',
    lodDefault: 'HIGH',
    createdAt: now,
    updatedAt: now,
  }
  const bible: HvsCharacterBible = {
    id: 'rael-bible',
    characterId: RAEL_CHARACTER_ID,
    version: 1,
    sections: { ...BIBLE_SECTIONS },
    createdAt: now,
    updatedAt: now,
  }
  return { human, bible }
}

export function authorizeRael(store: HvsDigitalHumanStore, actor: HvsAuthorityActor, now = new Date().toISOString()): HvsDigitalHuman {
  const existing = store.characters.find(item => item.id === RAEL_CHARACTER_ID)
  if (existing) return existing
  const { human, bible } = createRaelRecord(actor, now)
  store.characters.push(human)
  store.bibles.push(bible)
  store.activeCharacterId = human.id
  return human
}
