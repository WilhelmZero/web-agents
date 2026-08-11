export type WorkflowNodeKind = 'scene-replace' | 'outpaint' | 'logo-replace';
export type WorkflowNodeStatus = 'idle' | 'ready' | 'running' | 'paused' | 'success' | 'failed' | 'blocked' | 'stopped';
export type WorkflowPort = 'images' | 'scene-results' | 'outpaint-results' | 'logo-results';

export interface WorkflowNodeConfig {
  concurrency: number;
  copies: number;
  prompt: string;
  imageModel: string;
  imageSize: '0.5K' | '1K' | '2K' | '4K';
  quality: 'high' | 'medium' | 'low';
  autoOutpaint: boolean;
  dualOutpaint: boolean;
  outpaintWidth: number;
  outpaintHeight: number;
  randomMatch: boolean;
}

export interface WorkflowNodeData {
  [key: string]: unknown;
  label: string;
  kind: WorkflowNodeKind;
  config: WorkflowNodeConfig;
  files: File[];
  logos: File[];
  predictedInput: number;
  predictedOutput: number;
  sceneOutput: number;
  outpaintOutput: number;
  success: number;
  failed: number;
  waiting: number;
  status: WorkflowNodeStatus;
  error?: string;
  logs: string[];
}

export interface WorkflowEdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowNodeLike {
  id: string;
  data: WorkflowNodeData;
}

export const WORKFLOW_PORT_TYPES: Record<string, 'image-batch'> = {
  images: 'image-batch',
  'scene-results': 'image-batch',
  'outpaint-results': 'image-batch',
  'logo-results': 'image-batch',
};

export function createsCycle(nodes: WorkflowNodeLike[], edges: WorkflowEdgeLike[], source: string, target: string) {
  if (source === target) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) || []), edge.target]);
  next.set(source, [...(next.get(source) || []), target]);
  const stack = [target]; const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(next.get(current) || []));
  }
  return false;
}

export function topologicalOrder(nodes: WorkflowNodeLike[], edges: WorkflowEdgeLike[]) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>();
  edges.forEach((edge) => { indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1); next.set(edge.source, [...(next.get(edge.source) || []), edge.target]); });
  const queue = nodes.filter((node) => !indegree.get(node.id)).map((node) => node.id); const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!; ordered.push(id);
    for (const target of next.get(id) || []) { const count = (indegree.get(target) || 0) - 1; indegree.set(target, count); if (!count) queue.push(target); }
  }
  return ordered.length === nodes.length ? ordered : [];
}

export function connectedInputCount(node: WorkflowNodeLike, nodes: WorkflowNodeLike[], edges: WorkflowEdgeLike[]) {
  const edge = edges.find((item) => item.target === node.id && (item.targetHandle || 'images') === 'images');
  if (!edge) return node.data.files.length;
  const source = nodes.find((item) => item.id === edge.source);
  if (!source) return 0;
  if (edge.sourceHandle === 'outpaint-results') return source.data.outpaintOutput;
  return source.data.sceneOutput || source.data.predictedOutput;
}

export function predictWorkflow<T extends WorkflowNodeLike>(nodes: T[], edges: WorkflowEdgeLike[]): T[] {
  const order = topologicalOrder(nodes, edges);
  if (!order.length && nodes.length) return nodes.map((node) => ({ ...node, data: { ...node.data, status: 'blocked', error: '工作流存在循环连接' } }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const id of order) {
    const node = byId.get(id)!; const input = connectedInputCount(node, [...byId.values()], edges); const copies = Math.max(1, node.data.config.copies);
    let sceneOutput = 0; let outpaintOutput = 0; let predictedOutput = 0; let error: string | undefined;
    if (node.data.kind === 'scene-replace') {
      sceneOutput = input * copies;
      outpaintOutput = node.data.config.autoOutpaint ? sceneOutput * (node.data.config.dualOutpaint ? 2 : 1) : 0;
      predictedOutput = node.data.config.autoOutpaint ? outpaintOutput : sceneOutput;
      if (!input) error = '请上传场景图或连接上游图片输出';
      else if (!node.data.config.prompt.trim()) error = '请填写场景替换提示词';
    } else if (node.data.kind === 'outpaint') {
      outpaintOutput = input * (node.data.config.dualOutpaint ? 2 : 1); predictedOutput = outpaintOutput;
      if (!input) error = '请上传图片或连接上游输出';
    } else {
      sceneOutput = input * copies; predictedOutput = sceneOutput;
      if (!input) error = '请连接或上传待替换场景图';
      else if (!node.data.logos.length) error = '请至少上传一张 Logo';
      else if (!node.data.config.randomMatch && node.data.logos.length < input) error = `Logo 不足：需要 ${input} 张，当前 ${node.data.logos.length} 张；可开启随机匹配`;
    }
    byId.set(id, { ...node, data: { ...node.data, predictedInput: input, predictedOutput, sceneOutput, outpaintOutput, waiting: predictedOutput, status: error ? 'blocked' : node.data.status === 'blocked' ? 'ready' : node.data.status, error } } as T);
  }
  return nodes.map((node) => byId.get(node.id) as T);
}

export class WorkflowSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try { return await task(); } finally { this.active -= 1; this.queue.shift()?.(); }
  }
}
