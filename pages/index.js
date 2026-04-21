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
  'Weight Loss':           { bg: '#1a2a1a', border: '#4a9a4a', text: '#7acc7a' },
  'Muscle Growth':         { bg: '#1a1a2a', border: '#4a4a9a', text: '#7a7acc' },
  'Recovery / Healing':    { bg: '#2a1a1a', border: '#9a4a4a', text: '#cc7a7a' },
  'Anti-Aging':            { bg: '#2a2a1a', border: '#9a9a4a', text: '#cccc7a' },
  'Cognitive / Focus':     { bg: '#1a2a2a', border: '#4a9a9a', text: '#7acccc' },
  'Hormonal / Metabolic':  { bg: '#2a1a2a', border: '#9a4a9a', text: '#cc7acc' },
  'Supplies':              { bg: '#222222', border: '#555555', text: '#aaaaaa' },
  'Other':                 { bg: '#222222', border: '#555555', text: '#aaaaaa' },
};

// ── Parse price string to float ──────────────────────────────────────
function parsePrice(priceStr) {
  if (!priceStr) return null;
  const match = String(priceStr).match(/[\d,]+(?:\.\d{2})?/);
  if (!match) return null;
  return parseFloat(match[0].replace(/,/g, ''));
}

// ── Build comparison table from all scan results ─────────────────────
function buildComparison(competitors, scrapeResults) {
  const map = {}; // normalizedName -> { name, category, sites: { competitorName: price } }

  competitors.forEach(c => {
    const result = scrapeResults[c.id];
    if (!result?.success) return;
    const items = result.insights?.[0]?.items || [];
    items.forEach(item => {
      // Parse "Product Name — 10mg — $48.00" or "Product Name — $48.00"
      const parts = item.split(' — ');
      const name = parts[0]?.trim();
      if (!name || name.length < 2) return;
      // Find price part
      const pricePart = parts.find(p => p.includes('$'));
      const price = pricePart?.match(/\$[\d,.]+/)?.[0] || '';
      const priceVal = parsePrice(price);
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!map[key]) {
        map[key] = { name, category: categorize(name), sites: {} };
      }
      if (price) map[key].sites[c.name] = { price, value: priceVal };
    });
  });

  return Object.values(map).filter(p => Object.keys(p.sites).length > 0);
}

