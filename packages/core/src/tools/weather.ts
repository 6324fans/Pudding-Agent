import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'

interface GeocodeResult {
  name: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
}

export const weatherTool: ToolHandler = {
  definition: {
    name: 'weather',
    description: `Get current weather and a short forecast for a city or location. No API key required.

Usage notes:
- Use this directly when the user asks about weather, temperature, rain, wind, or forecast.
- If the user does not provide a location, ask for the city first.
- Include the resolved location and source in the final answer.`,
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or location name, e.g. Hangzhou, Shanghai, Tokyo' },
        days: { type: 'number', description: 'Forecast days, default 3, max 7' },
      },
      required: ['location'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const location = String(input.location || '').trim()
    if (!location) return { content: 'Error: location is required', isError: true }
    const days = Math.min(Math.max(Number(input.days || 3), 1), 7)

    try {
      const place = await geocode(location, context.signal)
      if (!place) return { content: `No location found for "${location}".`, isError: true }
      const weather = await fetchWeather(place, days, context.signal)
      return { content: formatWeather(place, weather) }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}

async function geocode(location: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`
  const response = await fetch(url, { signal: signal || AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Geocoding returned ${response.status}`)
  const data = await response.json() as { results?: GeocodeResult[] }
  return data.results?.[0] || null
}

async function fetchWeather(place: GeocodeResult, days: number, signal?: AbortSignal): Promise<any> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: String(days),
    timezone: place.timezone || 'auto',
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: signal || AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Weather API returned ${response.status}`)
  return response.json()
}

function formatWeather(place: GeocodeResult, data: any): string {
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ')
  const current = data.current || {}
  const daily = data.daily || {}
  const lines = [
    `Location: ${label}`,
    `Current: ${current.temperature_2m}${data.current_units?.temperature_2m || 'C'}, feels like ${current.apparent_temperature}${data.current_units?.apparent_temperature || 'C'}, ${weatherText(current.weather_code)}`,
    `Humidity: ${current.relative_humidity_2m}${data.current_units?.relative_humidity_2m || '%'}`,
    `Wind: ${current.wind_speed_10m}${data.current_units?.wind_speed_10m || 'km/h'}`,
    `Precipitation: ${current.precipitation}${data.current_units?.precipitation || 'mm'}`,
    '',
    'Forecast:',
  ]

  const dates: string[] = daily.time || []
  for (let i = 0; i < dates.length; i++) {
    lines.push(`- ${dates[i]}: ${weatherText(daily.weather_code?.[i])}, ${daily.temperature_2m_min?.[i]}-${daily.temperature_2m_max?.[i]}${data.daily_units?.temperature_2m_max || 'C'}, rain chance ${daily.precipitation_probability_max?.[i] ?? 'n/a'}${data.daily_units?.precipitation_probability_max || '%'}`)
  }

  lines.push('', 'Source: https://open-meteo.com/')
  return lines.join('\n')
}

function weatherText(code: unknown): string {
  const value = Number(code)
  const map: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    71: 'slight snow',
    73: 'moderate snow',
    75: 'heavy snow',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    95: 'thunderstorm',
    96: 'thunderstorm with hail',
    99: 'thunderstorm with heavy hail',
  }
  return map[value] || `weather code ${code}`
}
