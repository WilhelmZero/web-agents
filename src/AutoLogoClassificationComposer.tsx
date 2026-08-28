import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
} from "@ant-design/icons";
import JSZip from "jszip";
import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_AUTO_LOGO_GENERATION_SETTINGS,
  DEFAULT_LOGO_CLASSIFICATION_SETTINGS,
  MODEL_CAPABILITIES,
  STORAGE_KEYS,
} from "./constants";
import { buildPickerFolderTree } from "./MultiTabSceneReplaceComposer";
import { groupFolderFiles } from "./MultiTabLogoReplaceComposer";
import { readLocalStorage } from "./storage";
import type {
  AutoLogoClassificationTask,
  AutoLogoGenerationSettings,
  ImageModel,
  LogoAsset,
  LogoClassificationPreset,
  LogoClassificationSettings,
} from "./types";
import {
  createId,
  downloadBlob,
  mimeExtension,
  normalizeSettingsForModel,
  sanitizeFileName,
} from "./utils";
import {
  allocateLogoIds,
  autoLogoStatusLabel,
  clampLogoCount,
  createAutoLogoTasks,
} from "./services/autoLogoPipeline";
import {
  classifyLogoReplacementImage,
  normalizeLogoClassificationPresets,
  withLogoClassificationFallback,
} from "./services/logoClassification";
import {
  generateExactLogoReplacement,
  verifyLogoReplacement,
} from "./services/gemini";
import {
  generateExactLogoReplacementOpenAi,
  verifyLogoReplacementOpenAi,
} from "./services/logoReplaceOpenAi";
import {
  batchCostMetrics,
  formatBatchDateTime,
  percentage,
} from "./services/batchExecutionMetrics";
import { formatBatchDuration } from "./services/batchTiming";
import { sanitizeRelativeFolderPath } from "./services/batchFolderPath";
import { reportTaskProgress } from "./services/taskProgress";

const { Title, Text, Paragraph } = Typography;
type Group = ReturnType<typeof groupFolderFiles>[number];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ANALYSIS_GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash",
  "gemini-2.5-flash",
].map((value) => ({ value, label: value }));
const ANALYSIS_OPENAI_MODELS = [
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.6-luna",
].map((value) => ({ value, label: value }));

function waitWithSignal(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function fileAsset(file: File): LogoAsset {
  return {
    id: createId(),
    name: file.name,
    file,
    mimeType: file.type,
    previewUrl: URL.createObjectURL(file),
  };
}

function FolderCover({
  file,
  generatedUrl,
}: {
  file?: File;
  generatedUrl?: string;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  useEffect(() => {
    if (generatedUrl || !file) return setSourceUrl("");
    const next = URL.createObjectURL(file);
    setSourceUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, generatedUrl]);
  const src = generatedUrl || sourceUrl;
  return src ? (
    <Image
      preview={false}
      src={src}
      alt={file?.name || "文件夹封面"}
      width="100%"
      height={160}
      style={{ objectFit: "cover", borderRadius: 8 }}
    />
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片" />
  );
}

function PresetEditor({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial?: LogoClassificationPreset;
  onCancel: () => void;
  onSave: (value: { name: string; prompt: string }) => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setPrompt(initial?.prompt || "");
    }
  }, [open, initial]);
  return (
    <Modal
      title={initial ? "编辑 Logo 替换分类" : "新增 Logo 替换分类"}
      open={open}
      okText="保存"
      onCancel={onCancel}
      onOk={() => onSave({ name, prompt })}
      okButtonProps={{ disabled: !name.trim() || !prompt.trim() }}
    >
      <Form layout="vertical">
        <Form.Item label="分类名称" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：玻璃杯激光雕刻"
          />
        </Form.Item>
        <Form.Item label="Logo 替换提示词" required>
          <Input.TextArea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            autoSize={{ minRows: 7, maxRows: 14 }}
            placeholder="该内容会逐字提交给图片模型"
          />
        </Form.Item>
        <Alert
          type="warning"
          showIcon
          title="生成请求只使用这段提示词"
          description="不会追加图片顺序、映射、保护模板、逐图限制或校验修正文字。"
        />
      </Form>
    </Modal>
  );
}

