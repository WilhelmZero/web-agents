import { OPENAI_ROOT } from "./services/openAiEndpoint";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Image,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Slider,
  Space,
  Switch,
  Tag,
  Upload,
} from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { DEFAULTS, validateOptions } from "./services/engraving/processing.mjs";
import { runAutoTune } from "./services/engraving/auto-tune.mjs";
import {
  createEngravingApi,
  testConnection,
  apiBase,
} from "./services/engraving/api";
import {
  loadPreferences,
  savePreferences,
  loadTask,
  saveTask,
} from "./services/engraving/storage";
import { processInWorker } from "./services/engraving/workerClient";
import type {
  AutoRun,
  Candidate,
  ImageJob,
  Preferences,
  RenderParams,
  SavedTask,
} from "./services/engraving/types";
import EngravingResultCard, {
  EngravingCompareGroup,
  DpiControl,
} from "./components/EngravingResultCard";
import {
  taskResults,
  mergeReviews,
  changeResultParams,
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
export default function CustomMonochromeLogoComposer({
  openAiApiKey,
  onConfigureKey,
}: {
  openAiApiKey: string;
  onConfigureKey: () => void;
}) {
  const [preferences, setPreferences] = useState(loadPreferences);
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
  const [preview, setPreview] = useState<{ blob: Blob; warnings: string[] }>(),
    [rendering, setRendering] = useState(false),
    [exporting, setExporting] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState(false),
    [additionalPrompt, setAdditionalPrompt] = useState(""),
    [testing, setTesting] = useState(false),
    [now, setNow] = useState(Date.now());
  const customReferenceUrl = useBlobUrl(task.customReference);
  function updateTask(next: SavedTask) {
    taskRef.current = next;
    setTask(next);
  }
  async function persist(next: SavedTask) {
    updateTask(next);
    try {
      await saveTask(next);
    } catch {
      setStorageWarning(
        "本地保存失败（可能存储空间不足或浏览器禁止存储）。当前结果仍在内存，请及时下载；刷新可能丢失。",
      );
    }
  }
  useEffect(() => {
    let disposed = false;
    loadTask()
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
      savePreferences(preferences);
    } catch {
      setStorageWarning("设置无法写入本地存储。");
    }
  }, [preferences]);
  useEffect(() => {
    if (!loaded || busy) return;
    const timer = setTimeout(() => {
      void saveTask(task).catch(() =>
        setStorageWarning("本地任务保存失败，请先下载结果。"),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [task, loaded, busy]);
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
  useEffect(() => {
    const abort = new AbortController();
    setPreview(undefined);
    if (!task.job) {
      setRendering(false);
      return;
    }
    setRendering(true);
    const job = task.job;
    const timer = setTimeout(() => {
      processInWorker(job.blob, { ...task.params, preview: true }, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) {
            setPreview({ blob: result.buffer, warnings: result.warnings });
            setError("");
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setRendering(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [task.job, task.params]);
  const patchPreferences = (patch: Partial<Preferences>) =>
    setPreferences((previous) => ({ ...previous, ...patch }));
  const patchParams = (patch: Partial<RenderParams>) =>
    updateTask(
      taskRef.current.job
        ? changeResultParams(taskRef.current, taskRef.current.job.id, patch)
        : {
            ...taskRef.current,
            params: { ...taskRef.current.params, ...patch },
          },
    );
  async function upload(file: File) {
    if (active.current || uploading || !loaded) return;
    setUploading(true);
    setError("");
    try {
      const result = await processInWorker(file, undefined, undefined, true);
      await persist({
        version: 1,
        original: result.buffer,
        customReference: taskRef.current.customReference,
        fileName: file.name,
        params: { ...taskRef.current.params, eraseMask: undefined },
      });
      setNotice(result.warnings.join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }
  function adopt(candidate: Candidate) {
    if (active.current) return;
    updateTask({
      ...taskRef.current,
      job: candidate.job,
      params: { ...candidate.params },
    });
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
      initial = taskRef.current,
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
      let reference = initial.customReference;
      if (!reference) {
        const response = await fetch(
          `${import.meta.env.BASE_URL}engraving-references/${snapshot.reference}-reference.jpg`,
        );
        if (!response.ok) throw new Error("风格参考加载失败");
        reference = (await processInWorker(await response.blob())).buffer;
      }
      const usedReference = reference;
      let lastPrompt = "";
      const api = createEngravingApi();
      const generate: typeof api.generate = async (input) => {
        lastPrompt = buildPrompt({ ...input, hasReference: true });
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
              params: { ...initial.params, eraseMask: undefined },
              initialParams: { ...initial.params, eraseMask: undefined },
              reviews: [],
              createdAt: Date.now(),
              reference: usedReference,
              prompt: lastPrompt,
            },
          ],
          params: { ...initial.params, eraseMask: undefined },
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
            params: { ...initial.params, eraseMask: undefined },
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
  async function exportResult() {
    if (!task.job) return;
    setExporting(true);
    setError("");
    try {
      const result = await processInWorker(task.job.blob, {
        ...task.params,
        preview: false,
      });
      download(
        result.buffer,
        `${task.fileName.replace(/\.[^.]+$/, "") || "engraving"}-${task.params.widthMm}mm-${task.params.dpi}dpi.png`,
      );
      setNotice(result.warnings.join("；"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const run = task.run;
  const elapsed = task.startedAt
    ? Math.max(0, ((task.endedAt || now) - task.startedAt) / 1000)
    : 0;
  const results = taskResults(task);
  const locked = busy || !loaded || uploading;
  return (
    <section className="custom-monochrome-logo">
      <header>
        <div>
          <h2>客户定制黑白 Logo</h2>
          <p>照片雕刻工作台 · 保留主体细节，输出适合黑色涂层的灰度或点阵 PNG</p>
        </div>
      </header>
      {storageWarning ? (
        <Alert type="warning" showIcon title={storageWarning} />
      ) : null}
      {error || run?.error ? (
        <Alert type="error" showIcon title={error || run?.error} />
      ) : null}
      {notice ? <Alert type="info" title={notice} /> : null}
      <div className="engraving-layout">
        <aside aria-label="参数设置" className="engraving-settings">
          <h3>参数设置</h3>
          <Card title="模型与质量" size="small">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <label>
                图片模型
                <Input
                  disabled={busy}
                  value={preferences.imageModel}
                  onChange={(e) =>
                    patchPreferences({ imageModel: e.target.value })
                  }
                />
              </label>
              <label>
                审核模型
                <Input
                  disabled={busy}
                  value={preferences.reviewModel}
                  onChange={(e) =>
                    patchPreferences({ reviewModel: e.target.value })
                  }
                />
              </label>
              <label>
                生成质量
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
              </label>

              <small>复用全局 OpenAI / GPT 地址与密钥</small>
              <Button onClick={onConfigureKey}>全局 API 设置</Button>
              <Button
                loading={testing}
                onClick={async () => {
                  setTesting(true);
                  try {
                    const count = await testConnection({
                      ...preferences,
                      baseUrl: OPENAI_ROOT,
                      apiKey: openAiApiKey,
                    });
                    setNotice(`连接成功，返回 ${count} 个模型；未生成图片。`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                测试连接（仅模型列表）
              </Button>
            </Space>
          </Card>
          <Card title="1 · 原照与主体" size="small">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Upload
                accept="image/jpeg,image/png,image/webp"
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
                  上传客户照片
                </Button>
              </Upload>
              <small>JPEG / PNG / WebP · ≤20 MB · ≤4000 万像素</small>
              <span>{task.fileName}</span>
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
          <Card title="2 · AI 生成与自动优化" size="small">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <label className="engraving-inline">
                自动优化
                <Switch
                  disabled={locked}
                  checked={preferences.auto}
                  onChange={(auto) => patchPreferences({ auto })}
                />
              </label>
              <label>
                最多轮数
                <InputNumber
                  aria-label="最多轮数"
                  disabled={locked || !preferences.auto}
                  min={1}
                  max={10}
                  precision={0}
                  value={preferences.maxRounds}
                  onChange={(n) =>
                    n !== null && patchPreferences({ maxRounds: n })
                  }
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
                  onChange={(n) =>
                    n !== null && patchPreferences({ targetScore: n })
                  }
                />
              </label>
              <small>
                每轮审核后调参或重新生成，可能多次计费；失败不自动重发。审核
                Token 按实际账单计费。
              </small>
              <Button
                type="primary"
                block
                disabled={locked || !task.original}
                onClick={() => void startGeneration()}
              >
                生成黑白 Logo
              </Button>
              <Button
                block
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
                  block
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
          </Card>
          <Card title="4 · 输出尺寸与下载" size="small">
            <Space wrap align="end">
              <label>
                输出模式
                <Select
                  aria-label="输出模式"
                  disabled={locked}
                  value={task.params.mode}
                  onChange={(mode) => patchParams({ mode })}
                  options={[
                    { value: "grayscale", label: "灰度 PNG" },
                    { value: "dither", label: "二值点阵 PNG" },
                  ]}
                />
              </label>
              <label>
                宽度（mm）
                <InputNumber
                  aria-label="宽度（mm）"
                  disabled={locked}
                  min={10}
                  max={300}
                  value={task.params.widthMm}
                  onChange={(n) => n !== null && patchParams({ widthMm: n })}
                />
              </label>
              <label>
                DPI
                <DpiControl
                  value={task.params.dpi}
                  disabled={locked}
                  onChange={(dpi) => patchParams({ dpi })}
                />
              </label>
              <label>
                边距（mm）
                <InputNumber
                  aria-label="边距（mm）"
                  disabled={locked}
                  min={0}
                  max={15}
                  value={task.params.margin}
                  onChange={(n) => n !== null && patchParams({ margin: n })}
                />
              </label>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                disabled={!task.job || locked}
                loading={exporting}
                onClick={() => void exportResult()}
              >
                完整尺寸导出
              </Button>
            </Space>
            <p>
              预览最长边 1200px；导出从生成原图重新计算，包含 DPI 元数据。最大
              8192px / 2400 万像素。默认 80mm / 300 DPI = 945px 宽。
            </p>
          </Card>
        </aside>
        <main>
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
          <EngravingCompareGroup original={task.original}>
            <div className="engraving-comparison">
              <PreviewImage blob={task.original} title="原照" />
              <PreviewImage
                blob={preview?.blob}
                title={rendering ? "结果计算中…" : "雕刻结果"}
              />
            </div>
          </EngravingCompareGroup>
          {task.job?.warnings
            .concat(preview?.warnings || [])
            .map((warning, index) => (
              <Alert key={index} type="warning" title={warning} />
            ))}
          <div className="engraving-results-list">
            {results.map((result) => (
              <EngravingResultCard
                key={result.job.id}
                result={result}
                original={task.original}
                disabled={locked}
                onAdopt={() =>
                  adopt({ job: result.job, params: result.params, round: 0 })
                }
                onChange={(patch) =>
                  updateTask(
                    changeResultParams(taskRef.current, result.job.id, patch),
                  )
                }
              />
            ))}
          </div>
        </main>
      </div>
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
