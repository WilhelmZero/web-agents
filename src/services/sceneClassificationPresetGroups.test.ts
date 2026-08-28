import { describe, expect, it } from "vitest";
import {
  normalizeSceneClassificationPresetGroups,
  updateSceneClassificationPresetGroupCategories,
} from "./sceneClassificationPresetGroups";

const categories = [
  {
    id: "bar",
    name: "家庭酒吧",
    prompt: "替换为家庭酒吧场景",
    isFallback: true,
    updatedAt: 1,
  },
];

describe("scene classification preset groups", () => {
  it("migrates legacy categories into one default preset group", () => {
    expect(normalizeSceneClassificationPresetGroups([], categories)).toEqual([
      expect.objectContaining({
        id: "migrated-default",
        name: "默认预设",
        categories,
      }),
    ]);
  });

  it("keeps multiple groups with independent category prompts", () => {
    const groups = normalizeSceneClassificationPresetGroups([
      { id: "a", name: "室内", categories, updatedAt: 1 },
      {
        id: "b",
        name: "户外",
        categories: [
          {
            ...categories[0],
            id: "garden",
            name: "花园",
            prompt: "替换为花园场景",
          },
        ],
        updatedAt: 2,
      },
    ]);
    expect(groups.map((item) => item.name)).toEqual(["室内", "户外"]);
    expect(groups[1].categories[0].prompt).toBe("替换为花园场景");
  });

  it("updates only the active group's categories", () => {
    const groups = normalizeSceneClassificationPresetGroups([
      { id: "a", name: "室内", categories, updatedAt: 1 },
      { id: "b", name: "户外", categories, updatedAt: 2 },
    ]);
    const updated = updateSceneClassificationPresetGroupCategories(
      groups,
      "b",
      (items) => items.map((item) => ({ ...item, prompt: "新场景" })),
    );
    expect(updated[0].categories[0].prompt).toBe("替换为家庭酒吧场景");
    expect(updated[1].categories[0].prompt).toBe("新场景");
  });
});
