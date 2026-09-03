"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useCalendarKey,
  useCalendarMonth,
  useConvertedDate,
} from "@/hooks/useCompanyCalendar";

/**
 * A date input that respects the calendar the company actually chose.
 *
 * **The gap this closes.** `CompanyProfile.calendar` drove fiscal-year
 * arithmetic, statutory-rate lookups and the payslip PDF — and nothing a person
 * typed or read. Forty native `<input type="date">` controls across
 * twenty-five files meant a company running Bikram Sambat entered and saw
 * Gregorian dates everywhere. The setting was true and invisible.
 *
 * **Gregorian stays the storage format.** `value` and `onChange` are always
 * `YYYY-MM-DD` Gregorian, exactly as the API expects. Only the presentation
 * changes, so switching the company's calendar re-renders and never re-keys data —
 * which is the same engine-neutrality rule that keeps a Nepal pack from
 * becoming a Nepal engine.
 *
 * On a Gregorian company this is the native control, unchanged. There is no
 * reason to hand somebody a bespoke picker when the browser's own is better.
 */
export default function DateField({
  label,
  value,
  onChange,
  required,
  disabled,
  helperText,
  // MUI's own default, so a date sitting among plain TextFields is the same
  // height as they are. It defaulted to `small` while it had two call sites,
  // and both dialogs it lived in rendered a short date field beside tall text
  // ones — a mismatch nobody notices until the whole app uses the component.
  size = "medium",
  fullWidth = true,
  sx,
  startIcon,
}: {
  label: string;
  /** Gregorian `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  helperText?: React.ReactNode;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: object;
  /** A leading glyph — a cake beside a birthday. Taken as a node rather than
   *  raw `slotProps`, because the BS branch already owns the *trailing*
   *  adornment and a caller handing over both would silently lose one. */
  startIcon?: React.ReactNode;
}) {
  const calendar = useCalendarKey();
  const adornment = startIcon ? (
    <InputAdornment position="start">{startIcon}</InputAdornment>
  ) : undefined;

  if (calendar !== "BS") {
    return (
      <TextField
        label={label}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        helperText={helperText}
        size={size}
        fullWidth={fullWidth}
        sx={sx}
        slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: adornment } }}
      />
    );
  }

  return (
    <BikramSambatField
      label={label}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      helperText={helperText}
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      startAdornment={adornment}
    />
  );
}

