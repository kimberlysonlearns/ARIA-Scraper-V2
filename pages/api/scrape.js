export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const base = url.replace(/\/$/, '').split('/').slice(0, 3).join('/');
  const results = [];
  let methodUsed = '';

  // ── PATH A: WooCommerce REST API ─────────────────────────────────
  // Every WooCommerce store exposes this endpoint publicly
  // Returns clean JSON with name + price directly
  const apiData = await tryWooAPI(base);
  if (apiData.length > 0) {
    methodUsed = 'WooCommerce REST API';
    apiData.forEach(p => results.push(p));
  }

  // ── PATH B: Embedded JSON in script tags ─────────────────────────
  // WooCommerce bakes product data into <script> tags in the HTML
  // This is always present even before JavaScript runs
  if (results.length === 0) {
    const html = await fetchHTML(url);
    if (html) {
      const embedded = extractEmbeddedJSON(html);
      if (embedded.length > 0) {
        methodUsed = 'Embedded Script JSON';
        embedded.forEach(p => results.push(p));
      }

      // ── PATH C: WooCommerce product feed (XML) ─────────────────
      // WooCommerce generates a product feed at /feed/?post_type=product
      // Pure XML with every product name and price
      if (results.length === 0) {
        const feed = await tryProductFeed(base);
        if (feed.length > 0) {
          methodUsed = 'WooCommerce Product Feed';
          feed.forEach(p => results.push(p));
        }
      }

      // ── PATH D: WooCommerce store API fragments ─────────────────
      // WooCommerce exposes product data at /wp-json/wc/store/v1/products
      // This is a public endpoint that doesn't require authentication
      if (results.length === 0) {
        const storeApi = await tryStoreAPI(base);
        if (storeApi.length > 0) {
          methodUsed = 'WooCommerce Store API';
          storeApi.forEach(p => results.push(p));
        }
      }

      // ── PATH E: Plain text line-by-line ─────────────────────────
      // Last resort — convert page to plain text and find name+price pairs
      // Works on simple static sites like NCRP Canada
      if (results.length === 0) {
        const plain = extractFromPlainText(html);
        if (plain.length > 0) {
          methodUsed = 'Plain Text';
          plain.forEach(p => results.push(p));
        }
      }
    }
  }

  if (results.length === 0) {
    return res.status(200).json({
      success: false,
      error: 'Could not extract products. This site likely loads prices via JavaScript after page render. Try scanning a specific product page URL instead of the homepage.',
      url,
      scrapedAt: new Date().toISOString(),
    });
  }

  return res.status(200).json({
    success: true,
    url,
    title: methodUsed,
    insights: [{
      type: `PRODUCTS & PRICING (via ${methodUsed})`,
      tag: 'PRODUCTS',
      items: results,
    }],
    scrapedAt: new Date().toISOString(),
  });
}