export default function AutoLogoClassificationComposer({
  apiKey,
  openAiApiKey,
  apiBaseUrl,
  connectionMode,
  onRequestKey,
  settingsHost,
}: {
  apiKey: string;
  openAiApiKey: string;
  apiBaseUrl: string | null;
  connectionMode: "direct" | "proxy";
  onRequestKey: () => void;
  settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [checkedFolders, setCheckedFolders] = useState<string[]>([]);
  const [logos, setLogos] = useState<LogoAsset[]>([]);
  const [oldLogo, setOldLogo] = useState<LogoAsset>();
  const [presets, setPresets] = useState<LogoClassificationPreset[]>(() =>
    normalizeLogoClassificationPresets(
      readLocalStorage(STORAGE_KEYS.logoClassificationPresets, []),
    ),
  );
  const [analysisSettings, setAnalysisSettings] =
    useState<LogoClassificationSettings>(
      () =>
        ({
          ...DEFAULT_LOGO_CLASSIFICATION_SETTINGS,
          ...readLocalStorage(STORAGE_KEYS.logoClassificationSettings, {}),
        }) as LogoClassificationSettings,
    );
  const [generationSettings, setGenerationSettings] =
    useState<AutoLogoGenerationSettings>(
      () =>
        ({
          ...DEFAULT_AUTO_LOGO_GENERATION_SETTINGS,
          ...readLocalStorage(
            STORAGE_KEYS.logoClassificationGenerationSettings,
            {},
          ),
        }) as AutoLogoGenerationSettings,
    );
  const [tasks, setTasks] = useState<AutoLogoClassificationTask[]>([]);
  const [presetEditor, setPresetEditor] = useState<{
    open: boolean;
    preset?: LogoClassificationPreset;
  }>({ open: false });
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [runEndedAt, setRunEndedAt] = useState<number>();
  const [analysisRequests, setAnalysisRequests] = useState(0);
  const [generationRequests, setGenerationRequests] = useState(0);
  const [verificationRequests, setVerificationRequests] = useState(0);
  const analysisRunning = useRef(new Set<string>());
  const generationRunning = useRef(new Set<string>());
  const analysisControllers = useRef(new Map<string, AbortController>());
  const generationControllers = useRef(new Map<string, AbortController>());
  const frozenPresets = useRef<LogoClassificationPreset[]>([]);
  const frozenLogos = useRef<LogoAsset[]>([]);
  const frozenOldLogo = useRef<LogoAsset | undefined>(undefined);
  const tasksRef = useRef(tasks);
  const logosRef = useRef(logos);
  const oldLogoRef = useRef(oldLogo);
  const analysisSettingsRef = useRef(analysisSettings);
  const generationSettingsRef = useRef(generationSettings);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    logosRef.current = logos;
  }, [logos]);
  useEffect(() => {
    oldLogoRef.current = oldLogo;
  }, [oldLogo]);
  useEffect(() => {
    analysisSettingsRef.current = analysisSettings;
    localStorage.setItem(
      STORAGE_KEYS.logoClassificationSettings,
      JSON.stringify(analysisSettings),
    );
  }, [analysisSettings]);
  useEffect(() => {
    generationSettingsRef.current = generationSettings;
    localStorage.setItem(
      STORAGE_KEYS.logoClassificationGenerationSettings,
      JSON.stringify(generationSettings),
    );
  }, [generationSettings]);
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.logoClassificationPresets,
      JSON.stringify(presets),
    );
  }, [presets]);
  useEffect(
    () => () => {
      tasksRef.current.forEach(
        (task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl),
      );
      logosRef.current.forEach((logo) => URL.revokeObjectURL(logo.previewUrl));
      if (oldLogoRef.current)
        URL.revokeObjectURL(oldLogoRef.current.previewUrl);
    },
    [],
  );

  const patchGeneration = (patch: Partial<AutoLogoGenerationSettings>) =>
    setGenerationSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.imageModel && next.imageProvider === "gemini")
        return {
          ...next,
          ...normalizeSettingsForModel(
            patch.imageModel,
            next.aspectRatio,
            next.imageSize,
          ),
        };
      return next;
    });
  const clearRun = useCallback(() => {
    analysisControllers.current.forEach((item) => item.abort());
    generationControllers.current.forEach((item) => item.abort());
    setTasks((current) => {
      current.forEach(
        (task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl),
      );
      return [];
    });
    analysisRunning.current.clear();
    generationRunning.current.clear();
    setRunStartedAt(undefined);
    setRunEndedAt(undefined);
    setAnalysisRequests(0);
    setGenerationRequests(0);
    setVerificationRequests(0);
  }, []);
  const reviewFiles = (files: File[]) => {
    const valid = files.filter(
      (file) =>
        IMAGE_TYPES.includes(file.type) &&
        file.size > 0 &&
        file.size <= 20 * 1024 * 1024,
    );
    setPendingFiles(valid);
    setCheckedFolders([]);
    if (valid.length !== files.length)
      message.warning("已忽略非图片、空文件或超过 20MB 的文件");
  };
  const importChecked = () => {
    const selected = groupFolderFiles(pendingFiles).filter((group) =>
      checkedFolders.includes(`dir:${group.path}`),
    );
    setGroups((current) => {
      const map = new Map(current.map((item) => [item.path, item]));
      selected.forEach((item) => map.set(item.path, item));
      return [...map.values()].sort((a, b) =>
        a.path.localeCompare(b.path, "zh-CN"),
      );
    });
    setPendingFiles([]);
    setCheckedFolders([]);
    clearRun();
  };
  const addLogo = (file: File) => {
    if (!IMAGE_TYPES.includes(file.type))
      return message.warning("Logo 仅支持 PNG、JPG 或 WebP");
    setLogos((current) => [...current, fileAsset(file)]);
    clearRun();
  };
  const setOldLogoFile = (file: File) => {
    if (!IMAGE_TYPES.includes(file.type))
      return message.warning("旧 Logo 仅支持 PNG、JPG 或 WebP");
    setOldLogo((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return fileAsset(file);
    });
    clearRun();
  };
  const removeLogo = (id: string) => {
    setLogos((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
    clearRun();
  };
  const savePreset = ({ name, prompt }: { name: string; prompt: string }) => {
    setPresets((current) =>
      presetEditor.preset
        ? current.map((item) =>
            item.id === presetEditor.preset?.id
              ? { ...item, name: name.trim(), prompt, updatedAt: Date.now() }
              : item,
          )
        : [
            ...current,
            {
              id: createId(),
              name: name.trim(),
              prompt,
              isFallback: current.length === 0,
              updatedAt: Date.now(),
            },
          ],
    );
    setPresetEditor({ open: false });
  };
  const deletePreset = (id: string) =>
    setPresets((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.isFallback && current.length > 1) {
        message.warning("请先把其他分类设为兜底分类");
        return current;
      }
      return current.filter((item) => item.id !== id);
    });

  const executeGeneration = useCallback(
    async (task: AutoLogoClassificationTask) => {
      if (
        generationRunning.current.has(task.id) ||
        !task.categoryPrompt ||
        !task.effectiveLogoCount
      )
        return;
      const selected = (task.selectedLogoIds || [])
        .map((id) => frozenLogos.current.find((item) => item.id === id))
        .filter(Boolean) as LogoAsset[];
      if (!selected.length) return;
      generationRunning.current.add(task.id);
      const controller = new AbortController();
      generationControllers.current.set(task.id, controller);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "generating",
                generationStartedAt: item.generationStartedAt || Date.now(),
                verificationStatus: generationSettingsRef.current
                  .strictVerification
                  ? "waiting"
                  : undefined,
                error: undefined,
              }
            : item,
        ),
      );
      let retry = task.generationRetryCount;
      let verificationRetry = 0;
      try {
        const config = generationSettingsRef.current;
        while (true) {
          try {
            setGenerationRequests((value) => value + 1);
            const result =
              config.imageProvider === "openai"
                ? await generateExactLogoReplacementOpenAi({
                    apiKey: openAiApiKey,
                    model: config.openAiImageModel,
                    scene: task.file,
                    oldLogo: frozenOldLogo.current?.file,
                    logos: selected.map((item) => item.file),
                    prompt: task.categoryPrompt,
                    signal: controller.signal,
                  })
                : await generateExactLogoReplacement({
                    apiKey,
                    apiBaseUrl,
                    model: config.imageModel,
                    scene: task.file,
                    oldLogo: frozenOldLogo.current?.file,
                    logos: selected.map((item) => item.file),
                    prompt: task.categoryPrompt,
                    imageSize: config.imageSize,
                    aspectRatio:
                      config.ratioMode === "fixed"
                        ? config.aspectRatio
                        : undefined,
                    signal: controller.signal,
                  });
            let verificationSummary: string | undefined;
            if (config.strictVerification) {
              setVerificationRequests((value) => value + 1);
              setTasks((current) =>
                current.map((item) =>
                  item.id === task.id
                    ? { ...item, verificationStatus: "verifying" }
                    : item,
                ),
              );
              const verification =
                analysisSettingsRef.current.provider === "openai"
                  ? await verifyLogoReplacementOpenAi({
                      apiKey: openAiApiKey,
                      model: analysisSettingsRef.current.openAiModel,
                      referenceLogo: selected[0].file,
                      originalScene: task.file,
                      generatedImage: result.blob,
                      signal: controller.signal,
                    })
                  : await verifyLogoReplacement({
                      apiKey,
                      apiBaseUrl,
                      model: analysisSettingsRef.current.geminiModel,
                      referenceLogo: selected[0].file,
                      originalScene: task.file,
                      generatedImage: result.blob,
                      signal: controller.signal,
                    });
              verificationSummary = verification.summary;
              if (
                !verification.passed &&
                verificationRetry < config.verificationRetries
              ) {
                verificationRetry += 1;
                retry += 1;
                continue;
              }
              if (!verification.passed)
                throw new Error(`严格校验未通过：${verification.summary}`);
            }
            const resultUrl = URL.createObjectURL(result.blob);
            setTasks((current) =>
              current.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      status: "success",
                      generationRetryCount: retry,
                      generationEndedAt: Date.now(),
                      resultBlob: result.blob,
                      resultUrl,
                      resultMimeType: result.mimeType,
                      verificationStatus: config.strictVerification
                        ? "passed"
                        : undefined,
                      verificationSummary,
                      error: undefined,
                    }
                  : item,
              ),
            );
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (
              !config.autoRetryErrors ||
              retry >= config.errorRetryLimit ||
              (error instanceof Error &&
                error.message.startsWith("严格校验未通过"))
            )
              throw error;
            retry += 1;
            setTasks((current) =>
              current.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      generationRetryCount: retry,
                      error: `${error instanceof Error ? error.message : "生成失败"}；等待自动重试`,
                    }
                  : item,
              ),
            );
            await waitWithSignal(
              Math.max(1, config.errorRetryDelaySeconds) * 1000,
              controller.signal,
            );
          }
        }
      } catch (error) {
        const stopped = controller.signal.aborted;
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: stopped ? "stopped" : "failed",
                  generationRetryCount: retry,
                  generationEndedAt: Date.now(),
                  verificationStatus: stopped
                    ? item.verificationStatus
                    : item.verificationStatus === "verifying"
                      ? "failed"
                      : item.verificationStatus,
                  error: stopped
                    ? "任务已停止"
                    : error instanceof Error
                      ? error.message
                      : "Logo 替换失败",
                }
              : item,
          ),
        );
      } finally {
        generationRunning.current.delete(task.id);
        generationControllers.current.delete(task.id);
      }
    },
    [apiKey, openAiApiKey, apiBaseUrl],
  );

  const executeAnalysis = useCallback(
    async (task: AutoLogoClassificationTask) => {
      if (analysisRunning.current.has(task.id)) return;
      analysisRunning.current.add(task.id);
      const controller = new AbortController();
      analysisControllers.current.set(task.id, controller);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: "analyzing",
                analysisStartedAt: Date.now(),
                error: undefined,
              }
            : item,
        ),
      );
      const config = analysisSettingsRef.current;
      const snapshot = frozenPresets.current;
      const fallback = snapshot.find((item) => item.isFallback) || snapshot[0];
      let retry = 0;
      try {
        let result:
          Awaited<ReturnType<typeof classifyLogoReplacementImage>> | undefined;
        let lastError: unknown;
        while (
          !result &&
          retry <= (config.autoRetryErrors ? config.errorRetryLimit : 0)
        ) {
          try {
            setAnalysisRequests((value) => value + 1);
            result = await classifyLogoReplacementImage({
              provider: config.provider,
              apiKey: config.provider === "openai" ? openAiApiKey : apiKey,
              apiBaseUrl,
              geminiModel: config.geminiModel,
              openAiModel: config.openAiModel,
              image: task.file,
              presets: snapshot,
              analyzeLogoCount: config.analyzeLogoCount,
              signal: controller.signal,
            });
          } catch (error) {
            lastError = error;
            if (
              controller.signal.aborted ||
              retry >= (config.autoRetryErrors ? config.errorRetryLimit : 0)
            )
              break;
            retry += 1;
            setTasks((current) =>
              current.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      analysisRetryCount: retry,
                      error: "分析失败，等待自动重试",
                    }
                  : item,
              ),
            );
            await waitWithSignal(
              Math.max(1, config.errorRetryDelaySeconds) * 1000,
              controller.signal,
            );
          }
        }
        const chosen = result
          ? snapshot.find((item) => item.id === result.categoryId) || fallback
          : fallback;
        if (!chosen) throw new Error("没有可用的兜底分类");
        const count = result
          ? {
              raw: result.rawLogoCount,
              effective: result.effectiveLogoCount,
              truncated: result.logoCountTruncated,
            }
          : clampLogoCount(1);
        const selectedLogoIds = allocateLogoIds(
          frozenLogos.current.map((item) => item.id),
          count.effective,
        );
        const source: "ai" | "fallback" = result
          ? result.usedFallback
            ? "fallback"
            : "ai"
          : "fallback";
        const reason =
          result?.reason ||
          `${lastError instanceof Error ? lastError.message : "分析请求失败"}；已使用兜底分类并按 1 个 Logo 生成`;
        if (count.effective === 0) {
          const resultUrl = URL.createObjectURL(task.file);
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "skipped-no-logo",
                    categoryId: chosen.id,
                    categoryName: chosen.name,
                    categoryPrompt: chosen.prompt,
                    classificationSource: source,
                    classificationReason: reason,
                    rawLogoCount: count.raw,
                    effectiveLogoCount: 0,
                    logoCountTruncated: count.truncated,
                    selectedLogoIds: [],
                    analysisRetryCount: retry,
                    analysisEndedAt: Date.now(),
                    resultBlob: task.file,
                    resultUrl,
                    resultMimeType: task.file.type,
                    generationEndedAt: Date.now(),
                    error: undefined,
                  }
                : item,
            ),
          );
          return;
        }
        setTasks((current) => {
          const original = current.find((item) => item.id === task.id);
          if (!original) return current;
          const base = {
            ...original,
            status: "waiting-generation" as const,
            categoryId: chosen.id,
            categoryName: chosen.name,
            categoryPrompt: chosen.prompt,
            classificationSource: source,
            classificationReason: reason,
            rawLogoCount: count.raw,
            effectiveLogoCount: count.effective,
            logoCountTruncated: count.truncated,
            selectedLogoIds,
            analysisRetryCount: retry,
            analysisEndedAt: Date.now(),
            error: undefined,
          };
          const clones = Array.from(
            {
              length:
                Math.max(1, generationSettingsRef.current.copiesPerScene) - 1,
            },
            (_, index) => ({ ...base, id: createId(), copyIndex: index + 1 }),
          );
          return current
            .map((item) => (item.id === task.id ? base : item))
            .concat(clones);
        });
      } catch (error) {
        const stopped = controller.signal.aborted;
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: stopped ? "stopped" : "failed",
                  analysisRetryCount: retry,
                  analysisEndedAt: Date.now(),
                  error: stopped
                    ? "任务已停止"
                    : error instanceof Error
                      ? error.message
                      : "分析失败",
                }
              : item,
          ),
        );
      } finally {
        analysisRunning.current.delete(task.id);
        analysisControllers.current.delete(task.id);
      }
    },
    [apiKey, openAiApiKey, apiBaseUrl],
  );

  useEffect(() => {
    const free = Math.max(
      0,
      analysisSettings.concurrency - analysisRunning.current.size,
    );
    tasks
      .filter(
        (item) =>
          item.status === "waiting-analysis" &&
          item.copyIndex === 0 &&
          !analysisRunning.current.has(item.id),
      )
      .slice(0, free)
      .forEach((item) => void executeAnalysis(item));
  }, [tasks, analysisSettings.concurrency, executeAnalysis]);
  useEffect(() => {
    const free = Math.max(
      0,
      generationSettings.concurrency - generationRunning.current.size,
    );
    tasks
      .filter(
        (item) =>
          item.status === "waiting-generation" &&
          !generationRunning.current.has(item.id),
      )
      .slice(0, free)
      .forEach((item) => void executeGeneration(item));
  }, [tasks, generationSettings.concurrency, executeGeneration]);
  const running = tasks.some((item) =>
    [
      "waiting-analysis",
      "analyzing",
      "waiting-generation",
      "generating",
    ].includes(item.status),
  );
  useEffect(() => {
    if (runStartedAt && tasks.length && !running && !runEndedAt)
      setRunEndedAt(Date.now());
  }, [runStartedAt, tasks.length, running, runEndedAt]);
  useEffect(() => {
    const completed = tasks.filter((item) =>
      ["success", "failed", "stopped", "skipped-no-logo"].includes(item.status),
    ).length;
    reportTaskProgress({
      id: "auto-logo-classify",
      label: "自动分类 Logo 替换",
      running,
      total: tasks.length,
      completed,
      failed: tasks.filter((item) => item.status === "failed").length,
    });
  }, [tasks, running]);

  const start = () => {
    const normalized = normalizeLogoClassificationPresets(presets);
    const fallback = normalized.find((item) => item.isFallback);
    if (!groups.length)
      return void message.warning("请先导入至少一个图片文件夹");
    if (!logos.length) return void message.warning("请先上传至少一个新 Logo");
    if (!normalized.length || !fallback)
      return void message.warning("请先创建分类并指定兜底分类");
    const analysisKey =
      analysisSettings.provider === "openai" ? openAiApiKey : apiKey;
    const generationKey =
      generationSettings.imageProvider === "openai" ? openAiApiKey : apiKey;
    if (!analysisKey || !generationKey) return onRequestKey();
    if (
      connectionMode === "proxy" &&
      (analysisSettings.provider === "gemini" ||
        generationSettings.imageProvider === "gemini") &&
      !apiBaseUrl
    )
      return void message.warning("请先配置 Gemini 代理地址");
    clearRun();
    frozenPresets.current = normalized.map((item) => ({ ...item }));
    frozenLogos.current = logos.map((item) => ({ ...item }));
    frozenOldLogo.current = oldLogo ? { ...oldLogo } : undefined;
    setRunStartedAt(Date.now());
    setTasks(createAutoLogoTasks(groups));
  };
  const stopAll = () => {
    analysisControllers.current.forEach((item) => item.abort());
    generationControllers.current.forEach((item) => item.abort());
    setTasks((current) =>
      current.map((item) =>
        ["waiting-analysis", "waiting-generation"].includes(item.status)
          ? { ...item, status: "stopped", error: "任务已停止" }
          : item,
      ),
    );
  };
  const retryTask = (task: AutoLogoClassificationTask, reanalyze = false) => {
    if (reanalyze)
      tasksRef.current
        .filter(
          (item) =>
            item.groupId === task.groupId && item.fileIndex === task.fileIndex,
        )
        .forEach((item) => {
          analysisControllers.current.get(item.id)?.abort();
          generationControllers.current.get(item.id)?.abort();
        });
    if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
    setRunEndedAt(undefined);
    setTasks((current) =>
      current
        .filter(
          (item) =>
            !(
              reanalyze &&
              item.groupId === task.groupId &&
              item.fileIndex === task.fileIndex &&
              item.copyIndex > 0
            ),
        )
        .map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: reanalyze
                  ? "waiting-analysis"
                  : item.effectiveLogoCount === 0
                    ? "skipped-no-logo"
                    : "waiting-generation",
                resultBlob: undefined,
                resultUrl: undefined,
                error: undefined,
                generationRetryCount: 0,
                verificationStatus: undefined,
                ...(reanalyze
                  ? {
                      categoryId: undefined,
                      categoryName: undefined,
                      categoryPrompt: undefined,
                      classificationSource: undefined,
                      classificationReason: undefined,
                      rawLogoCount: undefined,
                      effectiveLogoCount: undefined,
                      logoCountTruncated: undefined,
                      selectedLogoIds: undefined,
                      analysisRetryCount: 0,
                    }
                  : {}),
              }
            : item,
        ),
    );
  };
  const retryAll = () => {
    setRunEndedAt(undefined);
    setTasks((current) =>
      current.map((item) =>
        item.status === "failed" || item.status === "stopped"
          ? {
              ...item,
              status: item.categoryPrompt
                ? "waiting-generation"
                : "waiting-analysis",
              error: undefined,
            }
          : item,
      ),
    );
  };
  const assignCategory = (
    task: AutoLogoClassificationTask,
    categoryId: string,
  ) => {
    const preset = (
      frozenPresets.current.length ? frozenPresets.current : presets
    ).find((item) => item.id === categoryId);
    if (!preset) return;
    setTasks((current) =>
      current.map((item) =>
        item.groupId === task.groupId && item.fileIndex === task.fileIndex
          ? {
              ...item,
              categoryId: preset.id,
              categoryName: preset.name,
              categoryPrompt: preset.prompt,
              classificationSource: "manual",
              classificationReason: "用户手动指定分类",
            }
          : item,
      ),
    );
  };
  const assignCount = (
    task: AutoLogoClassificationTask,
    value: number | null,
  ) => {
    const count = clampLogoCount(value);
    const ids = allocateLogoIds(
      frozenLogos.current.map((item) => item.id),
      count.effective,
    );
    tasksRef.current
      .filter(
        (item) =>
          item.groupId === task.groupId && item.fileIndex === task.fileIndex,
      )
      .forEach((item) => {
        analysisControllers.current.get(item.id)?.abort();
        generationControllers.current.get(item.id)?.abort();
      });
    setRunEndedAt(undefined);
    setTasks((current) => {
      const source =
        current.find(
          (item) =>
            item.groupId === task.groupId &&
            item.fileIndex === task.fileIndex &&
            item.copyIndex === 0,
        ) || task;
      current
        .filter(
          (item) =>
            item.groupId === task.groupId && item.fileIndex === task.fileIndex,
        )
        .forEach(
          (item) => item.resultUrl && URL.revokeObjectURL(item.resultUrl),
        );
      const others = current.filter(
        (item) =>
          !(item.groupId === task.groupId && item.fileIndex === task.fileIndex),
      );
      if (count.effective === 0) {
        const url = URL.createObjectURL(source.file);
        return [
          ...others,
          {
            ...source,
            status: "skipped-no-logo" as const,
            rawLogoCount: count.raw,
            effectiveLogoCount: 0,
            logoCountTruncated: count.truncated,
            selectedLogoIds: [],
            resultBlob: source.file,
            resultUrl: url,
            resultMimeType: source.file.type,
            classificationSource: "manual" as const,
            classificationReason: "用户手动设置 Logo 数量为 0",
            error: undefined,
          },
        ];
      }
      const base = {
        ...source,
        status: "waiting-generation" as const,
        rawLogoCount: count.raw,
        effectiveLogoCount: count.effective,
        logoCountTruncated: count.truncated,
        selectedLogoIds: ids,
        resultBlob: undefined,
        resultUrl: undefined,
        error: undefined,
        copyIndex: 0,
      };
      return [
        ...others,
        base,
        ...Array.from(
          {
            length:
              Math.max(1, generationSettingsRef.current.copiesPerScene) - 1,
          },
          (_, index) => ({ ...base, id: createId(), copyIndex: index + 1 }),
        ),
      ];
    });
  };

  const success = tasks.filter((item) => item.status === "success").length;
  const zeroLogo = tasks.filter(
    (item) => item.status === "skipped-no-logo",
  ).length;
  const failed = tasks.filter((item) => item.status === "failed").length;
  const stopped = tasks.filter((item) => item.status === "stopped").length;
  const sourceTasks = tasks.filter((item) => item.copyIndex === 0);
  const analyzed = sourceTasks.filter((item) => item.analysisEndedAt).length;
  const fallbackCount = sourceTasks.filter(
    (item) => item.classificationSource === "fallback",
  ).length;
  const analysisRetries = sourceTasks.reduce(
    (sum, item) => sum + item.analysisRetryCount,
    0,
  );
  const generationRetries = tasks.reduce(
    (sum, item) => sum + item.generationRetryCount,
    0,
  );
  const planned =
    groups.reduce((sum, group) => sum + group.files.length, 0) *
    generationSettings.copiesPerScene;
  const terminal = success + zeroLogo + failed + stopped;
  const cost = batchCostMetrics({
    model:
      generationSettings.imageProvider === "openai"
        ? generationSettings.openAiImageModel
        : generationSettings.imageModel,
    size: generationSettings.imageSize,
    plannedRequests: planned,
    worstCaseMultiplier:
      1 +
      generationSettings.errorRetryLimit +
      (generationSettings.strictVerification
        ? generationSettings.verificationRetries
        : 0),
    actualRequests: generationRequests,
  });
  const categoryDistribution = useMemo(
    () =>
      Object.values(
        sourceTasks.reduce<Record<string, { name: string; count: number }>>(
          (map, item) => {
            if (item.categoryId)
              map[item.categoryId] = {
                name: item.categoryName || item.categoryId,
                count: (map[item.categoryId]?.count || 0) + 1,
              };
            return map;
          },
          {},
        ),
      ),
    [sourceTasks],
  );
  const countDistribution = useMemo(
    () =>
      Object.entries(
        sourceTasks.reduce<Record<string, number>>((map, item) => {
          if (item.effectiveLogoCount !== undefined)
            map[String(item.effectiveLogoCount)] =
              (map[String(item.effectiveLogoCount)] || 0) + 1;
          return map;
        }, {}),
      ),
    [sourceTasks],
  );
  const selectedGroup = groups.find((item) => item.id === selectedGroupId);
  const selectedTasks = tasks
    .filter((item) => item.groupId === selectedGroupId)
    .sort((a, b) => a.fileIndex - b.fileIndex || a.copyIndex - b.copyIndex);
  const selectedPreviewTasks = selectedTasks.filter((item) => item.resultUrl);
  const selectedOriginalUrls = useMemo(
    () =>
      Object.fromEntries(
        selectedPreviewTasks.map((task) => [
          task.id,
          URL.createObjectURL(task.file),
        ]),
      ),
    [selectedGroupId, selectedPreviewTasks.length],
  );
  useEffect(
    () => () =>
      Object.values(selectedOriginalUrls).forEach((url) =>
        URL.revokeObjectURL(url),
      ),
    [selectedOriginalUrls],
  );
  const outputName = (task: AutoLogoClassificationTask) =>
    task.status === "skipped-no-logo"
      ? task.file.name
      : `${sanitizeFileName(task.file.name.replace(/\.[^.]+$/, ""))}_Logo替换_${task.copyIndex + 1}.${mimeExtension(task.resultMimeType || "image/png")}`;
  const downloadOne = (task: AutoLogoClassificationTask) => {
    if (task.resultBlob) downloadBlob(task.resultBlob, outputName(task));
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    tasks
      .filter(
        (item) =>
          item.resultBlob &&
          ["success", "skipped-no-logo"].includes(item.status),
      )
      .forEach((task) =>
        zip.file(
          `${sanitizeRelativeFolderPath(task.relativePath, task.groupName)}/${outputName(task)}`,
          task.resultBlob!,
        ),
      );
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      `自动分类Logo替换-${Date.now()}.zip`,
    );
  };

  const settingsPanel = (
    <div className="settings-panel">
      <Title level={4}>自动分类 Logo 设置</Title>
      <Form layout="vertical">
        <Form.Item label="分析服务商">
          <Segmented
            block
            value={analysisSettings.provider}
            options={[
              { value: "gemini", label: "Gemini" },
              { value: "openai", label: "GPT" },
            ]}
            onChange={(provider) =>
              setAnalysisSettings((current) => ({
                ...current,
                provider: provider as LogoClassificationSettings["provider"],
              }))
            }
          />
        </Form.Item>
        <Form.Item label="分析模型">
          <Select
            value={
              analysisSettings.provider === "openai"
                ? analysisSettings.openAiModel
                : analysisSettings.geminiModel
            }
            options={
              analysisSettings.provider === "openai"
                ? ANALYSIS_OPENAI_MODELS
                : ANALYSIS_GEMINI_MODELS
            }
            onChange={(value) =>
              setAnalysisSettings((current) =>
                analysisSettings.provider === "openai"
                  ? {
                      ...current,
                      openAiModel:
                        value as LogoClassificationSettings["openAiModel"],
                    }
                  : {
                      ...current,
                      geminiModel:
                        value as LogoClassificationSettings["geminiModel"],
                    },
              )
            }
          />
        </Form.Item>
        <Form.Item>
          <Flex justify="space-between">
            <Text>分析 Logo 个数</Text>
            <Switch
              checked={analysisSettings.analyzeLogoCount}
              onChange={(analyzeLogoCount) =>
                setAnalysisSettings((current) => ({
                  ...current,
                  analyzeLogoCount,
                }))
              }
            />
          </Flex>
          <Text type="secondary">
            关闭时固定携带第一张 Logo；开启后识别 0–16 个产品载体 Logo 位置。
          </Text>
        </Form.Item>
        <Form.Item label="分析并发">
          <InputNumber
            min={1}
            max={8}
            value={analysisSettings.concurrency}
            onChange={(concurrency) =>
              setAnalysisSettings((current) => ({
                ...current,
                concurrency: concurrency || 1,
              }))
            }
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="生图服务商">
          <Segmented
            block
            value={generationSettings.imageProvider}
            options={[
              { value: "gemini", label: "Gemini" },
              { value: "openai", label: "GPT" },
            ]}
            onChange={(imageProvider) =>
              patchGeneration({
                imageProvider:
                  imageProvider as AutoLogoGenerationSettings["imageProvider"],
              })
            }
          />
        </Form.Item>
        {generationSettings.imageProvider === "gemini" ? (
          <>
            <Form.Item label="图片模型">
              <Select
                value={generationSettings.imageModel}
                options={Object.entries(MODEL_CAPABILITIES).map(
                  ([value, item]) => ({ value, label: item.label }),
                )}
                onChange={(imageModel) =>
                  patchGeneration({ imageModel: imageModel as ImageModel })
                }
              />
            </Form.Item>
            <Form.Item label="输出分辨率">
              <Segmented
                block
                value={generationSettings.imageSize}
                options={
                  MODEL_CAPABILITIES[generationSettings.imageModel].imageSizes
                }
                onChange={(imageSize) => patchGeneration({ imageSize })}
              />
            </Form.Item>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            title="GPT Image 2 将使用最高质量输出"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item label="生图并发">
          <InputNumber
            min={1}
            max={8}
            value={generationSettings.concurrency}
            onChange={(concurrency) =>
              patchGeneration({ concurrency: concurrency || 1 })
            }
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="每张生成数量">
          <InputNumber
            min={1}
            max={8}
            value={generationSettings.copiesPerScene}
            onChange={(copiesPerScene) =>
              patchGeneration({ copiesPerScene: copiesPerScene || 1 })
            }
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item>
          <Flex justify="space-between">
            <Text>严格校验</Text>
            <Switch
              checked={generationSettings.strictVerification}
              onChange={(strictVerification) =>
                patchGeneration({ strictVerification })
              }
            />
          </Flex>
          <Text type="secondary">
            校验失败重试仍逐字使用原预设，不追加修正提示。
          </Text>
        </Form.Item>
        {generationSettings.strictVerification ? (
          <Form.Item label="校验重试次数">
            <InputNumber
              min={0}
              max={8}
              value={generationSettings.verificationRetries}
              onChange={(verificationRetries) =>
                patchGeneration({
                  verificationRetries: verificationRetries || 0,
                })
              }
              style={{ width: "100%" }}
            />
          </Form.Item>
        ) : null}
        <Form.Item>
          <Flex justify="space-between">
            <Text>接口错误自动重试</Text>
            <Switch
              checked={generationSettings.autoRetryErrors}
              onChange={(autoRetryErrors) =>
                patchGeneration({ autoRetryErrors })
              }
            />
          </Flex>
        </Form.Item>
        <Form.Item label="错误重试次数 / 间隔秒">
          <Space.Compact block>
            <InputNumber
              min={0}
              max={10}
              value={generationSettings.errorRetryLimit}
              onChange={(errorRetryLimit) =>
                patchGeneration({ errorRetryLimit: errorRetryLimit || 0 })
              }
            />
            <InputNumber
              min={1}
              max={600}
              value={generationSettings.errorRetryDelaySeconds}
              onChange={(errorRetryDelaySeconds) =>
                patchGeneration({
                  errorRetryDelaySeconds: errorRetryDelaySeconds || 1,
                })
              }
            />
          </Space.Compact>
        </Form.Item>
      </Form>
    </div>
  );

  return (
    <div className="auto-scene-classification auto-logo-classification">
      <section className="hero-strip">
        <div>
          <Text className="eyebrow">AUTOMATIC LOGO REPLACEMENT</Text>
          <Title level={2}>自动分类 Logo 替换</Title>
        <Paragraph className="hero-description">
            AI 选择用户预设，可选分析产品载体上的 Logo
            数量；分析与生图使用独立并发队列。
          </Paragraph>
        </div>
        <div className="hero-orb" />
      </section>
      <Card title="1. 导入文件夹与 Logo">
        <Flex gap={16} wrap align="start">
          <Upload.Dragger
            directory
            multiple
            showUploadList={false}
            accept={IMAGE_TYPES.join(",")}
            beforeUpload={(file, list) => {
              if (file === list[0]) reviewFiles(list as File[]);
              return false;
            }}
            style={{ flex: "1 1 360px" }}
          >
            <p className="ant-upload-drag-icon">
              <FolderOpenOutlined />
            </p>
            <p className="ant-upload-text">选择包含多个图片文件夹的根目录</p>
            <p className="ant-upload-hint">随后勾选要处理的最深层图片目录</p>
          </Upload.Dragger>
          <div style={{ flex: "1 1 360px" }}>
            <Flex justify="space-between" align="center">
              <Text strong>新 Logo（{logos.length}）</Text>
              <Upload
                multiple
                showUploadList={false}
                accept={IMAGE_TYPES.join(",")}
                beforeUpload={(file) => {
                  addLogo(file as File);
                  return false;
                }}
              >
                <Button icon={<PlusOutlined />}>添加新 Logo</Button>
              </Upload>
            </Flex>
            <div className="dev-logo-strip" style={{ marginTop: 10 }}>
              {logos.map((logo, index) => (
                <div key={logo.id}>
                  <Image src={logo.previewUrl} />
                  <Tag>{index + 1}</Tag>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeLogo(logo.id)}
                  />
                </div>
              ))}
            </div>
            <Flex
              justify="space-between"
              align="center"
              style={{ marginTop: 14 }}
            >
              <Text strong>旧 Logo 参考（选填）</Text>
              <Upload
                showUploadList={false}
                accept={IMAGE_TYPES.join(",")}
                beforeUpload={(file) => {
                  setOldLogoFile(file as File);
                  return false;
                }}
              >
                <Button>{oldLogo ? "更换" : "上传"}</Button>
              </Upload>
            </Flex>
            {oldLogo ? (
              <Flex gap={8} align="center" style={{ marginTop: 8 }}>
                <Image width={72} src={oldLogo.previewUrl} />
                <Text ellipsis>{oldLogo.name}</Text>
                <Button
                  type="text"
                  danger
                  onClick={() => {
                    URL.revokeObjectURL(oldLogo.previewUrl);
                    setOldLogo(undefined);
                    clearRun();
                  }}
                >
                  删除
                </Button>
              </Flex>
            ) : null}
          </div>
        </Flex>
        {groups.length ? (
          <div className="folder-group-grid" style={{ marginTop: 16 }}>
            {groups.map((group) => (
              <Card key={group.id} size="small" title={group.name}>
                <FolderCover file={group.files[0]} />
                <Text type="secondary">
                  {group.path} · {group.files.length} 张
                </Text>
              </Card>
            ))}
          </div>
        ) : null}
      </Card>
      <Card
        title="2. 自定义分类与原样提示词"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setPresetEditor({ open: true })}
          >
            新增分类
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          title="AI 只选择分类，生图只提交预设原文"
          description="首个分类自动成为兜底；批次启动后冻结当前预设、Logo 顺序和旧 Logo。"
          style={{ marginBottom: 14 }}
        />
        {presets.length ? (
          <div className="auto-category-grid">
            {presets.map((preset) => (
              <Card
                key={preset.id}
                size="small"
                title={
                  <Space>
                    <Text strong>{preset.name}</Text>
                    {preset.isFallback ? <Tag color="gold">兜底</Tag> : null}
                  </Space>
                }
                extra={
                  <Space size={2}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setPresetEditor({ open: true, preset })}
                    />
                    <Popconfirm
                      title={`删除分类“${preset.name}”？`}
                      onConfirm={() => deletePreset(preset.id)}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  </Space>
                }
              >
                <Paragraph
                  ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
                >
                  {preset.prompt}
                </Paragraph>
                {!preset.isFallback ? (
                  <Button
                    block
                    size="small"
                    onClick={() =>
                      setPresets((current) =>
                        withLogoClassificationFallback(current, preset.id),
                      )
                    }
                  >
                    设为兜底分类
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
        ) : (
          <Empty description="尚未创建分类，添加至少一个分类后才能运行" />
        )}
      </Card>
      <Card className="action-card">
        <Flex justify="space-between" gap={12} wrap>
          <div>
            <Title level={4}>
              准备处理{" "}
              {groups.reduce((sum, item) => sum + item.files.length, 0)} 张图片
            </Title>
            <Text type="secondary">
              分析并发 {analysisSettings.concurrency} · 生图并发{" "}
              {generationSettings.concurrency} ·{" "}
              {analysisSettings.analyzeLogoCount
                ? "按识别数量携带 Logo"
                : "每张固定携带 1 个 Logo"}
            </Text>
          </div>
          <Space wrap>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              disabled={running}
              onClick={start}
            >
              开始自动分类并替换
            </Button>
            {running ? (
              <Button danger icon={<StopOutlined />} onClick={stopAll}>
                全部停止
              </Button>
            ) : null}
            {tasks.some(
              (item) => item.status === "failed" || item.status === "stopped",
            ) ? (
              <Button icon={<ReloadOutlined />} onClick={retryAll}>
                重试失败/停止项
              </Button>
            ) : null}
            <Button
              icon={<DownloadOutlined />}
              disabled={!success && !zeroLogo}
              onClick={() => void downloadAll()}
            >
              下载全部（{success + zeroLogo}）
            </Button>
          </Space>
        </Flex>
        {tasks.length ? (
          <>
            <Progress
              percent={
                tasks.length ? Math.round((terminal / tasks.length) * 100) : 0
              }
              status={failed ? "exception" : running ? "active" : "success"}
            />
            <Flex gap={24} wrap>
              <Statistic
                title="分析完成"
                value={analyzed}
                suffix={`/ ${groups.reduce((sum, item) => sum + item.files.length, 0)}`}
              />
              <Statistic title="分析请求" value={analysisRequests} />
              <Statistic title="兜底分类" value={fallbackCount} />
              <Statistic title="生成成功" value={success} />
              <Statistic title="原图输出" value={zeroLogo} />
              <Statistic title="失败 / 停止" value={`${failed} / ${stopped}`} />
              <Statistic title="生图请求" value={generationRequests} />
              <Statistic title="校验请求" value={verificationRequests} />
              <Statistic
                title="分析 / 生图重试"
                value={`${analysisRetries} / ${generationRetries}`}
              />
              <Statistic
                title="总耗时"
                value={
                  runStartedAt
                    ? formatBatchDuration(
                        (runEndedAt || Date.now()) - runStartedAt,
                      )
                    : "—"
                }
              />
            </Flex>
            <Flex gap={24} wrap style={{ marginTop: 14 }}>
              <Statistic
                title="预计最低金额"
                prefix="$"
                precision={3}
                value={cost.estimatedMinimum}
              />
              <Statistic
                title="预计最差金额"
                prefix="$"
                precision={3}
                value={cost.estimatedWorst}
              />
              <Statistic
                title="实际图片费用（实时预估）"
                prefix="$"
                precision={3}
                value={cost.actual}
              />
              <Statistic
                title="开始时间"
                value={formatBatchDateTime(runStartedAt)}
              />
              <Statistic
                title="结束时间"
                value={formatBatchDateTime(runEndedAt)}
              />
              <Statistic
                title="生成成功率"
                suffix="%"
                precision={1}
                value={percentage(success, success + failed)}
              />
            </Flex>
            <Space wrap style={{ marginTop: 14 }}>
              {categoryDistribution.map((item) => (
                <Tag key={item.name} color="purple">
                  {item.name} {item.count}
                </Tag>
              ))}
              {countDistribution.map(([count, amount]) => (
                <Tag key={count} color={count === "0" ? "default" : "blue"}>
                  {count} 个 Logo：{amount} 张
                </Tag>
              ))}
            </Space>
            <Paragraph
              type="secondary"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              分类分析与图片生成并行执行；文本分析和校验 Token
              费用按实际账单计费，不计入图片费用估算。
            </Paragraph>
          </>
        ) : null}
      </Card>
      {tasks.length ? (
        <Card
          title="3. 按文件夹查看结果"
          extra={
            <Text type="secondary">每组只展示第一张结果，点击后查看全部</Text>
          }
        >
          <div className="folder-group-grid">
            {groups.map((group) => {
              const groupTasks = tasks.filter(
                (item) => item.groupId === group.id,
              );
              const cover = groupTasks.find((item) => item.resultUrl);
              const done = groupTasks.filter((item) =>
                ["success", "failed", "stopped", "skipped-no-logo"].includes(
                  item.status,
                ),
              ).length;
              return (
                <Card
                  hoverable
                  key={group.id}
                  size="small"
                  title={group.name}
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setPreviewOriginal(false);
                  }}
                  extra={
                    <Tag
                      color={
                        groupTasks.some((item) =>
                          ["generating", "analyzing"].includes(item.status),
                        )
                          ? "processing"
                          : groupTasks.some((item) => item.status === "failed")
                            ? "error"
                            : done === groupTasks.length
                              ? "success"
                              : "default"
                      }
                    >
                      {done}/{groupTasks.length}
                    </Tag>
                  }
                >
                  <FolderCover
                    file={group.files[0]}
                    generatedUrl={cover?.resultUrl}
                  />
                  <Text>
                    成功{" "}
                    {
                      groupTasks.filter((item) => item.status === "success")
                        .length
                    }{" "}
                    · 原图{" "}
                    {
                      groupTasks.filter(
                        (item) => item.status === "skipped-no-logo",
                      ).length
                    }{" "}
                    · 失败{" "}
                    {
                      groupTasks.filter((item) => item.status === "failed")
                        .length
                    }
                  </Text>
                  <Button block type="link" icon={<EyeOutlined />}>
                    查看全部图片
                  </Button>
                </Card>
              );
            })}
          </div>
        </Card>
      ) : null}
      <Modal
        width={1180}
        destroyOnHidden
        title={`${selectedGroup?.name || "文件夹"} · 全部图片`}
        open={Boolean(selectedGroupId)}
        footer={
          <Button onClick={() => setSelectedGroupId(undefined)}>完成</Button>
        }
        onCancel={() => setSelectedGroupId(undefined)}
      >
        <Alert
          type="info"
          showIcon
          title={`共 ${selectedTasks.length} 个任务，可查看 ${selectedPreviewTasks.length} 张`}
          description="放大后可滚轮缩放、拖动、左右切换，并在控制栏切换原图。"
          style={{ marginBottom: 14 }}
        />
        {selectedTasks.length ? (
          <Image.PreviewGroup
            preview={{
              onOpenChange: (open) => {
                if (!open) setPreviewOriginal(false);
              },
              onChange: () => setPreviewOriginal(false),
              actionsRender: (node) => (
                <>
                  {node}
                  <Tooltip title={previewOriginal ? "查看生成图" : "查看原图"}>
                    <button
                      type="button"
                      className={
                        previewOriginal
                          ? "scene-preview-compare-action is-active"
                          : "scene-preview-compare-action"
                      }
                      onClick={() => setPreviewOriginal((value) => !value)}
                    >
                      <EyeOutlined />
                    </button>
                  </Tooltip>
                </>
              ),
              imageRender: (node, info) => {
                const task = selectedPreviewTasks[info.current];
                return previewOriginal && task
                  ? cloneElement(
                      node as ReactElement<{ src?: string; alt?: string }>,
                      { src: selectedOriginalUrls[task.id], alt: "上传原图" },
                    )
                  : node;
              },
            }}
          >
            <div className="batch-result-grid">
              {selectedTasks.map((task) => (
                <Card
                  key={task.id}
                  size="small"
                  className="batch-result-card"
                  title={
                    <Text ellipsis={{ tooltip: task.file.name }}>
                      {task.file.name} · 结果 {task.copyIndex + 1}
                    </Text>
                  }
                  extra={
                    <Tag
                      color={
                        task.status === "success"
                          ? "success"
                          : task.status === "failed"
                            ? "error"
                            : ["generating", "analyzing"].includes(task.status)
                              ? "processing"
                              : "default"
                      }
                    >
                      {autoLogoStatusLabel(task.status)}
                    </Tag>
                  }
                >
                  {task.resultUrl ? (
                    <Image src={task.resultUrl} alt="自动分类 Logo 替换结果" />
                  ) : (
                    <div className={`task-state-card is-${task.status}`}>
                      <Text
                        type={task.status === "failed" ? "danger" : "secondary"}
                      >
                        {task.error || autoLogoStatusLabel(task.status)}
                      </Text>
                    </div>
                  )}
                  <Flex gap={6} wrap style={{ marginTop: 8 }}>
                    <Select
                      size="small"
                      value={task.categoryId}
                      placeholder="选择分类"
                      style={{ minWidth: 140 }}
                      options={(frozenPresets.current.length
                        ? frozenPresets.current
                        : presets
                      ).map((item) => ({ value: item.id, label: item.name }))}
                      onChange={(value) => assignCategory(task, value)}
                    />
                    <Space.Compact size="small">
                      <InputNumber
                        min={0}
                        max={16}
                        value={task.effectiveLogoCount}
                        onChange={(value) => assignCount(task, value)}
                      />
                      <Button disabled>个 Logo</Button>
                    </Space.Compact>
                    <Space size={4}>
                      {task.resultBlob ? (
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => downloadOne(task)}
                        >
                          下载
                        </Button>
                      ) : null}
                      {[
                        "analyzing",
                        "generating",
                        "waiting-analysis",
                        "waiting-generation",
                      ].includes(task.status) ? (
                        <Button
                          size="small"
                          danger
                          icon={<StopOutlined />}
                          onClick={() => {
                            analysisControllers.current.get(task.id)?.abort();
                            generationControllers.current.get(task.id)?.abort();
                            setTasks((current) =>
                              current.map((item) =>
                                item.id === task.id
                                  ? {
                                      ...item,
                                      status: "stopped",
                                      error: "任务已停止",
                                    }
                                  : item,
                              ),
                            );
                          }}
                        >
                          停止
                        </Button>
                      ) : task.effectiveLogoCount ? (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => retryTask(task)}
                        >
                          重试生成
                        </Button>
                      ) : null}
                      {task.copyIndex === 0 ? (
                        <Button
                          size="small"
                          onClick={() => retryTask(task, true)}
                        >
                          重做分析
                        </Button>
                      ) : null}
                    </Space>
                  </Flex>
                  {task.categoryName ? (
                    <Text type="secondary">
                      分类：{task.categoryName}（
                      {task.classificationSource === "fallback"
                        ? "兜底"
                        : task.classificationSource === "manual"
                          ? "手动"
                          : "AI"}
                      ）· {task.classificationReason}
                    </Text>
                  ) : null}
                  {task.logoCountTruncated ? (
                    <Alert
                      type="warning"
                      showIcon
                      title={`识别到 ${task.rawLogoCount} 个位置，已按上限 16 个发送`}
                    />
                  ) : null}
                  {task.verificationSummary ? (
                    <Text type="secondary">
                      校验：{task.verificationSummary}
                    </Text>
                  ) : null}
                </Card>
              ))}
            </div>
          </Image.PreviewGroup>
        ) : (
          <Empty description="该文件夹暂无任务" />
        )}
      </Modal>
      <Modal
        title="选择要导入的图片目录"
        open={pendingFiles.length > 0}
        width={900}
        okText={`导入已选 ${checkedFolders.length} 个目录`}
        okButtonProps={{ disabled: !checkedFolders.length }}
        onOk={importChecked}
        onCancel={() => {
          setPendingFiles([]);
          setCheckedFolders([]);
        }}
      >
        <Alert
          type="info"
          showIcon
          title="仅显示包含图片的最深层文件夹"
          description="勾选多个目录后会保留原始相对路径。"
          style={{ marginBottom: 12 }}
        />
        <Checkbox.Group
          value={checkedFolders}
          onChange={(values) => setCheckedFolders(values as string[])}
          style={{ width: "100%" }}
        >
          <div className="folder-picker-tree">
            {buildPickerFolderTree(groupFolderFiles(pendingFiles)).map(
              (root) => (
                <div key={root.path}>
                  <Text strong>{root.name}</Text>
                  {(function render(
                    nodes: typeof root.children,
                    depth = 1,
                  ): ReactElement[] {
                    return nodes.flatMap((node) => [
                      <div
                        key={node.path}
                        style={{ paddingLeft: depth * 18, marginTop: 8 }}
                      >
                        {node.group ? (
                          <Checkbox value={`dir:${node.group.path}`}>
                            {node.name} · {node.group.files.length} 张
                          </Checkbox>
                        ) : (
                          <Text>{node.name}</Text>
                        )}
                      </div>,
                      ...render(node.children, depth + 1),
                    ]);
                  })(root.children)}
                  {root.group ? (
                    <div style={{ paddingLeft: 18 }}>
                      <Checkbox value={`dir:${root.group.path}`}>
                        {root.name} · {root.group.files.length} 张
                      </Checkbox>
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        </Checkbox.Group>
      </Modal>
      <PresetEditor
        open={presetEditor.open}
        initial={presetEditor.preset}
        onCancel={() => setPresetEditor({ open: false })}
        onSave={savePreset}
      />
      {!settingsHost ? (
        <aside className="logo-settings">{settingsPanel}</aside>
      ) : (
        createPortal(settingsPanel, settingsHost)
      )}
    </div>
  );
}
