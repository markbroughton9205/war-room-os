/**
 * Native non-destructive filter system. Adjustable amount 0–1.
 */
export type FilterSpec = {
  id: string
  name: string
  css: string
  description: string
}

export const FILTER_SPECS: FilterSpec[] = [
  { id: 'luxury-gold', name: 'Luxury Gold', css: 'sepia(0.28) saturate(1.15) contrast(1.08) brightness(1.04)', description: 'Warm gold lift for beauty commercials.' },
  { id: 'clean-beauty', name: 'Clean Beauty', css: 'saturate(0.92) contrast(1.04) brightness(1.06)', description: 'Soft clean commercial skin.' },
  { id: 'cinematic', name: 'Cinematic', css: 'contrast(1.12) saturate(0.9) brightness(0.96)', description: 'Letterbox-ready contrast.' },
  { id: 'warm-lifestyle', name: 'Warm Lifestyle', css: 'sepia(0.18) saturate(1.1) brightness(1.05)', description: 'Afternoon lifestyle warmth.' },
  { id: 'dark-luxury', name: 'Dark Luxury', css: 'brightness(0.88) contrast(1.18) saturate(0.95)', description: 'Low-key jewel tones.' },
  { id: 'commercial-clean', name: 'Commercial Clean', css: 'saturate(1.02) contrast(1.05) brightness(1.03)', description: 'Neutral product-safe look.' },
  { id: 'film', name: 'Film', css: 'sepia(0.12) contrast(1.08) saturate(0.88)', description: 'Mild print stock.' },
  { id: 'dream', name: 'Dream', css: 'brightness(1.08) saturate(0.85) contrast(0.94)', description: 'Soft bloom atmosphere.' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.45) contrast(1.1) saturate(0.8)', description: 'Aged still.' },
  { id: 'street', name: 'Street', css: 'contrast(1.2) saturate(1.15) brightness(0.98)', description: 'Hard city contrast.' },
  { id: 'gaming-neon', name: 'Gaming Neon', css: 'saturate(1.45) contrast(1.15) hue-rotate(12deg)', description: 'Neon accent push.' },
]

export function getFilterSpec(id: string): FilterSpec | null {
  return FILTER_SPECS.find(f => f.id === id) ?? null
}

export function composeFilterCss(filterIds: Array<{ filterId: string; amount: number; enabled: boolean }>): string {
  const parts: string[] = []
  for (const applied of filterIds) {
    if (!applied.enabled || applied.amount <= 0) continue
    const spec = getFilterSpec(applied.filterId)
    if (!spec) continue
    parts.push(`opacity(${Math.max(0.15, applied.amount)})`)
    parts.push(spec.css)
  }
  return parts.length ? parts.join(' ') : 'none'
}
