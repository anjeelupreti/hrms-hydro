"use client";

import EditIcon from "@mui/icons-material/Edit";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import KanbanBoard from "@/components/common/KanbanBoard";
import { useUpdateDeal } from "@/hooks/useCrm";
import type { Deal, DealStage } from "@/types/crm";

/**
 * Deals, on the shared board.
 *
 * The board mechanics — drag context, column loop, drop handler — live in
 * `KanbanBoard`, shared with the candidate pipeline and the client desk. Three
 * copies of one interaction is three places to fix the same dropped-card bug.
 * What is left here is the only part that is about deals: what a card says.
 *
 * No `transitions` passed, deliberately. A deal has no declared flow — any
 * stage can follow any other, because a deal genuinely can go back to
 * qualification — and inventing a rule to match the ticket board would be
 * asserting a constraint the business does not have.
 */

const STAGES: { value: DealStage; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function DealsKanban({ deals, onEdit }: { deals: Deal[]; onEdit?: (deal: Deal) => void }) {
  const updateDeal = useUpdateDeal();

  const columns = STAGES.map((stage) => ({
    value: stage.value,
    label: stage.label,
    cards: deals.filter((deal) => deal.stage === stage.value),
    is_terminal: stage.value === "won" || stage.value === "lost",
  }));

  return (
    <KanbanBoard
      columns={columns}
      getId={(deal) => deal.id}
      onMove={(deal, to) => updateDeal.mutate({ id: deal.id, values: { stage: to as DealStage } })}
      emptyHint="No deals here"
      columnWidth={260}
      minHeight={400}
      renderCard={(deal) => (
        <Card variant="outlined">
          <CardContent sx={{ p: "12px !important" }}>
            <Stack direction="row" sx={{ alignItems: "flex-start" }}>
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                {deal.title}
              </Typography>
              {onEdit && (
                <IconButton
                  size="small"
                  sx={{ mt: -0.5, mr: -0.5 }}
                  // Stops the click starting a drag instead of opening the form.
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onEdit(deal)}
                  title="Edit deal"
                >
                  <EditIcon sx={{ fontSize: 15 }} />
                </IconButton>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {deal.client_name}
            </Typography>
            <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
              {deal.value}
            </Typography>
            {deal.owner_name && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {deal.owner_name}
              </Typography>
            )}
          </CardContent>
        </Card>
      )}
    />
  );
}
