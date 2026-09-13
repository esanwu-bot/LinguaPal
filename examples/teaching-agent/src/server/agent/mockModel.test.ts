import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallContent, ToolResultMessage } from "../../shared/protocol";
import { createUserMessage, messageText, text } from "./message";
import { MockModel } from "./mockModel";

const model = new MockModel();

function findToolCall(content: Array<{ type: string }>): ToolCallContent | undefined {
  return content.find((block): block is ToolCallContent => block.type === "toolCall");
}

async function completeWithUser(input: string) {
  return model.complete({
    systemPrompt: "You are LinguaPal.",
    messages: [createUserMessage(input)],
    tools: [],
  });
}

test("MockModel 用英语回复并触发 pronunciation_evaluate", async () => {
  const message = await completeWithUser("I like dogs.");

  assert.equal(message.stopReason, "toolUse");
  assert.ok(message.content.some((block) => block.type === "text"));

  const call = findToolCall(message.content);
  assert.ok(call);
  assert.equal(call.name, "pronunciation_evaluate");
  assert.equal(call.arguments.transcript, "I like dogs.");
});

test("MockModel 在非英文输入时兜底为 Hello!", async () => {
  for (const input of ["你好呀", "   ", "12345"]) {
    const message = await completeWithUser(input);
    const call = findToolCall(message.content);
    assert.equal(call?.arguments.transcript, "Hello!", `input=${input}`);
  }
});

test("MockModel 没有上下文时也能给出稳定开局", async () => {
  const message = await model.complete({ systemPrompt: "", messages: [], tools: [] });

  assert.equal(message.stopReason, "toolUse");
  assert.equal(findToolCall(message.content)?.arguments.transcript, "Hello!");
});

test("MockModel 拿到评分结果后用英语收尾并停止", async () => {
  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "pronunciation_evaluate",
    content: [text(JSON.stringify({ accuracy: 86, fluency: 90, completeness: 88, feedback: "发音很棒！" }))],
    details: { accuracy: 86 },
    isError: false,
    timestamp: Date.now(),
  };

  const message = await model.complete({ systemPrompt: "", messages: [toolResult], tools: [] });

  assert.equal(message.stopReason, "stop");
  assert.ok(message.content.every((block) => block.type === "text"));
  assert.match(messageText(message), /86/);
});

test("MockModel 遇到工具错误时温柔地引导重试", async () => {
  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "call_2",
    toolName: "pronunciation_evaluate",
    content: [text("Tool call blocked: 缺少待评估的英文内容")],
    isError: true,
    timestamp: Date.now(),
  };

  const message = await model.complete({ systemPrompt: "", messages: [toolResult], tools: [] });

  assert.equal(message.stopReason, "stop");
  assert.match(messageText(message), /try one more time/i);
});
