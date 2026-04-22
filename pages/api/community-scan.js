export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { competitorName, country, trustpilot } = req.body;
  if (!competitorName) return res.status(400).json({ error: 'competitorName required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'API key not configured.' });

  const tpContext = trustpilot
    ? `They have ${trustpilot.count} Trustpilot reviews averaging ${trustpilot.stars}/5 stars.`
    : 'No Trustpilot profile found.';

  const prompt = `You are a competitive intelligence analyst with deep knowledge of the research peptide vendor industry. Based on your training data, provide a detailed reputation analysis of "${competitorName}" (a research peptide vendor${country === 'CA' ? ' based in Canada' : ' based in the USA'}).

${tpContext}

Draw from your knowledge of Reddit (r/Peptides, r/PeptidesGrowth, r/semaglutide), SteroidSourceTalk, MesoRX, Eroids, Trustpilot, and other forums where this vendor has been discussed.

CRITICAL: Return ONLY a valid JSON object. No markdown, no backticks, no text before or after. Start with { and end with }.

{"summary":"3-4 sentence overall reputation summary based on community knowledge","sentimentScore":50,"watchFlag":false,"verdict":"one sentence actionable insight for a competitor monitoring this vendor","latestActivity":"most recent known community mention or activity","sources":["platform1","platform2"],"positiveReviews":[{"quote":"real or representative customer praise from forums/reviews","source":"platform","date":"approx date"},{"quote":"praise quote","source":"platform","date":"date"},{"quote":"praise quote","source":"platform","date":"date"}],"negativeReviews":[{"quote":"real or representative complaint from forums/reviews","source":"platform","date":"approx date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"},{"quote":"complaint","source":"platform","date":"date"}],"neutralObservations":[{"quote":"neutral observation","source":"platform","date":"date"},{"quote":"observation","source":"platform","date":"date"}],"mainIssues":["main recurring issue 1","main recurring issue 2","main recurring issue 3"],"suggestions":["what YOUR company should do differently to avoid this issue 1","suggestion 2","suggestion 3","suggestion 4"],"positive":"main praise in 10 words","negative":"main complaint in 10 words","neutral":"key observation in 10 words or null"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(200).json({ error: `API error ${response.status}: ${errText.slice(0, 200)}` });
    }

    const data = await response.json();
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
    if (!result) return res.status(200).json({ error: 'No structured data in response', raw: textBlock.slice(0, 400) });

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
