import { ClearOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Empty, Flex, Image, List, Space, Tag, Typography } from 'antd';
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

function OutputThumbnails({ images }: { images: Blob[] }) {
  const [urls, setUrls] = useState<Array<{ thumbnail: string; original: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const build = async () => {
      const next: Array<{ thumbnail: string; original: string }> = [];
      for (const image of images) {
        if (cancelled) break;
        const original = URL.createObjectURL(image); created.push(original);
        let thumbnailBlob = image;
        try {
          const bitmap = await createImageBitmap(image);
          const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
          thumbnailBlob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob || image), 'image/webp', 0.78));
        } catch { /* Fall back to the original when thumbnail decoding is unavailable. */ }
        if (cancelled) break;
        const thumbnail = URL.createObjectURL(thumbnailBlob); created.push(thumbnail);
        next.push({ thumbnail, original }); setUrls([...next]);
      }
    };
    void build();
    return () => { cancelled = true; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [images]);
  return <div className="request-console-output"><Text type="secondary">输出缩略图</Text><Image.PreviewGroup><div className="request-console-thumbnails">{urls.map((url, index) => <Image key={url.original} src={url.thumbnail} preview={{ src: url.original }} alt={`输出图片 ${index + 1}`} />)}</div></Image.PreviewGroup></div>;
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
              <Space wrap><Tag color={meta.color}>{meta.text}</Tag><Tag color={entry.model.toLowerCase().startsWith('gpt') ? 'green' : 'blue'}>{entry.model.toLowerCase().startsWith('gpt') ? 'GPT' : 'Gemini'}</Tag><Text strong>{entry.model}</Text><Tag>{entry.connection === 'proxy' ? '代理' : '直连'}</Tag></Space>
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
            {open && entry.outputImages?.length ? <OutputThumbnails images={entry.outputImages} /> : null}
          </div>
        </List.Item>;
      }}
    /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发起 Gemini 或 GPT 请求后，状态和结果会显示在这里" />}
    <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>控制台不会记录 API Key、Base64 图片数据或完整请求正文；最多保留最近 24 张输出图片，日志仅保留在当前页面会话。</Text>
  </Drawer>;
}
