import { useState } from 'react';

export default function Home() {
  const [activePage, setActivePage] = useState('dashboard');
  const [competitors, setCompetitors] = useState([
    { id: 1, name: 'ACME CORP', industry: 'Enterprise SaaS', arr: '$500M', website: 'https://acme.example.com', items: 0 },
    { id: 2, name: 'ZENITH SOLUTIONS', industry: 'Cloud Services', arr: '$350M', website: 'https://zenith.example.com', items: 0 },
    { id: 3, name: 'NEXUS CORP', industry: 'SaaS Platform', arr: '$250M', website: 'https://nexus.example.com', items: 0 },
  ]);
  const [alerts, setAlerts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', website: '', industry: '', arr: '' });
  const [scraping, setScraping] = useState({});
  const [scrapeResults, setScrapeResults] = useState({});

  const navItems = [
    { id: 'dashboard', label: 'DASHBOARD' },
    { id: 'alerts', label: 'ALERTS' },
    { id: 'competitors', label: 'COMPETITORS' },
    { id: 'research', label: 'RESEARCH' },
    { id: 'analysis', label: 'ANALYSIS' },
    { id: 'reports', label: 'REPORTS' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const handleAddCompetitor = () => {
    if (!form.name.trim()) { alert('Please enter a company name'); return; }
    if (!form.website.trim()) { alert('Please enter a website URL'); return; }
    let website = form.website.trim();
    if (!website.startsWith('http')) website = 'https://' + website;
    setCompetitors([...competitors, {
      id: Date.now(),
      name: form.name.toUpperCase(),
      industry: form.industry || 'Unknown',
      arr: form.arr || 'N/A',
      website,
      items: 0,
    }]);
    setForm({ name: '', website: '', industry: '', arr: '' });
    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this competitor?')) {
      setCompetitors(competitors.filter(c => c.id !== id));
      const newResults = { ...scrapeResults };
      delete newResults[id];
      setScrapeResults(newResults);
    }
  };

  const handleScrape = async (competitor) => {
    if (!competitor.website || competitor.website.includes('example.com')) {
      alert('Please add a real website URL for this competitor first.');
      return;
    }
    setScraping(prev => ({ ...prev, [competitor.id]: true }));
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: competitor.website }),
      });
      const data = await response.json();
      setScrapeResults(prev => ({ ...prev, [competitor.id]: { ...data, competitorName: competitor.name } }));
      if (data.success) {
        const newAlert = {
          id: Date.now(),
          competitor: competitor.name,
          url: competitor.website,
          title: data.title,
          insights: data.insights,
          scrapedAt: data.scrapedAt,
        };
        setAlerts(prev => [newAlert, ...prev]);
        setCompetitors(prev => prev.map(c => c.id === competitor.id ? { ...c, items: c.items + 1 } : c));
      }
    } catch (error) {
      setScrapeResults(prev => ({ ...prev, [competitor.id]: { success: false, error: 'Failed to scan. Check the URL and try again.' } }));
    }
    setScraping(prev => ({ ...prev, [competitor.id]: false }));
  };

  const handleScrapeAll = async () => {
    const realCompetitors = competitors.filter(c => c.website && !c.website.includes('example.com'));
    if (realCompetitors.length === 0) { alert('Please add real competitor website URLs first.'); return; }
    for (const competitor of realCompetitors) { await handleScrape(competitor); }
  };

  const formatDate = (iso) => { if (!iso) return ''; return new Date(iso).toLocaleString(); };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Century Gothic', 'Trebuchet MS', sans-serif", background: '#1a1a1a', color: '#fff' }}>
      <aside style={{ width: '240px', minWidth: '240px', background: '#242424', padding: '20px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh', overflowY: 'auto', position: 'sticky', top: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #f5e6e0, #e8a8b8)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: '700', color: '#242424' }}>A</div>
          <div>
            <div style={{ fontSize: '18px', color: '#f5e6e0', letterSpacing: '2px' }}>ARIA</div>
            <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '1px' }}>Intelligence Platform</div>
          </div>
        </div>
        <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic', borderTop: '1px solid #333', borderBottom: '1px solid #333', padding: '10px 0', marginBottom: '20px' }}>Adaptive Research Intelligence Assistant</div>
        <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>Navigation</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '24px' }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActivePage(item.id)} style={{ padding: '10px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', textAlign: 'left', fontFamily: 'inherit', background: activePage === item.id ? '#f5e6e0' : 'transparent', color: activePage === item.id ? '#242424' : '#ccc', fontWeight: activePage === item.id ? '500' : '400' }}>
              {item.label}{item.id === 'alerts' && alerts.length > 0 && <span style={{ marginLeft: '8px', background: '#e8a8b8', color: '#242424', borderRadius: '99px', padding: '2px 6px', fontSize: '10px', fontWeight: '700' }}>{alerts.length}</span>}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ borderTop: '1px solid #333', paddingTop: '10px', fontSize: '10px', color: '#999' }}><p>v1.0 MVP</p><p style={{ marginTop: '4px' }}>Production Ready</p></div>
      </aside>

      <main style={{ marginLeft: "0", flex: 1, padding: '24px', background: '#1a1a1a' }}>

        {activePage === 'dashboard' && (
          <div>
            <h1 style={h1Style}>DASHBOARD</h1>
            <p style={subtitleStyle}>Your competitive intelligence at a glance</p>
            <div style={gridStyle}>
              <div style={statCard}><div style={statLabel}>Competitors</div><div style={statValue}>{competitors.length}</div></div>
              <div style={statCard}><div style={statLabel}>Scans Run</div><div style={statValue}>{alerts.length}</div></div>
              <div style={statCard}><div style={statLabel}>Alerts</div><div style={statValue}>{alerts.length}</div></div>
              <div style={statCard}><div style={statLabel}>Status</div><div style={{ fontSize: '18px', fontWeight: '400', color: '#f5e6e0' }}>ACTIVE</div></div>
            </div>
            <div style={cardStyle}>
              <h3 style={h3Style}>QUICK ACTIONS</h3>
              <p style={pStyle}>Add your real competitor websites then click Check Now to scan them.</p>
              <button style={{ ...btnPrimaryStyle, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
            </div>
            {alerts.length > 0 && (
              <div style={cardStyle}>
                <h3 style={h3Style}>LATEST SCANS</h3>
                {alerts.slice(0, 3).map((alert, i) => (
                  <div key={i} style={insightBox}>
                    <h4 style={h4Style}>{alert.competitor} — {alert.title}</h4>
                    <p style={{ fontSize: '12px', color: '#999', margin: '4px 0' }}>Scanned {formatDate(alert.scrapedAt)}</p>
                    {alert.insights?.slice(0, 1).map((insight, j) => <p key={j} style={pStyle}>{insight.type}: {insight.items?.slice(0, 2).join(' • ')}</p>)}
                  </div>
                ))}
              </div>
            )}
            {alerts.length === 0 && (
              <div style={cardStyle}>
                <h3 style={h3Style}>GET STARTED</h3>
                <ol style={{ marginLeft: '20px', color: '#ccc', fontSize: '13px', lineHeight: '2' }}>
                  <li>Go to <strong>Competitors</strong> page</li>
                  <li>Add your real competitor URLs</li>
                  <li>Click <strong>CHECK NOW</strong> on each competitor</li>
                  <li>View results in <strong>Alerts</strong></li>
                </ol>
              </div>
            )}
          </div>
        )}

        {activePage === 'alerts' && (
          <div>
            <h1 style={h1Style}>ALERTS</h1>
            <p style={subtitleStyle}>Real scan results from your competitor websites</p>
            {alerts.length === 0 && (
              <div style={cardStyle}>
                <h3 style={h3Style}>NO ALERTS YET</h3>
                <p style={pStyle}>Go to the Competitors page and click CHECK NOW to run your first scan.</p>
                <button style={{ ...btnPrimaryStyle, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            )}
            {alerts.map((alert, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <h3 style={h3Style}>{alert.competitor}</h3>
                    <p style={{ fontSize: '11px', color: '#999', margin: '4px 0' }}>{alert.url}</p>
                    <p style={{ fontSize: '11px', color: '#999' }}>Scanned: {formatDate(alert.scrapedAt)}</p>
                  </div>
                  <span style={tagStyle}>SCAN</span>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <h4 style={h4Style}>PAGE TITLE</h4>
                  <p style={pStyle}>{alert.title}</p>
                </div>
                {alert.insights?.map((insight, j) => (
                  <div key={j} style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <h4 style={{ ...h4Style, margin: 0 }}>{insight.type}</h4>
                      <span style={tagStyle}>{insight.tag}</span>
                    </div>
                    <ul style={{ margin: '0 0 0 16px', padding: 0 }}>
                      {insight.items?.map((item, k) => <li key={k} style={{ fontSize: '12px', color: '#ccc', marginBottom: '4px', lineHeight: '1.5' }}>{item}</li>)}
                    </ul>
                  </div>
                ))}
                {(!alert.insights || alert.insights.length === 0) && <p style={{ ...pStyle, color: '#666', fontStyle: 'italic' }}>Site scanned successfully. No specific changes detected.</p>}
              </div>
            ))}
          </div>
        )}

        {activePage === 'competitors' && (
          <div>
            <h1 style={h1Style}>COMPETITORS</h1>
            <p style={subtitleStyle}>Add competitors and scan their websites</p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <button style={btnPrimaryStyle} onClick={() => setShowModal(true)}>+ ADD COMPETITOR</button>
              <button style={btnStyle} onClick={handleScrapeAll}>SCAN ALL COMPETITORS</button>
            </div>
            <div style={{ display: 'grid', gap: '16px' }}>
              {competitors.map(c => (
                <div key={c.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={h3Style}>{c.name}</h3>
                      <p style={{ fontSize: '12px', color: '#999', margin: '4px 0' }}>{c.industry} • {c.arr}</p>
                      <p style={{ fontSize: '12px', color: '#f5e6e0', marginTop: '4px' }}>{c.website}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button style={{ ...btnPrimaryStyle, padding: '8px 16px', fontSize: '11px', opacity: scraping[c.id] ? 0.7 : 1 }} onClick={() => handleScrape(c)} disabled={scraping[c.id]}>
                        {scraping[c.id] ? 'SCANNING...' : 'CHECK NOW'}
                      </button>
                      <button style={{ ...btnStyle, padding: '8px 16px', fontSize: '11px' }} onClick={() => handleDelete(c.id)}>DELETE</button>
                    </div>
                  </div>
                  {scraping[c.id] && <div style={{ background: '#1a1a1a', borderRadius: '6px', padding: '12px' }}><p style={{ fontSize: '12px', color: '#f5e6e0', margin: 0 }}>Scanning {c.website}...</p></div>}
                  {scrapeResults[c.id] && !scraping[c.id] && (
                    <div style={{ background: '#1a1a1a', borderRadius: '6px', padding: '16px' }}>
                      {scrapeResults[c.id].success ? (
                        <div>
                          <p style={{ fontSize: '11px', color: '#999', marginBottom: '8px' }}>Last scanned: {formatDate(scrapeResults[c.id].scrapedAt)}</p>
                          <p style={{ fontSize: '13px', color: '#f5e6e0', fontWeight: '500', marginBottom: '8px' }}>{scrapeResults[c.id].title}</p>
                          {scrapeResults[c.id].insights?.map((insight, j) => (
                            <div key={j} style={{ marginBottom: '8px' }}>
                              <span style={{ ...tagStyle, marginBottom: '4px', display: 'inline-block' }}>{insight.tag}</span>
                              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                {insight.items?.slice(0, 3).map((item, k) => <li key={k} style={{ fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>{item}</li>)}
                              </ul>
                            </div>
                          ))}
                          <button style={{ ...btnStyle, padding: '6px 12px', fontSize: '11px', marginTop: '8px' }} onClick={() => setActivePage('alerts')}>VIEW IN ALERTS →</button>
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontSize: '12px', color: '#d4949d', margin: 0 }}>Could not scan: {scrapeResults[c.id].error}</p>
                          <p style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>Some sites block automated access. Try checking the URL is correct.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {showModal && (
              <div onClick={() => setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#242424', border: '1px solid #333', borderRadius: '8px', padding: '32px', maxWidth: '500px', width: '90%' }}>
                  <h2 style={{ fontSize: '20px', marginBottom: '24px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' }}>ADD COMPETITOR</h2>
                  {[{ label: 'Company Name *', key: 'name', placeholder: 'e.g., Acme Corp', type: 'text' }, { label: 'Website URL *', key: 'website', placeholder: 'https://acme.com', type: 'url' }, { label: 'Industry', key: 'industry', placeholder: 'e.g., SaaS', type: 'text' }, { label: 'ARR', key: 'arr', placeholder: 'e.g., $500M', type: 'text' }].map(field => (
                    <div key={field.key}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '8px', color: '#fff', textTransform: 'uppercase' }}>{field.label}</label>
                      <input type={field.type} placeholder={field.placeholder} value={form[field.key]} onChange={e => setForm({ ...form, [field.key]: e.target.value })} style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#1a1a1a', color: '#fff', fontFamily: 'inherit', fontSize: '13px', marginBottom: '16px', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button style={btnStyle} onClick={() => setShowModal(false)}>CANCEL</button>
                    <button style={btnPrimaryStyle} onClick={handleAddCompetitor}>ADD COMPETITOR</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activePage === 'research' && (
          <div>
            <h1 style={h1Style}>RESEARCH</h1>
            <p style={subtitleStyle}>Scan history and data points</p>
            <div style={cardStyle}>
              <h3 style={h3Style}>SCAN HISTORY ({alerts.length} scans)</h3>
              {alerts.length === 0 && <p style={pStyle}>No scans yet. Go to Competitors and click CHECK NOW.</p>}
              <div style={{ display: 'grid', gap: '12px' }}>
                {alerts.map((alert, i) => (
                  <div key={i} style={itemStyle}>
                    <h4 style={h4Style}>{alert.competitor}</h4>
                    <p style={{ fontSize: '12px', color: '#999', margin: '4px 0' }}>{alert.url}</p>
                    <p style={{ fontSize: '12px', color: '#999' }}>Scanned: {formatDate(alert.scrapedAt)}</p>
                    {alert.insights?.map((insight, j) => <span key={j} style={tagStyle}>{insight.tag}</span>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activePage === 'analysis' && (
          <div>
            <h1 style={h1Style}>ANALYSIS</h1>
            <p style={subtitleStyle}>Competitive insights and strategic analysis</p>
            <div style={gridStyle}>
              <div style={statCard}><div style={statLabel}>Competitors</div><div style={statValue}>{competitors.length}</div></div>
              <div style={statCard}><div style={statLabel}>Total Scans</div><div style={statValue}>{alerts.length}</div></div>
              <div style={statCard}><div style={statLabel}>Pricing Alerts</div><div style={statValue}>{alerts.filter(a => a.insights?.some(i => i.tag === 'PRICING')).length}</div></div>
              <div style={statCard}><div style={statLabel}>Product Alerts</div><div style={statValue}>{alerts.filter(a => a.insights?.some(i => i.tag === 'PRODUCT')).length}</div></div>
            </div>
            <div style={cardStyle}>
              <h3 style={h3Style}>INSIGHTS SUMMARY</h3>
              {alerts.length === 0 && <p style={pStyle}>Run your first scan to see analysis here.</p>}
              {alerts.map((alert, i) => (
                <div key={i} style={insightBox}>
                  <h4 style={h4Style}>{alert.competitor}</h4>
                  <p style={pStyle}>{alert.title}</p>
                  {alert.insights?.map((insight, j) => <p key={j} style={{ fontSize: '12px', color: '#999', margin: '2px 0' }}><strong style={{ color: '#f5e6e0' }}>{insight.type}:</strong> {insight.items?.slice(0, 2).join(' • ')}</p>)}
                </div>
              ))}
            </div>
          </div>
        )}

        {activePage === 'reports' && (
          <div>
            <h1 style={h1Style}>REPORTS</h1>
            <p style={subtitleStyle}>Summary of all competitive intelligence</p>
            {alerts.length === 0 ? (
              <div style={cardStyle}>
                <h3 style={h3Style}>NO DATA YET</h3>
                <p style={pStyle}>Run scans on your competitors to generate report data.</p>
                <button style={{ ...btnPrimaryStyle, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            ) : (
              <div style={cardStyle}>
                <h3 style={h3Style}>COMPETITIVE INTELLIGENCE REPORT</h3>
                <p style={{ fontSize: '11px', color: '#999', marginBottom: '20px' }}>Generated: {new Date().toLocaleDateString()} | {competitors.length} competitors | {alerts.length} scans</p>
                {competitors.map(c => {
                  const ca = alerts.filter(a => a.competitor === c.name);
                  if (ca.length === 0) return null;
                  return (
                    <div key={c.id} style={{ ...insightBox, marginBottom: '20px' }}>
                      <h4 style={h4Style}>{c.name}</h4>
                      <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 8px' }}>{c.website}</p>
                      {ca.slice(0, 2).map((alert, i) => (
                        <div key={i} style={{ marginBottom: '8px' }}>
                          <p style={{ fontSize: '12px', color: '#ccc' }}>Scan {i + 1}: {formatDate(alert.scrapedAt)}</p>
                          {alert.insights?.map((insight, j) => <p key={j} style={{ fontSize: '12px', color: '#999', margin: '2px 0 2px 12px' }}>• {insight.type}: {insight.items?.slice(0, 2).join(', ')}</p>)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activePage === 'settings' && (
          <div>
            <h1 style={h1Style}>SETTINGS</h1>
            <p style={subtitleStyle}>Configure your ARIA platform</p>
            <div style={cardStyle}>
              <h3 style={h3Style}>HOW TO USE ARIA</h3>
              <ol style={{ marginLeft: '20px', color: '#ccc', fontSize: '13px', lineHeight: '2.2' }}>
                <li>Go to <strong style={{ color: '#f5e6e0' }}>Competitors</strong> and add real competitor URLs</li>
                <li>Click <strong style={{ color: '#f5e6e0' }}>CHECK NOW</strong> to scan a competitor site</li>
                <li>View results in <strong style={{ color: '#f5e6e0' }}>Alerts</strong></li>
                <li>See data in <strong style={{ color: '#f5e6e0' }}>Analysis</strong> and <strong style={{ color: '#f5e6e0' }}>Reports</strong></li>
                <li>Click <strong style={{ color: '#f5e6e0' }}>SCAN ALL COMPETITORS</strong> to check everyone at once</li>
              </ol>
            </div>
            <div style={cardStyle}>
              <h3 style={h3Style}>ABOUT ARIA</h3>
              <p style={pStyle}><strong>ARIA</strong> — Adaptive Research Intelligence Assistant</p>
              <p style={{ ...pStyle, color: '#999' }}>VERSION: 1.0 (MVP) | STATUS: PRODUCTION READY</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

const h1Style = { fontSize: '28px', fontWeight: '400', marginBottom: '8px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' };
const subtitleStyle = { color: '#999', marginBottom: '32px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '32px' };
const statCard = { background: '#242424', border: '1px solid #333', borderRadius: '8px', padding: '24px' };
const statLabel = { fontSize: '10px', color: '#999', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' };
const statValue = { fontSize: '36px', fontWeight: '400', color: '#f5e6e0' };
const cardStyle = { background: '#242424', border: '1px solid #333', borderRadius: '8px', padding: '24px', marginBottom: '20px' };
const h3Style = { fontSize: '14px', fontWeight: '400', margin: '0 0 16px 0', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '0.5px' };
const h4Style = { fontSize: '12px', fontWeight: '500', margin: '0 0 8px 0', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.5px' };
const pStyle = { color: '#ccc', lineHeight: '1.6', marginBottom: '12px', fontSize: '13px' };
const insightBox = { borderLeft: '3px solid #f5e6e0', paddingLeft: '16px', marginBottom: '16px' };
const itemStyle = { background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '16px' };
const tagStyle = { display: 'inline-block', padding: '4px 12px', background: '#333', color: '#f5e6e0', border: '1px solid #f5e6e0', borderRadius: '12px', fontSize: '10px', marginRight: '6px', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const btnStyle = { padding: '10px 20px', border: '1px solid #f5e6e0', borderRadius: '6px', cursor: 'pointer', fontWeight: '400', fontSize: '12px', background: 'transparent', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit' };
const btnPrimaryStyle = { padding: '10px 20px', border: '1px solid #f5e6e0', borderRadius: '6px', cursor: 'pointer', fontWeight: '400', fontSize: '12px', background: '#f5e6e0', color: '#242424', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit' };
