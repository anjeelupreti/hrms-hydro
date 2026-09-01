export type Holiday = {
  id: number;
  name: string;
  date: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
