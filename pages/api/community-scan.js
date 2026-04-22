export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { competitorName, country, trustpilot } = req.body;
  if (!competitorName) return res.status(400).json({ error: 'competitorName required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Vercel environment variables.' });

  const tpContext = trustpilot
    ? `They have ${trustpilot.count} Trustpilot reviews averaging ${trustpilot.stars}/5 stars.`
    : 'No Trustpilot profile found.';

  const prompt = `You are a competitive intelligence analyst. Search the web for customer reviews, forum posts, Reddit discussions, and any public mentions of "${competitorName}" (a research peptide vendor${country === 'CA' ? ' based in Canada' : ' based in the USA'}).

${tpContext}

Search Reddit (r/Peptides, r/PeptidesGrowth, r/semaglutide, r/researchchemicals), SteroidSourceTalk, MesoRX, Eroids, Trustpilot, and any other relevant forums or review sites.

Return ONLY a valid JSON object with no markdown, no backticks, no explanation:
{"summary":"2-3 sentence overall reputation summary based on what you find","positive":"main praise customers give (10 words max)","negative":"main complaint customers give (10 words max)","neutral":"notable neutral observation (10 words max) or null","sources":["list","of","platforms","where","mentions","found"],"sentimentScore":0-100,"watchFlag":true or false,"verdict":"one sentence actionable insight for a competitor monitoring this vendor","latestActivity":"description of most recent mention found with approximate date"}`;

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
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
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
    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ error: 'No structured data in response', raw: textBlock.slice(0, 300) });

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ result });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
}
