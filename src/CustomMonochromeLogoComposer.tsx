import BatchEngravingComposer from "./components/BatchEngravingComposer";
import * as taskStorage from "./services/engraving/storage";
import { OPENAI_ROOT } from "./services/openAiEndpoint";
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
} from "react";
import {
  Alert,
  Divider,
  Flex,
  Form,
  Button,
  Card,
  Image,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Tag,
  Upload,
} from "antd";
import {
  DownloadOutlined,
  UploadOutlined,
  FileImageOutlined,
} from "@ant-design/icons";
import { DEFAULTS, validateOptions } from "./services/engraving/processing.mjs";
import { runAutoTune } from "./services/engraving/auto-tune.mjs";
import { createEngravingApi, apiBase } from "./services/engraving/api";
import {
  loadPreferences,
  savePreferences,
  loadTask,
  saveTask,
  startNewTask,
  listTaskHistory,
  copyHistoryTask,
  type TaskHistoryEntry,
} from "./services/engraving/storage";
import { processInWorker } from "./services/engraving/workerClient";
import type {
  AutoRun,
  ImageJob,
  Preferences,
  SavedTask,
} from "./services/engraving/types";
import EngravingGallery from "./components/EngravingGallery";
import {
  taskResults,
  mergeReviews,
  changeResultParams,
  clearTaskResults,
} from "./services/engraving/results";
import { buildPrompt } from "./services/engraving/prompts.mjs";
import "./custom-monochrome-logo.css";

