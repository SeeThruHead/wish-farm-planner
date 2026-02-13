/**
 * Stdin service — reads piped input if available.
 * Eagerly starts reading at module load to keep the process alive
 * while waiting for slow upstream commands.
 */
import { Effect, Context, Layer } from "effect";

// ── Service interface ───────────────────────────────────

export class StdinService extends Context.Tag("StdinService")<
  StdinService,
  { readonly read: Effect.Effect<string | undefined> }
>() {}

// ── Live implementation ─────────────────────────────────

// Read stdin eagerly at module load so Node doesn't exit
// while waiting for slow upstream pipes (e.g. cra-payroll + Puppeteer).
const stdinPromise: Promise<string | undefined> = (() => {
  if (process.stdin.isTTY) return Promise.resolve(undefined);
  return new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8").trim();
      resolve(text.length > 0 ? text : undefined);
    });
    process.stdin.on("error", reject);
    process.stdin.resume();
  });
})();

export const StdinServiceLive = Layer.succeed(StdinService, {
  read: Effect.promise(() => stdinPromise),
});
