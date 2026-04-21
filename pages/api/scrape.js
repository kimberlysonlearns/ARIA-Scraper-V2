export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const base = url.replace(/\/$/, '').split('/').slice(0, 3).join('/');

  try {
    // ── PATH A: WooCommerce Store API (best for dynamic sites) ──────
    // Public endpoint, no auth needed, returns name + price in cents
    const storeApi = await tryStoreAPI(base);
    if (storeApi.length > 0) {
      return res.status(200).json({
        success: true, url,
        title: 'WooCommerce Store API',
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: storeApi }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // ── PATH B: WooCommerce REST API ────────────────────────────────
    const restApi = await tryRestAPI(base);
    if (restApi.length > 0) {
      return res.status(200).json({
        success: true, url,
        title: 'WooCommerce REST API',
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: restApi }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // ── PATH C: Sitemap → scrape each product page ──────────────────
    // Gets ALL products, scrapes each individual page for name + price
    const sitemapProducts = await tryFromSitemap(base);
    if (sitemapProducts.length > 0) {
      return res.status(200).json({
        success: true, url,
        title: 'Sitemap + Product Pages',
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: sitemapProducts }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // ── PATH D: Product Feed XML ────────────────────────────────────
    const feed = await tryFeed(base);
    if (feed.length > 0) {
      return res.status(200).json({
        success: true, url,
        title: 'WooCommerce Product Feed',
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: feed }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // ── PATH E: Plain text from homepage (static sites) ─────────────
    const html = await fetchHTML(url);
    if (html) {
      const plain = extractPlainText(html);
      if (plain.length > 0) {
        return res.status(200).json({
          success: true, url,
          title: 'Plain Text',
          insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: plain }],
          scrapedAt: new Date().toISOString(),
        });
      }
    }

    return res.status(200).json({
      success: false,
      error: 'Could not extract product data. This site loads prices via JavaScript after page render.',
      url,
      scrapedAt: new Date().toISOString(),
    });

  } catch (e) {
    return res.status(200).json({ success: false, error: e.message || 'Failed', url });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
async function fetchHTML(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
      },
      signal: AbortSignal.timeout(10000),
    });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

function decode(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, '').replace(/\s+/g, ' ').trim();
}

// ── PATH A: WooCommerce Store API ───────────────────────────────────
async function tryStoreAPI(base) {
  try {
    // Try paginated to get ALL products
    const results = [];
    let page = 1;
    while (page <= 5) { // max 5 pages = 500 products
      const r = await fetch(`${base}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) break;
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach(p => {
        if (!p.name) return;
        const name = decode(p.name);
        // Price comes in cents as string e.g. "4800" = $48.00
        const rawPrice = p.prices?.sale_price || p.prices?.price || p.prices?.regular_price || '';
        const price = rawPrice ? `$${(parseInt(rawPrice) / 100).toFixed(2)}` : '';
        results.push(price ? `${name} — ${price}` : name);
      });
      if (data.length < 100) break; // last page
      page++;
    }
    return results;
  } catch { return []; }
}

// ── PATH B: WooCommerce REST API ────────────────────────────────────
async function tryRestAPI(base) {
  try {
    const results = [];
    let page = 1;
    while (page <= 5) {
      const r = await fetch(`${base}/wp-json/wc/v3/products?per_page=100&status=publish&page=${page}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) break;
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach(p => {
        if (!p.name) return;
        const price = p.sale_price || p.price || p.regular_price || '';
        results.push(price ? `${decode(p.name)} — $${price}` : decode(p.name));
      });
      if (data.length < 100) break;
      page++;
    }
    return results;
  } catch { return []; }
}

// ── PATH C: Sitemap → individual product pages ──────────────────────
async function tryFromSitemap(base) {
  try {
    // Step 1: Find all product URLs from sitemap
    const productUrls = await getProductUrlsFromSitemap(base);
    if (productUrls.length === 0) return [];

    // Step 2: Scrape each product page for name + price
    // Limit to 30 to avoid timeout
    const results = [];
    const urlsToScrape = productUrls.slice(0, 30);

    for (const productUrl of urlsToScrape) {
      const product = await scrapeProductPage(productUrl);
      if (product) results.push(product);
    }

    return results;
  } catch { return []; }
}

async function getProductUrlsFromSitemap(base) {
  const sitemapUrls = [
    `${base}/product-sitemap.xml`,
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/wp-sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const r = await fetch(sitemapUrl, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const xml = await r.text();

      // If this is a sitemap index, find the product sitemap
      if (xml.includes('<sitemapindex')) {
        const subSitemaps = xml.match(/<loc>([^<]*product[^<]*)<\/loc>/gi) || [];
        for (const sub of subSitemaps) {
          const subUrl = sub.replace(/<\/?loc>/g, '').trim();
          const subR = await fetch(subUrl, { signal: AbortSignal.timeout(8000) });
          if (!subR.ok) continue;
          const subXml = await subR.text();
          const urls = extractUrlsFromSitemap(subXml, base);
          if (urls.length > 0) return urls;
        }
      }

      const urls = extractUrlsFromSitemap(xml, base);
      if (urls.length > 0) return urls;
    } catch { continue; }
  }
  return [];
}

function extractUrlsFromSitemap(xml, base) {
  const allUrls = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
  return allUrls
    .map(u => u.replace(/<\/?loc>/g, '').trim())
    .filter(u => {
      // Only product pages - filter out category/tag/page URLs
      return u.includes('/shop/') &&
        !u.includes('/categories/') &&
        !u.includes('/tag/') &&
        !u.includes('?') &&
        !u.endsWith('/shop/');
    });
}

async function scrapeProductPage(url) {
  try {
    const html = await fetchHTML(url);
    if (!html) return null;

    // Decode entities first
    const decoded = decode(html);

    // Extract product name from page title or h1
    const name =
      decoded.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
      decoded.match(/<h1[^>]*>([^<]{3,60})<\/h1>/i)?.[1]?.trim() ||
      // Fall back to URL slug
      url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (!name || name.length < 2) return null;

    // Try JSON-LD for price (most reliable on individual pages)
    const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdBlocks) {
      try {
        const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, ''));
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          const nodes = item['@graph'] || [item];
          for (const node of nodes) {
            if (node['@type'] === 'Product') {
              const price = node.offers?.price || node.offers?.lowPrice || '';
              const currency = node.offers?.priceCurrency || 'CAD';
              if (price) return `${decode(name)} — $${price} ${currency}`;
            }
          }
        }
      } catch {}
    }

    // Try WooCommerce price in HTML
    const cleanHtml = decode(html);
    const priceMatch =
      cleanHtml.match(/class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>\s*<[^>]+>\s*\$?\s*<\/[^>]+>([\d,.]+)/i) ||
      cleanHtml.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*(?:CAD|USD)?/);

    if (priceMatch) {
      const price = priceMatch[1]?.replace(/,/g, '') || '';
      if (price && parseFloat(price) > 0) {
        return `${decode(name)} — $${parseFloat(price).toFixed(2)} CAD`;
      }
    }

    // Return just the name if no price found
    return decode(name);
  } catch { return null; }
}

