export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=10&t=year`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ARIA-Intelligence-Platform/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(200).json({ posts: [] });
    }

    const data = await response.json();
    const posts = (data?.data?.children || []).map(p => ({
      title: p.data.title,
      subreddit: p.data.subreddit,
      score: p.data.score,
      url: `https://reddit.com${p.data.permalink}`,
      created: new Date(p.data.created_utc * 1000).toLocaleDateString(),
      selftext: (p.data.selftext || '').slice(0, 400),
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ posts });
  } catch (e) {
    return res.status(200).json({ posts: [], error: e.message });
  }
}
