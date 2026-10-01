# Notion Database Sync

Synchronize Notion databases with external data sources (CSV, JSON, Google Sheets).

## Features

- **CSV Sync**: Import/export data between Notion databases and CSV files
- **JSON Sync**: Bulk import/export JSON arrays to/from Notion databases
- **Google Sheets Integration**: Two-way sync with Google Sheets
- **Conflict Resolution**: Handle duplicate detection and merge strategies
- **Field Mapping**: Map Notion properties to external source columns

## Installation

```bash
npm install github:Retsumdk/notion-database-sync
```

## Usage

### CLI

```bash
# Sync CSV to Notion
notion-sync csv --database-id <DATABASE_ID> --source data.csv

# Sync JSON to Notion
notion-sync json --database-id <DATABASE_ID> --source data.json

# Export Notion to Google Sheets
notion-sync export --database-id <DATABASE_ID> --to-sheets --sheet-name "My Data"
```

### Programmatic

```typescript
import { NotionSync } from 'notion-database-sync';

const sync = new NotionSync({
  notionToken: process.env.NOTION_TOKEN
});

// CSV to Notion
await sync.importCSV({
  databaseId: 'your-database-id',
  sourcePath: './data.csv',
  mapping: {
    'Name': 'title',
    'Email': 'email',
    'Status': 'select'
  }
});

// Notion to JSON
const data = await sync.exportJSON({
  databaseId: 'your-database-id'
});
console.log(data);
```

## Environment Variables

- `NOTION_TOKEN` - Your Notion integration token
- `GOOGLE_SHEETS_CREDENTIALS` - Google service account JSON credentials

## License

MIT

## CLI Reference

The `notion-sync` command ships with the package (installed automatically by `npm install github:Retsumdk/notion-database-sync`).

```bash
npx notion-sync help
```

### Commands

```bash
# Import a CSV file (auto-maps columns to database properties by name)
notion-sync csv --database-id <DATABASE_ID> --source data.csv

# Import a JSON array of row objects
notion-sync json --database-id <DATABASE_ID> --source data.json

# Export every row of a database to a JSON file (paginates through all pages)
notion-sync export --database-id <DATABASE_ID> --out rows.json

# Export to Google Sheets via a service account
notion-sync export --database-id <DATABASE_ID> --to-sheets \
  --sheet-id <SPREADSHEET_ID> --sheet-name "My Data"
```

### Options

| Option | Description |
| --- | --- |
| `--database-id <ID>` | Notion database ID (required for `csv`, `json`, `export`) |
| `--source <file>` | CSV or JSON file to import (required for `csv`, `json`) |
| `--mapping <file>` | JSON file mapping source columns to Notion properties |
| `--no-auto-map` | Disable schema-based column auto-mapping |
| `--out <file>` | Output path for `export` (JSON rows) |
| `--to-sheets` | Export rows to Google Sheets instead of a file |
| `--sheet-id <ID>` | Target Google Sheets spreadsheet ID (required for `--to-sheets`, or set `GOOGLE_SHEETS_ID`) |
| `--sheet-name <name>` | Target sheet tab name (default: `Sheet1`) |
| `--token <token>` | Notion integration token (defaults to `NOTION_TOKEN`) |
| `--base-url <url>` | Override the Notion API base URL (defaults to `NOTION_BASE_URL`) — useful for proxies and tests |

Options may also be passed as `--flag=value`.

### Column mapping

By default the CLI retrieves the database schema and maps source columns to
properties with matching names, case-insensitively. Columns with no matching
property are skipped and reported:

```console
$ notion-sync csv --database-id db123 --source data.csv
Imported 3 row(s) from data.csv into database db123
Skipped empty columns: Name, Due
```

Pass `--mapping map.json` to control the mapping explicitly. Values that match
a database property name are typed from the schema; values that are Notion type
keywords (`title`, `rich_text`, `number`, `select`, `multi_select`, `date`,
`checkbox`, `email`, `url`, `phone_number`) keep the legacy type-key convention
used by the programmatic API:

```json
{
  "Name": "Name",
  "Qty": "number",
  "Tasks": "multi_select"
}
```

### Google Sheets export

`--to-sheets` appends a header row plus one row per database record using the
Google Sheets REST API with a service account (no additional dependencies —
the RS256 JWT bearer flow is implemented on top of Node's `crypto` module).
Set `GOOGLE_SHEETS_CREDENTIALS` to inline service-account JSON or a path to
the JSON key file, and share the target spreadsheet with the service account's
email address.
