import {
  CloudSyncOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Image,
  Input,
  List,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { DesktopJobEvent, DesktopJobItem, DesktopJobStatus, DesktopJobSummary, DesktopResourceSnapshot, DesktopRuntimeInfo, DesktopSecretState } from './desktop/types';

const { Text, Title } = Typography;

const statusMeta: Record<DesktopJobStatus, { color: string; label: string }> = {
  queued: { color: 'gold', label: '排队' }, analyzing: { color: 'processing', label: '分析' }, running: { color: 'processing', label: '生成' },
  verifying: { color: 'cyan', label: '校验' }, retry_wait: { color: 'orange', label: '等待重试' }, paused: { color: 'default', label: '已暂停' },
  completed: { color: 'success', label: '已完成' }, failed: { color: 'error', label: '失败' }, cancelled: { color: 'default', label: '已停止' }, interrupted: { color: 'warning', label: '等待恢复' },
};

const bytes = (value?: number) => {
  if (value === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let index = 0; let next = value;
  while (next >= 1024 && index < units.length - 1) { next /= 1024; index += 1; }
  return `${next.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const elapsed = (start?: number, end?: number) => {
  if (!start) return '-'; const seconds = Math.max(0, Math.floor(((end || Date.now()) - start) / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const ResourceSparkline = memo(function ResourceSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div style={{ height: 36 }} />;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - Math.min(100, Math.max(0, value)) * 0.36}`).join(' ');
  return <svg viewBox="0 0 100 36" preserveAspectRatio="none" width="100%" height="36" role="img" aria-label="最近十分钟资源变化"><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
});

const ItemThumbnail = memo(function ItemThumbnail({ item }: { item: DesktopJobItem }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true; setSrc(undefined);
    if (item.thumbnailPath && window.desktop) void window.desktop.readThumbnail(item.thumbnailPath).then((value) => { if (alive && value) setSrc(value); });
    return () => { alive = false; setSrc(undefined); };
  }, [item.thumbnailPath]);
  return src ? <Image width={76} height={76} style={{ objectFit: 'cover', borderRadius: 8 }} src={src} preview={{ src }} /> : <div className="desktop-task-thumb-placeholder">{item.status === 'completed' ? '✓' : '…'}</div>;
});

function JobDetails({ job, onChanged }: { job: DesktopJobSummary; onChanged: () => void }) {
  const [items, setItems] = useState<DesktopJobItem[]>([]); const [events, setEvents] = useState<DesktopJobEvent[]>([]);
  const refresh = useCallback(async () => {
    if (!window.desktop) return; const [nextItems, nextEvents] = await Promise.all([window.desktop.getJobItems(job.id), window.desktop.getJobEvents(job.id)]); setItems(nextItems); setEvents(nextEvents);
  }, [job.id]);
  useEffect(() => { void refresh(); const remove = window.desktop?.onJobsChanged(() => void refresh()); return remove; }, [refresh]);
  const action = async (kind: 'pause' | 'resume' | 'cancel' | 'retry') => {
    if (!window.desktop) return; await ({ pause: window.desktop.pauseJob, resume: window.desktop.resumeJob, cancel: window.desktop.cancelJob, retry: window.desktop.retryJob }[kind])(job.id); await refresh(); onChanged();
  };
  return <Tabs items={[
    { key: 'items', label: `图片 ${items.length}`, children: <List dataSource={items} pagination={items.length > 24 ? { pageSize: 24, size: 'small' } : false} renderItem={(item) => <List.Item actions={item.outputPath ? [<Button key="open" size="small" onClick={() => void window.desktop?.openPath(item.outputPath!)}>打开</Button>, <Button key="reveal" size="small" onClick={() => void window.desktop?.revealPath(item.outputPath!)}>定位</Button>] : []}><List.Item.Meta avatar={<ItemThumbnail item={item} />} title={<Space wrap><Text ellipsis style={{ maxWidth: 320 }}>{item.sourceName}</Text><Tag color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag><Tag>{item.stage}</Tag></Space>} description={<><Text type="secondary">第 {item.copyIndex + 1} 份 · 重试 {item.retryCount}/{item.maxRetries}</Text>{item.error && <Alert style={{ marginTop: 6 }} type="error" showIcon message={item.error} />}</>} /></List.Item>} /> },
    { key: 'events', label: '运行日志', children: events.length ? <Timeline items={events.map((event) => ({ color: event.level === 'error' ? 'red' : event.level === 'warning' ? 'orange' : 'blue', children: <><Text type="secondary">{new Date(event.createdAt).toLocaleString()}</Text><br />{event.message}</> }))} /> : <Empty description="暂无日志" /> },
    { key: 'settings', label: '任务信息', children: <><Descriptions column={1} size="small" items={[{ key: 'tool', label: '类型', children: job.tool === 'scene-replace' ? '场景替换' : job.tool === 'logo-removal' ? '去除 Logo' : 'Logo 替换' }, { key: 'output', label: '输出目录', children: <Button type="link" style={{ padding: 0 }} onClick={() => void window.desktop?.openPath(job.outputRoot)}>{job.outputRoot}</Button> }, { key: 'created', label: '创建时间', children: new Date(job.createdAt).toLocaleString() }, { key: 'elapsed', label: '执行耗时', children: elapsed(job.startedAt, job.endedAt) }, { key: 'requests', label: '实际模型请求', children: job.actualRequests }, { key: 'estimate', label: '预计费用范围', children: `$${job.estimatedMinCost.toFixed(4)} – $${job.estimatedMaxCost.toFixed(4)}` }, { key: 'cost', label: '按已完成请求实时预估', children: `$${job.estimatedCost.toFixed(4)}` }]} /><Space style={{ marginTop: 18 }} wrap>{['queued', 'running', 'retry_wait', 'analyzing', 'verifying'].includes(job.status) && <Button icon={<PauseCircleOutlined />} onClick={() => void action('pause')}>暂停</Button>}{job.status === 'paused' && <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void action('resume')}>继续</Button>}{['failed', 'cancelled'].includes(job.status) && <Button icon={<ReloadOutlined />} onClick={() => void action('retry')}>重试失败项</Button>}{!['completed', 'cancelled'].includes(job.status) && <Button danger icon={<StopOutlined />} onClick={() => void action('cancel')}>停止</Button>}</Space></> },
  ]} />;
}

