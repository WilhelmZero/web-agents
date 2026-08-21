import {
  CheckCircleOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FolderOpenOutlined, PauseCircleOutlined,
  PlayCircleOutlined, ReloadOutlined, StopOutlined,
} from '@ant-design/icons';
import {
  Alert, App, Button, Card, Col, Divider, Empty, Flex, Form, Image, Input, InputNumber, Modal, Popconfirm,
  Progress, Row, Segmented, Select, Space, Statistic, Switch, Tag, Timeline, Typography, Upload,
} from 'antd';
import JSZip from 'jszip';
import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OriginalCompareImage from './OriginalCompareImage';
import { MODEL_CAPABILITIES } from './constants';
import { desktopAssetFromFile, isElectronDesktop, submitDesktopJob } from './desktop/runtime';
import { reportTaskProgress } from './services/taskProgress';
import {
  DEFAULT_LOGO_REMOVAL_PROMPT, analyzeLogoRemovalTarget, buildLogoRemovalGenerationPrompt, generateLogoRemoval,
  verifyLogoRemoval,
} from './services/logoRemoval';
import {
  putLogoRemovalResult, readLatestLogoRemovalDraft, readLogoRemovalResult,
  saveLogoRemovalDraft,
} from './services/logoRemovalStore';
import type { ImageModel, ImageSize, LogoRemovalAnalysis, LogoRemovalSettings, LogoRemovalTask, LogoRemovalVerification, OptimizerModel } from './types';
import { downloadBlob, mimeExtension, sanitizeFileName } from './utils';

const { Title, Text, Paragraph } = Typography;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SETTINGS_KEY = 'scene-studio.logo-removal.settings.v1';

interface FolderGroup { id: string; name: string; path: string; files: File[] }
interface StoredDraft { groups: FolderGroup[]; tasks: LogoRemovalTask[]; settings: LogoRemovalSettings }

const DEFAULT_SETTINGS: LogoRemovalSettings = {
  scope: 'cup-body', analysisProvider: 'gemini', analysisModel: 'gemini-3.1-flash-lite', openAiAnalysisModel: 'gpt-5.6-luna',
  imageProvider: 'gemini', imageModel: 'gemini-3.1-flash-image', openAiImageModel: 'gpt-image-2', imageSize: '1K',
  verificationEnabled: true, verificationProvider: 'gemini', verificationModel: 'gemini-3.1-flash-lite', openAiVerificationModel: 'gpt-5.6-luna',
  prompt: DEFAULT_LOGO_REMOVAL_PROMPT, concurrency: 2, copiesPerImage: 1, verificationRetries: 2,
  autoRetryErrors: true, errorRetryLimit: 2, errorRetryDelaySeconds: 30,
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } as LogoRemovalSettings; }
  catch { return DEFAULT_SETTINGS; }
}

function relativePath(file: File) { return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name; }
function fileKey(file: File) { return `${relativePath(file)}:${file.size}:${file.lastModified}`; }

export function groupLogoRemovalFiles(files: File[]) {
  const groups = new Map<string, FolderGroup>();
  files.filter((file) => IMAGE_TYPES.has(file.type)).forEach((file) => {
    const parts = relativePath(file).split('/').filter(Boolean);
    const path = parts.slice(0, -1).join('/') || '未分组';
    const current = groups.get(path) || { id: encodeURIComponent(path), name: parts.at(-2) || '未分组', path, files: [] };
    if (!current.files.some((item) => fileKey(item) === fileKey(file))) current.files.push(file);
    groups.set(path, current);
  });
  return Array.from(groups.values());
}

const LazyFileImage = memo(function LazyFileImage({ file, className }: { file: File; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url); }, [file]);
  return src ? <img src={src} alt={file.name} className={className} loading="lazy" /> : null;
});

