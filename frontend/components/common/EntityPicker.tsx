"use client";

import Autocomplete, { autocompleteClasses } from "@mui/material/Autocomplete";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { HTMLAttributes, ReactNode } from "react";

import type { PickerOption } from "@/hooks/useEntitySearch";

function initials(label: string) {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

type BaseProps = {
  label: string;
  options: PickerOption[];
  /** Controlled search text — the picker never filters locally. */
  inputValue: string;
  onInputChange: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  placeholder?: string;
  /** Show a round avatar per row. On for people, off for departments. */
  showAvatars?: boolean;
  /** Rows exist beyond this page, so "no match" may just mean "keep typing". */
  hasMore?: boolean;
  total?: number;
  autoFocus?: boolean;
  /** `small` for a filter bar, `medium` (default) for a form. */
  size?: "small" | "medium";
  /** Width/placement at the call site — filter bars cap theirs. */
  sx?: SxProps<Theme>;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: number | null;
  onChange: (value: number | null) => void;
};

type MultiProps = BaseProps & {
  multiple: true;
  value: number[];
  onChange: (value: number[]) => void;
  /** Cap the selection — a training roster with a seat limit, say. */
  max?: number;
};

type Props = SingleProps | MultiProps;

/**
 * The one picker for choosing records from a collection.
 *
 * Used wherever the options come from the API rather than from a constant. A
 * plain `<TextField select>` has no search, so it goes from fine to unusable
 * somewhere around fifty rows — and it holds only the page the caller fetched,
 * which past 100 rows makes a record not merely hard to find but impossible to
 * pick.
 *
 * Filtering is disabled (`filterOptions={(x) => x}`) on purpose: the server has
 * already decided what matches. Filtering again in the browser would hide rows
 * that matched on a field we do not render, like an employee code.
 *
 * No list virtualisation, deliberately. Search runs server-side and returns a
 * page of 25, so the dropdown never holds enough rows to justify the machinery
 * — the thing that used to make these lists slow was fetching everything, and
 * that is what got fixed.
 */
export default function EntityPicker(props: Props) {
  const {
    label,
    options,
    inputValue,
    onInputChange,
    loading = false,
    disabled,
    required,
    error,
    helperText,
    placeholder,
    showAvatars = false,
    hasMore = false,
    total = 0,
    autoFocus,
    size = "medium",
    sx,
  } = props;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const byId = new Map(options.map((option) => [option.id, option]));

  // A saved id whose row has not loaded yet still needs *something* to render,
  // or the field would flash empty and look like the value was lost.
  const resolve = (id: number): PickerOption => byId.get(id) ?? { id, label: "…" };

  const atMax =
    props.multiple === true && props.max !== undefined && props.value.length >= props.max;

  const noOptionsText = loading
    ? "Searching…"
    : inputValue.trim()
      ? `No match for “${inputValue.trim()}”`
      : "Start typing to search";

  return (
    <Autocomplete
      // MUI does not open the popup on focus unless told to, so without this
      // a click on the field does nothing visible and a short list of options
      // — already loaded — is only discoverable by guessing a letter.
      //
      // `openOnFocus` fixes the common case (a short list you want to browse)
      // and costs the long case nothing: the field is still a search box, and
      // typing still narrows server-side.
      openOnFocus
      // Keyboard parity. Without this, a screen-reader or keyboard user tabbing
      // into the field gets the same silent empty control the mouse user did.
      selectOnFocus
      handleHomeEndKeys
      multiple={props.multiple}
      disableCloseOnSelect={props.multiple === true}
      options={options}
      value={
        props.multiple === true
          ? props.value.map(resolve)
          : props.value === null
            ? null
            : resolve(props.value)
      }
      onChange={(_, next) => {
        if (props.multiple === true) {
          const picked = (next as PickerOption[]).map((option) => option.id);
          props.onChange(props.max ? picked.slice(0, props.max) : picked);
        } else {
          props.onChange((next as PickerOption | null)?.id ?? null);
        }
      }}
      inputValue={inputValue}
      onInputChange={(_, next, reason) => {
        // Clearing on blur/select would wipe the box the moment a row is picked
        // in multi-select, where people usually want to keep typing.
        if (reason === "input") onInputChange(next);
        if (reason === "clear") onInputChange("");
        // MUI fires this with reason `"reset"` on selection. Handling only
        // `"input"` and `"clear"` leaves `inputValue` at "" after a choice, so
        // a single-select shows its placeholder while a value is very much set
        // — a filter that works while the control denies it.
        //
        // Multi-select is deliberately left alone — there the chips carry the
        // selection and the box stays free for the next search, which is what
        // the note above is about.
        if (reason === "reset" && props.multiple !== true) onInputChange(next);
      }}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) =>
        atMax && props.multiple === true && !props.value.includes(option.id)
      }
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      size={size}
      fullWidth
      renderOption={(optionProps, option, { selected }) => {
        const { key, ...rest } = optionProps as HTMLAttributes<HTMLLIElement> & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ gap: 1.25 }}>
            {/* Multi-select had no mark on the row at all: the only sign a
                person was chosen was a chip appearing in the field above,
                which is off-screen once the list is scrolled. With the list
                deliberately held open (`disableCloseOnSelect`) to keep
                picking, that left no way to tell what was already in. */}
            {props.multiple === true && (
              <Checkbox
                size="small"
                checked={selected}
                disableRipple
                // The row owns the click; the box is a state display, so
                // giving it its own hit target would double-toggle.
                tabIndex={-1}
                sx={{ p: 0.25, mr: 0.25 }}
              />
            )}
            {showAvatars && (
              <Avatar
                src={option.avatarUrl ?? undefined}
                sx={{ width: 30, height: 30, fontSize: 12 }}
              >
                {initials(option.label)}
              </Avatar>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {option.label}
              </Typography>
              {option.secondary && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: "block" }}
                >
                  {option.secondary}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderValue={
        props.multiple === true
          ? (selected, getItemProps) =>
              (selected as PickerOption[]).map((option, index) => {
                // MUI returns a `key` inside `getItemProps`, and spreading it
                // after an explicit `key` silently overrides ours — React warns
                // because a key arriving through a spread is invisible to it
                // when it reconciles the list. Pulled out and passed directly:
                // the option's own id is the stable identity here, and MUI's
                // index-based key is not (removing the first chip renumbers
                // every one after it).
                // MUI's own types omit the `key` it actually returns, so the
                // cast is what lets us take it back out.
                const { key: _muiKey, ...itemProps } = getItemProps({ index }) as ReturnType<
                  typeof getItemProps
                > & { key?: React.Key };
                return (
                  <Chip
                    key={option.id}
                    {...itemProps}
                    size="small"
                    label={option.label}
                    avatar={
                      showAvatars ? (
                        <Avatar src={option.avatarUrl ?? undefined}>
                          {initials(option.label)}
                        </Avatar>
                      ) : undefined
                    }
                  />
                );
              })
          : undefined
      }
      noOptionsText={noOptionsText}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={error}
          autoFocus={autoFocus}
          placeholder={
            placeholder ??
            (props.multiple === true && props.value.length > 0 ? "" : "Type to search…")
          }
          helperText={
            helperText ??
            (atMax
              ? `Limit of ${props.multiple === true ? props.max : 0} reached.`
              : hasMore && !inputValue.trim()
                ? `Showing ${options.length} of ${total} — type to search all.`
                : undefined)
          }
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              // A spinner inside the field, not above the list: the list is
              // showing stale results while this runs, and without it there is
              // nothing to say the rows are about to change.
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} sx={{ mr: 1 }} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      sx={[
        // Chips wrap onto their own lines on a phone rather than squeezing the
        // input down to nothing.
        isMobile ? { [`& .${autocompleteClasses.inputRoot}`]: { flexWrap: "wrap" } } : {},
        ...(Array.isArray(sx) ? sx : [sx ?? {}]),
      ]}
      slotProps={{ listbox: { style: { maxHeight: isMobile ? 240 : 360 } } }}
    />
  );
}
