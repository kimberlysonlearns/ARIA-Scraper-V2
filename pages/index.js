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
  'Weight Loss':          { bg: '#1e0a28', border: '#e0b0ff', text: '#e0b0ff' },
  'Muscle Growth':        { bg: '#0a1428', border: '#b0d4ff', text: '#b0d4ff' },
  'Recovery / Healing':   { bg: '#0a1e14', border: '#b0ffd8', text: '#b0ffd8' },
  'Anti-Aging':           { bg: '#281e0a', border: '#ffe0a0', text: '#ffe0a0' },
  'Cognitive / Focus':    { bg: '#0a2222', border: '#a0f0e8', text: '#a0f0e8' },
  'Hormonal / Metabolic': { bg: '#280a1e', border: '#ffb0e0', text: '#ffb0e0' },
  'Supplies':             { bg: '#141414', border: '#d8d8d8', text: '#d8d8d8' },
  'Other':                { bg: '#141414', border: '#d8d8d8', text: '#d8d8d8' },
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


function AllProductsTab({ competitors, scrapeResults, setActivePage }) {
  const [apFilter, setApFilter] = useState('ALL');
  const [apSort, setApSort] = useState('name');
  const [apSearch, setApSearch] = useState('');

// Build master product list from all scan results
const masterMap = {};
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
    if (!masterMap[key]) {
      masterMap[key] = {
        name,
        category: categorize(name),
        sites: {},
      };
    }
    if (price) masterMap[key].sites[c.name] = { price, value: priceVal };
  });
});

const allProducts = Object.values(masterMap);
const categories = ['ALL', ...new Set(allProducts.map(p => p.category))].sort();

const filtered = allProducts
  .filter(p => {
    const matchCat = apFilter === 'ALL' || p.category === apFilter;
    const matchSearch = !apSearch || p.name.toLowerCase().includes(apSearch.toLowerCase());
    return matchCat && matchSearch;
  })
  .sort((a, b) => {
    if (apSort === 'name') return a.name.localeCompare(b.name);
    if (apSort === 'category') return a.category.localeCompare(b.category);
    if (apSort === 'price') {
      const aMin = Math.min(...Object.values(a.sites).map(s => s.value || 999));
      const bMin = Math.min(...Object.values(b.sites).map(s => s.value || 999));
      return aMin - bMin;
    }
    if (apSort === 'sites') return Object.keys(b.sites).length - Object.keys(a.sites).length;
    return 0;
  });

const allSites = [...new Set(allProducts.flatMap(p => Object.keys(p.sites)))];

