import { App, Alert, Button, Card, Empty, Flex, Image, InputNumber, Modal, Popconfirm, Progress, Space, Statistic, Tag, Typography, Upload } from 'antd';
import { DeleteOutlined, EyeOutlined, FileImageOutlined, FolderOpenOutlined, PlusOutlined, RocketOutlined, StopOutlined, SyncOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import LogoReplaceComposer from './LogoReplaceComposer';
import PsdLogoImportModal from './PsdLogoImportModal';
import { reportTaskProgress } from './services/taskProgress';
import type { LogoReplaceProgressSnapshot, LogoReplaceTaskDetail } from './types';

const { Title, Text, Paragraph } = Typography;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DB_NAME = 'scene-studio.multi-tab-logo-replace.v1';
const STORE = 'batches';

interface FolderGroup { id: string; name: string; path: string; files: File[] }
interface SharedBatch { id: string; createdAt: number; groups: FolderGroup[]; logos: File[]; globalConcurrency?: number; startCommandId?: string }
interface WorkerProgress extends LogoReplaceProgressSnapshot { groupId: string; name: string; status: 'opening' | 'ready' | 'running' | 'completed'; updatedAt: number }

function FileThumbnail({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setPreviewUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <div className="batch-asset-card">{previewUrl ? <Image src={previewUrl} alt={file.name} /> : <div className="batch-asset-placeholder"><FileImageOutlined /></div>}<Text ellipsis={{ tooltip: file.name }}>{file.name}</Text><Popconfirm title="从当前批次移除这张图片？" description="不会删除电脑中的原文件。" onConfirm={onRemove}><Button danger type="text" size="small" icon={<DeleteOutlined />}>移除</Button></Popconfirm></div>;
}

function TaskResultThumbnail({ detail }: { detail: LogoReplaceTaskDetail }) {
  const [urls, setUrls] = useState({ result: '', original: '' });
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    const result = detail.resultBlob ? URL.createObjectURL(detail.resultBlob) : '';
    const original = detail.originalFile ? URL.createObjectURL(detail.originalFile) : '';
    setUrls({ result, original });
    setShowOriginal(false);
    return () => { if (result) URL.revokeObjectURL(result); if (original) URL.revokeObjectURL(original); };
  }, [detail.resultBlob, detail.originalFile]);
  const statusText = detail.status === 'success' ? '生成完成' : detail.status === 'failed' ? '生成失败' : detail.status === 'stopped' ? '已停止' : detail.status === 'running' ? '生成中' : '等待中';
  const statusColor = detail.status === 'success' ? 'success' : detail.status === 'failed' ? 'error' : detail.status === 'running' ? 'processing' : 'default';
  const toggleOriginal = () => setShowOriginal((current) => !current);
  return <Card size="small" className="batch-result-card" title={`场景 ${detail.sceneIndex + 1} · 结果 ${detail.copyIndex + 1}`} extra={<Tag color={statusColor}>{statusText}</Tag>}>
    {urls.result ? <>
      <div className="batch-result-image"><Image src={showOriginal && urls.original ? urls.original : urls.result} alt={showOriginal ? '原图' : '生成图'} preview={{ actionsRender: (originalNode) => <>{originalNode}{urls.original && <button type="button" className={`scene-preview-compare-action${showOriginal ? ' is-active' : ''}`} title={showOriginal ? '查看生成图' : '查看原图'} onClick={(event) => { event.stopPropagation(); toggleOriginal(); }}><EyeOutlined /></button>}</> }} /></div>
      {urls.original && <Button block size="small" icon={<EyeOutlined />} onClick={toggleOriginal}>{showOriginal ? '查看生成图' : '查看原图'}</Button>}
    </> : <div className="batch-result-state"><FileImageOutlined /><Text type="secondary">{detail.error || statusText}</Text></div>}
    <Flex gap={6} wrap className="batch-result-meta">{detail.retryCount > 0 && <Tag color="gold">重试 {detail.retryCount} 次</Tag>}{detail.verificationStatus && <Tag>校验：{detail.verificationStatus}</Tag>}</Flex>
  </Card>;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function saveBatch(batch: SharedBatch) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(batch); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function readBatch(id: string) {
  const db = await openDb();
  const result = await new Promise<SharedBatch | undefined>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close(); return result;
}

export function groupFolderFiles(files: File[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  files.filter((file) => IMAGE_TYPES.includes(file.type)).forEach((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relativePath.split('/').filter(Boolean); const directories = parts.slice(0, -1);
    const leaf = directories.at(-1) || '未分组'; const parent = directories.at(-2);
    const name = parent === leaf ? leaf : leaf; const path = directories.join('/');
    const id = encodeURIComponent(path || name);
    const group = groups.get(id) || { id, name, path, files: [] }; group.files.push(file); groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

function injectFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input || !files.length) return false;
  const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true;
}

interface Props { apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; settingsHost?: HTMLElement | null; onSessionStateChange?: (value: boolean) => void }

export default function MultiTabLogoReplaceComposer(props: Props) {
  const { message } = App.useApp(); const params = new URLSearchParams(location.search);
  const batchId = params.get('batch'); const groupId = params.get('group'); const worker = params.get('worker') === '1';
  const [groups, setGroups] = useState<FolderGroup[]>([]); const [logos, setLogos] = useState<File[]>([]); const [tabLimit, setTabLimit] = useState(4);
  const [globalConcurrency, setGlobalConcurrency] = useState(6);
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [pendingPsdFile, setPendingPsdFile] = useState<File>();
  const [blockedWorkerUrls, setBlockedWorkerUrls] = useState<Array<{ name: string; url: string }>>([]);
  const [workerBatch, setWorkerBatch] = useState<SharedBatch>(); const [workerGroup, setWorkerGroup] = useState<FolderGroup>(); const [injected, setInjected] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null); const loadedLogoKeys = useRef(new Set<string>());
  const [channel, setChannel] = useState<BroadcastChannel>();
  const [automationStartToken, setAutomationStartToken] = useState<string>();
  const [workerProgress, setWorkerProgress] = useState<Record<string, WorkerProgress>>({});
  const [workerTaskDetails, setWorkerTaskDetails] = useState<Record<string, Record<string, LogoReplaceTaskDetail>>>({});
  const [selectedProgressGroupId, setSelectedProgressGroupId] = useState<string>();
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  useEffect(() => { if (typeof BroadcastChannel === 'undefined') return; const next = new BroadcastChannel('scene-studio-logo-tabs'); setChannel(next); return () => next.close(); }, []);

  useEffect(() => {
    if (!worker || !batchId || !groupId) return;
    void readBatch(batchId).then((batch) => { const group = batch?.groups.find((item) => item.id === groupId); setWorkerBatch(batch); setWorkerGroup(group); setAutomationStartToken(batch?.startCommandId); props.onSessionStateChange?.(Boolean(group)); });
  }, [worker, batchId, groupId, props.onSessionStateChange]);

  useEffect(() => {
    if (!workerBatch || !workerGroup || injected) return;
    const timer = window.setTimeout(() => {
      const root = rootRef.current; if (!root) return;
      const sceneInput = root.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept="image/png,image/jpeg,image/webp"]');
      const logoInput = root.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept*=".psd"]');
      const sceneOk = injectFiles(sceneInput, workerGroup.files); const logoOk = injectFiles(logoInput, workerBatch.logos);
      workerBatch.logos.forEach((file) => loadedLogoKeys.current.add(`${file.name}:${file.size}:${file.lastModified}`));
      if (sceneOk && logoOk) { setInjected(true); channel?.postMessage({ type: 'worker-ready', batchId, groupId, name: workerGroup.name, count: workerGroup.files.length }); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [workerBatch, workerGroup, injected, channel, batchId, groupId]);

  useEffect(() => {
    if (!channel) return;
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.batchId !== (worker ? batchId : activeBatchId)) return;
      if (worker && data.type === 'start-all') setAutomationStartToken(data.commandId);
      if (worker && data.type === 'stop-all') rootRef.current?.querySelector<HTMLButtonElement>('.logo-replace-integrated .action-card button.ant-btn-danger')?.click();
      if (worker && data.type === 'logos-updated' && batchId) void readBatch(batchId).then((batch) => {
        if (!batch) return; setWorkerBatch(batch); const fresh = batch.logos.filter((file) => !loadedLogoKeys.current.has(`${file.name}:${file.size}:${file.lastModified}`));
        if (fresh.length) { const input = rootRef.current?.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept*=".psd"]') || null; injectFiles(input, fresh); fresh.forEach((file) => loadedLogoKeys.current.add(`${file.name}:${file.size}:${file.lastModified}`)); message.success(`已同步 ${fresh.length} 个公共 Logo`); }
      });
      if (!worker && data.type === 'worker-ready') setWorkerProgress((current) => ({ ...current, [data.groupId]: { ...(current[data.groupId] || { total: 0, success: 0, failed: 0, stopped: 0, waiting: 0, running: 0, retrying: 0 }), groupId: data.groupId, name: data.name, status: 'ready', updatedAt: Date.now() } }));
      if (!worker && data.type === 'worker-progress') setWorkerProgress((current) => ({ ...current, [data.groupId]: data.progress }));
      if (!worker && data.type === 'worker-task') setWorkerTaskDetails((current) => ({ ...current, [data.groupId]: { ...(current[data.groupId] || {}), [data.detail.id]: data.detail } }));
    };
    channel.addEventListener('message', receive);
    return () => channel.removeEventListener('message', receive);
  }, [worker, channel, batchId, activeBatchId, message]);

  useEffect(() => {
    if (!worker || !workerBatch?.globalConcurrency || !navigator.locks) return;
    const originalFetch = window.fetch.bind(window); const slots = workerBatch.globalConcurrency;
    window.fetch = async (...args) => {
      const target = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (!/generativelanguage\.googleapis\.com|api\.openai\.com|\/api\/gemini/i.test(target)) return originalFetch(...args);
      while (true) {
        for (let index = 0; index < slots; index += 1) {
          const result = await navigator.locks.request(`scene-studio-ai-slot-${index}`, { ifAvailable: true }, async (lock) => lock ? originalFetch(...args) : undefined);
          if (result) return result;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    };
    return () => { window.fetch = originalFetch; };
  }, [worker, workerBatch?.globalConcurrency]);

  const openWorkers = async () => {
    if (!groups.length) return void message.warning('请先选择包含各组图片的根文件夹'); if (!logos.length) return void message.warning('请先上传公共 Logo');
    const selected = groups.slice(0, tabLimit); const id = `batch-${Date.now()}`;
    const placeholders = selected.map((_group, index) => window.open('', `scene-studio-logo-worker-${id}-${index}`));
    await saveBatch({ id, createdAt: Date.now(), groups, logos, globalConcurrency });
    setActiveBatchId(id);
    setWorkerProgress(Object.fromEntries(selected.map((group) => [group.id, { groupId: group.id, name: group.name, status: 'opening', total: 0, success: 0, failed: 0, stopped: 0, waiting: 0, running: 0, retrying: 0, updatedAt: Date.now() }])));
    const targets = selected.map((group) => { const url = new URL(location.href); url.searchParams.set('tool', 'logo-replace-tabs'); url.searchParams.set('worker', '1'); url.searchParams.set('batch', id); url.searchParams.set('group', group.id); url.searchParams.set('folder', group.name); return { name: group.name, url: url.toString() }; });
    const blocked: typeof targets = [];
    targets.forEach((target, index) => { const opened = placeholders[index]; if (opened) opened.location.href = target.url; else blocked.push(target); });
    setBlockedWorkerUrls(blocked); if (blocked.length) message.warning(`${blocked.length} 个标签被浏览器拦截，请在弹窗中逐个打开或允许本站弹出窗口`);
    if (selected.length < groups.length) message.info(`已打开 ${selected.length} 组，其余 ${groups.length - selected.length} 组可提高同时标签数后再次打开`);
  };
  const syncLogos = async () => { const id = activeBatchId || batchId; if (!id) return; const batch = await readBatch(id); if (!batch) return; batch.logos = logos; await saveBatch(batch); channel?.postMessage({ type: 'logos-updated', batchId: id }); message.success('公共 Logo 更新已广播'); };
  const startAllWorkers = async () => {
    if (!activeBatchId) return void message.warning('请先保存批次并打开工作标签');
    const batch = await readBatch(activeBatchId); if (!batch) return void message.error('未找到当前批次');
    const commandId = `start-${Date.now()}`; batch.startCommandId = commandId; await saveBatch(batch);
    setWorkerTaskDetails({});
    setSelectedProgressGroupId(undefined);
    channel?.postMessage({ type: 'start-all', batchId: activeBatchId, commandId });
    setWorkerProgress((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, { ...item, status: item.status === 'completed' ? 'completed' : 'running', updatedAt: Date.now() }])));
    message.success('已通知所有工作标签开始替换');
  };
  const stopAllWorkers = () => { if (!activeBatchId) return; channel?.postMessage({ type: 'stop-all', batchId: activeBatchId }); message.info('已通知所有工作标签停止任务'); };
  const workerSnapshots = Object.values(workerProgress);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const selectedProgressWorker = selectedProgressGroupId ? workerProgress[selectedProgressGroupId] : undefined;
  const selectedTaskDetails = selectedProgressGroupId ? Object.values(workerTaskDetails[selectedProgressGroupId] || {}).sort((a, b) => a.sceneIndex - b.sceneIndex || a.copyIndex - b.copyIndex) : [];
  const removeGroupFile = (groupId: string, target: File) => {
    const group = groups.find((item) => item.id === groupId);
    if (group?.files.length === 1) { setSelectedGroupId(undefined); message.info(`已移除空分组 ${group.name}`); }
    setGroups((current) => current.flatMap((item) => {
      if (item.id !== groupId) return [item];
      const files = item.files.filter((file) => file !== target);
      return files.length ? [{ ...item, files }] : [];
    }));
  };
  const addGroupFile = (groupId: string, file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { message.error(`${file.name} 不是支持的图片格式`); return Upload.LIST_IGNORE; }
    setGroups((current) => current.map((group) => group.id === groupId ? { ...group, files: [...group.files, file] } : group));
    return Upload.LIST_IGNORE;
  };
  const aggregate = workerSnapshots.reduce((sum, item) => ({ total: sum.total + item.total, success: sum.success + item.success, failed: sum.failed + item.failed, stopped: sum.stopped + item.stopped, waiting: sum.waiting + item.waiting, running: sum.running + item.running, retrying: sum.retrying + item.retrying }), { total: 0, success: 0, failed: 0, stopped: 0, waiting: 0, running: 0, retrying: 0 });
  const aggregateCompleted = aggregate.success + aggregate.failed + aggregate.stopped;
  const aggregateProcessing = aggregate.waiting + aggregate.running > 0 || workerSnapshots.some((item) => item.status === 'opening' || item.status === 'running');
  useEffect(() => { if (worker) return; reportTaskProgress({ id: 'multi-tab-logo-replace', label: '多标签 Logo 替换', completed: aggregateCompleted, total: aggregate.total, failed: aggregate.failed, running: aggregateProcessing }); }, [worker, aggregateCompleted, aggregate.total, aggregate.failed, aggregateProcessing]);

  if (worker) return <div ref={rootRef}><Alert type={injected ? 'success' : 'info'} showIcon title={workerGroup ? `工作标签：${workerGroup.name}` : '正在加载分组任务'} description={workerGroup ? `${workerGroup.path} · ${workerGroup.files.length} 张场景图 · 公共 Logo ${workerBatch?.logos.length || 0} 个${injected ? '，已自动导入' : '，正在自动导入…'}` : '请保留主控标签页以便接收公共 Logo 更新。'} style={{ marginBottom: 16 }} /><LogoReplaceComposer {...props} automationStartToken={automationStartToken} onTaskDetailChange={(detail) => { if (channel && batchId && groupId) channel.postMessage({ type: 'worker-task', batchId, groupId, detail }); }} onProgressChange={(progress) => { if (!channel || !batchId || !groupId || !workerGroup) return; const status = progress.total > 0 && progress.success + progress.failed + progress.stopped >= progress.total ? 'completed' : progress.waiting + progress.running > 0 ? 'running' : 'ready'; channel.postMessage({ type: 'worker-progress', batchId, groupId, progress: { ...progress, groupId, name: workerGroup.name, status, updatedAt: Date.now() } }); }} /></div>;

  return <div className="multi-tab-logo-page"><section className="hero-strip logo-replace-hero"><div><Text className="eyebrow">MULTI-TAB LOGO REPLACER</Text><Title level={2}>一个主控页，分发多组 Logo 替换任务</Title><Paragraph className="hero-description">一次选择场景根文件夹和公共 Logo，每个最深层子目录自动分配到独立标签页；工作页完整使用现有 Logo 替换功能。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 选择场景根文件夹"><Upload.Dragger directory multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file, fileList) => { if (file.uid === fileList.at(-1)?.uid) { const next = groupFolderFiles(fileList as File[]); setGroups(next); message.success(`识别到 ${next.length} 个图片分组`); } return Upload.LIST_IGNORE; }}><FolderOpenOutlined style={{ fontSize: 34, color: '#7654dd' }} /><p className="ant-upload-text">拖拽或点击选择场景根文件夹</p><p className="ant-upload-hint">支持“测试图片/AM058/AM058”这类两层目录，按最深层图片目录自动分组</p></Upload.Dragger>{groups.length ? <div className="folder-group-grid">{groups.map((group) => <Card key={group.id} size="small" hoverable className="folder-manage-card" onClick={() => setSelectedGroupId(group.id)}><FolderOpenOutlined /> <Text strong>{group.name}</Text><br /><Text type="secondary">{group.path} · {group.files.length} 张</Text><Button type="link" size="small" style={{ paddingInline: 0, display: 'block' }} onClick={(event) => { event.stopPropagation(); setSelectedGroupId(group.id); }}>查看和管理图片</Button></Card>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择文件夹后显示分组" />}</Card>
    <Card className="workflow-card" title="2. 上传所有标签共用的 Logo" extra={<Text type="secondary">{logos.length} 个</Text>}><Upload.Dragger multiple showUploadList={false} accept="image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop" beforeUpload={(file) => { const next = file as File; if (next.name.toLowerCase().endsWith('.psd') || next.type === 'image/vnd.adobe.photoshop') setPendingPsdFile(next); else setLogos((current) => [...current, next]); return false; }}><FileImageOutlined style={{ fontSize: 30 }} /><p>拖拽或选择公共 Logo / PSD</p></Upload.Dragger>{logos.length ? <Image.PreviewGroup><div className="batch-asset-grid">{logos.map((logo, index) => <FileThumbnail key={`${logo.name}-${logo.size}-${logo.lastModified}-${index}`} file={logo} onRemove={() => setLogos((current) => current.filter((item) => item !== logo))} />)}<Upload multiple showUploadList={false} accept="image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop" beforeUpload={(file) => { const next = file as File; if (next.name.toLowerCase().endsWith('.psd') || next.type === 'image/vnd.adobe.photoshop') setPendingPsdFile(next); else setLogos((current) => [...current, next]); return false; }}><button type="button" className="batch-asset-add"><PlusOutlined /><span>继续添加 Logo</span></button></Upload></div></Image.PreviewGroup> : null}{activeBatchId && <Button style={{ marginTop: 12 }} icon={<SyncOutlined />} onClick={() => void syncLogos()}>同步到已打开标签</Button>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备分发 {groups.length} 组任务</Title><Text type="secondary">公共 Logo {logos.length} 个；Web Locks 将所有标签的 AI 请求合计限制在 {globalConcurrency} 个</Text></div><Space wrap><Text>同时打开</Text><InputNumber min={1} max={10} value={tabLimit} onChange={(value) => setTabLimit(value || 1)} /><Text>个标签</Text><Text>全局并发</Text><InputNumber min={1} max={12} value={globalConcurrency} onChange={(value) => setGlobalConcurrency(value || 1)} /><Button size="large" icon={<RocketOutlined />} onClick={() => void openWorkers()}>保存批次并打开标签</Button><Button type="primary" size="large" icon={<RocketOutlined />} disabled={!activeBatchId} onClick={() => void startAllWorkers()}>一键开始所有替换</Button>{aggregateProcessing && <Button danger size="large" icon={<StopOutlined />} onClick={stopAllWorkers}>停止全部</Button>}</Space></Flex></Card>
    {!!workerSnapshots.length && <Card className="workflow-card" title="批次任务进度" extra={<Tag color={aggregate.failed ? 'error' : aggregateProcessing ? 'processing' : aggregate.total && aggregate.success === aggregate.total ? 'success' : 'default'}>{aggregate.failed ? '存在最终失败' : aggregateProcessing ? '执行中' : aggregate.total ? '已完成' : '等待开始'}</Tag>}>
      <Flex gap={28} wrap><Statistic title="工作标签" value={workerSnapshots.length} suffix={` / 就绪 ${workerSnapshots.filter((item) => item.status !== 'opening').length}`} /><Statistic title="任务总数" value={aggregate.total} /><Statistic title="成功" value={aggregate.success} valueStyle={{ color: '#389e0d' }} /><Statistic title="自动重试中" value={aggregate.retrying} valueStyle={{ color: '#d48806' }} /><Statistic title="最终失败" value={aggregate.failed} valueStyle={{ color: aggregate.failed ? '#cf1322' : undefined }} /><Statistic title="已停止" value={aggregate.stopped} /></Flex>
      <Progress style={{ margin: '18px 0' }} percent={aggregate.total ? Math.round((aggregateCompleted / aggregate.total) * 100) : 0} status={aggregate.failed ? 'exception' : aggregateProcessing ? 'active' : aggregate.total ? 'success' : 'normal'} />
      <div className="folder-group-grid">{workerSnapshots.map((item) => <Card key={item.groupId} size="small" hoverable className="batch-progress-card" onClick={() => setSelectedProgressGroupId(item.groupId)} title={item.name} extra={<Tag color={item.status === 'completed' && !item.failed ? 'success' : item.failed ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status === 'opening' ? '打开中' : item.status === 'ready' ? '已就绪' : item.status === 'running' ? '执行中' : '已完成'}</Tag>}><Text>成功 {item.success}/{item.total || '—'}</Text><br /><Text type="secondary">运行 {item.running} · 等待 {item.waiting} · 重试 {item.retrying} · 失败 {item.failed} · 停止 {item.stopped}</Text><Button type="link" size="small" icon={<EyeOutlined />} style={{ display: 'block', paddingInline: 0 }}>查看任务缩略图（{Object.keys(workerTaskDetails[item.groupId] || {}).length}）</Button></Card>)}</div>
    </Card>}
    <Alert type="info" showIcon title="公共 Logo 采用批次锁定" description="工作标签从 IndexedDB 读取同一组 Logo；新增公共 Logo 后可广播同步。为避免运行中的校验基准变化，删除或替换 Logo 建议创建新批次。" />
    <Modal title={selectedGroup ? `${selectedGroup.name} · 图片管理` : '图片管理'} open={Boolean(selectedGroup)} width={900} footer={<Button onClick={() => setSelectedGroupId(undefined)}>完成</Button>} onCancel={() => setSelectedGroupId(undefined)}>
      {selectedGroup && <><Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 14 }}><Text type="secondary">{selectedGroup.path} · 当前 {selectedGroup.files.length} 张；增删只影响当前网页批次。</Text><Upload multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file) => addGroupFile(selectedGroup.id, file as File)}><Button type="primary" icon={<PlusOutlined />}>添加图片到该文件夹</Button></Upload></Flex><Image.PreviewGroup><div className="batch-asset-grid">{selectedGroup.files.map((file, index) => <FileThumbnail key={`${file.name}-${file.size}-${file.lastModified}-${index}`} file={file} onRemove={() => removeGroupFile(selectedGroup.id, file)} />)}</div></Image.PreviewGroup></>}
    </Modal>
    <Modal title={selectedProgressWorker ? `${selectedProgressWorker.name} · 任务结果` : '任务结果'} open={Boolean(selectedProgressWorker)} width={1100} footer={<Button onClick={() => setSelectedProgressGroupId(undefined)}>完成</Button>} onCancel={() => setSelectedProgressGroupId(undefined)}>
      {selectedProgressWorker && <Alert type={selectedProgressWorker.failed ? 'warning' : selectedProgressWorker.status === 'running' ? 'info' : 'success'} showIcon title={`成功 ${selectedProgressWorker.success}/${selectedProgressWorker.total || '—'} · 运行 ${selectedProgressWorker.running} · 等待 ${selectedProgressWorker.waiting} · 失败 ${selectedProgressWorker.failed}`} description="点击缩略图可放大；缩略图下方和放大工具栏都可以切换查看原图。" style={{ marginBottom: 16 }} />}
      {selectedTaskDetails.length ? <div className="batch-result-grid">{selectedTaskDetails.map((detail) => <TaskResultThumbnail key={detail.id} detail={detail} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务开始后，这里会实时显示每张图片的状态和生成结果" />}
    </Modal>
    <PsdLogoImportModal file={pendingPsdFile} onClose={() => setPendingPsdFile(undefined)} onImport={(files) => { setLogos((current) => [...current, ...files]); message.success(`已加入 ${files.length} 个 PSD Logo 图层`); }} />
    <Modal title="部分工作标签被浏览器拦截" open={blockedWorkerUrls.length > 0} footer={<Button onClick={() => setBlockedWorkerUrls([])}>关闭</Button>} onCancel={() => setBlockedWorkerUrls([])}><Alert type="warning" showIcon title="请允许本站弹出窗口，或点击下方按钮逐个打开" description="这是浏览器的多弹窗安全限制；批次已经保存，不需要重新选择文件夹和 Logo。" style={{ marginBottom: 14 }} /><Flex vertical gap={8}>{blockedWorkerUrls.map((target) => <Button key={target.url} icon={<RocketOutlined />} onClick={() => { const opened = window.open(target.url, '_blank'); if (opened) setBlockedWorkerUrls((current) => current.filter((item) => item.url !== target.url)); }}>{target.name} · 打开工作标签</Button>)}</Flex></Modal>
  </div>;
}
