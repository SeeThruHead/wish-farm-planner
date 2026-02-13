/**
 * Terminal output rendering for the wish farm plan.
 * Every render function has a corresponding JSON serializer.
 */
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

const line = (ch: string, w: number): string => ch.repeat(w);
const pad = (s: string, w: number): string => s.padStart(w);

const months = (n: number): string =>
  n === Infinity ? "never" : n === 1 ? "1 month" : `${n} months`;

const dateStr = (d: Date): string =>
  d.getFullYear() > 9000 ? "never" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short" });

const W = 72;

// ═══════════════════════════════════════════════════════
// Summary Plan (monthly allocation)
// ═══════════════════════════════════════════════════════

export const renderIncomeSummary = (income: IncomeProfile): string => `
Income Summary
${line("═", W)}
  Monthly Take-Home (after RRSP):   $${pad(money(income.monthlyNetPay), 10)}
  Monthly Expenses:                -$${pad(money(income.monthlyExpenses), 10)}
${line("─", W)}
  Monthly Discretionary:            $${pad(money(income.monthlyDiscretionary), 10)}
  Annual Discretionary:             $${pad(money(income.annualDiscretionary), 10)}
${line("═", W)}`;

const wishRow = (w: WishPlan): string => {
  const name = w.item.name.padEnd(24);
  const cost = ("$" + money(w.item.cost)).padStart(12);
  const alloc = ("$" + money(w.monthlyAllocation)).padStart(10);
  const time = months(w.monthsToSave).padStart(10);
  const target = dateStr(w.targetDate).padStart(10);
  return `  ${name} ${cost} ${alloc} ${time} ${target}`;
};

const summaryHeader = (): string => {
  const name = "Item".padEnd(24);
  const cost = "Cost".padStart(12);
  const alloc = "$/month".padStart(10);
  const time = "Months".padStart(10);
  const target = "Target".padStart(10);
  return `  ${name} ${cost} ${alloc} ${time} ${target}`;
};

export const renderWishTable = (plan: WishFarmPlan): string => {
  const header = summaryHeader();
  const rows = plan.wishes.map(wishRow);
  return `
Wish Farm Plan
${line("═", W)}
${header}
${line("─", W)}
${rows.join("\n")}
${line("─", W)}
  Total Monthly Saving:  $${pad(money(plan.totalMonthlyWishSaving), 10)}
  Unallocated Monthly:   $${pad(money(plan.unallocatedMonthly), 10)}
${line("═", W)}`;
};

export const renderFullReport = (plan: WishFarmPlan): string =>
  renderIncomeSummary(plan.income) + "\n" + renderWishTable(plan);

// ═══════════════════════════════════════════════════════
// Paycheck Plan (per-paycheck allocation table)
// ═══════════════════════════════════════════════════════

const assignmentStr = (a: CategoryAssignment): string => {
  const flag = a.funded ? " ✓" : "";
  return `$${money(a.amount)} → ${a.category}${flag}`;
};

/** Render a legend showing which items are timed vs sequential. */
const renderLegend = (wishes: readonly WishItem[]): string => {
  const timed = wishes.filter((w) => w.months !== undefined);
  const sequential = wishes.filter((w) => w.months === undefined);
  const lines: string[] = [];

  const afterTag = (w: WishItem) =>
    w.after && w.after.length > 0 ? `  [after: ${w.after.join(", ")}]` : "";
  const deferrableTag = (w: WishItem) =>
    w.deferrable === false ? "  (locked)" : "";

  if (timed.length > 0) {
    lines.push("  Timed:");
    for (const w of timed)
      lines.push(`    ${w.name.padEnd(24)} $${money(w.cost).padStart(10)}  over ${w.months} months  ($${money(w.cost / w.months!).padStart(8)}/mo)${deferrableTag(w)}${afterTag(w)}`);
  }
  if (sequential.length > 0) {
    lines.push("  Sequential:");
    for (const w of sequential)
      lines.push(`    ${w.name.padEnd(24)} $${money(w.cost).padStart(10)}${afterTag(w)}`);
  }
  return lines.join("\n");
};

const paycheckRow = (pc: PaycheckAllocation): string => {
  const period = String(pc.period).padStart(3);
  const cats = pc.assignments.map(assignmentStr).join("  │  ");
  const noteStr = pc.notes.length > 0 ? `  ← ${pc.notes.join("; ")}` : "";
  return `  ${period}  ${cats}${noteStr}`;
};

const paycheckHeader = (): string => {
  return `    #  Allocations`;
};

export const renderPaycheckTable = (plan: PaycheckPlan): string => {
  const header = paycheckHeader();
  const TW = Math.max(W, header.length + 30);

  const rowLines = plan.paychecks.map(paycheckRow);

  // Summary: when each item is funded
  const funded: string[] = [];
  const seen = new Set<string>();
  for (const pc of plan.paychecks) {
    for (const a of pc.assignments) {
      if (a.funded && !seen.has(a.category)) {
        seen.add(a.category);
        funded.push(`  ✓ ${a.category.padEnd(24)} funded by paycheck #${pc.period}`);
      }
    }
  }

  const unfunded = plan.wishes
    .filter((w) => !seen.has(w.name))
    .map((w) => `  ✗ ${w.name.padEnd(24)} not funded this year`);

  const legend = renderLegend(plan.wishes);

  return `${renderIncomeSummary(plan.income)}

Allocation Strategy
${line("─", W)}
${legend}
${line("─", W)}

Paycheck Allocation
${line("═", TW)}
${header}
${line("─", TW)}
${rowLines.join("\n")}
${line("═", TW)}

Funding Timeline
${line("─", W)}
${[...funded, ...unfunded].join("\n")}
${line("─", W)}`;
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
    notes: pc.notes,
    assignments: pc.assignments.map((a) => ({
      category: a.category,
      amount: a.amount,
      funded: a.funded,
      runningTotal: a.runningTotal,
    })),
  })),
});

export const renderJson = (data: object): string => JSON.stringify(data, null, 2);
