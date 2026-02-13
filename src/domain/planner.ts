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

export const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** Build income profile from a static discretionary amount per period. */
export const buildIncomeProfileStatic = (
  discretionaryPerPeriod: number,
  monthlyExpenses: number,
  periodsPerYear: number,
): IncomeProfile => {
  const ppm = periodsPerYear / 12;
  const monthlyDiscretionary = round2(discretionaryPerPeriod * ppm);
  const monthlyNetPay = round2(monthlyDiscretionary + monthlyExpenses);
  return {
    monthlyNetPay,
    monthlyExpenses,
    monthlyDiscretionary,
    annualDiscretionary: round2(monthlyDiscretionary * 12),
  };
};

/** Generate synthetic per-paycheck rows from a static discretionary amount. */
export const buildStaticRows = (
  discretionaryPerPeriod: number,
  monthlyExpenses: number,
  periodsPerYear: number,
): readonly CraPayPeriodRow[] => {
  const ppm = periodsPerYear / 12;
  const expensesPortion = round2(monthlyExpenses / ppm);
  const netPay = round2(discretionaryPerPeriod + expensesPortion);
  return Array.from({ length: periodsPerYear }, (_, i) => ({
    period: i + 1,
    grossIncome: netPay,
    rrspMatched: 0,
    rrspUnmatched: 0,
    rrspEmployer: 0,
    federalTax: 0,
    provincialTax: 0,
    cpp: 0,
    cpp2: 0,
    ei: 0,
    totalDeductions: 0,
    netPay,
    cumulativeCpp: 0,
    cumulativeCpp2: 0,
    cumulativeEi: 0,
  }));
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
 * Internal allocation state threaded through the fold over paychecks.
 * Encapsulates all mutable tracking that was previously closed-over variables.
 */
interface AllocationState {
  readonly saved: ReadonlyMap<string, number>;
  readonly done: ReadonlySet<string>;
  readonly firstContrib: ReadonlySet<string>;
  readonly currentSeqIdx: number;
}

const initState = (items: readonly WishItem[]): AllocationState => ({
  saved: new Map(items.map((i) => [i.name, 0])),
  done: new Set(),
  firstContrib: new Set(),
  currentSeqIdx: 0,
});

/** Check if all deps for an item are funded. */
const depsReady = (item: WishItem, done: ReadonlySet<string>): boolean =>
  !item.after || item.after.length === 0 || item.after.every((dep) => done.has(dep));

/** Pre-computed per-paycheck discretionary amounts. */
const computeDiscretionaries = (
  rows: readonly CraPayPeriodRow[],
  expensesPortion: number,
): readonly number[] =>
  rows.map((row) =>
    round2(Math.max(0, row.netPay - row.rrspMatched - row.rrspUnmatched - expensesPortion)),
  );

/** Check if deferrable timed items can still be funded given budget committed so far. */
const timedFeasible = (
  deferrableTimedItems: readonly WishItem[],
  fixedTimedItems: readonly WishItem[],
  saved: ReadonlyMap<string, number>,
  done: ReadonlySet<string>,
  discretionaries: readonly number[],
  fromPaycheck: number,
  reservedThisPaycheck: number,
): boolean => {
  let totalNeeded = 0;
  for (const item of deferrableTimedItems) {
    if (done.has(item.name)) continue;
    const remaining = item.cost - saved.get(item.name)!;
    if (remaining > 0) totalNeeded += remaining;
  }

  let available = Math.max(0, discretionaries[fromPaycheck] - reservedThisPaycheck);
  for (let i = fromPaycheck + 1; i < discretionaries.length; i++) {
    available += discretionaries[i];
  }

  // Subtract future fixed timed obligations
  for (const item of fixedTimedItems) {
    if (done.has(item.name)) continue;
    const remaining = item.cost - saved.get(item.name)!;
    if (remaining > 0) available -= remaining;
  }

  return available >= totalNeeded - 0.01;
};

/** Merge an assignment into the list, combining if same category already present. */
const mergeOrPush = (
  assignments: CategoryAssignment[],
  category: string,
  amount: number,
  funded: boolean,
  runningTotal: number,
): void => {
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

/** Fund an item up to maxAmount. Returns amount spent and updated state fields. */
const fundItem = (
  item: WishItem,
  maxAmount: number,
  saved: ReadonlyMap<string, number>,
  done: ReadonlySet<string>,
  assignments: CategoryAssignment[],
): { spent: number; newSaved: number; funded: boolean } => {
  const alreadySaved = saved.get(item.name)!;
  const needed = round2(item.cost - alreadySaved);
  if (needed <= 0) {
    return { spent: 0, newSaved: alreadySaved, funded: true };
  }

  const amount = round2(Math.min(maxAmount, needed));
  const newTotal = round2(alreadySaved + amount);
  const funded = newTotal >= item.cost - 0.005;

  mergeOrPush(assignments, item.name, amount, funded, newTotal);
  return { spent: amount, newSaved: newTotal, funded };
};

/** Apply flag strings to assignments based on collected flags map. */
const applyFlags = (
  assignments: readonly CategoryAssignment[],
  itemFlags: ReadonlyMap<string, string[]>,
): CategoryAssignment[] =>
  assignments.map((a) => {
    const f = itemFlags.get(a.category);
    return f ? { ...a, flags: f.join("") } : a;
  });

/** Allocate a single paycheck, returning the allocation and updated state. */
const allocateSinglePaycheck = (
  state: AllocationState,
  row: CraPayPeriodRow,
  rowIdx: number,
  config: {
    readonly expensesPortion: number;
    readonly timedItems: readonly WishItem[];
    readonly sequentialItems: readonly WishItem[];
    readonly fixedTimedItems: readonly WishItem[];
    readonly deferrableTimedItems: readonly WishItem[];
    readonly fixedPerPaycheck: ReadonlyMap<string, number>;
    readonly deadlines: ReadonlyMap<string, number>;
    readonly discretionaries: readonly number[];
  },
): { allocation: PaycheckAllocation; nextState: AllocationState } => {
  const {
    expensesPortion, sequentialItems, fixedTimedItems,
    deferrableTimedItems, fixedPerPaycheck, deadlines, discretionaries,
  } = config;

  // Shallow-copy state for this paycheck's mutations
  const saved = new Map(state.saved);
  const done = new Set(state.done);
  const firstContrib = new Set(state.firstContrib);
  let currentSeqIdx = state.currentSeqIdx;

  const takeHome = round2(row.netPay - row.rrspMatched - row.rrspUnmatched);
  const discretionary = round2(takeHome - expensesPortion);
  const assignments: CategoryAssignment[] = [];
  const itemFlags = new Map<string, string[]>();
  const addFlag = (name: string, flag: string) => {
    if (!itemFlags.has(name)) itemFlags.set(name, []);
    itemFlags.get(name)!.push(flag);
  };

  let remaining = Math.max(0, discretionary);

  // 1. Non-deferrable timed items get their fixed slice first
  for (const item of fixedTimedItems) {
    if (done.has(item.name) || !depsReady(item, done) || remaining <= 0.005) continue;

    if (!firstContrib.has(item.name)) {
      firstContrib.add(item.name);
      addFlag(item.name, "🔒");
    }

    const perPaycheck = fixedPerPaycheck.get(item.name)!;
    const cap = Math.min(perPaycheck, item.cost - saved.get(item.name)!);
    const { spent, newSaved, funded } = fundItem(item, Math.min(remaining, round2(cap)), saved, done, assignments);
    saved.set(item.name, newSaved);
    if (funded) done.add(item.name);
    remaining = round2(remaining - spent);
  }

  // 2. Sequential items
  let seqSpent = 0;
  let idx = currentSeqIdx;
  const seqFundedThisPay: string[] = [];
  while (remaining > 0.005 && idx < sequentialItems.length) {
    const item = sequentialItems[idx];

    if (!depsReady(item, done)) { idx++; continue; }

    const needed = round2(item.cost - saved.get(item.name)!);
    if (needed <= 0) {
      idx++;
      if (idx > currentSeqIdx) currentSeqIdx = idx;
      continue;
    }

    const wouldSpend = round2(Math.min(remaining, needed));
    if (!timedFeasible(deferrableTimedItems, fixedTimedItems, saved, done, discretionaries, rowIdx, seqSpent + wouldSpend)) {
      addFlag(item.name, "⏸");
      break;
    }

    if (!firstContrib.has(item.name)) {
      firstContrib.add(item.name);
      if (item.after && item.after.length > 0) addFlag(item.name, "🔓");
    }

    const { spent, newSaved, funded } = fundItem(item, wouldSpend, saved, done, assignments);
    saved.set(item.name, newSaved);
    if (funded) done.add(item.name);
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
    const deferredTimed = deferrableTimedItems.filter((t) => !done.has(t.name) && depsReady(t, done));
    if (deferredTimed.length > 0) {
      for (const name of seqFundedThisPay) addFlag(name, "⚡");
    }
  }

  // 3. Remaining goes to deferrable timed items
  for (const item of deferrableTimedItems) {
    if (remaining <= 0.005 || done.has(item.name) || !depsReady(item, done)) continue;

    if (!firstContrib.has(item.name)) {
      firstContrib.add(item.name);
      if (item.after && item.after.length > 0) addFlag(item.name, "🔓");
      const deadline = deadlines.get(item.name)!;
      const behindBy = round2(item.cost * (rowIdx + 1) / deadline - saved.get(item.name)!);
      if (behindBy > 0.01) addFlag(item.name, "⏩");
    }

    const { spent, newSaved, funded } = fundItem(item, remaining, saved, done, assignments);
    saved.set(item.name, newSaved);
    if (funded) done.add(item.name);
    remaining = round2(remaining - spent);
  }

  // 4. Overflow to non-deferrable timed items (accelerate)
  for (const item of fixedTimedItems) {
    if (remaining <= 0.005 || done.has(item.name) || !depsReady(item, done)) continue;

    const { spent, newSaved, funded } = fundItem(item, remaining, saved, done, assignments);
    saved.set(item.name, newSaved);
    if (funded) done.add(item.name);
    remaining = round2(remaining - spent);
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

  return {
    allocation: {
      period: row.period,
      takeHome,
      expensesPortion,
      discretionary,
      assignments: applyFlags(assignments, itemFlags),
    },
    nextState: { saved, done, firstContrib, currentSeqIdx },
  };
};

/**
 * Hybrid allocation: sequential items first, timed items use slack.
 *
 * Uses a fold over paycheck rows, threading AllocationState through each step.
 */
export const allocatePaychecks = (
  rows: readonly CraPayPeriodRow[],
  monthlyExpenses: number,
  items: readonly WishItem[],
  ppm: number,
): PaycheckPlan => {
  const sorted = sortByPriority(items);
  const income = buildIncomeProfileFromRows(rows, monthlyExpenses);
  const expensesPortion = round2(monthlyExpenses / ppm);

  const timedItems = sorted.filter((i) => i.months !== undefined);
  const sequentialItems = sorted.filter((i) => i.months === undefined);
  const fixedTimedItems = timedItems.filter((i) => i.deferrable === false);
  const deferrableTimedItems = timedItems.filter((i) => i.deferrable !== false);

  const deadlines = new Map(timedItems.map((i) => [i.name, Math.ceil(i.months! * ppm)]));
  const fixedPerPaycheck = new Map(
    fixedTimedItems.map((i) => [i.name, round2(i.cost / (i.months! * ppm))]),
  );
  const discretionaries = computeDiscretionaries(rows, expensesPortion);

  const config = {
    expensesPortion, timedItems, sequentialItems, fixedTimedItems,
    deferrableTimedItems, fixedPerPaycheck, deadlines, discretionaries,
  };

  const { paychecks } = rows.reduce(
    (acc, row, idx) => {
      const { allocation, nextState } = allocateSinglePaycheck(acc.state, row, idx, config);
      return { state: nextState, paychecks: [...acc.paychecks, allocation] };
    },
    { state: initState(sorted), paychecks: [] as PaycheckAllocation[] },
  );

  return { income, paychecks, wishes: sorted };
};

/**
 * Determine how many pay periods fall in each month for a given pay period type.
 */
export const periodsPerMonth = (payPeriod: string): number => {
  if (payPeriod.includes("Semi-monthly")) return 2;
  if (payPeriod.startsWith("Monthly")) return 1;
  if (payPeriod.includes("Biweekly")) return 26 / 12;
  if (payPeriod.includes("Weekly")) return 52 / 12;
  if (payPeriod.includes("Daily")) return 240 / 12;
  const match = payPeriod.match(/(\d+)\s+pay periods/);
  return match ? parseInt(match[1], 10) / 12 : 2;
};
