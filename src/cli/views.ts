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

const moneyShort = (n: number): string =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
    : `$${money(n)}`;

const months = (n: number): string =>
  n === Infinity ? "never" : n === 1 ? "1 month" : `${n} months`;

const dateStr = (d: Date): string =>
  d.getFullYear() > 9000 ? "never" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short" });

// ── Helpers for per-paycheck ranges ─────────────────────

interface PayRange {
  readonly low: number;
  readonly high: number;
  readonly lowRange: string;  // e.g. "#1–6"
  readonly highRange: string; // e.g. "#7–24"
  readonly isFlat: boolean;
}

/** Group consecutive paychecks by value, return low/high ranges. */
const computeRange = (
  paychecks: readonly PaycheckAllocation[],
  getter: (pc: PaycheckAllocation) => number,
): PayRange => {
  if (paychecks.length === 0) return { low: 0, high: 0, lowRange: "", highRange: "", isFlat: true };

  const values = paychecks.map(getter);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const isFlat = Math.abs(high - low) < 0.01;

  if (isFlat) return { low, high, lowRange: "", highRange: "", isFlat };

  // Find contiguous ranges at the low and high values
  // Low: count from start while value equals low (within tolerance)
  let lastLowIdx = 0;
  while (lastLowIdx < values.length - 1 && Math.abs(values[lastLowIdx + 1] - low) < 0.01) lastLowIdx++;

  let firstHighIdx = values.length - 1;
  while (firstHighIdx > 0 && Math.abs(values[firstHighIdx - 1] - high) < 0.01) firstHighIdx--;

  const lowRange = lastLowIdx === 0 ? `#1` : `#1–${lastLowIdx + 1}`;
  const highRange = firstHighIdx === values.length - 1
    ? `#${values.length}`
    : `#${firstHighIdx + 1}–${values.length}`;

  return { low, high, lowRange, highRange, isFlat };
};

const rangeStr = (range: PayRange): string =>
  range.isFlat
    ? `$${money(range.low)}`
    : `$${money(range.low)} (${range.lowRange}) → $${money(range.high)} (${range.highRange})`;

// ═══════════════════════════════════════════════════════
// Income Summary (used by plan command)
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
// Summary Plan (monthly allocation — plan command)
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

/** Place two rendered table strings side by side with a gap. */
const sideBySide = (left: string, right: string, gap = 3): string => {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  // Visible width (strip ANSI codes)
  const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const leftWidth = Math.max(...leftLines.map(visLen));
  const maxRows = Math.max(leftLines.length, rightLines.length);
  const pad = " ".repeat(gap);
  const out: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const l = leftLines[i] ?? "";
    const r = rightLines[i] ?? "";
    const trailing = leftWidth - visLen(l);
    out.push(l + " ".repeat(trailing) + pad + r);
  }
  return out.join("\n");
};

