import { Button, Flex, Input, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OptimizerModel, PerImagePromptAssignment, PerImagePromptTool } from './types';
import { analyzePerImagePrompt, analyzePerImagePromptBatch, analyzePerImagePromptWithRetry, assignmentNeedsAnalysis, perImagePromptFileKey } from './services/perImagePrompt';

const { Text } = Typography;
export interface PerImageAnalysisConfig { provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; concurrency: number; autoRetryErrors?: boolean; errorRetryLimit?: number; errorRetryDelaySeconds?: number }

export function usePerImagePrompts(options: { tool: PerImagePromptTool; files: File[]; sourcePrompt: string; config: PerImageAnalysisConfig; initial?: Record<string, PerImagePromptAssignment>; onChange?: (items: Record<string, PerImagePromptAssignment>) => void }) {
  const [assignments, setAssignments] = useState<Record<string, PerImagePromptAssignment>>(() => options.initial || {});
  const assignmentsRef = useRef(assignments); assignmentsRef.current = assignments;
  useEffect(() => { if (options.initial) setAssignments(options.initial); }, [options.initial]);
  const commit = useCallback((updater: (current: Record<string, PerImagePromptAssignment>) => Record<string, PerImagePromptAssignment>) => {
    setAssignments((current) => { const next = updater(current); assignmentsRef.current = next; options.onChange?.(next); return next; });
  }, [options.onChange]);
  const analyze = useCallback(async (targets?: File[]) => {
    const sourcePrompt = options.sourcePrompt.trim(); const files = targets || options.files.filter((file) => assignmentNeedsAnalysis(assignmentsRef.current[perImagePromptFileKey(file)], sourcePrompt));
    if (!files.length) return { assignments: assignmentsRef.current, failed: 0 };
    commit((current) => { const next = { ...current }; files.forEach((file) => { const key = perImagePromptFileKey(file); next[key] = { ...(next[key] || { fileKey: key, tool: options.tool, summary: '', applicableConditions: [], prompt: '', updatedAt: Date.now() }), sourcePrompt, status: 'analyzing', error: undefined }; }); return next; });
    const results = await analyzePerImagePromptBatch(files, options.config.concurrency, (image) => analyzePerImagePromptWithRetry(() => analyzePerImagePrompt({ tool: options.tool, image, sourcePrompt, ...options.config }), { enabled: options.config.autoRetryErrors ?? true, retryLimit: options.config.errorRetryLimit ?? 3, delaySeconds: options.config.errorRetryDelaySeconds ?? 30 }));
    let merged: Record<string, PerImagePromptAssignment> = {};
    commit((current) => { merged = { ...current }; results.forEach(({ file, assignment, error }) => { const key = perImagePromptFileKey(file); merged[key] = assignment || { ...(merged[key] || { fileKey: key, tool: options.tool, summary: '', applicableConditions: [], prompt: '', updatedAt: Date.now() }), sourcePrompt, status: 'failed', updatedAt: Date.now(), error }; }); return merged; });
    return { assignments: merged, failed: results.filter((item) => item.error).length };
  }, [commit, options.config, options.files, options.sourcePrompt, options.tool]);
  const edit = useCallback((file: File, prompt: string) => commit((current) => { const key = perImagePromptFileKey(file); const existing = current[key]; return { ...current, [key]: { ...(existing || { fileKey: key, tool: options.tool, summary: '人工编辑', applicableConditions: [] }), prompt, sourcePrompt: options.sourcePrompt.trim(), status: 'ready', updatedAt: Date.now(), error: undefined } }; }), [commit, options.sourcePrompt, options.tool]);
  const clear = useCallback(() => commit(() => ({})), [commit]);
  const effective = useCallback((file: File) => { const item = assignmentsRef.current[perImagePromptFileKey(file)]; return item && !assignmentNeedsAnalysis(item, options.sourcePrompt) ? item : undefined; }, [options.sourcePrompt]);
  const current = useCallback(() => assignmentsRef.current, []);
  return { assignments, analyze, edit, clear, effective, current };
}

export function PerImagePromptEditor({ file, assignment, sourcePrompt, onEdit, onAnalyze }: { file: File; assignment?: PerImagePromptAssignment; sourcePrompt: string; onEdit: (value: string) => void; onAnalyze: () => void }) {
  const simplifiedSource = `${sourcePrompt.trim()}\n[逐图分析需同时精简通用强制限制]`;
  const stale = assignmentNeedsAnalysis(assignment, sourcePrompt) && !(assignment?.status === 'ready' && assignment.sourcePrompt === simplifiedSource);
  const status = assignment?.status === 'analyzing' ? '分析中' : assignment?.status === 'failed' ? '失败' : stale ? '待分析' : '已分配';
  const color = assignment?.status === 'failed' ? 'error' : assignment?.status === 'analyzing' ? 'processing' : stale ? 'default' : 'success';
  const skipped = assignment?.action === 'skip-no-logo' || assignment?.action === 'skip-gift-scene';
  return <div className="per-image-prompt-editor"><Flex justify="space-between" align="center" gap={8}><Space size={6}><Text strong>本图提示词</Text><Tag color={color}>{status}</Tag>{skipped && <Tag color="warning">{assignment.action === 'skip-no-logo' ? '无 Logo，保留原图' : '送礼图，保留原图'}</Tag>}</Space><Button size="small" icon={<ReloadOutlined />} loading={assignment?.status === 'analyzing'} onClick={onAnalyze}>重新分析</Button></Flex>{assignment?.summary && <Text type="secondary">{assignment.summary}</Text>}{assignment?.actionReason && <Text type={skipped ? 'warning' : 'secondary'}>{assignment.actionReason}</Text>}{assignment?.applicableConditions?.length ? <Flex gap={4} wrap>{assignment.applicableConditions.map((item) => <Tag key={item}>{item}</Tag>)}</Flex> : null}<Input.TextArea rows={3} value={assignment?.prompt || ''} placeholder="分析后生成该图片专用提示词" onChange={(event) => onEdit(event.target.value)} status={assignment?.status === 'failed' ? 'error' : undefined} />{assignment?.error && <Text type="danger">{assignment.error}</Text>}</div>;
}
