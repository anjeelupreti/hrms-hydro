"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Where the company is, derived from the timezone they already configured.
 *
 * **A lookup table rather than a coordinate field.** Storing
 * `latitude`/`longitude` on `CompanyProfile` would be the complete answer, but
 * that is a migration plus a settings screen for a decorative feature. Mapping
 * the timezone the company has already set to a city costs nothing and gets a
 * workspace in Dubai or Delhi its own weather rather than Nepal's.
 *
 * Unknown zones fall back to Kathmandu with the label shown in the tooltip, so
 * a wrong guess is visible rather than silent. When a location field does land,
 * this table is deleted and nothing else changes.
 */
const ZONE_COORDS: Record<string, { lat: number; lon: number; place: string }> = {
  "Asia/Kathmandu": { lat: 27.7172, lon: 85.324, place: "Kathmandu" },
  "Asia/Kolkata": { lat: 28.6139, lon: 77.209, place: "New Delhi" },
  "Asia/Dhaka": { lat: 23.8103, lon: 90.4125, place: "Dhaka" },
  "Asia/Dubai": { lat: 25.2048, lon: 55.2708, place: "Dubai" },
  "Asia/Singapore": { lat: 1.3521, lon: 103.8198, place: "Singapore" },
  "Europe/London": { lat: 51.5072, lon: -0.1276, place: "London" },
  "America/New_York": { lat: 40.7128, lon: -74.006, place: "New York" },
};
const FALLBACK = ZONE_COORDS["Asia/Kathmandu"];

/**
 * The conditions this hook distinguishes.
 *
 * A name, not a glyph. How a condition is drawn is the shell's decision, so
 * the icon lives with the component that renders it and this hook stays about
 * the weather.
 */
export type WeatherKind =
  | "clear"
  | "partly-cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

/**
 * WMO weather codes → a condition and a plain description.
 *
 * Open-Meteo returns a numeric code, not a description. Grouped rather than
 * enumerated: the API defines ~28 codes and the distinction between "moderate"
 * and "dense" drizzle is not worth a top-bar glyph.
 */
function describe(code: number): { kind: WeatherKind; description: string } {
  if (code === 0) return { kind: "clear", description: "Clear" };
  if (code <= 2) return { kind: "partly-cloudy", description: "Partly cloudy" };
  if (code === 3) return { kind: "overcast", description: "Overcast" };
  if (code <= 48) return { kind: "fog", description: "Fog" };
  if (code <= 57) return { kind: "drizzle", description: "Drizzle" };
  if (code <= 67) return { kind: "rain", description: "Rain" };
  if (code <= 77) return { kind: "snow", description: "Snow" };
  if (code <= 82) return { kind: "rain", description: "Showers" };
  if (code <= 86) return { kind: "snow", description: "Snow showers" };
  return { kind: "thunderstorm", description: "Thunderstorm" };
}

export type Weather = {
  temperature: number;
  kind: WeatherKind;
  description: string;
  place: string;
};

/**
 * Current temperature for the company's city.
 *
 * Open-Meteo: free, key-less and CORS-enabled, so there is no secret to keep
 * and no proxy route to maintain. Called from the browser deliberately — the
 * request carries a city centroid and nothing about the user.
 *
 * **Cached hard.** Half an hour of `staleTime` with no refetch on focus means
 * a tab left open all day makes a handful of calls, and navigating between
 * pages makes none. The weather is decoration; it must never cost more than it
 * is worth, and accuracy to the minute is not what it is for.
 */
export function useWeather(timezone: string | undefined) {
  const spot = (timezone && ZONE_COORDS[timezone]) || FALLBACK;

  return useQuery<Weather>({
    // Keyed by place so switching companies does not show the previous city's
    // temperature under the new one's name.
    queryKey: ["weather", spot.place],
    queryFn: async () => {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}` +
          `&current=temperature_2m,weather_code`
      );
      if (!res.ok) throw new Error("weather unavailable");
      const data = await res.json();
      const code = Number(data?.current?.weather_code ?? -1);
      return {
        temperature: Number(data?.current?.temperature_2m ?? 0),
        place: spot.place,
        ...describe(code),
      };
    },
    enabled: Boolean(timezone),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // One retry, then give up quietly. A third party being down must not
    // produce a retry storm from every open tab, and the strip simply drops
    // its weather segment.
    retry: 1,
  });
}
