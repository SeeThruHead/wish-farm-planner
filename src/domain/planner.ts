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

// ── Per-paycheck hybrid allocation ──────────────────────

/**
 * Hybrid allocation: sequential items first, timed items use slack.
 *
 * Strategy:
 *   1. Sequential items get funded first from each paycheck (greedy).
 *   2. Whatever remains goes to timed items.
 *   3. Timed items have a deadline (months * periodsPerMonth).
 *      They are guaranteed to be funded because after all sequential
 *      items are done, 100% of discretionary flows to them.
 *
 * The trick: before giving money to a sequential item, we check that
 * timed items can still be fully funded with the remaining paychecks.
 * If not, timed items take priority to avoid missing their deadline.
 *
 * After all sequential items are funded, overflow accelerates the
 * highest-priority unfunded timed item.
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

  // Split into timed and sequential
  const timedItems = sorted.filter((i) => i.months !== undefined);
  const sequentialItems = sorted.filter((i) => i.months === undefined);

  // Compute deadline paycheck for each timed item
  const deadlines = new Map<string, number>();
  for (const item of timedItems) {
    deadlines.set(item.name, Math.ceil(item.months! * periodsPerMonth));
  }

  // Mutable running totals
  const saved = new Map<string, number>();
  for (const item of sorted) saved.set(item.name, 0);

  const timedDone = new Set<string>();
  let currentSeqIdx = 0;

  // Pre-compute conservative per-paycheck discretionary for feasibility checks.
  // Use the minimum discretionary across all remaining paychecks as a safe estimate.
  const discretionaries = rows.map((row) =>
    round2(Math.max(0, row.netPay - row.rrspMatched - row.rrspUnmatched - expensesPortion)),
  );

  /**
   * Check if timed items can still be funded given remaining paychecks,
   * assuming each future paycheck contributes at most `budget` to timed items.
   */
  const timedFeasible = (fromPaycheck: number, reservedThisPaycheck: number): boolean => {
    let totalTimedNeeded = 0;
    for (const item of timedItems) {
      if (timedDone.has(item.name)) continue;
      const remaining = item.cost - saved.get(item.name)!;
      if (remaining <= 0) continue;
      totalTimedNeeded += remaining;
    }

    // How much budget is available for timed items from this paycheck onward?
    // This paycheck: discretionary - reservedThisPaycheck
    // Future paychecks: full discretionary (conservative: assume all seq items done)
    let availableForTimed = Math.max(0, discretionaries[fromPaycheck] - reservedThisPaycheck);
    for (let i = fromPaycheck + 1; i < rows.length; i++) {
      availableForTimed += discretionaries[i];
    }

    return availableForTimed >= totalTimedNeeded - 0.01;
  };

  const mergeOrPush = (
    assignments: CategoryAssignment[],
    category: string,
    amount: number,
    funded: boolean,
    runningTotal: number,
  ) => {
    const existing = assignments.find((a) => a.category === category);
    if (existing) {
      const merged: CategoryAssignment = {
        category,
        amount: round2(existing.amount + amount),
        funded,
        runningTotal,
      };
      assignments[assignments.indexOf(existing)] = merged;
    } else {
      assignments.push({ category, amount, funded, runningTotal });
    }
  };

  const paychecks: PaycheckAllocation[] = rows.map((row, rowIdx) => {
    const takeHome = round2(row.netPay - row.rrspMatched - row.rrspUnmatched);
    const discretionary = round2(takeHome - expensesPortion);
    const assignments: CategoryAssignment[] = [];

    let remaining = Math.max(0, discretionary);

    // 1. Try to give money to sequential items first
    let seqSpent = 0;
    let idx = currentSeqIdx;
    while (remaining > 0.005 && idx < sequentialItems.length) {
      const item = sequentialItems[idx];
      const alreadySaved = saved.get(item.name)!;
      const needed = round2(item.cost - alreadySaved);

      if (needed <= 0) {
        idx++;
        continue;
      }

      const wouldSpend = round2(Math.min(remaining, needed));

      // Check: if we spend this on sequential, can timed items still make it?
      if (!timedFeasible(rowIdx, seqSpent + wouldSpend)) {
        break; // Can't afford it — timed items need the money
      }

      const amount = wouldSpend;
      const newTotal = round2(alreadySaved + amount);
      saved.set(item.name, newTotal);
      remaining = round2(remaining - amount);
      seqSpent += amount;

      const funded = newTotal >= item.cost - 0.005;
      assignments.push({ category: item.name, amount, funded, runningTotal: newTotal });

      if (funded) {
        idx++;
        currentSeqIdx = idx;
      }
    }

    // 2. Remaining goes to timed items (highest priority first)
    for (const item of timedItems) {
      if (remaining <= 0.005) break;
      if (timedDone.has(item.name)) continue;

      const alreadySaved = saved.get(item.name)!;
      const needed = round2(item.cost - alreadySaved);
      if (needed <= 0) {
        timedDone.add(item.name);
        continue;
      }

      const amount = round2(Math.min(remaining, needed));
      const newTotal = round2(alreadySaved + amount);
      saved.set(item.name, newTotal);
      remaining = round2(remaining - amount);

      const funded = newTotal >= item.cost - 0.005;
      if (funded) timedDone.add(item.name);

      mergeOrPush(assignments, item.name, amount, funded, newTotal);
    }

    // 3. True leftover (everything funded)
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
