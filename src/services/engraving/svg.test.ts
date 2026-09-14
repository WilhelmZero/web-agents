import {expect,it} from 'vitest';
import {parseSvg} from './svg';
it('accepts viewBox-only SVG and preserves its aspect ratio',()=>{expect(parseSvg('<svg viewBox="0 0 240 120"><path d="M0 0L20 20"/></svg>')).toMatchObject({width:240,height:120});});
it('supports physical dimensions and caps raster resolution',()=>{expect(parseSvg('<svg width="100mm" height="50mm"/>')).toMatchObject({width:378,height:189});expect(parseSvg('<svg width="5000" height="1000"/>')).toMatchObject({width:4096,height:819});});
it('rejects invalid or excessive dimensions and external resources',()=>{for(const svg of ['<html/>','<svg width="100000" height="100000"/>','<svg><image href="https://example.com/a.png"/></svg>','<!DOCTYPE svg><svg/>'])expect(()=>parseSvg(svg)).toThrow();});
it('removes executable nodes and events while retaining local gradients',()=>{const svg=parseSvg('<svg onload="alert(1)"><script>bad()</script><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>').text;expect(svg).not.toContain('onload');expect(svg).not.toContain('<script');expect(svg).toContain('url(#g)');});
