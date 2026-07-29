/**
 * Lakera Guard screening helper for Node.js/TypeScript MCP servers.
 *
 * Wraps an MCP tool handler so that:
 *  - pre_call:  the input is screened BEFORE the tool logic runs
 *  - post_call: the output is screened AFTER the tool logic runs
 *
 * Usage:
 *   import { guardContent } from "./guard.js";
 *
 *   const guardedHandler = guardContent(
 *     async (args: { text: string }) => {
 *       return `Make TLDR of text: ${args.text}`;
 *     },
 *     { inputParam: "text", outputScreen: true }
 *   );
 *
 *   server.tool("tldr_text", { text: z.string() }, guardedHandler);
 */

import "dotenv/config";

const LAKERA_API_KEY = process.env.LAKERA_API_KEY;
const LAKERA_GUARD_URL = "https://api.lakera.ai/v2/guard";

const LAKERA_PROJECT_ID = process.env.LAKERA_PROJECT_ID ?? "project-6687456967";

export interface ScreenResult {
  isSafe: boolean;
  summary: string;
  raw?: unknown;
}

export type GuardRole = "user" | "assistant";

export interface GuardMessage {
  role: GuardRole;
  content: string;
}

/**
 * Calls the Lakera Guard API to screen a conversation.
 * Treats any non-200 response or network error as "unsafe" (fail closed).
 *
 * `messages` follows the OpenAI chat format. Per Lakera's docs, Guard screens
 * the *last* message in the list but uses earlier messages as context — so
 * when screening an assistant reply, the preceding user message should be
 * included unmodified rather than screening the reply in isolation.
 */
export async function screenMessages(messages: GuardMessage[]): Promise<ScreenResult> {
  if (!LAKERA_API_KEY) {
    throw new Error("LAKERA_API_KEY is not set in the environment (.env)");
  }

  try {
    const resp = await fetch(LAKERA_GUARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LAKERA_API_KEY}`,
      },
      body: JSON.stringify({
        messages,
        breakdown: true,
        dev_info: true,
        project_id: LAKERA_PROJECT_ID,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[lakera_guarded] error: ${resp.status} - ${errText}`);
      return { isSafe: false, summary: `Error screening content (HTTP ${resp.status}): ${errText}` };
    }

    const result = await resp.json();
    const flagged = Boolean(result?.flagged);

    // breakdown[].project_id / policy_id tell us which project & policy Lakera
    // actually applied to this request. If project_id here doesn't match
    // LAKERA_PROJECT_ID, the request silently fell back to another project/policy
    // (e.g. because the configured project_id is invalid or not recognized).
    const breakdown = Array.isArray(result?.breakdown) ? result.breakdown : [];
    const appliedProjectId = breakdown[0]?.project_id;
    const appliedPolicyId = breakdown[0]?.policy_id;
    const projectMismatch = appliedProjectId && appliedProjectId !== LAKERA_PROJECT_ID;

    console.error(
      `[lakera_guarded] sent project_id=${LAKERA_PROJECT_ID} | applied project_id=${appliedProjectId} policy_id=${appliedPolicyId} | flagged=${flagged}` +
        (projectMismatch ? " | ** PROJECT MISMATCH: request did not use the configured project! **" : "")
    );
    if (breakdown.length) {
      console.error(`[lakera_guarded] breakdown: ${JSON.stringify(breakdown)}`);
    }

    return {
      isSafe: !flagged,
      summary: flagged
        ? `Content has been flagged by Lakera Guard as potentially harmful.` +
          (projectMismatch
            ? ` (WARNING: request used project_id=${appliedProjectId}, not the configured ${LAKERA_PROJECT_ID} — check that the project ID exists and belongs to this API key.)`
            : ` (project_id=${appliedProjectId ?? LAKERA_PROJECT_ID}, policy_id=${appliedPolicyId ?? "unknown"})`)
        : "Lakera Guard screened the message and content is safe to use.",
      raw: result,
    };
  } catch (err) {
    console.error("[lakera_guarded] request failed:", err);
    return { isSafe: false, summary: "Error screening content (request failed)" };
  }
}

/** Convenience wrapper: screen a single message with no prior context. */
export async function screenContent(text: string, role: GuardRole = "user"): Promise<ScreenResult> {
  return screenMessages([{ role, content: text }]);
}

export interface GuardOptions<Args> {
  /** Name of the key in `args` whose string value should be screened before the call. Leave empty to skip input screening. */
  inputParam?: keyof Args & string;
  /** Whether to screen the string result after the call. Default true. */
  outputScreen?: boolean;
}

/**
 * Higher-order function equivalent of the Python @guard_content decorator.
 * Wrap any async tool handler with this to add pre_call/post_call screening.
 */
export function guardContent<Args extends Record<string, unknown>, Result>(
  handler: (args: Args) => Promise<Result>,
  options: GuardOptions<Args> = {}
) {
  const { inputParam, outputScreen = true } = options;

  return async (args: Args): Promise<Result> => {
    // --- pre_call: input goes into `contents` exactly as the user typed it (role: user) ---
    let inputText: string | undefined;
    if (inputParam && typeof args[inputParam] === "string") {
      inputText = args[inputParam] as unknown as string;
      const check = await screenContent(inputText, "user");
      if (!check.isSafe) {
        throw new Error(`Input rejected: ${check.summary}`);
      }
    }

    // --- call the actual tool logic ---
    const result = await handler(args);

    // --- post_call: screen the output (role: assistant), with the original
    // user input included as preceding context — not screened in isolation ---
    if (outputScreen && typeof result === "string") {
      const messages: GuardMessage[] = [];
      if (inputText !== undefined) {
        messages.push({ role: "user", content: inputText });
      }
      messages.push({ role: "assistant", content: result });

      const check = await screenMessages(messages);
      if (!check.isSafe) {
        throw new Error(`Output rejected: ${check.summary}`);
      }
    }

    return result;
  };
}
