import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Checkbox, Empty, Flex, Form, Image, Input, InputNumber, Popconfirm, Progress, Radio, Segmented, Select, Space, Statistic, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_OBJECT_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { buildObjectReplacementInstruction, generateObjectReplacementImage } from './services/gemini';
import { buildObjectReplaceTasks } from './services/objectReplaceUtils';
import { readLocalStorage } from './storage';
import type { LogoAsset, ObjectPreservationOptions, ObjectReplaceSettings, ObjectReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;
const ELEMENTS: Array<{ key: keyof Omit<ObjectPreservationOptions, 'custom'>; label: string }> = [
  { key: 'print', label: '印花' }, { key: 'logo', label: 'Logo' }, { key: 'engraving', label: '雕刻' },
  { key: 'liquid', label: '酒液' }, { key: 'foam', label: '泡沫' },
];

function stateLabel(status: ObjectReplaceTask['status']) {
  return status === 'waiting' ? '排队中' : status === 'running' ? '生成中' : status === 'success' ? '替换成功' : status === 'failed' ? '替换失败' : '已停止';
}
function outputName(task: ObjectReplaceTask, scene: LogoAsset, model: string) {
  return String(task.sceneIndex + 1).padStart(2, '0') + '_' + sanitizeFileName(scene.name) + '_' + String(task.copyIndex + 1).padStart(2, '0') + '_' + model + '.' + mimeExtension(task.resultMimeType);
}

export default function ObjectReplaceComposer({ apiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const stored = readLocalStorage(STORAGE_KEYS.objectReplaceSettings, {} as Partial<ObjectReplaceSettings>);
  const [settings, setSettings] = useState<ObjectReplaceSettings>(() => ({
    ...DEFAULT_OBJECT_REPLACE_SETTINGS, ...stored,
    preservation: { ...DEFAULT_OBJECT_REPLACE_SETTINGS.preservation, ...stored.preservation, custom: [...(stored.preservation?.custom ?? [])] },
  }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [sourceReference, setSourceReference] = useState<LogoAsset>();
  const [targetReference, setTargetReference] = useState<LogoAsset>();
  const [tasks, setTasks] = useState<ObjectReplaceTask[]>([]);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const [customDraft, setCustomDraft] = useState('');
  const running = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes);
  const sourceRef = useRef(sourceReference);
  const targetRef = useRef(targetReference);
  const settingsRef = useRef(settings);

  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { sourceRef.current = sourceReference; }, [sourceReference]);
  useEffect(() => { targetRef.current = targetReference; }, [targetReference]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(STORAGE_KEYS.objectReplaceSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || sourceReference || targetReference || tasks.length || settings.targetObjectName.trim())), [scenes.length, sourceReference, targetReference, tasks.length, settings.targetObjectName, onSessionStateChange]);

  const valid = (file: File) => {
    if (!TYPES.includes(file.type)) return void message.error(file.name + '：仅支持 PNG、JPEG、WebP');
    if (!file.size || file.size > MAX_SIZE) return void message.error(file.name + '：文件需小于 20MB 且不能为空');
    return true;
  };
  const asset = (file: File): LogoAsset => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
  const clearResults = () => {
    aborters.current.forEach((item) => item.abort());
    setTasks((current) => { current.forEach((item) => item.resultUrl && URL.revokeObjectURL(item.resultUrl)); return []; });
    setCompareIds(new Set());
  };
  const patch = (value: Partial<ObjectReplaceSettings>) => setSettings((current) => {
    const next = { ...current, ...value };
    return value.imageModel ? { ...next, ...normalizeSettingsForModel(value.imageModel, next.aspectRatio, next.imageSize) } : next;
  });
  const preserve = (value: Partial<ObjectPreservationOptions>) => patch({ preservation: { ...settings.preservation, ...value } });
  const addScenes = (files: File[]) => {
    const next = files.filter((file) => valid(file) === true).map(asset);
    if (next.length) { clearResults(); setScenes((current) => [...current, ...next]); }
    return false;
  };
  const removeScene = (id: string) => {
    clearResults();
    setScenes((current) => { const found = current.find((item) => item.id === id); if (found) URL.revokeObjectURL(found.previewUrl); return current.filter((item) => item.id !== id); });
  };
  const clearScenes = () => { clearResults(); setScenes((current) => { current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); return []; }); };
  const setReference = (kind: 'source' | 'target', file: File) => {
    if (valid(file) !== true) return false;
    clearResults();
    const setter = kind === 'source' ? setSourceReference : setTargetReference;
    setter((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return asset(file); });
    return false;
  };
  const clearReference = (kind: 'source' | 'target') => {
    clearResults();
    const setter = kind === 'source' ? setSourceReference : setTargetReference;
    setter((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return undefined; });
  };
  const prompt = useMemo(() => buildObjectReplacementInstruction({
    sourceObjectName: settings.sourceObjectName, targetObjectName: settings.targetObjectName,
    hasSourceReference: Boolean(sourceReference), hasTargetReference: Boolean(targetReference), preservation: settings.preservation,
  }), [settings.sourceObjectName, settings.targetObjectName, settings.preservation, sourceReference, targetReference]);

  const execute = useCallback(async (task: ObjectReplaceTask) => {
    if (running.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId);
    if (!scene) return;
    running.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const config = settingsRef.current;
      const result = await generateObjectReplacementImage({
        apiKey, apiBaseUrl, signal: controller.signal, model: config.imageModel, scene: scene.file,
        sourceReference: sourceRef.current?.file, targetReference: targetRef.current?.file,
        sourceObjectName: config.sourceObjectName, targetObjectName: config.targetObjectName, preservation: config.preservation,
        aspectRatio: config.ratioMode === 'fixed' ? config.aspectRatio : undefined, imageSize: config.imageSize,
      });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType } : item));
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? {
        ...item, status: controller.signal.aborted ? 'stopped' : 'failed',
        error: controller.signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '物体替换失败',
      } : item));
    } finally { running.current.delete(task.id); aborters.current.delete(task.id); }
  }, [apiKey, apiBaseUrl]);

  useEffect(() => {
    const free = Math.max(0, settings.concurrency - running.current.size);
    tasks.filter((item) => item.status === 'waiting' && !running.current.has(item.id)).slice(0, free).forEach((item) => void execute(item));
  }, [tasks, settings.concurrency, execute]);

  const start = () => {
    if (!apiKey) return onRequestKey();
    if (connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张场景图');
    if (!settings.sourceObjectName.trim() && !sourceReference) return void message.warning('请输入原物体名称或上传原物体参考图');
    if (!settings.targetObjectName.trim() && !targetReference) return void message.warning('请输入新物体名称或上传新物体参考图');
    clearResults(); setTasks(buildObjectReplaceTasks(scenes, settings.copiesPerScene));
  };
  const stop = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => current.map((item) => item.status === 'waiting' ? { ...item, status: 'stopped' } : item)); };
  const retry = (task: ObjectReplaceTask) => { const next = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 }; setTasks((current) => current.map((item) => item.id === task.id ? next : item)); void execute(next); };

  const successful = tasks.filter((item) => item.status === 'success' && item.resultBlob);
  const busy = tasks.some((item) => item.status === 'waiting' || item.status === 'running');
  const done = tasks.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length;
  const count = scenes.length * settings.copiesPerScene;
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((item) => item.sceneId === scene.id) })).filter((item) => item.tasks.length), [scenes, tasks]);
  const downloadOne = (task: ObjectReplaceTask, scene: LogoAsset) => task.resultBlob && downloadBlob(task.resultBlob, outputName(task, scene, settings.imageModel));
  const downloadGroup = async (scene: LogoAsset, items: ObjectReplaceTask[]) => {
    const zip = new JSZip(); items.forEach((item) => item.resultBlob && zip.file(outputName(item, scene, settings.imageModel), item.resultBlob));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), sanitizeFileName(scene.name) + '_物体替换.zip');
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    groups.forEach((group) => { const folder = settings.copiesPerScene > 1 ? zip.folder(String(group.tasks[0]?.sceneIndex + 1).padStart(2, '0') + '_' + sanitizeFileName(group.scene.name))! : zip; group.tasks.forEach((item) => item.resultBlob && folder.file(outputName(item, group.scene, settings.imageModel), item.resultBlob)); });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_物体替换结果.zip');
  };

  const reference = (kind: 'source' | 'target', item?: LogoAsset) => <div className="replace-logo-slot">{item ? <><Image src={item.previewUrl} alt="物体参考图" /><Space><Upload showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => setReference(kind, file as File)}><Button size="small" icon={<ReloadOutlined />}>替换</Button></Upload><Button size="small" danger icon={<DeleteOutlined />} onClick={() => clearReference(kind)}>删除</Button></Space></> : <Upload.Dragger showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => setReference(kind, file as File)}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">上传参考图（选填）</p></Upload.Dragger>}</div>;

  const panel = <div className="settings-panel object-replace-settings-panel">
    <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>物体替换设置</Title><Tag color="geekblue">OBJECT</Tag></Flex>
    <Form layout="vertical" style={{ marginTop: 20 }}>
      <Form.Item label="从新物体参考图移植的元素"><Alert type="info" showIcon title="默认只替换物体本体" description="印花、Logo、雕刻等勾选后从新物体移植；未勾选的酒液、泡沫及其他场景内容会沿用原图。" style={{ marginBottom: 12 }} /><Space direction="vertical">{ELEMENTS.map((item) => <Checkbox key={item.key} checked={settings.preservation[item.key]} onChange={(event) => preserve({ [item.key]: event.target.checked })}>{item.label}</Checkbox>)}</Space>
        <Flex gap={8} style={{ marginTop: 10 }}><Input value={customDraft} placeholder="输入自定义元素" onChange={(event) => setCustomDraft(event.target.value)} onPressEnter={() => { const value = customDraft.trim(); if (value && !settings.preservation.custom.includes(value)) preserve({ custom: [...settings.preservation.custom, value] }); setCustomDraft(''); }} /><Button onClick={() => { const value = customDraft.trim(); if (value && !settings.preservation.custom.includes(value)) preserve({ custom: [...settings.preservation.custom, value] }); setCustomDraft(''); }}>新增</Button></Flex>
        {!!settings.preservation.custom.length && <Space direction="vertical" style={{ width: '100%', marginTop: 10 }}>{settings.preservation.custom.map((item, index) => <Flex key={index} gap={6}><Input value={item} onChange={(event) => preserve({ custom: settings.preservation.custom.map((value, itemIndex) => itemIndex === index ? event.target.value : value) })} /><Button danger icon={<DeleteOutlined />} onClick={() => preserve({ custom: settings.preservation.custom.filter((_, itemIndex) => itemIndex !== index) })} /></Flex>)}</Space>}
        {!targetReference && <Text type="secondary" className="field-help">未上传新物体参考图时，请在新物体名称中明确描述开启元素的外观。</Text>}</Form.Item>
      <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patch({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
      <Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patch({ ratioMode: event.target.value })}><Radio value="original">跟随场景原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patch({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item>
      <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patch({ imageSize: imageSize as ObjectReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item>
      <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(value) => patch({ copiesPerScene: value || 1 })} style={{ width: '100%' }} /></Form.Item>
      <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(value) => patch({ concurrency: value || 1 })} style={{ width: '100%' }} /></Form.Item>
      <Form.Item label="实际替换提示词"><Input.TextArea readOnly value={prompt} autoSize={{ minRows: 7, maxRows: 13 }} /><Text type="secondary" className="field-help">这是实际发送给模型的完整文本，强约束不可编辑。</Text></Form.Item>
    </Form>
    <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, count) + count * PRICING.models[settings.imageModel].inputImage * ((sourceReference ? 1 : 0) + (targetReference ? 1 : 0))} /><Text type="secondary">按 {count} 个请求估算。</Text></Card>
  </div>;

  return <div className="object-replace-page">
    <section className="hero-strip object-replace-hero"><div><Text className="eyebrow">OBJECT REPLACER</Text><Title level={2}>批量替换场景中的同类物体</Title><Paragraph className="hero-description">自动识别并替换所有目标物体，严格保持场景构图和其他内容不变。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传场景图</span></Space>} extra={<Space><Text type="secondary">{scenes.length} 张</Text>{!!scenes.length && <Popconfirm title="清空所有场景图？" onConfirm={clearScenes}><Button size="small" danger>清空全部</Button></Popconfirm>}</Space>}>
      {!scenes.length ? <Upload.Dragger multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴场景图</p><p className="ant-upload-hint">支持多张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}
    </Card>
    <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>定义原物体与新物体</span></Space>}><Alert type="info" showIcon title="名称或参考图至少填写一项" description="参考图可增强识别和外观保持；所有场景统一使用这一组替换条件。" style={{ marginBottom: 16 }} /><div className="replace-logo-grid">
      <Card size="small" title="原物体"><Form layout="vertical"><Form.Item label="原物体名称"><Input value={settings.sourceObjectName} placeholder="例如：杯子" onChange={(event) => { patch({ sourceObjectName: event.target.value }); clearResults(); }} /></Form.Item></Form>{reference('source', sourceReference)}</Card><div className="replace-arrow">→</div>
      <Card size="small" title="新物体"><Form layout="vertical"><Form.Item label="新物体名称"><Input value={settings.targetObjectName} placeholder="例如：带手柄的透明玻璃杯" onChange={(event) => { patch({ targetObjectName: event.target.value }); clearResults(); }} /></Form.Item></Form>{reference('target', targetReference)}</Card>
    </div></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {count} 张图片</Title><Text type="secondary">{scenes.length} 张场景图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} onClick={start}>{busy ? '正在替换' : '开始替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((done / tasks.length) * 100)} status={busy ? 'active' : successful.length ? 'success' : 'exception'} />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>物体替换结果</Title><Text type="secondary">结果按原始场景图分组</Text></div><Space><Popconfirm title="清空全部替换结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!successful.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
      {tasks.length ? <div className="object-result-groups">{groups.map((group) => <Card key={group.scene.id} className="object-result-group" title={sanitizeFileName(group.scene.name)} extra={<Button size="small" disabled={!group.tasks.some((item) => item.resultBlob)} icon={<DownloadOutlined />} onClick={() => void downloadGroup(group.scene, group.tasks)}>下载本组</Button>}><Image.PreviewGroup><div className="logo-replace-results">{group.tasks.map((task) => <Card key={task.id} size="small" title={'结果 ' + (task.copyIndex + 1)} extra={task.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadOne(task, group.scene)} />}><div className="replace-result-image">{task.resultUrl ? <Image src={compareIds.has(task.id) ? group.scene.previewUrl : task.resultUrl} alt="物体替换结果" /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={'task-state-card is-' + task.status}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{stateLabel(task.status)}</Text><Text type="secondary">{task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div><Flex justify="space-between" align="center" gap={8} style={{ marginTop: 8 }}><Space><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{stateLabel(task.status)}</Tag>{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; })}>{compareIds.has(task.id) ? '查看生成图' : '原图对比'}</Button>}</Space>{task.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task)}>重试</Button>}</Flex></Card>)}</div></Image.PreviewGroup></Card>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成上传并开始替换后，结果会显示在这里" />}
    </section>
    <Alert type="warning" showIcon title="生成式替换提示" description="模型会尽量严格保持非目标区域，但生成式图片接口不能保证像素级完全一致。参考图越清晰，识别和外观保持通常越准确。" />
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}