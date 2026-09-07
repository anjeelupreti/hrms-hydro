"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import PlaceIcon from "@mui/icons-material/Place";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ListControls from "@/components/common/ListControls";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { CompanyPicker, EmployeePicker } from "@/components/common/pickers";
import { useCan } from "@/hooks/useMe";
import { useRetireSite, useSaveSite, useSites, type Site, type SiteFormValues } from "@/hooks/useSites";
import { withCode } from "@/lib/people";

const EMPTY: SiteFormValues = {
  name: "",
  code: "",
  company: null,
  district: "",
  province: "",
  address: "",
  description: "",
  latitude: "",
  longitude: "",
  elevation_m: "",
  contact_name: "",
  contact_phone: "",
  access_notes: "",
  supervisors: [],
  is_active: true,
  photo: null,
};

/**
 * Sites — the places people are sent to.
 *
 * **A site exists to carry its supervisors.** `destination` on a field visit
 * stays free text, because a visit goes to "the headrace tunnel, ch. 1400" as
 * often as to a named installation and a lookup that could not hold those
 * would be filled in with "Other" and a note. What free text cannot do is name
 * the people who know whether a trip there is necessary — and a travel order
 * has to be validated by somebody who does.
 */
export default function SitesPage() {
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [creating, setCreating] = useState(false);

  const canManage = useCan("workplace.manage");
  const { data, isPending } = useSites({
    search: search || undefined,
    active: showRetired ? undefined : true,
  });
  const sites = data?.results ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Sites"
        subtitle="Where people are sent, and who signs off going there"
        icon={<PlaceIcon />}
        actions={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New site
            </Button>
          ) : null
        }
      />

      <ListControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Name, code or district"
        chips={
          <Chip
            size="small"
            label={showRetired ? "Including retired" : "Active only"}
            color={showRetired ? "primary" : "default"}
            variant={showRetired ? "filled" : "outlined"}
            onClick={() => setShowRetired((v) => !v)}
          />
        }
      />

      {isPending ? (
        <Skeleton variant="rounded" height={280} />
      ) : sites.length === 0 ? (
        <Alert severity="info">
          No sites yet. {canManage ? "Add one so travel orders can be routed to the people who know it." : ""}
        </Alert>
      ) : (
        // **Cards, not a table row.** A site is a *place*, and the one thing
        // that tells an approver whether a trip there is a morning or two days
        // on a jeep track is what it looks like — which a row of text columns
        // cannot carry. The photograph is the reason this page changed shape:
        // `Site.photo` has always been there and was shown nowhere.
        <Grid container spacing={2}>
          {sites.map((site) => (
            <Grid key={site.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  opacity: site.is_active ? 1 : 0.6,
                }}
              >
                {/* A fixed 150px band whether or not there is a photograph, so
                    a grid of cards does not go ragged the moment one site has
                    no picture. Without one it takes the module's own gradient
                    and shows the initials, the same answer `PersonAvatar` gives
                    for somebody with no face on file. */}
                <Box
                  sx={{
                    height: 150,
                    position: "relative",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: site.photo_url
                      ? `url(${site.photo_url}) center/cover`
                      : "linear-gradient(135deg, var(--mui-palette-primary-light), var(--mui-palette-primary-dark))",
                  }}
                >
                  {!site.photo_url ? (
                    <PlaceIcon sx={{ fontSize: 52, color: "common.white", opacity: 0.75 }} />
                  ) : null}
                  {!site.is_active ? (
                    <Chip
                      size="small"
                      label="Retired"
                      sx={{ position: "absolute", top: 8, right: 8, bgcolor: "background.paper" }}
                    />
                  ) : null}
                  {site.code ? (
                    <Chip
                      size="small"
                      label={site.code}
                      sx={{ position: "absolute", top: 8, left: 8, bgcolor: "background.paper" }}
                    />
                  ) : null}
                </Box>

                <Box sx={{ p: 2, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                        {site.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[site.address, site.district, site.province].filter(Boolean).join(", ") || "—"}
                      </Typography>
                    </Box>
                    {canManage ? (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => setEditing(site)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>

                  {site.company_name ? (
                    <Typography variant="caption" color="text.secondary">
                      {site.company_name}
                    </Typography>
                  ) : null}

                  <Box sx={{ mt: "auto", pt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                      Who signs off going there
                    </Typography>
                    {site.supervisor_names.length === 0 ? (
                      // Worth saying plainly: a site with nobody on it cannot
                      // be the reason a travel order is approvable, so trips
                      // there fall back to the traveller's own supervisors.
                      <Typography variant="caption" color="warning.main">
                        Nobody — trips fall back to the traveller&apos;s own supervisors
                      </Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }} useFlexGap>
                        {site.supervisor_names.map((person) => (
                          <Chip
                            key={person.id}
                            size="small"
                            variant="outlined"
                            label={withCode(person.name, person.employee_code)}
                          />
                        ))}
                      </Stack>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      {site.visit_count} {site.visit_count === 1 ? "visit" : "visits"} recorded
                    </Typography>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <SiteDialog
        open={creating || editing !== null}
        site={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </PageContainer>
  );
}

function SiteDialog({
  open,
  site,
  onClose,
}: {
  open: boolean;
  site: Site | null;
  onClose: () => void;
}) {
  const save = useSaveSite();
  const retire = useRetireSite();
  const [values, setValues] = useState<SiteFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  // Seeded when the dialog opens on a different record, rather than in an
  // effect that would fight every keystroke.
  const key = site?.id ?? 0;
  if (open && seeded !== key) {
    setSeeded(key);
    setValues(
      site
        ? {
            name: site.name,
            code: site.code,
            company: site.company,
            district: site.district,
            province: site.province,
            address: site.address,
            description: site.description,
            latitude: site.latitude ?? "",
            longitude: site.longitude ?? "",
            elevation_m: site.elevation_m == null ? "" : String(site.elevation_m),
            contact_name: site.contact_name,
            contact_phone: site.contact_phone,
            access_notes: site.access_notes,
            supervisors: site.supervisors,
            is_active: site.is_active,
            // Never seeded from the existing photo: a File cannot be
            // reconstructed from a URL, and null means "leave it alone".
            photo: null,
          }
        : EMPTY
    );
    setError(null);
  }
  if (!open && seeded !== null) setSeeded(null);

  function set<K extends keyof SiteFormValues>(field: K, value: SiteFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{site ? "Edit site" : "New site"}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2}>
          <TextField
            label="Name"
            required
            fullWidth
            size="small"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <TextField
            label="Code"
            fullWidth
            size="small"
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
            helperText="Short form for lists and reports — SJ-HW for the Sanjen headworks."
          />
          <CompanyPicker
            label="Company"
            value={values.company}
            onChange={(id) => set("company", id)}
            size="small"
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="District"
              fullWidth
              size="small"
              value={values.district}
              onChange={(e) => set("district", e.target.value)}
            />
            <TextField
              label="Province"
              fullWidth
              size="small"
              value={values.province}
              onChange={(e) => set("province", e.target.value)}
            />
          </Stack>
          <TextField
            label="Address"
            fullWidth
            size="small"
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
          />
          <EmployeePicker
            label="Supervisors"
            multiple
            value={values.supervisors}
            onChange={(ids) => set("supervisors", (ids as number[]) ?? [])}
            size="small"
            helperText="They can approve trips here, alongside each traveller's own supervisors."
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Contact on site"
              fullWidth
              size="small"
              value={values.contact_name}
              onChange={(e) => set("contact_name", e.target.value)}
              helperText="A trip is arranged with a person, not a place."
            />
            <TextField
              label="Contact phone"
              fullWidth
              size="small"
              value={values.contact_phone}
              onChange={(e) => set("contact_phone", e.target.value)}
            />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Latitude"
              fullWidth
              size="small"
              value={values.latitude}
              onChange={(e) => set("latitude", e.target.value)}
            />
            <TextField
              label="Longitude"
              fullWidth
              size="small"
              value={values.longitude}
              onChange={(e) => set("longitude", e.target.value)}
            />
            <TextField
              label="Elevation (m)"
              fullWidth
              size="small"
              value={values.elevation_m}
              onChange={(e) => set("elevation_m", e.target.value)}
            />
          </Stack>

          <TextField
            label="Getting there"
            fullWidth
            size="small"
            value={values.access_notes}
            onChange={(e) => set("access_notes", e.target.value)}
            placeholder="6 hrs from Butwal, last 20 km rough"
            helperText="In words — the honest answer is a sentence, not a number of hours."
          />

          {/* A travel order to "the headworks" means something different to
              somebody who has been there and somebody who has not, and the
              approver is frequently the latter. */}
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            {site?.photo_url && !values.photo ? (
              <Box
                component="img"
                src={site.photo_url}
                alt=""
                sx={{ width: 96, height: 64, objectFit: "cover", borderRadius: 1 }}
              />
            ) : null}
            <Button component="label" size="small" variant="outlined">
              {values.photo ? values.photo.name : site?.photo_url ? "Replace photo" : "Add a photo"}
              <Box
                component="input"
                type="file"
                accept="image/*"
                hidden
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  set("photo", e.target.files?.[0] ?? null)
                }
              />
            </Button>
          </Stack>

          <TextField
            label="Notes"
            fullWidth
            multiline
            minRows={2}
            size="small"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {site && site.is_active ? (
          <Button
            color="error"
            sx={{ mr: "auto" }}
            disabled={retire.isPending}
            onClick={() =>
              retire.mutate(site.id, { onSuccess: onClose, onError: (e) => setError(e.message) })
            }
          >
            Retire
          </Button>
        ) : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={save.isPending || !values.name.trim()}
          onClick={() =>
            save.mutate(
              { id: site?.id ?? null, values },
              { onSuccess: onClose, onError: (e) => setError(e.message) }
            )
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