function TaskResultImage({ resultKey, original, onOpen }: { resultKey?: string; original: File; onOpen: () => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true; let url = '';
    if (resultKey) void readLogoRemovalResult(resultKey).then((value) => { if (!active || !value) return; url = URL.createObjectURL(value.blob); setSrc(url); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [resultKey]);
  return src ? <button type="button" className="logo-removal-result-button" onClick={onOpen}><img src={src} alt="去除 Logo 结果" loading="lazy" /><span><EyeOutlined /> 查看与对比</span></button> : <LazyFileImage file={original} className="logo-removal-result-placeholder" />;
}

function ResultPreview({ open, tasks, files, initialIndex, onClose }: { open: boolean; tasks: LogoRemovalTask[]; files: Map<string, File>; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  useEffect(() => { if (open) setIndex(initialIndex); }, [initialIndex, open]);
  const task = tasks[index]; const original = task ? files.get(task.sourceRelativePath) : undefined;
  useEffect(() => {
    if (!open || !task || !original) return;
    const sourceUrl = URL.createObjectURL(original); setOriginalUrl(sourceUrl); let resultUrl = ''; let active = true;
    if (task.resultKey) void readLogoRemovalResult(task.resultKey).then((value) => { if (!active || !value) return; resultUrl = URL.createObjectURL(value.blob); setGeneratedUrl(resultUrl); });
    return () => { active = false; URL.revokeObjectURL(sourceUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); setGeneratedUrl(''); setOriginalUrl(''); };
  }, [open, original, task]);
  return <Modal width="min(1100px, 94vw)" open={open} onCancel={onClose} footer={null} title={task?.sourceName || '结果预览'} destroyOnHidden>
    {task && generatedUrl ? <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Button disabled={index <= 0} onClick={() => setIndex((value) => value - 1)}>上一张</Button>
        <Space><Tag>{index + 1}/{tasks.length}</Tag>{task.status === 'skipped' && <Tag color="gold">无需处理</Tag>}{task.markedUsable && <Tag color="green">已标记可用</Tag>}</Space>
        <Button disabled={index >= tasks.length - 1} onClick={() => setIndex((value) => value + 1)}>下一张</Button>
      </Flex>
      <div className="logo-removal-preview-stage"><OriginalCompareImage src={generatedUrl} originalSrc={originalUrl} alt={task.sourceName} /></div>
      <Row gutter={16} style={{ marginTop: 16 }}><Col span={12}><Text strong>原图</Text><Image src={originalUrl} /></Col><Col span={12}><Text strong>生成图</Text><Image src={generatedUrl} /></Col></Row>
    </> : <Empty description="正在读取缓存图片" />}
  </Modal>;
}

export default function LogoRemovalComposer(props: { apiKey: string; openAiApiKey: string; apiBaseUrl?: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; settingsHost?: HTMLElement | null }) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState(loadSettings);
  const [groups, setGroups] = useState<FolderGroup[]>([]);
  const [tasks, setTasks] = useState<LogoRemovalTask[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [running, setRunning] = useState(false); const [paused, setPaused] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [timelineTaskId, setTimelineTaskId] = useState<string>();
  const runningIds = useRef(new Set<string>()); const controllers = useRef(new Map<string, AbortController>());
  const analysisPromises = useRef(new Map<string, Promise<LogoRemovalAnalysis>>());
  const filesByPath = useMemo(() => new Map(groups.flatMap((group) => group.files.map((file) => [relativePath(file), file] as const))), [groups]);
  const resultTasks = useMemo(() => tasks.filter((task) => task.resultKey), [tasks]);

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { if (groups.length || tasks.length) void saveLogoRemovalDraft<StoredDraft>(sessionId, { groups, tasks, settings }); }, [groups, sessionId, settings, tasks]);
  useEffect(() => {
    const completed = tasks.filter((task) => ['success', 'skipped'].includes(task.status)).length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    reportTaskProgress({ id: 'logo-removal', label: '去除 Logo', total: tasks.length, completed, failed, running: runningIds.current.size > 0 });
    return () => reportTaskProgress({ id: 'logo-removal', label: '去除 Logo', total: 0, completed: 0, failed: 0, running: false });
  }, [tasks]);

  const patchTask = useCallback((id: string, patch: Partial<LogoRemovalTask> | ((task: LogoRemovalTask) => Partial<LogoRemovalTask>)) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...(typeof patch === 'function' ? patch(task) : patch) } : task));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const incoming = groupLogoRemovalFiles(files);
    if (!incoming.length) return void message.warning('没有识别到 PNG、JPEG 或 WebP 图片');
    setGroups((current) => {
      const map = new Map(current.map((group) => [group.path, group]));
      incoming.forEach((group) => { const existing = map.get(group.path); map.set(group.path, existing ? { ...existing, files: [...existing.files, ...group.files.filter((file) => !existing.files.some((old) => fileKey(old) === fileKey(file)))] } : group); });
      return Array.from(map.values());
    });
  }, [message]);

  const createTasks = useCallback(() => groups.flatMap((group) => group.files.flatMap((file) => Array.from({ length: settings.copiesPerImage }, (_, copyIndex): LogoRemovalTask => ({
    id: crypto.randomUUID(), groupId: group.id, sourceName: file.name, sourceRelativePath: relativePath(file), copyIndex,
    status: 'waiting', stage: '等待分析', attempts: [], retryCount: 0,
  })))), [groups, settings.copiesPerImage]);

  const analyzeFile = useCallback((file: File, controller: AbortController) => {
    const key = fileKey(file);
    const existing = analysisPromises.current.get(key); if (existing) return existing;
    const promise = analyzeLogoRemovalTarget({ settings, apiKey: props.apiKey, openAiApiKey: props.openAiApiKey, apiBaseUrl: props.apiBaseUrl, scene: file, signal: controller.signal }).finally(() => analysisPromises.current.delete(key));
    analysisPromises.current.set(key, promise); return promise;
  }, [props.apiBaseUrl, props.apiKey, props.openAiApiKey, settings]);

  const runTask = useCallback(async (task: LogoRemovalTask) => {
    const file = filesByPath.get(task.sourceRelativePath); if (!file) return patchTask(task.id, { status: 'failed', stage: '源文件丢失', error: '无法读取原图' });
    const controller = new AbortController(); controllers.current.set(task.id, controller); runningIds.current.add(task.id);
    try {
      patchTask(task.id, { status: 'analyzing', stage: '分析目标 Logo', error: undefined });
      const analysis = task.analysis || await analyzeFile(file, controller);
      patchTask(task.id, { analysis });
      if (analysis.action === 'skip_no_target') {
        const key = `${sessionId}:${task.id}:original`;
        await putLogoRemovalResult({ key, sessionId, groupId: task.groupId, taskId: task.id, kind: 'result', blob: file, mimeType: file.type });
        patchTask(task.id, { status: 'skipped', stage: '无需处理，已保留原图', resultKey: key, resultMimeType: file.type, error: undefined }); return;
      }
      let feedback = ''; let finalBlob: Blob | undefined; let finalMime = 'image/png'; let lastVerification: LogoRemovalVerification | undefined;
      for (let verificationAttempt = 0; verificationAttempt <= settings.verificationRetries; verificationAttempt += 1) {
        if (controller.signal.aborted) throw new DOMException('任务已停止', 'AbortError');
        const attemptId = crypto.randomUUID(); const prompt = buildLogoRemovalGenerationPrompt(settings, analysis, feedback);
        patchTask(task.id, (current) => ({ status: 'running', stage: verificationAttempt ? `自动修复 ${verificationAttempt}/${settings.verificationRetries}` : '去除 Logo', attempts: [...current.attempts, { id: attemptId, index: current.attempts.length + 1, startedAt: Date.now(), status: 'running', prompt, model: settings.imageProvider === 'openai' ? settings.openAiImageModel : settings.imageModel }] }));
        const generated = await generateLogoRemoval({ settings, apiKey: props.apiKey, openAiApiKey: props.openAiApiKey, apiBaseUrl: props.apiBaseUrl, scene: file, analysis, repairFeedback: feedback, signal: controller.signal });
        const attemptKey = `${sessionId}:${task.id}:attempt:${attemptId}`;
        await putLogoRemovalResult({ key: attemptKey, sessionId, groupId: task.groupId, taskId: task.id, kind: 'attempt', blob: generated.blob, mimeType: generated.mimeType });
        if (!settings.verificationEnabled) { finalBlob = generated.blob; finalMime = generated.mimeType; patchTask(task.id, (current) => ({ attempts: current.attempts.map((item) => item.id === attemptId ? { ...item, status: 'passed', endedAt: Date.now(), resultKey: attemptKey } : item) })); break; }
        patchTask(task.id, { status: 'verifying', stage: '校验去除结果' });
        lastVerification = await verifyLogoRemoval({ settings, apiKey: props.apiKey, openAiApiKey: props.openAiApiKey, apiBaseUrl: props.apiBaseUrl, originalScene: file, generatedImage: generated.blob, analysis, signal: controller.signal });
        patchTask(task.id, (current) => ({ attempts: current.attempts.map((item) => item.id === attemptId ? { ...item, status: lastVerification?.passed ? 'passed' : 'failed', endedAt: Date.now(), resultKey: attemptKey, verification: lastVerification } : item) }));
        if (lastVerification.passed) { finalBlob = generated.blob; finalMime = generated.mimeType; break; }
        feedback = [...lastVerification.differences, lastVerification.summary].filter(Boolean).join('；');
      }
      if (!finalBlob) throw new Error(lastVerification?.summary || '达到自动修复上限，校验仍未通过');
      const resultKey = `${sessionId}:${task.id}:result`;
      await putLogoRemovalResult({ key: resultKey, sessionId, groupId: task.groupId, taskId: task.id, kind: 'result', blob: finalBlob, mimeType: finalMime });
      patchTask(task.id, { status: 'success', stage: '已完成', resultKey, resultMimeType: finalMime, error: undefined });
    } catch (error) {
      const stopped = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (stopped) patchTask(task.id, { status: 'stopped', stage: '已停止', error: '用户已停止该任务' });
      else if (settings.autoRetryErrors && task.retryCount < settings.errorRetryLimit) {
        patchTask(task.id, { status: 'retry_wait', stage: `等待 ${settings.errorRetryDelaySeconds} 秒后自动重试`, retryCount: task.retryCount + 1, error: error instanceof Error ? error.message : '任务失败' });
        window.setTimeout(() => patchTask(task.id, (current) => current.status === 'retry_wait' ? { status: 'waiting', stage: '等待自动重试' } : {}), settings.errorRetryDelaySeconds * 1000);
      } else patchTask(task.id, { status: 'failed', stage: '最终失败', error: error instanceof Error ? error.message : '任务失败' });
    } finally { controllers.current.delete(task.id); runningIds.current.delete(task.id); }
  }, [analyzeFile, filesByPath, patchTask, props.apiBaseUrl, props.apiKey, props.openAiApiKey, sessionId, settings]);

  useEffect(() => {
    if (!running || paused) return;
    const available = settings.concurrency - runningIds.current.size; if (available <= 0) return;
    const pending = tasks.filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id)).slice(0, available);
    pending.forEach((task) => void runTask(task));
    if (!pending.length && runningIds.current.size === 0 && tasks.length && tasks.every((task) => ['success', 'failed', 'stopped', 'skipped'].includes(task.status))) setRunning(false);
  }, [paused, runTask, running, settings.concurrency, tasks]);

  const start = useCallback(async () => {
    if (!groups.length) return void message.warning('请先选择包含图片的文件夹');
    const providerNeeds = [settings.analysisProvider, settings.imageProvider, ...(settings.verificationEnabled ? [settings.verificationProvider] : [])];
    if (providerNeeds.includes('gemini') && !props.apiKey || providerNeeds.includes('openai') && !props.openAiApiKey) return props.onRequestKey();
    if (isElectronDesktop()) {
      const outputRoot = await window.desktop?.pickOutputDirectory(); if (!outputRoot) return;
      const id = await submitDesktopJob({ name: `去除 Logo ${new Date().toLocaleString()}`, outputRoot, globalConcurrency: settings.concurrency, apiBaseUrl: props.apiBaseUrl, groups: groups.map((group) => ({ id: group.id, name: group.name, relativePath: group.path, scenes: group.files.map(desktopAssetFromFile) })), config: { tool: 'logo-removal', settings } });
      window.dispatchEvent(new Event('desktop-task-created')); message.success(`后台任务已创建：${id}`); return;
    }
    setTasks((current) => current.length ? current.map((task) => ['failed', 'stopped'].includes(task.status) ? { ...task, status: 'waiting', stage: '等待重试', error: undefined } : task) : createTasks());
    setPaused(false); setRunning(true);
  }, [createTasks, groups, message, props, settings]);

  const stopTask = (id: string) => { controllers.current.get(id)?.abort(); patchTask(id, { status: 'stopped', stage: '已停止' }); };
  const stopAll = () => { setRunning(false); controllers.current.forEach((controller) => controller.abort()); setTasks((current) => current.map((task) => ['waiting', 'retry_wait', 'analyzing', 'running', 'verifying'].includes(task.status) ? { ...task, status: 'stopped', stage: '已停止' } : task)); };
  const retryTask = (id: string) => { patchTask(id, { status: 'waiting', stage: '等待重试', error: undefined }); setRunning(true); setPaused(false); };

  const downloadTask = async (task: LogoRemovalTask) => { if (!task.resultKey) return; const value = await readLogoRemovalResult(task.resultKey); if (value) downloadBlob(value.blob, `${sanitizeFileName(task.sourceName)}${settings.copiesPerImage > 1 ? `_${task.copyIndex + 1}` : ''}_去除Logo.${mimeExtension(value.mimeType)}`); };
  const downloadZip = async (groupId?: string) => {
    const zip = new JSZip(); const selected = resultTasks.filter((task) => !groupId || task.groupId === groupId);
    for (const task of selected) { const value = task.resultKey ? await readLogoRemovalResult(task.resultKey) : undefined; const group = groups.find((item) => item.id === task.groupId); if (!value || !group) continue; zip.folder(group.path)?.folder(sanitizeFileName(task.sourceName))?.file(`${sanitizeFileName(task.sourceName)}_${task.copyIndex + 1}_去除Logo.${mimeExtension(value.mimeType)}`, value.blob); }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), groupId ? `${sanitizeFileName(groups.find((item) => item.id === groupId)?.name || '本组')}_去除Logo.zip` : '全部去除Logo结果.zip');
  };

  const restore = async () => { const draft = await readLatestLogoRemovalDraft<StoredDraft>(); if (!draft) return void message.info('没有找到可恢复的缓存任务'); setSessionId(draft.sessionId); setGroups(draft.value.groups || []); setTasks(draft.value.tasks || []); setSettings({ ...DEFAULT_SETTINGS, ...draft.value.settings }); message.success('已恢复最近一次缓存任务'); };

  const stats = useMemo(() => ({ total: tasks.length, done: tasks.filter((task) => ['success', 'skipped'].includes(task.status)).length, failed: tasks.filter((task) => task.status === 'failed').length, skipped: tasks.filter((task) => task.status === 'skipped').length, usable: tasks.filter((task) => task.markedUsable).length }), [tasks]);
  const settingsPanel = <div className="settings-panel"><Flex justify="space-between" align="center"><Title level={4} style={{ margin: 0 }}>去除设置</Title><Tag color="purple">本地缓存</Tag></Flex><Divider />
    <Form layout="vertical">
      <Form.Item label="去除范围"><Select value={settings.scope} onChange={(scope) => setSettings((value) => ({ ...value, scope }))} options={[{ value: 'cup-body', label: '仅杯体表面（默认）' }, { value: 'cup-and-bottom', label: '杯体表面和杯底' }, { value: 'all-product-carriers', label: '所有产品载体' }]} /></Form.Item>
      <Form.Item label="分析模型"><Space.Compact block><Select style={{ width: 100 }} value={settings.analysisProvider} onChange={(analysisProvider) => setSettings((value) => ({ ...value, analysisProvider }))} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} /><Select style={{ width: '100%' }} value={settings.analysisProvider === 'openai' ? settings.openAiAnalysisModel : settings.analysisModel} onChange={(model: string) => setSettings((value) => settings.analysisProvider === 'openai' ? { ...value, openAiAnalysisModel: model as LogoRemovalSettings['openAiAnalysisModel'] } : { ...value, analysisModel: model as OptimizerModel })} options={(settings.analysisProvider === 'openai' ? ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] : ['gemini-3.1-flash-lite', 'gemini-3.1-flash', 'gemini-2.5-flash']).map((value) => ({ value, label: value }))} /></Space.Compact></Form.Item>
      <Form.Item label="图片模型"><Space.Compact block><Select style={{ width: 100 }} value={settings.imageProvider} onChange={(imageProvider) => setSettings((value) => ({ ...value, imageProvider }))} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} /><Select style={{ width: '100%' }} value={settings.imageProvider === 'openai' ? settings.openAiImageModel : settings.imageModel} onChange={(model: string) => setSettings((value) => settings.imageProvider === 'openai' ? { ...value, openAiImageModel: model as LogoRemovalSettings['openAiImageModel'] } : { ...value, imageModel: model as ImageModel })} options={(settings.imageProvider === 'openai' ? ['gpt-image-2', 'gpt-image-2-2026-04-21'] : Object.keys(MODEL_CAPABILITIES)).map((value) => ({ value, label: value }))} /></Space.Compact></Form.Item>
      {settings.imageProvider === 'gemini' && <Form.Item label="输出清晰度"><Segmented block value={settings.imageSize} onChange={(imageSize) => setSettings((value) => ({ ...value, imageSize: imageSize as ImageSize }))} options={['0.5K', '1K', '2K', '4K']} /></Form.Item>}
      <Form.Item label="每张生成份数"><InputNumber min={1} max={4} value={settings.copiesPerImage} onChange={(copiesPerImage) => setSettings((value) => ({ ...value, copiesPerImage: copiesPerImage || 1 }))} style={{ width: '100%' }} /></Form.Item>
      <Form.Item label="全局并发"><InputNumber min={1} max={8} value={settings.concurrency} onChange={(concurrency) => setSettings((value) => ({ ...value, concurrency: concurrency || 1 }))} style={{ width: '100%' }} /></Form.Item>
      <Form.Item label="完整提示词"><Input.TextArea rows={9} value={settings.prompt} onChange={(event) => setSettings((value) => ({ ...value, prompt: event.target.value }))} /></Form.Item>
      <Form.Item label="生成后自动校验"><Switch checked={settings.verificationEnabled} onChange={(verificationEnabled) => setSettings((value) => ({ ...value, verificationEnabled }))} /></Form.Item>
      {settings.verificationEnabled && <><Form.Item label="校验模型"><Space.Compact block><Select style={{ width: 100 }} value={settings.verificationProvider} onChange={(verificationProvider) => setSettings((value) => ({ ...value, verificationProvider }))} options={[{ value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'GPT' }]} /><Select style={{ width: '100%' }} value={settings.verificationProvider === 'openai' ? settings.openAiVerificationModel : settings.verificationModel} onChange={(model: string) => setSettings((value) => settings.verificationProvider === 'openai' ? { ...value, openAiVerificationModel: model as LogoRemovalSettings['openAiVerificationModel'] } : { ...value, verificationModel: model as OptimizerModel })} options={(settings.verificationProvider === 'openai' ? ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] : ['gemini-3.1-flash-lite', 'gemini-3.1-flash', 'gemini-2.5-flash']).map((value) => ({ value, label: value }))} /></Space.Compact></Form.Item><Form.Item label="校验修复次数"><InputNumber min={0} max={5} value={settings.verificationRetries} onChange={(verificationRetries) => setSettings((value) => ({ ...value, verificationRetries: verificationRetries || 0 }))} style={{ width: '100%' }} /></Form.Item></>}
      <Form.Item label="接口失败自动重试"><Switch checked={settings.autoRetryErrors} onChange={(autoRetryErrors) => setSettings((value) => ({ ...value, autoRetryErrors }))} /></Form.Item>
      {settings.autoRetryErrors && <Row gutter={8}><Col span={12}><Form.Item label="次数"><InputNumber min={0} max={10} value={settings.errorRetryLimit} onChange={(errorRetryLimit) => setSettings((value) => ({ ...value, errorRetryLimit: errorRetryLimit || 0 }))} style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item label="间隔（秒）"><InputNumber min={1} max={3600} value={settings.errorRetryDelaySeconds} onChange={(errorRetryDelaySeconds) => setSettings((value) => ({ ...value, errorRetryDelaySeconds: errorRetryDelaySeconds || 30 }))} style={{ width: '100%' }} /></Form.Item></Col></Row>}
    </Form></div>;

  return <section className="logo-removal-composer">
    <div className="logo-removal-hero"><div><Text className="eyebrow">LOGO REMOVAL QUEUE</Text><Title level={2}>批量去除杯身 Logo</Title><Paragraph>多个文件夹在一个页面统一分析、生成、校验和重试，不创建子标签。</Paragraph></div><div className="logo-removal-hero-stat"><strong>{groups.reduce((sum, group) => sum + group.files.length, 0)}</strong><span>张待处理图片</span></div></div>
    <Card title={<Space><FolderOpenOutlined /> 导入图片文件夹</Space>} extra={<Space><Button onClick={() => void restore()}>恢复缓存任务</Button>{groups.length > 0 && <Popconfirm title="移除全部文件夹？" onConfirm={() => { stopAll(); setGroups([]); setTasks([]); setSessionId(crypto.randomUUID()); }}><Button danger icon={<DeleteOutlined />}>移除全部</Button></Popconfirm>}</Space>}>
      <Upload.Dragger directory multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file, fileList) => { if (file.uid === fileList.at(-1)?.uid) addFiles(fileList as File[]); return Upload.LIST_IGNORE; }}><FolderOpenOutlined style={{ fontSize: 40, color: '#7654dd' }} /><p className="ant-upload-text">拖入或选择一个或多个图片文件夹</p><p className="ant-upload-hint">自动按原目录分组，支持 PNG、JPEG、WebP</p></Upload.Dragger>
      {groups.length > 0 && <div className="logo-removal-folder-grid">{groups.map((group) => { const groupTasks = tasks.filter((task) => task.groupId === group.id); return <Card key={group.id} size="small" className="logo-removal-folder-card" cover={group.files[0] ? <LazyFileImage file={group.files[0]} /> : undefined} actions={[<Button type="text" icon={<DownloadOutlined />} disabled={!groupTasks.some((task) => task.resultKey)} onClick={() => void downloadZip(group.id)}>下载本组</Button>, <Popconfirm title="移除该文件夹？" onConfirm={() => { setGroups((current) => current.filter((item) => item.id !== group.id)); setTasks((current) => current.filter((task) => task.groupId !== group.id)); }}><Button type="text" danger icon={<DeleteOutlined />}>移除</Button></Popconfirm>]}><Card.Meta title={group.name} description={<><Text ellipsis={{ tooltip: group.path }}>{group.path}</Text><br /><Tag>{group.files.length} 张</Tag>{groupTasks.length > 0 && <Tag color="blue">{groupTasks.filter((task) => ['success', 'skipped'].includes(task.status)).length}/{groupTasks.length}</Tag>}</>} /></Card>; })}</div>}
    </Card>
    <Card className="logo-removal-control-card"><Flex wrap="wrap" gap={10} justify="space-between" align="center"><Space wrap><Button type="primary" size="large" icon={<PlayCircleOutlined />} onClick={() => void start()}>{tasks.length ? '继续/重试任务' : '分析并开始'}</Button><Button icon={<PauseCircleOutlined />} disabled={!running} onClick={() => setPaused((value) => !value)}>{paused ? '继续' : '暂停'}</Button><Button danger icon={<StopOutlined />} disabled={!running && !tasks.some((task) => ['waiting', 'retry_wait'].includes(task.status))} onClick={stopAll}>停止全部</Button><Button icon={<ReloadOutlined />} disabled={!tasks.some((task) => task.status === 'failed')} onClick={() => { setTasks((current) => current.map((task) => task.status === 'failed' ? { ...task, status: 'waiting', stage: '等待重试', error: undefined } : task)); setRunning(true); }}>重试全部失败</Button></Space><Button icon={<DownloadOutlined />} disabled={!resultTasks.length} onClick={() => void downloadZip()}>下载全部 ZIP</Button></Flex>
      {stats.total > 0 && <><Progress percent={Math.round(stats.done / stats.total * 100)} status={stats.failed ? 'exception' : running ? 'active' : 'normal'} /><Row gutter={16}><Col span={6}><Statistic title="总任务" value={stats.total} /></Col><Col span={6}><Statistic title="完成" value={stats.done} /></Col><Col span={6}><Statistic title="无需处理" value={stats.skipped} /></Col><Col span={6}><Statistic title="可用率" value={stats.done ? stats.usable / stats.done * 100 : 0} precision={1} suffix="%" /></Col></Row></>}
    </Card>
    {tasks.length ? <Card title="任务与结果"><div className="logo-removal-task-grid">{tasks.map((task) => { const file = filesByPath.get(task.sourceRelativePath); const resultIndex = resultTasks.findIndex((item) => item.id === task.id); return <Card key={task.id} size="small" className={`logo-removal-task-card status-${task.status}`} cover={file ? <TaskResultImage resultKey={task.resultKey} original={file} onOpen={() => setPreviewIndex(resultIndex)} /> : undefined} actions={[
          <Button type="text" icon={<ReloadOutlined />} disabled={!['failed', 'stopped'].includes(task.status)} onClick={() => retryTask(task.id)}>重试</Button>,
          <Button type="text" danger icon={<StopOutlined />} disabled={!['waiting', 'retry_wait', 'analyzing', 'running', 'verifying'].includes(task.status)} onClick={() => stopTask(task.id)}>终止</Button>,
          <Button type="text" icon={<DownloadOutlined />} disabled={!task.resultKey} onClick={() => void downloadTask(task)}>下载</Button>,
          <Button type="text" disabled={!task.attempts.length} onClick={() => setTimelineTaskId(task.id)}>时间线</Button>,
        ]}><Flex justify="space-between"><Text strong ellipsis={{ tooltip: task.sourceName }}>{task.sourceName}</Text><Tag color={task.status === 'success' ? 'green' : task.status === 'skipped' ? 'gold' : task.status === 'failed' ? 'red' : ['running', 'analyzing', 'verifying'].includes(task.status) ? 'processing' : 'default'}>{task.stage}</Tag></Flex>{task.analysis && <Paragraph ellipsis={{ rows: 2, expandable: true }}>{task.analysis.summary || task.analysis.reason}</Paragraph>}{task.error && <Alert type="error" title={task.error} showIcon />}{task.resultKey && <Flex justify="space-between" style={{ marginTop: 8 }}><Button size="small" type={task.markedUsable ? 'primary' : 'default'} icon={<CheckCircleOutlined />} onClick={() => patchTask(task.id, { markedUsable: !task.markedUsable })}>标记可用</Button><Text type="secondary">{task.attempts.length} 次尝试</Text></Flex>}</Card>; })}</div></Card> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="导入文件夹后开始处理" />}
    <ResultPreview open={previewIndex >= 0} tasks={resultTasks} files={filesByPath} initialIndex={Math.max(0, previewIndex)} onClose={() => setPreviewIndex(-1)} />
    <Modal width="min(860px, 94vw)" open={Boolean(timelineTaskId)} onCancel={() => setTimelineTaskId(undefined)} footer={null} title="生成尝试时间线" destroyOnHidden>
      {(() => {
        const task = tasks.find((item) => item.id === timelineTaskId);
        if (!task?.attempts.length) return <Empty description="暂无生成尝试" />;
        return <Timeline items={task.attempts.map((attempt) => ({
          color: attempt.status === 'passed' ? 'green' : attempt.status === 'failed' ? 'red' : 'blue',
          children: <Card size="small" title={`第 ${attempt.index} 次 · ${attempt.model}`} extra={<Tag color={attempt.status === 'passed' ? 'green' : attempt.status === 'failed' ? 'red' : 'processing'}>{attempt.status === 'passed' ? '通过' : attempt.status === 'failed' ? '未通过' : '执行中'}</Tag>}>
            <Text type="secondary">{new Date(attempt.startedAt).toLocaleString()}{attempt.endedAt ? ` · ${Math.max(0, ((attempt.endedAt - attempt.startedAt) / 1000)).toFixed(1)} 秒` : ''}</Text>
            <Paragraph copyable ellipsis={{ rows: 4, expandable: true }} style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{attempt.prompt}</Paragraph>
            {attempt.verification && <Alert type={attempt.verification.passed ? 'success' : 'warning'} showIcon message={attempt.verification.summary} description={attempt.verification.differences.join('；') || '未发现明显差异'} />}
          </Card>,
        }))} />;
      })()}
    </Modal>
    {props.settingsHost && createPortal(settingsPanel, props.settingsHost)}
  </section>;
}
