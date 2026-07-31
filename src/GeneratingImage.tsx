import { Image, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLanguage } from './i18n';

export default function GeneratingImage({
  percent,
  status = 'running',
}: {
  percent: number;
  status?: 'waiting' | 'running';
}) {
  const { language } = useLanguage();
  const [simulatedPercent, setSimulatedPercent] = useState(() =>
    status === 'running' ? Math.max(1, Math.min(96, Math.round(percent))) : 0,
  );

  useEffect(() => {
    if (status === 'waiting') {
      setSimulatedPercent(0);
      return;
    }
    setSimulatedPercent((current) => Math.max(current, Math.max(1, Math.min(96, Math.round(percent)))));
    const timer = window.setInterval(() => {
      setSimulatedPercent((current) => Math.min(96, current + 1 + Math.floor(Math.random() * 2)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [percent, status]);

  return (
    <Image
      preview={false}
      width="100%"
      height={170}
      className="generating-image"
      placeholder={{
        progress: {
          percent: simulatedPercent,
          render: (_progress, currentPercent) => (
            <Typography.Text strong>
              {status === 'waiting'
                ? language === 'en-US' ? 'Queued…' : '排队中…'
                : language === 'en-US'
                  ? `Generating… ${Math.round(currentPercent)}%`
                  : `生成中… ${Math.round(currentPercent)}%`}
            </Typography.Text>
          ),
        },
      }}
    />
  );
}
