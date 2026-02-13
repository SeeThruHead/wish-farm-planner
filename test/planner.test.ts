import { describe, test, expect } from "bun:test";
import {
  buildIncomeProfile,
  buildIncomeProfileFromRows,
  allocateSequential,
  allocateProportional,
  allocatePaychecks,
  sortByPriority,
  periodsPerMonth,
} from "../src/domain/planner";
import type { CraPayrollAverages, CraPayPeriodRow, WishItem, IncomeProfile } from "../src/domain/types";

// ── Fixtures ────────────────────────────────────────────

const AVERAGES: CraPayrollAverages = {
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
};

const ITEMS: WishItem[] = [
  { name: "Mac Studio", cost: 2999, priority: 1 },
  { name: "DAC/Amp", cost: 899, priority: 2 },
  { name: "Headphones", cost: 1599, priority: 3 },
  { name: "Motorcycle", cost: 12000, priority: 4 },
];

/** Create N identical paycheck rows for testing. */
const makeRows = (n: number, overrides: Partial<CraPayPeriodRow> = {}): CraPayPeriodRow[] =>
  Array.from({ length: n }, (_, i) => ({
    period: i + 1,
    grossIncome: 10958.33,
    rrspMatched: 438.33,
    rrspUnmatched: 0,
    rrspEmployer: 438.33,
    federalTax: 2232.82,
    provincialTax: 1431.13,
    cpp: 669.42,
    cpp2: 0,
    ei: 178.62,
    totalDeductions: 4511.99,
    netPay: 6446.34,
    cumulativeCpp: 669.42 * (i + 1),
    cumulativeCpp2: 0,
    cumulativeEi: 178.62 * (i + 1),
    ...overrides,
  }));

// ── buildIncomeProfile ──────────────────────────────────

describe("buildIncomeProfile", () => {
  test("computes monthly net pay after RRSP", () => {
    const profile = buildIncomeProfile(AVERAGES, 3500);
    expect(profile.monthlyNetPay).toBeCloseTo(5975.93, 2);
  });

  test("computes discretionary income", () => {
    const profile = buildIncomeProfile(AVERAGES, 3500);
    expect(profile.monthlyDiscretionary).toBeCloseTo(5975.93 - 3500, 2);
  });

  test("annual discretionary is 12x monthly", () => {
    const profile = buildIncomeProfile(AVERAGES, 3500);
    expect(profile.annualDiscretionary).toBeCloseTo(profile.monthlyDiscretionary * 12, 2);
  });

  test("negative discretionary when expenses exceed income", () => {
    const profile = buildIncomeProfile(AVERAGES, 7000);
    expect(profile.monthlyDiscretionary).toBeLessThan(0);
  });

  test("includes unmatched RRSP in deduction", () => {
    const withUnmatched = { ...AVERAGES, rrspUnmatched: 200 };
    const profile = buildIncomeProfile(withUnmatched, 3500);
    expect(profile.monthlyNetPay).toBeCloseTo(6309.27 - 333.34 - 200, 2);
  });
});

// ── buildIncomeProfileFromRows ──────────────────────────

describe("buildIncomeProfileFromRows", () => {
  test("computes from per-paycheck rows", () => {
    const rows = makeRows(24);
    const profile = buildIncomeProfileFromRows(rows, 3500);
    const expectedMonthly = (6446.34 - 438.33) * 24 / 12;
    expect(profile.monthlyNetPay).toBeCloseTo(expectedMonthly, 0);
  });

  test("handles varying take-home (CPP/EI maxout)", () => {
    const rows = [
      ...makeRows(18, { netPay: 6000 }),
      ...makeRows(6, { netPay: 7000 }),
    ].map((r, i) => ({ ...r, period: i + 1 }));
    const profile = buildIncomeProfileFromRows(rows, 3000);
    // (18 * (6000 - 438.33) + 6 * (7000 - 438.33)) / 12
    const annualTakeHome = 18 * (6000 - 438.33) + 6 * (7000 - 438.33);
    expect(profile.monthlyNetPay).toBeCloseTo(annualTakeHome / 12, 0);
  });
});

// ── sortByPriority ──────────────────────────────────────

describe("sortByPriority", () => {
  test("sorts by priority ascending", () => {
    const shuffled = [ITEMS[2], ITEMS[0], ITEMS[3], ITEMS[1]];
    const sorted = sortByPriority(shuffled);
    expect(sorted[0].name).toBe("Mac Studio");
    expect(sorted[3].name).toBe("Motorcycle");
  });

  test("does not mutate original array", () => {
    const original = [ITEMS[2], ITEMS[0]];
    sortByPriority(original);
    expect(original[0].name).toBe("Headphones");
  });
});

