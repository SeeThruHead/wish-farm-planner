/**
 * Terminal output rendering for the wish farm plan.
 * Every render function has a corresponding JSON serializer.
 */
import Table from "cli-table3";
import type {
  WishFarmPlan,
  WishPlan,
  WishItem,
  IncomeProfile,
  PaycheckPlan,
  PaycheckAllocation,
  CategoryAssignment,
} from "../domain/types";

const money = (n: number): string =>
  n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const months = (n: number): string =>
  n === Infinity ? "never" : n === 1 ? "1 month" : `${n} months`;

const dateStr = (d: Date): string =>
  d.getFullYear() > 9000 ? "never" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short" });

// ═══════════════════════════════════════════════════════
// Income Summary
// ═══════════════════════════════════════════════════════

export const renderIncomeSummary = (income: IncomeProfile): string => {
  const t = new Table({ style: { head: [], border: [] } });
  t.push(
    [{ colSpan: 2, content: "Income Summary", hAlign: "center" }],
    ["Monthly Take-Home (after RRSP)", `$${money(income.monthlyNetPay)}`],
    ["Monthly Expenses", `-$${money(income.monthlyExpenses)}`],
    ["Monthly Discretionary", `$${money(income.monthlyDiscretionary)}`],
    ["Annual Discretionary", `$${money(income.annualDiscretionary)}`],
  );
  return t.toString();
};

// ═══════════════════════════════════════════════════════
// Summary Plan (monthly allocation)
// ═══════════════════════════════════════════════════════

export const renderWishTable = (plan: WishFarmPlan): string => {
  const t = new Table({
    head: ["Item", "Cost", "$/month", "Months", "Target"],
    style: { head: [], border: [] },
    colAligns: ["left", "right", "right", "right", "right"],
  });
  for (const w of plan.wishes) {
    t.push([
      w.item.name,
      `$${money(w.item.cost)}`,
      `$${money(w.monthlyAllocation)}`,
      months(w.monthsToSave),
      dateStr(w.targetDate),
    ]);
  }
  t.push(
    [],
    [{ colSpan: 2, content: "Total Monthly Saving" }, { colSpan: 3, content: `$${money(plan.totalMonthlyWishSaving)}` }],
    [{ colSpan: 2, content: "Unallocated Monthly" }, { colSpan: 3, content: `$${money(plan.unallocatedMonthly)}` }],
  );
  return t.toString();
};

export const renderFullReport = (plan: WishFarmPlan): string =>
  renderIncomeSummary(plan.income) + "\n\n" + renderWishTable(plan);

// ═══════════════════════════════════════════════════════
// Paycheck Plan (per-paycheck allocation table)
// ═══════════════════════════════════════════════════════

const assignmentCell = (a: CategoryAssignment): string => {
  const check = a.funded ? " ✓" : "";
  const icons = a.flags ? ` ${a.flags}` : "";
  return `$${money(a.amount)} → ${a.category}${check}${icons}`;
};

// Keep the old function name for tests that import it
export const assignmentStr = assignmentCell;

/** Render a legend showing which items are timed vs sequential. */
const renderLegend = (wishes: readonly WishItem[]): string => {
  const timed = wishes.filter((w) => w.months !== undefined);
  const sequential = wishes.filter((w) => w.months === undefined);

  const afterTag = (w: WishItem) =>
    w.after && w.after.length > 0 ? `  [after: ${w.after.join(", ")}]` : "";
  const deferrableTag = (w: WishItem) =>
    w.deferrable === false ? "  (locked)" : "";

  const t = new Table({ style: { head: [], border: [] } });
  t.push([{ colSpan: 4, content: "Allocation Strategy", hAlign: "center" }]);

  if (timed.length > 0) {
    t.push([{ colSpan: 4, content: "Timed", hAlign: "left" }]);
    for (const w of timed) {
      t.push([
        `  ${w.name}`,
        `$${money(w.cost)}`,
        `${w.months}mo ($${money(w.cost / w.months!)}/mo)`,
        `${deferrableTag(w)}${afterTag(w)}`.trim() || "",
      ]);
    }
  }
  if (sequential.length > 0) {
    t.push([{ colSpan: 4, content: "Sequential", hAlign: "left" }]);
    for (const w of sequential) {
      t.push([
        `  ${w.name}`,
        `$${money(w.cost)}`,
        "",
        afterTag(w).trim() || "",
      ]);
    }
  }
  return t.toString();
};

