import { describe, expect, it } from "vitest";
import { FOLDER_SCENE_POOLS } from "./sceneThemeRecommendation";
import {
  createDefaultLogoClassificationPresetGroup,
  createDefaultSceneClassificationPresetGroup,
} from "./defaultClassificationPresetGroups";

describe("default automatic-classification preset groups", () => {
  it("maps the multi-tab Logo replacement material cases into complete prompts", () => {
    const group = createDefaultLogoClassificationPresetGroup();

    expect(group.name).toBe("多标签 Logo 替换默认预设");
    expect(group.categories).toHaveLength(6);
    expect(group.categories.filter((item) => item.isFallback)).toHaveLength(1);
    expect(group.categories.map((item) => item.name)).toEqual([
      "其他载体 / 沿用原工艺",
      "玻璃杯 / 磨砂激光雕刻",
      "啤酒杯 / 光滑区安全替换",
      "深色木盒 / 激光烧蚀",
      "浅色木盒 / 原木同色浅雕",
      "其他雕刻载体 / 材质自适应",
    ]);
    expect(
      group.categories.every((item) =>
        item.prompt.includes("只允许修改旧 Logo 覆盖区域"),
      ),
    ).toBe(true);
    expect(
      group.categories.find((item) => item.id === "default-logo-beer-mug")
        ?.prompt,
    ).toContain("不得裁切、拉伸、向下进入纹理区");
    expect(
      group.categories.find((item) => item.id === "default-logo-light-wood")
        ?.prompt,
    ).toContain("近零色差");
  });

  it("maps every multi-tab cup type and its scene pool into the scene group", () => {
    const group = createDefaultSceneClassificationPresetGroup();

    expect(group.name).toBe("多标签场景替换默认预设");
    expect(group.categories).toHaveLength(6);
    expect(
      group.categories
        .filter((item) => item.isFallback)
        .map((item) => item.name),
    ).toEqual(["其他杯型 / 按真实用途"]);
    for (const [cupType, themes] of Object.entries(FOLDER_SCENE_POOLS)) {
      const category = group.categories.find((item) => item.name === cupType);
      expect(category).toBeDefined();
      for (const theme of themes) {
        expect(category?.prompt).toContain(
          theme.replace(/^替换为/, "").replace(/主题$/, ""),
        );
      }
      expect(category?.prompt).toContain(
        "杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变",
      );
    }
  });

  it("returns fresh copies so editor changes cannot mutate the built-in template", () => {
    const first = createDefaultLogoClassificationPresetGroup();
    first.categories[0].name = "已修改";
    expect(
      createDefaultLogoClassificationPresetGroup().categories[0].name,
    ).toBe("其他载体 / 沿用原工艺");
  });
});
