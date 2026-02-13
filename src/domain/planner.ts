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
 * Features:
 *   - Sequential items get funded first (greedy), checked against
 *     timed deadline feasibility.
 *   - Timed items with `deferrable: false` always get their fixed
 *     per-paycheck amount BEFORE sequential items.
 *   - Items with `after: [...]` are blocked until all named deps are funded.
 *   - Overflow after sequential items accelerates timed items.
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

  // Categorize items
  const timedItems = sorted.filter((i) => i.months !== undefined);
  const sequentialItems = sorted.filter((i) => i.months === undefined);
  const fixedTimedItems = timedItems.filter((i) => i.deferrable === false);
  const deferrableTimedItems = timedItems.filter((i) => i.deferrable !== false);

  // Deadline paychecks for timed items
  const deadlines = new Map<string, number>();
  for (const item of timedItems) {
    deadlines.set(item.name, Math.ceil(item.months! * periodsPerMonth));
  }

  // Fixed per-paycheck for non-deferrable timed items
  const fixedPerPaycheck = new Map<string, number>();
  for (const item of fixedTimedItems) {
    fixedPerPaycheck.set(item.name, round2(item.cost / (item.months! * periodsPerMonth)));
  }

  // Mutable state
  const saved = new Map<string, number>();
  for (const item of sorted) saved.set(item.name, 0);
  const done = new Set<string>();
  const firstContrib = new Set<string>();
  let currentSeqIdx = 0;

  const discretionaries = rows.map((row) =>
    round2(Math.max(0, row.netPay - row.rrspMatched - row.rrspUnmatched - expensesPortion)),
  );

  /** Check if all deps for an item are funded. */
  const depsReady = (item: WishItem): boolean => {
    if (!item.after || item.after.length === 0) return true;
    return item.after.every((dep) => done.has(dep));
  };

  /** Check if deferrable timed items can still be funded. */
  const timedFeasible = (fromPaycheck: number, reservedThisPaycheck: number): boolean => {
    let totalNeeded = 0;
    for (const item of deferrableTimedItems) {
      if (done.has(item.name)) continue;
      const remaining = item.cost - saved.get(item.name)!;
      if (remaining > 0) totalNeeded += remaining;
    }

    let available = Math.max(0, discretionaries[fromPaycheck] - reservedThisPaycheck);
    for (let i = fromPaycheck + 1; i < rows.length; i++) {
      available += discretionaries[i];
    }

    // Subtract future fixed timed obligations from available budget
    for (const item of fixedTimedItems) {
      if (done.has(item.name)) continue;
      const remaining = item.cost - saved.get(item.name)!;
      if (remaining > 0) available -= remaining;
    }

    return available >= totalNeeded - 0.01;
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
      assignments[assignments.indexOf(existing)] = {
        category,
        amount: round2(existing.amount + amount),
        funded,
        runningTotal,
        flags: existing.flags,
      };
    } else {
      assignments.push({ category, amount, funded, runningTotal, flags: "" });
    }
  };

  const fundItem = (
    item: WishItem,
    maxAmount: number,
    assignments: CategoryAssignment[],
  ): number => {
    const alreadySaved = saved.get(item.name)!;
    const needed = round2(item.cost - alreadySaved);
    if (needed <= 0) {
      done.add(item.name);
      return 0;
    }

    const amount = round2(Math.min(maxAmount, needed));
    const newTotal = round2(alreadySaved + amount);
    saved.set(item.name, newTotal);

    const funded = newTotal >= item.cost - 0.005;
    if (funded) done.add(item.name);

    mergeOrPush(assignments, item.name, amount, funded, newTotal);
    return amount;
  };

  const paychecks: PaycheckAllocation[] = rows.map((row, rowIdx) => {
    const takeHome = round2(row.netPay - row.rrspMatched - row.rrspUnmatched);
    const discretionary = round2(takeHome - expensesPortion);
    const assignments: CategoryAssignment[] = [];
    const itemFlags = new Map<string, string[]>();
    const addFlag = (name: string, flag: string) => {
      if (!itemFlags.has(name)) itemFlags.set(name, []);
      itemFlags.get(name)!.push(flag);
    };

    let remaining = Math.max(0, discretionary);

    // 1. Non-deferrable timed items get their fixed slice first (if deps ready)
    for (const item of fixedTimedItems) {
      if (done.has(item.name)) continue;
      if (!depsReady(item)) continue;
      if (remaining <= 0.005) break;

      if (!firstContrib.has(item.name)) {
        firstContrib.add(item.name);
        addFlag(item.name, "🔒");
      }

      const perPaycheck = fixedPerPaycheck.get(item.name)!;
      const cap = Math.min(perPaycheck, item.cost - saved.get(item.name)!);
      const spent = fundItem(item, Math.min(remaining, round2(cap)), assignments);
      remaining = round2(remaining - spent);
    }

    // 2. Sequential items (if deps ready)
    let seqSpent = 0;
    let idx = currentSeqIdx;
    const seqFundedThisPay: string[] = [];
    while (remaining > 0.005 && idx < sequentialItems.length) {
      const item = sequentialItems[idx];

      if (!depsReady(item)) {
        idx++;
        continue;
      }

      const alreadySaved = saved.get(item.name)!;
      const needed = round2(item.cost - alreadySaved);
      if (needed <= 0) {
        idx++;
        if (idx > currentSeqIdx) currentSeqIdx = idx;
        continue;
      }

      const wouldSpend = round2(Math.min(remaining, needed));

      if (!timedFeasible(rowIdx, seqSpent + wouldSpend)) {
        addFlag(item.name, "⏸");
        break;
      }

      if (!firstContrib.has(item.name)) {
        firstContrib.add(item.name);
        if (item.after && item.after.length > 0) {
          addFlag(item.name, "🔓");
        }
      }

      const spent = fundItem(item, wouldSpend, assignments);
      remaining = round2(remaining - spent);
      seqSpent += spent;

      if (done.has(item.name)) {
        seqFundedThisPay.push(item.name);
        idx++;
        if (idx > currentSeqIdx) currentSeqIdx = idx;
      }
    }
    // Flag sequential items prioritized over active timed items
    if (seqFundedThisPay.length > 0) {
      const deferredTimed = deferrableTimedItems.filter((t) => !done.has(t.name) && depsReady(t));
      if (deferredTimed.length > 0) {
        for (const name of seqFundedThisPay) addFlag(name, "⚡");
      }
    }

    // 3. Remaining goes to deferrable timed items (if deps ready)
    for (const item of deferrableTimedItems) {
      if (remaining <= 0.005) break;
      if (done.has(item.name)) continue;
      if (!depsReady(item)) continue;

      if (!firstContrib.has(item.name)) {
        firstContrib.add(item.name);
        if (item.after && item.after.length > 0) {
          addFlag(item.name, "🔓");
        }
        const deadline = deadlines.get(item.name)!;
        const behindBy = round2(item.cost * (rowIdx + 1) / deadline - saved.get(item.name)!);
        if (behindBy > 0.01) {
          addFlag(item.name, "⏩");
        }
      }

      const spent = fundItem(item, remaining, assignments);
      remaining = round2(remaining - spent);

      if (done.has(item.name)) {
        const deadline = deadlines.get(item.name)!;
        const earlyBy = deadline - (rowIdx + 1);
        if (earlyBy > 0) {
          addFlag(item.name, `⏫+${earlyBy}`);
        }
      }
    }

    // 4. Overflow to non-deferrable timed items (accelerate beyond fixed rate)
    for (const item of fixedTimedItems) {
      if (remaining <= 0.005) break;
      if (done.has(item.name)) continue;
      if (!depsReady(item)) continue;

      const spent = fundItem(item, remaining, assignments);
      remaining = round2(remaining - spent);

      if (done.has(item.name)) {
        const deadline = deadlines.get(item.name)!;
        const earlyBy = deadline - (rowIdx + 1);
        if (earlyBy > 0) {
          addFlag(item.name, `⏫+${earlyBy}`);
        }
      }
    }

    // 5. True leftover
    if (remaining > 0.005) {
      assignments.push({
        category: "Unallocated",
        amount: round2(remaining),
        funded: false,
        runningTotal: round2(remaining),
        flags: "",
      });
    }

    // Apply collected flags to assignments
    const flagged = assignments.map((a) => {
      const f = itemFlags.get(a.category);
      return f ? { ...a, flags: f.join("") } : a;
    });

    return { period: row.period, takeHome, expensesPortion, discretionary, assignments: flagged };
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
