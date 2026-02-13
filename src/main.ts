#!/usr/bin/env bun
/**
 * Entry point for wish-farm-planner CLI.
 */
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { command } from "./cli/app";

const cli = Command.run(command, {
  name: "wish-farm-planner",
  version: "0.1.0",
});

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
