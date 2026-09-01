export type Announcement = {
  id: number;
  title: string;
  body: string;
  department: number | null;
  department_name: string | null;
  pinned: boolean;
  expires_at: string | null;
  posted_by: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
