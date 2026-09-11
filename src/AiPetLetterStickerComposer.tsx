import { CheckOutlined, CloudUploadOutlined, DeleteOutlined, DownloadOutlined, ReloadOutlined, StopOutlined, SwapOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Checkbox, Collapse, ColorPicker, Empty, Image, Input, Modal, Popconfirm, Progress, Segmented, Select, Slider, Space, Statistic, Tag, Tooltip, Typography, Upload } from "antd";
import JSZip from "jszip";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editAiPetLetter, AiPetLetterApiError, optimizeAiPetLetterPrompts } from "./services/aiPetLetters/api";
import { colorizeTransparentResult, downloadBlob, fingerprintBlob, normalizeHexColor, normalizeReference, resizeForDownload } from "./services/aiPetLetters/image";
import { adaptPromptOutputMode, createDefaultPrompts, defaultPromptForLetter, promptOptimizerInstruction, validateOptimizedPrompt } from "./services/aiPetLetters/prompts";
import { loadAiPetLetterPrompts, loadAiPetLetterSettings, loadAiPetLetterWorkspace, saveAiPetLetterPrompts, saveAiPetLetterSettings, saveAiPetLetterWorkspace } from "./services/aiPetLetters/storage";
import { normalizeQuality, qualityOptions, type AiPetLetterPrompt, type AiPetLetterSettings, type AiPetLetterTask } from "./services/aiPetLetters/types";
import type { AppSettings } from "./types";
import "./ai-pet-letter-stickers.css";

const { Text, Title } = Typography;
const asset = (name: string) => `${import.meta.env.BASE_URL}ai-pet-letter-stickers/${name}`;

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const value = URL.createObjectURL(blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}

function ResultCover({ blob, letter, onOpen }: { blob: Blob; letter: string; onOpen: () => void }) {
  const url = useBlobUrl(blob);
  return url ? <Image preview={false} src={url} alt={`${letter} 生成结果`} onClick={onOpen} /> : null;
}

