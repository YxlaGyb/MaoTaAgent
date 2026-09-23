/// The loop smoke: every case module's assertions run in the order the original
/// single script ran them, so the trace of a run stays the trace it always was.

import { runAborted } from "./aborted.ts";
import { runBatchShapes, runBatching } from "./batching.ts";
import { runCompleted } from "./completed.ts";
import { runMaxSteps } from "./max-steps.ts";
import { runParsing } from "./parsing.ts";
import { runRewrites } from "./rewrites.ts";
import { runSeams } from "./seams.ts";

await runCompleted();
await runMaxSteps();
await runAborted();
await runBatching();
await runParsing();
await runBatchShapes();
await runSeams();
await runRewrites();

console.log("agent loop ok: completed, max_steps, aborted, batching, ordering, seams, parsing, rewrites");
