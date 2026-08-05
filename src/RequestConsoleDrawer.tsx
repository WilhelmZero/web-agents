import { ClearOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Empty, Flex, List, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { clearRequestConsole, subscribeRequestConsole, type RequestConsoleEntry } from './services/requestConsole';

const { Text } = Typography;

function statusMeta(status: RequestConsoleEntry['status']) {
  if (status === 'running') return { color: 'processing', text: '请求中' };
  if (status === 'retrying') return { color: 'warning', text: '等待重试' };
  if (status === 'success') return { color: 'success', text: '成功' };
  if (status === 'stopped') return { color: 'default', text: '已中止' };
  return { color: 'error', text: '失败' };
}

export default function RequestConsoleDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<RequestConsoleEntry[]>([]);
  useEffect(() => subscribeRequestConsole(setEntries), []);

  return <Drawer
    title="请求控制台"
    open={open}
    onClose={onClose}
    width={560}
    extra={<Button size="small" danger icon={<ClearOutlined />} disabled={!entries.length} onClick={clearRequestConsole}>清空日志</Button>}
  >
    {entries.length ? <List
      dataSource={entries}
      renderItem={(entry) => {
        const meta = statusMeta(entry.status);
        return <List.Item>
          <div style={{ width: '100%' }}>
            <Flex justify="space-between" align="center" gap={8}>
              <Space wrap><Tag color={meta.color}>{meta.text}</Tag><Text strong>{entry.model}</Text><Tag>{entry.connection === 'proxy' ? '代理' : '直连'}</Tag></Space>
              <Text type="secondary">{new Date(entry.startedAt).toLocaleTimeString()}</Text>
            </Flex>
            <Descriptions size="small" column={2} style={{ marginTop: 10 }}>
              <Descriptions.Item label="请求">{entry.requestSummary}</Descriptions.Item>
              <Descriptions.Item label="尝试次数">{entry.attempt}</Descriptions.Item>
              <Descriptions.Item label="HTTP">{entry.httpStatus ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="耗时">{entry.durationMs === undefined ? '-' : (entry.durationMs / 1000).toFixed(1) + 's'}</Descriptions.Item>
              {entry.resultSummary && <Descriptions.Item label="结果" span={2}>{entry.resultSummary}</Descriptions.Item>}
              {entry.message && <Descriptions.Item label="信息" span={2}><Text type={entry.status === 'failed' ? 'danger' : 'secondary'}>{entry.message}</Text></Descriptions.Item>}
            </Descriptions>
          </div>
        </List.Item>;
      }}
    /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发起 Gemini 请求后，状态和结果会显示在这里" />}
    <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>控制台不会记录 API Key、Base64 图片数据或完整请求正文，日志仅保留在当前页面会话。</Text>
  </Drawer>;
}