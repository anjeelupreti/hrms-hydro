"use client";

import ClearIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rendered for screen readers; falls back to the placeholder. */
  label?: string;
  sx?: SxProps<Theme>;
  autoFocus?: boolean;
};

/**
 * The one search input in the app.
 *
 * Every list page needs the same thing — type to narrow, a visible way to
 * clear, Escape to bail out — and hand-rolling it per page is how you end
 * up with six subtly different search boxes. Filtering itself stays with
 * the caller (see `useTextFilter`), because only the page knows which
 * fields are worth matching on.
 */
export default function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label,
  sx,
  autoFocus,
}: Props) {
  return (
    <TextField
      size="small"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          e.preventDefault();
          e.stopPropagation();
          onChange("");
        }
      }}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      sx={{ width: { xs: "100%", sm: 260 }, ...sx }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="disabled" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear search" onClick={() => onChange("")} edge="end">
                <ClearIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
    />
  );
}
