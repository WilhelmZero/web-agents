import {
  DEFAULT_AI_PET_LETTER_SETTINGS,
  type AiPetLetterPrompt,
  type AiPetLetterSettings,
  type AiPetLetterWorkspace,
} from "./types";
import { adaptPromptOutputMode, createDefaultPrompts, defaultPromptForLetter } from "./prompts";
import type { AppLanguage } from "../../i18n";
import { loadServerDocument, saveServerDocument, serverPersistenceEnabled } from '../serverPersistence';

const SETTINGS_KEY = "ai-pet-letter-stickers:settings:v1";
const PROMPTS_KEY = "ai-pet-letter-stickers:prompts:v1";
const DB_NAME = "ai-pet-letter-stickers-v1";

function isPreviousDefaultPrompt(value: string | undefined): boolean {
  return Boolean(value?.includes("其他角色和小装饰保持参考图中的身份、造型、数量和大致位置。"));
}

function isBuiltInDefaultPrompt(letter: string | undefined, value: string | undefined): boolean {
  if (!letter || !value) return false;
  const withoutOutputMode = (prompt: string) => prompt
    .replace(/\s*输出背景模式：[^。]*。/g, "")
    .replace(/\s*Output background mode:[^\n]*\.?/gi, "")
    .trim();
  return (["zh-CN", "en-US"] as const).some((language) => {
    const base = defaultPromptForLetter(letter, language);
    return withoutOutputMode(value) === withoutOutputMode(base) || value === base || (["direct-background", "transparent-colorize"] as const)
      .some((mode) => withoutOutputMode(value) === withoutOutputMode(adaptPromptOutputMode(base, mode, language)));
  });
}

export function loadAiPetLetterSettings(): AiPetLetterSettings {
  try {
    return { ...DEFAULT_AI_PET_LETTER_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"), version: 2 };
  } catch {
    return DEFAULT_AI_PET_LETTER_SETTINGS;
  }
}

export function saveAiPetLetterSettings(value: AiPetLetterSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}

export function loadAiPetLetterPrompts(language: AppLanguage = "zh-CN"): AiPetLetterPrompt[] {
  const defaults = createDefaultPrompts(language);
  try {
    const saved = JSON.parse(localStorage.getItem(PROMPTS_KEY) || "[]") as Partial<AiPetLetterPrompt>[];
    const byLetter = new Map(saved.map((item) => [item.letter, item]));
    return defaults.map((item) => {
      const savedItem = byLetter.get(item.letter);
      const legacyLocalComposite = savedItem?.currentPrompt?.includes("逐像素保持") || savedItem?.currentPrompt?.includes("局部编辑");
      const shouldUpgradeDefault = legacyLocalComposite || isPreviousDefaultPrompt(savedItem?.currentPrompt) || isBuiltInDefaultPrompt(savedItem?.letter, savedItem?.currentPrompt);
      return { ...item, ...savedItem, currentPrompt: shouldUpgradeDefault ? item.currentPrompt : savedItem?.currentPrompt || item.currentPrompt, defaultPrompt: item.defaultPrompt };
    });
  } catch {
    return defaults;
  }
}

export function saveAiPetLetterPrompts(value: AiPetLetterPrompt[]) {
  localStorage.setItem(PROMPTS_KEY, JSON.stringify(value.map(({ letter, currentPrompt, selected }) => ({ letter, currentPrompt, selected }))));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadAiPetLetterWorkspace(): Promise<AiPetLetterWorkspace | null> {
  if (serverPersistenceEnabled()) return loadServerDocument<AiPetLetterWorkspace>('ai-pet-letter-stickers:workspace');
  const db = await openDb();
  return new Promise<AiPetLetterWorkspace | null>((resolve, reject) => {
    const request = db.transaction("workspace").objectStore("workspace").get("current");
    request.onsuccess = () => resolve((request.result as AiPetLetterWorkspace | undefined) || null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveAiPetLetterWorkspace(value: AiPetLetterWorkspace) {
  if (serverPersistenceEnabled()) return saveServerDocument('ai-pet-letter-stickers:workspace', value, 'ai-pet-letter-stickers');
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("workspace", "readwrite");
    transaction.objectStore("workspace").put(value, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}