// ── allocateSequential ──────────────────────────────────

describe("allocateSequential", () => {
  const income: IncomeProfile = {
    monthlyNetPay: 5975.93,
    monthlyExpenses: 3500,
    monthlyDiscretionary: 2475.93,
    annualDiscretionary: 29711.16,
  };

  test("all items get the full monthly discretionary", () => {
    const plan = allocateSequential(income, ITEMS);
    for (const w of plan.wishes) {
      expect(w.monthlyAllocation).toBe(income.monthlyDiscretionary);
    }
  });

  test("items are ordered by priority", () => {
    const plan = allocateSequential(income, ITEMS);
    expect(plan.wishes[0].item.name).toBe("Mac Studio");
    expect(plan.wishes[3].item.name).toBe("Motorcycle");
  });

  test("months to save is correct", () => {
    const plan = allocateSequential(income, ITEMS);
    expect(plan.wishes[0].monthsToSave).toBe(2);
    expect(plan.wishes[1].monthsToSave).toBe(1);
  });

  test("target dates are cumulative", () => {
    const plan = allocateSequential(income, ITEMS);
    for (let i = 1; i < plan.wishes.length; i++) {
      expect(plan.wishes[i].targetDate.getTime()).toBeGreaterThan(
        plan.wishes[i - 1].targetDate.getTime(),
      );
    }
  });

  test("handles zero discretionary income", () => {
    const broke: IncomeProfile = { ...income, monthlyDiscretionary: 0, annualDiscretionary: 0 };
    const plan = allocateSequential(broke, ITEMS);
    for (const w of plan.wishes) {
      expect(w.monthlyAllocation).toBe(0);
      expect(w.monthsToSave).toBe(Infinity);
    }
  });

  test("handles empty wish list", () => {
    const plan = allocateSequential(income, []);
    expect(plan.wishes).toHaveLength(0);
    expect(plan.totalMonthlyWishSaving).toBe(income.monthlyDiscretionary);
  });
});

// ── allocateProportional ────────────────────────────────

describe("allocateProportional", () => {
  const income: IncomeProfile = {
    monthlyNetPay: 5975.93,
    monthlyExpenses: 3500,
    monthlyDiscretionary: 2475.93,
    annualDiscretionary: 29711.16,
  };

  test("higher priority items get more allocation", () => {
    const plan = allocateProportional(income, ITEMS);
    expect(plan.wishes[0].monthlyAllocation).toBeGreaterThan(plan.wishes[3].monthlyAllocation);
  });

  test("total allocation roughly equals discretionary", () => {
    const plan = allocateProportional(income, ITEMS);
    expect(plan.totalMonthlyWishSaving + plan.unallocatedMonthly).toBeCloseTo(
      income.monthlyDiscretionary, 0,
    );
  });

  test("single item gets full discretionary", () => {
    const plan = allocateProportional(income, [ITEMS[0]]);
    expect(plan.wishes[0].monthlyAllocation).toBeCloseTo(income.monthlyDiscretionary, 0);
  });
});

// ── allocatePaychecks ───────────────────────────────────

