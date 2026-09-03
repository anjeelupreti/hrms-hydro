"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DescriptionIcon from "@mui/icons-material/Description";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import Link from "next/link";

import DateText from "@/components/common/DateText";
import { useMemorandumDesk } from "@/hooks/useMemoranda";

/**
 * Memoranda waiting on this person, on the page they open every morning.
 *
 * **A memorandum stops until its holder moves it.** The chain has no timeout:
 * one person not noticing it is their turn halts the document for everybody
 * behind them. The only places that said so were the bell — which is read once
 * and cleared — and the memorandum page itself, which somebody has to think to
 * visit. This is the page people actually land on, so this is where "it is your
 * turn" belongs.
 *
 * Silent when there is nothing, like every other card here: an empty box saying
 * "no memoranda" is a line of noise on a page that already has a lot to say.
 */
export default function NeedsYourTurn() {
  const { data: desk, isPending } = useMemorandumDesk();
  const waiting = desk?.awaiting_me ?? [];

  if (isPending) {
    return <Skeleton variant="rounded" height={92} sx={{ mt: 2 }} />;
  }
  if (waiting.length === 0) return null;

  return (
    <Box
      sx={(theme) => ({
        mt: 2,
        p: 2,
        borderRadius: 2,
        border: "1px solid",
        borderColor: theme.palette.primary.main,
        bgcolor: alpha(theme.palette.primary.main, 0.05),
      })}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }}
        useFlexGap
      >
        <DescriptionIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Memoranda waiting on you
        </Typography>
        <Chip size="small" color="primary" label={waiting.length} />
        <Box sx={{ flex: 1 }} />
        <Button
          component={Link}
          href="/memoranda"
          size="small"
          endIcon={<ArrowForwardIcon />}
        >
          Open
        </Button>
      </Stack>

      <Stack spacing={1}>
        {/* Capped, with the rest behind the button above. Somebody with
            fourteen of these needs the top of the pile and a way through to
            the list, not fourteen rows pushing the day's attendance off the
            screen. */}
        {waiting.slice(0, 4).map((memo) => (
          <Stack
            key={memo.id}
            component={Link}
            href="/memoranda"
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "baseline",
              flexWrap: "wrap",
              textDecoration: "none",
              color: "inherit",
              borderRadius: 1,
              px: 1,
              py: 0.75,
              bgcolor: "background.paper",
              "&:hover": { bgcolor: "action.hover" },
            }}
            useFlexGap
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
              {memo.memo_id ?? "—"}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
              {memo.subject}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <DateText value={memo.memo_date} />
            </Typography>
          </Stack>
        ))}
        {waiting.length > 4 ? (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
            and {waiting.length - 4} more
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
