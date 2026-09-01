"use client";

import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useEffect, useRef, useState } from "react";

type Props = {
  /** Existing image URL (already uploaded), or null. */
  value: string | null;
  onChange: (file: File | null) => void;
  /** Fallback text (initials) when there's no image. */
  fallback?: string;
  shape?: "circle" | "square";
  size?: number;
  label?: string;
};

/**
 * Image input with an immediate local preview: the moment a file is
 * chosen it's shown via an object URL (revoked on cleanup), before any
 * upload happens. Reused for the profile avatar and the company logo.
 */
export default function ImageUpload({
  value,
  onChange,
  fallback = "",
  shape = "circle",
  size = 96,
  label = "Upload image",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleFile(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    onChange(file);
  }

  const shown = preview ?? value;

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
      <Avatar
        src={shown ?? undefined}
        variant={shape === "square" ? "rounded" : "circular"}
        sx={{ width: size, height: size, fontSize: size / 3, bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}
      >
        {fallback}
      </Avatar>
      <Box>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="outlined" size="small" startIcon={<PhotoCameraIcon />} onClick={() => inputRef.current?.click()}>
          {label}
        </Button>
        {shown && (
          <Button size="small" color="error" sx={{ ml: 1 }} onClick={() => handleFile(null)}>
            Remove
          </Button>
        )}
      </Box>
    </Stack>
  );
}
