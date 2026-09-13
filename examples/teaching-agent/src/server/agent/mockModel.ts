import type { AgentMessage, AssistantMessage, ToolResultMessage } from "../../shared/protocol";
import { createAssistantMessage, messageText, text } from "./message";
import type { CompleteInput, TeachingModel } from "./model";

/**
 * LinguaPal 的离线模型（「小灵」降级版）。
 *
 * 没有配置 LLM Key、Key 失效或网络中断时，用它保证孩子仍然能继续玩：
 * 无论孩子说什么，都先用一句简单英语回应，并调用 pronunciation_evaluate 给出评分，
 * 拿到工具结果后再用一句英语收尾。行为完全确定，因此也适合作为 E2E 测试基准。
 */
export class MockModel implements TeachingModel {
  async complete(input: CompleteInput): Promise<AssistantMessage> {
    const last = input.messages[input.messages.length - 1];

    // 工具结果已经回来，这一轮收尾，否则 loop 会一直带着 toolResult 转下去。
    if (last?.role === "toolResult") {
      return this.replyFromToolResult(last);
    }

    // 首轮和新一轮对话都固定触发发音评估，保证孩子每次开口都能看到反馈。
    return createAssistantMessage(
      [
        text("That's great! 🦊 Can you say it again?"),
        {
          type: "toolCall",
          id: `mock_${Date.now()}_pronunciation`,
          name: "pronunciation_evaluate",
          arguments: { transcript: pickTranscript(last) },
        },
      ],
      "toolUse",
    );
  }

  private replyFromToolResult(toolResult: ToolResultMessage): AssistantMessage {
    if (toolResult.isError) {
      return createAssistantMessage([text("No worries! Let's try one more time!")]);
    }

    if (toolResult.toolName === "pronunciation_evaluate") {
      const accuracy = readAccuracy(toolResult);
      return createAssistantMessage([
        text(
          accuracy === undefined
            ? "Nice job! Let's keep going!"
            : `Nice job! Your score is ${accuracy}. Let's keep going!`,
        ),
      ]);
    }

    return createAssistantMessage([text("Good job! Let's practice again!")]);
  }
}

/** 只保留用户消息里的英文单词；孩子说中文或什么都没说时兜底为 "Hello!"。 */
function pickTranscript(message: AgentMessage | undefined): string {
  if (!message || message.role !== "user") {
    return "Hello!";
  }

  const english = messageText(message)
    .split(/\s+/)
    .filter((word) => /^[A-Za-z][A-Za-z'.,!?]*$/.test(word))
    .join(" ");

  return english || "Hello!";
}

/** 评分放在 toolResult.details，兜底再解析一次 content 里的 JSON。 */
function readAccuracy(toolResult: ToolResultMessage): number | undefined {
  const details = toolResult.details as { accuracy?: unknown } | undefined;
  if (details && typeof details.accuracy === "number") {
    return details.accuracy;
  }

  try {
    const parsed = JSON.parse(messageText(toolResult)) as { accuracy?: unknown };
    return typeof parsed.accuracy === "number" ? parsed.accuracy : undefined;
  } catch {
    return undefined;
  }
}
