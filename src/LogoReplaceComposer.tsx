import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import JSZip from 'jszip';
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOGO_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import LogoReplaceDevComposer from './LogoReplaceDevComposer';
import { reportTaskProgress } from './services/taskProgress';
import { buildLogoReplacementInstruction, generateLogoReplacement, verifyLogoReplacement } from './services/gemini';
import { generateLogoReplacementOpenAi, verifyLogoReplacementOpenAi } from './services/logoReplaceOpenAi';
import { imageDimensions, outputAspectRatio, resizeImageBlob } from './services/logoOutputSizing';
import { assignReplacementLogos, buildLogoReplaceTasks, shouldAutoRetryLogoError } from './services/logoReplaceUtils';
import { readLocalStorage } from './storage';
import type { LogoAsset, LogoReplaceProgressSnapshot, LogoReplaceSettings, LogoReplaceTask, LogoReplaceTaskDetail, PerImagePromptAssignment } from './types';
import { createId, downloadBlob, estimateGptImage2HighOutputCostRange, estimateImageCost, normalizeSettingsForModel, sanitizeFileName } from './utils';
import { logoReplaceResultFileName } from './services/logoReplaceFileName';
import PsdLogoImportModal from './PsdLogoImportModal';
import { PerImagePromptEditor, usePerImagePrompts } from './usePerImagePrompts';
import { perImagePromptFileKey } from './services/perImagePrompt';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function statusText(status: LogoReplaceTask['status']) {
  if (status === 'waiting') return '排队中';
  if (status === 'running') return '生成中';
  if (status === 'success') return '替换成功';
  if (status === 'failed') return '替换失败';
  return '已停止';
}

export function buildActualReplacementPrompt(settings: LogoReplaceSettings, hasOldLogo: boolean, expectedText = '', correctionFeedback = '', perImagePrompt?: string) {
  const mandatoryPrompt = buildLogoReplacementInstruction({
    hasOldLogo,
    logoColorMode: settings.logoColorMode,
    customLogoColor: settings.customLogoColor,
    engravingMode: settings.engravingMode,
    glassEngravingEnabled: settings.glassEngravingEnabled,
    woodEngravingEnabled: settings.woodEngravingEnabled,
    customEngravingEnabled: settings.customEngravingEnabled,
    woodEngravingStyle: settings.woodEngravingStyle,
    woodEngravingColorDepth: settings.woodEngravingColorDepth,
    customWoodEngravingMethod: settings.customWoodEngravingMethod,
    customEngravingObject: settings.customEngravingObject,
    engravingMethod: settings.engravingMethod,
    expectedText,
    correctionFeedback,
  });
  const customPrompt = perImagePrompt?.trim() || (settings.customizeReplacementPrompt ? settings.replacementPrompt.trim() : '');
  const collageInstruction = '【多个小图强制规则】请直接查看并判断输入画面中是否存在多个小图；若存在，必须对模型判断出的每一个小图逐一、完整地执行相同的 Logo 替换要求，所有小图都必须处理。不得根据截图、拼贴、海报或详情页等预设类别来决定是否执行，也不得筛选或跳过其中任何小图。同一新 Logo 必须应用到每个小图中所有对应的旧 Logo，严禁只处理第一张、最大一张或其中部分小图；不得合并、删除、移动、裁切任何小图，不得改变原有排版、标题、标签及其他非 Logo 内容。';
  return customPrompt
    ? customPrompt + '\n\n【以下 Logo 工艺、颜色、小字保护及图中图规则为强制最高优先级，不得被前文覆盖】\n' + mandatoryPrompt + '\n\n' + collageInstruction
    : mandatoryPrompt + '\n\n' + collageInstruction;
}
interface LogoReplaceComposerProps {
  apiKey: string;
  openAiApiKey: string;
  apiBaseUrl: string | null;
  connectionMode: 'direct' | 'proxy';
  onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void;
  settingsHost?: HTMLElement | null;
  automationStartToken?: string;
  automationRetryFailedToken?: string;
  onProgressChange?: (progress: LogoReplaceProgressSnapshot) => void;
  onTaskDetailChange?: (detail: LogoReplaceTaskDetail) => void;
  initialPerImagePrompts?: Record<string, PerImagePromptAssignment>;
  onPerImagePromptsChange?: (items: Record<string, PerImagePromptAssignment>) => void;
}

