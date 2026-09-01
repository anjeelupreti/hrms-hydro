"use client";

import AddIcon from "@mui/icons-material/Add";
import EmailIcon from "@mui/icons-material/Email";
import PhoneIcon from "@mui/icons-material/Phone";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useActivities,
  useContacts,
  useCreateContact,
  useCreateDeal,
  useDeals,
  useLogActivity,
} from "@/hooks/useCrm";
import { useCreateProject, useProjects } from "@/hooks/useProjects";

type Props = {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
  clientName: string;
};

const ACTIVITY_ICON: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", note: "Note" };

export default function ClientDetailDialog({ open, onClose, clientId, clientName }: Props) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{clientName}</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Contacts" />
          <Tab label="Deals" />
          <Tab label="Projects" />
          <Tab label="Activity" />
        </Tabs>
        {tab === 0 && <ContactsPanel clientId={clientId} />}
        {tab === 1 && <DealsPanel clientId={clientId} />}
        {tab === 2 && <ProjectsPanel clientId={clientId} />}
        {tab === 3 && <ActivityPanel clientId={clientId} />}
      </DialogContent>
    </Dialog>
  );
}

function ContactsPanel({ clientId }: { clientId: number | null }) {
  const { data: contacts } = useContacts(clientId ?? undefined);
  const createContact = useCreateContact();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function handleAdd() {
    if (!clientId) return;
    await createContact.mutateAsync({ client: clientId, name, title, email, phone });
    setAdding(false);
    setName("");
    setTitle("");
    setEmail("");
    setPhone("");
  }

  return (
    <Stack spacing={1.5}>
      {contacts?.results.map((contact) => (
        <Box key={contact.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {contact.name} {contact.title && `— ${contact.title}`}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 0.25, flexWrap: "wrap" }}>
                {contact.email && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <EmailIcon sx={{ fontSize: 14 }} /> {contact.email}
                  </Typography>
                )}
                {contact.phone && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <PhoneIcon sx={{ fontSize: 14 }} /> {contact.phone}
                  </Typography>
                )}
                {!contact.email && !contact.phone && (
                  <Typography variant="caption" color="text.secondary">
                    No contact details
                  </Typography>
                )}
              </Stack>
            </Box>
            <Stack direction="row" spacing={0.5}>
              {contact.email && (
                <Tooltip title={`Email ${contact.email}`}>
                  <IconButton size="small" component={MuiLink} href={`mailto:${contact.email}`}>
                    <EmailIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {contact.phone && (
                <Tooltip title={`Call ${contact.phone}`}>
                  <IconButton size="small" component={MuiLink} href={`tel:${contact.phone}`}>
                    <PhoneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </Box>
      ))}
      {contacts && contacts.results.length === 0 && !adding && (
        <Typography color="text.secondary" variant="body2">
          No contacts yet.
        </Typography>
      )}
      {adding ? (
        <Stack spacing={1}>
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Title" size="small" value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField label="Email" size="small" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Phone" size="small" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={handleAdd}>
              Save
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ alignSelf: "flex-start" }}>
          Add contact
        </Button>
      )}
    </Stack>
  );
}

const STAGE_COLOR = { lead: "default", qualified: "info", proposal: "warning", won: "success", lost: "error" } as const;

function DealsPanel({ clientId }: { clientId: number | null }) {
  const { data: deals } = useDeals({ client: clientId ?? undefined });
  const createDeal = useCreateDeal();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("0");

  async function handleAdd() {
    if (!clientId) return;
    await createDeal.mutateAsync({ client: clientId, title, stage: "lead", value });
    setAdding(false);
    setTitle("");
    setValue("0");
  }

  return (
    <Stack spacing={1.5}>
      {deals?.results.map((deal) => (
        <Stack key={deal.id} direction="row" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover", justifyContent: "space-between", alignItems: "center" }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {deal.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {deal.value}
            </Typography>
          </Box>
          <Chip size="small" label={deal.stage} color={STAGE_COLOR[deal.stage]} />
        </Stack>
      ))}
      {deals && deals.results.length === 0 && !adding && (
        <Typography color="text.secondary" variant="body2">
          No deals yet.
        </Typography>
      )}
      {adding ? (
        <Stack spacing={1}>
          <TextField label="Title" size="small" value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField label="Value" size="small" value={value} onChange={(e) => setValue(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={handleAdd}>
              Save
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ alignSelf: "flex-start" }}>
          Add deal
        </Button>
      )}
    </Stack>
  );
}

function ProjectsPanel({ clientId }: { clientId: number | null }) {
  const { data: projects } = useProjects({ client: clientId ?? undefined });
  const createProject = useCreateProject();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  async function handleAdd() {
    if (!clientId) return;
    await createProject.mutateAsync({ client: clientId, name, status: "planning" });
    setAdding(false);
    setName("");
  }

  return (
    <Stack spacing={1.5}>
      {projects?.results.map((project) => (
        <Box key={project.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {project.name}
          </Typography>
          <Chip size="small" label={project.status.replace("_", " ")} sx={{ mt: 0.5 }} />
        </Box>
      ))}
      {projects && projects.results.length === 0 && !adding && (
        <Typography color="text.secondary" variant="body2">
          No projects yet.
        </Typography>
      )}
      {adding ? (
        <Stack spacing={1}>
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={handleAdd}>
              Save
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ alignSelf: "flex-start" }}>
          Add project
        </Button>
      )}
    </Stack>
  );
}

function ActivityPanel({ clientId }: { clientId: number | null }) {
  const { data: activities } = useActivities({ client: clientId ?? undefined });
  const logActivity = useLogActivity();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("note");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!clientId) return;
    setError(null);
    try {
      await logActivity.mutateAsync({
        client: clientId,
        activity_type: type,
        notes,
        occurred_at: new Date().toISOString(),
      });
      setAdding(false);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error">{error}</Alert>}
      {activities?.results.map((activity) => (
        <Box key={activity.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
            <Chip size="small" label={ACTIVITY_ICON[activity.activity_type]} />
            <Typography variant="caption" color="text.secondary">
              {new Date(activity.occurred_at).toLocaleString()}
            </Typography>
          </Stack>
          <Typography variant="body2">{activity.notes}</Typography>
        </Box>
      ))}
      {activities && activities.results.length === 0 && !adding && (
        <Typography color="text.secondary" variant="body2">
          No activity logged yet.
        </Typography>
      )}
      <Divider />
      {adding ? (
        <Stack spacing={1}>
          <TextField select label="Type" size="small" value={type} onChange={(e) => setType(e.target.value)}>
            <MenuItem value="call">Call</MenuItem>
            <MenuItem value="email">Email</MenuItem>
            <MenuItem value="meeting">Meeting</MenuItem>
            <MenuItem value="note">Note</MenuItem>
          </TextField>
          <TextField label="Notes" size="small" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={handleAdd}>
              Log activity
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ alignSelf: "flex-start" }}>
          Log activity
        </Button>
      )}
    </Stack>
  );
}
