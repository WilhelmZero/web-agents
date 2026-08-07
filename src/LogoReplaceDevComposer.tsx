import { ExperimentOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, StopOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Empty, Flex, Form, Image, InputNumber, Popconfirm, Progress, Radio, Segmented, Select, Space, Switch, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOGO_REPLACE_SETTINGS, MODEL_CAPABILITIES } from './constants';
import GeneratingImage from './GeneratingImage';
import { analyzeSceneLogoStyles, generateMultiLogoReplacement } from './services/gemini';
import { assignMultipleLogos } from './services/logoReplaceDevUtils';
import type { LogoAsset, LogoReplaceDevTask, LogoReplaceSettings, SceneLogoAnalysis, SceneLogoStyle } from './types';
import { createId, downloadBlob, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Title, Text, Paragraph } = Typography;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;
const FALLBACK_STYLE: SceneLogoStyle = { id: 'single', label: '样式 1', description: '场景中的现有品牌 Logo', occurrences: 1, carrier: '原 Logo 所在载体' };

export default function LogoReplaceDevComposer({ apiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void;
  onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<LogoReplaceSettings>(() => ({ ...DEFAULT_LOGO_REPLACE_SETTINGS } as LogoReplaceSettings));
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [logos, setLogos] = useState<LogoAsset[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, SceneLogoAnalysis>>({});
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [seed, setSeed] = useState(createId);
  const [tasks, setTasks] = useState<LogoReplaceDevTask[]>([]);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const analyzing = useRef(new Set<string>());
  const running = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes); const logosRef = useRef(logos); const settingsRef = useRef(settings); const analysesRef = useRef(analyses);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { logosRef.current = logos; }, [logos]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { analysesRef.current = analyses; }, [analyses]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || logos.length || tasks.length)), [scenes.length, logos.length, tasks.length, onSessionStateChange]);

  const validate = (file: File) => { if (!TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`); if (!file.size || file.size > MAX_SIZE) return void message.error(`${file.name}：文件需小于 20MB`); return true; };
  const asset = (file: File): LogoAsset => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
  const clearTasks = () => { aborters.current.forEach((item) => item.abort()); setTasks((current) => { current.forEach((item) => item.resultUrl && URL.revokeObjectURL(item.resultUrl)); return []; }); setCompareIds(new Set()); };
  const addScenes = (files: File[]) => { const next = files.filter((file) => validate(file) === true).map(asset); if (next.length) { clearTasks(); setScenes((current) => [...current, ...next]); } return false; };
  const addLogos = (files: File[]) => { const next = files.filter((file) => validate(file) === true).map(asset); if (next.length) { clearTasks(); setLogos((current) => [...current, ...next]); setSeed(createId()); } return false; };
  const removeAsset = (kind: 'scene' | 'logo', id: string) => { clearTasks(); const setter = kind === 'scene' ? setScenes : setLogos; setter((current) => { current.find((item) => item.id === id)?.previewUrl && URL.revokeObjectURL(current.find((item) => item.id === id)!.previewUrl); return current.filter((item) => item.id !== id); }); if (kind === 'scene') { setAnalyses((current) => { const next = { ...current }; delete next[id]; return next; }); setAssignments((current) => { const next = { ...current }; delete next[id]; return next; }); } };
  const patch = (value: Partial<LogoReplaceSettings>) => setSettings((current) => { const next = { ...current, ...value }; return value.imageModel ? { ...next, ...normalizeSettingsForModel(value.imageModel, next.aspectRatio, next.imageSize) } : next; });

  const analyzeOne = useCallback(async (scene: LogoAsset) => {
    if (analyzing.current.has(scene.id)) return;
    analyzing.current.add(scene.id); setAnalyses((current) => ({ ...current, [scene.id]: { sceneId: scene.id, status: 'analyzing', styles: [] } }));
    try { const result = await analyzeSceneLogoStyles({ apiKey, apiBaseUrl, model: settings.verificationModel, scene: scene.file }); setAnalyses((current) => ({ ...current, [scene.id]: { sceneId: scene.id, status: 'success', ...result } })); }
    catch (error) { setAnalyses((current) => ({ ...current, [scene.id]: { sceneId: scene.id, status: 'failed', styles: [], error: error instanceof Error ? error.message : '解析失败' } })); }
    finally { analyzing.current.delete(scene.id); }
  }, [apiKey, apiBaseUrl, settings.verificationModel]);
  useEffect(() => {
    if (!multiEnabled || !apiKey) return;
    const pending = scenes.filter((scene) => !analyses[scene.id] && !analyzing.current.has(scene.id));
    pending.slice(0, Math.max(0, 8 - analyzing.current.size)).forEach((scene) => void analyzeOne(scene));
  }, [multiEnabled, scenes, analyses, apiKey, analyzeOne]);
  useEffect(() => { setAssignments(assignMultipleLogos(scenes.map((scene) => scene.id), analyses, logos, seed)); }, [scenes, analyses, logos, seed]);

  const execute = useCallback(async (task: LogoReplaceDevTask) => {
    if (running.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId); const selected = task.newLogoIds.map((id) => logosRef.current.find((item) => item.id === id)).filter(Boolean) as LogoAsset[];
    if (!scene || !selected.length) return;
    running.current.add(task.id); const controller = new AbortController(); aborters.current.set(task.id, controller); setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try { const config = settingsRef.current; const styles = analysesRef.current[scene.id]?.styles.length ? analysesRef.current[scene.id].styles.slice(0, selected.length) : [FALLBACK_STYLE]; const result = await generateMultiLogoReplacement({ apiKey, apiBaseUrl, signal: controller.signal, model: config.imageModel, scene: scene.file, logos: selected.map((item) => item.file), styles, instruction: '保持每个新 Logo 的图形、文字、大小写、颜色和比例准确。', aspectRatio: config.ratioMode === 'fixed' ? config.aspectRatio : undefined, imageSize: config.imageSize }); const resultUrl = URL.createObjectURL(result.blob); setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType } : item)); }
    catch (error) { setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: controller.signal.aborted ? 'stopped' : 'failed', error: controller.signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '替换失败' } : item)); }
    finally { running.current.delete(task.id); aborters.current.delete(task.id); }
  }, [apiKey, apiBaseUrl]);
  useEffect(() => { const free = Math.max(0, settings.concurrency - running.current.size); tasks.filter((item) => item.status === 'waiting' && !running.current.has(item.id)).slice(0, free).forEach((item) => void execute(item)); }, [tasks, settings.concurrency, execute]);

  const start = () => {
    if (!apiKey) return onRequestKey(); if (connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey(); if (!scenes.length || !logos.length) return void message.warning('请先上传场景图和新 Logo');
    if (multiEnabled && scenes.some((scene) => analyses[scene.id]?.status !== 'success')) return void message.warning('请等待所有场景解析完成，失败项可点击重新解析');
    const invalid = scenes.find((scene) => (assignments[scene.id]?.length || 0) < (multiEnabled ? Math.max(1, analyses[scene.id]?.styles.length || 1) : 1)); if (invalid) return void message.warning('新 Logo 数量不足，或部分场景尚未完成 Logo 分配');
    clearTasks(); setTasks(scenes.flatMap((scene, sceneIndex) => Array.from({ length: settings.copiesPerScene }, (_, copyIndex) => ({ id: createId(), sceneId: scene.id, sceneIndex, newLogoIds: assignments[scene.id], copyIndex, status: 'waiting' as const, retryCount: 0 }))));
  };
  const retry = (task: LogoReplaceDevTask) => { const next = { ...task, status: 'waiting' as const, retryCount: task.retryCount + 1, error: undefined }; setTasks((current) => current.map((item) => item.id === task.id ? next : item)); };
  const busy = tasks.some((item) => item.status === 'waiting' || item.status === 'running'); const done = tasks.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length; const successful = tasks.filter((item) => item.resultBlob);
  const outputName = (task: LogoReplaceDevTask) => `${String(task.sceneIndex + 1).padStart(2, '0')}_multi-logo_${task.copyIndex + 1}.${mimeExtension(task.resultMimeType)}`;
  const downloadAll = async () => { const zip = new JSZip(); tasks.forEach((task) => task.resultBlob && zip.file(outputName(task), task.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), 'Logo替换开发版结果.zip'); };

  const panel = <div className="settings-panel"><Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>开发版设置</Title><Tag color="magenta">DEV</Tag></Flex><Form layout="vertical" style={{ marginTop: 20 }}><Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patch({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item><Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patch({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 8 }} value={settings.aspectRatio} onChange={(aspectRatio) => patch({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item><Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patch({ imageSize: imageSize as LogoReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item><Form.Item label="每张生成数量"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(copiesPerScene) => patch({ copiesPerScene: copiesPerScene || 1 })} style={{ width: '100%' }} /></Form.Item><Form.Item label="生成并发数"><InputNumber min={1} max={8} value={settings.concurrency} onChange={(concurrency) => patch({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item></Form></div>;

  return <div className="logo-replace-dev-page"><section className="hero-strip logo-replace-dev-hero"><div><Text className="eyebrow">MULTI LOGO LAB</Text><Title level={2}>多样式 Logo 智能替换开发版</Title><Paragraph className="hero-description">识别单张场景中的不同 Logo 样式，将每种样式及其所有重复位置映射到不同的新 Logo。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传场景图</span></Space>} extra={<Flex align="center" gap={8}><Text>单图匹配多 Logo</Text><Switch checked={multiEnabled} onChange={(checked) => { setMultiEnabled(checked); setAnalyses({}); setSeed(createId()); clearTasks(); }} /></Flex>}><Alert type={multiEnabled ? 'info' : 'warning'} showIcon title={multiEnabled ? '已开启场景预解析 · 最大并发 8' : '未开启时每张场景只分配一个新 Logo，不会调用语言模型解析'} style={{ marginBottom: 14 }} />{!scenes.length ? <Upload.Dragger multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">上传含一个或多个 Logo 样式的场景图</p></Upload.Dragger> : <div className="dev-scene-analysis-list">{scenes.map((scene) => { const analysis = analyses[scene.id]; return <Card size="small" key={scene.id}><Flex gap={14} align="start"><Image width={110} height={110} style={{ objectFit: 'cover', borderRadius: 8 }} src={scene.previewUrl} /><div style={{ flex: 1, minWidth: 0 }}><Flex justify="space-between"><Text strong ellipsis={{ tooltip: scene.name }}>{scene.name}</Text><Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeAsset('scene', scene.id)} /></Flex>{multiEnabled ? !analysis ? <Tag>等待解析</Tag> : analysis.status === 'analyzing' ? <Tag color="processing">AI 解析中</Tag> : analysis.status === 'failed' ? <Space><Tag color="error">解析失败</Tag><Button size="small" icon={<ReloadOutlined />} onClick={() => { setAnalyses((current) => { const next = { ...current }; delete next[scene.id]; return next; }); }}>重试</Button></Space> : <><Text type="secondary">识别到 {analysis.styles.length} 种样式，共 {analysis.styles.reduce((sum, item) => sum + item.occurrences, 0)} 个位置</Text><Flex wrap gap={6} style={{ marginTop: 8 }}>{analysis.styles.map((style) => <Tag key={style.id} color="purple">{style.label} × {style.occurrences} · {style.carrier}</Tag>)}</Flex></> : <Tag>单 Logo 模式</Tag>}</div></Flex></Card>; })}<Upload multiple showUploadList={false} beforeUpload={(file) => addScenes([file as File])}><Button icon={<PlusOutlined />}>继续添加场景</Button></Upload></div>}</Card>
    <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>上传并分配新 Logo</span></Space>} extra={<Button disabled={!logos.length} onClick={() => setSeed(createId())}>重新随机分配</Button>}><Upload multiple showUploadList={false} accept={TYPES.join(',')} beforeUpload={(file) => addLogos([file as File])}><Button icon={<PlusOutlined />}>上传新 Logo</Button></Upload>{!!logos.length && <div className="dev-logo-strip">{logos.map((logo) => <div key={logo.id}><Image src={logo.previewUrl} /><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeAsset('logo', logo.id)} /></div>)}</div>} {!!scenes.length && <div className="dev-mapping-list">{scenes.map((scene) => { const required = multiEnabled ? Math.max(1, analyses[scene.id]?.styles.length || 1) : 1; return <Flex key={scene.id} gap={12} align="center"><Text style={{ width: 180 }} ellipsis={{ tooltip: scene.name }}>{scene.name}</Text><Select mode="multiple" maxCount={required} value={assignments[scene.id] || []} onChange={(ids) => setAssignments((current) => ({ ...current, [scene.id]: ids }))} placeholder={`请选择 ${required} 个不同 Logo`} style={{ flex: 1 }} options={logos.map((logo) => ({ value: logo.id, label: logo.name }))} /><Tag color={(assignments[scene.id]?.length || 0) === required ? 'success' : 'warning'}>{assignments[scene.id]?.length || 0}/{required}</Tag></Flex>; })}</div>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center"><div><Title level={4} style={{ margin: 0 }}>准备生成 {scenes.length * settings.copiesPerScene} 张结果</Title><Text type="secondary">{multiEnabled ? '每张请求携带该场景所需的多个不同新 Logo' : '每张请求携带一个新 Logo'}</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={() => { aborters.current.forEach((item) => item.abort()); setTasks((current) => current.map((item) => item.status === 'waiting' ? { ...item, status: 'stopped' } : item)); }}>停止</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} onClick={start}>开始开发版替换</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 16 }} percent={Math.round(done / tasks.length * 100)} />}</Card>
    <section className="results-section"><Flex justify="space-between"><Title level={3}>开发版结果</Title><Button disabled={!successful.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>{tasks.length ? <div className="logo-replace-results">{tasks.map((task) => { const scene = scenes.find((item) => item.id === task.sceneId); return <Card key={task.id} size="small" title={`场景 ${task.sceneIndex + 1} · ${task.newLogoIds.length} 个 Logo`} extra={task.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => task.resultBlob && downloadBlob(task.resultBlob, outputName(task))} />}><div className="replace-result-image">{task.resultUrl && scene ? <Image src={compareIds.has(task.id) ? scene.previewUrl : task.resultUrl} /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text>{task.error || task.status}</Text></div>}</div><Flex justify="space-between" style={{ marginTop: 8 }}><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.status}</Tag><Space>{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; })}>原图对比</Button>}{task.status === 'failed' && <Button size="small" onClick={() => retry(task)}>重试</Button>}</Space></Flex></Card>; })}</div> : <Empty description="完成解析、映射并生成后，结果会显示在这里" />}</section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
