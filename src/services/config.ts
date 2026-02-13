/**
 * Config file loading service.
 * Uses @effect/platform FileSystem for non-blocking I/O.
 */
import { Effect, pipe, Data, Context, Layer } from "effect";
import { Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { WishFarmConfigSchema, type WishFarmConfig } from "../domain/types";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

const CONFIG_PATHS = [
  "wish-farm.json",
  `${process.env.HOME || "~"}/.config/wish-farm.json`,
  `${process.env.HOME || "~"}/.wish-farm.json`,
];

// ── Service interface ───────────────────────────────────

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  { readonly load: (path?: string) => Effect.Effect<WishFarmConfig, ConfigError> }
>() {}

// ── Live implementation ─────────────────────────────────

const findConfigFile = (
  fs: FileSystem.FileSystem,
  explicitPath?: string,
): Effect.Effect<string, ConfigError> => {
  const checkExists = (path: string) =>
    pipe(
      fs.exists(path),
      Effect.mapError((e) => new ConfigError({ message: `Filesystem error: ${String(e)}` })),
    );

  if (explicitPath) {
    return Effect.gen(function* () {
      const exists = yield* checkExists(explicitPath);
      if (!exists) yield* Effect.fail(new ConfigError({ message: `Config file not found: ${explicitPath}` }));
      return explicitPath;
    });
  }

  return Effect.gen(function* () {
    for (const p of CONFIG_PATHS) {
      const exists = yield* checkExists(p);
      if (exists) return p;
    }
    return yield* Effect.fail(
      new ConfigError({
        message:
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
      }),
    );
  });
};

const readAndParse = (
  fs: FileSystem.FileSystem,
  path: string,
): Effect.Effect<WishFarmConfig, ConfigError> =>
  pipe(
    fs.readFileString(path),
    Effect.mapError((e) => new ConfigError({ message: `Failed to read config: ${String(e)}` })),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (e) => new ConfigError({ message: `Invalid JSON in config: ${e instanceof Error ? e.message : String(e)}` }),
      }),
    ),
    Effect.flatMap((raw) =>
      pipe(
        Schema.decodeUnknown(WishFarmConfigSchema)(raw),
        Effect.mapError((e) => new ConfigError({ message: `Invalid config: ${String(e)}` })),
      ),
    ),
  );

export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      load: (path?: string) =>
        Effect.gen(function* () {
          const resolved = yield* findConfigFile(fs, path);
          return yield* readAndParse(fs, resolved);
        }),
    };
  }),
);

// ── Convenience for backward compat ─────────────────────

export const loadConfig = (
  explicitPath?: string,
): Effect.Effect<WishFarmConfig, ConfigError, ConfigService> =>
  pipe(
    ConfigService,
    Effect.flatMap((svc) => svc.load(explicitPath)),
  );
