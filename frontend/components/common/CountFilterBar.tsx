"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";

export type CountFilterOption<T extends string> = {
  value: T | "";
  label: string;
  count?: number;
  icon?: ReactNode;
  /** Reserved status tone. Omit for neutral buckets — most of them. */
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
};

type Props<T extends string> = {
  options: CountFilterOption<T>[];
  value: T | "";
  onChange: (value: T | "") => void;
  /** Hide counts while the first page is still loading. */
  loading?: boolean;
  ariaLabel: string;
};

/**
 * Counters that are also the filter.
 *
 * A list page usually shows a status dropdown *and*, somewhere else, a row of
 * totals. That is two controls answering one question, and the count never
 * tells you it is clickable. This merges them: the number and the filter are
 * the same object, so "3 on probation" is both the fact and the way to see
 * them.
 *
 * The count is on the chip rather than in a separate tile because a bucket
 * with zero rows is still worth showing — it says "we checked, there are
 * none", which an absent tile does not.
 *
 * Tone is opt-in and reserved: only genuine states (terminated, overdue) get
 * colour. Painting every bucket makes the row a rainbow and drains the meaning
 * out of the one chip that matters.
 */
export default function CountFilterBar<T extends string>({
  options,
  value,
  onChange,
  loading = false,
  ariaLabel,
}: Props<T>) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      role="group"
      aria-label={ariaLabel}
      sx={{ flexWrap: "wrap", rowGap: 1 }}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const tone = option.tone && option.tone !== "neutral" ? option.tone : null;

        return (
          <Chip
            key={option.value || "all"}
            icon={option.icon as never}
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            variant={selected ? "filled" : "outlined"}
            color={selected ? "primary" : "default"}
            label={
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <Box component="span">{option.label}</Box>
                {loading && option.count === undefined ? (
                  <Skeleton variant="text" width={14} sx={{ display: "inline-block" }} />
                ) : (
                  option.count !== undefined && (
                    <Box
                      component="span"
                      className="hrms-num"
                      sx={{
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        color: selected ? "inherit" : tone ? `var(--hrms-status-${tone}-fg)` : "text.secondary",
                      }}
                    >
                      {option.count}
                    </Box>
                  )
                )}
              </Stack>
            }
            sx={{
              fontWeight: 600,
              ...(!selected &&
                tone && {
                  borderColor: `var(--hrms-status-${tone}-border)`,
                }),
            }}
          />
        );
      })}
    </Stack>
  );
}
