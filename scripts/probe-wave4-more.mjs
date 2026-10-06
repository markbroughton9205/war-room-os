const urls = [
  'https://www.antaranews.com/rss',
  'https://www.antaranews.com/rss/terkini',
  'https://www.antaranews.com/rss/top-news',
  'https://www.cnnindonesia.com/ekonomi/rss',
  'https://www.cnnindonesia.com/nasional/rss',
  'https://www.liputan6.com/rss',
  'https://www.republika.co.id/rss',
  'https://rss.tempo.co/',
  'https://nasional.kompas.com/rss',
  'https://money.kompas.com/rss',
  'https://www.kompas.com/rss',
  'https://www.mdh.or.tz/feed',
  'https://www.ccbrt.or.tz/feed',
  'https://www.lvcthealth.org/feed',
  'https://www.redcross.or.ke/feed',
  'https://nairobi.go.ke/feed',
  'https://www.amref.org/kenya/feed',
  'https://www.amref.org/tanzania/feed/',
  'https://www.ncm.gov.sa/ar/Pages/rss.aspx',
  'https://www.ncema.gov.ae/rss.xml',
  'https://www.cdd.gov.jo/rss.xml',
  'https://www.civildefence.gov.qa/rss',
  'https://www.met.gov.kw/RSS/rss.xml',
  'https://www.petra.gov.jo/rss.xml',
  'https://en.antaranews.com/rss/ekonomi',
]

function firstTitles(xml) {
  return xml.split(/<item[\s>]/i).slice(1, 6).map(block => {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').trim()
    return title?.slice(0, 140) ?? null
  }).filter(Boolean)
}

for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'WarRoomPlanetaryFabric/4.0' }, redirect: 'follow', signal: AbortSignal.timeout(12000) })
    const xml = await res.text()
    const live = /<rss[\s>]|<rdf:RDF|<feed[\s>]/i.test(xml)
    const titles = live ? firstTitles(xml) : []
    const infra = titles.filter(t => /infrastruktur|jalan|jembatan|tol|kereta|pelabuhan|bandara|rel |flyover/i.test(t))
    const sw = /\b(afya|jamii|chanjo|hospitali|magonjwa|habari)\b/i.test(xml)
    const ar = /[\u0600-\u06ff]/.test(xml)
    console.log(JSON.stringify({ url, status: res.status, type: (res.headers.get('content-type') || '').slice(0, 40), live, infra, sw, ar, titles: titles.slice(0, 4) }))
  } catch (error) {
    console.log(JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) }))
  }
}
