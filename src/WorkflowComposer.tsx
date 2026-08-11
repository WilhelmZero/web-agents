import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge,
  applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ApartmentOutlined, CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, DownloadOutlined,
  ExpandOutlined, FileImageOutlined, PauseOutlined, PictureOutlined, PlayCircleOutlined,
  ReloadOutlined, SaveOutlined, StopOutlined, SwapOutlined, UploadOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Card, Divider, Empty, Flex, Form, Image, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Tabs, Tag, Tooltip, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LOGO_REPLACE_SETTINGS, DEFAULT_SCENE_REPLACE_SETTINGS, MODEL_CAPABILITIES } from './constants';
import { generateLogoReplacement, generateSceneReplacementImage } from './services/gemini';
import { generateLogoReplacementOpenAi } from './services/logoReplaceOpenAi';
import { editPaperTextOpenAi } from './services/paperText';
import { buildOutpaintPrompt, closestAspectRatio, prepareOutpaintInput } from './services/outpaint';
import { reportTaskProgress } from './services/taskProgress';
import {
  WORKFLOW_PORT_TYPES, WorkflowSemaphore, createsCycle, predictWorkflow, topologicalOrder,
  type WorkflowEdgeLike, type WorkflowNodeConfig, type WorkflowNodeData, type WorkflowNodeKind,
} from './services/workflowEngine';
import type { ImageModel } from './types';
import { createId, downloadBlob, sanitizeFileName } from './utils';
import OriginalCompareImage from './OriginalCompareImage';

const { Text, Title } = Typography;
const STORAGE_KEY = 'scene-studio-workflow-v1';
const DRAFT_DB = 'scene-studio-workflow-drafts';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
type FlowNode = Node<WorkflowNodeData, 'creationTool'>;
type FlowEdge = Edge;
interface WorkflowAsset { id: string; file: File; sourceFile: File; url: string; nodeId: string; sourceName: string }
interface GlobalSettings { concurrency: number; retryEnabled: boolean; retryLimit: number; retryDelay: number }
interface Props { apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void }

const MODEL_OPTIONS = [
  { label: 'GPT', options: [{ value: 'gpt-image-2', label: 'GPT Image 2' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] },
  { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) },
];

function defaultConfig(kind: WorkflowNodeKind): WorkflowNodeConfig {
  if (kind === 'logo-replace') return { concurrency: DEFAULT_LOGO_REPLACE_SETTINGS.concurrency, copies: DEFAULT_LOGO_REPLACE_SETTINGS.copiesPerScene, prompt: DEFAULT_LOGO_REPLACE_SETTINGS.replacementPrompt, imageModel: DEFAULT_LOGO_REPLACE_SETTINGS.imageModel, imageSize: DEFAULT_LOGO_REPLACE_SETTINGS.imageSize, quality: 'high', autoOutpaint: false, dualOutpaint: false, outpaintWidth: 3200, outpaintHeight: 1310, randomMatch: DEFAULT_LOGO_REPLACE_SETTINGS.randomAssignLogos };
  if (kind === 'scene-replace') return { concurrency: DEFAULT_SCENE_REPLACE_SETTINGS.concurrency, copies: DEFAULT_SCENE_REPLACE_SETTINGS.copiesPerScene, prompt: '', imageModel: DEFAULT_SCENE_REPLACE_SETTINGS.imageModel, imageSize: DEFAULT_SCENE_REPLACE_SETTINGS.imageSize, quality: DEFAULT_SCENE_REPLACE_SETTINGS.imageQuality, autoOutpaint: false, dualOutpaint: false, outpaintWidth: 3200, outpaintHeight: 1310, randomMatch: true };
  return { concurrency: 3, copies: 1, prompt: '自然延展原图场景，补充画面之外合理存在的环境内容，保持真实摄影质感和自然景深。', imageModel: 'gemini-3.1-flash-image', imageSize: '2K', quality: 'high', autoOutpaint: false, dualOutpaint: false, outpaintWidth: 3200, outpaintHeight: 1310, randomMatch: true };
}

function createNode(kind: WorkflowNodeKind, position: { x: number; y: number }): FlowNode {
  const labels = { 'scene-replace': '场景替换', outpaint: '扩图', 'logo-replace': 'Logo 替换' };
  return { id: createId(), type: 'creationTool', position, data: { label: labels[kind], kind, config: defaultConfig(kind), files: [], logos: [], predictedInput: 0, predictedOutput: 0, sceneOutput: 0, outpaintOutput: 0, success: 0, failed: 0, waiting: 0, status: 'idle', logs: [] } };
}