function LogoReplaceSingleComposer({
  apiKey,
  openAiApiKey,
  apiBaseUrl,
  connectionMode,
  onRequestKey,
  onSessionStateChange,
  settingsHost,
  automationStartToken,
  automationRetryFailedToken,
  onProgressChange,
  onTaskDetailChange,
  initialPerImagePrompts,
  onPerImagePromptsChange,
}: LogoReplaceComposerProps) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<LogoReplaceSettings>(() => {
    const stored = readLocalStorage(STORAGE_KEYS.logoReplaceSettings, {} as Partial<LogoReplaceSettings> & { logoEffect?: string });
    const legacyEffect = (stored as { logoEffect?: string }).logoEffect;
    const glassEngravingEnabled = stored.glassEngravingEnabled ?? (!legacyEffect || legacyEffect === 'glass-engrave' || legacyEffect === 'laser-engrave');
    const woodEngravingEnabled = stored.woodEngravingEnabled ?? (legacyEffect === 'wood-engrave' || legacyEffect === 'deboss' || legacyEffect === 'emboss');
    const customEngravingEnabled = stored.customEngravingEnabled ?? legacyEffect === 'custom-engrave';
    return { ...(DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings), ...stored, glassEngravingEnabled, woodEngravingEnabled, customEngravingEnabled };
  });  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [oldLogo, setOldLogo] = useState<LogoAsset>();
  const [newLogos, setNewLogos] = useState<LogoAsset[]>([]);
  const [expectedTexts, setExpectedTexts] = useState<Record<string, string>>({});
  const [randomSeed, setRandomSeed] = useState(() => createId());
  const [manualLogoAssignments, setManualLogoAssignments] = useState<Record<string, string>>({});
  const [compareOriginalIds, setCompareOriginalIds] = useState<Set<string>>(() => new Set());
  const [previewCompareOriginal, setPreviewCompareOriginal] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(() => new Set());
  const [tasks, setTasks] = useState<LogoReplaceTask[]>([]);
  const [pendingPsdFile, setPendingPsdFile] = useState<File>();
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const retryTimers = useRef(new Map<string, number>());
  const handledAutomationStart = useRef<string | undefined>(undefined);
  const publishedTaskSignatures = useRef(new Map<string, string>());
  const scenesRef = useRef(scenes);
  const oldLogoRef = useRef(oldLogo);
  const newLogosRef = useRef(newLogos);
  const settingsRef = useRef(settings);

  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { oldLogoRef.current = oldLogo; }, [oldLogo]);
  useEffect(() => { newLogosRef.current = newLogos; }, [newLogos]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.logoReplaceSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || oldLogo || newLogos.length || tasks.length)), [scenes.length, oldLogo, newLogos.length, tasks.length, onSessionStateChange]);
  useEffect(() => () => { retryTimers.current.forEach((timer) => window.clearTimeout(timer)); }, []);

  const validateFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`);
    if (!file.size || file.size > MAX_IMAGE_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`);
    return true;
  };
  const makeAsset = (file: File): LogoAsset => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
  const resetTasks = () => {
    aborters.current.forEach((controller) => controller.abort());
    retryTimers.current.forEach((timer) => window.clearTimeout(timer));
    retryTimers.current.clear();
    publishedTaskSignatures.current.clear();
    setTasks((current) => {
      current.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
      return [];
    });
    setCompareOriginalIds(new Set());
    setPreviewCompareOriginal(false);
    setSelectedResultIds(new Set());
  };
  const addScenes = (files: File[]) => {
    const assets = files.filter((file) => validateFile(file) === true).map(makeAsset);
    if (assets.length) {
      resetTasks();
      setScenes((current) => [...current, ...assets]);
    }
    return false;
  };
  const removeScene = (id: string) => {
    resetTasks();
    setScenes((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };
  const setOldLogoAsset = (file: File) => {
    if (validateFile(file) !== true) return false;
    resetTasks();
    const next = makeAsset(file);
    setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return next; });
    return false;
  };
  const clearOldLogo = () => {
    resetTasks();
    setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return undefined; });
  };
  const addNewLogos = (files: File[]) => {
    const assets = files.filter((file) => validateFile(file) === true).map(makeAsset);
    if (assets.length) {
      resetTasks();
      setNewLogos((current) => [...current, ...assets]);
    }
    return false;
  };
  const loadPsdLogos = async (file: File) => {
    setPendingPsdFile(file);
  };
  const addNewLogoFile = (file: File) => {
    if (file.name.toLowerCase().endsWith('.psd')) { void loadPsdLogos(file); return false; }
    return addNewLogos([file]);
  };
  const removeNewLogo = (id: string) => {
    resetTasks();
    setManualLogoAssignments((current) => Object.fromEntries(Object.entries(current).filter(([, logoId]) => logoId !== id)));
    setExpectedTexts((current) => { const next = { ...current }; delete next[id]; return next; });
    setNewLogos((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };
  const patchSettings = (patch: Partial<LogoReplaceSettings>) => setSettings((current) => {
    const next = { ...current, ...patch };
    if (patch.imageModel) return { ...next, ...normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize) };
    return next;
  });

  const defaultReplacementPrompt = useMemo(() => buildLogoReplacementInstruction({
    hasOldLogo: settings.useOldLogoReference && Boolean(oldLogo),
    logoColorMode: settings.logoColorMode,
    customLogoColor: settings.customLogoColor,
    engravingMode: settings.engravingMode,
    glassEngravingEnabled: settings.glassEngravingEnabled,
    woodEngravingEnabled: settings.woodEngravingEnabled,
    customEngravingEnabled: settings.customEngravingEnabled,
    woodEngravingStyle: settings.woodEngravingStyle,
    woodEngravingColorDepth: settings.woodEngravingColorDepth,
    customWoodEngravingMethod: settings.customWoodEngravingMethod,
    customEngravingObject: settings.customEngravingObject,
    engravingMethod: settings.engravingMethod,
  }), [oldLogo, settings.useOldLogoReference, settings.logoColorMode, settings.customLogoColor, settings.engravingMode, settings.glassEngravingEnabled, settings.woodEngravingEnabled, settings.customEngravingEnabled, settings.woodEngravingStyle, settings.woodEngravingColorDepth, settings.customWoodEngravingMethod, settings.customEngravingObject, settings.engravingMethod]);
  const actualReplacementPrompt = useMemo(
    () => buildActualReplacementPrompt(settings, settings.useOldLogoReference && Boolean(oldLogo)),
    [settings, oldLogo],
  );
  const perImagePromptSource = settings.customizeReplacementPrompt ? settings.replacementPrompt.trim() : actualReplacementPrompt;
  const perImagePrompts = usePerImagePrompts({ tool: 'logo-replace', files: scenes.map((scene) => scene.file), sourcePrompt: perImagePromptSource, initial: initialPerImagePrompts, onChange: onPerImagePromptsChange, config: { provider: settings.languageProvider, apiKey: settings.languageProvider === 'openai' ? openAiApiKey : apiKey, apiBaseUrl, geminiModel: settings.verificationModel, openAiModel: settings.openAiLanguageModel, concurrency: Math.min(8, settings.concurrency), autoRetryErrors: settings.autoRetryErrors, errorRetryLimit: settings.errorRetryLimit, errorRetryDelaySeconds: settings.errorRetryDelaySeconds } });
  const pairings = useMemo(
    () => assignReplacementLogos(scenes, newLogos, settings.randomAssignLogos, randomSeed, manualLogoAssignments),
    [scenes, newLogos, settings.randomAssignLogos, randomSeed, manualLogoAssignments],
  );

  const executeTask = useCallback(async (task: LogoReplaceTask) => {
    if (runningIds.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId);
    const replacement = newLogosRef.current.find((item) => item.id === task.newLogoId);
    if (!scene || !replacement) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined, verificationStatus: settingsRef.current.strictTextVerification ? 'pending' : 'skipped', acceptedVerificationRisk: false } : item));
    try {
      const currentSettings = settingsRef.current;
      const expectedText = expectedTexts[replacement.id]?.trim() || '';
      let correctionFeedback = '';
      for (let verificationAttempt = 0; verificationAttempt <= currentSettings.verificationRetries; verificationAttempt += 1) {
        const commonGenerateOptions = {
          scene: scene.file,
          oldLogo: currentSettings.useOldLogoReference ? oldLogoRef.current?.file : undefined,
          newLogo: replacement.file,
          signal: controller.signal,
        };
        const assignedPrompt = currentSettings.perImagePromptEnabled ? perImagePrompts.effective(scene.file)?.prompt : undefined;
        if (currentSettings.perImagePromptEnabled && !assignedPrompt) throw new Error('该场景图尚未完成逐图提示词分析');
        const replacementPrompt = buildActualReplacementPrompt(currentSettings, currentSettings.useOldLogoReference && Boolean(oldLogoRef.current), expectedText, correctionFeedback, assignedPrompt);
        const dimensions = await imageDimensions(scene.file);
        const aspectRatio = outputAspectRatio(currentSettings.ratioMode, dimensions.width, dimensions.height, currentSettings.aspectRatio, currentSettings.customOutputWidth, currentSettings.customOutputHeight, MODEL_CAPABILITIES[currentSettings.imageModel].aspectRatios);
        const result = currentSettings.imageProvider === 'openai'
          ? await generateLogoReplacementOpenAi({ ...commonGenerateOptions, apiKey: openAiApiKey, model: currentSettings.openAiImageModel, prompt: replacementPrompt })
          : await generateLogoReplacement({ ...commonGenerateOptions, apiKey, model: currentSettings.imageModel, logoColorMode: currentSettings.logoColorMode, customLogoColor: currentSettings.customLogoColor, promptOverride: replacementPrompt, aspectRatio, imageSize: currentSettings.imageSize, apiBaseUrl });
        const exactOutputSize = currentSettings.ratioMode === 'custom'
          ? { width: currentSettings.customOutputWidth, height: currentSettings.customOutputHeight }
          : currentSettings.ratioMode === 'original' ? dimensions : undefined;
        if (exactOutputSize) { const resized = await resizeImageBlob(result.blob, exactOutputSize.width, exactOutputSize.height); result.blob = resized; result.mimeType = resized.type || 'image/png'; }
        if (!currentSettings.strictTextVerification) {
          const resultUrl = URL.createObjectURL(result.blob);
          setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType, verificationStatus: 'skipped' } : item));
          return;
        }
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, verificationStatus: 'verifying', verificationAttempts: verificationAttempt + 1 } : item));
        let verification;
        try {
          const verifyOptions = { referenceLogo: replacement.file, originalScene: scene.file, generatedImage: result.blob, expectedText, signal: controller.signal };
          verification = currentSettings.languageProvider === 'openai'
            ? await verifyLogoReplacementOpenAi({ ...verifyOptions, apiKey: openAiApiKey, model: currentSettings.openAiLanguageModel })
            : await verifyLogoReplacement({ ...verifyOptions, apiKey, apiBaseUrl, model: currentSettings.verificationModel });
        } catch (error) {
          const resultUrl = URL.createObjectURL(result.blob);
          const summary = error instanceof Error ? error.message : 'Logo 校验失败';
          setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType, verificationStatus: 'failed', verificationAttempts: verificationAttempt + 1, verificationResult: { passed: false, referenceText: expectedText, generatedText: '', differences: [summary], graphicConsistent: false, summary } } : item));
          return;
        }
        if (verification.passed) {
          const resultUrl = URL.createObjectURL(result.blob);
          setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType, verificationStatus: 'passed', verificationResult: verification, verificationAttempts: verificationAttempt + 1 } : item));
          return;
        }
        if (verificationAttempt >= currentSettings.verificationRetries) {
          const resultUrl = URL.createObjectURL(result.blob);
          setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType, verificationStatus: 'failed', verificationResult: verification, verificationAttempts: verificationAttempt + 1 } : item));
          return;
        }
        correctionFeedback = [verification.summary, ...verification.differences].filter(Boolean).join('；');
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', verificationStatus: 'pending', verificationResult: verification, verificationAttempts: verificationAttempt + 1 } : item));
      }
    } catch (error) {
      const stopped = controller.signal.aborted;
      const currentSettings = settingsRef.current;
      const detail = error instanceof Error ? error.message : 'Logo 替换失败';
      if (!stopped && shouldAutoRetryLogoError(task.retryCount, currentSettings.autoRetryErrors, currentSettings.errorRetryLimit)) {
        const delayMs = Math.max(1, currentSettings.errorRetryDelaySeconds) * 1000;
        const nextRetryAt = Date.now() + delayMs;
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'waiting', error: `${detail}；将在 ${currentSettings.errorRetryDelaySeconds} 秒后自动重试`, retryCount: item.retryCount + 1, nextRetryAt, verificationStatus: currentSettings.strictTextVerification ? 'pending' : 'skipped' } : item));
        const timer = window.setTimeout(() => {
          retryTimers.current.delete(task.id);
          setTasks((current) => current.map((item) => item.id === task.id && item.status === 'waiting' && !item.autoRetryStopped ? { ...item, nextRetryAt: undefined, error: undefined } : item));
        }, delayMs);
        retryTimers.current.set(task.id, timer);
      } else {
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : detail, nextRetryAt: undefined } : item));
      }
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, [apiKey, openAiApiKey, apiBaseUrl, expectedTexts, perImagePrompts]);
  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    tasks.filter((task) => task.status === 'waiting' && !task.nextRetryAt && !task.autoRetryStopped && !runningIds.current.has(task.id)).slice(0, available).forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const start = async () => {
    if (settings.imageProvider === 'openai' || (settings.strictTextVerification && settings.languageProvider === 'openai')) { if (!openAiApiKey) return onRequestKey(); }
    else if (!apiKey) return onRequestKey();
    if ((settings.imageProvider === 'gemini' || (settings.strictTextVerification && settings.languageProvider === 'gemini')) && connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张已贴 Logo 的场景图');
    if (!newLogos.length) return void message.warning('请至少上传一个新 Logo');
    if (pairings.some((pairing) => !pairing.logo)) return void message.warning('存在尚未匹配新 Logo 的场景图');
    if (settings.perImagePromptEnabled) {
      const key = settings.languageProvider === 'openai' ? openAiApiKey : apiKey; if (!key) return onRequestKey();
      const missing = scenes.filter((scene) => !perImagePrompts.effective(scene.file));
      if (missing.length) { const analyzed = await perImagePrompts.analyze(missing.map((scene) => scene.file)); if (analyzed.failed) return void message.error(`${analyzed.failed} 张图片提示词分析失败，请重试后再生成`); if (!settings.autoGenerateAfterPromptAnalysis) return void message.success('逐图提示词已分配，请检查修改后再次点击生成'); }
    }
    resetTasks();
    setCompareOriginalIds(new Set());
    setTasks(buildLogoReplaceTasks(pairings, settings.copiesPerScene));
  };
  useEffect(() => {
    if (!automationStartToken || handledAutomationStart.current === automationStartToken || !scenes.length || !newLogos.length) return;
    handledAutomationStart.current = automationStartToken;
    start();
  }, [automationStartToken, scenes.length, newLogos.length]);
  const stop = () => {
    aborters.current.forEach((controller) => controller.abort());
    retryTimers.current.forEach((timer) => window.clearTimeout(timer));
    retryTimers.current.clear();
    setTasks((current) => current.map((task) => task.status === 'waiting' ? { ...task, status: 'stopped' } : task));
  };
  const stopTaskRetry = (id: string) => {
    const timer = retryTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    retryTimers.current.delete(id);
    aborters.current.get(id)?.abort();
    setTasks((current) => current.map((item) => item.id === id ? { ...item, status: 'stopped', autoRetryStopped: true, nextRetryAt: undefined, error: '已停止该图片，不再自动重试' } : item));
  };
  const retry = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
    const timer = retryTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    retryTimers.current.delete(id);
    const next = { ...task, status: 'waiting' as const, error: undefined, resultBlob: undefined, resultUrl: undefined, resultMimeType: undefined, retryCount: 0, nextRetryAt: undefined, autoRetryStopped: false, verificationStatus: settings.strictTextVerification ? 'pending' as const : 'skipped' as const, verificationResult: undefined, verificationAttempts: 0, acceptedVerificationRisk: false };
    setCompareOriginalIds((current) => { const ids = new Set(current); ids.delete(id); return ids; });
    setSelectedResultIds((current) => { const ids = new Set(current); ids.delete(id); return ids; });
    setTasks((current) => current.map((item) => item.id === id ? next : item));
  };
  const retryAllFailed = useCallback(() => {
    setTasks((current) => current.map((task) => task.status === 'failed' ? { ...task, status: 'waiting', error: undefined, resultBlob: undefined, resultUrl: undefined, resultMimeType: undefined, retryCount: 0, nextRetryAt: undefined, autoRetryStopped: false, verificationStatus: settingsRef.current.strictTextVerification ? 'pending' : 'skipped', verificationResult: undefined, verificationAttempts: 0, acceptedVerificationRisk: false } : task));
  }, []);
  const handledAutomationRetry = useRef<string | undefined>(undefined);
  useEffect(() => { if (!automationRetryFailedToken || handledAutomationRetry.current === automationRetryFailedToken) return; handledAutomationRetry.current = automationRetryFailedToken; retryAllFailed(); }, [automationRetryFailedToken, retryAllFailed]);
  const clearResults = () => resetTasks();
  const successful = tasks.filter((task) => task.status === 'success' && task.resultBlob);
  const downloadable = successful.filter((task) => task.verificationStatus !== 'failed' || task.acceptedVerificationRisk);
  const processing = tasks.some((task) => task.status === 'waiting' || task.status === 'running');
  const completed = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const retryingCount = tasks.filter((task) => task.retryCount > 0 && (task.status === 'waiting' || task.status === 'running')).length;
  useEffect(() => { reportTaskProgress({ id: 'logo-replace', label: 'Logo 替换', completed, total: tasks.length, failed: tasks.filter((task) => task.status === 'failed').length, running: processing }); }, [completed, tasks, processing]);
  useEffect(() => { onProgressChange?.({ total: tasks.length, success: tasks.filter((task) => task.status === 'success').length, failed: tasks.filter((task) => task.status === 'failed').length, stopped: tasks.filter((task) => task.status === 'stopped').length, waiting: tasks.filter((task) => task.status === 'waiting').length, running: tasks.filter((task) => task.status === 'running').length, retrying: retryingCount }); }, [tasks, retryingCount, onProgressChange]);
  useEffect(() => {
    if (!onTaskDetailChange) return;
    tasks.forEach((task) => {
      const signature = [task.status, task.retryCount, task.error || '', task.verificationStatus || '', Boolean(task.resultBlob)].join('|');
      if (publishedTaskSignatures.current.get(task.id) === signature) return;
      publishedTaskSignatures.current.set(task.id, signature);
      const scene = scenesRef.current.find((item) => item.id === task.sceneId);
      onTaskDetailChange({
        id: task.id,
        sceneIndex: task.sceneIndex,
        copyIndex: task.copyIndex,
        status: task.status,
        retryCount: task.retryCount,
        error: task.error,
        verificationStatus: task.verificationStatus,
        verificationAttempts: task.verificationAttempts,
        acceptedVerificationRisk: task.acceptedVerificationRisk,
        resultBlob: task.resultBlob,
        originalFile: task.resultBlob ? scene?.file : undefined,
      });
    });
  }, [tasks, onTaskDetailChange]);
  const taskCount = scenes.length * settings.copiesPerScene;
  const gptOutputCostRange = estimateGptImage2HighOutputCostRange(taskCount);
  const baseEstimatedCost = settings.imageProvider === 'openai' ? gptOutputCostRange.max : estimateImageCost(settings.imageModel, settings.imageSize, taskCount) + taskCount * PRICING.models[settings.imageModel].inputImage * (settings.useOldLogoReference && oldLogo ? 2 : 1);
  const worstCaseImageCost = baseEstimatedCost * (settings.strictTextVerification ? settings.verificationRetries + 1 : 1) * (settings.autoRetryErrors ? settings.errorRetryLimit + 1 : 1);
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((task) => task.sceneId === scene.id) })).filter((group) => group.tasks.length), [scenes, tasks]);
  const previewableResults = useMemo(() => groups.flatMap((group) => group.tasks
    .filter((task) => Boolean(task.resultUrl))
    .map((task) => ({ task, scene: group.scene }))), [groups]);
  const logoResultPreviewItems = useMemo(() => previewableResults.map(({ task, scene }) => ({
    src: compareOriginalIds.has(task.id) ? scene.previewUrl : task.resultUrl!,
    alt: compareOriginalIds.has(task.id) ? `${scene.name} 原图` : `${scene.name} Logo 替换结果`,
  })), [compareOriginalIds, previewableResults]);
  const logoResultPreviewConfig = {
    onOpenChange: (open: boolean) => { if (!open) setPreviewCompareOriginal(false); },
    onChange: () => setPreviewCompareOriginal(false),
    actionsRender: (originalNode: ReactElement) => <>
      {originalNode}
      <Tooltip title={previewCompareOriginal ? '查看生成图' : '查看原图'}>
        <button
          type="button"
          aria-label={previewCompareOriginal ? '查看生成图' : '查看原图'}
          className={`scene-preview-compare-action${previewCompareOriginal ? ' is-active' : ''}`}
          onClick={() => setPreviewCompareOriginal((current) => !current)}
        >
          <EyeOutlined />
        </button>
      </Tooltip>
    </>,
    imageRender: (originalNode: ReactElement, info: { current: number }) => {
      const item = previewableResults[info.current];
      return previewCompareOriginal && item
        ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, {
            src: item.scene.previewUrl,
            alt: `${item.scene.name} 原图`,
          })
        : originalNode;
    },
  };
  const downloadTask = (task: LogoReplaceTask) => {
    const scene = scenes.find((item) => item.id === task.sceneId);
    if (scene && task.resultBlob && (task.verificationStatus !== 'failed' || task.acceptedVerificationRisk)) downloadBlob(task.resultBlob, logoReplaceResultFileName(scene.name, task.copyIndex, settings.copiesPerScene, task.resultMimeType));
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    groups.forEach((group) => {
      const target = settings.copiesPerScene > 1 ? zip.folder(`${String(group.tasks[0]?.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(group.scene.name)}`)! : zip;
      group.tasks.forEach((task) => { if (task.resultBlob && (task.verificationStatus !== 'failed' || task.acceptedVerificationRisk)) target.file(logoReplaceResultFileName(group.scene.name, task.copyIndex, settings.copiesPerScene, task.resultMimeType), task.resultBlob); });
    });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_Logo替换结果.zip');
  };
  const selectedSuccessful = downloadable.filter((task) => selectedResultIds.has(task.id));
  const allSuccessfulSelected = downloadable.length > 0 && selectedSuccessful.length === downloadable.length;
  const toggleResultSelection = (id: string, checked: boolean) => {
    setSelectedResultIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSelectAllSuccessful = (checked: boolean) => {
    setSelectedResultIds(checked ? new Set(downloadable.map((task) => task.id)) : new Set());
  };
  const downloadSelected = async () => {
    if (!selectedSuccessful.length) return;
    if (selectedSuccessful.length === 1) {
      downloadTask(selectedSuccessful[0]);
      return;
    }
    const zip = new JSZip();
    selectedSuccessful.forEach((task) => {
      const scene = scenes.find((item) => item.id === task.sceneId);
      if (scene && task.resultBlob) zip.file(logoReplaceResultFileName(scene.name, task.copyIndex, settings.copiesPerScene, task.resultMimeType), task.resultBlob);
    });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `SceneStudio_选中的Logo替换结果_${selectedSuccessful.length}张.zip`);
  };

  const settingsPanel = (
    <div className="settings-panel logo-replace-settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>替换设置</Title><Tag color="cyan">REPLACE</Tag></Flex>
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item label="逐图分配提示词"><Flex justify="space-between" align="center"><Text>生成前分析每张场景图并筛选适用条件</Text><Switch checked={settings.perImagePromptEnabled} onChange={(perImagePromptEnabled) => patchSettings({ perImagePromptEnabled })} /></Flex>{settings.perImagePromptEnabled && <Flex justify="space-between" align="center" style={{ marginTop: 10 }}><Text>分析完成后自动生成</Text><Switch checked={settings.autoGenerateAfterPromptAnalysis} onChange={(autoGenerateAfterPromptAnalysis) => patchSettings({ autoGenerateAfterPromptAnalysis })} /></Flex>}</Form.Item>
        <Form.Item label="Logo 分配方式">
          <Flex justify="space-between" align="center"><Text>随机分配新 Logo</Text><Switch checked={settings.randomAssignLogos} onChange={(randomAssignLogos) => { patchSettings({ randomAssignLogos }); resetTasks(); }} /></Flex>
          <Text type="secondary" className="field-help">关闭时场景图与新 Logo 必须数量一致并按顺序配对；开启后允许数量不同。</Text>
        </Form.Item>
        <Form.Item label="严格文字校验">
          <Flex justify="space-between" align="center"><Text>生成后自动检查 Logo 字符</Text><Switch checked={settings.strictTextVerification} onChange={(strictTextVerification) => patchSettings({ strictTextVerification })} /></Flex>
          <Text type="secondary" className="field-help">默认开启。校验失败会携带字符差异自动重新生成。</Text>
          {settings.strictTextVerification && <Space direction="vertical" style={{ width: '100%', marginTop: 10 }}>
            <Segmented block value={settings.languageProvider} onChange={(languageProvider) => patchSettings({ languageProvider: languageProvider as LogoReplaceSettings['languageProvider'] })} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} />
            {settings.languageProvider === 'openai'
              ? <Select value={settings.openAiLanguageModel} onChange={(openAiLanguageModel) => patchSettings({ openAiLanguageModel })} options={[{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra（推荐）' }, { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol（最高质量）' }, { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（低成本）' }]} />
              : <Select value={settings.verificationModel} onChange={(verificationModel) => patchSettings({ verificationModel })} options={[{ value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }, { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' }, { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]} />}
            <Flex justify="space-between" align="center"><Text>自动修复次数</Text><InputNumber min={0} max={3} value={settings.verificationRetries} onChange={(verificationRetries) => patchSettings({ verificationRetries: verificationRetries ?? 2 })} /></Flex>
          </Space>}
        </Form.Item>
        <Form.Item label="新 Logo 颜色">
          <Select value={settings.logoColorMode} onChange={(logoColorMode) => patchSettings({ logoColorMode })} options={[
            { value: 'original', label: '保持原色' }, { value: 'white', label: '白色' }, { value: 'black', label: '黑色' }, { value: 'custom', label: '自定义颜色' },
          ]} />
          {settings.logoColorMode === 'custom' && <Flex gap={8} align="center" style={{ marginTop: 10 }}><ColorPicker value={settings.customLogoColor} onChange={(_, hex) => patchSettings({ customLogoColor: hex })} /><Text code>{settings.customLogoColor}</Text></Flex>}
        </Form.Item>
        <Form.Item label="雕刻工艺">
          <Segmented block value={settings.engravingMode} onChange={(engravingMode) => patchSettings({ engravingMode: engravingMode as LogoReplaceSettings['engravingMode'] })} options={[
            { value: 'auto', label: '自动识别图片工艺' },
            { value: 'custom', label: '自定义雕刻工艺' },
          ]} />
          {settings.engravingMode === 'auto' ? <Alert style={{ marginTop: 12 }} type="info" showIcon title="逐个 Logo 自动识别并沿用原工艺" description="AI 会分别识别每个 Logo 所在载体和原有雕刻方式：木盒沿用木盒原工艺，玻璃沿用玻璃原工艺；同一张图中的多种不同工艺会逐个匹配，不会统一套用。" /> : <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
            <Card size="small" title="玻璃 Logo 工艺">
              <Flex justify="space-between" align="center"><Text>玻璃激光磨砂雕刻</Text><Switch checked={settings.glassEngravingEnabled} onChange={(glassEngravingEnabled) => patchSettings({ glassEngravingEnabled })} /></Flex>
              <Text type="secondary" className="field-help">仅在 Logo 位于玻璃载体时生效，呈半透明乳白或雾化蚀刻质感，并保留透光、折射和曲面效果。</Text>
            </Card>
            <Card size="small" title="木盒 Logo 工艺">
              <Flex justify="space-between" align="center"><Text>启用木盒独立雕刻</Text><Switch checked={settings.woodEngravingEnabled} onChange={(woodEngravingEnabled) => patchSettings({ woodEngravingEnabled })} /></Flex>
              {settings.woodEngravingEnabled && <>
                <Select style={{ marginTop: 10 }} value={settings.woodEngravingStyle} onChange={(woodEngravingStyle) => patchSettings({ woodEngravingStyle })} options={[
                  { value: 'auto', label: '自动识别木盒颜色（推荐）' },
                  { value: 'dark-burn', label: '深色激光烧蚀（深黑高对比）' },
                  { value: 'natural-recessed', label: '原木浅雕 / 凹刻（同色低对比）' },
                  { value: 'custom', label: '自定义木盒雕刻方式' },
                ]} />
                {settings.woodEngravingStyle === 'auto' && <Text type="secondary" className="field-help">逐个识别木盒底色：深色木盒使用深色激光烧蚀，浅色木盒使用原木浅雕 / 凹刻。</Text>}
                {settings.woodEngravingStyle === 'dark-burn' && <Text type="secondary" className="field-help">图案呈深棕至炭黑色，边缘清晰，同时保留木纹和自然焦痕。</Text>}
                {settings.woodEngravingStyle === 'natural-recessed' && <Text type="secondary" className="field-help">颜色接近原木，不做黑色填充，通过极浅凹槽、切削纹理和自然阴影显示 Logo。</Text>}
                {(settings.woodEngravingStyle === 'natural-recessed' || settings.woodEngravingStyle === 'auto') && <div style={{ marginTop: 10 }}>
                  <Flex justify="space-between"><Text>原木浅雕颜色深浅</Text><Text code>{settings.woodEngravingColorDepth}%</Text></Flex>
                  <Slider min={0} max={100} value={settings.woodEngravingColorDepth} onChange={(woodEngravingColorDepth) => patchSettings({ woodEngravingColorDepth })} marks={{ 0: '仅凹槽 / 不改色', 50: '中等', 100: '最深色' }} />
                </div>}
                {settings.woodEngravingStyle === 'custom' && <Input.TextArea style={{ marginTop: 10 }} value={settings.customWoodEngravingMethod} placeholder="输入木盒雕刻方式、深浅、颜色和表面效果" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patchSettings({ customWoodEngravingMethod: event.target.value })} />}
              </>}
            </Card>
            <Card size="small" title="自定义物体 Logo 工艺">
              <Flex justify="space-between" align="center"><Text>启用自定义载体雕刻</Text><Switch checked={settings.customEngravingEnabled} onChange={(customEngravingEnabled) => patchSettings({ customEngravingEnabled })} /></Flex>
              {settings.customEngravingEnabled && <>
                <Input style={{ marginTop: 10 }} value={settings.customEngravingObject} placeholder="输入雕刻载体，例如：深蓝色皮革盒" onChange={(event) => patchSettings({ customEngravingObject: event.target.value })} />
                <Input.TextArea style={{ marginTop: 10 }} value={settings.engravingMethod} placeholder="输入具体雕刻方式、颜色、深浅和材质效果" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patchSettings({ engravingMethod: event.target.value })} />
              </>}
            </Card>
          </Space>}
        </Form.Item>        <Form.Item label="替换提示词">
          <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
            <Text>自定义编辑</Text>
            <Switch checked={settings.customizeReplacementPrompt} onChange={(customizeReplacementPrompt) => patchSettings({ customizeReplacementPrompt, replacementPrompt: customizeReplacementPrompt ? (settings.replacementPrompt.trim() || defaultReplacementPrompt) : settings.replacementPrompt })} />
          </Flex>
          <Input.TextArea value={settings.customizeReplacementPrompt ? settings.replacementPrompt : defaultReplacementPrompt} readOnly={!settings.customizeReplacementPrompt} autoSize={{ minRows: 6, maxRows: 12 }} onChange={(event) => patchSettings({ replacementPrompt: event.target.value })} />
          <Flex justify="space-between" align="center" gap={8} style={{ marginTop: 8 }}><Text type="secondary" className="field-help">{settings.customizeReplacementPrompt ? '上方为自定义内容，工艺、颜色和小字保护规则会作为强制后缀追加。' : '这里显示的完整提示词就是实际发送给模型的文本。'}</Text>{settings.customizeReplacementPrompt && <Button size="small" onClick={() => patchSettings({ replacementPrompt: '' })}>清空自定义</Button>}</Flex>
          {settings.customizeReplacementPrompt && <><Text strong style={{ display: 'block', marginTop: 10 }}>最终实际发送提示词</Text><Input.TextArea readOnly value={actualReplacementPrompt} autoSize={{ minRows: 6, maxRows: 12 }} style={{ marginTop: 6 }} /></>}
          <Text type="secondary" className="field-help">图片按“场景图、可选旧 Logo、新 Logo”的顺序作为独立图片内容提交。</Text>
        </Form.Item>
        <Form.Item label="图片服务"><Segmented block value={settings.imageProvider} onChange={(imageProvider) => patchSettings({ imageProvider: imageProvider as LogoReplaceSettings['imageProvider'] })} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} /></Form.Item>
        <Form.Item label="图片模型">{settings.imageProvider === 'openai' ? <Select value={settings.openAiImageModel} options={[{ value: 'gpt-image-2', label: 'GPT Image 2' }]} /> : <Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} />}</Form.Item>
        {settings.imageProvider === 'gemini' ? <><Form.Item label="画面比例">
          <Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}><Radio value="original">跟随场景原图</Radio><Radio value="fixed">指定比例</Radio><Radio value="custom">自定义分辨率</Radio></Radio.Group>
          {settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}
          {settings.ratioMode === 'custom' && <><Select style={{ marginTop: 10 }} value={`${settings.customOutputWidth}x${settings.customOutputHeight}`} onChange={(value) => { const [customOutputWidth, customOutputHeight] = value.split('x').map(Number); patchSettings({ customOutputWidth, customOutputHeight }); }} options={[{ value: '3200x1310', label: '3200 × 1310' }, { value: '1800x1350', label: '1800 × 1350' }, { value: `${settings.customOutputWidth}x${settings.customOutputHeight}`, label: '当前自定义尺寸' }]} /><Flex gap={8} style={{ marginTop: 10 }}><InputNumber min={64} max={8192} value={settings.customOutputWidth} onChange={(customOutputWidth) => patchSettings({ customOutputWidth: customOutputWidth || 64 })} addonBefore="宽" style={{ flex: 1 }} /><InputNumber min={64} max={8192} value={settings.customOutputHeight} onChange={(customOutputHeight) => patchSettings({ customOutputHeight: customOutputHeight || 64 })} addonBefore="高" style={{ flex: 1 }} /></Flex></>}
        </Form.Item>
        <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as LogoReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item></> : <Alert type="info" showIcon title="GPT Image 2 使用自动尺寸" description="通过 OpenAI Images Edit 直接编辑场景图，并按输入画面自动选择输出尺寸。" style={{ marginBottom: 18 }} />}
        <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(copiesPerScene) => patchSettings({ copiesPerScene: copiesPerScene || 1 })} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="错误自动重试">
          <Flex justify="space-between" align="center"><Text>接口或并发错误后无人值守重试</Text><Switch checked={settings.autoRetryErrors} onChange={(autoRetryErrors) => patchSettings({ autoRetryErrors })} /></Flex>
          {settings.autoRetryErrors && <Space direction="vertical" style={{ width: '100%', marginTop: 10 }}>
            <Flex justify="space-between" align="center"><Text>最多重试次数</Text><InputNumber min={1} max={20} value={settings.errorRetryLimit} onChange={(errorRetryLimit) => patchSettings({ errorRetryLimit: errorRetryLimit || 1 })} /></Flex>
            <Flex justify="space-between" align="center"><Text>失败后等待时间</Text><InputNumber min={5} max={3600} addonAfter="秒" value={settings.errorRetryDelaySeconds} onChange={(errorRetryDelaySeconds) => patchSettings({ errorRetryDelaySeconds: errorRetryDelaySeconds || 30 })} /></Flex>
            <Text type="secondary" className="field-help">适合限流、并发过高或临时网络错误；达到上限后才标记为最终失败。</Text>
          </Space>}
        </Form.Item>
      </Form>
      <Card className="price-card" variant="borderless"><Flex gap={20} wrap><Statistic title={settings.imageProvider === 'openai' ? 'GPT 预计图片输出费用（上限）' : '基础预计价格'} prefix="$" precision={3} value={baseEstimatedCost} />{(settings.strictTextVerification || settings.autoRetryErrors) && <Statistic title="最坏情况生图价格" prefix="$" precision={3} value={worstCaseImageCost} />}</Flex>{settings.imageProvider === 'openai' ? <Text type="secondary">GPT Image 2 当前使用 high 质量与 auto 尺寸，按官方常见尺寸每张约 US$0.165–0.211 估算；本次 {taskCount} 个请求的输出费用约 US${gptOutputCostRange.min.toFixed(3)}–{gptOutputCostRange.max.toFixed(3)}。输入场景图、Logo 和提示词 token 会按实际大小另计；最坏情况同时计入文字校验与错误自动重试上限。<a href="https://developers.openai.com/api/docs/guides/image-generation#calculating-costs" target="_blank" rel="noreferrer">OpenAI 官方计价</a></Text> : <Text type="secondary">基础费用按 {taskCount} 个请求估算。{settings.strictTextVerification ? `文字校验最多重新生成 ${settings.verificationRetries} 次；` : ''}{settings.autoRetryErrors ? `接口错误最多自动重试 ${settings.errorRetryLimit} 次；` : ''}校验模型的文本 token 费用另计。</Text>}</Card>
    </div>
  );

  const oldLogoCard = (
    <div className="replace-logo-slot">
      {oldLogo ? <><Image src={oldLogo.previewUrl} alt="旧 Logo" /><Space><Upload showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setOldLogoAsset(file as File)}><Button size="small" icon={<ReloadOutlined />}>替换</Button></Upload><Button size="small" danger icon={<DeleteOutlined />} onClick={clearOldLogo}>删除</Button></Space></> : <Upload.Dragger showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setOldLogoAsset(file as File)}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">上传旧 Logo（选填）</p><p className="ant-upload-hint">PNG / JPEG / WebP</p></Upload.Dragger>}
    </div>
  );
  return (
    <div className="logo-replace-page">
      <section className="hero-strip logo-replace-hero"><div><Text className="eyebrow">LOGO REPLACER</Text><Title level={2}>批量替换场景中的品牌 Logo</Title><Paragraph className="hero-description">识别场景中的旧 Logo 并替换为新 Logo，其他内容严格保持不变。</Paragraph></div><div className="hero-orb" /></section>
      <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传已贴 Logo 的场景图</span></Space>} extra={<Text type="secondary">{scenes.length} 张</Text>}>
        {!scenes.length && <Upload.Dragger multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴场景图</p><p className="ant-upload-hint">支持多张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger>}
        {!!scenes.length && <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}
      </Card>
      <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>设置 Logo</span></Space>} extra={<Space><Text type="secondary">使用旧 Logo 参考</Text><Switch checked={settings.useOldLogoReference} onChange={(useOldLogoReference) => patchSettings({ useOldLogoReference })} /></Space>}>
        {settings.useOldLogoReference && <Alert type="info" showIcon title="旧 Logo 可不上传" description="上传旧 Logo 能帮助 AI 更准确识别需要替换的标识；新 Logo 必须上传。" style={{ marginBottom: 16 }} />}
        <div className={`replace-logo-grid${settings.useOldLogoReference ? '' : ' is-single'}`}>
          {settings.useOldLogoReference && <><Card size="small" title="旧 Logo（选填）">{oldLogoCard}</Card><div className="replace-arrow"><SwapOutlined /></div></>}
          <Card size="small" title="新 Logo（可多选）">
            {!newLogos.length ? <Upload.Dragger multiple showUploadList={false} accept={`${ACCEPTED_TYPES.join(',')},.psd,image/vnd.adobe.photoshop`} beforeUpload={(file) => addNewLogoFile(file as File)}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">上传一个或多个新 Logo</p><p className="ant-upload-hint">PNG / JPEG / WebP / PSD；PSD 可选择包括隐藏图层在内的 Logo</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-new-logo-grid">{newLogos.map((logo) => <div className="replace-new-logo-card" key={logo.id}><Image src={logo.previewUrl} alt="新 Logo" /><Input size="small" value={expectedTexts[logo.id] || ''} placeholder="准确文字（选填）" onChange={(event) => setExpectedTexts((current) => ({ ...current, [logo.id]: event.target.value }))} /><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNewLogo(logo.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={`${ACCEPTED_TYPES.join(',')},.psd,image/vnd.adobe.photoshop`} beforeUpload={(file) => addNewLogoFile(file as File)}><button type="button" className="replace-logo-add"><PlusOutlined /><span>添加 Logo / PSD</span></button></Upload></div></Image.PreviewGroup>}
          </Card>
        </div>
        {!!scenes.length && !!newLogos.length && <Card size="small" className="replace-pair-preview" title="场景与新 Logo 配对预览" extra={settings.randomAssignLogos && <Button size="small" icon={<ReloadOutlined />} onClick={() => { setRandomSeed(createId()); resetTasks(); }}>重新随机</Button>}>
          {pairings.some((pairing) => !pairing.logo) && <Alert type="error" showIcon title="存在未匹配场景" description="请为未匹配的场景手动指定一个新 Logo，或开启随机分配。" style={{ marginBottom: 12 }} />}
          <div className="replace-pair-preview-grid">{pairings.map(({ scene, logo }, index) => <div className="replace-pair-preview-item" key={scene.id}><Image src={scene.previewUrl} alt={`场景 ${index + 1}`} /><SwapOutlined /><div className="pair-logo-box">{logo ? <Image src={logo.previewUrl} alt={`新 Logo ${index + 1}`} /> : <Text type="danger">未匹配</Text>}</div><Text type="secondary">第 {index + 1} 组</Text><Select aria-label={`手动指定第 ${index + 1} 组 Logo`} value={manualLogoAssignments[scene.id] || ''} onChange={(logoId) => { setManualLogoAssignments((current) => { const next = { ...current }; if (logoId) next[scene.id] = logoId; else delete next[scene.id]; return next; }); resetTasks(); }} options={[{ value: '', label: '跟随自动分配' }, ...newLogos.map((item, logoIndex) => ({ value: item.id, label: `Logo ${logoIndex + 1} · ${item.name}` }))]} /></div>)}</div>
        </Card>}
      </Card>
      {settings.perImagePromptEnabled && <Card className="workflow-card" title="逐图提示词分配" extra={<Button icon={<ReloadOutlined />} onClick={() => void perImagePrompts.analyze()}>分析全部 / 重试失败</Button>}><div className="per-image-prompt-grid">{scenes.map((scene) => <Card size="small" key={scene.id} title={scene.name}><PerImagePromptEditor file={scene.file} assignment={perImagePrompts.assignments[perImagePromptFileKey(scene.file)]} sourcePrompt={perImagePromptSource} onEdit={(value) => perImagePrompts.edit(scene.file, value)} onAnalyze={() => void perImagePrompts.analyze([scene.file])} /></Card>)}</div></Card>}
      <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {taskCount} 张图片</Title><Text type="secondary">{scenes.length} 张场景图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{tasks.some((task) => task.status === 'failed') && <Button icon={<ReloadOutlined />} onClick={retryAllFailed}>一键重试所有失败</Button>}{processing && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={processing} onClick={() => void start()}>{processing ? '正在替换' : '开始替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((completed / tasks.length) * 100)} status={processing ? 'active' : successful.length ? 'success' : 'exception'} />}</Card>
      {processing && <Card size="small" title="单个任务控制"><Flex gap={8} wrap>{tasks.filter((task) => task.status === 'waiting' || task.status === 'running').map((task) => <Button danger size="small" key={task.id} icon={<StopOutlined />} onClick={() => stopTaskRetry(task.id)}>停止 场景 {task.sceneIndex + 1} · 结果 {task.copyIndex + 1}</Button>)}</Flex></Card>}
      <section className="results-section"><Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>替换结果</Title><Text type="secondary">每个结果仅改变 Logo</Text></div><Space wrap>{!!downloadable.length && <Checkbox checked={allSuccessfulSelected} indeterminate={selectedSuccessful.length > 0 && !allSuccessfulSelected} onChange={(event) => toggleSelectAllSuccessful(event.target.checked)}>全选成功项</Checkbox>}<Button disabled={!selectedSuccessful.length} icon={<DownloadOutlined />} onClick={() => void downloadSelected()}>下载选中{selectedSuccessful.length ? `（${selectedSuccessful.length}）` : ''}</Button><Popconfirm title="清空全部替换结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!downloadable.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
        {tasks.length ? <Image.PreviewGroup items={logoResultPreviewItems} preview={logoResultPreviewConfig}><div className="logo-replace-results">{groups.flatMap((group) => group.tasks.map((task) => <Card key={task.id} size="small" style={selectedResultIds.has(task.id) ? { borderColor: '#1677ff', boxShadow: '0 0 0 1px #1677ff' } : undefined} title={`场景 ${task.sceneIndex + 1} · 结果 ${task.copyIndex + 1}`} extra={task.resultBlob && <Space size={4}><Checkbox disabled={task.verificationStatus === 'failed' && !task.acceptedVerificationRisk} aria-label={`选择场景 ${task.sceneIndex + 1} 结果 ${task.copyIndex + 1}`} checked={selectedResultIds.has(task.id)} onChange={(event) => toggleResultSelection(task.id, event.target.checked)} /><Button type="text" disabled={task.verificationStatus === 'failed' && !task.acceptedVerificationRisk} icon={<DownloadOutlined />} onClick={() => downloadTask(task)} /><Button type="text" title="重新生成" icon={<ReloadOutlined />} onClick={() => retry(task.id)} /></Space>}><div className="replace-result-image">{task.resultUrl ? <Image src={compareOriginalIds.has(task.id) ? group.scene.previewUrl : task.resultUrl} preview={{ src: compareOriginalIds.has(task.id) ? group.scene.previewUrl : task.resultUrl }} alt={compareOriginalIds.has(task.id) ? "原始场景图" : "Logo 替换结果"} /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{task.nextRetryAt ? '等待自动重试' : statusText(task.status)}</Text><Text type="secondary">{task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div><Flex justify="space-between" align="center" gap={8} style={{ marginTop: 8 }}><Space size={6} wrap><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{task.nextRetryAt ? '等待重试' : statusText(task.status)}</Tag>{task.retryCount > 0 && <Tag color="orange">错误重试 {task.retryCount}/{settings.errorRetryLimit}</Tag>}{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareOriginalIds((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>{compareOriginalIds.has(task.id) ? '查看生成图' : '原图对比'}</Button>}</Space><Space size={6}>{task.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task.id)}>重试</Button>}{task.retryCount > 0 && (task.status === 'waiting' || task.status === 'running') && <Button danger size="small" icon={<StopOutlined />} onClick={() => stopTaskRetry(task.id)}>停止重试</Button>}</Space></Flex>{task.verificationStatus && <Flex vertical gap={6} style={{ marginTop: 8 }}><Tag color={task.verificationStatus === 'passed' ? 'success' : task.verificationStatus === 'failed' ? 'error' : task.verificationStatus === 'verifying' ? 'processing' : 'default'}>{task.verificationStatus === 'passed' ? '文字校验通过' : task.verificationStatus === 'failed' ? '文字校验未通过' : task.verificationStatus === 'verifying' ? '校验中' : task.verificationStatus === 'skipped' ? '未启用校验' : '等待校验'}</Tag>{task.verificationResult && <Text type={task.verificationStatus === 'failed' ? 'danger' : 'secondary'}>{[task.verificationResult.summary, ...task.verificationResult.differences].filter(Boolean).join('；')}{task.verificationAttempts ? `（校验 ${task.verificationAttempts} 次）` : ''}</Text>}{task.verificationStatus === 'failed' && !task.acceptedVerificationRisk && <Space><Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task.id)}>重新生成</Button><Button size="small" onClick={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, acceptedVerificationRisk: true } : item))}>人工确认可用</Button></Space>}{task.acceptedVerificationRisk && <Tag color="warning">已人工接受风险</Tag>}</Flex>}</Card>))}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成上传并开始替换后，结果会显示在这里" />}
      </section>
      <Alert type="warning" showIcon title="生成式替换提示" description="模型会尽量保持其他区域不变，但生成式图片接口不能保证像素级完全一致；旧 Logo 参考图有助于提高识别准确率。" />
      {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}
      {settingsHost && createPortal(settingsPanel, settingsHost)}
      <PsdLogoImportModal file={pendingPsdFile} onClose={() => setPendingPsdFile(undefined)} onImport={(files) => { addNewLogos(files); message.success(`已从 PSD 导入 ${files.length} 个透明 Logo 图层`); }} />
    </div>
  );
}

export default function LogoReplaceComposer(props: LogoReplaceComposerProps) {
  const initialModes = readLocalStorage<LogoReplaceSettings>(STORAGE_KEYS.logoReplaceSettings, DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings);
  const [multiEnabled, setMultiEnabled] = useState(Boolean(initialModes.multiLogoModeEnabled));
  const [distinctLogoPerOccurrence, setDistinctLogoPerOccurrence] = useState(Boolean(initialModes.distinctLogoPerOccurrence));
  const [singleHasSession, setSingleHasSession] = useState(false);
  const [multiHasSession, setMultiHasSession] = useState(false);
  useEffect(() => props.onSessionStateChange?.(singleHasSession || multiHasSession), [singleHasSession, multiHasSession, props.onSessionStateChange]);
  useEffect(() => {
    const stored = readLocalStorage<LogoReplaceSettings>(STORAGE_KEYS.logoReplaceSettings, DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings);
    localStorage.setItem(STORAGE_KEYS.logoReplaceSettings, JSON.stringify({ ...stored, multiLogoModeEnabled: multiEnabled, distinctLogoPerOccurrence }));
  }, [multiEnabled, distinctLogoPerOccurrence]);

  return (
    <div className="logo-replace-integrated">
      <Card className="logo-replace-mode-card" size="small">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <div><Text strong>单图匹配多 Logo</Text><br /><Text type="secondary">开启后先解析每张场景中的 Logo 样式和实际位置数量，再按场景独立分配。</Text></div>
          <Space wrap><Tooltip title="同一种旧 Logo 出现多次时，每个位置尽可能换成不同的新 Logo；新 Logo 不足才重复使用"><Checkbox checked={distinctLogoPerOccurrence} onChange={(event) => { const checked = event.target.checked; setDistinctLogoPerOccurrence(checked); if (checked) setMultiEnabled(true); }}>相同 Logo 多位置随机不同 Logo</Checkbox></Tooltip><Switch checked={multiEnabled} onChange={(checked) => { setMultiEnabled(checked); if (!checked) setDistinctLogoPerOccurrence(false); }} /></Space>
        </Flex>
      </Card>
      <div hidden={multiEnabled}>
        <LogoReplaceSingleComposer {...props} settingsHost={multiEnabled ? null : props.settingsHost} onSessionStateChange={setSingleHasSession} />
      </div>
      <div hidden={!multiEnabled}>
        <LogoReplaceDevComposer {...props} settingsHost={multiEnabled ? props.settingsHost : null} onSessionStateChange={setMultiHasSession} integrated distinctLogoPerOccurrence={distinctLogoPerOccurrence} />
      </div>
    </div>
  );
}
