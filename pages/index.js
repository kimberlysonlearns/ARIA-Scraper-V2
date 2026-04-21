import { useState, useEffect } from 'react';

// ── Category engine ──────────────────────────────────────────────────
function categorize(name) {
  const n = name.toLowerCase();
  if (/semaglutide|tirzepatide|retatrutide|cagrilintide|orforglipron|survodutide|glp|ozempic|wegovy|mounjaro|zepbound|fat|weight|slim|lean|burn/.test(n)) return 'Weight Loss';
  if (/mk.?677|ipamorelin|ghrp|cjc|tesamorelin|hgh|gh |growth hormone|igf|sermorelin|hexarelin/.test(n)) return 'Muscle Growth';
  if (/bpc.?157|tb.?500|healing|repair|bpc|pentadeca|injury|recovery|ghk|glow|blend/.test(n)) return 'Recovery / Healing';
  if (/epitalon|epithalon|anti.?ag|longevity|nad|niagen|ghk.?cu|copper|telomer/.test(n)) return 'Anti-Aging';
  if (/selank|semax|cerebrolysin|nootropic|cogni|focus|brain|modafinil|peptide p/.test(n)) return 'Cognitive / Focus';
  if (/thymosin|thymulin|mots.?c|ss.?31|ovagen|cartalax|chonluten|cardiogen|vilon|aod|fragment|liraglutide|tadalafil|sildenafil|testosterone|enclomiphene|hcg|dhea|melanotan|pt.?141|glutathione|nad|l.?carnitine|amino/.test(n)) return 'Hormonal / Metabolic';
  if (/bac water|bacteriostatic|water|solvent|diluent/.test(n)) return 'Supplies';
  return 'Other';
}

const CATEGORY_COLORS = {
  'Weight Loss':          { bg: '#1a2a1a', border: '#4a9a4a', text: '#7acc7a' },
  'Muscle Growth':        { bg: '#1a1a2a', border: '#4a4a9a', text: '#7a7acc' },
  'Recovery / Healing':   { bg: '#2a1a1a', border: '#9a4a4a', text: '#cc7a7a' },
  'Anti-Aging':           { bg: '#2a2a1a', border: '#9a9a4a', text: '#cccc7a' },
  'Cognitive / Focus':    { bg: '#1a2a2a', border: '#4a9a9a', text: '#7acccc' },
  'Hormonal / Metabolic': { bg: '#2a1a2a', border: '#9a4a9a', text: '#cc7acc' },
  'Supplies':             { bg: '#222', border: '#555', text: '#aaa' },
  'Other':                { bg: '#222', border: '#555', text: '#aaa' },
};

function parsePrice(str) {
  if (!str) return null;
  const m = String(str).match(/[\d,]+(?:\.\d{2})?/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : null;
}

// ── Build product comparison map ─────────────────────────────────────
function buildComparison(competitors, scrapeResults) {
  const map = {};
  competitors.forEach(c => {
    const result = scrapeResults[c.id];
    if (!result?.success) return;
    const items = result.insights?.[0]?.items || [];
    items.forEach(item => {
      const parts = item.split(' — ');
      const name = parts[0]?.trim();
      if (!name || name.length < 2) return;
      const pricePart = parts.find(p => p.includes('$'));
      const price = pricePart?.match(/\$[\d,.]+/)?.[0] || '';
      const priceVal = parsePrice(price);
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!map[key]) map[key] = { name, category: categorize(name), sites: {} };
      if (price) map[key].sites[c.name] = { price, value: priceVal };
    });
  });
  return Object.values(map).filter(p => Object.keys(p.sites).length > 0);
}

// ── Score a competitor 0–100 ─────────────────────────────────────────
function scoreCompetitor(competitorName, comparison, totalCompetitors) {
  if (!comparison.length) return 0;
  // Coverage score (40pts): how many products do they carry vs total unique products
  const coverage = comparison.filter(p => p.sites[competitorName]).length;
  const coverageScore = Math.round((coverage / comparison.length) * 40);
  // Pricing score (60pts): how often are they the cheapest option
  let winsCount = 0;
  let eligibleCount = 0;
  comparison.forEach(p => {
    if (!p.sites[competitorName]) return;
    const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
    if (prices.length < 2) return;
    eligibleCount++;
    const minPrice = Math.min(...prices);
    if (p.sites[competitorName].value <= minPrice) winsCount++;
  });
  const pricingScore = eligibleCount > 0 ? Math.round((winsCount / eligibleCount) * 60) : 0;
  return coverageScore + pricingScore;
}

// ── Detect price changes between scans ───────────────────────────────
function detectChanges(prevResults, currentResults, competitors) {
  const changes = [];
  competitors.forEach(c => {
    const prev = prevResults[c.id];
    const curr = currentResults[c.id];
    if (!prev?.success || !curr?.success) return;
    const prevItems = {};
    (prev.insights?.[0]?.items || []).forEach(item => {
      const parts = item.split(' — ');
      const name = parts[0]?.trim();
      const pricePart = parts.find(p => p.includes('$'));
      if (name && pricePart) prevItems[name.toLowerCase()] = { name, price: pricePart, value: parsePrice(pricePart) };
    });
    (curr.insights?.[0]?.items || []).forEach(item => {
      const parts = item.split(' — ');
      const name = parts[0]?.trim();
      const pricePart = parts.find(p => p.includes('$'));
      if (!name || !pricePart) return;
      const key = name.toLowerCase();
      const currVal = parsePrice(pricePart);
      const prevEntry = prevItems[key];
      if (!prevEntry || !prevEntry.value || !currVal) return;
      if (Math.abs(currVal - prevEntry.value) >= 0.01) {
        const pct = Math.round(((currVal - prevEntry.value) / prevEntry.value) * 100);
        changes.push({
          competitor: c.name,
          product: name,
          from: prevEntry.price,
          to: pricePart,
          fromVal: prevEntry.value,
          toVal: currVal,
          pct,
          direction: currVal < prevEntry.value ? 'down' : 'up',
          detectedAt: curr.scrapedAt,
        });
      }
    });
  });
  return changes;
}

