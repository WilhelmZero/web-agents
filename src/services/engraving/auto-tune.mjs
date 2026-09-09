import { validateOptions } from './processing.mjs';
import { validateReview, SCORE_KEYS, ISSUES, ADJUST_KEYS } from './quality-review.mjs';
import { AppError } from './errors.mjs';

export function validateAutoOptions(value = {}) {
  const maxRounds = value.maxRounds ?? 5, targetScore = value.targetScore ?? 85;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) throw new AppError('自动调试轮数必须为 1–10，默认 5 轮。');
  if (!Number.isInteger(targetScore) || targetScore < 70 || targetScore > 95) throw new AppError('目标评分必须为 70–95。');
  return { maxRounds, targetScore };
}

function assessed(review, target) {
  const score = Math.round(SCORE_KEYS.reduce((sum, key) => sum + review.scores[key], 0) / SCORE_KEYS.length);
  const passed = score >= target && Math.min(...SCORE_KEYS.map(key => review.scores[key])) >= target - 5 &&
    review.scores.identity >= 90 && review.scores.subjects >= 90 && review.issues.length === 0;
  return { ...review, score, passed, issueLabels: review.issues.map(key => ISSUES[key]) };
}

const FIXES = {
  identity: 'Restore the exact original faces, facial geometry, expressions, anatomy and pose from image 1. Do not beautify or change identities.',
  subjects: 'Restore ALL original subjects and associated objects without recropping or omissions.',
  hair_dark: 'Make dense, brighter etched strands throughout the black hair/fur interior and silhouette, following original hair direction. Avoid a black featureless mass or white cap.',
  texture_weak: 'Increase directional hair, fur and fabric microtexture to match the engraving reference. Do not invent random noise.',
  background: 'Remove ALL scenery and haze. Keep every non-subject region transparent with clean negative spaces, no shadow or glow.',
  highlights: 'Restore tonal gradients in skin and folds in white clothing; reduce flat clipped white areas.',
  shadows: 'Restore readable midtone detail inside subject shadows while retaining black gaps and anchors.',
  artifacts: 'Remove fabricated details and repair original anatomy and lettering using only image 1.',
};

// Each round is one candidate render + review, including the first generation.
// Every candidate starts from the original photo; no chained identity drift.
export async function runAutoTune({ original, reference, config, subject, instructions, style, params: initialParams, options,
  generate, review, render, saveCandidate, publish, cancelled = () => false }) {
  const { maxRounds, targetScore } = validateAutoOptions(options);
  let params = validateOptions({ ...initialParams, eraseMask: undefined, preview: false });
  let source, job, best = null, fallback = null, feedback = '', action = 'generate';
  let generations = 0, checks = 0;
  const rounds = [], tried = new Set();
  const state = (status, phase = '', extra = {}) => ({ status, phase, maxRounds, targetScore, generations, checks, rounds: [...rounds], best, fallback, ...extra });
  try {
    for (let round = 1; round <= maxRounds; round++) {
      if (cancelled()) return state('cancelled', '已停止后续调试');
      if (action === 'generate') {
        generations++;
        await publish(state('running', `第 ${round}/${maxRounds} 轮：${source ? '重新生成' : '生成图片'}`));
        if (cancelled()) { generations--; return state('cancelled', '已停止，未提交下一次生图'); }
        const result = await generate({ image: original, referenceImage: reference, config, subject, instructions, style, feedback });
        source = result.buffer;
        job = await saveCandidate(source, result.warnings || []);
        fallback = { job, params: { ...params }, round, assessed: false };
        tried.clear();
        // Save before cancellation, so an already-billed result is not discarded.
        await publish(state('running', `第 ${round}/${maxRounds} 轮：图片已保存`));
      }
      if (cancelled()) return state('cancelled', '已停止，保留现有结果');
      await publish(state('running', `第 ${round}/${maxRounds} 轮：${action === 'adjust' ? '本地调参并检查' : '检查效果'}`));
      const rendered = await render(source, { ...params, preview: false });
      if (cancelled()) return state('cancelled', '已停止，保留现有结果');
      checks++;
      const assessment = assessed(validateReview(await review({ original, reference, rendered: rendered.buffer, config, params, instructions })), targetScore);
      const entry = { ...assessment, round, action, reviewAction: assessment.action, job, params: { ...params } };
      rounds.push(entry);
      // Prefer integrity over aesthetics when the candidate has a missing face/subject.
      const rank = item => (item.passed ? 1000 : 0) + Math.min(item.scores.identity, item.scores.subjects) * 2 + item.score;
      if (!best || rank(entry) > rank(best)) best = entry;
      await publish(state('running', `第 ${round}/${maxRounds} 轮：${assessment.passed ? '检查通过' : '发现待改进项'}`));
      if (cancelled()) return state('cancelled', '已停止，保留最好的一版');
      if (assessment.passed) { best = entry; return state('completed', '自动检查通过，请人工确认后雕刻'); }
      if (round === maxRounds) break;
      tried.add(JSON.stringify(ADJUST_KEYS.map(key => params[key])));
      const proposed = { ...params, ...assessment.adjustments };
      // Never overwrite sizing, masks, mode or other settings from model output.
      const key = JSON.stringify(ADJUST_KEYS.map(name => proposed[name]));
      const severe = assessment.scores.identity < 90 || assessment.scores.subjects < 90 ||
        assessment.issues.some(issue => ['identity', 'subjects', 'background', 'artifacts'].includes(issue));
      if (!severe && assessment.action === 'adjust' && !tried.has(key)) {
        params = proposed; action = 'adjust';
      } else {
        action = 'generate';
        const issues = [...assessment.issues, ...SCORE_KEYS.filter(k => assessment.scores[k] < (['identity', 'subjects'].includes(k) ? Math.max(90, targetScore) : targetScore)).map(k => ({ hair: 'hair_dark', texture: 'texture_weak', tones: 'highlights' }[k] || k))];
        feedback = issues.map(issue => FIXES[issue]).filter(Boolean).join('\n');
        params = validateOptions({ ...initialParams, eraseMask: undefined, preview: false });
      }
    }
    return state('limit', '已达轮数上限，未达标；保留综合最佳的一版供手动调整');
  } catch (error) {
    return state('failed', '自动调试已停止，保留已生成图片', {
      error: error instanceof AppError ? error.message : (error?.message || '本地处理或保存失败，请检查浏览器存储和图片。'),
      errorCode: error instanceof AppError ? error.code : 'AUTO_TUNE_ERROR',
    });
  }
}
