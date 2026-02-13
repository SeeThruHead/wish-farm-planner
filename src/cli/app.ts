/**
 * CLI definition using @effect/cli.
 *
 * Input priority (highest wins):
 *   --discretionary flag > piped stdin > config file
 */
import { Command, Options } from "@effect/cli";
import { Console, Effect, Option, pipe } from "effect";
import { createPlan, createPaycheckPlan, type AllocationStrategy } from "../services/planner-service";
import { StdinService } from "../services/stdin";
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

const discretionaryOption = Options.integer("discretionary").pipe(
  Options.withAlias("d"),
  Options.withDescription("Fixed discretionary amount per pay period (skips cra-payroll)"),
  Options.optional,
);

const periodsOption = Options.integer("periods").pipe(
  Options.withAlias("p"),
  Options.withDescription("Pay periods per year (default: 24 = semi-monthly)"),
  Options.optional,
);

// ── Plan Command (monthly summary) ──────────────────────

const strategyOption = Options.choice("strategy", ["sequential", "proportional"]).pipe(
  Options.withAlias("s"),
  Options.withDescription("Allocation strategy: sequential (one at a time) or proportional (split across all)"),
  Options.withDefault("sequential" as const),
);

const planCommand = Command.make(
  "plan",
  { config: configOption, strategy: strategyOption, json: jsonOption, discretionary: discretionaryOption, periods: periodsOption },
  ({ config, strategy, json, discretionary, periods }) =>
    Effect.gen(function* () {
      const stdin = yield* (yield* StdinService).read;
      const plan = yield* createPlan({
        configPath: Option.getOrUndefined(config),
        strategy: strategy as AllocationStrategy,
        discretionary: Option.getOrUndefined(discretionary),
        periods: Option.getOrUndefined(periods),
        stdin,
      });
      const output = json ? renderJson(summaryPlanToJson(plan)) : renderFullReport(plan);
      yield* Console.log(output);
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`❌ ${error.message}`).pipe(Effect.flatMap(() => Effect.fail(error))),
      ),
    ),
).pipe(Command.withDescription("Monthly summary of wish farm allocations"));

// ── Paychecks Command (per-paycheck table) ──────────────

const paychecksCommand = Command.make(
  "paychecks",
  { config: configOption, json: jsonOption, discretionary: discretionaryOption, periods: periodsOption },
  ({ config, json, discretionary, periods }) =>
    Effect.gen(function* () {
      const stdin = yield* (yield* StdinService).read;
      const plan = yield* createPaycheckPlan({
        configPath: Option.getOrUndefined(config),
        discretionary: Option.getOrUndefined(discretionary),
        periods: Option.getOrUndefined(periods),
        stdin,
      });
      const output = json ? renderJson(paycheckPlanToJson(plan)) : renderPaycheckTable(plan);
      yield* Console.log(output);
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`❌ ${error.message}`).pipe(Effect.flatMap(() => Effect.fail(error))),
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
    "Plan your discretionary spending with a YNAB-style wish farm.\n\n" +
    "Input priority (highest wins):\n" +
    "  --discretionary flag  >  piped stdin  >  config file\n\n" +
    "Examples:\n" +
    "  wish-farm-planner paychecks                              # uses config file\n" +
    "  wish-farm-planner paychecks --discretionary 3500          # static $3,500/period\n" +
    "  cra-payroll --json --table | wish-farm-planner paychecks  # pipe from cra-payroll",
  ),
  Command.withSubcommands([planCommand, paychecksCommand]),
);
