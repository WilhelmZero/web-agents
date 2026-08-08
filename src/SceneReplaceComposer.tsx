import { ClearOutlined, DeleteOutlined, DownloadOutlined, ExpandOutlined, EyeOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Modal, Popconfirm, Progress, Radio, Segmented, Select, Space, Statistic, Switch, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reportTaskProgress } from './services/taskProgress';
import { DEFAULT_SCENE_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { generateSceneReplacementImage } from './services/gemini';
import { editPaperTextOpenAi } from './services/paperText';
import { buildOutpaintPrompt, closestAspectRatio, composeExactOutpaint, prepareOutpaintInput } from './services/outpaint';
import { readLocalStorage } from './storage';
import type { ImageModel, LogoAsset, SceneReplaceSettings, SceneReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';
import { BUILT_IN_SCENE_REPLACE_PRESETS, normalizeCustomScenePresets, SCENE_PRESET_EMOJIS, type SceneReplacePreset } from './services/sceneReplacePresets';

const { Text, Title, Paragraph } = Typography;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;
type SceneModel = SceneReplaceSettings['imageModel'];
const isOpenAiModel = (model: SceneModel) => model.startsWith('gpt-image-');
const OUTPAINT_PRESETS = [{ label: '超宽屏 3200 × 1310', value: '3200x1310', width: 3200, height: 1310 }, { label: '横版 1800 × 1350', value: '1800x1350', width: 1800, height: 1350 }, { label: '自定义尺寸', value: 'custom' }];
const MODEL_OPTIONS = [{ label: 'GPT（OpenAI 官方直连）', options: [{ value: 'gpt-image-2', label: 'GPT Image 2（推荐）' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] }, { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) }];

function statusLabel(status: SceneReplaceTask['status']) {
  return status === 'waiting' ? '排队中' : status === 'running' ? '替换中' : status === 'success' ? '替换成功' : status === 'failed' ? '替换失败' : '已停止';
}

export default function SceneReplaceComposer({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<SceneReplaceSettings>(() => ({ ...DEFAULT_SCENE_REPLACE_SETTINGS, ...readLocalStorage(STORAGE_KEYS.sceneReplaceSettings, {}) }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [prompt, setPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const [customPresets, setCustomPresets] = useState<SceneReplacePreset[]>(() => normalizeCustomScenePresets(readLocalStorage(STORAGE_KEYS.sceneReplacePresets, [])));
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [presetDraft, setPresetDraft] = useState({ name: '', icon: '✨', content: '' });
  const [tasks, setTasks] = useState<SceneReplaceTask[]>([]);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const [previewModes, setPreviewModes] = useState<Record<string, 'scene' | 'ai' | 'outpaint'>>({});
  const running = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes);
  const settingsRef = useRef(settings);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(STORAGE_KEYS.sceneReplaceSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.sceneReplacePresets, JSON.stringify(customPresets)); }, [customPresets]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || tasks.length || prompt.trim())), [scenes.length, tasks.length, prompt, onSessionStateChange]);

  const clearResults = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => { current.forEach((item) => { if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); if (item.outpaintAiUrl) URL.revokeObjectURL(item.outpaintAiUrl); if (item.outpaintUrl) URL.revokeObjectURL(item.outpaintUrl); }); return []; }); setCompareIds(new Set()); setPreviewModes({}); };
  const patch = (value: Partial<SceneReplaceSettings>) => setSettings((current) => { const next = { ...current, ...value }; return value.imageModel && !isOpenAiModel(value.imageModel) ? { ...next, ...normalizeSettingsForModel(value.imageModel as ImageModel, next.aspectRatio, next.imageSize) } : next; });
  const valid = (file: File) => { if (!TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`); if (!file.size || file.size > MAX_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`); return true; };
  const addScenes = (files: File[]) => { const next = files.filter((file) => valid(file) === true).map((file) => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) })); if (next.length) { clearResults(); setScenes((current) => [...current, ...next].slice(0, 20)); } return false; };
  const removeScene = (id: string) => { clearResults(); setScenes((current) => { const found = current.find((item) => item.id === id); if (found) URL.revokeObjectURL(found.previewUrl); return current.filter((item) => item.id !== id); }); };
  const clearScenes = () => { clearResults(); setScenes((current) => { current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); return []; }); };

  const outpaintTask = useCallback(async (taskId: string, source: Blob, signal: AbortSignal) => {
    const config = settingsRef.current;
    if (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey) throw new Error('请先在右上角配置所选扩图模型的 API Key');
    if (!isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) throw new Error('请先配置 Gemini 代理地址');
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, outpaintStatus: 'running', outpaintError: undefined } : item));
    try {
      const sourceFile = new File([source], `scene-${taskId}.png`, { type: source.type || 'image/png' });
      const prepared = await prepareOutpaintInput(sourceFile, config.outpaintWidth, config.outpaintHeight);
      const outpaintPrompt = buildOutpaintPrompt(config.outpaintPrompt, config.outpaintWidth, config.outpaintHeight);
      const aiBlob = isOpenAiModel(config.outpaintImageModel)
        ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: config.outpaintImageModel, image: prepared.file, mask: prepared.mask, prompt: outpaintPrompt, quality: config.outpaintQuality, signal })
        : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: config.outpaintImageModel as ImageModel, image: prepared.file, imageSize: config.outpaintImageSize, aspectRatio: closestAspectRatio(config.outpaintWidth, config.outpaintHeight, MODEL_CAPABILITIES[config.outpaintImageModel as ImageModel].aspectRatios), prompt: outpaintPrompt })).blob;
      const finalBlob = await composeExactOutpaint(aiBlob, sourceFile, config.outpaintWidth, config.outpaintHeight);
      const aiUrl = URL.createObjectURL(aiBlob); const finalUrl = URL.createObjectURL(finalBlob);
      setTasks((current) => current.map((item) => {
        if (item.id !== taskId) return item;
        if (item.outpaintAiUrl) URL.revokeObjectURL(item.outpaintAiUrl); if (item.outpaintUrl) URL.revokeObjectURL(item.outpaintUrl);
        return { ...item, outpaintStatus: 'success', outpaintAiBlob: aiBlob, outpaintAiUrl: aiUrl, outpaintBlob: finalBlob, outpaintUrl: finalUrl };
      }));
      setPreviewModes((current) => ({ ...current, [taskId]: 'outpaint' }));
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
    } catch (error) { setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: controller.signal.aborted ? 'stopped' : 'failed', error: controller.signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '场景替换失败' } : item)); }
    finally { running.current.delete(task.id); aborters.current.delete(task.id); }
  }, [apiKey, openAiApiKey, apiBaseUrl, outpaintTask]);
  useEffect(() => { const free = Math.max(0, settings.concurrency - running.current.size); tasks.filter((item) => item.status === 'waiting' && !running.current.has(item.id)).slice(0, free).forEach((item) => void execute(item)); }, [tasks, settings.concurrency, execute]);
  const start = () => {
    const config = settingsRef.current; if (isOpenAiModel(config.imageModel) ? !openAiApiKey : !apiKey) return onRequestKey(); if (!isOpenAiModel(config.imageModel) && connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (config.autoOutpaint && (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey)) return onRequestKey();
    if (config.autoOutpaint && !isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置 Gemini 代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张原始场景图'); if (!prompt.trim()) return void message.warning('请选择预设或填写目标场景提示词');
    clearResults(); setTasks(scenes.flatMap((scene, sceneIndex) => Array.from({ length: settings.copiesPerScene }, (_, copyIndex) => ({ id: createId(), sceneId: scene.id, sceneIndex, copyIndex, status: 'waiting' as const, prompt: prompt.trim(), retryCount: 0 }))));
  };
  const stop = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => current.map((item) => item.status === 'waiting' ? { ...item, status: 'stopped' } : item)); };
  const retry = (task: SceneReplaceTask) => { const next = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 }; setTasks((current) => current.map((item) => item.id === task.id ? next : item)); void execute(next); };
  const manualOutpaint = async (targets: SceneReplaceTask[]) => {
    const config = settingsRef.current;
    if (isOpenAiModel(config.outpaintImageModel) ? !openAiApiKey : !apiKey) return onRequestKey();
    if (!isOpenAiModel(config.outpaintImageModel) && connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey();
    const eligible = targets.filter((item) => item.resultBlob && item.outpaintStatus !== 'running'); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(config.concurrency, eligible.length) }, async () => { while (cursor < eligible.length) { const item = eligible[cursor++]; const controller = new AbortController(); aborters.current.set(`outpaint-${item.id}`, controller); try { await outpaintTask(item.id, item.resultBlob!, controller.signal); } catch { /* error is displayed on the result card */ } finally { aborters.current.delete(`outpaint-${item.id}`); } } }));
  };
  const success = tasks.filter((item) => item.status === 'success' && item.resultBlob); const busy = tasks.some((item) => item.status === 'waiting' || item.status === 'running' || item.outpaintStatus === 'running'); const done = tasks.filter((item) => ['success', 'failed', 'stopped'].includes(item.status) && item.outpaintStatus !== 'running').length;
  useEffect(() => { reportTaskProgress({ id: 'scene-replace', label: '场景替换', completed: done, total: tasks.length, failed: tasks.filter((task) => task.status === 'failed').length, running: busy }); }, [done, tasks, busy]);
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((item) => item.sceneId === scene.id) })).filter((item) => item.tasks.length), [scenes, tasks]);
  const allPresets = useMemo(() => [...BUILT_IN_SCENE_REPLACE_PRESETS, ...customPresets], [customPresets]);
  const resultItems = useMemo(() => tasks.flatMap((task) => { const scene = scenes.find((item) => item.id === task.sceneId); return scene ? [{ task, scene }] : []; }), [tasks, scenes]);
  const openPresetEditor = () => { setPresetDraft({ name: '', icon: '✨', content: prompt.trim() }); setPresetEditorOpen(true); };
  const savePreset = () => {
    if (!presetDraft.name.trim() || !presetDraft.icon.trim() || !presetDraft.content.trim()) return void message.warning('请填写预设名称、图标和提示词');
    const next = { id: createId(), name: presetDraft.name.trim(), icon: presetDraft.icon.trim(), content: presetDraft.content.trim() };
    setCustomPresets((current) => [...current, next]); setSelectedPreset(next.id); setPrompt(next.content); setPresetEditorOpen(false); message.success('自定义提示词预设已保存到本地');
  };
  const fileName = (task: SceneReplaceTask, scene: LogoAsset) => `${String(task.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}_${task.outpaintBlob ? `扩图_${settings.outpaintWidth}x${settings.outpaintHeight}` : '场景替换'}_${String(task.copyIndex + 1).padStart(2, '0')}.${task.outpaintBlob ? 'png' : mimeExtension(task.resultMimeType)}`;
  const downloadAll = async () => { const zip = new JSZip(); groups.forEach(({ scene, tasks: items }) => items.forEach((item) => { const blob = item.outpaintBlob || item.resultBlob; if (blob) zip.file(fileName(item, scene), blob); })); downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_场景替换结果.zip'); };

  const selectedOutpaintPreset = OUTPAINT_PRESETS.find((item) => item.width === settings.outpaintWidth && item.height === settings.outpaintHeight)?.value || 'custom';
  const panel = <div className="settings-panel scene-replace-settings-panel"><Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>场景替换设置</Title><Tag color="cyan">SCENE</Tag></Flex><Form layout="vertical" style={{ marginTop: 20 }}>
    <Form.Item label="场景替换图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patch({ imageModel })} options={MODEL_OPTIONS} /></Form.Item>
    {isOpenAiModel(settings.imageModel) ? <Form.Item label="GPT 输出质量"><Select value={settings.imageQuality} onChange={(imageQuality) => patch({ imageQuality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item> : <><Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patch({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patch({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item><Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patch({ imageSize: imageSize as SceneReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].imageSizes} /></Form.Item></>}
    <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(value) => patch({ copiesPerScene: value || 1 })} style={{ width: '100%' }} /></Form.Item>
    <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(value) => patch({ concurrency: value || 1 })} style={{ width: '100%' }} /></Form.Item>
    <Form.Item label="生成后自动扩图"><Switch checked={settings.autoOutpaint} onChange={(autoOutpaint) => patch({ autoOutpaint })} /><Text type="secondary" style={{ marginLeft: 10 }}>{settings.autoOutpaint ? '场景替换完成后自动扩图' : '可在结果区手动扩图'}</Text></Form.Item>
    <Card size="small" title="扩图设置（自动与手动共用）" style={{ marginBottom: 16 }}><Form.Item label="扩图图片模型"><Select value={settings.outpaintImageModel} onChange={(outpaintImageModel) => patch({ outpaintImageModel })} options={MODEL_OPTIONS} /></Form.Item>{isOpenAiModel(settings.outpaintImageModel) ? <Form.Item label="GPT 扩图质量"><Select value={settings.outpaintQuality} onChange={(outpaintQuality) => patch({ outpaintQuality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item> : <Form.Item label="扩图生成质量"><Segmented block value={settings.outpaintImageSize} onChange={(outpaintImageSize) => patch({ outpaintImageSize: outpaintImageSize as SceneReplaceSettings['outpaintImageSize'] })} options={MODEL_CAPABILITIES[settings.outpaintImageModel as ImageModel].imageSizes} /></Form.Item>}<Form.Item label="输出尺寸预设"><Select value={selectedOutpaintPreset} options={OUTPAINT_PRESETS} onChange={(value) => { const preset = OUTPAINT_PRESETS.find((item) => item.value === value); if (preset?.width && preset.height) patch({ outpaintWidth: preset.width, outpaintHeight: preset.height }); }} /></Form.Item><Flex gap={8}><Form.Item label="宽度" style={{ flex: 1 }}><InputNumber min={64} max={8192} value={settings.outpaintWidth} onChange={(outpaintWidth) => patch({ outpaintWidth: outpaintWidth || 64 })} style={{ width: '100%' }} /></Form.Item><Form.Item label="高度" style={{ flex: 1 }}><InputNumber min={64} max={8192} value={settings.outpaintHeight} onChange={(outpaintHeight) => patch({ outpaintHeight: outpaintHeight || 64 })} style={{ width: '100%' }} /></Form.Item></Flex><Form.Item label="扩图提示词"><Input.TextArea value={settings.outpaintPrompt} onChange={(event) => patch({ outpaintPrompt: event.target.value })} autoSize={{ minRows: 3, maxRows: 7 }} /></Form.Item></Card>
  </Form>{!isOpenAiModel(settings.imageModel) && <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel as ImageModel, settings.imageSize, scenes.length * settings.copiesPerScene)} /><Text type="secondary">按 {scenes.length * settings.copiesPerScene} 个请求估算。</Text></Card>}</div>;

  return <div className="scene-replace-page"><section className="hero-strip scene-replace-hero"><div><Text className="eyebrow">SCENE REPLACER</Text><Title level={2}>保留主体，只替换场景与氛围</Title><Paragraph className="hero-description">批量改造已有场景图，锁定人物、产品、Logo、文字和构图，让新环境的光线自然融入原图。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传原始场景图</span></Space>} extra={<Space><Text type="secondary">{scenes.length} / 20</Text>{!!scenes.length && <Popconfirm title="清空所有场景图？" onConfirm={clearScenes}><Button size="small" danger>清空全部</Button></Popconfirm>}</Space>}>{!scenes.length ? <Upload.Dragger multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴原始场景图</p><p className="ant-upload-hint">支持最多 20 张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}</Card>
    <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>选择并编辑目标场景</span></Space>}><div className="scene-replace-editor"><div><Flex justify="space-between" align="center"><Text strong>提示词预设</Text><Button size="small" icon={<PlusOutlined />} onClick={openPresetEditor}>新增预设</Button></Flex><div className="scene-preset-grid">{allPresets.map((preset) => <div role="button" tabIndex={0} key={preset.id} className={selectedPreset === preset.id ? 'scene-preset-card is-selected' : 'scene-preset-card'} onClick={() => { setSelectedPreset(preset.id); setPrompt(preset.content); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setSelectedPreset(preset.id); setPrompt(preset.content); } }}><span>{preset.icon}</span><b>{preset.name}</b>{!preset.builtIn && <Button className="scene-preset-delete" type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除 ${preset.name}`} onClick={(event) => { event.stopPropagation(); setCustomPresets((current) => current.filter((item) => item.id !== preset.id)); if (selectedPreset === preset.id) setSelectedPreset(undefined); }} />}</div>)}</div></div><div className="scene-prompt-editor"><Flex justify="space-between" align="center"><Text strong>发送给模型的完整提示词（可直接修改）</Text>{selectedPreset && <Button type="link" size="small" onClick={() => { setSelectedPreset(undefined); setPrompt(''); }}>清除选择</Button>}</Flex><Input.TextArea value={prompt} onChange={(event) => { setPrompt(event.target.value); setSelectedPreset(undefined); }} placeholder="例如：改为海边度假主题，严格要求杯子及人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果" autoSize={{ minRows: 9, maxRows: 15 }} showCount maxLength={3000} /><Alert type="info" showIcon title="完整提示词完全由你控制" description="系统不再自动追加隐藏的严格约束；可以自由删改人物、产品、服装、构图或背景相关要求。" /><Button icon={<PlusOutlined />} onClick={openPresetEditor}>将当前提示词保存为预设</Button></div></div></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {scenes.length * settings.copiesPerScene} 张图片</Title><Text type="secondary">{scenes.length} 张原图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} onClick={start}>{busy ? '正在替换' : '开始场景替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((done / tasks.length) * 100)} status={busy ? 'active' : success.length ? 'success' : 'exception'} />}</Card>
    <section className="results-section">
      <Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>场景替换结果</Title><Text type="secondary">可查看场景结果、AI 扩图返回和最终合成图</Text></div><Space><Button icon={<ExpandOutlined />} disabled={!success.length || success.some((item) => item.outpaintStatus === 'running')} onClick={() => void manualOutpaint(success)}>一键扩图全部</Button><Popconfirm title="清空全部结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!success.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
      {tasks.length ? <Image.PreviewGroup><div className="logo-replace-results scene-replace-results-grid">{resultItems.map(({ task, scene }) => {
        const mode = previewModes[task.id] || (task.outpaintUrl ? 'outpaint' : 'scene');
        const shownUrl = compareIds.has(task.id) ? scene.previewUrl : mode === 'ai' ? task.outpaintAiUrl : mode === 'outpaint' ? task.outpaintUrl : task.resultUrl;
        const downloadable = task.outpaintBlob || task.resultBlob;
        return <Card key={task.id} size="small" title={<Text ellipsis={{ tooltip: scene.name }}>{sanitizeFileName(scene.name)} · 结果 {task.copyIndex + 1}</Text>} extra={downloadable && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(downloadable, fileName(task, scene))} />}><div className="replace-result-image">{shownUrl ? <Image src={shownUrl} alt="场景替换与扩图结果" /> : task.status === 'running' || task.outpaintStatus === 'running' ? <GeneratingImage progressKey={`${task.id}-${task.outpaintStatus}`} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' || task.outpaintStatus === 'failed' ? 'danger' : 'secondary'}>{task.outpaintStatus === 'failed' ? '扩图失败' : statusLabel(task.status)}</Text><Text type="secondary">{task.outpaintError || task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div>
          {(task.resultUrl || task.outpaintAiUrl || task.outpaintUrl) && !compareIds.has(task.id) && <Segmented block size="small" style={{ marginTop: 8 }} value={mode} onChange={(value) => setPreviewModes((current) => ({ ...current, [task.id]: value as 'scene' | 'ai' | 'outpaint' }))} options={[...(task.resultUrl ? [{ label: '场景结果', value: 'scene' }] : []), ...(task.outpaintAiUrl ? [{ label: 'AI 扩图返回', value: 'ai' }] : []), ...(task.outpaintUrl ? [{ label: '最终扩图', value: 'outpaint' }] : [])]} />}
          <Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={task.outpaintStatus === 'failed' || task.status === 'failed' ? 'error' : task.outpaintStatus === 'running' || task.status === 'running' ? 'processing' : task.status === 'success' ? 'success' : 'default'}>{task.outpaintStatus === 'running' ? '扩图中' : task.outpaintStatus === 'success' ? '扩图成功' : task.outpaintStatus === 'failed' ? '扩图失败' : statusLabel(task.status)}</Tag><Space wrap>{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; })}>{compareIds.has(task.id) ? '查看生成图' : '原图对比'}</Button>}{task.resultBlob && <Button size="small" icon={task.outpaintBlob ? <ReloadOutlined /> : <ExpandOutlined />} loading={task.outpaintStatus === 'running'} onClick={() => void manualOutpaint([task])}>{task.outpaintBlob ? '重新扩图' : '扩图'}</Button>}<Button size="small" icon={<ReloadOutlined />} disabled={task.status === 'running' || task.status === 'waiting' || task.outpaintStatus === 'running'} onClick={() => retry(task)}>重新生成</Button></Space></Flex>
        </Card>;
      })}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传图片并开始替换后，结果会显示在这里" />}
    </section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
    <Modal title="新增场景提示词预设" open={presetEditorOpen} okText="保存预设" cancelText="取消" onOk={savePreset} onCancel={() => setPresetEditorOpen(false)}><Form layout="vertical"><Form.Item label="预设名称" required><Input value={presetDraft.name} maxLength={30} placeholder="例如：海岛度假" onChange={(event) => setPresetDraft((current) => ({ ...current, name: event.target.value }))} /></Form.Item><Form.Item label="图标" required><Input value={presetDraft.icon} maxLength={12} placeholder="可输入任意 Emoji 或文字" onChange={(event) => setPresetDraft((current) => ({ ...current, icon: event.target.value }))} /><div className="scene-emoji-picker">{SCENE_PRESET_EMOJIS.map((emoji) => <Button key={emoji} className={presetDraft.icon === emoji ? 'is-selected' : ''} onClick={() => setPresetDraft((current) => ({ ...current, icon: emoji }))}>{emoji}</Button>)}</div></Form.Item><Form.Item label="完整提示词" required><Input.TextArea value={presetDraft.content} autoSize={{ minRows: 5, maxRows: 10 }} maxLength={3000} placeholder="输入选择该预设后要发送给模型的完整提示词" onChange={(event) => setPresetDraft((current) => ({ ...current, content: event.target.value }))} /></Form.Item></Form></Modal>
  </div>;
}
