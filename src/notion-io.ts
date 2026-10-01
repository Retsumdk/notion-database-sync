import type { SchemaEntry } from './properties';
import { buildProperties, flattenProperties } from './properties';

export interface NotionClientLike {
  databases: {
    retrieve(args: { database_id: string }): Promise<unknown>;
    query(args: {
      database_id: string;
      start_cursor?: string;
      page_size?: number;
    }): Promise<unknown>;
  };
  pages: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface ImportRecordsOptions {
  databaseId: string;
  records: Record<string, unknown>[];
  mapping?: Record<string, string>;
  schema?: Map<string, SchemaEntry>;
}

export interface ImportRecordsResult {
  created: number;
  skipped: string[];
}

export async function importRecords(
  client: NotionClientLike,
  options: ImportRecordsOptions
): Promise<ImportRecordsResult> {
  const created: number[] = [];
  const skipped = new Set<string>();

  for (const record of options.records) {
    const { properties, skipped: rowSkipped } = buildProperties(
      record,
      options.mapping || {},
      options.schema
    );
    for (const column of rowSkipped) {
      skipped.add(column);
    }
    await client.pages.create({
      parent: { database_id: options.databaseId },
      properties,
    });
    created.push(1);
  }

  return { created: created.length, skipped: [...skipped] };
}

export async function queryAllRows(
  client: NotionClientLike,
  databaseId: string
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  do {
    const response = (await client.databases.query({
      database_id: databaseId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })) as { results: unknown[]; next_cursor: string | null; has_more: boolean };

    for (const page of response.results) {
      const properties = (page as { properties?: Record<string, unknown> })
        .properties;
      if (properties) {
        rows.push(flattenProperties(properties as Record<string, any>));
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return rows;
}
