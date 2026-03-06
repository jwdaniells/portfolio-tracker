import { useState, useEffect, useMemo } from "react";

// ─── Formatters ─────────────────────────────────────────────────────────────
const fmt   = (n,d=0) => { if(n==null||isNaN(n)) return "—"; return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",minimumFractionDigits:d,maximumFractionDigits:d}).format(n); };
const fmtN  = (n,d=0) => { if(n==null||isNaN(n)) return "—"; return new Intl.NumberFormat("en-GB",{minimumFractionDigits:d,maximumFractionDigits:d}).format(n); };
const pct   = (n)     => { if(n==null) return "—"; return (n*100).toFixed(1)+"%"; };

// ─── UK Tax Engine (2025/26 rates — simplified, frozen thresholds) ──────────
const TAX = {
  personalAllowance: 12570,
  basicRate: 0.20,     basicLimit: 50270,
  higherRate: 0.40,    higherLimit: 125140,
  additionalRate: 0.45,
  paTaper: 100000,     // PA reduced by £1 for every £2 above this
};

function calcIncomeTax(gross) {
  if (gross <= 0) return { tax: 0, net: 0, effectiveRate: 0, marginalRate: 0 };
  // PA taper
  let pa = TAX.personalAllowance;
  if (gross > TAX.paTaper) pa = Math.max(0, pa - Math.floor((gross - TAX.paTaper) / 2));
  let taxable = Math.max(0, gross - pa);
  let tax = 0;
  // Basic band
  const basicBand = Math.max(0, TAX.basicLimit - pa);
  const inBasic = Math.min(taxable, basicBand);
  tax += inBasic * TAX.basicRate;
  taxable -= inBasic;
  // Higher band
  const higherBand = TAX.higherLimit - TAX.basicLimit;
  const inHigher = Math.min(taxable, higherBand);
  tax += inHigher * TAX.higherRate;
  taxable -= inHigher;
  // Additional
  tax += taxable * TAX.additionalRate;
  const net = gross - tax;
  const effectiveRate = gross > 0 ? tax / gross : 0;
  let marginalRate = 0;
  if (gross > TAX.higherLimit) marginalRate = TAX.additionalRate;
  else if (gross > TAX.basicLimit) marginalRate = TAX.higherRate;
  else if (gross > pa) marginalRate = TAX.basicRate;
  return { tax: Math.round(tax), net: Math.round(net), effectiveRate, marginalRate, pa };
}

// Optimise drawdown split between John and Elaine to minimise total tax
// given their respective guaranteed incomes (non-portfolio)
function optimiseDrawdown(johnGuaranteed, elaineGuaranteed, targetNet, maxJohnSipp, maxElaineSipp, totalIsa) {
  // Try many splits: John gets x% of SIPP drawdown, Elaine gets (100-x)%
  // ISA drawn last (tax-free)
  let bestTax = Infinity, bestSplit = null;
  for (let jp = 0; jp <= 100; jp += 1) {
    const ep = 100 - jp;
    // Binary search for gross total SIPP needed
    let lo = 0, hi = maxJohnSipp + maxElaineSipp + totalIsa;
    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      // ISA first or SIPP first? Strategy: SIPP first (taxable), ISA to top up
      const sippDraw = Math.min(mid, maxJohnSipp + maxElaineSipp);
      const isaDraw = Math.max(0, mid - sippDraw);
      const johnSipp = Math.min(sippDraw * jp / 100, maxJohnSipp);
      const elaineSipp = Math.min(sippDraw - johnSipp, maxElaineSipp);
      const johnGross = johnGuaranteed + johnSipp;
      const elaineGross = elaineGuaranteed + elaineSipp;
      const johnTax = calcIncomeTax(johnGross);
      const elaineTax = calcIncomeTax(elaineGross);
      const netTotal = johnTax.net + elaineTax.net + isaDraw;
      if (netTotal < targetNet) lo = mid; else hi = mid;
    }
    const totalDraw = (lo + hi) / 2;
    const sippDraw = Math.min(totalDraw, maxJohnSipp + maxElaineSipp);
    const isaDraw = Math.max(0, totalDraw - sippDraw);
    const johnSipp = Math.min(sippDraw * jp / 100, maxJohnSipp);
    const elaineSipp = Math.min(sippDraw - johnSipp, maxElaineSipp);
    const johnGross = johnGuaranteed + johnSipp;
    const elaineGross = elaineGuaranteed + elaineSipp;
    const jTax = calcIncomeTax(johnGross);
    const eTax = calcIncomeTax(elaineGross);
    const netTotal = jTax.net + eTax.net + isaDraw;
    const totalTax = jTax.tax + eTax.tax;
    if (Math.abs(netTotal - targetNet) < 200 && totalTax < bestTax) {
      bestTax = totalTax;
      bestSplit = {
        johnSippDraw: Math.round(johnSipp),
        elaineSippDraw: Math.round(elaineSipp),
        isaDraw: Math.round(isaDraw),
        johnGross: Math.round(johnGross),
        elaineGross: Math.round(elaineGross),
        johnTax: jTax,
        elaineTax: eTax,
        totalTax: Math.round(totalTax),
        totalGross: Math.round(johnGross + elaineGross + isaDraw),
        totalNet: Math.round(jTax.net + eTax.net + isaDraw),
        totalFromPortfolio: Math.round(johnSipp + elaineSipp + isaDraw),
      };
    }
  }
  return bestSplit;
}

// ─── Default Assumptions ────────────────────────────────────────────────────
const DEFAULTS = {
  // People
  johnDOB: "1968-03-27",
  elaineDOB: "1971-02-26",
  retireYear: 2031,       // March 2031

  // Portfolio (read from tracker or default)
  johnSipp: 681968,
  elaineSipp: 115680,
  johnIsa: 18635,
  elaineIsa: 24929,
  lsegPension: 13120,

  // Monthly contributions until retirement
  monthlyContrib: 2011,   // combined
  contribGrowth: 0.05,    // nominal growth on contributions

  // DB Pensions
  dbPensions: [
    { owner: "John",   name: "Atkins",      annual: 5000, startAge: 65, indexed: false },
    { owner: "John",   name: "Pfizer",      annual: 2500, startAge: 65, indexed: false },
    { owner: "Elaine", name: "Disney",      annual: 1237, startAge: 65, indexed: false },
    { owner: "Elaine", name: "Nippon Life",  annual: 135,  startAge: 65, indexed: false },
  ],

  // State Pensions (2025/26 full amount)
  statePension: 11502,
  johnSpAge: 67,
  elaineSpAge: 67,

  // Mortgage (£1,600/month — paid ON TOP of living costs until cleared)
  mortgageBalance: 250000,
  mortgageClearAge: 67,    // John's age when mortgage cleared via PCLS
  mortgageAnnualCost: 19200, // £1,600/month
  usePclsForMortgage: true,

  // Target income (net, after tax)
  targetNetIncome: 60000,   // base retirement income (post-mortgage)
  elainePartTime: 4800,     // until retirement
  inflationRate: 0.025,

  // Stepped income reductions in later life (% reduction from base target)
  // These reflect lower activity, travel, discretionary spend
  incomeSteps: [
    { fromAge: 75, reduction: 0.10, label: "Age 75 — less travel & activity" },
    { fromAge: 80, reduction: 0.15, label: "Age 80 — more home-based lifestyle" },
    { fromAge: 85, reduction: 0.20, label: "Age 85 — lower discretionary spend" },
  ],

  // Growth scenarios (real, after inflation)
  scenarioBear: 0.03,
  scenarioCentral: 0.05,
  scenarioBull: 0.07,

  // Longevity
  planToAge: 95,

  // IHT / Estate Planning
  houseValue: 1200000,        // current market value
  houseGrowthRate: 0.03,      // conservative 3% nominal (below long-term UK avg)
  mortgageNow: 350000,        // current total mortgage balance
  mortgageRepaymentPortion: 100000, // portion on repayment (rest is interest-only)
  mortgageClearAgeIHT: 67,    // age when remaining mortgage paid off (synced with main mortgage)
  ihtNrb: 325000,             // Nil-Rate Band per person
  ihtRnrb: 175000,            // Residence Nil-Rate Band per person (main home to direct descendants)
  ihtRate: 0.40,              // 40% on excess above threshold
  ihtRnrbTaperStart: 2000000, // RNRB tapers by £1 per £2 above this
};

