/**
 * Adapter for the @seethruhead/cra-payroll CLI.
 * Shells out to `cra-payroll --json` and parses the structured output.
 */
import { execFile } from "node:child_process";
import { Effect, pipe, Data, Context, Layer } from "effect";
import { Schema } from "effect";
import {
  CraMonthlyOutput,
  CraTableOutput,
  type CraPayrollAverages,
  type CraPayPeriodRow,
} from "../domain/types";

// ── Error types ─────────────────────────────────────────

export class CraPayrollError extends Data.TaggedError("CraPayrollError")<{
  readonly message: string;
}> {}

// ── Options ─────────────────────────────────────────────

export interface CraPayrollOptions {
  readonly salary?: number;
  readonly province?: string;
  readonly year?: number;
  readonly payPeriod?: string;
  readonly rrspMatch?: number;
  readonly rrspUnmatched?: number;
}

// ── Service interface ───────────────────────────────────

export class CraPayrollService extends Context.Tag("CraPayrollService")<
  CraPayrollService,
  {
    readonly getMonthlyAverages: (opts: CraPayrollOptions) => Effect.Effect<CraPayrollAverages, CraPayrollError>;
    readonly getPayPeriodRows: (opts: CraPayrollOptions) => Effect.Effect<readonly CraPayPeriodRow[], CraPayrollError>;
  }
>() {}

// ── Live implementation ─────────────────────────────────

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
    catch: (e) => new CraPayrollError({ message: e instanceof Error ? e.message : String(e) }),
  });

const parseMonthlyOutput = (raw: string): Effect.Effect<CraPayrollAverages, CraPayrollError> =>
  pipe(
    Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (e) => new CraPayrollError({ message: `Invalid JSON from cra-payroll: ${e}` }) }),
    Effect.flatMap((parsed) => Schema.decodeUnknown(CraMonthlyOutput)(parsed)),
    Effect.map((output) => output.averages),
    Effect.mapError((e) => new CraPayrollError({ message: `Failed to parse cra-payroll monthly output: ${String(e)}` })),
  );

const parseTableOutput = (raw: string): Effect.Effect<readonly CraPayPeriodRow[], CraPayrollError> =>
  pipe(
    Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (e) => new CraPayrollError({ message: `Invalid JSON from cra-payroll: ${e}` }) }),
    Effect.flatMap((parsed) => Schema.decodeUnknown(CraTableOutput)(parsed)),
    Effect.map((output) => output.yearly.rows),
    Effect.mapError((e) => new CraPayrollError({ message: `Failed to parse cra-payroll table output: ${String(e)}` })),
  );

export const CraPayrollServiceLive = Layer.succeed(CraPayrollService, {
  getMonthlyAverages: (opts) =>
    pipe(
      execCraPayroll([...buildBaseArgs(opts), "--monthly"]),
      Effect.flatMap(parseMonthlyOutput),
    ),
  getPayPeriodRows: (opts) =>
    pipe(
      execCraPayroll([...buildBaseArgs(opts), "--table"]),
      Effect.flatMap(parseTableOutput),
    ),
});

// ── Convenience for backward compat ─────────────────────

export const getPayPeriodRows = (
  opts: CraPayrollOptions,
): Effect.Effect<readonly CraPayPeriodRow[], CraPayrollError, CraPayrollService> =>
  pipe(
    CraPayrollService,
    Effect.flatMap((svc) => svc.getPayPeriodRows(opts)),
  );
