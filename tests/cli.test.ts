import { describe, test, expect } from "@jest/globals";
import {
  parseCliArgs,
  usage,
  validateCommand,
  type CliCommand,
} from "../src/cli";

describe("parseCliArgs", () => {
  test.each<[string, CliCommand]>([
    ["csv", "csv"],
    ["json", "json"],
    ["export", "export"],
    ["help", "help"],
    ["--help", "help"],
    ["-h", "help"],
  ])("resolves command %s", (input, expected) => {
    expect(parseCliArgs([input]).command).toBe(expected);
  });

  test("parses database-id with both space and = forms", () => {
    expect(parseCliArgs(["csv", "--database-id", "db-1", "--source", "x.csv"]).options["database-id"]).toBe("db-1");
    expect(parseCliArgs(["csv", "--database-id=db-2"]).options["database-id"]).toBe("db-2");
  });

  test("maps boolean-style flags to true", () => {
    const parsed = parseCliArgs(["export", "--database-id", "db-1", "--to-sheets", "--sheet-id", "sheet-1", "--sheet-name", "My Data"]);
    expect(parsed.options["to-sheets"]).toBe(true);
    expect(parsed.options["sheet-name"]).toBe("My Data");
  });

  test("rejects unknown commands", () => {
    expect(() => parseCliArgs(["bogus"])).toThrow(/Unknown command/);
  });

  test("rejects unknown options", () => {
    expect(() => parseCliArgs(["csv", "--wat"])).toThrow(/Unknown option/);
  });

  test("rejects missing values", () => {
    expect(() => parseCliArgs(["csv", "--database-id"])).toThrow(/requires a value/);
  });

  test.each([
    { args: ["csv", "--source", "x.csv"], expected: /--database-id/ },
    { args: ["json", "--database-id", "db-1"], expected: /--source/ },
    { args: ["export", "--out", "rows.json"], expected: /--database-id/ },
    { args: ["csv", "--database-id", "db-1"], expected: /--source/ },
    { args: ["csv", "--source", "x.csv"], expected: /--database-id/ },
    { args: ["export", "--database-id", "db-1", "--to-sheets"], expected: /--sheet-id/ },
  ])("validates $args", ({ args, expected }) => {
    expect(() => validateCommand(parseCliArgs(args))).toThrow(expected);
  });

  test("accepts sheets export with sheet id", () => {
    const parsed = parseCliArgs(["export", "--database-id", "db-1", "--to-sheets", "--sheet-id", "sheet-1"]);
    expect(parsed.options["to-sheets"]).toBe(true);
  });
});

describe("usage", () => {
  test("documents every command", () => {
    expect(usage()).toMatch(/notion-sync csv/);
    expect(usage()).toMatch(/notion-sync json/);
    expect(usage()).toMatch(/notion-sync export/);
  });
});
