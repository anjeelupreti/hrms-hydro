export type Notification = {
  id: number;
  verb: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationPreference = {
  email_enabled: boolean;
  in_app_enabled: boolean;
  push_enabled: boolean;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
