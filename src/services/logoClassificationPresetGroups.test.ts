import { describe, expect, it } from "vitest";
import {
  normalizeLogoClassificationPresetGroups,
  updateLogoClassificationPresetGroupCategories,
} from "./logoClassificationPresetGroups";

const categories = [
  {
    id: "glass",
    name: "玻璃杯",
    prompt: "只替换玻璃杯 Logo",
    isFallback: true,
    updatedAt: 1,
  },
];

describe("Logo classification preset groups", () => {
  it("migrates legacy categories into one default preset group", () => {
    expect(normalizeLogoClassificationPresetGroups([], categories)).toEqual([
      expect.objectContaining({
        id: "migrated-default",
        name: "默认预设",
        categories,
      }),
    ]);
  });

  it("keeps multiple groups with their own categories", () => {
    const groups = normalizeLogoClassificationPresetGroups([
      { id: "a", name: "杯具", categories, updatedAt: 1 },
      {
        id: "b",
        name: "礼盒",
        categories: [
          {
            ...categories[0],
            id: "box",
            name: "木盒",
            prompt: "替换木盒 Logo",
          },
        ],
        updatedAt: 2,
      },
    ]);
    expect(groups.map((item) => item.name)).toEqual(["杯具", "礼盒"]);
    expect(groups[1].categories[0].prompt).toBe("替换木盒 Logo");
  });

  it("updates only the selected group's categories", () => {
    const groups = normalizeLogoClassificationPresetGroups([
      { id: "a", name: "杯具", categories, updatedAt: 1 },
      { id: "b", name: "礼盒", categories, updatedAt: 2 },
    ]);
    const updated = updateLogoClassificationPresetGroupCategories(
      groups,
      "b",
      (items) => items.map((item) => ({ ...item, prompt: "新提示词" })),
    );
    expect(updated[0].categories[0].prompt).toBe("只替换玻璃杯 Logo");
    expect(updated[1].categories[0].prompt).toBe("新提示词");
  });
});
