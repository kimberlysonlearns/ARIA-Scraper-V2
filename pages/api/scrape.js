export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const baseUrl = url.replace(/\/$/, '').split('/').slice(0, 3).join('/');

  try {
    const html = await fetchHTML(url);
    if (!html) {
      return res.status(200).json({ success: false, error: 'Could not access this website.', url });
    }

    const title = decodeHTML(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');

    // Method 1: WooCommerce REST API
    const wooProducts = await tryWooCommerceAPI(baseUrl);
    if (wooProducts.length > 0) {
      return res.status(200).json({
        success: true, url, title, method: 'WooCommerce API',
        insights: [{ type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: wooProducts }],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Method 2: JSON-LD
    const jsonLdProducts = extractJSONLD(html);
    if (jsonLdProducts.length > 0) {
      return res.status(200).json({
        success: true, url, title, method: 'Structured Data',
        insights: [
          { type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: jsonLdProducts },
          ...extractGeneralInsights(html),
        ],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Method 3: Direct HTML product extraction
    const directProducts = extractDirectProducts(html);
    if (directProducts.length > 0) {
      return res.status(200).json({
        success: true, url, title, method: 'Direct HTML',
        insights: [
          { type: 'PRODUCTS & PRICING', tag: 'PRODUCTS', items: directProducts },
          ...extractGeneralInsights(html),
        ],
        scrapedAt: new Date().toISOString(),
      });
    }

    // Method 4: General fallback
    const generalInsights = extractGeneralInsights(html);
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i)?.[1]?.trim() || '';
    if (metaDesc) generalInsights.push({ type: 'SITE DESCRIPTION', tag: 'INFO', items: [decodeHTML(metaDesc)] });

    return res.status(200).json({
      success: true, url, title, method: 'General',
      insights: generalInsights,
      scrapedAt: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({ success: false, error: error.message || 'Failed to fetch', url });
  }
}

// Decode HTML entities
function decodeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&#36;/g, '$')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '—')
    .replace(/&#8212;/g, '—')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fetch HTML
async function fetchHTML(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// WooCommerce REST API
async function tryWooCommerceAPI(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=50&status=publish`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const products = await r.json();
    if (!Array.isArray(products) || products.length === 0) return [];
    return products.map(p => {
      const price = p.sale_price || p.price || p.regular_price || '';
      const weight = p.weight ? `${p.weight}` : '';
      return `${p.name}${weight ? ` ${weight}` : ''}${price ? ` — $${price}` : ''}`;
    }).filter(Boolean);
  } catch { return []; }
}

// JSON-LD
function extractJSONLD(html) {
  const results = [];
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  blocks.forEach(block => {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, ''));
      const items = Array.isArray(json) ? json : [json];
      items.forEach(item => {
        const nodes = item['@graph'] ? item['@graph'] : [item];
        nodes.forEach(node => {
          if (node['@type'] === 'Product' && node.name) {
            const price = node.offers?.price || node.offers?.lowPrice || '';
            const currency = node.offers?.priceCurrency || '';
            results.push(decodeHTML(`${node.name}${price ? ` — $${price} ${currency}` : ''}`).trim());
          }
        });
      });
    } catch {}
  });
  return results;
}

// Direct product extraction — finds name + dosage + price
function extractDirectProducts(html) {
  const results = [];
  const skipWords = ['copyright', 'shipping', 'faq', 'why choose', 'contact', 'choose us', 'products', 'shipping and delivery', 'home', 'evolve'];

  // Strip scripts and styles
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Find all h2/h3/h4 headings — product names live here
  const headingRegex = /<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi;
  let match;
  const headings = [];
  while ((match = headingRegex.exec(cleaned)) !== null) {
    const text = decodeHTML(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (
      text.length > 2 &&
      text.length < 100 &&
      !text.includes('{') &&
      !text.includes('function') &&
      !skipWords.some(w => text.toLowerCase().includes(w))
    ) {
      headings.push({ text, index: match.index });
    }
  }

  // For each product heading, look for dosage and price nearby
  headings.forEach(heading => {
    // Get the next 800 characters after the heading
    const nearby = cleaned.substring(heading.index, heading.index + 800);
    const nearbyText = decodeHTML(nearby.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

    // Extract dosage — e.g. "10 mg", "10ml", "12.5 mg / 50 Tablets", "30 ml"
    const dosageMatch = nearbyText.match(
      /(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu|tablets?|caps?|capsules?|vials?|tabs?)(?:\s*\/\s*\d+\s*(?:mg|mcg|ml|g|iu|tablets?|caps?|capsules?|vials?|tabs?))?(?:\s*\/\s*\d+\s*(?:mg|mcg|ml|g|iu|tablets?|caps?|capsules?|vials?))?)/i
    );

    // Extract price — e.g. "$90.00"
    const priceMatch = nearbyText.match(/\$[\d,]+(?:\.\d{2})?/);

    const dosage = dosageMatch?.[0]?.trim() || '';
    const price = priceMatch?.[0]?.trim() || '';

    if (price) {
      // Format: "Product Name — 10 mg — $90.00"
      const entry = [heading.text, dosage, price].filter(Boolean).join(' — ');
      results.push(entry);
    } else if (dosage) {
      // No price but has dosage
      results.push(`${heading.text} — ${dosage}`);
    } else {
      // Just the name if nothing else found
      results.push(heading.text);
    }
  });

  // Remove duplicates and limit
  return [...new Set(results)].filter(Boolean).slice(0, 25);
}

// General insights fallback
function extractGeneralInsights(html) {
  const insights = [];
  const cleanText = decodeHTML(html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim());

  // All prices
  const prices = [...new Set((cleanText.match(/\$[\d,]+(?:\.\d{2})?/g) || []))].slice(0, 10);
  if (prices.length > 0) insights.push({ type: 'ALL PRICES FOUND', tag: 'PRICING', items: prices });

  // Headings
  const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  const headings = [];
  let hm;
  while ((hm = headingRegex.exec(html)) !== null && headings.length < 8) {
    const text = decodeHTML(hm[1].replace(/<[^>]+>/g, '').trim());
    if (text.length > 3 && text.length < 80 && !text.includes('{')) headings.push(text);
  }
  if (headings.length > 0) insights.push({ type: 'PAGE SECTIONS', tag: 'HOMEPAGE', items: headings });

  return insights;
}