function elapsed(start?: number, end?: number) {
  if (!start) return "—";
  const seconds = Math.max(0, Math.round(((end || Date.now()) - start) / 1000));
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function statusLabel(status?: AiPetLetterTask["status"]) {
  return !status ? "未开始" : ({ waiting: "等待中", running: "生成中", success: "成功", failed: "失败", stopped: "已停止", interrupted: "已中断" } as const)[status];
}

export default function AiPetLetterStickerComposer({ active, settings: globalSettings, settingsHost, onConfigure }: {
  active: boolean;
  settings: AppSettings;
  settingsHost: HTMLElement | null;
  onConfigure: () => void;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<AiPetLetterSettings>(loadAiPetLetterSettings);
  const [prompts, setPrompts] = useState<AiPetLetterPrompt[]>(() => loadAiPetLetterPrompts().map((item) => ({ ...item, defaultPrompt: adaptPromptOutputMode(item.defaultPrompt, settings.outputMode), currentPrompt: adaptPromptOutputMode(item.currentPrompt, settings.outputMode) })));
  const [referenceBlob, setReferenceBlob] = useState<Blob>();
  const [normalizedPreviewBlob, setNormalizedPreviewBlob] = useState<Blob>();
  const [referenceName, setReferenceName] = useState("默认 A 字母参考图");
  const [referenceFingerprint, setReferenceFingerprint] = useState("");
  const [tasks, setTasks] = useState<AiPetLetterTask[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [preview, setPreview] = useState<{ kind: "reference" | "raw"; letter?: string }>({ kind: "reference" });
  const [compareLetter, setCompareLetter] = useState<string>();
  const [enlarged, setEnlarged] = useState<{ letter: string; current: number }>();
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [optimizationDiff, setOptimizationDiff] = useState<Array<{ letter: string; before: string; after: string }>>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [requestCount, setRequestCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const stopAll = useRef(false);

  useEffect(() => {
    if (!referenceBlob) return;
    const id = window.setTimeout(() => void normalizeReference(referenceBlob, settings, 960, 540).then(setNormalizedPreviewBlob).catch(() => setNormalizedPreviewBlob(referenceBlob)), 120);
    return () => clearTimeout(id);
  }, [referenceBlob, settings.cropX, settings.cropY, settings.cropZoom]);
  const currentReferenceFingerprint = useMemo(() => `${referenceFingerprint}:${settings.cropZoom.toFixed(3)}:${settings.cropX.toFixed(3)}:${settings.cropY.toFixed(3)}`, [referenceFingerprint, settings.cropX, settings.cropY, settings.cropZoom]);
  const referenceCompareUrl = useBlobUrl(normalizedPreviewBlob || referenceBlob);
  const previewTask = tasks.find((item) => item.letter === preview.letter);
  const previewBlob = preview.kind === "reference" ? (normalizedPreviewBlob || referenceBlob) : previewTask?.result?.compositeBlob;
  const previewUrl = useBlobUrl(previewBlob);
  const detailLetter = enlarged?.letter || compareLetter;
  const detailTask = tasks.find((item) => item.letter === detailLetter);
  const detailResultUrl = useBlobUrl(detailTask?.result?.compositeBlob);
  const detailRawUrl = useBlobUrl(detailTask?.result?.rawBlob);

  const loadDefault = useCallback(async () => {
    const referenceResponse = await fetch(`${asset("default-reference.png")}?v=3`);
    const ref = await referenceResponse.blob();
    setReferenceBlob(ref); setReferenceName("默认 A 字母参考图"); setReferenceFingerprint(await fingerprintBlob(ref));
    setSettings((value) => ({ ...value, cropZoom: 1, cropX: 0, cropY: 0 }));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const workspace = await loadAiPetLetterWorkspace();
        if (workspace?.referenceBlob) {
          setReferenceBlob(workspace.referenceBlob); setReferenceName(workspace.referenceName || "已恢复参考图");
          setReferenceFingerprint(workspace.referenceFingerprint || await fingerprintBlob(workspace.referenceBlob));
          const restored = workspace.tasks.map((task): AiPetLetterTask => task.status === "running" || task.status === "waiting" ? { ...task, status: "interrupted", error: "页面刷新时任务尚未完成" } : task);
          setTasks(restored);
          setRequestCount(restored.reduce((sum, task) => sum + (task.startedAt ? 1 + task.retries : 0), 0));
          setRetryCount(restored.reduce((sum, task) => sum + task.retries, 0));
          setStartedAt(restored.reduce<number | undefined>((min, task) => task.startedAt && (!min || task.startedAt < min) ? task.startedAt : min, undefined));
          if ((workspace.referenceName || "").startsWith("默认 A 字母参考图")) await loadDefault();
        } else await loadDefault();
      } catch { await loadDefault(); }
      setHydrated(true);
    })();
  }, [loadDefault]);

  useEffect(() => saveAiPetLetterSettings(settings), [settings]);
  useEffect(() => saveAiPetLetterPrompts(prompts), [prompts]);
  useEffect(() => {
    if (!hydrated) return;
    const id = window.setTimeout(() => void saveAiPetLetterWorkspace({ referenceBlob, referenceFingerprint, referenceName, tasks, updatedAt: Date.now() }), 400);
    return () => clearTimeout(id);
  }, [hydrated, referenceBlob, referenceFingerprint, referenceName, tasks]);

  const updateTask = useCallback((letter: string, patch: Partial<AiPetLetterTask>) => setTasks((items) => items.map((item) => item.letter === letter ? { ...item, ...patch } : item)), []);

  const processLetters = useCallback(async (letters: string[], replace = false) => {
    if (!letters.length) { message.warning("请至少选择一个字母"); return; }
    if (!globalSettings.openAiApiKey) { message.warning("请先在右上角配置 OpenAI API Key"); onConfigure(); return; }
    if (!referenceBlob) { message.warning("请先准备参考图"); return; }
    const promptSnapshot = new Map(prompts.map((item) => [item.letter, item.currentPrompt.trim()]));
    const invalid = letters.find((letter) => !promptSnapshot.get(letter));
    if (invalid) { message.warning(`${invalid} 的提示词为空`); return; }
    const snapshot = { ...settings, quality: normalizeQuality(settings.model, settings.quality) };
    const now = Date.now(); setStartedAt(now); setRunning(true); stopAll.current = false;
    setSelectedResults((items) => items.filter((letter) => !letters.includes(letter)));
    const queued = letters.map<AiPetLetterTask>((letter) => ({ letter, status: "waiting", prompt: promptSnapshot.get(letter)!, model: snapshot.model, quality: snapshot.quality, outputMode: snapshot.outputMode, backgroundColor: snapshot.backgroundColor, retries: 0 }));
    setTasks((current) => {
      if (!replace) return queued;
      const target = new Set(letters); return [...current.filter((item) => !target.has(item.letter)), ...queued].sort((a, b) => a.letter.localeCompare(b.letter));
    });
    try {
      const normalizedReference = await normalizeReference(referenceBlob, snapshot);
      if (normalizedReference.size >= 50 * 1024 * 1024) throw new Error("规范化后的参考图超过 50 MB，请换用更简单的参考图");
      let index = 0;
      const worker = async () => {
        while (!stopAll.current) {
          const letter = letters[index++]; if (!letter) return;
          const controller = new AbortController(); controllers.current.set(letter, controller);
          updateTask(letter, { status: "running", startedAt: Date.now(), error: undefined });
          let retries = 0;
          try {
            while (true) {
              try {
                setRequestCount((value) => value + 1);
                const rawBlob = await editAiPetLetter({ apiKey: globalSettings.openAiApiKey, image: normalizedReference, prompt: promptSnapshot.get(letter)!, model: snapshot.model, quality: snapshot.quality, background: snapshot.outputMode === "transparent-colorize" ? "transparent" : undefined, signal: controller.signal, attempt: retries + 1 });
                const compositeBlob = snapshot.outputMode === "transparent-colorize" ? await colorizeTransparentResult(rawBlob, snapshot.backgroundColor) : rawBlob;
                updateTask(letter, { status: "success", retries, endedAt: Date.now(), result: { letter, rawBlob, compositeBlob, outputMode: snapshot.outputMode, backgroundColor: snapshot.backgroundColor, referenceFingerprint: currentReferenceFingerprint, width: 3840, height: 2160, createdAt: Date.now() } });
                break;
              } catch (error) {
                if (controller.signal.aborted || stopAll.current) { updateTask(letter, { status: "stopped", retries, endedAt: Date.now() }); break; }
                if (error instanceof AiPetLetterApiError && error.retryable && retries < 2) {
                  retries += 1; setRetryCount((value) => value + 1); updateTask(letter, { retries });
                  await new Promise((resolve) => setTimeout(resolve, retries * 1200)); continue;
                }
                throw error;
              }
            }
          } catch (error) { updateTask(letter, { status: "failed", retries, endedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }); }
          finally { controllers.current.delete(letter); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(snapshot.concurrency, letters.length) }, worker));
      if (stopAll.current) setTasks((items) => items.map((item) => item.status === "waiting" ? { ...item, status: "stopped", endedAt: Date.now() } : item));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "准备图片失败");
      setTasks((items) => items.map((item) => item.status === "waiting" ? { ...item, status: "failed", error: "准备图片失败", endedAt: Date.now() } : item));
    } finally { setRunning(false); }
  }, [currentReferenceFingerprint, globalSettings.openAiApiKey, message, onConfigure, prompts, referenceBlob, settings, updateTask]);

  const stop = () => { stopAll.current = true; controllers.current.forEach((controller) => controller.abort()); };
  const optimizeOne = async (letter: string) => {
    if (!globalSettings.openAiApiKey) { onConfigure(); return; }
    const item = prompts.find((value) => value.letter === letter); if (!item) return;
    setPrompts((values) => values.map((value) => value.letter === letter ? { ...value, optimizing: true } : value));
    try {
      const optimized = await optimizeAiPetLetterPrompts({ apiKey: globalSettings.openAiApiKey, input: promptOptimizerInstruction(letter, item.currentPrompt) });
      const error = validateOptimizedPrompt(letter, optimized); if (error) throw new Error(error);
      setPrompts((values) => values.map((value) => value.letter === letter ? { ...value, currentPrompt: optimized, optimizing: false } : value));
    } catch (error) { message.error(error instanceof Error ? error.message : "优化失败"); setPrompts((values) => values.map((value) => value.letter === letter ? { ...value, optimizing: false } : value)); }
  };
  const optimizeAll = async () => {
    if (!globalSettings.openAiApiKey) { onConfigure(); return; }
    setOptimizingAll(true);
    try {
      const input = `一次性优化 A-Z 的整幅图片编辑提示词。返回 JSON 对象，键必须为 A 到 Z，值为对应完整中文提示词。每项必须明确目标大写字母，保留橙色渐变和黑色描边，要求整幅图统一生成且没有拼接接缝，所有角色完整可见、互不遮挡重叠、不被裁切。A–Z 必须有计划地轮换直接趴靠或抱住字母的萌宠，避免相邻成品顶部重复同一只猫；替换后若有明显空白，只能用少量参考图已有的小贴纸自然填充且不能遮挡字母或角色。禁止其他文字。\n\n${JSON.stringify(Object.fromEntries(prompts.map((item) => [item.letter, item.currentPrompt])))}`;
      const response = await optimizeAiPetLetterPrompts({ apiKey: globalSettings.openAiApiKey, input, batch: true });
      const parsed = JSON.parse(response) as Record<string, string>;
      const next = prompts.map((item) => ({ letter: item.letter, before: item.currentPrompt, after: parsed[item.letter]?.trim() || "" }));
      const invalid = next.find((item) => validateOptimizedPrompt(item.letter, item.after));
      if (invalid) throw new Error(`${invalid.letter} 的优化结果不完整，已拒绝整批应用`);
      setOptimizationDiff(next);
    } catch (error) { message.error(error instanceof Error ? error.message : "批量优化失败"); }
    finally { setOptimizingAll(false); }
  };

  const uploadReference = async (file: File) => {
    if (![/^image\/(png|jpeg|webp)$/].some((pattern) => pattern.test(file.type))) { message.error("仅支持 PNG、JPEG、WebP"); return false; }
    if (file.size > 50 * 1024 * 1024) { message.error("参考图不能超过 50 MB"); return false; }
    const fp = await fingerprintBlob(file);
    setReferenceBlob(file); setReferenceName(file.name); setReferenceFingerprint(fp);
    setSettings((value) => ({ ...value, cropZoom: 1, cropX: 0, cropY: 0 })); setPreview({ kind: "reference" }); return false;
  };

  const downloadTask = async (task: AiPetLetterTask) => {
    if (!task.result) return;
    message.loading({ content: `正在准备 ${task.letter}.png`, key: "ai-pet-download", duration: 0 });
    const useTransparent = settings.downloadVariant === "transparent" && task.result.outputMode === "transparent-colorize";
    try { downloadBlob(await resizeForDownload(useTransparent ? task.result.rawBlob : task.result.compositeBlob, settings.downloadSize), `${task.letter}${useTransparent ? "_透明" : ""}.png`); message.success({ content: "下载已开始", key: "ai-pet-download" }); }
    catch (error) { message.error({ content: error instanceof Error ? error.message : "导出失败", key: "ai-pet-download" }); }
  };
  const downloadSelected = async () => {
    const selected = tasks.filter((task) => selectedResults.includes(task.letter) && task.result);
    if (!selected.length) { message.warning("请先选择结果"); return; }
    const zip = new JSZip();
    for (const task of selected) {
      const useTransparent = settings.downloadVariant === "transparent" && task.result!.outputMode === "transparent-colorize";
      zip.file(`${task.letter}${useTransparent ? "_透明" : ""}.png`, await resizeForDownload(useTransparent ? task.result!.rawBlob : task.result!.compositeBlob, settings.downloadSize));
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), "AI萌宠字母贴纸.zip");
  };

  const finished = tasks.filter((task) => ["success", "failed", "stopped", "interrupted"].includes(task.status)).length;
  const statusCounts = Object.fromEntries(["success", "failed", "stopped"].map((status) => [status, tasks.filter((task) => task.status === status).length]));
  const successful = tasks.filter((task) => task.result);
  const oldReference = successful.some((task) => task.result?.referenceFingerprint !== currentReferenceFingerprint);

  const inspector = <div className="ai-pet-letter-settings">
    <Title level={4}>生成设置</Title>
    <Text type="secondary">使用右上角 OpenAI Key 与全局请求控制台</Text>
    <label>图片模型</label>
    <Select value={settings.model} options={["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"].map((value) => ({ value, label: value }))} onChange={(model) => { const quality = normalizeQuality(model, settings.quality); setSettings((value) => ({ ...value, model, quality })); if (quality !== settings.quality) message.info("GPT Image 2 最高使用 high，已自动调整"); }} />
    <label>生成质量</label><Select value={settings.quality} options={qualityOptions(settings.model).map((value) => ({ value, label: value }))} onChange={(quality) => setSettings((value) => ({ ...value, quality }))} />
    <label>并发数：{settings.concurrency}</label><Slider min={1} max={6} value={settings.concurrency} onChange={(concurrency) => setSettings((value) => ({ ...value, concurrency }))} />
    <label>背景生成模式</label>
    <Segmented block value={settings.outputMode} options={[{ label: "直接生成底色", value: "direct-background" }, { label: "透明图后上色", value: "transparent-colorize" }]} onChange={(outputMode) => {
      const nextMode = outputMode as AiPetLetterSettings["outputMode"];
      setSettings((value) => ({ ...value, outputMode: nextMode, downloadVariant: nextMode === "direct-background" ? "colorized" : value.downloadVariant }));
      setPrompts((items) => items.map((item) => ({ ...item, defaultPrompt: adaptPromptOutputMode(item.defaultPrompt, nextMode), currentPrompt: adaptPromptOutputMode(item.currentPrompt, nextMode) })));
    }} />
    {settings.outputMode === "transparent-colorize" ? <>
      <label>上色背景</label>
      <Space.Compact block><ColorPicker value={settings.backgroundColor} onChangeComplete={(color) => setSettings((value) => ({ ...value, backgroundColor: color.toHexString() }))} /><Input aria-label="上色背景色" value={settings.backgroundColor} onChange={(event) => setSettings((value) => ({ ...value, backgroundColor: event.target.value }))} onBlur={() => setSettings((value) => ({ ...value, backgroundColor: normalizeHexColor(value.backgroundColor) }))} /></Space.Compact>
      <label>下载内容</label><Segmented block value={settings.downloadVariant} options={[{ label: "上色成品", value: "colorized" }, { label: "AI 透明原图", value: "transparent" }]} onChange={(downloadVariant) => setSettings((value) => ({ ...value, downloadVariant: downloadVariant as AiPetLetterSettings["downloadVariant"] }))} />
      <Alert type="info" showIcon message="AI 生成透明 PNG，页面再用所选颜色铺底；透明原图与上色成品都会保留。" />
    </> : <Alert type="info" showIcon message="当前模式由 AI 直接生成包含背景底色的完整图片。" />}
    <label>下载尺寸</label><Segmented block value={settings.downloadSize} onChange={(downloadSize) => setSettings((value) => ({ ...value, downloadSize: downloadSize as "native" | "high-res" }))} options={[{ label: "AI 原生 3840×2160", value: "native" }, { label: "高清 7717×4346", value: "high-res" }]} />
    <Alert type="info" showIcon message="高清档为本地高质量放大，不会增加 AI 原生细节。费用按 OpenAI 实际账单计费。" />
    <label>参考图裁切缩放：{settings.cropZoom.toFixed(2)}×</label><Slider min={1} max={2} step={0.01} value={settings.cropZoom} onChange={(cropZoom) => setSettings((value) => ({ ...value, cropZoom }))} />
    <label>水平位置</label><Slider min={-1} max={1} step={0.01} value={settings.cropX} onChange={(cropX) => setSettings((value) => ({ ...value, cropX }))} />
    <label>垂直位置</label><Slider min={-1} max={1} step={0.01} value={settings.cropY} onChange={(cropY) => setSettings((value) => ({ ...value, cropY }))} />
    <div className="ai-pet-letter-select-all"><Checkbox checked={prompts.every((item) => item.selected)} indeterminate={prompts.some((item) => item.selected) && !prompts.every((item) => item.selected)} onChange={(event) => setPrompts((items) => items.map((item) => ({ ...item, selected: event.target.checked })))}>生成 A–Z</Checkbox><Text>{prompts.filter((item) => item.selected).length} 张</Text></div>
    <div className="ai-pet-letter-grid">{prompts.map((item) => <Checkbox key={item.letter} checked={item.selected} onChange={(event) => setPrompts((items) => items.map((value) => value.letter === item.letter ? { ...value, selected: event.target.checked } : value))}>{item.letter}</Checkbox>)}</div>
  </div>;

  if (!active && !hydrated) return null;
  return <div className="ai-pet-letter-page">
    <section className="ai-pet-letter-hero">
      <div><Tag color="purple">整幅 AI 生成</Tag><Title level={2}>AI 萌宠字母贴纸</Title><Text type="secondary">整幅画面统一交给 AI 重新生成，不做局部拼接；支持直接生成底色，或生成透明 PNG 后在本地上色。</Text></div>
      <Space wrap>
        <Upload showUploadList={false} beforeUpload={uploadReference} accept="image/png,image/jpeg,image/webp"><Button icon={<CloudUploadOutlined />}>替换参考图</Button></Upload>
        <Button onClick={() => void loadDefault()}>恢复默认图</Button>
        <Button icon={<ThunderboltOutlined />} loading={optimizingAll} onClick={() => void optimizeAll()}>AI 优化全部提示词</Button>
        {running ? <Button danger icon={<StopOutlined />} onClick={stop}>停止全部</Button> : <Button type="primary" icon={<CheckOutlined />} disabled={!prompts.some((item) => item.selected)} onClick={() => void processLetters(prompts.filter((item) => item.selected).map((item) => item.letter))}>生成已选字母</Button>}
      </Space>
    </section>
    {oldReference && <Alert type="warning" showIcon message="部分结果属于旧参考图；重新生成前请按结果指纹区分。" />}
    <section className="ai-pet-letter-stats">
      <Statistic title="总体进度" value={tasks.length ? `${finished}/${tasks.length}` : "0/0"} />
      <Statistic title="成功" value={statusCounts.success || 0} />
      <Statistic title="失败" value={statusCounts.failed || 0} />
      <Statistic title="停止 / 中断" value={(statusCounts.stopped || 0) + tasks.filter((task) => task.status === "interrupted").length} />
      <Statistic title="预计图片请求" value={prompts.filter((item) => item.selected).length} />
      <Statistic title="请求 / 重试" value={`${requestCount} / ${retryCount}`} />
      <Statistic title="开始时间" value={startedAt ? new Date(startedAt).toLocaleTimeString() : "—"} />
      <Statistic title="总耗时" value={elapsed(startedAt, running ? undefined : tasks.reduce((max, item) => Math.max(max, item.endedAt || 0), 0) || undefined)} />
    </section>
    {!!tasks.length && <Progress percent={Math.round(finished / tasks.length * 100)} status={statusCounts.failed ? "exception" : running ? "active" : "normal"} />}
    <section className="ai-pet-letter-main">
      <Card className="ai-pet-letter-preview" title={preview.kind === "reference" ? referenceName : `${preview.letter} · 生成结果`} extra={preview.letter && <Segmented value={preview.kind} onChange={(kind) => setPreview({ kind: kind as "reference" | "raw", letter: preview.letter })} options={[{ label: "参考图", value: "reference" }, { label: "生成结果", value: "raw" }]} />}>
        {previewUrl ? <Image src={previewUrl} preview={preview.kind === "reference" ? { mask: "点击放大" } : false} onClick={preview.kind === "raw" && preview.letter ? () => setEnlarged({ letter: preview.letter!, current: 0 }) : undefined} /> : <Empty description="暂无可预览图片" />}
      </Card>
    </section>
    <Card title="A–Z 最终提示词" extra={<Space wrap><Text type="secondary">界面文字会逐字提交，不追加隐藏提示词</Text><Button size="small" onClick={() => setPrompts((items) => items.map((item) => ({ ...item, selected: true })))}>全选</Button><Button size="small" onClick={() => setPrompts((items) => items.map((item) => ({ ...item, selected: false })))}>取消全选</Button></Space>}>
      <Collapse items={prompts.map((item) => ({ key: item.letter, label: <Space><Checkbox checked={item.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => setPrompts((items) => items.map((value) => value.letter === item.letter ? { ...value, selected: event.target.checked } : value))} /><Tag color="blue">{item.letter}</Tag><Text type="secondary">{statusLabel(tasks.find((task) => task.letter === item.letter)?.status)}</Text></Space>, children: <><Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={3000} showCount value={item.currentPrompt} onChange={(event) => setPrompts((items) => items.map((value) => value.letter === item.letter ? { ...value, currentPrompt: event.target.value } : value))} /><Space className="ai-pet-prompt-actions"><Button icon={<ReloadOutlined />} onClick={() => setPrompts((items) => items.map((value) => value.letter === item.letter ? { ...value, currentPrompt: adaptPromptOutputMode(defaultPromptForLetter(item.letter), settings.outputMode) } : value))}>恢复默认</Button><Button loading={item.optimizing} icon={<ThunderboltOutlined />} onClick={() => void optimizeOne(item.letter)}>AI 优化</Button>{tasks.find((task) => task.letter === item.letter)?.status === "running" && <Button danger onClick={() => controllers.current.get(item.letter)?.abort()}>停止此图</Button>}<Button onClick={() => void processLetters([item.letter], true)}>重新生成</Button></Space></> }))} />
    </Card>
    <Card title="生成结果" extra={<Space><Checkbox checked={successful.length > 0 && successful.every((item) => selectedResults.includes(item.letter))} onChange={(event) => setSelectedResults(event.target.checked ? successful.map((item) => item.letter) : [])}>全选已有结果</Checkbox><Button icon={<DownloadOutlined />} onClick={() => void downloadSelected()}>下载所选（{selectedResults.length}）</Button><Button disabled={!tasks.some((task) => task.status === "failed" || task.status === "interrupted")} onClick={() => void processLetters(tasks.filter((task) => task.status === "failed" || task.status === "interrupted").map((task) => task.letter), true)}>重试失败</Button><Popconfirm title="清空所有生成任务和结果？" onConfirm={() => { stop(); setTasks([]); setSelectedResults([]); setPreview({ kind: "reference" }); }}><Button danger icon={<DeleteOutlined />}>清空结果</Button></Popconfirm></Space>}>
      {tasks.length ? <div className="ai-pet-letter-gallery">{tasks.map((task) => <Card key={`${task.letter}-${task.result?.createdAt || 0}`} size="small" className="ai-pet-letter-result" cover={task.result ? <ResultCover blob={task.result.compositeBlob} letter={task.letter} onOpen={() => setEnlarged({ letter: task.letter, current: 0 })} /> : <div className="ai-pet-letter-placeholder"><strong>{task.letter}</strong><span>{task.status === "running" ? "生成中…" : task.error || statusLabel(task.status)}</span></div>} actions={task.result ? [<Button type="text" key="view" onClick={() => { setPreview({ kind: "raw", letter: task.letter }); setCompareLetter(task.letter); }}>对比</Button>, <Button type="text" key="download" onClick={() => void downloadTask(task)}>下载</Button>, <Button type="text" key="retry" onClick={() => void processLetters([task.letter], true)}>重生</Button>] : undefined}><Card.Meta title={<Space><Checkbox checked={selectedResults.includes(task.letter)} disabled={!task.result} onChange={(event) => setSelectedResults((items) => event.target.checked ? [...new Set([...items, task.letter])] : items.filter((letter) => letter !== task.letter))} />{task.letter}<Tag color={task.status === "success" ? "success" : task.status === "failed" ? "error" : "default"}>{statusLabel(task.status)}</Tag></Space>} description={task.result && task.result.referenceFingerprint !== currentReferenceFingerprint ? "旧参考图" : task.result?.outputMode === "transparent-colorize" ? `透明原图 · ${task.result.backgroundColor || "#00aeff"} 上色` : task.retries ? `重试 ${task.retries} 次` : ""} /></Card>)}</div> : <Empty description="尚未生成；可以先编辑 26 条提示词" />}
    </Card>
    {enlarged && detailResultUrl && referenceCompareUrl ? <Image.PreviewGroup
      items={[{ src: detailResultUrl, alt: `${enlarged.letter} 生成结果` }, { src: referenceCompareUrl, alt: "本次参考图" }, ...(detailTask?.result?.outputMode === "transparent-colorize" && detailRawUrl ? [{ src: detailRawUrl, alt: `${enlarged.letter} AI 透明原图` }] : [])]}
      preview={{
        open: true,
        current: enlarged.current,
        onChange: (current) => setEnlarged((value) => value ? { ...value, current } : value),
        onOpenChange: (open) => { if (!open) setEnlarged(undefined); },
        countRender: (current) => current === 1 ? `${enlarged.letter} · 上色成品` : current === 2 ? "参考图" : "AI 透明原图",
        actionsRender: (originalNode, info) => <>{originalNode}<Tooltip title={info.current === 0 ? "切换到参考图" : "切换到生成结果"}><button type="button" aria-label={info.current === 0 ? "切换到参考图" : "切换到生成结果"} className="scene-preview-compare-action" onClick={(event) => { event.stopPropagation(); setEnlarged((value) => value ? { ...value, current: info.current === 0 ? 1 : 0 } : value); }}><SwapOutlined /></button></Tooltip></>,
      }}
    /> : null}
    <Modal width={1180} open={Boolean(compareLetter)} title={`${compareLetter || ""} · 生成结果与参考图对比`} onCancel={() => setCompareLetter(undefined)} footer={<Button onClick={() => setCompareLetter(undefined)}>关闭</Button>}>
      {detailResultUrl && referenceCompareUrl ? <div className="ai-pet-letter-compare-grid">
        <figure><figcaption>生成结果（点击继续放大）</figcaption><Image preview={false} src={detailResultUrl} alt={`${compareLetter || ""} 生成结果`} onClick={() => compareLetter && setEnlarged({ letter: compareLetter, current: 0 })} /></figure>
        <figure><figcaption>本次参考图（点击继续放大）</figcaption><Image preview={false} src={referenceCompareUrl} alt="本次参考图" onClick={() => compareLetter && setEnlarged({ letter: compareLetter, current: 1 })} /></figure>
        {detailTask?.result?.outputMode === "transparent-colorize" && detailRawUrl ? <figure><figcaption>AI 透明原图（点击继续放大）</figcaption><Image preview={false} src={detailRawUrl} alt={`${compareLetter || ""} AI 透明原图`} onClick={() => compareLetter && setEnlarged({ letter: compareLetter, current: 2 })} /></figure> : null}
      </div> : <Empty description="暂无可对比图片" />}
      {detailTask?.result?.outputMode === "transparent-colorize" && detailRawUrl ? <Alert className="ai-pet-letter-transparent-note" type="info" showIcon message="此结果同时保留 AI 透明原图；可在右侧将下载内容切换为“AI 透明原图”。" /> : null}
    </Modal>
    {settingsHost ? createPortal(inspector, settingsHost) : null}
    <Modal width={920} title="批量提示词优化对比" open={optimizationDiff.length > 0} onCancel={() => setOptimizationDiff([])} onOk={() => { const byLetter = new Map(optimizationDiff.map((item) => [item.letter, item.after])); setPrompts((items) => items.map((item) => ({ ...item, currentPrompt: byLetter.get(item.letter) || item.currentPrompt }))); setOptimizationDiff([]); }} okText="应用全部">
      <div className="ai-pet-optimization-diff">{optimizationDiff.map((item) => <Collapse key={item.letter} items={[{ key: item.letter, label: `${item.letter} · 查看修改`, children: <div className="ai-pet-diff-columns"><div><Text strong>修改前</Text><p>{item.before}</p></div><div><Text strong>修改后</Text><p>{item.after}</p></div></div> }]} />)}</div>
    </Modal>
  </div>;
}
