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
npm install notion-database-sync
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
