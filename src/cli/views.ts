/**
 * Terminal output rendering for the wish farm plan.
 * Every render function has a corresponding JSON serializer.
 */
import type {
  WishFarmPlan,
  WishPlan,
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

const paycheckRow = (pc: PaycheckAllocation): string => {
  const period = String(pc.period).padStart(3);
  const take = ("$" + money(pc.takeHome)).padStart(11);
  const exp = ("$" + money(pc.expensesPortion)).padStart(11);
  const disc = ("$" + money(pc.discretionary)).padStart(11);
  const cats = pc.assignments.map(assignmentStr).join("  │  ");
  return `  ${period}  ${take}  ${exp}  ${disc}  │  ${cats}`;
};

const paycheckHeader = (): string => {
  const period = "#".padStart(3);
  const take = "Take Home".padStart(11);
  const exp = "Expenses".padStart(11);
  const disc = "Discretion.".padStart(11);
  return `  ${period}  ${take}  ${exp}  ${disc}  │  YNAB Categories`;
};

export const renderPaycheckTable = (plan: PaycheckPlan): string => {
  const header = paycheckHeader();
  const TW = Math.max(W, header.length + 30);
  const rows = plan.paychecks.map(paycheckRow);

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

  return `${renderIncomeSummary(plan.income)}

Paycheck Allocation (Sequential)
${line("═", TW)}
${header}
${line("─", TW)}
${rows.join("\n")}
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
  wishes: plan.wishes.map((w) => ({ name: w.name, cost: w.cost, priority: w.priority })),
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
    })),
  })),
});

export const renderJson = (data: object): string => JSON.stringify(data, null, 2);
