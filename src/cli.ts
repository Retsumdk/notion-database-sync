#!/usr/bin/env node
import * as fs from 'fs';
import { Client } from '@notionhq/client';
import { parse } from 'csv-parse/sync';
import {
  autoMap,
  fetchSchema,
  type SchemaEntry,
} from './properties';
import { importRecords, queryAllRows } from './notion-io';
import { SheetsExporter, loadCredentials } from './sheets';

export type CliCommand = 'csv' | 'json' | 'export' | 'help';

export interface ParsedCli {
  command: CliCommand;
  options: Record<string, string | boolean>;
}

const KNOWN_OPTIONS = new Set([
  'database-id',
  'source',
  'out',
  'mapping',
  'no-auto-map',
  'to-sheets',
  'sheet-id',
  'sheet-name',
  'token',
  'base-url',
  'help',
  'h',
  'version',
]);

const COMMANDS: CliCommand[] = ['csv', 'json', 'export', 'help'];

export function parseCliArgs(argv: string[]): ParsedCli {
  const options: Record<string, string | boolean> = {};
  let commandInput = '';
  const rest: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      commandInput = commandInput || 'help';
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && !commandInput) {
      commandInput = arg;
      i += 1;
      continue;
    }
    rest.push(arg);
    i += 1;
  }

  let command = commandInput as CliCommand;
  if (options['help'] || rest.includes('--help') || rest.includes('-h')) {
    command = 'help';
  }

  if (!command) {
    throw new Error('Missing command (csv | json | export | help)');
  }
  if (!COMMANDS.includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  for (let j = 0; j < rest.length; j++) {
    const arg = rest[j];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    let name = arg.slice(2);
    let value: string | boolean = true;
    const eq = name.indexOf('=');
    if (eq !== -1) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    } else if (j + 1 < rest.length && !rest[j + 1].startsWith('--')) {
      value = rest[++j];
    }
    if (!KNOWN_OPTIONS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    if (name === 'h') {
      name = 'help';
      command = 'help';
    }
    if (name === 'no-auto-map') {
      options[name] = true;
      continue;
    }
    if (value === true && name !== 'to-sheets' && name !== 'help') {
      throw new Error(`Option --${name} requires a value`);
    }
    options[name] = value;
  }

  return { command, options };
}

export function validateCommand(parsed: ParsedCli): void {
  const options = parsed.options;
  if (parsed.command === 'csv' || parsed.command === 'json') {
    const missing: string[] = [];
    if (!options['database-id']) missing.push('--database-id');
    if (!options['source']) missing.push('--source');
    if (missing.length > 0) {
      throw new Error(`${parsed.command} requires ${missing.join(' and ')}`);
    }
  }
  if (parsed.command === 'export') {
    if (!options['database-id']) {
      throw new Error('export requires --database-id and --out (or --to-sheets)');
    }
    if (!options['out'] && !options['to-sheets']) {
      throw new Error('export requires --out (or --to-sheets)');
    }
  }
  if (options['to-sheets'] && !options['sheet-id']) {
    throw new Error('--to-sheets requires --sheet-id (or GOOGLE_SHEETS_ID)');
  }
}

export function usage(): string {
  return [
    'notion-sync — synchronize Notion databases with CSV and JSON sources',
    '',
    'Usage:',
    '  notion-sync csv --database-id <ID> --source data.csv [--mapping map.json] [--no-auto-map]',
    '  notion-sync json --database-id <ID> --source data.json [--mapping map.json] [--no-auto-map]',
    '  notion-sync export --database-id <ID> --out rows.json',
    '  notion-sync export --database-id <ID> --to-sheets --sheet-id <SHEET_ID> [--sheet-name "My Data"]',
    '  notion-sync help',
    '',
    'Options:',
    '  --database-id <ID>   Notion database ID (required for csv/json/export)',
    '  --source <file>      CSV or JSON file to import (required for csv/json)',
    '  --mapping <file>     JSON file mapping source columns to Notion property names',
    '  --no-auto-map        Disable schema-based column auto-mapping',
    '  --out <file>         Write exported rows to this JSON file (export mode)',
    '  --to-sheets          Export rows to Google Sheets (export mode)',
    '  --sheet-id <ID>      Target Google Sheets spreadsheet ID',
    '  --sheet-name <name>  Target sheet tab name (default: Sheet1)',
    '  --token <token>      Notion integration token (defaults to NOTION_TOKEN)',
    '  --base-url <url>     Override the Notion API base URL (defaults to NOTION_BASE_URL)',
    '',
    'Options may also be passed as --flag=value.',
    '',
    'Environment:',
    '  NOTION_TOKEN                    Notion integration token',
    '  NOTION_BASE_URL                 Override Notion API base URL',
    '  GOOGLE_SHEETS_CREDENTIALS       Service-account JSON (inline or file path)',
    '  GOOGLE_SHEETS_ID                Default spreadsheet ID for --to-sheets',
  ].join('\n');
}

