import { BarChartOutlined, CheckCircleOutlined, PictureOutlined, RedoOutlined } from '@ant-design/icons';
import { Card, Empty, Progress, Segmented, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { summarizeUsage, type UsageRow } from './services/usageDashboard';

const compactNumber = (value: number, en: boolean) => new Intl.NumberFormat(en ? 'en-US' : 'zh-CN').format(value);

export default function UsageDashboard({ rows, labels, language, tool }: {
  rows: UsageRow[];
  labels: Record<string, string>;
  language: 'zh-CN' | 'en-US';
  tool: string;
}) {
  const en = language === 'en-US';
  const [period, setPeriod] = useState<7 | 30>(30);
  const summary = useMemo(() => summarizeUsage(rows, period, tool), [rows, period, tool]);
  const topTools = summary.tools.slice(0, 6);
  const maxDaily = Math.max(1, ...summary.days.map((item) => item.images));
  const maxTool = Math.max(1, ...topTools.map((item) => item.images));
  const totalProviderRequests = summary.providers.reduce((sum, item) => sum + item.requests, 0);

  return <section className="usage-dashboard" aria-label={en ? 'Usage dashboard' : '用量仪表盘'}>
    <div className="usage-dashboard-heading">
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>{en ? 'Usage overview' : '用量概览'}</Typography.Title>
        <Typography.Text type="secondary">{en ? 'Server-recorded AI requests · follows the tool filter above' : '服务端记录的 AI 请求 · 跟随上方工具筛选'}</Typography.Text>
      </div>
      <Segmented aria-label={en ? 'Time range' : '统计时间范围'} value={period} onChange={(value) => setPeriod(value as 7 | 30)} options={[{ label: en ? '7 days' : '近 7 天', value: 7 }, { label: en ? '30 days' : '近 30 天', value: 30 }]} />
    </div>
    {!summary.requests ? <Card><Empty description={en ? 'No recorded usage in this period' : '所选时间范围暂无用量记录'} /></Card> : <>
      <div className="usage-kpi-grid">
        <div className="usage-kpi"><span className="usage-kpi-icon"><BarChartOutlined /></span><span>{en ? 'AI requests' : 'AI 请求'}</span><strong>{compactNumber(summary.requests, en)}</strong></div>
        <div className="usage-kpi"><span className="usage-kpi-icon"><PictureOutlined /></span><span>{en ? 'Generated images' : '生成图片'}</span><strong>{compactNumber(summary.images, en)}</strong></div>
        <div className="usage-kpi"><span className="usage-kpi-icon"><CheckCircleOutlined /></span><span>{en ? 'Request success rate' : '请求成功率'}</span><strong>{summary.successRate === null ? '—' : `${summary.successRate}%`}</strong><small>{en ? `${summary.successful} succeeded / ${summary.failed} failed` : `成功 ${summary.successful} · 失败 ${summary.failed}`}</small></div>
        <div className="usage-kpi"><span className="usage-kpi-icon"><RedoOutlined /></span><span>{en ? 'Retries' : '重试次数'}</span><strong>{compactNumber(summary.retries, en)}</strong></div>
      </div>
      <div className="usage-chart-grid">
        <Card className="usage-chart-card" title={en ? 'Images generated each day' : '每日生成图片'} extra={<Typography.Text type="secondary">{en ? 'Images' : '张'}</Typography.Text>}>
          <div className="usage-daily-chart" role="img" aria-label={en ? `Daily generated images over the past ${period} days` : `近 ${period} 天每日生成图片数`}>
            {summary.days.map((entry, index) => <Tooltip key={entry.day} title={`${entry.day} · ${en ? 'Images' : '图片'} ${entry.images} · ${en ? 'Requests' : '请求'} ${entry.requests}`}>
              <div className="usage-day-column"><div className="usage-day-bar-track"><div className="usage-day-bar" style={{ height: entry.images ? `${Math.max(3, entry.images / maxDaily * 100)}%` : 0 }} /></div><span>{period === 7 || index % 5 === 0 || index === summary.days.length - 1 ? entry.day.slice(5) : ''}</span></div>
            </Tooltip>)}
          </div>
        </Card>
        <Card className="usage-chart-card" title={en ? 'Images by tool' : '各工具生成图片'} extra={<Typography.Text type="secondary">{en ? 'Top 6' : '前 6 项'}</Typography.Text>}>
          {topTools.length ? <div className="usage-tool-bars">{topTools.map((entry) => <div className="usage-tool-row" key={entry.tool}>
            <div className="usage-tool-label" title={labels[entry.tool] || entry.tool}>{labels[entry.tool] || entry.tool}</div>
            <div className="usage-tool-bar-track"><div className="usage-tool-bar" style={{ width: `${entry.images / maxTool * 100}%` }} /></div>
            <strong>{compactNumber(entry.images, en)}</strong>
          </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={en ? 'No generated images' : '暂无生成图片'} />}
        </Card>
      </div>
      <Card className="usage-provider-card" title={en ? 'Requests by provider' : '各服务商请求量'}>
        <div className="usage-provider-list">{summary.providers.map((entry) => <div className="usage-provider-row" key={entry.provider}>
          <div><strong>{entry.provider === 'openai' ? 'OpenAI' : entry.provider === 'gemini' ? 'Gemini' : entry.provider}</strong><span>{compactNumber(entry.requests, en)} / {compactNumber(totalProviderRequests, en)}</span></div>
          <Progress percent={totalProviderRequests ? Math.round(entry.requests / totalProviderRequests * 100) : 0} showInfo={false} strokeColor="#7457d8" trailColor="#ece9f5" />
        </div>)}</div>
      </Card>
    </>}
    <Typography.Text type="secondary" className="usage-dashboard-note">{en ? 'Requests count completed AI gateway records; images count actual model outputs, not final archived artwork. No cost estimate is inferred.' : '请求数为已记录完成的 AI 网关请求；图片数为模型实际输出，不等同于最终归档成品。此处不推算费用。'}{rows.length >= 5000 && (en ? ' The server returned its maximum of 5,000 grouped rows; totals may be incomplete.' : ' 服务器已返回上限 5,000 条分组记录，总计可能不完整。')}</Typography.Text>
  </section>;
}
