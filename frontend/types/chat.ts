export type ChatAttachment = {
  id: number;
  filename: string;
  content_type: string;
};

export type ChatMessage = {
  id: number;
  conversation: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  is_deleted: boolean;
  attachments: ChatAttachment[];
};

export type ConversationMember = { user_id: number; name: string };

export type Conversation = {
  id: number;
  /** `self` is your own notes thread — one member, you. */
  type: "dm" | "group" | "self";
  name: string;
  display_name: string;
  members: ConversationMember[];
  last_message: ChatMessage | null;
  unread_count: number;
  updated_at: string;
};

export type ChatParticipant = { user_id: number; name: string; role: string };

export type MessageHistory = { results: ChatMessage[]; has_more: boolean };

// Incoming WebSocket events (server -> client). The shape of `message`
// matches ChatMessage exactly — the backend's services.message_to_dict is
// shared between the REST history endpoint and these live events.
export type ChatSocketEvent =
  | { type: "message.new"; message: ChatMessage; client_id?: string | null }
  | { type: "message.edited"; message: ChatMessage }
  | { type: "message.deleted"; message: ChatMessage }
  | { type: "typing"; conversation: number; user_id: number; sender_name: string }
  | { type: "conversation.new"; conversation: Conversation };
