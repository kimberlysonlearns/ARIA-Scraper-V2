export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(200).json({ success: false, error: `Site returned status ${response.status}`, url });
    }

    const html = await response.text();

    // Strip all HTML tags and get clean text
    const cleanText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract title
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || 'No title found';

    // Extract meta description
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,200})["']/i)?.[1]?.trim() || '';

    // Extract clean prices from text
    const priceRegex = /\$\s*[\d,]+(?:\.\d{2})?(?:\s*\/?\s*(?:mo|month|yr|year|user|seat|per))?/gi;
    const rawPrices = cleanText.match(priceRegex) || [];
    const prices = [...new Set(rawPrices.map(p => p.trim()).filter(p => p.length < 30))].slice(0, 5);

    // Extract pricing plan names
    const planRegex = /\b(free|starter|basic|pro|professional|business|enterprise|premium|plus|growth|scale|team)\b[^.]{0,40}(?:plan|tier|package|pricing)?/gi;
    const rawPlans = cleanText.match(planRegex) || [];
    const plans = [...new Set(rawPlans.map(p => p.trim()).filter(p => p.length > 3 && p.length < 60))].slice(0, 4);

    // Combine pricing insights
    const pricingItems = [...prices, ...plans].filter(Boolean);

    // Extract product/feature mentions
    const productRegex = /\b(?:new|launch(?:ing|ed)?|introduc(?:ing|ed)?|announc(?:ing|ed)?|now available|coming soon|update|release|feature)[^.!?]{5,80}/gi;
    const rawProducts = cleanText.match(productRegex) || [];
    const products = [...new Set(rawProducts.map(p => p.trim()).filter(p => {
      const clean = p.replace(/[^a-zA-Z0-9\s$.,!?-]/g, '').trim();
      return clean.length > 10 && clean.length < 100;
    }))].slice(0, 4);

    // Extract headings for homepage content
    const headingRegex = /<h[1-3][^>]*>([^<]{3,80})<\/h[1-3]>/gi;
    const headings = [];
    let match;
    while ((match = headingRegex.exec(html)) !== null && headings.length < 6) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 3 && text.length < 100 && !text.includes('{') && !text.includes('function')) {
        headings.push(text);
      }
    }

    // Extract sentences mentioning key business topics
    const sentences = cleanText.match(/[A-Z][^.!?]{20,150}[.!?]/g) || [];
    const businessKeywords = ['price', 'cost', 'plan', 'feature', 'product', 'service', 'offer', 'solution', 'platform', 'tool', 'launch', 'new', 'update', 'integration', 'partner'];
    const relevantSentences = sentences
      .filter(s => businessKeywords.some(k => s.toLowerCase().includes(k)))
      .filter(s => !s.includes('function') && !s.includes('{') && !s.includes('var ') && !s.includes('const '))
      .slice(0, 4);

    // Build insights
    const insights = [];

    if (pricingItems.length > 0) {
      insights.push({ type: 'PRICING', tag: 'PRICING', items: pricingItems });
    } else if (relevantSentences.some(s => s.toLowerCase().includes('price') || s.toLowerCase().includes('cost') || s.toLowerCase().includes('plan'))) {
      const priceSentences = relevantSentences.filter(s => s.toLowerCase().includes('price') || s.toLowerCase().includes('cost') || s.toLowerCase().includes('plan')).slice(0, 3);
      if (priceSentences.length > 0) insights.push({ type: 'PRICING', tag: 'PRICING', items: priceSentences });
    }

    if (products.length > 0) {
      insights.push({ type: 'PRODUCTS & FEATURES', tag: 'PRODUCT', items: products });
    } else if (relevantSentences.length > 0) {
      insights.push({ type: 'KEY MENTIONS', tag: 'PRODUCT', items: relevantSentences.slice(0, 3) });
    }

    if (headings.length > 0) {
      insights.push({ type: 'HOMEPAGE CONTENT', tag: 'HOMEPAGE', items: headings.slice(0, 5) });
    }

    if (metaDesc) {
      insights.push({ type: 'SITE DESCRIPTION', tag: 'INFO', items: [metaDesc] });
    }

    return res.status(200).json({
      success: true,
      url,
      title,
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