const KIND_ICON = { 'scene-replace': <PictureOutlined />, outpaint: <ExpandOutlined />, 'logo-replace': <SwapOutlined /> };
const STATUS_COLOR = { idle: 'default', ready: 'blue', running: 'processing', paused: 'warning', success: 'success', failed: 'error', blocked: 'error', stopped: 'default' } as const;

const CreationNode = memo(function CreationNode({ data, selected }: { data: WorkflowNodeData; selected?: boolean }) {
  return <div className={`workflow-node kind-${data.kind}${selected ? ' is-selected' : ''}${data.error ? ' has-error' : ''}`}>
    <Handle type="target" position={Position.Left} id="images" className="workflow-handle" />
    <div className="workflow-node-head"><span className="workflow-node-icon">{KIND_ICON[data.kind]}</span><strong>{data.label}</strong><Tag color={STATUS_COLOR[data.status]}>{data.status === 'running' ? '运行中' : data.status === 'success' ? '已完成' : data.error ? '需处理' : '就绪'}</Tag></div>
    <div className="workflow-node-metrics"><span>输入 <b>{data.predictedInput}</b></span><span>预计输出 <b>{data.predictedOutput}</b></span></div>
    {data.kind === 'scene-replace' ? <div className="workflow-node-outputs"><span>场景结果 <b>{data.sceneOutput}</b></span><span>扩图结果 <b>{data.outpaintOutput || '—'}</b></span></div> : null}
    {data.success || data.failed ? <div className="workflow-node-progress"><span>成功 {data.success}</span><span>失败 {data.failed}</span><span>等待 {data.waiting}</span></div> : null}
    {data.error ? <div className="workflow-node-error">{data.error}</div> : null}
    {data.kind === 'scene-replace' ? <><Handle type="source" position={Position.Right} id="scene-results" className="workflow-handle scene-port" style={{ top: '54%' }} /><Handle type="source" position={Position.Right} id="outpaint-results" className="workflow-handle outpaint-port" style={{ top: '75%' }} /></> : <Handle type="source" position={Position.Right} id={data.kind === 'outpaint' ? 'outpaint-results' : 'logo-results'} className="workflow-handle" />}
  </div>;
});

const FileThumb = memo(function FileThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <Tooltip title={file.name}><div><img src={url} alt={file.name} /><button type="button" onClick={onRemove}>×</button></div></Tooltip>;
});

const AssetCompare = memo(function AssetCompare({ asset }: { asset: WorkflowAsset }) {
  const [originalUrl, setOriginalUrl] = useState('');
  useEffect(() => { const url = URL.createObjectURL(asset.sourceFile); setOriginalUrl(url); return () => URL.revokeObjectURL(url); }, [asset.sourceFile]);
  return originalUrl ? <OriginalCompareImage src={asset.url} originalSrc={originalUrl} alt={asset.file.name} /> : null;
});

function serialize(nodes: FlowNode[], edges: FlowEdge[], name: string, globals: GlobalSettings) {
  return { version: 1, name, globals, nodes: nodes.map((node) => ({ ...node, selected: false, data: { ...node.data, files: [], logos: [], success: 0, failed: 0, waiting: node.data.predictedOutput, status: 'idle', logs: [] } })), edges };
}

