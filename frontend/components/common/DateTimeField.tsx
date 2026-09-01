"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

import DateField from "@/components/common/DateField";
import { useCalendarKey } from "@/hooks/useCompanyCalendar";

/**
 * A moment in time, in the calendar the company actually chose.
 *
 * **Only the date half is a calendar question.** Bikram Sambat changes which
 * day it is; it has never changed what o'clock it is. So on a BS company this is
 * a `DateField` for the day and the browser's own time control for the clock,
 * rather than a bespoke widget that reimplements both and gets the easy half
 * wrong. On a Gregorian company it stays the native `datetime-local`, untouched.
 *
 * **The wire format does not move.** `value` and `onChange` are always
 * `YYYY-MM-DDTHH:MM` — exactly what `<input type="datetime-local">` produces
 * and what every caller already sends. Switching the company's calendar changes
 * what a person sees and nothing about what is stored, which is the same
 * engine-neutrality rule that keeps a Nepal pack from becoming a Nepal engine.
 */
export default function DateTimeField({
  label,
  value,
  onChange,
  required,
  disabled,
  helperText,
  size = "medium",
  fullWidth = true,
  sx,
}: {
  label: string;
  /** `YYYY-MM-DDTHH:MM`, local, or empty. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  helperText?: React.ReactNode;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: object;
}) {
  const calendar = useCalendarKey();

  if (calendar !== "BS") {
    return (
      <TextField
        label={label}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        helperText={helperText}
        size={size}
        fullWidth={fullWidth}
        sx={sx}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    );
  }

  // Split rather than store. Two pieces of state for one value is how a field
  // ends up showing a day the form is not going to submit.
  const [date = "", time = ""] = value ? value.split("T") : [];

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      // Two controls now stand where one did, and some of these sit in a
      // half-width grid cell. Wrapping puts the clock under the day rather
      // than squeezing both into something unreadable.
      sx={{ width: fullWidth ? "100%" : undefined, flexWrap: "wrap", ...sx }}
    >
      <DateField
        label={label}
        value={date}
        // Flexible rather than full-width, so the clock can sit beside it when
        // there is room and drop below when there is not.
        fullWidth={false}
        sx={{ flex: "1 1 150px" }}
        // The date is the anchor: clearing it clears the whole moment, and
        // picking one with no clock yet lands on the start of a working day
        // rather than on midnight, which is almost never what anybody meant.
        onChange={(next) => onChange(next ? `${next}T${time || "09:00"}` : "")}
        required={required}
        disabled={disabled}
        helperText={helperText}
        size={size}
      />
      <TextField
        label="Time"
        type="time"
        value={time}
        // A time with no date is not a moment, so it is ignored until there is
        // one. Emptying the clock keeps the day and falls back to midnight.
        onChange={(e) => date && onChange(`${date}T${e.target.value || "00:00"}`)}
        disabled={disabled || !date}
        size={size}
        sx={{ width: size === "small" ? 116 : 132, flexShrink: 0 }}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Stack>
  );
}
