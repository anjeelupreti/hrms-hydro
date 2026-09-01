"use client";

import AddIcon from "@mui/icons-material/Add";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import EditIcon from "@mui/icons-material/Edit";
import HistoryIcon from "@mui/icons-material/History";
import DeleteIcon from "@mui/icons-material/Delete";
import DevicesIcon from "@mui/icons-material/Devices";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import AssetHistory from "@/components/assets/AssetHistory";
import AssetPhotos from "@/components/assets/AssetPhotos";
import ListInsight from "@/components/common/ListInsight";
import StateChip, { toneFor } from "@/components/common/StateChip";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCan, useCanCreate, useCanDelete } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import CountFilterBar from "@/components/common/CountFilterBar";
import {
  useAssets,
  useAssetStatusCounts,
  useAssignAsset,
  useDeleteAsset,
  useMyAssets,
  useReturnAsset,
  useSaveAsset,
  useUploadAssetPhoto,
  type Asset,
  type AssetStatus,
} from "@/hooks/useAssets";
import { EmployeePicker } from "@/components/common/pickers";

const CATEGORIES = ["laptop", "desktop", "monitor", "phone", "furniture", "vehicle", "other"];

export default function AssetsPage() {
  const isHR = useCan("workplace.manage");
  // Registering an asset and writing off an asset are the admin's; keeping the
  // register current is not.
  const canCreate = useCanCreate("workplace.manage");
  const canDelete = useCanDelete("workplace.manage");
  const [status, setStatus] = useState<AssetStatus | "">("");
  const { data } = useAssets({ status: status || undefined });
  const { data: counts } = useAssetStatusCounts();
  const { data: mine } = useMyAssets();
  const del = useDeleteAsset();
  const ret = useReturnAsset();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [assignFor, setAssignFor] = useState<Asset | null>(null);
  const [photosFor, setPhotosFor] = useState<Asset | null>(null);
  const [historyFor, setHistoryFor] = useState<Asset | null>(null);

  const assets = data?.results ?? [];
  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(assets, (a) => [
    a.name,
    a.asset_tag,
    a.category,
    a.status,
    a.assigned_to_name,
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Assets"
        subtitle="Company equipment and who holds it"
        icon={<DevicesIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search assets…"
              label="Search assets by name, tag, category or holder"
            />
            {isHR && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
                New asset
              </Button>
            )}
          </>
        }
      />

      {(mine?.length ?? 0) > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="overline" color="text.secondary">
            Assigned to me
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 1 }}>
            {mine!.map((a) => (
              <Chip key={a.id} icon={<DevicesIcon />} label={`${a.name} (${a.asset_tag})`} />
            ))}
          </Stack>
        </Box>
      )}

      {counts ? (
        (() => {
          // In circulation, over what the company owns and still uses. Retired
          // kit is excluded from the denominator: a store full of dead monitors
          // would otherwise read as poor utilisation forever, and the number is
          // meant to answer "should we buy more" — which retired stock cannot.
          const inService = counts.total - counts.retired;
          const idle = counts.available;
          return (
            <ListInsight
              headline={`${counts.assigned} of ${inService} out with staff`}
              reading={
                inService === 0
                  ? "Nothing on the books yet."
                  : idle === 0
                    ? "Nothing spare in the store — the next joiner needs a purchase, not an allocation."
                    : `${idle} spare in the store, so the next ${idle} joiner${idle === 1 ? "" : "s"} can be equipped without buying anything.`
              }
              aside={
                counts.maintenance > 0 ? (
                  <>
                    <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.2 }}>
                      {counts.maintenance} in repair
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      not available to assign
                    </Typography>
                  </>
                ) : undefined
              }
              segments={[
                { label: "Available", value: counts.available, depth: 0 },
                { label: "Assigned", value: counts.assigned, depth: 1 },
                { label: "In maintenance", value: counts.maintenance, depth: 0.5, attention: true },
                { label: "Retired", value: counts.retired, depth: 0.2 },
              ]}
            />
          );
        })()
      ) : null}

      {/* Status was only ever a coloured chip in the table - readable one row

          at a time, useless for "how many are in maintenance". Counted in SQL

          because the table itself stops at 100 rows. */}

      <Box sx={{ mb: 2 }}>

        <CountFilterBar

          ariaLabel="Filter assets by status"

          value={status}

          onChange={(next) => setStatus(next)}

          options={[

            { value: "", label: "All", count: counts?.total },

            { value: "available", label: "Available", count: counts?.available, tone: "success" },

            { value: "assigned", label: "Assigned", count: counts?.assigned, tone: "info" },

            { value: "maintenance", label: "Maintenance", count: counts?.maintenance, tone: "warning" },

            { value: "retired", label: "Retired", count: counts?.retired },

          ]}

        />

      </Box>


      <TableContainer component={Box} sx={{ bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Asset</TableCell>
              <TableCell>Tag</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Holder</TableCell>
              {isHR && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((a) => (
              <TableRow key={a.id} hover>
                <TableCell>
                  {/* The picture is the identifier people actually recognise —
                      "the silver one with the sticker", not VLU-LT-014. It
                      doubles as the way in to the gallery, so photographs are
                      one click from the row they describe rather than buried
                      in an overflow menu. */}
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                    <Box
                      role="button"
                      tabIndex={0}
                      aria-label={`Photographs of ${a.name}`}
                      onClick={() => setPhotosFor(a)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPhotosFor(a);
                        }
                      }}
                      sx={{
                        width: 36,
                        height: 36,
                        flexShrink: 0,
                        borderRadius: 1.5,
                        border: "1px solid",
                        borderColor: "divider",
                        bgcolor: "action.hover",
                        display: "grid",
                        placeItems: "center",
                        overflow: "hidden",
                        cursor: "pointer",
                        color: "text.disabled",
                      }}
                    >
                      {a.cover_url ? (
                        <Box
                          component="img"
                          src={a.cover_url}
                          alt=""
                          sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <PhotoCameraIcon fontSize="small" />
                      )}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {a.name}
                      </Typography>
                      {a.photo_count > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {a.photo_count} photo{a.photo_count === 1 ? "" : "s"}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>{a.asset_tag}</TableCell>
                <TableCell sx={{ textTransform: "capitalize" }}>{a.category}</TableCell>
                <TableCell><StateChip label={String(a.status)} tone={toneFor(a.status)} /></TableCell>
                <TableCell>{a.assigned_to_name ?? "—"}</TableCell>
                {isHR && (
                  <TableCell align="right">
                    {a.status === "assigned" ? (
                      <Tooltip title="Return">
                        <IconButton size="small" onClick={() => ret.mutate(a.id)}>
                          <KeyboardReturnIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      a.status === "available" && (
                        <Tooltip title="Assign">
                          <IconButton size="small" onClick={() => setAssignFor(a)}>
                            <AssignmentIndIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )
                    )}
                    {/* Everything that has happened to it — who held it
                        when, what was repaired, what it came back like. Open
                        to everybody who can see the row: "who had this when it
                        broke" is not an HR question. */}
                    <Tooltip title="History">
                      <IconButton size="small" onClick={() => setHistoryFor(a)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {/* Edit before delete. Deleting was the *only* way to
                        correct a wrong serial, and it takes the assignment
                        history with it. */}
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setEditing(a)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" onClick={() => del.mutate(a.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isHR ? 6 : 5}>
                  <EmptyState
                    variant={isEmptyResult ? "noResults" : "empty"}
                    title={isEmptyResult ? `No assets match “${query}”` : "No assets yet"}
                    description={
                      isEmptyResult
                      ? "Try a different search, or clear it to see everything."
                      : "Track company equipment here — laptops, phones, furniture, vehicles — and who is holding each one. Assignments and returns are recorded, so an item is never just missing."
                    }
                    compact
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <AssetPhotos asset={photosFor} canEdit={isHR} onClose={() => setPhotosFor(null)} />
      <AssetHistory asset={historyFor} canEdit={isHR} onClose={() => setHistoryFor(null)} />

      {creating && <AssetDialog onClose={() => setCreating(false)} />}
      {editing && (
        <AssetDialog key={editing.id} asset={editing} onClose={() => setEditing(null)} />
      )}
      {assignFor && <AssignDialog asset={assignFor} onClose={() => setAssignFor(null)} />}
    </PageContainer>
  );
}

/**
 * Add an asset, or correct one.
 *
 * Create and edit. `useSaveAsset` sends `PATCH` when given an id and
 * `AssetViewSet` is a plain `ModelViewSet`, so without an edit route a laptop
 * entered with the wrong serial could only be deleted and re-added, losing its
 * assignment history with it.
 */
function AssetDialog({ asset, onClose }: { asset?: Asset | null; onClose: () => void }) {
  const save = useSaveAsset();
  // Seeded from the asset when editing. The caller keys this dialog by id, so
  // opening a different row remounts it rather than showing the last one's
  // half-edited values.
  const [name, setName] = useState(asset?.name ?? "");
  const [tag, setTag] = useState(asset?.asset_tag ?? "");
  const [category, setCategory] = useState(asset?.category ?? "laptop");
  const [serial, setSerial] = useState(asset?.serial_number ?? "");
  const [error, setError] = useState<string | null>(null);

  /**
   * A photograph at the moment of creation. `AssetPhotos` is a second dialog
   * reached from the row menu, which means the one moment somebody has the
   * laptop in front of them and a camera in their hand is the one moment the
   * product has nowhere to put the picture.
   *
   * Held as a pending file and uploaded *after* the asset is saved, because on
   * a create there is no id to attach it to until the server has answered.
   * `useSaveAsset` returns the saved asset, which is where the id comes from.
   */
  const uploadPhoto = useUploadAssetPhoto();
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function choosePhoto(file: File | null) {
    setPendingPhoto(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function submit() {
    setError(null);
    try {
      const saved = await save.mutateAsync({
        id: asset?.id,
        values: { name, asset_tag: tag, category, serial_number: serial },
      });
      if (pendingPhoto) {
        // After the save, and awaited: closing while the upload is in flight
        // loses the picture silently, which is the failure this exists to stop.
        await uploadPhoto.mutateAsync({ asset: saved.id, file: pendingPhoto });
      }
      if (preview) URL.revokeObjectURL(preview);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{asset ? `Edit ${asset.name}` : "New asset"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Asset tag" value={tag} onChange={(e) => setTag(e.target.value)} helperText="Unique, e.g. LAP-001" />
          <TextField select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c} sx={{ textTransform: "capitalize" }}>{c}</MenuItem>
            ))}
          </TextField>
          <TextField label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} />

          {/* The photograph, in the dialog where the asset is created — see the
              note on `pendingPhoto`. Framed as *condition at handover*, because
              that is the argument it settles; "add an image" would get a stock
              product shot of a laptop, which settles nothing. */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
              Photo — what it looks like now. The only entry here nobody can
              dispute later.
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 84,
                  height: 84,
                  flexShrink: 0,
                  borderRadius: 2,
                  overflow: "hidden",
                  border: "1px dashed",
                  borderColor: "divider",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "action.hover",
                }}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt="Selected asset photo"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <PhotoCameraIcon sx={{ color: "text.disabled" }} />
                )}
              </Box>
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Button component="label" size="small" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                  {pendingPhoto ? "Choose another" : "Add a photo"}
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                  />
                </Button>
                {pendingPhoto ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {pendingPhoto.name}
                  </Typography>
                ) : null}
                {asset ? (
                  <Typography variant="caption" color="text.disabled">
                    Adds to this asset&apos;s existing photos.
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={save.isPending || uploadPhoto.isPending || !name || !tag}
        >
          {uploadPhoto.isPending ? "Uploading photo…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const assign = useAssignAsset();
  const [employee, setEmployee] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!employee) {
      setError("Pick an employee.");
      return;
    }
    try {
      await assign.mutateAsync({ id: asset.id, employee: Number(employee), note });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Assign {asset.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <EmployeePicker value={employee || null} onChange={(id) => setEmployee(id ?? 0)} required />
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={assign.isPending}>
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
