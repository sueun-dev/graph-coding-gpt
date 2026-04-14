import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export const MISTAKE_RELATIVE_PATH = ".graphcoding/mistake.md";

const renderExcerpt = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "- no output captured";
  }

  const lines = value.trim().split("\n").slice(-20);
  return lines.map((line) => `> ${line}`).join("\n");
};

export const buildMistakeDocument = ({ mode, attempts, status, resolvedAt }) => {
  const lines = [
    "# mistake.md",
    "",
    `- mode: ${mode}`,
    `- status: ${status}`,
    `- attempts: ${attempts.length}`,
  ];

  if (resolvedAt) {
    lines.push(`- resolvedAt: ${resolvedAt}`);
  }

  lines.push("", "## Purpose", "", "- Track build/test failures for the current step.", "- Keep repair passes narrow and scoped to the current approved graph step.", "");

  for (const attempt of attempts) {
    lines.push(`## Attempt ${attempt.attempt}`);
    lines.push("");
    lines.push(`- failedAt: ${attempt.failedAt}`);
    lines.push(`- message: ${attempt.message}`);
    if (attempt.promptPath) {
      lines.push(`- promptPath: ${attempt.promptPath}`);
    }
    if (attempt.logPath) {
      lines.push(`- logPath: ${attempt.logPath}`);
    }
    lines.push("");
    lines.push("### Last Output");
    lines.push("");
    lines.push(renderExcerpt(attempt.partialOutput));
    lines.push("");
    lines.push("### Repair Rule");
    lines.push("");
    lines.push("- Fix only the current recorded failure.");
    lines.push("- Do not widen scope beyond the selected step and required boundaries.");
    lines.push("- Keep existing approved work intact.");
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

export const buildRepairPrompt = ({ originalPrompt, attempt, mode, mistakeRelativePath = MISTAKE_RELATIVE_PATH }) => `
You are continuing a previously failed coding pass.

This is repair attempt ${attempt}.

Rules:
- Read ${mistakeRelativePath} first.
- Fix only the failures recorded there.
- Do not widen scope beyond the current ${mode} task.
- Preserve the current approved work and only change what is necessary to make validation pass.
- If the previous attempt added out-of-scope code, remove or reduce it.
- End after the current recorded failures are addressed.

Original implementation task:
${originalPrompt}
`.trim();

export const runWorkspaceBuildWithRecovery = async ({
  prompt,
  cwd,
  mode,
  maxAttempts = 3,
  runAttempt,
  verifyAttempt,
}) => {
  const mistakePath = path.join(cwd, MISTAKE_RELATIVE_PATH);
  const attempts = [];
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await runAttempt({ prompt: currentPrompt, cwd, mode, attempt });
      if (typeof verifyAttempt === "function") {
        await verifyAttempt({ prompt: currentPrompt, cwd, mode, attempt, result });
      }
      const status = attempt === 1 ? "clean" : "resolved";
      const mistakeDocument = buildMistakeDocument({
        mode,
        attempts,
        status,
        resolvedAt: attempt === 1 ? null : new Date().toISOString(),
      });
      await mkdir(path.dirname(mistakePath), { recursive: true });
      await writeFile(mistakePath, mistakeDocument);
      return {
        ...result,
        attemptCount: attempt,
        recovered: attempt > 1,
        mistakePath,
      };
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Workspace build failed.");
      attempts.push({
        attempt,
        failedAt: new Date().toISOString(),
        message: normalizedError.message,
        promptPath: typeof normalizedError.promptPath === "string" ? normalizedError.promptPath : null,
        logPath: typeof normalizedError.logPath === "string" ? normalizedError.logPath : null,
        partialOutput: typeof normalizedError.partialOutput === "string" ? normalizedError.partialOutput : "",
      });

      const failedDocument = buildMistakeDocument({
        mode,
        attempts,
        status: attempt >= maxAttempts ? "failed" : "repairing",
        resolvedAt: null,
      });
      await mkdir(path.dirname(mistakePath), { recursive: true });
      await writeFile(mistakePath, failedDocument);

      if (attempt >= maxAttempts) {
        throw Object.assign(normalizedError, {
          mistakePath,
          attemptCount: attempt,
        });
      }

      currentPrompt = buildRepairPrompt({
        originalPrompt: prompt,
        attempt: attempt + 1,
        mode,
      });
    }
  }

  throw Object.assign(new Error("Workspace build recovery loop exited unexpectedly."), {
    mistakePath,
    attemptCount: attempts.length,
  });
};
