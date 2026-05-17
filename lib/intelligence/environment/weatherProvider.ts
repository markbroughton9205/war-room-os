import { getEnvAliasNames, getEnvAliasValue, resolveEnvAlias } from '@/lib/configuration/envAlias'
import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import type { WeatherDashboardSnapshot, WeatherForecastPoint, WeatherProviderState } from '@/lib/intelligence/environment/liveEnvironmentTypes'

const WEATHER_ENV_NAMES = [...getEnvAliasNames('weatherApiKey'), ...getEnvAliasNames('weatherProvider')]
const WEATHER_TIMEOUT_MS = 8000

type OpenWeatherCurrent = {
  weather?: { description?: string }[]
  main?: { temp?: number; temp_min?: number; temp_max?: number }
  wind?: { speed?: number; deg?: number }
}

type OpenWeatherForecast = {
  list?: {
    dt_txt?: string
    main?: { temp?: number; temp_min?: number; temp_max?: number }
    weather?: { description?: string }[]
    pop?: number
    wind?: { speed?: number; deg?: number }
  }[]
}

type WeatherApiForecast = {
  location?: { name?: string; region?: string }
  current?: {
    temp_f?: number
    condition?: { text?: string }
    precip_in?: number
    wind_mph?: number
    wind_dir?: string
    last_updated?: string
  }
  forecast?: {
    forecastday?: {
      date?: string
      day?: { maxtemp_f?: number; mintemp_f?: number; daily_chance_of_rain?: number; condition?: { text?: string } }
      hour?: { time?: string; temp_f?: number; chance_of_rain?: number; condition?: { text?: string }; wind_mph?: number; wind_dir?: string }[]
    }[]
  }
  alerts?: { alert?: { headline?: string; severity?: string; expires?: string }[] }
}

type NwsPoints = {
  properties?: {
    forecast?: string
    forecastHourly?: string
    forecastZone?: string
    relativeLocation?: { properties?: { city?: string; state?: string } }
  }
}

type NwsForecast = {
  properties?: {
    generatedAt?: string
    periods?: {
      name?: string
      startTime?: string
      temperature?: number
      temperatureUnit?: string
      shortForecast?: string
      probabilityOfPrecipitation?: { value?: number | null }
      windSpeed?: string
      windDirection?: string
    }[]
  }
}

type NwsAlerts = {
  features?: {
    properties?: {
      event?: string
      severity?: string
      expires?: string
      senderName?: string
    }
  }[]
}

function unavailable({
  locationLabel,
  detail,
  providerState,
  provider,
  envVarNames = WEATHER_ENV_NAMES,
}: {
  locationLabel: string
  detail: string
  providerState: WeatherProviderState
  provider?: string
  envVarNames?: string[]
}): WeatherDashboardSnapshot {
  const aliasDiagnostics = [resolveEnvAlias('weatherApiKey'), resolveEnvAlias('weatherProvider')]
  const primaryDiagnostic = aliasDiagnostics.find(diagnostic => diagnostic.configured) ?? aliasDiagnostics[0]
  const aliasRecommendation = aliasDiagnostics.find(diagnostic => diagnostic.recommendation)?.recommendation ?? null

  return {
    status: 'unavailable',
    providerState,
    provider: provider ?? getEnvAliasValue('weatherProvider') ?? 'not configured',
    locationLabel,
    currentTempF: null,
    condition: providerState === 'configured_but_fetch_failed' ? 'Weather fetch failed' : 'Weather provider unavailable',
    highF: null,
    lowF: null,
    precipitationChance: null,
    wind: null,
    alerts: [],
    hourlyForecast: [],
    dailyForecast: [],
    freshness: 'unknown',
    fetchedAt: null,
    source: 'No weather provider returned data',
    detail,
    setup: {
      envVarNames,
      preferredEnvName: primaryDiagnostic.preferredEnvName,
      aliasDetected: aliasDiagnostics.some(diagnostic => diagnostic.aliasDetected),
      configured: aliasDiagnostics.some(diagnostic => diagnostic.configured),
      aliasRecommendation,
      envAliasDiagnostics: aliasDiagnostics,
      blockedFeature: 'Live weather, hourly forecast, 7-day outlook, and weather alerts',
      recommendedSetup: aliasRecommendation ?? 'Set WEATHER_PROVIDER to openweather, weatherapi, or noaa. Set WEATHER_API_KEY for OpenWeather or WeatherAPI. NOAA also requires WEATHER_LATITUDE and WEATHER_LONGITUDE.',
    },
  }
}

function locationLabel(location: CommanderLocationState): string {
  if (location.mode === 'off') return 'Location off'
  if (location.neighborhood && location.mode === 'neighborhood') return location.neighborhood
  return location.city ?? 'City not set'
}

