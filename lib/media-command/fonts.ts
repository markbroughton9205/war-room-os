/**
 * Approved HVS font catalog. CSS stacks for Program Viewer.
 * Render (libass) uses the first family name that fontconfig can resolve.
 * Do not copy or redistribute font files.
 */
export type HvsFontId =
  | 'dejavu-sans'
  | 'dejavu-serif'
  | 'liberation-sans'
  | 'liberation-serif'
  | 'nimbus-sans'
  | 'free-sans'
  | 'cinzel'
  | 'times'

export type HvsFontSpec = {
  id: HvsFontId
  label: string
  css: string
  assName: string
  fallbackAss: string
}

export const HVS_FONTS: HvsFontSpec[] = [
  { id: 'dejavu-sans', label: 'DejaVu Sans', css: '"DejaVu Sans", "Liberation Sans", Arial, sans-serif', assName: 'DejaVu Sans', fallbackAss: 'Sans' },
  { id: 'dejavu-serif', label: 'DejaVu Serif', css: '"DejaVu Serif", "Liberation Serif", "Times New Roman", serif', assName: 'DejaVu Serif', fallbackAss: 'Serif' },
  { id: 'liberation-sans', label: 'Liberation Sans', css: '"Liberation Sans", "DejaVu Sans", Arial, sans-serif', assName: 'Liberation Sans', fallbackAss: 'Sans' },
  { id: 'liberation-serif', label: 'Liberation Serif', css: '"Liberation Serif", "Times New Roman", serif', assName: 'Liberation Serif', fallbackAss: 'Serif' },
  { id: 'nimbus-sans', label: 'Nimbus Sans', css: '"Nimbus Sans", "Liberation Sans", Arial, sans-serif', assName: 'Nimbus Sans L', fallbackAss: 'Sans' },
  { id: 'free-sans', label: 'FreeSans', css: 'FreeSans, "DejaVu Sans", Arial, sans-serif', assName: 'FreeSans', fallbackAss: 'Sans' },
  { id: 'cinzel', label: 'Cinzel (CSS; render falls back)', css: 'Cinzel, "Times New Roman", "DejaVu Serif", serif', assName: 'Cinzel', fallbackAss: 'DejaVu Serif' },
  { id: 'times', label: 'Times', css: '"Times New Roman", Times, "Liberation Serif", serif', assName: 'Times New Roman', fallbackAss: 'DejaVu Serif' },
]

export const HVS_DEFAULT_FONT = HVS_FONTS[0]

export function findHvsFont(family: string | null | undefined): HvsFontSpec {
  if (!family) return HVS_DEFAULT_FONT
  const needle = family.toLowerCase()
  return HVS_FONTS.find(font => needle.includes(font.label.toLowerCase()) || needle.includes(font.assName.toLowerCase()) || needle.includes(font.id)) ?? HVS_DEFAULT_FONT
}

export function cssFontFamily(family: string | null | undefined): string {
  return findHvsFont(family).css
}

export function assFontName(family: string | null | undefined, available: string[] = []): string {
  const spec = findHvsFont(family)
  const hay = available.map(name => name.toLowerCase())
  if (hay.some(name => name.includes(spec.assName.toLowerCase()))) return spec.assName
  if (hay.some(name => name.includes(spec.fallbackAss.toLowerCase()))) return spec.fallbackAss
  const dejavu = available.find(name => /dejavu sans/i.test(name))
  if (dejavu) return 'DejaVu Sans'
  const liberation = available.find(name => /liberation sans/i.test(name))
  if (liberation) return 'Liberation Sans'
  return spec.fallbackAss || 'Sans'
}

export function parseFontList(raw: string): string[] {
  return raw
    .split('\n')
    .map(line => line.split(',')[0]?.trim() ?? '')
    .filter(Boolean)
}
