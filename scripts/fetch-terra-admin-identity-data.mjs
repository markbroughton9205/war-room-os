/**
 * Fetch lawful Natural Earth compact geometry + verified flag SVGs into
 * public/terra/admin-identity/. Run from repo root.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'public', 'terra', 'admin-identity')
const tmp = path.join(root, '.tmp', 'terra-admin-identity')
const UA = 'WarRoomOS-TerraAdminIdentity/0.2 (Commander geographic identity; local install)'

const NE = {
  countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
  admin1: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_1_states_provinces.geojson',
  places: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_populated_places.geojson',
}

const FLAG_ICONS_ZIP = 'https://codeload.github.com/lipis/flag-icons/tar.gz/refs/tags/v7.5.0'

const STATE_FILES = [
  ['US-AL', 'Flag_of_Alabama.svg'],
  ['US-AK', 'Flag_of_Alaska.svg'],
  ['US-AZ', 'Flag_of_Arizona.svg'],
  ['US-AR', 'Flag_of_Arkansas.svg'],
  ['US-CA', 'Flag_of_California.svg'],
  ['US-CO', 'Flag_of_Colorado.svg'],
  ['US-CT', 'Flag_of_Connecticut.svg'],
  ['US-DE', 'Flag_of_Delaware.svg'],
  ['US-FL', 'Flag_of_Florida.svg'],
  ['US-GA', 'Flag_of_Georgia_(U.S._state).svg'],
  ['US-HI', 'Flag_of_Hawaii.svg'],
  ['US-ID', 'Flag_of_Idaho.svg'],
  ['US-IL', 'Flag_of_Illinois.svg'],
  ['US-IN', 'Flag_of_Indiana.svg'],
  ['US-IA', 'Flag_of_Iowa.svg'],
  ['US-KS', 'Flag_of_Kansas.svg'],
  ['US-KY', 'Flag_of_Kentucky.svg'],
  ['US-LA', 'Flag_of_Louisiana.svg'],
  ['US-ME', 'Flag_of_Maine.svg'],
  ['US-MD', 'Flag_of_Maryland.svg'],
  ['US-MA', 'Flag_of_Massachusetts.svg'],
  ['US-MI', 'Flag_of_Michigan.svg'],
  ['US-MN', 'Flag_of_Minnesota.svg'],
  ['US-MS', 'Flag_of_Mississippi.svg'],
  ['US-MO', 'Flag_of_Missouri.svg'],
  ['US-MT', 'Flag_of_Montana.svg'],
  ['US-NE', 'Flag_of_Nebraska.svg'],
  ['US-NV', 'Flag_of_Nevada.svg'],
  ['US-NH', 'Flag_of_New_Hampshire.svg'],
  ['US-NJ', 'Flag_of_New_Jersey.svg'],
  ['US-NM', 'Flag_of_New_Mexico.svg'],
  ['US-NY', 'Flag_of_New_York.svg'],
  ['US-NC', 'Flag_of_North_Carolina.svg'],
  ['US-ND', 'Flag_of_North_Dakota.svg'],
  ['US-OH', 'Flag_of_Ohio.svg'],
  ['US-OK', 'Flag_of_Oklahoma.svg'],
  ['US-OR', 'Flag_of_Oregon.svg'],
  ['US-PA', 'Flag_of_Pennsylvania.svg'],
  ['US-RI', 'Flag_of_Rhode_Island.svg'],
  ['US-SC', 'Flag_of_South_Carolina.svg'],
  ['US-SD', 'Flag_of_South_Dakota.svg'],
  ['US-TN', 'Flag_of_Tennessee.svg'],
  ['US-TX', 'Flag_of_Texas.svg'],
  ['US-UT', 'Flag_of_Utah.svg'],
  ['US-VT', 'Flag_of_Vermont.svg'],
  ['US-VA', 'Flag_of_Virginia.svg'],
  ['US-WA', 'Flag_of_Washington.svg'],
  ['US-WV', 'Flag_of_West_Virginia.svg'],
  ['US-WI', 'Flag_of_Wisconsin.svg'],
  ['US-WY', 'Flag_of_Wyoming.svg'],
  ['US-DC', 'Flag_of_the_District_of_Columbia.svg'],
  ['CA-ON', 'Flag_of_Ontario.svg'],
  ['CA-QC', 'Flag_of_Quebec.svg'],
  ['CA-BC', 'Flag_of_British_Columbia.svg'],
  ['AU-NSW', 'Flag_of_New_South_Wales.svg'],
  ['AU-VIC', 'Flag_of_Victoria_(Australia).svg'],
  ['AU-QLD', 'Flag_of_Queensland.svg'],
  ['DE-BY', 'Flag_of_Bavaria_(lozengy).svg'],
  ['ES-CT', 'Flag_of_Catalonia.svg'],
  ['JP-13', 'Flag_of_Tokyo_Metropolis.svg'],
]

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

async function download(url, destPath) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirp(path.dirname(destPath))
  fs.writeFileSync(destPath, buf)
  return buf
}

function round(n, digits = 3) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function ringsFromGeometry(geometry) {
  if (!geometry) return []
  const rings = []
  const pushPoly = (coords) => {
    const ring = (coords[0] || []).map(([lon, lat]) => [round(lon), round(lat)])
    if (ring.length >= 4) rings.push(dedupe(ring))
  }
  if (geometry.type === 'Polygon') pushPoly(geometry.coordinates)
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) pushPoly(poly)
  }
  return rings
}

function dedupe(ring) {
  const out = []
  for (const pt of ring) {
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) out.push(pt)
  }
  if (out.length >= 2 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    /* closed */
  } else if (out.length) {
    out.push(out[0])
  }
  return out
}

