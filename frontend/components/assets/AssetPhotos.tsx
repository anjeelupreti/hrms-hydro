"use client";

import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import {
  useAssetPhotos,
  useDeleteAssetPhoto,
  useUploadAssetPhoto,
  type Asset,
} from "@/hooks/useAssets";

/**
 * What an asset looks like, alongside what the register says about it.
 *
 * **The register records movements; only a photograph records condition.** The
 * argument an asset list cannot settle is the one that actually happens on
 * return — *it went out with that scratch* — because every other field here is
 * a claim typed by whoever was at the desk. So this is not decoration: the
 * pictures are the evidence, and the caption is what they are evidence *of*.
 *
 * Captions are asked for at upload rather than offered afterwards, because a
 * gallery of six untitled photographs of the same black laptop is worth about
 * as much as none. The field is optional — refusing an upload for want of a
 * caption would mean the photo does not get taken at all.
 *
 * **Images load through `/media/…`, never a storage URL.** Media is gated on
 * the caller's schema, and the app's own route attaches the session — a direct
 * link would either 404 or, worse, serve one company's property to another.
 */
export default function AssetPhotos({
  asset,
  canEdit,
  onClose,
}: {
  asset: Asset | null;
  /** HR only. Everyone else sees the gallery and cannot change it. */
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data, isPending } = useAssetPhotos(asset?.id ?? null);
  const upload = useUploadAssetPhoto();
  const remove = useDeleteAssetPhoto();
  const fileInput = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [zoomed, setZoomed] = useState<string | null>(null);

  const photos = data?.results ?? [];

  function pick(file: File | undefined) {
    if (!file || !asset) return;
    upload.mutate(
      { asset: asset.id, file, caption: caption.trim() },
      // Cleared on success only: if the upload fails, the words the person
      // typed are still in the box for the retry.
      { onSuccess: () => setCaption("") },
    );
  }

  return (
    <Dialog open={asset != null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="div" sx={{ fontWeight: 700 }}>
            {asset?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {asset?.asset_tag} · condition on record
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {canEdit && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2.5 }}>
            <TextField
              size="small"
              fullWidth
              label="What does this show?"
              placeholder="Scratch on the lid, at handover"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pick(e.target.files?.[0]);
                // Reset, so choosing the same file twice still fires a change.
                e.target.value = "";
              }}
            />
            <Button
              variant="contained"
              startIcon={<AddPhotoAlternateIcon />}
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
              sx={{ flexShrink: 0 }}
            >
              {upload.isPending ? "Adding…" : "Add photo"}
            </Button>
          </Stack>
        )}

        {isPending ? null : photos.length === 0 ? (
          <EmptyState
            icon={<AddPhotoAlternateIcon />}
            title="No photographs yet"
            description={
              canEdit
                ? "Photograph an asset when it goes out and when it comes back. It is the only record here that settles an argument about its condition."
                : "Nothing has been photographed for this asset."
            }
          />
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" },
              gap: 1.5,
            }}
          >
            {photos.map((photo) => (
              <Box
                key={photo.id}
                sx={{
                  position: "relative",
                  borderRadius: 2,
                  overflow: "hidden",
                  border: "1px solid",
                  borderColor: "divider",
                  "&:hover .photo-remove": { opacity: 1 },
                }}
              >
                <Box
                  component="img"
                  src={photo.image_url}
                  alt={photo.caption || `Photograph of ${asset?.name}`}
                  onClick={() => setZoomed(photo.image_url)}
                  sx={{
                    display: "block",
                    width: "100%",
                    aspectRatio: "4 / 3",
                    objectFit: "cover",
                    cursor: "zoom-in",
                    bgcolor: "action.hover",
                  }}
                />
                {canEdit && (
                  <Tooltip title="Remove this photograph">
                    <IconButton
                      className="photo-remove"
                      size="small"
                      aria-label="Remove photograph"
                      onClick={() => remove.mutate(photo.id)}
                      sx={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        opacity: 0,
                        transition: "opacity 120ms",
                        bgcolor: "background.paper",
                        "&:hover": { bgcolor: "background.paper" },
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Box sx={{ px: 1, py: 0.75 }}>
                  <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
                    {photo.caption || "No caption"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(photo.created_at).toLocaleDateString()}
                    {photo.uploaded_by_name ? ` · ${photo.uploaded_by_name}` : ""}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>

      {/* A grid of thumbnails cannot show a scratch, which is the whole point
          of the grid. Clicking one opens it at full size. */}
      <Dialog open={zoomed != null} onClose={() => setZoomed(null)} maxWidth="lg">
        <Box
          component="img"
          src={zoomed ?? ""}
          alt=""
          onClick={() => setZoomed(null)}
          sx={{ display: "block", maxWidth: "90vw", maxHeight: "85vh", cursor: "zoom-out" }}
        />
      </Dialog>
    </Dialog>
  );
}
