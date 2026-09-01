"use client";

import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useColorScheme } from "@mui/material/styles";

export default function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();
  const isDark = mode === "dark";

  return (
    <Tooltip title={isDark ? "Light mode" : "Dark mode"}>
      <IconButton onClick={() => setMode(isDark ? "light" : "dark")} color="inherit">
        {isDark ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Tooltip>
  );
}
