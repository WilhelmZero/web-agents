import type {
  LogoClassificationPreset,
  LogoClassificationPresetGroup,
} from "../types";
import { normalizeLogoClassificationPresets } from "./logoClassification";

function validName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLogoClassificationPresetGroups(
  value: unknown,
  legacyPresets: unknown = [],
): LogoClassificationPresetGroup[] {
  const groups = Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<LogoClassificationPresetGroup>;
        const id = validName(candidate.id);
        const name = validName(candidate.name);
        const categories = normalizeLogoClassificationPresets(
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

  const categories = normalizeLogoClassificationPresets(legacyPresets);
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

export function updateLogoClassificationPresetGroupCategories(
  groups: LogoClassificationPresetGroup[],
  groupId: string,
  updater: (
    categories: LogoClassificationPreset[],
  ) => LogoClassificationPreset[],
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
