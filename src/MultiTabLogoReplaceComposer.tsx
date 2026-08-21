import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Flex,
  Image,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import JSZip from "jszip";
import LogoReplaceComposer, {
  buildActualReplacementPrompt,
} from "./LogoReplaceComposer";
import PsdLogoImportModal from "./PsdLogoImportModal";
import { reportTaskProgress } from "./services/taskProgress";
import { formatBatchDuration } from "./services/batchTiming";
import type {
  LogoReplaceProgressSnapshot,
  LogoReplaceSettings,
  LogoReplaceTaskDetail,
  PerImagePromptAssignment,
} from "./types";
import { downloadBlob, formatFileTimestamp, sanitizeFileName } from "./utils";
import { logoReplaceResultFileName } from "./services/logoReplaceFileName";
import { sanitizeRelativeFolderPath } from "./services/batchFolderPath";
import { DEFAULT_LOGO_REPLACE_SETTINGS, STORAGE_KEYS } from "./constants";
import { readLocalStorage } from "./storage";
import { PerImagePromptEditor, usePerImagePrompts } from "./usePerImagePrompts";
import {
  perImagePromptFileKey,
  shouldAnalyzePerImagePromptsInController,
} from "./services/perImagePrompt";
import {
  batchCostMetrics,
  formatBatchDateTime,
  percentage,
} from "./services/batchExecutionMetrics";
import {
  putMultiTabResult,
  readMultiTabGroupResults,
} from "./services/multiTabResultStore";
import { desktopAssetFromFile, isElectronDesktop, submitDesktopJob } from "./desktop/runtime";

const { Title, Text, Paragraph } = Typography;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DB_NAME = "scene-studio.multi-tab-logo-replace.v1";
const STORE = "batches";
const LAST_BATCH_KEY = "scene-studio.multi-tab-logo-replace.last-batch";

interface FolderGroup {
  id: string;
  name: string;
  path: string;
  files: File[];
}
interface FolderTreeNode {
  title: string;
  key: string;
  children?: FolderTreeNode[];
}
interface PickerFolderNode {
  name: string;
  path: string;
  children: PickerFolderNode[];
  group?: FolderGroup;
}
interface SharedBatch {
  id: string;
  createdAt: number;
  groups: FolderGroup[];
  logos: File[];
  oldLogo?: File;
  globalConcurrency?: number;
  perImagePrompts?: Record<string, PerImagePromptAssignment>;
  startCommandId?: string;
  multiLogoModeEnabled?: boolean;
  distinctLogoPerOccurrence?: boolean;
  autoDownloadOnComplete?: boolean;
}
interface WorkerProgress extends LogoReplaceProgressSnapshot {
  groupId: string;
  name: string;
  status: "opening" | "ready" | "running" | "completed";
  updatedAt: number;
}

export function FileThumbnail({
  file,
  onRemove,
}: {
  file: File;
  onRemove?: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!onRemove)
    return previewUrl ? (
      <Image
        loading="lazy"
        preview={false}
        src={previewUrl}
        alt={file.name}
        width={42}
        height={42}
        style={{ objectFit: "cover", borderRadius: 5 }}
      />
    ) : null;
  return (
    <div className="batch-asset-card">
      {previewUrl ? (
        <Image loading="lazy" src={previewUrl} alt={file.name} />
      ) : (
        <div className="batch-asset-placeholder">
          <FileImageOutlined />
        </div>
      )}
      <Text ellipsis={{ tooltip: file.name }}>{file.name}</Text>
      {onRemove && (
        <Popconfirm
          title="从当前批次移除这张图片？"
          description="不会删除电脑中的原文件。"
          onConfirm={onRemove}
        >
          <Button danger type="text" size="small" icon={<DeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      )}
    </div>
  );
}

function TaskResultThumbnail({
  detail,
  urls,
  showOriginal,
  onToggleOriginal,
  usable,
  onUsableChange,
}: {
  detail: LogoReplaceTaskDetail;
  urls: { result: string; original: string };
  showOriginal: boolean;
  onToggleOriginal: () => void;
  usable: boolean;
  onUsableChange: (value: boolean) => void;
}) {
  const toggleOriginal = onToggleOriginal;
  const statusText = detail.skipReason
    ? "保留原图"
    : detail.status === "success"
      ? "生成完成"
      : detail.status === "failed"
        ? "生成失败"
        : detail.status === "stopped"
          ? "已停止"
          : detail.status === "running"
            ? "生成中"
            : "等待中";
  const statusColor =
    detail.status === "success"
      ? "success"
      : detail.status === "failed"
        ? "error"
        : detail.status === "running"
          ? "processing"
          : "default";
  return (
    <Card
      size="small"
      className="batch-result-card"
      title={`场景 ${detail.sceneIndex + 1} · 结果 ${detail.copyIndex + 1}`}
      extra={<Tag color={statusColor}>{statusText}</Tag>}
    >
      {urls.result ? (
        <>
          <div className="batch-result-image">
            <Image
              src={showOriginal && urls.original ? urls.original : urls.result}
              alt={showOriginal ? "原图" : "生成图"}
              preview={{
                src:
                  showOriginal && urls.original ? urls.original : urls.result,
                actionsRender: (originalNode) => (
                  <>
                    {originalNode}
                    {urls.original && (
                      <button
                        type="button"
                        className={`scene-preview-compare-action${showOriginal ? " is-active" : ""}`}
                        title={showOriginal ? "查看生成图" : "查看原图"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleOriginal();
                        }}
                      >
                        <EyeOutlined />
                      </button>
                    )}
                  </>
                ),
              }}
            />
          </div>
          {urls.original && !detail.skipReason && (
            <Button
              block
              size="small"
              icon={<EyeOutlined />}
              onClick={toggleOriginal}
            >
              {showOriginal ? "查看生成图" : "查看原图"}
            </Button>
          )}
        </>
      ) : (
        <div className="batch-result-state">
          <FileImageOutlined />
          <Text type="secondary">{detail.error || statusText}</Text>
        </div>
      )}
      <Flex gap={6} wrap className="batch-result-meta">
        {detail.skipReason && (
          <Tag color="warning">未执行替换：{detail.skipReason}</Tag>
        )}
        {detail.retryCount > 0 && (
          <Tag color="gold">重试 {detail.retryCount} 次</Tag>
        )}
        {detail.verificationStatus && !detail.skipReason && (
          <Tag>校验：{detail.verificationStatus}</Tag>
        )}
        {detail.resultBlob && (
          <Checkbox
            checked={usable}
            onChange={(event) => onUsableChange(event.target.checked)}
          >
            手动标记可用
          </Checkbox>
        )}
      </Flex>
    </Card>
  );
}