// ─── Main Component ─────────────────────────────────────────────────────────
export default function RetirementPlanner() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [livePortfolio, setLivePortfolio] = useState(null);
  const [scenario, setScenario] = useState("central");

  // Try to load live portfolio values
  useEffect(() => {
    fetch("./price_history-2.json")
      .then(r => r.json())
      .then(d => {
        const accVal = id => {
          const a = d.accounts.find(x => x.id === id);
          if (!a) return 0;
          return a.holdings.reduce((s, h) => {
            if (h.manualValue) return s + h.manualValue;
            return s + (h.units || 0) * (h.price || 0);
          }, 0);
        };
        const live = {
          johnSipp: Math.round(accVal("john-sipp")),
          elaineSipp: Math.round(accVal("elaine-sipp")),
          johnIsa: Math.round(accVal("john-isa")),
          elaineIsa: Math.round(accVal("elaine-isa")),
          lsegPension: Math.round(accVal("john-pension")),
        };
        setLivePortfolio(live);
        setCfg(c => ({ ...c, ...live }));
        setDraft(c => ({ ...c, ...live }));
      })
      .catch(() => {});
  }, []);

  // ─── Projection Engine ──────────────────────────────────────────────────
  const projection = useMemo(() => {
    const johnBirthYear = parseInt(cfg.johnDOB.split("-")[0]);
    const elaineBirthYear = parseInt(cfg.elaineDOB.split("-")[0]);
    const retireYear = cfg.retireYear;
    const retireAgeJohn = retireYear - johnBirthYear;
    const retireAgeElaine = retireYear - elaineBirthYear;

    const rates = {
      bear: cfg.scenarioBear,
      central: cfg.scenarioCentral,
      bull: cfg.scenarioBull,
    };

    const results = {};
    for (const [scName, realRate] of Object.entries(rates)) {
      const years = [];
      // Starting values — grow to retirement with contributions
      const yearsToRetire = retireYear - 2026;
      const preRetireGrowth = 1 + (realRate + cfg.inflationRate); // nominal growth pre-retire
      let johnSipp = cfg.johnSipp;
      let elaineSipp = cfg.elaineSipp;
      let johnIsa = cfg.johnIsa;
      let elaineIsa = cfg.elaineIsa;
      let lsegPension = cfg.lsegPension;

      // Grow portfolios to retirement (contributions go 70% John SIPP, 20% Elaine SIPP, 10% ISAs)
      for (let y = 0; y < yearsToRetire; y++) {
        const contrib = cfg.monthlyContrib * 12;
        johnSipp = johnSipp * preRetireGrowth + contrib * 0.70;
        elaineSipp = elaineSipp * preRetireGrowth + contrib * 0.20;
        johnIsa = johnIsa * preRetireGrowth + contrib * 0.05;
        elaineIsa = elaineIsa * preRetireGrowth + contrib * 0.05;
        lsegPension = lsegPension * preRetireGrowth;
      }

      const totalAtRetirement = johnSipp + elaineSipp + johnIsa + elaineIsa + lsegPension;

      // PCLS (25% tax-free from SIPPs)
      const johnPcls = johnSipp * 0.25;
      const elainePcls = elaineSipp * 0.25;
      const totalPcls = johnPcls + elainePcls;
      let pclsTaken = false;
      let mortgagePaid = false;

      // Nominal growth rate during drawdown (real + inflation)
      const nominalGrowth = 1 + realRate + cfg.inflationRate;
      let inflationFactor = 1; // cumulative from retirement

      // Year-by-year from retirement
      for (let yr = retireYear; yr <= johnBirthYear + cfg.planToAge; yr++) {
        const johnAge = yr - johnBirthYear;
        const elaineAge = yr - elaineBirthYear;
        const yearIdx = yr - retireYear;

        inflationFactor = Math.pow(1 + cfg.inflationRate, yearIdx);

        // ── Income target calculation ──
        // Base target: £60k (post-mortgage living costs)
        let baseTarget = cfg.targetNetIncome;

        // Apply stepped reductions for later life
        for (const step of [...(cfg.incomeSteps || [])].sort((a, b) => b.fromAge - a.fromAge)) {
          if (johnAge >= step.fromAge) {
            baseTarget = cfg.targetNetIncome * (1 - step.reduction);
            break;
          }
        }

        // Before mortgage cleared: add mortgage payments on top
        const mortgageTopUp = (!mortgagePaid) ? cfg.mortgageAnnualCost : 0;
        const targetNet = Math.round(baseTarget + mortgageTopUp);

        // Guaranteed income this year
        let johnGuaranteed = 0;
        let elaineGuaranteed = 0;

        // DB pensions (constant — not inflation-indexed)
        for (const db of cfg.dbPensions) {
          const ownerAge = db.owner === "John" ? johnAge : elaineAge;
          if (ownerAge >= db.startAge) {
            if (db.owner === "John") johnGuaranteed += db.annual;
            else elaineGuaranteed += db.annual;
          }
        }

        // State pensions (shown in today's money)
        if (johnAge >= cfg.johnSpAge) {
          johnGuaranteed += cfg.statePension;
        }
        if (elaineAge >= cfg.elaineSpAge) {
          elaineGuaranteed += cfg.statePension;
        }

        // LSEG pension — add to John's guaranteed from retirement
        if (yearIdx >= 0) {
          johnGuaranteed += Math.round(lsegPension * 0.05); // ~5% annuity equivalent
        }

        // Elaine's part-time income (only pre-retirement, already covered)
        const totalGuaranteed = johnGuaranteed + elaineGuaranteed;

        // Mortgage event
        let mortgageEvent = 0;
        let pclsEvent = 0;
        if (cfg.usePclsForMortgage && johnAge === cfg.mortgageClearAge && !pclsTaken) {
          pclsEvent = totalPcls;
          johnSipp -= johnPcls;
          elaineSipp -= elainePcls;
          mortgageEvent = cfg.mortgageBalance;
          pclsTaken = true;
          mortgagePaid = true;
        }

        // Income needed is now simply targetNet (mortgage + step-downs already factored in above)
        const incomeNeeded = targetNet;

        // Optimise drawdown split
        const totalIsa = johnIsa + elaineIsa;
        const drawdown = optimiseDrawdown(
          johnGuaranteed, elaineGuaranteed,
          incomeNeeded,
          Math.max(0, johnSipp),
          Math.max(0, elaineSipp),
          Math.max(0, totalIsa)
        );

        const portfolioDraw = drawdown ? drawdown.totalFromPortfolio : 0;
        const taxPaid = drawdown ? drawdown.totalTax : 0;
        const netReceived = drawdown ? drawdown.totalNet : 0;

        // Subtract drawdown from accounts
        if (drawdown) {
          johnSipp = Math.max(0, johnSipp - drawdown.johnSippDraw);
          elaineSipp = Math.max(0, elaineSipp - drawdown.elaineSippDraw);
          // ISA draw split proportionally
          if (drawdown.isaDraw > 0 && totalIsa > 0) {
            const isaRatio = johnIsa / totalIsa;
            johnIsa = Math.max(0, johnIsa - drawdown.isaDraw * isaRatio);
            elaineIsa = Math.max(0, elaineIsa - drawdown.isaDraw * (1 - isaRatio));
          }
        }

        // Apply growth to remaining balances
        johnSipp *= nominalGrowth;
        elaineSipp *= nominalGrowth;
        johnIsa *= nominalGrowth;
        elaineIsa *= nominalGrowth;

        const totalPortfolio = johnSipp + elaineSipp + johnIsa + elaineIsa;
        const exhausted = totalPortfolio <= 0;

        years.push({
          year: yr,
          johnAge, elaineAge,
          totalPortfolio: Math.round(totalPortfolio),
          johnSipp: Math.round(johnSipp),
          elaineSipp: Math.round(elaineSipp),
          johnIsa: Math.round(johnIsa),
          elaineIsa: Math.round(elaineIsa),
          johnGuaranteed, elaineGuaranteed,
          totalGuaranteed,
          incomeNeeded,
          portfolioDraw: Math.round(portfolioDraw),
          taxPaid: Math.round(taxPaid),
          netReceived: Math.round(netReceived),
          mortgageEvent: mortgageEvent > 0 ? mortgageEvent : null,
          pclsEvent: pclsEvent > 0 ? Math.round(pclsEvent) : null,
          exhausted,
          drawdownDetail: drawdown,
        });

        if (exhausted) break;
      }

      // Summary
      const lastYear = years[years.length - 1];
      const exhaustionAge = lastYear.exhausted ? lastYear.johnAge : null;
      const portfolioAt80 = years.find(y => y.johnAge === 80);
      const portfolioAt90 = years.find(y => y.johnAge === 90);

      results[scName] = {
        years,
        totalAtRetirement: Math.round(totalAtRetirement),
        totalPcls: Math.round(totalPcls),
        exhaustionAge,
        portfolioAt80: portfolioAt80 ? portfolioAt80.totalPortfolio : null,
        portfolioAt90: portfolioAt90 ? portfolioAt90.totalPortfolio : null,
        sustainableYears: years.filter(y => !y.exhausted).length,
      };
    }
    return results;
  }, [cfg, scenario]);

  // ─── IHT Projection Engine ────────────────────────────────────────────────
  const ihtProjection = useMemo(() => {
    const johnBirthYear = parseInt(cfg.johnDOB.split("-")[0]);
    const currentAge = new Date().getFullYear() - johnBirthYear;
    const yearsRepayment = cfg.mortgageClearAgeIHT - currentAge; // years until mortgage clear
    const repaymentPerYear = yearsRepayment > 0 ? cfg.mortgageRepaymentPortion / yearsRepayment : 0;
    const interestOnlyPortion = cfg.mortgageNow - cfg.mortgageRepaymentPortion;

    const results = {};
    for (const scName of ["bear", "central", "bull"]) {
      const projYears = projection[scName]?.years || [];
      const years = [];

      // Pre-retirement years (from current age to retirement)
      for (let age = currentAge; age < (cfg.retireYear - johnBirthYear); age++) {
        const yearsFromNow = age - currentAge;
        const houseVal = Math.round(cfg.houseValue * Math.pow(1 + cfg.houseGrowthRate, yearsFromNow));

        // Mortgage: repayment portion reduces linearly, interest-only stays until cleared
        let mortgageRemaining;
        if (age >= cfg.mortgageClearAgeIHT) {
          mortgageRemaining = 0;
        } else {
          const repaid = Math.min(repaymentPerYear * yearsFromNow, cfg.mortgageRepaymentPortion);
          mortgageRemaining = Math.round(interestOnlyPortion + cfg.mortgageRepaymentPortion - repaid);
        }

        // Portfolio: split SIPP and ISA — apply 2027 SIPP IHT rule
        // From 6 April 2027 SIPPs form part of the taxable estate; before that date they are outside.
        const sippNow = cfg.johnSipp + cfg.elaineSipp + cfg.lsegPension;
        const isaNow  = cfg.johnIsa + cfg.elaineIsa;
        const nomRate = 1 + (scName === "bear" ? cfg.scenarioBear : scName === "central" ? cfg.scenarioCentral : cfg.scenarioBull) + cfg.inflationRate;
        const sippVal = Math.round(sippNow * Math.pow(nomRate, yearsFromNow));
        const isaVal  = Math.round(isaNow  * Math.pow(nomRate, yearsFromNow));
        const sippsInEstate = (johnBirthYear + age) >= 2027;
        const portfolioVal  = sippsInEstate ? sippVal + isaVal : isaVal;

        const grossEstate = portfolioVal + houseVal;
        const netEstate = grossEstate - mortgageRemaining;

        // IHT calculation (second death — both allowances available)
        const combinedNrb = cfg.ihtNrb * 2;
        let combinedRnrb = cfg.ihtRnrb * 2;
        // RNRB taper: reduces by £1 per £2 above taper start
        if (netEstate > cfg.ihtRnrbTaperStart) {
          const taperReduction = Math.floor((netEstate - cfg.ihtRnrbTaperStart) / 2);
          combinedRnrb = Math.max(0, combinedRnrb - taperReduction);
        }
        const totalAllowance = combinedNrb + combinedRnrb;
        const taxableEstate = Math.max(0, netEstate - totalAllowance);
        const ihtDue = Math.round(taxableEstate * cfg.ihtRate);

        years.push({
          year: johnBirthYear + age,
          johnAge: age,
          houseValue: houseVal,
          mortgage: mortgageRemaining,
          portfolioValue: portfolioVal,
          sippValue: sippVal,
          isaValue: isaVal,
          sippsInEstate,
          grossEstate,
          netEstate,
          combinedNrb,
          combinedRnrb,
          totalAllowance,
          taxableEstate,
          ihtDue,
          netAfterIht: netEstate - ihtDue,
          phase: "pre-retirement",
        });
      }

      // Post-retirement years (from projection data)
      for (const py of projYears) {
        const yearsFromNow = py.johnAge - currentAge;
        const houseVal = Math.round(cfg.houseValue * Math.pow(1 + cfg.houseGrowthRate, yearsFromNow));

        let mortgageRemaining;
        if (py.johnAge >= cfg.mortgageClearAgeIHT) {
          mortgageRemaining = 0;
        } else {
          const repaid = Math.min(repaymentPerYear * yearsFromNow, cfg.mortgageRepaymentPortion);
          mortgageRemaining = Math.round(interestOnlyPortion + cfg.mortgageRepaymentPortion - repaid);
        }

        // From 6 April 2027 SIPPs are in the taxable estate
        const sippValPost = py.johnSipp + py.elaineSipp;
        const isaValPost  = py.johnIsa + py.elaineIsa;
        const sippsInEstatePost = py.year >= 2027;
        const estatePortfolio = sippsInEstatePost ? py.totalPortfolio : isaValPost;

        const grossEstate = estatePortfolio + houseVal;
        const netEstate = grossEstate - mortgageRemaining;

        const combinedNrb = cfg.ihtNrb * 2;
        let combinedRnrb = cfg.ihtRnrb * 2;
        if (netEstate > cfg.ihtRnrbTaperStart) {
          const taperReduction = Math.floor((netEstate - cfg.ihtRnrbTaperStart) / 2);
          combinedRnrb = Math.max(0, combinedRnrb - taperReduction);
        }
        const totalAllowance = combinedNrb + combinedRnrb;
        const taxableEstate = Math.max(0, netEstate - totalAllowance);
        const ihtDue = Math.round(taxableEstate * cfg.ihtRate);

        years.push({
          year: py.year,
          johnAge: py.johnAge,
          houseValue: houseVal,
          mortgage: mortgageRemaining,
          portfolioValue: estatePortfolio,
          sippValue: sippValPost,
          isaValue: isaValPost,
          sippsInEstate: sippsInEstatePost,
          grossEstate,
          netEstate,
          combinedNrb,
          combinedRnrb,
          totalAllowance,
          taxableEstate,
          ihtDue,
          netAfterIht: netEstate - ihtDue,
          phase: "post-retirement",
        });
      }

      // Peak IHT
      const peakIht = years.reduce((max, y) => y.ihtDue > max.ihtDue ? y : max, years[0] || { ihtDue: 0 });
      const ihtAtRetire = years.find(y => y.johnAge === cfg.retireYear - johnBirthYear);
      const ihtAt75 = years.find(y => y.johnAge === 75);
      const ihtAt80 = years.find(y => y.johnAge === 80);
      const ihtAt90 = years.find(y => y.johnAge === 90);

      results[scName] = { years, peakIht, ihtAtRetire, ihtAt75, ihtAt80, ihtAt90 };
    }
    return results;
  }, [cfg, projection]);

  // ─── Styles (matching tracker dark theme) ─────────────────────────────────
  const S = {
    wrap: { background: "#0f1923", minHeight: "100vh", fontFamily: "'Segoe UI',sans-serif", color: "#e8dcc8", fontSize: 13 },
    nav: { background: "#0a1420", borderBottom: "1px solid #1e2f3e", display: "flex", alignItems: "center", padding: "0 20px", gap: 4 },
    logo: { color: "#c9a84c", fontWeight: 700, fontSize: 15, letterSpacing: "0.12em", textTransform: "uppercase", marginRight: 20, padding: "14px 0" },
    tab: a => ({ padding: "14px 16px", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: "none", background: "transparent", color: a ? "#c9a84c" : "#6a7d8f", borderBottom: a ? "2px solid #c9a84c" : "2px solid transparent", fontFamily: "inherit" }),
    body: { padding: "20px 24px", maxWidth: 1600, margin: "0 auto" },
    card: { background: "#121e2b", border: "1px solid #1e2f3e", borderRadius: 4, padding: "16px 20px", marginBottom: 16 },
    g3: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 },
    g4: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 },
    g5: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 16 },
    sBox: { background: "#121e2b", border: "1px solid #1e2f3e", borderRadius: 4, padding: "14px 16px" },
    sLbl: { fontSize: 10, color: "#6a7d8f", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 },
    sec: { fontSize: 10, color: "#6a7d8f", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #1e2f3e" },
    tbl: { width: "100%", borderCollapse: "collapse" },
    th: { padding: "8px 10px", borderBottom: "1px solid #1e2f3e", color: "#6a7d8f", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "left", whiteSpace: "nowrap" },
    thR: { padding: "8px 10px", borderBottom: "1px solid #1e2f3e", color: "#6a7d8f", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right", whiteSpace: "nowrap" },
    td: { padding: "9px 10px", borderBottom: "1px solid #1e2f3e", color: "#e8dcc8", verticalAlign: "middle" },
    tdR: { padding: "9px 10px", borderBottom: "1px solid #1e2f3e", color: "#e8dcc8", textAlign: "right", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },
    gain: v => ({ padding: "9px 10px", borderBottom: "1px solid #1e2f3e", textAlign: "right", verticalAlign: "middle", fontVariantNumeric: "tabular-nums", color: v == null ? "#6a7d8f" : v >= 0 ? "#70AD47" : "#e07060" }),
    input: { background: "#0f1923", border: "1px solid #2a3d50", color: "#e8dcc8", padding: "6px 10px", fontSize: 12, fontFamily: "inherit", width: "100%", textAlign: "right", outline: "none", borderRadius: 3 },
    inputFocus: { borderColor: "#c9a84c" },
    label: { fontSize: 10, color: "#6a7d8f", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, display: "block" },
    rBtn: a => ({ padding: "6px 14px", fontSize: 10, letterSpacing: "0.1em", border: "1px solid", borderColor: a ? "#c9a84c" : "#2a3d50", background: a ? "#c9a84c18" : "transparent", color: a ? "#c9a84c" : "#6a7d8f", cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }),
    milestone: (color) => ({ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", background: color + "10", border: `1px solid ${color}30`, borderRadius: 4, marginBottom: 8 }),
    msIcon: { fontSize: 20, lineHeight: 1.2 },
    link: { color: "#c9a84c", textDecoration: "none", fontSize: 11 },
  };

  // ─── Input helper (edits draft, not cfg directly) ─────────────────────────
  const updateDraft = (fn) => { setDraft(fn); setDirty(true); };
  const submitChanges = () => { setCfg(draft); setDirty(false); };
  const resetDraft = () => { setDraft(cfg); setDirty(false); };

  const NumInput = ({ label, value, field, prefix = "", suffix = "", step = 1 }) => (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {prefix && <span style={{ color: "#6a7d8f", fontSize: 12 }}>{prefix}</span>}
        <input
          type="number"
          style={S.input}
          value={value}
          step={step}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (field === "_mortgageMonthly") {
              updateDraft(c => ({ ...c, mortgageAnnualCost: isNaN(v) ? 0 : Math.round(v * 12) }));
            } else {
              updateDraft(c => ({ ...c, [field]: isNaN(v) ? 0 : v }));
            }
          }}
        />
        {suffix && <span style={{ color: "#6a7d8f", fontSize: 12, whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
    </div>
  );

  // Active projection
  const proj = projection[scenario];
  const projBear = projection.bear;
  const projCentral = projection.central;
  const projBull = projection.bull;

  // ─── Chart: Portfolio Value Over Time ─────────────────────────────────────
  const PortfolioChart = () => {
    const allScenarios = [
      { key: "bull", label: "Bull", color: "#70AD47", data: projBull.years },
      { key: "central", label: "Central", color: "#c9a84c", data: projCentral.years },
      { key: "bear", label: "Bear", color: "#e07060", data: projBear.years },
    ];
    const maxLen = Math.max(...allScenarios.map(s => s.data.length));
    const allVals = allScenarios.flatMap(s => s.data.map(y => y.totalPortfolio));
    const maxV = Math.max(...allVals, 1);
    const W = 800, H = 240, P = { t: 15, r: 15, b: 35, l: 75 };
    const toX = i => P.l + (i / (maxLen - 1)) * (W - P.l - P.r);
    const toY = v => P.t + (1 - v / maxV) * (H - P.t - P.b);
    const ticks = [0, Math.round(maxV / 4), Math.round(maxV / 2), Math.round(maxV * 3 / 4), maxV];

    // Find milestone years
    const johnBY = parseInt(cfg.johnDOB.split("-")[0]);
    const mortgageYr = johnBY + cfg.mortgageClearAge;
    const spYr = johnBY + cfg.johnSpAge;

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {/* Grid */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} y1={toY(v)} x2={W - P.r} y2={toY(v)} stroke="#1e2f3e" strokeDasharray="3,3" />
            <text x={P.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#4a6070">
              {v >= 1000000 ? (v / 1000000).toFixed(1) + "m" : (v / 1000).toFixed(0) + "k"}
            </text>
          </g>
        ))}
        {/* Milestone markers */}
        {projCentral.years.map((y, i) => {
          if (y.year === mortgageYr) return <line key="mort" x1={toX(i)} y1={P.t} x2={toX(i)} y2={H - P.b} stroke="#e07060" strokeDasharray="4,4" strokeOpacity="0.5" />;
          if (y.year === spYr) return <line key="sp" x1={toX(i)} y1={P.t} x2={toX(i)} y2={H - P.b} stroke="#70AD47" strokeDasharray="4,4" strokeOpacity="0.5" />;
          return null;
        })}
        {/* Scenario lines */}
        {allScenarios.map(sc => {
          const pathD = sc.data.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.totalPortfolio)}`).join(" ");
          return (
            <g key={sc.key}>
              <path d={pathD} fill="none" stroke={sc.color} strokeWidth={sc.key === scenario ? 2.5 : 1} strokeOpacity={sc.key === scenario ? 1 : 0.4} />
            </g>
          );
        })}
        {/* X labels */}
        {projCentral.years.map((y, i) => {
          const step = Math.max(1, Math.floor(maxLen / 12));
          return (i % step === 0 || i === maxLen - 1) ? (
            <text key={i} x={toX(i)} y={H - P.b + 14} textAnchor="middle" fontSize="8" fill="#4a6070">
              {y.year} ({y.johnAge})
            </text>
          ) : null;
        })}
        {/* Legend */}
        {allScenarios.map((sc, i) => (
          <g key={sc.key}>
            <line x1={P.l + i * 100} y1={H - 5} x2={P.l + i * 100 + 20} y2={H - 5} stroke={sc.color} strokeWidth="2" />
            <text x={P.l + i * 100 + 24} y={H - 2} fontSize="9" fill={sc.color}>{sc.label} ({pct(sc.key === "bear" ? cfg.scenarioBear : sc.key === "central" ? cfg.scenarioCentral : cfg.scenarioBull)} real)</text>
          </g>
        ))}
      </svg>
    );
  };

  // ─── Income Waterfall Chart ───────────────────────────────────────────────
  const IncomeWaterfall = () => {
    if (!proj || !proj.years.length) return null;
    const yrs = proj.years;
    const maxIncome = Math.max(...yrs.map(y => y.incomeNeeded + y.portfolioDraw));
    const W = 800, H = 200, P = { t: 15, r: 15, b: 35, l: 65 };
    const barW = Math.min(20, (W - P.l - P.r) / yrs.length - 2);
    const toX = i => P.l + (i / yrs.length) * (W - P.l - P.r) + barW / 2;
    const toH = v => (v / (maxIncome || 1)) * (H - P.t - P.b);
    const baseY = H - P.b;

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = Math.round(maxIncome * f);
          return (
            <g key={i}>
              <line x1={P.l} y1={baseY - toH(v)} x2={W - P.r} y2={baseY - toH(v)} stroke="#1e2f3e" strokeDasharray="3,3" />
              <text x={P.l - 6} y={baseY - toH(v) + 4} textAnchor="end" fontSize="9" fill="#4a6070">{(v / 1000).toFixed(0)}k</text>
            </g>
          );
        })}
        {yrs.map((y, i) => {
          const gH = toH(y.totalGuaranteed);
          const pH = toH(y.portfolioDraw);
          const tH = toH(y.taxPaid);
          return (
            <g key={i}>
              {/* Guaranteed income */}
              <rect x={toX(i) - barW / 2} y={baseY - gH} width={barW} height={gH} fill="#70AD47" rx="1" opacity="0.8" />
              {/* Portfolio drawdown */}
              <rect x={toX(i) - barW / 2} y={baseY - gH - pH} width={barW} height={pH} fill="#c9a84c" rx="1" opacity="0.8" />
              {/* Tax */}
              <rect x={toX(i) - barW / 2} y={baseY - gH - pH - tH} width={barW} height={tH} fill="#e07060" rx="1" opacity="0.5" />
              {/* X label */}
              {(i % Math.max(1, Math.floor(yrs.length / 12)) === 0) && (
                <text x={toX(i)} y={H - P.b + 13} textAnchor="middle" fontSize="8" fill="#4a6070">{y.year}</text>
              )}
            </g>
          );
        })}
        {/* Legend */}
        <rect x={P.l} y={H - 7} width={10} height={6} fill="#70AD47" rx="1" />
        <text x={P.l + 14} y={H - 2} fontSize="9" fill="#70AD47">Guaranteed</text>
        <rect x={P.l + 90} y={H - 7} width={10} height={6} fill="#c9a84c" rx="1" />
        <text x={P.l + 104} y={H - 2} fontSize="9" fill="#c9a84c">Portfolio</text>
        <rect x={P.l + 170} y={H - 7} width={10} height={6} fill="#e07060" rx="1" />
        <text x={P.l + 184} y={H - 2} fontSize="9" fill="#e07060">Tax</text>
      </svg>
    );
  };

  // ─── Key milestones ───────────────────────────────────────────────────────
  const johnBY = parseInt(cfg.johnDOB.split("-")[0]);
  const elaineBY = parseInt(cfg.elaineDOB.split("-")[0]);
  const milestones = [
    { year: cfg.retireYear, icon: "🏖️", color: "#c9a84c", title: `Retire — Age ${cfg.retireYear - johnBY}`,
      desc: `Begin flexible drawdown. Target ${fmt(cfg.targetNetIncome + cfg.mortgageAnnualCost)} net p.a. (incl. ${fmt(cfg.mortgageAnnualCost)} mortgage)` },
    { year: johnBY + 65, icon: "📋", color: "#4472C4", title: `John's DB Pensions Start — Age 65`,
      desc: `Atkins (${fmt(5000)}) + Pfizer (${fmt(2500)}) = ${fmt(7500)} p.a.` },
    { year: johnBY + cfg.mortgageClearAge, icon: "🏠", color: "#e07060", title: `Mortgage Cleared — Age ${cfg.mortgageClearAge}`,
      desc: `${fmt(cfg.mortgageBalance)} paid via PCLS. Target drops to ${fmt(cfg.targetNetIncome)} net p.a.` },
    { year: johnBY + cfg.johnSpAge, icon: "👴", color: "#70AD47", title: `John's State Pension — Age ${cfg.johnSpAge}`,
      desc: `${fmt(cfg.statePension)} p.a. (current rates)` },
    { year: elaineBY + 65, icon: "📋", color: "#5BA3A0", title: `Elaine's DB Pensions Start — Age 65`,
      desc: `Disney (${fmt(1237)}) + Nippon Life (${fmt(135)}) = ${fmt(1372)} p.a.` },
    { year: elaineBY + cfg.elaineSpAge, icon: "👵", color: "#70AD47", title: `Elaine's State Pension — Age ${cfg.elaineSpAge}`,
      desc: `${fmt(cfg.statePension)} p.a.` },
    ...(cfg.incomeSteps || []).map(step => ({
      year: johnBY + step.fromAge, icon: "📉", color: "#9E7FC0",
      title: `Income Step-Down — Age ${step.fromAge}`,
      desc: `Target reduces by ${(step.reduction * 100).toFixed(0)}% to ${fmt(cfg.targetNetIncome * (1 - step.reduction))} net p.a. — ${step.label}`
    })),
  ].sort((a, b) => a.year - b.year);

  // Sections
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "income", label: "Income Timeline" },
    { id: "drawdown", label: "Drawdown Detail" },
    { id: "tax", label: "Tax Optimisation" },
    { id: "sustainability", label: "Sustainability" },
    { id: "iht", label: "IHT" },
    { id: "config", label: "Assumptions" },
  ];

  return (
    <div style={S.wrap}>
      <nav style={S.nav}>
        <div style={S.logo}>Retirement Planner</div>
        {sections.map(s => (
          <button key={s.id} style={S.tab(activeSection === s.id)} onClick={() => setActiveSection(s.id)}>{s.label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <a href="./index.html" style={S.link}>← Portfolio Tracker</a>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════
          OVERVIEW TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "overview" && (
        <div style={S.body}>
          {/* Headline Summary */}
          <div style={{ ...S.card, borderColor: projCentral.exhaustionAge ? "#e0706044" : "#70AD4744" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={S.sLbl}>Retirement Plan · John & Elaine Daniells</div>
                <div style={{ fontSize: 22, color: "#c9a84c", fontWeight: 600, marginTop: 4 }}>
                  {projCentral.exhaustionAge
                    ? `Portfolio exhausted at age ${projCentral.exhaustionAge}`
                    : `Sustainable to age ${cfg.planToAge}+`}
                </div>
                <div style={{ fontSize: 12, color: "#6a7d8f", marginTop: 6 }}>
                  Retire March {cfg.retireYear} (age {cfg.retireYear - johnBY}) · Target {fmt(cfg.targetNetIncome)} net p.a. · Three-scenario projection
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {["bear", "central", "bull"].map(s => (
                  <button key={s} style={S.rBtn(scenario === s)} onClick={() => setScenario(s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Key Numbers */}
          <div style={S.g5}>
            <div style={S.sBox}>
              <div style={S.sLbl}>Portfolio Today</div>
              <div style={{ fontSize: 20, color: "#c9a84c" }}>{fmt(cfg.johnSipp + cfg.elaineSipp + cfg.johnIsa + cfg.elaineIsa + cfg.lsegPension)}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Projected at Retirement</div>
              <div style={{ fontSize: 20, color: "#e8dcc8" }}>{fmt(projCentral.totalAtRetirement)}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>Central scenario · March {cfg.retireYear}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>PCLS (Tax-Free Cash)</div>
              <div style={{ fontSize: 20, color: "#70AD47" }}>{fmt(projCentral.totalPcls)}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>25% of SIPPs at {cfg.mortgageClearAge}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Guaranteed Income (max)</div>
              <div style={{ fontSize: 20, color: "#70AD47" }}>{fmt(cfg.dbPensions.reduce((s, p) => s + p.annual, 0) + cfg.statePension * 2)} p.a.</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>From age {cfg.elaineSpAge + (elaineBY - johnBY) + johnBY === elaineBY + cfg.elaineSpAge ? cfg.elaineSpAge + 3 : 70}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Portfolio at 80</div>
              <div style={{ fontSize: 20, color: projCentral.portfolioAt80 && projCentral.portfolioAt80 > 0 ? "#70AD47" : "#e07060" }}>
                {projCentral.portfolioAt80 != null ? fmt(projCentral.portfolioAt80) : "Exhausted"}
              </div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>Central scenario</div>
            </div>
          </div>

          {/* Portfolio Projection Chart */}
          <div style={S.card}>
            <div style={S.sec}>Portfolio Value · Three Scenarios (Real Growth + Inflation)</div>
            <PortfolioChart />
          </div>

          {/* Income Waterfall */}
          <div style={S.card}>
            <div style={S.sec}>Annual Income Composition · {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</div>
            <IncomeWaterfall />
          </div>

          {/* Milestones */}
          <div style={S.card}>
            <div style={S.sec}>Key Milestones</div>
            {milestones.map((m, i) => (
              <div key={i} style={S.milestone(m.color)}>
                <span style={S.msIcon}>{m.icon}</span>
                <div>
                  <div style={{ fontSize: 12, color: m.color, fontWeight: 600 }}>{m.year} — {m.title}</div>
                  <div style={{ fontSize: 11, color: "#6a7d8f", marginTop: 2 }}>{m.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Scenario Comparison */}
          <div style={S.card}>
            <div style={S.sec}>Scenario Comparison</div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Scenario</th>
                  <th style={S.thR}>Real Growth</th>
                  <th style={S.thR}>Pot at Retirement</th>
                  <th style={S.thR}>PCLS</th>
                  <th style={S.thR}>Portfolio at 80</th>
                  <th style={S.thR}>Portfolio at 90</th>
                  <th style={S.thR}>Sustainable Years</th>
                  <th style={S.th}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "bear", label: "Bear", color: "#e07060", rate: cfg.scenarioBear },
                  { key: "central", label: "Central", color: "#c9a84c", rate: cfg.scenarioCentral },
                  { key: "bull", label: "Bull", color: "#70AD47", rate: cfg.scenarioBull },
                ].map(sc => {
                  const p = projection[sc.key];
                  return (
                    <tr key={sc.key} style={scenario === sc.key ? { background: "#1e3040" } : {}} onClick={() => setScenario(sc.key)} onMouseEnter={e => e.currentTarget.style.background = "#1e3040"} onMouseLeave={e => { if (scenario !== sc.key) e.currentTarget.style.background = ""; }}>
                      <td style={{ ...S.td, color: sc.color, fontWeight: 600, cursor: "pointer" }}>{sc.label}</td>
                      <td style={S.tdR}>{pct(sc.rate)}</td>
                      <td style={S.tdR}>{fmt(p.totalAtRetirement)}</td>
                      <td style={S.tdR}>{fmt(p.totalPcls)}</td>
                      <td style={{ ...S.tdR, color: p.portfolioAt80 && p.portfolioAt80 > 0 ? "#70AD47" : "#e07060" }}>
                        {p.portfolioAt80 != null ? fmt(p.portfolioAt80) : "—"}
                      </td>
                      <td style={{ ...S.tdR, color: p.portfolioAt90 && p.portfolioAt90 > 0 ? "#70AD47" : "#e07060" }}>
                        {p.portfolioAt90 != null ? fmt(p.portfolioAt90) : "—"}
                      </td>
                      <td style={S.tdR}>{p.sustainableYears} years</td>
                      <td style={{ ...S.td, color: p.exhaustionAge ? "#e07060" : "#70AD47" }}>
                        {p.exhaustionAge ? `Runs out at ${p.exhaustionAge}` : `Lasts to ${cfg.planToAge}+`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          INCOME TIMELINE TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "income" && (
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sec}>Income Timeline · Year-by-Year</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["bear", "central", "bull"].map(s => (
                <button key={s} style={S.rBtn(scenario === s)} onClick={() => setScenario(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={S.card}>
            <IncomeWaterfall />
          </div>
          <div style={{ ...S.card, overflow: "auto" }}>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Year</th>
                  <th style={S.th}>John Age</th>
                  <th style={S.th}>Elaine Age</th>
                  <th style={S.thR}>Income Target</th>
                  <th style={S.thR}>Guaranteed</th>
                  <th style={S.thR}>From Portfolio</th>
                  <th style={S.thR}>Tax Paid</th>
                  <th style={S.thR}>Net Received</th>
                  <th style={S.thR}>Portfolio Value</th>
                  <th style={S.th}>Events</th>
                </tr>
              </thead>
              <tbody>
                {proj.years.map(y => {
                  const events = [];
                  if (y.pclsEvent) events.push(`PCLS: ${fmt(y.pclsEvent)}`);
                  if (y.mortgageEvent) events.push(`Mortgage: -${fmt(y.mortgageEvent)}`);
                  const johnDB = cfg.dbPensions.filter(p => p.owner === "John" && y.johnAge === p.startAge).map(p => p.name);
                  const elaineDB = cfg.dbPensions.filter(p => p.owner === "Elaine" && y.elaineAge === p.startAge).map(p => p.name);
                  if (johnDB.length) events.push(`J: ${johnDB.join(", ")} starts`);
                  if (elaineDB.length) events.push(`E: ${elaineDB.join(", ")} starts`);
                  if (y.johnAge === cfg.johnSpAge) events.push("J: State Pension");
                  if (y.elaineAge === cfg.elaineSpAge) events.push("E: State Pension");

                  return (
                    <tr key={y.year} style={y.exhausted ? { background: "#3d1e1e" } : {}} onMouseEnter={e => e.currentTarget.style.background = y.exhausted ? "#3d1e1e" : "#1e3040"} onMouseLeave={e => e.currentTarget.style.background = y.exhausted ? "#3d1e1e" : ""}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{y.year}</td>
                      <td style={S.td}>{y.johnAge}</td>
                      <td style={S.td}>{y.elaineAge}</td>
                      <td style={S.tdR}>{fmt(y.incomeNeeded)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(y.totalGuaranteed)}</td>
                      <td style={{ ...S.tdR, color: "#c9a84c" }}>{fmt(y.portfolioDraw)}</td>
                      <td style={{ ...S.tdR, color: "#e07060" }}>{fmt(y.taxPaid)}</td>
                      <td style={{ ...S.tdR, color: y.netReceived >= y.incomeNeeded * 0.95 ? "#70AD47" : "#e07060" }}>{fmt(y.netReceived)}</td>
                      <td style={{ ...S.tdR, color: y.totalPortfolio > 0 ? "#e8dcc8" : "#e07060", fontWeight: 600 }}>{fmt(y.totalPortfolio)}</td>
                      <td style={{ ...S.td, fontSize: 10, color: "#6a7d8f", maxWidth: 200 }}>{events.join(" · ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          DRAWDOWN DETAIL TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "drawdown" && (
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sec}>Drawdown Detail · Account-Level Breakdown</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["bear", "central", "bull"].map(s => (
                <button key={s} style={S.rBtn(scenario === s)} onClick={() => setScenario(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ ...S.card, overflow: "auto" }}>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Year</th>
                  <th style={S.th}>Age (J/E)</th>
                  <th style={S.thR}>John SIPP Draw</th>
                  <th style={S.thR}>Elaine SIPP Draw</th>
                  <th style={S.thR}>ISA Draw</th>
                  <th style={S.thR}>John SIPP Bal</th>
                  <th style={S.thR}>Elaine SIPP Bal</th>
                  <th style={S.thR}>John ISA Bal</th>
                  <th style={S.thR}>Elaine ISA Bal</th>
                  <th style={S.thR}>Total Portfolio</th>
                </tr>
              </thead>
              <tbody>
                {proj.years.map(y => (
                  <tr key={y.year} onMouseEnter={e => e.currentTarget.style.background = "#1e3040"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{y.year}</td>
                    <td style={S.td}>{y.johnAge}/{y.elaineAge}</td>
                    <td style={{ ...S.tdR, color: "#c9a84c" }}>{y.drawdownDetail ? fmt(y.drawdownDetail.johnSippDraw) : "—"}</td>
                    <td style={{ ...S.tdR, color: "#c9a84c" }}>{y.drawdownDetail ? fmt(y.drawdownDetail.elaineSippDraw) : "—"}</td>
                    <td style={{ ...S.tdR, color: "#70AD47" }}>{y.drawdownDetail ? fmt(y.drawdownDetail.isaDraw) : "—"}</td>
                    <td style={S.tdR}>{fmt(y.johnSipp)}</td>
                    <td style={S.tdR}>{fmt(y.elaineSipp)}</td>
                    <td style={S.tdR}>{fmt(y.johnIsa)}</td>
                    <td style={S.tdR}>{fmt(y.elaineIsa)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600, color: y.totalPortfolio > 0 ? "#e8dcc8" : "#e07060" }}>{fmt(y.totalPortfolio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAX OPTIMISATION TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "tax" && (
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sec}>Tax Optimisation · Personal Allowance Usage</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["bear", "central", "bull"].map(s => (
                <button key={s} style={S.rBtn(scenario === s)} onClick={() => setScenario(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Tax Summary Card */}
          <div style={S.g3}>
            <div style={S.sBox}>
              <div style={S.sLbl}>Year 1 Tax</div>
              <div style={{ fontSize: 20, color: "#e07060" }}>{proj.years[0] ? fmt(proj.years[0].taxPaid) : "—"}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>Effective rate: {proj.years[0] ? pct(proj.years[0].taxPaid / (proj.years[0].drawdownDetail?.totalGross || 1)) : "—"}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Lifetime Tax (to {cfg.planToAge})</div>
              <div style={{ fontSize: 20, color: "#e07060" }}>{fmt(proj.years.reduce((s, y) => s + y.taxPaid, 0))}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Tax-Free Withdrawals</div>
              <div style={{ fontSize: 20, color: "#70AD47" }}>{fmt(proj.years.reduce((s, y) => s + (y.drawdownDetail?.isaDraw || 0), 0))}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>ISA drawdowns (always tax-free)</div>
            </div>
          </div>

          <div style={{ ...S.card, overflow: "auto" }}>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Year</th>
                  <th style={S.thR}>John Gross</th>
                  <th style={S.thR}>John PA Used</th>
                  <th style={S.thR}>John Tax</th>
                  <th style={S.thR}>John Net</th>
                  <th style={S.thR}>Elaine Gross</th>
                  <th style={S.thR}>Elaine PA Used</th>
                  <th style={S.thR}>Elaine Tax</th>
                  <th style={S.thR}>Elaine Net</th>
                  <th style={S.thR}>ISA (Tax-Free)</th>
                  <th style={S.thR}>Total Tax</th>
                  <th style={S.thR}>Effective Rate</th>
                </tr>
              </thead>
              <tbody>
                {proj.years.map(y => {
                  const d = y.drawdownDetail;
                  if (!d) return null;
                  const jPaUsed = Math.min(d.johnGross, d.johnTax.pa || TAX.personalAllowance);
                  const ePaUsed = Math.min(d.elaineGross, d.elaineTax.pa || TAX.personalAllowance);
                  const effRate = d.totalGross > 0 ? d.totalTax / d.totalGross : 0;
                  return (
                    <tr key={y.year} onMouseEnter={e => e.currentTarget.style.background = "#1e3040"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{y.year}</td>
                      <td style={S.tdR}>{fmt(d.johnGross)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(jPaUsed)}</td>
                      <td style={{ ...S.tdR, color: "#e07060" }}>{fmt(d.johnTax.tax)}</td>
                      <td style={S.tdR}>{fmt(d.johnTax.net)}</td>
                      <td style={S.tdR}>{fmt(d.elaineGross)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(ePaUsed)}</td>
                      <td style={{ ...S.tdR, color: "#e07060" }}>{fmt(d.elaineTax.tax)}</td>
                      <td style={S.tdR}>{fmt(d.elaineTax.net)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(d.isaDraw)}</td>
                      <td style={{ ...S.tdR, color: "#e07060", fontWeight: 600 }}>{fmt(d.totalTax)}</td>
                      <td style={{ ...S.tdR, color: "#6a7d8f" }}>{pct(effRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUSTAINABILITY TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "sustainability" && (
        <div style={S.body}>
          <div style={S.sec}>Portfolio Sustainability Analysis</div>

          <div style={S.g3}>
            {[
              { key: "bear", label: "Bear", color: "#e07060", rate: cfg.scenarioBear },
              { key: "central", label: "Central", color: "#c9a84c", rate: cfg.scenarioCentral },
              { key: "bull", label: "Bull", color: "#70AD47", rate: cfg.scenarioBull },
            ].map(sc => {
              const p = projection[sc.key];
              return (
                <div key={sc.key} style={{ ...S.sBox, borderColor: sc.color + "44" }}>
                  <div style={{ ...S.sLbl, color: sc.color }}>{sc.label} ({pct(sc.rate)} real)</div>
                  <div style={{ fontSize: 24, color: sc.color, fontWeight: 600, marginBottom: 8 }}>
                    {p.exhaustionAge ? `Runs out at ${p.exhaustionAge}` : `Lasts to ${cfg.planToAge}+`}
                  </div>
                  <div style={{ fontSize: 11, color: "#6a7d8f", lineHeight: 1.6 }}>
                    <div>Portfolio at retirement: {fmt(p.totalAtRetirement)}</div>
                    <div>Sustainable years: {p.sustainableYears}</div>
                    <div>Portfolio at 80: {p.portfolioAt80 != null ? fmt(p.portfolioAt80) : "Exhausted"}</div>
                    <div>Portfolio at 90: {p.portfolioAt90 != null ? fmt(p.portfolioAt90) : "Exhausted"}</div>
                    <div>Lifetime tax: {fmt(p.years.reduce((s, y) => s + y.taxPaid, 0))}</div>
                    <div>Total drawn from portfolio: {fmt(p.years.reduce((s, y) => s + y.portfolioDraw, 0))}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={S.card}>
            <div style={S.sec}>Portfolio Value Projection · All Scenarios</div>
            <PortfolioChart />
          </div>

          {/* What-if: different target incomes */}
          <div style={S.card}>
            <div style={S.sec}>Sensitivity · How Income Target Affects Sustainability</div>
            <div style={{ fontSize: 11, color: "#6a7d8f", marginBottom: 12 }}>
              Central scenario shown. Adjust your target income in the Assumptions tab to model alternatives.
            </div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.thR}>Net Target</th>
                  <th style={S.thR}>Year 1 Draw</th>
                  <th style={S.thR}>Year 1 Tax</th>
                  <th style={S.th}>Bear</th>
                  <th style={S.th}>Central</th>
                  <th style={S.th}>Bull</th>
                </tr>
              </thead>
              <tbody>
                {[40000, 50000, 60000, 70000, 80000].map(target => {
                  const gross = Math.round(target * 1.15); // rough
                  const tax = Math.round(target * 0.15);
                  const isCurrent = target === cfg.targetNetIncome;
                  return (
                    <tr key={target} style={isCurrent ? { background: "#1e3040" } : {}}>
                      <td style={{ ...S.tdR, color: isCurrent ? "#c9a84c" : "#e8dcc8", fontWeight: isCurrent ? 600 : 400 }}>{fmt(target)}</td>
                      <td style={{ ...S.tdR, color: "#6a7d8f" }}>~{fmt(gross)}</td>
                      <td style={{ ...S.tdR, color: "#e07060" }}>~{fmt(tax)}</td>
                      <td style={{ ...S.td, color: "#e07060" }}>—</td>
                      <td style={{ ...S.td, color: "#c9a84c" }}>{isCurrent ? (projCentral.exhaustionAge ? `Age ${projCentral.exhaustionAge}` : `${cfg.planToAge}+`) : "—"}</td>
                      <td style={{ ...S.td, color: "#70AD47" }}>—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "#4a6070", marginTop: 8 }}>Note: Full sensitivity analysis across all targets coming in a future update. Only your current target ({fmt(cfg.targetNetIncome)}) is fully modelled.</div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          IHT (INHERITANCE TAX) TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "iht" && (() => {
        const ihtData = ihtProjection[scenario];
        const ihtCentral = ihtProjection.central;
        const ihtBear = ihtProjection.bear;
        const ihtBull = ihtProjection.bull;
        if (!ihtData || !ihtData.years.length) return null;

        const currentYear = ihtData.years[0];
        const peakIht = ihtData.peakIht;

        // ── Estate Composition Chart ──
        const EstateChart = () => {
          const yrs = ihtData.years;
          const allVals = yrs.map(y => y.grossEstate);
          const maxV = Math.max(...allVals, 1);
          const W = 800, H = 260, P = { t: 15, r: 15, b: 35, l: 75 };
          const toX = i => P.l + (i / (yrs.length - 1)) * (W - P.l - P.r);
          const toY = v => P.t + (1 - v / maxV) * (H - P.t - P.b);
          const ticks = [0, Math.round(maxV / 4), Math.round(maxV / 2), Math.round(maxV * 3 / 4), maxV];
          const fmtAxis = v => v >= 1000000 ? (v / 1000000).toFixed(1) + "m" : (v / 1000).toFixed(0) + "k";

          // Area paths
          const housePath = yrs.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.houseValue)}`).join(" ")
            + ` L${toX(yrs.length - 1)},${toY(0)} L${toX(0)},${toY(0)} Z`;
          const portfolioTopPath = yrs.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.houseValue + y.portfolioValue)}`).join(" ");
          const grossPath = yrs.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.grossEstate)}`).join(" ");
          const netPath = yrs.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.netEstate)}`).join(" ");
          const allowancePath = yrs.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.totalAllowance)}`).join(" ");

          // Find the index where SIPPs enter the estate (first year >= 2027)
          const sipp2027Idx = yrs.findIndex(y => y.sippsInEstate);

          return (
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
              {/* Grid */}
              {ticks.map((v, i) => (
                <g key={i}>
                  <line x1={P.l} y1={toY(v)} x2={W - P.r} y2={toY(v)} stroke="#1e2f3e" strokeDasharray="3,3" />
                  <text x={P.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#4a6070">{fmtAxis(v)}</text>
                </g>
              ))}
              {/* House area (bottom) */}
              <path d={housePath} fill="#4472C4" fillOpacity="0.15" />
              {/* Net estate line */}
              <path d={netPath} fill="none" stroke="#c9a84c" strokeWidth="2" />
              {/* Gross estate line */}
              <path d={grossPath} fill="none" stroke="#e8dcc8" strokeWidth="1" strokeDasharray="4,4" strokeOpacity="0.4" />
              {/* Allowance threshold line */}
              <path d={allowancePath} fill="none" stroke="#70AD47" strokeWidth="1.5" strokeDasharray="6,3" strokeOpacity="0.7" />
              {/* 2027 SIPP rule transition marker */}
              {sipp2027Idx >= 0 && (
                <g>
                  <line x1={toX(sipp2027Idx)} y1={P.t} x2={toX(sipp2027Idx)} y2={H - P.b} stroke="#e07060" strokeWidth="1.5" strokeDasharray="5,3" strokeOpacity="0.8" />
                  <text x={toX(sipp2027Idx) + 4} y={P.t + 12} fontSize="8" fill="#e07060">SIPPs in estate</text>
                  <text x={toX(sipp2027Idx) + 4} y={P.t + 22} fontSize="8" fill="#e07060">(Apr 2027)</text>
                </g>
              )}
              {/* X labels */}
              {yrs.map((y, i) => {
                const step = Math.max(1, Math.floor(yrs.length / 14));
                return (i % step === 0 || i === yrs.length - 1) ? (
                  <text key={i} x={toX(i)} y={H - P.b + 14} textAnchor="middle" fontSize="8" fill="#4a6070">
                    {y.year} ({y.johnAge})
                  </text>
                ) : null;
              })}
              {/* Legend */}
              <line x1={P.l} y1={H - 5} x2={P.l + 20} y2={H - 5} stroke="#c9a84c" strokeWidth="2" />
              <text x={P.l + 24} y={H - 2} fontSize="9" fill="#c9a84c">Net Estate</text>
              <line x1={P.l + 110} y1={H - 5} x2={P.l + 130} y2={H - 5} stroke="#70AD47" strokeWidth="1.5" strokeDasharray="6,3" />
              <text x={P.l + 134} y={H - 2} fontSize="9" fill="#70AD47">IHT Threshold</text>
              <rect x={P.l + 240} y={H - 10} width={12} height={8} fill="#4472C4" fillOpacity="0.3" />
              <text x={P.l + 256} y={H - 2} fontSize="9" fill="#4472C4">House Value</text>
              <line x1={P.l + 340} y1={H - 5} x2={P.l + 360} y2={H - 5} stroke="#e07060" strokeWidth="1.5" strokeDasharray="5,3" />
              <text x={P.l + 364} y={H - 2} fontSize="9" fill="#e07060">SIPPs join estate (2027)</text>
            </svg>
          );
        };

        // ── IHT Liability Chart (3 scenarios) ──
        const IhtChart = () => {
          const allScenarios = [
            { key: "bull", label: "Bull", color: "#70AD47", data: ihtBull.years },
            { key: "central", label: "Central", color: "#c9a84c", data: ihtCentral.years },
            { key: "bear", label: "Bear", color: "#e07060", data: ihtBear.years },
          ];
          const maxLen = Math.max(...allScenarios.map(s => s.data.length));
          const allVals = allScenarios.flatMap(s => s.data.map(y => y.ihtDue));
          const maxV = Math.max(...allVals, 1);
          const W = 800, H = 200, P = { t: 15, r: 15, b: 35, l: 75 };
          const toX = i => P.l + (i / (maxLen - 1)) * (W - P.l - P.r);
          const toY = v => P.t + (1 - v / maxV) * (H - P.t - P.b);
          const ticks = [0, Math.round(maxV / 4), Math.round(maxV / 2), Math.round(maxV * 3 / 4), maxV];
          const fmtAxis = v => v >= 1000000 ? (v / 1000000).toFixed(1) + "m" : (v / 1000).toFixed(0) + "k";

          const sipp2027IdxIht = ihtCentral.years.findIndex(y => y.sippsInEstate);

          return (
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
              {ticks.map((v, i) => (
                <g key={i}>
                  <line x1={P.l} y1={toY(v)} x2={W - P.r} y2={toY(v)} stroke="#1e2f3e" strokeDasharray="3,3" />
                  <text x={P.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#4a6070">{fmtAxis(v)}</text>
                </g>
              ))}
              {allScenarios.map(sc => {
                const pathD = sc.data.map((y, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(y.ihtDue)}`).join(" ");
                return (
                  <path key={sc.key} d={pathD} fill="none" stroke={sc.color} strokeWidth={sc.key === scenario ? 2.5 : 1} strokeOpacity={sc.key === scenario ? 1 : 0.4} />
                );
              })}
              {/* 2027 SIPP rule marker */}
              {sipp2027IdxIht >= 0 && (
                <line x1={toX(sipp2027IdxIht)} y1={P.t} x2={toX(sipp2027IdxIht)} y2={H - P.b} stroke="#e07060" strokeWidth="1.5" strokeDasharray="5,3" strokeOpacity="0.7" />
              )}
              {ihtCentral.years.map((y, i) => {
                const step = Math.max(1, Math.floor(maxLen / 14));
                return (i % step === 0 || i === maxLen - 1) ? (
                  <text key={i} x={toX(i)} y={H - P.b + 14} textAnchor="middle" fontSize="8" fill="#4a6070">
                    {y.year} ({y.johnAge})
                  </text>
                ) : null;
              })}
              {allScenarios.map((sc, i) => (
                <g key={sc.key}>
                  <line x1={P.l + i * 100} y1={H - 5} x2={P.l + i * 100 + 20} y2={H - 5} stroke={sc.color} strokeWidth="2" />
                  <text x={P.l + i * 100 + 24} y={H - 2} fontSize="9" fill={sc.color}>{sc.label}</text>
                </g>
              ))}
            </svg>
          );
        };

        return (
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sec}>Inheritance Tax Liability · Estate Projection</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["bear", "central", "bull"].map(s => (
                <button key={s} style={S.rBtn(scenario === s)} onClick={() => setScenario(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* IHT Headline */}
          <div style={{ ...S.card, borderColor: (ihtCentral.peakIht?.ihtDue || 0) > 0 ? "#e0706044" : "#70AD4744" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={S.sLbl}>Estimated IHT Liability · Second Death (Spouse Allowances Combined)</div>
                <div style={{ fontSize: 22, color: "#e07060", fontWeight: 600, marginTop: 4 }}>
                  {ihtCentral.peakIht ? `Peak liability: ${fmt(ihtCentral.peakIht.ihtDue)} at age ${ihtCentral.peakIht.johnAge}` : "No IHT liability"}
                </div>
                <div style={{ fontSize: 12, color: "#6a7d8f", marginTop: 6 }}>
                  Estate includes portfolio + property ({fmt(cfg.houseValue)} today, {pct(cfg.houseGrowthRate)} growth) · Mortgage {fmt(cfg.mortgageNow)} clearing at {cfg.mortgageClearAgeIHT} · Combined allowance up to {fmt((cfg.ihtNrb + cfg.ihtRnrb) * 2)}
                </div>
                <div style={{ fontSize: 11, color: "#e07060", marginTop: 8, padding: "6px 10px", background: "#e0706012", border: "1px solid #e0706030", borderRadius: 3 }}>
                  ⚠ SIPP legislation change (Budget 2024): From 6 April 2027, defined contribution pension pots will form part of the taxable estate. Projections reflect this — SIPPs are excluded from the estate before 2027 and included from 2027 onwards.
                </div>
              </div>
            </div>
          </div>

          {/* Key IHT Figures */}
          <div style={S.g5}>
            <div style={S.sBox}>
              <div style={S.sLbl}>Estate Today</div>
              <div style={{ fontSize: 20, color: "#c9a84c" }}>{fmt(currentYear.netEstate)}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>After mortgage</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>IHT Today</div>
              <div style={{ fontSize: 20, color: currentYear.ihtDue > 0 ? "#e07060" : "#70AD47" }}>{fmt(currentYear.ihtDue)}</div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>{currentYear.ihtDue > 0 ? `${pct(currentYear.ihtDue / currentYear.netEstate)} of estate` : "Below threshold"}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>IHT at Retirement</div>
              <div style={{ fontSize: 20, color: (ihtData.ihtAtRetire?.ihtDue || 0) > 0 ? "#e07060" : "#70AD47" }}>
                {ihtData.ihtAtRetire ? fmt(ihtData.ihtAtRetire.ihtDue) : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>Age {cfg.retireYear - parseInt(cfg.johnDOB.split("-")[0])}</div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>IHT at 80</div>
              <div style={{ fontSize: 20, color: (ihtData.ihtAt80?.ihtDue || 0) > 0 ? "#e07060" : "#70AD47" }}>
                {ihtData.ihtAt80 ? fmt(ihtData.ihtAt80.ihtDue) : "—"}
              </div>
            </div>
            <div style={S.sBox}>
              <div style={S.sLbl}>Effective IHT Rate</div>
              <div style={{ fontSize: 20, color: "#e07060" }}>
                {peakIht && peakIht.netEstate > 0 ? pct(peakIht.ihtDue / peakIht.netEstate) : "0%"}
              </div>
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: 2 }}>At peak liability</div>
            </div>
          </div>

          {/* Estate Composition Chart */}
          <div style={S.card}>
            <div style={S.sec}>Estate Value Over Time · {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</div>
            <EstateChart />
          </div>

          {/* IHT Liability Chart */}
          <div style={S.card}>
            <div style={S.sec}>IHT Liability · Three Scenarios</div>
            <IhtChart />
          </div>

          {/* Allowance Breakdown */}
          <div style={S.card}>
            <div style={S.sec}>IHT Allowances (Second Death — Combined Couple)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              <div>
                <table style={S.tbl}>
                  <thead>
                    <tr>
                      <th style={S.th}>Allowance</th>
                      <th style={S.thR}>Per Person</th>
                      <th style={S.thR}>Combined</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={S.td}>Nil-Rate Band (NRB)</td>
                      <td style={S.tdR}>{fmt(cfg.ihtNrb)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(cfg.ihtNrb * 2)}</td>
                    </tr>
                    <tr>
                      <td style={S.td}>Residence Nil-Rate Band (RNRB)</td>
                      <td style={S.tdR}>{fmt(cfg.ihtRnrb)}</td>
                      <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(cfg.ihtRnrb * 2)}</td>
                    </tr>
                    <tr style={{ background: "#1e304033" }}>
                      <td style={{ ...S.td, fontWeight: 600 }}>Total Threshold</td>
                      <td style={S.tdR}>—</td>
                      <td style={{ ...S.tdR, fontWeight: 600, color: "#70AD47" }}>{fmt((cfg.ihtNrb + cfg.ihtRnrb) * 2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "#6a7d8f", lineHeight: 1.8, padding: "8px 0" }}>
                <div><span style={{ color: "#e8dcc8" }}>Spouse exemption:</span> On first death, everything passes to surviving spouse tax-free. Unused NRB and RNRB transfer to survivor.</div>
                <div><span style={{ color: "#e8dcc8" }}>RNRB condition:</span> Main residence must be passed to direct descendants (children, grandchildren).</div>
                <div><span style={{ color: "#e8dcc8" }}>RNRB taper:</span> Reduces by £1 for every £2 of estate above {fmt(cfg.ihtRnrbTaperStart)}. Fully lost at {fmt(cfg.ihtRnrbTaperStart + (cfg.ihtRnrb * 2) * 2)}.</div>
                <div><span style={{ color: "#e8dcc8" }}>IHT rate:</span> {(cfg.ihtRate * 100).toFixed(0)}% on everything above the combined threshold.</div>
              </div>
            </div>
          </div>

          {/* Scenario Comparison */}
          <div style={S.g3}>
            {[
              { key: "bear", label: "Bear", color: "#e07060" },
              { key: "central", label: "Central", color: "#c9a84c" },
              { key: "bull", label: "Bull", color: "#70AD47" },
            ].map(sc => {
              const d = ihtProjection[sc.key];
              return (
                <div key={sc.key} style={{ ...S.sBox, borderColor: sc.color + "44", cursor: "pointer" }} onClick={() => setScenario(sc.key)}>
                  <div style={{ ...S.sLbl, color: sc.color }}>{sc.label} Scenario</div>
                  <div style={{ fontSize: 11, color: "#6a7d8f", lineHeight: 1.8, marginTop: 6 }}>
                    <div>Peak IHT: <span style={{ color: "#e07060", fontWeight: 600 }}>{d.peakIht ? fmt(d.peakIht.ihtDue) : "—"}</span> {d.peakIht ? `(age ${d.peakIht.johnAge})` : ""}</div>
                    <div>IHT at 75: <span style={{ color: "#e8dcc8" }}>{d.ihtAt75 ? fmt(d.ihtAt75.ihtDue) : "—"}</span></div>
                    <div>IHT at 80: <span style={{ color: "#e8dcc8" }}>{d.ihtAt80 ? fmt(d.ihtAt80.ihtDue) : "—"}</span></div>
                    <div>IHT at 90: <span style={{ color: "#e8dcc8" }}>{d.ihtAt90 ? fmt(d.ihtAt90.ihtDue) : "—"}</span></div>
                    <div>Net to heirs at 90: <span style={{ color: "#70AD47" }}>{d.ihtAt90 ? fmt(d.ihtAt90.netAfterIht) : "—"}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Year-by-Year Table */}
          <div style={{ ...S.card, overflow: "auto" }}>
            <div style={S.sec}>Year-by-Year Estate & IHT · {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Year</th>
                  <th style={S.th}>Age</th>
                  <th style={S.thR}>Portfolio (estate)</th>
                  <th style={S.thR}>SIPP (excl. pre-2027)</th>
                  <th style={S.thR}>House Value</th>
                  <th style={S.thR}>Mortgage</th>
                  <th style={S.thR}>Net Estate</th>
                  <th style={S.thR}>Allowance</th>
                  <th style={S.thR}>Taxable</th>
                  <th style={S.thR}>IHT Due</th>
                  <th style={S.thR}>Net to Heirs</th>
                </tr>
              </thead>
              <tbody>
                {ihtData.years.map(y => (
                  <tr key={y.year}
                    style={y.johnAge === peakIht?.johnAge ? { background: "#3d1e1e44" } : y.year === 2027 ? { background: "#e0706010", borderTop: "1px solid #e0706040" } : {}}
                    onMouseEnter={e => e.currentTarget.style.background = "#1e3040"}
                    onMouseLeave={e => e.currentTarget.style.background = y.johnAge === peakIht?.johnAge ? "#3d1e1e44" : y.year === 2027 ? "#e0706010" : ""}
                  >
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      {y.year}
                      {y.year === 2027 && <span style={{ fontSize: 9, color: "#e07060", marginLeft: 4 }}>▲SIPP</span>}
                    </td>
                    <td style={S.td}>{y.johnAge}</td>
                    <td style={S.tdR}>
                      {fmt(y.portfolioValue)}
                      <div style={{ fontSize: 9, color: "#6a7d8f" }}>{y.sippsInEstate ? "ISA+SIPP" : "ISA only"}</div>
                    </td>
                    <td style={{ ...S.tdR, color: y.sippsInEstate ? "#e8dcc8" : "#3a5070" }}>
                      {y.sippsInEstate ? fmt(y.sippValue) : <span style={{ color: "#3a5070" }}>excl. {fmt(y.sippValue)}</span>}
                    </td>
                    <td style={{ ...S.tdR, color: "#4472C4" }}>{fmt(y.houseValue)}</td>
                    <td style={{ ...S.tdR, color: y.mortgage > 0 ? "#e07060" : "#70AD47" }}>{y.mortgage > 0 ? `-${fmt(y.mortgage)}` : "—"}</td>
                    <td style={{ ...S.tdR, fontWeight: 600 }}>{fmt(y.netEstate)}</td>
                    <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(y.totalAllowance)}</td>
                    <td style={{ ...S.tdR, color: y.taxableEstate > 0 ? "#e07060" : "#6a7d8f" }}>{y.taxableEstate > 0 ? fmt(y.taxableEstate) : "—"}</td>
                    <td style={{ ...S.tdR, color: y.ihtDue > 0 ? "#e07060" : "#70AD47", fontWeight: 600 }}>{y.ihtDue > 0 ? fmt(y.ihtDue) : fmt(0)}</td>
                    <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(y.netAfterIht)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════
          ASSUMPTIONS (CONFIG) TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeSection === "config" && (
        <div style={S.body}>
          {/* Sticky submit bar */}
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: dirty ? "#1a2a18" : "#121e2b", border: `1px solid ${dirty ? "#70AD4766" : "#1e2f3e"}`, borderRadius: 4, padding: "12px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s" }}>
            <div>
              <div style={S.sec}>Assumptions & Configuration</div>
              <div style={{ fontSize: 11, color: dirty ? "#c9a84c" : "#6a7d8f" }}>
                {dirty ? "You have unsaved changes — click Submit to recalculate projections" : "All projections are up to date. Portfolio values pulled live from the tracker."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {dirty && <button onClick={resetDraft} style={{ padding: "8px 18px", fontSize: 11, letterSpacing: "0.1em", border: "1px solid #2a3d50", background: "transparent", color: "#6a7d8f", cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }}>DISCARD</button>}
              <button onClick={submitChanges} disabled={!dirty} style={{ padding: "8px 24px", fontSize: 11, letterSpacing: "0.1em", fontWeight: 600, border: dirty ? "1px solid #70AD47" : "1px solid #2a3d50", background: dirty ? "#70AD4722" : "transparent", color: dirty ? "#70AD47" : "#3a4d60", cursor: dirty ? "pointer" : "default", borderRadius: 3, fontFamily: "inherit", transition: "all 0.2s" }}>SUBMIT CHANGES</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {/* People */}
            <div style={S.card}>
              <div style={{ ...S.sec, marginBottom: 16 }}>People & Dates</div>
              <NumInput label="Retire Year" value={draft.retireYear} field="retireYear" />
              <NumInput label="Plan To Age" value={draft.planToAge} field="planToAge" />
              <NumInput label="John State Pension Age" value={draft.johnSpAge} field="johnSpAge" />
              <NumInput label="Elaine State Pension Age" value={draft.elaineSpAge} field="elaineSpAge" />
            </div>

            {/* Portfolio */}
            <div style={S.card}>
              <div style={{ ...S.sec, marginBottom: 16 }}>Portfolio Values {livePortfolio && <span style={{ color: "#70AD47", fontSize: 9, marginLeft: 6 }}>● LIVE</span>}</div>
              <NumInput label="John SIPP" value={draft.johnSipp} field="johnSipp" prefix="£" />
              <NumInput label="Elaine SIPP" value={draft.elaineSipp} field="elaineSipp" prefix="£" />
              <NumInput label="John ISA" value={draft.johnIsa} field="johnIsa" prefix="£" />
              <NumInput label="Elaine ISA" value={draft.elaineIsa} field="elaineIsa" prefix="£" />
              <NumInput label="LSEG Pension" value={draft.lsegPension} field="lsegPension" prefix="£" />
              <NumInput label="Monthly Contributions" value={draft.monthlyContrib} field="monthlyContrib" prefix="£" suffix="/mo" />
            </div>

            {/* Income */}
            <div style={S.card}>
              <div style={{ ...S.sec, marginBottom: 16 }}>Income & Mortgage</div>
              <NumInput label="Target Net Income (post-mortgage, annual)" value={draft.targetNetIncome} field="targetNetIncome" prefix="£" suffix="/yr" />
              <NumInput label="State Pension (each)" value={draft.statePension} field="statePension" prefix="£" suffix="/yr" />
              <NumInput label="Mortgage Balance at Retirement" value={draft.mortgageBalance} field="mortgageBalance" prefix="£" />
              <NumInput label="Mortgage Monthly Payment" value={Math.round(draft.mortgageAnnualCost / 12)} field="_mortgageMonthly" prefix="£" suffix="/mo" />
              <div style={{ fontSize: 10, color: "#4a6070", marginTop: -8, marginBottom: 12 }}>= {fmt(draft.mortgageAnnualCost)} p.a. — added on top of target until age {draft.mortgageClearAge}</div>
              <NumInput label="Clear Mortgage at John Age" value={draft.mortgageClearAge} field="mortgageClearAge" />
              <NumInput label="Elaine Part-Time Income" value={draft.elainePartTime} field="elainePartTime" prefix="£" suffix="/yr (to 2031)" />
            </div>
          </div>

          {/* Income Step-Downs */}
          <div style={S.card}>
            <div style={{ ...S.sec, marginBottom: 16 }}>Later-Life Income Step-Downs</div>
            <div style={{ fontSize: 11, color: "#6a7d8f", marginBottom: 14 }}>As activity decreases in later life, spending typically reduces. Adjust the age thresholds and reduction percentages below.</div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>From John's Age</th>
                  <th style={S.thR}>Reduction</th>
                  <th style={S.thR}>Target Income</th>
                  <th style={S.th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "#1e304033" }}>
                  <td style={S.td}>63 (retire) – 67</td>
                  <td style={S.tdR}>—</td>
                  <td style={{ ...S.tdR, color: "#c9a84c" }}>{fmt(draft.targetNetIncome + draft.mortgageAnnualCost)}</td>
                  <td style={{ ...S.td, color: "#6a7d8f", fontSize: 10 }}>Base {fmt(draft.targetNetIncome)} + mortgage {fmt(draft.mortgageAnnualCost)}</td>
                </tr>
                <tr style={{ background: "#1e304033" }}>
                  <td style={S.td}>67 (mortgage cleared) – 74</td>
                  <td style={S.tdR}>—</td>
                  <td style={{ ...S.tdR, color: "#70AD47" }}>{fmt(draft.targetNetIncome)}</td>
                  <td style={{ ...S.td, color: "#6a7d8f", fontSize: 10 }}>Base target, no mortgage</td>
                </tr>
                {(draft.incomeSteps || []).map((step, i) => (
                  <tr key={i}>
                    <td style={S.td}>
                      <input type="number" style={{ ...S.input, width: 60, textAlign: "center" }} value={step.fromAge}
                        onChange={e => { const v = parseInt(e.target.value); updateDraft(c => ({ ...c, incomeSteps: c.incomeSteps.map((s, j) => j === i ? { ...s, fromAge: isNaN(v) ? s.fromAge : v } : s) })); }} />
                    </td>
                    <td style={S.tdR}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <input type="number" style={{ ...S.input, width: 60 }} value={Math.round(step.reduction * 100)} step={5}
                          onChange={e => { const v = parseInt(e.target.value); updateDraft(c => ({ ...c, incomeSteps: c.incomeSteps.map((s, j) => j === i ? { ...s, reduction: isNaN(v) ? s.reduction : v / 100 } : s) })); }} />
                        <span style={{ color: "#6a7d8f", fontSize: 11 }}>%</span>
                      </div>
                    </td>
                    <td style={{ ...S.tdR, color: "#9E7FC0" }}>{fmt(draft.targetNetIncome * (1 - step.reduction))}</td>
                    <td style={{ ...S.td, color: "#6a7d8f", fontSize: 10 }}>{step.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {/* Growth Scenarios */}
            <div style={S.card}>
              <div style={{ ...S.sec, marginBottom: 16 }}>Growth Scenarios (Real, After Inflation)</div>
              <NumInput label="Bear Case" value={draft.scenarioBear} field="scenarioBear" step={0.005} suffix="(e.g. 0.03 = 3%)" />
              <NumInput label="Central Case" value={draft.scenarioCentral} field="scenarioCentral" step={0.005} suffix="(e.g. 0.05 = 5%)" />
              <NumInput label="Bull Case" value={draft.scenarioBull} field="scenarioBull" step={0.005} suffix="(e.g. 0.07 = 7%)" />
              <NumInput label="Inflation Rate" value={draft.inflationRate} field="inflationRate" step={0.005} suffix="(e.g. 0.025 = 2.5%)" />
            </div>

            {/* DB Pensions */}
            <div style={S.card}>
              <div style={{ ...S.sec, marginBottom: 16 }}>Defined Benefit Pensions</div>
              <table style={S.tbl}>
                <thead>
                  <tr>
                    <th style={S.th}>Owner</th>
                    <th style={S.th}>Scheme</th>
                    <th style={S.thR}>Annual</th>
                    <th style={S.thR}>From Age</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.dbPensions.map((p, i) => (
                    <tr key={i}>
                      <td style={S.td}>{p.owner}</td>
                      <td style={S.td}>{p.name}</td>
                      <td style={S.tdR}>{fmt(p.annual)}</td>
                      <td style={S.tdR}>{p.startAge}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ ...S.td, fontWeight: 600 }}>Total</td>
                    <td style={{ ...S.tdR, fontWeight: 600 }}>{fmt(draft.dbPensions.reduce((s, p) => s + p.annual, 0))}</td>
                    <td style={S.tdR}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* IHT / Estate Planning */}
          <div style={S.card}>
            <div style={{ ...S.sec, marginBottom: 16 }}>IHT / Estate Planning</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <div style={{ ...S.label, marginBottom: 12, fontSize: 11, color: "#e8dcc8" }}>Property</div>
                <NumInput label="House Value (current)" value={draft.houseValue} field="houseValue" prefix="£" />
                <NumInput label="House Growth Rate" value={draft.houseGrowthRate} field="houseGrowthRate" step={0.005} suffix="(e.g. 0.03 = 3%)" />
                <NumInput label="Current Mortgage" value={draft.mortgageNow} field="mortgageNow" prefix="£" />
                <NumInput label="Repayment Portion" value={draft.mortgageRepaymentPortion} field="mortgageRepaymentPortion" prefix="£" />
                <div style={{ fontSize: 10, color: "#4a6070", marginTop: -8 }}>Interest-only: {fmt(draft.mortgageNow - draft.mortgageRepaymentPortion)} — paid off at age {draft.mortgageClearAgeIHT}</div>
              </div>
              <div>
                <div style={{ ...S.label, marginBottom: 12, fontSize: 11, color: "#e8dcc8" }}>IHT Allowances (per person)</div>
                <NumInput label="Nil-Rate Band" value={draft.ihtNrb} field="ihtNrb" prefix="£" />
                <NumInput label="Residence Nil-Rate Band" value={draft.ihtRnrb} field="ihtRnrb" prefix="£" />
                <div style={{ fontSize: 10, color: "#70AD47", marginTop: -4 }}>Combined couple: {fmt((draft.ihtNrb + draft.ihtRnrb) * 2)}</div>
              </div>
              <div>
                <div style={{ ...S.label, marginBottom: 12, fontSize: 11, color: "#e8dcc8" }}>IHT Rates</div>
                <NumInput label="IHT Rate" value={draft.ihtRate} field="ihtRate" step={0.01} suffix="(e.g. 0.40 = 40%)" />
                <NumInput label="RNRB Taper Starts At" value={draft.ihtRnrbTaperStart} field="ihtRnrbTaperStart" prefix="£" />
                <div style={{ fontSize: 10, color: "#4a6070", marginTop: -4 }}>RNRB tapers by £1 per £2 above this. Fully lost at {fmt(draft.ihtRnrbTaperStart + (draft.ihtRnrb * 2) * 2)}</div>
              </div>
            </div>
          </div>

          {/* Tax Rates Reference */}
          <div style={S.card}>
            <div style={{ ...S.sec, marginBottom: 16 }}>UK Tax Rates (2025/26 — Frozen Thresholds)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 11 }}>
              <div><span style={{ color: "#6a7d8f" }}>Personal Allowance</span><br /><span style={{ color: "#70AD47" }}>{fmt(TAX.personalAllowance)} each</span></div>
              <div><span style={{ color: "#6a7d8f" }}>Basic Rate (20%)</span><br />{fmt(TAX.personalAllowance)} – {fmt(TAX.basicLimit)}</div>
              <div><span style={{ color: "#6a7d8f" }}>Higher Rate (40%)</span><br />{fmt(TAX.basicLimit)} – {fmt(TAX.higherLimit)}</div>
              <div><span style={{ color: "#6a7d8f" }}>Additional Rate (45%)</span><br />Over {fmt(TAX.higherLimit)}</div>
            </div>
            <div style={{ fontSize: 10, color: "#4a6070", marginTop: 10 }}>PA tapers by £1 for every £2 earned above {fmt(TAX.paTaper)}</div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "20px 0 40px", fontSize: 10, color: "#2a3d50" }}>
        Daniells Retirement Planner · For personal planning purposes only — not financial advice · <a href="./index.html" style={{ color: "#3a4d60" }}>Back to Portfolio Tracker</a>
      </div>
    </div>
  );
}
