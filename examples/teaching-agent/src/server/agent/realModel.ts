import type {
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolDefinition,
} from "../../shared/protocol";
import { createAssistantMessage, messageText, text } from "./message";
import type { CompleteInput, TeachingModel } from "./model";

type ChatCompletionToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatCompletionToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: unknown;
};

export class RealModel implements TeachingModel {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = (process.env.CW_AGENT_LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = process.env.CW_AGENT_LLM_KEY || process.env.OPENAI_API_KEY || "";
    this.model = process.env.CW_AGENT_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  async complete(input: CompleteInput): Promise<AssistantMessage> {
    if (!this.apiKey) {
      return createErrorMessage("缺少 OPENAI_API_KEY，无法调用真实模型。");
    }

    const messages: ChatMessage[] = [
      ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
      ...input.messages.map(toChatMessage),
    ];

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(input.tools.length > 0
            ? { tools: input.tools.map(toChatTool), tool_choice: "auto" }
            : {}),
        }),
        signal: input.signal,
      });

      const payload = (await response.json()) as ChatCompletionResponse;
      if (!response.ok) {
        return createErrorMessage(
          `模型请求失败 ${response.status}：${JSON.stringify(payload.error ?? payload)}`,
        );
      }

      const choice = payload.choices?.[0];
      const assistant = choice?.message;
      if (!assistant) {
        return createErrorMessage(`模型未返回消息：${JSON.stringify(payload)}`);
      }

      return toAssistantMessage(assistant, choice?.finish_reason, payload.usage);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return createAssistantMessage([text("模型调用已取消。")], "aborted");
      }
      return createErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

function toChatMessage(message: AgentMessage): ChatMessage {
  if (message.role === "assistant") {
    const toolCalls = message.content.filter(isToolCall);
    const content = messageText(message);
    return {
      role: "assistant",
      content: content.length > 0 ? content : null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : {}),
    };
  }

  if (message.role === "toolResult") {
    return { role: "tool", tool_call_id: message.toolCallId, content: messageText(message) };
  }

  return { role: "user", content: messageText(message) };
}

function toChatTool(tool: ToolDefinition): { type: "function"; function: Record<string, unknown> } {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toAssistantMessage(
  message: NonNullable<NonNullable<ChatCompletionResponse["choices"]>[number]["message"]>,
  finishReason: string | null | undefined,
  usage: ChatCompletionResponse["usage"],
): AssistantMessage {
  const toolCalls: ToolCallContent[] = (message.tool_calls ?? []).map((call) => ({
    type: "toolCall",
    id: call.id,
    name: call.function.name,
    arguments: safeJsonParse(call.function.arguments),
  }));

  const created = createAssistantMessage(
    [...(message.content ? [text(message.content)] : []), ...toolCalls],
    finishReason === "tool_calls" || toolCalls.length > 0 ? "toolUse" : "stop",
  );

  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  return {
    ...created,
    usage: {
      input: inputTokens,
      output: outputTokens,
      totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
    },
  };
}

function createErrorMessage(detail: string): AssistantMessage {
  return {
    ...createAssistantMessage([text(`真实模型调用失败：${detail}`)], "error"),
    errorMessage: detail,
  };
}

function isToolCall(block: AssistantMessage["content"][number]): block is ToolCallContent {
  return block.type === "toolCall";
}

function safeJsonParse(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