export const renderPaycheckTable = (plan: PaycheckPlan): string => {
  const pcs = plan.paychecks;

  // ── Compute funding timeline ──
  const fundedAt = new Map<string, number>();
  for (const pc of pcs) {
    for (const a of pc.assignments) {
      if (a.funded && !fundedAt.has(a.category)) {
        fundedAt.set(a.category, pc.period);
      }
    }
  }

  // ── Year-end totals ──
  const totalSpent = plan.wishes
    .filter((w) => fundedAt.has(w.name))
    .reduce((sum, w) => sum + w.cost, 0);
  const totalDiscretionary = pcs.reduce((sum, pc) => sum + pc.discretionary, 0);
  const remaining = totalDiscretionary - totalSpent;

  // ── Per-paycheck ranges ──
  const takeHomeRange = computeRange(pcs, (pc) => pc.takeHome);
  const discRange = computeRange(pcs, (pc) => pc.discretionary);

  // ── Income Summary table (top-left) ──
  const income = new Table({
    head: ["", "Per Paycheck", "Annual"],
    style: { head: [], border: [] },
    colAligns: ["left", "left", "right"],
  });
  const annualTakeHome = pcs.reduce((s, pc) => s + pc.takeHome, 0);
  const annualExpenses = pcs.reduce((s, pc) => s + pc.expensesPortion, 0);
  income.push(
    ["Take-Home", rangeStr(takeHomeRange), `$${money(annualTakeHome)}`],
    ["Expenses", `-$${money(pcs[0]?.expensesPortion ?? 0)}`, `-$${money(annualExpenses)}`],
    ["Discretionary", rangeStr(discRange), `$${money(totalDiscretionary)}`],
  );

  // ── Legend table (top-right) ──
  const legend = new Table({ style: { head: [], border: [] } });
  legend.push(
    [{ colSpan: 2, content: "Legend", hAlign: "center" as const }],
    ["⚡", "prioritized over timed"],
    ["🔓", "dependency unlocked"],
    ["⏩", "catching up (deferred)"],
    ["🔒", "locked rate"],
    ["⏸ ", "paused for deadline"],
  );

  // ── Items table (full width) ──
  const items = new Table({
    head: ["P", "Item", "Cost", "Type", "Funded", "Notes"],
    style: { head: [], border: [] },
    colAligns: ["right", "left", "right", "left", "left", "left"],
  });
  for (const w of plan.wishes) {
    const type = w.months !== undefined ? `${w.months}mo` : "seq";
    const funded = fundedAt.has(w.name) ? `✓ #${fundedAt.get(w.name)}` : "✗";
    const notes: string[] = [];
    if (w.deferrable === false) notes.push("locked");
    if (w.after && w.after.length > 0) notes.push(`after: ${w.after.join(", ")}`);
    items.push([w.priority, w.name, `$${money(w.cost)}`, type, funded, notes.join(", ")]);
  }

  // ── Paycheck allocation table (full width) ──
  const maxSlots = Math.max(...pcs.map((pc) => pc.assignments.length));
  const head = ["#", ...Array.from({ length: maxSlots }, (_, i) => `Slot ${i + 1}`)];
  const colAligns: Array<"left" | "right" | "center"> = ["right", ...Array.from({ length: maxSlots }, () => "left" as const)];
  const alloc = new Table({ head, style: { head: [], border: [] }, colAligns });

  for (const pc of pcs) {
    const cells: string[] = [String(pc.period)];
    for (let i = 0; i < maxSlots; i++) {
      cells.push(i < pc.assignments.length ? assignmentCell(pc.assignments[i]) : "");
    }
    alloc.push(cells);
  }

  // ── Year-End Summary table (bottom-left) ──
  const yearEnd = new Table({ style: { head: [], border: [] } });
  yearEnd.push(
    [{ colSpan: 2, content: "Year-End Summary", hAlign: "center" as const }],
    ["Total Discretionary", `$${money(totalDiscretionary)}`],
    ["Wish Spending", `-$${money(totalSpent)}`],
    ["Remaining Cash", `$${money(remaining)}`],
  );

  // ── Funding Timeline table (bottom-right) ──
  const timeline = new Table({ style: { head: [], border: [] } });
  timeline.push([{ colSpan: 2, content: "Funding Timeline", hAlign: "center" as const }]);
  // Show items in order of when they're funded
  const sortedFunded = [...fundedAt.entries()].sort((a, b) => a[1] - b[1]);
  for (const [name, period] of sortedFunded) {
    timeline.push([`✓ ${name}`, `paycheck #${period}`]);
  }
  // Show unfunded items
  for (const w of plan.wishes) {
    if (!fundedAt.has(w.name)) {
      timeline.push([`✗ ${w.name}`, "not funded"]);
    }
  }

  return [
    sideBySide(income.toString(), legend.toString()),
    "",
    items.toString(),
    "",
    alloc.toString(),
    "",
    sideBySide(yearEnd.toString(), timeline.toString()),
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