async function saveDraft(payload: unknown) {
  await new Promise<void>((resolve, reject) => { const request = indexedDB.open(DRAFT_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(payload, 'latest'); tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
}

async function loadDraft<T>() {
  return new Promise<T | undefined>((resolve, reject) => { const request = indexedDB.open(DRAFT_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('drafts', 'readonly'); const get = tx.objectStore('drafts').get('latest'); get.onsuccess = () => { request.result.close(); resolve(get.result as T | undefined); }; get.onerror = () => reject(get.error); }; });
}

function WorkflowComposerInner({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange }: Props) {
  const { message } = App.useApp();
  const restored = useMemo(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as { name?: string; globals?: GlobalSettings; nodes?: FlowNode[]; edges?: FlowEdge[] } | null; } catch { return null; } }, []);
  const [name, setName] = useState(restored?.name || '商品图工作流');
  const [globals, setGlobals] = useState<GlobalSettings>(restored?.globals || { concurrency: 3, retryEnabled: true, retryLimit: 3, retryDelay: 30 });
  const [nodes, setNodes] = useState<FlowNode[]>(restored?.nodes?.map((node) => ({ ...node, data: { ...node.data, files: [], logos: [], logs: [], status: 'idle' } })) || []);
  const [edges, setEdges] = useState<FlowEdge[]>(restored?.edges || []);
  const [selectedId, setSelectedId] = useState<string>(); const [results, setResults] = useState<Record<string, WorkflowAsset[]>>({});
  const [running, setRunning] = useState(false); const [paused, setPaused] = useState(false); const pausedRef = useRef(false); const abortRef = useRef<AbortController | undefined>(undefined);
  const [resultOpen, setResultOpen] = useState(false); const importRef = useRef<HTMLInputElement>(null);
  const nodesRef = useRef(nodes); const edgesRef = useRef(edges); const resultsRef = useRef(results);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]); useEffect(() => { edgesRef.current = edges; }, [edges]); useEffect(() => { pausedRef.current = paused; }, [paused]);
  const predicted = useMemo(() => predictWorkflow(nodes, edges as WorkflowEdgeLike[]), [nodes, edges]);
  useEffect(() => { const changed = predicted.some((node, index) => node.data.predictedInput !== nodes[index]?.data.predictedInput || node.data.predictedOutput !== nodes[index]?.data.predictedOutput || node.data.error !== nodes[index]?.data.error); if (changed) setNodes(predicted); }, [predicted, nodes]);
  useEffect(() => { const payload = serialize(nodes, edges, name, globals); localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); onSessionStateChange?.(Boolean(nodes.length)); }, [nodes, edges, name, globals, onSessionStateChange]);
  const selected = nodes.find((node) => node.id === selectedId);
  useEffect(() => { const total = nodes.reduce((sum, node) => sum + node.data.predictedOutput, 0); const completed = nodes.reduce((sum, node) => sum + node.data.success + node.data.failed, 0); reportTaskProgress({ id: 'workflow', label: name, total, completed, failed: nodes.reduce((sum, node) => sum + node.data.failed, 0), running }); }, [nodes, name, running]);
  const patchNode = useCallback((id: string, patch: Partial<WorkflowNodeData>) => setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch, status: 'idle', success: 0, failed: 0, logs: [], ...patch } } : node)), []);
  const patchConfig = (patch: Partial<WorkflowNodeConfig>) => selected && patchNode(selected.id, { config: { ...selected.data.config, ...patch } });
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || createsCycle(nodesRef.current, edgesRef.current, connection.source, connection.target)) return void message.error('不允许形成循环工作流');
    if (!WORKFLOW_PORT_TYPES[connection.sourceHandle || 'images'] || !WORKFLOW_PORT_TYPES[connection.targetHandle || 'images']) return void message.error('节点端口类型不兼容');
    if (edgesRef.current.some((edge) => edge.target === connection.target && (edge.targetHandle || 'images') === (connection.targetHandle || 'images'))) return void message.error('该输入端口已经连接了上游');
    setEdges((current) => addEdge({ ...connection, id: createId(), animated: true }, current));
  }, [message]);
  const addNode = (kind: WorkflowNodeKind) => setNodes((current) => [...current, createNode(kind, { x: 90 + current.length * 300, y: 140 + (current.length % 2) * 80 })]);
  const addFiles = (target: 'files' | 'logos', incoming: File[]) => { if (!selected) return false; const valid = incoming.filter((file) => IMAGE_TYPES.includes(file.type) && file.size <= 20 * 1024 * 1024); patchNode(selected.id, { [target]: [...selected.data[target], ...valid] }); return false; };

  const sourceAssets = (node: FlowNode) => {
    const edge = edgesRef.current.find((item) => item.target === node.id && (item.targetHandle || 'images') === 'images');
    if (!edge) return node.data.files.map((file) => ({ id: createId(), file, sourceFile: file, url: URL.createObjectURL(file), nodeId: node.id, sourceName: file.name }));
    const upstream = resultsRef.current[edge.source] || [];
    return upstream.filter((asset) => !edge.sourceHandle || asset.id.includes(`:${edge.sourceHandle}:`) || edge.sourceHandle === 'logo-results');
  };
  const waitPause = async (signal: AbortSignal) => { while (pausedRef.current && !signal.aborted) await new Promise((resolve) => window.setTimeout(resolve, 150)); };
  const withRetry = async <T,>(fn: () => Promise<T>, signal: AbortSignal) => { let attempt = 0; while (true) { await waitPause(signal); try { return await fn(); } catch (error) { if (signal.aborted || !globals.retryEnabled || attempt >= globals.retryLimit) throw error; attempt += 1; await new Promise((resolve) => window.setTimeout(resolve, Math.max(1, globals.retryDelay) * 1000)); } } };
  const generateOutpaint = async (asset: WorkflowAsset, config: WorkflowNodeConfig, signal: AbortSignal, width: number, height: number) => {
    const prepared = await prepareOutpaintInput(asset.file, width, height); const prompt = buildOutpaintPrompt(config.prompt, width, height);
    const blob = config.imageModel.startsWith('gpt-image-') ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: config.imageModel, image: prepared.file, mask: prepared.mask, prompt, quality: config.quality, signal }) : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: config.imageModel as ImageModel, image: prepared.file, imageSize: config.imageSize, aspectRatio: closestAspectRatio(width, height, MODEL_CAPABILITIES[config.imageModel as ImageModel].aspectRatios), prompt })).blob;
    return new File([blob], `${sanitizeFileName(asset.sourceName)}_${width}x${height}.png`, { type: blob.type || 'image/png' });
  };
  const executeNode = async (node: FlowNode, semaphore: WorkflowSemaphore, signal: AbortSignal) => {
    const inputs = sourceAssets(node); const outputs: WorkflowAsset[] = []; let failed = 0; patchNode(node.id, { status: 'running', waiting: node.data.predictedOutput, success: 0, failed: 0, logs: [`开始处理 ${inputs.length} 张输入`] });
    const jobs: Array<() => Promise<void>> = [];
    if (node.data.kind === 'scene-replace') inputs.forEach((asset) => Array.from({ length: node.data.config.copies }).forEach((_, copy) => jobs.push(async () => {
      try { const blob = await withRetry(() => semaphore.run(() => node.data.config.imageModel.startsWith('gpt-image-') ? editPaperTextOpenAi({ apiKey: openAiApiKey, model: node.data.config.imageModel, image: asset.file, prompt: node.data.config.prompt, quality: node.data.config.quality, signal }) : generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: node.data.config.imageModel as ImageModel, prompt: node.data.config.prompt, image: asset.file, imageSize: node.data.config.imageSize }).then((item) => item.blob)), signal); const file = new File([blob], `${sanitizeFileName(asset.sourceName)}_场景_${copy + 1}.png`, { type: blob.type || 'image/png' }); outputs.push({ id: `${createId()}:scene-results:`, file, sourceFile: asset.sourceFile, url: URL.createObjectURL(file), nodeId: node.id, sourceName: asset.sourceName }); if (node.data.config.autoOutpaint) { const sizes = node.data.config.dualOutpaint ? [[3200, 1310], [1800, 1350]] : [[node.data.config.outpaintWidth, node.data.config.outpaintHeight]]; for (const [width, height] of sizes) { const expanded = await withRetry(() => semaphore.run(() => generateOutpaint({ ...asset, file }, node.data.config, signal, width, height)), signal); outputs.push({ id: `${createId()}:outpaint-results:`, file: expanded, sourceFile: file, url: URL.createObjectURL(expanded), nodeId: node.id, sourceName: asset.sourceName }); } } } catch { failed += 1; }
    })));
    if (node.data.kind === 'outpaint') inputs.forEach((asset) => (node.data.config.dualOutpaint ? [[3200, 1310], [1800, 1350]] : [[node.data.config.outpaintWidth, node.data.config.outpaintHeight]]).forEach(([width, height]) => jobs.push(async () => { try { const file = await withRetry(() => semaphore.run(() => generateOutpaint(asset, node.data.config, signal, width, height)), signal); outputs.push({ id: `${createId()}:outpaint-results:`, file, sourceFile: asset.sourceFile, url: URL.createObjectURL(file), nodeId: node.id, sourceName: asset.sourceName }); } catch { failed += 1; } })));
    if (node.data.kind === 'logo-replace') inputs.forEach((asset, index) => Array.from({ length: node.data.config.copies }).forEach((_, copy) => jobs.push(async () => { try { const logo = node.data.logos[node.data.config.randomMatch ? Math.floor(Math.random() * node.data.logos.length) : index]; if (!logo) throw new Error('Logo 不足'); const blob = await withRetry(() => semaphore.run(() => node.data.config.imageModel.startsWith('gpt-image-') ? generateLogoReplacementOpenAi({ apiKey: openAiApiKey, model: 'gpt-image-2', scene: asset.file, newLogo: logo, prompt: node.data.config.prompt || '将场景中的原 Logo 替换为参考 Logo，保持材质、透视、光影与位置自然真实。', signal }).then((item) => item.blob) : generateLogoReplacement({ apiKey, apiBaseUrl, signal, model: node.data.config.imageModel as ImageModel, scene: asset.file, newLogo: logo, logoColorMode: 'original', promptOverride: node.data.config.prompt || undefined, imageSize: node.data.config.imageSize }).then((item) => item.blob)), signal); const file = new File([blob], `${sanitizeFileName(asset.sourceName)}_Logo_${copy + 1}.png`, { type: blob.type || 'image/png' }); outputs.push({ id: `${createId()}:logo-results:`, file, sourceFile: asset.sourceFile, url: URL.createObjectURL(file), nodeId: node.id, sourceName: asset.sourceName }); } catch { failed += 1; } })));
    let cursor = 0; const workers = Array.from({ length: Math.min(node.data.config.concurrency, jobs.length || 1) }, async () => { while (cursor < jobs.length && !signal.aborted) await jobs[cursor++](); }); await Promise.all(workers);
    resultsRef.current = { ...resultsRef.current, [node.id]: outputs }; setResults(resultsRef.current); patchNode(node.id, { status: signal.aborted ? 'stopped' : failed ? 'failed' : 'success', success: outputs.length, failed, waiting: 0, logs: [`完成：成功 ${outputs.length}，失败 ${failed}`], error: failed ? `${failed} 个任务在重试后仍失败，下游已阻断` : undefined }); return failed === 0;
  };
  const validate = () => { const current = predictWorkflow(nodesRef.current, edgesRef.current); setNodes(current); const errors = current.filter((node) => node.data.error); if (!apiKey && !openAiApiKey) errors.push({ ...current[0], data: { ...current[0]?.data, error: '请先配置 API Key' } } as FlowNode); if (errors.length) { message.error(`发现 ${errors.length} 个问题，请查看红色节点`); return false; } message.success('工作流验证通过'); return true; };
  const run = async (mode: 'all' | 'selected' | 'from' = 'all') => { if (running || !validate()) return; const order = topologicalOrder(nodesRef.current, edgesRef.current); let ids = order; if (mode === 'selected' && selectedId) ids = [selectedId]; if (mode === 'from' && selectedId) { const reachable = new Set([selectedId]); let changed = true; while (changed) { changed = false; edgesRef.current.forEach((edge) => { if (reachable.has(edge.source) && !reachable.has(edge.target)) { reachable.add(edge.target); changed = true; } }); } ids = order.filter((id) => reachable.has(id)); }
    const controller = new AbortController(); abortRef.current = controller; setRunning(true); setPaused(false); const semaphore = new WorkflowSemaphore(Math.max(1, globals.concurrency));
    for (const id of ids) { if (controller.signal.aborted) break; const node = nodesRef.current.find((item) => item.id === id); if (!node) continue; const parents = edgesRef.current.filter((edge) => edge.target === id).map((edge) => nodesRef.current.find((item) => item.id === edge.source)); if (parents.some((parent) => parent?.data.status === 'failed' || parent?.data.status === 'blocked')) { patchNode(id, { status: 'blocked', error: '上游存在失败任务，请重试上游后继续' }); break; } const ok = await executeNode(node, semaphore, controller.signal); if (!ok) break; }
    setRunning(false); abortRef.current = undefined;
  };
  const exportJson = () => downloadBlob(new Blob([JSON.stringify(serialize(nodes, edges, name, globals), null, 2)], { type: 'application/json' }), `${sanitizeFileName(name)}.workflow.json`);
  const restoreDraft = async () => { const draft = await loadDraft<{ name: string; globals: GlobalSettings; nodes: FlowNode[]; edges: FlowEdge[]; assets?: Array<{ id: string; files: File[]; logos: File[] }>; results?: Record<string, WorkflowAsset[]> }>(); if (!draft) return void message.info('本机还没有完整草稿'); const assetMap = new Map((draft.assets || []).map((item) => [item.id, item])); setName(draft.name || '恢复的工作流'); setGlobals(draft.globals || globals); setNodes(draft.nodes.map((node) => ({ ...node, data: { ...node.data, files: assetMap.get(node.id)?.files || [], logos: assetMap.get(node.id)?.logos || [] } }))); setEdges(draft.edges || []); const restoredResults = Object.fromEntries(Object.entries(draft.results || {}).map(([id, assets]) => [id, assets.map((asset) => ({ ...asset, url: URL.createObjectURL(asset.file) }))])); resultsRef.current = restoredResults; setResults(restoredResults); message.success('完整草稿已恢复'); };
  const importJson = async (file: File) => { try { const parsed = JSON.parse(await file.text()); if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) throw new Error('不支持的工作流文件'); setName(parsed.name || '导入的工作流'); setGlobals(parsed.globals || globals); setNodes(parsed.nodes); setEdges(parsed.edges || []); message.success('工作流已导入'); } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); } };
  const downloadResults = async () => { const zip = new JSZip(); Object.entries(results).forEach(([nodeId, assets]) => { const folder = zip.folder(nodes.find((node) => node.id === nodeId)?.data.label || nodeId); assets.forEach((asset) => folder?.file(asset.file.name, asset.file)); }); downloadBlob(await zip.generateAsync({ type: 'blob' }), `${sanitizeFileName(name)}_全部结果.zip`); };
  const totalResults = Object.values(results).reduce((sum, items) => sum + items.length, 0);

  return <div className="workflow-builder">
    <header className="workflow-commandbar"><Input variant="borderless" className="workflow-name" value={name} onChange={(event) => setName(event.target.value)} /><Tag color="success">已自动保存</Tag><span className="workflow-command-spacer" /><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => event.target.files?.[0] && void importJson(event.target.files[0])} /><Button icon={<UploadOutlined />} onClick={() => importRef.current?.click()}>导入</Button><Button icon={<DownloadOutlined />} onClick={exportJson}>导出</Button><Button icon={<SaveOutlined />} onClick={() => void saveDraft({ ...serialize(nodes, edges, name, globals), assets: nodes.map((node) => ({ id: node.id, files: node.data.files, logos: node.data.logos })), results }).then(() => message.success('完整草稿已保存到本机'))}>保存完整草稿</Button><Button onClick={() => void restoreDraft()}>恢复草稿</Button><Button icon={<CheckCircleOutlined />} onClick={validate}>验证</Button><Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => void run('all')}>运行全部</Button><Button icon={<PauseOutlined />} disabled={!running} onClick={() => setPaused((value) => !value)}>{paused ? '继续' : '暂停'}</Button><Button danger icon={<StopOutlined />} disabled={!running} onClick={() => abortRef.current?.abort()}>停止</Button></header>
    <div className="workflow-globalbar"><strong><ApartmentOutlined /> 全局设置</strong><Divider type="vertical" /><span>并发数</span><InputNumber min={1} max={12} value={globals.concurrency} onChange={(concurrency) => setGlobals((current) => ({ ...current, concurrency: concurrency || 1 }))} /><span>错误自动重试</span><Switch checked={globals.retryEnabled} onChange={(retryEnabled) => setGlobals((current) => ({ ...current, retryEnabled }))} /><span>重试间隔</span><InputNumber min={1} max={3600} addonAfter="秒" value={globals.retryDelay} onChange={(retryDelay) => setGlobals((current) => ({ ...current, retryDelay: retryDelay || 30 }))} /><span>重试次数</span><InputNumber min={0} max={20} value={globals.retryLimit} onChange={(retryLimit) => setGlobals((current) => ({ ...current, retryLimit: retryLimit || 0 }))} /></div>
    <div className="workflow-shell">
      <aside className="workflow-toolbox"><Title level={4}>工具箱</Title>{(['scene-replace', 'outpaint', 'logo-replace'] as WorkflowNodeKind[]).map((kind) => <button key={kind} type="button" draggable className={`workflow-tool kind-${kind}`} onDragStart={(event) => event.dataTransfer.setData('application/workflow-kind', kind)} onClick={() => addNode(kind)}><span>{KIND_ICON[kind]}</span><span><strong>{{ 'scene-replace': '场景替换', outpaint: '扩图', 'logo-replace': 'Logo 替换' }[kind]}</strong><small>{{ 'scene-replace': '批量替换图片场景', outpaint: '智能扩展图片边界', 'logo-replace': '批量替换场景 Logo' }[kind]}</small></span></button>)}<Divider /><Text type="secondary">拖入画布或点击添加。输出可连接多个下游，输入端口只能连接一个上游。</Text>{totalResults ? <Button block type="primary" ghost icon={<DownloadOutlined />} onClick={() => void downloadResults()}>下载全部结果（{totalResults}）</Button> : null}</aside>
      <main className="workflow-canvas" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); const kind = event.dataTransfer.getData('application/workflow-kind') as WorkflowNodeKind; if (kind) addNode(kind); }}><ReactFlow<FlowNode, FlowEdge> nodes={nodes} edges={edges} nodeTypes={{ creationTool: CreationNode }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(undefined)} fitView deleteKeyCode={['Backspace', 'Delete']}><Background gap={20} color="#dfe6f1" /><Controls /><MiniMap nodeColor={(node) => node.data?.error ? '#ff4d4f' : node.data?.kind === 'logo-replace' ? '#7c5cff' : node.data?.kind === 'outpaint' ? '#20b486' : '#3b75f2'} pannable zoomable /></ReactFlow></main>
      <aside className="workflow-inspector">{selected ? <><Flex justify="space-between" align="center"><Space><span className={`workflow-inspector-icon kind-${selected.data.kind}`}>{KIND_ICON[selected.data.kind]}</span><Title level={4} style={{ margin: 0 }}>{selected.data.label}</Title></Space><Button type="text" danger icon={<DeleteOutlined />} onClick={() => { setNodes((current) => current.filter((node) => node.id !== selected.id)); setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedId(undefined); }} /></Flex><Tabs items={[
        { key: 'config', label: '配置', children: <Form layout="vertical"><Form.Item label="节点名称"><Input value={selected.data.label} onChange={(event) => patchNode(selected.id, { label: event.target.value })} /></Form.Item><Form.Item label="图片模型"><Select value={selected.data.config.imageModel} options={MODEL_OPTIONS} onChange={(imageModel) => patchConfig({ imageModel })} /></Form.Item><Form.Item label="节点并发上限"><InputNumber min={1} max={8} value={selected.data.config.concurrency} onChange={(concurrency) => patchConfig({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item>{selected.data.kind !== 'outpaint' ? <Form.Item label="每张生成数量"><InputNumber min={1} max={8} value={selected.data.config.copies} onChange={(copies) => patchConfig({ copies: copies || 1 })} style={{ width: '100%' }} /></Form.Item> : null}<Form.Item label={selected.data.kind === 'outpaint' ? '扩图提示词' : selected.data.kind === 'scene-replace' ? '场景替换提示词' : 'Logo 替换补充提示词'}><Input.TextArea value={selected.data.config.prompt} onChange={(event) => patchConfig({ prompt: event.target.value })} autoSize={{ minRows: 4, maxRows: 9 }} /></Form.Item>{selected.data.kind === 'scene-replace' ? <><Form.Item label="生成后自动扩图"><Switch checked={selected.data.config.autoOutpaint} onChange={(autoOutpaint) => patchConfig({ autoOutpaint })} /></Form.Item>{selected.data.config.autoOutpaint ? <Form.Item label="同时输出双尺寸"><Switch checked={selected.data.config.dualOutpaint} onChange={(dualOutpaint) => patchConfig({ dualOutpaint })} /><Text type="secondary"> 3200×1310 与 1800×1350</Text></Form.Item> : null}</> : null}{selected.data.kind === 'outpaint' ? <><Form.Item label="输出模式"><Segmented block value={selected.data.config.dualOutpaint ? 'dual' : 'single'} options={[{ label: '单尺寸', value: 'single' }, { label: '双尺寸', value: 'dual' }]} onChange={(value) => patchConfig({ dualOutpaint: value === 'dual' })} /></Form.Item>{!selected.data.config.dualOutpaint ? <Flex gap={8}><Form.Item label="宽度"><InputNumber min={64} max={8192} value={selected.data.config.outpaintWidth} onChange={(outpaintWidth) => patchConfig({ outpaintWidth: outpaintWidth || 64 })} /></Form.Item><Form.Item label="高度"><InputNumber min={64} max={8192} value={selected.data.config.outpaintHeight} onChange={(outpaintHeight) => patchConfig({ outpaintHeight: outpaintHeight || 64 })} /></Form.Item></Flex> : null}</> : null}{selected.data.kind === 'logo-replace' ? <Form.Item label="随机匹配 Logo"><Switch checked={selected.data.config.randomMatch} onChange={(randomMatch) => patchConfig({ randomMatch })} /><Text type="secondary"> 开启后允许一张 Logo 循环匹配全部场景</Text></Form.Item> : null}</Form> },
        { key: 'input', label: `输入 ${selected.data.predictedInput}`, children: <><Upload.Dragger multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file) => addFiles('files', [file as File])}><CloudUploadOutlined /><p>{edges.some((edge) => edge.target === selected.id) ? '已连接上游；也可断开后上传本地图片' : '拖入图片或文件夹，或点击批量上传'}</p></Upload.Dragger><div className="workflow-file-grid">{selected.data.files.map((file, index) => <FileThumb file={file} key={`${file.name}-${file.lastModified}-${index}`} onRemove={() => patchNode(selected.id, { files: selected.data.files.filter((_, i) => i !== index) })} />)}</div>{selected.data.kind === 'logo-replace' ? <><Divider>Logo 素材</Divider><Upload.Dragger multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file) => addFiles('logos', [file as File])}><FileImageOutlined /><p>批量上传 Logo</p></Upload.Dragger><div className="workflow-file-grid">{selected.data.logos.map((file, index) => <FileThumb file={file} key={`${file.name}-${file.lastModified}-${index}`} onRemove={() => patchNode(selected.id, { logos: selected.data.logos.filter((_, i) => i !== index) })} />)}</div></> : null}</> },
        { key: 'output', label: `输出 ${selected.data.success || selected.data.predictedOutput}`, children: <><Card size="small"><Flex justify="space-between"><Text>预计输入</Text><b>{selected.data.predictedInput}</b></Flex><Flex justify="space-between"><Text>预计输出</Text><b>{selected.data.predictedOutput}</b></Flex><Flex justify="space-between"><Text>实际成功</Text><b>{selected.data.success}</b></Flex><Flex justify="space-between"><Text>失败</Text><b>{selected.data.failed}</b></Flex></Card>{selected.data.error ? <Alert type="error" showIcon title={selected.data.error} style={{ marginTop: 12 }} /> : <Alert type="success" showIcon title="数量校验通过" style={{ marginTop: 12 }} />}{results[selected.id]?.length ? <Button block type="primary" style={{ marginTop: 12 }} onClick={() => setResultOpen(true)}>查看生成结果</Button> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="运行后显示输出" />}</> },
        { key: 'logs', label: '运行日志', children: selected.data.logs.length ? selected.data.logs.map((log, index) => <div className="workflow-log" key={index}>{log}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行日志" /> },
      ]} /><Space direction="vertical" style={{ width: '100%' }}><Button block type="primary" icon={<PlayCircleOutlined />} disabled={running} onClick={() => void run('selected')}>仅运行此节点</Button><Button block icon={<ReloadOutlined />} disabled={running} onClick={() => void run('from')}>从此节点向后运行</Button></Space></> : <Empty description="点击节点后在这里配置输入、参数和输出" />}</aside>
    </div>
    <Modal open={resultOpen} width="min(1100px, 94vw)" footer={null} title={`${selected?.data.label || ''} · 生成结果`} onCancel={() => setResultOpen(false)}><Image.PreviewGroup><div className="workflow-result-grid">{(selected ? results[selected.id] : [])?.map((asset) => <Card key={asset.id} size="small" title={<Text ellipsis>{asset.file.name}</Text>} extra={<Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(asset.file, asset.file.name)} />}><AssetCompare asset={asset} /></Card>)}</div></Image.PreviewGroup></Modal>
  </div>;
}

export default function WorkflowComposer(props: Props) { return <ReactFlowProvider><WorkflowComposerInner {...props} /></ReactFlowProvider>; }