function resolveToken(options: Record<string, string | boolean>): string {
  return (options['token'] as string) || process.env.NOTION_TOKEN || '';
}

function resolveBaseUrl(options: Record<string, string | boolean>): string {
  return (options['base-url'] as string) || process.env.NOTION_BASE_URL || '';
}

function buildClient(options: Record<string, string | boolean>): Client {
  const token = resolveToken(options);
  if (!token) {
    throw new Error('no Notion token. Pass --token or set NOTION_TOKEN.');
  }
  const clientOptions: { auth: string; baseUrl?: string } = { auth: token };
  const baseUrl = resolveBaseUrl(options);
  if (baseUrl) clientOptions.baseUrl = baseUrl;
  return new Client(clientOptions);
}

function loadRecords(
  sourcePath: string,
  command: 'csv' | 'json'
): Record<string, unknown>[] {
  const raw = fs.readFileSync(sourcePath, 'utf-8');
  if (command === 'json') {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON source must be an array of row objects');
    }
    for (const row of parsed) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('JSON source must be an array of row objects');
      }
    }
    return parsed as Record<string, unknown>[];
  }
  return parse(raw, { columns: true, skip_empty_lines: true }) as Record<
    string,
    unknown
  >[];
}

async function runImport(
  command: 'csv' | 'json',
  options: Record<string, string | boolean>
): Promise<number> {
  const databaseId = options['database-id'] as string;
  const sourcePath = options['source'] as string;
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source file not found: ${sourcePath}`);
  }

  let mapping: Record<string, string> | undefined;
  const mappingPath = options['mapping'] as string | undefined;
  if (mappingPath) {
    if (!fs.existsSync(mappingPath)) {
      throw new Error(`mapping file not found: ${mappingPath}`);
    }
    mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
  }

  const client = buildClient(options);
  let schema: Map<string, SchemaEntry> | undefined;
  if (!mapping && !options['no-auto-map']) {
    schema = await fetchSchema(client, databaseId);
    const records = loadRecords(sourcePath, command);
    const columns = Object.keys(records[0] || {});
    mapping = autoMap(columns, schema);
    if (Object.keys(mapping).length === 0) {
      throw new Error(
        'no columns matched the database schema. Check column names or pass --mapping.'
      );
    }
  }

  const records = loadRecords(sourcePath, command);
  const result = await importRecords(client, {
    databaseId,
    records,
    mapping: mapping || {},
    schema,
  });

  console.log(
    `Imported ${result.created} row(s) from ${sourcePath} into database ${databaseId}`
  );
  if (result.skipped.length > 0) {
    console.log(`Skipped empty columns: ${result.skipped.join(', ')}`);
  }
  return 0;
}

async function runExport(
  options: Record<string, string | boolean>
): Promise<number> {
  const client = buildClient(options);
  const rows = await queryAllRows(client, options['database-id'] as string);

  if (options['to-sheets']) {
    const credentialsSource = process.env.GOOGLE_SHEETS_CREDENTIALS || '';
    if (!credentialsSource) {
      throw new Error(
        '--to-sheets requires GOOGLE_SHEETS_CREDENTIALS (service-account JSON, inline or file path)'
      );
    }
    const spreadsheetId =
      (options['sheet-id'] as string) || process.env.GOOGLE_SHEETS_ID || '';
    if (!spreadsheetId) {
      throw new Error('--to-sheets requires --sheet-id or GOOGLE_SHEETS_ID');
    }
    const credentials = loadCredentials(credentialsSource);
    const exporter = new SheetsExporter(credentials);
    const result = await exporter.appendRows({
      spreadsheetId,
      sheetName: (options['sheet-name'] as string) || 'Sheet1',
      rows,
    });
    console.log(
      `Exported ${rows.length} row(s) to Google Sheets ${spreadsheetId} (${result.updatedCells} cells updated)`
    );
    return 0;
  }

  const out = options['out'] as string;
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`Exported ${rows.length} row(s) to ${out}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes('--version')) {
    const pkg = require('../package.json') as { version: string };
    console.log(pkg.version);
    return 0;
  }

  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
    validateCommand(parsed);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error(usage());
    return 1;
  }

  if (parsed.command === 'help') {
    console.log(usage());
    return 0;
  }
  if (parsed.command === 'csv' || parsed.command === 'json') {
    return runImport(parsed.command as 'csv' | 'json', parsed.options);
  }
  if (parsed.command === 'export') {
    return runExport(parsed.options);
  }
  return 0;
}

const invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  try {
    return fs.realpathSync(entry).endsWith('cli.js');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
