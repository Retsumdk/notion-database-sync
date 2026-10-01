import { describe, test, expect } from "@jest/globals";
import { importRecords, queryAllRows } from "../src/notion-io";
import type { NotionClientLike } from "../src/notion-io";

function fakeClient(captured: unknown[], queryPages: unknown[][]) {
  return {
    databases: {
      retrieve: async () => ({}),
      query: async () => {
        const page = queryPages.shift() || [];
        return {
          results: page,
          has_more: queryPages.length > 0,
          next_cursor: queryPages.length > 0 ? "cursor-2" : null,
        };
      },
    },
    pages: {
      create: async (args: unknown) => {
        captured.push(args);
        return { id: `page-${captured.length}` };
      },
    },
  } as unknown as NotionClientLike;
}

describe("importRecords", () => {
  test("creates one page per record and reports skipped columns", async () => {
    const captured: unknown[] = [];
    const client = fakeClient(captured, [[]]);
    const result = await importRecords(client, {
      databaseId: "db-1",
      records: [
        { Name: "Alpha", Notes: "first" },
        { Name: "", Notes: "second" },
      ],
      schema: new Map([
        ["Name", { name: "Name", type: "title" }],
        ["Notes", { name: "Notes", type: "rich_text" }],
      ]),
    });
    expect(result.created).toBe(2);
    expect(result.skipped).toEqual(["Name"]);
    expect(captured[0]).toMatchObject({
      parent: { database_id: "db-1" },
      properties: { Name: { title: [{ text: { content: "Alpha" } }] } },
    });
  });
});

describe("queryAllRows", () => {
  test("follows pagination until has_more is false", async () => {
    const client = fakeClient([], [
      [
        {
          properties: {
            Name: { type: "title", title: [{ plain_text: "row-1" }] },
          },
        },
      ],
      [
        {
          properties: {
            Name: { type: "title", title: [{ plain_text: "row-2" }] },
          },
        },
      ],
    ]);
    const rows = await queryAllRows(client, "db-1");
    expect(rows).toEqual([{ Name: "row-1" }, { Name: "row-2" }]);
  });
});
