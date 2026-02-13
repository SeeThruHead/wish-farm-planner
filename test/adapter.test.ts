import { describe, test, expect } from "bun:test";
import * as Schema from "@effect/schema/Schema";
import { CraMonthlyOutput } from "../src/domain/types";

describe("CRA payroll adapter schema", () => {
  const VALID_OUTPUT = {
    mode: "monthly",
    config: {
      province: "Ontario",
      annualSalary: 100000,
      payPeriod: "Semi-monthly (24 pay periods a year)",
      year: 2026,
      rrspMatchPercent: 4,
      rrspUnmatchedPercent: 0,
      cppMaxedOut: false,
      eiMaxedOut: false,
    },
    averages: {
      grossIncome: 8333.34,
      rrspMatched: 333.34,
      rrspUnmatched: 0,
      rrspEmployer: 333.34,
      federalTax: 1047.23,
      provincialTax: 530.71,
      cpp: 352.54,
      cpp2: 0,
      ei: 93.59,
      totalDeductions: 2024.07,
      netPay: 6309.27,
    },
  };

  test("parses valid cra-payroll monthly JSON output", () => {
    const result = Schema.decodeUnknownSync(CraMonthlyOutput)(VALID_OUTPUT);
    expect(result.mode).toBe("monthly");
    expect(result.averages.netPay).toBe(6309.27);
  });

  test("rejects wrong mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(CraMonthlyOutput)({ ...VALID_OUTPUT, mode: "annual" }),
    ).toThrow();
  });

  test("rejects missing averages fields", () => {
    const bad = {
      ...VALID_OUTPUT,
      averages: { grossIncome: 8333.34 },
    };
    expect(() => Schema.decodeUnknownSync(CraMonthlyOutput)(bad)).toThrow();
  });

  test("rejects non-numeric salary", () => {
    const bad = {
      ...VALID_OUTPUT,
      config: { ...VALID_OUTPUT.config, annualSalary: "100000" },
    };
    expect(() => Schema.decodeUnknownSync(CraMonthlyOutput)(bad)).toThrow();
  });
});
