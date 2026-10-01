import { Client } from '@notionhq/client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

export interface SyncOptions {
  databaseId: string;
  sourcePath: string;
  mapping?: Record<string, string>;
  notionToken?: string;
}

export interface NotionSyncConfig {
  notionToken?: string;
}

export class NotionSync {
  private notion: Client | null = null;
  private token: string;

  constructor(config: NotionSyncConfig) {
    this.token = config.notionToken || process.env.NOTION_TOKEN || '';
    if (this.token) {
      this.notion = new Client({ auth: this.token });
    }
  }

  async importCSV(options: SyncOptions): Promise<{ imported: number }> {
    if (!this.notion) {
      throw new Error('Notion token not configured');
    }

    const fileContent = fs.readFileSync(options.sourcePath, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true });
    
    let imported = 0;
    for (const record of records) {
      const properties: Record<string, any> = {};
      
      for (const [csvColumn, notionProp] of Object.entries(options.mapping || {})) {
        const value = record[csvColumn];
        if (!value) continue;
        
        switch (notionProp) {
          case 'title':
            properties[notionProp] = { title: [{ text: { content: value } }] };
            break;
          case 'rich_text':
            properties[notionProp] = { rich_text: [{ text: { content: value } }] };
            break;
          case 'number':
            properties[notionProp] = { number: parseFloat(value) || 0 };
            break;
          case 'select':
            properties[notionProp] = { select: { name: value } };
            break;
          case 'multi_select':
            properties[notionProp] = { multi_select: value.split(',').map((s: string) => ({ name: s.trim() })) };
            break;
          case 'date':
            properties[notionProp] = { date: { start: value } };
            break;
          case 'checkbox':
            properties[notionProp] = { checkbox: value.toLowerCase() === 'true' };
            break;
          case 'email':
            properties[notionProp] = { email: value };
            break;
          case 'url':
            properties[notionProp] = { url: value };
            break;
          default:
            properties[notionProp] = { rich_text: [{ text: { content: value } }] };
        }
      }

      await this.notion.pages.create({
        parent: { database_id: options.databaseId },
        properties
      });
      imported++;
    }

    return { imported };
  }

  async exportJSON(options: { databaseId: string }): Promise<any[]> {
    if (!this.notion) {
      throw new Error('Notion token not configured');
    }

    const response = await this.notion.databases.query({
      database_id: options.databaseId
    });

    return response.results.map((page: any) => {
      const row: Record<string, any> = {};
      for (const [key, prop] of Object.entries(page.properties || {}) as [string, any][]) {
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
        }
      }
      return row;
    });
  }

  async importJSON(options: {
    databaseId: string;
    sourcePath: string;
    mapping?: Record<string, string>;
  }): Promise<{ imported: number }> {
    if (!this.notion) {
      throw new Error('Notion token not configured');
    }

    const parsed = JSON.parse(fs.readFileSync(options.sourcePath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error('JSON source must be an array of objects');
    }

    let imported = 0;
    for (const record of parsed) {
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error(`JSON record at index ${imported} is not an object`);
      }
      const properties: Record<string, any> = {};
      for (const [column, notionProp] of Object.entries(options.mapping || {})) {
        const value = (record as Record<string, any>)[column];
        if (value === undefined || value === null || value === '') continue;
        const stringValue = String(value);
        switch (notionProp) {
          case 'title':
            properties[notionProp] = { title: [{ text: { content: stringValue } }] };
            break;
          case 'rich_text':
            properties[notionProp] = { rich_text: [{ text: { content: stringValue } }] };
            break;
          case 'number':
            properties[notionProp] = { number: parseFloat(stringValue) || 0 };
            break;
          case 'select':
            properties[notionProp] = { select: { name: stringValue } };
            break;
          case 'multi_select':
            properties[notionProp] = { multi_select: stringValue.split(',').map((s: string) => ({ name: s.trim() })) };
            break;
          case 'date':
            properties[notionProp] = { date: { start: stringValue } };
            break;
          case 'checkbox':
            properties[notionProp] = { checkbox: stringValue.toLowerCase() === 'true' };
            break;
          case 'email':
            properties[notionProp] = { email: stringValue };
            break;
          case 'url':
            properties[notionProp] = { url: stringValue };
            break;
          default:
            properties[notionProp] = { rich_text: [{ text: { content: stringValue } }] };
        }
      }

      await this.notion.pages.create({
        parent: { database_id: options.databaseId },
        properties
      });
      imported++;
    }

    return { imported };
  }

  async exportJSONAll(options: {
    databaseId: string;
    pageSize?: number;
  }): Promise<any[]> {
    if (!this.notion) {
      throw new Error('Notion token not configured');
    }

    const rows: any[] = [];
    let cursor: string | undefined = undefined;
    do {
      const response = await this.notion.databases.query({
        database_id: options.databaseId,
        page_size: options.pageSize,
        start_cursor: cursor
      });
      for (const page of response.results as any[]) {
        const row: Record<string, any> = {};
        for (const [key, prop] of Object.entries(page.properties || {}) as [string, any][]) {
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
          }
        }
        rows.push(row);
      }
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return rows;
  }

  async listDatabases(): Promise<any[]> {
    if (!this.notion) {
      throw new Error('Notion token not configured');
    }
    const response = await this.notion.search({
      filter: { property: 'object', value: 'database' }
    });
    return response.results;
  }
}

// CLI
const args = process.argv.slice(2);
if (args[0] === 'csv' || args[0] === 'json') {
  const command = args[0];
  const dbIndex = args.indexOf('--database-id');
  const sourceIndex = args.indexOf('--source');
  
  if (dbIndex === -1 || sourceIndex === -1) {
    console.error('Usage: notion-sync csv --database-id <ID> --source <file>');
    process.exit(1);
  }
  
  const databaseId = args[dbIndex + 1];
  const sourcePath = args[sourceIndex + 1];
  
  const sync = new NotionSync({});
  
  if (command === 'csv') {
    sync.importCSV({ databaseId, sourcePath, mapping: {} })
      .then(result => console.log(`Imported ${result.imported} rows`))
      .catch(err => { console.error(err); process.exit(1); });
  }
}

export default NotionSync;
