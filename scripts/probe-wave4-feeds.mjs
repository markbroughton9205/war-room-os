const urls = [
  'https://www.bom.gov.au/fwo/IDZ00054.warnings_nsw.xml',
  'https://www.bom.gov.au/fwo/IDZ00059.warnings_vic.xml',
  'https://alerts.metservice.com/cap/rss',
  'https://www.e-nexco.co.jp/bids/public_notice/const_hq/const_hq.xml',
  'https://www.e-nexco.co.jp/bids/public_notice/const_kanto/const_kanto.xml',
  'https://www.antaranews.com/rss/ekonomi',
  'https://www.antaranews.com/rss/nasional',
  'https://www.cnbcindonesia.com/news/rss',
  'https://properti.detik.com/rss',
  'https://finance.detik.com/rss',
  'https://www.kompas.com/properti/rss',
  'https://www.jawapos.com/infrastruktur/rss',
  'https://www.solarserver.de/feed/',
  'https://www.iwr.de/rss.xml',
  'https://www.pv-magazine.de/feed/',
  'https://www.bwe-seminare.de/rss.xml',
  'https://www.conicet.gov.ar/feed/',
  'https://www.agenciacyta.org.ar/feed/',
  'https://blog.scielo.org/es/feed/',
  'https://www.invdes.com.mx/feed/',
  'https://998.gov.sa/Ar/News/Pages/RssFeed.aspx',
  'https://www.moh.go.tz/feed',
  'https://sikika.or.tz/index.php/sw/?format=feed&type=rss',
  'https://twaweza.org/feed/',
  'https://www.ktr.mlit.go.jp/rss/press.xml',
  'https://www.gsi.go.jp/common/000000000.rdf',
  'https://www.nilim.go.jp/lab/bcg/siryou/rss.xml',
  'https://www.metro.tokyo.lg.jp/tosei/hodohappyo/press.rdf',
]

async function probe(url) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'WarRoomPlanetaryFabric/4.0 (wave4-inspect; metadata-only)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString('utf8').slice(0, 4000)
    const itemCount = (text.match(/<item[\s>]|<entry[\s>]/gi) || []).length
    const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
    const link = (text.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || (text.match(/<link[^>]+href=["']([^"']+)/i) || [])[1]
    const ftp = /ftp:\/\//i.test(text)
    const arabic = /[\u0600-\u06ff]/.test(text)
    const swahili = /\b(afya|jamii|chanjo|hospitali|habari)\b/i.test(text)
    return {
      url,
      status: res.status,
      type: res.headers.get('content-type'),
      bytes: buf.length,
      ms: Date.now() - started,
      itemCount,
      title: title ? title.replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 120) : null,
      link: link ? String(link).replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 160) : null,
      ftp,
      arabic,
      swahili,
      snippet: text.replace(/\s+/g, ' ').slice(0, 180),
    }
  } catch (error) {
    return { url, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started }
  }
}

const rows = []
for (const url of urls) {
  rows.push(await probe(url))
}
console.log(JSON.stringify(rows, null, 2))
