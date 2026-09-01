"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import Amount from "@/components/common/Amount";
import EmptyState from "@/components/common/EmptyState";
import { DepartmentPicker, EmployeePicker } from "@/components/common/pickers";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import {
  BUDGET_ENFORCEMENTS,
  BUDGET_PERIODS,
  useDeleteBudget,
  useExpenseBudgets,
  useSaveBudget,
  type BudgetFormValues,
  type ExpenseBudget,
} from "@/hooks/useExpenseBudgets";
import { useCan, useMe } from "@/hooks/useMe";

/**
 * The ceilings on spending, and how close each one is.
 *
 * **Two controls on one page, because they are set in one conversation.** A cap
 * is per claim — "nobody claims more than 25,000 for a hotel" — and a budget is
 * a pool over a period. A system with only the first misses the department that
 * quietly spends its year in a quarter; a system with only the second lets one
 * person spend it in an afternoon.
 *
 * The meter is what the page is for. A budget nobody can see the state of is a
 * rule that surfaces only as a refusal.
 */

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "supplies", label: "Supplies" },
  { value: "software", label: "Software" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
];

const EMPTY: BudgetFormValues = {
  name: "",
  category: "",
  department: null,
  employee: null,
  period: "fiscal_year",
  amount: "",
  per_claim_cap: "",
  warn_at_percent: 80,
  enforcement: "warn",
  is_active: true,
  note: "",
};

export default function ExpenseBudgetsPage() {
  const { data: me } = useMe();
  const canManage = useCan("expenses.manage");
  const isAdmin = me?.role === "owner" || me?.role === "hr_admin" || Boolean(me?.is_superuser);

  const { data, isLoading } = useExpenseBudgets();
  const save = useSaveBudget();
  const remove = useDeleteBudget();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseBudget | null>(null);
  const [values, setValues] = useState<BudgetFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const budgets = data?.results ?? [];

  function start(budget: ExpenseBudget | null) {
    setEditing(budget);
    setValues(
      budget
        ? {
            name: budget.name,
            category: budget.category,
            department: budget.department,
            employee: budget.employee,
            period: budget.period,
            amount: budget.amount,
            per_claim_cap: budget.per_claim_cap ?? "",
            warn_at_percent: budget.warn_at_percent,
            enforcement: budget.enforcement,
            is_active: budget.is_active,
            note: budget.note,
          }
        : { ...EMPTY }
    );
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ id: editing?.id, values });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  function set<K extends keyof BudgetFormValues>(key: K, value: BudgetFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <PageContainer>
      <Breadcrumbs />
      <Button component={Link} href="/expenses" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Expenses
      </Button>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 2 }}
      >
        <Box>
          <Typography variant="h5">Budgets and caps</Typography>
          <Typography variant="body2" color="text.secondary">
            A cap limits one claim. A budget is a pool for a period. The most
            specific rule that matches a claim is the one that applies.
          </Typography>
        </Box>
        {isAdmin && canManage ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => start(null)}>
            Set a budget
          </Button>
        ) : null}
      </Stack>

      {isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={120} />
          ))}
        </Stack>
      ) : budgets.length === 0 ? (
        <EmptyState
          title="No budgets set"
          description="Without one, nothing is refused. Set a company-wide backstop first, then narrow it by department or category where a team needs its own."
        />
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          }}
        >
          {budgets.map((budget) => {
            const percent = budget.used_percent ?? 0;
            const over = percent > 100;
            const near = !over && percent >= budget.warn_at_percent && budget.warn_at_percent > 0;
            return (
              <Card key={budget.id} sx={{ opacity: budget.is_active ? 1 : 0.6 }}>
                <CardContent>
                  <Stack direction="row" sx={{ alignItems: "flex-start" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{budget.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {budget.scope_label} · {budget.period_display}
                      </Typography>
                    </Box>
                    {canManage ? (
                      <Stack direction="row">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => start(budget)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {isAdmin ? (
                          <Tooltip title="Remove">
                            <IconButton size="small" onClick={() => remove.mutate(budget.id)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Stack>
                    ) : null}
                  </Stack>

                  <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap" }} useFlexGap>
                    <Chip size="small" label={budget.category_display} />
                    <Chip
                      size="small"
                      variant="outlined"
                      color={budget.enforcement === "block" ? "error" : "default"}
                      label={budget.enforcement === "block" ? "Refuses" : "Flags"}
                    />
                    {!budget.is_active ? (
                      <Chip size="small" variant="outlined" label="Inactive" />
                    ) : null}
                  </Stack>

                  {Number(budget.amount) > 0 ? (
                    <Box sx={{ mt: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2">
                          <Amount value={budget.spent} /> of <Amount value={budget.amount} />
                        </Typography>
                        <Typography
                          variant="body2"
                          color={over ? "error.main" : near ? "warning.main" : "text.secondary"}
                          sx={{ fontWeight: 700 }}
                        >
                          {percent.toFixed(0)}%
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        // Capped at 100 for the bar; the number above already
                        // says when it has gone past, and a bar that overflows
                        // its track reads as a rendering fault.
                        value={Math.min(percent, 100)}
                        color={over ? "error" : near ? "warning" : "primary"}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                      {budget.remaining !== null ? (
                        <Typography variant="caption" color="text.secondary">
                          <Amount value={budget.remaining} /> left
                        </Typography>
                      ) : null}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                      No pool — this row is a per-claim cap only.
                    </Typography>
                  )}

                  {budget.per_claim_cap ? (
                    <Typography variant="body2" sx={{ mt: 1.5 }}>
                      One claim: at most <Amount value={budget.per_claim_cap} />
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${editing.name}` : "Set a budget"}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Name"
                fullWidth
                required
                autoFocus
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Grid>

            {/* ── Scope: three optional dimensions ──────────────────────
                Leaving one empty widens the rule. Nothing set is the
                company-wide backstop; the most specific match wins. */}
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                WHO AND WHAT IT COVERS
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Category"
                fullWidth
                value={values.category}
                onChange={(e) => set("category", e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DepartmentPicker
                label="Department"
                value={values.department}
                onChange={(id) => set("department", id)}
                placeholder="Whole company"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <EmployeePicker
                label="One person"
                value={values.employee}
                onChange={(id) => set("employee", id)}
                placeholder="Anybody"
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                THE LIMITS
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Period"
                fullWidth
                value={values.period}
                onChange={(e) => set("period", e.target.value as BudgetFormValues["period"])}
              >
                {BUDGET_PERIODS.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Pool for the period"
                fullWidth
                inputMode="decimal"
                value={values.amount}
                onChange={(e) => set("amount", e.target.value)}
                helperText="0 for a cap-only rule."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Cap per claim"
                fullWidth
                inputMode="decimal"
                value={values.per_claim_cap}
                onChange={(e) => set("per_claim_cap", e.target.value)}
                helperText="Empty for no limit."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="When it is breached"
                fullWidth
                value={values.enforcement}
                onChange={(e) =>
                  set("enforcement", e.target.value as BudgetFormValues["enforcement"])
                }
                helperText="Refusing is stricter; flagging makes it a conversation."
              >
                {BUDGET_ENFORCEMENTS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Warn at"
                type="number"
                fullWidth
                value={values.warn_at_percent}
                onChange={(e) => set("warn_at_percent", Number(e.target.value))}
                helperText="Percent of the pool. 0 never warns."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Note"
                fullWidth
                multiline
                minRows={2}
                value={values.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={values.is_active}
                    onChange={(e) => set("is_active", e.target.checked)}
                  />
                }
                label="Active"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={save.isPending || !values.name.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
