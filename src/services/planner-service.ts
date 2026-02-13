/**
 * Orchestrates the full planning pipeline.
 *
 * Input priority (highest wins):
 *   1. CLI flags (--discretionary)
 *   2. Piped stdin (cra-payroll --json --table | wish-farm-planner)
 *   3. Config file (craPayrollArgs or discretionaryPerPeriod)
 */
import { Effect, pipe } from "effect";
import type { WishFarmConfig, WishItem, WishFarmPlan, PaycheckPlan, CraPayPeriodRow } from "../domain/types";
import {
  buildIncomeProfile,
  buildIncomeProfileStatic,
  buildStaticRows,
  allocateSequential,
  allocateProportional,
  allocatePaychecks,
  periodsPerMonth,
} from "../domain/planner";
import {
  getMonthlyAverages,
  getPayPeriodRows,
  type CraPayrollOptions,
  type CraPayrollError,
} from "../adapters/cra-payroll";
import { loadConfig, type ConfigError } from "./config";

export type AllocationStrategy = "sequential" | "proportional";

export interface PlanOptions {
  readonly configPath?: string;
  readonly strategy: AllocationStrategy;
  readonly discretionary?: number;
  readonly periods?: number;
  readonly stdin?: string;
}

export interface PaycheckPlanOptions {
  readonly configPath?: string;
  readonly discretionary?: number;
  readonly periods?: number;
  readonly stdin?: string;
}

const configToCraOptions = (config: WishFarmConfig): CraPayrollOptions => ({
  salary: config.craPayrollArgs?.salary,
  province: config.craPayrollArgs?.province,
  year: config.craPayrollArgs?.year,
  payPeriod: config.craPayrollArgs?.payPeriod,
  rrspMatch: config.craPayrollArgs?.rrspMatch,
  rrspUnmatched: config.craPayrollArgs?.rrspUnmatched,
});

const configToWishItems = (config: WishFarmConfig): readonly WishItem[] =>
  config.wishes.map((w) => ({
    name: w.name,
    cost: w.cost,
    priority: w.priority,
    ...(w.months !== undefined ? { months: w.months } : {}),
    ...(w.deferrable !== undefined ? { deferrable: w.deferrable } : {}),
    ...(w.after !== undefined && w.after.length > 0 ? { after: w.after } : {}),
  }));

/** Try to parse piped stdin as cra-payroll --json --table output. */
const parseStdinRows = (stdin: string): CraPayPeriodRow[] | null => {
  try {
    const parsed = JSON.parse(stdin);
    if (parsed.mode === "table" && parsed.yearly?.rows) {
      return parsed.yearly.rows as CraPayPeriodRow[];
    }
    return null;
  } catch {
    return null;
  }
};

/** Resolve the per-paycheck rows using the priority chain: flag > pipe > config. */
const resolveRows = (
  config: WishFarmConfig,
  options: { discretionary?: number; periods?: number; stdin?: string },
): Effect.Effect<{ rows: readonly CraPayPeriodRow[]; ppm: number }, CraPayrollError> => {
  const periodsPerYear = options.periods ?? config.periodsPerYear ?? 24;
  const ppm = periodsPerYear / 12;

  // 1. Flag wins
  if (options.discretionary !== undefined) {
    const rows = buildStaticRows(options.discretionary, config.monthlyExpenses, periodsPerYear);
    return Effect.succeed({ rows, ppm });
  }

  // 2. Pipe wins over config
  if (options.stdin) {
    const parsed = parseStdinRows(options.stdin);
    if (parsed) {
      return Effect.succeed({ rows: parsed, ppm });
    }
  }

  // 3. Config: static discretionary
  if (config.discretionaryPerPeriod !== undefined) {
    const rows = buildStaticRows(config.discretionaryPerPeriod, config.monthlyExpenses, periodsPerYear);
    return Effect.succeed({ rows, ppm });
  }

  // 4. Config: cra-payroll
  const payPeriod = config.craPayrollArgs?.payPeriod ?? "Semi-monthly (24 pay periods a year)";
  return pipe(
    getPayPeriodRows(configToCraOptions(config)),
    Effect.map((rows) => ({ rows, ppm: periodsPerMonth(payPeriod) })),
  );
};

/** Summary plan (monthly allocation view). */
export const createPlan = (
  options: PlanOptions,
): Effect.Effect<WishFarmPlan, ConfigError | CraPayrollError> =>
  pipe(
    loadConfig(options.configPath),
    Effect.flatMap((config) =>
      pipe(
        resolveRows(config, options),
        Effect.map(({ rows, ppm }) => {
          const expensesPortion = config.monthlyExpenses / ppm;
          const annualTakeHome = rows.reduce(
            (sum, r) => sum + (r.netPay - r.rrspMatched - r.rrspUnmatched), 0,
          );
          const monthlyNetPay = Math.round(annualTakeHome / 12 * 100) / 100;
          const monthlyDiscretionary = Math.round((monthlyNetPay - config.monthlyExpenses) * 100) / 100;
          const income = {
            monthlyNetPay,
            monthlyExpenses: config.monthlyExpenses,
            monthlyDiscretionary,
            annualDiscretionary: Math.round(monthlyDiscretionary * 12 * 100) / 100,
          };
          const items = configToWishItems(config);
          return options.strategy === "sequential"
            ? allocateSequential(income, items)
            : allocateProportional(income, items);
        }),
      ),
    ),
  );

/** Per-paycheck plan (sequential allocation across actual paychecks). */
export const createPaycheckPlan = (
  options: PaycheckPlanOptions,
): Effect.Effect<PaycheckPlan, ConfigError | CraPayrollError> =>
  pipe(
    loadConfig(options.configPath),
    Effect.flatMap((config) =>
      pipe(
        resolveRows(config, options),
        Effect.map(({ rows, ppm }) =>
          allocatePaychecks(rows, config.monthlyExpenses, configToWishItems(config), ppm),
        ),
      ),
    ),
  );
