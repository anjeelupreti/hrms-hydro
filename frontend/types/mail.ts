export type EmailAttachment = {
  id: number;
  filename: string;
  content_type: string;
};

export type EmailFolder = "inbox" | "sent";

export type EmailListItem = {
  id: number;
  folder: EmailFolder;
  from_email: string;
  from_name: string;
  to: string;
  subject: string;
  snippet: string;
  date: string | null;
  is_read: boolean;
  is_outgoing: boolean;
  has_attachments: boolean;
};

export type EmailDetail = Omit<EmailListItem, "snippet"> & {
  cc: string;
  body_text: string;
  body_html: string;
  attachments: EmailAttachment[];
};
