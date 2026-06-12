/**
 * OpenWeather forecast client — graceful degradation without a key
 * (returns null; weather factor reports 'weather_unavailable').
 * In-memory 1h cache to stay within free-tier limits.
 */
import type { WeatherForecast } from './types';

const cache = new Map<string, { fetched: number; forecast: WeatherForecast | null }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function mapCondition(owmMain: string, rainMm: number): WeatherForecast['condition'] {
  if (owmMain === 'Snow') return 'snow';
  if (owmMain === 'Rain' || owmMain === 'Drizzle' || owmMain === 'Thunderstorm') {
    return rainMm >= 2.5 ? 'heavy_rain' : 'light_rain';
  }
  if (owmMain === 'Clouds') return 'cloudy';
  return 'clear';
}

export async function getWeatherForecast(
  lat: number | null,
  lng: number | null,
  kickoffUtc: Date
): Promise<WeatherForecast | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || lat === null || lng === null) return null;

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetched < CACHE_TTL_MS) return cached.forecast;

  try {
    // 5-day/3-hour forecast endpoint (free tier)
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`OpenWeather ${res.status}`);
    const body = (await res.json()) as {
      list: Array<{
        dt: number;
        main: { temp: number; humidity: number };
        weather: Array<{ main: string }>;
        wind: { speed: number };
        rain?: { '3h'?: number };
      }>;
    };

    // Pick the 3h slot closest to kickoff
    const target = kickoffUtc.getTime() / 1000;
    let best = body.list[0];
    for (const slot of body.list) {
      if (Math.abs(slot.dt - target) < Math.abs(best.dt - target)) best = slot;
    }
    if (!best) throw new Error('empty forecast list');

    const forecast: WeatherForecast = {
      temp_c: best.main.temp,
      condition: mapCondition(best.weather[0]?.main ?? 'Clear', best.rain?.['3h'] ?? 0),
      wind_kph: best.wind.speed * 3.6,
      humidity_pct: best.main.humidity,
      source: 'openweather'
    };
    cache.set(key, { fetched: Date.now(), forecast });
    return forecast;
  } catch (err) {
    console.warn('weather fetch failed:', err instanceof Error ? err.message : err);
    cache.set(key, { fetched: Date.now(), forecast: null });
    return null;
  }
}
