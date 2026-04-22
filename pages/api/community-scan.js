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

Search Reddit (r/Peptides, r/PeptidesGrowth, r/semaglutide, r/researchchemicals), SteroidSourceTalk, MesoRX, Eroids, Trustpilot, and any other relevant forums or review sites. Find as many actual customer quotes as possible, especially negative ones.

CRITICAL: You MUST return ONLY a valid JSON object. No markdown, no backticks, no explanation, no text before or after. Your entire response must start with { and end with }. Do not wrap in code blocks.

Use this exact structure:
{"summary":"3-4 sentence overall reputation summary","sentimentScore":50,"watchFlag":false,"verdict":"one sentence actionable insight for a competitor","latestActivity":"most recent mention with approximate date","sources":["platform1","platform2"],"positiveReviews":[{"quote":"real customer quote","source":"platform","date":"approx date"},{"quote":"quote","source":"platform","date":"date"},{"quote":"quote","source":"platform","date":"date"}],"negativeReviews":[{"quote":"real complaint quote","source":"platform","date":"approx date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"}],"neutralObservations":[{"quote":"neutral observation","source":"platform","date":"date"},{"quote":"observation","source":"platform","date":"date"}],"mainIssues":["main recurring issue 1","main recurring issue 2","main recurring issue 3"],"suggestions":["what YOUR company should do differently 1","suggestion 2","suggestion 3","suggestion 4"],"positive":"main praise in 10 words","negative":"main complaint in 10 words","neutral":"key observation in 10 words or null"}`;

  const callAPI = async () => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
    }
    return response.json();
  };

  const parseResult = (data) => {
    const textBlock = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let result = null;
    try { result = JSON.parse(textBlock.trim()); } catch(e) {}
    if (!result) {
      const start = textBlock.indexOf('{');
      const end = textBlock.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { result = JSON.parse(textBlock.slice(start, end + 1)); } catch(e) {}
      }
    }
    if (!result) {
      const stripped = textBlock.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try { result = JSON.parse(stripped); } catch(e) {}
    }
    return result;
  };

  try {
    // First attempt
    let data = await callAPI();
    let result = parseResult(data);

    // Retry once if parsing failed
    if (!result) {
      await new Promise(r => setTimeout(r, 3000));
      data = await callAPI();
      result = parseResult(data);
    }

    if (!result) {
      const textBlock = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return res.status(200).json({ error: 'No structured data in response', raw: textBlock.slice(0, 400) });
    }

    // Ensure required fields
    if (!result.positiveReviews) result.positiveReviews = [];
    if (!result.negativeReviews) result.negativeReviews = [];
    if (!result.neutralObservations) result.neutralObservations = [];
    if (!result.sources) result.sources = [];
    if (!result.mainIssues) result.mainIssues = [];
    if (!result.suggestions) result.suggestions = [];
    if (typeof result.sentimentScore !== 'number') result.sentimentScore = 50;
    if (typeof result.watchFlag !== 'boolean') result.watchFlag = false;

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
}
