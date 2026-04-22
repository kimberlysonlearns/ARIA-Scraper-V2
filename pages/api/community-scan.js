export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { competitorName, country, trustpilot } = req.body;
  if (!competitorName) return res.status(400).json({ error: 'competitorName required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'API key not configured.' });

  const tpContext = trustpilot
    ? `They have ${trustpilot.count} Trustpilot reviews averaging ${trustpilot.stars}/5 stars.`
    : 'No Trustpilot profile found.';

  const prompt = `You are a competitive intelligence analyst. Search the web thoroughly for customer reviews, forum posts, Reddit discussions, and public mentions of "${competitorName}" (a research peptide vendor${country === 'CA' ? ' based in Canada' : ' based in the USA'}).

${tpContext}

Search Reddit (r/Peptides, r/PeptidesGrowth, r/semaglutide, r/researchchemicals), SteroidSourceTalk, MesoRX, Eroids, Trustpilot, and any other relevant forums or review sites. Find actual customer quotes where possible.

You MUST return ONLY a valid JSON object. No markdown, no backticks, no text before or after the JSON. Start your response with { and end with }.

{"summary":"3-4 sentence overall reputation summary","sentimentScore":50,"watchFlag":false,"verdict":"one sentence actionable insight","latestActivity":"most recent mention with approximate date","sources":["platform1","platform2"],"positiveReviews":[{"quote":"customer quote","source":"platform","date":"approx date"},{"quote":"another quote","source":"platform","date":"date"}],"negativeReviews":[{"quote":"complaint quote","source":"platform","date":"approx date"},{"quote":"another complaint","source":"platform","date":"date"}],"neutralObservations":[{"quote":"neutral observation","source":"platform","date":"approx date"}],"positive":"main praise in 10 words","negative":"main complaint in 10 words","neutral":"key observation in 10 words"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(200).json({ error: `API error ${response.status}: ${errText.slice(0, 200)}` });
    }

    const data = await response.json();
    const textBlock = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    // Try multiple JSON extraction strategies
    let result = null;

    // Strategy 1: direct parse
    try { result = JSON.parse(textBlock.trim()); } catch(e) {}

    // Strategy 2: find first { to last }
    if (!result) {
      const start = textBlock.indexOf('{');
      const end = textBlock.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { result = JSON.parse(textBlock.slice(start, end + 1)); } catch(e) {}
      }
    }

    // Strategy 3: strip markdown fences
    if (!result) {
      const stripped = textBlock.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try { result = JSON.parse(stripped); } catch(e) {}
    }

    if (!result) {
      return res.status(200).json({ error: 'No structured data in response', raw: textBlock.slice(0, 400) });
    }

    // Ensure required arrays exist
    if (!result.positiveReviews) result.positiveReviews = [];
    if (!result.negativeReviews) result.negativeReviews = [];
    if (!result.neutralObservations) result.neutralObservations = [];
    if (!result.sources) result.sources = [];
    if (typeof result.sentimentScore !== 'number') result.sentimentScore = 50;
    if (typeof result.watchFlag !== 'boolean') result.watchFlag = false;

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
}