function bboxOf(rings) {
  let west = 180
  let south = 90
  let east = -180
  let north = -90
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  return [west, south, east, north]
}

function centroid(rings) {
  const ring = rings[0] || []
  if (!ring.length) return [0, 0]
  let x = 0
  let y = 0
  let n = 0
  for (const [lon, lat] of ring) {
    x += lon
    y += lat
    n += 1
  }
  return [round(x / n, 4), round(y / n, 4)]
}

function disputedFromProps(p) {
  const featurecla = String(p.FEATURECLA || p.featurecla || '')
  const type = String(p.TYPE || p.type || '')
  const note = `${featurecla} ${type}`.trim()
  const disputed = /disputed|claim|breakaway|overlap|indeterminate/i.test(note) || p.DISPUTED === 1 || p.disputed === 1
  return { disputed, disputeNote: disputed ? note || 'Natural Earth disputed classification' : null }
}

function compactCountries(geojson) {
  const features = []
  for (const feat of geojson.features || []) {
    const p = feat.properties || {}
    const rings = ringsFromGeometry(feat.geometry)
    if (!rings.length) continue
    const [lon, lat] = centroid(rings)
    const iso2 = String(p.ISO_A2 || p.iso_a2 || '').toUpperCase()
    const { disputed, disputeNote } = disputedFromProps(p)
    features.push({
      id: String(p.ADM0_A3 || p.ISO_A3 || p.NAME || features.length),
      name: String(p.NAME || p.ADMIN || p.NAME_EN || 'Unknown'),
      kind: 'country',
      iso2: iso2.length === 2 && iso2 !== '-1' ? iso2 : null,
      iso3: String(p.ADM0_A3 || p.ISO_A3 || '') || null,
      iso3166_2: null,
      adm0: String(p.ADM0_A3 || '') || null,
      labelRank: Number(p.LABELRANK ?? p.labelrank ?? 6),
      disputed,
      disputeNote,
      lon,
      lat,
      bbox: bboxOf(rings),
      rings,
    })
  }
  return {
    name: 'ne_110m_admin_0_countries',
    provenanceId: 'natural_earth',
    version: '5.1.2',
    license: 'Public Domain',
    featureCount: features.length,
    features,
  }
}

function compactAdmin1(geojson) {
  const features = []
  for (const feat of geojson.features || []) {
    const p = feat.properties || {}
    const rings = ringsFromGeometry(feat.geometry)
    if (!rings.length) continue
    const [lon, lat] = centroid(rings)
    const { disputed, disputeNote } = disputedFromProps(p)
    features.push({
      id: String(p.iso_3166_2 || p.adm1_code || p.name || features.length),
      name: String(p.name || p.NAME || p.name_en || 'Unknown'),
      kind: 'state',
      iso2: String(p.iso_a2 || '').toUpperCase() || null,
      iso3: String(p.adm0_a3 || '') || null,
      iso3166_2: String(p.iso_3166_2 || '') || null,
      adm0: String(p.adm0_a3 || '') || null,
      labelRank: Number(p.labelrank ?? p.scalerank ?? 6),
      disputed,
      disputeNote,
      lon,
      lat,
      bbox: bboxOf(rings),
      rings,
    })
  }
  return {
    name: 'ne_50m_admin_1_states_provinces',
    provenanceId: 'natural_earth',
    version: '5.1.2',
    license: 'Public Domain',
    featureCount: features.length,
    features,
  }
}

