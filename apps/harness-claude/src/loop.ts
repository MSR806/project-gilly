import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest, InvocationResult } from "@gilly/harness-protocol";

/** Collapse an SDK message stream to the session id and final text. Pure — no SDK calls. */
export async function reduceSdkStream(
  messages: AsyncIterable<SDKMessage>,
): Promise<{ harnessSessionId: string | null; finalText: string }> {
  let harnessSessionId: string | null = null;
  let resultText: string | null = null;
  let assistantText = "";

  for await (const message of messages) {
    if (message.type === "system" && message.subtype === "init") {
      harnessSessionId = message.session_id;
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") assistantText += block.text;
      }
    } else if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
    }
  }

  // Prefer the result message; fall back to accumulated assistant text.
  return { harnessSessionId, finalText: resultText ?? assistantText };
}

/**
 * Drives one Claude Agent SDK loop for an invocation. `queryFn` is injectable for tests.
 * Never throws: SDK/runtime failures come back as an `{ status: "error" }` result.
 */
export async function runAgentLoop(
  req: InvocationRequest,
  queryFn: typeof query = query,
): Promise<InvocationResult> {
  try {
    const messages = queryFn({
      prompt: req.userMessage,
      options: {
        systemPrompt: req.agent.systemPrompt,
        model: req.agent.model,
        ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
      },
    });
    const { harnessSessionId, finalText } = await reduceSdkStream(messages);
    return { status: "completed", finalText, harnessSessionId, error: null };
  } catch (err) {
    return { status: "error", finalText: "", harnessSessionId: null, error: String(err) };
  }
}
