/**
 * Core domain types for the wish farm planner.
 */
import * as Schema from "@effect/schema/Schema";

// ── CRA Payroll JSON output (monthly mode) ──────────────────

export const CraPayrollAverages = Schema.Struct({
  grossIncome: Schema.Number,
  rrspMatched: Schema.Number,
  rrspUnmatched: Schema.Number,
  rrspEmployer: Schema.Number,
  federalTax: Schema.Number,
  provincialTax: Schema.Number,
  cpp: Schema.Number,
  cpp2: Schema.Number,
  ei: Schema.Number,
  totalDeductions: Schema.Number,
  netPay: Schema.Number,
});

export const CraPayrollConfig = Schema.Struct({
  province: Schema.String,
  annualSalary: Schema.Number,
  payPeriod: Schema.String,
  year: Schema.Number,
  rrspMatchPercent: Schema.Number,
  rrspUnmatchedPercent: Schema.Number,
  cppMaxedOut: Schema.Boolean,
  eiMaxedOut: Schema.Boolean,
});

export const CraMonthlyOutput = Schema.Struct({
  mode: Schema.Literal("monthly"),
  config: CraPayrollConfig,
  averages: CraPayrollAverages,
});

export type CraMonthlyOutput = typeof CraMonthlyOutput.Type;
export type CraPayrollAverages = typeof CraPayrollAverages.Type;

// ── CRA Payroll JSON output (table mode, per-paycheck) ──────

export const CraPayPeriodRow = Schema.Struct({
  period: Schema.Number,
  grossIncome: Schema.Number,
  rrspMatched: Schema.Number,
  rrspUnmatched: Schema.Number,
  rrspEmployer: Schema.Number,
  federalTax: Schema.Number,
  provincialTax: Schema.Number,
  cpp: Schema.Number,
  cpp2: Schema.Number,
  ei: Schema.Number,
  totalDeductions: Schema.Number,
  netPay: Schema.Number,
  cumulativeCpp: Schema.Number,
  cumulativeCpp2: Schema.Number,
  cumulativeEi: Schema.Number,
});

export type CraPayPeriodRow = typeof CraPayPeriodRow.Type;

export const CraTableOutput = Schema.Struct({
  mode: Schema.Literal("table"),
  config: CraPayrollConfig,
  yearly: Schema.Struct({
    rows: Schema.Array(CraPayPeriodRow),
    totals: Schema.Record({ key: Schema.String, value: Schema.Number }),
  }),
});

export type CraTableOutput = typeof CraTableOutput.Type;

// ── Wish Farm domain ────────────────────────────────────────

export interface WishItem {
  readonly name: string;
  readonly cost: number;
  readonly priority: number;        // 1 = highest
  readonly months?: number;         // if set, spread over this many months (timed); if blank, sequential
  readonly deferrable?: boolean;    // timed only: if false, always pays fixed amount (not deferred by sequential). default true
  readonly after?: readonly string[];  // don't start until ALL named items are funded
}

export interface IncomeProfile {
  readonly monthlyNetPay: number;
  readonly monthlyExpenses: number;
  readonly monthlyDiscretionary: number;
  readonly annualDiscretionary: number;
}

/** What happens to discretionary money in a single paycheck */
export interface PaycheckAllocation {
  readonly period: number;
  readonly takeHome: number;         // netPay - employee rrsp
  readonly expensesPortion: number;  // monthly expenses / paychecks-per-month
  readonly discretionary: number;    // takeHome - expensesPortion
  readonly assignments: readonly CategoryAssignment[];
}

/** A single category receiving money in a paycheck */
export interface CategoryAssignment {
  readonly category: string;
  readonly amount: number;
  readonly funded: boolean;          // true if this paycheck completes the item
  readonly runningTotal: number;     // cumulative saved toward this item after this paycheck
  readonly flags: string;            // icon flags e.g. "⚡", "🔓⏩", "⏫+11"
}

export interface PaycheckPlan {
  readonly income: IncomeProfile;
  readonly paychecks: readonly PaycheckAllocation[];
  readonly wishes: readonly WishItem[];
}

export interface WishPlan {
  readonly item: WishItem;
  readonly monthlyAllocation: number;
  readonly monthsToSave: number;
  readonly targetDate: Date;
}

export interface WishFarmPlan {
  readonly income: IncomeProfile;
  readonly wishes: readonly WishPlan[];
  readonly totalMonthlyWishSaving: number;
  readonly unallocatedMonthly: number;
}

// ── Config file schema ──────────────────────────────────────

export const WishItemSchema = Schema.Struct({
  name: Schema.String,
  cost: Schema.Number,
  priority: Schema.Number,
  months: Schema.optional(Schema.Number),
  deferrable: Schema.optional(Schema.Boolean),
  after: Schema.optional(Schema.Array(Schema.String)),
});

export const WishFarmConfigSchema = Schema.Struct({
  monthlyExpenses: Schema.Number,
  wishes: Schema.Array(WishItemSchema),
  craPayrollArgs: Schema.optional(Schema.Struct({
    salary: Schema.optional(Schema.Number),
    province: Schema.optional(Schema.String),
    year: Schema.optional(Schema.Number),
    payPeriod: Schema.optional(Schema.String),
    rrspMatch: Schema.optional(Schema.Number),
    rrspUnmatched: Schema.optional(Schema.Number),
  })),
});

export type WishFarmConfig = typeof WishFarmConfigSchema.Type;
