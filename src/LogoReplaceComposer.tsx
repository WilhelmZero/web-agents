import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ColorPicker,
  Empty,
  Flex,
  Form,
  Image,
  InputNumber,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  Upload,
} from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOGO_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { generateLogoReplacement } from './services/gemini';
import { readLocalStorage } from './storage';
import type { LogoAsset, LogoReplaceSettings, LogoReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function statusText(status: LogoReplaceTask['status']) {
  if (status === 'waiting') return '排队中';
  if (status === 'running') return '生成中';
  if (status === 'success') return '替换成功';
  if (status === 'failed') return '替换失败';
  return '已停止';
}

function fileName(task: LogoReplaceTask, scene: LogoAsset, model: string) {
  return `${String(task.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}_${String(task.copyIndex + 1).padStart(2, '0')}_${model}.${mimeExtension(task.resultMimeType)}`;
}

export default function LogoReplaceComposer({
  apiKey,
  apiBaseUrl,
  connectionMode,
  onRequestKey,
  onSessionStateChange,
  settingsHost,
}: {
  apiKey: string;
  apiBaseUrl: string | null;
  connectionMode: 'direct' | 'proxy';
  onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void;
  settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<LogoReplaceSettings>(() => ({
    ...(DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings),
    ...readLocalStorage(STORAGE_KEYS.logoReplaceSettings, {} as Partial<LogoReplaceSettings>),
  }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [oldLogo, setOldLogo] = useState<LogoAsset>();
  const [newLogo, setNewLogo] = useState<LogoAsset>();
  const [tasks, setTasks] = useState<LogoReplaceTask[]>([]);
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes);
  const oldLogoRef = useRef(oldLogo);
  const newLogoRef = useRef(newLogo);
  const settingsRef = useRef(settings);

  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { oldLogoRef.current = oldLogo; }, [oldLogo]);
  useEffect(() => { newLogoRef.current = newLogo; }, [newLogo]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.logoReplaceSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || oldLogo || newLogo || tasks.length)), [scenes.length, oldLogo, newLogo, tasks.length, onSessionStateChange]);

  const validateFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`);
    if (!file.size || file.size > MAX_IMAGE_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`);
    return true;
  };
  const makeAsset = (file: File): LogoAsset => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
  const resetTasks = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => {
      current.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
      return [];
    });
  };
  const addScenes = (files: File[]) => {
    const assets = files.filter((file) => validateFile(file) === true).map(makeAsset);
    if (assets.length) {
      resetTasks();
      setScenes((current) => [...current, ...assets]);
    }
    return false;
  };
  const removeScene = (id: string) => {
    resetTasks();
    setScenes((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };
  const setSingleAsset = (kind: 'old' | 'new', file: File) => {
    if (validateFile(file) !== true) return false;
    resetTasks();
    const next = makeAsset(file);
    if (kind === 'old') setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return next; });
    else setNewLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return next; });
    return false;
  };
  const clearSingleAsset = (kind: 'old' | 'new') => {
    resetTasks();
    if (kind === 'old') setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return undefined; });
    else setNewLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return undefined; });
  };
  const patchSettings = (patch: Partial<LogoReplaceSettings>) => setSettings((current) => {
    const next = { ...current, ...patch };
    if (patch.imageModel) return { ...next, ...normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize) };
    return next;
  });

  const executeTask = useCallback(async (task: LogoReplaceTask) => {
    if (runningIds.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId);
    const replacement = newLogoRef.current;
    if (!scene || !replacement) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const currentSettings = settingsRef.current;
      const result = await generateLogoReplacement({
        apiKey,
        model: currentSettings.imageModel,
        scene: scene.file,
        oldLogo: oldLogoRef.current?.file,
        newLogo: replacement.file,
        logoColorMode: currentSettings.logoColorMode,
        customLogoColor: currentSettings.customLogoColor,
        aspectRatio: currentSettings.ratioMode === 'fixed' ? currentSettings.aspectRatio : undefined,
        imageSize: currentSettings.imageSize,
        signal: controller.signal,
        apiBaseUrl,
      });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType } : item));
    } catch (error) {
      const stopped = controller.signal.aborted;
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : error instanceof Error ? error.message : 'Logo 替换失败' } : item));
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, [apiKey, apiBaseUrl]);

  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    tasks.filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id)).slice(0, available).forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const start = () => {
    if (!apiKey) return onRequestKey();
    if (connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张已贴 Logo 的场景图');
    if (!newLogo) return void message.warning('请上传新 Logo');
    resetTasks();
    setTasks(scenes.flatMap((scene, sceneIndex) => Array.from({ length: settings.copiesPerScene }, (_, copyIndex) => ({
      id: createId(), sceneId: scene.id, sceneIndex, copyIndex, status: 'waiting' as const, retryCount: 0,
    }))));
  };
  const stop = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => current.map((task) => task.status === 'waiting' ? { ...task, status: 'stopped' } : task));
  };
  const retry = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const next = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 };
    setTasks((current) => current.map((item) => item.id === id ? next : item));
    void executeTask(next);
  };
  const clearResults = () => resetTasks();
  const successful = tasks.filter((task) => task.status === 'success' && task.resultBlob);
  const processing = tasks.some((task) => task.status === 'waiting' || task.status === 'running');
  const completed = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const taskCount = scenes.length * settings.copiesPerScene;
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((task) => task.sceneId === scene.id) })).filter((group) => group.tasks.length), [scenes, tasks]);
  const downloadTask = (task: LogoReplaceTask) => {
    const scene = scenes.find((item) => item.id === task.sceneId);
    if (scene && task.resultBlob) downloadBlob(task.resultBlob, fileName(task, scene, settings.imageModel));
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    groups.forEach((group) => {
      const target = settings.copiesPerScene > 1 ? zip.folder(`${String(group.tasks[0]?.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(group.scene.name)}`)! : zip;
      group.tasks.forEach((task) => { if (task.resultBlob) target.file(fileName(task, group.scene, settings.imageModel), task.resultBlob); });
    });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_Logo替换结果.zip');
  };

  const settingsPanel = (
    <div className="settings-panel logo-replace-settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>替换设置</Title><Tag color="cyan">REPLACE</Tag></Flex>
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item label="新 Logo 颜色">
          <Select value={settings.logoColorMode} onChange={(logoColorMode) => patchSettings({ logoColorMode })} options={[
            { value: 'original', label: '保持原色' }, { value: 'white', label: '白色' }, { value: 'black', label: '黑色' }, { value: 'custom', label: '自定义颜色' },
          ]} />
          {settings.logoColorMode === 'custom' && <Flex gap={8} align="center" style={{ marginTop: 10 }}><ColorPicker value={settings.customLogoColor} onChange={(_, hex) => patchSettings({ customLogoColor: hex })} /><Text code>{settings.customLogoColor}</Text></Flex>}
        </Form.Item>
        <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
        <Form.Item label="画面比例">
          <Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}><Radio value="original">跟随场景原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>
          {settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}
        </Form.Item>
        <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as LogoReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item>
        <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(copiesPerScene) => patchSettings({ copiesPerScene: copiesPerScene || 1 })} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item>
      </Form>
      <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, taskCount) + taskCount * PRICING.models[settings.imageModel].inputImage * (oldLogo ? 2 : 1)} /><Text type="secondary">按 {taskCount} 个请求与 {oldLogo ? 3 : 2} 张输入参考图估算。</Text></Card>
    </div>
  );

  const singleLogoCard = (kind: 'old' | 'new', asset?: LogoAsset) => (
    <div className="replace-logo-slot">
      {asset ? <><Image src={asset.previewUrl} alt={kind === 'old' ? '旧 Logo' : '新 Logo'} /><Space><Upload showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setSingleAsset(kind, file as File)}><Button size="small" icon={<ReloadOutlined />}>替换</Button></Upload><Button size="small" danger icon={<DeleteOutlined />} onClick={() => clearSingleAsset(kind)}>删除</Button></Space></> : <Upload.Dragger showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setSingleAsset(kind, file as File)}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">{kind === 'old' ? '上传旧 Logo（选填）' : '上传新 Logo'}</p><p className="ant-upload-hint">PNG / JPEG / WebP</p></Upload.Dragger>}
    </div>
  );

  return (
    <div className="logo-replace-page">
      <section className="hero-strip logo-replace-hero"><div><Text className="eyebrow">LOGO REPLACER</Text><Title level={2}>批量替换场景中的品牌 Logo</Title><Paragraph className="hero-description">识别场景中的旧 Logo 并替换为新 Logo，其他内容严格保持不变。</Paragraph></div><div className="hero-orb" /></section>
      <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传已贴 Logo 的场景图</span></Space>} extra={<Text type="secondary">{scenes.length} 张</Text>}>
        {!scenes.length && <Upload.Dragger multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴场景图</p><p className="ant-upload-hint">支持多张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger>}
        {!!scenes.length && <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}
      </Card>
      <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>设置旧 Logo 与新 Logo</span></Space>}>
        <Alert type="info" showIcon title="旧 Logo 可不上传" description="上传旧 Logo 能帮助 AI 更准确识别需要替换的标识；新 Logo 必须上传。" style={{ marginBottom: 16 }} />
        <div className="replace-logo-grid"><Card size="small" title="旧 Logo（选填）">{singleLogoCard('old', oldLogo)}</Card><div className="replace-arrow"><SwapOutlined /></div><Card size="small" title="新 Logo（必填）">{singleLogoCard('new', newLogo)}</Card></div>
      </Card>
      <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {taskCount} 张图片</Title><Text type="secondary">{scenes.length} 张场景图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{processing && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={processing} onClick={start}>{processing ? '正在替换' : '开始替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((completed / tasks.length) * 100)} status={processing ? 'active' : successful.length ? 'success' : 'exception'} />}</Card>
      <section className="results-section"><Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>替换结果</Title><Text type="secondary">每个结果仅改变 Logo</Text></div><Space><Popconfirm title="清空全部替换结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!successful.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
        {tasks.length ? <Image.PreviewGroup><div className="logo-replace-results">{groups.flatMap((group) => group.tasks.map((task) => <Card key={task.id} size="small" title={`场景 ${task.sceneIndex + 1} · 结果 ${task.copyIndex + 1}`} extra={task.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadTask(task)} />}><div className="replace-result-image">{task.resultUrl ? <Image src={task.resultUrl} alt="Logo 替换结果" /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{statusText(task.status)}</Text><Text type="secondary">{task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{statusText(task.status)}</Tag>{task.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task.id)}>重试</Button>}</Flex></Card>))}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成上传并开始替换后，结果会显示在这里" />}
      </section>
      <Alert type="warning" showIcon title="生成式替换提示" description="模型会尽量保持其他区域不变，但生成式图片接口不能保证像素级完全一致；旧 Logo 参考图有助于提高识别准确率。" />
      {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}
      {settingsHost && createPortal(settingsPanel, settingsHost)}
    </div>
  );
}
