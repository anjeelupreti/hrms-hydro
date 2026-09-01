"use client";

import AddIcon from "@mui/icons-material/Add";
import ApartmentIcon from "@mui/icons-material/Apartment";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useMemo, useState } from "react";

import { CompanyPicker } from "@/components/common/pickers";
import { useCompanyOptions } from "@/hooks/useCompanies";

/**
 * The group companies somebody *also* works for.
 *
 * **Why this is not just a multi-select.** A multi-select shows the current set
 * only while its menu is open, and removing one means reopening the menu,
 * finding the row and untickig it. The list this holds is read far more often
 * than it is edited — it is the answer to "where else does this person work" —
 * so the standing state is a row of named chips, each with its own remove, and
 * adding is a deliberate second step.
 *
 * **The primary company is shown here too, and cannot be removed.** Leaving it
 * out made the field look like the whole answer to "which companies", so
 * somebody would add the primary to the secondaries to make the list complete
 * and the save would be refused. Showing it, greyed and immovable, says what
 * the field is for without a paragraph.
 */
export default function SecondaryCompanyField({
  primaryCompanyId,
  primaryCompanyName,
  value,
  onChange,
  disabled = false,
}: {
  /** Excluded from the picker and shown as a fixed chip. */
  primaryCompanyId: number | null;
  /** Only needed before the options have loaded; the lookup below wins. */
  primaryCompanyName?: string | null;
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { data: options } = useCompanyOptions();
  const [adding, setAdding] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<number, string>();
    for (const company of options ?? []) map.set(company.id, company.name);
    return map;
  }, [options]);

  const primaryLabel =
    (primaryCompanyId != null ? byId.get(primaryCompanyId) : null) ?? primaryCompanyName ?? null;

  function add(id: number | null) {
    setAdding(false);
    if (id == null || value.includes(id) || id === primaryCompanyId) return;
    onChange([...value, id]);
  }

  function remove(id: number) {
    onChange(value.filter((existing) => existing !== id));
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        COMPANIES
      </Typography>

      <Box
        sx={(theme) => ({
          mt: 0.75,
          p: 1.25,
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: alpha(theme.palette.primary.main, 0.03),
          minHeight: 92,
        })}
      >
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
          {primaryLabel ? (
            <Chip
              icon={<ApartmentIcon />}
              label={primaryLabel}
              color="primary"
              size="small"
              // No delete handle. The primary is changed in the field above,
              // and a remove here would look like a way to leave somebody with
              // no employer.
              sx={{ fontWeight: 700 }}
            />
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ py: 0.5 }}>
              Pick a primary company above first.
            </Typography>
          )}

          {value.map((id) => (
            <Chip
              key={id}
              label={byId.get(id) ?? `Company ${id}`}
              size="small"
              variant="outlined"
              onDelete={disabled ? undefined : () => remove(id)}
              deleteIcon={<CloseIcon />}
            />
          ))}
        </Stack>

        {adding ? (
          <Box sx={{ mt: 1.25 }}>
            <CompanyPicker
              label="Add a company"
              autoFocus
              size="small"
              value={null}
              onChange={add}
              // Both the primary and everything already chosen, so the picker
              // never offers a row that would be silently dropped.
              excludeIds={[...value, ...(primaryCompanyId != null ? [primaryCompanyId] : [])]}
            />
            <Button size="small" onClick={() => setAdding(false)} sx={{ mt: 0.5 }}>
              Cancel
            </Button>
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setAdding(true)}
            disabled={disabled || primaryCompanyId == null}
            sx={{ mt: 1 }}
          >
            Also works for…
          </Button>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
        The primary company is who pays them. The others are where else they
        work — no payroll attaches to those.
      </Typography>
    </Box>
  );
}
