"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/common/EmptyState";
import { useOpenEmployee } from "@/lib/employeeProfile";
import { useOrgChart } from "@/hooks/useEmployees";
import type { OrgChartNode } from "@/types/employees";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function OrgNode({ node }: { node: OrgChartNode }) {
  const openEmployee = useOpenEmployee();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
      <Card
        sx={{
          p: 2,
          m: 2,
          width: 250,
          cursor: "pointer",
          border: "1px solid",
          borderColor: "divider",
          "&:hover": { borderColor: "primary.main", boxShadow: 3 },
        }}
        onClick={() => openEmployee(node.id)}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Avatar src={node.photo ?? undefined} sx={{ bgcolor: "transparent", color: "primary.main", border: "1.5px solid", borderColor: "primary.main" }}>
            {initials(node.name)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {node.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {node.designation ?? "Employee"}
            </Typography>
          </Box>
        </Stack>
      </Card>

      {node.children.length > 0 && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            position: "relative",
            pt: 2,
            "&::before": {
              content: '""',
              position: "absolute",
              top: 0,
              left: "50%",
              borderLeft: "2px solid",
              borderColor: "divider",
              width: 0,
              height: "16px",
            },
          }}
        >
          <Box sx={{ display: "flex", gap: 4, position: "relative" }}>
            {node.children.map((child) => (
              <OrgNode key={child.id} node={child} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * The reporting hierarchy.
 *
 * Reads the server's `org-chart` endpoint, which returns the tree already
 * nested and unpaginated. Assembling it here from the paginated directory
 * cannot work: the API caps a page at 100, so a larger company is drawn
 * *partial but complete-looking*, with whole branches missing because their
 * manager fell on page two.
 */
export default function OrgChart() {
  const { data: roots, isLoading, isError } = useOrgChart();

  if (isLoading) {
    return (
      <Stack direction="row" spacing={4} sx={{ p: 4, justifyContent: "center" }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" width={250} height={84} />
        ))}
      </Stack>
    );
  }

  if (isError) {
    return (
      <EmptyState
        variant="error"
        title="Could not load the org chart"
        description="The reporting hierarchy could not be fetched. Refresh to try again."
        surface
      />
    );
  }

  if (!roots || roots.length === 0) {
    return (
      <EmptyState
        title="No reporting lines yet"
        description="The chart is built from each employee's manager. Set managers on employee records and the hierarchy appears here."
        surface
      />
    );
  }

  return (
    <Box sx={{ p: 4, overflow: "auto", minHeight: 600, display: "flex", justifyContent: "center" }}>
      <Box sx={{ display: "flex", gap: 8 }}>
        {roots.map((root) => (
          <OrgNode key={root.id} node={root} />
        ))}
      </Box>
    </Box>
  );
}
