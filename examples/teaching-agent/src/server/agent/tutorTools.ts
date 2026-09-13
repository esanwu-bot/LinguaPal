import type { ToolDefinition, ToolResult } from "../../shared/protocol";
import { text } from "./message";
import { ToolRegistry } from "./tools";

type TutorTool = ToolDefinition & {
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
};

const DEFAULT_MASTERY_LEVEL = 1;
const MAX_MASTERY_LEVEL = 5;

// ---------------------------------------------------------------------------
// 1. pronunciation_evaluate —— 发音评估
// ---------------------------------------------------------------------------

export const pronunciationEvaluateTool: TutorTool = {
  name: "pronunciation_evaluate",
  description: "评估孩子英语发音的准确度、流利度、完整度，返回 0-100 分。孩子说完一句英文后调用。",
  parameters: {
    type: "object",
    properties: {
      transcript: { type: "string", description: "孩子说出的英文内容，保留原始词序" },
    },
    required: ["transcript"],
  },
  async execute(args) {
    const transcript = stringArg(args.transcript, "");
    const words = transcript.split(/\s+/).filter(Boolean);

    // 边界：孩子没说出英文时给 0 分并提示，而不是抛错，方便模型温柔地引导重说。
    if (words.length === 0) {
      const empty = { accuracy: 0, fluency: 0, completeness: 0, feedback: "我还没听到英文哦，再说一次吧～" };
      return {
        content: [text(JSON.stringify(empty))],
        details: { ...empty, transcript, isEmpty: true },
      };
    }

    // 最小实现：基于句子长度与结尾标点做启发式评分。
    // 后续可替换为讯飞 / 腾讯语音评测 API，接口签名保持不变。
    const accuracy = Math.min(100, 70 + words.length * 2);
    const fluency = /[.!?]$/.test(transcript) ? 90 : 80;
    const completeness = Math.min(100, 75 + words.length * 3);
    const feedback = accuracy >= 85 ? "发音很棒！" : "再试一次会更好～";
    const scores = { accuracy, fluency, completeness, feedback };

    return {
      content: [text(JSON.stringify(scores))],
      details: { ...scores, transcript, wordCount: words.length },
    };
  },
};

// ---------------------------------------------------------------------------
// 2. vocabulary_lookup —— 目标词汇查询
// ---------------------------------------------------------------------------

type VocabularyEntry = { word: string; meaning: string; example: string };

const VOCAB_LIBRARY: Record<string, VocabularyEntry[]> = {
  animals: [
    { word: "puppy", meaning: "小狗", example: "The puppy is cute." },
    { word: "friendly", meaning: "友好的", example: "Dogs are friendly." },
    { word: "adopt", meaning: "领养", example: "I want to adopt a dog." },
  ],
  food: [
    { word: "delicious", meaning: "美味的", example: "The cake is delicious." },
    { word: "taste", meaning: "品尝", example: "Can I taste it?" },
    { word: "hungry", meaning: "饿的", example: "I am hungry." },
  ],
  colors: [
    { word: "purple", meaning: "紫色", example: "I like purple." },
    { word: "bright", meaning: "明亮的", example: "The sun is bright." },
  ],
  numbers: [
    { word: "count", meaning: "数数", example: "Let's count to ten." },
    { word: "double", meaning: "双倍的", example: "Two is double one." },
  ],
  family: [
    { word: "parents", meaning: "父母", example: "My parents love me." },
    { word: "grandma", meaning: "奶奶/外婆", example: "Grandma makes cookies." },
  ],
  school: [
    { word: "pencil", meaning: "铅笔", example: "This is my pencil." },
    { word: "recess", meaning: "课间休息", example: "We play at recess." },
  ],
  hobbies: [
    { word: "draw", meaning: "画画", example: "I like to draw." },
    { word: "swim", meaning: "游泳", example: "Can you swim?" },
  ],
};

/** 允许模型用单复数或中文话题名，统一归一化到 VOCAB_LIBRARY 的 key。 */
const TOPIC_ALIASES: Record<string, string> = {
  animal: "animals",
  动物: "animals",
  foods: "food",
  食物: "food",
  color: "colors",
  colour: "colors",
  颜色: "colors",
  number: "numbers",
  数字: "numbers",
  家庭: "family",
  学校: "school",
  hobby: "hobbies",
  爱好: "hobbies",
};

