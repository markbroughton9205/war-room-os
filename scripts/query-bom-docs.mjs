import { PlanetaryRegistryStore } from '../lib/planetary-intelligence/registryStore.ts'

const store = new PlanetaryRegistryStore()
const docs = store.listDocuments().filter(row => {
  const blob = `${row.url ?? ''} ${row.canonical_url ?? ''} ${row.publisher ?? ''} ${row.title ?? ''}`
  return /bom|metservice|nexco|marine wind|sheep/i.test(blob)
})
console.log('matching docs', docs.length)
for (const doc of docs.slice(0, 20)) {
  console.log({
    title: doc.title,
    url: doc.canonical_url,
    lang: doc.detected_language,
    geo: doc.source_geography,
    class: doc.source_class,
    topic: doc.topic,
    publishedAt: doc.published_at,
    origin: doc.independent_origin_id,
  })
}
store.close()
