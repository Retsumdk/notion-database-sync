export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'email'
  | 'url'
  | 'phone_number';

export interface SchemaEntry {
  name: string;
  type: string;
}

export async function fetchSchema(
  client: {
    databases: { retrieve(args: { database_id: string }): Promise<unknown> };
  },
  databaseId: string
): Promise<Map<string, SchemaEntry>> {
  const database = (await client.databases.retrieve({
    database_id: databaseId,
  })) as { properties?: Record<string, { type?: string }> };

  const schema = new Map<string, SchemaEntry>();
  for (const [name, property] of Object.entries(database.properties || {})) {
    if (property.type) {
      schema.set(name.toLowerCase(), { name, type: property.type });
    }
  }
  return schema;
}

function schemaIndex(
  schema: Map<string, SchemaEntry>
): Map<string, SchemaEntry> {
  const index = new Map<string, SchemaEntry>();
  for (const entry of schema.values()) {
    index.set(entry.name.toLowerCase(), entry);
  }
  return index;
}

export function autoMap(
  columns: string[],
  schema: Map<string, SchemaEntry>
): Record<string, string> {
  const index = schemaIndex(schema);
  const mapping: Record<string, string> = {};
  for (const column of columns) {
    const entry = index.get(column.toLowerCase());
    if (entry) {
      mapping[column] = entry.name;
    }
  }
  return mapping;
}

export interface ToNotionPropertyOptions {
  strict?: boolean;
}

export function toNotionProperty(
  type: string,
  value: string,
  options?: ToNotionPropertyOptions
): Record<string, unknown> | null {
  const strict = options?.strict !== false;
  if (strict && (value === undefined || value === null || value.trim() === '')) {
    return null;
  }
  switch (type) {
    case 'title':
      return { title: [{ text: { content: value } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: value } }] };
    case 'number': {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        if (!strict) {
          return { number: null };
        }
        throw new Error(`Cannot convert "${value}" to a number`);
      }
      return { number: parsed };
    }
    case 'select':
      return { select: { name: value } };
    case 'multi_select':
      return {
        multi_select: String(value)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    case 'date':
      return { date: { start: value } };
    case 'checkbox':
      return { checkbox: String(value).toLowerCase() === 'true' };
    case 'email':
      return { email: value };
    case 'url':
      return { url: value };
    case 'phone_number':
      return { phone_number: value };
    default:
      return { rich_text: [{ text: { content: value } }] };
  }
}

export interface MappingResult {
  properties: Record<string, Record<string, unknown>>;
  skipped: string[];
}

export function buildProperties(
  record: Record<string, unknown>,
  mapping: Record<string, string>,
  schema?: Map<string, SchemaEntry>
): MappingResult {
  const properties: Record<string, Record<string, unknown>> = {};
  const skipped: string[] = [];
  const hasExplicitMapping = Object.keys(mapping).length > 0;
  const effectiveMapping: Record<string, string> = hasExplicitMapping
    ? mapping
    : schema
      ? autoMap(Object.keys(record), schema)
      : {};

  for (const column of Object.keys(record)) {
    const target = effectiveMapping[column];
    if (!target) {
      if (!hasExplicitMapping) {
        skipped.push(column);
      }
      continue;
    }
    const value = record[column];
    if (value === undefined || value === null || String(value).trim() === '') {
      skipped.push(column);
      continue;
    }
    const entry = schema
      ? schemaIndex(schema).get(target.toLowerCase())
      : undefined;
    const type = entry ? entry.type : target;
    const key = entry ? entry.name : target;
    const property = toNotionProperty(type, String(value));
    if (property) {
      properties[key] = property;
    }
  }

  return { properties, skipped };
}

export function flattenProperties(
  properties: Record<string, any>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties || {})) {
    if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
      row[key] = prop.title[0].plain_text;
    } else if (prop.type === 'rich_text' && prop.rich_text?.[0]?.plain_text) {
      row[key] = prop.rich_text[0].plain_text;
    } else if (prop.type === 'number') {
      row[key] = prop.number;
    } else if (prop.type === 'select') {
      row[key] = prop.select?.name;
    } else if (prop.type === 'multi_select') {
      row[key] = prop.multi_select?.map((s: any) => s.name).join(', ');
    } else if (prop.type === 'date') {
      row[key] = prop.date?.start;
    } else if (prop.type === 'checkbox') {
      row[key] = prop.checkbox;
    } else if (prop.type === 'email') {
      row[key] = prop.email;
    } else if (prop.type === 'url') {
      row[key] = prop.url;
    } else if (prop.type === 'phone_number') {
      row[key] = prop.phone_number;
    }
  }
  return row;
}
