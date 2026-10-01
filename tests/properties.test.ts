import { describe, test, expect } from "@jest/globals";
import {
  autoMap,
  buildProperties,
  toNotionProperty,
  type SchemaEntry,
} from "../src/properties";

const schema = new Map<string, SchemaEntry>([
  ["Name", { name: "Name", type: "title" }],
  ["Qty", { name: "Qty", type: "number" }],
  ["Done", { name: "Done", type: "checkbox" }],
  ["Tags", { name: "Tags", type: "multi_select" }],
  ["Due", { name: "Due", type: "date" }],
  ["Email", { name: "Email", type: "email" }],
  ["Link", { name: "Link", type: "url" }],
  ["Status", { name: "Status", type: "select" }],
  ["Notes", { name: "Notes", type: "rich_text" }],
  ["Phone", { name: "Phone", type: "phone_number" }],
]);

describe("toNotionProperty", () => {
  test("builds every supported property shape", () => {
    expect(toNotionProperty("title", "Alpha")).toEqual({
      title: [{ text: { content: "Alpha" } }],
    });
    expect(toNotionProperty("rich_text", "hello")).toEqual({
      rich_text: [{ text: { content: "hello" } }],
    });
    expect(toNotionProperty("number", "42")).toEqual({ number: 42 });
    expect(toNotionProperty("number", "not-a-number", { strict: false })).toEqual({ number: null });
    expect(toNotionProperty("select", "Open")).toEqual({ select: { name: "Open" } });
    expect(toNotionProperty("multi_select", "a, b")).toEqual({
      multi_select: [{ name: "a" }, { name: "b" }],
    });
    expect(toNotionProperty("date", "2026-10-01")).toEqual({
      date: { start: "2026-10-01" },
    });
    expect(toNotionProperty("checkbox", "true")).toEqual({ checkbox: true });
    expect(toNotionProperty("checkbox", "FALSE")).toEqual({ checkbox: false });
    expect(toNotionProperty("email", "a@b.com")).toEqual({ email: "a@b.com" });
    expect(toNotionProperty("url", "https://example.com")).toEqual({
      url: "https://example.com",
    });
    expect(toNotionProperty("phone_number", "+1 555 0100")).toEqual({
      phone_number: "+1 555 0100",
    });
  });

  test("treats empty values as missing in strict mode", () => {
    expect(toNotionProperty("title", "")).toBeNull();
    expect(toNotionProperty("title", "   ")).toBeNull();
    expect(toNotionProperty("title", "", { strict: false })).toEqual({
      title: [{ text: { content: "" } }],
    });
  });
});

describe("buildProperties", () => {
  test("maps by schema-aware property names", () => {
    const { properties, skipped } = buildProperties(
      { Name: "Alpha", Qty: "3", Done: "true", Tags: "a, b", Due: "2026-10-01" },
      {},
      schema
    );
    expect(properties).toEqual({
      Name: { title: [{ text: { content: "Alpha" } }] },
      Qty: { number: 3 },
      Done: { checkbox: true },
      Tags: { multi_select: [{ name: "a" }, { name: "b" }] },
      Due: { date: { start: "2026-10-01" } },
    });
    expect(skipped).toEqual([]);
  });

  test("falls back to the legacy type-key convention when the mapping value is a type keyword", () => {
    const { properties } = buildProperties(
      { Name: "Alpha", Notes: "row" },
      { Name: "title", Notes: "rich_text" },
      schema
    );
    expect(properties).toEqual({
      title: { title: [{ text: { content: "Alpha" } }] },
      rich_text: { rich_text: [{ text: { content: "row" } }] },
    });
  });

  test("mapping overrides the schema-derived type", () => {
    const { properties } = buildProperties(
      { Qty: "007" },
      { Qty: "Notes" },
      schema
    );
    expect(properties).toEqual({
      Notes: { rich_text: [{ text: { content: "007" } }] },
    });
  });

  test("skips empty columns and unknown columns", () => {
    const { properties, skipped } = buildProperties(
      { Name: "", Notes: "row", Mystery: "x" },
      {},
      schema
    );
    expect(properties).toEqual({
      Notes: { rich_text: [{ text: { content: "row" } }] },
    });
    expect(skipped).toEqual(["Name", "Mystery"]);
  });
});

describe("autoMap", () => {
  test("matches columns to properties case-insensitively", () => {
    const mapping = autoMap(["name", "QTY", "done"], schema);
    expect(mapping).toEqual({ name: "Name", QTY: "Qty", done: "Done" });
  });

  test("drops unmatched columns", () => {
    expect(autoMap(["name", "Mystery"], schema)).toEqual({ name: "Name" });
    expect(autoMap(["Mystery"], schema)).toEqual({});
  });
});
