"use client";

import { Drawer, Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useModalStore } from "@/hooks/useModalStore";

import ReviewDrawer from "@/components/performance/ReviewDrawer";
import ExpenseClaimModal from "@/components/payroll/ExpenseClaimModal";

/** The prop bag is untyped at the store, so narrow once here. */
function numericProp(props: Record<string, unknown>, key: string): number | null {
  const value = props[key];
  return typeof value === "number" ? value : null;
}

export default function GlobalDrawer() {
  const { drawerType, drawerProps, closeDrawer } = useModalStore();

  const reviewId = numericProp(drawerProps, "reviewId");

  return (
    <Drawer
      anchor="right"
      open={drawerType !== null}
      onClose={closeDrawer}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: 500, md: 600 },
            bgcolor: "background.paper",
          },
        },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {drawerType === "reviewDrawer" && "Performance Review"}
            {drawerType === "expenseClaim" && "Expense Claim"}
            {!drawerType && "Details"}
          </Typography>
          <IconButton onClick={closeDrawer} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, overflowY: "auto" }}>
          {/* drawerProps is an open bag by design, so each drawer narrows the
              one field it needs. Spreading it wholesale would let a caller
              typo an id and render a drawer with nothing to fetch. */}
          {drawerType === "expenseClaim" && <ExpenseClaimModal />}
          {drawerType === "reviewDrawer" && reviewId != null && <ReviewDrawer reviewId={reviewId} />}
        </Box>
      </Box>
    </Drawer>
  );
}