function windLabel(speed: number | undefined, direction: number | string | undefined): string | null {
  if (typeof speed !== 'number') return null
  const directionText = typeof direction === 'number' ? `${Math.round(direction)}deg` : direction
  return `${Math.round(speed)} mph${directionText ? ` ${directionText}` : ''}`
}

function formatFreshness(iso: string | null): string {
  if (!iso) return 'unknown'
  const ageMs = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m old`
  return `${Math.round(minutes / 60)}h old`
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Weather provider request timed out'
  if (error instanceof Error) return error.message.replace(/appid=[^&\s]+/gi, 'appid=[redacted]').replace(/key=[^&\s]+/gi, 'key=[redacted]')
  return 'Weather provider request failed'
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WarRoomLiveEnvironment/1.0',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`Weather provider returned HTTP ${res.status}`)
    return await res.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

async function geocodeOpenWeather(city: string, apiKey: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${encodeURIComponent(apiKey)}`
  const results = await fetchJson<{ lat?: number; lon?: number; name?: string; state?: string }[]>(url)
  const first = results[0]
  if (typeof first?.lat !== 'number' || typeof first.lon !== 'number') return null
  return { lat: first.lat, lon: first.lon, name: [first.name, first.state].filter(Boolean).join(', ') || city }
}

function toDailyForecast(list: NonNullable<OpenWeatherForecast['list']>): WeatherForecastPoint[] {
  const byDay = new Map<string, NonNullable<OpenWeatherForecast['list']>>()
  for (const point of list) {
    const day = point.dt_txt?.slice(0, 10)
    if (!day) continue
    byDay.set(day, [...(byDay.get(day) ?? []), point])
  }
  return Array.from(byDay.entries()).slice(0, 7).map(([day, points]) => {
    const temps = points.flatMap(point => [point.main?.temp_min, point.main?.temp_max]).filter((value): value is number => typeof value === 'number')
    const precip = points.map(point => point.pop).filter((value): value is number => typeof value === 'number')
    const midday = points[Math.floor(points.length / 2)]
    return {
      label: day,
      tempF: temps.length ? Math.round(Math.max(...temps)) : null,
      condition: midday?.weather?.[0]?.description ?? 'Forecast returned',
      precipitationChance: precip.length ? Math.round(Math.max(...precip) * 100) : null,
      wind: windLabel(midday?.wind?.speed, midday?.wind?.deg),
    }
  })
}

async function buildOpenWeather(location: CommanderLocationState, apiKey: string): Promise<WeatherDashboardSnapshot> {
  const city = location.city?.trim()
  if (!city || location.mode === 'off') {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'Weather is blocked until a city-level location is available.',
      providerState: 'missing_provider',
      provider: 'OpenWeather',
    })
  }
  const geo = await geocodeOpenWeather(city, apiKey)
  if (!geo) {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'OpenWeather did not resolve the configured city.',
      providerState: 'configured_but_fetch_failed',
      provider: 'OpenWeather',
    })
  }

  const [current, forecast] = await Promise.all([
    fetchJson<OpenWeatherCurrent>(`https://api.openweathermap.org/data/2.5/weather?lat=${geo.lat}&lon=${geo.lon}&units=imperial&appid=${encodeURIComponent(apiKey)}`),
    fetchJson<OpenWeatherForecast>(`https://api.openweathermap.org/data/2.5/forecast?lat=${geo.lat}&lon=${geo.lon}&units=imperial&appid=${encodeURIComponent(apiKey)}`),
  ])
  const fetchedAt = new Date().toISOString()
  const hourly = (forecast.list ?? []).slice(0, 8).map(point => ({
    label: point.dt_txt ?? 'forecast',
    tempF: numberOrNull(point.main?.temp),
    condition: point.weather?.[0]?.description ?? 'Forecast returned',
    precipitationChance: typeof point.pop === 'number' ? Math.round(point.pop * 100) : null,
    wind: windLabel(point.wind?.speed, point.wind?.deg),
  }))
  const daily = toDailyForecast(forecast.list ?? [])

  return {
    status: 'available',
    providerState: 'configured_and_live',
    provider: 'OpenWeather',
    locationLabel: geo.name,
    currentTempF: numberOrNull(current.main?.temp),
    condition: current.weather?.[0]?.description ?? 'Weather returned',
    highF: numberOrNull(current.main?.temp_max ?? daily[0]?.tempF),
    lowF: numberOrNull(current.main?.temp_min),
    precipitationChance: hourly[0]?.precipitationChance ?? null,
    wind: windLabel(current.wind?.speed, current.wind?.deg),
    alerts: [],
    hourlyForecast: hourly,
    dailyForecast: daily,
    freshness: formatFreshness(fetchedAt),
    fetchedAt,
    source: 'api.openweathermap.org',
    detail: 'Current conditions and forecast are fetched server-side from OpenWeather. Alerts are not included by this adapter unless the provider returns them.',
  }
}

