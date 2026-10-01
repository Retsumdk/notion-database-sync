import { describe, test, expect, afterAll } from "@jest/globals";
import * as crypto from "crypto";
import {
  SheetsExporter,
  buildJwt,
  loadCredentials,
  valuesFromRows,
  type Credentials,
} from "../src/sheets";

const keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keyPair.publicKey;

const credentials: Credentials = {
  client_email: "sync-bot@example.iam.gserviceaccount.com",
  private_key: privateKeyPem,
};

describe("buildJwt", () => {
  test("produces a verifiable RS256 JWT for the sheets scope", () => {
    const { assertion } = buildJwt(credentials, 1_000_000_000);
    const [encodedHeader, encodedClaims, signature] = assertion.split(".");

    expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });

    const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString());
    expect(claims).toEqual({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_000_000,
      exp: 1_003_600,
    });

    const verified = crypto
      .createVerify("RSA-SHA256")
      .update(`${encodedHeader}.${encodedClaims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(verified).toBe(true);
  });
});

describe("loadCredentials", () => {
  test("parses inline JSON and ignores whitespace in private keys", () => {
    const loaded = loadCredentials(JSON.stringify(credentials));
    expect(loaded.client_email).toBe(credentials.client_email);
    expect(loaded.private_key).toContain("PRIVATE KEY");
  });

  test("rejects credentials missing required fields", () => {
    expect(() => loadCredentials(JSON.stringify({ client_email: "x" }))).toThrow();
    expect(() => loadCredentials("/nonexistent/credentials.json")).toThrow();
  });
});

describe("valuesFromRows", () => {
  test("serializes scalars and skips nested values, building a header from every key", () => {
    const values = valuesFromRows([
      { Name: "Alpha", Done: true, Qty: 3 },
      { Name: "Beta", Extra: "note" },
      { Name: "Gamma", Nested: { deep: true } },
    ]);
    expect(values).toEqual([
      ["Name", "Done", "Qty", "Extra"],
      ["Alpha", true, 3, ""],
      ["Beta", "", "", "note"],
      ["Gamma", "", "", ""],
    ]);
  });
});

describe("SheetsExporter", () => {
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("exchanges the JWT and appends rows to the sheet", async () => {
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "ya29.test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ updates: { updatedCells: 4 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const exporter = new SheetsExporter(credentials, fetch as typeof fetch);
    const result = await exporter.appendRows({
      spreadsheetId: "sheet-123",
      sheetName: "My Data",
      rows: [{ Name: "Alpha", Qty: 3 }],
    });

    expect(result.updatedCells).toBe(4);

    const [tokenCall, appendCall] = fetchCalls;
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const tokenBody = tokenCall.init.body as string;
    expect(tokenBody).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(tokenBody).toContain("assertion=");

    expect(appendCall.url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/My%20Data!A1:append?valueInputOption=RAW"
    );
    expect((appendCall.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer ya29.test-token"
    );
    expect(JSON.parse(appendCall.init.body as string)).toEqual({
      values: [["Name", "Qty"], ["Alpha", 3]],
    });
  });

  test("throws a descriptive error when the token exchange fails", async () => {
    globalThis.fetch = (async () =>
      new Response("bad token request", { status: 401 })) as typeof fetch;
    const exporter = new SheetsExporter(credentials);
    await expect(
      exporter.appendRows({
        spreadsheetId: "sheet-123",
        sheetName: "Sheet1",
        rows: [{ Name: "Alpha" }],
      })
    ).rejects.toThrow("Google token exchange failed (401)");
  });
});
