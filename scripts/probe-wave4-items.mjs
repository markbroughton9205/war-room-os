const urls = [
  'https://www.bom.gov.au/fwo/IDZ00054.warnings_nsw.xml',
  'https://www.bom.gov.au/fwo/IDZ00059.warnings_vic.xml',
  'https://alerts.metservice.com/cap/rss',
  'https://www.e-nexco.co.jp/bids/public_notice/const_hq/const_hq.xml',
  'https://www.e-nexco.co.jp/bids/public_notice/const_kanto/const_kanto.xml',
  'https://www.antaranews.com/rss/ekonomi',
  'https://www.cnbcindonesia.com/news/rss',
  'https://www.solarserver.de/feed/',
  'https://finance.detik.com/rss',
  'https://www.bwe-seminare.de/rss.xml',
  'https://www.agenciacyta.org.ar/feed/',
  'https://blog.scielo.org/es/feed/',
]

function items(xml) {
  const blocks = xml.split(/<item[\s>]/i).slice(1)
  return blocks.slice(0, 4).map(block => {
    const grab = tag => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .trim()
    const href = (block.match(/<link[^>]+href=["']([^"']+)/i) || [])[1]
    return {
      title: grab('title')?.slice(0, 180) ?? null,
      link: grab('link')?.slice(0, 200) || href || null,
      guid: grab('guid')?.slice(0, 200) ?? null,
      date: grab('pubDate') ?? grab('dc:date') ?? null,
      desc: grab('description')?.slice(0, 160) ?? null,
    }
  })
}

for (const url of urls) {
  const res = await fetch(url, { headers: { 'user-agent': 'WarRoomPlanetaryFabric/4.0' }, signal: AbortSignal.timeout(15000) })
  const xml = await res.text()
  console.log('\n====', url, res.status, '====')
  console.log(JSON.stringify(items(xml), null, 2))
}