async function buildWeatherApi(location: CommanderLocationState, apiKey: string): Promise<WeatherDashboardSnapshot> {
  const city = location.city?.trim()
  if (!city || location.mode === 'off') {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'Weather is blocked until a city-level location is available.',
      providerState: 'missing_provider',
      provider: 'WeatherAPI',
    })
  }
  const data = await fetchJson<WeatherApiForecast>(`https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(city)}&days=7&aqi=no&alerts=yes`)
  const fetchedAt = new Date().toISOString()
  const hourly = data.forecast?.forecastday?.flatMap(day => day.hour ?? []).slice(0, 12).map(point => ({
    label: point.time ?? 'forecast',
    tempF: numberOrNull(point.temp_f),
    condition: point.condition?.text ?? 'Forecast returned',
    precipitationChance: numberOrNull(point.chance_of_rain),
    wind: windLabel(point.wind_mph, point.wind_dir),
  })) ?? []
  const daily = data.forecast?.forecastday?.map(day => ({
    label: day.date ?? 'forecast',
    tempF: numberOrNull(day.day?.maxtemp_f),
    condition: day.day?.condition?.text ?? 'Forecast returned',
    precipitationChance: numberOrNull(day.day?.daily_chance_of_rain),
    wind: null,
  })) ?? []

  return {
    status: 'available',
    providerState: 'configured_and_live',
    provider: 'WeatherAPI',
    locationLabel: [data.location?.name, data.location?.region].filter(Boolean).join(', ') || city,
    currentTempF: numberOrNull(data.current?.temp_f),
    condition: data.current?.condition?.text ?? 'Weather returned',
    highF: daily[0]?.tempF ?? null,
    lowF: numberOrNull(data.forecast?.forecastday?.[0]?.day?.mintemp_f),
    precipitationChance: numberOrNull(data.forecast?.forecastday?.[0]?.day?.daily_chance_of_rain),
    wind: windLabel(data.current?.wind_mph, data.current?.wind_dir),
    alerts: (data.alerts?.alert ?? []).slice(0, 5).map(alert => ({
      title: alert.headline ?? 'Weather alert',
      severity: alert.severity ?? 'unknown',
      expiresAt: alert.expires ?? null,
      source: 'WeatherAPI',
    })),
    hourlyForecast: hourly,
    dailyForecast: daily,
    freshness: formatFreshness(fetchedAt),
    fetchedAt,
    source: 'api.weatherapi.com',
    detail: 'Current conditions, forecast, and alerts are fetched server-side from WeatherAPI.',
  }
}

