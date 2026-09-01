"use client";

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import OrgMap, { DepartmentMap, type OrgDepartment, type OrgNode } from "@/components/employees/OrgMap";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";

/**
 * An org chart exists to make the *shape* of a company visible, which rules out
 * an indented list: increasing left-margins read as a bulleted outline at three
 * levels and run off the right of the page at five, with a person's manager
 * several screens above them.
 *
 * Two projections, because they answer different questions and neither can be
 * derived from the other by filtering:
 *
 * * **Reporting** — who signs off for whom. A tree, pannable, in either
 *   orientation: top-to-bottom reads as hierarchy, left-to-right fits a deep
 *   chain on a laptop.
 * * **Departments** — who belongs where, ordered by seniority. Reporting lines
 *   cross departments constantly (a finance manager under a COO sits beneath
 *   Operations), so this is genuinely a second view rather than a highlighted
 *   subtree.
 *
 * The search dims rather than filters in the tree view: removing non-matching
 * cards would break the branches and leave matches floating with no context,
 * and *where* somebody sits is most of what you came to find out.
 */

type OrgResponse = { tree: OrgNode[]; departments: OrgDepartment[] };

function useOrgChart() {
  return useQuery({
    queryKey: ["org-chart"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/employees/employees/org-chart/");
      if (!res.ok) throw new Error("Failed to load org chart");
      return (await res.json()) as OrgResponse;
    },
  });
}

export default function OrgChartPage() {
  const { data, isLoading } = useOrgChart();
  const router = useRouter();
  const [view, setView] = useState<"reporting" | "departments">("reporting");
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [query, setQuery] = useState("");

  const openPerson = (id: number) => router.push(`/employees/${id}`);

  return (
    <PageContainer>
      {/* A back link, not a breadcrumb: `PageHeader` below already draws the
          trail, and a second one would print it twice. */}
      <Button component={Link} href="/employees" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Employees
      </Button>

      <PageHeader
        title="Org chart"
        subtitle="Who reports to whom, and who sits where — drag to move around"
        icon={<AccountTreeIcon />}
      />

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        sx={{ mb: 2, alignItems: { md: "center" }, flexWrap: "wrap" }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, v) => v && setView(v)}
        >
          <ToggleButton value="reporting">Reporting line</ToggleButton>
          <ToggleButton value="departments">By department</ToggleButton>
        </ToggleButtonGroup>

        {/* Only meaningful for the tree. Hidden rather than disabled in the
            department view — a dead control is a question the reader has to
            answer for themselves. */}
        {view === "reporting" ? (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={orientation}
            onChange={(_, v) => v && setOrientation(v)}
          >
            <ToggleButton value="vertical">Top to bottom</ToggleButton>
            <ToggleButton value="horizontal">Left to right</ToggleButton>
          </ToggleButtonGroup>
        ) : null}

        <TextField
          size="small"
          placeholder="Find a person, role or team"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 260, ml: { md: "auto" } }}
        />
      </Stack>

      {isLoading || !data ? (
        <Skeleton variant="rounded" height={560} />
      ) : view === "reporting" ? (
        data.tree.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nobody has a reporting line yet. Set a manager on an employee record and they
            will appear here.
          </Typography>
        ) : (
          <OrgMap
            roots={data.tree}
            vertical={orientation === "vertical"}
            query={query}
            onOpen={openPerson}
          />
        )
      ) : (
        <DepartmentMap departments={data.departments} query={query} onOpen={openPerson} />
      )}

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Rank comes from the designation, not from depth in the tree — two people on
          different branches can be peers. Set it on a designation to order this chart.
        </Typography>
      </Box>
    </PageContainer>
  );
}