function BikramSambatField({
  label,
  value,
  onChange,
  required,
  disabled,
  helperText,
  size,
  fullWidth,
  sx,
  startAdornment,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  helperText?: React.ReactNode;
  size: "small" | "medium";
  fullWidth: boolean;
  sx?: object;
  startAdornment?: React.ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [viewing, setViewing] = useState<{ year: number; month: number } | null>(null);

  // What is currently selected, in the company's calendar — asked of the server
  // rather than converted here, so the label and the grid can never disagree.
  const { data: selected } = useConvertedDate(value || null);

  const month = useCalendarMonth(viewing?.year, viewing?.month, Boolean(anchor));

  function open(event: React.MouseEvent<HTMLElement>) {
    if (disabled) return;
    // Open on the month of the current value, or on today.
    if (selected?.local) {
      setViewing({ year: selected.local.year, month: selected.local.month });
    }
    setAnchor(event.currentTarget);
  }

  function shift(delta: number) {
    const base = viewing ?? (month.data ? { year: month.data.year, month: month.data.month } : null);
    if (!base) return;
    let m = base.month + delta;
    let y = base.year;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    setViewing({ year: y, month: m });
  }

  const shown = month.data;

  /**
   * The twelve month names of whichever calendar the company runs.
   *
   * Served with the month rather than hardcoded: a Bikram Sambat company needs
   * Baishakh through Chaitra and a Gregorian one needs January through
   * December, and a list written here would be right for one of them.
   */
  const monthOptions = shown?.month_names ?? [];

  /**
   * A century around the year in view, which is what a date field has to
   * reach: a date of birth is eighty years back and a licence expiry is ten
   * forward. Rebuilt from whatever is on screen, so paging past the end of the
   * list extends it rather than stopping.
   */
  const yearOptions = (() => {
    const centre = shown?.year ?? new Date().getFullYear();
    return Array.from({ length: 121 }, (_, index) => centre - 90 + index);
  })();
  // Blanks before the first day so the columns line up with the weekday header.
  const leadingBlanks = shown ? shown.days[0].weekday : 0;

  return (
    <>
      <TextField
        label={label}
        value={selected?.local?.label ?? (value ? value : "")}
        placeholder="Pick a date"
        onClick={open}
        required={required}
        disabled={disabled}
        helperText={helperText}
        size={size}
        fullWidth={fullWidth}
        slotProps={{
          input: {
            readOnly: true,
            startAdornment,
            endAdornment: (
              <InputAdornment position="end">
                <CalendarMonthIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          },
          inputLabel: { shrink: true },
        }}
        sx={{ "& .MuiInputBase-root": { cursor: disabled ? "default" : "pointer" }, ...sx }}
      />

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, width: 296 }}>
          {/* **The month and the year are dropdowns, not a caption.**
              They used to be a static label between two chevrons, which is fine
              for stepping to next month and useless for anything else: a date
              of birth, a licence issued in 2074, a probation date two years out
              — all of them meant clicking an arrow twenty or forty times.
              Picking the month and the year directly is one click each. */}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 1 }}>
            <IconButton size="small" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>

            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={shown ? shown.month : ""}
              onChange={(event) =>
                setViewing({
                  year: shown?.year ?? new Date().getFullYear(),
                  month: Number(event.target.value),
                })
              }
              sx={{
                flex: 1,
                "& .MuiSelect-select": { py: 0.25, fontSize: 14, fontWeight: 700 },
              }}
            >
              {monthOptions.map((name, index) => (
                <MenuItem key={name} value={index + 1} sx={{ fontSize: 14 }}>
                  {name}
                </MenuItem>
              ))}
            </Select>

            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={shown ? shown.year : ""}
              onChange={(event) =>
                setViewing({
                  year: Number(event.target.value),
                  month: shown?.month ?? 1,
                })
              }
              // A long list, so it scrolls rather than running off the screen —
              // which is the other half of "no scroll available for them".
              MenuProps={{ slotProps: { paper: { sx: { maxHeight: 280 } } } }}
              sx={{ "& .MuiSelect-select": { py: 0.25, fontSize: 14, fontWeight: 700 } }}
            >
              {yearOptions.map((year) => (
                <MenuItem key={year} value={year} sx={{ fontSize: 14 }}>
                  {year}
                </MenuItem>
              ))}
            </Select>

            <IconButton size="small" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.25, mb: 0.5 }}>
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
              <Typography
                key={d}
                variant="caption"
                sx={{ textAlign: "center", color: "text.secondary", fontWeight: 600 }}
              >
                {d}
              </Typography>
            ))}
          </Box>

          {month.isLoading || !shown ? (
            <Skeleton variant="rounded" height={190} />
          ) : (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.25 }}>
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <Box key={`blank-${i}`} />
              ))}
              {shown.days.map((day) => {
                const isSelected = day.gregorian === value;
                const isToday = day.gregorian === shown.today.gregorian;
                return (
                  <Button
                    key={day.gregorian}
                    size="small"
                    onClick={() => {
                      // Gregorian goes out. The API never learns this widget
                      // exists, which is what keeps the engine neutral.
                      onChange(day.gregorian);
                      setAnchor(null);
                    }}
                    variant={isSelected ? "contained" : "text"}
                    sx={{
                      minWidth: 0,
                      p: 0.25,
                      fontWeight: isToday ? 800 : 500,
                      // Today is outlined rather than filled, so it cannot be
                      // mistaken for the selection.
                      border: isToday && !isSelected ? "1px solid" : undefined,
                      borderColor: "primary.main",
                    }}
                  >
                    {day.day}
                  </Button>
                );
              })}
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: "space-between" }}>
            <Button
              size="small"
              onClick={() => {
                if (shown) onChange(shown.today.gregorian);
                setAnchor(null);
              }}
            >
              Today
            </Button>
            {/* Clearing has to be possible: plenty of these dates are optional,
                and a picker with no way back to empty makes them mandatory by
                accident. */}
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                onChange("");
                setAnchor(null);
              }}
            >
              Clear
            </Button>
          </Stack>

          {/* The Gregorian date, always visible. Somebody reconciling with a
              bank, a tax filing or a foreign colleague needs both, and hiding
              one to prove a point about localisation helps nobody. */}
          {value && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {value}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
