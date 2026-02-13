#!/usr/bin/env node
/**
 * Entry point for wish-farm-planner CLI.
 * Wires up all Effect layers and runs the CLI.
 */
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { command } from "./cli/app";
import { ConfigServiceLive } from "./services/config";
import { CraPayrollServiceLive } from "./adapters/cra-payroll";
import { StdinServiceLive } from "./services/stdin";
import pkg from "../package.json";

const AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  CraPayrollServiceLive,
  StdinServiceLive,
);

const cli = Command.run(command, {
  name: "wish-farm-planner",
  version: pkg.version,
});

cli(process.argv).pipe(
  Effect.provide(AppLayer),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
