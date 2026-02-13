/**
 * Adapter for the @seethruhead/cra-payroll CLI.
 * Shells out to `cra-payroll --json` and parses the structured output.
 */
import { execFile } from "node:child_process";
import { Effect, pipe } from "effect";
import { Schema } from "effect";
import {
  CraMonthlyOutput,
  CraTableOutput,
  type CraPayrollAverages,
  type CraPayPeriodRow,
} from "../domain/types";

// ── Error types ─────────────────────────────────────────

export class CraPayrollError {
  readonly _tag = "CraPayrollError";
  constructor(readonly message: string) {}
}

// ── Build CLI args from options ─────────────────────────

export interface CraPayrollOptions {
  readonly salary?: number;
  readonly province?: string;
  readonly year?: number;
  readonly payPeriod?: string;
  readonly rrspMatch?: number;
  readonly rrspUnmatched?: number;
}

const buildBaseArgs = (opts: CraPayrollOptions): string[] => {
  const args: string[] = ["--json"];
  if (opts.salary !== undefined) args.push("--salary", String(opts.salary));
  if (opts.province !== undefined) args.push("--province", opts.province);
  if (opts.year !== undefined) args.push("--year", String(opts.year));
  if (opts.payPeriod !== undefined) args.push("--pay-period", opts.payPeriod);
  if (opts.rrspMatch !== undefined) args.push("--rrsp-match", String(opts.rrspMatch));
  if (opts.rrspUnmatched !== undefined) args.push("--rrsp-unmatched", String(opts.rrspUnmatched));
  return args;
};

// ── Execute cra-payroll ─────────────────────────────────

const execCraPayroll = (args: readonly string[]): Effect.Effect<string, CraPayrollError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile("cra-payroll", [...args], (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`cra-payroll failed: ${stderr || error.message}`));
          } else {
            resolve(stdout.trim());
          }
        });
      }),
    catch: (e) => new CraPayrollError(e instanceof Error ? e.message : String(e)),
  });

// ── Parse JSON output ───────────────────────────────────

const parseMonthlyOutput = (raw: string): Effect.Effect<CraPayrollAverages, CraPayrollError> =>
  pipe(
    Schema.decodeUnknown(CraMonthlyOutput)(JSON.parse(raw)),
    Effect.map((output) => output.averages),
    Effect.mapError((e) => new CraPayrollError(`Failed to parse cra-payroll monthly output: ${String(e)}`)),
  );

const parseTableOutput = (raw: string): Effect.Effect<readonly CraPayPeriodRow[], CraPayrollError> =>
  pipe(
    Schema.decodeUnknown(CraTableOutput)(JSON.parse(raw)),
    Effect.map((output) => output.yearly.rows),
    Effect.mapError((e) => new CraPayrollError(`Failed to parse cra-payroll table output: ${String(e)}`)),
  );

// ── Public API ──────────────────────────────────────────

export const getMonthlyAverages = (
  opts: CraPayrollOptions,
): Effect.Effect<CraPayrollAverages, CraPayrollError> =>
  pipe(
    execCraPayroll([...buildBaseArgs(opts), "--monthly"]),
    Effect.flatMap(parseMonthlyOutput),
  );

export const getPayPeriodRows = (
  opts: CraPayrollOptions,
): Effect.Effect<readonly CraPayPeriodRow[], CraPayrollError> =>
  pipe(
    execCraPayroll([...buildBaseArgs(opts), "--table"]),
    Effect.flatMap(parseTableOutput),
  );
