import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Popconfirm, Progress, Radio, Segmented, Select, Space, Statistic, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reportTaskProgress } from './services/taskProgress';
import { DEFAULT_SCENE_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { generateSceneReplacementImage } from './services/gemini';
import { readLocalStorage } from './storage';
import type { LogoAsset, SceneReplaceSettings, SceneReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;
const PRESETS = [
  { id: 'christmas', icon: '🎄', name: '温馨圣诞', content: '温馨高级的欧美圣诞室内场景，壁炉、自然松枝、暖白串灯与少量精致礼物，冬日傍晚的柔和暖光，写实商业摄影，背景干净不过度拥挤。' },
  { id: 'new-year', icon: '✨', name: '新年派对', content: '现代高级的新年庆祝场景，克制的金色灯光、少量彩带和柔焦灯饰，午夜派对氛围，精致写实，避免廉价或杂乱的装饰。' },
  { id: 'valentine', icon: '♥', name: '情人节', content: '现代欧美情人节约会场景，克制的鲜花、烛光与细腻散景，柔和浪漫的粉金色光线，优雅写实且不俗艳。' },
  { id: 'halloween', icon: '🎃', name: '万圣节', content: '高级欧美万圣节室内场景，小南瓜、烛光、干叶与低调装饰，深秋暮色和橙棕色氛围，神秘但精致的写实商业摄影。' },
  { id: 'thanksgiving', icon: '🍂', name: '感恩节', content: '欧美感恩节家庭聚餐环境，暖木色、亚麻织物、秋叶、蜡烛和柔和窗光，温暖丰盛但背景保持简洁，真实自然。' },
  { id: 'spring', icon: '🌿', name: '春日花园', content: '明亮清新的春日花园露台，浅色花草、自然绿植与晨间阳光，空气通透，柔和景深，真实高端生活方式摄影。' },
  { id: 'summer', icon: '🌊', name: '海滨夏日', content: '清爽高级的海滨露台场景，远处蓝色海面与天空、自然日光和轻盈织物，阳光明快但不过曝，度假感写实摄影。' },
  { id: 'autumn', icon: '🍁', name: '秋日木屋', content: '安静的秋日木屋或露台环境，暖木材质、金色落叶和午后斜阳，色调温润克制，具有电影感的写实商业摄影。' },
  { id: 'winter', icon: '❄', name: '冬日雪景', content: '窗外有柔和雪景的现代室内空间，冷白自然光与室内暖光平衡，安静通透、高级写实，避免夸张冰雪特效。' },
  { id: 'cafe', icon: '☕', name: '巴黎咖啡馆', content: '巴黎街角精品咖啡馆的清晨，石材与深色木质细节，柔和侧光、窗外街景散景，优雅自然的编辑风商业摄影。' },
  { id: 'studio', icon: '◫', name: '极简摄影棚', content: '高端极简摄影棚环境，中性浅灰背景、柔和大面积侧光与自然落影，空间干净、材质真实，突出原有主体。' },
  { id: 'hotel', icon: '◇', name: '精品酒店', content: '现代精品酒店大堂或套房，天然石材、胡桃木和克制的暖光，空间安静奢华，背景层次柔和，写实建筑摄影。' },
  { id: 'office', icon: '▦', name: '现代办公', content: '明亮现代的创意办公空间，玻璃、浅木与绿植，柔和自然窗光，专业但不冰冷，干净写实的品牌摄影。' },
  { id: 'night', icon: '🌙', name: '都市夜景', content: '高级都市夜景环境，远处城市灯光形成细腻散景，冷暖光线自然交融，具有电影感但保持主体清晰真实。' },
  { id: 'kitchen', icon: '⌂', name: '明亮厨房', content: '明亮高端的现代家庭厨房，浅色石材、自然木与清晨窗光，干净生活化，柔和阴影和真实材质细节。' },
  { id: 'camping', icon: '⛺', name: '户外露营', content: '精致自然的山野露营场景，木桌、帆布帐篷、远山与日落余晖，色调温暖通透，真实户外生活方式摄影。' },
];

function statusLabel(status: SceneReplaceTask['status']) {
  return status === 'waiting' ? '排队中' : status === 'running' ? '替换中' : status === 'success' ? '替换成功' : status === 'failed' ? '替换失败' : '已停止';
}

export default function SceneReplaceComposer({ apiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<SceneReplaceSettings>(() => ({ ...DEFAULT_SCENE_REPLACE_SETTINGS, ...readLocalStorage(STORAGE_KEYS.sceneReplaceSettings, {}) }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [prompt, setPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const [tasks, setTasks] = useState<SceneReplaceTask[]>([]);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const running = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes);
  const settingsRef = useRef(settings);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(STORAGE_KEYS.sceneReplaceSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || tasks.length || prompt.trim())), [scenes.length, tasks.length, prompt, onSessionStateChange]);

  const clearResults = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => { current.forEach((item) => item.resultUrl && URL.revokeObjectURL(item.resultUrl)); return []; }); setCompareIds(new Set()); };
  const patch = (value: Partial<SceneReplaceSettings>) => setSettings((current) => { const next = { ...current, ...value }; return value.imageModel ? { ...next, ...normalizeSettingsForModel(value.imageModel, next.aspectRatio, next.imageSize) } : next; });
  const valid = (file: File) => { if (!TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`); if (!file.size || file.size > MAX_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`); return true; };
  const addScenes = (files: File[]) => { const next = files.filter((file) => valid(file) === true).map((file) => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) })); if (next.length) { clearResults(); setScenes((current) => [...current, ...next].slice(0, 20)); } return false; };
  const removeScene = (id: string) => { clearResults(); setScenes((current) => { const found = current.find((item) => item.id === id); if (found) URL.revokeObjectURL(found.previewUrl); return current.filter((item) => item.id !== id); }); };
  const clearScenes = () => { clearResults(); setScenes((current) => { current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); return []; }); };

  const execute = useCallback(async (task: SceneReplaceTask) => {
    if (running.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId); if (!scene) return;
    running.current.add(task.id); const controller = new AbortController(); aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const config = settingsRef.current;
      const result = await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal: controller.signal, model: config.imageModel, prompt: task.prompt, image: scene.file, aspectRatio: config.ratioMode === 'fixed' ? config.aspectRatio : undefined, imageSize: config.imageSize });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType } : item));
    } catch (error) { setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: controller.signal.aborted ? 'stopped' : 'failed', error: controller.signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '场景替换失败' } : item)); }
    finally { running.current.delete(task.id); aborters.current.delete(task.id); }
  }, [apiKey, apiBaseUrl]);
  useEffect(() => { const free = Math.max(0, settings.concurrency - running.current.size); tasks.filter((item) => item.status === 'waiting' && !running.current.has(item.id)).slice(0, free).forEach((item) => void execute(item)); }, [tasks, settings.concurrency, execute]);
  const start = () => {
    if (!apiKey) return onRequestKey(); if (connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张原始场景图'); if (!prompt.trim()) return void message.warning('请选择预设或填写目标场景提示词');
    clearResults(); setTasks(scenes.flatMap((scene, sceneIndex) => Array.from({ length: settings.copiesPerScene }, (_, copyIndex) => ({ id: createId(), sceneId: scene.id, sceneIndex, copyIndex, status: 'waiting' as const, prompt: prompt.trim(), retryCount: 0 }))));
  };
  const stop = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => current.map((item) => item.status === 'waiting' ? { ...item, status: 'stopped' } : item)); };
  const retry = (task: SceneReplaceTask) => { const next = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 }; setTasks((current) => current.map((item) => item.id === task.id ? next : item)); void execute(next); };
  const success = tasks.filter((item) => item.status === 'success' && item.resultBlob); const busy = tasks.some((item) => item.status === 'waiting' || item.status === 'running'); const done = tasks.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length;
  useEffect(() => { reportTaskProgress({ id: 'scene-replace', label: '场景替换', completed: done, total: tasks.length, failed: tasks.filter((task) => task.status === 'failed').length, running: busy }); }, [done, tasks, busy]);
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((item) => item.sceneId === scene.id) })).filter((item) => item.tasks.length), [scenes, tasks]);
  const fileName = (task: SceneReplaceTask, scene: LogoAsset) => `${String(task.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}_场景替换_${String(task.copyIndex + 1).padStart(2, '0')}.${mimeExtension(task.resultMimeType)}`;
  const downloadAll = async () => { const zip = new JSZip(); groups.forEach(({ scene, tasks: items }) => items.forEach((item) => item.resultBlob && zip.file(fileName(item, scene), item.resultBlob))); downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_场景替换结果.zip'); };

  const panel = <div className="settings-panel scene-replace-settings-panel"><Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>场景替换设置</Title><Tag color="cyan">SCENE</Tag></Flex><Form layout="vertical" style={{ marginTop: 20 }}>
    <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patch({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
    <Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patch({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patch({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item>
    <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patch({ imageSize: imageSize as SceneReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item>
    <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(value) => patch({ copiesPerScene: value || 1 })} style={{ width: '100%' }} /></Form.Item>
    <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(value) => patch({ concurrency: value || 1 })} style={{ width: '100%' }} /></Form.Item>
  </Form><Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, scenes.length * settings.copiesPerScene)} /><Text type="secondary">按 {scenes.length * settings.copiesPerScene} 个请求估算。</Text></Card></div>;

  return <div className="scene-replace-page"><section className="hero-strip scene-replace-hero"><div><Text className="eyebrow">SCENE REPLACER</Text><Title level={2}>保留主体，只替换场景与氛围</Title><Paragraph className="hero-description">批量改造已有场景图，锁定人物、产品、Logo、文字和构图，让新环境的光线自然融入原图。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传原始场景图</span></Space>} extra={<Space><Text type="secondary">{scenes.length} / 20</Text>{!!scenes.length && <Popconfirm title="清空所有场景图？" onConfirm={clearScenes}><Button size="small" danger>清空全部</Button></Popconfirm>}</Space>}>{!scenes.length ? <Upload.Dragger multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴原始场景图</p><p className="ant-upload-hint">支持最多 20 张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}</Card>
    <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>选择并编辑目标场景</span></Space>}><div className="scene-replace-editor"><div><Text strong>提示词预设</Text><div className="scene-preset-grid">{PRESETS.map((preset) => <button type="button" key={preset.id} className={selectedPreset === preset.id ? 'scene-preset-card is-selected' : 'scene-preset-card'} onClick={() => { setSelectedPreset(preset.id); setPrompt(preset.content); }}><span>{preset.icon}</span><b>{preset.name}</b></button>)}</div></div><div className="scene-prompt-editor"><Flex justify="space-between" align="center"><Text strong>当前提示词（可直接修改）</Text>{selectedPreset && <Button type="link" size="small" onClick={() => { setSelectedPreset(undefined); setPrompt(''); }}>清除选择</Button>}</Flex><Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述新的背景场景、环境光线与整体氛围……" autoSize={{ minRows: 9, maxRows: 15 }} showCount maxLength={2000} /><Alert type="info" showIcon title="仅修改场景与氛围" description="生成时会自动追加严格锁定约束：人物、产品、Logo、文字、机位和整体构图保持不变。" /></div></div></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {scenes.length * settings.copiesPerScene} 张图片</Title><Text type="secondary">{scenes.length} 张原图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} onClick={start}>{busy ? '正在替换' : '开始场景替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((done / tasks.length) * 100)} status={busy ? 'active' : success.length ? 'success' : 'exception'} />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>场景替换结果</Title><Text type="secondary">可在每张结果上切换查看原图对比</Text></div><Space><Popconfirm title="清空全部结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!success.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>{tasks.length ? <div className="object-result-groups">{groups.map(({ scene, tasks: items }) => <Card key={scene.id} className="object-result-group" title={sanitizeFileName(scene.name)}><Image.PreviewGroup><div className="logo-replace-results">{items.map((task) => <Card key={task.id} size="small" title={`结果 ${task.copyIndex + 1}`} extra={task.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => task.resultBlob && downloadBlob(task.resultBlob, fileName(task, scene))} />}><div className="replace-result-image">{task.resultUrl ? <Image src={compareIds.has(task.id) ? scene.previewUrl : task.resultUrl} alt="场景替换结果" /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{statusLabel(task.status)}</Text><Text type="secondary">{task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Space><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{statusLabel(task.status)}</Tag>{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; })}>{compareIds.has(task.id) ? '查看生成图' : '原图对比'}</Button>}</Space>{task.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task)}>重试</Button>}</Flex></Card>)}</div></Image.PreviewGroup></Card>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传图片并开始替换后，结果会显示在这里" />}</section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