export default function DesktopTaskCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [jobs, setJobs] = useState<DesktopJobSummary[]>([]); const [resource, setResource] = useState<DesktopResourceSnapshot>(); const [runtime, setRuntime] = useState<DesktopRuntimeInfo>();
  const [resourceHistory, setResourceHistory] = useState<DesktopResourceSnapshot[]>([]);
  const [selected, setSelected] = useState<DesktopJobSummary>(); const [secretState, setSecretState] = useState<DesktopSecretState>({ geminiConfigured: false, openAiConfigured: false });
  const [gemini, setGemini] = useState(''); const [openAi, setOpenAi] = useState(''); const [savingKeys, setSavingKeys] = useState(false);
  const refresh = useCallback(async () => { if (!window.desktop) return; setJobs(await window.desktop.listJobs()); }, []);
  useEffect(() => {
    if (!window.desktop) return; void refresh(); void window.desktop.getResourceSnapshot().then(setResource); void window.desktop.getRuntimeInfo().then(setRuntime); void window.desktop.getSecretState().then(setSecretState);
    const updateResource = (snapshot: DesktopResourceSnapshot) => { setResource(snapshot); setResourceHistory((history) => [...history, snapshot].slice(-300)); };
    const removeJobs = window.desktop.onJobsChanged(() => void refresh()); const removeResources = window.desktop.onResourcesChanged(updateResource); return () => { removeJobs(); removeResources(); };
  }, [refresh]);
  const totals = useMemo(() => jobs.reduce((sum, job) => ({ total: sum.total + job.total, done: sum.done + job.completed, failed: sum.failed + job.failed, queued: sum.queued + job.queued, running: sum.running + job.running }), { total: 0, done: 0, failed: 0, queued: 0, running: 0 }), [jobs]);
  const saveKeys = async () => {
    if (!window.desktop) return; setSavingKeys(true); try { const state = await window.desktop.setSecrets({ ...(gemini ? { gemini } : {}), ...(openAi ? { openAi } : {}) }); setSecretState(state); setGemini(''); setOpenAi(''); message.success('API Key 已通过系统安全存储加密保存'); } finally { setSavingKeys(false); }
  };
  return <>
    <Drawer title={<Space><CloudSyncOutlined />桌面后台任务中心<Tag color="green">主进程运行</Tag></Space>} width="min(1120px, 96vw)" open={open} onClose={onClose} extra={<Space><Button onClick={() => void window.desktop?.pauseAll()} icon={<PauseCircleOutlined />}>暂停全部</Button><Button type="primary" onClick={() => void window.desktop?.resumeAll()} icon={<PlayCircleOutlined />}>继续全部</Button></Space>}>
      {resource?.guardPaused && <Alert type="warning" showIcon message={resource.guardReason} style={{ marginBottom: 16 }} />}
      <Row gutter={[12, 12]}><Col xs={12} md={4}><Card size="small"><Statistic title="全部图片" value={totals.total} /></Card></Col><Col xs={12} md={4}><Card size="small"><Statistic title="完成" value={totals.done} valueStyle={{ color: '#389e0d' }} /></Card></Col><Col xs={12} md={4}><Card size="small"><Statistic title="执行中" value={totals.running} valueStyle={{ color: '#d48806' }} /></Card></Col><Col xs={12} md={4}><Card size="small"><Statistic title="排队" value={totals.queued} /></Card></Col><Col xs={12} md={4}><Card size="small"><Statistic title="应用内存" value={bytes(resource?.appMemoryBytes)} /></Card></Col><Col xs={12} md={4}><Card size="small"><Statistic title="系统内存" value={resource ? `${resource.systemMemoryPercent}%` : '-'} /></Card></Col></Row>
      <Card size="small" style={{ marginTop: 12 }}><Flex justify="space-between" align="center" wrap="wrap" gap={12}><Space wrap><Text>主进程 {bytes(resource?.mainMemoryBytes)}</Text><Text>渲染进程 {bytes(resource?.rendererMemoryBytes)}</Text><Text>CPU {resource?.cpuPercent ?? '-'}%</Text><Text>活动请求 {resource?.activeRequests ?? 0}/{resource?.globalConcurrency ?? 1}</Text><Text>磁盘可用 {bytes(resource?.diskFreeBytes)}</Text></Space><Space><Text>开机启动到托盘</Text><Switch checked={runtime?.launchAtLogin} onChange={async (value) => { const saved = await window.desktop?.setLaunchAtLogin(value); if (runtime && saved !== undefined) setRuntime({ ...runtime, launchAtLogin: saved }); }} /></Space></Flex><Row gutter={12} style={{ marginTop: 8 }}><Col span={12}><Text type="secondary">系统内存 · 最近 10 分钟</Text><ResourceSparkline values={resourceHistory.map((item) => item.systemMemoryPercent)} color="#fa8c16" /></Col><Col span={12}><Text type="secondary">CPU · 最近 10 分钟</Text><ResourceSparkline values={resourceHistory.map((item) => item.cpuPercent)} color="#1677ff" /></Col></Row></Card>
      <Card title={<Space><KeyOutlined />桌面 API Key</Space>} size="small" style={{ marginTop: 12 }} extra={<Space><Tag color={secretState.geminiConfigured ? 'green' : 'default'}>Gemini</Tag><Tag color={secretState.openAiConfigured ? 'green' : 'default'}>OpenAI</Tag></Space>}><Flex gap={8} wrap="wrap"><Input.Password style={{ flex: '1 1 280px' }} value={gemini} onChange={(event) => setGemini(event.target.value)} placeholder={secretState.geminiConfigured ? 'Gemini 已配置，输入可覆盖' : 'Gemini API Key'} /><Input.Password style={{ flex: '1 1 280px' }} value={openAi} onChange={(event) => setOpenAi(event.target.value)} placeholder={secretState.openAiConfigured ? 'OpenAI 已配置，输入可覆盖' : 'OpenAI API Key'} /><Button type="primary" loading={savingKeys} disabled={!gemini && !openAi} onClick={() => void saveKeys()}>加密保存</Button></Flex></Card>
      <Title level={5} style={{ marginTop: 18 }}>后台队列</Title>
      {jobs.length ? <List grid={{ gutter: 12, xs: 1, md: 2 }} dataSource={jobs} renderItem={(job) => <List.Item><Card hoverable onClick={() => setSelected(job)} title={<Space><Tag color={statusMeta[job.status].color}>{statusMeta[job.status].label}</Tag><Text ellipsis style={{ maxWidth: 310 }}>{job.name}</Text></Space>} extra={<Button type="text" icon={<FolderOpenOutlined />} onClick={(event) => { event.stopPropagation(); void window.desktop?.openPath(job.outputRoot); }} />}><Progress percent={job.total ? Math.round((job.completed + job.failed) / job.total * 100) : 0} status={job.failed ? 'exception' : job.status === 'completed' ? 'success' : 'active'} /><Flex justify="space-between"><Text type="secondary">完成 {job.completed} · 失败 {job.failed} · 排队 {job.queued}</Text><Text type="secondary">{elapsed(job.startedAt, job.endedAt)}</Text></Flex><Text type="secondary">预计 ${job.estimatedMinCost.toFixed(3)}–${job.estimatedMaxCost.toFixed(3)} · 当前 ${job.estimatedCost.toFixed(3)}</Text></Card></List.Item>} /> : <Empty description="从场景替换、Logo 替换或去除 Logo 页面创建后台任务" />}
      <Text type="secondary">数据库：{runtime?.databasePath || '-'}</Text>
    </Drawer>
    <Modal width={900} open={Boolean(selected)} title={selected?.name} onCancel={() => setSelected(undefined)} footer={null} destroyOnHidden>{selected && <JobDetails job={selected} onChanged={() => void refresh()} />}</Modal>
  </>;
}
