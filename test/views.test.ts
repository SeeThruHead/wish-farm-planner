import { describe, test, expect } from "bun:test";
import {
  renderIncomeSummary,
  renderWishTable,
  renderFullReport,
  renderPaycheckTable,
  renderJson,
  summaryPlanToJson,
  paycheckPlanToJson,
} from "../src/cli/views";
import type {
  WishFarmPlan,
  IncomeProfile,
  WishPlan,
  PaycheckPlan,
  PaycheckAllocation,
} from "../src/domain/types";

const INCOME: IncomeProfile = {
  monthlyNetPay: 5975.93,
  monthlyExpenses: 3500,
  monthlyDiscretionary: 2475.93,
  annualDiscretionary: 29711.16,
};

const WISHES: WishPlan[] = [
  {
    item: { name: "Mac Studio", cost: 2999, priority: 1 },
    monthlyAllocation: 2475.93,
    monthsToSave: 2,
    targetDate: new Date(2026, 3, 1),
  },
  {
    item: { name: "DAC/Amp", cost: 899, priority: 2 },
    monthlyAllocation: 2475.93,
    monthsToSave: 1,
    targetDate: new Date(2026, 4, 1),
  },
];

const PLAN: WishFarmPlan = {
  income: INCOME,
  wishes: WISHES,
  totalMonthlyWishSaving: 2475.93,
  unallocatedMonthly: 0,
};

const PAYCHECK_PLAN: PaycheckPlan = {
  income: INCOME,
  wishes: [
    { name: "Mac Studio", cost: 2999, priority: 1 },
    { name: "DAC/Amp", cost: 899, priority: 2 },
  ],
  paychecks: [
    {
      period: 1,
      takeHome: 6008.01,
      expensesPortion: 2500,
      discretionary: 3508.01,
      assignments: [
        { category: "Mac Studio", amount: 2999, funded: true, runningTotal: 2999 },
        { category: "DAC/Amp", amount: 509.01, funded: false, runningTotal: 509.01 },
      ],
      notes: [],
    },
    {
      period: 2,
      takeHome: 6008.01,
      expensesPortion: 2500,
      discretionary: 3508.01,
      assignments: [
        { category: "DAC/Amp", amount: 389.99, funded: true, runningTotal: 899 },
        { category: "Unallocated", amount: 3118.02, funded: false, runningTotal: 3118.02 },
      ],
      notes: [],
    },
  ],
};

// ── Summary views ───────────────────────────────────────

describe("renderIncomeSummary", () => {
  test("shows monthly take-home", () => {
    expect(renderIncomeSummary(INCOME)).toContain("5,975.93");
  });

  test("shows discretionary income", () => {
    expect(renderIncomeSummary(INCOME)).toContain("2,475.93");
  });
});

describe("renderWishTable", () => {
  test("shows all wish items", () => {
    const output = renderWishTable(PLAN);
    expect(output).toContain("Mac Studio");
    expect(output).toContain("DAC/Amp");
  });

  test("shows months to save", () => {
    const output = renderWishTable(PLAN);
    expect(output).toContain("2 months");
    expect(output).toContain("1 month");
  });
});

describe("renderFullReport", () => {
  test("includes both sections", () => {
    const output = renderFullReport(PLAN);
    expect(output).toContain("Income Summary");
    expect(output).toContain("Wish Farm Plan");
  });
});

// ── Paycheck views ──────────────────────────────────────

describe("renderPaycheckTable", () => {
  test("shows paycheck numbers", () => {
    const output = renderPaycheckTable(PAYCHECK_PLAN);
    expect(output).toContain("1");
    expect(output).toContain("2");
  });

  test("shows category assignments", () => {
    const output = renderPaycheckTable(PAYCHECK_PLAN);
    expect(output).toContain("Mac Studio");
    expect(output).toContain("DAC/Amp");
  });

  test("shows funded checkmarks", () => {
    const output = renderPaycheckTable(PAYCHECK_PLAN);
    expect(output).toContain("✓");
  });

  test("shows funding timeline", () => {
    const output = renderPaycheckTable(PAYCHECK_PLAN);
    expect(output).toContain("Funding Timeline");
    expect(output).toContain("funded by paycheck #1");
    expect(output).toContain("funded by paycheck #2");
  });

  test("includes income summary", () => {
    const output = renderPaycheckTable(PAYCHECK_PLAN);
    expect(output).toContain("Income Summary");
  });
});

// ── JSON output ─────────────────────────────────────────

describe("summaryPlanToJson", () => {
  test("produces valid JSON with all fields", () => {
    const json = renderJson(summaryPlanToJson(PLAN));
    const parsed = JSON.parse(json);
    expect(parsed.income.monthlyNetPay).toBe(5975.93);
    expect(parsed.wishes).toHaveLength(2);
    expect(parsed.wishes[0].name).toBe("Mac Studio");
    expect(parsed.wishes[0].monthlyAllocation).toBe(2475.93);
    expect(parsed.wishes[0].monthsToSave).toBe(2);
    expect(parsed.wishes[0].targetDate).toContain("2026");
    expect(parsed.totalMonthlyWishSaving).toBe(2475.93);
    expect(parsed.unallocatedMonthly).toBe(0);
  });

  test("nulls out Infinity months and far-future dates", () => {
    const plan: WishFarmPlan = {
      ...PLAN,
      wishes: [
        {
          item: { name: "Dream", cost: 99999, priority: 1 },
          monthlyAllocation: 0,
          monthsToSave: Infinity,
          targetDate: new Date(9999, 11, 31),
        },
      ],
    };
    const parsed = JSON.parse(renderJson(summaryPlanToJson(plan)));
    expect(parsed.wishes[0].monthsToSave).toBeNull();
    expect(parsed.wishes[0].targetDate).toBeNull();
  });
});

describe("paycheckPlanToJson", () => {
  test("produces valid JSON with all paycheck fields", () => {
    const json = renderJson(paycheckPlanToJson(PAYCHECK_PLAN));
    const parsed = JSON.parse(json);
    expect(parsed.income.monthlyNetPay).toBe(5975.93);
    expect(parsed.wishes).toHaveLength(2);
    expect(parsed.paychecks).toHaveLength(2);
  });

  test("includes assignment details", () => {
    const parsed = JSON.parse(renderJson(paycheckPlanToJson(PAYCHECK_PLAN)));
    const first = parsed.paychecks[0];
    expect(first.period).toBe(1);
    expect(first.takeHome).toBe(6008.01);
    expect(first.assignments[0].category).toBe("Mac Studio");
    expect(first.assignments[0].amount).toBe(2999);
    expect(first.assignments[0].funded).toBe(true);
    expect(first.assignments[0].runningTotal).toBe(2999);
  });

  test("includes funded and unfunded assignments", () => {
    const parsed = JSON.parse(renderJson(paycheckPlanToJson(PAYCHECK_PLAN)));
    const second = parsed.paychecks[1];
    expect(second.assignments[0].funded).toBe(true); // DAC/Amp
    expect(second.assignments[1].funded).toBe(false); // Unallocated
  });
});
