"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ReplyIcon from "@mui/icons-material/Reply";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useEmail } from "@/hooks/useMail";

type Props = {
  messageId: number;
  onBack: () => void;
  onReply: (to: string, subject: string) => void;
};

export default function MailReader({ messageId, onBack, onReply }: Props) {
  const { data: email, isLoading } = useEmail(messageId);

  if (isLoading || !email) {
    return (
      <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  const sender = email.from_name || email.from_email;

  return (
    <Stack sx={{ height: "100%", flex: 1, minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
      >
        <IconButton size="small" onClick={onBack} sx={{ display: { md: "none" } }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          {email.subject || "(no subject)"}
        </Typography>
        {!email.is_outgoing && (
          <Button
            size="small"
            startIcon={<ReplyIcon />}
            onClick={() => onReply(email.from_email, email.subject)}
          >
            Reply
          </Button>
        )}
      </Stack>

      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>{email.is_outgoing ? "To" : "From"}:</strong>{" "}
            {email.is_outgoing ? email.to : `${sender} <${email.from_email}>`}
          </Typography>
          {!email.is_outgoing && email.to && (
            <Typography variant="caption" color="text.secondary">
              To: {email.to}
            </Typography>
          )}
          {email.date && (
            <Typography variant="caption" color="text.secondary">
              {new Date(email.date).toLocaleString()}
            </Typography>
          )}
        </Stack>

        {email.attachments.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
            {email.attachments.map((att) => (
              <Chip
                key={att.id}
                icon={<AttachFileIcon />}
                label={att.filename}
                component={Link}
                href={`/api/proxy/mail/attachments/${att.id}/download`}
                clickable
                variant="outlined"
                size="small"
              />
            ))}
          </Stack>
        )}

        <Divider sx={{ mb: 2 }} />

        {email.body_text ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {email.body_text}
          </Typography>
        ) : email.body_html ? (
          // Untrusted email HTML — render in a sandboxed iframe with no
          // allow-scripts so embedded scripts can't run (XSS guard).
          <Box
            component="iframe"
            title="message body"
            sandbox=""
            srcDoc={email.body_html}
            sx={{ width: "100%", minHeight: 400, border: "none" }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            (empty message)
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