async function buildNoaa(location: CommanderLocationState): Promise<WeatherDashboardSnapshot> {
  const lat = Number(process.env.WEATHER_LATITUDE)
  const lon = Number(process.env.WEATHER_LONGITUDE)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'NOAA/NWS fallback needs WEATHER_LATITUDE and WEATHER_LONGITUDE because no precise coordinates are stored in the client location state.',
      providerState: 'missing_key',
      provider: 'NOAA/NWS',
      envVarNames: ['WEATHER_PROVIDER', 'WEATHER_LATITUDE', 'WEATHER_LONGITUDE'],
    })
  }
  const point = await fetchJson<NwsPoints>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`)
  const forecastUrl = point.properties?.forecast
  const hourlyUrl = point.properties?.forecastHourly
  if (!forecastUrl || !hourlyUrl) {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'NOAA/NWS did not return forecast endpoints for the configured coordinates.',
      providerState: 'configured_but_fetch_failed',
      provider: 'NOAA/NWS',
    })
  }

  const [dailyData, hourlyData, alertsData] = await Promise.all([
    fetchJson<NwsForecast>(forecastUrl),
    fetchJson<NwsForecast>(hourlyUrl),
    fetchJson<NwsAlerts>(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`),
  ])
  const fetchedAt = new Date().toISOString()
  const hourly = (hourlyData.properties?.periods ?? []).slice(0, 12).map(period => ({
    label: period.name ?? period.startTime ?? 'forecast',
    tempF: period.temperatureUnit === 'F' ? numberOrNull(period.temperature) : null,
    condition: period.shortForecast ?? 'Forecast returned',
    precipitationChance: numberOrNull(period.probabilityOfPrecipitation?.value),
    wind: [period.windSpeed, period.windDirection].filter(Boolean).join(' ') || null,
  }))
  const daily = (dailyData.properties?.periods ?? []).slice(0, 14).map(period => ({
    label: period.name ?? period.startTime ?? 'forecast',
    tempF: period.temperatureUnit === 'F' ? numberOrNull(period.temperature) : null,
    condition: period.shortForecast ?? 'Forecast returned',
    precipitationChance: numberOrNull(period.probabilityOfPrecipitation?.value),
    wind: [period.windSpeed, period.windDirection].filter(Boolean).join(' ') || null,
  }))
  const temps = daily.map(day => day.tempF).filter((temp): temp is number => temp !== null)

  return {
    status: 'available',
    providerState: 'configured_and_live',
    provider: 'NOAA/NWS',
    locationLabel: [point.properties?.relativeLocation?.properties?.city, point.properties?.relativeLocation?.properties?.state].filter(Boolean).join(', ') || locationLabel(location),
    currentTempF: hourly[0]?.tempF ?? null,
    condition: hourly[0]?.condition ?? 'Weather returned',
    highF: temps.length ? Math.max(...temps) : null,
    lowF: temps.length ? Math.min(...temps) : null,
    precipitationChance: hourly[0]?.precipitationChance ?? null,
    wind: hourly[0]?.wind ?? null,
    alerts: (alertsData.features ?? []).slice(0, 5).map(feature => ({
      title: feature.properties?.event ?? 'Weather alert',
      severity: feature.properties?.severity ?? 'unknown',
      expiresAt: feature.properties?.expires ?? null,
      source: feature.properties?.senderName ?? 'NOAA/NWS',
    })),
    hourlyForecast: hourly,
    dailyForecast: daily,
    freshness: formatFreshness(fetchedAt),
    fetchedAt,
    source: 'api.weather.gov',
    detail: 'Forecast and active alerts are fetched server-side from NOAA/NWS using configured coordinates.',
  }
}

export async function buildWeatherDashboardSnapshot(location: CommanderLocationState): Promise<WeatherDashboardSnapshot> {
  const provider = (getEnvAliasValue('weatherProvider') || '').toLowerCase()
  const apiKey = getEnvAliasValue('weatherApiKey')
  const hasNoaaCoordinates = Number.isFinite(Number(process.env.WEATHER_LATITUDE)) && Number.isFinite(Number(process.env.WEATHER_LONGITUDE))

  if (provider === 'noaa' || provider === 'nws') {
    try {
      return await buildNoaa(location)
    } catch (error) {
      return {
        ...unavailable({
          locationLabel: locationLabel(location),
          detail: safeErrorMessage(error),
          providerState: 'configured_but_fetch_failed',
          provider: 'NOAA/NWS',
        }),
        status: 'error',
        fetchedAt: new Date().toISOString(),
      }
    }
  }

  if (!apiKey && !hasNoaaCoordinates) {
    return unavailable({
      locationLabel: locationLabel(location),
      detail: 'Set WEATHER_API_KEY for OpenWeather/WeatherAPI or WEATHER_LATITUDE and WEATHER_LONGITUDE for NOAA/NWS.',
      providerState: 'missing_key',
    })
  }

  const attempts: { name: string; load: () => Promise<WeatherDashboardSnapshot> }[] = []
  if (apiKey) {
    if (provider === 'weatherapi' || provider === 'weather_api') attempts.push({ name: 'WeatherAPI', load: () => buildWeatherApi(location, apiKey) })
    else if (provider === 'openweather' || provider === 'openweathermap') attempts.push({ name: 'OpenWeather', load: () => buildOpenWeather(location, apiKey) })
    else if (provider === '') {
      attempts.push({ name: 'OpenWeather', load: () => buildOpenWeather(location, apiKey) })
      attempts.push({ name: 'WeatherAPI', load: () => buildWeatherApi(location, apiKey) })
    } else {
      return unavailable({
        locationLabel: locationLabel(location),
        detail: `Unsupported WEATHER_PROVIDER "${provider}".`,
        providerState: 'missing_provider',
      })
    }
  }
  if (hasNoaaCoordinates && (provider === '' || provider === 'noaa' || provider === 'nws')) {
    attempts.push({ name: 'NOAA/NWS', load: () => buildNoaa(location) })
  }

  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      return await attempt.load()
    } catch (error) {
      errors.push(`${attempt.name}: ${safeErrorMessage(error)}`)
    }
  }

  return {
    ...unavailable({
      locationLabel: locationLabel(location),
      detail: errors.length ? errors.join('; ') : 'No weather adapter could be selected from the configured environment.',
      providerState: 'configured_but_fetch_failed',
      provider: provider || 'weather provider',
    }),
    status: 'error',
    fetchedAt: new Date().toISOString(),
  }
}
