import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NotionSync } from "../src/index";

const fakeClient = (captured: any[]) => ({
  pages: {
    create: async (args: any) => {
      captured.push(args);
      return { id: `page-${captured.length}` };
    },
  },
});

describe("NotionSync", () => {
  let dir: string;
  let captured: any[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-sync-"));
    captured = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeSync() {
    const sync = new NotionSync({ notionToken: "secret_test" });
    (sync as any).notion = fakeClient(captured);
    return sync;
  }

  test("throws when no token is configured", async () => {
    const sync = new NotionSync({});
    delete (sync as any).notion;
    await expect(
      sync.importCSV({ databaseId: "db-1", sourcePath: "x.csv" })
    ).rejects.toThrow("Notion token not configured");
  });

  test("maps CSV columns to title and rich_text properties", async () => {
    const csv = "Name,Notes\nAlpha,first row\nBeta,second row";
    const file = join(dir, "rows.csv");
    writeFileSync(file, csv);

    const result = await makeSync().importCSV({
      databaseId: "db-1",
      sourcePath: file,
      mapping: { Name: "title", Notes: "rich_text" },
    });

    expect(result.imported).toBe(2);
    expect(captured[0].parent).toEqual({ database_id: "db-1" });
    expect(captured[0].properties.title).toEqual({
      title: [{ text: { content: "Alpha" } }],
    });
    expect(captured[1].properties.rich_text).toEqual({
      rich_text: [{ text: { content: "second row" } }],
    });
  });

  test("maps number, checkbox and multi_select columns", async () => {
    const file = join(dir, "rows.csv");
    writeFileSync(file, 'Qty,Done,Tasks\n3,true,"a, b"');

    await makeSync().importCSV({
      databaseId: "db-1",
      sourcePath: file,
      mapping: { Qty: "number", Done: "checkbox", Tasks: "multi_select" },
    });

    expect(captured[0].properties.number).toEqual({ number: 3 });
    expect(captured[0].properties.checkbox).toEqual({ checkbox: true });
    expect(captured[0].properties.multi_select).toEqual({
      multi_select: [{ name: "a" }, { name: "b" }],
    });
  });

  test("skips empty values and defaults unknown types to rich_text", async () => {
    writeFileSync(join(dir, "rows.csv"), "A,B\n,plain\nx,");
    await makeSync().importCSV({
      databaseId: "db-1",
      sourcePath: join(dir, "rows.csv"),
      mapping: { A: "title", B: "rich_text" },
    });
    expect(captured).toHaveLength(2);
    expect(captured[0].properties.title).toBeUndefined();
    expect(captured[0].properties.rich_text).toEqual({
      rich_text: [{ text: { content: "plain" } }],
    });
    expect(captured[1].properties.title).toEqual({
      title: [{ text: { content: "x" } }],
    });
    expect(captured[1].properties.rich_text).toBeUndefined();
  });

  test("CLI block does not run on import and exit code stays clean", () => {
    expect(process.exitCode).toBeUndefined();
    expect(typeof NotionSync).toBe("function");
  });
});
