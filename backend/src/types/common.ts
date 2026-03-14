export interface PaginationInput {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type ISODateString = string;
export type UUID = string;