export default function Home() {
  const [activePage, setActivePage] = useState('dashboard');
  const [competitors, setCompetitors] = useState([]);
  const [scrapeResults, setScrapeResults] = useState({});
  const [prevScrapeResults, setPrevScrapeResults] = useState({});
  const [priceChanges, setPriceChanges] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', website: '' });
  const [scraping, setScraping] = useState({});
  const [analysisFilter, setAnalysisFilter] = useState('ALL');
  const [analysisSortBy, setAnalysisSortBy] = useState('name');

  // ── Persist to localStorage ──────────────────────────────────────
  useEffect(() => {
    try {
      const c = localStorage.getItem('aria_competitors'); if (c) setCompetitors(JSON.parse(c));
      const r = localStorage.getItem('aria_results'); if (r) setScrapeResults(JSON.parse(r));
      const p = localStorage.getItem('aria_prev_results'); if (p) setPrevScrapeResults(JSON.parse(p));
      const ch = localStorage.getItem('aria_changes'); if (ch) setPriceChanges(JSON.parse(ch));
    } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem('aria_competitors', JSON.stringify(competitors)); } catch {} }, [competitors]);
  useEffect(() => { try { localStorage.setItem('aria_results', JSON.stringify(scrapeResults)); } catch {} }, [scrapeResults]);
  useEffect(() => { try { localStorage.setItem('aria_prev_results', JSON.stringify(prevScrapeResults)); } catch {} }, [prevScrapeResults]);
  useEffect(() => { try { localStorage.setItem('aria_changes', JSON.stringify(priceChanges)); } catch {} }, [priceChanges]);

  const navItems = [
    { id: 'dashboard', label: 'DASHBOARD' },
    { id: 'competitors', label: 'COMPETITORS' },
    { id: 'analysis', label: 'ANALYSIS' },
    { id: 'marketintel', label: 'MARKET INTEL' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const handleAddCompetitor = () => {
    if (!form.name.trim()) { alert('Please enter a company name'); return; }
    if (!form.website.trim()) { alert('Please enter a website URL'); return; }
    let website = form.website.trim();
    if (!website.startsWith('http')) website = 'https://' + website;
    setCompetitors(prev => [...prev, { id: Date.now(), name: form.name.toUpperCase(), website, items: 0 }]);
    setForm({ name: '', website: '' });
    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this competitor?')) return;
    setCompetitors(prev => prev.filter(c => c.id !== id));
    setScrapeResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPrevScrapeResults(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleScrape = async (competitor) => {
    if (!competitor.website || competitor.website.includes('example.com')) {
      alert('Please add a real website URL first.'); return;
    }
    setScraping(prev => ({ ...prev, [competitor.id]: true }));
    try {
      const r = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: competitor.website }),
      });
      const data = await r.json();
      if (data.success) {
        // Save current as previous before overwriting
        setScrapeResults(prev => {
          const oldResult = prev[competitor.id];
          if (oldResult?.success) {
            setPrevScrapeResults(pp => ({ ...pp, [competitor.id]: oldResult }));
          }
          const updated = { ...prev, [competitor.id]: { ...data, competitorName: competitor.name } };
          // Detect changes
          if (oldResult?.success) {
            const newChanges = detectChanges(
              { [competitor.id]: oldResult },
              { [competitor.id]: { ...data, competitorName: competitor.name } },
              [competitor]
            );
            if (newChanges.length > 0) {
              setPriceChanges(pc => [...newChanges, ...pc].slice(0, 100));
            }
          }
          return updated;
        });
        setCompetitors(prev => prev.map(c => c.id === competitor.id ? { ...c, items: (c.items || 0) + 1 } : c));
      } else {
        setScrapeResults(prev => ({ ...prev, [competitor.id]: { ...data, competitorName: competitor.name } }));
      }
    } catch {
      setScrapeResults(prev => ({ ...prev, [competitor.id]: { success: false, error: 'Scan failed. Check URL and try again.' } }));
    }
    setScraping(prev => ({ ...prev, [competitor.id]: false }));
  };

  const handleScrapeAll = async () => {
    const real = competitors.filter(c => c.website && !c.website.includes('example.com'));
    if (!real.length) { alert('Add real competitor URLs first.'); return; }
    for (const c of real) await handleScrape(c);
  };

  const fmt = iso => iso ? new Date(iso).toLocaleString() : '';
  const comparison = buildComparison(competitors, scrapeResults);
  const allPrices = comparison.flatMap(p => Object.values(p.sites).map(s => s.value).filter(Boolean));

  // Cheapest site by avg price
  const cheapestSite = (() => {
    const totals = {};
    comparison.forEach(p => Object.entries(p.sites).forEach(([site, { value }]) => {
      if (value) totals[site] = (totals[site] || []).concat(value);
    }));
    let best = null, bestAvg = Infinity;
    Object.entries(totals).forEach(([site, prices]) => {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      if (avg < bestAvg) { bestAvg = avg; best = site; }
    });
    return best;
  })();

  // ── Export functions ─────────────────────────────────────────────
  const exportCSV = () => {
    const allSites = [...new Set(comparison.flatMap(p => Object.keys(p.sites)))];
    const headers = ['Product', 'Category', ...allSites, 'Lowest Price', 'Highest Price', 'Avg Price'];
    const rows = comparison.map(p => {
      const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
      const low = prices.length ? `$${Math.min(...prices).toFixed(2)}` : '';
      const high = prices.length ? `$${Math.max(...prices).toFixed(2)}` : '';
      const avg = prices.length ? `$${(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2)}` : '';
      const sitePrices = allSites.map(site => p.sites[site]?.price || '—');
      return [p.name, p.category, ...sitePrices, low, high, avg];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ARIA_Analysis_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportHTML = () => {
    const allSites = [...new Set(comparison.flatMap(p => Object.keys(p.sites)))];
    const date = new Date().toLocaleDateString();
    const priceChangesHTML = priceChanges.length > 0 ? `
      <h2>Price Changes Detected</h2>
      <table><tr><th>Product</th><th>Competitor</th><th>From</th><th>To</th><th>Change</th><th>Date</th></tr>
      ${priceChanges.map(ch => `<tr><td>${ch.product}</td><td>${ch.competitor}</td><td style="text-decoration:line-through">${ch.from}</td><td style="color:${ch.direction==='down'?'green':'red'};font-weight:bold">${ch.to}</td><td style="color:${ch.direction==='down'?'green':'red'}">${ch.direction==='down'?'↓':'↑'}${Math.abs(ch.pct)}%</td><td>${ch.detectedAt?new Date(ch.detectedAt).toLocaleDateString():''}</td></tr>`).join('')}
      </table>` : '';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>ARIA Analysis Report — ${date}</title>
<style>
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#111;padding:40px;max-width:1100px;margin:0 auto}
  h1{font-size:28px;font-weight:300;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #f5e6e0;padding-bottom:12px;margin-bottom:8px}
  .meta{font-size:12px;color:#999;margin-bottom:32px}
  h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#444;margin:28px 0 12px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
  .stat{background:#f8f8f8;border-radius:8px;padding:16px}
  .stat-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px}
  .stat-value{font-size:22px;font-weight:300;color:#111}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px}
  th{background:#1a1a1a;color:#f5e6e0;padding:10px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600}
  td{padding:9px 12px;border-bottom:1px solid #f0f0f0}
  tr:nth-child(even) td{background:#fafafa}
  .cat{font-size:10px;padding:2px 8px;border-radius:99px;background:#eee;color:#555}
  .low{color:#2a7a2a;font-weight:600}
  .insight{padding:12px 16px;border-radius:6px;margin-bottom:10px;font-size:13px}
  .insight.green{background:#f0f9f0;border-left:3px solid #4a9a4a;color:#2a5a2a}
  .insight.red{background:#fdf0f0;border-left:3px solid #9a4a4a;color:#5a2a2a}
  .insight.blue{background:#f0f0f9;border-left:3px solid #4a4a9a;color:#2a2a5a}
  .footer{margin-top:40px;font-size:11px;color:#ccc;border-top:1px solid #eee;padding-top:16px}
</style></head><body>
<h1>ARIA Competitive Analysis Report</h1>
<div class="meta">Generated: ${date} · ${comparison.length} products · ${allSites.length} competitors</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Cheapest Overall</div><div class="stat-value" style="font-size:16px;color:#2a7a2a">${cheapestSite||'—'}</div></div>
  <div class="stat"><div class="stat-label">Products Tracked</div><div class="stat-value">${comparison.length}</div></div>
  <div class="stat"><div class="stat-label">Price Range</div><div class="stat-value" style="font-size:16px">${allPrices.length?`$${Math.min(...allPrices).toFixed(2)}–$${Math.max(...allPrices).toFixed(2)}`:'—'}</div></div>
  <div class="stat"><div class="stat-label">Price Changes</div><div class="stat-value" style="color:${priceChanges.length>0?'#cc7700':'#111'}">${priceChanges.length}</div></div>
</div>
<h2>Key Insights</h2>
${cheapestSite?`<div class="insight green"><strong>Cheapest overall:</strong> ${cheapestSite} has the lowest average pricing across all tracked products.</div>`:''}
${(() => {
  const overpriced = comparison.filter(p => {
    const prices = Object.values(p.sites).map(s=>s.value).filter(Boolean);
    if (prices.length < 2) return false;
    const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
    return Math.max(...prices) > avg * 1.3;
  });
  return overpriced.length > 0 ? `<div class="insight red"><strong>Price gaps detected:</strong> ${overpriced.slice(0,3).map(p=>p.name).join(', ')} show 30%+ price variation across sites.</div>` : '';
})()}
${(() => {
  const cats = {};
  comparison.forEach(p => { cats[p.category] = (cats[p.category]||0)+1; });
  const top = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  return top ? `<div class="insight blue"><strong>Most competitive category:</strong> ${top[0]} with ${top[1]} products tracked.</div>` : '';
})()}
${priceChangesHTML}
<h2>Product Comparison Table</h2>
<table>
<tr><th>Product</th><th>Category</th>${allSites.map(s=>`<th>${s}</th>`).join('')}<th>Lowest</th><th>Highest</th><th>Avg</th></tr>
${comparison.sort((a,b)=>a.name.localeCompare(b.name)).map(p => {
  const prices = Object.values(p.sites).map(s=>s.value).filter(Boolean);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const low = prices.length ? `$${Math.min(...prices).toFixed(2)}` : '—';
  const high = prices.length ? `$${Math.max(...prices).toFixed(2)}` : '—';
  const avg = prices.length ? `$${(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2)}` : '—';
  return `<tr><td>${p.name}</td><td><span class="cat">${p.category}</span></td>${allSites.map(site => {
    const sd = p.sites[site];
    const isLow = sd?.value && sd.value === minPrice && prices.length > 1;
    return `<td${isLow?' class="low"':''}>${sd ? sd.price+(isLow?' ★':'') : '—'}</td>`;
  }).join('')}<td class="low">${low}</td><td>${high}</td><td>${avg}</td></tr>`;
}).join('')}
</table>
<div class="footer">ARIA Competitive Intelligence Platform · aria-scraper-v2.vercel.app · Report generated ${date}</div>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ARIA_Analysis_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Ranked competitors
  const rankedCompetitors = [...competitors]
    .filter(c => scrapeResults[c.id]?.success)
    .map(c => ({
      ...c,
      score: scoreCompetitor(c.name, comparison, competitors.length),
      productCount: (scrapeResults[c.id]?.insights?.[0]?.items || []).length,
      lastScan: scrapeResults[c.id]?.scrapedAt,
    }))
    .sort((a, b) => b.score - a.score);

  const unscannedCompetitors = competitors.filter(c => !scrapeResults[c.id]?.success);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Century Gothic', 'Trebuchet MS', sans-serif", background: '#111', color: '#fff' }}>

      {/* Sidebar */}
      <style>{`
        .nav-btn { transition: background 0.15s, color 0.15s; }
        .nav-btn:hover { background: rgba(232,168,184,0.18) !important; color: #f5c8d4 !important; }
        .nav-btn.active { background: #f5e6e0 !important; color: #181818 !important; }
      `}</style>
      <aside style={{ width: '240px', minWidth: '240px', background: '#141414', padding: '0', borderRight: '1px solid #252525', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', flexShrink: 0 }}>

        {/* Logo block */}
        <div style={{ padding: '28px 20px 22px', borderBottom: '1px solid #222' }}>
          <svg width="200" height="100" viewBox="0 0 200 100" fill="none">
            <rect x="4" y="48" width="14" height="24" rx="2.5" fill="#f5e6e0" opacity="0.2"/>
            <rect x="22" y="30" width="14" height="42" rx="2.5" fill="#e8a8b8" opacity="0.5"/>
            <rect x="40" y="10" width="14" height="62" rx="2.5" fill="#e8a8b8"/>
            <rect x="58" y="10" width="14" height="62" rx="2.5" fill="#e8a8b8" opacity="0.75"/>
            <rect x="76" y="30" width="14" height="42" rx="2.5" fill="#e8a8b8" opacity="0.5"/>
            <rect x="94" y="48" width="14" height="24" rx="2.5" fill="#f5e6e0" opacity="0.2"/>
            <rect x="30" y="36" width="58" height="9" rx="2.5" fill="#f5e6e0" opacity="0.28"/>
            <text x="118" y="52" fontFamily="'Century Gothic', 'Trebuchet MS', sans-serif" fontSize="34" fontWeight="600" fill="#f5e6e0" letterSpacing="5">ARIA</text>
            <text x="118" y="67" fontFamily="'Century Gothic', 'Trebuchet MS', sans-serif" fontSize="9.5" fill="#999" letterSpacing="0.3">Artificial Research Intelligent Agent</text>
          </svg>
        </div>

        {/* Nav */}
        <div style={{ padding: '16px 12px', flex: 1 }}>
          <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '8px', paddingLeft: '8px' }}>Navigation</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`nav-btn${activePage === item.id ? ' active' : ''}`}
                style={{ padding: '10px 12px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '14px', textAlign: 'left', fontFamily: 'inherit', background: activePage === item.id ? '#f5e6e0' : 'transparent', color: activePage === item.id ? '#181818' : '#bbb', fontWeight: activePage === item.id ? '600' : '400', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                {item.label}
                {item.id === 'analysis' && priceChanges.length > 0 && (
                  <span style={{ background: '#cc7a7a', color: '#fff', borderRadius: '99px', padding: '1px 7px', fontSize: '9px', fontWeight: '700' }}>{priceChanges.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #222' }}>
          <div style={{ fontSize: '10px', color: '#555', lineHeight: '1.7' }}>
            <div style={{ color: '#888', fontWeight: '500', marginBottom: '2px' }}>ARIA Intelligence Platform</div>
            <div>Competitive pricing &amp; market analysis</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '28px', overflowX: 'hidden' }}>

        {/* ── DASHBOARD ──────────────────────────────────────────── */}
        {activePage === 'dashboard' && (
          <div>
            <h1 style={H1}>DASHBOARD</h1>
            <p style={SUB}>Competitive pricing intelligence at a glance</p>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              {[
                { label: 'Competitors', value: competitors.length },
                { label: 'Products Tracked', value: comparison.length },
                { label: 'Price Changes', value: priceChanges.length },
                { label: 'Cheapest Site', value: cheapestSite || '—', small: true },
              ].map((s, i) => (
                <div key={i} style={STAT_CARD}>
                  <div style={STAT_LABEL}>{s.label}</div>
                  <div style={{ fontSize: s.small ? '14px' : '28px', fontWeight: s.small ? '500' : '400', color: '#f5e6e0', marginTop: '6px' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Price change banner */}
            {priceChanges.length > 0 && (
              <div style={{ background: '#1e1a14', border: '1px solid #7a5a2a', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ fontSize: '14px', color: '#ccaa7a', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                  Recent Price Changes ({priceChanges.length})
                </div>
                {priceChanges.slice(0, 5).map((ch, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < Math.min(priceChanges.length, 5) - 1 ? '1px solid #2a2a1a' : 'none' }}>
                    <div>
                      <span style={{ fontSize: '14px', color: '#ddd' }}>{ch.product}</span>
                      <span style={{ fontSize: '14px', color: '#aaa', marginLeft: '8px' }}>{ch.competitor}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', color: '#aaa', textDecoration: 'line-through' }}>{ch.from}</span>
                      <span style={{ fontSize: '14px', color: ch.direction === 'down' ? '#7acc7a' : '#cc7a7a', fontWeight: '600' }}>
                        {ch.to} {ch.direction === 'down' ? '↓' : '↑'} {Math.abs(ch.pct)}%
                      </span>
                    </div>
                  </div>
                ))}
                {priceChanges.length > 5 && (
                  <button onClick={() => setActivePage('analysis')} style={{ marginTop: '10px', fontSize: '14px', color: '#ccaa7a', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    View all {priceChanges.length} changes in Analysis →
                  </button>
                )}
              </div>
            )}

            {/* Competitor rankings */}
            {competitors.length === 0 ? (
              <div style={CARD}>
                <h3 style={H3}>GET STARTED</h3>
                <ol style={{ marginLeft: '20px', color: '#aaa', fontSize: '14px', lineHeight: '2.4' }}>
                  <li>Go to <strong style={{ color: '#f5e6e0' }}>Competitors</strong> → Add competitor URLs</li>
                  <li>Click <strong style={{ color: '#f5e6e0' }}>CHECK NOW</strong> to scan each site</li>
                  <li>Come back here to see rankings and price changes</li>
                </ol>
              </div>
            ) : (
              <div style={CARD}>
                <h3 style={H3}>COMPETITOR RANKINGS</h3>
                <p style={{ fontSize: '14px', color: '#777', marginBottom: '14px' }}>Scored on product coverage (40pts) + lowest pricing (60pts)</p>

                {/* Ranked (scanned) */}
                {rankedCompetitors.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: i % 2 === 0 ? '#111' : '#161616', borderRadius: '6px', marginBottom: '4px' }}>
                    {/* Rank */}
                    <div style={{ minWidth: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? '#3a3020' : '#1a1a1a', border: `1px solid ${i === 0 ? '#ccaa7a' : '#2a2a2a'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '700', color: i === 0 ? '#ccaa7a' : '#555', flexShrink: 0 }}>
                      #{i + 1}
                    </div>
                    {/* Name + link */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: '#ddd', fontWeight: '500' }}>{c.name}</div>
                      <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#888', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.website}
                      </a>
                    </div>
                    {/* Products */}
                    <div style={{ textAlign: 'center', minWidth: '60px' }}>
                      <div style={{ fontSize: '16px', color: '#ccc', fontWeight: '500' }}>{c.productCount}</div>
                      <div style={{ fontSize: '9px', color: '#777', textTransform: 'uppercase' }}>products</div>
                    </div>
                    {/* Score bar */}
                    <div style={{ minWidth: '100px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '9px', color: '#777', textTransform: 'uppercase' }}>Score</span>
                        <span style={{ fontSize: '14px', color: c.score >= 70 ? '#7acc7a' : c.score >= 40 ? '#cccc7a' : '#cc7a7a', fontWeight: '600' }}>{c.score}/100</span>
                      </div>
                      <div style={{ height: '4px', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: c.score >= 70 ? '#4a9a4a' : c.score >= 40 ? '#9a9a4a' : '#9a4a4a', borderRadius: '2px', transition: 'width 0.3s' }} />
                      </div>
                    </div>
                    {/* Cheapest badge */}
                    {cheapestSite === c.name && (
                      <div style={{ fontSize: '9px', padding: '3px 8px', background: '#1a2a1a', border: '1px solid #4a9a4a', borderRadius: '99px', color: '#7acc7a', whiteSpace: 'nowrap' }}>CHEAPEST</div>
                    )}
                    {/* Last scan */}
                    <div style={{ fontSize: '9px', color: '#777', minWidth: '70px', textAlign: 'right' }}>
                      {c.lastScan ? new Date(c.lastScan).toLocaleDateString() : ''}
                    </div>
                  </div>
                ))}

                {/* Unscanned */}
                {unscannedCompetitors.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#111', borderRadius: '6px', marginBottom: '4px', opacity: 0.5 }}>
                    <div style={{ minWidth: '28px', height: '28px', borderRadius: '50%', background: '#1a1a1a', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#777', flexShrink: 0 }}>—</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: '#aaa' }}>{c.name}</div>
                      <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#777', textDecoration: 'none' }}>{c.website}</a>
                    </div>
                    <div style={{ fontSize: '14px', color: '#777' }}>Not scanned yet</div>
                    <button onClick={() => { setActivePage('competitors'); }} style={{ fontSize: '10px', padding: '4px 10px', background: 'transparent', border: '1px solid #333', borderRadius: '4px', color: '#aaa', cursor: 'pointer', fontFamily: 'inherit' }}>SCAN</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COMPETITORS ────────────────────────────────────────── */}
        {activePage === 'competitors' && (
          <div>
            <h1 style={H1}>COMPETITORS</h1>
            <p style={SUB}>Manage and scan your tracked competitors</p>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <button style={BTN_PRIMARY} onClick={() => setShowModal(true)}>+ ADD COMPETITOR</button>
              <button style={BTN} onClick={handleScrapeAll}>SCAN ALL</button>
            </div>

            {competitors.length === 0 && (
              <div style={CARD}><p style={P}>No competitors yet. Click "+ Add Competitor" to get started.</p></div>
            )}

            <div style={{ display: 'grid', gap: '12px' }}>
              {competitors.map(c => {
                const result = scrapeResults[c.id];
                const products = result?.insights?.[0]?.items || [];
                const competitorChanges = priceChanges.filter(ch => ch.competitor === c.name);
                return (
                  <div key={c.id} style={CARD}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ ...H3, margin: 0 }}>{c.name}</h3>
                        <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#888', textDecoration: 'none' }}>{c.website}</a>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {competitorChanges.length > 0 && (
                          <span style={{ fontSize: '10px', padding: '3px 8px', background: '#1e1a14', border: '1px solid #7a5a2a', borderRadius: '99px', color: '#ccaa7a' }}>
                            {competitorChanges.length} price change{competitorChanges.length > 1 ? 's' : ''}
                          </span>
                        )}
                        <button style={{ ...BTN_PRIMARY, padding: '7px 14px', fontSize: '14px', opacity: scraping[c.id] ? 0.6 : 1 }} onClick={() => handleScrape(c)} disabled={scraping[c.id]}>
                          {scraping[c.id] ? 'SCANNING...' : 'CHECK NOW'}
                        </button>
                        <button style={{ ...BTN, padding: '7px 14px', fontSize: '14px' }} onClick={() => handleDelete(c.id)}>DELETE</button>
                      </div>
                    </div>

                    {scraping[c.id] && <p style={{ fontSize: '14px', color: '#f5e6e0' }}>Scanning {c.website}...</p>}

                    {result && !scraping[c.id] && (
                      result.success ? (
                        <div>
                          <p style={{ fontSize: '14px', color: '#777', marginBottom: '10px' }}>
                            Last scan: {fmt(result.scrapedAt)} · via {result.title} · {products.length} products
                          </p>
                          <div style={{ display: 'grid', gap: '5px', maxHeight: '300px', overflowY: 'auto' }}>
                            {products.map((item, i) => {
                              const parts = item.split(' — ');
                              const name = parts[0]?.trim();
                              const pricePart = parts.find(p => p.includes('$')) || '';
                              const dosage = parts.find(p => p.match(/\d+\s*(?:mg|ml|g|iu)/i) && !p.includes('$')) || '';
                              const cat = categorize(name);
                              const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Other'];
                              const changed = priceChanges.find(ch => ch.competitor === c.name && ch.product.toLowerCase() === name.toLowerCase());
                              return (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: changed ? '#1e1a14' : '#111', borderRadius: '5px', border: `1px solid ${changed ? '#7a5a2a' : '#1e1e1e'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: '14px', color: '#ccc' }}>{name}</span>
                                    {dosage && <span style={{ fontSize: '10px', color: '#777' }}>{dosage}</span>}
                                    <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '99px', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text, whiteSpace: 'nowrap' }}>{cat}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    {changed && (
                                      <span style={{ fontSize: '10px', color: changed.direction === 'down' ? '#7acc7a' : '#cc7a7a' }}>
                                        was {changed.from} {changed.direction === 'down' ? '↓' : '↑'}
                                      </span>
                                    )}
                                    <span style={{ fontSize: '14px', color: '#f5e6e0', fontWeight: '500' }}>{pricePart}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: '14px', color: '#cc7a7a' }}>Scan failed: {result.error}</p>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {showModal && (
              <div onClick={() => setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#181818', border: '1px solid #333', borderRadius: '10px', padding: '28px', maxWidth: '460px', width: '90%' }}>
                  <h2 style={{ fontSize: '16px', marginBottom: '20px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' }}>Add Competitor</h2>
                  {[{ label: 'Company Name *', key: 'name', placeholder: 'e.g., NCRP Canada', type: 'text' }, { label: 'Website URL *', key: 'website', placeholder: 'https://ncrpcanada.com', type: 'url' }].map(f => (
                    <div key={f.key}>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: '600', marginBottom: '6px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{f.label}</label>
                      <input type={f.type} placeholder={f.placeholder} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                        style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#111', color: '#fff', fontFamily: 'inherit', fontSize: '14px', marginBottom: '14px', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button style={BTN} onClick={() => setShowModal(false)}>CANCEL</button>
                    <button style={BTN_PRIMARY} onClick={handleAddCompetitor}>ADD</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ANALYSIS ───────────────────────────────────────────── */}
        {activePage === 'analysis' && (
          <div>
            <h1 style={H1}>ANALYSIS</h1>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
              <p style={{ ...SUB, margin: 0 }}>Price comparison and change detection</p>
              {comparison.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ ...BTN, fontSize: '14px', padding: '7px 14px' }} onClick={exportCSV}>
                    EXPORT CSV
                  </button>
                  <button style={{ ...BTN, fontSize: '14px', padding: '7px 14px' }} onClick={exportHTML}>
                    EXPORT REPORT
                  </button>
                </div>
              )}
            </div>

            {comparison.length === 0 && (
              <div style={CARD}>
                <h3 style={H3}>NO DATA YET</h3>
                <p style={P}>Scan at least one competitor to see analysis.</p>
                <button style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            )}

            {comparison.length > 0 && (
              <>
                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Cheapest Overall</div><div style={{ fontSize: '14px', color: '#7acc7a', fontWeight: '500', marginTop: '6px' }}>{cheapestSite || '—'}</div></div>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Products Compared</div><div style={{ fontSize: '28px', color: '#f5e6e0', marginTop: '4px' }}>{comparison.length}</div></div>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Price Range</div><div style={{ fontSize: '14px', color: '#f5e6e0', fontWeight: '500', marginTop: '6px' }}>{allPrices.length ? `$${Math.min(...allPrices).toFixed(2)} – $${Math.max(...allPrices).toFixed(2)}` : '—'}</div></div>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Price Changes</div><div style={{ fontSize: '28px', color: priceChanges.length > 0 ? '#ccaa7a' : '#f5e6e0', marginTop: '4px' }}>{priceChanges.length}</div></div>
                </div>

                {/* Price changes section */}
                {priceChanges.length > 0 && (
                  <div style={{ ...CARD, marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ ...H3, margin: 0 }}>PRICE CHANGES DETECTED</h3>
                      <button onClick={() => { if (window.confirm('Clear all price change history?')) { setPriceChanges([]); localStorage.removeItem('aria_changes'); } }} style={{ fontSize: '10px', padding: '4px 10px', background: 'transparent', border: '1px solid #333', borderRadius: '4px', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>CLEAR</button>
                    </div>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      {priceChanges.map((ch, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#1a1a14', border: '1px solid #2a2a1a', borderRadius: '6px' }}>
                          <div>
                            <span style={{ fontSize: '14px', color: '#ddd', fontWeight: '500' }}>{ch.product}</span>
                            <span style={{ fontSize: '14px', color: '#888', marginLeft: '10px' }}>{ch.competitor}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '14px', color: '#888', textDecoration: 'line-through' }}>{ch.from}</span>
                            <span style={{ fontSize: '14px', color: ch.direction === 'down' ? '#7acc7a' : '#cc7a7a', fontWeight: '600' }}>
                              {ch.to}
                            </span>
                            <span style={{ fontSize: '14px', padding: '2px 8px', borderRadius: '99px', background: ch.direction === 'down' ? '#1a2a1a' : '#2a1a1a', border: `1px solid ${ch.direction === 'down' ? '#4a9a4a' : '#9a4a4a'}`, color: ch.direction === 'down' ? '#7acc7a' : '#cc7a7a' }}>
                              {ch.direction === 'down' ? '↓' : '↑'} {Math.abs(ch.pct)}%
                            </span>
                            <span style={{ fontSize: '10px', color: '#777' }}>{ch.detectedAt ? new Date(ch.detectedAt).toLocaleDateString() : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key insights */}
                <div style={{ ...CARD, marginBottom: '16px' }}>
                  <h3 style={H3}>KEY INSIGHTS</h3>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {cheapestSite && (
                      <div style={{ padding: '12px', background: '#1a2a1a', border: '1px solid #4a9a4a', borderRadius: '6px' }}>
                        <p style={{ fontSize: '14px', color: '#7acc7a', margin: 0 }}><strong>Cheapest overall:</strong> {cheapestSite} has the lowest average pricing across all tracked products.</p>
                      </div>
                    )}
                    {(() => {
                      const overpriced = comparison.filter(p => {
                        const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                        if (prices.length < 2) return false;
                        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
                        return Math.max(...prices) > avg * 1.3;
                      });
                      return overpriced.length > 0 ? (
                        <div style={{ padding: '12px', background: '#2a1a1a', border: '1px solid #9a4a4a', borderRadius: '6px' }}>
                          <p style={{ fontSize: '14px', color: '#cc7a7a', margin: 0 }}><strong>Price gaps detected:</strong> {overpriced.slice(0, 3).map(p => p.name).join(', ')} show 30%+ variation across sites.</p>
                        </div>
                      ) : null;
                    })()}
                    {(() => {
                      const cats = {};
                      comparison.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
                      const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
                      return top ? (
                        <div style={{ padding: '12px', background: '#1a1a2a', border: '1px solid #4a4a9a', borderRadius: '6px' }}>
                          <p style={{ fontSize: '14px', color: '#7a7acc', margin: 0 }}><strong>Most competitive category:</strong> {top[0]} with {top[1]} products tracked.</p>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Comparison table */}
                {(() => {
                  const categories = ['ALL', ...new Set(comparison.map(p => p.category))];
                  const allSites = [...new Set(comparison.flatMap(p => Object.keys(p.sites)))];
                  const filtered = comparison
                    .filter(p => analysisFilter === 'ALL' || p.category === analysisFilter)
                    .sort((a, b) => {
                      if (analysisSortBy === 'name') return a.name.localeCompare(b.name);
                      if (analysisSortBy === 'category') return a.category.localeCompare(b.category);
                      if (analysisSortBy === 'price') {
                        const aMin = Math.min(...Object.values(a.sites).map(s => s.value || 999));
                        const bMin = Math.min(...Object.values(b.sites).map(s => s.value || 999));
                        return aMin - bMin;
                      }
                      return 0;
                    });
                  return (
                    <div style={CARD}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                        <h3 style={{ ...H3, margin: 0 }}>PRODUCT COMPARISON TABLE</h3>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <select value={analysisSortBy} onChange={e => setAnalysisSortBy(e.target.value)} style={{ padding: '5px 10px', background: '#111', border: '1px solid #333', borderRadius: '5px', color: '#aaa', fontSize: '14px', fontFamily: 'inherit' }}>
                            <option value="name">Sort: Name</option>
                            <option value="category">Sort: Category</option>
                            <option value="price">Sort: Price (low)</option>
                          </select>
                          <select value={analysisFilter} onChange={e => setAnalysisFilter(e.target.value)} style={{ padding: '5px 10px', background: '#111', border: '1px solid #333', borderRadius: '5px', color: '#aaa', fontSize: '14px', fontFamily: 'inherit' }}>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <div style={{ minWidth: `${200 + 140 + allSites.length * 130}px` }}>
                          <div style={{ display: 'grid', gridTemplateColumns: `200px 140px ${allSites.map(() => '130px').join(' ')}`, marginBottom: '4px' }}>
                            {['PRODUCT', 'CATEGORY', ...allSites].map((h, i) => (
                              <div key={i} style={{ fontSize: '9px', color: '#777', textTransform: 'uppercase', letterSpacing: '1px', padding: '6px 8px', fontWeight: '600' }}>{h}</div>
                            ))}
                          </div>
                          <div style={{ display: 'grid', gap: '3px' }}>
                            {filtered.map((p, i) => {
                              const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                              const minPrice = prices.length ? Math.min(...prices) : null;
                              const cat = CATEGORY_COLORS[p.category] || CATEGORY_COLORS['Other'];
                              const hasChange = priceChanges.some(ch => ch.product.toLowerCase() === p.name.toLowerCase());
                              return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: `200px 140px ${allSites.map(() => '130px').join(' ')}`, background: hasChange ? '#1a1a14' : i % 2 === 0 ? '#161616' : '#111', borderRadius: '4px', border: hasChange ? '1px solid #2a2a1a' : '1px solid transparent' }}>
                                  <div style={{ padding: '8px', fontSize: '14px', color: '#ddd', alignSelf: 'center', wordBreak: 'break-word' }}>
                                    {p.name}
                                    {hasChange && <span style={{ marginLeft: '6px', fontSize: '9px', color: '#ccaa7a' }}>↕</span>}
                                  </div>
                                  <div style={{ padding: '8px', alignSelf: 'center' }}>
                                    <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: cat.bg, border: `1px solid ${cat.border}`, color: cat.text, whiteSpace: 'nowrap' }}>{p.category}</span>
                                  </div>
                                  {allSites.map(site => {
                                    const sd = p.sites[site];
                                    const isLowest = sd?.value && sd.value === minPrice && prices.length > 1;
                                    return (
                                      <div key={site} style={{ padding: '8px', fontSize: '14px', color: isLowest ? '#7acc7a' : sd ? '#ccc' : '#2a2a2a', fontWeight: isLowest ? '600' : '400', alignSelf: 'center' }}>
                                        {sd ? sd.price : '—'}
                                        {isLowest && <span style={{ fontSize: '9px', marginLeft: '4px', color: '#4a9a4a' }}>LOW</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      {filtered.length === 0 && <p style={{ ...P, marginTop: '12px' }}>No products in this category yet.</p>}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── MARKET INTEL ───────────────────────────────────────── */}
        {activePage === 'marketintel' && (
          <div>
            <h1 style={H1}>MARKET INTEL</h1>
            <p style={SUB}>Competitive signals across all tracked sites</p>

            {competitors.length === 0 ? (
              <div style={CARD}>
                <h3 style={H3}>NO COMPETITORS YET</h3>
                <p style={P}>Add competitors to see market intel.</p>
                <button style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            ) : (() => {
              const knownIntel = {
                'GROWTH GUYS': {
                  freeShipping: null, flatShipping: 'Not advertised', dispatchSpeed: 'Same day tracked',
                  activeSales: ['Semaglutide — 40% off', 'Tirzepatide — 30% off', 'Retatrutide — 20% off'],
                  bundles: ['Single vial vs 10-pack on every product'], promoCode: null,
                  labTesting: 'Janoshik — public results page per batch', productCount: '71', subscription: null,
                  uniqueFeatures: ['Largest range — 71 products', 'Purity % + avg mass per product'],
                },
                'PURITY PEPTIDES': {
                  freeShipping: null, flatShipping: 'Not publicly listed', dispatchSpeed: 'Same day before 2pm EST',
                  activeSales: ['-21% on select products'],
                  bundles: [], promoCode: 'WDPILLS23 — 10% off first order',
                  labTesting: 'COA per batch — HPLC + mass spec', productCount: '70', subscription: null,
                  uniqueFeatures: ['Practitioner / clinic focused positioning'],
                },
                'NCRP': {
                  freeShipping: '$350', flatShipping: '$20 Ontario · $30 outside', dispatchSpeed: 'Within 24hrs Mon–Fri',
                  activeSales: [], bundles: [], promoCode: null,
                  labTesting: '98%+ purity guaranteed, HPLC', productCount: '14', subscription: null,
                  uniqueFeatures: ['All products made in Canada', 'Smallest / most focused range'],
                },
                'PEPTIDE WAREHOUSE': {
                  freeShipping: '$300', flatShipping: null, dispatchSpeed: 'Same day before 2pm EST',
                  activeSales: ['BPC-157 on sale', 'TB-500 on sale', 'GHK-Cu on sale', 'BPC+TB500 Blend on sale', 'N-Acetyl Epitalon: $54.99 → $44.99'],
                  bundles: [], promoCode: null,
                  labTesting: 'HPLC tested — mentioned', productCount: '~12 visible', subscription: null,
                  uniqueFeatures: ['GHK-Cu Face Cream (skincare)', 'Spray format products'],
                },
              };

              const getK = (c) => Object.entries(knownIntel).find(([k]) => c.name.includes(k) || k.includes(c.name.split(' ')[0]))?.[1] || {};

              const SEC = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', marginBottom: '14px', overflow: 'hidden' };
              const SEC_HEAD = { padding: '10px 16px', background: '#1e1e1e', borderBottom: '1px solid #2a2a2a', fontSize: '10px', fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' };
              const ROW_LABEL = { padding: '12px 14px', fontSize: '14px', color: '#888', background: '#161616', width: '170px', minWidth: '170px', verticalAlign: 'top', borderTop: '1px solid #222' };
              const colW = `${Math.floor(70 / competitors.length)}%`;
              const COL_HEAD = { padding: '9px 12px', fontSize: '10px', color: '#aaa', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.5px', borderLeft: '1px solid #2a2a2a', width: colW, background: '#1a1a1a' };
              const CELL = { padding: '12px 12px', fontSize: '14px', color: '#ddd', borderLeft: '1px solid #222', borderTop: '1px solid #222', verticalAlign: 'top', width: colW };

              const Pill = ({ text, type }) => {
                const s = { green: { bg:'#1a2a1a', border:'#4a9a4a', color:'#7acc7a' }, amber: { bg:'#2a1e0a', border:'#8a6a2a', color:'#ccaa7a' }, blue: { bg:'#1a1a2a', border:'#4a4a9a', color:'#9a9acc' }, teal: { bg:'#0a1e1e', border:'#2a7a7a', color:'#7acccc' }, gray: { bg:'#1e1e1e', border:'#333', color:'#888' } }[type] || { bg:'#1e1e1e', border:'#333', color:'#888' };
                return <span style={{ display:'inline-block', fontSize:'10px', padding:'2px 8px', borderRadius:'99px', background:s.bg, border:`1px solid ${s.border}`, color:s.color, marginRight:'4px', marginBottom:'4px', lineHeight:'1.6' }}>{text}</span>;
              };
              const None = () => <span style={{ color:'#444', fontSize: '14px' }}>—</span>;

              const SectionTable = ({ title, rows }) => (
                <div style={SEC}>
                  <div style={SEC_HEAD}>{title}</div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...ROW_LABEL, borderTop:'none', background:'#1a1a1a' }}></th>
                        {competitors.map(c => <th key={c.id} style={{ ...COL_HEAD, borderTop:'none' }}>{c.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>
                          <td style={ROW_LABEL}>{row.label}</td>
                          {competitors.map(c => <td key={c.id} style={CELL}>{row.render(getK(c), c)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              return (
                <>
                  <SectionTable title="Shipping" rows={[
                    { label: 'Free over', render: (k) => k.freeShipping ? <Pill text={`Free over $${k.freeShipping}`} type="green" /> : <None /> },
                    { label: 'Flat rate / other', render: (k) => k.flatShipping ? <span style={{ color:'#ccc', fontSize: '14px' }}>{k.flatShipping}</span> : <None /> },
                    { label: 'Dispatch speed', render: (k) => k.dispatchSpeed ? <span style={{ color:'#cccc7a', fontSize: '14px' }}>{k.dispatchSpeed}</span> : <None /> },
                  ]} />

                  <SectionTable title="Sales & Discounts" rows={[
                    { label: 'Active sales', render: (k) => (k.activeSales||[]).length > 0 ? <div>{(k.activeSales||[]).map((s,i) => <Pill key={i} text={s} type="amber" />)}</div> : <None /> },
                    { label: 'Bundle / multi-pack', render: (k) => (k.bundles||[]).length > 0 ? <div>{(k.bundles||[]).map((s,i) => <Pill key={i} text={s} type="green" />)}</div> : <None /> },
                    { label: 'Promo code', render: (k) => k.promoCode ? <span style={{ fontFamily:'monospace', fontSize: '14px', padding:'3px 8px', background:'#0a1e1e', border:'1px solid #2a7a7a', borderRadius:'5px', color:'#7acccc' }}>{k.promoCode}</span> : <None /> },
                    { label: 'Subscription', render: () => <None /> },
                  ]} />

                  <SectionTable title="Trust & Quality" rows={[
                    { label: 'Lab testing', render: (k) => k.labTesting ? <span style={{ color:'#7acc7a', fontSize: '14px', lineHeight:'1.6' }}>{k.labTesting}</span> : <None /> },
                    { label: 'Product count', render: (k, c) => { const sc = (scrapeResults[c.id]?.insights?.[0]?.items||[]).length; const d = sc > 0 ? sc : k.productCount; return <span style={{ fontSize:'16px', color:'#f5e6e0', fontWeight:'500' }}>{d||'—'}</span>; } },
                    { label: 'Unique features', render: (k) => (k.uniqueFeatures||[]).length > 0 ? <div>{(k.uniqueFeatures||[]).map((f,i) => <Pill key={i} text={f} type="blue" />)}</div> : <None /> },
                  ]} />

                  <div style={{ ...SEC, border:'1px solid #3a3a5a' }}>
                    <div style={{ ...SEC_HEAD, color:'#9a9acc' }}>Market Gaps — opportunities none of your competitors are taking</div>
                    <div style={{ padding:'16px', display:'grid', gap:'10px' }}>
                      {[
                        { title:'Subscription pricing', body:'None of the 4 tracked competitors offer recurring orders. First-mover advantage available — recurring revenue and customer lock-in.' },
                        { title:'Multi-pack bundles', body:'Only Growth Guys offers volume discounts. Purity Peptides, NCRP and Peptide Warehouse leave average order value on the table.' },
                        { title:'Public lab results page', body:'Only Growth Guys publishes a dedicated per-batch results page. A public transparency page is a proven trust differentiator.' },
                      ].map((g, i) => (
                        <div key={i} style={{ padding:'12px 14px', background:'#141420', borderRadius:'6px', border:'1px solid #2a2a4a', display:'flex', gap:'14px', alignItems:'flex-start' }}>
                          <div style={{ width:'6px', minWidth:'6px', height:'6px', borderRadius:'50%', background:'#5a5a9a', marginTop:'5px' }} />
                          <div>
                            <p style={{ fontSize: '14px', color:'#bbbbd0', margin:'0 0 4px', fontWeight:'500' }}>{g.title}</p>
                            <p style={{ fontSize: '14px', color:'#888', margin:0, lineHeight:'1.6' }}>{g.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

                {/* ── SETTINGS ───────────────────────────────────────────── */}
        {activePage === 'settings' && (
          <div>
            <h1 style={H1}>SETTINGS</h1>
            <p style={SUB}>Configure your ARIA platform</p>
            <div style={CARD}>
              <h3 style={H3}>DATA MANAGEMENT</h3>
              <p style={P}>All data is saved in your browser and survives page refreshes. Includes competitors, scan results, and price change history.</p>
              <button style={{ ...BTN, marginTop: '12px', borderColor: '#cc7a7a', color: '#cc7a7a' }} onClick={() => {
                if (window.confirm('Clear ALL data? This cannot be undone.')) {
                  setCompetitors([]); setScrapeResults({}); setPrevScrapeResults({}); setPriceChanges([]);
                  ['aria_competitors','aria_results','aria_prev_results','aria_changes'].forEach(k => localStorage.removeItem(k));
                }
              }}>CLEAR ALL DATA</button>
            </div>
            <div style={CARD}>
              <h3 style={H3}>HOW SCORING WORKS</h3>
              <p style={P}>Each competitor is scored out of 100 based on two factors:</p>
              <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
                <div style={{ padding: '10px 14px', background: '#111', borderRadius: '6px', border: '1px solid #222' }}>
                  <p style={{ fontSize: '14px', color: '#ddd', margin: '0 0 4px' }}>Product Coverage — 40 points</p>
                  <p style={{ fontSize: '14px', color: '#888', margin: 0 }}>How many of the total tracked products does this competitor carry?</p>
                </div>
                <div style={{ padding: '10px 14px', background: '#111', borderRadius: '6px', border: '1px solid #222' }}>
                  <p style={{ fontSize: '14px', color: '#ddd', margin: '0 0 4px' }}>Pricing Competitiveness — 60 points</p>
                  <p style={{ fontSize: '14px', color: '#888', margin: 0 }}>How often does this competitor have the lowest price across all products?</p>
                </div>
              </div>
            </div>
            <div style={CARD}>
              <h3 style={H3}>ABOUT ARIA</h3>
              <p style={P}>ARIA — Adaptive Research Intelligence Assistant</p>
              <p style={{ ...P, color: '#777' }}>VERSION: 2.1 | Price Change Detection | Competitor Scoring</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

const H1 = { fontSize: '28px', fontWeight: '400', marginBottom: '6px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' };
const SUB = { color: '#888', marginBottom: '28px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '22px', marginBottom: '16px' };
const H3 = { fontSize: '14px', fontWeight: '600', margin: '0 0 14px 0', color: '#bbb', textTransform: 'uppercase', letterSpacing: '1px' };
const P = { color: '#bbb', lineHeight: '1.7', marginBottom: '10px', fontSize: '14px' };
const STAT_CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '18px' };
const STAT_LABEL = { fontSize: '10px', color: '#777', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' };
const BTN = { padding: '10px 20px', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', background: 'transparent', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit' };
const BTN_PRIMARY = { padding: '10px 20px', border: '1px solid #f5e6e0', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', background: '#f5e6e0', color: '#181818', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit', fontWeight: '500' };
