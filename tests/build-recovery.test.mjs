import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";

import {
  MISTAKE_RELATIVE_PATH,
  buildRepairPrompt,
  runWorkspaceBuildWithRecovery,
} from "../server/build-recovery.mjs";

test("runWorkspaceBuildWithRecovery retries failed attempts and writes mistake.md", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-recovery-"));
  await mkdir(path.join(root, ".graphcoding"), { recursive: true });

  let attempts = 0;
  const result = await runWorkspaceBuildWithRecovery({
    prompt: "Implement the selected step only.",
    cwd: root,
    mode: "selection",
    maxAttempts: 3,
    runAttempt: async ({ prompt, attempt }) => {
      attempts += 1;
      if (attempt < 3) {
        throw Object.assign(new Error(`attempt ${attempt} failed`), {
          promptPath: `/tmp/prompt-${attempt}.md`,
          logPath: `/tmp/log-${attempt}.txt`,
          partialOutput: `line 1\nline 2\nattempt ${attempt} failure`,
        });
      }

      assert.match(prompt, /repair attempt 3/i);
      return {
        output: "build ok",
        promptPath: "/tmp/prompt-3.md",
        logPath: "/tmp/log-3.txt",
      };
    },
  });

  assert.equal(attempts, 3);
  assert.equal(result.recovered, true);
  assert.equal(result.attemptCount, 3);

  const mistakePath = path.join(root, MISTAKE_RELATIVE_PATH);
  const mistakeContent = await readFile(mistakePath, "utf8");
  assert.match(mistakeContent, /status: resolved/);
  assert.match(mistakeContent, /Attempt 1/);
  assert.match(mistakeContent, /Attempt 2/);
  assert.match(mistakeContent, /attempt 2 failed/);
});

test("runWorkspaceBuildWithRecovery surfaces final failure and leaves failed mistake.md", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-recovery-fail-"));

  await assert.rejects(
    () =>
      runWorkspaceBuildWithRecovery({
        prompt: "Implement only the selected step.",
        cwd: root,
        mode: "selection",
        maxAttempts: 2,
        runAttempt: async ({ attempt }) => {
          throw Object.assign(new Error(`attempt ${attempt} hard failure`), {
            partialOutput: `attempt ${attempt} output`,
          });
        },
      }),
    (error) => {
      assert.equal(error.attemptCount, 2);
      assert.match(error.mistakePath, /mistake\.md$/);
      return true;
    },
  );

  const mistakeContent = await readFile(path.join(root, MISTAKE_RELATIVE_PATH), "utf8");
  assert.match(mistakeContent, /status: failed/);
  assert.match(mistakeContent, /Attempt 2/);
});

test("buildRepairPrompt points repairs back to mistake.md and preserves scope", () => {
  const prompt = buildRepairPrompt({
    originalPrompt: "Implement only the current selection.",
    attempt: 2,
    mode: "selection",
  });

  assert.match(prompt, /Read \.graphcoding\/mistake\.md first\./);
  assert.match(prompt, /Fix only the failures recorded there\./);
  assert.match(prompt, /Do not widen scope beyond the current selection task\./);
});
