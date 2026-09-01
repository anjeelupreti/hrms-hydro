"use client";

import PaletteIcon from "@mui/icons-material/Palette";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import ColourPicker from "@/components/common/ColourPicker";
import ColorModeToggle from "@/components/shell/ColorModeToggle";

export default function ThemePopover({ variant = "icon", sx }: { variant?: "icon" | "button"; sx?: SxProps<Theme> }) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      {variant === "icon" ? (
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" sx={{ color: "text.secondary", ...sx }}>
          <PaletteIcon fontSize="small" />
        </IconButton>
      ) : (
        <Button
          variant="outlined"
          size="small"
          startIcon={<PaletteIcon />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ color: "text.secondary", borderColor: "divider", ...sx }}
        >
          Theme
        </Button>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 2,
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
              minWidth: 260,
              boxShadow: "0 12px 40px rgba(0,0,0,0.1)",
            },
          },
        }}
      >
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1, fontWeight: 700 }}>
              Appearance
            </Typography>
            <ColorModeToggle />
          </Box>
          <ColourPicker />
        </Stack>
      </Popover>
    </>
  );
}
