"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";

import { ACCENT_PRESETS } from "@/lib/store/theme";
import { useThemeStore } from "@/lib/store/theme";

/**
 * A compact row of 8 colour swatches. Clicking one updates the whole-app
 * primary accent colour instantly via the Zustand persist store.
 */
export default function ColourPicker() {
  const accentColor = useThemeStore((s) => s.accentColor);
  const setAccentColor = useThemeStore((s) => s.setAccentColor);

  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Accent colour
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {ACCENT_PRESETS.map((preset) => {
          const isActive = accentColor === preset.value;
          return (
            <Tooltip key={preset.value} title={preset.name} arrow>
              <Box
                component="button"
                onClick={() => setAccentColor(preset.value)}
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "none",
                  bgcolor: preset.value,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  outline: isActive ? `3px solid ${preset.value}` : "3px solid transparent",
                  outlineOffset: 2,
                  transition: "transform 0.15s ease, outline 0.15s ease",
                  "&:hover": { transform: "scale(1.15)" },
                  "&:focus-visible": { outline: `3px solid ${preset.value}`, outlineOffset: 3 },
                }}
                aria-label={`Set accent colour to ${preset.name}`}
                aria-pressed={isActive}
              >
                {isActive && (
                  <CheckIcon sx={{ fontSize: 16, color: "common.white" }} />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Your selection is saved automatically and persists across sessions.
      </Typography>
    </Box>
  );
}
