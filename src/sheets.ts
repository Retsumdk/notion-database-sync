import * as crypto from 'crypto';
import * as fs from 'fs';

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_API_BASE = 'https://sheets.googleapis.com/v4';

export interface Credentials {
  client_email: string;
  private_key: string;
}

export type ServiceAccountCredentials = Credentials;

export interface AppendRowsOptions {
  spreadsheetId: string;
  sheetName: string;
  rows: Record<string, unknown>[];
}

export interface AppendRowsResult {
  updatedCells: number;
  updatedRange: string;
}

export interface JwtParts {
  assertion: string;
  claims: Record<string, unknown>;
}

export function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildJwt(credentials: Credentials, now: number = Date.now()): JwtParts {
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const claims = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: DEFAULT_TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedClaims = base64Url(JSON.stringify(claims));
  const signatureBase = `${encodedHeader}.${encodedClaims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureBase);
  const signature = signer.sign(credentials.private_key);
  const assertion = `${signatureBase}.${base64Url(signature)}`;
  return { assertion, claims };
}

export function valuesFromRows(rows: Record<string, unknown>[]): unknown[][] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const header = keys.filter((key) =>
    rows.some((row) => {
      const value = row[key];
      return value !== null && value !== undefined && typeof value !== 'object';
    })
  );
  const values = rows.map((row) => header.map((key) => serializeCell(row[key])));
  return [header, ...values];
}

export function loadCredentials(source: string): Credentials {
  const raw = fs.existsSync(source) ? fs.readFileSync(source, 'utf-8') : source;
  let parsed: Partial<Credentials>;
  try {
    parsed = JSON.parse(raw) as Partial<Credentials>;
  } catch {
    throw new Error(
      'GOOGLE_SHEETS_CREDENTIALS must be service-account JSON (inline or a file path)'
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      'GOOGLE_SHEETS_CREDENTIALS must be service-account JSON with client_email and private_key'
    );
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n').trim(),
  };
}

export class SheetsExporter {
  private credentials: Credentials;
  private fetchImpl: typeof fetch;
  private tokenUrl: string;
  private apiBase: string;

  constructor(
    credentials: Credentials,
    fetchImpl: typeof fetch = fetch,
    options?: { tokenUrl?: string; apiBase?: string }
  ) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
    this.tokenUrl =
      options?.tokenUrl || process.env.SHEETS_TOKEN_URL || DEFAULT_TOKEN_URL;
    this.apiBase =
      options?.apiBase || process.env.SHEETS_API_BASE_URL || DEFAULT_API_BASE;
  }

  getAccessToken(now: number = Date.now()): Promise<string> {
    const { assertion } = buildJwt(this.credentials, now);
    return this.exchangeToken(assertion);
  }

  private async exchangeToken(assertion: string): Promise<string> {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(
        `Google token exchange failed (${response.status})${await response.text()}`
      );
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error('Google token exchange returned no access_token');
    }
    return body.access_token;
  }

  async appendRows(options: AppendRowsOptions): Promise<AppendRowsResult> {
    if (options.rows.length === 0) {
      return { updatedCells: 0, updatedRange: '' };
    }
    const accessToken = await this.getAccessToken();
    const values = valuesFromRows(options.rows);
    const range = encodeURIComponent(`${options.sheetName}!A1`);
    const url = `${this.apiBase}/spreadsheets/${encodeURIComponent(
      options.spreadsheetId
    )}/values/${range}:append?valueInputOption=RAW`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });
    if (!response.ok) {
      throw new Error(`Sheets append failed (${response.status})${await response.text()}`);
    }
    const body = (await response.json()) as {
      updates?: { updatedCells?: number; updatedRange?: string };
    };
    return {
      updatedCells: body.updates?.updatedCells ?? 0,
      updatedRange: body.updates?.updatedRange ?? '',
    };
  }
}

function serializeCell(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return value;
}
