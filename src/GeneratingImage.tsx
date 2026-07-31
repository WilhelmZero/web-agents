import { Image, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './i18n';

interface SharedProgress {
  percent: number;
  listeners: Set<(percent: number) => void>;
  timer: number;
}

const sharedProgress = new Map<string, SharedProgress>();
let localProgressId = 0;

function subscribeProgress(key: string, initialPercent: number, listener: (percent: number) => void) {
  let entry = sharedProgress.get(key);
  if (!entry) {
    entry = {
      percent: Math.max(1, Math.min(96, Math.round(initialPercent))),
      listeners: new Set(),
      timer: 0,
    };
    entry.timer = window.setInterval(() => {
      if (!entry) return;
      entry.percent = Math.min(96, entry.percent + 1 + Math.floor(Math.random() * 2));
      entry.listeners.forEach((notify) => notify(entry!.percent));
    }, 1000);
    sharedProgress.set(key, entry);
  } else {
    entry.percent = Math.max(entry.percent, Math.max(1, Math.min(96, Math.round(initialPercent))));
  }
  entry.listeners.add(listener);
  listener(entry.percent);
  return () => {
    entry?.listeners.delete(listener);
    if (entry && entry.listeners.size === 0) {
      window.clearInterval(entry.timer);
      sharedProgress.delete(key);
    }
  };
}

export default function GeneratingImage({
  percent,
  status = 'running',
  progressKey,
}: {
  percent: number;
  status?: 'waiting' | 'running';
  progressKey?: string;
}) {
  const { language } = useLanguage();
  const localKey = useRef('');
  if (!localKey.current) {
    localProgressId += 1;
    localKey.current = `local-progress-${localProgressId}`;
  }
  const [simulatedPercent, setSimulatedPercent] = useState(() =>
    status === 'running' ? Math.max(1, Math.min(96, Math.round(percent))) : 0,
  );

  useEffect(() => {
    if (status === 'waiting') {
      setSimulatedPercent(0);
      return;
    }
    return subscribeProgress(progressKey || localKey.current, percent, setSimulatedPercent);
  }, [percent, progressKey, status]);

  return (
    <Image
      key={`${status}-${simulatedPercent}`}
      preview={false}
      width="100%"
      height={170}
      className="generating-image"
      placeholder={{
        progress: {
          percent: simulatedPercent,
          render: () => (
            <Typography.Text strong>
              {status === 'waiting'
                ? language === 'en-US' ? 'Queued…' : '排队中…'
                : language === 'en-US'
                  ? `Generating… ${simulatedPercent}%`
                  : `生成中… ${simulatedPercent}%`}
            </Typography.Text>
          ),
        },
      }}
    />
  );
}
