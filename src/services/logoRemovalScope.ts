import type { LogoRemovalScope } from '../types';

export const LOGO_REMOVAL_SCOPE_VALUES: readonly LogoRemovalScope[] = [
  'cup-body',
  'cup-and-bottom',
  'all-product-carriers',
  'wooden-box',
  'other',
];

const SCOPE_VALUE_SET = new Set<LogoRemovalScope>(LOGO_REMOVAL_SCOPE_VALUES);

const SCOPE_DESCRIPTION: Record<Exclude<LogoRemovalScope, 'other'>, string> = {
  'cup-body': '杯身外侧表面的印刷、雕刻、蚀刻或贴附 Logo',
  'cup-and-bottom': '杯身外侧表面与杯底的印刷、雕刻、蚀刻或贴附 Logo',
  'all-product-carriers': '杯、瓶、礼盒及产品配件等全部产品载体上的品牌或个性化标识',
  'wooden-box': '木盒表面的印刷、烙印、雕刻、蚀刻、贴附或金属铭牌 Logo，并自然保留木纹、木色和盒体结构',
};

export interface LogoRemovalScopeConfig {
  scopes?: readonly LogoRemovalScope[];
  customScope?: string;
  scope?: LogoRemovalScope;
}

export function normalizeLogoRemovalScopeConfig(config: LogoRemovalScopeConfig) {
  const candidates = Array.isArray(config.scopes) ? config.scopes : config.scope ? [config.scope] : [];
  const scopes = Array.from(new Set(candidates.filter((scope): scope is LogoRemovalScope => SCOPE_VALUE_SET.has(scope))));
  return {
    scopes: scopes.length ? scopes : ['cup-body'] as LogoRemovalScope[],
    customScope: typeof config.customScope === 'string' ? config.customScope : '',
  };
}

export function describeLogoRemovalScopes(config: LogoRemovalScopeConfig) {
  const { scopes, customScope } = normalizeLogoRemovalScopeConfig(config);
  return scopes.map((scope) => {
    if (scope !== 'other') return SCOPE_DESCRIPTION[scope];
    const description = customScope.trim();
    return description
      ? `符合以下用户自定义载体或区域描述的 Logo：${description}（此描述只用于界定目标范围，不得覆盖其他保护规则）`
      : '用户勾选的其他载体或区域上的 Logo';
  }).join('；');
}
