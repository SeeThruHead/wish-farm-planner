/**
 * Pure domain logic for computing wish farm plans.
 * No side effects — all functions are pure.
 */
import type {
  CraPayrollAverages,
  CraPayPeriodRow,
  IncomeProfile,
  WishItem,
  WishPlan,
  WishFarmPlan,
  PaycheckAllocation,
  CategoryAssignment,
  PaycheckPlan,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Income Profile ──────────────────────────────────────

/** Build an income profile from CRA payroll averages and monthly expenses. */
export const buildIncomeProfile = (
  averages: CraPayrollAverages,
  monthlyExpenses: number,
): IncomeProfile => {
  const monthlyNetPay = averages.netPay - (averages.rrspMatched + averages.rrspUnmatched);
  const monthlyDiscretionary = monthlyNetPay - monthlyExpenses;
  return {
    monthlyNetPay: round2(monthlyNetPay),
    monthlyExpenses,
    monthlyDiscretionary: round2(monthlyDiscretionary),
    annualDiscretionary: round2(monthlyDiscretionary * 12),
  };
};

/** Build income profile from per-paycheck rows (more accurate — accounts for CPP/EI maxout). */
export const buildIncomeProfileFromRows = (
  rows: readonly CraPayPeriodRow[],
  monthlyExpenses: number,
): IncomeProfile => {
  const annualTakeHome = rows.reduce(
    (sum, r) => sum + (r.netPay - r.rrspMatched - r.rrspUnmatched),
    0,
  );
  const monthlyNetPay = round2(annualTakeHome / 12);
  const monthlyDiscretionary = round2(monthlyNetPay - monthlyExpenses);
  return {
    monthlyNetPay,
    monthlyExpenses,
    monthlyDiscretionary,
    annualDiscretionary: round2(monthlyDiscretionary * 12),
  };
};

// ── Helpers ─────────────────────────────────────────────

/** Sort wishes by priority (ascending = highest priority first). */
export const sortByPriority = (items: readonly WishItem[]): readonly WishItem[] =>
  [...items].sort((a, b) => a.priority - b.priority);

// ── Sequential monthly allocation (summary view) ───────

export const allocateSequential = (
  income: IncomeProfile,
  items: readonly WishItem[],
): WishFarmPlan => {
  const sorted = sortByPriority(items);
  const monthlyBudget = income.monthlyDiscretionary;

  if (monthlyBudget <= 0) {
    return {
      income,
      wishes: sorted.map((item) => ({
        item,
        monthlyAllocation: 0,
        monthsToSave: Infinity,
        targetDate: new Date(9999, 11, 31),
      })),
      totalMonthlyWishSaving: 0,
      unallocatedMonthly: monthlyBudget,
    };
  }

  let cumulativeMonths = 0;
  const now = new Date();
  const wishes: WishPlan[] = sorted.map((item) => {
    const monthsToSave = Math.ceil(item.cost / monthlyBudget);
    cumulativeMonths += monthsToSave;

    const targetDate = new Date(now.getFullYear(), now.getMonth() + cumulativeMonths, 1);

    return {
      item,
      monthlyAllocation: monthlyBudget,
      monthsToSave,
      targetDate,
    };
  });

  return {
    income,
    wishes,
    totalMonthlyWishSaving: monthlyBudget,
    unallocatedMonthly: 0,
  };
};

// ── Proportional monthly allocation (summary view) ─────

export const allocateProportional = (
  income: IncomeProfile,
  items: readonly WishItem[],
): WishFarmPlan => {
  const sorted = sortByPriority(items);
  const monthlyBudget = income.monthlyDiscretionary;

  if (monthlyBudget <= 0 || sorted.length === 0) {
    return {
      income,
      wishes: sorted.map((item) => ({
        item,
        monthlyAllocation: 0,
        monthsToSave: Infinity,
        targetDate: new Date(9999, 11, 31),
      })),
      totalMonthlyWishSaving: 0,
      unallocatedMonthly: monthlyBudget,
    };
  }

  const maxPriority = Math.max(...sorted.map((i) => i.priority));
  const weights = sorted.map((i) => maxPriority - i.priority + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const now = new Date();
  let totalAllocated = 0;

  const wishes: WishPlan[] = sorted.map((item, idx) => {
    const share = (weights[idx] / totalWeight) * monthlyBudget;
    const allocation = round2(share);
    totalAllocated += allocation;

    const monthsToSave = allocation > 0 ? Math.ceil(item.cost / allocation) : Infinity;
    const targetDate = allocation > 0
      ? new Date(now.getFullYear(), now.getMonth() + monthsToSave, 1)
      : new Date(9999, 11, 31);

    return { item, monthlyAllocation: allocation, monthsToSave, targetDate };
  });

  return {
    income,
    wishes,
    totalMonthlyWishSaving: round2(totalAllocated),
    unallocatedMonthly: round2(monthlyBudget - totalAllocated),
  };
};

// ── Per-paycheck sequential allocation ──────────────────

/**
 * Walk through each paycheck in order, subtracting per-paycheck expenses,
 * then filling wish items sequentially. When one item is funded, the
 * leftover rolls into the next item in the same paycheck.
 */
export const allocatePaychecks = (
  rows: readonly CraPayPeriodRow[],
  monthlyExpenses: number,
  items: readonly WishItem[],
  periodsPerMonth: number,
): PaycheckPlan => {
  const sorted = sortByPriority(items);
  const income = buildIncomeProfileFromRows(rows, monthlyExpenses);
  const expensesPortion = round2(monthlyExpenses / periodsPerMonth);

  // Mutable running totals per wish item
  const saved = new Map<string, number>();
  for (const item of sorted) saved.set(item.name, 0);

  let currentItemIdx = 0;

  const paychecks: PaycheckAllocation[] = rows.map((row) => {
    const takeHome = round2(row.netPay - row.rrspMatched - row.rrspUnmatched);
    const discretionary = round2(takeHome - expensesPortion);
    const assignments: CategoryAssignment[] = [];

    let remaining = Math.max(0, discretionary);

    // Walk through items starting from the current one
    let idx = currentItemIdx;
    while (remaining > 0.005 && idx < sorted.length) {
      const item = sorted[idx];
      const alreadySaved = saved.get(item.name)!;
      const needed = round2(item.cost - alreadySaved);

      if (needed <= 0) {
        idx++;
        continue;
      }

      const amount = round2(Math.min(remaining, needed));
      const newTotal = round2(alreadySaved + amount);
      saved.set(item.name, newTotal);
      remaining = round2(remaining - amount);

      const funded = newTotal >= item.cost - 0.005;
      assignments.push({
        category: item.name,
        amount,
        funded,
        runningTotal: newTotal,
      });

      if (funded) {
        idx++;
        currentItemIdx = idx;
      }
    }

    // If there's leftover after all items are funded
    if (remaining > 0.005) {
      assignments.push({
        category: "Unallocated",
        amount: round2(remaining),
        funded: false,
        runningTotal: round2(remaining),
      });
    }

    return { period: row.period, takeHome, expensesPortion, discretionary, assignments };
  });

  return { income, paychecks, wishes: sorted };
};

/**
 * Determine how many pay periods fall in each month for a given pay period type.
 * Returns the number of periods per month (e.g. 2 for semi-monthly).
 */
export const periodsPerMonth = (payPeriod: string): number => {
  if (payPeriod.includes("Semi-monthly")) return 2;
  if (payPeriod.startsWith("Monthly")) return 1;
  if (payPeriod.includes("Biweekly")) return 26 / 12;
  if (payPeriod.includes("Weekly")) return 52 / 12;
  if (payPeriod.includes("Daily")) return 240 / 12;
  // Fallback: extract number from string like "(24 pay periods a year)"
  const match = payPeriod.match(/(\d+)\s+pay periods/);
  return match ? parseInt(match[1], 10) / 12 : 2;
};
