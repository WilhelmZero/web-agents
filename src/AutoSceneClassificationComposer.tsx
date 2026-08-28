import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
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
  BulbOutlined,
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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_SCENE_CLASSIFICATION_SETTINGS,
  DEFAULT_SCENE_REPLACE_SETTINGS,
  MODEL_CAPABILITIES,
  STORAGE_KEYS,
} from "./constants";
import { buildPickerFolderTree } from "./MultiTabSceneReplaceComposer";
import { FileThumbnail, groupFolderFiles } from "./MultiTabLogoReplaceComposer";
import { readLocalStorage } from "./storage";
import type {
  AutoSceneClassificationTask,
  ImageModel,
  SceneClassificationPreset,
  SceneClassificationPresetGroup,
  SceneClassificationSettings,
  SceneReplaceSettings,
} from "./types";
import {
  createId,
  downloadBlob,
  formatFileTimestamp,
  mimeExtension,
  normalizeSettingsForModel,
  sanitizeFileName,
} from "./utils";
import {
  classifySceneImage,
  normalizeSceneClassificationPresets,
  withSceneClassificationFallback,
} from "./services/sceneClassification";
import {
  normalizeSceneClassificationPresetGroups,
  updateSceneClassificationPresetGroupCategories,
} from "./services/sceneClassificationPresetGroups";
import { createDefaultSceneClassificationPresetGroup } from "./services/defaultClassificationPresetGroups";
import {
  generateSceneReplacementImage,
  optimizeSceneReplacePrompt,
} from "./services/gemini";
import { editPaperTextOpenAi } from "./services/paperText";
import { optimizeScenePromptOpenAi } from "./services/promptOptimizer";
import { detectWhiteBackground } from "./services/whiteBackgroundDetection";
import {
  detectImageChange,
  resolveInsufficientImageChangeOutcome,
} from "./services/imageChangeDetection";
import {
  batchCostMetrics,
  formatBatchDateTime,
  percentage,
} from "./services/batchExecutionMetrics";
import { formatBatchDuration } from "./services/batchTiming";
import {
  buildOutpaintPrompt,
  closestAspectRatio,
  prepareOutpaintInput,
} from "./services/outpaint";
import { sanitizeRelativeFolderPath } from "./services/batchFolderPath";
import {
  appendAutoSceneGroupFile,
  autoSceneStatusLabel,
  createAutoSceneTasks,
  removeAutoSceneGroupFile,
} from "./services/autoScenePipeline";
import { imageDimensions, resizeImageBlob } from "./services/logoOutputSizing";
import {
  automaticAspectRatio,
  automaticOpenAiSize,
  OPENAI_IMAGE_OUTPUT_SIZES,
  shouldRestoreOriginalDimensions,
} from "./services/automaticOutputSizing";

const { Title, Text, Paragraph } = Typography;
type Group = ReturnType<typeof groupFolderFiles>[number];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MODEL_OPTIONS = [
  {
    label: "GPT",
    options: [
      { value: "gpt-image-2", label: "GPT Image 2（推荐）" },
      { value: "gpt-image-2-2026-04-21", label: "GPT Image 2（2026-04-21）" },
    ],
  },
  {
    label: "Gemini",
    options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({
      value,
      label: item.label,
    })),
  },
];
const ANALYSIS_GEMINI_MODELS = [
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { value: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];
const ANALYSIS_OPENAI_MODELS = [
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];
const DUAL_OUTPAINT_SIZES = [
  { width: 3200, height: 1310 },
  { width: 1800, height: 1350 },
] as const;
const isOpenAiModel = (model: string) => model.startsWith("gpt-image-");

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
  onOptimize,
}: {
  open: boolean;
  initial?: SceneClassificationPreset;
  onCancel: () => void;
  onSave: (value: { name: string; prompt: string }) => void;
  onOptimize: (prompt: string) => Promise<string>;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setPrompt(initial?.prompt || "");
    }
  }, [open, initial]);
  return (
    <Modal
      title={initial ? "编辑分类预设" : "新增分类预设"}
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
            placeholder="例如：家庭酒吧"
          />
        </Form.Item>
        <Form.Item label="场景替换提示词" required>
          <Input.TextArea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            autoSize={{ minRows: 7, maxRows: 14 }}
            placeholder="该内容会原样提交给图片模型"
          />
          <Flex justify="flex-end" style={{ marginTop: 8 }}>
            <Button
              icon={<BulbOutlined />}
              loading={optimizing}
              disabled={!prompt.trim()}
              onClick={async () => {
                setOptimizing(true);
                try {
                  setPrompt(await onOptimize(prompt));
                  message.success("提示词已优化，可继续修改后保存");
                } catch (error) {
                  message.error(
                    error instanceof Error ? error.message : "提示词优化失败",
                  );
                } finally {
                  setOptimizing(false);
                }
              }}
            >
              AI 优化
            </Button>
          </Flex>
        </Form.Item>
        <Alert
          type="warning"
          showIcon
          title="生成时完全使用这段提示词"
          description="不会追加公共提示词、保护模板、自动推荐或逐图限制。"
        />
      </Form>
    </Modal>
  );
}

function PresetGroupEditor({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial?: SceneClassificationPresetGroup;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(initial?.name || "");
  }, [open, initial]);
  return (
    <Modal
      title={initial ? "重命名场景分类预设" : "新增场景分类预设"}
      open={open}
      okText="保存"
      onCancel={onCancel}
      onOk={() => onSave(name)}
      okButtonProps={{ disabled: !name.trim() }}
    >
      <Form layout="vertical">
        <Form.Item label="预设名称" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：杯具室内外场景"
          />
        </Form.Item>
        <Alert
          type="info"
          showIcon
          title="一个预设可包含多个分类场景提示词"
          description="运行时 AI 只在当前选中预设包含的分类中进行判断。"
        />
      </Form>
    </Modal>
  );
}