function TaskResultGallery({
  details,
  usableIds,
  onUsableChange,
}: {
  details: LogoReplaceTaskDetail[];
  usableIds: string[];
  onUsableChange: (id: string, value: boolean) => void;
}) {
  const [urlsById, setUrlsById] = useState<
    Record<string, { result: string; original: string }>
  >({});
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const next = Object.fromEntries(
      details.map((detail) => [
        detail.id,
        {
          result: detail.resultBlob
            ? URL.createObjectURL(detail.resultBlob)
            : "",
          original: detail.originalFile
            ? URL.createObjectURL(detail.originalFile)
            : "",
        },
      ]),
    );
    setUrlsById(next);
    setShowOriginalIds(new Set());
    return () =>
      Object.values(next).forEach(({ result, original }) => {
        if (result) URL.revokeObjectURL(result);
        if (original) URL.revokeObjectURL(original);
      });
  }, [details]);
  const previewItems = details.flatMap((detail) => {
    const urls = urlsById[detail.id];
    if (!urls?.result) return [];
    const showOriginal =
      showOriginalIds.has(detail.id) && Boolean(urls.original);
    return [
      {
        src: showOriginal ? urls.original : urls.result,
        alt: showOriginal
          ? `场景 ${detail.sceneIndex + 1} 原图`
          : `场景 ${detail.sceneIndex + 1} 结果 ${detail.copyIndex + 1}`,
      },
    ];
  });
  return (
    <Image.PreviewGroup items={previewItems}>
      <div className="batch-result-grid">
        {details.map((detail) => (
          <TaskResultThumbnail
            key={detail.id}
            detail={detail}
            urls={urlsById[detail.id] || { result: "", original: "" }}
            showOriginal={showOriginalIds.has(detail.id)}
            onToggleOriginal={() =>
              setShowOriginalIds((current) => {
                const next = new Set(current);
                next.has(detail.id)
                  ? next.delete(detail.id)
                  : next.add(detail.id);
                return next;
              })
            }
            usable={usableIds.includes(detail.id)}
            onUsableChange={(value) => onUsableChange(detail.id, value)}
          />
        ))}
      </div>
    </Image.PreviewGroup>
  );
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveBatch(batch: SharedBatch) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(batch);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readBatch(id: string) {
  const db = await openDb();
  const result = await new Promise<SharedBatch | undefined>(
    (resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return result;
}

async function readLatestBatch() {
  const db = await openDb();
  const result = await new Promise<SharedBatch | undefined>(
    (resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as SharedBatch[]).sort(
            (a, b) => b.createdAt - a.createdAt,
          )[0],
        );
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return result;
}

export function groupFolderFiles(files: File[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  files
    .filter((file) => IMAGE_TYPES.includes(file.type))
    .forEach((file) => {
      const relativePath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      const parts = relativePath.split("/").filter(Boolean);
      const directories = parts.slice(0, -1);
      const leaf = directories.at(-1) || "未分组";
      const parent = directories.at(-2);
      const name = parent === leaf ? leaf : leaf;
      const path = directories.join("/");
      const id = encodeURIComponent(path || name);
      const group = groups.get(id) || { id, name, path, files: [] };
      group.files.push(file);
      groups.set(id, group);
    });
  return [...groups.values()].sort((a, b) =>
    a.path.localeCompare(b.path, "zh-CN"),
  );
}

export function fileRelativePath(file: File) {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  );
}

function fileDirectory(file: File) {
  return fileRelativePath(file)
    .split("/")
    .filter(Boolean)
    .slice(0, -1)
    .join("/");
}

export function filesInCheckedFolders(files: File[], checkedKeys: string[]) {
  const directories = checkedKeys
    .filter((key) => key.startsWith("dir:"))
    .map((key) => key.slice(4));
  return files.filter((file) => {
    const directory = fileDirectory(file);
    return directories.some(
      (selected) =>
        directory === selected || directory.startsWith(`${selected}/`),
    );
  });
}

export function buildFolderTree(files: File[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = [];
  files
    .filter((file) => IMAGE_TYPES.includes(file.type))
    .forEach((file) => {
      const parts = fileRelativePath(file)
        .split("/")
        .filter(Boolean)
        .slice(0, -1);
      let nodes = roots;
      let path = "";
      parts.forEach((part) => {
        path = path ? `${path}/${part}` : part;
        const key = `dir:${path}`;
        let node = nodes.find((item) => item.key === key);
        if (!node) {
          node = { title: part, key, children: [] };
          nodes.push(node);
        }
        nodes = node.children || [];
      });
    });
  return roots;
}

export function buildLogoPickerFolderTree(
  groups: FolderGroup[],
): PickerFolderNode[] {
  const leafGroups = groups.filter(
    (group) =>
      !groups.some(
        (candidate) =>
          candidate.path !== group.path &&
          candidate.path.startsWith(`${group.path}/`),
      ),
  );
  const roots: PickerFolderNode[] = [];
  leafGroups.forEach((group) => {
    let nodes = roots;
    let path = "";
    group.path
      .split("/")
      .filter(Boolean)
      .forEach((name, index, parts) => {
        path = path ? `${path}/${name}` : name;
        let node = nodes.find((item) => item.path === path);
        if (!node) {
          node = { name, path, children: [] };
          nodes.push(node);
        }
        if (index === parts.length - 1) node.group = group;
        nodes = node.children;
      });
  });
  return roots;
}

function activeLogoComposerRoot(root: HTMLElement | null) {
  return (
    root?.querySelector<HTMLElement>(
      ".logo-replace-integrated > div:not([hidden])",
    ) || null
  );
}

interface Props {
  apiKey: string;
  openAiApiKey: string;
  apiBaseUrl: string | null;
  connectionMode: "direct" | "proxy";
  onRequestKey: () => void;
  settingsHost?: HTMLElement | null;
  onSessionStateChange?: (value: boolean) => void;
}

export default function MultiTabLogoReplaceComposer(props: Props) {
  const { message } = App.useApp();
  const params = new URLSearchParams(location.search);
  const batchId = params.get("batch");
  const groupId = params.get("group");
  const worker = params.get("worker") === "1";
  const [groups, setGroups] = useState<FolderGroup[]>([]);
  const [logos, setLogos] = useState<File[]>([]);
  const [oldLogo, setOldLogo] = useState<File>();
  const [globalConcurrency, setGlobalConcurrency] = useState(6);
  const storedLogoSettings = readLocalStorage<LogoReplaceSettings>(
    STORAGE_KEYS.logoReplaceSettings,
    DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings,
  );
  const [perImagePromptEnabled, setPerImagePromptEnabled] = useState(
    storedLogoSettings.perImagePromptEnabled,
  );
  const [autoGenerateAfterPromptAnalysis, setAutoGenerateAfterPromptAnalysis] =
    useState(storedLogoSettings.autoGenerateAfterPromptAnalysis);
  const [distinctLogoPerOccurrence, setDistinctLogoPerOccurrence] = useState(
    Boolean(storedLogoSettings.distinctLogoPerOccurrence),
  );
  const [autoDownloadOnComplete, setAutoDownloadOnComplete] = useState(() =>
    readLocalStorage("scene-studio.logo-tabs-auto-download", false),
  );
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [pendingPsdFile, setPendingPsdFile] = useState<File>();
  const [blockedWorkerUrls, setBlockedWorkerUrls] = useState<
    Array<{ name: string; url: string }>
  >([]);
  const [workerBatch, setWorkerBatch] = useState<SharedBatch>();
  const [workerGroup, setWorkerGroup] = useState<FolderGroup>();
  const [injected, setInjected] = useState(false);
  const logoPromptSource = storedLogoSettings.customizeReplacementPrompt
    ? storedLogoSettings.replacementPrompt
    : buildActualReplacementPrompt(
        storedLogoSettings,
        Boolean(oldLogo),
      );
  const perImagePrompts = usePerImagePrompts({
    tool: "logo-replace",
    files: groups.flatMap((group) => group.files),
    sourcePrompt: logoPromptSource,
    initial: workerBatch?.perImagePrompts,
    config: {
      provider: storedLogoSettings.languageProvider,
      apiKey:
        storedLogoSettings.languageProvider === "openai"
          ? props.openAiApiKey
          : props.apiKey,
      apiBaseUrl: props.apiBaseUrl,
      geminiModel: storedLogoSettings.verificationModel,
      openAiModel: storedLogoSettings.openAiLanguageModel,
      concurrency: Math.min(8, globalConcurrency),
      autoRetryErrors: storedLogoSettings.autoRetryErrors,
      errorRetryLimit: storedLogoSettings.errorRetryLimit,
      errorRetryDelaySeconds: storedLogoSettings.errorRetryDelaySeconds,
    },
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const loadedLogoKeys = useRef(new Set<string>());
  const [channel, setChannel] = useState<BroadcastChannel>();
  const [automationStartToken, setAutomationStartToken] = useState<string>();
  const [automationRetryFailedToken, setAutomationRetryFailedToken] =
    useState<string>();
  const [workerProgress, setWorkerProgress] = useState<
    Record<string, WorkerProgress>
  >({});
  const [workerTaskDetails, setWorkerTaskDetails] = useState<
    Record<string, Record<string, LogoReplaceTaskDetail>>
  >({});
  const [selectedProgressGroupId, setSelectedProgressGroupId] =
    useState<string>();
  const [loadedTaskDetails, setLoadedTaskDetails] = useState<
    LogoReplaceTaskDetail[]
  >([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [pendingFolderFiles, setPendingFolderFiles] = useState<File[]>([]);
  const [checkedFolderKeys, setCheckedFolderKeys] = useState<string[]>([]);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingGroup, setDownloadingGroup] = useState(false);
  const [cachedResultCount, setCachedResultCount] = useState(0);
  const [restoringCache, setRestoringCache] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [runEndedAt, setRunEndedAt] = useState<number>();
  const [runDurationMs, setRunDurationMs] = useState<number>();
  const [usableTaskIds, setUsableTaskIds] = useState<string[]>([]);
  const [workerTitleState, setWorkerTitleState] = useState<
    "queued" | "running" | "completed"
  >("queued");
  const autoDownloadStarted = useRef(false);
  const [titleFlash, setTitleFlash] = useState(false);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const next = new BroadcastChannel("scene-studio-logo-tabs");
    setChannel(next);
    return () => next.close();
  }, []);

  const restoreCachedBatch = async (preferredId?: string) => {
    if (worker) return;
    setRestoringCache(true);
    try {
      const batch =
        (preferredId ? await readBatch(preferredId) : undefined) ||
        (await readLatestBatch());
      if (!batch)
        return void message.info("没有找到可恢复的多标签 Logo 批次缓存");
      const entries = await Promise.all(
        batch.groups.map(async (group) => {
          const tasks = await readMultiTabGroupResults<LogoReplaceTaskDetail>(
            "logo",
            batch.id,
            group.id,
          );
          const success = tasks.filter(
            (task) => task.status === "success" && task.resultBlob,
          ).length;
          const failed = tasks.filter(
            (task) => task.status === "failed",
          ).length;
          const stopped = tasks.filter(
            (task) => task.status === "stopped",
          ).length;
          return [
            group.id,
            {
              groupId: group.id,
              name: group.name,
              status: "completed",
              total: tasks.length,
              success,
              failed,
              stopped,
              waiting: 0,
              running: 0,
              retrying: 0,
              updatedAt: Date.now(),
            } satisfies WorkerProgress,
          ] as const;
        }),
      );
      const count = entries.reduce(
        (sum, [, progress]) => sum + progress.success,
        0,
      );
      setGroups(batch.groups);
      setLogos(batch.logos);
      setOldLogo(batch.oldLogo);
      setGlobalConcurrency(batch.globalConcurrency || 6);
      setDistinctLogoPerOccurrence(Boolean(batch.distinctLogoPerOccurrence));
      setAutoDownloadOnComplete(Boolean(batch.autoDownloadOnComplete));
      setActiveBatchId(batch.id);
      setWorkerProgress(Object.fromEntries(entries));
      setCachedResultCount(count);
      localStorage.setItem(LAST_BATCH_KEY, batch.id);
      message.success(`已从 IndexedDB 恢复批次，共找到 ${count} 张生成图片`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "恢复缓存失败");
    } finally {
      setRestoringCache(false);
    }
  };
  useEffect(() => {
    if (worker || activeBatchId) return;
    const lastId = localStorage.getItem(LAST_BATCH_KEY) || undefined;
    void restoreCachedBatch(lastId);
  }, [worker]);

  useEffect(() => {
    if (!worker || !batchId || !groupId) return;
    void readBatch(batchId).then((batch) => {
      const group = batch?.groups.find((item) => item.id === groupId);
      setWorkerBatch(
        batch && group
          ? {
              ...batch,
              groups: [group],
              perImagePrompts: Object.fromEntries(
                Object.entries(batch.perImagePrompts || {}).filter(([key]) =>
                  group.files.some(
                    (file) => perImagePromptFileKey(file) === key,
                  ),
                ),
              ),
            }
          : batch,
      );
      setWorkerGroup(group);
      setAutomationStartToken(batch?.startCommandId);
      props.onSessionStateChange?.(Boolean(group));
    });
  }, [worker, batchId, groupId, props.onSessionStateChange]);

  useEffect(() => {
    if (!workerBatch || !workerGroup || injected) return;
    workerBatch.logos.forEach((file) =>
      loadedLogoKeys.current.add(
        `${file.name}:${file.size}:${file.lastModified}`,
      ),
    );
    if (workerBatch.oldLogo) {
      loadedLogoKeys.current.add(
        `old:${workerBatch.oldLogo.name}:${workerBatch.oldLogo.size}:${workerBatch.oldLogo.lastModified}`,
      );
    }
    setInjected(true);
    channel?.postMessage({
      type: "worker-ready",
      batchId,
      groupId,
      name: workerGroup.name,
      count: workerGroup.files.length,
    });
  }, [workerBatch, workerGroup, injected, channel, batchId, groupId]);

  useEffect(() => {
    if (!channel) return;
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.batchId !== (worker ? batchId : activeBatchId)) return;
      if (worker && data.type === "start-all")
        setAutomationStartToken(data.commandId);
      if (worker && data.type === "retry-failed")
        setAutomationRetryFailedToken(data.commandId);
      if (worker && data.type === "stop-all")
        activeLogoComposerRoot(rootRef.current)
          ?.querySelector<HTMLButtonElement>(
            ".action-card button.ant-btn-danger",
          )
          ?.click();
      if (worker && data.type === "logos-updated" && batchId)
        void readBatch(batchId).then((batch) => {
          if (!batch) return;
          const group = batch.groups.find((item) => item.id === groupId);
          setWorkerBatch(
            group
              ? {
                  ...batch,
                  groups: [group],
                  perImagePrompts: Object.fromEntries(
                    Object.entries(batch.perImagePrompts || {}).filter(
                      ([key]) =>
                        group.files.some(
                          (file) => perImagePromptFileKey(file) === key,
                        ),
                    ),
                  ),
                }
              : batch,
          );
          const fresh = batch.logos.filter(
            (file) =>
              !loadedLogoKeys.current.has(
                `${file.name}:${file.size}:${file.lastModified}`,
              ),
          );
          if (fresh.length) {
            fresh.forEach((file) =>
              loadedLogoKeys.current.add(
                `${file.name}:${file.size}:${file.lastModified}`,
              ),
            );
            message.success(`已同步 ${fresh.length} 个公共 Logo`);
          }
          const oldLogoKey = batch.oldLogo
            ? `old:${batch.oldLogo.name}:${batch.oldLogo.size}:${batch.oldLogo.lastModified}`
            : undefined;
          if (oldLogoKey && !loadedLogoKeys.current.has(oldLogoKey)) {
            loadedLogoKeys.current.add(oldLogoKey);
            message.success("已同步旧 Logo 参考图");
          }
        });
      if (!worker && data.type === "worker-ready")
        setWorkerProgress((current) => ({
          ...current,
          [data.groupId]: {
            ...(current[data.groupId] || {
              total: 0,
              success: 0,
              failed: 0,
              stopped: 0,
              waiting: 0,
              running: 0,
              retrying: 0,
            }),
            groupId: data.groupId,
            name: data.name,
            status: "ready",
            updatedAt: Date.now(),
          },
        }));
      if (!worker && data.type === "worker-progress")
        setWorkerProgress((current) => ({
          ...current,
          [data.groupId]: data.progress,
        }));
      if (!worker && data.type === "worker-task")
        setWorkerTaskDetails((current) => ({
          ...current,
          [data.groupId]: {
            ...(current[data.groupId] || {}),
            [data.detail.id]: data.detail,
          },
        }));
    };
    channel.addEventListener("message", receive);
    return () => channel.removeEventListener("message", receive);
  }, [worker, channel, batchId, activeBatchId, message]);

  useEffect(() => {
    if (!worker || !workerBatch?.globalConcurrency || !navigator.locks) return;
    const originalFetch = window.fetch.bind(window);
    const slots = workerBatch.globalConcurrency;
    window.fetch = async (...args) => {
      const target =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof URL
            ? args[0].href
            : args[0].url;
      if (
        !/generativelanguage\.googleapis\.com|api\.openai\.com|\/api\/gemini/i.test(
          target,
        )
      )
        return originalFetch(...args);
      while (true) {
        for (let index = 0; index < slots; index += 1) {
          const result = await navigator.locks.request(
            `scene-studio-ai-slot-${index}`,
            { ifAvailable: true },
            async (lock) => (lock ? originalFetch(...args) : undefined),
          );
          if (result) return result;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [worker, workerBatch?.globalConcurrency]);

  const buildWorkerTarget = (id: string, group: FolderGroup) => {
    const url = new URL(location.href);
    url.searchParams.set("tool", "logo-replace-tabs");
    url.searchParams.set("worker", "1");
    url.searchParams.set("batch", id);
    url.searchParams.set("group", group.id);
    url.searchParams.set("folder", group.name);
    return { name: group.name, url: url.toString() };
  };
  const persistCurrentBatch = async (
    id = activeBatchId || `batch-${Date.now()}`,
  ) => {
    localStorage.setItem(
      STORAGE_KEYS.logoReplaceSettings,
      JSON.stringify({
        ...storedLogoSettings,
        useOldLogoReference: Boolean(oldLogo),
        perImagePromptEnabled,
        autoGenerateAfterPromptAnalysis,
        multiLogoModeEnabled: false,
        distinctLogoPerOccurrence,
      }),
    );
    localStorage.setItem(
      "scene-studio.logo-tabs-auto-download",
      JSON.stringify(autoDownloadOnComplete),
    );
    await saveBatch({
      id,
      createdAt: Date.now(),
      groups,
      logos,
      oldLogo,
      globalConcurrency,
      perImagePrompts: perImagePrompts.current(),
      multiLogoModeEnabled: false,
      distinctLogoPerOccurrence,
      autoDownloadOnComplete,
    });
    setActiveBatchId(id);
    localStorage.setItem(LAST_BATCH_KEY, id);
    return id;
  };
  const openWorkers = async () => {
    if (!groups.length)
      return void message.warning("请先选择包含各组图片的根文件夹");
    if (!logos.length) return void message.warning("请先上传公共 Logo");
    if (isElectronDesktop()) {
      const outputRoot = await window.desktop?.pickOutputDirectory();
      if (!outputRoot) return;
      try {
        const sharedLogos = logos.map(desktopAssetFromFile);
        const id = await submitDesktopJob({
          name: `多文件夹 Logo 替换 ${new Date().toLocaleString()}`,
          outputRoot,
          globalConcurrency,
          startPaused: true,
          apiBaseUrl: props.apiBaseUrl,
          groups: groups.map((group) => ({ id: group.id, name: group.name, relativePath: group.path, scenes: group.files.map(desktopAssetFromFile), logos: sharedLogos, oldLogo: oldLogo ? desktopAssetFromFile(oldLogo) : undefined })),
          config: { tool: "logo-replace", settings: { ...storedLogoSettings, useOldLogoReference: Boolean(oldLogo), perImagePromptEnabled, autoGenerateAfterPromptAnalysis: true, distinctLogoPerOccurrence } },
        });
        setActiveBatchId(id);
        window.dispatchEvent(new Event("desktop-task-created"));
        message.success("全部文件夹已加入桌面后台队列，不再创建子标签");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "创建桌面批次失败");
      }
      return;
    }
    const id = `batch-${Date.now()}`;
    const placeholders = groups.map((_group, index) =>
      window.open("", `scene-studio-logo-worker-${id}-${index}`),
    );
    if (
      shouldAnalyzePerImagePromptsInController(
        perImagePromptEnabled,
        autoGenerateAfterPromptAnalysis,
      )
    ) {
      const missing = groups
        .flatMap((group) => group.files)
        .filter((file) => !perImagePrompts.effective(file));
      if (missing.length) {
        const analyzed = await perImagePrompts.analyze(missing);
        if (analyzed.failed) {
          placeholders.forEach((item) => item?.close());
          return void message.error(
            `${analyzed.failed} 张图片提示词分析失败，请重试`,
          );
        }
        placeholders.forEach((item) => item?.close());
        return void message.success("逐图提示词已分配，请审核后再次打开标签");
      }
    }
    await persistCurrentBatch(id);
    setWorkerProgress(
      Object.fromEntries(
        groups.map((group) => [
          group.id,
          {
            groupId: group.id,
            name: group.name,
            status: "opening",
            total: 0,
            success: 0,
            failed: 0,
            stopped: 0,
            waiting: 0,
            running: 0,
            retrying: 0,
            updatedAt: Date.now(),
          },
        ]),
      ),
    );
    const targets = groups.map((group) => buildWorkerTarget(id, group));
    const blocked: typeof targets = [];
    targets.forEach((target, index) => {
      const opened = placeholders[index];
      if (opened) opened.location.href = target.url;
      else blocked.push(target);
    });
    setBlockedWorkerUrls(blocked);
    if (blocked.length)
      message.warning(
        `${blocked.length} 个标签被浏览器拦截，请在弹窗中逐个打开或允许本站弹出窗口`,
      );
  };
  const openSingleWorker = async (group: FolderGroup) => {
    if (!logos.length) return void message.warning("请先上传公共 Logo");
    if (isElectronDesktop()) {
      try {
        const outputRoot = await window.desktop?.pickOutputDirectory(); if (!outputRoot) return;
        const id = await submitDesktopJob({ name: `${group.name} · Logo 替换`, outputRoot, globalConcurrency, apiBaseUrl: props.apiBaseUrl, groups: [{ id: group.id, name: group.name, relativePath: group.path, scenes: group.files.map(desktopAssetFromFile), logos: logos.map(desktopAssetFromFile), oldLogo: oldLogo ? desktopAssetFromFile(oldLogo) : undefined }], config: { tool: "logo-replace", settings: { ...storedLogoSettings, useOldLogoReference: Boolean(oldLogo), perImagePromptEnabled, autoGenerateAfterPromptAnalysis: true, distinctLogoPerOccurrence } } });
        setActiveBatchId(id); window.dispatchEvent(new Event("desktop-task-created")); message.success(`${group.name} 已加入桌面后台队列`);
      } catch (error) { message.error(error instanceof Error ? error.message : "创建桌面批次失败"); }
      return;
    }
    const placeholder = window.open(
      "",
      `scene-studio-logo-worker-${group.id}-${Date.now()}`,
    );
    if (
      shouldAnalyzePerImagePromptsInController(
        perImagePromptEnabled,
        autoGenerateAfterPromptAnalysis,
      )
    ) {
      const missing = group.files.filter(
        (file) => !perImagePrompts.effective(file),
      );
      if (missing.length) {
        const analyzed = await perImagePrompts.analyze(missing);
        if (analyzed.failed) {
          placeholder?.close();
          return void message.error(
            `${analyzed.failed} 张图片提示词分析失败，请重试`,
          );
        }
        placeholder?.close();
        return void message.success("逐图提示词已分配，请审核后再次打开标签");
      }
    }
    const id = await persistCurrentBatch();
    const target = buildWorkerTarget(id, group);
    setWorkerProgress((current) => ({
      ...current,
      [group.id]: current[group.id] || {
        groupId: group.id,
        name: group.name,
        status: "opening",
        total: 0,
        success: 0,
        failed: 0,
        stopped: 0,
        waiting: 0,
        running: 0,
        retrying: 0,
        updatedAt: Date.now(),
      },
    }));
    if (placeholder) placeholder.location.href = target.url;
    else
      setBlockedWorkerUrls((current) =>
        current.some((item) => item.url === target.url)
          ? current
          : [...current, target],
      );
  };
  const removeGroup = (group: FolderGroup) => {
    setGroups((current) => current.filter((item) => item.id !== group.id));
    setSelectedGroupId((current) =>
      current === group.id ? undefined : current,
    );
    setWorkerProgress((current) => {
      const next = { ...current };
      delete next[group.id];
      return next;
    });
    message.success(`已移除分组 ${group.name}`);
  };
  const removeAllGroups = async () => {
    const id = activeBatchId || batchId;
    setGroups([]);
    setSelectedGroupId(undefined);
    setSelectedProgressGroupId(undefined);
    setWorkerProgress({});
    setWorkerTaskDetails({});
    setLoadedTaskDetails([]);
    setPendingFolderFiles([]);
    setCheckedFolderKeys([]);
    setBlockedWorkerUrls([]);
    setCachedResultCount(0);
    setUsableTaskIds([]);
    perImagePrompts.clear();
    if (id) {
      const batch = await readBatch(id);
      if (batch) await saveBatch({ ...batch, groups: [], perImagePrompts: {} });
    }
    message.success("已移除全部文件夹分组");
  };
  const removeAllLogos = async () => {
    const id = activeBatchId || batchId;
    setLogos([]);
    setOldLogo(undefined);
    setPendingPsdFile(undefined);
    if (id) {
      const batch = await readBatch(id);
      if (batch)
        await saveBatch({ ...batch, logos: [], oldLogo: undefined });
      channel?.postMessage({ type: "logos-updated", batchId: id });
    }
    message.success("已移除全部 Logo");
  };
  const syncLogos = async () => {
    const id = activeBatchId || batchId;
    if (!id) return;
    const batch = await readBatch(id);
    if (!batch) return;
    batch.logos = logos;
    batch.oldLogo = oldLogo;
    await saveBatch(batch);
    channel?.postMessage({ type: "logos-updated", batchId: id });
    message.success("公共新 Logo 与旧 Logo 参考已同步到子标签");
  };
  const startAllWorkers = async () => {
    if (isElectronDesktop()) {
      if (!activeBatchId) return void message.warning("请先创建桌面后台批次");
      await window.desktop?.resumeJob(activeBatchId);
      window.dispatchEvent(new Event("desktop-task-created"));
      return void message.success("桌面后台队列已开始执行");
    }
    if (!activeBatchId)
      return void message.warning("请先保存批次并打开工作标签");
    const batch = await readBatch(activeBatchId);
    if (!batch) return void message.error("未找到当前批次");
    const commandId = `start-${Date.now()}`;
    batch.startCommandId = commandId;
    await saveBatch(batch);
    setWorkerTaskDetails({});
    setRunStartedAt(Date.now());
    setRunEndedAt(undefined);
    setRunDurationMs(undefined);
    setUsableTaskIds([]);
    setSelectedProgressGroupId(undefined);
    channel?.postMessage({
      type: "start-all",
      batchId: activeBatchId,
      commandId,
    });
    setWorkerProgress((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, item]) => [
          id,
          {
            ...item,
            status: item.status === "completed" ? "completed" : "running",
            updatedAt: Date.now(),
          },
        ]),
      ),
    );
    message.success("已通知所有工作标签开始替换");
  };
  const stopAllWorkers = () => {
    if (!activeBatchId) return;
    channel?.postMessage({ type: "stop-all", batchId: activeBatchId });
    message.info("已通知所有工作标签停止任务");
  };
  const disableCloseWarnings = () => {
    channel?.postMessage({
      type: "disable-close-warning",
      batchId: activeBatchId,
    });
    message.success("已通知所有工作标签关闭离页提醒");
  };
  const retryAllFailedWorkers = () => {
    if (!activeBatchId || !aggregate.failed) return;
    channel?.postMessage({
      type: "retry-failed",
      batchId: activeBatchId,
      commandId: `retry-${Date.now()}`,
    });
    message.success("已通知所有工作标签重试失败任务");
  };
  const workerSnapshots = Object.values(workerProgress);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const selectedProgressWorker = selectedProgressGroupId
    ? workerProgress[selectedProgressGroupId]
    : undefined;
  const selectedTaskDetails = loadedTaskDetails;
  const removeGroupFile = (groupId: string, target: File) => {
    const group = groups.find((item) => item.id === groupId);
    if (group?.files.length === 1) {
      setSelectedGroupId(undefined);
      message.info(`已移除空分组 ${group.name}`);
    }
    setGroups((current) =>
      current.flatMap((item) => {
        if (item.id !== groupId) return [item];
        const files = item.files.filter((file) => file !== target);
        return files.length ? [{ ...item, files }] : [];
      }),
    );
  };
  const addGroupFile = (groupId: string, file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      message.error(`${file.name} 不是支持的图片格式`);
      return Upload.LIST_IGNORE;
    }
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, files: [...group.files, file] }
          : group,
      ),
    );
    return Upload.LIST_IGNORE;
  };
  const reviewFolderFiles = (files: File[]) => {
    const accepted = files.filter((file) => IMAGE_TYPES.includes(file.type));
    const tree = buildLogoPickerFolderTree(groupFolderFiles(accepted));
    const keys: string[] = [];
    const collect = (nodes: PickerFolderNode[]) =>
      nodes.forEach((node) => {
        if (node.group) keys.push(`dir:${node.path}`);
        collect(node.children);
      });
    collect(tree);
    setPendingFolderFiles(accepted);
    setCheckedFolderKeys(keys);
  };
  const importCheckedFolderFiles = () => {
    const next = groupFolderFiles(pendingFolderFiles).filter((group) =>
      checkedFolderKeys.includes(`dir:${group.path}`),
    );
    const selectedCount = next.reduce(
      (sum, group) => sum + group.files.length,
      0,
    );
    setGroups(next);
    setPendingFolderFiles([]);
    setCheckedFolderKeys([]);
    message.success(`已导入 ${selectedCount} 张图片，共 ${next.length} 个分组`);
  };
  const downloadableDetails = Object.values(workerTaskDetails).flatMap(
    (details) =>
      Object.values(details).filter((detail) => detail.status === "success"),
  );
  const downloadAllWorkerResults = async () => {
    if (!activeBatchId) return void message.warning("请先恢复或创建一个批次");
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      let packagedCount = 0;
      await Promise.all(
        groups.map(async (groupEntry) => {
          const workerGroupId = groupEntry.id;
          const stored = await readMultiTabGroupResults<LogoReplaceTaskDetail>(
            "logo",
            activeBatchId!,
            workerGroupId,
          );
          const details = Object.fromEntries(
            stored.map((detail) => [detail.id, detail]),
          );
          const sourceGroup = groups.find(
            (group) => group.id === workerGroupId,
          );
          const groupName =
            workerProgress[workerGroupId]?.name ||
            sourceGroup?.name ||
            "未命名分组";
          const folder = zip.folder(
            sanitizeRelativeFolderPath(sourceGroup?.path || "", groupName),
          );
          const items = Object.values(details)
            .filter((detail) => detail.resultBlob)
            .sort(
              (a, b) =>
                a.sceneIndex - b.sceneIndex || a.copyIndex - b.copyIndex,
            );
          const copiesByScene = new Map<number, number>();
          Object.values(details).forEach((detail) =>
            copiesByScene.set(
              detail.sceneIndex,
              Math.max(
                copiesByScene.get(detail.sceneIndex) || 0,
                detail.copyIndex + 1,
              ),
            ),
          );
          items.forEach((detail) => {
            packagedCount += 1;
            folder?.file(
              logoReplaceResultFileName(
                detail.originalFile?.name ||
                  `场景_${detail.sceneIndex + 1}.png`,
                detail.copyIndex,
                copiesByScene.get(detail.sceneIndex) || 1,
                detail.resultBlob?.type,
              ),
              detail.resultBlob!,
            );
          });
        }),
      );
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        `SceneStudio_多标签Logo替换全部结果_${formatFileTimestamp()}.zip`,
      );
      if (!packagedCount)
        return void message.warning("当前批次缓存中没有可下载的生成图片");
      setCachedResultCount(packagedCount);
      message.success(`已从 IndexedDB 打包 ${packagedCount} 张生成图片`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打包下载失败");
    } finally {
      setDownloadingAll(false);
    }
  };
  const downloadSelectedGroupResults = async () => {
    if (!activeBatchId || !selectedProgressGroupId)
      return void message.warning("未选择可下载的任务分组");
    const group = groups.find((item) => item.id === selectedProgressGroupId);
    if (!group) return void message.warning("未找到该分组的批次信息");
    setDownloadingGroup(true);
    try {
      const details = await readMultiTabGroupResults<LogoReplaceTaskDetail>(
        "logo",
        activeBatchId,
        selectedProgressGroupId,
      );
      const items = details
        .filter((detail) => detail.status === "success" && detail.resultBlob)
        .sort(
          (a, b) => a.sceneIndex - b.sceneIndex || a.copyIndex - b.copyIndex,
        );
      if (!items.length)
        return void message.warning("该组缓存中没有可下载的生成图片");
      const zip = new JSZip();
      const copiesByScene = new Map<number, number>();
      details.forEach((detail) =>
        copiesByScene.set(
          detail.sceneIndex,
          Math.max(
            copiesByScene.get(detail.sceneIndex) || 0,
            detail.copyIndex + 1,
          ),
        ),
      );
      items.forEach((detail) =>
        zip.file(
          logoReplaceResultFileName(
            detail.originalFile?.name || `场景_${detail.sceneIndex + 1}.png`,
            detail.copyIndex,
            copiesByScene.get(detail.sceneIndex) || 1,
            detail.resultBlob?.type,
          ),
          detail.resultBlob!,
        ),
      );
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        `${sanitizeFileName(group.name || "未命名分组")}_Logo替换结果_${formatFileTimestamp()}.zip`,
      );
      message.success(`已打包下载本组 ${items.length} 张生成图片`);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "本组图片打包失败",
      );
    } finally {
      setDownloadingGroup(false);
    }
  };
  useEffect(() => {
    if (
      !worker ||
      workerTitleState !== "completed" ||
      !workerBatch?.autoDownloadOnComplete ||
      !batchId ||
      !groupId ||
      !workerGroup ||
      autoDownloadStarted.current
    )
      return;
    const marker = `scene-studio.logo-auto-downloaded.${batchId}.${groupId}`;
    if (sessionStorage.getItem(marker)) return;
    autoDownloadStarted.current = true;
    const timer = window.setTimeout(
      () =>
        void (async () => {
          try {
            const details =
              await readMultiTabGroupResults<LogoReplaceTaskDetail>(
                "logo",
                batchId,
                groupId,
              );
            const items = details
              .filter(
                (detail) => detail.status === "success" && detail.resultBlob,
              )
              .sort(
                (a, b) =>
                  a.sceneIndex - b.sceneIndex || a.copyIndex - b.copyIndex,
              );
            if (!items.length) {
              autoDownloadStarted.current = false;
              return;
            }
            const zip = new JSZip();
            const copiesByScene = new Map<number, number>();
            details.forEach((detail) =>
              copiesByScene.set(
                detail.sceneIndex,
                Math.max(
                  copiesByScene.get(detail.sceneIndex) || 0,
                  detail.copyIndex + 1,
                ),
              ),
            );
            items.forEach((detail) =>
              zip.file(
                logoReplaceResultFileName(
                  detail.originalFile?.name ||
                    `场景_${detail.sceneIndex + 1}.png`,
                  detail.copyIndex,
                  copiesByScene.get(detail.sceneIndex) || 1,
                  detail.resultBlob?.type,
                ),
                detail.resultBlob!,
              ),
            );
            downloadBlob(
              await zip.generateAsync({ type: "blob" }),
              `${sanitizeFileName(workerGroup.name)}_Logo替换结果_${formatFileTimestamp()}.zip`,
            );
            sessionStorage.setItem(marker, "1");
            message.success(`本组已完成，自动下载 ${items.length} 张结果`);
          } catch {
            autoDownloadStarted.current = false;
            message.warning("本组自动下载失败，可在主控页手动下载");
          }
        })(),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [
    worker,
    workerTitleState,
    workerBatch?.autoDownloadOnComplete,
    batchId,
    groupId,
    workerGroup,
    message,
  ]);
  const aggregate = workerSnapshots.reduce(
    (sum, item) => ({
      total: sum.total + item.total,
      success: sum.success + item.success,
      failed: sum.failed + item.failed,
      stopped: sum.stopped + item.stopped,
      waiting: sum.waiting + item.waiting,
      running: sum.running + item.running,
      retrying: sum.retrying + item.retrying,
    }),
    {
      total: 0,
      success: 0,
      failed: 0,
      stopped: 0,
      waiting: 0,
      running: 0,
      retrying: 0,
    },
  );
  const aggregateCompleted =
    aggregate.success + aggregate.failed + aggregate.stopped;
  const aggregateProcessing =
    aggregate.waiting + aggregate.running > 0 ||
    workerSnapshots.some(
      (item) => item.status === "opening" || item.status === "running",
    );
  const allTaskDetails = Object.values(workerTaskDetails).flatMap((details) =>
    Object.values(details),
  );
  const plannedLogoRequests =
    groups.reduce((sum, group) => sum + group.files.length, 0) *
    storedLogoSettings.copiesPerScene;
  const actualLogoRequests = allTaskDetails.reduce(
    (sum, detail) =>
      sum +
      (detail.status === "waiting" && !detail.retryCount
        ? 0
        : Math.max(1, detail.verificationAttempts || 0) + detail.retryCount),
    0,
  );
  const logoCostMetrics = batchCostMetrics({
    model:
      storedLogoSettings.imageProvider === "openai"
        ? storedLogoSettings.openAiImageModel
        : storedLogoSettings.imageModel,
    size: storedLogoSettings.imageSize,
    plannedRequests: plannedLogoRequests,
    worstCaseMultiplier:
      (storedLogoSettings.strictTextVerification
        ? storedLogoSettings.verificationRetries + 1
        : 1) *
      (storedLogoSettings.autoRetryErrors
        ? storedLogoSettings.errorRetryLimit + 1
        : 1),
    actualRequests: actualLogoRequests,
  });
  const checkedLogoTasks = allTaskDetails.filter(
    (detail) =>
      detail.verificationStatus === "passed" ||
      detail.verificationStatus === "failed",
  );
  const firstPassLogoTasks = checkedLogoTasks.filter(
    (detail) =>
      detail.verificationStatus === "passed" &&
      (detail.verificationAttempts || 1) === 1 &&
      detail.retryCount === 0,
  );
  const availableLogoTasks = downloadableDetails.filter((detail) =>
    usableTaskIds.includes(detail.id),
  );
  const setLogoTaskUsable = (id: string, value: boolean) =>
    setUsableTaskIds((current) =>
      value
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  useEffect(() => {
    if (!worker || workerTitleState !== "running") return;
    const timer = window.setInterval(
      () => setTitleFlash((value) => !value),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [worker, workerTitleState]);
  useEffect(() => {
    if (!worker || !workerGroup) return;
    const light =
      workerTitleState === "completed"
        ? "🟢"
        : workerTitleState === "running"
          ? titleFlash
            ? "⚪"
            : "🟡"
          : "🟡";
    document.title = `${light} ${workerGroup.name} - Scene Studio`;
  }, [worker, workerGroup, workerTitleState, titleFlash]);
  useEffect(() => {
    if (!worker || !automationStartToken) return;
    setWorkerTitleState("running");
  }, [worker, automationStartToken]);
  useEffect(() => {
    if (
      worker ||
      !runStartedAt ||
      aggregateProcessing ||
      !aggregate.total ||
      aggregateCompleted < aggregate.total
    )
      return;
    const endedAt = Date.now();
    setRunDurationMs(endedAt - runStartedAt);
    setRunEndedAt(endedAt);
  }, [
    worker,
    runStartedAt,
    aggregateProcessing,
    aggregate.total,
    aggregateCompleted,
  ]);
  useEffect(() => {
    if (!activeBatchId) return;
    const key = `scene-studio.logo-batch-usable.${activeBatchId}`;
    const stored = localStorage.getItem(key);
    setUsableTaskIds(stored ? JSON.parse(stored) : []);
  }, [activeBatchId]);
  useEffect(() => {
    if (activeBatchId)
      localStorage.setItem(
        `scene-studio.logo-batch-usable.${activeBatchId}`,
        JSON.stringify(usableTaskIds),
      );
  }, [activeBatchId, usableTaskIds]);
  useEffect(() => {
    if (!activeBatchId || !selectedProgressGroupId) {
      setLoadedTaskDetails([]);
      return;
    }
    let cancelled = false;
    void readMultiTabGroupResults<LogoReplaceTaskDetail>(
      "logo",
      activeBatchId,
      selectedProgressGroupId,
    ).then((items) => {
      if (!cancelled)
        setLoadedTaskDetails(
          items.sort(
            (a, b) => a.sceneIndex - b.sceneIndex || a.copyIndex - b.copyIndex,
          ),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBatchId, selectedProgressGroupId, workerTaskDetails]);
  const pendingPickerTree = buildLogoPickerFolderTree(
    groupFolderFiles(pendingFolderFiles),
  );
  const pickerKeys: string[] = [];
  const collectPickerKeys = (nodes: PickerFolderNode[]) =>
    nodes.forEach((node) => {
      if (node.group) pickerKeys.push(`dir:${node.path}`);
      collectPickerKeys(node.children);
    });
  collectPickerKeys(pendingPickerTree);
  const levelEmoji = (depth: number) => `${Math.min(depth + 1, 9)}\uFE0F\u20E3`;
  const togglePickerFolder = (key: string) =>
    setCheckedFolderKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  const renderPickerTree = (
    nodes: PickerFolderNode[],
    depth = 0,
  ): React.ReactNode => (
    <Collapse
      size="small"
      bordered={false}
      defaultActiveKey={nodes.map((node) => node.path)}
      items={nodes.map((node) => {
        const key = `dir:${node.path}`;
        const checked = checkedFolderKeys.includes(key);
        return {
          key: node.path,
          label: (
            <Flex align="center" gap={8}>
              <span aria-label={`第 ${depth + 1} 层`}>{levelEmoji(depth)}</span>
              <FolderOpenOutlined />
              <Text strong={Boolean(node.group)}>{node.name}</Text>
              {node.group && <Tag>{node.group.files.length} 张</Tag>}
            </Flex>
          ),
          children: (
            <>
              <>
                {node.group && (
                  <Card
                    size="small"
                    hoverable
                    className={
                      checked
                        ? "scene-leaf-folder-card is-selected"
                        : "scene-leaf-folder-card"
                    }
                    onClick={() => togglePickerFolder(key)}
                  >
                    <Checkbox
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => togglePickerFolder(key)}
                    >
                      导入此文件夹
                    </Checkbox>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Image.PreviewGroup>
                        <Flex
                          gap={4}
                          wrap
                          className="scene-folder-mini-thumbnails"
                        >
                          {node.group.files.slice(0, 12).map((file, index) => (
                            <FileThumbnail
                              key={`${file.name}-${index}`}
                              file={file}
                            />
                          ))}
                        </Flex>
                      </Image.PreviewGroup>
                    </div>
                    {node.group.files.length > 12 && (
                      <Text type="secondary">
                        另有 {node.group.files.length - 12} 张
                      </Text>
                    )}
                  </Card>
                )}
              </>
              {node.children.length
                ? renderPickerTree(node.children, depth + 1)
                : null}
            </>
          ),
        };
      })}
    />
  );
  useEffect(() => {
    if (worker) return;
    reportTaskProgress({
      id: "multi-tab-logo-replace",
      label: "多标签 Logo 替换",
      completed: aggregateCompleted,
      total: aggregate.total,
      failed: aggregate.failed,
      running: aggregateProcessing,
    });
  }, [
    worker,
    aggregateCompleted,
    aggregate.total,
    aggregate.failed,
    aggregateProcessing,
  ]);

  if (worker)
    return (
      <div ref={rootRef}>
        <Alert
          type={injected ? "success" : "info"}
          showIcon
          title={
            workerGroup ? `工作标签：${workerGroup.name}` : "正在加载分组任务"
          }
          description={
            workerGroup
              ? `${workerGroup.path} · ${workerGroup.files.length} 张场景图 · 公共新 Logo ${workerBatch?.logos.length || 0} 个 · 旧 Logo 参考${workerBatch?.oldLogo ? "已导入" : "未提供"}${injected ? "，素材已自动导入" : "，正在自动导入…"}`
              : "正在从批次中读取图片，请保留主控标签页。"
          }
          style={{ marginBottom: 16 }}
        />
        {workerBatch && workerGroup && (
          <LogoReplaceComposer
            {...props}
            initialSceneFiles={workerGroup.files}
            initialNewLogoFiles={workerBatch.logos}
            initialOldLogoFile={workerBatch.oldLogo ?? null}
            initialMultiLogoModeEnabled={workerBatch.multiLogoModeEnabled}
            initialDistinctLogoPerOccurrence={
              workerBatch.distinctLogoPerOccurrence
            }
            initialPerImagePrompts={workerBatch.perImagePrompts}
            onPerImagePromptsChange={(items) => {
              void readBatch(workerBatch.id).then((latest) =>
                saveBatch({
                  ...(latest || workerBatch),
                  perImagePrompts: {
                    ...(latest?.perImagePrompts || {}),
                    ...items,
                  },
                }),
              );
            }}
            automationStartToken={automationStartToken}
            automationRetryFailedToken={automationRetryFailedToken}
            onTaskDetailChange={(detail) => {
              if (!channel || !batchId || !groupId) return;
              const {
                resultBlob: _resultBlob,
                originalFile: _originalFile,
                ...summary
              } = detail;
              const publish = () =>
                channel.postMessage({
                  type: "worker-task",
                  batchId,
                  groupId,
                  detail: summary,
                });
              if (
                detail.resultBlob ||
                detail.status === "failed" ||
                detail.status === "stopped"
              )
                void putMultiTabResult(
                  "logo",
                  batchId,
                  groupId,
                  detail.id,
                  detail,
                ).finally(publish);
              else publish();
            }}
            onProgressChange={(progress) => {
              if (!channel || !batchId || !groupId) return;
              const status =
                progress.total > 0 &&
                progress.success + progress.failed + progress.stopped >=
                  progress.total
                  ? "completed"
                  : progress.waiting + progress.running > 0
                    ? "running"
                    : "ready";
              setWorkerTitleState(
                status === "completed"
                  ? "completed"
                  : progress.running > 0
                    ? "running"
                    : "queued",
              );
              channel.postMessage({
                type: "worker-progress",
                batchId,
                groupId,
                progress: {
                  ...progress,
                  groupId,
                  name: workerGroup.name,
                  status,
                  updatedAt: Date.now(),
                },
              });
            }}
          />
        )}
      </div>
    );

  return (
    <div className="multi-tab-logo-page">
      <section className="hero-strip logo-replace-hero">
        <div>
          <Text className="eyebrow">MULTI-TAB LOGO REPLACER</Text>
          <Title level={2}>一个主控页，分发多组 Logo 替换任务</Title>
          <Paragraph className="hero-description">
            一次选择场景根文件夹和公共
            Logo，每个最深层子目录自动分配到独立标签页；工作页完整使用现有 Logo
            替换功能。
          </Paragraph>
        </div>
        <div className="hero-orb" />
      </section>
      <Card
        className="workflow-card"
        title="1. 选择场景根文件夹"
      >
        <Flex justify="flex-end" style={{ marginBottom: 12 }}>
          <Popconfirm
            title="移除全部文件夹？"
            description="只清空当前批次中的文件夹，不会删除电脑中的原文件。"
            disabled={!groups.length}
            onConfirm={() => void removeAllGroups()}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!groups.length}>
              移除全部文件夹
            </Button>
          </Popconfirm>
        </Flex>
        <Upload.Dragger
          directory
          multiple
          showUploadList={false}
          accept="image/png,image/jpeg,image/webp"
          beforeUpload={(file, fileList) => {
            if (file.uid === fileList.at(-1)?.uid)
              reviewFolderFiles(fileList as File[]);
            return Upload.LIST_IGNORE;
          }}
        >
          <FolderOpenOutlined style={{ fontSize: 34, color: "#7654dd" }} />
          <p className="ant-upload-text">拖拽或点击选择场景根文件夹</p>
          <p className="ant-upload-hint">
            支持“测试图片/AM058/AM058”这类两层目录，按最深层图片目录自动分组
          </p>
        </Upload.Dragger>
        {groups.length ? (
          <div className="folder-group-grid">
            {groups.map((group) => (
              <Card
                key={group.id}
                size="small"
                hoverable
                className="folder-manage-card"
                onClick={() => setSelectedGroupId(group.id)}
              >
                <FolderOpenOutlined /> <Text strong>{group.name}</Text>
                <br />
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
                      setSelectedGroupId(group.id);
                    }}
                  >
                    查看和管理图片
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<RocketOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      void openSingleWorker(group);
                    }}
                  >
                    单独打开标签
                  </Button>
                  <Popconfirm
                    title={`移除分组 ${group.name}？`}
                    description="只从当前批次移除，不会删除电脑中的文件。"
                    onConfirm={() => removeGroup(group)}
                  >
                    <Button
                      danger
                      type="link"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    >
                      移除分组
                    </Button>
                  </Popconfirm>
                </Flex>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="选择文件夹后显示分组"
          />
        )}
      </Card>
      <Card
        className="workflow-card"
        title="2. 上传所有标签共用的新 Logo 与旧 Logo 参考"
        extra={<Text type="secondary">{logos.length} 个</Text>}
      >
        <Flex justify="flex-end" style={{ marginBottom: 12 }}>
          <Popconfirm
            title="移除全部 Logo？"
            description="将同时清空公共新 Logo 和旧 Logo 参考图，不会删除电脑中的原文件。"
            disabled={!logos.length && !oldLogo}
            onConfirm={() => void removeAllLogos()}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!logos.length && !oldLogo}
            >
              移除全部 Logo
            </Button>
          </Popconfirm>
        </Flex>
        <Upload.Dragger
          multiple
          showUploadList={false}
          accept="image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop"
          beforeUpload={(file) => {
            const next = file as File;
            if (
              next.name.toLowerCase().endsWith(".psd") ||
              next.type === "image/vnd.adobe.photoshop"
            )
              setPendingPsdFile(next);
            else setLogos((current) => [...current, next]);
            return false;
          }}
        >
          <FileImageOutlined style={{ fontSize: 30 }} />
          <p>拖拽或选择公共 Logo / PSD</p>
        </Upload.Dragger>
        {logos.length ? (
          <Image.PreviewGroup>
            <div className="batch-asset-grid">
              {logos.map((logo, index) => (
                <FileThumbnail
                  key={`${logo.name}-${logo.size}-${logo.lastModified}-${index}`}
                  file={logo}
                  onRemove={() =>
                    setLogos((current) =>
                      current.filter((item) => item !== logo),
                    )
                  }
                />
              ))}
              <Upload
                multiple
                showUploadList={false}
                accept="image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop"
                beforeUpload={(file) => {
                  const next = file as File;
                  if (
                    next.name.toLowerCase().endsWith(".psd") ||
                    next.type === "image/vnd.adobe.photoshop"
                  )
                    setPendingPsdFile(next);
                  else setLogos((current) => [...current, next]);
                  return false;
                }}
              >
                <button type="button" className="batch-asset-add">
                  <PlusOutlined />
                  <span>继续添加 Logo</span>
                </button>
              </Upload>
            </div>
          </Image.PreviewGroup>
        ) : null}
        <Card
          size="small"
          title="旧 Logo 参考（选填，所有子标签共用）"
          style={{ marginTop: 16 }}
          extra={oldLogo ? <Tag color="success">已启用识别参考</Tag> : null}
        >
          <Text type="secondary">
            用于帮助模型准确定位场景中需要被替换的旧标识；只上传一张参考图，不会作为新 Logo 使用。
          </Text>
          <div style={{ marginTop: 12 }}>
            {oldLogo ? (
              <div className="batch-asset-grid">
                <FileThumbnail file={oldLogo} onRemove={() => setOldLogo(undefined)} />
                <Upload
                  showUploadList={false}
                  accept="image/png,image/jpeg,image/webp"
                  beforeUpload={(file) => {
                    setOldLogo(file as File);
                    return false;
                  }}
                >
                  <button type="button" className="batch-asset-add">
                    <ReloadOutlined />
                    <span>替换参考图</span>
                  </button>
                </Upload>
              </div>
            ) : (
              <Upload.Dragger
                showUploadList={false}
                accept="image/png,image/jpeg,image/webp"
                beforeUpload={(file) => {
                  setOldLogo(file as File);
                  return false;
                }}
              >
                <FileImageOutlined style={{ fontSize: 30 }} />
                <p>拖拽或选择旧 Logo 参考图</p>
                <p className="ant-upload-hint">PNG / JPEG / WebP</p>
              </Upload.Dragger>
            )}
          </div>
        </Card>
        {activeBatchId && (
          <Button
            style={{ marginTop: 12 }}
            icon={<SyncOutlined />}
            onClick={() => void syncLogos()}
          >
            同步新 Logo 与旧 Logo 参考到已打开标签
          </Button>
        )}
      </Card>
      <Card className="workflow-card" title="Logo 分配模式">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <div>
            <Text strong>原图多个相同 Logo，随机匹配不同 Logo</Text>
            <br />
            <Text type="secondary">
              每张场景独立识别实际 Logo 位置数；先用完尽可能多的不同
              Logo，不足时再随机重复，多余 Logo 不使用。
            </Text>
          </div>
          <Switch
            checked={distinctLogoPerOccurrence}
            onChange={setDistinctLogoPerOccurrence}
          />
        </Flex>
      </Card>
      <Card className="action-card">
        <Flex justify="space-between" align="center" wrap gap={12}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              准备分发 {groups.length} 组任务
            </Title>
            <Text type="secondary">
              自动按当前 {groups.length} 个分组打开全部标签，不限制个数；Web
              Locks 将所有标签的 AI 请求合计限制在 {globalConcurrency} 个
            </Text>
          </div>
          <Space wrap>
            <Text>全局并发</Text>
            <InputNumber
              min={1}
              max={12}
              value={globalConcurrency}
              onChange={(value) => setGlobalConcurrency(value || 1)}
            />
            <Button
              size="large"
              icon={<RocketOutlined />}
              onClick={() => void openWorkers()}
            >
              保存批次并打开全部标签
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              disabled={!activeBatchId}
              onClick={() => void startAllWorkers()}
            >
              一键开始所有替换
            </Button>
            {aggregate.failed > 0 && (
              <Button icon={<ReloadOutlined />} onClick={retryAllFailedWorkers}>
                一键重试所有失败
              </Button>
            )}
            {aggregateProcessing && (
              <Button
                danger
                size="large"
                icon={<StopOutlined />}
                onClick={stopAllWorkers}
              >
                停止全部
              </Button>
            )}
            <Button disabled={!activeBatchId} onClick={disableCloseWarnings}>
              解除全部标签关闭提醒
            </Button>
          </Space>
        </Flex>
      </Card>
      <Card className="workflow-card" title="自动下载">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <div>
            <Text strong>每个子标签完成后自动下载本组 ZIP</Text>
            <br />
            <Text type="secondary">
              浏览器首次可能要求允许多个文件自动下载；每个标签仅触发一次。
            </Text>
          </div>
          <Switch
            checked={autoDownloadOnComplete}
            onChange={setAutoDownloadOnComplete}
          />
        </Flex>
      </Card>
      <Card
        className="workflow-card"
        title="IndexedDB 缓存结果"
        extra={
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={restoringCache}
              onClick={() => void restoreCachedBatch(activeBatchId)}
            >
              从缓存恢复结果
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloadingAll}
              disabled={!activeBatchId}
              onClick={() => void downloadAllWorkerResults()}
            >
              强制下载缓存 ZIP
              {cachedResultCount ? `（${cachedResultCount}）` : ""}
            </Button>
          </Space>
        }
      >
        <Text type="secondary">
          子标签刷新后结果区可能清空，但已完成图片仍保存在浏览器
          IndexedDB。这里会直接扫描缓存，不依赖子标签当前内存状态。
        </Text>
      </Card>
      {!!workerSnapshots.length && (
        <Card
          className="workflow-card"
          title="批次任务进度"
          extra={
            <Space wrap>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadingAll}
                disabled={!activeBatchId}
                onClick={() => void downloadAllWorkerResults()}
              >
                一键下载全部生成图片（
                {Math.max(cachedResultCount, downloadableDetails.length)}）
              </Button>
              <Tag
                color={
                  aggregate.failed
                    ? "error"
                    : aggregateProcessing
                      ? "processing"
                      : aggregate.total && aggregate.success === aggregate.total
                        ? "success"
                        : "default"
                }
              >
                {aggregate.failed
                  ? "存在最终失败"
                  : aggregateProcessing
                    ? "执行中"
                    : aggregate.total
                      ? "已完成"
                      : "等待开始"}
              </Tag>
            </Space>
          }
        >
          <Flex gap={28} wrap>
            <Statistic
              title="工作标签"
              value={workerSnapshots.length}
              suffix={` / 就绪 ${workerSnapshots.filter((item) => item.status !== "opening").length}`}
            />
            <Statistic title="任务总数" value={aggregate.total} />
            <Statistic
              title="成功"
              value={aggregate.success}
              valueStyle={{ color: "#389e0d" }}
            />
            <Statistic
              title="自动重试中"
              value={aggregate.retrying}
              valueStyle={{ color: "#d48806" }}
            />
            <Statistic
              title="最终失败"
              value={aggregate.failed}
              valueStyle={{ color: aggregate.failed ? "#cf1322" : undefined }}
            />
            <Statistic title="已停止" value={aggregate.stopped} />
            {runDurationMs !== undefined && (
              <Statistic
                title="本次执行耗时"
                value={formatBatchDuration(runDurationMs)}
              />
            )}
          </Flex>
          <Flex gap={28} wrap style={{ marginTop: 16 }}>
            <Statistic
              title="预计最低金额"
              prefix="$"
              precision={3}
              value={logoCostMetrics.estimatedMinimum}
            />
            <Statistic
              title="预计最差金额"
              prefix="$"
              precision={3}
              value={logoCostMetrics.estimatedWorst}
            />
            <Statistic
              title="实际消费金额（实时预估）"
              prefix="$"
              precision={3}
              value={logoCostMetrics.actual}
            />
            <Statistic
              title="已发生生图请求"
              suffix=" 次"
              value={actualLogoRequests}
            />
            <Statistic
              title="开始计时时间"
              value={formatBatchDateTime(runStartedAt)}
            />
            <Statistic
              title="结束计时时间"
              value={formatBatchDateTime(runEndedAt)}
            />
            <Statistic
              title="一次检测成功率"
              suffix="%"
              precision={1}
              value={percentage(
                firstPassLogoTasks.length,
                checkedLogoTasks.length,
              )}
            />
            <Statistic
              title="可用率（手动标记）"
              suffix="%"
              precision={1}
              value={percentage(
                availableLogoTasks.length,
                downloadableDetails.length,
              )}
            />
          </Flex>
          <Text type="secondary">
            未开始的任务不计入实际消费；当前只按已经发出的生图、校验重绘和接口重试请求实时估算，全部结束后即为本批次最终预估值。语言模型文本
            Token 费用另计；可用率请在任务缩略图弹窗中逐张标记。
          </Text>
          <Progress
            style={{ margin: "18px 0" }}
            percent={
              aggregate.total
                ? Math.round((aggregateCompleted / aggregate.total) * 100)
                : 0
            }
            status={
              aggregate.failed
                ? "exception"
                : aggregateProcessing
                  ? "active"
                  : aggregate.total
                    ? "success"
                    : "normal"
            }
          />
          <div className="folder-group-grid">
            {workerSnapshots.map((item) => (
              <Card
                key={item.groupId}
                size="small"
                hoverable
                className="batch-progress-card"
                onClick={() => setSelectedProgressGroupId(item.groupId)}
                title={item.name}
                extra={
                  <Tag
                    color={
                      item.status === "completed" && !item.failed
                        ? "success"
                        : item.failed
                          ? "error"
                          : item.status === "running"
                            ? "processing"
                            : "default"
                    }
                  >
                    {item.status === "opening"
                      ? "打开中"
                      : item.status === "ready"
                        ? "已就绪"
                        : item.status === "running"
                          ? "执行中"
                          : "已完成"}
                  </Tag>
                }
              >
                <Text>
                  成功 {item.success}/{item.total || "—"}
                </Text>
                <br />
                <Text type="secondary">
                  运行 {item.running} · 等待 {item.waiting} · 重试{" "}
                  {item.retrying} · 失败 {item.failed} · 停止 {item.stopped}
                </Text>
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  style={{ display: "block", paddingInline: 0 }}
                >
                  查看任务缩略图（
                  {Object.keys(workerTaskDetails[item.groupId] || {}).length}）
                </Button>
              </Card>
            ))}
          </div>
        </Card>
      )}
      <Alert
        type="info"
        showIcon
        title="公共 Logo 采用批次锁定"
        description="工作标签从 IndexedDB 读取同一组新 Logo 和旧 Logo 参考图；更新后可广播同步。为避免运行中的校验基准变化，运行期间不建议替换参考素材。"
      />
      <Modal
        title="选择要导入的场景文件夹"
        open={pendingFolderFiles.length > 0}
        width={980}
        okText={`导入已选 ${checkedFolderKeys.length} 个目录`}
        cancelText="取消"
        okButtonProps={{ disabled: !checkedFolderKeys.length }}
        onOk={importCheckedFolderFiles}
        onCancel={() => {
          setPendingFolderFiles([]);
          setCheckedFolderKeys([]);
        }}
      >
        <Alert
          type="info"
          showIcon
          title="保留完整目录结构，仅选择最深层图片文件夹"
          description="父级目录只展示结构；叶子目录可以通过复选框或点击整张卡片选择。"
          style={{ marginBottom: 14 }}
        />
        <Flex
          justify="space-between"
          align="center"
          style={{ marginBottom: 12 }}
        >
          <Text type="secondary">
            已选择 {checkedFolderKeys.length} / {pickerKeys.length} 个最深层目录
          </Text>
          <Space>
            <Button
              size="small"
              onClick={() => setCheckedFolderKeys(pickerKeys)}
            >
              全选
            </Button>
            <Button size="small" onClick={() => setCheckedFolderKeys([])}>
              取消全选
            </Button>
          </Space>
        </Flex>
        <div
          className="scene-folder-picker-tree"
          style={{ maxHeight: "58vh", overflowY: "auto", paddingRight: 8 }}
        >
          {renderPickerTree(pendingPickerTree)}
        </div>
      </Modal>
      <Modal
        title={selectedGroup ? `${selectedGroup.name} · 图片管理` : "图片管理"}
        open={Boolean(selectedGroup)}
        width={900}
        footer={
          <Button onClick={() => setSelectedGroupId(undefined)}>完成</Button>
        }
        onCancel={() => setSelectedGroupId(undefined)}
      >
        {selectedGroup && (
          <>
            <Flex
              justify="space-between"
              align="center"
              gap={12}
              wrap
              style={{ marginBottom: 14 }}
            >
              <Text type="secondary">
                {selectedGroup.path} · 当前 {selectedGroup.files.length}{" "}
                张；增删只影响当前网页批次。
              </Text>
              <Upload
                multiple
                showUploadList={false}
                accept="image/png,image/jpeg,image/webp"
                beforeUpload={(file) =>
                  addGroupFile(selectedGroup.id, file as File)
                }
              >
                <Button type="primary" icon={<PlusOutlined />}>
                  添加图片到该文件夹
                </Button>
              </Upload>
            </Flex>
            <Image.PreviewGroup>
              <div className="batch-asset-grid">
                {selectedGroup.files.map((file, index) => (
                  <FileThumbnail
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() => removeGroupFile(selectedGroup.id, file)}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          </>
        )}
      </Modal>
      <Modal
        destroyOnHidden
        title={
          selectedProgressWorker
            ? `${selectedProgressWorker.name} · 任务结果`
            : "任务结果"
        }
        open={Boolean(selectedProgressWorker)}
        width={1100}
        footer={
          <Space>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloadingGroup}
              onClick={() => void downloadSelectedGroupResults()}
            >
              一键下载本组图片
            </Button>
            <Button onClick={() => setSelectedProgressGroupId(undefined)}>
              完成
            </Button>
          </Space>
        }
        onCancel={() => setSelectedProgressGroupId(undefined)}
      >
        {selectedProgressWorker && (
          <Alert
            type={
              selectedProgressWorker.failed
                ? "warning"
                : selectedProgressWorker.status === "running"
                  ? "info"
                  : "success"
            }
            showIcon
            title={`成功 ${selectedProgressWorker.success}/${selectedProgressWorker.total || "—"} · 运行 ${selectedProgressWorker.running} · 等待 ${selectedProgressWorker.waiting} · 失败 ${selectedProgressWorker.failed}`}
            description="点击缩略图可放大；缩略图下方和放大工具栏都可以切换查看原图。"
            style={{ marginBottom: 16 }}
          />
        )}
        {selectedTaskDetails.length ? (
          <TaskResultGallery
            details={selectedTaskDetails}
            usableIds={usableTaskIds}
            onUsableChange={setLogoTaskUsable}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="任务开始后，这里会实时显示每张图片的状态和生成结果"
          />
        )}
      </Modal>
      <Card className="workflow-card" title="逐图提示词分配">
        <Flex justify="space-between" align="center">
          <Text strong>生成前逐图分析</Text>
          <Switch
            checked={perImagePromptEnabled}
            onChange={setPerImagePromptEnabled}
          />
        </Flex>
        {perImagePromptEnabled && (
          <>
            <Flex
              justify="space-between"
              align="center"
              style={{ marginTop: 12 }}
            >
              <Text>由子标签分析并自动生成</Text>
              <Switch
                checked={autoGenerateAfterPromptAnalysis}
                onChange={setAutoGenerateAfterPromptAnalysis}
              />
            </Flex>
            {autoGenerateAfterPromptAnalysis ? (
              <Alert
                style={{ marginTop: 12 }}
                type="info"
                showIcon
                title="主控页不再分析或显示审核列表"
                description="打开工作标签后，点击一键开始所有替换；每个子标签只分析自己的图片，分析成功后自动进入生成，不占用主控页的分析资源。"
              />
            ) : (
              <>
                <Button
                  style={{ marginBlock: 12 }}
                  icon={<ReloadOutlined />}
                  onClick={() => void perImagePrompts.analyze()}
                >
                  分析全部 / 重试失败
                </Button>
                <div className="per-image-prompt-grid">
                  {groups.flatMap((group) =>
                    group.files.map((file) => (
                      <Card
                        size="small"
                        key={`${group.id}-${perImagePromptFileKey(file)}`}
                        title={`${group.name} · ${file.name}`}
                      >
                        <PerImagePromptEditor
                          file={file}
                          assignment={
                            perImagePrompts.assignments[
                              perImagePromptFileKey(file)
                            ]
                          }
                          sourcePrompt={logoPromptSource}
                          onEdit={(value) => perImagePrompts.edit(file, value)}
                          onAnalyze={() => void perImagePrompts.analyze([file])}
                        />
                      </Card>
                    )),
                  )}
                </div>
              </>
            )}
          </>
        )}
      </Card>
      <PsdLogoImportModal
        file={pendingPsdFile}
        onClose={() => setPendingPsdFile(undefined)}
        onImport={(files) => {
          setLogos((current) => [...current, ...files]);
          message.success(`已加入 ${files.length} 个 PSD Logo 图层`);
        }}
      />
      <Modal
        title="部分工作标签被浏览器拦截"
        open={blockedWorkerUrls.length > 0}
        footer={<Button onClick={() => setBlockedWorkerUrls([])}>关闭</Button>}
        onCancel={() => setBlockedWorkerUrls([])}
      >
        <Alert
          type="warning"
          showIcon
          title="请允许本站弹出窗口，或点击下方按钮逐个打开"
          description="这是浏览器的多弹窗安全限制；批次已经保存，不需要重新选择文件夹和 Logo。"
          style={{ marginBottom: 14 }}
        />
        <Flex vertical gap={8}>
          {blockedWorkerUrls.map((target) => (
            <Button
              key={target.url}
              icon={<RocketOutlined />}
              onClick={() => {
                const opened = window.open(target.url, "_blank");
                if (opened)
                  setBlockedWorkerUrls((current) =>
                    current.filter((item) => item.url !== target.url),
                  );
              }}
            >
              {target.name} · 打开工作标签
            </Button>
          ))}
        </Flex>
      </Modal>
    </div>
  );
}
