import { pathToFileURL } from 'node:url'
import {
  dayNightStateFromElevation,
  formatZonedClock,
  relativeAgeLabel,
  resolveIanaTimeZone,
  resolveTerraWorldTime,
  solarElevationDegrees,
  solarPosition,
  worldClockStrip,
} from './worldTime'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const akron = resolveIanaTimeZone(41.081, -81.519)
  const tokyo = resolveIanaTimeZone(35.676, 139.65)
  const kyiv = resolveIanaTimeZone(50.45, 30.523)
  const helsinki = resolveIanaTimeZone(60.17, 24.94)
  const beirut = resolveIanaTimeZone(33.893, 35.501)
  results.push(check('akron_is_america_new_york', akron?.timeZone === 'America/New_York', akron?.timeZone ?? 'none'))
  results.push(check('tokyo_is_asia_tokyo', tokyo?.timeZone === 'Asia/Tokyo', tokyo?.timeZone ?? 'none'))
  results.push(check('kyiv_is_europe_kyiv', kyiv?.timeZone === 'Europe/Kyiv' || kyiv?.timeZone === 'Europe/Kiev', kyiv?.timeZone ?? 'none'))
  results.push(check('helsinki_is_europe_helsinki', helsinki?.timeZone === 'Europe/Helsinki', helsinki?.timeZone ?? 'none'))
  results.push(check('beirut_is_asia_beirut', beirut?.timeZone === 'Asia/Beirut', beirut?.timeZone ?? 'none'))

  const summer = formatZonedClock('2026-09-16T19:42:00.000Z', 'America/New_York')
  const winter = formatZonedClock('2026-01-15T19:42:00.000Z', 'America/New_York')
  results.push(check(
    'dst_changes_new_york_offset',
    Boolean(summer?.utcOffset === 'UTC-4' && winter?.utcOffset === 'UTC-5' && summer.dstActive === true && winter.dstActive === false),
    `${summer?.utcOffset ?? '?'} dst=${String(summer?.dstActive)} vs ${winter?.utcOffset ?? '?'} dst=${String(winter?.dstActive)}`,
  ))

  const tokyoNight = resolveTerraWorldTime({
    utcIso: '2026-09-16T19:42:00.000Z',
    latitude: 35.676,
    longitude: 139.65,
    place: '東京 / Tokyo',
  })
  results.push(check(
    'tokyo_local_clock_and_night',
    Boolean(tokyoNight.timeZone === 'Asia/Tokyo' && tokyoNight.utcOffset === 'UTC+9' && tokyoNight.dayNightState === 'NIGHT' && tokyoNight.localTime && tokyoNight.nativePlaceName === '東京' && tokyoNight.englishPlaceName === 'Tokyo'),
    `${tokyoNight.localTime ?? 'none'} ${tokyoNight.dayNightState ?? 'none'}`,
  ))

  const akronDay = resolveTerraWorldTime({
    utcIso: '2026-09-16T19:42:00.000Z',
    latitude: 41.081,
    longitude: -81.519,
    place: 'Akron, Ohio',
  })
  results.push(check(
    'akron_local_clock_and_day',
    Boolean(akronDay.timeZone === 'America/New_York' && akronDay.utcOffset === 'UTC-4' && akronDay.dayNightState === 'DAY'),
    `${akronDay.localTime ?? 'none'} ${akronDay.dayNightState ?? 'none'}`,
  ))

  const event = resolveTerraWorldTime({
    utcIso: '2026-09-16T18:14:00.000Z',
    latitude: 50.45,
    longitude: 30.523,
    place: 'Kyiv',
    sourceTimestamp: '2026-09-16T18:14:00.000Z',
  })
  results.push(check(
    'event_keeps_utc_and_local',
    Boolean(event.sourceTimestamp === '2026-09-16T18:14:00.000Z' && event.eventLocalTime && event.eventUtcOffset === 'UTC+3'),
    `${event.eventLocalTime ?? 'none'} ${event.eventUtcOffset ?? 'none'}`,
  ))

  const commanderZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const ocean = resolveIanaTimeZone(0, -30)
  results.push(check(
    'ocean_is_not_commander_machine_zone',
    Boolean(ocean && ocean.timeZone !== commanderZone && ocean.coverageState === 'PARTIAL'),
    `${ocean?.timeZone ?? 'none'} commander=${commanderZone} ${ocean?.coverageState ?? ''}`,
  ))
  results.push(check(
    'does_not_use_commander_timezone_for_tokyo',
    tokyoNight.timeZone === 'Asia/Tokyo',
    `tokyo=${tokyoNight.timeZone} commander=${commanderZone}`,
  ))

  const elev = solarElevationDegrees(0, 0, '2026-09-16T12:00:00.000Z')
  const noon = solarPosition(0, 0, '2026-09-16T12:00:00.000Z')
  results.push(check('solar_elevation_is_finite', typeof elev === 'number' && Number.isFinite(elev), String(elev)))
  results.push(check(
    'civil_band_maps_to_twilight_or_day_or_night',
    ['DAY', 'NIGHT', 'SUNRISE', 'SUNSET'].includes(dayNightStateFromElevation(noon?.elevation ?? null, noon?.rising) ?? ''),
    String(dayNightStateFromElevation(noon?.elevation ?? null, noon?.rising)),
  ))

  const strip = worldClockStrip('2026-09-16T19:42:00.000Z', akronDay)
  results.push(check(
    'world_clock_strip_starts_with_local_then_named_cities',
    strip[0]?.id === 'local' && strip[0]?.selected === true && strip.some(city => city.id === 'tokyo' && city.localTime) && strip.some(city => city.id === 'sydney'),
    strip.map(city => city.id).join(','),
  ))
  results.push(check(
    'breaking_age_label',
    relativeAgeLabel('2026-09-16T19:35:00.000Z', '2026-09-16T19:42:00.000Z') === '7 minutes ago',
    relativeAgeLabel('2026-09-16T19:35:00.000Z', '2026-09-16T19:42:00.000Z') ?? 'none',
  ))
  return results
}

export function runTerraWorldTimeValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraWorldTimeValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra world time: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
