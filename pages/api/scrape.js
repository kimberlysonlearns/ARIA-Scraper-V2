export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // Try multiple page variants to get the most data
    const urlsToTry = [url];

    // Add shop/products page if it looks like an ecommerce site
    const baseUrl = url.replace(/\/$/, '');
    urlsToTry.push(`${baseUrl}/shop`);
    urlsToTry.push(`${baseUrl}/products`);
    urlsToTry.push(`${baseUrl}/product-category/all-products`);

    let bestHtml = '';
    let bestTitle = '';
    let successUrl = url;

    for (const tryUrl of urlsToTry) {
      try {
        const response = await fetch(tryUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
          signal: AbortSignal.timeout(12000),
        });

        if (response.ok) {
          const html = await response.text();
          // Prefer pages with more product data
          if (html.includes('woocommerce') || html.includes('product') || html.length > bestHtml.length) {
            bestHtml = html;
            bestTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
            successUrl = tryUrl;
          }
        }
      } catch (e) {
        // Continue to next URL
      }
    }

    if (!bestHtml) {
      return res.status(200).json({ success: false, error: 'Could not access this website.', url });
    }

    const html = bestHtml;

    // ── PRODUCT EXTRACTION ──────────────────────────────────────────

    // Method 1: WooCommerce structured product data
    const products = [];

    // Extract product names from WooCommerce markup
    const wcProductRegex = /<(?:h2|h3)[^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>([^<]+)<\/(?:h2|h3)>/gi;
    let wcMatch;
    const wcNames = [];
    while ((wcMatch = wcProductRegex.exec(html)) !== null) {
      wcNames.push(wcMatch[1].trim());
    }

    // Extract prices from WooCommerce
    const wcPriceRegex = /<span[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
    const wcPriceHtml = html.match(wcPriceRegex) || [];
    const wcPrices = wcPriceHtml.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(p => p.length > 0 && p.length < 30);

    // Match product names with prices
    if (wcNames.length > 0) {
      wcNames.forEach((name, i) => {
        const price = wcPrices[i * 2] || wcPrices[i] || '';
        products.push(`${name}${price ? ' — ' + price : ''}`);
      });
    }

    // Method 2: JSON-LD structured data (most reliable)
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    const jsonProducts = [];
    jsonLdMatches.forEach(block => {
      try {
        const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ''));
        const items = Array.isArray(json) ? json : [json];
        items.forEach(item => {
          if (item['@type'] === 'Product' || item['@type'] === 'ItemList') {
            if (item.name && item.offers) {
              const price = item.offers.price || item.offers.lowPrice || '';
              const currency = item.offers.priceCurrency || '';
              jsonProducts.push(`${item.name} — ${price} ${currency}`.trim());
            }
            if (item.itemListElement) {
              item.itemListElement.forEach(el => {
                if (el.name) jsonProducts.push(el.name);
              });
            }
          }
        });
      } catch (e) {}
    });

    // Method 3: Generic price + nearby text extraction
    const cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

    // Find price patterns with surrounding context
    const priceContextRegex = /([A-Z][A-Za-z\s\-+()]{3,50})\s*[\n\r]*\s*(\$[\d,]+(?:\.\d{2})?\s*(?:CAD|USD|EUR)?)/g;
    const contextMatches = [];
    let ctxMatch;
    const cleanForContext = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    while ((ctxMatch = priceContextRegex.exec(cleanForContext)) !== null && contextMatches.length < 10) {
      const name = ctxMatch[1].trim();
      const price = ctxMatch[2].trim();
      if (name.length > 3 && name.length < 60 && !name.includes('{') && !name.includes('function')) {
        contextMatches.push(`${name} — ${price}`);
      }
    }

    // Method 4: All prices on the page
    const cleanText = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const allPrices = [...new Set((cleanText.match(/\$[\d,]+(?:\.\d{2})?\s*(?:CAD|USD|EUR|AUD)?/g) || []).map(p => p.trim()))].slice(0, 8);

    // Method 5: Product names from title tags and headings
    const headingRegex = /<h[1-4][^>]*>([^<]{3,80})<\/h[1-4]>/gi;
    const headings = [];
    let hMatch;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 8) {
      const text = hMatch[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 3 && text.length < 80 && !text.includes('{') && !text.includes('//') && !text.match(/^[\d\s$.,]+$/)) {
        headings.push(text);
      }
    }

    // Method 6: Extract sentences mentioning products/features/launches
    const sentences = cleanText.match(/[A-Z][^.!?]{20,200}[.!?]/g) || [];
    const productKeywords = ['launch', 'new', 'introduc', 'announc', 'now available', 'coming soon', 'update', 'release', 'feature', 'integrat'];
    const productSentences = sentences
      .filter(s => productKeywords.some(k => s.toLowerCase().includes(k)))
      .filter(s => !s.includes('function') && !s.includes('{') && !s.includes('var ') && s.length < 150)
      .slice(0, 4);

    // Meta description
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i)?.[1]?.trim() || '';

    // ── BUILD INSIGHTS ──────────────────────────────────────────────

    const insights = [];

    // Best product+price data — prioritize JSON-LD, then WooCommerce, then context
    const bestProducts = jsonProducts.length > 0 ? jsonProducts :
                         products.length > 0 ? products :
                         contextMatches.length > 0 ? contextMatches : [];

    if (bestProducts.length > 0) {
      insights.push({
        type: 'PRODUCTS & PRICING',
        tag: 'PRODUCTS',
        items: bestProducts.slice(0, 8),
      });
    } else if (allPrices.length > 0) {
      insights.push({
        type: 'PRICING DETECTED',
        tag: 'PRICING',
        items: allPrices,
      });
    }

    if (productSentences.length > 0) {
      insights.push({
        type: 'PRODUCT UPDATES',
        tag: 'UPDATES',
        items: productSentences,
      });
    }

    if (headings.length > 0) {
      insights.push({
        type: 'HOMEPAGE CONTENT',
        tag: 'HOMEPAGE',
        items: headings.slice(0, 6),
      });
    }

    if (metaDesc) {
      insights.push({
        type: 'SITE DESCRIPTION',
        tag: 'INFO',
        items: [metaDesc],
      });
    }

    return res.status(200).json({
      success: true,
      url: successUrl,
      title: bestTitle || 'No title found',
      metaDesc,
      insights,
      scrapedAt: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({
      success: false,
      error: error.message || 'Failed to fetch website',
      url,
    });
  }
}
