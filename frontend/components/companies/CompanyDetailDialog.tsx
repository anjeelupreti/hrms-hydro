"use client";

import ApartmentIcon from "@mui/icons-material/Apartment";
import BoltIcon from "@mui/icons-material/Bolt";
import EditIcon from "@mui/icons-material/Edit";
import EmailIcon from "@mui/icons-material/Email";
import LanguageIcon from "@mui/icons-material/Language";
import PeopleIcon from "@mui/icons-material/People";
import PhoneIcon from "@mui/icons-material/Phone";
import PlaceIcon from "@mui/icons-material/Place";
import WaterIcon from "@mui/icons-material/Water";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

import DateText from "@/components/common/DateText";
import type { Company } from "@/types/companies";

/**
 * One company, read-only.
 *
 * **Why a dialog and not a page.** A company is a dozen facts that are looked
 * at and closed again — a registration number to quote on a form, the licence
 * number, how many people it employs. A page would mean losing the list to see
 * one of them and finding it again afterwards. The form that *edits* those
 * facts is already a dialog for the same reason.
 *
 * Facts are omitted rather than shown blank. A row reading "Licence number —"
 * says nothing and takes the same space as one that says something, and a
 * holding company has no licence number to give.
 */
export default function CompanyDetailDialog({
  company,
  onClose,
  onEdit,
}: {
  company: Company | null;
  onClose: () => void;
  /** Omitted for somebody who may not edit — the button then does not appear. */
  onEdit?: (company: Company) => void;
}) {
  if (!company) return null;

  /**
   * The address, without saying the same place twice.
   *
   * `address` is free text and usually already carries the district —
   * "Butwal-8, Rupandehi" — so joining the three fields blindly produced
   * "Butwal-8, Rupandehi, Rupandehi, Lumbini". Each part is added only if it is
   * not already in what has been assembled.
   */
  const address = [company.address, company.district, company.province]
    .filter(Boolean)
    .reduce<string[]>((parts, part) => {
      const seen = parts.join(", ").toLowerCase();
      return seen.includes(part.toLowerCase()) ? parts : [...parts, part];
    }, [])
    .join(", ");

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" spacing={1.75} sx={{ alignItems: "flex-start" }}>
          <Avatar
            src={company.logo ?? undefined}
            variant="rounded"
            sx={(theme) => ({
              width: 46,
              height: 46,
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: "primary.main",
              fontWeight: 800,
            })}
          >
            {company.logo ? null : <ApartmentIcon />}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
              {company.name}
            </Typography>
            {company.legal_name && company.legal_name !== company.name ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {company.legal_name}
              </Typography>
            ) : null}
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ mt: 0.75, flexWrap: "wrap" }}
              useFlexGap
            >
              <Chip size="small" label={company.code} sx={{ fontWeight: 700 }} />
              <Chip size="small" variant="outlined" label={company.kind_display} />
              {company.project_stage !== "na" ? (
                <Chip size="small" variant="outlined" label={company.project_stage_display} />
              ) : null}
              {company.is_primary ? (
                <Chip size="small" color="primary" label="Payroll entity" />
              ) : null}
              {!company.is_active ? (
                <Chip size="small" color="warning" variant="outlined" label="Inactive" />
              ) : null}
            </Stack>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          {/* The two figures anybody opens a company to read. */}
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }} useFlexGap>
            <Figure
              icon={<PeopleIcon fontSize="small" />}
              value={String(company.employee_count)}
              label={company.employee_count === 1 ? "employee" : "employees"}
            />
            {company.installed_capacity_mw ? (
              <Figure
                icon={<BoltIcon fontSize="small" />}
                value={company.installed_capacity_mw}
                label="MW installed"
              />
            ) : null}
          </Stack>

          <Section title="Registration">
            <Fact label="Parent" value={company.parent_name} />
            <Fact label="Registration number" value={company.registration_number} />
            <Fact label="PAN / VAT" value={company.pan_vat_number} />
            <Fact label="Licence number" value={company.licence_number} />
            <Fact
              label="Established"
              value={
                company.established_on ? <DateText value={company.established_on} /> : null
              }
            />
          </Section>

          {company.river || company.installed_capacity_mw ? (
            <Section title="The project">
              <Fact
                label="River"
                value={company.river}
                icon={<WaterIcon sx={{ fontSize: 15 }} />}
              />
              <Fact label="Stage" value={company.project_stage_display} />
              <Fact
                label="Installed capacity"
                value={
                  company.installed_capacity_mw ? `${company.installed_capacity_mw} MW` : null
                }
              />
            </Section>
          ) : null}

          <Section title="Where and how to reach it">
            <Fact label="Address" value={address} icon={<PlaceIcon sx={{ fontSize: 15 }} />} />
            <Fact label="Phone" value={company.phone} icon={<PhoneIcon sx={{ fontSize: 15 }} />} />
            <Fact label="Email" value={company.email} icon={<EmailIcon sx={{ fontSize: 15 }} />} />
            <Fact
              label="Website"
              value={company.website}
              icon={<LanguageIcon sx={{ fontSize: 15 }} />}
            />
          </Section>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Box sx={{ flex: 1 }} />
        {onEdit ? (
          <Button variant="contained" startIcon={<EditIcon />} onClick={() => onEdit(company)}>
            Edit
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

function Figure({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <Box
      sx={(theme) => ({
        flex: "1 1 140px",
        px: 2,
        py: 1.25,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: alpha(theme.palette.primary.main, 0.04),
      })}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", color: "primary.main" }}>
        {icon}
        <Typography sx={{ fontWeight: 800, fontSize: "1.35rem", lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

/** A group of facts, hidden entirely when every one of them is empty. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const filled = Array.isArray(children)
    ? children.filter(Boolean).length > 0
    : Boolean(children);
  if (!filled) return null;
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: ".06em" }}
      >
        {title.toUpperCase()}
      </Typography>
      <Divider sx={{ mt: 0.5, mb: 1 }} />
      <Stack spacing={0.85}>{children}</Stack>
    </Box>
  );
}

/** One fact. Renders nothing at all when there is no value — see the note on
 *  the component above. */
function Fact({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "baseline" }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
        {icon}
        <Typography variant="body2" component="div" sx={{ wordBreak: "break-word" }}>
          {value}
        </Typography>
      </Stack>
    </Stack>
  );
}
