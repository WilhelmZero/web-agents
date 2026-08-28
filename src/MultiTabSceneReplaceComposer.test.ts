import { describe, expect, it } from "vitest";
import { groupFolderFiles } from "./MultiTabLogoReplaceComposer";
import {
  buildFolderScenePrompt,
  buildPickerFolderTree,
  collectSceneOutputItems,
} from "./MultiTabSceneReplaceComposer";
import type { SceneReplaceTask } from "./types";

function folderFile(name: string, path: string) {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("buildPickerFolderTree", () => {
  it("preserves parent directories but only attaches images to deepest folders", () => {
    const groups = groupFolderFiles([
      folderFile("parent.png", "root/AM058/parent.png"),
      folderFile("one.png", "root/AM058/AM058/one.png"),
      folderFile("two.png", "root/AM059/AM059/two.png"),
    ]);
    const tree = buildPickerFolderTree(groups);
    expect(tree[0].name).toBe("root");
    expect(tree[0].group).toBeUndefined();
    expect(tree[0].children.map((node) => node.name)).toEqual([
      "AM058",
      "AM059",
    ]);
    expect(tree[0].children[0].group).toBeUndefined();
    expect(
      tree[0].children[0].children[0].group?.files.map((file) => file.name),
    ).toEqual(["one.png"]);
  });

  it("combines the folder theme with the common prompt used by every worker image", () => {
    expect(
      buildFolderScenePrompt("保持杯子不变", {
        cupType: "啤酒杯",
        theme: "替换为后院 BBQ 主题",
        source: "matched",
        firstFileKey: "one",
        status: "ready",
      }),
    ).toBe("替换为后院 BBQ 主题；保持杯子不变");
  });

  it("ignores the folder theme when exact prompt control is enabled", () => {
    const input = "  只提交这一段提示词  ";
    expect(
      buildFolderScenePrompt(
        input,
        {
          cupType: "啤酒杯",
          theme: "不得拼接的主题",
          source: "matched",
          firstFileKey: "one",
          status: "ready",
        },
        true,
      ),
    ).toBe(input);
  });

  it("matches every generated result to its source file identity instead of a stale array index", () => {
    const first = folderFile("first.png", "root/A/first.png");
    const second = folderFile("second.png", "root/A/second.png");
    const group = groupFolderFiles([first, second])[0];
    const task: SceneReplaceTask = {
      id: "result-1",
      sceneId: "scene-2",
      sceneIndex: 0,
      sourceFileKey: `${second.name}:${second.size}:${second.lastModified}`,
      copyIndex: 0,
      status: "success",
      prompt: "替换场景",
      retryCount: 0,
      resultBlob: new Blob(["result"], { type: "image/png" }),
    };

    const [item] = collectSceneOutputItems([group], { [group.id]: [task] });
    expect(item.original).toBe(second);
  });
});
