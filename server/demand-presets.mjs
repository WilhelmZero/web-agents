// Only fields traceable to a public platform source are pre-filled. Unknown
// platform limits are intentionally left blank and labelled unverified.
const checkedAt = '2026-10-10';
const source = (url, status = 'recommendation') => ({ url, checkedAt, status });

export const DEFAULT_DEMAND_PRESETS = [
  { id: '00000000-0000-4000-8000-000000000001', platform: 'AMAZON', type: 'main', name: 'Amazon US main image', nameZh: 'Amazon 美国站首图',
    requirements: [{ content: 'Main product image; confirm the current category policy', source: source('https://sellercentral.amazon.com/help/hub/reference/external/G1881', 'unverified') }] },
  { id: '00000000-0000-4000-8000-000000000002', platform: 'ETSY', type: null, name: 'Etsy listing image', nameZh: 'Etsy 商品图',
    requirements: [{ content: 'Listing photo; Etsy recommends at least 2000 px in both dimensions', source: source('https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop?segment=selling') }] },
  { id: '00000000-0000-4000-8000-000000000003', platform: 'EBAY', type: null, name: 'eBay listing image', nameZh: 'eBay 商品图',
    requirements: [{ content: 'Listing photo', minLongestEdge: 500, source: source('https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370', 'requirement') }] },
  { id: '00000000-0000-4000-8000-000000000004', platform: 'TIKTOK', type: null, name: 'TikTok Shop US image', nameZh: 'TikTok Shop 美国站商品图',
    requirements: [{ content: 'Product image; confirm the current marketplace requirements', source: source('https://seller-us.tiktok.com/university/essay?default_language=en&knowledge_id=481891871868714', 'unverified') }] },
  { id: '00000000-0000-4000-8000-000000000005', platform: 'WAYFAIR', type: null, name: 'Wayfair onboarding image', nameZh: 'Wayfair 商品图',
    requirements: [{ content: 'Product image; confirm the current marketplace requirements', source: source('https://sell.wayfair.com/onboarding-checklist', 'unverified') }] },
  ...['TEMU', 'SHEIN', 'WALMART'].map((platform, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 6}`, platform, type: null,
    name: `${platform} image · verify requirements`, nameZh: `${platform} 图片 · 要求待核验`,
    requirements: [{ content: 'Please verify platform image requirements', source: { checkedAt, status: 'unverified' } }] })),
];