export const vocabularyLookupTool: TutorTool = {
  name: "vocabulary_lookup",
  description:
    "查询适合 5-10 岁孩子学习的目标词汇，返回释义和例句。查具体单词用 word，按话题找词用 topic。",
  parameters: {
    type: "object",
    properties: {
      word: { type: "string", description: "要查询的具体单词，如 adopt。孩子问 What does X mean? 时传这个" },
      topic: {
        type: "string",
        description: "当前对话话题，可选值：animals / food / colors / numbers / family / school / hobbies",
      },
    },
  },
  async execute(args) {
    const rawWord = stringArg(args.word, "").toLowerCase();
    const rawTopic = stringArg(args.topic, "").toLowerCase();

    // 优先按具体单词检索整个词库，直接命中 "What does X mean?" 这类问题。
    if (rawWord) {
      const found = findWord(rawWord);
      if (found) {
        return {
          content: [text(JSON.stringify([found]))],
          details: { word: rawWord, topic: found.topic, words: [found] },
        };
      }
      return notFound(`unknown word: ${rawWord}`);
    }

    const topic = TOPIC_ALIASES[rawTopic] ?? rawTopic;
    const words = VOCAB_LIBRARY[topic];

    // 边界：话题不在词库内时，把可用话题回传给模型，避免它继续瞎猜。
    if (!words) {
      return notFound(rawTopic ? `unknown topic: ${rawTopic}` : "no topic or word provided");
    }

    const picked = words.slice(0, 2);
    return {
      content: [text(JSON.stringify(picked))],
      details: { topic, words: picked },
    };
  },
};

type VocabularyMatch = VocabularyEntry & { topic: string };

function findWord(word: string): VocabularyMatch | undefined {
  for (const [topic, entries] of Object.entries(VOCAB_LIBRARY)) {
    const match = entries.find((entry) => entry.word.toLowerCase() === word);
    if (match) {
      return { ...match, topic };
    }
  }
  return undefined;
}

/** 查不到时把可用话题回传给模型，避免它继续瞎猜。 */
function notFound(reason: string): ToolResult {
  const availableTopics = Object.keys(VOCAB_LIBRARY);
  return {
    content: [text(JSON.stringify({ error: reason, availableTopics }))],
    details: { error: reason, availableTopics },
  };
}

// ---------------------------------------------------------------------------
// 3. vocabulary_track —— 词汇掌握记录
// ---------------------------------------------------------------------------

type VocabularyRecord = {
  word: string;
  masteryLevel: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** 最小实现：进程内存储，重启即清空；后续阶段可替换为 SQLite / JSONL 落盘。 */
const vocabularyRecords = new Map<string, VocabularyRecord>();

export function listTrackedVocabulary(): VocabularyRecord[] {
  return [...vocabularyRecords.values()];
}

export function isMasteryLevel(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_MASTERY_LEVEL;
}

export function normalizeMasteryLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MASTERY_LEVEL;
  }
  return Math.min(MAX_MASTERY_LEVEL, Math.max(0, Math.round(value)));
}

export const vocabularyTrackTool: TutorTool = {
  name: "vocabulary_track",
  description: "记录孩子本次掌握的新词汇及其掌握等级（0-5）。",
  parameters: {
    type: "object",
    properties: {
      word: { type: "string", description: "孩子掌握的词汇" },
      masteryLevel: { type: "number", description: "掌握等级 0-5，缺省为 1" },
    },
    required: ["word"],
  },
  async execute(args) {
    const word = stringArg(args.word, "");
    if (!word) {
      throw new Error("word is required");
    }

    const masteryLevel = normalizeMasteryLevel(args.masteryLevel);
    const key = word.toLowerCase();
    const now = Date.now();
    const record: VocabularyRecord = {
      word,
      masteryLevel,
      firstSeenAt: vocabularyRecords.get(key)?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    vocabularyRecords.set(key, record);

    console.log(`[vocab-track] ${word} level=${masteryLevel}`);
    return {
      content: [text(`已记录词汇：${word}（掌握等级 ${masteryLevel}/5）`)],
      details: { ...record, trackedCount: vocabularyRecords.size },
    };
  },
};

// ---------------------------------------------------------------------------
// 组装：英语陪练 Agent 的工具集
// ---------------------------------------------------------------------------

/** 创建只包含 LinguaPal 陪练工具的注册表（不含工作区文件类工具）。 */
export function createTutorToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(pronunciationEvaluateTool);
  registry.register(vocabularyLookupTool);
  registry.register(vocabularyTrackTool);
  return registry;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
