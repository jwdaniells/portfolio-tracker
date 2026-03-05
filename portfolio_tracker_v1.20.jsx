import { useState, useEffect } from "react";

// External data files
const _cbv = Date.now();
const DATA_URL     = `./price_history-2.json?v=${_cbv}`;
const ANALYSIS_URL = `./analysis.json?v=${_cbv}`;
const loadTime = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });



const BUCKET_COLORS = {
  "High Beta / Blockchain":         "#e07060",
  "Core Multi-Asset / Balanced":    "#4472C4",
  "Global Equity":                  "#70AD47",
  "Global Equity Core":             "#70AD47",
  "Thematic / Sustainable Equity":  "#5BA3A0",
  "Diversified Growth":             "#9E7FC0",
  "Income / Bond":                  "#c9a84c",
};



const fmt     = (n, d=2) => { if (n==null||isNaN(n)) return "—"; return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",minimumFractionDigits:d,maximumFractionDigits:d}).format(n); };
const fmtNum  = (n, d=4) => { if (n==null||isNaN(n)) return "—"; return new Intl.NumberFormat("en-GB",{minimumFractionDigits:0,maximumFractionDigits:d}).format(n); };
const fmtPct  = (n)      => { if (n==null||isNaN(n)||!isFinite(n)) return "—"; return (n>=0?"+":"")+(n*100).toFixed(2)+"%"; };
const hVal    = (h)      => { if (h.units!=null&&h.price!=null) return h.units*h.price; if (h.manualValue!=null) return h.manualValue; return h.costBasis||0; };
const pensionCost = (h)  => { if (!h.pensionTracking) return h.costBasis||0; return (h.openingValue||0)+(h.contributions||[]).reduce((s,c)=>s+c.amount,0); };
const hReturn = (h)      => { const val=hVal(h),cost=h.pensionTracking?pensionCost(h):(h.costBasis||0),divs=h.dividendsReceived||0; if(!cost) return null; return {gain:val+divs-cost, pct:(val+divs-cost)/cost, includingDivs:divs>0}; };
const annReturn = (h)    => { if (!h.purchaseDate||!h.costBasis||h.costBasis===0) return null; const val=hVal(h)+(h.dividendsReceived||0),cost=h.costBasis,years=(Date.now()-new Date(h.purchaseDate).getTime())/(365.25*24*60*60*1000); if(years<0.01) return null; return Math.pow(val/cost,1/years)-1; };
const accTots = (acc)    => { const val=acc.holdings.reduce((s,h)=>s+hVal(h),0),cost=acc.holdings.reduce((s,h)=>s+pensionCost(h),0); return {value:val,cost,gain:cost>0?val-cost:null,ret:cost>0?(val-cost)/cost:null}; };
const daysAgo = (d)      => { const n=Math.floor((Date.now()-new Date(d).getTime())/86400000); return n===0?"Today":n===1?"Yesterday":`${n}d ago`; };
const hPrevVal    = (h)   => { if(h.prevPrice!=null&&h.units!=null) return h.units*h.prevPrice; if(h.prevManualValue!=null) return h.prevManualValue; return null; };
const hSinceUpdate= (h)   => { const prev=hPrevVal(h); if(prev==null||prev===0) return null; const curr=hVal(h); return {gain:curr-prev,pct:(curr-prev)/prev}; };
const accPrevVal  = (acc) => acc.holdings.reduce((s,h)=>{ const p=hPrevVal(h); return s+(p!=null?p:hVal(h)); },0);

const seedHist = (accounts, meta) => {
  const prevTotal = accounts.reduce((s,a)=>s+accPrevVal(a),0);
  const currTotal = accounts.reduce((s,a)=>s+a.holdings.reduce((ss,h)=>ss+hVal(h),0),0);
  return [
    { date: meta.prevDate,  totalValue: Math.round(prevTotal), note: "v1.10 baseline (25 Feb, BCHS corrected to £113.28)" },
    { date: meta.fetchDate, totalValue: Math.round(currTotal), note: `${meta.version} update (27 Feb, Goal tab: age labels, actuals line, Projected rename; dashboard annualised return)` },
  ];
};

export default function PortfolioTracker() {
  const [data,setData]       = useState(null);
  const [activeTab,setActiveTab] = useState("dashboard");
  const [selectedAcc,setSelectedAcc] = useState(null);
  const [editCell,setEditCell]   = useState(null);
  const [editVal,setEditVal]     = useState("");
  const [histRange,setHistRange] = useState("All");
  const [cryptoEditCell,setCryptoEditCell] = useState(null);
  const [cryptoEditVal,setCryptoEditVal]   = useState("");
  const [analysis,setAnalysis]             = useState(null);

  useEffect(()=>{(async()=>{
    try {
      const cfg = await fetch(DATA_URL).then(r=>r.json());
      const refreshH = (h, ih) => !ih ? h : {...h, price:ih.price, priceDate:ih.priceDate, manualValue:ih.manualValue, dividendsReceived:ih.dividendsReceived, prevPrice:ih.prevPrice, prevManualValue:ih.prevManualValue, fetchStatus:ih.fetchStatus};
      const buildAccounts = (stored) => stored
        ? stored.map(acc=>{ const init=cfg.accounts.find(a=>a.id===acc.id); if(!init) return acc; return {...acc,wrapper:init.wrapper,provider:init.provider,holdings:acc.holdings.map(h=>refreshH(h,init.holdings.find(x=>x.id===h.id)))}; })
        : cfg.accounts;
      let stored = null;
      try { const res=await window.storage.get("portfolio-data-v24"); if(res&&res.value) stored=JSON.parse(res.value); } catch {}
      const accounts = buildAccounts(stored?.accounts||null);
      // History is always driven by the JSON file — grows with each price fetch
      const history  = cfg.history?.length ? cfg.history : seedHist(accounts, cfg.meta);
      // Crypto — refresh prices from JSON but keep user-edited units from storage
      const cfgCrypto = cfg.crypto || [];
      const crypto = stored?.crypto
        ? stored.crypto.map(c => { const init=cfgCrypto.find(x=>x.id===c.id); return init ? {...c, price:init.price, priceDate:init.priceDate, prevPrice:init.prevPrice} : c; })
        : cfgCrypto;
      const cryptoHistory = cfg.cryptoHistory || [];
      setData({ meta:cfg.meta, lastFetch:{date:cfg.meta.fetchDateDisplay,time:loadTime(),priceDate:cfg.meta.fetchDate}, accounts, history, crypto, cryptoHistory });
    } catch(e) { console.error("Failed to load portfolio data:", e); }
    // Load analysis data (non-blocking — tab still works without it)
    try { const a = await fetch(ANALYSIS_URL).then(r=>r.ok?r.json():null); if(a) setAnalysis(a); } catch {}
  })(); },[]);
  useEffect(()=>{ if(data) window.storage.set("portfolio-data-v24",JSON.stringify(data)).catch(()=>{}); },[data]);

  if(!data) return <div style={{background:"#0f1923",color:"#c9a84c",padding:40,fontFamily:"sans-serif",textAlign:"center"}}>Loading…</div>;

  const { version, prevDateDisplay } = data.meta;

  const totalVal  = data.accounts.reduce((s,a)=>s+a.holdings.reduce((ss,h)=>ss+hVal(h),0),0);
  const totalCost = data.accounts.reduce((s,a)=>s+a.holdings.reduce((ss,h)=>ss+pensionCost(h),0),0);
  const totalGain = totalVal-totalCost;
  const totalPrev = data.accounts.reduce((s,a)=>s+accPrevVal(a),0);
  const totalSinceUpdate = totalVal-totalPrev;
  const totalSincePct    = totalPrev>0?totalSinceUpdate/totalPrev:null;
  const bucketMap={}; data.accounts.forEach(a=>a.holdings.forEach(h=>{ const b=h.bucket||"Other"; bucketMap[b]=(bucketMap[b]||0)+hVal(h); }));
  const buckets = Object.entries(bucketMap).sort((a,b)=>b[1]-a[1]);
  const allWA   = data.accounts.flatMap(a=>a.holdings.map(h=>({...h,accId:a.id})));
  const fOk     = allWA.filter(h=>h.fetchStatus&&h.fetchStatus.ok===true).length;
  const fWarn   = allWA.filter(h=>h.fetchStatus&&h.fetchStatus.ok==="manual").length;
  const fFail   = allWA.filter(h=>h.fetchStatus&&h.fetchStatus.ok===false).length;
  const fTotal  = allWA.filter(h=>h.fetchStatus).length;

  // Portfolio-level annualised return (value-weighted)
  const portAnnReturn = (()=>{
    const holdings = data.accounts.flatMap(a=>a.holdings);
    let wAnn=0, wTotal=0;
    holdings.forEach(h=>{
      if(!h.purchaseDate||!h.costBasis||h.costBasis===0) return;
      const val=hVal(h)+(h.dividendsReceived||0), cost=h.costBasis;
      const y=(Date.now()-new Date(h.purchaseDate).getTime())/(365.25*24*60*60*1000);
      if(y<0.01) return;
      const r=Math.pow(val/cost,1/y)-1;
      wAnn+=r*hVal(h); wTotal+=hVal(h);
    });
    return wTotal>0 ? wAnn/wTotal : null;
  })();

  const startEdit  = (k,v) => { setEditCell(k); setEditVal(v!=null?String(v):""); };
  const commitEdit = (aId,hId,field) => { const v=parseFloat(editVal),today=new Date().toISOString().slice(0,10); setData(d=>({...d,accounts:d.accounts.map(a=>{ if(a.id!==aId) return a; return {...a,holdings:a.holdings.map(h=>{ if(h.id!==hId) return h; const up={...h,[field]:isNaN(v)?null:v}; if(field==="price"||field==="manualValue") up.priceDate=today; return up; })}; })})); setEditCell(null); };

  const S={
    wrap:{background:"#0f1923",minHeight:"100vh",fontFamily:"'Segoe UI',sans-serif",color:"#e8dcc8",fontSize:13},
    nav:{background:"#0a1420",borderBottom:"1px solid #1e2f3e",display:"flex",alignItems:"center",padding:"0 20px",gap:4},
    logo:{color:"#c9a84c",fontWeight:700,fontSize:15,letterSpacing:"0.12em",textTransform:"uppercase",marginRight:20,padding:"14px 0"},
    ver:{color:"#3a4d60",fontSize:10,letterSpacing:"0.08em",marginLeft:"auto",padding:"0 8px"},
    tab:a=>({padding:"14px 16px",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",border:"none",background:"transparent",color:a?"#c9a84c":"#6a7d8f",borderBottom:a?"2px solid #c9a84c":"2px solid transparent",fontFamily:"inherit"}),
    body:{padding:"20px 24px",maxWidth:1600,margin:"0 auto"},
    card:{background:"#121e2b",border:"1px solid #1e2f3e",borderRadius:4,padding:"16px 20px",marginBottom:16},
    g3:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16},
    g4:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16},
    g5:{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:16},
    sBox:{background:"#121e2b",border:"1px solid #1e2f3e",borderRadius:4,padding:"14px 16px"},
    sLbl:{fontSize:10,color:"#6a7d8f",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6},
    sec:{fontSize:10,color:"#6a7d8f",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:12,paddingBottom:8,borderBottom:"1px solid #1e2f3e"},
    tbl:{width:"100%",borderCollapse:"collapse"},
    th:{padding:"8px 10px",borderBottom:"1px solid #1e2f3e",color:"#6a7d8f",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"left",whiteSpace:"nowrap"},
    thR:{padding:"8px 10px",borderBottom:"1px solid #1e2f3e",color:"#6a7d8f",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"right",whiteSpace:"nowrap"},
    thC:{padding:"8px 10px",borderBottom:"1px solid #1e2f3e",color:"#6a7d8f",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap"},
    td:{padding:"9px 10px",borderBottom:"1px solid #1e2f3e",color:"#e8dcc8",verticalAlign:"middle"},
    tdR:{padding:"9px 10px",borderBottom:"1px solid #1e2f3e",color:"#e8dcc8",textAlign:"right",verticalAlign:"middle",fontVariantNumeric:"tabular-nums"},
    tdC:{padding:"9px 10px",borderBottom:"1px solid #1e2f3e",color:"#e8dcc8",textAlign:"center",verticalAlign:"middle"},
    gain:v=>({padding:"9px 10px",borderBottom:"1px solid #1e2f3e",textAlign:"right",verticalAlign:"middle",fontVariantNumeric:"tabular-nums",color:v==null?"#6a7d8f":v>=0?"#70AD47":"#e07060"}),
    pill:c=>({display:"inline-block",padding:"2px 7px",borderRadius:2,fontSize:9,background:c+"22",color:c,border:`1px solid ${c}44`,whiteSpace:"nowrap"}),
    ticker:{display:"inline-block",padding:"2px 6px",borderRadius:2,fontSize:9,background:"#c9a84c18",color:"#c9a84c",border:"1px solid #c9a84c44",letterSpacing:"0.06em",fontFamily:"monospace",marginBottom:2},
    isin:{display:"inline-block",padding:"2px 6px",borderRadius:2,fontSize:9,background:"#1e3040",color:"#6a7d8f",border:"1px solid #2a3d50",letterSpacing:"0.04em",fontFamily:"monospace"},
    input:{background:"#0f1923",border:"1px solid #c9a84c88",color:"#c9a84c",padding:"3px 6px",fontSize:12,fontFamily:"inherit",width:100,textAlign:"right",outline:"none",borderRadius:2},
    dateBadge:stale=>({display:"inline-block",padding:"1px 5px",borderRadius:2,fontSize:9,background:stale?"#3d1e1e":"#1e2f3e",color:stale?"#e07060":"#6a7d8f",border:`1px solid ${stale?"#e0706033":"#2a3d50"}`,fontFamily:"monospace"}),
    rBtn:a=>({padding:"4px 10px",fontSize:10,letterSpacing:"0.1em",border:"1px solid",borderColor:a?"#c9a84c":"#2a3d50",background:a?"#c9a84c18":"transparent",color:a?"#c9a84c":"#6a7d8f",cursor:"pointer",borderRadius:2,fontFamily:"inherit"}),
    backBtn:{background:"transparent",border:"1px solid #2a3d50",color:"#6a7d8f",padding:"5px 12px",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",borderRadius:2,fontFamily:"inherit",marginBottom:16},
  };

  const EN=({cellKey,value,onCommit,currency=true})=>{ if(editCell===cellKey) return <input autoFocus style={S.input} value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={onCommit} onKeyDown={e=>{ if(e.key==="Enter") onCommit(); if(e.key==="Escape") setEditCell(null); }}/>; const disp=value!=null&&value!==0?(currency?fmt(value):fmtNum(value)):<span style={{color:"#3a4d60"}}>—</span>; return <span onClick={()=>startEdit(cellKey,value)} style={{cursor:"text",borderBottom:"1px dashed #2a3d50",paddingBottom:1}} title="Click to edit">{disp}</span>; };
  const FetchBadge=({fetchStatus:s})=>{ if(!s) return <span style={{color:"#3a4d60",fontSize:11}}>—</span>; if(s.ok==="manual") return <span title={s.source} style={{fontSize:13}}>⚠️</span>; if(s.ok) return <span title={s.source} style={{fontSize:13}}>✅</span>; return <span title={s.source} style={{fontSize:13}}>❌</span>; };
  const Chart=()=>{ const hist=data.history||[]; if(hist.length<2) return <div style={{textAlign:"center",color:"#3a4d60",padding:40,fontSize:12}}>Need at least 2 data points to chart.</div>; const ranges={"24H":1,"1M":30,"3M":91,"6M":182,"1Y":365,"All":99999}; const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-ranges[histRange]); const pts=hist.filter(h=>new Date(h.date)>=cutoff); const use=pts.length>=2?pts:hist.slice(-2); const W=680,H=160,P={t:10,r:10,b:30,l:70}; const vals=use.map(p=>p.totalValue),minV=Math.min(...vals),maxV=Math.max(...vals),rng=maxV-minV||1; const toX=i=>P.l+(i/(use.length-1))*(W-P.l-P.r); const toY=v=>P.t+(1-(v-minV)/rng)*(H-P.t-P.b); const pathD=use.map((p,i)=>`${i===0?"M":"L"}${toX(i)},${toY(p.totalValue)}`).join(" "); const areaD=pathD+` L${toX(use.length-1)},${H-P.b} L${toX(0)},${H-P.b} Z`; const chg=use[use.length-1].totalValue-use[0].totalValue,chgPct=use[0].totalValue>0?chg/use[0].totalValue:0,lc=chg>=0?"#70AD47":"#e07060"; const ticks=[minV,(minV+maxV)/2,maxV]; return (<div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div><span style={{fontSize:11,color:"#9ab"}}>Change: </span><span style={{fontSize:13,color:lc,fontVariantNumeric:"tabular-nums"}}>{fmt(chg,0)} ({fmtPct(chgPct)})</span></div><div style={{display:"flex",gap:6}}>{["24H","1M","3M","6M","1Y","All"].map(r=><button key={r} style={S.rBtn(histRange===r)} onClick={()=>setHistRange(r)}>{r}</button>)}</div></div><svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lc} stopOpacity="0.3"/><stop offset="100%" stopColor={lc} stopOpacity="0"/></linearGradient></defs>{ticks.map((v,i)=><g key={i}><line x1={P.l} y1={toY(v)} x2={W-P.r} y2={toY(v)} stroke="#1e2f3e" strokeDasharray="3,3"/><text x={P.l-6} y={toY(v)+4} textAnchor="end" fontSize="9" fill="#4a6070">{(v/1000).toFixed(0)}k</text></g>)}<path d={areaD} fill="url(#ag)"/><path d={pathD} fill="none" stroke={lc} strokeWidth="1.5"/>{use.map((p,i)=><circle key={i} cx={toX(i)} cy={toY(p.totalValue)} r="2.5" fill={lc}/>)}{use.map((p,i)=>{ const step=Math.max(1,Math.floor(use.length/6)); return(i%step===0||i===use.length-1)?<text key={i} x={toX(i)} y={H-P.b+14} textAnchor="middle" fontSize="8" fill="#4a6070">{p.date.slice(5)}</text>:null; })}</svg></div>); };

  const lf=data.lastFetch||{};

  return (
    <div style={S.wrap}>
      <nav style={S.nav}>
        <div style={S.logo}>Daniells Portfolio</div>
        {[["dashboard","Dashboard"],["account","Accounts"],["allocation","Allocation"],["history","History"],["goal","Goal"],["analysis","Analysis"],["crypto","Crypto"]].map(([id,label])=>(<button key={id} style={S.tab(activeTab===id)} onClick={()=>{ setActiveTab(id); if(id!=="account") setSelectedAcc(null); }}>{label}</button>))}
        <a href="./retirement.html" style={{marginLeft:"auto",color:"#6a7d8f",textDecoration:"none",fontSize:10,letterSpacing:"0.1em",padding:"14px 12px",borderBottom:"2px solid transparent",display:"flex",alignItems:"center",gap:4}} onMouseEnter={e=>e.currentTarget.style.color="#c9a84c"} onMouseLeave={e=>e.currentTarget.style.color="#6a7d8f"}>RETIREMENT PLANNER →</a>
        <div style={S.ver}>{version}</div>
      </nav>

      {activeTab==="dashboard"&&(<div style={S.body}>
        <div style={S.g5}>
          <div style={S.sBox}><div style={S.sLbl}>Total Value</div><div style={{fontSize:22,color:"#c9a84c",fontVariantNumeric:"tabular-nums"}}>{fmt(totalVal,0)}</div></div>
          <div style={S.sBox}><div style={S.sLbl}>Cost Basis</div><div style={{fontSize:22,color:"#e8dcc8",fontVariantNumeric:"tabular-nums"}}>{fmt(totalCost,0)}</div></div>
          <div style={S.sBox}><div style={S.sLbl}>Total Gain</div><div style={{fontSize:22,color:totalGain>=0?"#70AD47":"#e07060",fontVariantNumeric:"tabular-nums"}}>{fmt(totalGain,0)}</div></div>
          <div style={S.sBox}>
            <div style={S.sLbl}>Return</div>
            <div style={{fontSize:22,color:totalGain>=0?"#70AD47":"#e07060",fontVariantNumeric:"tabular-nums"}}>{fmtPct(totalCost>0?totalGain/totalCost:null)}</div>
            <div style={{fontSize:11,color:totalGain>=0?"#70AD47":"#e07060",marginTop:4,fontVariantNumeric:"tabular-nums"}}>{portAnnReturn!=null?fmtPct(portAnnReturn)+" p.a.":"—"}</div>
          </div>
          <div style={{...S.sBox,borderColor:totalSinceUpdate>=0?"#70AD4744":"#e0706044"}}><div style={S.sLbl}>Since {prevDateDisplay}</div><div style={{fontSize:18,color:totalSinceUpdate>=0?"#70AD47":"#e07060",fontVariantNumeric:"tabular-nums"}}>{fmt(totalSinceUpdate,0)}</div><div style={{fontSize:13,color:totalSinceUpdate>=0?"#70AD47":"#e07060",marginTop:2}}>{fmtPct(totalSincePct)}</div></div>
        </div>
        <div style={{...S.card,padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><span style={{fontSize:11,color:"#6a7d8f",letterSpacing:"0.08em",textTransform:"uppercase"}}>Prices as at </span><span style={{fontSize:12,color:"#e8dcc8"}}>{lf.date||"—"} · {lf.time||""}</span><span style={{fontSize:11,color:"#4a6070",marginLeft:12}}>· % change vs </span><span style={{fontSize:11,color:"#9ab"}}>{prevDateDisplay}</span></div>
          <div style={{fontSize:11}}><span style={{color:"#70AD47"}}>✅ {fOk} fetched</span>{fWarn>0&&<span style={{color:"#FFC000"}}> · ⚠️ {fWarn} manual</span>}{fFail>0&&<span style={{color:"#e07060"}}> · ❌ {fFail} failed</span>}<span style={{color:"#4a6070"}}> / {fTotal} holdings</span></div>
        </div>
        <div style={S.card}><div style={S.sec}>Accounts</div><table style={S.tbl}><thead><tr><th style={S.th}>Account</th><th style={S.th}>Holder</th><th style={S.th}>Provider</th><th style={S.thR}>Cost Basis</th><th style={S.thR}>Value</th><th style={S.thR}>Gain</th><th style={S.thR}>Return</th><th style={{...S.thR,color:"#9ab"}}>Since {prevDateDisplay}</th></tr></thead><tbody>{data.accounts.filter(a=>a.holdings.length>0).map(acc=>{ const t=accTots(acc); const prev=accPrevVal(acc); const sinceGain=t.value-prev; const sincePct=prev>0?sinceGain/prev:null; return (<tr key={acc.id} style={{cursor:"pointer"}} onClick={()=>{ setSelectedAcc(acc.id); setActiveTab("account"); }} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={S.td}>{acc.wrapper}</td><td style={S.td}>{acc.holder}</td><td style={{...S.td,color:"#6a7d8f",fontSize:11}}>{acc.provider}</td><td style={S.tdR}>{t.cost>0?fmt(t.cost):<span style={{color:"#3a4d60"}}>—</span>}</td><td style={S.tdR}>{fmt(t.value)}</td><td style={S.gain(t.gain)}>{t.gain!=null?fmt(t.gain):"—"}</td><td style={S.gain(t.ret)}>{t.ret!=null?fmtPct(t.ret):"—"}</td><td style={S.gain(sincePct)}>{sincePct!=null?<span>{fmtPct(sincePct)}<span style={{fontSize:9,color:"#6a7d8f",marginLeft:3}}>({fmt(sinceGain,0)})</span></span>:"—"}</td></tr>); })}</tbody><tfoot><tr style={{borderTop:"1px solid #c9a84c33"}}><td style={{...S.td,color:"#c9a84c",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}} colSpan={3}>Total</td><td style={{...S.tdR,color:"#c9a84c"}}>{fmt(totalCost,0)}</td><td style={{...S.tdR,color:"#c9a84c"}}>{fmt(totalVal,0)}</td><td style={{...S.gain(totalGain),color:"#c9a84c"}}>{fmt(totalGain,0)}</td><td style={{...S.gain(totalGain),color:"#c9a84c"}}>{fmtPct(totalGain/totalCost)}</td><td style={{...S.gain(totalSinceUpdate),color:totalSinceUpdate>=0?"#70AD47":"#e07060"}}>{fmtPct(totalSincePct)}<span style={{fontSize:9,marginLeft:3}}>({fmt(totalSinceUpdate,0)})</span></td></tr></tfoot></table></div>
        <div style={S.card}><div style={S.sec}>Allocation</div><div style={{display:"flex",gap:2,height:12,borderRadius:4,overflow:"hidden",marginBottom:10}}>{buckets.map(([name,val])=><div key={name} title={`${name}: ${fmt(val,0)} (${(val/totalVal*100).toFixed(1)}%)`} style={{flex:val,background:BUCKET_COLORS[name]||"#4a6070"}}/>)}</div><div style={{display:"flex",flexWrap:"wrap",gap:"6px 16px"}}>{buckets.map(([name,val])=>(<div key={name} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}><div style={{width:8,height:8,borderRadius:1,background:BUCKET_COLORS[name]||"#4a6070",flexShrink:0}}/><span style={{color:"#9ab"}}>{name}</span><span style={{color:"#c9a84c",fontVariantNumeric:"tabular-nums"}}>{(val/totalVal*100).toFixed(1)}%</span></div>))}</div></div>
        <div style={S.card}><div style={S.sec}>Portfolio History</div><Chart/></div>
      </div>)}

      {activeTab==="account"&&!selectedAcc&&(<div style={S.body}><div style={S.card}><div style={S.sec}>Select an Account</div><table style={S.tbl}><thead><tr><th style={S.th}>Wrapper</th><th style={S.th}>Holder</th><th style={S.th}>Provider</th><th style={S.thR}>Value</th><th style={S.thR}>Gain</th><th style={S.thR}>Return</th><th style={{...S.thR,color:"#9ab"}}>Since {prevDateDisplay}</th></tr></thead><tbody>{data.accounts.filter(a=>a.holdings.length>0).map(acc=>{ const t=accTots(acc); const prev=accPrevVal(acc); const sinceGain=t.value-prev; const sincePct=prev>0?sinceGain/prev:null; return (<tr key={acc.id} style={{cursor:"pointer"}} onClick={()=>setSelectedAcc(acc.id)} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={S.td}>{acc.wrapper}</td><td style={S.td}>{acc.holder}</td><td style={{...S.td,color:"#6a7d8f",fontSize:11}}>{acc.provider}</td><td style={S.tdR}>{fmt(t.value)}</td><td style={S.gain(t.gain)}>{t.gain!=null?fmt(t.gain):"—"}</td><td style={S.gain(t.ret)}>{t.ret!=null?fmtPct(t.ret):"—"}</td><td style={S.gain(sincePct)}>{sincePct!=null?fmtPct(sincePct):"—"}</td></tr>); })}</tbody></table></div></div>)}

      {activeTab==="account"&&selectedAcc&&(()=>{ const acc=data.accounts.find(a=>a.id===selectedAcc); if(!acc) return null; const t=accTots(acc); const accPrev=accPrevVal(acc); const accSinceGain=t.value-accPrev; const accSincePct=accPrev>0?accSinceGain/accPrev:null; return (<div style={S.body}>
        <button style={S.backBtn} onClick={()=>{ setSelectedAcc(null); setActiveTab("dashboard"); }}>← Back</button>
        <div style={{...S.card,padding:"16px 20px",marginBottom:16}}><div style={{fontSize:18,color:"#c9a84c"}}>{acc.holder} — {acc.wrapper}</div><div style={{fontSize:11,color:"#6a7d8f",marginTop:2}}>{acc.provider}</div></div>
        <div style={S.g4}><div style={S.sBox}><div style={S.sLbl}>Cost Basis</div><div style={{fontSize:18,color:"#e8dcc8"}}>{t.cost>0?fmt(t.cost):"—"}</div></div><div style={S.sBox}><div style={S.sLbl}>Current Value</div><div style={{fontSize:18,color:"#e8dcc8"}}>{fmt(t.value)}</div></div><div style={S.sBox}><div style={S.sLbl}>Gain / Return</div><div style={{fontSize:18,color:t.gain!=null&&t.gain>=0?"#70AD47":"#e07060"}}>{t.gain!=null?`${fmt(t.gain)} · ${fmtPct(t.ret)}`:""}</div></div><div style={{...S.sBox,borderColor:accSinceGain>=0?"#70AD4744":"#e0706044"}}><div style={S.sLbl}>Since {prevDateDisplay}</div><div style={{fontSize:18,color:accSinceGain>=0?"#70AD47":"#e07060"}}>{fmt(accSinceGain,0)}</div><div style={{fontSize:13,color:accSinceGain>=0?"#70AD47":"#e07060",marginTop:2}}>{fmtPct(accSincePct)}</div></div></div>
        {acc.holdings.length>0?(<div style={S.card}><div style={S.sec}>Holdings — click price, units or cost basis to edit · <span style={{color:"#9ab"}}>% change vs {prevDateDisplay}</span></div><div style={{overflowX:"auto"}}><table style={S.tbl}><thead><tr><th style={S.th}>Fund / Asset</th><th style={S.th}>Ticker / ISIN</th><th style={S.thC}>Update</th><th style={S.th}>Bucket</th><th style={S.thR}>Units</th><th style={S.thR}>Price (£)</th><th style={S.th}>Price Date</th><th style={S.thR}>Cost Basis</th><th style={S.thR}>Divs Rcvd</th><th style={S.thR}>Value</th><th style={{...S.thR,color:"#9ab"}}>Since {prevDateDisplay}</th><th style={S.thR}>Gain / Loss</th><th style={S.thR}>Total Return</th><th style={S.thR}>Ann. Return</th><th style={S.thR}>Alloc.</th></tr></thead><tbody>{acc.holdings.map(h=>{ const val=hVal(h),tr=hReturn(h),gain=tr?tr.gain:null,ret=tr?tr.pct:null,alloc=t.value>0?val/t.value:0,bc=BUCKET_COLORS[h.bucket]||"#4a6070",stale=h.priceDate?((Date.now()-new Date(h.priceDate).getTime())/86400000)>3:false; const since=hSinceUpdate(h); return (<tr key={h.id} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={{...S.td,maxWidth:180,fontSize:11}}>{h.name}</td><td style={{...S.td,whiteSpace:"nowrap"}}><div style={{display:"flex",flexDirection:"column",gap:3}}>{h.ticker&&<div style={S.ticker}>{h.ticker}</div>}{h.isin&&<div style={S.isin}>{h.isin}</div>}{!h.ticker&&!h.isin&&<span style={{color:"#3a4d60",fontSize:10}}>—</span>}</div></td><td style={S.tdC}><FetchBadge fetchStatus={h.fetchStatus}/></td><td style={S.td}><span style={S.pill(bc)}>{h.bucket||"—"}</span></td><td style={S.tdR}><EN cellKey={`${acc.id}-${h.id}-units`} value={h.units} onCommit={()=>commitEdit(acc.id,h.id,"units")} currency={false}/></td><td style={S.tdR}><EN cellKey={`${acc.id}-${h.id}-price`} value={h.price} onCommit={()=>commitEdit(acc.id,h.id,"price")}/></td><td style={S.td}><span style={S.dateBadge(stale)}>{h.priceDate?daysAgo(h.priceDate):"—"}{stale?" ⚠":""}</span></td><td style={S.tdR}><EN cellKey={`${acc.id}-${h.id}-cb`} value={h.costBasis} onCommit={()=>commitEdit(acc.id,h.id,"costBasis")}/></td><td style={S.tdR}>{h.dividendsReceived!=null?<EN cellKey={`${acc.id}-${h.id}-divs`} value={h.dividendsReceived} onCommit={()=>commitEdit(acc.id,h.id,"dividendsReceived")}/>:<span style={{color:"#3a4d60",fontSize:10}}>—</span>}</td><td style={S.tdR}>{fmt(val)}</td><td style={S.gain(since?since.pct:null)}>{since?<span>{fmtPct(since.pct)}<br/><span style={{fontSize:9,color:"#6a7d8f"}}>{fmt(since.gain,0)}</span></span>:"—"}</td><td style={S.gain(gain)}>{gain!=null?fmt(gain):"—"}</td><td style={S.gain(ret)}>{ret!=null?<span>{fmtPct(ret)}{tr&&tr.includingDivs&&<span style={{fontSize:9,color:"#9ab",marginLeft:3}}>incl.divs</span>}</span>:"—"}</td>{(()=>{ const ann=annReturn(h); return <td style={S.gain(ann)}>{ann!=null?<span>{fmtPct(ann)}<span style={{fontSize:9,color:"#6a7d8f",marginLeft:3}}>p.a.</span></span>:"—"}</td>; })()}<td style={S.tdR}>{(alloc*100).toFixed(1)}%</td></tr>); })}</tbody></table></div></div>):<div style={{...S.card,textAlign:"center",color:"#3a4d60",padding:"40px 20px"}}>No holdings recorded.</div>}
        {acc.holdings.some(h=>h.pensionTracking)&&(()=>{ const ph=acc.holdings.find(h=>h.pensionTracking),contribs=ph.contributions||[],totalContribs=contribs.reduce((s,c)=>s+c.amount,0); return (<div style={S.card}><div style={S.sec}>Pension Contributions Log</div><div style={{...S.g3,marginBottom:16}}><div style={S.sBox}><div style={S.sLbl}>Opening Value ({ph.openingDate||""})</div><div style={{fontSize:16,color:"#e8dcc8"}}>{fmt(ph.openingValue||0)}</div></div><div style={S.sBox}><div style={S.sLbl}>Contributions ({contribs.length} payments)</div><div style={{fontSize:16,color:"#e8dcc8"}}>{fmt(totalContribs)}</div></div><div style={S.sBox}><div style={S.sLbl}>Total Invested</div><div style={{fontSize:16,color:"#c9a84c"}}>{fmt((ph.openingValue||0)+totalContribs)}</div></div></div><table style={S.tbl}><thead><tr><th style={S.th}>Date</th><th style={S.thR}>Amount</th><th style={S.thR}>Running Total</th></tr></thead><tbody><tr onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={{...S.td,color:"#6a7d8f",fontSize:11}}>Opening value ({ph.openingDate})</td><td style={S.tdR}>{fmt(ph.openingValue||0)}</td><td style={S.tdR}>{fmt(ph.openingValue||0)}</td></tr>{contribs.map((c,i)=>{ const running=(ph.openingValue||0)+contribs.slice(0,i+1).reduce((s,x)=>s+x.amount,0); return (<tr key={i} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={{...S.td,fontFamily:"monospace",fontSize:11}}>{c.date}</td><td style={S.tdR}>{fmt(c.amount)}</td><td style={S.tdR}>{fmt(running)}</td></tr>); })}</tbody></table><div style={{marginTop:12,fontSize:11,color:"#6a7d8f"}}>Monthly contribution: {fmt(2010.67)} · Update manually each month</div></div>); })()}
      </div>); })()}

      {activeTab==="allocation"&&(<div style={S.body}>
        <div style={S.card}><div style={S.sec}>Asset Allocation by Bucket</div><table style={S.tbl}><thead><tr><th style={S.th}>Bucket</th><th style={S.thR}>Value</th><th style={S.thR}>Weight</th><th style={{...S.th,width:"40%"}}>Bar</th></tr></thead><tbody>{buckets.map(([name,val])=>{ const pct=val/totalVal,color=BUCKET_COLORS[name]||"#4a6070"; return (<tr key={name} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={S.td}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}}/>{name}</div></td><td style={S.tdR}>{fmt(val,0)}</td><td style={S.tdR}>{(pct*100).toFixed(1)}%</td><td style={S.td}><div style={{background:"#0f1923",borderRadius:2,height:8,overflow:"hidden"}}><div style={{height:"100%",background:color,width:`${pct*100}%`,borderRadius:2}}/></div></td></tr>); })}</tbody></table></div>
        <div style={S.card}><div style={S.sec}>All Holdings by Value — combined across accounts</div><div style={{overflowX:"auto"}}><table style={S.tbl}><thead><tr><th style={S.th}>Fund</th><th style={S.th}>Bucket</th><th style={S.th}>ISIN</th><th style={S.thR}>Total Value</th><th style={S.thR}>Weight</th><th style={S.th}>Held In</th></tr></thead><tbody>{(()=>{ const groups={}; data.accounts.forEach(acc=>acc.holdings.forEach(h=>{ const key=h.isin||h.name; if(!groups[key]) groups[key]={name:h.name,bucket:h.bucket,isin:h.isin,ticker:h.ticker,totalVal:0,accounts:[]}; groups[key].totalVal+=hVal(h); groups[key].accounts.push(acc.wrapper+(acc.holder?" ("+acc.holder+")":"")); })); return Object.values(groups).sort((a,b)=>b.totalVal-a.totalVal).map((g,i)=>{ const pct=g.totalVal/totalVal,color=BUCKET_COLORS[g.bucket]||"#4a6070"; return (<tr key={i} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={{...S.td,fontSize:11}}>{g.ticker&&<div style={S.ticker}>{g.ticker}</div>}<div style={{marginTop:g.ticker?3:0}}>{g.name}</div></td><td style={S.td}><span style={S.pill(color)}>{g.bucket}</span></td><td style={{...S.td,fontFamily:"monospace",fontSize:10,color:"#6a7d8f"}}>{g.isin||"—"}</td><td style={S.tdR}>{fmt(g.totalVal,0)}</td><td style={S.tdR}>{(pct*100).toFixed(1)}%</td><td style={{...S.td,fontSize:10,color:"#6a7d8f"}}>{g.accounts.join(" · ")}</td></tr>); }); })()}</tbody></table></div></div>
      </div>)}

      {activeTab==="history"&&(<div style={S.body}>
        <div style={S.card}><div style={S.sec}>Portfolio Value Over Time</div><Chart/></div>
        <div style={S.card}><div style={S.sec}>Update Log</div><table style={S.tbl}><thead><tr><th style={S.th}>Date</th><th style={S.thR}>Value</th><th style={S.thR}>Change (£)</th><th style={S.thR}>Change (%)</th><th style={S.th}>Note</th></tr></thead><tbody>{[...(data.history||[])].reverse().map((h,i,arr)=>{ const prev=arr[i+1]; const chg=prev?h.totalValue-prev.totalValue:null; const chgPct=prev&&prev.totalValue>0?chg/prev.totalValue:null; return (<tr key={i} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}><td style={{...S.td,fontFamily:"monospace",fontSize:11}}>{h.date}</td><td style={S.tdR}>{fmt(h.totalValue,0)}</td><td style={S.gain(chg)}>{chg!=null?fmt(chg,0):"—"}</td><td style={S.gain(chgPct)}>{chgPct!=null?fmtPct(chgPct):"—"}</td><td style={{...S.td,color:"#6a7d8f",fontSize:11}}>{h.note||""}</td></tr>); })}</tbody></table></div>
      </div>)}

      {activeTab==="goal"&&(()=>{
        const GOAL        = 1400000;
        const BASELINE    = 857270;
        const BASELINE_DT = new Date("2026-02-25");
        const MONTHLY     = 2010.67;
        const RATE_REQ    = 0.0790;
        const RATE_PROJ   = 0.115;
        const RATE_BEAR   = 0.06;
        const RATE_BULL   = 0.17;
        const JOHN_DOB    = new Date("1968-03-27");

        const project = (start, rate, months, monthly) => {
          const mr = Math.pow(1 + rate, 1/12) - 1;
          let v = start;
          const full = Math.floor(months);
          const frac = months - full;
          for (let m = 0; m < full; m++) v = v * (1 + mr) + monthly;
          if (frac > 0) v = v * (1 + mr * frac);
          return v;
        };

        const months = 61;
        const pts = Array.from({length: months}, (_, m) => {
          const dt = new Date(BASELINE_DT);
          dt.setMonth(dt.getMonth() + m);
          const age = Math.floor((dt - JOHN_DOB) / (365.25*24*60*60*1000));
          return {
            m, dt, age,
            yearLabel: m % 12 === 0 ? `${dt.getFullYear()}` : null,
            ageLabel:  m % 12 === 0 ? `Age ${age}` : null,
            midLabel:  m % 12 === 6 ? `Jul'${String(dt.getFullYear()).slice(2)}` : null,
            bear:     project(BASELINE, RATE_BEAR, m, MONTHLY),
            proj:     project(BASELINE, RATE_PROJ, m, MONTHLY),
            bull:     project(BASELINE, RATE_BULL, m, MONTHLY),
            required: project(BASELINE, RATE_REQ,  m, MONTHLY),
          };
        });

        const daysSince = (new Date("2026-02-27") - BASELINE_DT) / 86400000;
        const mSince = daysSince / 30.44;
        const currentOnReq = project(BASELINE, RATE_REQ, mSince, MONTHLY);
        const currentActual = totalVal;
        const isAheadOfRequired = currentActual >= currentOnReq;

        const val5Proj = project(BASELINE, RATE_PROJ, 60, MONTHLY);
        const val5Bear = project(BASELINE, RATE_BEAR, 60, MONTHLY);
        const val5Bull = project(BASELINE, RATE_BULL, 60, MONTHLY);

        // Actuals from history mapped to months-since-baseline
        const actuals = (data.history||[]).map(h => {
          const mOff = (new Date(h.date) - BASELINE_DT) / (30.44*24*60*60*1000);
          return { m: mOff, v: h.totalValue };
        }).filter(a => a.m >= 0 && a.m <= 60).sort((a,b) => a.m - b.m);

        const W=700, H=240, P={t:16,r:40,b:52,l:80};
        const allVals = [GOAL*1.05, pts[0].bear*0.97];
        pts.forEach(p => { allVals.push(p.bear, p.bull); });
        const minV = Math.min(...allVals);
        const maxV = Math.max(...allVals);
        const rng  = maxV - minV;
        const toX  = m => P.l + (m/(months-1))*(W-P.l-P.r);
        const toY  = v => P.t + (1-(v-minV)/rng)*(H-P.t-P.b);

        const linePath = key => pts.map((p,i)=>`${i===0?"M":"L"}${toX(p.m).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(" ");
        const areaPath = () => {
          const top = pts.map((p,i)=>`${i===0?"M":"L"}${toX(p.m).toFixed(1)},${toY(p.bull).toFixed(1)}`).join(" ");
          const bot = [...pts].reverse().map((p,i)=>`${i===0?"M":"L"}${toX(p.m).toFixed(1)},${toY(p.bear).toFixed(1)}`).join(" ");
          return top+" "+bot+" Z";
        };
        const actualsPath = actuals.length >= 2
          ? actuals.map((a,i)=>`${i===0?"M":"L"}${toX(a.m).toFixed(1)},${toY(a.v).toFixed(1)}`).join(" ")
          : null;

        const tickVals = Array.from({length:5},(_,i)=>minV+(rng*i/4));
        const cxDot = toX(mSince);
        const cyDot = toY(currentActual);

        // Estimate months from now to reach milestones at projected rate
        const monthsToTarget = (start, rate, monthly, target) => {
          if (start >= target) return 0;
          const mr = Math.pow(1 + rate, 1/12) - 1;
          let v = start;
          for (let m = 1; m <= 600; m++) { v = v * (1 + mr) + monthly; if (v >= target) return m; }
          return null;
        };
        const mTo1M = monthsToTarget(currentActual, RATE_PROJ, MONTHLY, 1000000);
        const mToGoal = monthsToTarget(currentActual, RATE_PROJ, MONTHLY, GOAL);
        const dateFrom = (mths) => { if (mths === null || mths === 0) return null; const d = new Date(); d.setMonth(d.getMonth() + mths); return d; };
        const est1MDate = dateFrom(mTo1M);
        const estGoalDate = dateFrom(mToGoal);
        const fmtDate = d => d ? d.toLocaleDateString("en-GB",{month:"short",year:"numeric"}) : "—";

        return (<div style={S.body}>
          <div style={{...S.card,borderColor:"#c9a84c44"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
              <div>
                <div style={{fontSize:10,color:"#6a7d8f",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>Current Goal</div>
                <div style={{fontSize:22,color:"#c9a84c",fontWeight:600}}>Reach £1,400,000 by February 2031</div>
                <div style={{fontSize:12,color:"#6a7d8f",marginTop:4}}>Starting from £857,270 baseline (25 Feb 2026) · includes £2,011/month pension contributions</div>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <div style={S.sBox}><div style={S.sLbl}>Required Rate</div><div style={{fontSize:22,color:"#c9a84c"}}>7.90% p.a.</div><div style={{fontSize:10,color:"#6a7d8f",marginTop:2}}>to hit goal incl. contributions</div></div>
                <div style={{...S.sBox,borderColor:isAheadOfRequired?"#70AD4744":"#e0706044"}}>
                  <div style={S.sLbl}>Today vs Required Pace</div>
                  <div style={{fontSize:20,color:isAheadOfRequired?"#70AD47":"#e07060"}}>{isAheadOfRequired?"▲ Ahead":"▼ Behind"}</div>
                  <div style={{fontSize:11,color:isAheadOfRequired?"#70AD47":"#e07060",marginTop:2}}>{fmt(currentActual-currentOnReq,0)} vs required {fmt(currentOnReq,0)}</div>
                </div>
                <div style={S.sBox}><div style={S.sLbl}>Progress to Goal</div><div style={{fontSize:20,color:"#e8dcc8"}}>{((currentActual/GOAL)*100).toFixed(1)}%</div><div style={{fontSize:11,color:"#6a7d8f",marginTop:2}}>{fmt(GOAL-currentActual,0)} still to go</div><div style={{borderTop:"1px solid #ffffff10",marginTop:6,paddingTop:5,fontSize:11,color:"#8ab4f8"}}>{currentActual<1000000?<div>Est. £1M: <span style={{color:"#e8dcc8"}}>{fmtDate(est1MDate)}</span></div>:null}<div>Est. Goal: <span style={{color:"#c9a84c"}}>{fmtDate(estGoalDate)}</span></div></div></div>
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.sec}>5-Year Projection · from 25 Feb 2026 · includes £2,011/month pension contributions · actuals plotted as they accumulate</div>
            <div style={{display:"flex",gap:20,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              {[
                {label:`Bull (17%) → £${(val5Bull/1000).toFixed(0)}k`,      color:"#70AD47", dash:null,  w:1.5, dim:true},
                {label:`Projected (11.5%) → £${(val5Proj/1000).toFixed(0)}k`, color:"#4472C4", dash:null, w:2.5, dim:false},
                {label:"Required (7.9%) → £1,400k",                          color:"#c9a84c", dash:"6,3", w:2,  dim:false},
                {label:`Bear (6%) → £${(val5Bear/1000).toFixed(0)}k`,        color:"#e07060", dash:null,  w:1.5, dim:true},
                {label:"£1.4m target",                                        color:"#c9a84c", dash:"3,4", w:1,  dim:true},
                {label:"Actual",                                              color:"#ffffff", dash:null,  w:2,  dim:false},
              ].map(({label,color,dash,w,dim})=>(
                <div key={label} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,opacity:dim?0.7:1}}>
                  <svg width="26" height="10"><line x1="0" y1="5" x2="26" y2="5" stroke={color} strokeWidth={w} strokeDasharray={dash||"none"}/></svg>
                  <span style={{color:"#9ab"}}>{label}</span>
                </div>
              ))}
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={isAheadOfRequired?"#70AD47":"#e07060"} stroke="#0f1923" strokeWidth="1.5"/></svg>
                <span style={{color:"#9ab"}}>Current ({fmt(currentActual,0)})</span>
              </div>
            </div>

            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
              {tickVals.map((v,i)=>(
                <g key={i}>
                  <line x1={P.l} y1={toY(v)} x2={W-P.r} y2={toY(v)} stroke="#1e2f3e" strokeDasharray="3,3"/>
                  <text x={P.l-6} y={toY(v)+4} textAnchor="end" fontSize="9" fill="#4a6070">{(v/1000).toFixed(0)}k</text>
                </g>
              ))}
              <path d={areaPath()} fill="#4472C4" opacity="0.07"/>
              <line x1={P.l} y1={toY(GOAL)} x2={W-P.r} y2={toY(GOAL)} stroke="#c9a84c" strokeWidth="1" strokeDasharray="3,4" opacity="0.65"/>
              <text x={W-P.r+4} y={toY(GOAL)+4} fontSize="9" fill="#c9a84c" opacity="0.8">£1.4m</text>
              <path d={linePath("bull")}     fill="none" stroke="#70AD47" strokeWidth="1.5" opacity="0.7"/>
              <path d={linePath("bear")}     fill="none" stroke="#e07060" strokeWidth="1.5" opacity="0.7"/>
              <path d={linePath("required")} fill="none" stroke="#c9a84c" strokeWidth="2"   strokeDasharray="6,3"/>
              <path d={linePath("proj")}     fill="none" stroke="#4472C4" strokeWidth="2.5"/>
              {actualsPath && <path d={actualsPath} fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.9"/>}
              {actuals.map((a,i)=><circle key={i} cx={toX(a.m)} cy={toY(a.v)} r="3" fill="#ffffff" stroke="#0f1923" strokeWidth="1.5"/>)}
              <circle cx={cxDot} cy={cyDot} r="5.5" fill={isAheadOfRequired?"#70AD47":"#e07060"} stroke="#0f1923" strokeWidth="2"/>
              {pts.filter(p=>p.yearLabel).map(p=>(
                <g key={p.m}>
                  <line x1={toX(p.m)} y1={H-P.b} x2={toX(p.m)} y2={H-P.b+4} stroke="#2a3d50"/>
                  <text x={toX(p.m)} y={H-P.b+14} textAnchor="middle" fontSize="9" fill="#4a6070">{p.yearLabel}</text>
                  <text x={toX(p.m)} y={H-P.b+26} textAnchor="middle" fontSize="8" fill="#3a4d60">{p.ageLabel}</text>
                </g>
              ))}
              {pts.filter(p=>p.midLabel).map(p=>(
                <text key={p.m} x={toX(p.m)} y={H-P.b+14} textAnchor="middle" fontSize="8" fill="#2a3d50">{p.midLabel}</text>
              ))}
            </svg>
          </div>

          <div style={S.card}>
            <div style={S.sec}>Year-by-Year Projections</div>
            <table style={S.tbl}>
              <thead><tr>
                <th style={S.th}>Year end</th>
                <th style={S.th}>Age</th>
                <th style={S.thR}>Contributions added</th>
                <th style={{...S.thR,color:"#e07060"}}>Bear (6%)</th>
                <th style={{...S.thR,color:"#c9a84c"}}>Required (7.9%)</th>
                <th style={{...S.thR,color:"#4472C4"}}>Projected (11.5%)</th>
                <th style={{...S.thR,color:"#70AD47"}}>Bull (17%)</th>
                <th style={{...S.thR,color:"#6a7d8f"}}>Projected vs Goal</th>
              </tr></thead>
              <tbody>{[1,2,3,4,5].map(y=>{
                const contribs = MONTHLY*12*y;
                const vBear = project(BASELINE, RATE_BEAR, y*12, MONTHLY);
                const vReq  = project(BASELINE, RATE_REQ,  y*12, MONTHLY);
                const vProj = project(BASELINE, RATE_PROJ, y*12, MONTHLY);
                const vBull = project(BASELINE, RATE_BULL, y*12, MONTHLY);
                const dt = new Date(BASELINE_DT); dt.setFullYear(dt.getFullYear()+y);
                const ageAtYr = Math.floor((dt - JOHN_DOB)/(365.25*24*60*60*1000));
                const dtStr = dt.toLocaleDateString("en-GB",{month:"short",year:"numeric"});
                return (
                  <tr key={y} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <td style={{...S.td,fontFamily:"monospace",fontSize:11}}>{dtStr}</td>
                    <td style={{...S.td,color:"#6a7d8f",fontSize:11}}>{ageAtYr}</td>
                    <td style={S.tdR}>{fmt(contribs,0)}</td>
                    <td style={{...S.tdR,color:"#e07060"}}>{fmt(vBear,0)}</td>
                    <td style={{...S.tdR,color:"#c9a84c"}}>{fmt(vReq,0)}</td>
                    <td style={{...S.tdR,color:"#4472C4"}}>{fmt(vProj,0)}</td>
                    <td style={{...S.tdR,color:"#70AD47"}}>{fmt(vBull,0)}</td>
                    <td style={S.gain(vProj-GOAL)}>{fmt(vProj-GOAL,0)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <div style={{marginTop:12,fontSize:10,color:"#4a6070",lineHeight:1.7}}>
              Projection basis: £857,270 baseline (25 Feb 2026) · £2,011/month pension contributions compounded monthly · Rates: Bear 6% / Required 7.90% / Projected 11.5% / Bull 17% annualised · "Projected" = weighted avg annualised return across all holdings, using 1yr market rates for BCHS (+40.3%) and HSBC Islamic (+13.7%), actual annualised returns for all other holdings · Actuals line plots real portfolio values from session history · Baseline projection lines are fixed and do not change — only the Actuals line grows over time
            </div>
          </div>
        </div>);
      })()}

      {activeTab==="analysis"&&(()=>{
        if(!analysis) return (<div style={S.body}><div style={{...S.card,textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:14,color:"#6a7d8f",marginBottom:12}}>No analysis data available.</div><div style={{fontSize:12,color:"#4a6070"}}>Run <code style={{background:"#1e3040",padding:"2px 6px",borderRadius:2,fontFamily:"monospace",fontSize:11}}>python3 fetch_analysis.py</code> or double-click <code style={{background:"#1e3040",padding:"2px 6px",borderRadius:2,fontFamily:"monospace",fontSize:11}}>refresh_analysis.command</code> to generate analysis.</div></div></div>);

        const sm = analysis.summary;
        const holdings = analysis.holdings || [];
        const cryptoA  = analysis.crypto || [];
        const sentColor = s => s && s.includes("Bullish") ? "#70AD47" : s && s.includes("Bearish") ? "#e07060" : "#c9a84c";
        const sentBg    = s => sentColor(s) + "18";
        const sentBdr   = s => sentColor(s) + "44";
        const confColor = c => c === "High" ? "#70AD47" : c === "Medium" ? "#c9a84c" : "#6a7d8f";

        // Build summary narrative
        const projRet = sm.projectedReturn12m;
        const projRetStr = projRet != null ? (projRet >= 0 ? "+" : "") + (projRet * 100).toFixed(1) + "%" : "N/A";
        const reqNow  = sm.requiredRateFromNow;
        const reqStr  = reqNow != null ? (reqNow * 100).toFixed(1) + "%" : "N/A";
        const aheadOfReq = projRet != null && reqNow != null && projRet >= reqNow;

        return (<div style={S.body}>
          {/* ── Portfolio Outlook Summary ── */}
          <div style={{...S.card,borderColor:sm.onTrack?"#70AD4744":"#e0706044"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
              <div>
                <div style={{fontSize:10,color:"#6a7d8f",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>Portfolio Outlook · 6–12 Month Forward View</div>
                <div style={{fontSize:20,color:sentColor(sm.overallSentiment),fontWeight:600}}>{sm.overallSentiment}</div>
                <div style={{fontSize:12,color:"#6a7d8f",marginTop:6}}>Based on trailing performance, momentum, volatility and analyst consensus across {holdings.length} holdings</div>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <div style={S.sBox}><div style={S.sLbl}>Projected 12M Return</div><div style={{fontSize:22,color:projRet!=null&&projRet>=0?"#70AD47":"#e07060"}}>{projRetStr}</div></div>
                <div style={S.sBox}><div style={S.sLbl}>Projected Value (12M)</div><div style={{fontSize:22,color:"#e8dcc8"}}>{sm.projectedValue12m?fmt(sm.projectedValue12m,0):"—"}</div></div>
                <div style={{...S.sBox,borderColor:sm.onTrack?"#70AD4744":"#e0706044"}}><div style={S.sLbl}>Goal Attainment</div><div style={{fontSize:20,color:sm.onTrack?"#70AD47":sm.onTrack===false?"#e07060":"#6a7d8f"}}>{sm.onTrack?"On Track ✓":sm.onTrack===false?"At Risk ✗":"—"}</div><div style={{fontSize:11,color:"#6a7d8f",marginTop:2}}>{sm.projectedGoalValue?`Projected ${fmt(sm.projectedGoalValue,0)} vs ${fmt(sm.goal,0)} goal`:""}</div></div>
              </div>
            </div>
          </div>

          {/* ── Key Triggers (Market Indicators) ── */}
          {analysis.indicators && (()=>{
            const ind = analysis.indicators;
            const keys = Object.keys(ind);
            const regime = analysis.marketRegime || "Mixed";
            const regimeColor = regime==="Favourable"?"#70AD47":regime==="Bear Warning"?"#e07060":regime==="Caution"?"#c9a84c":"#6a7d8f";
            const sigColor = s => s==="bull"?"#70AD47":s==="bear"?"#e07060":s==="caution"?"#c9a84c":"#6a7d8f";
            const sigBg = s => sigColor(s)+"15";
            const sigBdr = s => sigColor(s)+"40";
            const sigLabel = s => s==="bull"?"Bullish":s==="bear"?"Bearish":s==="caution"?"Caution":"Neutral";
            const sigIcon = s => s==="bull"?"▲":s==="bear"?"▼":s==="caution"?"⚠":"●";
            return (<div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:14}}>
                <div>
                  <div style={{fontSize:10,color:"#6a7d8f",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>Key Triggers · Market Indicators</div>
                  <div style={{fontSize:11,color:"#4a6070"}}>Real-time signals from major market gauges — updated with each analysis refresh</div>
                </div>
                <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 14px",borderRadius:4,background:regimeColor+"18",border:`1px solid ${regimeColor}44`,fontSize:13,fontWeight:600,color:regimeColor}}>{regime==="Favourable"?"✓":regime==="Bear Warning"?"⚠":regime==="Caution"?"△":"●"} {regime}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                {keys.map(k=>{
                  const d = ind[k];
                  const isIdx = ["SP500","FTSE100","GOLD"].includes(k);
                  const valStr = isIdx ? d.value.toLocaleString(undefined,{maximumFractionDigits:1}) : k==="BUFFETT" ? d.value.toFixed(1)+"%" : k==="CAPE" ? d.value.toFixed(1) : d.value.toLocaleString(undefined,{maximumFractionDigits:2});
                  return (<div key={k} style={{background:"#14232f",border:`1px solid ${sigBdr(d.signal)}`,borderRadius:6,padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontSize:10,color:"#6a7d8f",letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:600}}>{k}</div>
                      <span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:sigBg(d.signal),color:sigColor(d.signal),border:`1px solid ${sigBdr(d.signal)}`,fontWeight:600}}>{sigIcon(d.signal)} {sigLabel(d.signal)}</span>
                    </div>
                    <div style={{fontSize:20,color:"#e8dcc8",fontWeight:600,marginBottom:4}}>{valStr}</div>
                    <div style={{fontSize:10,color:"#6a7d8f",lineHeight:1.4,marginBottom:6}}>{d.name}</div>
                    <div style={{display:"flex",gap:10,fontSize:10}}>
                      {d.change_1m!=null&&<span style={{color:d.change_1m>=0?"#70AD47":"#e07060"}}>1M: {d.change_1m>=0?"+":""}{(d.change_1m*100).toFixed(1)}%</span>}
                      {d.change_3m!=null&&<span style={{color:d.change_3m>=0?"#70AD47":"#e07060"}}>3M: {d.change_3m>=0?"+":""}{(d.change_3m*100).toFixed(1)}%</span>}
                    </div>
                    {d.thresholds&&<div style={{fontSize:9,color:"#4a6070",marginTop:6,lineHeight:1.3}}>{Object.values(d.thresholds).find(t=>t[0]<=d.value&&d.value<t[1])?.[2]||""}</div>}
                  </div>);
                })}
              </div>
            </div>);
          })()}

          {/* ── Reminders ── */}
          {analysis.reminders && analysis.reminders.length > 0 && (()=>{
            const rems = analysis.reminders.filter(r=>r.status==="active");
            if(!rems.length) return null;
            const today = new Date().toISOString().slice(0,10);
            return (<div style={{...S.card,borderColor:"#c9a84c44"}}>
              <div style={{fontSize:10,color:"#6a7d8f",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:10}}>Reminders & Action Items</div>
              {rems.map((r,i)=>{
                const overdue = r.due < today;
                const dueSoon = !overdue && r.due <= new Date(Date.now()+7*86400000).toISOString().slice(0,10);
                const icon = overdue ? "🔴" : dueSoon ? "🟡" : "🔵";
                const dueDate = new Date(r.due+"T00:00:00");
                const dueStr = dueDate.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
                return (<div key={r.id||i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:i<rems.length-1?"1px solid #1e3040":"none"}}>
                  <span style={{fontSize:14,marginTop:1}}>{icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"#e8dcc8"}}>{r.text}</div>
                    <div style={{fontSize:10,color:overdue?"#e07060":dueSoon?"#c9a84c":"#4a6070",marginTop:3}}>Due: {dueStr}{overdue?" — OVERDUE":dueSoon?" — due soon":""}</div>
                  </div>
                </div>);
              })}
            </div>);
          })()}

          {/* ── Key Metrics Row ── */}
          <div style={S.g5}>
            <div style={S.sBox}><div style={S.sLbl}>Current Value</div><div style={{fontSize:18,color:"#c9a84c"}}>{fmt(sm.currentValue,0)}</div></div>
            <div style={S.sBox}><div style={S.sLbl}>Required Rate (from now)</div><div style={{fontSize:18,color:"#c9a84c"}}>{reqStr} p.a.</div><div style={{fontSize:10,color:"#4a6070",marginTop:2}}>Original: {(sm.requiredRateOrig*100).toFixed(1)}% from baseline</div></div>
            <div style={S.sBox}><div style={S.sLbl}>Months to Goal</div><div style={{fontSize:18,color:"#e8dcc8"}}>{sm.monthsRemaining}</div><div style={{fontSize:10,color:"#4a6070",marginTop:2}}>Target: {sm.goalDate}</div></div>
            <div style={S.sBox}><div style={S.sLbl}>Rate vs Required</div><div style={{fontSize:18,color:aheadOfReq?"#70AD47":"#e07060"}}>{aheadOfReq?"▲ Above":"▼ Below"}</div><div style={{fontSize:11,color:aheadOfReq?"#70AD47":"#e07060",marginTop:2}}>{projRet!=null&&reqNow!=null?`${projRetStr} projected vs ${reqStr} required`:""}</div></div>
            <div style={S.sBox}><div style={S.sLbl}>Sentiment Breakdown</div><div style={{display:"flex",gap:2,height:10,borderRadius:3,overflow:"hidden",marginBottom:6,marginTop:4}}>{sm.sentimentBreakdown.bullish>0&&<div style={{flex:sm.sentimentBreakdown.bullish,background:"#70AD47",borderRadius:2}}/>}{sm.sentimentBreakdown.neutral>0&&<div style={{flex:sm.sentimentBreakdown.neutral,background:"#c9a84c",borderRadius:2}}/>}{sm.sentimentBreakdown.bearish>0&&<div style={{flex:sm.sentimentBreakdown.bearish,background:"#e07060",borderRadius:2}}/>}</div><div style={{display:"flex",gap:12,fontSize:10}}><span style={{color:"#70AD47"}}>{sm.sentimentBreakdown.bullish} bullish</span><span style={{color:"#c9a84c"}}>{sm.sentimentBreakdown.neutral} neutral</span><span style={{color:"#e07060"}}>{sm.sentimentBreakdown.bearish} bearish</span></div></div>
          </div>

          {/* ── Holdings Analysis Table ── */}
          <div style={S.card}>
            <div style={S.sec}>Holdings Analysis · 6–12 Month Forward View</div>
            <div style={{overflowX:"auto"}}>
              <table style={S.tbl}>
                <thead><tr>
                  <th style={S.th}>Fund / Asset</th>
                  <th style={S.th}>Bucket</th>
                  <th style={S.thR}>3M Return</th>
                  <th style={S.thR}>6M Return</th>
                  <th style={S.thR}>1Y Return</th>
                  <th style={S.thR}>Volatility</th>
                  <th style={S.thR}>52W High</th>
                  <th style={S.thR}>Proj. 6M</th>
                  <th style={S.thR}>Proj. 12M</th>
                  <th style={S.th}>Sentiment</th>
                  <th style={S.th}>Confidence</th>
                </tr></thead>
                <tbody>{holdings.map(h=>{
                  const r = h.returns||{};
                  const p = h.projection||{};
                  const bc = BUCKET_COLORS[h.bucket]||"#4a6070";
                  return (<tr key={h.ticker} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <td style={{...S.td,fontSize:11}}><div style={S.ticker}>{h.ticker}</div><div style={{marginTop:3}}>{h.name}</div></td>
                    <td style={S.td}><span style={S.pill(bc)}>{h.bucket||"—"}</span></td>
                    <td style={S.gain(r["3m_return"])}>{r["3m_return"]!=null?fmtPct(r["3m_return"]):"—"}</td>
                    <td style={S.gain(r["6m_return"])}>{r["6m_return"]!=null?fmtPct(r["6m_return"]):"—"}</td>
                    <td style={S.gain(r["1y_return"])}>{r["1y_return"]!=null?fmtPct(r["1y_return"]):"—"}</td>
                    <td style={{...S.tdR,color:r.volatility_30d>0.25?"#e07060":r.volatility_30d>0.15?"#c9a84c":"#6a7d8f"}}>{r.volatility_30d!=null?(r.volatility_30d*100).toFixed(0)+"%":"—"}</td>
                    <td style={{...S.tdR,color:"#6a7d8f"}}>{r.pct_from_52w_high!=null?(r.pct_from_52w_high*100).toFixed(1)+"%":"—"}</td>
                    <td style={S.gain(p.projected_return_6m)}>{p.projected_return_6m!=null?fmtPct(p.projected_return_6m):"—"}</td>
                    <td style={S.gain(p.projected_return_12m)}>{p.projected_return_12m!=null?fmtPct(p.projected_return_12m):"—"}</td>
                    <td style={S.td}><span style={{display:"inline-block",padding:"3px 8px",borderRadius:3,fontSize:10,background:sentBg(p.sentiment),color:sentColor(p.sentiment),border:`1px solid ${sentBdr(p.sentiment)}`,whiteSpace:"nowrap"}}>{p.sentiment||"—"}</span></td>
                    <td style={S.td}><span style={{fontSize:10,color:confColor(p.confidence)}}>{p.confidence||"—"}</span></td>
                  </tr>);
                })}</tbody>
              </table>
            </div>
          </div>

          {/* ── Holding Detail Cards ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:16}}>
            {holdings.map(h=>{
              const r = h.returns||{};
              const p = h.projection||{};
              return (<div key={h.ticker} style={{...S.card,marginBottom:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div><div style={S.ticker}>{h.ticker}</div><div style={{fontSize:12,color:"#e8dcc8",marginTop:3}}>{h.name}</div></div>
                  <span style={{display:"inline-block",padding:"3px 8px",borderRadius:3,fontSize:10,background:sentBg(p.sentiment),color:sentColor(p.sentiment),border:`1px solid ${sentBdr(p.sentiment)}`}}>{p.sentiment}</span>
                </div>
                <div style={{fontSize:11,color:"#9ab",lineHeight:1.6,marginBottom:8}}>{h.narrative}</div>
                <div style={{display:"flex",gap:16,fontSize:10,color:"#6a7d8f",flexWrap:"wrap"}}>
                  {p.projected_return_12m!=null&&<span>12M proj: <span style={{color:sentColor(p.sentiment)}}>{fmtPct(p.projected_return_12m)}</span></span>}
                  {r.volatility_30d!=null&&<span>Vol: {(r.volatility_30d*100).toFixed(0)}%</span>}
                  <span>Confidence: <span style={{color:confColor(p.confidence)}}>{p.confidence}</span></span>
                </div>
              </div>);
            })}
          </div>

          {/* ── Crypto Analysis ── */}
          {cryptoA.length>0&&<div style={S.card}>
            <div style={S.sec}>Crypto Analysis · excluded from portfolio totals</div>
            <table style={S.tbl}>
              <thead><tr><th style={S.th}>Coin</th><th style={S.thR}>3M</th><th style={S.thR}>6M</th><th style={S.thR}>1Y</th><th style={S.thR}>Vol</th><th style={S.thR}>Proj. 12M</th><th style={S.th}>Sentiment</th></tr></thead>
              <tbody>{cryptoA.map(c=>{
                const r=c.returns||{},p=c.projection||{};
                return (<tr key={c.symbol} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <td style={{...S.td,fontWeight:600}}>{c.name} <span style={{color:"#c9a84c",fontFamily:"monospace",fontSize:10,marginLeft:4}}>{c.symbol}</span></td>
                  <td style={S.gain(r["3m_return"])}>{r["3m_return"]!=null?fmtPct(r["3m_return"]):"—"}</td>
                  <td style={S.gain(r["6m_return"])}>{r["6m_return"]!=null?fmtPct(r["6m_return"]):"—"}</td>
                  <td style={S.gain(r["1y_return"])}>{r["1y_return"]!=null?fmtPct(r["1y_return"]):"—"}</td>
                  <td style={{...S.tdR,color:"#6a7d8f"}}>{r.volatility_30d!=null?(r.volatility_30d*100).toFixed(0)+"%":"—"}</td>
                  <td style={S.gain(p.projected_return_12m)}>{p.projected_return_12m!=null?fmtPct(p.projected_return_12m):"—"}</td>
                  <td style={S.td}><span style={{display:"inline-block",padding:"3px 8px",borderRadius:3,fontSize:10,background:sentBg(p.sentiment),color:sentColor(p.sentiment),border:`1px solid ${sentBdr(p.sentiment)}`}}>{p.sentiment}</span></td>
                </tr>);
              })}</tbody>
            </table>
          </div>}

          {/* ── Footer ── */}
          <div style={{...S.card,padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:10,color:"#4a6070"}}>Analysis generated {analysis.meta.analysisDateDisplay} · Based on Yahoo Finance data (1-year trailing) · Projections are estimates, not guarantees · Weighted by holding value</div>
            <div style={{fontSize:10,color:"#4a6070"}}>Refresh: <code style={{background:"#1e3040",padding:"2px 6px",borderRadius:2,fontFamily:"monospace",fontSize:10,color:"#6a7d8f"}}>refresh_analysis.command</code></div>
          </div>
        </div>);
      })()}

      {activeTab==="crypto"&&(()=>{
        const coins = data.crypto||[];
        const COIN_COLORS = {"BTC":"#F7931A","ETH":"#627EEA","XRP":"#00AAE4","ADA":"#0033AD"};
        const totalCryptoVal  = coins.reduce((s,c)=>s+(c.units&&c.price?c.units*c.price:0),0);
        const totalCryptoPrev = coins.reduce((s,c)=>{ if(!c.units) return s; const p=c.prevPrice!=null?c.prevPrice:c.price; return s+(p!=null?c.units*p:0); },0);
        const cryptoChange    = totalCryptoVal-totalCryptoPrev;
        const cryptoChangePct = totalCryptoPrev>0?cryptoChange/totalCryptoPrev:null;
        const coinsHeld       = coins.filter(c=>c.units>0).length;
        const startCE  = (id,v)=>{ setCryptoEditCell(id); setCryptoEditVal(v!=null?String(v):""); };
        const commitCE = (id)=>{ const v=parseFloat(cryptoEditVal); if(!isNaN(v)) setData(d=>({...d,crypto:d.crypto.map(c=>c.id===id?{...c,units:v}:c)})); setCryptoEditCell(null); };
        const hist = data.cryptoHistory||[];
        const CryptoChart = ()=>{
          if(hist.length<2) return <div style={{textAlign:"center",color:"#3a4d60",padding:40,fontSize:12}}>Need at least 2 fetches to chart. Prices update weekdays at 4:45pm.</div>;
          const vals=hist.map(e=>e.totalValue); const min=Math.min(...vals),max=Math.max(...vals);
          const W=540,H=160,PX=10,PY=18,gap=max-min||1;
          const px=(i)=>PX+i*(W-2*PX)/(hist.length-1);
          const py=(v)=>PY+(1-(v-min)/gap)*(H-2*PY);
          const pts=hist.map((e,i)=>`${px(i)},${py(e.totalValue)}`).join(" ");
          return (<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W}}>
            <polyline points={pts} fill="none" stroke="#F7931A" strokeWidth={2}/>
            {hist.map((e,i)=><circle key={i} cx={px(i)} cy={py(e.totalValue)} r={3} fill="#F7931A"/>)}
            {hist.map((e,i)=>i===0||i===hist.length-1?<text key={"l"+i} x={px(i)} y={H-4} textAnchor={i===0?"start":"end"} fill="#6a7d8f" fontSize={9}>{e.date}</text>:null)}
            {hist.map((e,i)=>i===hist.length-1?<text key={"v"+i} x={px(i)} y={py(e.totalValue)-8} textAnchor="end" fill="#F7931A" fontSize={9}>{fmt(e.totalValue,0)}</text>:null)}
          </svg>);
        };
        return (<div style={S.body}>
          <div style={{...S.card,borderColor:"#F7931A44",marginBottom:8,padding:"8px 16px"}}>
            <span style={{fontSize:11,color:"#6a7d8f"}}>⚡ Crypto holdings are tracked separately and excluded from all portfolio totals, projections and allocation.</span>
          </div>
          <div style={S.g3}>
            <div style={S.sBox}><div style={S.sLbl}>Total Crypto Value</div><div style={{fontSize:22,color:"#F7931A",fontVariantNumeric:"tabular-nums"}}>{fmt(totalCryptoVal,0)}</div></div>
            <div style={{...S.sBox,borderColor:cryptoChange>=0?"#70AD4744":"#e0706044"}}><div style={S.sLbl}>Since {prevDateDisplay}</div><div style={{fontSize:22,color:cryptoChange>=0?"#70AD47":"#e07060",fontVariantNumeric:"tabular-nums"}}>{fmt(cryptoChange,0)}</div><div style={{fontSize:13,color:cryptoChange>=0?"#70AD47":"#e07060",marginTop:2}}>{fmtPct(cryptoChangePct)}</div></div>
            <div style={S.sBox}><div style={S.sLbl}>Coins Held</div><div style={{fontSize:22,color:"#e8dcc8"}}>{coinsHeld}</div><div style={{fontSize:11,color:"#6a7d8f",marginTop:2}}>of {coins.length} tracked</div></div>
          </div>
          <div style={S.card}>
            <div style={S.sec}>Holdings — click units to edit</div>
            <table style={S.tbl}><thead><tr>
              <th style={S.th}>Coin</th><th style={S.th}>Symbol</th><th style={S.thR}>Units</th><th style={S.thR}>Price (GBP)</th><th style={S.th}>Price Date</th><th style={S.thR}>Value (GBP)</th><th style={{...S.thR,color:"#9ab"}}>Since {prevDateDisplay}</th>
            </tr></thead>
            <tbody>{coins.map(c=>{
              const val=c.units&&c.price?c.units*c.price:null;
              const prev=c.units&&c.prevPrice!=null?c.units*c.prevPrice:null;
              const chg=val!=null&&prev!=null?val-prev:null;
              const chgPct=prev&&prev>0?chg/prev:null;
              const stale=c.priceDate?((Date.now()-new Date(c.priceDate).getTime())/86400000)>3:false;
              const cc=COIN_COLORS[c.symbol]||"#c9a84c";
              return (<tr key={c.id} onMouseEnter={e=>e.currentTarget.style.background="#1e3040"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                <td style={{...S.td,fontWeight:600}}><span style={{color:cc,marginRight:6}}>●</span>{c.name}</td>
                <td style={{...S.td,fontFamily:"monospace",color:"#c9a84c",fontSize:11}}>{c.symbol}</td>
                <td style={S.tdR}>{cryptoEditCell===c.id
                  ?<input autoFocus style={S.input} value={cryptoEditVal} onChange={e=>setCryptoEditVal(e.target.value)} onBlur={()=>commitCE(c.id)} onKeyDown={e=>{if(e.key==="Enter")commitCE(c.id);if(e.key==="Escape")setCryptoEditCell(null);}}/>
                  :<span onClick={()=>startCE(c.id,c.units)} style={{cursor:"text",borderBottom:"1px dashed #2a3d50",paddingBottom:1}} title="Click to edit">{c.units!=null?fmtNum(c.units,8):<span style={{color:"#3a4d60"}}>—</span>}</span>}</td>
                <td style={S.tdR}>{c.price!=null?<span style={{fontVariantNumeric:"tabular-nums"}}>{c.price>=1?fmt(c.price):`£${c.price.toFixed(6)}`}</span>:<span style={{color:"#3a4d60"}}>—</span>}</td>
                <td style={S.td}><span style={S.dateBadge(stale)}>{c.priceDate?daysAgo(c.priceDate):"—"}{stale?" ⚠":""}</span></td>
                <td style={S.tdR}>{val!=null?fmt(val,val<1?4:0):<span style={{color:"#3a4d60"}}>—</span>}</td>
                <td style={S.gain(chgPct)}>{chgPct!=null?<span>{fmtPct(chgPct)}<br/><span style={{fontSize:9,color:"#6a7d8f"}}>{fmt(chg,0)}</span></span>:"—"}</td>
              </tr>);
            })}</tbody>
            {totalCryptoVal>0&&<tfoot><tr style={{borderTop:"1px solid #F7931A33"}}>
              <td style={{...S.td,color:"#F7931A",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}} colSpan={5}>Total</td>
              <td style={{...S.tdR,color:"#F7931A"}}>{fmt(totalCryptoVal,0)}</td>
              <td style={S.gain(cryptoChangePct)}>{cryptoChangePct!=null?<span>{fmtPct(cryptoChangePct)}<span style={{fontSize:9,marginLeft:3}}>({fmt(cryptoChange,0)})</span></span>:"—"}</td>
            </tr></tfoot>}
            </table>
          </div>
          {hist.length>=2&&<div style={S.card}><div style={S.sec}>Crypto Portfolio Value History</div><CryptoChart/></div>}
        </div>);
      })()}
    </div>
  );
}
