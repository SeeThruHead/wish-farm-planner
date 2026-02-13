/**
 * CLI definition using @effect/cli.
 *
 * Input priority (highest wins):
 *   --discretionary flag > piped stdin > config file
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

// ── Read stdin if piped ─────────────────────────────────

const readStdin = (): Effect.Effect<string | undefined> => {
  // Only attempt to read if stdin is piped (not a terminal)
  if (process.stdin.isTTY) return Effect.succeed(undefined);

  return Effect.tryPromise({
    try: () =>
      new Promise<string | undefined>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8").trim();
          resolve(text.length > 0 ? text : undefined);
        });
        process.stdin.on("error", reject);
        process.stdin.resume();
      }),
    catch: (e) => new Error(`Failed to read stdin: ${e}`),
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
};

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
    pipe(
      readStdin(),
      Effect.flatMap((stdin) =>
        createPlan({
          configPath: config._tag === "Some" ? config.value : undefined,
          strategy: strategy as AllocationStrategy,
          discretionary: discretionary._tag === "Some" ? discretionary.value : undefined,
          periods: periods._tag === "Some" ? periods.value : undefined,
          stdin,
        }),
      ),
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
  { config: configOption, json: jsonOption, discretionary: discretionaryOption, periods: periodsOption },
  ({ config, json, discretionary, periods }) =>
    pipe(
      readStdin(),
      Effect.flatMap((stdin) =>
        createPaycheckPlan({
          configPath: config._tag === "Some" ? config.value : undefined,
          discretionary: discretionary._tag === "Some" ? discretionary.value : undefined,
          periods: periods._tag === "Some" ? periods.value : undefined,
          stdin,
        }),
      ),
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