export default function AutoSceneClassificationComposer({
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
  const [presetGroups, setPresetGroups] = useState<
    SceneClassificationPresetGroup[]
  >(() => {
    const hasGroupedPresets =
      localStorage.getItem(STORAGE_KEYS.sceneClassificationPresetGroups) !==
      null;
    const legacyPresets = hasGroupedPresets
      ? []
      : readLocalStorage(STORAGE_KEYS.sceneClassificationPresets, []);
    if (!hasGroupedPresets && !Array.isArray(legacyPresets)) {
      return [createDefaultSceneClassificationPresetGroup()];
    }
    if (!hasGroupedPresets && legacyPresets.length === 0) {
      return [createDefaultSceneClassificationPresetGroup()];
    }
    return normalizeSceneClassificationPresetGroups(
      readLocalStorage(STORAGE_KEYS.sceneClassificationPresetGroups, []),
      legacyPresets,
    );
  });
  const [activePresetGroupId, setActivePresetGroupId] = useState(() =>
    readLocalStorage(STORAGE_KEYS.activeSceneClassificationPresetGroup, ""),
  );
  const [analysisSettings, setAnalysisSettings] =
    useState<SceneClassificationSettings>(
      () =>
        ({
          ...DEFAULT_SCENE_CLASSIFICATION_SETTINGS,
          ...readLocalStorage(STORAGE_KEYS.sceneClassificationSettings, {}),
        }) as SceneClassificationSettings,
    );
  const [generationSettings, setGenerationSettings] =
    useState<SceneReplaceSettings>(() => {
      const stored = readLocalStorage<Partial<SceneReplaceSettings>>(
        STORAGE_KEYS.sceneClassificationGenerationSettings,
        {},
      );
      return {
        ...DEFAULT_SCENE_REPLACE_SETTINGS,
        ...stored,
        ratioMode: stored.ratioMode || "auto",
        openAiOutputSize: stored.openAiOutputSize || "1024x1024",
        executionMode: "realtime",
        perImagePromptEnabled: false,
        autoRecommendScene: false,
      } as SceneReplaceSettings;
    });
  const [tasks, setTasks] = useState<AutoSceneClassificationTask[]>([]);
  const [presetEditor, setPresetEditor] = useState<{
    open: boolean;
    preset?: SceneClassificationPreset;
  }>({ open: false });
  const [presetGroupEditor, setPresetGroupEditor] = useState<{
    open: boolean;
    group?: SceneClassificationPresetGroup;
  }>({ open: false });
  const [managedGroupId, setManagedGroupId] = useState<string>();
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [runEndedAt, setRunEndedAt] = useState<number>();
  const [analysisRequests, setAnalysisRequests] = useState(0);
  const [generationRequests, setGenerationRequests] = useState(0);
  const analysisRunning = useRef(new Set<string>());
  const generationRunning = useRef(new Set<string>());
  const analysisControllers = useRef(new Map<string, AbortController>());
  const generationControllers = useRef(new Map<string, AbortController>());
  const frozenPresets = useRef<SceneClassificationPreset[]>([]);
  const tasksRef = useRef(tasks);
  const generationSettingsRef = useRef(generationSettings);
  const analysisSettingsRef = useRef(analysisSettings);
  const activePresetGroup =
    presetGroups.find((item) => item.id === activePresetGroupId) ||
    presetGroups[0];
  const selectedPresetGroupId = activePresetGroup?.id || "";
  const presets = activePresetGroup?.categories || [];
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    generationSettingsRef.current = generationSettings;
    localStorage.setItem(
      STORAGE_KEYS.sceneClassificationGenerationSettings,
      JSON.stringify(generationSettings),
    );
  }, [generationSettings]);
  useEffect(() => {
    analysisSettingsRef.current = analysisSettings;
    localStorage.setItem(
      STORAGE_KEYS.sceneClassificationSettings,
      JSON.stringify(analysisSettings),
    );
  }, [analysisSettings]);
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.sceneClassificationPresetGroups,
      JSON.stringify(presetGroups),
    );
  }, [presetGroups]);
  useEffect(() => {
    if (selectedPresetGroupId !== activePresetGroupId)
      setActivePresetGroupId(selectedPresetGroupId);
    localStorage.setItem(
      STORAGE_KEYS.activeSceneClassificationPresetGroup,
      JSON.stringify(selectedPresetGroupId),
    );
  }, [activePresetGroupId, selectedPresetGroupId]);
  useEffect(
    () => () => {
      tasksRef.current.forEach((task) => {
        if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
        task.outpaintResults?.forEach((item) => URL.revokeObjectURL(item.url));
      });
    },
    [],
  );

  const patchGeneration = (value: Partial<SceneReplaceSettings>) =>
    setGenerationSettings((current) => {
      const next = {
        ...current,
        ...value,
        executionMode: "realtime" as const,
        perImagePromptEnabled: false,
        autoRecommendScene: false,
      };
      return value.imageModel && !isOpenAiModel(value.imageModel)
        ? {
            ...next,
            ...normalizeSettingsForModel(
              value.imageModel as ImageModel,
              next.aspectRatio,
              next.imageSize,
            ),
          }
        : next;
    });
  const setPresets = useCallback(
    (
      updater: (
        current: SceneClassificationPreset[],
      ) => SceneClassificationPreset[],
    ) =>
      setPresetGroups((current) =>
        updateSceneClassificationPresetGroupCategories(
          current,
          selectedPresetGroupId,
          updater,
        ),
      ),
    [selectedPresetGroupId],
  );
  const clearRun = useCallback(() => {
    analysisControllers.current.forEach((item) => item.abort());
    generationControllers.current.forEach((item) => item.abort());
    setTasks((current) => {
      current.forEach((task) => {
        if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
        task.outpaintResults?.forEach((item) => URL.revokeObjectURL(item.url));
      });
      return [];
    });
    analysisRunning.current.clear();
    generationRunning.current.clear();
    setRunStartedAt(undefined);
    setRunEndedAt(undefined);
    setAnalysisRequests(0);
    setGenerationRequests(0);
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
  const managedGroup = groups.find((group) => group.id === managedGroupId);
  const removeGroup = (group: Group) => {
    clearRun();
    setGroups((current) => current.filter((item) => item.id !== group.id));
    setManagedGroupId((current) =>
      current === group.id ? undefined : current,
    );
    message.success(`已移除文件夹 ${group.name}`);
  };
  const removeAllGroups = () => {
    clearRun();
    setGroups([]);
    setManagedGroupId(undefined);
    setPendingFiles([]);
    setCheckedFolders([]);
    message.success("已移除全部文件夹");
  };
  const removeGroupFile = (groupId: string, target: File) => {
    const group = groups.find((item) => item.id === groupId);
    clearRun();
    if (group?.files.length === 1) {
      setManagedGroupId(undefined);
      message.info(`已移除空文件夹 ${group.name}`);
    }
    setGroups((current) => removeAutoSceneGroupFile(current, groupId, target));
  };
  const addGroupFile = (groupId: string, file: File) => {
    if (
      !IMAGE_TYPES.includes(file.type) ||
      file.size <= 0 ||
      file.size > 20 * 1024 * 1024
    ) {
      message.error(`${file.name} 不是支持的图片，或文件超过 20MB`);
      return Upload.LIST_IGNORE;
    }
    clearRun();
    setGroups((current) => appendAutoSceneGroupFile(current, groupId, file));
    return Upload.LIST_IGNORE;
  };
  const savePresetGroup = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (presetGroupEditor.group) {
      setPresetGroups((current) =>
        current.map((item) =>
          item.id === presetGroupEditor.group?.id
            ? { ...item, name: trimmedName, updatedAt: Date.now() }
            : item,
        ),
      );
    } else {
      const id = createId();
      setPresetGroups((current) => [
        ...current,
        { id, name: trimmedName, categories: [], updatedAt: Date.now() },
      ]);
      setActivePresetGroupId(id);
    }
    setPresetGroupEditor({ open: false });
  };
  const deletePresetGroup = (id: string) => {
    setPresetGroups((current) => current.filter((item) => item.id !== id));
    setActivePresetGroupId((current) => (current === id ? "" : current));
    setPresetEditor({ open: false });
  };
  const savePreset = ({ name, prompt }: { name: string; prompt: string }) => {
    setPresets((current) => {
      if (presetEditor.preset)
        return current.map((item) =>
          item.id === presetEditor.preset?.id
            ? { ...item, name: name.trim(), prompt, updatedAt: Date.now() }
            : item,
        );
      return [
        ...current,
        {
          id: createId(),
          name: name.trim(),
          prompt,
          isFallback: current.length === 0,
          updatedAt: Date.now(),
        },
      ];
    });
    setPresetEditor({ open: false });
  };

  const optimizePresetPrompt = useCallback(
    async (prompt: string) => {
      const config = analysisSettingsRef.current;
      if (config.provider === "openai") {
        if (!openAiApiKey) {
          onRequestKey();
          throw new Error("请先填写 OpenAI API Key");
        }
        return optimizeScenePromptOpenAi({
          apiKey: openAiApiKey,
          model: config.openAiModel,
          prompt,
        });
      }
      if (!apiKey) {
        onRequestKey();
        throw new Error("请先填写 Gemini API Key");
      }
      return optimizeSceneReplacePrompt({
        apiKey,
        apiBaseUrl,
        model: config.geminiModel,
        prompt,
      });
    },
    [apiBaseUrl, apiKey, onRequestKey, openAiApiKey],
  );
  const deletePreset = (id: string) => {
    setPresets((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.isFallback && current.length > 1) {
        message.warning("请先把其他分类设为兜底分类");
        return current;
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const performOutpaint = useCallback(
    async (taskId: string, source: Blob, signal: AbortSignal) => {
      const config = generationSettingsRef.current;
      if (!config.autoOutpaint) return;
      setTasks((current) =>
        current.map((item) =>
          item.id === taskId
            ? { ...item, outpaintStatus: "running", outpaintError: undefined }
            : item,
        ),
      );
      try {
        const sourceFile = new File([source], `scene-${taskId}.png`, {
          type: source.type || "image/png",
        });
        const sizes = config.outpaintBothSizes
          ? DUAL_OUTPAINT_SIZES
          : [{ width: config.outpaintWidth, height: config.outpaintHeight }];
        const results = await Promise.all(
          sizes.map(async ({ width, height }) => {
            const prepared = await prepareOutpaintInput(
              sourceFile,
              width,
              height,
            );
            const prompt = buildOutpaintPrompt(
              config.outpaintPrompt,
              width,
              height,
            );
            setGenerationRequests((value) => value + 1);
            const blob = isOpenAiModel(config.outpaintImageModel)
              ? await editPaperTextOpenAi({
                  apiKey: openAiApiKey,
                  model: config.outpaintImageModel,
                  image: prepared.file,
                  mask: prepared.mask,
                  prompt,
                  quality: config.outpaintQuality,
                  signal,
                })
              : (
                  await generateSceneReplacementImage({
                    apiKey,
                    apiBaseUrl,
                    model: config.outpaintImageModel as ImageModel,
                    image: prepared.file,
                    prompt,
                    imageSize: config.outpaintImageSize,
                    aspectRatio: closestAspectRatio(
                      width,
                      height,
                      MODEL_CAPABILITIES[
                        config.outpaintImageModel as ImageModel
                      ].aspectRatios,
                    ),
                    signal,
                  })
                ).blob;
            return { width, height, blob, url: URL.createObjectURL(blob) };
          }),
        );
        setTasks((current) =>
          current.map((item) =>
            item.id === taskId
              ? { ...item, outpaintStatus: "success", outpaintResults: results }
              : item,
          ),
        );
      } catch (error) {
        setTasks((current) =>
          current.map((item) =>
            item.id === taskId
              ? {
                  ...item,
                  outpaintStatus: signal.aborted ? "stopped" : "failed",
                  outpaintError: signal.aborted
                    ? "任务已停止"
                    : error instanceof Error
                      ? error.message
                      : "扩图失败",
                }
              : item,
          ),
        );
      }
    },
    [apiKey, openAiApiKey, apiBaseUrl],
  );

  const executeGeneration = useCallback(
    async (task: AutoSceneClassificationTask) => {
      if (generationRunning.current.has(task.id) || !task.categoryPrompt)
        return;
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
                error: undefined,
              }
            : item,
        ),
      );
      let lastBlob: Blob | undefined;
      let retry = task.generationRetryCount;
      try {
        const config = generationSettingsRef.current;
        const dimensions =
          config.ratioMode === "auto" || config.ratioMode === "original"
            ? await imageDimensions(task.file)
            : undefined;
        const sourceWidth = dimensions?.width || 1;
        const sourceHeight = dimensions?.height || 1;
        const aspectRatio = isOpenAiModel(config.imageModel)
          ? undefined
          : automaticAspectRatio({
              mode: config.ratioMode,
              sourceWidth,
              sourceHeight,
              fixedRatio: config.aspectRatio,
              supportedRatios:
                MODEL_CAPABILITIES[config.imageModel as ImageModel]
                  .aspectRatios,
            });
        const openAiSize = automaticOpenAiSize({
          mode: config.ratioMode,
          sourceWidth,
          sourceHeight,
          fixedSize: config.openAiOutputSize || "1024x1024",
        });
        while (true) {
          setGenerationRequests((value) => value + 1);
          try {
            lastBlob = isOpenAiModel(config.imageModel)
              ? await editPaperTextOpenAi({
                  apiKey: openAiApiKey,
                  model: config.imageModel,
                  image: task.file,
                  prompt: task.categoryPrompt,
                  quality: config.imageQuality,
                  size: openAiSize || "omit",
                  signal: controller.signal,
                  exactPrompt: true,
                })
              : (
                  await generateSceneReplacementImage({
                    apiKey,
                    apiBaseUrl,
                    model: config.imageModel as ImageModel,
                    image: task.file,
                    prompt: task.categoryPrompt,
                    imageSize: config.imageSize,
                    aspectRatio,
                    signal: controller.signal,
                    exactPrompt: true,
                  })
                ).blob;
            if (
              lastBlob &&
              dimensions &&
              shouldRestoreOriginalDimensions(config.ratioMode)
            ) {
              lastBlob = await resizeImageBlob(
                lastBlob,
                dimensions.width,
                dimensions.height,
              );
            }
            let changedRatio: number | undefined;
            let warning: string | undefined;
            if (config.detectInsufficientSceneChange) {
              const change = await detectImageChange(task.file, lastBlob);
              changedRatio = change.changedRatio;
              const outcome = resolveInsufficientImageChangeOutcome(
                change.changedRatio,
                retry,
                config.errorRetryLimit,
              );
              if (outcome === "retry")
                throw new Error(
                  `场景变化检测未通过：仅 ${(change.changedRatio * 100).toFixed(1)}% 像素发生明显变化`,
                );
              if (outcome === "keep-last-with-warning")
                warning = `变化仅 ${(change.changedRatio * 100).toFixed(1)}%，已达到重试上限并保留最后结果`;
            }
            const resultUrl = URL.createObjectURL(lastBlob);
            setTasks((current) =>
              current.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      status: "success",
                      generationRetryCount: retry,
                      generationEndedAt: Date.now(),
                      resultBlob: lastBlob,
                      resultUrl,
                      resultMimeType: lastBlob?.type || "image/png",
                      changedRatio,
                      insufficientChangeWarning: warning,
                      outpaintStatus: "idle",
                    }
                  : item,
              ),
            );
            await performOutpaint(task.id, lastBlob, controller.signal);
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (
              (!config.autoRetryErrors &&
                !(
                  error instanceof Error &&
                  error.message.startsWith("场景变化检测未通过")
                )) ||
              retry >= config.errorRetryLimit
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
                  error: stopped
                    ? "任务已停止"
                    : error instanceof Error
                      ? error.message
                      : "场景替换失败",
                }
              : item,
          ),
        );
      } finally {
        generationRunning.current.delete(task.id);
        generationControllers.current.delete(task.id);
      }
    },
    [apiKey, openAiApiKey, apiBaseUrl, performOutpaint],
  );

  const executeAnalysis = useCallback(
    async (task: AutoSceneClassificationTask) => {
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
        if (
          generationSettingsRef.current.autoSkipWhiteBackground &&
          (await detectWhiteBackground(task.file)).isWhiteBackground
        ) {
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "skipped-white",
                    analysisEndedAt: Date.now(),
                    classificationReason: "本地检测为白底商品图",
                  }
                : item,
            ),
          );
          return;
        }
        let result: Awaited<ReturnType<typeof classifySceneImage>> | undefined;
        let lastError: unknown;
        while (
          !result &&
          retry <= (config.autoRetryErrors ? config.errorRetryLimit : 0)
        ) {
          try {
            setAnalysisRequests((value) => value + 1);
            result = await classifySceneImage({
              provider: config.provider,
              apiKey: config.provider === "openai" ? openAiApiKey : apiKey,
              apiBaseUrl,
              geminiModel: config.geminiModel,
              openAiModel: config.openAiModel,
              image: task.file,
              presets: snapshot,
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
          ? snapshot.find((item) => item.id === result?.categoryId) || fallback
          : fallback;
        if (!chosen) throw new Error("没有可用的兜底分类");
        const source = result
          ? result.usedFallback
            ? "fallback"
            : "ai"
          : "fallback";
        const reason =
          result?.reason ||
          `${lastError instanceof Error ? lastError.message : "分析请求失败"}；已使用兜底分类`;
        setTasks((current) => {
          const original = current.find((item) => item.id === task.id);
          if (!original) return current;
          const base = {
            ...original,
            status: "waiting-generation" as const,
            categoryId: chosen.id,
            categoryName: chosen.name,
            categoryPrompt: chosen.prompt,
            classificationSource: source as "ai" | "fallback",
            classificationReason: reason,
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
  const running = tasks.some(
    (item) =>
      [
        "waiting-analysis",
        "analyzing",
        "classified",
        "waiting-generation",
        "generating",
      ].includes(item.status) || item.outpaintStatus === "running",
  );
  useEffect(() => {
    if (runStartedAt && tasks.length && !running && !runEndedAt)
      setRunEndedAt(Date.now());
  }, [runStartedAt, tasks.length, running, runEndedAt]);

  const start = () => {
    const normalized = normalizeSceneClassificationPresets(presets);
    const fallback = normalized.find((item) => item.isFallback);
    if (!groups.length)
      return void message.warning("请先导入至少一个图片文件夹");
    if (!normalized.length || !fallback)
      return void message.warning("请在当前预设中创建分类并指定兜底分类");
    const analysisKey =
      analysisSettings.provider === "openai" ? openAiApiKey : apiKey;
    const generationKey = isOpenAiModel(generationSettings.imageModel)
      ? openAiApiKey
      : apiKey;
    const outpaintKey = generationSettings.autoOutpaint
      ? isOpenAiModel(generationSettings.outpaintImageModel)
        ? openAiApiKey
        : apiKey
      : "not-required";
    if (!analysisKey || !generationKey || !outpaintKey) return onRequestKey();
    if (
      connectionMode === "proxy" &&
      (analysisSettings.provider === "gemini" ||
        !isOpenAiModel(generationSettings.imageModel) ||
        (generationSettings.autoOutpaint &&
          !isOpenAiModel(generationSettings.outpaintImageModel))) &&
      !apiBaseUrl
    )
      return void message.warning("请先配置 Gemini 代理地址");
    clearRun();
    frozenPresets.current = normalized.map((item) => ({ ...item }));
    setRunStartedAt(Date.now());
    setTasks(createAutoSceneTasks(groups));
  };
  const stopAll = () => {
    analysisControllers.current.forEach((item) => item.abort());
    generationControllers.current.forEach((item) => item.abort());
    setTasks((current) =>
      current.map((item) =>
        ["waiting-analysis", "classified", "waiting-generation"].includes(
          item.status,
        )
          ? { ...item, status: "stopped", error: "任务已停止" }
          : item,
      ),
    );
  };
  const retryTask = (task: AutoSceneClassificationTask, reanalyze = false) => {
    if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
    task.outpaintResults?.forEach((item) => URL.revokeObjectURL(item.url));
    setRunEndedAt(undefined);
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status:
                reanalyze && item.copyIndex === 0
                  ? "waiting-analysis"
                  : item.categoryPrompt
                    ? "waiting-generation"
                    : "waiting-analysis",
              resultBlob: undefined,
              resultUrl: undefined,
              outpaintResults: undefined,
              outpaintStatus: undefined,
              error: undefined,
              generationRetryCount: 0,
              ...(reanalyze
                ? {
                    categoryId: undefined,
                    categoryName: undefined,
                    categoryPrompt: undefined,
                    classificationSource: undefined,
                    classificationReason: undefined,
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
    task: AutoSceneClassificationTask,
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
              ...(item.status === "failed" && !item.resultBlob
                ? { status: "waiting-generation" as const, error: undefined }
                : {}),
            }
          : item,
      ),
    );
  };

  const planned =
    groups.reduce((sum, group) => sum + group.files.length, 0) *
    generationSettings.copiesPerScene;
  const success = tasks.filter((item) => item.status === "success").length;
  const failed = tasks.filter((item) => item.status === "failed").length;
  const stopped = tasks.filter((item) => item.status === "stopped").length;
  const analyzedSources = tasks.filter(
    (item) => item.copyIndex === 0 && item.analysisEndedAt,
  ).length;
  const fallbackCount = tasks.filter(
    (item) => item.copyIndex === 0 && item.classificationSource === "fallback",
  ).length;
  const cost = batchCostMetrics({
    model: generationSettings.imageModel,
    size: generationSettings.imageSize,
    plannedRequests: planned,
    worstCaseMultiplier: generationSettings.autoRetryErrors
      ? generationSettings.errorRetryLimit + 1
      : 1,
    actualRequests: generationRequests,
  });
  const categoryDistribution = useMemo(
    () =>
      Array.from(
        new Map(
          tasks
            .filter((item) => item.copyIndex === 0 && item.categoryId)
            .map((item) => [
              item.categoryId!,
              {
                name: item.categoryName!,
                count: tasks.filter(
                  (candidate) =>
                    candidate.copyIndex === 0 &&
                    candidate.categoryId === item.categoryId,
                ).length,
              },
            ]),
        ).values(),
      ),
    [tasks],
  );
  const selectedTasks = useMemo(
    () => tasks.filter((item) => item.groupId === selectedGroupId),
    [tasks, selectedGroupId],
  );
  const selectedPreviewTasks = useMemo(
    () => selectedTasks.filter((item) => item.resultUrl),
    [selectedTasks],
  );
  const selectedGroup = groups.find((item) => item.id === selectedGroupId);
  const [selectedOriginalUrls, setSelectedOriginalUrls] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    const next = Object.fromEntries(
      selectedPreviewTasks.map((task) => [
        task.id,
        URL.createObjectURL(task.file),
      ]),
    );
    setSelectedOriginalUrls(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  }, [selectedPreviewTasks]);
  const analysisStarted = tasks.reduce<number | undefined>(
    (value, task) =>
      task.analysisStartedAt && (!value || task.analysisStartedAt < value)
        ? task.analysisStartedAt
        : value,
    undefined,
  );
  const analysisEnded = tasks.reduce<number | undefined>(
    (value, task) =>
      task.analysisEndedAt && (!value || task.analysisEndedAt > value)
        ? task.analysisEndedAt
        : value,
    undefined,
  );
  const generationStarted = tasks.reduce<number | undefined>(
    (value, task) =>
      task.generationStartedAt && (!value || task.generationStartedAt < value)
        ? task.generationStartedAt
        : value,
    undefined,
  );
  const generationEnded = tasks.reduce<number | undefined>(
    (value, task) =>
      task.generationEndedAt && (!value || task.generationEndedAt > value)
        ? task.generationEndedAt
        : value,
    undefined,
  );
  const analysisRetries = tasks
    .filter((task) => task.copyIndex === 0)
    .reduce((sum, task) => sum + task.analysisRetryCount, 0);
  const generationRetries = tasks.reduce(
    (sum, task) => sum + task.generationRetryCount,
    0,
  );
  const downloadOne = (task: AutoSceneClassificationTask) => {
    if (task.resultBlob)
      downloadBlob(
        task.resultBlob,
        `${sanitizeFileName(task.file.name.replace(/\.[^.]+$/, ""))}_场景_${task.copyIndex + 1}.${mimeExtension(task.resultMimeType || "image/png")}`,
      );
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    tasks
      .filter((item) => item.resultBlob)
      .forEach((task) => {
        const folder = zip.folder(
          sanitizeRelativeFolderPath(task.relativePath, task.groupName),
        );
        folder?.file(
          `${sanitizeFileName(task.file.name.replace(/\.[^.]+$/, ""))}_场景_${task.copyIndex + 1}.${mimeExtension(task.resultMimeType || "image/png")}`,
          task.resultBlob!,
        );
        task.outpaintResults?.forEach((result) =>
          folder?.file(
            `${sanitizeFileName(task.file.name.replace(/\.[^.]+$/, ""))}_扩图_${result.width}x${result.height}.${mimeExtension(result.blob.type || "image/png")}`,
            result.blob,
          ),
        );
      });
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      `SceneStudio_自动分类场景替换_${formatFileTimestamp()}.zip`,
    );
  };

  const settingsPanel = (
    <div className="settings-panel scene-replace-settings-panel">
      <Flex justify="space-between">
        <Title level={4} style={{ margin: 0 }}>
          自动分类设置
        </Title>
        <Tag color="purple">PIPELINE</Tag>
      </Flex>
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Card size="small" title="AI 分类分析" style={{ marginBottom: 16 }}>
          <Form.Item label="分析服务商">
            <Segmented
              block
              value={analysisSettings.provider}
              onChange={(provider) =>
                setAnalysisSettings((current) => ({
                  ...current,
                  provider: provider as SceneClassificationSettings["provider"],
                }))
              }
              options={[
                { value: "gemini", label: "Gemini" },
                { value: "openai", label: "GPT" },
              ]}
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
                  current.provider === "openai"
                    ? {
                        ...current,
                        openAiModel:
                          value as SceneClassificationSettings["openAiModel"],
                      }
                    : {
                        ...current,
                        geminiModel:
                          value as SceneClassificationSettings["geminiModel"],
                      },
                )
              }
            />
          </Form.Item>
          <Form.Item label="分析并发">
            <InputNumber
              min={1}
              max={12}
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
          <Form.Item label="分析错误自动重试">
            <Switch
              checked={analysisSettings.autoRetryErrors}
              onChange={(autoRetryErrors) =>
                setAnalysisSettings((current) => ({
                  ...current,
                  autoRetryErrors,
                }))
              }
            />
          </Form.Item>
          {analysisSettings.autoRetryErrors ? (
            <Flex gap={8}>
              <Form.Item label="次数" style={{ flex: 1 }}>
                <InputNumber
                  min={0}
                  max={20}
                  value={analysisSettings.errorRetryLimit}
                  onChange={(errorRetryLimit) =>
                    setAnalysisSettings((current) => ({
                      ...current,
                      errorRetryLimit: errorRetryLimit || 0,
                    }))
                  }
                />
              </Form.Item>
              <Form.Item label="等待秒数" style={{ flex: 1 }}>
                <InputNumber
                  min={1}
                  max={3600}
                  value={analysisSettings.errorRetryDelaySeconds}
                  onChange={(errorRetryDelaySeconds) =>
                    setAnalysisSettings((current) => ({
                      ...current,
                      errorRetryDelaySeconds: errorRetryDelaySeconds || 1,
                    }))
                  }
                />
              </Form.Item>
            </Flex>
          ) : null}
        </Card>
        <Card size="small" title="场景生成" style={{ marginBottom: 16 }}>
          <Form.Item label="图片模型">
            <Select
              value={generationSettings.imageModel}
              options={MODEL_OPTIONS}
              onChange={(imageModel) => patchGeneration({ imageModel })}
            />
          </Form.Item>
          {isOpenAiModel(generationSettings.imageModel) ? (
            <Form.Item label="GPT 输出质量">
              <Select
                value={generationSettings.imageQuality}
                options={["high", "medium", "low"].map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(imageQuality) => patchGeneration({ imageQuality })}
              />
            </Form.Item>
          ) : (
            <Form.Item label="输出分辨率">
              <Segmented
                block
                value={generationSettings.imageSize}
                options={
                  MODEL_CAPABILITIES[
                    generationSettings.imageModel as ImageModel
                  ].imageSizes
                }
                onChange={(imageSize) =>
                  patchGeneration({
                    imageSize: imageSize as SceneReplaceSettings["imageSize"],
                  })
                }
              />
            </Form.Item>
          )}
          <Form.Item label="输出图片比例">
            <Select
              value={generationSettings.ratioMode}
              onChange={(ratioMode) => patchGeneration({ ratioMode })}
              options={[
                { value: "auto", label: "Auto（脚本自动选择）" },
                { value: "unspecified", label: "不传比例（由模型判断）" },
                { value: "original", label: "跟随场景原图" },
                { value: "fixed", label: "固定输出尺寸" },
              ]}
            />
            <Text type="secondary">
              {generationSettings.ratioMode === "auto"
                ? "脚本按原图宽高，从当前模型支持的固定尺寸中选择最合适的一档。"
                : generationSettings.ratioMode === "unspecified"
                  ? "请求中不发送比例或尺寸参数，由图片模型结合提示词判断。"
                  : generationSettings.ratioMode === "original"
                    ? "先匹配最接近的模型比例，生成后再还原为场景原图像素尺寸。"
                    : "始终使用下方指定的固定输出尺寸。"}
            </Text>
            {generationSettings.ratioMode === "fixed" ? (
              isOpenAiModel(generationSettings.imageModel) ? (
                <Select
                  aria-label="GPT 固定输出尺寸"
                  style={{ marginTop: 10 }}
                  value={generationSettings.openAiOutputSize || "1024x1024"}
                  options={OPENAI_IMAGE_OUTPUT_SIZES.map((value) => ({
                    value,
                    label: value.replace("x", " × "),
                  }))}
                  onChange={(openAiOutputSize) =>
                    patchGeneration({ openAiOutputSize })
                  }
                />
              ) : (
                <Select
                  aria-label="Gemini 固定输出比例"
                  style={{ marginTop: 10 }}
                  value={generationSettings.aspectRatio}
                  options={MODEL_CAPABILITIES[
                    generationSettings.imageModel as ImageModel
                  ].aspectRatios.map((value) => ({ value, label: value }))}
                  onChange={(aspectRatio) => patchGeneration({ aspectRatio })}
                />
              )
            ) : null}
          </Form.Item>
          <Form.Item label="生图并发">
            <InputNumber
              min={1}
              max={12}
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
          <Flex justify="space-between">
            <Text>变化不足 20% 自动重试</Text>
            <Switch
              checked={generationSettings.detectInsufficientSceneChange}
              onChange={(detectInsufficientSceneChange) =>
                patchGeneration({ detectInsufficientSceneChange })
              }
            />
          </Flex>
          <Flex justify="space-between" style={{ marginTop: 12 }}>
            <Text>自动跳过白底图</Text>
            <Switch
              checked={generationSettings.autoSkipWhiteBackground}
              onChange={(autoSkipWhiteBackground) =>
                patchGeneration({ autoSkipWhiteBackground })
              }
            />
          </Flex>
          <Flex justify="space-between" style={{ marginTop: 12 }}>
            <Text>生成后自动扩图</Text>
            <Switch
              checked={generationSettings.autoOutpaint}
              onChange={(autoOutpaint) => patchGeneration({ autoOutpaint })}
            />
          </Flex>
          <Flex justify="space-between" style={{ marginTop: 12 }}>
            <Text>生图错误自动重试</Text>
            <Switch
              checked={generationSettings.autoRetryErrors}
              onChange={(autoRetryErrors) =>
                patchGeneration({ autoRetryErrors })
              }
            />
          </Flex>
          {generationSettings.autoRetryErrors ? (
            <Flex gap={8} style={{ marginTop: 12 }}>
              <Form.Item label="重试次数" style={{ flex: 1 }}>
                <InputNumber
                  min={0}
                  max={20}
                  value={generationSettings.errorRetryLimit}
                  onChange={(errorRetryLimit) =>
                    patchGeneration({ errorRetryLimit: errorRetryLimit || 0 })
                  }
                />
              </Form.Item>
              <Form.Item label="等待秒数" style={{ flex: 1 }}>
                <InputNumber
                  min={1}
                  max={3600}
                  value={generationSettings.errorRetryDelaySeconds}
                  onChange={(errorRetryDelaySeconds) =>
                    patchGeneration({
                      errorRetryDelaySeconds: errorRetryDelaySeconds || 1,
                    })
                  }
                />
              </Form.Item>
            </Flex>
          ) : null}
          {generationSettings.autoOutpaint ? (
            <>
              <Form.Item label="扩图模型" style={{ marginTop: 12 }}>
                <Select
                  value={generationSettings.outpaintImageModel}
                  options={MODEL_OPTIONS}
                  onChange={(outpaintImageModel) =>
                    patchGeneration({ outpaintImageModel })
                  }
                />
              </Form.Item>
              <Flex justify="space-between">
                <Text>同时输出 3200×1310 和 1800×1350</Text>
                <Switch
                  checked={generationSettings.outpaintBothSizes}
                  onChange={(outpaintBothSizes) =>
                    patchGeneration({ outpaintBothSizes })
                  }
                />
              </Flex>
            </>
          ) : null}
        </Card>
      </Form>
      <Alert
        type="info"
        showIcon
        title="两套并发完全独立"
        description={`分析并发 ${analysisSettings.concurrency}，生图并发 ${generationSettings.concurrency}；两条队列会同时推进。`}
      />
    </div>
  );

  const pendingGroups = groupFolderFiles(pendingFiles);
  const pickerTree = buildPickerFolderTree(pendingGroups);
  const renderTree = (nodes: typeof pickerTree, depth = 0): ReactNode => (
    <Collapse
      size="small"
      bordered={false}
      defaultActiveKey={nodes.map((item) => item.path)}
      items={nodes.map((node) => ({
        key: node.path,
        label: (
          <Flex gap={8} align="center">
            <FolderOpenOutlined />
            <Text>{node.name}</Text>
            {node.group ? <Tag>{node.group.files.length} 张</Tag> : null}
          </Flex>
        ),
        children: (
          <>
            {node.group ? (
              <Checkbox
                checked={checkedFolders.includes(`dir:${node.path}`)}
                onChange={(event) =>
                  setCheckedFolders((current) =>
                    event.target.checked
                      ? [...new Set([...current, `dir:${node.path}`])]
                      : current.filter((item) => item !== `dir:${node.path}`),
                  )
                }
              >
                导入此文件夹
              </Checkbox>
            ) : null}
            {node.children.length ? renderTree(node.children, depth + 1) : null}
          </>
        ),
      }))}
    />
  );
  return (
    <div className="auto-scene-classify-page">
      <section className="hero-strip scene-replace-hero">
        <div>
          <Text className="eyebrow">AUTO SCENE CLASSIFICATION</Text>
          <Title level={2}>自动分类场景替换</Title>
          <Paragraph className="hero-description">
            一次导入多个文件夹，由独立 AI
            队列持续分类；每张图分类完成后立即使用对应预设提示词开始场景替换。
          </Paragraph>
        </div>
        <div className="hero-orb" />
      </section>
      <Card
        title="1. 导入多个图片文件夹"
        extra={
          <Popconfirm
            title="移除全部文件夹？"
            description="只清空当前网页批次，不会删除电脑中的原文件。"
            disabled={!groups.length}
            onConfirm={removeAllGroups}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!groups.length}>
              移除全部文件夹
            </Button>
          </Popconfirm>
        }
      >
        <Upload.Dragger
          directory
          multiple
          showUploadList={false}
          accept={IMAGE_TYPES.join(",")}
          beforeUpload={(file, list) => {
            if (file.uid === list.at(-1)?.uid) reviewFiles(list as File[]);
            return Upload.LIST_IGNORE;
          }}
        >
          <FolderOpenOutlined style={{ fontSize: 34, color: "#7654dd" }} />
          <p className="ant-upload-text">拖拽或点击选择图片根文件夹</p>
          <p className="ant-upload-hint">
            保留完整目录结构，可在下一步勾选多个最深层图片目录
          </p>
        </Upload.Dragger>
        {groups.length ? (
          <div className="folder-group-grid" style={{ marginTop: 16 }}>
            {groups.map((group) => (
              <Card
                key={group.id}
                size="small"
                hoverable
                className="folder-manage-card"
                title={group.name}
                onClick={() => setManagedGroupId(group.id)}
              >
                <FolderCover file={group.files[0]} />
                <Text type="secondary">
                  {group.path} · {group.files.length} 张
                </Text>
                <Flex gap={6} wrap>
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setManagedGroupId(group.id);
                    }}
                  >
                    查看和管理图片
                  </Button>
                  <Popconfirm
                    title={`移除文件夹 ${group.name}？`}
                    description="只从当前网页批次移除，不会删除电脑中的原文件。"
                    onConfirm={() => removeGroup(group)}
                  >
                    <Button
                      danger
                      type="link"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    >
                      移除文件夹
                    </Button>
                  </Popconfirm>
                </Flex>
              </Card>
            ))}
          </div>
        ) : null}
      </Card>
      <Card title="2. 分类场景提示词预设">
        <Flex gap={12} wrap align="end" style={{ marginBottom: 14 }}>
          <div style={{ flex: "1 1 280px" }}>
            <Text strong>当前预设</Text>
            <Select
              aria-label="当前场景分类提示词预设"
              value={selectedPresetGroupId || undefined}
              placeholder="请先新增预设"
              style={{ width: "100%", marginTop: 6 }}
              options={presetGroups.map((group) => ({
                value: group.id,
                label: `${group.name}（${group.categories.length} 个分类）`,
              }))}
              onChange={setActivePresetGroupId}
            />
          </div>
          <Space wrap>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setPresetGroupEditor({ open: true })}
            >
              新增预设
            </Button>
            <Button
              icon={<EditOutlined />}
              disabled={!activePresetGroup}
              onClick={() =>
                setPresetGroupEditor({
                  open: true,
                  group: activePresetGroup,
                })
              }
            >
              重命名
            </Button>
            <Popconfirm
              title={`删除预设“${activePresetGroup?.name || ""}”？`}
              description="该预设包含的全部分类场景提示词也会被删除。"
              disabled={!activePresetGroup}
              onConfirm={() =>
                activePresetGroup && deletePresetGroup(activePresetGroup.id)
              }
            >
              <Button danger disabled={!activePresetGroup}>
                删除预设
              </Button>
            </Popconfirm>
          </Space>
        </Flex>
        <Alert
          type="info"
          showIcon
          title="一个预设可保存多个分类场景提示词"
          description="AI 只在当前预设的分类中选择，选中后直接把该分类提示词原样交给图片模型；批次启动后冻结当前预设。"
          style={{ marginBottom: 14 }}
        />
        <Flex
          justify="space-between"
          align="center"
          style={{ marginBottom: 12 }}
        >
          <Text strong>
            {activePresetGroup
              ? `${activePresetGroup.name} · ${presets.length} 个分类`
              : "尚未选择预设"}
          </Text>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!activePresetGroup}
            onClick={() => setPresetEditor({ open: true })}
          >
            新增分类
          </Button>
        </Flex>
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
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => setPresetEditor({ open: true, preset })}
                      />
                    </Tooltip>
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
                        withSceneClassificationFallback(current, preset.id),
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
          <Empty
            description={
              activePresetGroup
                ? "当前预设尚无分类，请添加至少一个分类"
                : "请先新增一个分类场景提示词预设"
            }
          />
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
              {generationSettings.concurrency} · 每张生成{" "}
              {generationSettings.copiesPerScene} 张
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
              disabled={!success}
              onClick={() => void downloadAll()}
            >
              下载全部（{success}）
            </Button>
          </Space>
        </Flex>
        {tasks.length ? (
          <>
            <Progress
              percent={
                planned
                  ? Math.round(
                      ((success +
                        failed +
                        stopped +
                        tasks.filter((item) => item.status === "skipped-white")
                          .length) /
                        planned) *
                        100,
                    )
                  : 0
              }
              status={failed ? "exception" : running ? "active" : "success"}
            />
            <Flex gap={24} wrap>
              <Statistic
                title="分析完成"
                value={analyzedSources}
                suffix={`/ ${groups.reduce((sum, item) => sum + item.files.length, 0)}`}
              />
              <Statistic title="分析请求" value={analysisRequests} />
              <Statistic title="兜底分类" value={fallbackCount} />
              <Statistic
                title="生成成功"
                value={success}
                suffix={`/ ${planned}`}
              />
              <Statistic title="生成失败" value={failed} />
              <Statistic title="已停止" value={stopped} />
              <Statistic title="生图/扩图请求" value={generationRequests} />
              <Statistic title="分析重试" value={analysisRetries} />
              <Statistic title="生图重试" value={generationRetries} />
              <Statistic
                title="分析耗时"
                value={
                  analysisStarted && analysisEnded
                    ? formatBatchDuration(analysisEnded - analysisStarted)
                    : "—"
                }
              />
              <Statistic
                title="生图耗时"
                value={
                  generationStarted
                    ? formatBatchDuration(
                        (generationEnded || Date.now()) - generationStarted,
                      )
                    : "—"
                }
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
                title="实际消费金额（实时预估）"
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
            {categoryDistribution.length ? (
              <Space wrap style={{ marginTop: 14 }}>
                {categoryDistribution.map((item) => (
                  <Tag key={item.name} color="purple">
                    {item.name} {item.count}
                  </Tag>
                ))}
              </Space>
            ) : null}
            <Paragraph
              type="secondary"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              分类分析与图片生成并行执行；文本分析 Token
              费用按实际账单计费，不计入图片费用估算。
            </Paragraph>
          </>
        ) : null}
      </Card>
      {tasks.length ? (
        <Card
          title="3. 按文件夹查看结果"
          extra={
            <Text type="secondary">
              每组仅展示第一张成功图片，点击后查看全部
            </Text>
          }
        >
          <div className="folder-group-grid">
            {groups.map((group) => {
              const groupTasks = tasks.filter(
                (item) => item.groupId === group.id,
              );
              const cover = groupTasks.find((item) => item.resultUrl);
              const terminal = groupTasks.filter((item) =>
                ["success", "failed", "stopped", "skipped-white"].includes(
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
                        groupTasks.some(
                          (item) =>
                            item.status === "generating" ||
                            item.status === "analyzing",
                        )
                          ? "processing"
                          : groupTasks.some((item) => item.status === "failed")
                            ? "error"
                            : terminal === groupTasks.length
                              ? "success"
                              : "default"
                      }
                    >
                      {terminal}/{groupTasks.length}
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
          title={`共 ${selectedTasks.length} 个任务，成功 ${selectedPreviewTasks.length} 张`}
          description="放大后可滚轮缩放、拖动、左右切换，并在控制栏切换当前生成图对应的原图。"
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
                            : task.status === "generating" ||
                                task.status === "analyzing"
                              ? "processing"
                              : "default"
                      }
                    >
                      {autoSceneStatusLabel(task.status)}
                    </Tag>
                  }
                >
                  {task.resultUrl ? (
                    <Image src={task.resultUrl} alt="自动分类场景替换结果" />
                  ) : (
                    <div className={`task-state-card is-${task.status}`}>
                      <Text
                        type={task.status === "failed" ? "danger" : "secondary"}
                      >
                        {task.error || autoSceneStatusLabel(task.status)}
                      </Text>
                    </div>
                  )}
                  <Flex
                    justify="space-between"
                    align="center"
                    wrap
                    gap={6}
                    style={{ marginTop: 8 }}
                  >
                    <Select
                      size="small"
                      value={task.categoryId}
                      placeholder="选择分类"
                      style={{ minWidth: 130 }}
                      options={(frozenPresets.current.length
                        ? frozenPresets.current
                        : presets
                      ).map((item) => ({ value: item.id, label: item.name }))}
                      onChange={(value) => assignCategory(task, value)}
                    />
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
                      {task.status === "analyzing" ||
                      task.status === "generating" ||
                      task.status === "waiting-analysis" ||
                      task.status === "waiting-generation" ? (
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
                      ) : (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => retryTask(task)}
                        >
                          重试生成
                        </Button>
                      )}
                      {task.copyIndex === 0 ? (
                        <Button
                          size="small"
                          onClick={() => retryTask(task, true)}
                        >
                          重做分类
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
                  {task.insufficientChangeWarning ? (
                    <Alert
                      type="warning"
                      showIcon
                      title="变化不足 20%，已保留最后结果"
                      description={task.insufficientChangeWarning}
                    />
                  ) : null}
                  {task.outpaintError ? (
                    <Text type="danger">扩图：{task.outpaintError}</Text>
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
        width={980}
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
          title="保留完整目录结构，仅勾选最深层图片文件夹"
          style={{ marginBottom: 14 }}
        />
        {renderTree(pickerTree)}
      </Modal>
      <Modal
        title={managedGroup ? `${managedGroup.name} · 图片管理` : "图片管理"}
        open={Boolean(managedGroup)}
        width={900}
        footer={
          <Button onClick={() => setManagedGroupId(undefined)}>完成</Button>
        }
        onCancel={() => setManagedGroupId(undefined)}
      >
        {managedGroup ? (
          <>
            <Flex
              justify="space-between"
              align="center"
              gap={12}
              wrap
              style={{ marginBottom: 14 }}
            >
              <Text type="secondary">
                {managedGroup.path} · 当前 {managedGroup.files.length}
                张；增删只影响当前网页批次。
              </Text>
              <Upload
                multiple
                showUploadList={false}
                accept={IMAGE_TYPES.join(",")}
                beforeUpload={(file) =>
                  addGroupFile(managedGroup.id, file as File)
                }
              >
                <Button type="primary" icon={<PlusOutlined />}>
                  添加图片到该文件夹
                </Button>
              </Upload>
            </Flex>
            <Image.PreviewGroup>
              <div className="batch-asset-grid">
                {managedGroup.files.map((file, index) => (
                  <FileThumbnail
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() => removeGroupFile(managedGroup.id, file)}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          </>
        ) : null}
      </Modal>
      <PresetEditor
        open={presetEditor.open}
        initial={presetEditor.preset}
        onCancel={() => setPresetEditor({ open: false })}
        onSave={savePreset}
        onOptimize={optimizePresetPrompt}
      />
      <PresetGroupEditor
        open={presetGroupEditor.open}
        initial={presetGroupEditor.group}
        onCancel={() => setPresetGroupEditor({ open: false })}
        onSave={savePresetGroup}
      />
      {settingsHost ? createPortal(settingsPanel, settingsHost) : null}
    </div>
  );
}