export default function Home() {
  const [activePage, setActivePage] = useState('dashboard');
  const [competitors, setCompetitors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', website: '' });
  const [scraping, setScraping] = useState({});
  const [scrapeResults, setScrapeResults] = useState({});
  const [analysisFilter, setAnalysisFilter] = useState('ALL');
  const [analysisSortBy, setAnalysisSortBy] = useState('name');

  // ── Local storage persistence ────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('aria_competitors');
      if (saved) setCompetitors(JSON.parse(saved));
      const savedAlerts = localStorage.getItem('aria_alerts');
      if (savedAlerts) setAlerts(JSON.parse(savedAlerts));
      const savedResults = localStorage.getItem('aria_results');
      if (savedResults) setScrapeResults(JSON.parse(savedResults));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('aria_competitors', JSON.stringify(competitors)); } catch {}
  }, [competitors]);

  useEffect(() => {
    try { localStorage.setItem('aria_alerts', JSON.stringify(alerts)); } catch {}
  }, [alerts]);

  useEffect(() => {
    try { localStorage.setItem('aria_results', JSON.stringify(scrapeResults)); } catch {}
  }, [scrapeResults]);

  const navItems = [
    { id: 'dashboard', label: 'DASHBOARD' },
    { id: 'competitors', label: 'COMPETITORS' },
    { id: 'alerts', label: 'ALERTS' },
    { id: 'analysis', label: 'ANALYSIS' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const handleAddCompetitor = () => {
    if (!form.name.trim()) { alert('Please enter a company name'); return; }
    if (!form.website.trim()) { alert('Please enter a website URL'); return; }
    let website = form.website.trim();
    if (!website.startsWith('http')) website = 'https://' + website;
    const newComp = { id: Date.now(), name: form.name.toUpperCase(), website, items: 0 };
    setCompetitors(prev => [...prev, newComp]);
    setForm({ name: '', website: '' });
    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this competitor?')) return;
    setCompetitors(prev => prev.filter(c => c.id !== id));
    setScrapeResults(prev => { const n = { ...prev }; delete n[id]; return n; });
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
      setScrapeResults(prev => ({ ...prev, [competitor.id]: { ...data, competitorName: competitor.name } }));
      if (data.success) {
        const newAlert = { id: Date.now(), competitor: competitor.name, url: competitor.website, title: data.title, insights: data.insights, scrapedAt: data.scrapedAt };
        setAlerts(prev => [newAlert, ...prev.slice(0, 49)]);
        setCompetitors(prev => prev.map(c => c.id === competitor.id ? { ...c, items: (c.items || 0) + 1 } : c));
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
  const scannedCount = competitors.filter(c => scrapeResults[c.id]?.success).length;
  const totalProducts = comparison.length;
  const allPrices = comparison.flatMap(p => Object.values(p.sites).map(s => s.value).filter(Boolean));
  const cheapestSite = (() => {
    const totals = {};
    comparison.forEach(p => Object.entries(p.sites).forEach(([site, { value }]) => {
      if (value) { totals[site] = (totals[site] || []).concat(value); }
    }));
    let best = null, bestAvg = Infinity;
    Object.entries(totals).forEach(([site, prices]) => {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      if (avg < bestAvg) { bestAvg = avg; best = site; }
    });
    return best;
  })();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Century Gothic', 'Trebuchet MS', sans-serif", background: '#111111', color: '#fff' }}>

      {/* Sidebar */}
      <aside style={{ width: '220px', minWidth: '220px', background: '#181818', padding: '20px', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg, #f5e6e0, #e8a8b8)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '700', color: '#181818' }}>A</div>
          <div>
            <div style={{ fontSize: '16px', color: '#f5e6e0', letterSpacing: '2px', fontWeight: '500' }}>ARIA</div>
            <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Intelligence Platform</div>
          </div>
        </div>
        <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Navigation</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '24px' }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActivePage(item.id)} style={{ padding: '9px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '11px', textAlign: 'left', fontFamily: 'inherit', background: activePage === item.id ? '#f5e6e0' : 'transparent', color: activePage === item.id ? '#181818' : '#888', fontWeight: activePage === item.id ? '600' : '400', letterSpacing: '0.5px' }}>
              {item.label}
              {item.id === 'alerts' && alerts.length > 0 && <span style={{ marginLeft: '8px', background: '#e8a8b8', color: '#181818', borderRadius: '99px', padding: '1px 6px', fontSize: '9px', fontWeight: '700' }}>{alerts.length}</span>}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '10px', fontSize: '9px', color: '#444' }}>
          <p>v2.0</p><p style={{ marginTop: '2px' }}>Data survives refresh ✓</p>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '28px', background: '#111111', overflowX: 'hidden' }}>

        {/* ── DASHBOARD ──────────────────────────────────────────── */}
        {activePage === 'dashboard' && (
          <div>
            <h1 style={H1}>DASHBOARD</h1>
            <p style={SUB}>Competitive pricing intelligence at a glance</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '28px' }}>
              {[
                { label: 'Competitors', value: competitors.length },
                { label: 'Scanned', value: scannedCount },
                { label: 'Products Tracked', value: totalProducts },
                { label: 'Cheapest Site', value: cheapestSite || '—', small: true },
              ].map((s, i) => (
                <div key={i} style={STAT_CARD}>
                  <div style={STAT_LABEL}>{s.label}</div>
                  <div style={{ ...STAT_VAL, fontSize: s.small ? '16px' : '32px', marginTop: '4px' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {comparison.length > 0 && (
              <div style={CARD}>
                <h3 style={H3}>PRICE SNAPSHOT</h3>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {comparison.slice(0, 8).map((p, i) => {
                    const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                    const low = prices.length ? Math.min(...prices) : null;
                    const high = prices.length ? Math.max(...prices) : null;
                    const cat = CATEGORY_COLORS[p.category] || CATEGORY_COLORS['Other'];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#181818', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: '13px', color: '#fff', fontWeight: '500' }}>{p.name}</span>
                          <span style={{ marginLeft: '10px', fontSize: '10px', padding: '2px 8px', borderRadius: '99px', background: cat.bg, border: `1px solid ${cat.border}`, color: cat.text }}>{p.category}</span>
                        </div>
                        <div style={{ fontSize: '13px', color: '#f5e6e0', fontWeight: '500' }}>
                          {low ? `$${low.toFixed(2)}` : '—'}
                          {high && high !== low ? <span style={{ color: '#666', fontSize: '11px' }}> – ${high.toFixed(2)}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {comparison.length > 8 && <p style={{ fontSize: '11px', color: '#555', marginTop: '12px' }}>+ {comparison.length - 8} more — see Analysis tab</p>}
              </div>
            )}

            {competitors.length === 0 && (
              <div style={CARD}>
                <h3 style={H3}>GET STARTED</h3>
                <ol style={{ marginLeft: '20px', color: '#888', fontSize: '13px', lineHeight: '2.2' }}>
                  <li>Go to <strong style={{ color: '#f5e6e0' }}>Competitors</strong> → Add competitor URLs</li>
                  <li>Click <strong style={{ color: '#f5e6e0' }}>CHECK NOW</strong> to scan each site</li>
                  <li>Go to <strong style={{ color: '#f5e6e0' }}>Analysis</strong> to compare prices</li>
                </ol>
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
                return (
                  <div key={c.id} style={CARD}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <h3 style={{ ...H3, margin: 0 }}>{c.name}</h3>
                        <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#666', textDecoration: 'none' }}>{c.website}</a>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button style={{ ...BTN_PRIMARY, padding: '7px 14px', fontSize: '11px', opacity: scraping[c.id] ? 0.6 : 1 }} onClick={() => handleScrape(c)} disabled={scraping[c.id]}>
                          {scraping[c.id] ? 'SCANNING...' : 'CHECK NOW'}
                        </button>
                        <button style={{ ...BTN, padding: '7px 14px', fontSize: '11px' }} onClick={() => handleDelete(c.id)}>DELETE</button>
                      </div>
                    </div>

                    {scraping[c.id] && <p style={{ fontSize: '12px', color: '#f5e6e0' }}>Scanning {c.website}...</p>}

                    {result && !scraping[c.id] && (
                      result.success ? (
                        <div>
                          <p style={{ fontSize: '11px', color: '#555', marginBottom: '10px' }}>Last scan: {fmt(result.scrapedAt)} · via {result.title} · {products.length} products</p>
                          <div style={{ display: 'grid', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                            {products.map((item, i) => {
                              const parts = item.split(' — ');
                              const name = parts[0]?.trim();
                              const pricePart = parts.find(p => p.includes('$')) || '';
                              const dosage = parts.find(p => p.match(/\d+\s*(?:mg|ml|g|iu)/i) && !p.includes('$')) || '';
                              const cat = categorize(name);
                              const c2 = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Other'];
                              return (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#111', borderRadius: '5px', border: '1px solid #222' }}>
                                  <div>
                                    <span style={{ fontSize: '12px', color: '#ddd' }}>{name}</span>
                                    {dosage && <span style={{ fontSize: '10px', color: '#555', marginLeft: '6px' }}>{dosage}</span>}
                                    <span style={{ marginLeft: '8px', fontSize: '9px', padding: '1px 6px', borderRadius: '99px', background: c2.bg, border: `1px solid ${c2.border}`, color: c2.text }}>{cat}</span>
                                  </div>
                                  <span style={{ fontSize: '12px', color: '#f5e6e0', fontWeight: '500' }}>{pricePart}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: '12px', color: '#cc7a7a' }}>Scan failed: {result.error}</p>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {showModal && (
              <div onClick={() => setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#181818', border: '1px solid #333', borderRadius: '10px', padding: '28px', maxWidth: '460px', width: '90%' }}>
                  <h2 style={{ fontSize: '18px', marginBottom: '20px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' }}>Add Competitor</h2>
                  {[{ label: 'Company Name *', key: 'name', placeholder: 'e.g., NCRP Canada', type: 'text' }, { label: 'Website URL *', key: 'website', placeholder: 'https://ncrpcanada.com', type: 'url' }].map(f => (
                    <div key={f.key}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '500', marginBottom: '6px', color: '#aaa', textTransform: 'uppercase' }}>{f.label}</label>
                      <input type={f.type} placeholder={f.placeholder} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                        style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#111', color: '#fff', fontFamily: 'inherit', fontSize: '13px', marginBottom: '14px', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button style={BTN} onClick={() => setShowModal(false)}>CANCEL</button>
                    <button style={BTN_PRIMARY} onClick={handleAddCompetitor}>ADD</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ALERTS ─────────────────────────────────────────────── */}
        {activePage === 'alerts' && (
          <div>
            <h1 style={H1}>ALERTS</h1>
            <p style={SUB}>Scan history and results</p>
            {alerts.length === 0 && (
              <div style={CARD}><p style={P}>No scans yet. Go to Competitors and click CHECK NOW.</p></div>
            )}
            {alerts.map((alert, i) => (
              <div key={i} style={{ ...CARD, marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ ...H3, margin: 0 }}>{alert.competitor}</h3>
                    <p style={{ fontSize: '11px', color: '#555', margin: '3px 0' }}>{alert.url} · {fmt(alert.scrapedAt)}</p>
                  </div>
                  <span style={TAG}>SCAN</span>
                </div>
                {alert.insights?.[0]?.items?.slice(0, 5).map((item, j) => (
                  <p key={j} style={{ fontSize: '12px', color: '#888', margin: '3px 0 3px 8px' }}>• {item}</p>
                ))}
                {(alert.insights?.[0]?.items?.length || 0) > 5 && (
                  <p style={{ fontSize: '11px', color: '#555', margin: '6px 0 0 8px' }}>+ {alert.insights[0].items.length - 5} more products</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── ANALYSIS ───────────────────────────────────────────── */}
        {activePage === 'analysis' && (
          <div>
            <h1 style={H1}>ANALYSIS</h1>
            <p style={SUB}>Price comparison across all competitors</p>

            {comparison.length === 0 && (
              <div style={CARD}>
                <h3 style={H3}>NO DATA YET</h3>
                <p style={P}>Scan at least one competitor to see price analysis.</p>
                <button style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            )}

            {comparison.length > 0 && (
              <>
                {/* Insights summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                  <div style={STAT_CARD}>
                    <div style={STAT_LABEL}>Cheapest Overall</div>
                    <div style={{ fontSize: '15px', color: '#7acc7a', fontWeight: '500', marginTop: '6px' }}>{cheapestSite || '—'}</div>
                  </div>
                  <div style={STAT_CARD}>
                    <div style={STAT_LABEL}>Products Compared</div>
                    <div style={STAT_VAL}>{totalProducts}</div>
                  </div>
                  <div style={STAT_CARD}>
                    <div style={STAT_LABEL}>Price Range</div>
                    <div style={{ fontSize: '14px', color: '#f5e6e0', fontWeight: '500', marginTop: '6px' }}>
                      {allPrices.length ? `$${Math.min(...allPrices).toFixed(2)} – $${Math.max(...allPrices).toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div style={STAT_CARD}>
                    <div style={STAT_LABEL}>Avg Price</div>
                    <div style={{ fontSize: '14px', color: '#f5e6e0', fontWeight: '500', marginTop: '6px' }}>
                      {allPrices.length ? `$${(allPrices.reduce((a, b) => a + b, 0) / allPrices.length).toFixed(2)}` : '—'}
                    </div>
                  </div>
                </div>



                {/* Comparison table — uses top-level analysisFilter + analysisSortBy */}
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
                          <select value={analysisSortBy} onChange={e => setAnalysisSortBy(e.target.value)} style={{ padding: '5px 10px', background: '#111', border: '1px solid #333', borderRadius: '5px', color: '#aaa', fontSize: '11px', fontFamily: 'inherit' }}>
                            <option value="name">Sort: Name</option>
                            <option value="category">Sort: Category</option>
                            <option value="price">Sort: Price (low)</option>
                          </select>
                          <select value={analysisFilter} onChange={e => setAnalysisFilter(e.target.value)} style={{ padding: '5px 10px', background: '#111', border: '1px solid #333', borderRadius: '5px', color: '#aaa', fontSize: '11px', fontFamily: 'inherit' }}>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <div style={{ minWidth: `${200 + 140 + allSites.length * 120}px` }}>
                          <div style={{ display: 'grid', gridTemplateColumns: `200px 140px ${allSites.map(() => '120px').join(' ')}`, gap: '1px', marginBottom: '4px' }}>
                            {['PRODUCT', 'CATEGORY', ...allSites].map((h, i) => (
                              <div key={i} style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', padding: '6px 8px', fontWeight: '600' }}>{h}</div>
                            ))}
                          </div>
                          <div style={{ display: 'grid', gap: '3px' }}>
                            {filtered.map((p, i) => {
                              const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                              const minPrice = prices.length ? Math.min(...prices) : null;
                              const cat = CATEGORY_COLORS[p.category] || CATEGORY_COLORS['Other'];
                              return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: `200px 140px ${allSites.map(() => '120px').join(' ')}`, gap: '1px', background: i % 2 === 0 ? '#161616' : '#111', borderRadius: '4px' }}>
                                  <div style={{ padding: '8px', fontSize: '12px', color: '#ddd', alignSelf: 'center', wordBreak: 'break-word' }}>{p.name}</div>
                                  <div style={{ padding: '8px', alignSelf: 'center' }}>
                                    <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: cat.bg, border: `1px solid ${cat.border}`, color: cat.text, whiteSpace: 'nowrap' }}>{p.category}</span>
                                  </div>
                                  {allSites.map(site => {
                                    const sd = p.sites[site];
                                    const isLowest = sd?.value && sd.value === minPrice && prices.length > 1;
                                    return (
                                      <div key={site} style={{ padding: '8px', fontSize: '12px', color: isLowest ? '#7acc7a' : sd ? '#ccc' : '#333', fontWeight: isLowest ? '600' : '400', alignSelf: 'center' }}>
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

                {/* Key insights */}
                <div style={CARD}>
                  <h3 style={H3}>KEY INSIGHTS</h3>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {cheapestSite && (
                      <div style={{ padding: '12px', background: '#1a2a1a', border: '1px solid #4a9a4a', borderRadius: '6px' }}>
                        <p style={{ fontSize: '12px', color: '#7acc7a', margin: 0 }}><strong>Cheapest overall:</strong> {cheapestSite} has the lowest average pricing across all tracked products.</p>
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
                          <p style={{ fontSize: '12px', color: '#cc7a7a', margin: 0 }}><strong>Price gaps detected:</strong> {overpriced.slice(0, 3).map(p => p.name).join(', ')} show 30%+ price variation across sites.</p>
                        </div>
                      ) : null;
                    })()}
                    {(() => {
                      const cats = {};
                      comparison.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
                      const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
                      return top ? (
                        <div style={{ padding: '12px', background: '#1a1a2a', border: '1px solid #4a4a9a', borderRadius: '6px' }}>
                          <p style={{ fontSize: '12px', color: '#7a7acc', margin: 0 }}><strong>Most competitive category:</strong> {top[0]} with {top[1]} products tracked across competitors.</p>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SETTINGS ───────────────────────────────────────────── */}
        {activePage === 'settings' && (
          <div>
            <h1 style={H1}>SETTINGS</h1>
            <p style={SUB}>Configure your ARIA platform</p>
            <div style={CARD}>
              <h3 style={H3}>DATA MANAGEMENT</h3>
              <p style={P}>Your competitors, scan results, and alerts are saved in your browser and survive page refreshes.</p>
              <button style={{ ...BTN, marginTop: '12px', borderColor: '#cc7a7a', color: '#cc7a7a' }} onClick={() => {
                if (window.confirm('Clear all data? This cannot be undone.')) {
                  setCompetitors([]); setAlerts([]); setScrapeResults({});
                  localStorage.removeItem('aria_competitors');
                  localStorage.removeItem('aria_alerts');
                  localStorage.removeItem('aria_results');
                }
              }}>CLEAR ALL DATA</button>
            </div>
            <div style={CARD}>
              <h3 style={H3}>PRODUCT CATEGORIES</h3>
              <p style={P}>Products are automatically categorized by name. Categories used:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {Object.entries(CATEGORY_COLORS).map(([cat, colors]) => (
                  <span key={cat} style={{ fontSize: '11px', padding: '4px 12px', borderRadius: '99px', background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}>{cat}</span>
                ))}
              </div>
            </div>
            <div style={CARD}>
              <h3 style={H3}>ABOUT ARIA</h3>
              <p style={P}>ARIA — Adaptive Research Intelligence Assistant</p>
              <p style={{ ...P, color: '#555' }}>VERSION: 2.0 | STATUS: PRODUCTION READY</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

const H1 = { fontSize: '26px', fontWeight: '400', marginBottom: '6px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' };
const SUB = { color: '#555', marginBottom: '28px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '20px', marginBottom: '16px' };
const H3 = { fontSize: '12px', fontWeight: '600', margin: '0 0 14px 0', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' };
const P = { color: '#888', lineHeight: '1.6', marginBottom: '10px', fontSize: '13px' };
const STAT_CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '18px' };
const STAT_LABEL = { fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' };
const STAT_VAL = { fontSize: '32px', fontWeight: '400', color: '#f5e6e0' };
const TAG = { display: 'inline-block', padding: '3px 10px', background: '#222', color: '#f5e6e0', border: '1px solid #333', borderRadius: '99px', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const BTN = { padding: '9px 18px', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontWeight: '400', fontSize: '11px', background: 'transparent', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit' };
const BTN_PRIMARY = { padding: '9px 18px', border: '1px solid #f5e6e0', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', fontSize: '11px', background: '#f5e6e0', color: '#181818', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit' };
