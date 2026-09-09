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
import {
  DownloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
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
import EngravingMaskEditor from "./components/EngravingMaskEditor";
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
const groupPreview = {
  actionsRender: (
    original: React.ReactElement,
    info: { image: { url: string } },
  ) => (
    <>
      {original}
      <Button
        icon={<DownloadOutlined />}
        onClick={() => {
          const a = document.createElement("a");
          a.href = info.image.url;
          a.download = "engraving-preview.png";
          a.click();
        }}
      >
        下载预览图
      </Button>
    </>
  ),
};
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
function CandidateCard({
  candidate,
  label,
  disabled,
  onAdopt,
}: {
  candidate: Candidate;
  label: string;
  disabled: boolean;
  onAdopt: () => void;
}) {
  const [blob, setBlob] = useState<Blob>(),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    processInWorker(
      candidate.job.blob,
      { ...candidate.params, preview: true },
      abort.signal,
    )
      .then((result) => setBlob(result.buffer))
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e.message));
      });
    return () => abort.abort();
  }, [candidate.job.blob, candidate.params]);
  return (
    <Card size="small">
      <PreviewImage blob={blob} title={label} />
      <p>{candidate.job.warnings.join("；")}</p>
      {error ? <Alert type="warning" title={error} /> : null}
      <Button disabled={disabled} onClick={onAdopt}>
        采用本轮参数与图片
      </Button>
    </Card>
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
  const [settingsOpen, setSettingsOpen] = useState(false),
    [maskOpen, setMaskOpen] = useState(false),
    [testing, setTesting] = useState(false),
    [now, setNow] = useState(Date.now());
  const sourceUrl = useBlobUrl(task.job?.blob);
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
        if (!disposed && saved) updateTask(saved);
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
    updateTask({
      ...taskRef.current,
      params: { ...taskRef.current.params, ...patch },
    });
  async function upload(file: File) {
    if (active.current || uploading || !loaded) return;
    setUploading(true);
    setError("");
    try {
      const result = await processInWorker(file, undefined, undefined, true);
      await persist({
        version: 1,
        original: result.buffer,
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
  async function startGeneration() {
    if (active.current || !taskRef.current.original) return;
    if (!openAiApiKey.trim()) {
      onConfigureKey();
      return;
    }
    try {
      validateOptions(taskRef.current.params);
      apiBase(preferences.baseUrl);
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
    const snapshot = { ...preferences },
      initial = taskRef.current,
      original = initial.original!;
    const config = { ...snapshot, apiKey: openAiApiKey };
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
      await persist({ ...taskRef.current, run: next });
    };
    try {
      const refResponse = await fetch(
        `${import.meta.env.BASE_URL}engraving-references/${snapshot.reference}-reference.jpg`,
      );
      if (!refResponse.ok)
        throw new Error("内置风格参考加载失败，请刷新后重试。");
      const reference = (await processInWorker(await refResponse.blob()))
        .buffer;
      const api = createEngravingApi();
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
          render: (source, params) => processInWorker(source, params),
          saveCandidate,
          publish,
          cancelled: () => stop.current,
        });
      else {
        await publish({ ...run, phase: "正在生成图片", generations: 1 });
        const result = await api.generate({
          image: original,
          referenceImage: reference,
          config,
          subject: snapshot.subject,
          instructions: snapshot.instructions,
          style: snapshot.style,
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
  const sliders = [
    ["texture", "纹理", 100],
    ["contrast", "对比度", 100],
    ["shadow", "暗部细节", 100],
    ["brightness", "亮度", 100],
    ["blackPoint", "黑底清理", 40],
  ] as const;
  const locked = busy || !loaded || uploading;
  return (
    <section className="custom-monochrome-logo">
      <header>
        <div>
          <h2>客户定制黑白 Logo</h2>
          <p>照片雕刻工作台 · 保留主体细节，输出适合黑色涂层的灰度或点阵 PNG</p>
        </div>
        <Button
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
        >
          工具设置
        </Button>
      </header>
      {storageWarning ? (
        <Alert type="warning" showIcon title={storageWarning} />
      ) : null}
      {error || run?.error ? (
        <Alert type="error" showIcon title={error || run?.error} />
      ) : null}
      {notice ? <Alert type="info" title={notice} /> : null}
      <div className="engraving-layout">
        <aside>
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
                  onChange={(reference) => patchPreferences({ reference })}
                  options={[
                    { value: "portrait", label: "人物雕刻" },
                    { value: "couple", label: "双人雕刻" },
                    { value: "bouquet", label: "人物与花束" },
                  ]}
                />
              </label>
              <small>
                仅用于 AI 风格对照，不复制参考人物。参考素材随网页公开分发。
              </small>
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
          <Card title="3 · 雕刻参数" size="small">
            {sliders.map(([key, label, max]) => (
              <label key={key}>
                {label} <span>{task.params[key]}</span>
                <Slider
                  aria-label={label}
                  disabled={locked}
                  min={0}
                  max={max}
                  value={task.params[key]}
                  onChange={(value) => patchParams({ [key]: value })}
                />
              </label>
            ))}
            <Space wrap>
              <Button
                disabled={locked}
                onClick={() =>
                  patchParams({
                    texture: 65,
                    contrast: 50,
                    shadow: 30,
                    brightness: 50,
                    blackPoint: 10,
                    invert: false,
                  })
                }
              >
                重置参数
              </Button>
              <span>主体反相</span>
              <Switch
                disabled={locked}
                checked={task.params.invert}
                onChange={(invert) => patchParams({ invert })}
              />
              <Button
                disabled={locked || !task.job}
                onClick={() => setMaskOpen(true)}
              >
                擦除校正
              </Button>
            </Space>
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
          <Image.PreviewGroup preview={groupPreview}>
            <div className="engraving-comparison">
              <PreviewImage blob={task.original} title="原照" />
              <PreviewImage
                blob={preview?.blob}
                title={rendering ? "结果计算中…" : "雕刻结果"}
              />
            </div>
          </Image.PreviewGroup>
          {task.job?.warnings
            .concat(preview?.warnings || [])
            .map((warning, index) => (
              <Alert key={index} type="warning" title={warning} />
            ))}
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
                <InputNumber
                  aria-label="DPI"
                  disabled={locked}
                  min={150}
                  max={1200}
                  value={task.params.dpi}
                  onChange={(n) => n !== null && patchParams({ dpi: n })}
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
          {run?.rounds.length || run?.fallback ? (
            <Collapse
              defaultActiveKey={["rounds"]}
              items={[
                {
                  key: "rounds",
                  label: "各轮评分与候选结果",
                  children: (
                    <Image.PreviewGroup preview={groupPreview}>
                      <div className="engraving-candidates">
                        {run.rounds.map((round) => (
                          <div key={`${round.round}-${round.job.id}`}>
                            <CandidateCard
                              candidate={round}
                              label={`第 ${round.round} 轮 · ${round.score} 分${run.best?.round === round.round ? " · 最佳" : ""}`}
                              disabled={locked}
                              onAdopt={() => adopt(round)}
                            />
                            <p>
                              {round.passed
                                ? "已达标"
                                : round.issueLabels.join("；") ||
                                  "未达目标阈值"}
                            </p>
                            <small>
                              {Object.entries(round.scores)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")}
                            </small>
                          </div>
                        ))}
                        {run.fallback &&
                        !run.rounds.some(
                          (r) => r.round === run.fallback?.round,
                        ) ? (
                          <CandidateCard
                            candidate={run.fallback}
                            label="最后生成结果（未审核）"
                            disabled={locked}
                            onAdopt={() => adopt(run.fallback!)}
                          />
                        ) : null}
                      </div>
                    </Image.PreviewGroup>
                  ),
                },
              ]}
            />
          ) : null}
        </main>
      </div>
      <Modal
        open={settingsOpen}
        title="客户定制黑白 Logo · 独立设置"
        onCancel={() => setSettingsOpen(false)}
        footer={<Button onClick={() => setSettingsOpen(false)}>完成</Button>}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            title="复用全局 OpenAI / GPT 密钥。兼容 API 必须允许浏览器 CORS；不使用本机代理服务。"
          />
          <Button onClick={onConfigureKey}>管理全局 API Key</Button>
          <label>
            兼容 API 地址
            <Input
              disabled={busy}
              value={preferences.baseUrl}
              onChange={(e) => patchPreferences({ baseUrl: e.target.value })}
            />
          </label>
          <label>
            图片模型
            <Input
              disabled={busy}
              value={preferences.imageModel}
              onChange={(e) => patchPreferences({ imageModel: e.target.value })}
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
          <Button
            loading={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const count = await testConnection({
                  ...preferences,
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
      </Modal>
      {maskOpen && task.job && sourceUrl ? (
        <EngravingMaskEditor
          job={task.job}
          sourceUrl={sourceUrl}
          value={task.params.eraseMask}
          onClose={() => setMaskOpen(false)}
          onSave={(eraseMask) => {
            patchParams({ eraseMask });
            setMaskOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
