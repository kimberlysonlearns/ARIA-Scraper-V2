export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const baseUrl = url.replace(/\/$/, '').split('/').slice(0, 3).join('/');

  try {
    const html = await fetchHTML(url);
    if (!html) return res.status(200).json({ success: false, error: 'Could not access this website.', url });

    const title = clean(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '');

    // Method 1: WooCommerce API
    const wooProducts = await tryWooAPI(baseUrl);
    if (wooProducts.length > 0) {
      return res.status(200).json({
        success: true, url, title,
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: wooProducts }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Method 2: JSON-LD
    const jsonProducts = extractJSONLD(html);
    if (jsonProducts.length > 0) {
      return res.status(200).json({
        success: true, url, title,
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: jsonProducts }, ...generalInsights(html)],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Method 3: Convert entire page to plain text first, then extract
    const products = extractFromPlainText(html);
    if (products.length > 0) {
      return res.status(200).json({
        success: true, url, title,
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: products }, ...generalInsights(html)],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Fallback
    const gi = generalInsights(html);
    const meta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i)?.[1];
    if (meta) gi.push({ type: 'SITE DESCRIPTION', tag: 'INFO', items: [clean(meta)] });
    return res.status(200).json({ success: true, url, title, insights: gi, scrapedAt: new Date().toISOString() });

  } catch (e) {
    return res.status(200).json({ success: false, error: e.message || 'Failed', url });
  }
}

// Clean HTML entities
function clean(str) {
  if (!str) return '';
  return str
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchHTML(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function tryWooAPI(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=50&status=publish`, {
      headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const p = await r.json();
    if (!Array.isArray(p) || !p.length) return [];
    return p.map(x => {
      const price = x.sale_price || x.price || x.regular_price || '';
      const weight = x.weight ? `${x.weight}` : '';
      return clean(`${x.name}${weight ? ' — ' + weight : ''}${price ? ' — $' + price : ''}`);
    }).filter(Boolean);
  } catch { return []; }
}

function extractJSONLD(html) {
  const results = [];
  (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []).forEach(b => {
    try {
      const j = JSON.parse(b.replace(/<\/?script[^>]*>/gi, ''));
      const items = Array.isArray(j) ? j : [j];
      items.forEach(i => {
        (i['@graph'] || [i]).forEach(n => {
          if (n['@type'] === 'Product' && n.name) {
            const price = n.offers?.price || n.offers?.lowPrice || '';
            results.push(clean(`${n.name}${price ? ' — $' + price : ''}`));
          }
        });
      });
    } catch {}
  });
  return results;
}

// KEY FIX: Convert entire HTML to plain text first, then find product+dosage+price patterns
function extractFromPlainText(html) {
  // Step 1: Decode ALL HTML entities first
  let text = html
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&\w+;/g, ' ');

  // Step 2: Remove scripts, styles, nav, footer
  text = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');

  // Step 3: Strip remaining tags
  text = text.replace(/<[^>]+>/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

  // Step 4: Split into lines
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const results = [];
  const skipWords = ['copyright', 'shipping', 'faq', 'why choose', 'contact', 'home', 'cart', 'add to cart', 'order now', 'documentation', 'quantity', 'out of stock', 'please contact', 'see our products', 'questions', 'how should', 'how do i', 'how much', 'are your', 'all products listed', 'all orders', 'all sales', 'evolve', 'choose us', 'choose', 'now available', 'subscribe', 'dismiss', 'follow'];

  const dosagePattern = /^\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)(?:\s*\/\s*\d+\s*(?:mg|mcg|ml|g|iu|tablets?|caps?|vials?|tabs?))?(?:\s*\/?\s*\d+\s*(?:tablets?|caps?|vials?|tabs?))?$/i;
  const pricePattern = /^\$[\d,]+(?:\.\d{2})?$/;
  const productPattern = /^[A-Z][A-Za-z0-9\s\-()./+]{2,60}$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip noise
    if (skipWords.some(w => line.toLowerCase().includes(w))) continue;
    if (line.length < 3 || line.length > 80) continue;
    if (line.includes('{') || line.includes('function') || line.includes('http')) continue;

    // Check if this line looks like a product name
    if (productPattern.test(line) && line === line.replace(/[a-z]/g, s => s)) {
      // ALL CAPS or mixed — likely a product name
      // Look ahead for dosage and price in the next 6 lines
      let dosage = '';
      let price = '';

      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const next = lines[j].trim();
        if (!dosage && dosagePattern.test(next)) dosage = next;
        if (!price && pricePattern.test(next)) price = next;
        // Stop if we hit another product name
        if (j > i + 1 && productPattern.test(next) && next === next.replace(/[a-z]/g, s => s) && next.length > 3) break;
      }

      if (price || dosage) {
        const parts = [line, dosage, price].filter(Boolean);
        results.push(parts.join(' — '));
      }
    }
  }

  // If the above didn't work, try a looser approach — find any line with a $ nearby
  if (results.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (skipWords.some(w => line.toLowerCase().includes(w))) continue;
      if (line.length < 3 || line.length > 60) continue;
      if (!line.match(/^[A-Za-z]/)) continue;

      // Look ahead for a price
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (pricePattern.test(lines[j])) {
          results.push(`${line} — ${lines[j]}`);
          break;
        }
      }
    }
  }

  return [...new Set(results)].slice(0, 25);
}

function generalInsights(html) {
  const insights = [];
  // Decode first then extract prices
  const decoded = html
    .replace(/&#36;/g, '$').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c));
  const text = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const prices = [...new Set((text.match(/\$[\d,]+(?:\.\d{2})?/g) || []))].slice(0, 10);
  if (prices.length > 0) insights.push({ type: 'ALL PRICES FOUND', tag: 'PRICING', items: prices });
  return insights;
}
