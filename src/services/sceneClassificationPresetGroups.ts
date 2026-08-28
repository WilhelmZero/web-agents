import type {
  SceneClassificationPreset,
  SceneClassificationPresetGroup,
} from "../types";
import { normalizeSceneClassificationPresets } from "./sceneClassification";

function validName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSceneClassificationPresetGroups(
  value: unknown,
  legacyPresets: unknown = [],
): SceneClassificationPresetGroup[] {
  const groups = Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<SceneClassificationPresetGroup>;
        const id = validName(candidate.id);
        const name = validName(candidate.name);
        const categories = normalizeSceneClassificationPresets(
          candidate.categories,
        );
        if (!id || !name) return [];
        return [
          {
            id,
            name,
            categories,
            updatedAt:
              typeof candidate.updatedAt === "number"
                ? candidate.updatedAt
                : Date.now(),
          },
        ];
      })
    : [];
  if (groups.length) return groups;

  const categories = normalizeSceneClassificationPresets(legacyPresets);
  return categories.length
    ? [
        {
          id: "migrated-default",
          name: "默认预设",
          categories,
          updatedAt: Date.now(),
        },
      ]
    : [];
}

export function updateSceneClassificationPresetGroupCategories(
  groups: SceneClassificationPresetGroup[],
  groupId: string,
  updater: (
    categories: SceneClassificationPreset[],
  ) => SceneClassificationPreset[],
) {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          categories: updater(group.categories),
          updatedAt: Date.now(),
        }
      : group,
  );
}