// ── PATH D: Product Feed XML ─────────────────────────────────────────
async function tryFeed(base) {
  const feedUrls = [
    `${base}/feed/?post_type=product`,
    `${base}/?feed=products`,
  ];
  for (const feedUrl of feedUrls) {
    try {
      const r = await fetch(feedUrl, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
      const results = [];
      items.forEach(item => {
        const title = decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
        const price =
          item.match(/<g:price>([\s\S]*?)<\/g:price>/i)?.[1]?.trim() ||
          item.match(/<price>([\s\S]*?)<\/price>/i)?.[1]?.trim() || '';
        if (title && title.length > 2) {
          results.push(price ? `${title} — ${price}` : title);
        }
      });
      if (results.length > 0) return results;
    } catch { continue; }
  }
  return [];
}

// ── PATH E: Plain text — handles NCRP (static), Wix, Shopify, etc ────
function extractPlainText(html) {
  let text = html
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, ' ');
  text = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  const lines = text.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 1);

  const noise = ['copyright', 'quantity', 'add to cart', 'out of stock', 'contact', 'faq',
    'shipping', 'documentation', 'dismiss', 'subscribe', 'cart', 'order now', 'choose us',
    'evolve', 'please contact', 'how ', 'are your', 'all products', 'all orders', 'all sales',
    'why choose', 'see our', 'follow', 'now available', 'view product', 'create account',
    'my account', 'privacy policy', 'terms of use', 'return policy', 'bottom of page', 'top of page'];

  // Single words that appear as standalone labels on Wix/Shopify — never product names
  const exactNoise = ['sale', 'price', 'new', 'new arrival', 'recommended', 'products', 'search',
    'home', 'more', 'spray', 'shop', 'skincare', 'skin care', 'company', 'in stock'];

  // Matches: $49.99 | C$49.99 | CAD$49.99 | $49 | from $49.99
  const priceRx = /^(?:(?:regular\s*price|sale\s*price|price\s*from|from|price)\s*)?(?:[A-Z]{0,3})\$[\d,]+(?:\.\d{2})?$/i;
  // Extract just the numeric price from a matched line
  const extractPrice = (s) => {
    const m = s.match(/([A-Z]{0,3}\$[\d,]+(?:\.\d{2})?)/i);
    if (!m) return null;
    // Normalize C$ CAD$ etc → $ and remove double $$
    return m[1].replace(/^[A-Za-z]+\$/, '$');
  };
  const dosageRx = /^\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)(?:\s*(?:Vial|Aqueous Solution|Solution|Tablets?|Caps?|\/)\s*[\d\s\w/.]*)?$/i;

  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 2 || line.length > 100) continue;
    if (!line.match(/^[A-Za-z]/)) continue;
    // Skip lines that are just price strings e.g. "Regular PriceC$54.99Sale PriceC$44.99"
    if (line.match(/^(?:regular\s*price|sale\s*price|price\s*from|pricefrom|from\s*[A-Z]*\$)/i)) continue;
    // Skip standalone label words that are never product names
    if (exactNoise.includes(line.toLowerCase())) continue;
    if (noise.some(n => line.toLowerCase().includes(n))) continue;
    if (line.includes('{') || line.includes('http')) continue;

    // Check if line itself contains an inline price e.g. "BPC-157 PriceFrom C$49.99"
    const inlinePrice = line.match(/(?:regular\s*price|sale\s*price|price\s*from|from|price)\s*(?:[A-Z]{0,3})\$([\d,]+(?:\.\d{2})?)/i);
    if (inlinePrice) {
      const name = line.replace(/(?:regular\s*price|sale\s*price|price\s*from|from\s*c?\$[\d.]+|price\s*c?\$[\d.]+).*/i, '').trim();
      const price = `$${inlinePrice[1]}`;
      if (name.length > 2 && name.length < 100) {
        results.push(`${name} — ${price}`);
        continue;
      }
    }

    // Otherwise look ahead for price on nearby line
    let dosage = '', price = '';
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const next = lines[j].trim();
      if (!dosage && dosageRx.test(next)) dosage = next;
      if (!price && priceRx.test(next)) {
        price = extractPrice(next) || next;
        break;
      }
    }
    if (price) results.push([line, dosage, price].filter(Boolean).join(' — '));
  }
  return [...new Set(results)].slice(0, 30);
}
