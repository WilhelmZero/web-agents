import { it, expect, vi } from "vitest";
import { validateProfile, profileRoute, verifyReview } from "./source-lock.mjs";
import { runAutoTune } from "./auto-tune.mjs";
import { DEFAULTS } from "./processing.mjs";
import { buildPrompt } from "./prompts.mjs";
import { bestResultIndex } from "./results";
const counts = (kind = "cat") => ({
  person: 0,
  cat: 0,
  dog: 0,
  horse: 0,
  otherAnimal: 0,
  character: 0,
  object: 0,
  [kind]: 1,
});
const profile = (kind = "cat", medium = "photo") =>
  validateProfile({
    medium,
    confidence: 0.96,
    description: "客户原照主体",
    counts: counts(kind),
    reviewConsistent: true,
    reason: "",
  });
const review = (c = counts()) => ({
  scores: {
    identity: 99,
    subjects: 99,
    hair: 99,
    texture: 99,
    background: 99,
    tones: 99,
  },
  issues: [],
  action: "accept" as const,
  suggestions: "改善纹理",
  adjustments: {
    texture: 65,
    contrast: 50,
    brightness: 50,
    shadow: 30,
    blackPoint: 10,
  },
  observedOriginal: counts(),
  observedOutput: c,
});
it("routes by visible content, preserving portraits and using general fallback for mixed/uncertain sources", () => {
  expect(profileRoute(profile("cat"))).toBe("cat");
  expect(profileRoute(profile("dog"))).toBe("dog");
  expect(profileRoute(profile("person"))).toBe("portrait");
  expect(profileRoute(profile("character", "cartoon"))).toBe("cartoon");
  expect(profileRoute(profile("object", "graphic"))).toBe("generic");
  expect(profileRoute({ ...profile(), confidence: 0.4 })).toBe("generic");
  expect(
    profileRoute({ ...profile(), counts: { ...counts(), person: 1 } }),
  ).toBe("generic");
});
it("rejects swapped roles, misdescribed outputs and contradictory narrative without accepting bad advice", () => {
  const lock = profile();
  expect(() =>
    verifyReview(
      lock,
      { ...review(), observedOriginal: counts("person") },
      profile(),
    ),
  ).toThrow(/矛盾/);
  expect(() =>
    verifyReview(
      lock,
      { ...review(), observedOutput: counts("person") },
      profile(),
    ),
  ).toThrow(/矛盾/);
  expect(() =>
    verifyReview(lock, review(), {
      ...profile(),
      reviewConsistent: false,
      reason: "成品是猫但意见说是人物",
    }),
  ).toThrow(/矛盾/);
  expect(() =>
    verifyReview(lock, review(), { ...profile(), confidence: 0.3 }),
  ).toThrow(/证据不足/);
});
it("allows legitimate wrong-subject findings but forces integrity failure despite high scores", () => {
  const r = verifyReview(
    profile(),
    review(counts("person")),
    profile("person"),
  );
  expect(r.integrity).toBe("mismatch");
  expect(r.scores.identity).toBe(0);
  expect(r.action).toBe("regenerate");
  expect(verifyReview(profile(), review(), profile()).integrity).toBe(
    "verified",
  );
});
it("uses route-specific texture instructions and source lock while leaving legacy portrait wording intact", () => {
  expect(buildPrompt({ sourceProfile: profile("cat") })).toContain(
    "PET ENGRAVING",
  );
  expect(
    buildPrompt({ sourceProfile: profile("character", "cartoon") }),
  ).toContain("CARTOON ENGRAVING");
  expect(
    buildPrompt({ sourceProfile: profile("object", "graphic") }),
  ).toContain("GENERAL ENGRAVING FALLBACK");
  expect(buildPrompt({ sourceProfile: profile("person") })).toContain(
    "BLACK HAIR AND DARK FUR ARE A PRIORITY",
  );
  expect(buildPrompt({ sourceProfile: profile("cat") })).not.toContain(
    "BLACK HAIR AND DARK FUR ARE A PRIORITY",
  );
});
it("stops after a contradictory review, preserves the billed image and sends no follow-up generation", async () => {
  const generate = vi.fn(async () => ({
    buffer: new Blob(["candidate"]),
    warnings: [],
  }));
  const d: any = {
    sourceProfile: profile(),
    original: new Blob(["cat"]),
    reference: new Blob(["style"]),
    config: {},
    subject: "auto",
    instructions: "",
    style: "strong",
    params: DEFAULTS,
    options: { maxRounds: 5, targetScore: 85 },
    generate,
    review: async () =>
      verifyReview(profile(), review(), {
        ...profile(),
        reviewConsistent: false,
      }),
    render: async (buffer: Blob) => ({
      buffer,
      width: 10,
      height: 10,
      warnings: [],
    }),
    saveCandidate: async (blob: Blob) => ({
      id: "saved",
      blob,
      width: 10,
      height: 10,
      warnings: [],
    }),
    publish: async () => {},
    cancelled: () => false,
  };
  const run = await runAutoTune(d);
  expect(run.status).toBe("failed");
  expect(run.fallback?.job.id).toBe("saved");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(run.rounds).toHaveLength(0);
});
it("does not auto-select a high-scoring integrity failure as cover", () => {
  const make = (id: string, integrity: string, score: number) => ({
    job: { id },
    reviews: [{ integrity, score, params: DEFAULTS }],
    params: DEFAULTS,
  });
  expect(
    bestResultIndex([
      make("bad", "mismatch", 99),
      make("good", "verified", 80),
    ] as any),
  ).toBe(1);
  expect(bestResultIndex([make("bad", "mismatch", 99)] as any)).toBe(-1);
});

it("does not accept a high average with failed integrity or continue editing a wrong subject", async () => {
  const original = new Blob(["cat"]);
  const inputs: any[] = [];
  const d: any = {
    sourceProfile: profile(),
    original,
    reference: new Blob(["style"]),
    config: {},
    subject: "auto",
    instructions: "",
    style: "strong",
    params: DEFAULTS,
    options: { maxRounds: 2, targetScore: 85, continueOnGenerated: true },
    generate: async (input: any) => {
      inputs.push(input);
      return { buffer: new Blob(["wrong"]), warnings: [] };
    },
    review: async () => ({ ...review(), integrity: "mismatch" }),
    render: async (buffer: Blob) => ({
      buffer,
      width: 10,
      height: 10,
      warnings: [],
    }),
    saveCandidate: async (blob: Blob) => ({
      id: String(inputs.length),
      blob,
      width: 10,
      height: 10,
      warnings: [],
    }),
    publish: async () => {},
    cancelled: () => false,
  };
  const run = await runAutoTune(d);
  expect(run.status).toBe("limit");
  expect(run.rounds.every((r: any) => !r.passed)).toBe(true);
  expect(inputs).toHaveLength(2);
  expect(inputs[1].image).toBe(original);
  expect(inputs[1].editMode).toBeUndefined();
});

it("does not auto-adopt a reference suspect even with no review", () => {
  const suspect: any = {
    job: { id: "suspect", referenceSuspect: true },
    reviews: [],
  };
  expect(bestResultIndex([suspect])).toBe(-1);
  expect(
    bestResultIndex([{ job: { id: "ok" }, reviews: [] }, suspect] as any),
  ).toBe(0);
});
