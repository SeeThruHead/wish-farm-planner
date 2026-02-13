/**
 * CLI definition using @effect/cli.
 */
import { Command, Options } from "@effect/cli";
import { Effect, pipe } from "effect";
import { createPlan, createPaycheckPlan, type AllocationStrategy } from "../services/planner-service";
import {
  renderFullReport,
  renderPaycheckTable,
  renderJson,
  summaryPlanToJson,
  paycheckPlanToJson,
} from "./views";

// ── Shared Options ──────────────────────────────────────

const configOption = Options.text("config").pipe(
  Options.withAlias("c"),
  Options.withDescription("Path to config file"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// ── Plan Command (monthly summary) ──────────────────────

const strategyOption = Options.choice("strategy", ["sequential", "proportional"]).pipe(
  Options.withAlias("s"),
  Options.withDescription("Allocation strategy: sequential (one at a time) or proportional (split across all)"),
  Options.withDefault("sequential" as const),
);

const planCommand = Command.make(
  "plan",
  { config: configOption, strategy: strategyOption, json: jsonOption },
  ({ config, strategy, json }) =>
    pipe(
      createPlan({
        configPath: config._tag === "Some" ? config.value : undefined,
        strategy: strategy as AllocationStrategy,
      }),
      Effect.map((plan) =>
        json ? renderJson(summaryPlanToJson(plan)) : renderFullReport(plan),
      ),
      Effect.tap((output) => Effect.sync(() => console.log(output))),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(`❌ ${error.message}`);
          process.exit(1);
        }),
      ),
    ),
).pipe(Command.withDescription("Monthly summary of wish farm allocations"));

// ── Paychecks Command (per-paycheck table) ──────────────

const paychecksCommand = Command.make(
  "paychecks",
  { config: configOption, json: jsonOption },
  ({ config, json }) =>
    pipe(
      createPaycheckPlan({
        configPath: config._tag === "Some" ? config.value : undefined,
      }),
      Effect.map((plan) =>
        json ? renderJson(paycheckPlanToJson(plan)) : renderPaycheckTable(plan),
      ),
      Effect.tap((output) => Effect.sync(() => console.log(output))),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(`❌ ${error.message}`);
          process.exit(1);
        }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Per-paycheck allocation table showing which YNAB categories to fund each paycheck",
  ),
);

// ── Root Command ────────────────────────────────────────

export const command = Command.make("wish-farm-planner").pipe(
  Command.withDescription(
    "Plan your discretionary spending. Uses cra-payroll to determine " +
      "take-home pay, subtracts your monthly expenses, and allocates the " +
      "remaining money to your wish farm items.",
  ),
  Command.withSubcommands([planCommand, paychecksCommand]),
);