return (
  <div>
    <h1 style={H1}>ALL PRODUCTS</h1>
    <p style={SUB}>{allProducts.length} unique products detected across {competitors.filter(c => scrapeResults[c.id]?.success).length} scanned competitors</p>

    {allProducts.length === 0 ? (
      <div className="aria-card" style={CARD}>
        <h3 style={H3}>NO PRODUCTS YET</h3>
        <p style={P}>Scan at least one competitor to populate this list.</p>
        <button className="aria-btn-primary" style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
      </div>
    ) : (
      <>
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Unique Products', value: allProducts.length },
            { label: 'With Prices', value: allProducts.filter(p => Object.keys(p.sites).length > 0).length },
            { label: 'Categories', value: categories.length - 1 },
            { label: 'Sites Scanned', value: allSites.length },
          ].map((s, i) => (
            <div key={i} style={STAT_CARD}>
              <div style={STAT_LABEL}>{s.label}</div>
              <div style={{ fontSize: '28px', color: '#f5e6e0', marginTop: '6px', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text" placeholder="Search products..."
            value={apSearch} onChange={e => setApSearch(e.target.value)}
            style={{ flex: 1, minWidth: '180px', padding: '9px 14px', background: '#181818', border: '1px solid #333', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}
          />
          <select value={apSort} onChange={e => setApSort(e.target.value)}
            style={{ padding: '9px 12px', background: '#181818', border: '1px solid #333', borderRadius: '6px', color: '#aaa', fontSize: '12px', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>
            <option value="name">Sort: Name A–Z</option>
            <option value="category">Sort: Category</option>
            <option value="price">Sort: Price (low)</option>
            <option value="sites">Sort: Most sites</option>
          </select>
          <select value={apFilter} onChange={e => setApFilter(e.target.value)}
            style={{ padding: '9px 12px', background: '#181818', border: '1px solid #333', borderRadius: '6px', color: '#aaa', fontSize: '12px', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Product table */}
        <div className="aria-card" style={CARD}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${220 + 140 + allSites.length * 130}px` }}>
              <thead>
                <tr>
                  <th style={{ padding: '10px 14px', fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #252525', background: '#1a1a1a', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif", width: '220px' }}>Product</th>
                  <th style={{ padding: '10px 14px', fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #252525', background: '#1a1a1a', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif", width: '140px' }}>Category</th>
                  {allSites.map(site => (
                    <th key={site} style={{ padding: '10px 14px', fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #252525', background: '#1a1a1a', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif", width: '130px' }}>{site}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const cc = CATEGORY_COLORS[p.category] || CATEGORY_COLORS['Other'];
                  const sitePrices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                  const minPrice = sitePrices.length ? Math.min(...sitePrices) : null;
                  return (
                    <tr key={i} className="aria-row" style={{ background: i % 2 === 0 ? '#161616' : '#111' }}>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#eee', fontWeight: '500', borderBottom: '1px solid #1e1e1e', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>{p.name}</td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #1e1e1e' }}>
                        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '99px', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text, fontWeight: '600', whiteSpace: 'nowrap', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>{p.category}</span>
                      </td>
                      {allSites.map(site => {
                        const sd = p.sites[site];
                        const isLow = sd?.value && sd.value === minPrice && sitePrices.length > 1;
                        return (
                          <td key={site} style={{ padding: '10px 14px', fontSize: '13px', color: isLow ? '#b0ffd8' : sd ? '#ccc' : '#2a2a2a', fontWeight: isLow ? '600' : '400', borderBottom: '1px solid #1e1e1e', fontFamily: "'Century Gothic','Trebuchet MS',sans-serif" }}>
                            {sd ? sd.price : '—'}
                            {isLow && <span style={{ fontSize: '9px', marginLeft: '5px', color: '#40c080', fontWeight: '700' }}>LOW</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p style={{ ...P, textAlign: 'center', padding: '24px', color: '#444' }}>No products match your filters.</p>}
        </div>
      </>
    )}
  </div>
);
}

function PeptideGuideTab() {
  const FF = "'Century Gothic', 'Trebuchet MS', sans-serif";
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');

const PEPTIDES = [
  // ── WEIGHT LOSS ──────────────────────────────────────────
  { id:1, name:'Semaglutide', category:'Weight Loss', desc:'A GLP-1 receptor agonist that mimics the hormone released after eating. Signals the brain to reduce appetite and slows stomach emptying, making you feel fuller longer.', benefits:'Activates GLP-1 receptors to suppress appetite, slow gastric emptying, and improve insulin secretion — reducing caloric intake and improving glycaemic control.', simple:'It tells your brain you are full even when you have not eaten much, so you naturally eat less and lose weight.', dosage:'Start 0.25mg/week, increase to 0.5–2.4mg/week over 4–8 weeks.', notes:'Subcutaneous injection. Once weekly. Titrate slowly to reduce nausea. Cycle: ongoing with monitoring.' },
  { id:2, name:'Tirzepatide', category:'Weight Loss', desc:'Dual GLP-1 and GIP receptor agonist — targets two metabolic pathways simultaneously. More effective than Semaglutide for fat loss in clinical trials.', benefits:'Dual agonism of GLP-1 and GIP receptors enhances insulin secretion, reduces glucagon, slows gastric emptying, and improves fat oxidation more than single-agonist therapy.', simple:'It pushes two "eat less and burn fat" buttons at the same time instead of one, so it works even better than Semaglutide.', dosage:'Start 2.5mg/week, increase by 2.5mg every 4 weeks up to 15mg/week.', notes:'Subcutaneous injection. Once weekly. Slower titration reduces GI side effects.' },
  { id:3, name:'Retatrutide', category:'Weight Loss', desc:'Triple agonist targeting GLP-1, GIP, and glucagon receptors. The newest and most potent weight loss peptide class. Still in clinical trials but widely available.', benefits:'Triple receptor activation simultaneously reduces appetite via GLP-1/GIP, increases energy expenditure via glucagon receptor, and promotes visceral fat mobilisation.', simple:'It pushes three different fat-burning buttons at once — it is the most powerful weight loss peptide available right now.', dosage:'Start 2mg/week, increase gradually to 4–12mg/week over 3–6 months.', notes:'Subcutaneous injection. Longest titration period. Very powerful — start conservatively.' },
  { id:4, name:'Cagrilintide', category:'Weight Loss', desc:'Amylin analogue that works via a completely different pathway from GLP-1. Often combined with Semaglutide (CagriSema) for synergistic effects.', benefits:'Mimics amylin to suppress glucagon, slow gastric emptying, and reduce food intake via central satiety pathways — complementary to GLP-1 mechanisms.', simple:'Works like a second "stop eating" signal using a totally different system in your body, making it a great partner to Semaglutide.', dosage:'0.16–2.4mg/week, titrate over 16–32 weeks.', notes:'Subcutaneous injection. Frequently combined with Semaglutide for additive fat loss.' },
  { id:5, name:'AOD-9604', category:'Weight Loss', desc:'A modified fragment of human growth hormone (HGH) that specifically targets fat metabolism without affecting blood sugar or growth.', benefits:'Stimulates lipolysis (fat cell breakdown) and inhibits lipogenesis (new fat creation) via beta-3 adrenergic receptors, without IGF-1 stimulation or glycaemic impact.', simple:'It tells fat cells to melt away without messing with your blood sugar or making you grow taller — gentle and targeted fat loss.', dosage:'200–300mcg/day subcutaneous injection, taken fasted.', notes:'Best taken in the morning on an empty stomach. No need to cycle aggressively. Gentle and well-tolerated.' },

  // ── MUSCLE GROWTH ─────────────────────────────────────────
  { id:6, name:'MK-677 (Ibutamoren)', category:'Muscle Growth', desc:'A growth hormone secretagogue — stimulates the pituitary gland to release more natural GH and IGF-1. Oral tablet, not an injection.', benefits:'Mimics ghrelin to stimulate GH secretion from the pituitary, increasing downstream IGF-1 — promoting muscle protein synthesis, lipolysis, and anabolic recovery.', simple:'It tricks your body into making more of its own growth hormone, which helps build muscle, burn fat, and sleep deeper — all in a pill.', dosage:'10–25mg/day orally. Start at 10mg to assess hunger and water retention tolerance.', notes:'Oral. Can be taken daily. Causes significant hunger increase. Best taken before bed. Long-term cycles of 3–6 months are common.' },
  { id:7, name:'CJC-1295', category:'Muscle Growth', desc:'A GHRH (Growth Hormone Releasing Hormone) analogue that stimulates the pituitary to release GH pulses. Usually combined with Ipamorelin for synergistic effect.', benefits:'Binds GHRH receptors on the pituitary to amplify and extend GH pulse frequency and amplitude, raising IGF-1 levels for sustained anabolic and lipolytic effects.', simple:'It nudges your brain to send more "grow and repair" signals to your body, helping build muscle and burn fat over time.', dosage:'300mcg 2–3x/week (with DAC) or 100mcg 2–3x/day (without DAC).', notes:'Subcutaneous injection. Almost always stacked with Ipamorelin. DAC version is longer-acting and requires less frequent dosing.' },
  { id:8, name:'Ipamorelin', category:'Muscle Growth', desc:'A selective GHRP (Growth Hormone Releasing Peptide) that stimulates GH release with minimal side effects compared to older GHRPs. Considered the cleanest GH secretagogue.', benefits:'Selectively activates ghrelin receptors to produce clean GH pulses without elevating cortisol, prolactin, or ACTH — the safest GHRP available.', simple:'It sends a clean "release growth hormone now" message to your body without any of the unwanted side effects of older versions.', dosage:'200–300mcg 2–3x/day subcutaneous injection.', notes:'Best taken fasted or before bed. Almost always combined with CJC-1295. 3-month cycles with 1 month off.' },
  { id:9, name:'Tesamorelin', category:'Muscle Growth', desc:'A GHRH analogue FDA-approved for visceral fat reduction in HIV patients. Strong GH-stimulating effects with excellent safety profile.', benefits:'Stimulates endogenous GH secretion via GHRH receptors, significantly reducing visceral adipose tissue and improving lean body mass — FDA-approved with published clinical data.', simple:'An FDA-approved peptide that melts belly fat and helps build lean muscle — it is one of the most trusted and well-studied options available.', dosage:'1–2mg/day subcutaneous injection.', notes:'One of the most clinically validated peptides. Excellent for body recomposition. Standard cycle 3–6 months.' },
  { id:10, name:'IGF-1 LR3', category:'Muscle Growth', desc:'Insulin-like Growth Factor 1 — a downstream product of GH. Directly stimulates muscle cell growth and repair. More potent and targeted than GH.', benefits:'Binds IGF-1 receptors to directly stimulate myoblast proliferation, protein synthesis, and satellite cell activation — promoting both hypertrophy and hyperplasia.', simple:'It goes straight to your muscle cells and tells them to grow and multiply — faster and more directly than growth hormone itself.', dosage:'20–50mcg/day subcutaneous or intramuscular injection.', notes:'Short cycles of 4–6 weeks due to receptor desensitisation. Very powerful — start at lowest dose. Post-injection hyperglycemia possible.' },
  { id:11, name:'HGH (Human Growth Hormone)', category:'Muscle Growth', desc:'The actual growth hormone molecule. Stimulates IGF-1 production in the liver, drives muscle growth, fat breakdown, and cellular repair throughout the body.', benefits:'Stimulates hepatic IGF-1 synthesis, promotes lipolysis, enhances nitrogen retention, increases lean muscle mass, improves bone density and connective tissue repair.', simple:'This is the real growth hormone — it tells your liver to make the building blocks that grow muscle, burn fat, and repair everything in your body.', dosage:'1–4 IU/day subcutaneous injection. Split into 2 doses for best results.', notes:'Most effective taken fasted in AM or before bed. Long cycles of 3–6 months minimum to see full effects. Expensive — verify purity via lab results.' },

  // ── RECOVERY / HEALING ────────────────────────────────────
  { id:12, name:'BPC-157', category:'Recovery / Healing', desc:'Body Protection Compound — a synthetic peptide derived from a protein in gastric juice. One of the most researched healing peptides. Works by upregulating growth factor receptors and promoting angiogenesis.', benefits:'Upregulates VEGF and other growth factor receptors, promotes angiogenesis, modulates nitric oxide signalling, and accelerates tendon, ligament, muscle, and gut tissue repair.', simple:'Think of it as a repair crew that shows up at injuries and speeds up healing everywhere in your body — muscles, tendons, gut, and more.', dosage:'200–400mcg/day subcutaneous or oral. Systemic: injection near injury site. Gut: oral capsule.', notes:'Can be taken orally for gut issues or injected for systemic/musculoskeletal injuries. No known toxicity. Safe for extended use.' },
  { id:13, name:'TB-500 (Thymosin Beta-4)', category:'Recovery / Healing', desc:'A synthetic version of a protein found in high concentrations at injury sites. Promotes cell migration, blood vessel formation, and tissue regeneration throughout the body.', benefits:'Regulates actin polymerisation to promote cell migration and proliferation, stimulates angiogenesis, reduces pro-inflammatory cytokines, and accelerates systemic tissue regeneration.', simple:'It tells your body to send repair cells to everywhere that is damaged and helps grow new blood vessels to feed healing tissue — full-body recovery.', dosage:'2–2.5mg 2x/week during injury phase, then 2mg/week for maintenance.', notes:"Works systemically — doesn't need to be injected near injury site. Pairs extremely well with BPC-157. 4–6 week cycles." },
  { id:14, name:'BPC-157 + TB-500 Blend', category:'Recovery / Healing', desc:'The most popular healing stack. BPC-157 targets local tissue repair while TB-500 provides systemic healing — together they cover both mechanisms for faster recovery.', benefits:'Combined local tissue repair (BPC-157 via growth factor upregulation) and systemic cellular migration/angiogenesis (TB-500 via actin regulation) — dual-mechanism comprehensive recovery.', simple:'BPC-157 fixes the specific injury site while TB-500 heals your whole body at the same time — together they are the fastest recovery stack available.', dosage:'BPC-157 250mcg + TB-500 1.25mg per injection, 2x/week.', notes:'The gold standard recovery protocol. Widely used by athletes. 4–6 week cycles. Injectable or BPC-157 oral + TB-500 injectable.' },
  { id:15, name:'GHK-Cu (Copper Peptide)', category:'Recovery / Healing', desc:'A naturally occurring copper peptide found in human plasma, urine, and saliva. Powerful regenerative and anti-aging effects on skin and tissue.', benefits:'Activates TGF-beta and collagen gene expression, modulates MMP activity for tissue remodelling, promotes wound healing, stimulates hair follicle cycling, and reduces oxidative damage.', simple:'A copper-powered peptide that tells your skin and tissues to rebuild collagen, heal wounds faster, and even help hair grow — used in both injections and skin creams.', dosage:'1–2mg/day subcutaneous injection or topical application.', notes:'Available as injectable and topical cream. Dual use: systemic healing + cosmetic. Very well tolerated.' },
  { id:16, name:'LL-37', category:'Recovery / Healing', desc:'A human antimicrobial peptide (cathelicidin) with immune-modulating properties. Naturally produced by the immune system in response to infection.', benefits:'Disrupts bacterial membrane integrity, modulates TLR signalling to regulate inflammatory response, promotes keratinocyte migration for wound closure, and stimulates angiogenesis.', simple:'Your own immune system makes this to fight infections and heal wounds — this is just a concentrated version that gives those healing powers a boost.', dosage:'100–200mcg/day subcutaneous injection.', notes:'Particularly useful for chronic infections, wound healing, and immune support. Modulates rather than over-stimulates immune response.' },

  // ── ANTI-AGING ────────────────────────────────────────────
  { id:17, name:'Epitalon', category:'Anti-Aging', desc:'A tetrapeptide (4 amino acids) that stimulates the pineal gland to produce melatonin and regulate telomere length. Often called the "fountain of youth" peptide.', benefits:'Stimulates pineal melatonin synthesis, activates telomerase to elongate telomeres, regulates circadian rhythm, and reduces oxidative stress markers associated with cellular aging.', simple:'It lengthens the protective caps on your DNA (like the plastic tips on shoelaces) so your cells age more slowly — and helps you sleep better too.', dosage:'5–10mg/day for 10–20 days, 2–3 cycles/year.', notes:'Short intensive cycles rather than daily use. Injectable or nasal spray. Most studied anti-aging peptide.' },
  { id:18, name:'NAD+ (Nicotinamide Adenine Dinucleotide)', category:'Anti-Aging', desc:'A coenzyme found in every cell that declines with age. Critical for energy production, DNA repair, and cell signalling. One of the most researched longevity molecules.', benefits:'Essential cofactor for sirtuins and PARP enzymes involved in DNA repair, activates mitochondrial biogenesis, supports cellular redox reactions, and declines ~50% by age 60.', simple:'Every cell in your body uses this like a battery — when it runs low with age, everything slows down. Refilling it gives your cells energy to repair and run properly again.', dosage:'250–500mg/day oral or 500mg–1g IV infusion.', notes:'Oral has lower bioavailability than IV. NAD+ precursors (NMN, NR) are oral alternatives. Flush sensation common with rapid IV dosing.' },
  { id:19, name:'MOTS-c', category:'Anti-Aging', desc:'A mitochondria-derived peptide that acts as a metabolic regulator. Naturally produced in the body but declines with age. Activates AMPK pathway.', benefits:'Activates AMPK to regulate glucose and lipid metabolism, improves insulin sensitivity, enhances mitochondrial function, and mimics the metabolic benefits of exercise at a cellular level.', simple:'It is like telling your cells to act like they just exercised — better energy, better fat burning, better metabolism — even when you are resting.', dosage:'5–10mg 2–3x/week subcutaneous injection.', notes:'Exercise mimetic — enhances benefits of physical activity. Stack with other anti-aging peptides. Short cycles of 4–8 weeks.' },
  { id:20, name:'SS-31 (Elamipretide)', category:'Anti-Aging', desc:'A mitochondria-targeting tetrapeptide that binds to cardiolipin in the inner mitochondrial membrane. Protects and restores mitochondrial function.', benefits:'Binds cardiolipin to stabilise the inner mitochondrial membrane, preserves electron transport chain efficiency, reduces mitochondrial ROS production, and restores ATP synthesis in aged cells.', simple:'Mitochondria are the power plants of your cells — this peptide fixes the power plants so they stop leaking toxic waste and start making energy properly again.', dosage:'0.5–2mg/day subcutaneous injection.', notes:'One of the most exciting longevity peptides. Targets the root cause of cellular aging. Research ongoing. Very well tolerated.' },
  { id:21, name:'N-Acetyl Epitalon Amidate', category:'Anti-Aging', desc:'An enhanced, more stable form of Epitalon. The acetylation and amidation increase bioavailability and half-life, making it more effective at lower doses.', benefits:'Same telomerase activation and melatonin regulation as Epitalon but with superior receptor binding affinity, enhanced metabolic stability, and extended half-life due to N-acetylation and C-terminal amidation.', simple:'The upgraded version of Epitalon — same DNA-protecting benefits but your body absorbs it better and it stays active longer, so you need less of it.', dosage:'2–5mg/day for 10–20 days, 2–3 cycles/year.', notes:'More potent than standard Epitalon. Preferred by many practitioners for improved stability.' },

  // ── COGNITIVE / FOCUS ─────────────────────────────────────
  { id:22, name:'Semax', category:'Cognitive / Focus', desc:'A synthetic analogue of ACTH (adrenocorticotropic hormone) developed in Russia. Enhances BDNF (brain-derived neurotrophic factor) production and dopamine/serotonin activity.', benefits:'Increases BDNF expression to support neuronal survival and synaptic plasticity, upregulates dopaminergic and serotonergic neurotransmission, and exerts neuroprotective effects via reduced neuroinflammation.', simple:'It gives your brain a fertiliser boost — helping brain cells grow, communicate faster, and making you feel more focused and in a better mood.', dosage:'200–600mcg/day as nasal spray or subcutaneous injection.', notes:'Nasal spray is most common. Fast-acting. Russian research drug with decades of clinical use. Cycle 2–4 weeks on, 2 weeks off.' },
  { id:23, name:'N-Acetyl Semax Amidate', category:'Cognitive / Focus', desc:'Enhanced version of Semax with acetylation and amidation for increased stability and potency. More bioavailable and longer-lasting than standard Semax.', benefits:'All Semax mechanisms with enhanced CNS penetration, greater receptor binding affinity, and prolonged half-life — achieving equivalent effects at significantly lower doses.', simple:'The stronger version of Semax — crosses into the brain more easily and lasts longer, so a smaller amount gives you more focus and mental clarity.', dosage:'100–300mcg/day nasal spray.', notes:'More potent — start at lower doses. Preferred over standard Semax by many users.' },
  { id:24, name:'Selank', category:'Cognitive / Focus', desc:'A synthetic analogue of tuftsin — an immunomodulatory peptide. Anxiolytic (anti-anxiety) effects without sedation. Developed in Russia as an anti-anxiety agent.', benefits:'Modulates GABAergic and serotonergic systems to reduce anxiety, enhances BDNF expression, stabilises enkephalin metabolism to improve mood, and exerts anxiolysis without benzodiazepine-like sedation or dependency.', simple:'It calms anxiety and sharpens focus at the same time — like turning down the noise in your head without making you sleepy or addicted.', dosage:'250–300mcg/day nasal spray, 2–3x/day.', notes:'Excellent for stress and anxiety without benzodiazepine downsides. Stack with Semax for cognitive + anxiety relief. Gentle and well-tolerated.' },
  { id:25, name:'N-Acetyl Selank Amidate', category:'Cognitive / Focus', desc:'Enhanced form of Selank with superior stability and bioavailability. The amidated form has greater receptor affinity.', benefits:'All Selank mechanisms with improved enzymatic resistance, enhanced blood-brain barrier penetration, and greater GABAergic/serotonergic receptor binding affinity.', simple:'The upgraded Selank — gets into the brain more effectively and stays active longer, giving you calmer, clearer thinking with less product needed.', dosage:'100–200mcg/day nasal spray.', notes:'More potent than standard Selank — dose accordingly. Preferred form for consistent results.' },
  { id:26, name:'5-Amino-1MQ', category:'Cognitive / Focus', desc:'A small molecule NNMT inhibitor that affects nicotinamide metabolism and NAD+ levels. Emerging metabolic and cognitive enhancer.', benefits:'Inhibits NNMT enzyme to redirect nicotinamide into NAD+ synthesis, activating SIRT1 and improving mitochondrial efficiency — with emerging data on adipocyte reduction and potential cognitive benefits.', simple:'It blocks a "waste enzyme" in your body so more fuel gets converted into energy instead of thrown away — better metabolism and sharper thinking as a result.', dosage:'50–100mg orally or 10mg reconstituted vial.', notes:'Research compound. Effects on metabolism well studied. Take with food. Cycle 4–8 weeks.' },

  // ── HORMONAL / METABOLIC ─────────────────────────────────
  { id:27, name:'Melanotan-2', category:'Hormonal / Metabolic', desc:'A synthetic analogue of alpha-MSH (melanocyte-stimulating hormone). Stimulates melanin production and has aphrodisiac properties.', benefits:'Activates MC1R receptors to stimulate melanogenesis (melanin production), MC3R/MC4R to suppress appetite and increase lipolysis, and MC4R centrally for aphrodisiac effects.', simple:'It activates your skin tanning system without needing the sun, and also works on the brain to reduce hunger and increase libido.', dosage:'0.25–0.5mg subcutaneous injection, starting dose 0.1mg.', notes:'Start very low — nausea and facial flushing common at first. Tanning effect requires some UV exposure. Loading phase then maintenance.' },
  { id:28, name:'PT-141 (Bremelanotide)', category:'Hormonal / Metabolic', desc:'A melanocortin receptor agonist acting on the CNS to enhance sexual arousal — distinct from PDE5 inhibitors (Viagra). Works on brain pathways not blood flow.', benefits:'Activates hypothalamic MC4R receptors to increase dopaminergic activity in arousal pathways — addresses sexual dysfunction at the neurological level rather than via vasodilation.', simple:'Unlike Viagra which works on blood flow, this one works directly on the brain to turn on the desire and arousal centres — it works for both men and women.', dosage:'0.5–2mg subcutaneous injection or nasal spray, 1–2 hours before activity.', notes:'FDA-approved as Vyleesi for female sexual dysfunction. Brain-based not blood flow. Avoid if cardiovascular concerns.' },
  { id:29, name:'Thymosin Alpha-1', category:'Hormonal / Metabolic', desc:'A thymic peptide that modulates the immune system. Naturally produced in the thymus gland and declines with age. FDA-approved in some countries.', benefits:'Upregulates T-cell maturation and dendritic cell function, enhances NK cell cytotoxicity, modulates Th1/Th2 balance, and increases IL-2 and IFN-gamma production for antiviral and antitumour immunity.', simple:'It trains and strengthens your immune army — helping your body fight viruses, infections, and even support cancer treatment more effectively.', dosage:'1.6mg 2x/week subcutaneous injection.', notes:'Used clinically in hepatitis B/C and cancer treatment. 4–6 week cycles. Well-studied immune modulator with excellent safety profile.' },
  { id:30, name:'hCG (Human Chorionic Gonadotropin)', category:'Hormonal / Metabolic', desc:'A hormone that mimics LH (luteinising hormone) — stimulates the testes to produce testosterone. Used in TRT protocols to maintain testicular function.', benefits:'Mimics LH to stimulate Leydig cell testosterone synthesis and maintain intratesticular testosterone levels, preventing testicular atrophy and preserving spermatogenesis during exogenous androgen use.', simple:'Tells your testicles to keep working and making testosterone even when you are on TRT — prevents them from shrinking and keeps fertility options open.', dosage:'250–500 IU 2–3x/week subcutaneous injection.', notes:'Critical for men on TRT who want to preserve fertility. Requires prescription in most jurisdictions.' },
  { id:31, name:'Enclomiphene', category:'Hormonal / Metabolic', desc:'A selective estrogen receptor modulator (SERM) that increases LH and FSH, stimulating natural testosterone production. Oral tablet.', benefits:'Blocks oestrogen receptors at the hypothalamus to increase GnRH pulsatility, elevating LH and FSH to stimulate endogenous testosterone production without suppressing the HPG axis.', simple:'It tricks your brain into thinking your testosterone is low, so it sends more signals to naturally make more — without shutting down your own system like TRT can.', dosage:'12.5–25mg/day orally.', notes:'Oral. Preferred over Clomiphene as it lacks the estrogenic isomer. Used for hypogonadism and post-cycle therapy.' },
  { id:32, name:'KPV', category:'Hormonal / Metabolic', desc:'A tripeptide (Lys-Pro-Val) fragment of alpha-MSH with potent anti-inflammatory properties. Particularly effective for gut inflammation.', benefits:'Inhibits NF-kB pathway and pro-inflammatory cytokine production (IL-1β, TNF-α, IL-6), crosses the gut epithelial barrier intact, and reduces intestinal permeability in inflammatory bowel conditions.', simple:"A tiny 3-piece peptide that turns down the inflammation alarm in your gut — great for people with IBS, Crohn's, or any gut issues.", dosage:'300–500mcg/day oral or subcutaneous injection.', notes:"Oral works well for gut issues. Injectable for systemic effects. Very well tolerated. Can be used long-term." },
  { id:33, name:'VIP (Vasoactive Intestinal Peptide)', category:'Hormonal / Metabolic', desc:'A neuropeptide found throughout the nervous system and gut. Regulates immune function, inflammation, and smooth muscle. Promising for CIRS and mold illness.', benefits:'Activates VPAC receptors to suppress pro-inflammatory cytokines, relax smooth muscle, regulate TH17/Treg balance, and restore neuroendocrine signalling disrupted by biotoxin illness.', simple:'A neuropeptide that calms inflammation throughout the nervous system and gut — particularly important for people dealing with mold illness or CIRS.', dosage:'50mcg 2x/day nasal spray.', notes:'Primarily used via nasal spray. Important in CIRS protocols. Requires diagnosis-appropriate use.' },
  { id:34, name:'Pinealon', category:'Hormonal / Metabolic', desc:'A tripeptide (Glu-Asp-Arg) that targets brain cell activity, particularly pineal gland function. Russian-developed neuroprotective peptide.', benefits:'Penetrates the blood-brain barrier to modulate gene expression in neurons, reduces oxidative stress in brain tissue, supports pineal melatonin regulation, and demonstrates neuroprotective effects in aging models.', simple:'A peptide that crosses into the brain to protect brain cells from aging damage and help regulate your sleep hormone — used in intensive short cycles.', dosage:'10mg/day for 10 days, 2–4 cycles/year.', notes:'Short intensive cycles. Nasal spray or injection. Stack with Epitalon for comprehensive anti-aging protocol.' },
];

const categories = ['all', 'Weight Loss', 'Muscle Growth', 'Recovery / Healing', 'Anti-Aging', 'Cognitive / Focus', 'Hormonal / Metabolic'];

const filtered = PEPTIDES.filter(p => {
  const matchCat = activeCategory === 'all' || p.category === activeCategory;
  const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.benefits.toLowerCase().includes(search.toLowerCase());
  return matchCat && matchSearch;
});

const CC = CATEGORY_COLORS;
const catColor = (cat) => CC[cat] || CC['Other'];

return (
  <div>
    <h1 style={H1}>PEPTIDE GUIDE</h1>
    <p style={SUB}>Reference library — {PEPTIDES.length} peptides across {categories.length - 1} categories</p>

    {/* Search + filter */}
    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        type="text" placeholder="Search peptides or benefits..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{ flex: 1, minWidth: '200px', padding: '10px 14px', background: '#181818', border: '1px solid #333', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: FF }}
      />
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {categories.map(cat => {
          const cc = cat === 'all' ? { bg:'#181818', border:'#555', text:'#aaa' } : catColor(cat);
          const isActive = activeCategory === cat;
          return (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '99px', border: `1px solid ${isActive ? cc.border : '#333'}`, background: isActive ? cc.bg : 'transparent', color: isActive ? cc.text : '#666', cursor: 'pointer', fontFamily: FF, transition: 'all 0.15s', fontWeight: isActive ? '600' : '400' }}>
              {cat === 'all' ? `All (${PEPTIDES.length})` : cat}
            </button>
          );
        })}
      </div>
    </div>

    {/* Peptide cards */}
    <div style={{ display: 'grid', gap: '10px' }}>
      {filtered.map(p => {
        const cc = catColor(p.category);
        return (
          <div key={p.id} style={{ background: '#181818', border: '1px solid #252525', borderRadius: '8px', padding: '18px 20px', transition: 'border-color 0.15s' }}
            className="aria-card">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#f5e6e0', margin: 0, fontFamily: FF }}>{p.name}</h3>
              <span style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '99px', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text, fontWeight: '600', fontFamily: FF, whiteSpace: 'nowrap' }}>{p.category}</span>
            </div>

            {/* 4 columns of info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '5px', fontFamily: FF }}>What it is</div>
                <p style={{ fontSize: '12px', color: '#bbb', margin: 0, lineHeight: '1.6', fontFamily: FF }}>{p.desc}</p>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '8px', fontFamily: FF }}>Primary benefits</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '9px', color: cc.text, fontWeight: '600', letterSpacing: '0.5px', marginBottom: '3px', fontFamily: FF, opacity: 0.8 }}>MEDICAL</div>
                    <p style={{ fontSize: '12px', color: '#bbb', margin: 0, lineHeight: '1.6', fontFamily: FF }}>{p.benefits}</p>
                  </div>
                  {p.simple && (
                    <div style={{ borderTop: '1px solid #222', paddingTop: '8px' }}>
                      <div style={{ fontSize: '9px', color: cc.text, fontWeight: '600', letterSpacing: '0.5px', marginBottom: '3px', fontFamily: FF, opacity: 0.8 }}>SIMPLE</div>
                      <p style={{ fontSize: '12px', color: '#ddd', margin: 0, lineHeight: '1.6', fontFamily: FF }}>{p.simple}</p>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '5px', fontFamily: FF }}>Recommended dosage</div>
                <p style={{ fontSize: '12px', color: cc.text, margin: 0, lineHeight: '1.6', fontFamily: FF, fontWeight: '500' }}>{p.dosage}</p>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '5px', fontFamily: FF }}>Key notes</div>
                <p style={{ fontSize: '12px', color: '#bbb', margin: 0, lineHeight: '1.6', fontFamily: FF }}>{p.notes}</p>
              </div>
            </div>
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div style={{ ...CARD, textAlign: 'center', padding: '40px' }}>
          <p style={{ ...P, color: '#555' }}>No peptides found for "{search}"</p>
        </div>
      )}
    </div>
  </div>
);
}
function PricingTab() {
  const FF = "'Century Gothic', 'Trebuchet MS', sans-serif";
  const [activeView, setActiveView] = useState('products');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('ALL');
  const [supSearch, setSupSearch] = useState('');
  const [supType, setSupType] = useState('ALL');

  // ── PRODUCT PRICING DATA ─────────────────────────────────────────────
  // bulk_low / bulk_high = estimated per-mg cost from CN Tier 2 supplier (USD)
  // ruo_low / ruo_high   = typical RUO retail sell price per mg (USD)
  // margin               = estimated gross margin % at midpoint
  // moq_g                = typical minimum order quantity in grams from CN supplier
  // notes                = sourcing notes
  const PRODUCTS = [
    // Weight Loss
    { name:'Semaglutide',     cat:'Weight Loss', bulk_low:0.003, bulk_high:0.008, ruo_low:0.012, ruo_high:0.025, moq_g:1,   notes:'GLP-1. Patent pressure in US. CN supply abundant.' },
    { name:'Tirzepatide',     cat:'Weight Loss', bulk_low:0.004, bulk_high:0.010, ruo_low:0.015, ruo_high:0.030, moq_g:1,   notes:'Dual GLP-1/GIP. Eli Lilly pressure on US vendors.' },
    { name:'Retatrutide',     cat:'Weight Loss', bulk_low:0.006, bulk_high:0.014, ruo_low:0.014, ruo_high:0.028, moq_g:1,   notes:'Triple agonist. Newer compound, smaller CN supply.' },
    { name:'Cagrilintide',    cat:'Weight Loss', bulk_low:0.005, bulk_high:0.012, ruo_low:0.012, ruo_high:0.020, moq_g:1,   notes:'Amylin analogue. Often sold as CagriSema blend.' },
    { name:'AOD-9604',        cat:'Weight Loss', bulk_low:0.003, bulk_high:0.007, ruo_low:0.008, ruo_high:0.015, moq_g:5,   notes:'HGH fragment. Commoditised, lots of CN supply.' },
    // Muscle Growth
    { name:'BPC-157',         cat:'Recovery',    bulk_low:0.001, bulk_high:0.003, ruo_low:0.005, ruo_high:0.012, moq_g:5,   notes:'Most commoditised peptide. High CN supply, low cost.' },
    { name:'TB-500',          cat:'Recovery',    bulk_low:0.002, bulk_high:0.005, ruo_low:0.006, ruo_high:0.014, moq_g:5,   notes:'Thymosin B4. Category 2 FDA. Wide CN supply.' },
    { name:'BPC+TB Blend',    cat:'Recovery',    bulk_low:0.0015,bulk_high:0.004, ruo_low:0.005, ruo_high:0.011, moq_g:5,   notes:'Blended by RUO site. Cost = weighted avg of components.' },
    { name:'GHK-Cu',          cat:'Recovery',    bulk_low:0.001, bulk_high:0.003, ruo_low:0.005, ruo_high:0.015, moq_g:10,  notes:'Copper peptide. Also cosmetic market. Very cheap at scale.' },
    { name:'Ipamorelin',      cat:'Muscle',      bulk_low:0.001, bulk_high:0.003, ruo_low:0.006, ruo_high:0.013, moq_g:5,   notes:'GHRP. Commoditised. Usually sold with CJC-1295.' },
    { name:'CJC-1295',        cat:'Muscle',      bulk_low:0.002, bulk_high:0.005, ruo_low:0.008, ruo_high:0.016, moq_g:5,   notes:'GHRH analogue. DAC and no-DAC versions.' },
    { name:'CJC+Ipa Blend',   cat:'Muscle',      bulk_low:0.0015,bulk_high:0.004, ruo_low:0.007, ruo_high:0.014, moq_g:5,   notes:'Most popular GH stack. Blend = cost of both components.' },
    { name:'MK-677',          cat:'Muscle',      bulk_low:0.0005,bulk_high:0.002, ruo_low:0.002, ruo_high:0.006, moq_g:10,  notes:'Oral secretagogue. Not a peptide — small molecule. Very cheap.' },
    { name:'Tesamorelin',     cat:'Muscle',      bulk_low:0.005, bulk_high:0.012, ruo_low:0.015, ruo_high:0.035, moq_g:1,   notes:'FDA-approved API. More expensive to source, premium pricing.' },
    { name:'IGF-1 LR3',       cat:'Muscle',      bulk_low:0.015, bulk_high:0.030, ruo_low:0.050, ruo_high:0.100, moq_g:0.1, notes:'Complex synthesis. Low MOQ available but expensive per mg.' },
    { name:'HGH',             cat:'Muscle',      bulk_low:0.010, bulk_high:0.025, ruo_low:0.030, ruo_high:0.080, moq_g:0.5, notes:'Full HGH molecule. Complex. Requires cold chain shipping.' },
    // Anti-Aging
    { name:'Epitalon',        cat:'Anti-Aging',  bulk_low:0.001, bulk_high:0.003, ruo_low:0.003, ruo_high:0.008, moq_g:5,   notes:'Tetrapeptide. Very cheap to synthesise. High margin possible.' },
    { name:'NAD+',            cat:'Anti-Aging',  bulk_low:0.00005,bulk_high:0.0002,ruo_low:0.0002,ruo_high:0.0005,moq_g:100, notes:'Not a peptide — small molecule. Priced per mg but sold in 500mg+ vials.' },
    { name:'GHK-Cu',          cat:'Anti-Aging',  bulk_low:0.001, bulk_high:0.003, ruo_low:0.005, ruo_high:0.015, moq_g:10,  notes:'Dual listing — cosmetic + anti-aging market overlap.' },
    { name:'MOTS-c',          cat:'Anti-Aging',  bulk_low:0.003, bulk_high:0.008, ruo_low:0.008, ruo_high:0.018, moq_g:1,   notes:'Mitochondria-derived peptide. Growing demand.' },
    { name:'SS-31',           cat:'Anti-Aging',  bulk_low:0.004, bulk_high:0.010, ruo_low:0.010, ruo_high:0.020, moq_g:1,   notes:'Cardiolipin-targeting. Research-grade compound.' },
    // Cognitive
    { name:'Semax',           cat:'Cognitive',   bulk_low:0.001, bulk_high:0.003, ruo_low:0.002, ruo_high:0.006, moq_g:5,   notes:'Russian-developed. Cheap to source, sold in large (25mg) vials.' },
    { name:'Selank',          cat:'Cognitive',   bulk_low:0.001, bulk_high:0.003, ruo_low:0.003, ruo_high:0.007, moq_g:5,   notes:'Anxiolytic peptide. Similar cost/margin profile to Semax.' },
    { name:'5-Amino-1MQ',     cat:'Cognitive',   bulk_low:0.0002,bulk_high:0.001, ruo_low:0.001, ruo_high:0.003, moq_g:10,  notes:'NNMT inhibitor small molecule. Oral. Very low bulk cost.' },
    // Hormonal
    { name:'PT-141',          cat:'Hormonal',    bulk_low:0.001, bulk_high:0.003, ruo_low:0.005, ruo_high:0.010, moq_g:5,   notes:'FDA-approved Vyleesi. Strong demand. Good margin.' },
    { name:'Melanotan-2',     cat:'Hormonal',    bulk_low:0.0005,bulk_high:0.002, ruo_low:0.003, ruo_high:0.007, moq_g:10,  notes:'Most commoditised tanning peptide. Extremely cheap.' },
    { name:'Thymosin Alpha-1',cat:'Hormonal',    bulk_low:0.003, bulk_high:0.008, ruo_low:0.008, ruo_high:0.018, moq_g:1,   notes:'Immune modulator. FDA-approved in some countries.' },
    { name:'KPV',             cat:'Hormonal',    bulk_low:0.001, bulk_high:0.003, ruo_low:0.003, ruo_high:0.007, moq_g:5,   notes:'Tripeptide. Very short chain = cheap to synthesise.' },
  ];

  const SUPPLIERS = [
    { name:'Shenzhen Jipeptide Biotechnology', city:'Shenzhen, Guangdong', type:'Manufacturer', products:['Custom peptides','GHK-Cu','NAD+','MT2','Selank','Semax','Bac water'], moq:'1–10g', contact:'Made-in-China', url:'https://mm.made-in-china.com/hot-china-products/Wholesale_Custom_Peptide.html', notes:'Custom synthesis + stock items. WeChat preferred.' },
    { name:'Wuhan Newtop Biotech', city:'Wuhan, Hubei', type:'Manufacturer', products:['GHK-Cu','Melanotan II','NAD+','Selank','Klow','Glow'], moq:'1g+', contact:'Made-in-China', url:'https://newtop-biotech.en.made-in-china.com', notes:'Diamond member, audited. Strong on cosmetic peptides.' },
    { name:'Changsha Duole Technology', city:'Changsha, Hunan', type:'Manufacturer', products:['Tirzepatide','Semaglutide','Retatrutide','Cagrilintide','NAD+','Copper peptide','Melanotan II'], moq:'Inquiry', contact:'ECHEMI', url:'https://www.echemi.com/supplier/pd2407221001-semaglutide-tirzepatide.html', notes:'Est. 2020. Strong GLP-1 range, synthetic biology platform.' },
    { name:'Qingdao Ania Biotechnology', city:'Qingdao, Shandong', type:'Manufacturer', products:['Retatrutide','MT2','API raw powder','Pharma intermediates'], moq:'Inquiry', contact:'Made-in-China', url:'https://mm.made-in-china.com/hot-china-products/Wholesale_Custom_Peptide.html', notes:'Full API range including newer GLP-1 compounds.' },
    { name:'Dingwang Technology (Wuhan)', city:'Wuhan, Hubei', type:'Manufacturer', products:['Pharma intermediates','Peptides','Nutritional supplements','Plant extracts'], moq:'Inquiry', contact:'ECHEMI', url:'https://www.echemi.com/supplier/pd2208011001-peptide.html', notes:'Traffic hub location, broad pharmaceutical range.' },
    { name:'Xingtai Jiachuang Technology', city:'Xingtai, Hebei', type:'Trader', products:['Retatrutide','Tirzepatide','Semaglutide','BPC-157','TB-500','NAD+','Selank','Semax'], moq:'10 vials', contact:'Global Sources', url:'https://www.globalsources.com/manufacturers/peptide.html', notes:'Full hot peptide range, fast delivery focus.' },
    { name:'Huaian Hanyou Peptide', city:'Huaian, Jiangsu', type:'Manufacturer', products:['BPC-157','TB-500','BPC+TB blend'], moq:'10 vials', contact:'Global Sources', url:'https://www.globalsources.com/china-suppliers/bpc-157-powder.htm', notes:'40 employees, specialises in BPC/TB recovery range.' },
    { name:'Pengting Peptide', city:'China', type:'Manufacturer', products:['Tirzepatide','Semaglutide','Retatrutide','GHK-Cu','Custom peptides'], moq:'50g trial', contact:'Direct website', url:'https://pengtingpeptide.com/', notes:'GMP + ISO certified. Targets pharma/biotech buyers.' },
    { name:'Zhengzhou Qinghuayuan', city:'Zhengzhou, Henan', type:'Manufacturer', products:['BPC-157','TB-500','Full peptide range'], moq:'Inquiry', contact:'Alibaba/MIC', url:'https://www.alibaba.com/peptides-bpc-157-suppliers.html', notes:'$740k+ revenue, large scale, 4300m² facility.' },
    { name:'Nanjing Top Speed International', city:'Nanjing, Jiangsu', type:'Trader', products:['Cagrilintide','NAD+','Semax','Selank','LL-37','ARA-290','VIP','MT2','SS-31'], moq:'Inquiry', contact:'Made-in-China', url:'https://njtopsi.en.made-in-china.com', notes:'Gold member, audited. Broad rare peptide stock.' },
    { name:'Peptide Co. Ltd (Shanghai)', city:'Jinshan, Shanghai', type:'Manufacturer', products:['Semaglutide','Tirzepatide','Retatrutide'], moq:'Inquiry', contact:'Made-in-China', url:'https://www.made-in-china.com/showroom/peptidessupplier/', notes:'100M+ annual output. GLP-1 specialist. 10+ production lines.' },
    { name:'Alibaba — Peptides', city:'Global', type:'Platform', products:['All peptides'], moq:'Varies', contact:'RFQ system', url:'https://www.alibaba.com/peptide-suppliers.html', notes:'Largest B2B marketplace. 100+ peptide suppliers.' },
    { name:'Made-in-China — Peptides', city:'Global', type:'Platform', products:['All peptides'], moq:'Varies', contact:'Inquiry form', url:'https://www.made-in-china.com/manufacturers/peptides-for-sale.html', notes:'More manufacturers vs traders. Good for audited suppliers.' },
    { name:'Global Sources — Peptides', city:'Global', type:'Platform', products:['All peptides'], moq:'Varies', contact:'RFQ system', url:'https://www.globalsources.com/manufacturers/peptide.html', notes:'B2B platform with verified supplier ratings.' },
    { name:'ECHEMI — Peptides', city:'Global', type:'Platform', products:['All peptides'], moq:'Varies', contact:'RFQ system', url:'https://www.echemi.com/supplier/pd2208011001-peptide.html', notes:'Chemical-focused. Good for API raw powder inquiries.' },
  ];

  const CATS = ['ALL','Weight Loss','Recovery','Muscle','Anti-Aging','Cognitive','Hormonal'];
  const TYPES = ['ALL','Manufacturer','Trader','Platform'];

  const filteredProducts = PRODUCTS.filter(p => {
    const ms = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const mc = activeCat === 'ALL' || p.cat === activeCat;
    return ms && mc;
  });

  const filteredSuppliers = SUPPLIERS.filter(s => {
    const ms = !supSearch || s.name.toLowerCase().includes(supSearch.toLowerCase()) || s.products.some(p => p.toLowerCase().includes(supSearch.toLowerCase()));
    const mt = supType === 'ALL' || s.type === supType;
    return ms && mt;
  });

  const midMargin = (p) => {
    const bulkMid = (p.bulk_low + p.bulk_high) / 2;
    const ruoMid  = (p.ruo_low  + p.ruo_high)  / 2;
    return ruoMid > 0 ? Math.round(((ruoMid - bulkMid) / ruoMid) * 100) : 0;
  };

  const TH = { padding:'9px 12px', fontSize:'10px', fontWeight:'600', color:'#666', textTransform:'uppercase', letterSpacing:'1px', background:'#1a1a1a', borderBottom:'1px solid #252525', textAlign:'left', whiteSpace:'nowrap', fontFamily:FF };
  const TD = { padding:'9px 12px', fontSize:'13px', borderBottom:'1px solid #1e1e1e', fontFamily:FF, verticalAlign:'middle' };

  const catColor = (cat) => CATEGORY_COLORS[cat] || CATEGORY_COLORS['Other'] || { bg:'#141414', border:'#888', text:'#888' };

  const typePill = (type) => {
    const colors = { Manufacturer:{ bg:'#0a1e14', border:'#b0ffd8', text:'#b0ffd8' }, Trader:{ bg:'#281e0a', border:'#ffe0a0', text:'#ffe0a0' }, Platform:{ bg:'#0a1428', border:'#b0d4ff', text:'#b0d4ff' } };
    const c = colors[type] || colors.Trader;
    return <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'99px', background:c.bg, border:`1px solid ${c.border}`, color:c.text, fontWeight:'600', fontFamily:FF }}>{type}</span>;
  };

  const marginColor = (m) => m >= 75 ? '#b0ffd8' : m >= 50 ? '#ffe0a0' : '#ffb0e0';

  const viewBtn = (id, label) => (
    <span onClick={() => setActiveView(id)} style={{ fontSize:'12px', padding:'8px 18px', borderRadius:'6px', cursor:'pointer', userSelect:'none', fontFamily:FF, fontWeight:activeView===id?'600':'400',
      background: activeView===id ? '#f5e6e0' : 'transparent',
      border:`1px solid ${activeView===id ? '#f5e6e0' : '#333'}`,
      color: activeView===id ? '#181818' : '#888' }}>{label}</span>
  );

  return (
    <div>
      <h1 style={H1}>PRICING INTELLIGENCE</h1>
      <p style={SUB}>Bulk API costs, estimated margins, and Tier 2 supplier directory</p>

      {/* View toggle */}
      <div style={{ display:'flex', gap:'8px', marginBottom:'24px' }}>
        {viewBtn('products', 'PRODUCT MARGINS')}
        {viewBtn('suppliers', 'SUPPLIER DIRECTORY')}
      </div>

      {/* ── PRODUCTS VIEW ─────────────────────────────────────── */}
      {activeView === 'products' && (
        <div>
          {/* Info callout */}
          <div style={{ background:'#0a1e14', border:'1px solid #1a3a2a', borderRadius:'8px', padding:'12px 16px', marginBottom:'20px', display:'flex', gap:'10px', alignItems:'flex-start' }}>
            <span style={{ color:'#b0ffd8', fontSize:'15px' }}>ℹ</span>
            <p style={{ fontSize:'12px', color:'#6a9a7a', margin:0, lineHeight:'1.6', fontFamily:FF }}>
              Bulk cost = estimated per-mg price from CN Tier 2 API supplier at small MOQ (1–10g). RUO sell price = typical retail per-mg on US/CA research sites. Margins are estimated midpoints — actual margins depend on your vial size, lyophilisation cost, overhead, and shipping. Use as a starting benchmark only.
            </p>
          </div>

          {/* Controls */}
          <div style={{ display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
            <input type="text" placeholder="Search product..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{ flex:1, minWidth:'160px', padding:'8px 12px', background:'#181818', border:'1px solid #333', borderRadius:'6px', color:'#fff', fontSize:'13px', fontFamily:FF }} />
          </div>
          <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap' }}>
            {CATS.map(c => {
              const cc = c !== 'ALL' ? catColor(c) : null;
              const isActive = activeCat === c;
              return (
                <span key={c} onClick={() => setActiveCat(c)} style={{ fontSize:'11px', padding:'4px 12px', borderRadius:'99px', cursor:'pointer', userSelect:'none',
                  background: isActive && cc ? cc.bg : isActive ? '#f5e6e0' : 'transparent',
                  border:`1px solid ${isActive && cc ? cc.border : isActive ? '#f5e6e0' : '#333'}`,
                  color: isActive && cc ? cc.text : isActive ? '#181818' : '#888', fontFamily:FF, fontWeight:isActive?'600':'400' }}>{c}</span>
              );
            })}
          </div>

          {/* Table */}
          <div style={{ ...CARD, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'820px' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width:'160px' }}>Product</th>
                  <th style={{ ...TH, width:'100px' }}>Category</th>
                  <th style={{ ...TH, width:'140px' }}>Bulk Cost (CN API)</th>
                  <th style={{ ...TH, width:'140px' }}>RUO Sell Price</th>
                  <th style={{ ...TH, width:'90px' }}>Est. Margin</th>
                  <th style={{ ...TH, width:'80px' }}>Min MOQ</th>
                  <th style={{ ...TH }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...TD, textAlign:'center', padding:'32px', color:'#444' }}>No results.</td></tr>
                ) : filteredProducts.map((p, i) => {
                  const cc = catColor(p.cat);
                  const m = midMargin(p);
                  return (
                    <tr key={i} className="aria-row" style={{ background: i%2===0 ? '#161616' : '#111' }}>
                      <td style={{ ...TD, fontWeight:'500', color:'#eee' }}>{p.name}</td>
                      <td style={TD}>
                        <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'99px', background:cc.bg, border:`1px solid ${cc.border}`, color:cc.text, fontWeight:'600', fontFamily:FF }}>{p.cat}</span>
                      </td>
                      <td style={TD}>
                        <span style={{ color:'#ffb0e0', fontWeight:'500' }}>${p.bulk_low.toFixed(4)}</span>
                        <span style={{ color:'#444', fontSize:'11px' }}> – </span>
                        <span style={{ color:'#ffb0e0', fontWeight:'500' }}>${p.bulk_high.toFixed(4)}</span>
                        <span style={{ color:'#555', fontSize:'11px' }}>/mg</span>
                      </td>
                      <td style={TD}>
                        <span style={{ color:'#b0ffd8', fontWeight:'500' }}>${p.ruo_low.toFixed(4)}</span>
                        <span style={{ color:'#444', fontSize:'11px' }}> – </span>
                        <span style={{ color:'#b0ffd8', fontWeight:'500' }}>${p.ruo_high.toFixed(4)}</span>
                        <span style={{ color:'#555', fontSize:'11px' }}>/mg</span>
                      </td>
                      <td style={TD}>
                        <span style={{ fontSize:'15px', fontWeight:'700', color:marginColor(m) }}>{m}%</span>
                        <div style={{ marginTop:'3px', height:'4px', background:'#222', borderRadius:'2px', width:'60px' }}>
                          <div style={{ height:'4px', borderRadius:'2px', width:`${Math.min(m,100)}%`, background:marginColor(m), transition:'width 0.3s' }} />
                        </div>
                      </td>
                      <td style={{ ...TD, color:'#aaa', fontSize:'12px' }}>{p.moq_g}g</td>
                      <td style={{ ...TD, fontSize:'11px', color:'#555', lineHeight:'1.5' }}>{p.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ ...P, fontSize:'11px', color:'#444', marginTop:'10px' }}>
            All prices estimated April 2026. Bulk cost based on CN Tier 2 API supplier quotes and market research. RUO sell price from live scrapes of US/CA research sites. Actual margins will vary with vial size, lyophilisation, labour, and overhead.
          </p>
        </div>
      )}

      {/* ── SUPPLIERS VIEW ────────────────────────────────────── */}
      {activeView === 'suppliers' && (
        <div>
          <div style={{ background:'#0a1428', border:'1px solid #1a2a3a', borderRadius:'8px', padding:'12px 16px', marginBottom:'20px', display:'flex', gap:'10px', alignItems:'flex-start' }}>
            <span style={{ color:'#b0d4ff', fontSize:'15px' }}>ℹ</span>
            <p style={{ fontSize:'12px', color:'#6a7a9a', margin:0, lineHeight:'1.6', fontFamily:FF }}>
              These are the Tier 2 Chinese bulk API suppliers that RUO sites source from. Pricing is quote-only — submit an RFQ via their platform, request a 1–5g sample with COA, then negotiate.
            </p>
          </div>
          <div style={{ display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
            <input type="text" placeholder="Search by name or product..." value={supSearch} onChange={e=>setSupSearch(e.target.value)}
              style={{ flex:1, minWidth:'200px', padding:'8px 12px', background:'#181818', border:'1px solid #333', borderRadius:'6px', color:'#fff', fontSize:'13px', fontFamily:FF }} />
          </div>
          <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap' }}>
            {TYPES.map(t => (
              <span key={t} onClick={() => setSupType(t)} style={{ fontSize:'11px', padding:'4px 12px', borderRadius:'99px', cursor:'pointer', userSelect:'none',
                background: supType===t ? '#f5e6e0' : 'transparent', border:`1px solid ${supType===t ? '#f5e6e0' : '#333'}`,
                color: supType===t ? '#181818' : '#888', fontFamily:FF, fontWeight:supType===t?'600':'400' }}>
                {t === 'ALL' ? 'All types' : t}
              </span>
            ))}
          </div>
          <div style={{ ...CARD, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'780px' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width:'200px' }}>Company</th>
                  <th style={{ ...TH, width:'140px' }}>Location</th>
                  <th style={{ ...TH, width:'90px' }}>Type</th>
                  <th style={{ ...TH, width:'220px' }}>Key Products</th>
                  <th style={{ ...TH, width:'80px' }}>MOQ</th>
                  <th style={{ ...TH, width:'80px' }}>Contact via</th>
                  <th style={{ ...TH, width:'60px' }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...TD, textAlign:'center', padding:'32px', color:'#444' }}>No results.</td></tr>
                ) : filteredSuppliers.map((s,i) => (
                  <tr key={i} className="aria-row" style={{ background: i%2===0 ? '#161616' : '#111' }}>
                    <td style={TD}>
                      <div style={{ fontWeight:'500', color:'#eee', marginBottom:'2px', fontFamily:FF }}>{s.name}</div>
                      {s.notes && <div style={{ fontSize:'11px', color:'#555', lineHeight:'1.4', fontFamily:FF }}>{s.notes}</div>}
                    </td>
                    <td style={{ ...TD, color:'#888', fontSize:'12px' }}>{s.city}</td>
                    <td style={TD}>{typePill(s.type)}</td>
                    <td style={TD}>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
                        {s.products.slice(0,4).map((p,j) => (
                          <span key={j} style={{ fontSize:'10px', padding:'2px 6px', borderRadius:'4px', background:'#222', border:'1px solid #2a2a2a', color:'#aaa', fontFamily:FF }}>{p}</span>
                        ))}
                        {s.products.length > 4 && <span style={{ fontSize:'10px', color:'#555', padding:'2px 4px', fontFamily:FF }}>+{s.products.length-4} more</span>}
                      </div>
                    </td>
                    <td style={{ ...TD, color:'#ccc', fontSize:'12px' }}>{s.moq}</td>
                    <td style={{ ...TD, color:'#888', fontSize:'12px' }}>{s.contact}</td>
                    <td style={TD}>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize:'11px', color:'#b0d4ff', textDecoration:'none', padding:'3px 8px', border:'1px solid #1a2a3a', borderRadius:'4px', background:'#0a1428', fontFamily:FF, whiteSpace:'nowrap' }}>→ visit</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reputation Section Component ─────────────────────────────────────
function ReputationSection({ competitors, reputationData, getRepK, StarRating, ROW_LABEL, COL_HEAD, CELL, F, MarketBadge, None }) {
  const [redditPosts, setRedditPosts] = useState({});
  const [redditLoading, setRedditLoading] = useState({});
  const [summaries, setSummaries] = useState({});
  const [summaryLoading, setSummaryLoading] = useState({});
  const [expandedComp, setExpandedComp] = useState(null);

  const fetchReddit = async (competitorId, query) => {
    if (redditPosts[competitorId] !== undefined || redditLoading[competitorId]) return;
    setRedditLoading(prev => ({ ...prev, [competitorId]: true }));
    try {
      const res = await fetch(`/api/reddit?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setRedditPosts(prev => ({ ...prev, [competitorId]: data.posts || [] }));
    } catch (e) {
      setRedditPosts(prev => ({ ...prev, [competitorId]: [] }));
    }
    setRedditLoading(prev => ({ ...prev, [competitorId]: false }));
  };

  const generateSummary = async (competitorId, competitorName, posts, trustpilot) => {
    if (summaries[competitorId] || summaryLoading[competitorId]) return;
    setSummaryLoading(prev => ({ ...prev, [competitorId]: true }));
    try {
      const postText = posts.slice(0, 6).map(p => `- "${p.title}" (r/${p.subreddit}, ${p.created}): ${p.selftext}`).join('\n');
      const tpText = trustpilot ? `Trustpilot: ${trustpilot.stars}/5 stars from ${trustpilot.count} reviews.` : 'No Trustpilot profile found.';
      const prompt = `You are a competitive intelligence analyst reviewing a peptide research chemical vendor called "${competitorName}". ${tpText}\n\nRecent Reddit posts mentioning them:\n${postText || 'No Reddit posts found in the past year.'}\n\nWrite a concise 3-sentence summary: (1) overall reputation and trust level, (2) most common customer praise or complaint, (3) any red flags or standout advantages. Be direct and analytical.`;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await response.json();
      const text = data?.content?.[0]?.text || 'Could not generate summary.';
      setSummaries(prev => ({ ...prev, [competitorId]: text }));
    } catch (e) {
      setSummaries(prev => ({ ...prev, [competitorId]: 'API error — try again.' }));
    }
    setSummaryLoading(prev => ({ ...prev, [competitorId]: false }));
  };

  const handleExpand = (c) => {
    const rep = getRepK(c);
    if (expandedComp === c.id) { setExpandedComp(null); return; }
    setExpandedComp(c.id);
    fetchReddit(c.id, rep.redditQuery);
  };

  const FF = "'Century Gothic', 'Trebuchet MS', sans-serif";

  return (
    <div style={{ background:'#181818', border:'1px solid #2a2a2a', borderRadius:'8px', marginBottom:'14px', overflow:'hidden' }}>
      <div style={{ padding:'10px 16px', background:'#1e1e1e', borderBottom:'1px solid #2a2a2a', fontSize:'11px', fontWeight:'600', color:'#bbb', textTransform:'uppercase', letterSpacing:'1px', fontFamily:F }}>
        Reputation & Reviews
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...ROW_LABEL, borderTop:'none', background:'#1a1a1a', width:'160px' }}></th>
              {competitors.map(c => (
                <th key={c.id} style={{ ...COL_HEAD, borderTop:'none', textAlign:'center' }}>
                  <div><MarketBadge country={c.country || 'US'} /></div>
                  <div>{c.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Trustpilot */}
            <tr>
              <td style={ROW_LABEL}>Trustpilot</td>
              {competitors.map(c => {
                const rep = getRepK(c);
                return (
                  <td key={c.id} style={{ ...CELL, textAlign:'center' }}>
                    {rep.trustpilot ? (
                      <div>
                        <StarRating stars={rep.trustpilot.stars} />
                        <div style={{ fontSize:'11px', color:'#666', fontFamily:F, marginTop:'2px' }}>{rep.trustpilot.count} reviews</div>
                        <a href={rep.trustpilotUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize:'10px', color:'#b0d4ff', textDecoration:'none', display:'inline-block', marginTop:'4px', padding:'2px 8px', border:'1px solid #1a2a3a', borderRadius:'4px', fontFamily:F }}>
                          VIEW →
                        </a>
                      </div>
                    ) : <None />}
                  </td>
                );
              })}
            </tr>
            {/* Forums */}
            <tr>
              <td style={ROW_LABEL}>Forums</td>
              {competitors.map(c => {
                const rep = getRepK(c);
                return (
                  <td key={c.id} style={CELL}>
                    {rep.forums && rep.forums.length > 0 ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                        {rep.forums.map((f, fi) => (
                          <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize:'11px', color:'#a0f0e8', textDecoration:'none', padding:'3px 8px', border:'1px solid #0a2222', borderRadius:'4px', background:'#0a1818', display:'block', fontFamily:F }}>
                            {f.name} →
                          </a>
                        ))}
                      </div>
                    ) : <None />}
                  </td>
                );
              })}
            </tr>
            {/* Reddit Posts */}
            <tr>
              <td style={ROW_LABEL}>Reddit Posts</td>
              {competitors.map(c => {
                const posts = redditPosts[c.id];
                const loading = redditLoading[c.id];
                const isExpanded = expandedComp === c.id;
                return (
                  <td key={c.id} style={{ ...CELL, textAlign:'center' }}>
                    <button onClick={() => handleExpand(c)}
                      style={{ fontSize:'11px', padding:'5px 10px', background: isExpanded ? '#1e0a28' : 'transparent', border:`1px solid ${isExpanded ? '#e0b0ff' : '#333'}`, borderRadius:'5px', color: isExpanded ? '#e0b0ff' : '#aaa', cursor:'pointer', fontFamily:F, letterSpacing:'0.5px' }}>
                      {loading ? 'LOADING...' : isExpanded ? 'HIDE ▲' : 'LOAD POSTS ▼'}
                    </button>
                    {isExpanded && (
                      <div style={{ marginTop:'10px', textAlign:'left' }}>
                        {loading && <div style={{ fontSize:'11px', color:'#555', fontFamily:F, padding:'8px' }}>Fetching from Reddit...</div>}
                        {!loading && posts && posts.length > 0 ? posts.map((p, pi) => (
                          <a key={pi} href={p.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', display:'block', marginBottom:'6px' }}>
                            <div style={{ background:'#111', border:'1px solid #1e1e1e', borderRadius:'5px', padding:'8px 10px' }}>
                              <div style={{ fontSize:'12px', color:'#ddd', fontFamily:F, lineHeight:'1.4', marginBottom:'4px' }}>{p.title}</div>
                              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                <span style={{ fontSize:'10px', color:'#555', fontFamily:F }}>r/{p.subreddit}</span>
                                <span style={{ fontSize:'10px', color:'#555', fontFamily:F }}>{p.created} · ↑{p.score}</span>
                              </div>
                            </div>
                          </a>
                        )) : (!loading && posts !== undefined && (
                          <div style={{ fontSize:'12px', color:'#555', fontFamily:F, padding:'8px' }}>No recent posts found.</div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
            {/* AI Summary */}
            <tr>
              <td style={ROW_LABEL}>AI Summary</td>
              {competitors.map(c => {
                const rep = getRepK(c);
                const summary = summaries[c.id];
                const loading = summaryLoading[c.id];
                const posts = redditPosts[c.id];
                const postsLoaded = posts !== undefined;
                return (
                  <td key={c.id} style={CELL}>
                    {!summary && !loading && (
                      <button
                        onClick={() => postsLoaded ? generateSummary(c.id, c.name, posts, rep.trustpilot) : null}
                        style={{ fontSize:'11px', padding:'5px 10px', background:'transparent', border:`1px solid ${postsLoaded ? '#2a3a2a' : '#222'}`, borderRadius:'5px', color: postsLoaded ? '#b0ffd8' : '#444', cursor: postsLoaded ? 'pointer' : 'default', fontFamily:F, letterSpacing:'0.5px', display:'block', width:'100%' }}>
                        {postsLoaded ? 'GENERATE SUMMARY ✦' : 'LOAD POSTS FIRST'}
                      </button>
                    )}
                    {loading && (
                      <div style={{ fontSize:'11px', color:'#555', fontFamily:F, fontStyle:'italic' }}>Analysing...</div>
                    )}
                    {summary && (
                      <div>
                        <div style={{ fontSize:'12px', color:'#ccc', fontFamily:F, lineHeight:'1.7' }}>{summary}</div>
                        <button onClick={() => setSummaries(prev => { const n={...prev}; delete n[c.id]; return n; })}
                          style={{ fontSize:'9px', color:'#555', background:'none', border:'none', cursor:'pointer', fontFamily:F, marginTop:'6px', padding:0 }}>
                          regenerate
                        </button>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Home() {
  const [activePage, setActivePage] = useState('dashboard');
  const [competitors, setCompetitors] = useState([]);
  const [scrapeResults, setScrapeResults] = useState({});
  const [prevScrapeResults, setPrevScrapeResults] = useState({});
  const [priceChanges, setPriceChanges] = useState([]);
  const [cadUsdRate, setCadUsdRate] = useState(0.72);
  const [editingCompetitor, setEditingCompetitor] = useState(null);
  const [aboutOpen, setAboutOpen] = useState({});
  const [productsOpen, setProductsOpen] = useState({});
  const [compNotes, setCompNotes] = useState({});
  const [scanHistory, setScanHistory] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', website: '', country: '' });
  const [scraping, setScraping] = useState({});
  const [analysisFilter, setAnalysisFilter] = useState('ALL');
  const [analysisSortBy, setAnalysisSortBy] = useState('name');
  const [analysisMarket, setAnalysisMarket] = useState('ALL');
  const [intelMarket, setIntelMarket] = useState('ALL');
  const [communityScans, setCommunityScans] = useState({});
  const [lastScanTime, setLastScanTime] = useState(null);
  const [scanCooldown, setScanCooldown] = useState(0);
  useEffect(() => {
    if (scanCooldown <= 0) return;
    const t = setInterval(() => setScanCooldown(p => { if (p <= 1) { clearInterval(t); return 0; } return p - 1; }), 1000);
    return () => clearInterval(t);
  }, [scanCooldown]);

  // ── Persist to localStorage ──────────────────────────────────────
  useEffect(() => {
    try {
      const c = localStorage.getItem('aria_competitors'); if (c) setCompetitors(JSON.parse(c));
      const rate = localStorage.getItem('aria_cad_usd'); if (rate) setCadUsdRate(parseFloat(rate));
      const n = localStorage.getItem('aria_comp_notes'); if (n) setCompNotes(JSON.parse(n));
      const sh = localStorage.getItem('aria_scan_history'); if (sh) setScanHistory(JSON.parse(sh));
      const r = localStorage.getItem('aria_results'); if (r) setScrapeResults(JSON.parse(r));
      const p = localStorage.getItem('aria_prev_results'); if (p) setPrevScrapeResults(JSON.parse(p));
      const ch = localStorage.getItem('aria_changes'); if (ch) setPriceChanges(JSON.parse(ch));
    } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem('aria_competitors', JSON.stringify(competitors)); } catch {} }, [competitors]);
  useEffect(() => { try { localStorage.setItem('aria_cad_usd', String(cadUsdRate)); } catch {} }, [cadUsdRate]);
  useEffect(() => { try { localStorage.setItem('aria_comp_notes', JSON.stringify(compNotes)); } catch {} }, [compNotes]);
  useEffect(() => { try { localStorage.setItem('aria_scan_history', JSON.stringify(scanHistory)); } catch {} }, [scanHistory]);
  useEffect(() => { try { localStorage.setItem('aria_results', JSON.stringify(scrapeResults)); } catch {} }, [scrapeResults]);
  useEffect(() => { try { localStorage.setItem('aria_prev_results', JSON.stringify(prevScrapeResults)); } catch {} }, [prevScrapeResults]);
  useEffect(() => { try { localStorage.setItem('aria_changes', JSON.stringify(priceChanges)); } catch {} }, [priceChanges]);

  const navItems = [
    { id: 'dashboard', label: 'DASHBOARD' },
    { id: 'competitors', label: 'COMPETITORS' },
    { id: 'analysis', label: 'ANALYSIS' },
    { id: 'pricing', label: 'PRICING' },
    { id: 'marketintel', label: 'MARKET INTEL' },
    { id: 'communityintel', label: 'COMMUNITY INTEL' },
    { id: 'peptideguide', label: 'PEPTIDE GUIDE' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const handleAddCompetitor = () => {
    if (!form.name.trim()) { alert('Please enter a company name'); return; }
    if (!form.website.trim()) { alert('Please enter a website URL'); return; }
    if (!form.country) { alert('Please select a market (CA or US)'); return; }
    let website = form.website.trim();
    if (!website.startsWith('http')) website = 'https://' + website;
    setCompetitors(prev => [...prev, { id: Date.now(), name: form.name.toUpperCase(), website, items: 0, country: form.country || 'US', currency: form.country === 'CA' ? 'CAD' : 'USD' }]);
    setForm({ name: '', website: '', country: '' });
    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this competitor?')) return;
    setCompetitors(prev => prev.filter(c => c.id !== id));
    setScrapeResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPrevScrapeResults(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleEditSave = () => {
    if (!editingCompetitor) return;
    let website = editingCompetitor.website.trim();
    if (!website.startsWith('http')) website = 'https://' + website;
    setCompetitors(prev => prev.map(c => c.id === editingCompetitor.id
      ? { ...c, name: editingCompetitor.name.toUpperCase(), website, country: editingCompetitor.country, currency: editingCompetitor.country === 'CA' ? 'CAD' : 'USD' }
      : c
    ));
    setEditingCompetitor(null);
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

  const activeComparison = comparison;
  const allPrices = activeComparison.flatMap(p => Object.values(p.sites).map(s => s.value).filter(Boolean));

  // Cheapest site by avg price
  const cheapestSite = (() => {
    const totals = {};
    activeComparison.forEach(p => Object.entries(p.sites).forEach(([site, { value }]) => {
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
  .low{color:#0a7a4a;font-weight:600}
  .insight{padding:12px 16px;border-radius:6px;margin-bottom:10px;font-size:13px}
  .insight.green{background:#e8fff4;border-left:3px solid #40c080;color:#0a4a2a}
  .insight.red{background:#fff0f8;border-left:3px solid #cc60a0;color:#4a1030}
  .insight.blue{background:#f0f4ff;border-left:3px solid #4080cc;color:#0a1a40}
  .footer{margin-top:40px;font-size:11px;color:#ccc;border-top:1px solid #eee;padding-top:16px}
</style></head><body>
<h1>ARIA Competitive Analysis Report</h1>
<div class="meta">Generated: ${date} · ${comparison.length} products · ${allSites.length} competitors</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Cheapest Overall</div><div class="stat-value" style="font-size:16px;color:#0a7a4a">${cheapestSite||'—'}</div></div>
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
        *, *::before, *::after { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif !important; }
        body { font-size: 14px; }
        .nav-btn { transition: background 0.15s, color 0.15s; }
        .nav-btn:hover { background: rgba(232,168,184,0.18) !important; color: #f5c8d4 !important; }
        .nav-btn.active { background: #f5e6e0 !important; color: #181818 !important; }
        .aria-btn:hover { background: rgba(255,255,255,0.08) !important; border-color: #888 !important; color: #fff !important; }
        .aria-btn-primary:hover { background: #fff !important; color: #111 !important; }
        .aria-row:hover { background: #1e1e1e !important; }
        .aria-card:hover { border-color: #3a3a3a !important; }
        a:hover { color: #f5c8d4 !important; opacity: 1 !important; }
        select { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif !important; }
        input { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif !important; }
        button { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif !important; }
        th, td { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif !important; }
      `}</style>
      <aside style={{ width: '260px', minWidth: '260px', background: '#141414', padding: '0', borderRight: '1px solid #252525', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', flexShrink: 0 }}>

        {/* Logo block */}
        <div style={{ padding: '24px 18px 18px', borderBottom: '1px solid #222' }}>
          <svg width="224" height="96" viewBox="0 0 224 96" fill="none">
            <rect x="4" y="46" width="13" height="22" rx="2.5" fill="#f5e6e0" opacity="0.2"/>
            <rect x="21" y="29" width="13" height="39" rx="2.5" fill="#e8a8b8" opacity="0.5"/>
            <rect x="38" y="10" width="13" height="58" rx="2.5" fill="#e8a8b8"/>
            <rect x="55" y="10" width="13" height="58" rx="2.5" fill="#e8a8b8" opacity="0.75"/>
            <rect x="72" y="29" width="13" height="39" rx="2.5" fill="#e8a8b8" opacity="0.5"/>
            <rect x="89" y="46" width="13" height="22" rx="2.5" fill="#f5e6e0" opacity="0.2"/>
            <rect x="28" y="34" width="56" height="8" rx="2" fill="#f5e6e0" opacity="0.28"/>
            <text x="112" y="50" fontFamily="'Century Gothic','Trebuchet MS',sans-serif" fontSize="32" fontWeight="600" fill="#f5e6e0" letterSpacing="5">ARIA</text>
            <text x="112" y="66" fontFamily="'Century Gothic','Trebuchet MS',sans-serif" fontSize="9" fill="#999" letterSpacing="0.3">Artificial Research</text>
            <text x="112" y="79" fontFamily="'Century Gothic','Trebuchet MS',sans-serif" fontSize="9" fill="#999" letterSpacing="0.3">Intelligent Agent</text>
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
                  <span style={{ background: '#ffb0e0', color: '#fff', borderRadius: '99px', padding: '1px 7px', fontSize: '9px', fontWeight: '700' }}>{priceChanges.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #222' }}>
          <div style={{ fontSize: '9px', color: '#444', letterSpacing: '0.5px', fontFamily: FF }}>ARIA v3.7</div>
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
              <div style={{ background: '#281e0a', border: '1px solid #cc9040', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ fontSize: '14px', color: '#ffe0a0', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                  Recent Price Changes ({priceChanges.length})
                </div>
                {priceChanges.slice(0, 5).map((ch, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < Math.min(priceChanges.length, 5) - 1 ? '1px solid #281e0a' : 'none' }}>
                    <div>
                      <span style={{ fontSize: '14px', color: '#ddd' }}>{ch.product}</span>
                      <span style={{ fontSize: '14px', color: '#aaa', marginLeft: '8px' }}>{ch.competitor}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', color: '#aaa', textDecoration: 'line-through' }}>{ch.from}</span>
                      <span style={{ fontSize: '14px', color: ch.direction === 'down' ? '#b0ffd8' : '#ffb0e0', fontWeight: '600' }}>
                        {ch.to} {ch.direction === 'down' ? '↓' : '↑'} {Math.abs(ch.pct)}%
                      </span>
                    </div>
                  </div>
                ))}
                {priceChanges.length > 5 && (
                  <button onClick={() => setActivePage('analysis')} style={{ marginTop: '10px', fontSize: '14px', color: '#ffe0a0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    View all {priceChanges.length} changes in Analysis →
                  </button>
                )}
              </div>
            )}

            {/* Competitor rankings */}
            {competitors.length === 0 ? (
              <div className="aria-card" style={CARD}>
                <h3 style={H3}>GET STARTED</h3>
                <ol style={{ marginLeft: '20px', color: '#aaa', fontSize: '14px', lineHeight: '2.4' }}>
                  <li>Go to <strong style={{ color: '#f5e6e0' }}>Competitors</strong> → Add competitor URLs</li>
                  <li>Click <strong style={{ color: '#f5e6e0' }}>CHECK NOW</strong> to scan each site</li>
                  <li>Come back here to see rankings and price changes</li>
                </ol>
              </div>
            ) : (
              <div className="aria-card" style={CARD}>
                <h3 style={H3}>COMPETITOR RANKINGS</h3>
                <p style={{ fontSize: '14px', color: '#777', marginBottom: '14px' }}>Scored on product coverage (40pts) + lowest pricing (60pts)</p>

                {/* Ranked (scanned) */}
                {rankedCompetitors.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: i % 2 === 0 ? '#111' : '#161616', borderRadius: '6px', marginBottom: '4px' }}>
                    {/* Rank */}
                    <div style={{ minWidth: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? '#3a3020' : '#1a1a1a', border: `1px solid ${i === 0 ? '#ffe0a0' : '#2a2a2a'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '700', color: i === 0 ? '#ffe0a0' : '#555', flexShrink: 0 }}>
                      #{i + 1}
                    </div>
                    {/* Name + link */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: '#ddd', fontWeight: '500', display:'flex', alignItems:'center', gap:'6px' }}>
                        {c.name}
                        {c.country && <span style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'99px', fontWeight:'600', background: c.country==='CA' ? '#281e0a' : '#0a1428', border: `1px solid ${c.country==='CA' ? '#ffe0a0' : '#b0d4ff'}`, color: c.country==='CA' ? '#ffe0a0' : '#b0d4ff' }}>{c.country}</span>}
                      </div>
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
                        <span style={{ fontSize: '14px', color: c.score >= 70 ? '#b0ffd8' : c.score >= 40 ? '#ffe0a0' : '#ffb0e0', fontWeight: '600' }}>{c.score}/100</span>
                      </div>
                      <div style={{ height: '4px', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: c.score >= 70 ? '#40c080' : c.score >= 40 ? '#cc9040' : '#cc60a0', borderRadius: '2px', transition: 'width 0.3s' }} />
                      </div>
                    </div>
                    {/* Cheapest badge */}
                    {cheapestSite === c.name && (
                      <div style={{ fontSize: '9px', padding: '3px 8px', background: '#0a1e14', border: '1px solid #40c080', borderRadius: '99px', color: '#b0ffd8', whiteSpace: 'nowrap' }}>CHEAPEST</div>
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
              <button className="aria-btn-primary" style={BTN_PRIMARY} onClick={() => setShowModal(true)}>+ ADD COMPETITOR</button>
              <button className="aria-btn" style={BTN} onClick={handleScrapeAll}>SCAN ALL</button>
            </div>

            {competitors.length === 0 && (
              <div className="aria-card" style={CARD}><p style={P}>No competitors yet. Click "+ Add Competitor" to get started.</p></div>
            )}

            <div style={{ display: 'grid', gap: '12px' }}>
              {competitors.map(c => {
                const result = scrapeResults[c.id];
                const products = result?.insights?.[0]?.items || [];
                const competitorChanges = priceChanges.filter(ch => ch.competitor === c.name);
                const history = scanHistory[c.id] || [];
                const isAboutOpen = !!aboutOpen[c.id];
                const note = compNotes[c.id] || '';
                const allCompProducts = Object.values(scrapeResults).flatMap(r => (r?.insights?.[0]?.items||[]).map(i => i.split(' — ')[0]?.trim()?.toLowerCase()));
                const myProducts = (result?.insights?.[0]?.items||[]).map(i => i.split(' — ')[0]?.trim()?.toLowerCase());
                const exclusiveCount = myProducts.filter(p => allCompProducts.filter(x => x === p).length === 1).length;
                const successfulScans = history.filter(h => h.success).length;
                const reliability = history.length ? Math.round((successfulScans / history.length) * 100) : null;

                return (
                  <div key={c.id} className="aria-card" style={{ ...CARD, borderColor: isAboutOpen ? '#3a3a3a' : '#2a2a2a' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ ...H3, margin: 0, display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
                          {c.name}
                          {c.country && <span style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'99px', fontWeight:'600', background: c.country==='CA' ? '#281e0a' : '#0a1428', border: `1px solid ${c.country==='CA' ? '#ffe0a0' : '#b0d4ff'}`, color: c.country==='CA' ? '#ffe0a0' : '#b0d4ff', textTransform:'none', letterSpacing:'0' }}>{c.country}</span>}
                        </h3>
                        <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#888', textDecoration: 'none' }}>{c.website}</a>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap:'wrap' }}>
                        {competitorChanges.length > 0 && (
                          <span style={{ fontSize: '10px', padding: '3px 8px', background: '#281e0a', border: '1px solid #cc9040', borderRadius: '99px', color: '#ffe0a0' }}>
                            {competitorChanges.length} change{competitorChanges.length > 1 ? 's' : ''}
                          </span>
                        )}
                        <button style={{ ...BTN, padding: '7px 14px', fontSize: '12px', borderColor: isAboutOpen ? '#f5e6e0' : '#444', color: isAboutOpen ? '#f5e6e0' : '#bbb' }}
                          onClick={() => setAboutOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                          ⓘ ABOUT
                        </button>
                        <button style={{ ...BTN, padding: '7px 14px', fontSize: '12px' }}
                          onClick={() => setEditingCompetitor({ ...c })}>EDIT</button>
                        <button style={{ ...BTN_PRIMARY, padding: '7px 14px', fontSize: '12px', opacity: scraping[c.id] ? 0.6 : 1 }} onClick={() => handleScrape(c)} disabled={scraping[c.id]}>
                          {scraping[c.id] ? 'SCANNING...' : 'CHECK NOW'}
                        </button>
                      </div>
                    </div>

                    {/* About panel */}
                    {isAboutOpen && (
                      <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:'8px', marginBottom:'14px', overflow:'hidden' }}>
                        <div style={{ background:'#1f1f1f', padding:'10px 16px', borderBottom:'1px solid #252525', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:'10px', fontWeight:'600', color:'#f5e6e0', letterSpacing:'1px', textTransform:'uppercase', fontFamily:FF }}>Company Profile</span>
                          <span style={{ fontSize:'14px', color:'#555', cursor:'pointer' }} onClick={() => setAboutOpen(prev => ({ ...prev, [c.id]: false }))}>×</span>
                        </div>
                        <div style={{ padding:'14px 16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px 20px' }}>
                          {/* Col 1 */}
                          <div>
                            <div style={{ fontSize:'9px', color:'#555', textTransform:'uppercase', letterSpacing:'1px', fontWeight:'600', marginBottom:'8px', fontFamily:FF }}>Business</div>
                            {[
                              ['Country', c.country === 'CA' ? '🇨🇦 Canada' : c.country === 'US' ? '🇺🇸 USA' : '🌐 Other'],
                              ['Currency', c.currency || 'USD'],
                              ['Products tracked', products.length || '—'],
                              ['Exclusive products', exclusiveCount || '—'],
                            ].map(([k,v]) => (
                              <div key={k} style={{ marginBottom:'8px' }}>
                                <div style={{ fontSize:'10px', color:'#555', fontFamily:FF }}>{k}</div>
                                <div style={{ fontSize:'12px', color:'#ccc', fontFamily:FF }}>{v}</div>
                              </div>
                            ))}
                          </div>
                          {/* Col 2 */}
                          <div>
                            <div style={{ fontSize:'9px', color:'#555', textTransform:'uppercase', letterSpacing:'1px', fontWeight:'600', marginBottom:'8px', fontFamily:FF }}>Scan Performance</div>
                            {[
                              ['Reliability', reliability !== null ? `${reliability}%` : 'No history'],
                              ['Scans recorded', history.length ? `${history.length} / last 5` : 'None yet'],
                              ['Last scan', history[0]?.scrapedAt ? new Date(history[0].scrapedAt).toLocaleDateString() : '—'],
                              ['Price changes', competitorChanges.length || '0'],
                            ].map(([k,v]) => {
                              const reliColor = k==='Reliability' && reliability !== null
                                ? (reliability >= 80 ? '#b0ffd8' : reliability >= 50 ? '#ffe0a0' : '#ffb0e0')
                                : '#ccc';
                              return (
                                <div key={k} style={{ marginBottom:'8px' }}>
                                  <div style={{ fontSize:'10px', color:'#555', fontFamily:FF }}>{k}</div>
                                  <div style={{ fontSize:'12px', color: reliColor, fontFamily:FF }}>{v}</div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Col 3 — scan history */}
                          <div>
                            <div style={{ fontSize:'9px', color:'#555', textTransform:'uppercase', letterSpacing:'1px', fontWeight:'600', marginBottom:'8px', fontFamily:FF }}>Scan History</div>
                            {history.length === 0 ? (
                              <div style={{ fontSize:'11px', color:'#444', fontFamily:FF }}>No scans yet</div>
                            ) : history.map((h, i) => (
                              <div key={i} style={{ display:'flex', justifyContent:'space-between', marginBottom:'5px', fontSize:'11px', fontFamily:FF }}>
                                <span style={{ color: h.success ? '#b0ffd8' : '#ffb0e0' }}>{h.success ? '✓' : '✗'} {h.productCount || 0} products</span>
                                <span style={{ color:'#555' }}>{h.scrapedAt ? new Date(h.scrapedAt).toLocaleDateString() : '—'}</span>
                              </div>
                            ))}
                          </div>
                          {/* Notes — full width */}
                          <div style={{ gridColumn:'1/-1', borderTop:'1px solid #252525', paddingTop:'12px' }}>
                            <div style={{ fontSize:'9px', color:'#555', textTransform:'uppercase', letterSpacing:'1px', fontWeight:'600', marginBottom:'6px', fontFamily:FF }}>Team Notes</div>
                            <textarea
                              value={note}
                              onChange={e => setCompNotes(prev => ({ ...prev, [c.id]: e.target.value }))}
                              placeholder="Add observations, manual price check dates, strategy notes..."
                              style={{ width:'100%', padding:'8px 10px', background:'#111', border:'1px solid #333', borderRadius:'6px', color:'#ccc', fontSize:'12px', fontFamily:FF, resize:'none', height:'56px' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {scraping[c.id] && <p style={{ fontSize: '14px', color: '#f5e6e0' }}>Scanning {c.website}...</p>}

                    {result && !scraping[c.id] && (
                      result.success ? (
                        <div style={{ background: '#111', borderRadius: '6px', padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '20px', color: '#f5e6e0', fontWeight: '500', fontFamily: FF }}>{products.length}</div>
                              <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF }}>Products</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '20px', color: competitorChanges.length > 0 ? '#ffe0a0' : '#f5e6e0', fontWeight: '500', fontFamily: FF }}>{competitorChanges.length}</div>
                              <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF }}>Price Changes</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '20px', color: (history.filter(h=>h.success).length / Math.max(history.length,1) * 100) >= 80 ? '#b0ffd8' : '#ffe0a0', fontWeight: '500', fontFamily: FF }}>{history.length ? Math.round(history.filter(h=>h.success).length/history.length*100) + '%' : '—'}</div>
                              <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF }}>Reliability</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: '#555', fontFamily: FF }}>Last scan: {fmt(result.scrapedAt)}</span>
                            <button onClick={() => setProductsOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                              style={{ fontSize: '11px', padding: '5px 12px', background: 'transparent', border: '1px solid #333', borderRadius: '5px', color: '#b0d4ff', cursor: 'pointer', fontFamily: FF, letterSpacing: '0.5px' }}>
                              {productsOpen[c.id] ? 'HIDE PRODUCTS ▲' : 'VIEW PRODUCTS ▼'}
                            </button>
                          </div>
                          {productsOpen[c.id] && (
                            <div style={{ marginTop: '10px', display: 'grid', gap: '4px', maxHeight: '360px', overflowY: 'auto' }}>
                              {products.map((item, pi) => {
                                const parts = item.split(' — ');
                                const name = parts[0]?.trim();
                                const pricePart = parts.find(p => p.includes('$')) || '';
                                const cat = categorize(name);
                                const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Other'];
                                const changed = priceChanges.find(ch => ch.competitor === c.name && ch.product.toLowerCase() === name.toLowerCase());
                                return (
                                  <div key={pi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: changed ? '#281e0a' : '#161616', borderRadius: '4px', border: `1px solid ${changed ? '#cc9040' : '#1e1e1e'}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                      <span style={{ fontSize: '13px', color: '#ccc', fontFamily: FF }}>{name}</span>
                                      <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '99px', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text, whiteSpace: 'nowrap' }}>{cat}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                      {changed && <span style={{ fontSize: '10px', color: changed.direction === 'down' ? '#b0ffd8' : '#ffb0e0' }}>was {changed.from} {changed.direction === 'down' ? '↓' : '↑'}</span>}
                                      <span style={{ fontSize: '13px', color: '#f5e6e0', fontWeight: '500', fontFamily: FF }}>{pricePart}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: '14px', color: '#ffb0e0', fontFamily: FF }}>Scan failed: {result.error}</p>
                      )
                    )}
                    {/* Delete button — bottom right */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                      <button style={{ ...BTN, padding: '6px 14px', fontSize: '11px', borderColor: '#4a1a1a', color: '#ff8080', background: '#1a0a0a' }} onClick={() => handleDelete(c.id)}>DELETE</button>
                    </div>
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
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: '600', marginBottom: '6px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Market / Country</label>
                    <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}
                      style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#111', color: '#fff', fontFamily: 'inherit', fontSize: '14px', marginBottom: '14px' }}>
                      <option value="">— Select market —</option>
                      <option value="CA">Canada (CAD)</option>
                      <option value="US">United States (USD)</option>
                      <option value="OTHER">Other (USD)</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button className="aria-btn" style={BTN} onClick={() => setShowModal(false)}>CANCEL</button>
                    <button className="aria-btn-primary" style={BTN_PRIMARY} onClick={handleAddCompetitor}>ADD</button>
                  </div>
                </div>
              </div>
            )}
            {/* ── EDIT COMPETITOR MODAL ── */}
            {editingCompetitor && (
              <div onClick={() => setEditingCompetitor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#181818', border: '1px solid #333', borderRadius: '10px', padding: '28px', maxWidth: '460px', width: '90%' }}>
                  <h2 style={{ fontSize: '16px', marginBottom: '20px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px' }}>Edit Competitor</h2>
                  {[{ label: 'Company Name', key: 'name', type: 'text' }, { label: 'Website URL', key: 'website', type: 'url' }].map(f => (
                    <div key={f.key}>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: '600', marginBottom: '6px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{f.label}</label>
                      <input type={f.type} value={editingCompetitor[f.key]} onChange={e => setEditingCompetitor(prev => ({ ...prev, [f.key]: e.target.value }))}
                        style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#111', color: '#fff', fontFamily: 'inherit', fontSize: '14px', marginBottom: '14px', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: '600', marginBottom: '6px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Market / Country</label>
                    <select value={editingCompetitor.country || 'US'} onChange={e => setEditingCompetitor(prev => ({ ...prev, country: e.target.value }))}
                      style={{ width: '100%', padding: '10px', border: '1px solid #333', borderRadius: '6px', background: '#111', color: '#fff', fontFamily: 'inherit', fontSize: '14px', marginBottom: '14px' }}>
                      <option value="US">United States (USD)</option>
                      <option value="CA">Canada (CAD)</option>
                      <option value="OTHER">Other (USD)</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button className="aria-btn" style={BTN} onClick={() => setEditingCompetitor(null)}>CANCEL</button>
                    <button className="aria-btn-primary" style={BTN_PRIMARY} onClick={handleEditSave}>SAVE</button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
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

            {/* Market filter */}
            <div style={{ display:'flex', gap:'8px', marginBottom:'20px', flexWrap:'wrap', alignItems:'center' }}>
              {[['ALL','All Markets'],['CA','CA — Canada (CAD)'],['US','US — United States (USD)']].map(([v,label]) => (
                <span key={v} onClick={() => setAnalysisMarket(v)} style={{ fontSize:'12px', padding:'5px 14px', borderRadius:'99px', cursor:'pointer', userSelect:'none', fontFamily: FF,
                  background: analysisMarket===v ? (v==='CA' ? '#281e0a' : v==='US' ? '#0a1428' : '#f5e6e0') : 'transparent',
                  border: `1px solid ${analysisMarket===v ? (v==='CA' ? '#ffe0a0' : v==='US' ? '#b0d4ff' : '#f5e6e0') : '#333'}`,
                  color: analysisMarket===v ? (v==='CA' ? '#ffe0a0' : v==='US' ? '#b0d4ff' : '#181818') : '#888',
                  fontWeight: analysisMarket===v ? '600' : '400' }}>{label}</span>
              ))}
              {analysisMarket === 'CA' && (
                <span style={{ fontSize:'11px', color:'#888', fontFamily:FF }}>Prices converted to USD at {cadUsdRate.toFixed(2)} · Update in Settings</span>
              )}
            </div>

            {comparison.length === 0 && (
              <div className="aria-card" style={CARD}>
                <h3 style={H3}>NO DATA YET</h3>
                <p style={P}>Scan at least one competitor to see analysis.</p>
                <button style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            )}

            {comparison.length > 0 && (
              <>
                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Products Compared</div><div style={{ fontSize: '28px', color: '#f5e6e0', marginTop: '4px' }}>{activeComparison.length}</div></div>
                  <div style={STAT_CARD}><div style={STAT_LABEL}>Price Range</div><div style={{ fontSize: '14px', color: '#f5e6e0', fontWeight: '500', marginTop: '6px' }}>{allPrices.length ? `$${Math.min(...allPrices).toFixed(2)} – $${Math.max(...allPrices).toFixed(2)}` : '—'}</div></div>
                </div>

                {/* Comparison table */}
                {(() => {
                  const categories = ['ALL', ...new Set(activeComparison.map(p => p.category))];
                  // Build competitor lookup for country tags
                  const compCountry = {};
                  competitors.forEach(c => { compCountry[c.name] = c.country || 'US'; });
                  // Filter sites by selected market
                  const allSites = [...new Set(activeComparison.flatMap(p => Object.keys(p.sites)))]
                    .filter(site => {
                      if (analysisMarket === 'ALL') return true;
                      return compCountry[site] === analysisMarket;
                    });
                  const filtered = activeComparison
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
                    <div className="aria-card" style={CARD}>
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
                            {['PRODUCT', 'CATEGORY', ...allSites].map((h, i) => {
                              const country = i >= 2 ? (compCountry[h] || 'US') : null;
                              return (
                                <div key={i} style={{ fontSize: '9px', color: '#777', textTransform: 'uppercase', letterSpacing: '1px', padding: '6px 8px', fontWeight: '600' }}>
                                  {country && (
                                    <span style={{ display:'inline-block', marginBottom:'3px', fontSize:'9px', padding:'1px 5px', borderRadius:'99px', fontWeight:'600', textTransform:'none', letterSpacing:'0',
                                      background: country==='CA' ? '#281e0a' : '#0a1428',
                                      border: `1px solid ${country==='CA' ? '#ffe0a0' : '#b0d4ff'}`,
                                      color: country==='CA' ? '#ffe0a0' : '#b0d4ff' }}>
                                      {country}
                                    </span>
                                  )}
                                  <div>{h}</div>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ display: 'grid', gap: '3px' }}>
                            {filtered.map((p, i) => {
                              const prices = Object.values(p.sites).map(s => s.value).filter(Boolean);
                              const minPrice = prices.length ? Math.min(...prices) : null;
                              const cat = CATEGORY_COLORS[p.category] || CATEGORY_COLORS['Other'];
                              const hasChange = priceChanges.some(ch => ch.product.toLowerCase() === p.name.toLowerCase());
                              return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: `200px 140px ${allSites.map(() => '130px').join(' ')}`, background: hasChange ? '#1a1a14' : i % 2 === 0 ? '#161616' : '#111', borderRadius: '4px', border: hasChange ? '1px solid #281e0a' : '1px solid transparent' }}>
                                  <div style={{ padding: '8px', fontSize: '14px', color: '#ddd', alignSelf: 'center', wordBreak: 'break-word' }}>
                                    {p.name}
                                    {hasChange && <span style={{ marginLeft: '6px', fontSize: '9px', color: '#ffe0a0' }}>↕</span>}
                                  </div>
                                  <div style={{ padding: '8px', alignSelf: 'center' }}>
                                    <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: cat.bg, border: `1px solid ${cat.border}`, color: cat.text, whiteSpace: 'nowrap' }}>{p.category}</span>
                                  </div>
                                  {allSites.map(site => {
                                    const sd = p.sites[site];
                                    const isLowest = sd?.value && sd.value === minPrice && prices.length > 1;
                                    return (
                                      <div key={site} style={{ padding: '8px', fontSize: '14px', color: isLowest ? '#b0ffd8' : sd ? '#ccc' : '#2a2a2a', fontWeight: isLowest ? '600' : '400', alignSelf: 'center' }}>
                                        {sd ? sd.price : '—'}
                                        {isLowest && <span style={{ fontSize: '9px', marginLeft: '4px', color: '#40c080' }}>LOW</span>}
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
              <div className="aria-card" style={CARD}>
                <h3 style={H3}>NO COMPETITORS YET</h3>
                <p style={P}>Add competitors to see market intel.</p>
                <button style={{ ...BTN_PRIMARY, marginTop: '12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            ) : (() => {
              const filteredByMarket = intelMarket === 'ALL' ? competitors : competitors.filter(c => (c.country || 'US') === intelMarket);
              const knownIntel = {
                'GROWTH GUYS': {
                  freeShipping: 'All orders', flatShipping: 'Canada Post domestic only', dispatchSpeed: 'Same day — tracking within 20 min',
                  activeSales: ['Semaglutide 5mg — 40% off ($30 CAD)', 'Tirzepatide 10mg — 30% off ($42 CAD)', 'Retatrutide 10mg — 20% off ($72 CAD)'],
                  bundles: ['Single vial vs 10-pack on every product (10% saving)'], promoCode: null,
                  labTesting: 'Janoshik — purity % + avg mass published per batch', productCount: '71', subscription: null,
                  uniqueFeatures: ['🇨🇦 Canada domestic only', 'Largest CA range — 71 products', 'Batch key on every vial — verify your own lot', 'BPC-157 Arginate Tablets (oral format)', 'Survodutide + Cagrilintide stocked'],
                },
                'PURITY PEPTIDES': {
                  freeShipping: null, flatShipping: 'Not publicly listed', dispatchSpeed: 'Not confirmed — blocks scraper',
                  activeSales: ['-21% on select products'],
                  bundles: [], promoCode: 'WDPILLS23 — 10% off first order',
                  labTesting: 'HPLC + mass spec COA per batch — 3rd party verified', productCount: '70+', subscription: null,
                  uniqueFeatures: ['🇨🇦 Canada domestic', 'Blocks automated scraper (403)', 'Clinic / practitioner positioning', 'Ships internationally to most countries'],
                },
                'NCRP': {
                  freeShipping: '$350', flatShipping: '$20 Ontario · $30 outside Ontario', dispatchSpeed: 'Within 24hrs Mon–Fri',
                  activeSales: [], bundles: [], promoCode: null,
                  labTesting: 'HPLC — 98%+ purity guaranteed', productCount: '14', subscription: null,
                  uniqueFeatures: ['🇨🇦 Made in Canada', 'Smallest / most focused range', 'Ontario-based'],
                },
                'PEPTIDE WAREHOUSE': {
                  freeShipping: '$300', flatShipping: null, dispatchSpeed: 'Same day before 2pm EST',
                  activeSales: ['BPC-157 on sale', 'TB-500 on sale', 'GHK-Cu on sale', 'BPC+TB Blend on sale'],
                  bundles: [], promoCode: null,
                  labTesting: 'HPLC tested', productCount: '~28 visible', subscription: null,
                  uniqueFeatures: ['GHK-Cu Face Cream (skincare crossover)', 'Spray format products', 'Wix platform — limited scrape'],
                },
                'CORE PEPTIDES': {
                  freeShipping: '$200 (Priority USPS)', flatShipping: null, dispatchSpeed: 'Same day before 1pm PST Mon–Fri',
                  activeSales: ['Ipamorelin 5mg on sale'],
                  bundles: ['CJC+Ipa 10mg', 'BPC+TB+GHK-Cu 70mg triple blend', 'Fragment+ModGRF+Ipa 12mg'], promoCode: null,
                  labTesting: 'cGMP facility — HPLC + mass spec, 99%+ purity', productCount: '103', subscription: null,
                  uniqueFeatures: ['🇺🇸 Largest US catalog — 103 products', 'cGMP manufactured', 'Custom bulk orders available', '30-day refund policy', 'Priority Express overnight available'],
                },
                'BIOTECH PEPTIDES': {
                  freeShipping: 'Not listed', flatShipping: 'Not listed', dispatchSpeed: 'Same day before 1pm PST',
                  activeSales: ['Tesamorelin on sale'],
                  bundles: ['BPC+TB 10mg', 'Sermorelin+Ipa 10mg', 'Fragment+ModGRF+Ipa 12mg', 'BPC+TB+GHK-Cu 70mg'], promoCode: null,
                  labTesting: 'HPLC + mass spec — USA synthesised + lyophilised', productCount: '50+', subscription: null,
                  uniqueFeatures: ['🇺🇸 USA made — synthesised and lyophilised domestically', 'Credit cards accepted', '30-day money back guarantee', 'Custom synthesis on request — any sequence', 'Replacement shipped free if damaged'],
                },
                'PRIME PEPTIDES': {
                  freeShipping: 'All orders (FedEx 3-Day, excl. Florida)', flatShipping: null, dispatchSpeed: 'Same day before 1pm EST · Priority before 2pm EST',
                  activeSales: ['Sitewide sale — up to 20% off'],
                  bundles: ['Glow Blend (GHK-Cu/BPC-157/TB-500)', 'Klow Blend'], promoCode: null,
                  labTesting: '3rd party COA — HPLC + mass spec per batch', productCount: '15', subscription: null,
                  uniqueFeatures: ['🇺🇸 Free FedEx 3-Day on all orders (no minimum)', 'Ships to Canada', 'Peptide calculator on site', 'Discreet packaging — return addr shows "SHIPPING MANAGER"', '⚠ FDA warning letter Dec 2024', 'Returns accepted on unopened vials within 30 days'],
                },
                'ONYX BIOLABS': {
                  freeShipping: '$200 (standard 3–5 day)', flatShipping: '$11.99 standard · $19.99 expedited 1–2 day', dispatchSpeed: 'Processed within 24–48 hrs',
                  activeSales: ['10% off first order — code FIRSTORDER', '16 new Kovera lab reports uploaded'],
                  bundles: ['KLOW 80mg (KPV/GHK-Cu/BPC-157/TB-500 quad blend)'], promoCode: 'FIRSTORDER — 10% off first order',
                  labTesting: 'Kovera Labs — 16 COAs published, 99.9%+ purity confirmed', productCount: '34', subscription: null,
                  uniqueFeatures: ['🇺🇸 Charlotte NC based', 'Affiliate program active', 'Lab merch store (t-shirts)', 'Peptide calculator + reconstitution guides', 'Route shipping insurance offered', 'Accepts credit/debit, ACH, Zelle, CashApp, crypto', 'Age 21+ required'],
                },
              };

              const getK = (c) => {
                const n = c.name.toUpperCase().replace(/\s+/g,' ').trim();
                const aliases = {
                  'GROWTH GUYS': ['GROWTH GUYS','GROWTHGUYS'],
                  'PURITY PEPTIDES': ['PURITY PEPTIDES','PURITYPEPTIDES'],
                  'CORE PEPTIDES': ['CORE PEPTIDES','COREPEPTIDES'],
                  'BIOTECH PEPTIDES': ['BIOTECH PEPTIDES','BIOTECHPEPTIDES','BIOTECH'],
                  'PRIME PEPTIDES': ['PRIME PEPTIDES','PRIMEPEPTIDES'],
                  'ONYX BIOLABS': ['ONYX BIOLABS','ONYX BIO LABS','ONYXBIOLABS','ONYX'],
                  'NCRP': ['NCRP'],
                  'PEPTIDE WAREHOUSE': ['PEPTIDE WAREHOUSE','PEPTIDEWAREHOUSE'],
                };
                for (const [key, names] of Object.entries(aliases)) {
                  if (names.some(alias => n.includes(alias) || alias.includes(n))) {
                    return knownIntel[key] || {};
                  }
                }
                return {};
              };

              const F = "'Century Gothic', 'Trebuchet MS', sans-serif";
              const SEC = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', marginBottom: '14px', overflow: 'hidden' };
              const SEC_HEAD = { padding: '10px 16px', background: '#1e1e1e', borderBottom: '1px solid #2a2a2a', fontSize: '11px', fontFamily: F, fontWeight: '600', color: '#bbb', textTransform: 'uppercase', letterSpacing: '1px' };
              const ROW_LABEL = { padding: '14px 16px', fontSize: '13px', fontFamily: F, color: '#aaa', background: '#161616', width: '170px', minWidth: '170px', verticalAlign: 'top', borderTop: '1px solid #222' };
              const colW = `${Math.floor(70 / filteredByMarket.length)}%`;
              const COL_HEAD = { padding: '10px 14px', fontSize: '11px', fontFamily: F, color: '#bbb', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', borderLeft: '1px solid #2a2a2a', width: colW, background: '#1a1a1a' };
              const CELL = { padding: '14px 14px', fontSize: '13px', fontFamily: F, color: '#ddd', borderLeft: '1px solid #222', borderTop: '1px solid #222', verticalAlign: 'top', width: colW };

              // Variant 2 — dark bg, neon pastel border + text (matches rest of app)
              const PILL_STYLES = {
                green:  { bg: '#0a1e14', border: '#b0ffd8', color: '#b0ffd8' },
                amber:  { bg: '#281e0a', border: '#ffe0a0', color: '#ffe0a0' },
                blue:   { bg: '#0a1428', border: '#b0d4ff', color: '#b0d4ff' },
                teal:   { bg: '#0a2222', border: '#a0f0e8', color: '#a0f0e8' },
                pink:   { bg: '#280a1e', border: '#ffb0e0', color: '#ffb0e0' },
                purple: { bg: '#1e0a28', border: '#e0b0ff', color: '#e0b0ff' },
                gray:   { bg: '#141414', border: '#d8d8d8', color: '#d8d8d8' },
              };

              const Pill = ({ text, type }) => {
                const s = PILL_STYLES[type] || PILL_STYLES.gray;
                return <span style={{ display: 'inline-block', fontSize: '11px', fontFamily: F, padding: '3px 10px', borderRadius: '99px', background: s.bg, border: `1px solid ${s.border}`, color: s.color, marginRight: '5px', marginBottom: '5px', lineHeight: '1.6', fontWeight: '500' }}>{text}</span>;
              };

              const None = () => <span style={{ color: '#555', fontSize: '13px', fontFamily: F }}>—</span>;
              const PlainText = ({ text, color }) => <span style={{ fontSize: '13px', fontFamily: F, color: color || '#ccc', lineHeight: '1.6' }}>{text}</span>;
              const CodePill = ({ text }) => <span style={{ fontFamily: 'monospace', fontSize: '11px', padding: '4px 10px', background: '#0a2222', border: '1px solid #a0f0e8', borderRadius: '6px', color: '#a0f0e8', fontWeight: '600', wordBreak: 'break-word', display: 'inline-block', lineHeight: '1.5' }}>{text}</span>;

              const MarketBadge = ({ country }) => {
                const isCA = country === 'CA';
                return (
                  <span style={{ display:'inline-block', marginBottom:'3px', fontSize:'9px', padding:'1px 6px', borderRadius:'99px', fontWeight:'600', textTransform:'none', letterSpacing:'0',
                    background: isCA ? '#281e0a' : '#0a1428',
                    border: `1px solid ${isCA ? '#ffe0a0' : '#b0d4ff'}`,
                    color: isCA ? '#ffe0a0' : '#b0d4ff' }}>
                    {isCA ? 'CA' : 'US'}
                  </span>
                );
              };

              const SectionTable = ({ title, rows }) => (
                <div style={SEC}>
                  <div style={SEC_HEAD}>{title}</div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...ROW_LABEL, borderTop:'none', background:'#1a1a1a' }}></th>
                        {filteredByMarket.map(c => (
                          <th key={c.id} style={{ ...COL_HEAD, borderTop:'none', textAlign:'center' }}>
                            <div><MarketBadge country={c.country || 'US'} /></div>
                            <div>{c.name}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>
                          <td style={ROW_LABEL}>{row.label}</td>
                          {filteredByMarket.map(c => <td key={c.id} style={CELL}>{row.render(getK(c), c)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              return (
                <>
                  {/* Market filter */}
                  <div style={{ display:'flex', gap:'8px', marginBottom:'20px', alignItems:'center', flexWrap:'wrap' }}>
                    {[['ALL','All Markets'],['CA','CA — Canada'],['US','US — United States']].map(([v,label]) => (
                      <span key={v} onClick={() => setIntelMarket(v)}
                        style={{ fontSize:'12px', padding:'5px 14px', borderRadius:'99px', cursor:'pointer', userSelect:'none', fontFamily: F,
                          background: intelMarket===v ? (v==='CA' ? '#281e0a' : v==='US' ? '#0a1428' : '#f5e6e0') : 'transparent',
                          border: `1px solid ${intelMarket===v ? (v==='CA' ? '#ffe0a0' : v==='US' ? '#b0d4ff' : '#f5e6e0') : '#333'}`,
                          color: intelMarket===v ? (v==='CA' ? '#ffe0a0' : v==='US' ? '#b0d4ff' : '#181818') : '#888',
                          fontWeight: intelMarket===v ? '600' : '400' }}>
                        {label}
                      </span>
                    ))}
                    <span style={{ fontSize:'11px', color:'#555', fontFamily:F }}>
                      {filteredByMarket.length} competitor{filteredByMarket.length !== 1 ? 's' : ''} shown
                    </span>
                  </div>
                  {filteredByMarket.length === 0 && (
                    <div className="aria-card" style={CARD}>
                      <p style={P}>No {intelMarket === 'CA' ? 'Canadian' : 'US'} competitors added yet. Go to Competitors and set the correct country on each card using the EDIT button.</p>
                    </div>
                  )}
                  {filteredByMarket.length > 0 && <>
                  <SectionTable title="Shipping" rows={[
                    { label: 'Free over', render: (k) => k.freeShipping ? <Pill text={`Free over ${k.freeShipping}`} type="green" /> : <None /> },
                    { label: 'Flat rate / other', render: (k) => k.flatShipping ? <PlainText text={k.flatShipping} /> : <None /> },
                    { label: 'Dispatch speed', render: (k) => k.dispatchSpeed ? <Pill text={k.dispatchSpeed} type="teal" /> : <None /> },
                  ]} />

                  <SectionTable title="Sales & Discounts" rows={[
                    { label: 'Active sales', render: (k) => (k.activeSales||[]).length > 0 ? <div>{(k.activeSales||[]).map((s,i) => <Pill key={i} text={s} type="amber" />)}</div> : <None /> },
                    { label: 'Bundle / multi-pack', render: (k) => (k.bundles||[]).length > 0 ? <div>{(k.bundles||[]).map((s,i) => <Pill key={i} text={s} type="green" />)}</div> : <None /> },
                    { label: 'Promo code', render: (k) => k.promoCode ? <CodePill text={k.promoCode} /> : <None /> },
                    { label: 'Subscription', render: () => <None /> },
                  ]} />

                  <SectionTable title="Trust & Quality" rows={[
                    { label: 'Lab testing', render: (k) => k.labTesting ? <Pill text={k.labTesting} type="green" /> : <None /> },
                    { label: 'Product count', render: (k, c) => <span style={{ fontSize: '22px', fontFamily: F, color: '#f5e6e0', fontWeight: '500' }}>{((scrapeResults[c.id]?.insights?.[0]?.items||[]).length || k.productCount) || '—'}</span> },
                    { label: 'Unique features', render: (k) => (k.uniqueFeatures||[]).length > 0 ? <div>{(k.uniqueFeatures||[]).map((f,i) => <Pill key={i} text={f} type="purple" />)}</div> : <None /> },
                  ]} />
                  </>}
                </>
              );
            })()}
          </div>
        )}

        {/* ── PEPTIDE GUIDE ──────────────────────────────────────── */}
        {activePage === 'peptideguide' && <PeptideGuideTab />}

        {/* ── PRICING ────────────────────────────────────────────── */}
        {activePage === 'pricing' && <PricingTab />}

        {/* ── COMMUNITY INTEL ────────────────────────────────────── */}
        {activePage === 'communityintel' && (
          <div>
            <h1 style={H1}>COMMUNITY INTEL</h1>
            <p style={SUB}>Live reputation scan across Reddit, forums, review sites and the web</p>

            {competitors.length === 0 ? (
              <div className="aria-card" style={CARD}>
                <h3 style={H3}>NO COMPETITORS YET</h3>
                <p style={P}>Add competitors first, then scan their community reputation here.</p>
                <button style={{ ...BTN_PRIMARY, marginTop:'12px' }} onClick={() => setActivePage('competitors')}>GO TO COMPETITORS →</button>
              </div>
            ) : (
              <>
                {/* Cooldown banner */}
                <div style={{ background: scanCooldown > 0 ? '#1a1a0a' : '#1a1a1a', border: `1px solid ${scanCooldown > 0 ? '#cc9040' : '#252525'}`, borderRadius:'8px', padding:'12px 16px', marginBottom:'20px', display:'flex', gap:'12px', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                    <span style={{ color:'#b0d4ff', fontSize:'14px' }}>ℹ</span>
                    <p style={{ fontSize:'12px', color:'#555', margin:0, lineHeight:'1.7', fontFamily:FF }}>
                      Scan one at a time — each scan searches Reddit, SteroidSourceTalk, MesoRX, Eroids, Trustpilot and the broader web. Wait 30 seconds between scans to avoid rate limits.
                    </p>
                  </div>
                  {scanCooldown > 0 && (
                    <div style={{ textAlign:'center', flexShrink:0, background:'#281e0a', border:'1px solid #cc9040', borderRadius:'8px', padding:'8px 16px', minWidth:'90px' }}>
                      <div style={{ fontSize:'22px', fontWeight:'700', color:'#ffe0a0', fontFamily:FF, lineHeight:1 }}>{scanCooldown}s</div>
                      <div style={{ fontSize:'9px', color:'#888', textTransform:'uppercase', letterSpacing:'1px', fontFamily:FF, marginTop:'2px' }}>Next scan</div>
                    </div>
                  )}
                  {scanCooldown === 0 && lastScanTime && (
                    <div style={{ textAlign:'center', flexShrink:0, background:'#0a1e14', border:'1px solid #40c080', borderRadius:'8px', padding:'8px 16px', minWidth:'90px' }}>
                      <div style={{ fontSize:'13px', fontWeight:'600', color:'#b0ffd8', fontFamily:FF }}>✓ READY</div>
                      <div style={{ fontSize:'9px', color:'#555', textTransform:'uppercase', letterSpacing:'1px', fontFamily:FF, marginTop:'2px' }}>Scan now</div>
                    </div>
                  )}
                </div>
                {/* Scan All button */}
                {(() => {
                  const allDone = competitors.every(c => communityScans[c.id]?.status === 'done');
                  const anyLoading = competitors.some(c => communityScans[c.id]?.status === 'loading');
                  const scanAllActive = communityScans._scanAllActive;
                  const scanAllProgress = communityScans._scanAllProgress || { current: 0, total: competitors.length };

                  const doScanAll = async () => {
                    if (anyLoading || scanAllActive) return;
                    setCommunityScans(prev => ({ ...prev, _scanAllActive: true, _scanAllProgress: { current: 0, total: competitors.length } }));
                    const tpMap = {
                      'GROWTH GUYS': null, 'PURITY PEPTIDES': null,
                      'CORE PEPTIDES': { stars:4.8, count:120 }, 'BIOTECH PEPTIDES': { stars:5.0, count:334 },
                      'PRIME PEPTIDES': { stars:4.7, count:45 }, 'ONYX BIOLABS': { stars:5.0, count:20 },
                    };
                    for (let i = 0; i < competitors.length; i++) {
                      const c = competitors[i];
                      setCommunityScans(prev => ({ ...prev, [c.id]: { status:'loading', expandedSection: prev[c.id]?.expandedSection }, _scanAllProgress: { current: i, total: competitors.length } }));
                      const tp = Object.entries(tpMap).find(([k]) => c.name.includes(k.split(' ')[0]))?.[1] || null;
                      try {
                        const response = await fetch('/api/community-scan', {
                          method:'POST', headers:{ 'Content-Type':'application/json' },
                          body: JSON.stringify({ competitorName: c.name, country: c.country, trustpilot: tp }),
                        });
                        const data = await response.json();
                        if (data.error) throw new Error(data.error);
                        setCommunityScans(prev => ({ ...prev, [c.id]: { status:'done', result: data.result, scannedAt: new Date().toLocaleTimeString(), expandedSection: prev[c.id]?.expandedSection } }));
                      } catch(e) {
                        setCommunityScans(prev => ({ ...prev, [c.id]: { status:'error', error: e.message } }));
                      }
                      if (i < competitors.length - 1) {
                        await new Promise(r => setTimeout(r, 25000));
                      }
                    }
                    setCommunityScans(prev => ({ ...prev, _scanAllActive: false, _scanAllProgress: { current: competitors.length, total: competitors.length } }));
                  };

                  return (
                    <div style={{ display:'flex', gap:'10px', alignItems:'center', marginBottom:'16px', flexWrap:'wrap' }}>
                      <button onClick={doScanAll} disabled={anyLoading || scanAllActive}
                        style={{ padding:'10px 22px', borderRadius:'6px', fontSize:'12px', fontWeight:'600', cursor: anyLoading||scanAllActive ? 'default':'pointer', fontFamily:FF, letterSpacing:'0.5px', textTransform:'uppercase',
                          border: anyLoading||scanAllActive ? '1px solid #b0d4ff' : '1px solid #b0d4ff',
                          background: anyLoading||scanAllActive ? 'transparent' : '#0a1428',
                          color: anyLoading||scanAllActive ? '#b0d4ff' : '#b0d4ff',
                          opacity: anyLoading||scanAllActive ? 0.7 : 1 }}>
                        {scanAllActive ? `⟳ SCANNING ${scanAllProgress.current + 1} OF ${scanAllProgress.total} — 25s BETWEEN EACH` : '⟳ SCAN ALL (AUTO-DELAY)'}
                      </button>
                      {scanAllActive && (
                        <div style={{ flex:1, minWidth:'200px' }}>
                          <div style={{ height:'4px', background:'#2a2a2a', borderRadius:'2px', overflow:'hidden' }}>
                            <div style={{ height:'100%', background:'#b0d4ff', borderRadius:'2px', width:`${(scanAllProgress.current / scanAllProgress.total) * 100}%`, transition:'width 0.5s' }} />
                          </div>
                          <div style={{ display:'flex', gap:'6px', marginTop:'6px', flexWrap:'wrap' }}>
                            {competitors.map((c, i) => {
                              const st = communityScans[c.id]?.status;
                              const color = st==='done' ? { bg:'#0a1e14', border:'#40c080', text:'#b0ffd8' } : st==='loading' ? { bg:'#0a1428', border:'#b0d4ff', text:'#b0d4ff' } : st==='error' ? { bg:'#280a1e', border:'#cc4080', text:'#ffb0e0' } : { bg:'#1a1a1a', border:'#2a2a2a', text:'#555' };
                              return <span key={i} style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'99px', background:color.bg, border:`1px solid ${color.border}`, color:color.text, fontFamily:FF }}>{c.name.split(' ')[0]}</span>;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display:'grid', gap:'12px' }}>
                  {competitors.map(c => {
                    const scan = communityScans[c.id] || { status:'idle' };
                    const isLoading = scan.status === 'loading';
                    const r = scan.result;

                    const doScan = async () => {
                      if (scanCooldown > 0) return;
                      setCommunityScans(prev => ({ ...prev, [c.id]: { status:'loading', expandedSection: prev[c.id]?.expandedSection } }));
                      setLastScanTime(Date.now());
                      setScanCooldown(30);
                      const tpMap = {
                        'GROWTH GUYS': null,
                        'PURITY PEPTIDES': null,
                        'CORE PEPTIDES': { stars:4.8, count:120 },
                        'BIOTECH PEPTIDES': { stars:5.0, count:334 },
                        'PRIME PEPTIDES': { stars:4.7, count:45 },
                        'ONYX BIOLABS': { stars:5.0, count:20 },
                      };
                      const tp = Object.entries(tpMap).find(([k]) => c.name.includes(k.split(' ')[0]))?.[1] || null;
                      try {
                        const response = await fetch('/api/community-scan', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ competitorName: c.name, country: c.country, trustpilot: tp }),
                        });
                        const data = await response.json();
                        if (data.error) throw new Error(data.error);
                        setCommunityScans(prev => ({ ...prev, [c.id]: { status:'done', result: data.result, scannedAt: new Date().toLocaleTimeString(), expandedSection: prev[c.id]?.expandedSection } }));
                      } catch(e) {
                        setCommunityScans(prev => ({ ...prev, [c.id]: { status:'error', error: e.message } }));
                      }
                    };

                    const toggleSection = (section) => {
                      setCommunityScans(prev => ({ ...prev, [c.id]: { ...prev[c.id], expandedSection: prev[c.id]?.expandedSection === section ? null : section } }));
                    };

                    const expandedSection = scan.expandedSection;

                    const SectionBtn = ({ id, label, color, count }) => (
                      <button onClick={() => toggleSection(id)}
                        style={{ padding:'6px 14px', borderRadius:'5px', fontSize:'11px', cursor:'pointer', fontFamily:FF, fontWeight:'600', letterSpacing:'0.5px', transition:'all 0.15s',
                          background: expandedSection===id ? color.bg : 'transparent',
                          border: `1px solid ${expandedSection===id ? color.border : '#2a2a2a'}`,
                          color: expandedSection===id ? color.text : '#666' }}>
                        {label} {count ? `(${count})` : ''} {expandedSection===id ? '▲' : '▼'}
                      </button>
                    );

                    return (
                      <div key={c.id} className="aria-card" style={{ ...CARD,
                        borderColor: scan.status==='done' ? (r?.watchFlag ? '#3a2a0a' : '#2a3a2a') : '#2a2a2a',
                        borderLeft: scan.status==='done' ? `3px solid ${r?.watchFlag ? '#cc9040' : '#40c080'}` : '3px solid #2a2a2a' }}>

                        {/* ── HEADER ROW ── */}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: scan.status==='done' ? '14px' : '0' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                            {scan.status==='done' && (
                              <div style={{ textAlign:'center', minWidth:'44px' }}>
                                <div style={{ fontSize:'22px', fontWeight:'600', lineHeight:1, fontFamily:FF, color: r?.sentimentScore>=70?'#b0ffd8':r?.sentimentScore>=40?'#ffe0a0':'#ffb0e0' }}>{r?.sentimentScore}</div>
                                <div style={{ fontSize:'8px', color:'#555', textTransform:'uppercase', letterSpacing:'0.5px', fontFamily:FF }}>Score</div>
                              </div>
                            )}
                            <div>
                              <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'2px' }}>
                                <span style={{ fontSize:'13px', fontWeight:'600', color:'#f5e6e0', letterSpacing:'1px', fontFamily:FF }}>{c.name}</span>
                                {c.country && <span style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'99px', fontWeight:'600', background:c.country==='CA'?'#281e0a':'#0a1428', border:`1px solid ${c.country==='CA'?'#ffe0a0':'#b0d4ff'}`, color:c.country==='CA'?'#ffe0a0':'#b0d4ff' }}>{c.country}</span>}
                                {scan.status==='done' && r?.watchFlag && <span style={{ fontSize:'9px', padding:'1px 8px', borderRadius:'99px', background:'#281e0a', border:'1px solid #cc9040', color:'#ffe0a0', fontFamily:FF }}>⚠ WATCH</span>}
                              </div>
                              <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ fontSize:'11px', color:'#444', textDecoration:'none', fontFamily:FF }}>{c.website}</a>
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            {scan.status==='done' && <span style={{ fontSize:'10px', color:'#444', fontFamily:FF }}>Scanned {scan.scannedAt}</span>}
                            <button onClick={doScan} disabled={isLoading}
                              style={{ padding:'7px 16px', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:isLoading?'default':'pointer', fontFamily:FF, letterSpacing:'0.5px', textTransform:'uppercase', transition:'all 0.15s',
                                border: isLoading?'1px solid #ffe0a0': scan.status==='done' ? '1px solid #333' : '1px solid #f5e6e0',
                                background: isLoading?'transparent': scan.status==='done' ? 'transparent' : '#f5e6e0',
                                color: isLoading?'#ffe0a0': scan.status==='done' ? '#777' : '#181818',
                                opacity: isLoading?0.8:1 }}>
                              {isLoading ? '⟳ SCANNING...' : scan.status==='done' ? '↺ RESCAN' : scanCooldown > 0 ? `WAIT ${scanCooldown}s` : 'SCAN'}
                            </button>
                          </div>
                        </div>

                        {/* Error */}
                        {scan.status==='error' && (
                          <p style={{ fontSize:'12px', color:'#ffb0e0', marginTop:'8px', fontFamily:FF }}>Scan failed — {scan.error}</p>
                        )}

                        {/* ── RESULTS ── */}
                        {scan.status==='done' && r && (
                          <div>
                            {/* Summary + verdict inline */}
                            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'16px', alignItems:'start', marginBottom:'14px' }}>
                              <p style={{ fontSize:'13px', color:'#bbb', lineHeight:'1.8', margin:0, fontFamily:FF }}>{r.summary}</p>
                              <div style={{ padding:'10px 14px', borderRadius:'6px', fontSize:'12px', lineHeight:'1.6', fontFamily:FF, minWidth:'220px', maxWidth:'300px',
                                background: r.watchFlag?'#1a1a0a':'#0a1a0a',
                                border: `1px solid ${r.watchFlag?'#cc9040':'#40c080'}`,
                                color: r.watchFlag?'#ffe0a0':'#b0ffd8' }}>
                                {r.watchFlag ? '⚠ ' : '✓ '}{r.verdict}
                              </div>
                            </div>

                            {/* Latest activity */}
                            {r.latestActivity && (
                              <div style={{ fontSize:'11px', color:'#555', marginBottom:'12px', fontFamily:FF, padding:'6px 10px', background:'#141414', borderRadius:'5px', borderLeft:'2px solid #333' }}>
                                🕐 Latest: {r.latestActivity}
                              </div>
                            )}

                            {/* Section toggles */}
                            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px' }}>
                              <SectionBtn id="positive" label="👍 Praise"
                                color={{ bg:'#0a1e14', border:'#40c080', text:'#b0ffd8' }}
                                count={r.positiveReviews?.length} />
                              <SectionBtn id="negative" label="👎 Complaints"
                                color={{ bg:'#280a1e', border:'#cc4080', text:'#ffb0e0' }}
                                count={r.negativeReviews?.length} />
                              <SectionBtn id="neutral" label="≈ Observations"
                                color={{ bg:'#1a1a1a', border:'#555', text:'#aaa' }}
                                count={r.neutralObservations?.length} />
                              {r.mainIssues && r.mainIssues.length > 0 && (
                                <SectionBtn id="issues" label="⚠ Issues"
                                  color={{ bg:'#1a0e0a', border:'#ff8040', text:'#ffb080' }}
                                  count={r.mainIssues.length} />
                              )}
                              {r.suggestions && r.suggestions.length > 0 && (
                                <SectionBtn id="suggestions" label="✓ Suggestions"
                                  color={{ bg:'#0a1a0e', border:'#40c080', text:'#b0ffd8' }}
                                  count={r.suggestions.length} />
                              )}
                              {r.sources && r.sources.length > 0 && (
                                <SectionBtn id="sources" label="Sources"
                                  color={{ bg:'#0a1428', border:'#4080cc', text:'#b0d4ff' }}
                                  count={r.sources.length} />
                              )}
                            </div>

                            {/* Expanded sections */}
                            {expandedSection === 'positive' && r.positiveReviews && (
                              <div style={{ background:'#0a140e', border:'1px solid #1a3a24', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#40c080', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'10px', fontFamily:FF }}>Customer Praise</div>
                                {r.positiveReviews.map((rev, i) => (
                                  <div key={i} style={{ marginBottom:'10px', paddingBottom:'10px', borderBottom: i < r.positiveReviews.length-1 ? '1px solid #1a2a1a' : 'none' }}>
                                    <p style={{ fontSize:'13px', color:'#b0ffd8', lineHeight:'1.7', margin:'0 0 4px', fontFamily:FF }}>"{rev.quote}"</p>
                                    <span style={{ fontSize:'10px', color:'#555', fontFamily:FF }}>{rev.source} · {rev.date}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {expandedSection === 'negative' && r.negativeReviews && (
                              <div style={{ background:'#140a0e', border:'1px solid #3a1a24', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#cc4080', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'10px', fontFamily:FF }}>Customer Complaints</div>
                                {r.negativeReviews.map((rev, i) => (
                                  <div key={i} style={{ marginBottom:'10px', paddingBottom:'10px', borderBottom: i < r.negativeReviews.length-1 ? '1px solid #2a1a1a' : 'none' }}>
                                    <p style={{ fontSize:'13px', color:'#ffb0e0', lineHeight:'1.7', margin:'0 0 4px', fontFamily:FF }}>"{rev.quote}"</p>
                                    <span style={{ fontSize:'10px', color:'#555', fontFamily:FF }}>{rev.source} · {rev.date}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {expandedSection === 'neutral' && r.neutralObservations && (
                              <div style={{ background:'#141414', border:'1px solid #2a2a2a', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#888', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'10px', fontFamily:FF }}>Observations</div>
                                {r.neutralObservations.map((rev, i) => (
                                  <div key={i} style={{ marginBottom:'10px', paddingBottom:'10px', borderBottom: i < r.neutralObservations.length-1 ? '1px solid #222' : 'none' }}>
                                    <p style={{ fontSize:'13px', color:'#aaa', lineHeight:'1.7', margin:'0 0 4px', fontFamily:FF }}>"{rev.quote}"</p>
                                    <span style={{ fontSize:'10px', color:'#555', fontFamily:FF }}>{rev.source} · {rev.date}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {expandedSection === 'sources' && r.sources && (
                              <div style={{ background:'#0a0e14', border:'1px solid #1a2a3a', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#4080cc', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'8px', fontFamily:FF }}>Sources Searched</div>
                                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                                  {r.sources.map((s,i) => (
                                    <span key={i} style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'99px', background:'#0a1428', border:'1px solid #1a3a5a', color:'#b0d4ff', fontFamily:FF }}>{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {expandedSection === 'issues' && r.mainIssues && r.mainIssues.length > 0 && (
                              <div style={{ background:'#1a0e0a', border:'1px solid #3a1a0a', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#ff8040', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'10px', fontFamily:FF }}>Main Issues Found</div>
                                {r.mainIssues.map((issue, i) => (
                                  <div key={i} style={{ display:'flex', gap:'10px', marginBottom:'8px', paddingBottom:'8px', borderBottom: i < r.mainIssues.length-1 ? '1px solid #2a1a0a' : 'none' }}>
                                    <span style={{ fontSize:'11px', color:'#ff8040', flexShrink:0, fontWeight:'700', fontFamily:FF }}>{i+1}.</span>
                                    <span style={{ fontSize:'13px', color:'#ffb080', lineHeight:'1.6', fontFamily:FF }}>{issue}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {expandedSection === 'suggestions' && r.suggestions && r.suggestions.length > 0 && (
                              <div style={{ background:'#0a1a0e', border:'1px solid #1a3a1a', borderRadius:'6px', padding:'12px 14px', marginBottom:'10px' }}>
                                <div style={{ fontSize:'9px', color:'#40c080', textTransform:'uppercase', letterSpacing:'1px', marginBottom:'10px', fontFamily:FF }}>What To Do Differently</div>
                                {r.suggestions.map((s, i) => (
                                  <div key={i} style={{ display:'flex', gap:'10px', marginBottom:'8px', paddingBottom:'8px', borderBottom: i < r.suggestions.length-1 ? '1px solid #1a2a1a' : 'none' }}>
                                    <span style={{ fontSize:'13px', color:'#40c080', flexShrink:0, fontWeight:'700', fontFamily:FF }}>✓</span>
                                    <span style={{ fontSize:'13px', color:'#b0ffd8', lineHeight:'1.6', fontFamily:FF }}>{s}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
            <div className="aria-card" style={CARD}>
              <h3 style={H3}>CURRENCY SETTINGS</h3>
              <p style={P}>CAD competitors have their prices converted to USD in the Analysis tab. Update this rate when the exchange rate shifts significantly.</p>
              <div style={{ display:'flex', alignItems:'center', gap:'12px', marginTop:'12px', flexWrap:'wrap' }}>
                <div>
                  <label style={{ display:'block', fontSize:'10px', color:'#777', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'5px', fontFamily:FF }}>CAD → USD Rate</label>
                  <input type="number" step="0.01" min="0.5" max="1.2" value={cadUsdRate}
                    onChange={e => setCadUsdRate(parseFloat(e.target.value) || 0.72)}
                    style={{ width:'100px', padding:'8px 10px', background:'#111', border:'1px solid #333', borderRadius:'6px', color:'#fff', fontSize:'14px', fontFamily:FF }} />
                </div>
                <div style={{ fontSize:'13px', color:'#888', fontFamily:FF, marginTop:'18px' }}>
                  e.g. $100 CAD = ${(100 * cadUsdRate).toFixed(2)} USD at current rate
                </div>
                <button style={{ ...BTN, marginTop:'18px', fontSize:'11px', padding:'6px 12px' }} onClick={() => setCadUsdRate(0.72)}>RESET TO 0.72</button>
              </div>
            </div>

            <div className="aria-card" style={CARD}>
              <h3 style={H3}>FIX COMPETITOR COUNTRIES</h3>
              <p style={P}>If competitors were added before the country dropdown existed, set their market here without losing scan data.</p>
              <div style={{ display:'grid', gap:'8px', marginTop:'12px' }}>
                {competitors.map(c => (
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', background:'#111', borderRadius:'6px', border:'1px solid #222' }}>
                    <span style={{ flex:1, fontSize:'13px', color:'#ddd', fontFamily:FF }}>{c.name}</span>
                    <select value={c.country || 'US'} onChange={e => setCompetitors(prev => prev.map(x => x.id===c.id ? {...x, country:e.target.value, currency:e.target.value==='CA'?'CAD':'USD'} : x))}
                      style={{ padding:'6px 10px', background:'#181818', border:'1px solid #333', borderRadius:'6px', color:'#fff', fontSize:'12px', fontFamily:FF }}>
                      <option value="CA">CA — Canada</option>
                      <option value="US">US — United States</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <span style={{ fontSize:'11px', color:'#555', fontFamily:FF }}>{c.currency || 'USD'}</span>
                  </div>
                ))}
                {competitors.length === 0 && <p style={{ ...P, color:'#555' }}>No competitors added yet.</p>}
              </div>
            </div>

            <div className="aria-card" style={CARD}>
              <h3 style={H3}>DATA MANAGEMENT</h3>
              <p style={P}>All data is saved in your browser and survives page refreshes. Includes competitors, scan results, and price change history.</p>
              <button style={{ ...BTN, marginTop: '12px', borderColor: '#ffb0e0', color: '#ffb0e0' }} onClick={() => {
                if (window.confirm('Clear ALL data? This cannot be undone.')) {
                  setCompetitors([]); setScrapeResults({}); setPrevScrapeResults({}); setPriceChanges([]); setScanHistory({}); setCompNotes({});
                  ['aria_competitors','aria_results','aria_prev_results','aria_changes','aria_comp_notes','aria_scan_history'].forEach(k => localStorage.removeItem(k));
                }
              }}>CLEAR ALL DATA</button>
            </div>
            <div className="aria-card" style={CARD}>
              <h3 style={H3}>ABOUT ARIA</h3>
              <p style={P}>ARIA — Adaptive Research Intelligence Assistant</p>
              <p style={{ ...P, color: '#555' }}>v3.7 · Competitor scoring: product coverage (40pts) + lowest pricing frequency (60pts)</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

const FF = "'Century Gothic', 'Trebuchet MS', sans-serif";
const H1 = { fontSize: '28px', fontWeight: '600', marginBottom: '6px', color: '#f5e6e0', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: FF };
const SUB = { color: '#888', marginBottom: '28px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF };
const CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '22px', marginBottom: '16px', transition: 'border-color 0.15s' };
const H3 = { fontSize: '11px', fontWeight: '600', margin: '0 0 14px 0', color: '#bbb', textTransform: 'uppercase', letterSpacing: '1.5px', fontFamily: FF };
const P = { color: '#bbb', lineHeight: '1.7', marginBottom: '10px', fontSize: '14px', fontFamily: FF };
const STAT_CARD = { background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '18px', fontFamily: FF };
const STAT_LABEL = { fontSize: '10px', color: '#777', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', fontFamily: FF };
const BTN = { padding: '10px 20px', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', background: 'transparent', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF, transition: 'all 0.15s' };
const BTN_PRIMARY = { padding: '10px 20px', border: '1px solid #f5e6e0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', background: '#f5e6e0', color: '#181818', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: FF, fontWeight: '600', transition: 'all 0.15s' };