function compactPlaces(geojson) {
  const features = []
  for (const feat of geojson.features || []) {
    const p = feat.properties || {}
    const coords = feat.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) continue
    const rank = Number(p.SCALERANK ?? p.LABELRANK ?? 8)
    if (rank > 6) continue
    features.push({
      id: String(p.GEONAMEID || p.NAME || features.length),
      name: String(p.NAME || p.NAMEASCII || 'Unknown'),
      kind: 'place',
      iso2: String(p.ISO_A2 || p.ADM0_A2 || '').toUpperCase() || null,
      iso3: String(p.ADM0_A3 || '') || null,
      iso3166_2: String(p.ADM1_CODE || '') || null,
      adm0: String(p.ADM0_A3 || '') || null,
      labelRank: rank,
      disputed: false,
      disputeNote: null,
      lon: round(Number(coords[0]), 4),
      lat: round(Number(coords[1]), 4),
      bbox: [Number(coords[0]), Number(coords[1]), Number(coords[0]), Number(coords[1])],
      rings: [],
    })
  }
  return {
    name: 'ne_110m_populated_places',
    provenanceId: 'natural_earth',
    version: '5.1.2',
    license: 'Public Domain',
    featureCount: features.length,
    features,
  }
}

async function main() {
  mkdirp(dest)
  mkdirp(tmp)
  mkdirp(path.join(dest, 'flags', 'countries'))
  mkdirp(path.join(dest, 'flags', 'states'))

  console.log('Downloading Natural Earth countries 110m…')
  const countriesRaw = JSON.parse((await download(NE.countries, path.join(tmp, 'countries.geojson'))).toString('utf8'))
  const countries = compactCountries(countriesRaw)
  fs.writeFileSync(path.join(dest, 'countries-110m.json'), JSON.stringify(countries))
  console.log(`  ${countries.featureCount} countries`)

  console.log('Downloading Natural Earth admin-1 50m…')
  const admin1Raw = JSON.parse((await download(NE.admin1, path.join(tmp, 'admin1.geojson'))).toString('utf8'))
  const admin1 = compactAdmin1(admin1Raw)
  fs.writeFileSync(path.join(dest, 'admin1-50m.json'), JSON.stringify(admin1))
  console.log(`  ${admin1.featureCount} states/provinces`)

  console.log('Downloading Natural Earth populated places 110m…')
  const placesRaw = JSON.parse((await download(NE.places, path.join(tmp, 'places.geojson'))).toString('utf8'))
  const places = compactPlaces(placesRaw)
  fs.writeFileSync(path.join(dest, 'places-110m.json'), JSON.stringify(places))
  console.log(`  ${places.featureCount} places`)

  console.log('Downloading flag-icons 7.5.0 (MIT)…')
  const zipPath = path.join(tmp, 'flag-icons.tgz')
  await download(FLAG_ICONS_ZIP, zipPath)
  const extractDir = path.join(tmp, 'flag-icons')
  fs.rmSync(extractDir, { recursive: true, force: true })
  mkdirp(extractDir)
  execSync(`tar -xzf "${zipPath}" -C "${extractDir}" --strip-components=1`, { stdio: 'inherit' })
  const svgDir = path.join(extractDir, 'flags', '4x3')
  for (const file of fs.readdirSync(svgDir)) {
    if (!file.endsWith('.svg')) continue
    fs.copyFileSync(path.join(svgDir, file), path.join(dest, 'flags', 'countries', file))
  }
  console.log(`  copied ${fs.readdirSync(path.join(dest, 'flags', 'countries')).length} country flags`)

  console.log('Downloading Wikimedia Commons state/province flags…')
  let stateOk = 0
  let stateFail = 0
  for (const [iso, file] of STATE_FILES) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`
    const out = path.join(dest, 'flags', 'states', `${iso}.svg`)
    try {
      await download(url, out)
      const head = fs.readFileSync(out, 'utf8').slice(0, 80)
      if (!head.includes('<svg') && !head.includes('<?xml')) {
        fs.unlinkSync(out)
        throw new Error('not svg')
      }
      stateOk += 1
    } catch (error) {
      stateFail += 1
      console.warn(`  skip ${iso}: ${error.message}`)
    }
  }
  console.log(`  state flags ok=${stateOk} fail=${stateFail}`)

  const provenance = {
    generatedAt: new Date().toISOString(),
    sources: {
      natural_earth: {
        license: 'Public Domain',
        homepage: 'https://www.naturalearthdata.com/about/terms-of-use/',
        files: ['countries-110m.json', 'admin1-50m.json', 'places-110m.json'],
        version: '5.1.2',
      },
      flag_icons: {
        license: 'MIT',
        homepage: 'https://github.com/lipis/flag-icons',
        version: '7.5.0',
        files: ['flags/countries/*.svg'],
      },
      wikimedia_commons: {
        license: 'Per-file (US state flags typically public domain)',
        homepage: 'https://commons.wikimedia.org/',
        files: ['flags/states/*.svg'],
        downloaded: stateOk,
        missing: stateFail,
      },
    },
    claims: 'War Room does not make territorial claims. Disputed Natural Earth classifications are preserved.',
  }
  fs.writeFileSync(path.join(dest, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2))
  console.log('Wrote', dest)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
