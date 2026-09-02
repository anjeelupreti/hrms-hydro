"use client";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useSyncExternalStore } from "react";

import AcUnitIcon from "@mui/icons-material/AcUnit";
import CloudIcon from "@mui/icons-material/Cloud";
import FilterDramaIcon from "@mui/icons-material/FilterDrama";
import GrainIcon from "@mui/icons-material/Grain";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import WbSunnyIcon from "@mui/icons-material/WbSunny";

import { DEVANAGARI_FONT, toDevanagari } from "@/lib/format/devanagari";
import { useToday } from "@/hooks/useToday";
import { useWeather, type WeatherKind } from "@/hooks/useWeather";

/**
 * The weather condition, drawn from the product's own icon set.
 *
 * Not an emoji: those render at the platform font's mercy — flat and
 * monochrome on one machine, a colour cartoon on the next — so neither
 * matches the line icons beside them in the bar.
 *
 * Sized to the caption it sits next to, and `aria-hidden` because the tooltip
 * already carries the condition in words.
 */
function WeatherIcon({ kind }: { kind: WeatherKind }) {
  const Icon =
    kind === "clear"
      ? WbSunnyIcon
      : kind === "partly-cloudy"
        ? FilterDramaIcon
        : kind === "overcast" || kind === "fog"
          ? CloudIcon
          : kind === "drizzle"
            ? GrainIcon
            : kind === "rain"
              ? WaterDropIcon
              : kind === "snow"
                ? AcUnitIcon
                : ThunderstormIcon;
  return <Icon aria-hidden sx={{ fontSize: "0.95rem", color: "text.secondary" }} />;
}

/**
 * Digits for the live clock come from `lib/format/devanagari`, which the Bikram
 * Sambat calendar grid also uses.
 *
 * The map itself is duplicated from the server's `to_devanagari` on purpose,
 * and that duplication is safe in a way the *date* conversion is not: ten
 * characters with no calendar arithmetic behind them. The clock ticks every
 * second, so asking the server for it is not an option; the date itself still
 * comes from the server, where the month-length table lives.
 */

/**
 * The current second, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, for two reasons
 * that happen to be the same reason: a ticking clock *is* an external mutable
 * source, and React has a primitive for exactly that. Setting state from an
 * effect to poll it is the pattern `react-hooks/set-state-in-effect` exists to
 * flag, and it also tears during concurrent rendering.
 *
 * `getServerSnapshot` returns 0 so the server and the first client paint agree
 * — the server cannot know the browser's time, and rendering a real one there
 * is a guaranteed hydration mismatch.
 */
let cachedSecond = 0;

function subscribeToSeconds(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

function getSecondSnapshot() {
  // Must be referentially stable within a tick, or React re-renders forever.
  const second = Math.floor(Date.now() / 1000);
  if (second !== cachedSecond) cachedSecond = second;
  return cachedSecond;
}

const getServerSecondSnapshot = () => 0;

function useClock(timeZone: string | undefined) {
  const second = useSyncExternalStore(
    subscribeToSeconds,
    getSecondSnapshot,
    getServerSecondSnapshot
  );

  // 0 is the server/first-paint sentinel — render nothing rather than 1970.
  if (second === 0) return null;
  const now = new Date(second * 1000);

  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone,
    }).format(now);
  } catch {
    // An invalid IANA zone from the company profile must not blank the top bar.
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
  }
}

function Segment({
  primary,
  secondary,
  devanagari = false,
}: {
  primary: string;
  secondary: string;
  devanagari?: boolean;
}) {
  return (
    <Stack sx={{ minWidth: 0, lineHeight: 1.15 }}>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          fontSize: "0.76rem",
          whiteSpace: "nowrap",
          // Only the Nepali segment pays for the Devanagari face.
          ...(devanagari && { fontFamily: DEVANAGARI_FONT }),
        }}
        noWrap
      >
        {primary}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontSize: "0.7rem",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          ...(devanagari && { fontFamily: DEVANAGARI_FONT }),
        }}
        noWrap
      >
        {secondary}
      </Typography>
    </Stack>
  );
}

/**
 * Weather, date and time — in English and in Nepali — for the top bar.
 *
 * Three constraints shape it, and a widget of this kind fails all three if it
 * is not built to them:
 *
 *  1. **The city is the company's.** Coordinates come from
 *     `CompanyProfile.timezone`, so the system outside Kathmandu sees its own
 *     weather rather than somebody else's.
 *  2. **A third party is not called per page load.** Both queries cache with
 *     long `staleTime`s and no refetch on focus — in practice one weather call
 *     per half hour and one date call per session.
 *  3. **It fits a 64px bar of single-line controls.** Two 0.7rem lines at fixed
 *     height, collapsing progressively: hidden below `md`, and the Nepali
 *     segment appears only from `lg` so it never competes with search.
 *
 * Every segment degrades independently. Missing weather, an unconvertible date
 * or a failed request removes only itself; the bar never breaks.
 */
export default function LocaleStrip() {
  const { data: today } = useToday();
  const { data: weather } = useWeather(today?.timezone);
  const clock = useClock(today?.timezone);

  // Nothing to show until the date lands. Rendering a skeleton here would
  // flash a grey block in the top bar on every cold load for no benefit.
  if (!today) return null;

  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        display: { xs: "none", md: "flex" },
        alignItems: "center",
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        bgcolor: "action.hover",
        // Wide enough for the longest real content: "Wednesday, 19 August
        // 2026" beside its Nepali equivalent, and two clocks.
        maxWidth: { md: 360, lg: 560 },
      }}
    >
      {weather && (
        <>
          <Tooltip title={`${weather.description} · ${weather.place}`}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <WeatherIcon kind={weather.kind} />
              <Typography variant="caption" sx={{ fontWeight: 700, fontSize: "0.72rem" }}>
                {Math.round(weather.temperature)}°
              </Typography>
            </Stack>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ my: 0.25 }} />
        </>
      )}

      <Segment primary={today.gregorian.label} secondary={clock ?? ""} />

      {today.nepali && (
        <>
          <Divider
            orientation="vertical"
            flexItem
            sx={{ my: 0.25 }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Segment
              devanagari
              primary={today.nepali.label}
              secondary={clock ? toDevanagari(clock) : ""}
            />
          </Box>
        </>
      )}
    </Stack>
  );
}
