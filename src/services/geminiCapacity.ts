export interface GeminiCapacitySettings {
  enabled: boolean;
  retryLimit: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
}

interface CapacityState { failures: number; blockedUntil: number }

const SETTINGS_KEY = 'scene-studio.gemini-capacity-settings.v1';
const STATE_KEY = 'scene-studio.gemini-capacity-state.v1';

export const DEFAULT_GEMINI_CAPACITY_SETTINGS: GeminiCapacitySettings = {
  enabled: true,
  retryLimit: 8,
  baseDelaySeconds: 15,
  maxDelaySeconds: 600,
};

export function getGeminiCapacitySettings(): GeminiCapacitySettings {
  try { return { ...DEFAULT_GEMINI_CAPACITY_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return DEFAULT_GEMINI_CAPACITY_SETTINGS; }
}

export function saveGeminiCapacitySettings(value: GeminiCapacitySettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}

function readState(): CapacityState {
  try { return { failures: 0, blockedUntil: 0, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; }
  catch { return { failures: 0, blockedUntil: 0 }; }
}

function writeState(value: CapacityState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('gemini-capacity-state', { detail: value }));
}

export function isGeminiCapacityError(status: number, message = '') {
  return status === 503 || /high demand|no capacity|capacity exhausted|MODEL_CAPACITY_EXHAUSTED/i.test(message);
}

export function registerGeminiCapacityFailure(): number {
  const settings = getGeminiCapacitySettings();
  if (!settings.enabled) return 0;
  const current = readState();
  const failures = Math.min(current.failures + 1, 16);
  const exponential = settings.baseDelaySeconds * 1000 * (2 ** Math.max(0, failures - 1));
  const jitter = Math.random() * Math.min(5000, exponential * 0.2);
  const delay = Math.min(settings.maxDelaySeconds * 1000, exponential + jitter);
  const blockedUntil = Math.max(current.blockedUntil, Date.now() + delay);
  writeState({ failures, blockedUntil });
  return Math.max(0, blockedUntil - Date.now());
}

export function registerGeminiCapacitySuccess() {
  const current = readState();
  if (!current.failures && !current.blockedUntil) return;
  writeState({ failures: Math.max(0, current.failures - 1), blockedUntil: current.blockedUntil > Date.now() ? current.blockedUntil : 0 });
}

export function geminiCapacityWaitMs() {
  if (!getGeminiCapacitySettings().enabled) return 0;
  return Math.max(0, readState().blockedUntil - Date.now());
}
