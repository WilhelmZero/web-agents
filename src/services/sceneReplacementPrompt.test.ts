import { describe, expect, it } from 'vitest';
import { buildSceneReplacementPrompt } from './sceneReplacementPrompt';

describe('buildSceneReplacementPrompt', () => {
  it('keeps the requested theme and appends non-overridable product constraints', () => {
    const prompt = buildSceneReplacementPrompt('改为温暖的家庭酒吧主题');

    expect(prompt.startsWith('改为温暖的家庭酒吧主题')).toBe(true);
    expect(prompt).toContain('它始终是商品的一部分');
    expect(prompt).toContain('商品说明文字');
    expect(prompt).toContain('商品信息层');
    expect(prompt).toContain('Laser Engraved / Dishwasher Safe / Perfect Gift / Non-Lead / Capacity');
    expect(prompt).toContain('只允许替换这一层');
    expect(prompt).toContain('杯身上的“YOUR CUSTOM TEXT/PHOTO HERE”');
    expect(prompt).toContain('局部氛围改造');
    expect(prompt).toContain('木盒相对画幅的大小不得变化');
    expect(prompt).toContain('不得为了展示完整房间');
    expect(prompt).toContain('多小图必须逐格独立执行并逐格验收');
    expect(prompt).toContain('任意一格的环境仍与原图基本相同');
    expect(prompt).toContain('不得合并、交换、移动、删除或重排小图');
    expect(prompt).toContain('无纵深商品棚拍/桌面构图');
    expect(prompt).toContain('严禁删除木盒后补出酒吧');
    expect(prompt).toContain('焦平面与景深锁定');
    expect(prompt).toContain('背景模糊强度');
    expect(prompt).toContain('尺寸箭头和辅助线');
    expect(prompt).toContain('无论盒子是打开、关闭');
    expect(prompt).toContain('禁止悬空、漂浮');
    expect(prompt).toContain('禁止无中生有地加入前景手');
    expect(prompt).toContain('穿搭允许为适应目标场景而改变');
    expect(prompt).toContain('统一重建与新场景一致的光照');
    expect(prompt).toContain('直接查看并判断输入画面中是否存在多个小图');
    expect(prompt).toContain('对模型判断出的每一个小图逐一、完整地执行');
    expect(prompt).toContain('不得根据截图、拼贴、海报或详情页等预设类别');
    expect(prompt).toContain('带文字画板');
    expect(prompt).toContain('此规则仅适用于背景陈设');
    expect(prompt).toContain('必须区分“前景商品信息”和“背景场景文字”');
    expect(prompt).toContain('节日、庆典、赛事名称、祝福语和年份');
    expect(prompt).toContain('即使目标场景也是另一个节日');
    expect(prompt).toContain('前景功能徽标及产品本体上的文字');
    expect(prompt).toContain('杯身 Logo 文字最高优先级保护');
    expect(prompt).toContain('无论写了什么内容、是否与旧节日或旧场景相关');
    expect(prompt).toContain('此规则优先于任何“删除背景节日文字');
    expect(prompt).toContain('杯身 Logo 中即使含有节日、赛事、年份或祝福文字，也禁止去除');
    expect(prompt).toContain('严格保持原图的画面裁切和可见范围');
    expect(prompt).toContain('禁止补全被裁掉的杯口、杯身、杯底');
    expect(prompt).toContain('禁止通过缩小主体、移动主体、扩大视野或重新构图');
  });
});
