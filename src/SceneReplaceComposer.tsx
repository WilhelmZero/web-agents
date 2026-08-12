import { BulbOutlined, ClearOutlined, DeleteOutlined, DownloadOutlined, ExpandOutlined, EyeOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Modal, Popconfirm, Progress, Radio, Segmented, Select, Space, Statistic, Switch, Tag, Tooltip, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { reportTaskProgress } from './services/taskProgress';
import { DEFAULT_SCENE_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import ImageInfoTooltip from './ImageInfoTooltip';
import { generateSceneReplacementImage, optimizeSceneReplacePrompt } from './services/gemini';
import { optimizeScenePromptOpenAi } from './services/promptOptimizer';
import { editPaperTextOpenAi } from './services/paperText';
import { buildOutpaintPrompt, closestAspectRatio, prepareOutpaintInput } from './services/outpaint';
import { readLocalStorage } from './storage';
import type { ImageModel, LogoAsset, SceneReplaceSettings, SceneReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, formatFileTimestamp, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';
import { BUILT_IN_SCENE_REPLACE_PRESETS, normalizeCustomScenePresets, SCENE_PRESET_EMOJIS, type SceneReplacePreset } from './services/sceneReplacePresets';
import { recommendSceneTheme, SCENE_COMMON_CONSTRAINT } from './services/sceneThemeRecommendation';
import { detectWhiteBackground } from './services/whiteBackgroundDetection';
import { buildSceneReplacementPrompt } from './services/sceneReplacementPrompt';

const { Text, Title, Paragraph } = Typography;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;
type SceneModel = SceneReplaceSettings['imageModel'];
const isOpenAiModel = (model: SceneModel) => model.startsWith('gpt-image-');
const OUTPAINT_PRESETS = [{ label: '超宽屏 3200 × 1310', value: '3200x1310', width: 3200, height: 1310 }, { label: '横版 1800 × 1350', value: '1800x1350', width: 1800, height: 1350 }, { label: '自定义尺寸', value: 'custom' }];
const DUAL_OUTPAINT_SIZES = [{ width: 3200, height: 1310 }, { width: 1800, height: 1350 }] as const;
const MODEL_OPTIONS = [{ label: 'GPT（OpenAI 官方直连）', options: [{ value: 'gpt-image-2', label: 'GPT Image 2（推荐）' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] }, { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) }];

function statusLabel(status: SceneReplaceTask['status']) {
  return status === 'waiting' ? '排队中' : status === 'running' ? '替换中' : status === 'success' ? '替换成功' : status === 'failed' ? '替换失败' : '已停止';
}

export default function SceneReplaceComposer({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost, initialPrompt, automationStartToken, automationRetryFailedToken, automationStopToken, onProgressChange, onResultsChange }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void; settingsHost?: HTMLElement | null;
  initialPrompt?: string; automationStartToken?: string; automationRetryFailedToken?: string; automationStopToken?: string; onProgressChange?: (progress: { total: number; completed: number; failed: number; running: boolean }) => void; onResultsChange?: (tasks: SceneReplaceTask[]) => void;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<SceneReplaceSettings>(() => ({ ...DEFAULT_SCENE_REPLACE_SETTINGS, ...readLocalStorage(STORAGE_KEYS.sceneReplaceSettings, {}) }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sceneThemes, setSceneThemes] = useState<Record<string, string>>({});
  const [whiteBackgroundSceneIds, setWhiteBackgroundSceneIds] = useState<string[]>([]);
  const [detectingWhiteSceneIds, setDetectingWhiteSceneIds] = useState<string[]>([]);
  const [recommendingSceneIds, setRecommendingSceneIds] = useState<string[]>([]);
  const recommendingSceneIdsRef = useRef(new Set<string>());
  const [optimizingPrompt, setOptimizingPrompt] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const [customPresets, setCustomPresets] = useState<SceneReplacePreset[]>(() => normalizeCustomScenePresets(readLocalStorage(STORAGE_KEYS.sceneReplacePresets, [])));
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [presetDraft, setPresetDraft] = useState({ name: '', icon: '✨', content: '' });
  const [tasks, setTasks] = useState<SceneReplaceTask[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string>();
  const [previewCompareOriginal, setPreviewCompareOriginal] = useState(false);
  const [directPreviewOriginal, setDirectPreviewOriginal] = useState(false);
  const [compareOriginalTaskIds, setCompareOriginalTaskIds] = useState<Set<string>>(() => new Set());
  const running = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const retryTimers = useRef(new Map<string, number>());
  const scenesRef = useRef(scenes);
  const settingsRef = useRef(settings);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(STORAGE_KEYS.sceneReplaceSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.sceneReplacePresets, JSON.stringify(customPresets)); }, [customPresets]);
  useEffect(() => { if (initialPrompt) setPrompt(initialPrompt); }, [initialPrompt]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || tasks.length || prompt.trim())), [scenes.length, tasks.length, prompt, onSessionStateChange]);

  const clearResults = () => { aborters.current.forEach((item) => item.abort()); retryTimers.current.forEach((timer) => window.clearTimeout(timer)); retryTimers.current.clear(); setTasks((current) => { current.forEach((item) => { if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); if (item.outpaintUrl) URL.revokeObjectURL(item.outpaintUrl); item.outpaintResults?.forEach((result) => URL.revokeObjectURL(result.url)); }); return []; }); setCompareOriginalTaskIds(new Set()); setSelectedResultId(undefined); };
  const patch = (value: Partial<SceneReplaceSettings>) => setSettings((current) => { const next = { ...current, ...value }; return value.imageModel && !isOpenAiModel(value.imageModel) ? { ...next, ...normalizeSettingsForModel(value.imageModel as ImageModel, next.aspectRatio, next.imageSize) } : next; });
  const valid = (file: File) => { if (!TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`); if (!file.size || file.size > MAX_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`); return true; };
  const recommendThemes = async (items: LogoAsset[]) => {
    const config = settingsRef.current; if (!config.autoRecommendScene || !items.length) return;
    const pending = items.filter((item) => !sceneThemes[item.id] && !recommendingSceneIdsRef.current.has(item.id));
    if (!pending.length) return;
    const provider = config.sceneRecommendationProvider; const key = provider === 'openai' ? openAiApiKey : apiKey;
    if (!key || (provider === 'gemini' && connectionMode === 'proxy' && !apiBaseUrl)) { onRequestKey(); message.warning('请先配置自动推荐场景所需的 API Key'); return; }
    pending.forEach((item) => recommendingSceneIdsRef.current.add(item.id));
    setRecommendingSceneIds((current) => [...new Set([...current, ...pending.map((item) => item.id)])]);
    let cursor = 0; await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => { while (cursor < pending.length) { const item = pending[cursor++]; try { const theme = await recommendSceneTheme({ provider, apiKey: key, apiBaseUrl, geminiModel: config.sceneRecommendationModel, openAiModel: config.openAiSceneRecommendationModel, image: item.file }); setSceneThemes((current) => ({ ...current, [item.id]: theme })); } catch (error) { message.error(`${item.name}：${error instanceof Error ? error.message : '场景推荐失败'}`); } finally { recommendingSceneIdsRef.current.delete(item.id); setRecommendingSceneIds((current) => current.filter((id) => id !== item.id)); } } }));
  };
  const scanWhiteBackgrounds = async (items: LogoAsset[]) => {
    if (!settingsRef.current.autoSkipWhiteBackground || !items.length) return;
    setDetectingWhiteSceneIds((current) => [...new Set([...current, ...items.map((item) => item.id)])]);
    await Promise.all(items.map(async (item) => { try { const result = await detectWhiteBackground(item.file); if (result.isWhiteBackground) setWhiteBackgroundSceneIds((current) => [...new Set([...current, item.id])]); } catch { /* unreadable images remain eligible */ } finally { setDetectingWhiteSceneIds((current) => current.filter((id) => id !== item.id)); } }));
  };
  const addScenes = (files: File[]) => { const next = files.filter((file) => valid(file) === true).map((file) => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) })); if (next.length) { clearResults(); setScenes((current) => [...current, ...next].slice(0, 20)); void scanWhiteBackgrounds(next); if (settingsRef.current.autoRecommendScene) { if (!prompt.trim()) setPrompt(SCENE_COMMON_CONSTRAINT); } } return false; };
  const removeScene = (id: string) => { clearResults(); setWhiteBackgroundSceneIds((current) => current.filter((item) => item !== id)); setSceneThemes((current) => { const next = { ...current }; delete next[id]; return next; }); setScenes((current) => { const found = current.find((item) => item.id === id); if (found) URL.revokeObjectURL(found.previewUrl); return current.filter((item) => item.id !== id); }); };
  const clearScenes = () => { clearResults(); setSceneThemes({}); setWhiteBackgroundSceneIds([]); setScenes((current) => { current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); return []; }); };
  useEffect(() => {
    if (!settings.autoRecommendScene) return;
    const missing = scenes.filter((scene) => !(settings.autoSkipWhiteBackground && whiteBackgroundSceneIds.includes(scene.id)) && !sceneThemes[scene.id] && !recommendingSceneIdsRef.current.has(scene.id));
    if (missing.length) void recommendThemes(missing);
  }, [settings.autoRecommendScene, settings.autoSkipWhiteBackground, scenes, sceneThemes, whiteBackgroundSceneIds, apiKey, openAiApiKey, apiBaseUrl]);

  const outpaintTask = useCallback(async (taskId: string, source: Blob, signal: AbortSignal, requestedSize?: { width: number; height: number }) => {
    const config = settingsRef.current;
    if (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey) throw new Error('请先在右上角配置所选扩图模型的 API Key');
    if (!isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) throw new Error('请先配置 Gemini 代理地址');
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, outpaintStatus: 'running', outpaintError: undefined } : item));
    try {
      const sourceFile = new File([source], `scene-${taskId}.png`, { type: source.type || 'image/png' });
      const sizes = requestedSize ? [requestedSize] : config.outpaintBothSizes ? DUAL_OUTPAINT_SIZES : [{ width: config.outpaintWidth, height: config.outpaintHeight }];
      const results = await Promise.all(sizes.map(async ({ width, height }) => {
        const prepared = await prepareOutpaintInput(sourceFile, width, height);
        const outpaintPrompt = buildOutpaintPrompt(config.outpaintPrompt, width, height);
        const blob = isOpenAiModel(config.outpaintImageModel)
          ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: config.outpaintImageModel, image: prepared.file, mask: prepared.mask, prompt: outpaintPrompt, quality: config.outpaintQuality, signal })
          : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: config.outpaintImageModel as ImageModel, image: prepared.file, imageSize: config.outpaintImageSize, aspectRatio: closestAspectRatio(width, height, MODEL_CAPABILITIES[config.outpaintImageModel as ImageModel].aspectRatios), prompt: outpaintPrompt })).blob;
        return { width, height, blob, url: URL.createObjectURL(blob) };
      }));
      setTasks((current) => current.map((item) => {
        if (item.id !== taskId) return item;
        const previous = item.outpaintResults || [];
        if (requestedSize) previous.filter((result) => result.width === requestedSize.width && result.height === requestedSize.height).forEach((result) => URL.revokeObjectURL(result.url));
        else { if (item.outpaintUrl) URL.revokeObjectURL(item.outpaintUrl); previous.forEach((result) => URL.revokeObjectURL(result.url)); }
        const merged = requestedSize ? [...previous.filter((result) => result.width !== requestedSize.width || result.height !== requestedSize.height), ...results].sort((a, b) => DUAL_OUTPAINT_SIZES.findIndex((size) => size.width === a.width && size.height === a.height) - DUAL_OUTPAINT_SIZES.findIndex((size) => size.width === b.width && size.height === b.height)) : results;
        return { ...item, outpaintStatus: 'success', outpaintBlob: merged[0].blob, outpaintUrl: merged[0].url, outpaintResults: merged };
      }));
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === taskId ? { ...item, outpaintStatus: signal.aborted ? 'stopped' : 'failed', outpaintError: signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '扩图失败' } : item));
    }
  }, [apiKey, openAiApiKey, apiBaseUrl, connectionMode]);

  const execute = useCallback(async (task: SceneReplaceTask) => {
    if (running.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId); if (!scene) return;
    running.current.add(task.id); const controller = new AbortController(); aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const config = settingsRef.current;
      if (isOpenAiModel(config.imageModel) ? !openAiApiKey : !apiKey) throw new Error('请先在右上角配置所选场景模型的 API Key');
      const resultBlob = isOpenAiModel(config.imageModel)
        ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: config.imageModel, image: scene.file, prompt: task.prompt, quality: config.imageQuality, signal: controller.signal })
        : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal: controller.signal, model: config.imageModel as ImageModel, prompt: task.prompt, image: scene.file, aspectRatio: config.ratioMode === 'fixed' ? config.aspectRatio : undefined, imageSize: config.imageSize })).blob;
      const resultUrl = URL.createObjectURL(resultBlob);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob, resultUrl, resultMimeType: resultBlob.type || 'image/png', outpaintStatus: 'idle' } : item));
      if (config.autoOutpaint) await outpaintTask(task.id, resultBlob, controller.signal);
    } catch (error) {
      const stopped = controller.signal.aborted; const config = settingsRef.current; const detail = error instanceof Error ? error.message : '场景替换失败';
      if (!stopped && config.autoRetryErrors && task.retryCount < config.errorRetryLimit) {
        const delayMs = Math.max(1, config.errorRetryDelaySeconds) * 1000; const nextRetryAt = Date.now() + delayMs;
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'waiting', error: `${detail}；将在 ${config.errorRetryDelaySeconds} 秒后自动重试`, retryCount: item.retryCount + 1, nextRetryAt } : item));
        const timer = window.setTimeout(() => { retryTimers.current.delete(task.id); setTasks((current) => current.map((item) => item.id === task.id && !item.autoRetryStopped ? { ...item, nextRetryAt: undefined, error: undefined } : item)); }, delayMs);
        retryTimers.current.set(task.id, timer);
      } else setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : detail, nextRetryAt: undefined } : item));
    }
    finally { running.current.delete(task.id); aborters.current.delete(task.id); }
  }, [apiKey, openAiApiKey, apiBaseUrl, outpaintTask]);
  useEffect(() => { const free = Math.max(0, settings.concurrency - running.current.size); tasks.filter((item) => item.status === 'waiting' && !item.nextRetryAt && !item.autoRetryStopped && !running.current.has(item.id)).slice(0, free).forEach((item) => void execute(item)); }, [tasks, settings.concurrency, execute]);
  const start = () => {
    const config = settingsRef.current; if (isOpenAiModel(config.imageModel) ? !openAiApiKey : !apiKey) return onRequestKey(); if (!isOpenAiModel(config.imageModel) && connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (config.autoOutpaint && (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey)) return onRequestKey();
    if (config.autoOutpaint && !isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置 Gemini 代理地址'); return onRequestKey(); }
    const eligible = settings.autoSkipWhiteBackground ? scenes.filter((scene) => !whiteBackgroundSceneIds.includes(scene.id)) : scenes;
    if (!eligible.length) return void message.warning('没有可参与生成的场景图，请关闭白底图跳过开关或上传非白底图'); if (!prompt.trim()) return void message.warning('请选择预设或填写目标场景提示词');
    if (settings.autoRecommendScene && eligible.some((scene) => !sceneThemes[scene.id])) return void message.warning('请等待所有参与生成的图片完成场景推荐，或手动填写缺少的主题');
    clearResults(); setTasks(eligible.flatMap((scene) => { const sceneIndex = scenes.findIndex((item) => item.id === scene.id); const targetPrompt = settings.autoRecommendScene ? `${sceneThemes[scene.id]}，${prompt.trim()}` : prompt.trim(); return Array.from({ length: settings.copiesPerScene }, (_, copyIndex) => ({ id: createId(), sceneId: scene.id, sceneIndex, copyIndex, status: 'waiting' as const, prompt: buildSceneReplacementPrompt(targetPrompt), retryCount: 0 })); }));
  };
  const lastAutomationStart = useRef<string | undefined>(undefined);
  useEffect(() => { if (!automationStartToken || lastAutomationStart.current === automationStartToken || !scenes.length || !prompt.trim()) return; lastAutomationStart.current = automationStartToken; start(); }, [automationStartToken, scenes.length, prompt]);
  const stop = () => { aborters.current.forEach((item) => item.abort()); retryTimers.current.forEach((timer) => window.clearTimeout(timer)); retryTimers.current.clear(); setTasks((current) => current.map((item) => item.status === 'waiting' ? { ...item, status: 'stopped', nextRetryAt: undefined } : item)); };
  const lastAutomationStop = useRef<string | undefined>(undefined);
  useEffect(() => { if (!automationStopToken || lastAutomationStop.current === automationStopToken) return; lastAutomationStop.current = automationStopToken; stop(); }, [automationStopToken]);
  const stopTask = (id: string) => { const timer = retryTimers.current.get(id); if (timer) window.clearTimeout(timer); retryTimers.current.delete(id); aborters.current.get(id)?.abort(); setTasks((current) => current.map((item) => item.id === id ? { ...item, status: 'stopped', autoRetryStopped: true, nextRetryAt: undefined, error: '已停止该任务' } : item)); };
  const resetForRetry = useCallback((task: SceneReplaceTask) => { if (task.resultUrl) URL.revokeObjectURL(task.resultUrl); if (task.outpaintUrl) URL.revokeObjectURL(task.outpaintUrl); task.outpaintResults?.forEach((result) => URL.revokeObjectURL(result.url)); const timer = retryTimers.current.get(task.id); if (timer) window.clearTimeout(timer); retryTimers.current.delete(task.id); return { ...task, status: 'waiting' as const, error: undefined, resultBlob: undefined, resultUrl: undefined, outpaintStatus: 'idle' as const, outpaintBlob: undefined, outpaintUrl: undefined, outpaintResults: undefined, outpaintError: undefined, retryCount: 0, nextRetryAt: undefined, autoRetryStopped: false }; }, []);
  const retry = (task: SceneReplaceTask) => { const next = resetForRetry(task); setTasks((current) => current.map((item) => item.id === task.id ? next : item)); setSelectedResultId(undefined); };
  const retryAllFailed = useCallback(() => { setTasks((current) => current.map((item) => item.status === 'failed' ? resetForRetry(item) : item)); setSelectedResultId(undefined); }, [resetForRetry]);
  const lastAutomationRetry = useRef<string | undefined>(undefined);
  useEffect(() => { if (!automationRetryFailedToken || lastAutomationRetry.current === automationRetryFailedToken) return; lastAutomationRetry.current = automationRetryFailedToken; retryAllFailed(); }, [automationRetryFailedToken, retryAllFailed]);
  const manualOutpaint = async (targets: SceneReplaceTask[]) => {
    const config = settingsRef.current;
    if (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey) return onRequestKey();
    if (!isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey();
    const eligible = targets.filter((item) => item.resultBlob && item.outpaintStatus !== 'running'); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(config.concurrency, eligible.length) }, async () => { while (cursor < eligible.length) { const item = eligible[cursor++]; const controller = new AbortController(); aborters.current.set(`outpaint-${item.id}`, controller); try { await outpaintTask(item.id, item.resultBlob!, controller.signal); } catch { /* error is displayed on the result card */ } finally { aborters.current.delete(`outpaint-${item.id}`); } } }));
  };
  const reOutpaintOne = async (task: SceneReplaceTask, size: { width: number; height: number }) => {
    if (!task.resultBlob || task.outpaintStatus === 'running') return;
    const controller = new AbortController(); aborters.current.set(`outpaint-${task.id}-${size.width}x${size.height}`, controller);
    try { await outpaintTask(task.id, task.resultBlob, controller.signal, size); }
    finally { aborters.current.delete(`outpaint-${task.id}-${size.width}x${size.height}`); }
  };
  const success = tasks.filter((item) => item.status === 'success' && item.resultBlob); const busy = tasks.some((item) => item.status === 'waiting' || item.status === 'running' || item.outpaintStatus === 'running'); const done = tasks.filter((item) => ['success', 'failed', 'stopped'].includes(item.status) && item.outpaintStatus !== 'running').length;
  useEffect(() => { reportTaskProgress({ id: 'scene-replace', label: '场景替换', completed: done, total: tasks.length, failed: tasks.filter((task) => task.status === 'failed').length, running: busy }); }, [done, tasks, busy]);
  useEffect(() => { onProgressChange?.({ total: tasks.length, completed: done, failed: tasks.filter((task) => task.status === 'failed').length, running: busy }); onResultsChange?.(tasks); }, [tasks, done, busy, onProgressChange, onResultsChange]);
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((item) => item.sceneId === scene.id) })).filter((item) => item.tasks.length), [scenes, tasks]);
  const allPresets = useMemo(() => [...BUILT_IN_SCENE_REPLACE_PRESETS, ...customPresets], [customPresets]);
  const resultItems = useMemo(() => tasks.flatMap((task) => { const scene = scenes.find((item) => item.id === task.sceneId); return scene ? [{ task, scene }] : []; }), [tasks, scenes]);
  const directPreviewItems = useMemo(() => resultItems.flatMap(({ task, scene }) => {
    const shownUrl = task.outpaintResults?.[0]?.url || task.outpaintUrl || task.resultUrl;
    return shownUrl ? [{ taskId: task.id, shownUrl, originalUrl: scene.previewUrl }] : [];
  }), [resultItems]);
  const selectedResult = resultItems.find((item) => item.task.id === selectedResultId);
  const selectedResultGroup = selectedResult ? resultItems.filter((item) => item.task.sceneId === selectedResult.task.sceneId) : [];
  const selectedOutpaintResults = selectedResultGroup.flatMap(({ task, scene }) => (task.outpaintResults || (task.outpaintBlob && task.outpaintUrl ? [{ width: settings.outpaintWidth, height: settings.outpaintHeight, blob: task.outpaintBlob, url: task.outpaintUrl }] : [])).map((result) => ({ task, scene, result })));
  const comparisonSourceAt = (index: number) => index < selectedResultGroup.length
    ? selectedResult?.scene.previewUrl
    : selectedOutpaintResults[index - selectedResultGroup.length]?.task.resultUrl;
  const openPresetEditor = () => { setPresetDraft({ name: '', icon: '✨', content: prompt.trim() }); setPresetEditorOpen(true); };
  const savePreset = () => {
    if (!presetDraft.name.trim() || !presetDraft.icon.trim() || !presetDraft.content.trim()) return void message.warning('请填写预设名称、图标和提示词');
    const next = { id: createId(), name: presetDraft.name.trim(), icon: presetDraft.icon.trim(), content: presetDraft.content.trim() };
    setCustomPresets((current) => [...current, next]); setSelectedPreset(next.id); setPrompt(next.content); setPresetEditorOpen(false); message.success('自定义提示词预设已保存到本地');
  };
  const optimizeScenePrompt = async () => {
    if (!prompt.trim()) return void message.warning('请先填写需要优化的场景提示词');
    const provider = settings.promptOptimizerProvider;
    if (provider === 'openai' ? !openAiApiKey : !apiKey) return onRequestKey();
    if (provider === 'gemini' && connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey();
    setOptimizingPrompt(true);
    try {
      const optimized = provider === 'openai'
        ? await optimizeScenePromptOpenAi({ apiKey: openAiApiKey, model: settings.openAiPromptOptimizerModel, prompt })
        : await optimizeSceneReplacePrompt({ apiKey, apiBaseUrl, model: settings.promptOptimizerModel, prompt });
      setPrompt(optimized); setSelectedPreset(undefined); message.success('提示词优化完成，可继续手动修改');
    } catch (error) { message.error(error instanceof Error ? error.message : '提示词优化失败'); }
    finally { setOptimizingPrompt(false); }
  };
  const fileName = (task: SceneReplaceTask, scene: LogoAsset, size?: { width: number; height: number }) => `${String(task.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}_${size ? `扩图_${size.width}x${size.height}` : '场景替换'}_${String(task.copyIndex + 1).padStart(2, '0')}.${size ? 'png' : mimeExtension(task.resultMimeType)}`;
  const downloadTaskGroup = async (task: SceneReplaceTask, scene: LogoAsset) => {
    if (!task.resultBlob) return;
    const zip = new JSZip(); zip.file(fileName(task, scene), task.resultBlob);
    const outpaintResults = task.outpaintResults || (task.outpaintBlob ? [{ width: settings.outpaintWidth, height: settings.outpaintHeight, blob: task.outpaintBlob }] : []);
    outpaintResults.forEach((result) => zip.file(fileName(task, scene, result), result.blob));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${sanitizeFileName(scene.name)}_结果_${String(task.copyIndex + 1).padStart(2, '0')}.zip`);
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    groups.forEach(({ scene, tasks: items }) => {
      const folder = zip.folder(`${String(items[0]?.sceneIndex + 1 || 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}`);
      items.forEach((item) => {
        const resultNumber = String(item.copyIndex + 1).padStart(2, '0');
        if (item.resultBlob) folder?.file(`场景替换_${resultNumber}.${mimeExtension(item.resultMimeType)}`, item.resultBlob);
        const outpaintResults = item.outpaintResults || (item.outpaintBlob ? [{ width: settings.outpaintWidth, height: settings.outpaintHeight, blob: item.outpaintBlob }] : []);
        outpaintResults.forEach((result) => folder?.file(`扩图_${resultNumber}_${result.width}x${result.height}.png`, result.blob));
      });
    });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `SceneStudio_场景替换结果_${formatFileTimestamp()}.zip`);
  };

  const selectedOutpaintPreset = OUTPAINT_PRESETS.find((item) => item.width === settings.outpaintWidth && item.height === settings.outpaintHeight)?.value || 'custom';
  const eligibleSceneCount = settings.autoSkipWhiteBackground ? scenes.length - whiteBackgroundSceneIds.length : scenes.length;
  const panel = <div className="settings-panel scene-replace-settings-panel"><Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>场景替换设置</Title><Tag color="cyan">SCENE</Tag></Flex><Form layout="vertical" style={{ marginTop: 20 }}>
    <Form.Item label="自动跳过白底图"><Flex justify="space-between" align="center"><Text>本地算法识别白底商品图，灰显且不参与生成</Text><Switch checked={settings.autoSkipWhiteBackground} onChange={(autoSkipWhiteBackground) => { patch({ autoSkipWhiteBackground }); if (autoSkipWhiteBackground) void scanWhiteBackgrounds(scenes.filter((scene) => !whiteBackgroundSceneIds.includes(scene.id))); }} /></Flex></Form.Item>
    <Form.Item label="上传后自动推荐场景"><Flex justify="space-between" align="center"><Text>扫描杯子、人物和构图，生成非节日场景主题</Text><Switch checked={settings.autoRecommendScene} onChange={(autoRecommendScene) => { patch({ autoRecommendScene }); if (autoRecommendScene) { setPrompt((current) => current.trim() || SCENE_COMMON_CONSTRAINT); void recommendThemes(scenes); } }} /></Flex>{settings.autoRecommendScene && <Space.Compact style={{ width: '100%', marginTop: 10 }}><Select value={settings.sceneRecommendationProvider} onChange={(sceneRecommendationProvider) => patch({ sceneRecommendationProvider })} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} />{settings.sceneRecommendationProvider === 'openai' ? <Select value={settings.openAiSceneRecommendationModel} onChange={(openAiSceneRecommendationModel) => patch({ openAiSceneRecommendationModel })} options={[{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }, { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }]} /> : <Select value={settings.sceneRecommendationModel} onChange={(sceneRecommendationModel) => patch({ sceneRecommendationModel })} options={[{ value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }, { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' }, { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]} />}</Space.Compact>}</Form.Item>
    <Form.Item label="场景替换图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patch({ imageModel })} options={MODEL_OPTIONS} /></Form.Item>
    {isOpenAiModel(settings.imageModel) ? <Form.Item label="GPT 输出质量"><Select value={settings.imageQuality} onChange={(imageQuality) => patch({ imageQuality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item> : <><Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patch({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patch({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item><Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patch({ imageSize: imageSize as SceneReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].imageSizes} /></Form.Item></>}
    <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(value) => patch({ copiesPerScene: value || 1 })} style={{ width: '100%' }} /></Form.Item>
    <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(value) => patch({ concurrency: value || 1 })} style={{ width: '100%' }} /></Form.Item>
    <Form.Item label="错误自动重试"><Flex justify="space-between" align="center"><Text>接口或并发错误后无人值守重试</Text><Switch checked={settings.autoRetryErrors} onChange={(autoRetryErrors) => patch({ autoRetryErrors })} /></Flex>{settings.autoRetryErrors && <Space direction="vertical" style={{ width: '100%', marginTop: 10 }}><Flex justify="space-between"><Text>最多重试次数</Text><InputNumber min={1} max={20} value={settings.errorRetryLimit} onChange={(errorRetryLimit) => patch({ errorRetryLimit: errorRetryLimit || 1 })} /></Flex><Flex justify="space-between"><Text>失败后等待时间</Text><InputNumber min={5} max={3600} addonAfter="秒" value={settings.errorRetryDelaySeconds} onChange={(errorRetryDelaySeconds) => patch({ errorRetryDelaySeconds: errorRetryDelaySeconds || 30 })} /></Flex></Space>}</Form.Item>
    <Form.Item label="生成后自动扩图"><Switch checked={settings.autoOutpaint} onChange={(autoOutpaint) => patch({ autoOutpaint })} /><Text type="secondary" style={{ marginLeft: 10 }}>{settings.autoOutpaint ? '场景替换完成后自动扩图' : '可在结果区手动扩图'}</Text></Form.Item>
    <Card size="small" title="扩图设置（自动与手动共用）" style={{ marginBottom: 16 }}><Form.Item label="扩图图片模型"><Select value={settings.outpaintImageModel} onChange={(outpaintImageModel) => patch({ outpaintImageModel })} options={MODEL_OPTIONS} /></Form.Item>{isOpenAiModel(settings.outpaintImageModel) ? <Form.Item label="GPT 扩图质量"><Select value={settings.outpaintQuality} onChange={(outpaintQuality) => patch({ outpaintQuality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item> : <Form.Item label="扩图生成质量"><Segmented block value={settings.outpaintImageSize} onChange={(outpaintImageSize) => patch({ outpaintImageSize: outpaintImageSize as SceneReplaceSettings['outpaintImageSize'] })} options={MODEL_CAPABILITIES[settings.outpaintImageModel as ImageModel].imageSizes} /></Form.Item>}<Form.Item label="同时输出两个常用尺寸"><Switch checked={settings.outpaintBothSizes} onChange={(outpaintBothSizes) => patch({ outpaintBothSizes })} /><Text type="secondary" style={{ marginLeft: 10 }}>3200 × 1310 与 1800 × 1350</Text></Form.Item><Form.Item label="输出尺寸预设"><Select disabled={settings.outpaintBothSizes} value={selectedOutpaintPreset} options={OUTPAINT_PRESETS} onChange={(value) => { const preset = OUTPAINT_PRESETS.find((item) => item.value === value); if (preset?.width && preset.height) patch({ outpaintWidth: preset.width, outpaintHeight: preset.height }); }} /></Form.Item><Flex gap={8}><Form.Item label="宽度" style={{ flex: 1 }}><InputNumber disabled={settings.outpaintBothSizes} min={64} max={8192} value={settings.outpaintWidth} onChange={(outpaintWidth) => patch({ outpaintWidth: outpaintWidth || 64 })} style={{ width: '100%' }} /></Form.Item><Form.Item label="高度" style={{ flex: 1 }}><InputNumber disabled={settings.outpaintBothSizes} min={64} max={8192} value={settings.outpaintHeight} onChange={(outpaintHeight) => patch({ outpaintHeight: outpaintHeight || 64 })} style={{ width: '100%' }} /></Form.Item></Flex><Form.Item label="扩图提示词"><Input.TextArea value={settings.outpaintPrompt} onChange={(event) => patch({ outpaintPrompt: event.target.value })} autoSize={{ minRows: 3, maxRows: 7 }} /></Form.Item></Card>
  </Form>{!isOpenAiModel(settings.imageModel) && <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel as ImageModel, settings.imageSize, eligibleSceneCount * settings.copiesPerScene)} /><Text type="secondary">按 {eligibleSceneCount * settings.copiesPerScene} 个请求估算。</Text></Card>}</div>;

  return <div className="scene-replace-page"><section className="hero-strip scene-replace-hero"><div><Text className="eyebrow">SCENE REPLACER</Text><Title level={2}>保留主体，只替换场景与氛围</Title><Paragraph className="hero-description">批量改造已有场景图，锁定人物、产品、Logo、文字和构图，让新环境的光线自然融入原图。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传原始场景图</span></Space>} extra={<Space><Text type="secondary">{scenes.length} / 20</Text>{!!scenes.length && <Popconfirm title="清空所有场景图？" onConfirm={clearScenes}><Button size="small" danger>清空全部</Button></Popconfirm>}</Space>}>{!scenes.length ? <Upload.Dragger multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴原始场景图</p><p className="ant-upload-hint">支持最多 20 张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className={`replace-scene-card${settings.autoSkipWhiteBackground && whiteBackgroundSceneIds.includes(scene.id) ? ' is-white-background' : ''}`} key={scene.id}><div className="replace-scene-image-wrap"><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} />{detectingWhiteSceneIds.includes(scene.id) && <Tag color="processing" className="white-background-badge">检测底色</Tag>}{settings.autoSkipWhiteBackground && whiteBackgroundSceneIds.includes(scene.id) && <Tag className="white-background-badge">白底图 · 已跳过</Tag>}</div><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button>{settings.autoRecommendScene && <div className="scene-card-theme-editor"><Flex justify="space-between" align="center"><Text strong>推荐主题</Text>{recommendingSceneIds.includes(scene.id) ? <Tag color="processing">自动分析中</Tag> : sceneThemes[scene.id] ? <Tag color="green">已推荐</Tag> : <Tag>等待自动分析</Tag>}</Flex><Input.TextArea rows={3} value={sceneThemes[scene.id] || ''} placeholder="正在自动识别杯型并推荐场景…" onChange={(event) => setSceneThemes((current) => ({ ...current, [scene.id]: event.target.value }))} /></div>}</div>)}<Upload multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}</Card>
<Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>{settings.autoRecommendScene ? '输入公共提示词' : '选择并编辑目标场景'}</span></Space>}><div className="scene-replace-editor">{!settings.autoRecommendScene && <div><Flex justify="space-between" align="center"><Text strong>提示词预设</Text><Button size="small" icon={<PlusOutlined />} onClick={openPresetEditor}>新增预设</Button></Flex><div className="scene-preset-grid">{allPresets.map((preset) => <div role="button" tabIndex={0} key={preset.id} className={selectedPreset === preset.id ? 'scene-preset-card is-selected' : 'scene-preset-card'} onClick={() => { setSelectedPreset(preset.id); setPrompt(preset.content); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setSelectedPreset(preset.id); setPrompt(preset.content); } }}><span>{preset.icon}</span><b>{preset.name}</b>{!preset.builtIn && <Button className="scene-preset-delete" type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除 ${preset.name}`} onClick={(event) => { event.stopPropagation(); setCustomPresets((current) => current.filter((item) => item.id !== preset.id)); if (selectedPreset === preset.id) setSelectedPreset(undefined); }} />}</div>)}</div></div>}<div className="scene-prompt-editor"><Flex justify="space-between" align="center"><Text strong>{settings.autoRecommendScene ? '公共约束提示词' : '发送给模型的完整提示词（可直接修改）'}</Text>{selectedPreset && <Button type="link" size="small" onClick={() => { setSelectedPreset(undefined); setPrompt(''); }}>清除选择</Button>}</Flex><Input.TextArea value={prompt} onChange={(event) => { setPrompt(event.target.value); setSelectedPreset(undefined); }} placeholder="例如：改为海边度假主题，严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果" autoSize={{ minRows: 9, maxRows: 15 }} showCount maxLength={3000} /><div className="scene-prompt-optimizer"><Segmented value={settings.promptOptimizerProvider} onChange={(promptOptimizerProvider) => patch({ promptOptimizerProvider: promptOptimizerProvider as SceneReplaceSettings['promptOptimizerProvider'] })} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} />{settings.promptOptimizerProvider === 'openai' ? <Select value={settings.openAiPromptOptimizerModel} onChange={(openAiPromptOptimizerModel) => patch({ openAiPromptOptimizerModel })} options={[{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra（推荐）' }, { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol（最高质量）' }, { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（低成本）' }]} /> : <Select value={settings.promptOptimizerModel} onChange={(promptOptimizerModel) => patch({ promptOptimizerModel })} options={[{ value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }, { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' }, { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]} />}<Button type="primary" icon={<BulbOutlined />} loading={optimizingPrompt} onClick={() => void optimizeScenePrompt()}>优化提示词</Button></div><Alert type="info" showIcon title="完整提示词完全由你控制" description="优化会增强摄影和场景描述，同时保留原提示词中的杯子、人物位置、动作和手势等硬性约束；优化结果仍可继续修改。" /><Button icon={<PlusOutlined />} onClick={openPresetEditor}>将当前提示词保存为预设</Button></div></div></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {eligibleSceneCount * settings.copiesPerScene} 张图片</Title><Text type="secondary">{eligibleSceneCount} 张参与生成{settings.autoSkipWhiteBackground && whiteBackgroundSceneIds.length > 0 ? ` · ${whiteBackgroundSceneIds.length} 张白底图已跳过` : ''} × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{tasks.some((item) => item.status === 'failed') && <Button icon={<ReloadOutlined />} onClick={retryAllFailed}>一键重试所有失败</Button>}{busy && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} onClick={start}>{busy ? '正在替换' : '开始场景替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((done / tasks.length) * 100)} status={busy ? 'active' : success.length ? 'success' : 'exception'} />}</Card>
    <section className="results-section">
      <Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>场景替换结果</Title><Text type="secondary">点击生成图片可查看大图，并在弹窗中扩图或重新扩图</Text></div><Space><Button icon={<ExpandOutlined />} disabled={!success.length || success.some((item) => item.outpaintStatus === 'running')} onClick={() => void manualOutpaint(success)}>一键扩图全部</Button><Popconfirm title="清空全部结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!success.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
      {tasks.length ? <Image.PreviewGroup preview={{ onOpenChange: (open) => { if (!open) setDirectPreviewOriginal(false); }, onChange: () => setDirectPreviewOriginal(false), actionsRender: (originalNode) => <>{originalNode}<Tooltip title={directPreviewOriginal ? '查看生成图' : '查看当前生成图对应的上传原图'}><button type="button" className={directPreviewOriginal ? 'scene-preview-compare-action is-active' : 'scene-preview-compare-action'} onClick={(event) => { event.stopPropagation(); setDirectPreviewOriginal((current) => !current); }}><EyeOutlined /></button></Tooltip></>, imageRender: (originalNode) => { const source = (originalNode as ReactElement<{ src?: string }>).props.src; const current = directPreviewItems.find((item) => item.shownUrl === source); return directPreviewOriginal && current ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, { src: current.originalUrl, alt: '当前生成图对应的上传原图' }) : originalNode; } }}><div className="logo-replace-results scene-replace-results-grid">{resultItems.map(({ task, scene }) => {
        const primaryOutpaint = task.outpaintResults?.[0]; const shownUrl = primaryOutpaint?.url || task.outpaintUrl || task.resultUrl;
        const compareOriginal = compareOriginalTaskIds.has(task.id);
        return <Card key={task.id} size="small" title={<Text ellipsis={{ tooltip: scene.name }}>{sanitizeFileName(scene.name)} · 结果 {task.copyIndex + 1}</Text>} extra={task.resultBlob && <Button type="text" title="下载该组全部图片" icon={<DownloadOutlined />} onClick={() => void downloadTaskGroup(task, scene)} />}>{shownUrl ? <ImageInfoTooltip src={compareOriginal ? scene.previewUrl : shownUrl}><div className="scene-result-preview-trigger" onClick={() => setDirectPreviewOriginal(false)}><Image src={compareOriginal ? scene.previewUrl : shownUrl} alt={compareOriginal ? '上传的原始场景图' : '点击放大场景替换结果'} preview={{ src: shownUrl, mask: <EyeOutlined /> }} /></div></ImageInfoTooltip> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{task.nextRetryAt ? '等待自动重试' : statusLabel(task.status)}</Text><Text type="secondary">{task.error}</Text></div>}{task.copyIndex === 0 && task.resultUrl && <Button block size="small" style={{ marginTop: 8 }} icon={<EyeOutlined />} onClick={() => setCompareOriginalTaskIds((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>{compareOriginal ? '查看生成图' : '查看原图对比'}</Button>}<Button block style={{ marginTop: 8 }} icon={<ExpandOutlined />} disabled={!task.resultUrl} onClick={() => { setSelectedResultId(task.id); setPreviewCompareOriginal(false); }}>查看生成与扩图结果</Button><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={task.outpaintStatus === 'failed' || task.status === 'failed' ? 'error' : task.outpaintStatus === 'running' || task.status === 'running' ? 'processing' : task.status === 'success' ? 'success' : 'default'}>{task.nextRetryAt ? '等待重试' : task.outpaintStatus === 'running' ? '扩图中' : task.outpaintStatus === 'success' ? settings.outpaintBothSizes ? '双尺寸已扩图' : '已扩图' : task.outpaintStatus === 'failed' ? '扩图失败' : statusLabel(task.status)}</Tag><Space size={6}><Button size="small" icon={<ReloadOutlined />} disabled={task.status === 'running' || task.status === 'waiting' || task.outpaintStatus === 'running'} onClick={() => retry(task)}>重新生成</Button>{(task.status === 'running' || task.status === 'waiting') && <Button danger size="small" icon={<StopOutlined />} onClick={() => stopTask(task.id)}>停止</Button>}</Space></Flex></Card>;
      })}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传图片并开始替换后，结果会显示在这里" />}
    </section>
    <Modal className="scene-result-modal" width={960} title={selectedResult ? `${sanitizeFileName(selectedResult.scene.name)} · ${selectedResultGroup.length} 个生成结果` : '生成结果'} open={Boolean(selectedResult)} footer={<Button onClick={() => setSelectedResultId(undefined)}>关闭</Button>} onCancel={() => setSelectedResultId(undefined)} destroyOnHidden>
      {selectedResult && <Image.PreviewGroup preview={{ onOpenChange: (open) => { if (!open) setPreviewCompareOriginal(false); }, onChange: () => setPreviewCompareOriginal(false), actionsRender: (originalNode, info) => <>{originalNode}<Tooltip title={previewCompareOriginal ? '查看生成图' : info.current < selectedResultGroup.length ? '原始场景图对比' : '扩图前生成图对比'}><button type="button" className={previewCompareOriginal ? 'scene-preview-compare-action is-active' : 'scene-preview-compare-action'} onClick={() => setPreviewCompareOriginal((current) => !current)}><EyeOutlined /></button></Tooltip></>, imageRender: (originalNode, info) => previewCompareOriginal ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, { src: comparisonSourceAt(info.current), alt: info.current < selectedResultGroup.length ? '原始场景图' : '扩图前的场景替换生成图' }) : originalNode }}>
        <div className="scene-result-modal-section"><Flex justify="space-between" align="center"><Title level={5}>场景替换结果</Title><Text type="secondary">点击缩略图放大，左右切换全部图片</Text></Flex><div className="scene-result-thumbnail-row">{selectedResultGroup.map(({ task, scene }) => <div className="scene-result-thumbnail-item" key={`scene-${task.id}`}><ImageInfoTooltip src={task.resultUrl}><Image src={task.resultUrl} alt={`场景替换结果 ${task.copyIndex + 1}`} /></ImageInfoTooltip><Flex justify="space-between" align="center"><Text>结果 {task.copyIndex + 1}</Text><Space size={4}>{!task.outpaintResults?.length && <Button size="small" type="primary" icon={<ExpandOutlined />} loading={task.outpaintStatus === 'running'} onClick={() => void manualOutpaint([task])}>扩图</Button>}{task.resultBlob && <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadBlob(task.resultBlob!, fileName(task, scene))}>下载</Button>}</Space></Flex>{task.outpaintError && <Text type="danger">{task.outpaintError}</Text>}</div>)}</div></div>
        <div className="scene-result-modal-section"><Flex justify="space-between" align="center"><Title level={5}>AI 扩图结果</Title><Text type="secondary">原图对比使用该扩图实际基于的场景替换生成图</Text></Flex>{selectedOutpaintResults.length ? <div className="scene-result-thumbnail-row">{selectedOutpaintResults.map(({ task, scene, result }) => <div className="scene-result-thumbnail-item" key={`outpaint-${task.id}-${result.width}x${result.height}`}><ImageInfoTooltip src={result.url}><Image src={result.url} alt={`AI 扩图结果 ${result.width} × ${result.height}`} /></ImageInfoTooltip><Flex justify="space-between" align="center"><Text>{result.width} × {result.height}</Text><Space size={4}><Button size="small" icon={<ReloadOutlined />} loading={task.outpaintStatus === 'running'} onClick={() => void reOutpaintOne(task, result)}>重新扩图</Button><Button size="small" icon={<DownloadOutlined />} onClick={() => downloadBlob(result.blob, fileName(task, scene, result))}>下载</Button></Space></Flex></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成扩图，使用上方按钮开始扩图" />}</div>
      </Image.PreviewGroup>}
    </Modal>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
    <Modal title="新增场景提示词预设" open={presetEditorOpen} okText="保存预设" cancelText="取消" onOk={savePreset} onCancel={() => setPresetEditorOpen(false)}><Form layout="vertical"><Form.Item label="预设名称" required><Input value={presetDraft.name} maxLength={30} placeholder="例如：海岛度假" onChange={(event) => setPresetDraft((current) => ({ ...current, name: event.target.value }))} /></Form.Item><Form.Item label="图标" required><Input value={presetDraft.icon} maxLength={12} placeholder="可输入任意 Emoji 或文字" onChange={(event) => setPresetDraft((current) => ({ ...current, icon: event.target.value }))} /><div className="scene-emoji-picker">{SCENE_PRESET_EMOJIS.map((emoji) => <Button key={emoji} className={presetDraft.icon === emoji ? 'is-selected' : ''} onClick={() => setPresetDraft((current) => ({ ...current, icon: emoji }))}>{emoji}</Button>)}</div></Form.Item><Form.Item label="完整提示词" required><Input.TextArea value={presetDraft.content} autoSize={{ minRows: 5, maxRows: 10 }} maxLength={3000} placeholder="输入选择该预设后要发送给模型的完整提示词" onChange={(event) => setPresetDraft((current) => ({ ...current, content: event.target.value }))} /></Form.Item></Form></Modal>
  </div>;
}
