/**
 * Config file loading service.
 * Reads wish-farm config from ~/.wish-farm.json or ./wish-farm.json.
 */
import { Effect, pipe } from "effect";
import { Schema } from "effect";
import { WishFarmConfigSchema, type WishFarmConfig } from "../domain/types";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

export class ConfigError {
  readonly _tag = "ConfigError";
  constructor(readonly message: string) {}
}

const CONFIG_PATHS = [
  "wish-farm.json",
  join(process.env.HOME || "~", ".config", "wish-farm.json"),
  join(process.env.HOME || "~", ".wish-farm.json"),
];

const findConfigFile = (explicitPath?: string): Effect.Effect<string, ConfigError> => {
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    return existsSync(resolved)
      ? Effect.succeed(resolved)
      : Effect.fail(new ConfigError(`Config file not found: ${resolved}`));
  }

  for (const p of CONFIG_PATHS) {
    const resolved = resolve(p);
    if (existsSync(resolved)) return Effect.succeed(resolved);
  }

  return Effect.fail(
    new ConfigError(
      `No config file found. Create one at ${CONFIG_PATHS[0]} or specify with --config.\n\n` +
        `Example config:\n` +
        JSON.stringify(
          {
            monthlyExpenses: 3500,
            wishes: [
              { name: "Mac Studio", cost: 2999, priority: 1 },
              { name: "Headphones", cost: 599, priority: 2 },
            ],
            craPayrollArgs: { salary: 100000, province: "Ontario" },
          },
          null,
          2,
        ),
    ),
  );
};

const readConfigFile = (path: string): Effect.Effect<unknown, ConfigError> =>
  Effect.try({
    try: () => JSON.parse(readFileSync(path, "utf-8")),
    catch: (e) => new ConfigError(`Failed to read config: ${e instanceof Error ? e.message : String(e)}`),
  });

const parseConfig = (raw: unknown): Effect.Effect<WishFarmConfig, ConfigError> =>
  pipe(
    Schema.decodeUnknown(WishFarmConfigSchema)(raw),
    Effect.mapError((e) => new ConfigError(`Invalid config: ${String(e)}`)),
  );

export const loadConfig = (
  explicitPath?: string,
): Effect.Effect<WishFarmConfig, ConfigError> =>
  pipe(
    findConfigFile(explicitPath),
    Effect.flatMap(readConfigFile),
    Effect.flatMap(parseConfig),
  );