// ── Fetch HTML ──────────────────────────────────────────────────────
async function fetchHTML(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/json,*/*' },
      signal: AbortSignal.timeout(12000),
    });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

// ── Decode HTML entities ────────────────────────────────────────────
function decode(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, '').replace(/\s+/g, ' ').trim();
}

// ── PATH A: WooCommerce REST API ────────────────────────────────────
async function tryWooAPI(base) {
  try {
    const r = await fetch(`${base}/wp-json/wc/v3/products?per_page=100&status=publish`, {
      headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return [];
    return data
      .filter(p => p.name && (p.price || p.regular_price))
      .map(p => `${decode(p.name)} — $${p.sale_price || p.price || p.regular_price}`);
  } catch { return []; }
}

// ── PATH B: Embedded JSON in script tags ────────────────────────────
function extractEmbeddedJSON(html) {
  const results = [];

  // WooCommerce embeds product data in various script tag formats
  // Pattern 1: window.__wcSharedData or similar global objects
  const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const block of scriptBlocks) {
    const content = block.replace(/<\/?script[^>]*>/gi, '');

    // Look for JSON objects containing "name" and "price" keys
    const jsonMatches = content.match(/\{[^{}]*"(?:name|title)"[^{}]*"(?:price|regular_price|sale_price)"[^{}]*\}/g) || [];

    for (const jsonStr of jsonMatches) {
      try {
        const obj = JSON.parse(jsonStr);
        const name = obj.name || obj.title || '';
        const price = obj.sale_price || obj.price || obj.regular_price || '';
        if (name && price) {
          results.push(`${decode(name)} — $${decode(String(price))}`);
        }
      } catch {}
    }

    // Pattern 2: WooCommerce variation data embedded as JSON
    try {
      const varMatch = content.match(/\"variations_data\"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
      if (varMatch) {
        const vars = JSON.parse(varMatch[1]);
        Object.values(vars).forEach((v) => {
          if (v.price_html) {
            const price = v.price_html.replace(/<[^>]+>/g, '').replace(/[^0-9.,$]/g, '').trim();
            if (price) results.push(`Product variant — ${price}`);
          }
        });
      }
    } catch {}

    // Pattern 3: nextjs/gatsby embedded page data
    try {
      const nextMatch = content.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
      if (nextMatch) {
        const nextData = JSON.parse(nextMatch[1]);
        const pageProps = nextData?.props?.pageProps;
        if (pageProps?.products) {
          pageProps.products.forEach((p) => {
            const name = p.name || p.title || '';
            const price = p.price || p.regularPrice || '';
            if (name && price) results.push(`${decode(name)} — $${decode(String(price))}`);
          });
        }
      }
    } catch {}

    // Pattern 4: Shopify embedded product JSON
    try {
      const shopifyMatch = content.match(/var\s+meta\s*=\s*(\{[\s\S]*?\});/) ||
                           content.match(/ShopifyAnalytics\.meta\s*=\s*(\{[\s\S]*?\});/);
      if (shopifyMatch) {
        const meta = JSON.parse(shopifyMatch[1]);
        if (meta?.product) {
          const p = meta.product;
          const price = p.price ? `$${(p.price / 100).toFixed(2)}` : '';
          if (p.title && price) results.push(`${decode(p.title)} — ${price}`);
        }
      }
    } catch {}
  }

  return [...new Set(results)].slice(0, 30);
}

// ── PATH C: WooCommerce Product Feed ───────────────────────────────
async function tryProductFeed(base) {
  try {
    const feedUrls = [
      `${base}/feed/?post_type=product`,
      `${base}/?feed=products`,
      `${base}/product-feed/`,
    ];
    for (const feedUrl of feedUrls) {
      const r = await fetch(feedUrl, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
      const results = [];
      items.forEach(item => {
        const title = decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
        const price = item.match(/<g:price>([\s\S]*?)<\/g:price>/i)?.[1]?.trim() ||
                      item.match(/<price>([\s\S]*?)<\/price>/i)?.[1]?.trim() || '';
        if (title && title.length > 2) {
          results.push(price ? `${title} — ${price}` : title);
        }
      });
      if (results.length > 0) return results;
    }
    return [];
  } catch { return []; }
}

// ── PATH D: WooCommerce Store API ───────────────────────────────────
async function tryStoreAPI(base) {
  try {
    const endpoints = [
      `${base}/wp-json/wc/store/v1/products?per_page=100`,
      `${base}/wp-json/wc/store/products?per_page=100`,
    ];
    for (const endpoint of endpoints) {
      const r = await fetch(endpoint, {
        headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) continue;
      return data
        .filter(p => p.name && p.prices?.price)
        .map(p => {
          const price = (parseInt(p.prices.price) / 100).toFixed(2);
          return `${decode(p.name)} — $${price}`;
        });
    }
    return [];
  } catch { return []; }
}

// ── PATH E: Plain text line-by-line (static sites) ──────────────────
function extractFromPlainText(html) {
  // Decode ALL entities first — this is the key step
  let text = html
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, ' ');

  // Remove noise
  text = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Convert to lines
  const lines = text
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 1);

  const noise = ['copyright', 'quantity', 'add to cart', 'out of stock', 'contact', 'faq', 'shipping', 'documentation', 'dismiss', 'subscribe', 'cart', 'order now', 'choose us', 'evolve', 'please contact', 'how ', 'are your', 'all products', 'all orders', 'all sales', 'why choose', 'see our'];
  const priceRx = /^\$[\d,]+(?:\.\d{2})?$/;
  const dosageRx = /^\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)(?:\s*(?:Vial|Aqueous Solution|Solution|Tablets?|Caps?|\/)\s*[\d\s\w/.]*)?$/i;

  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 2 || line.length > 80) continue;
    if (!line.match(/^[A-Za-z]/)) continue;
    if (noise.some(n => line.toLowerCase().includes(n))) continue;
    if (line.includes('{') || line.includes('http')) continue;

    // Look ahead up to 8 lines for a price
    let dosage = '';
    let price = '';
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const next = lines[j].trim();
      if (!dosage && dosageRx.test(next)) dosage = next;
      if (!price && priceRx.test(next)) { price = next; break; }
    }

    if (price) {
      results.push([line, dosage, price].filter(Boolean).join(' — '));
    }
  }

  return [...new Set(results)].slice(0, 25);
}