function useBlobUrl(blob?: Blob) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) {
      setValue(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function PreviewImage({ blob, title }: { blob?: Blob; title: string }) {
  const url = useBlobUrl(blob);
  return (
    <div className="engraving-image">
      <strong>{title}</strong>
      {url ? (
        <Image
          src={url}
          alt={title}
          preview={{
            actionsRender: (original) => (
              <>
                {original}
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => blob && download(blob, `${title}.png`)}
                >
                  下载
                </Button>
              </>
            ),
          }}
        />
      ) : (
        <div className="engraving-empty">
          {title === "原照" ? "上传客户照片后开始制作" : "生成结果将在此显示"}
        </div>
      )}
    </div>
  );
}
export function EngravingTaskComposer({
  openAiApiKey,
  onConfigureKey,
  settingsHost,
  scope,
  embedded = false,
  initialFile,
  onTaskState,
  controllerRef,
  batchLocked = false,
  workspaceActive = true,
}: {
  openAiApiKey: string;
  onConfigureKey: () => void;
  settingsHost?: HTMLElement | null;
  scope?: string;
  embedded?: boolean;
  initialFile?: File;
  batchLocked?: boolean;
  workspaceActive?: boolean;
  controllerRef?: React.Ref<{ start: () => Promise<void>; stop: () => void; flush: () => Promise<void> }>;
  onTaskState?: (state: {
    task: SavedTask;
    busy: boolean;
    ready: boolean;
    loaded: boolean; importing: boolean;
  }) => void;
}) {
  const store = useMemo(
    () =>
      scope
        ? taskStorage.getTaskStorage(scope)
        : {
            loadPreferences,
            savePreferences,
            loadTask,
            saveTask,
            startNewTask,
            listTaskHistory,
            copyHistoryTask,
          },
    [scope],
  );
  const {
    loadPreferences: readPreferences,
    savePreferences: writePreferences,
    loadTask: readTask,
    saveTask: writeTask,
    startNewTask: newTask,
    listTaskHistory: readHistory,
    copyHistoryTask: copyTask,
  } = store;
  const [preferences, setPreferences] = useState(readPreferences);
  const [task, setTask] = useState<SavedTask>({
    version: 1,
    fileName: "",
    params: { ...DEFAULTS },
  });
  const taskRef = useRef(task),
    stop = useRef(false),
    active = useRef(false);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [error, setError] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [notice, setNotice] = useState("");
  const [additionalOpen, setAdditionalOpen] = useState(false),
    [additionalPrompt, setAdditionalPrompt] = useState(""),
    [now, setNow] = useState(Date.now());
  const [clearOpen, setClearOpen] = useState(false),
    [clearing, setClearing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  async function openHistory() {
    setHistoryBusy(true);
    try {
      await writeTask(taskRef.current);
      setHistory(await readHistory());
      setHistoryOpen(true);
    } catch {
      setStorageWarning("无法读取任务历史，请先下载当前结果。");
    } finally {
      setHistoryBusy(false);
    }
  }
  async function restoreHistory(id: string) {
    if (active.current) return;
    setHistoryBusy(true);
    try {
      await writeTask(taskRef.current);
      const saved = await copyTask(id);
      updateTask({ ...saved, results: taskResults(saved) });
      setHistoryOpen(false);
      setError("");
      setNotice("已恢复为本标签的独立副本，不影响其他标签；不会自动生成。");
    } catch {
      setStorageWarning("恢复历史失败，请保留当前页面并先下载结果。");
    } finally {
      setHistoryBusy(false);
    }
  }
  const referenceControlsVisible = false;
  const customReferenceUrl = useBlobUrl(task.customReference);
  function updateTask(next: SavedTask) {
    taskRef.current = next;
    setTask(next);
  }
  async function persist(next: SavedTask) {
    updateTask(next);
    try {
      await writeTask(next);
    } catch {
      setStorageWarning(
        "本地保存失败（可能存储空间不足或浏览器禁止存储）。当前结果仍在内存，请及时下载；刷新可能丢失。",
      );
    }
  }
  useEffect(() => {
    let disposed = false;
    readTask()
      .then((saved) => {
        if (!disposed && saved)
          updateTask({ ...saved, results: taskResults(saved) });
      })
      .catch(() => {
        if (!disposed)
          setStorageWarning("无法恢复本地任务，请检查浏览器 IndexedDB 权限。");
      })
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    try {
      writePreferences(preferences);
    } catch {
      setStorageWarning("设置无法写入本地存储。");
    }
  }, [preferences]);
  useEffect(() => {
    if (!loaded || clearing || uploading || historyBusy) return;
    const timer = setTimeout(() => {
      void writeTask(task).catch(() =>
        setStorageWarning("本地任务保存失败，请先下载结果。"),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [task, loaded, busy, clearing, uploading, historyBusy]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const patchPreferences = (patch: Partial<Preferences>) =>
    setPreferences((previous) => ({ ...previous, ...patch }));
  async function upload(file: File) {
    if (active.current || uploading || !loaded) return;
    setUploading(true);
    setError("");
    try {
      const result = await processInWorker(file, undefined, undefined, true);
      await writeTask(taskRef.current);
      await newTask();
      await persist({
        version: 1,
        original: result.buffer,
        customReference: taskRef.current.customReference,
        fileName: file.name,
        params: {
          ...taskRef.current.params,
          dpi: DEFAULTS.dpi,
          margin: DEFAULTS.margin,
          eraseMask: undefined,
          crop: null,
        },
      });
      setNotice(result.warnings.join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }
  async function startGeneration(additional?: string) {
    if (active.current || !taskRef.current.original) return;
    if (!openAiApiKey.trim()) {
      onConfigureKey();
      return;
    }
    try {
      validateOptions(taskRef.current.params);
      apiBase(OPENAI_ROOT);
      if (!preferences.imageModel.trim() || !preferences.reviewModel.trim())
        throw new Error("请填写图像模型和审核模型。");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    active.current = true;
    stop.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    const snapshot = {
        ...preferences,
        auto: additional === undefined && preferences.auto,
      },
      initial = {
        ...taskRef.current,
        params: {
          ...taskRef.current.params,
          dpi: DEFAULTS.dpi,
          margin: DEFAULTS.margin,
        },
      },
      original = initial.original!;
    const config = { ...snapshot, baseUrl: OPENAI_ROOT, apiKey: openAiApiKey };
    let run: AutoRun = {
      status: "running",
      phase: "准备风格参考",
      maxRounds: snapshot.auto ? snapshot.maxRounds : 1,
      targetScore: snapshot.targetScore,
      generations: 0,
      checks: 0,
      rounds: [],
      best: null,
      fallback: null,
    };
    await persist({
      ...initial,
      startedAt: Date.now(),
      endedAt: undefined,
      run,
    });
    const publish = async (next: AutoRun) => {
      run = next;
      await persist({
        ...taskRef.current,
        run: next,
        results: mergeReviews(taskResults(taskRef.current), next),
      });
    };
    try {
      let reference = referenceControlsVisible
        ? initial.customReference
        : undefined;
      if (!reference) {
        const response = await fetch(
          `${import.meta.env.BASE_URL}engraving-references/${referenceControlsVisible ? snapshot.reference : "portrait"}-reference.jpg`,
        );
        if (!response.ok) throw new Error("风格参考加载失败");
        reference = (await processInWorker(await response.blob())).buffer;
      }
      const usedReference = reference;
      let lastPrompt = "";
      const api = createEngravingApi();
      const generate: typeof api.generate = async (input) => {
        lastPrompt = buildPrompt({
          ...input,
          editMode: input.editMode || input.outpaint?.enabled,
          hasReference: true,
        });
        return api.generate(input);
      };
      const saveCandidate = async (
        blob: Blob,
        warnings: string[],
      ): Promise<ImageJob> => {
        const image = await createImageBitmap(blob);
        const job = {
          id: crypto.randomUUID(),
          blob,
          width: image.width,
          height: image.height,
          warnings,
        };
        image.close();
        await persist({
          ...taskRef.current,
          job,
          results: [
            ...taskResults(taskRef.current),
            {
              job,
              params: { ...initial.params, eraseMask: undefined, crop: null },
              initialParams: {
                ...initial.params,
                eraseMask: undefined,
                crop: null,
              },
              reviews: [],
              createdAt: Date.now(),
              reference: usedReference,
              prompt: lastPrompt,
            },
          ],
          params: { ...initial.params, eraseMask: undefined, crop: null },
        });
        return job;
      };
      if (stop.current)
        run = { ...run, status: "cancelled", phase: "已停止，未提交生成请求" };
      else if (snapshot.auto)
        run = await runAutoTune({
          original,
          reference,
          config,
          subject: snapshot.subject,
          instructions: snapshot.instructions,
          style: snapshot.style,
          outpaint: snapshot.outpaint,
          params: initial.params,
          options: snapshot,
          ...api,
          generate,
          render: (source, params) => processInWorker(source, params),
          saveCandidate,
          publish,
          cancelled: () => stop.current,
        });
      else {
        await publish({ ...run, phase: "正在生成图片", generations: 1 });
        const result = await generate({
          image: original,
          referenceImage: reference,
          config,
          subject: snapshot.subject,
          instructions: snapshot.instructions,
          style: snapshot.style,
          outpaint: snapshot.outpaint,
          feedback: additional,
        });
        const job = await saveCandidate(result.buffer, result.warnings);
        run = {
          ...run,
          status: stop.current ? "cancelled" : "completed",
          phase: stop.current
            ? "已停止，已返回图片已保存"
            : "生成完成，请人工检查",
          fallback: {
            job,
            params: { ...initial.params, eraseMask: undefined, crop: null },
            round: 1,
          },
        };
      }
    } catch (e) {
      run = {
        ...run,
        status: "failed",
        phase: "已停止后续步骤并保留可用结果",
        error: e instanceof Error ? e.message : "处理失败。",
      };
    } finally {
      const chosen = run.best || run.fallback;
      await persist({
        ...taskRef.current,
        run,
        results: mergeReviews(taskResults(taskRef.current), run),
        ...(chosen ? { job: chosen.job, params: { ...chosen.params } } : {}),
        endedAt: Date.now(),
      });
      active.current = false;
      setBusy(false);
    }
  }
  const imported = useRef<File | undefined>(undefined);
  const [initialImported, setInitialImported] = useState(!initialFile);
  useEffect(() => {
    if (loaded && initialFile && imported.current !== initialFile) {
      imported.current = initialFile;
      setInitialImported(false);
      void upload(initialFile).finally(() => setInitialImported(true));
    }
  }, [loaded, initialFile]);
  useEffect(() => {
    onTaskState?.({
      task,
      busy,
      ready: loaded && initialImported && !uploading && !!task.original,
      loaded,
      importing: uploading || (!!initialFile && !initialImported),
    });
  }, [task, busy, loaded, uploading, onTaskState, initialImported]);
  useImperativeHandle(controllerRef, () => ({
    flush: () => writeTask(taskRef.current),
    start: () => startGeneration(),
    stop: () => {
      stop.current = true;
    },
  }));
  const run = task.run;
  const elapsed = task.startedAt
    ? Math.max(0, ((task.endedAt || now) - task.startedAt) / 1000)
    : 0;
  const results = taskResults(task);
  const locked =
    busy || !loaded || uploading || clearing || historyBusy || batchLocked;

  const settingsPanel = (
    <div
      className="settings-panel engraving-settings-panel"
      role="complementary"
      aria-label="参数设置"
    >
      <Flex justify="space-between">
        <h3 style={{ margin: 0 }}>雕刻设置</h3>
        <Tag>单图</Tag>
      </Flex>
      <Divider />
      <Form layout="vertical">
        {" "}
        <Form.Item label="图片模型">
          <Input
            disabled={busy}
            value={preferences.imageModel}
            onChange={(e) => patchPreferences({ imageModel: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="审核模型">
          <Input
            disabled={busy}
            value={preferences.reviewModel}
            onChange={(e) => patchPreferences({ reviewModel: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="生成质量">
          <Select
            disabled={busy}
            style={{ width: "100%" }}
            value={preferences.quality}
            onChange={(quality) => patchPreferences({ quality })}
            options={["low", "medium", "high", "auto"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Form.Item>
      </Form>
      <Divider />
      <h4>自动优化</h4>
      <Space orientation="vertical" style={{ width: "100%" }}>
        {" "}
        <label className="engraving-inline">
          自动优化
          <Switch
            disabled={locked}
            checked={preferences.auto}
            onChange={(auto) => patchPreferences({ auto })}
          />
        </label>
        <label className="engraving-inline">
          在生成图上持续优化
          <Switch
            aria-label="在生成图上持续优化"
            disabled={locked || !preferences.auto}
            checked={preferences.continueOnGenerated}
            onChange={(continueOnGenerated) =>
              patchPreferences({ continueOnGenerated })
            }
          />
        </label>
        <small>
          开启后，从评分最佳的生成图继续修改，并附带原照保留人物和构图。
        </small>
        <label>
          最多轮数
          <InputNumber
            aria-label="最多轮数"
            disabled={locked || !preferences.auto}
            min={1}
            max={10}
            precision={0}
            value={preferences.maxRounds}
            onChange={(n) => n !== null && patchPreferences({ maxRounds: n })}
          />
        </label>
        <label>
          目标评分
          <InputNumber
            aria-label="目标评分"
            disabled={locked || !preferences.auto}
            min={70}
            max={95}
            precision={0}
            value={preferences.targetScore}
            onChange={(n) => n !== null && patchPreferences({ targetScore: n })}
          />
        </label>
        <small>
          每轮审核后调参或重新生成，可能多次计费；失败不自动重发。审核 Token
          按实际账单计费。
        </small>
      </Space>
    </div>
  );
  return (
    <section className="custom-monochrome-logo">
      <header hidden={!workspaceActive}>
        <div>
          <h2>客户定制黑白 Logo</h2>
          <p>照片雕刻工作台 · 保留主体细节，输出适合黑色涂层的灰度或点阵 PNG</p>
        </div>
        <Button disabled={locked} onClick={() => void openHistory()}>
          任务历史
        </Button>
      </header>
      <Modal
        open={historyOpen}
        title="任务历史"
        onCancel={() => !historyBusy && setHistoryOpen(false)}
        footer={null}
      >
        <p>
          各标签独立保存。恢复会创建副本，当前任务仍保留在历史中；历史仅保存在此浏览器。
        </p>
        {!history.length && <p>暂无保存的任务。</p>}
        <Space orientation="vertical" style={{ width: "100%" }}>
          {history.map((entry) => (
            <Card key={entry.id} size="small">
              <Space wrap>
                <span>
                  {entry.fileName || "未命名任务"} · {entry.count} 张 ·{" "}
                  {new Date(entry.updatedAt).toLocaleString()}
                </span>
                <Button
                  disabled={historyBusy}
                  onClick={() => void restoreHistory(entry.id)}
                >
                  恢复副本
                </Button>
              </Space>
            </Card>
          ))}
        </Space>
      </Modal>
      {storageWarning ? (
        <Alert type="warning" showIcon title={storageWarning} />
      ) : null}
      {error || run?.error ? (
        <Alert type="error" showIcon title={error || run?.error} />
      ) : null}
      {notice ? <Alert type="info" title={notice} /> : null}
      <div className="engraving-layout">
        <main>
          <div hidden={!workspaceActive}>
          {!embedded && (
            <Card
              className="workflow-card"
              title={
                <Space>
                  <FileImageOutlined />
                  <span>上传单张原图</span>
                </Space>
              }
            >
              {!task.original ? (
                <Upload.Dragger
                  aria-label="上传单张原图"
                  accept="image/jpeg,image/png,image/webp"
                  multiple={false}
                  maxCount={1}
                  showUploadList={false}
                  disabled={locked}
                  beforeUpload={(file) => {
                    void upload(file);
                    return false;
                  }}
                >
                  <p className="ant-upload-drag-icon">
                    <FileImageOutlined />
                  </p>
                  <p className="ant-upload-text">点击或拖拽上传图片</p>
                  <p className="ant-upload-hint">
                    JPEG / PNG / WebP · ≤20 MB · ≤4000 万像素
                  </p>
                </Upload.Dragger>
              ) : (
                <>
                  <PreviewImage blob={task.original} title="原照" />
                  <p>{task.fileName}</p>
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    multiple={false}
                    showUploadList={false}
                    disabled={locked}
                    beforeUpload={(file) => {
                      void upload(file);
                      return false;
                    }}
                  >
                    <Button
                      icon={<UploadOutlined />}
                      loading={uploading}
                      disabled={locked}
                    >
                      替换原图
                    </Button>
                  </Upload>
                  <p>
                    替换原图将开始独立任务；当前原照、结果和参数保留在任务历史中。
                  </p>
                </>
              )}
            </Card>
          )}
          <Card className="workflow-card" title="主体与风格">
            <Space orientation="vertical" style={{ width: "100%" }}>
              {" "}
              <label>
                保留主体
                <Select
                  aria-label="保留主体"
                  disabled={locked}
                  value={preferences.subject}
                  onChange={(subject) => patchPreferences({ subject })}
                  options={[
                    ["auto", "自动识别"],
                    ["portrait", "人物"],
                    ["pet", "动物"],
                    ["group", "人和动物"],
                    ["horse", "骑马"],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                纹理风格
                <Select
                  aria-label="纹理风格"
                  disabled={locked}
                  value={preferences.style}
                  onChange={(style) => patchPreferences({ style })}
                  options={[
                    { value: "natural", label: "细腻写实" },
                    { value: "strong", label: "强纹理雕刻" },
                  ]}
                />
              </label>
              <label className="engraving-inline">
                扩图补全主体
                <Switch
                  aria-label="扩图补全主体"
                  disabled={locked}
                  checked={preferences.outpaint?.enabled === true}
                  onChange={(enabled) =>
                    patchPreferences({
                      outpaint: {
                        enabled,
                        instructions: preferences.outpaint?.instructions || "",
                      },
                    })
                  }
                />
              </label>
              {preferences.outpaint?.enabled && (
                <>
                  <Input.TextArea
                    aria-label="扩图要求"
                    disabled={locked}
                    maxLength={800}
                    showCount
                    value={preferences.outpaint.instructions}
                    placeholder="留空由AI自动判断；例如：向图片右侧扩图，补全人物手臂和手肘，保留安全边距"
                    onChange={(e) =>
                      patchPreferences({
                        outpaint: {
                          enabled: true,
                          instructions: e.target.value,
                        },
                      })
                    }
                  />
                  <small>
                    补全照片边缘被截断的主体，画面外细节由AI推测；开启自动优化可检查完整性。
                  </small>
                </>
              )}
              {referenceControlsVisible ? (
                <>
                  {" "}
                  <label>
                    风格参考
                    <Select
                      aria-label="风格参考"
                      disabled={locked}
                      value={preferences.reference}
                      onChange={(reference) => {
                        patchPreferences({ reference });
                        updateTask({
                          ...taskRef.current,
                          customReference: undefined,
                        });
                      }}
                      options={[
                        { value: "portrait", label: "人物雕刻" },
                        { value: "couple", label: "双人雕刻" },
                        { value: "bouquet", label: "人物与花束" },
                      ]}
                    />
                  </label>
                  <small>
                    用于 AI 风格对照，不复制参考人物。内置素材随网页公开分发。
                  </small>
                  <Image
                    src={
                      customReferenceUrl ||
                      `${import.meta.env.BASE_URL}engraving-references/${preferences.reference}-reference.jpg`
                    }
                    alt="当前风格参考图"
                    style={{ maxHeight: 200, objectFit: "contain" }}
                  />
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    showUploadList={false}
                    disabled={locked}
                    beforeUpload={(file) => {
                      setUploading(true);
                      void processInWorker(file, undefined, undefined, true)
                        .then((result) =>
                          persist({
                            ...taskRef.current,
                            customReference: result.buffer,
                          }),
                        )
                        .catch((e) => setError(e.message))
                        .finally(() => setUploading(false));
                      return false;
                    }}
                  >
                    <Button disabled={locked}>上传风格参考图</Button>
                  </Upload>
                  {task.customReference ? (
                    <Button
                      disabled={locked}
                      onClick={() =>
                        updateTask({
                          ...taskRef.current,
                          customReference: undefined,
                        })
                      }
                    >
                      恢复内置风格参考
                    </Button>
                  ) : null}
                </>
              ) : null}{" "}
              <Input.TextArea
                aria-label="主体保留要求"
                disabled={locked}
                value={preferences.instructions}
                onChange={(e) =>
                  patchPreferences({ instructions: e.target.value })
                }
                maxLength={1600}
                showCount
                rows={4}
                placeholder="主体保留要求（最多 1600 字）"
              />
            </Space>
          </Card>
          <Card className="action-card">
            <Flex justify="space-between" align="center" gap={12} wrap>
              <div>
                <h3>生成黑白 Logo</h3>
                <small>保留主体细节，输出雕刻效果</small>
              </div>
              <Space wrap>
                {" "}
                <Button
                  type="primary"
                  disabled={locked || !task.original}
                  onClick={() => void startGeneration()}
                >
                  生成黑白 Logo
                </Button>
                <Button
                  disabled={locked || !task.original || !results.length}
                  onClick={() => {
                    setAdditionalPrompt("");
                    setAdditionalOpen(true);
                  }}
                >
                  补充提示词再生成一张
                </Button>
                {busy ? (
                  <Button
                    danger
                    onClick={() => {
                      stop.current = true;
                      setNotice(
                        "已请求停止：不会开始下一步，正在执行的请求返回后先保存图片。",
                      );
                    }}
                  >
                    停止后续步骤
                  </Button>
                ) : null}
              </Space>
            </Flex>
          </Card>
          {run ? (
            <Card size="small">
              <Space wrap>
                <Tag>{run.status}</Tag>
                <span>{run.phase}</span>
                <span>耗时 {elapsed.toFixed(0)} 秒</span>
                <span>
                  生图 {run.generations} 次 · 审核 {run.checks} 次
                </span>
              </Space>
              <Progress
                percent={
                  run.status === "completed"
                    ? 100
                    : Math.round((run.rounds.length / run.maxRounds) * 100)
                }
                status={
                  busy
                    ? "active"
                    : run.status === "failed"
                      ? "exception"
                      : run.status === "completed"
                        ? "success"
                        : "normal"
                }
              />
            </Card>
          ) : null}
          </div>
          {embedded && task.original && <h3>原照：{task.fileName} · {busy ? "生成中" : "生成结果"}</h3>}
          <EngravingGallery
            onClear={() => setClearOpen(true)}
            clearDisabled={locked}
            results={results}
            original={task.original}
            onChange={(id, patch) => {
              updateTask(changeResultParams(taskRef.current, id, patch));
            }}
          />
        </main>
      </div>
      {settingsHost ? (
        createPortal(settingsPanel, settingsHost)
      ) : settingsHost === undefined ? (
        <aside className="logo-settings">{settingsPanel}</aside>
      ) : null}
      <Modal
        open={clearOpen}
        title="清空历史结果"
        okText="确认清空"
        cancelText="取消"
        confirmLoading={clearing}
        okButtonProps={{ danger: true, disabled: locked }}
        onCancel={() => !clearing && setClearOpen(false)}
        onOk={async () => {
          if (active.current || uploading || !loaded || clearing) return;
          setClearing(true);
          try {
            const next = clearTaskResults(taskRef.current);
            await writeTask(next);
            updateTask(next);
            setClearOpen(false);
            setNotice(
              "历史生成结果及审核记录已清空，无法撤销。原照、风格参考和全局生成统计已保留。",
            );
          } catch {
            setError("清空失败，历史结果仍保留，请检查本地存储权限后重试。");
          } finally {
            setClearing(false);
          }
        }}
      >
        <p>
          将删除当前工具本地保存的全部生成图片、逐图参数、裁剪、擦除蒙版及审核记录，清空后无法恢复。请先下载需要保留的图片。
        </p>
        <p>保留原照、风格参考、生成配置和全局生成张数统计。</p>
      </Modal>
      <Modal
        open={additionalOpen}
        title="补充提示词，再生成一张"
        onCancel={() => setAdditionalOpen(false)}
        okText="再生成一张"
        okButtonProps={{ disabled: locked || !additionalPrompt.trim() }}
        onOk={() => {
          setAdditionalOpen(false);
          void startGeneration(additionalPrompt);
        }}
      >
        <p>
          使用原照与当前风格参考生成一张新图，不覆盖已有结果，也不启动自动循环。
        </p>
        <Input.TextArea
          aria-label="补充提示词"
          value={additionalPrompt}
          onChange={(e) => setAdditionalPrompt(e.target.value)}
          maxLength={1600}
          showCount
          rows={5}
        />
      </Modal>
    </section>
  );
}

export default BatchEngravingComposer;
