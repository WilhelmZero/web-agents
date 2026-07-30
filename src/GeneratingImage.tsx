import { Image, Typography } from 'antd';

export default function GeneratingImage({
  percent,
  status = 'running',
}: {
  percent: number;
  status?: 'waiting' | 'running';
}) {
  const normalizedPercent = Math.max(0, Math.min(99, Math.round(percent)));

  return (
    <Image
      preview={false}
      width="100%"
      height={170}
      className="generating-image"
      placeholder={{
        progress: {
          percent: normalizedPercent,
          render: (_progress, currentPercent) => (
            <Typography.Text strong>
              {status === 'waiting' ? '排队中…' : `生成中… ${Math.round(currentPercent)}%`}
            </Typography.Text>
          ),
        },
      }}
    />
  );
}
