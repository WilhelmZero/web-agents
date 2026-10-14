import { describe, expect, it } from "vitest";
import { FOLDER_SCENE_POOLS } from "./sceneThemeRecommendation";
import {
  createDefaultLogoClassificationPresetGroup,
  createDefaultSceneClassificationPresetGroup,
  localizeDefaultLogoClassificationPresetGroups,
  localizeDefaultSceneClassificationPresetGroups,
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

  it('switches untouched built-in category names and prompts in both directions', () => {
    const originalScene = createDefaultSceneClassificationPresetGroup();
    const originalLogo = createDefaultLogoClassificationPresetGroup();
    const englishScene = localizeDefaultSceneClassificationPresetGroups([originalScene], 'en-US')[0];
    const englishLogo = localizeDefaultLogoClassificationPresetGroups([originalLogo], 'en-US')[0];
    expect(englishScene.name).toBe('Default multi-tab scene replacement preset');
    expect(englishScene.categories[0].name).toBe('Shot glass');
    expect(englishScene.categories[0].prompt).toContain('Strictly preserve the cup');
    expect(englishLogo.categories[1].name).toBe('Glass / frosted laser engraving');
    expect(englishLogo.categories[1].prompt).toContain('do not redraw, translate, or alter it');
    expect(localizeDefaultSceneClassificationPresetGroups([englishScene], 'zh-CN')[0]).toEqual(originalScene);
    expect(localizeDefaultLogoClassificationPresetGroups([englishLogo], 'zh-CN')[0]).toEqual(originalLogo);
  });

  it('does not overwrite edits to built-in categories or user-created groups', () => {
    const original = createDefaultSceneClassificationPresetGroup();
    const edited = { ...original, categories: original.categories.map((category, index) => index === 0 ? { ...category, name: 'My category', prompt: 'My custom prompt' } : category) };
    const custom = { ...original, id: 'my-group', name: 'My group' };
    const [localized, untouched] = localizeDefaultSceneClassificationPresetGroups([edited, custom], 'en-US');
    expect(localized.categories[0].name).toBe('My category');
    expect(localized.categories[0].prompt).toBe('My custom prompt');
    expect(localized.categories[1].name).toBe('Stemless egg cup');
    expect(untouched).toBe(custom);
  });
});
