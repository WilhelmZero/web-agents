import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, message } from 'antd';
import type { ServerKeyStatus } from './aiTransport';

interface Session { username: string; admin: boolean }

export default function ServerGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshConfig() {
    const response = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    window.__studioServerKeys = await response.json() as ServerKeyStatus;
    window.dispatchEvent(new Event('studio:server-keys'));
  }

  async function loadSession() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!response.ok) return setSession(null);
      const user = await response.json() as Session;
      await refreshConfig();
      setSession(user);
    } catch { setSession(null); }
    finally { setChecking(false); }
  }

  useEffect(() => { void loadSession(); }, []);
  useEffect(() => {
    const reportArchiveError = (event: Event) => message.error(`生成结果归档失败：${(event as CustomEvent<string>).detail}`);
    window.addEventListener('studio:archive-error', reportArchiveError);
    return () => window.removeEventListener('studio:archive-error', reportArchiveError);
  }, []);
  useEffect(() => {
    if (!session) return;
    const refresh = () => { if (document.visibilityState === 'visible') void refreshConfig().catch(() => {}); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [session]);

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
  return <>{children}</>;
}
