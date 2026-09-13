import assert from "node:assert/strict";
import { test } from "node:test";
import { messageText } from "./message";
import {
  createTutorToolRegistry,
  isMasteryLevel,
  normalizeMasteryLevel,
} from "./tutorTools";

test("tutor registry exposes exactly the three LinguaPal tools", () => {
  const registry = createTutorToolRegistry();
  assert.deepEqual(
    registry.definitions().map((tool) => tool.name).sort(),
    ["pronunciation_evaluate", "vocabulary_lookup", "vocabulary_track"],
  );
});

test("pronunciation_evaluate scores a normal English sentence", async () => {
  const registry = createTutorToolRegistry();
  const result = await registry.execute("pronunciation_evaluate", { transcript: "I like dogs." });
  const scores = JSON.parse(messageText(result)) as {
    accuracy: number;
    fluency: number;
    completeness: number;
    feedback: string;
  };

  assert.ok(scores.accuracy > 0 && scores.accuracy <= 100);
  assert.equal(scores.fluency, 90);
  assert.ok(scores.completeness > 0 && scores.completeness <= 100);
  assert.ok(scores.feedback.length > 0);
});

test("pronunciation_evaluate returns zero scores for empty input", async () => {
  const registry = createTutorToolRegistry();
  const result = await registry.execute("pronunciation_evaluate", { transcript: "   " });
  const scores = JSON.parse(messageText(result)) as { accuracy: number; feedback: string };

  assert.equal(scores.accuracy, 0);
  assert.match(scores.feedback, /英文/);
});

test("vocabulary_lookup resolves aliases and hints available topics", async () => {
  const registry = createTutorToolRegistry();

  const known = JSON.parse(messageText(await registry.execute("vocabulary_lookup", { topic: "Animals" }))) as Array<{
    word: string;
  }>;
  assert.ok(known.length > 0);

  const unknown = JSON.parse(
    messageText(await registry.execute("vocabulary_lookup", { topic: "space travel" })),
  ) as { availableTopics: string[] };
  assert.ok(unknown.availableTopics.includes("animals"));
});

test("vocabulary_lookup finds a single word across topics", async () => {
  const registry = createTutorToolRegistry();

  const found = JSON.parse(
    messageText(await registry.execute("vocabulary_lookup", { word: "Adopt", topic: "family" })),
  ) as Array<{ word: string; meaning: string; example: string; topic: string }>;
  assert.equal(found.length, 1);
  assert.equal(found[0].topic, "animals");
  assert.ok(found[0].meaning.length > 0);

  const missing = JSON.parse(
    messageText(await registry.execute("vocabulary_lookup", { word: "photosynthesis" })),
  ) as { error: string; availableTopics: string[] };
  assert.match(missing.error, /unknown word/);
  assert.ok(missing.availableTopics.length > 0);
});

test("vocabulary_track records words and clamps mastery level", async () => {
  const registry = createTutorToolRegistry();
  await registry.execute("vocabulary_track", { word: "adopt", masteryLevel: 99 });

  const result = await registry.execute("vocabulary_track", { word: "adopt" });
  const details = result.details as { masteryLevel: number; trackedCount: number };
  assert.equal(details.masteryLevel, 1);
  assert.ok(details.trackedCount >= 1);
});

test("vocabulary_track rejects an empty word", async () => {
  const registry = createTutorToolRegistry();
  await assert.rejects(() => registry.execute("vocabulary_track", {}), /word is required/);
});

test("mastery level helpers clamp to the 0-5 range", () => {
  assert.equal(normalizeMasteryLevel(undefined), 1);
  assert.equal(normalizeMasteryLevel(Number.NaN), 1);
  assert.equal(normalizeMasteryLevel(-3), 0);
  assert.equal(normalizeMasteryLevel(3.6), 4);
  assert.equal(normalizeMasteryLevel(9), 5);

  assert.equal(isMasteryLevel(0), true);
  assert.equal(isMasteryLevel(5), true);
  assert.equal(isMasteryLevel(6), false);
  assert.equal(isMasteryLevel(2.5), false);
  assert.equal(isMasteryLevel("3"), false);
  assert.equal(isMasteryLevel(undefined), false);
});