const iconLegend = (): string => {
  const t = new Table({
    style: { head: [], border: [] },
    colAligns: ["center", "left"],
  });
  t.push(
    ["⚡", "prioritized over timed — no deadline impact"],
    ["🔓", "dependency met, now active"],
    ["⏩", "was deferred, catching up"],
    ["🔒", "locked rate (non-deferrable)"],
    ["⏸", "paused — timed deadline needs budget"],
  );
  return t.toString();
};

export const renderPaycheckTable = (plan: PaycheckPlan): string => {
  // Find the max number of assignment slots across all paychecks
  const maxSlots = Math.max(...plan.paychecks.map((pc) => pc.assignments.length));

  const head = ["#", ...Array.from({ length: maxSlots }, (_, i) => `Slot ${i + 1}`)];
  const colAligns: Array<"left" | "right" | "center"> = ["right", ...Array.from({ length: maxSlots }, () => "left" as const)];

  const t = new Table({
    head,
    style: { head: [], border: [] },
    colAligns,
  });

  for (const pc of plan.paychecks) {
    const cells: string[] = [String(pc.period)];
    for (let i = 0; i < maxSlots; i++) {
      cells.push(i < pc.assignments.length ? assignmentCell(pc.assignments[i]) : "");
    }
    t.push(cells);
  }

  // Funding timeline
  const timelineTable = new Table({ style: { head: [], border: [] } });
  timelineTable.push([{ colSpan: 2, content: "Funding Timeline", hAlign: "center" }]);
  const seen = new Set<string>();
  for (const pc of plan.paychecks) {
    for (const a of pc.assignments) {
      if (a.funded && !seen.has(a.category)) {
        seen.add(a.category);
        timelineTable.push([`✓ ${a.category}`, `paycheck #${pc.period}`]);
      }
    }
  }
  for (const w of plan.wishes) {
    if (!seen.has(w.name)) {
      timelineTable.push([`✗ ${w.name}`, "not funded this year"]);
    }
  }

  // Year-end summary
  const totalSpent = plan.wishes
    .filter((w) => seen.has(w.name))
    .reduce((sum, w) => sum + w.cost, 0);
  const totalDiscretionary = plan.paychecks.reduce((sum, pc) => sum + pc.discretionary, 0);
  const remaining = totalDiscretionary - totalSpent;

  const summaryTable = new Table({ style: { head: [], border: [] } });
  summaryTable.push(
    [{ colSpan: 2, content: "Year-End Summary", hAlign: "center" }],
    ["Total Discretionary", `$${money(totalDiscretionary)}`],
    ["Total Wish Spending", `-$${money(totalSpent)}`],
    ["Remaining Cash", `$${money(remaining)}`],
  );

  return [
    renderIncomeSummary(plan.income),
    "",
    summaryTable.toString(),
    "",
    renderLegend(plan.wishes),
    "",
    iconLegend(),
    "",
    t.toString(),
    "",
    timelineTable.toString(),
  ].join("\n");
};

// ═══════════════════════════════════════════════════════
// JSON output — every mode
// ═══════════════════════════════════════════════════════

export const summaryPlanToJson = (plan: WishFarmPlan): object => ({
  income: plan.income,
  wishes: plan.wishes.map((w) => ({
    name: w.item.name,
    cost: w.item.cost,
    priority: w.item.priority,
    monthlyAllocation: w.monthlyAllocation,
    monthsToSave: w.monthsToSave === Infinity ? null : w.monthsToSave,
    targetDate: w.targetDate.getFullYear() > 9000 ? null : w.targetDate.toISOString(),
  })),
  totalMonthlyWishSaving: plan.totalMonthlyWishSaving,
  unallocatedMonthly: plan.unallocatedMonthly,
});

export const paycheckPlanToJson = (plan: PaycheckPlan): object => ({
  income: plan.income,
  wishes: plan.wishes.map((w) => ({
    name: w.name, cost: w.cost, priority: w.priority,
    ...(w.months !== undefined ? { months: w.months } : {}),
    ...(w.deferrable !== undefined ? { deferrable: w.deferrable } : {}),
    ...(w.after && w.after.length > 0 ? { after: w.after } : {}),
    strategy: w.months !== undefined ? "timed" : "sequential",
  })),
  paychecks: plan.paychecks.map((pc) => ({
    period: pc.period,
    takeHome: pc.takeHome,
    expensesPortion: pc.expensesPortion,
    discretionary: pc.discretionary,
    assignments: pc.assignments.map((a) => ({
      category: a.category,
      amount: a.amount,
      funded: a.funded,
      runningTotal: a.runningTotal,
      ...(a.flags ? { flags: a.flags } : {}),
    })),
  })),
});

export const renderJson = (data: object): string => JSON.stringify(data, null, 2);
