"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A list of email addresses, typed one at a time.
 *
 * Not an `EntityPicker`: the people a letter is addressed to are outside the
 * company — a district office, a ministry desk, a contractor — so there is no
 * collection to search. What there is instead is the mistake the server refuses
 * on save ("ram sharma is not an email address"), and finding that out after
 * writing a whole letter is the wrong moment. So the chip turns red as it is
 * made, and Save is held until nothing is red.
 *
 * Comma, semicolon and Enter all commit, because addresses get pasted in from
 * somebody else's list as often as they are typed.
 */
export default function EmailChips({
  label,
  value,
  onChange,
  helperText,
  placeholder,
  disabled,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  helperText?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const bad = value.filter((address) => !LOOKS_LIKE_EMAIL.test(address));

  return (
    <Autocomplete
      multiple
      freeSolo
      disabled={disabled}
      options={[]}
      value={value}
      // A pasted "a@x.com, b@y.com" is one string until it is split, and
      // splitting on commit is the only place that can see it.
      onChange={(_event, next) => {
        const flattened = (next as string[])
          .flatMap((entry) => entry.split(/[,;]/))
          .map((entry) => entry.trim())
          .filter(Boolean);
        onChange(Array.from(new Set(flattened)));
      }}
      renderValue={(addresses, getItemProps) =>
        (addresses as string[]).map((address, index) => {
          // MUI returns a `key` inside `getItemProps` and its own types omit
          // it; spreading it over an explicit `key` makes the key invisible to
          // React when it reconciles. Same take-it-back-out as `EntityPicker`.
          const { key: _muiKey, ...itemProps } = getItemProps({ index }) as ReturnType<
            typeof getItemProps
          > & { key?: React.Key };
          const valid = LOOKS_LIKE_EMAIL.test(address);
          return (
            <Chip
              key={address}
              {...itemProps}
              size="small"
              label={address}
              color={valid ? "default" : "error"}
              variant={valid ? "outlined" : "filled"}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          error={bad.length > 0}
          placeholder={value.length === 0 ? placeholder : undefined}
          helperText={
            bad.length > 0
              ? `${bad.join(", ")} ${bad.length === 1 ? "is not an" : "are not"} email address${bad.length === 1 ? "" : "es"}.`
              : helperText
          }
        />
      )}
    />
  );
}

/** Whether every address in the list is one — the Save guard reads this. */
export function allValidEmails(addresses: string[]): boolean {
  return addresses.every((address) => LOOKS_LIKE_EMAIL.test(address));
}
