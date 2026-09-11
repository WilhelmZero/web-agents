import {
  DEFAULT_AI_PET_LETTER_SETTINGS,
  type AiPetLetterPrompt,
  type AiPetLetterSettings,
  type AiPetLetterWorkspace,
} from "./types";
import { createDefaultPrompts } from "./prompts";

const SETTINGS_KEY = "ai-pet-letter-stickers:settings:v1";
const PROMPTS_KEY = "ai-pet-letter-stickers:prompts:v1";
const DB_NAME = "ai-pet-letter-stickers-v1";

export function loadAiPetLetterSettings(): AiPetLetterSettings {
  try {
    return { ...DEFAULT_AI_PET_LETTER_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"), version: 1 };
  } catch {
    return DEFAULT_AI_PET_LETTER_SETTINGS;
  }
}

export function saveAiPetLetterSettings(value: AiPetLetterSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}

export function loadAiPetLetterPrompts(): AiPetLetterPrompt[] {
  const defaults = createDefaultPrompts();
  try {
    const saved = JSON.parse(localStorage.getItem(PROMPTS_KEY) || "[]") as Partial<AiPetLetterPrompt>[];
    const byLetter = new Map(saved.map((item) => [item.letter, item]));
    return defaults.map((item) => {
      const savedItem = byLetter.get(item.letter);
      const legacyLocalComposite = savedItem?.currentPrompt?.includes("逐像素保持") || savedItem?.currentPrompt?.includes("局部编辑");
      return { ...item, ...savedItem, currentPrompt: legacyLocalComposite ? item.currentPrompt : savedItem?.currentPrompt || item.currentPrompt, defaultPrompt: item.defaultPrompt };
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
  const db = await openDb();
  return new Promise<AiPetLetterWorkspace | null>((resolve, reject) => {
    const request = db.transaction("workspace").objectStore("workspace").get("current");
    request.onsuccess = () => resolve((request.result as AiPetLetterWorkspace | undefined) || null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveAiPetLetterWorkspace(value: AiPetLetterWorkspace) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("workspace", "readwrite");
    transaction.objectStore("workspace").put(value, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}
