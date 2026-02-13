/**
 * Orchestrates the full planning pipeline:
 * 1. Load config
 * 2. Get CRA payroll data (monthly averages or per-paycheck rows)
 * 3. Compute income profile
 * 4. Allocate wish items
 */
import { Effect, pipe } from "effect";
import type { WishFarmConfig, WishItem, WishFarmPlan, PaycheckPlan } from "../domain/types";
import {
  buildIncomeProfile,
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
}

export interface PaycheckPlanOptions {
  readonly configPath?: string;
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

/** Summary plan (monthly allocation view). */
export const createPlan = (
  options: PlanOptions,
): Effect.Effect<WishFarmPlan, ConfigError | CraPayrollError> =>
  pipe(
    loadConfig(options.configPath),
    Effect.flatMap((config) =>
      pipe(
        getMonthlyAverages(configToCraOptions(config)),
        Effect.map((averages) => {
          const income = buildIncomeProfile(averages, config.monthlyExpenses);
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
        getPayPeriodRows(configToCraOptions(config)),
        Effect.map((rows) => {
          const payPeriod = config.craPayrollArgs?.payPeriod ?? "Semi-monthly (24 pay periods a year)";
          const ppm = periodsPerMonth(payPeriod);
          return allocatePaychecks(rows, config.monthlyExpenses, configToWishItems(config), ppm);
        }),
      ),
    ),
  );