describe("allocatePaychecks", () => {
  test("fills items sequentially across paychecks", () => {
    const rows = makeRows(24);
    const plan = allocatePaychecks(rows, 5000, ITEMS, 2);

    // First paycheck should start funding Mac Studio
    const first = plan.paychecks[0];
    expect(first.assignments[0].category).toBe("Mac Studio");
  });

  test("rollovers work — leftover goes to next item in same paycheck", () => {
    const rows = makeRows(24);
    const plan = allocatePaychecks(rows, 2000, ITEMS, 2);

    // With ~4500 discretionary per paycheck and Mac Studio costing 2999,
    // the first paycheck should fund Mac Studio and start DAC/Amp
    const first = plan.paychecks[0];
    const macStudio = first.assignments.find((a) => a.category === "Mac Studio");
    expect(macStudio).toBeTruthy();
    expect(macStudio!.funded).toBe(true);

    // Should have started the next item
    expect(first.assignments.length).toBeGreaterThan(1);
  });

  test("all items eventually get funded if enough income", () => {
    const rows = makeRows(24);
    const plan = allocatePaychecks(rows, 2000, ITEMS, 2);

    const fundedItems = new Set<string>();
    for (const pc of plan.paychecks) {
      for (const a of pc.assignments) {
        if (a.funded) fundedItems.add(a.category);
      }
    }

    for (const item of ITEMS) {
      expect(fundedItems.has(item.name)).toBe(true);
    }
  });

  test("running totals accumulate correctly", () => {
    const rows = makeRows(24);
    const plan = allocatePaychecks(rows, 5000, [{ name: "Bike", cost: 10000, priority: 1 }], 2);

    let lastTotal = 0;
    for (const pc of plan.paychecks) {
      const bikeAlloc = pc.assignments.find((a) => a.category === "Bike");
      if (bikeAlloc) {
        expect(bikeAlloc.runningTotal).toBeGreaterThanOrEqual(lastTotal);
        lastTotal = bikeAlloc.runningTotal;
      }
    }
    // Eventually funded
    expect(lastTotal).toBeGreaterThanOrEqual(10000 - 1);
  });

  test("unallocated appears after all items funded", () => {
    // Small items, big income
    const rows = makeRows(24);
    const smallItems = [{ name: "Cable", cost: 50, priority: 1 }];
    const plan = allocatePaychecks(rows, 2000, smallItems, 2);

    // First paycheck funds Cable, rest is unallocated
    const first = plan.paychecks[0];
    expect(first.assignments.some((a) => a.category === "Unallocated")).toBe(true);

    // All subsequent paychecks are fully unallocated
    for (const pc of plan.paychecks.slice(1)) {
      expect(pc.assignments.length).toBe(1);
      expect(pc.assignments[0].category).toBe("Unallocated");
    }
  });

  test("handles zero discretionary (expenses >= take home)", () => {
    const rows = makeRows(4);
    const plan = allocatePaychecks(rows, 20000, ITEMS, 2);

    // No discretionary, nothing allocated to wishes
    for (const pc of plan.paychecks) {
      const wishAssignments = pc.assignments.filter((a) => a.category !== "Unallocated");
      expect(wishAssignments).toHaveLength(0);
    }
  });

  test("expenses portion is monthly / periods-per-month", () => {
    const rows = makeRows(24);
    const plan = allocatePaychecks(rows, 6000, ITEMS, 2);
    expect(plan.paychecks[0].expensesPortion).toBe(3000);
  });

  test("overflow from sequential accelerates timed items", () => {
    const rows = makeRows(24);
    const items: WishItem[] = [
      { name: "Big Timed", cost: 20000, priority: 1, months: 12 },
      { name: "Small Sequential", cost: 100, priority: 2 },
    ];
    const plan = allocatePaychecks(rows, 2000, items, 2);

    // First paycheck: timed gets its slice, sequential gets funded, overflow goes to timed
    const first = plan.paychecks[0];
    const timedAssignment = first.assignments.find((a) => a.category === "Big Timed");
    const seqAssignment = first.assignments.find((a) => a.category === "Small Sequential");

    expect(seqAssignment).toBeTruthy();
    expect(seqAssignment!.funded).toBe(true);

    // Timed item should have gotten MORE than its base allocation (overflow)
    const basePerPaycheck = 20000 / (12 * 2); // ~833.33
    expect(timedAssignment!.amount).toBeGreaterThan(basePerPaycheck);
  });

  test("no Unallocated while timed items remain unfunded", () => {
    const rows = makeRows(24);
    // Cost high enough that it won't be fully funded by overflow alone
    const items: WishItem[] = [
      { name: "Timed Only", cost: 100000, priority: 1, months: 12 },
    ];
    const plan = allocatePaychecks(rows, 2000, items, 2);

    for (const pc of plan.paychecks) {
      const timedAssignment = pc.assignments.find((a) => a.category === "Timed Only");
      const hasUnallocated = pc.assignments.find((a) => a.category === "Unallocated");
      // If timed item is still unfunded, there should be no Unallocated
      if (timedAssignment && !timedAssignment.funded) {
        expect(hasUnallocated).toBeUndefined();
      }
    }
  });
});

// ── periodsPerMonth ─────────────────────────────────────

describe("periodsPerMonth", () => {
  test("semi-monthly is 2", () => {
    expect(periodsPerMonth("Semi-monthly (24 pay periods a year)")).toBe(2);
  });

  test("monthly is 1", () => {
    expect(periodsPerMonth("Monthly (12 pay periods a year)")).toBe(1);
  });

  test("biweekly is ~2.17", () => {
    expect(periodsPerMonth("Biweekly (26 pay periods a year)")).toBeCloseTo(26 / 12, 2);
  });

  test("weekly is ~4.33", () => {
    expect(periodsPerMonth("Weekly (52 pay periods a year)")).toBeCloseTo(52 / 12, 2);
  });
});
