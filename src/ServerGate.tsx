import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import type { ServerKeyStatus } from './aiTransport';

interface Session { username: string; admin: boolean }
interface Asset { id: string; name: string; expired: boolean }
interface Job { id: string; tool: string; provider: string; model: string; status: string; imageCount: number; error?: string; createdAt: string; assets: Asset[] }

export default function ServerGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [usage, setUsage] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);

  async function loadSession() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!response.ok) return setSession(null);
      const user = await response.json() as Session;
      const configResponse = await fetch('/api/config', { credentials: 'same-origin' });
      window.__studioServerKeys = configResponse.ok ? await configResponse.json() as ServerKeyStatus : { openai: false, gemini: false };
      setSession(user);
    } catch { setSession(null); }
    finally { setChecking(false); }
  }

  useEffect(() => { void loadSession(); }, []);
  useEffect(() => {
    if (!open || !session) return;
    const refresh = async () => {
      const response = await fetch('/api/jobs');
      if (response.ok) setJobs(await response.json() as Job[]);
      if (session.admin) {
        const usageResponse = await fetch('/api/admin/usage');
        if (usageResponse.ok) setUsage(await usageResponse.json() as Array<Record<string, unknown>>);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [open, session]);

  async function login(values: { username: string; password: string }) {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!response.ok) { message.error(response.status === 429 ? '尝试次数过多，请稍后再试' : '账号或密码错误'); return; }
      await loadSession();
    } catch { message.error('无法连接到登录服务'); }
    finally { setBusy(false); }
  }

  if (checking) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>正在检查登录状态…</div>;
  if (!session) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#f5f4fb' }}>
    <Card title="Scene Studio 登录" style={{ width: 'min(420px, 100%)' }}>
      <Form layout="vertical" onFinish={(values) => void login(values)}>
        <Form.Item label="账号" name="username" rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy} block>登录</Button>
      </Form>
    </Card>
  </div>;
  return <>
    {children}
    <Button type="primary" style={{ position: 'fixed', right: 22, bottom: 22, zIndex: 1000 }} onClick={() => setOpen(true)}>服务器任务</Button>
    <Modal title={`服务器任务 · ${session.username}`} open={open} onCancel={() => setOpen(false)} footer={<Button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); setSession(null); setOpen(false); }}>退出登录</Button>} width={800}>
      <List dataSource={jobs} locale={{ emptyText: '暂无服务器任务' }} pagination={{ pageSize: 8 }} renderItem={(job) => <List.Item actions={job.status === 'queued' ? [<Button key="cancel" danger size="small" onClick={async () => { const response = await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' }); if (response.ok) setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'cancelled' } : item)); else message.warning('任务已开始，不能取消排队状态'); }}>取消排队</Button>] : undefined}>
        <List.Item.Meta title={<Space><Typography.Text>{job.tool}</Typography.Text><Tag>{job.provider}</Tag><Tag color={job.status === 'success' ? 'green' : job.status === 'failed' ? 'red' : 'blue'}>{job.status}</Tag></Space>} description={<>
          <div>{job.model} · {new Date(job.createdAt).toLocaleString()} · 图片 {job.imageCount}</div>
          {job.error && <Typography.Text type="danger">{job.error}</Typography.Text>}
          <Space wrap>{job.assets.map((asset) => asset.expired ? <Tag key={asset.id}>图片已过期</Tag> : <Button key={asset.id} size="small" href={`/api/assets/${asset.id}`} target="_blank">{asset.name}</Button>)}</Space>
        </>} />
      </List.Item>} />
      {session.admin && <details><summary>用量统计</summary><pre style={{ maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(usage, null, 2)}</pre></details>}
    </Modal>
  </>;
}
