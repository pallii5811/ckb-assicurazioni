# Test reale aziende — Browser Console

## Cosa fa

Per ogni P.IVA, simula esattamente quello che faresti tu manualmente:
1. Cerca l'azienda → `/api/company-lookup` (anagrafica + contatti + titolare + social)
2. Espande "Insurance Intelligence" → `/api/insurance/triggers` (hotness + trigger + network + capacità + eventi)
3. Espande "Profilo Assicurativo" → `/api/insurance/premiums` + `workforce` + `cauzioni`

Stampa report pulito + alert su campi mancanti.

## Istruzioni

1. Browser su `http://localhost:3000/dashboard` (loggato)
2. **F12** → tab **Console**
3. Incolla TUTTO lo script qui sotto + **Invio**
4. Aspetta. Per la prima azienda servono ~60-90 secondi.
5. Output finale: `=== FINE TEST ===` + i risultati strutturati.
6. Copia/incolla l'output qui o screenshot.

## Note

- **Default**: testa solo la **prima azienda** (CABRIL SERVICE). Se vuoi tutte e 22, cambia `LIMIT = 1` in `LIMIT = 22` nello script.
- Se una chiamata dura > 120s, viene marcata TIMEOUT.
- Lo script salva tutto in `window.__testResults` così puoi rivederlo dopo.

---

## Script da incollare

```javascript
(async function testAziende() {
  const LIMIT = 1; // ⚙️ CAMBIA QUI: 1 per test rapido, 22 per testare tutte

  const aziende = [
    { piva: '08977760019', nome: 'CABRIL SERVICE S.R.L.' },
    { piva: '06897960016', nome: 'CAD ONE S.R.L.' },
    { piva: '08568990017', nome: 'CADMO INFOR SRL' },
    { piva: '10896240016', nome: 'CAE TECHNOLOGIES S.R.L.' },
    { piva: '05699040019', nome: 'CAFFEMANIA SRL' },
    { piva: '08510300018', nome: 'CAFFÈ DEL BAGAT' },
    { piva: '09491360013', nome: 'CAGNO COSTRUZIONI SRL' },
    { piva: '07599550014', nome: 'CALASSO ANTONIO' },
    { piva: '12432130016', nome: 'CALIBRO ZERO S.R.L.' },
    { piva: '06379580019', nome: 'CALLEGHER SRL' },
    { piva: '05081870015', nome: 'CAMBER VIAGGI S.R.L.' },
    { piva: '12205680015', nome: 'CAMERSON GROUP' },
    { piva: '08813110015', nome: 'CAMINITI' },
    { piva: '07769730016', nome: 'CAMPEOTTO SAS' },
    { piva: '10180990011', nome: 'CANAVESANA MULTISERVICE' },
    { piva: '05111170014', nome: 'CANCIA MARINA' },
    { piva: '08474800011', nome: 'CANNATA GIANLUCA' },
    { piva: '07111940016', nome: 'CANTELLI SCALE SRL' },
    { piva: '04610760011', nome: 'CANTELLO' },
    { piva: '12367550014', nome: 'CANTIERE S.R.L.' },
    { piva: '08708010015', nome: 'CAPRARI ING. DAVIDE' },
  ];

  // Helper fetch con timeout
  async function call(path, body, timeoutMs = 120000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = Date.now();
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const ms = Date.now() - start;
      if (!r.ok) return { ok: false, status: r.status, ms, error: await r.text().catch(() => '') };
      return { ok: true, status: r.status, ms, data: await r.json() };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, ms: Date.now() - start, error: e.name === 'AbortError' ? 'TIMEOUT' : e.message };
    }
  }

  const results = [];
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  TEST ${LIMIT}/${aziende.length} AZIENDE — ${new Date().toLocaleString('it-IT')}  ║`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);

  for (let i = 0; i < Math.min(LIMIT, aziende.length); i++) {
    const a = aziende[i];
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`▶ [${i + 1}/${LIMIT}] ${a.nome}  (P.IVA ${a.piva})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const out = { input: a, anagrafica: null, intelligence: null, premiums: null, workforce: null, cauzioni: null, errors: [] };

    // 1. ANAGRAFICA
    console.log(`📋 1/5 Anagrafica (company-lookup)...`);
    const ana = await call('/api/company-lookup', { query: a.piva }, 90000);
    if (!ana.ok) { console.log(`   ❌ FAIL ${ana.status} (${ana.ms}ms): ${(ana.error || '').slice(0, 100)}`); out.errors.push(`anagrafica:${ana.status}`); }
    else {
      out.anagrafica = ana.data;
      console.log(`   ✅ ${ana.ms}ms`);
      console.log(`   • Ragione: ${ana.data.ragione_sociale || ana.data.nome || '—'}`);
      console.log(`   • ATECO: ${ana.data.codice_ateco || '—'}  (${ana.data.descrizione_ateco || '—'})`);
      console.log(`   • Sede: ${ana.data.sede_legale || '—'}`);
      console.log(`   • Capitale: ${ana.data.capitale_sociale || '—'}`);
      console.log(`   • Costituzione: ${ana.data.data_costituzione || '—'}`);
      console.log(`   • Fatturato: ${ana.data.fatturato || '—'}  (anno ${ana.data.fatturato_anno || '—'})`);
      console.log(`   • Dipendenti: ${ana.data.dipendenti || '—'}`);
      console.log(`   • Stato: ${ana.data.stato_attivita || '—'}`);
      console.log(`   • Forma: ${ana.data.forma_giuridica || '—'}`);
      console.log(`   • PEC: ${ana.data.pec || '—'}`);
      console.log(`   • Email: ${ana.data.email || '—'}`);
      console.log(`   • Tel: ${ana.data.telefono || '—'}`);
      console.log(`   • Sito: ${ana.data.sito_web || ana.data.website || '—'}`);
      console.log(`   • Titolare: ${ana.data.titolare || '—'}`);
      console.log(`   • LinkedIn: ${ana.data.linkedin_url || ana.data.linkedin || '—'}`);
      console.log(`   • Instagram: ${ana.data.instagram_url || ana.data.instagram || '—'}`);
      console.log(`   • Facebook: ${ana.data.facebook_url || ana.data.facebook || '—'}`);
      // Alert su campi mancanti critici
      const critical = ['ragione_sociale', 'codice_ateco', 'sede_legale'];
      const missing = critical.filter(k => !ana.data[k]);
      if (missing.length) console.log(`   ⚠️ MANCANTI critici: ${missing.join(', ')}`);
    }

    // 2. INSURANCE INTELLIGENCE (NUOVO)
    console.log(`\n🔥 2/5 Insurance Intelligence (triggers)...`);
    const tri = await call('/api/insurance/triggers', {
      ragioneSociale: out.anagrafica?.ragione_sociale || a.nome,
      partitaIva: a.piva,
      citta: out.anagrafica?.citta || 'Torino',
      ateco: out.anagrafica?.codice_ateco,
      fatturato: out.anagrafica?.fatturato,
      dipendenti: out.anagrafica?.dipendenti,
      costituzioneAnno: out.anagrafica?.data_costituzione ? parseInt(String(out.anagrafica.data_costituzione).slice(0, 4)) : undefined,
      ruolo: 'titolare',
      titolareNome: out.anagrafica?.titolare,
      hasLinkedinPresence: !!(out.anagrafica?.linkedin_url || out.anagrafica?.linkedin),
    }, 90000);
    if (!tri.ok) { console.log(`   ❌ FAIL ${tri.status} (${tri.ms}ms): ${(tri.error || '').slice(0, 100)}`); out.errors.push(`triggers:${tri.status}`); }
    else {
      out.intelligence = tri.data;
      console.log(`   ✅ ${tri.ms}ms`);
      console.log(`   🔥 HOTNESS: ${tri.data.hotnessLabel} (${tri.data.hotnessScore}/100)`);
      console.log(`   📝 Rationale: ${tri.data.hotnessRationale}`);
      console.log(`   ⚡ Trigger: ${tri.data.triggers.length}`);
      tri.data.triggers.forEach((t, j) => {
        console.log(`      ${j + 1}. [${t.severity.toUpperCase()}] ${t.title}`);
        console.log(`         ${t.description.slice(0, 100)}`);
        console.log(`         💡 ${t.insuranceImplication.slice(0, 100)}`);
      });
      console.log(`   👥 Network LinkedIn: ${tri.data.network.colleghiLinkedin.length} profili`);
      tri.data.network.colleghiLinkedin.slice(0, 3).forEach(c => console.log(`      • ${c.nome}${c.ruolo ? ' — ' + c.ruolo : ''}`));
      console.log(`   📜 Albi probabili: ${tri.data.network.albiProfessionali.length}`);
      tri.data.network.albiProfessionali.forEach(al => console.log(`      • ${al.nome} [${al.severity}]`));
      if (tri.data.spendingCapacity) {
        const sc = tri.data.spendingCapacity;
        console.log(`   💰 Capacità spesa polizze: €${sc.capacitaTotaleAnnualePolizze.min.toLocaleString('it-IT')} - €${sc.capacitaTotaleAnnualePolizze.max.toLocaleString('it-IT')}/anno`);
        console.log(`      Segmento: ${sc.propensioneAssicurativa.segmento} (${sc.propensioneAssicurativa.percentualeSpesaAttesa}% del fatturato)`);
        if (sc.redditoTitolareStimato) console.log(`      Reddito titolare: €${sc.redditoTitolareStimato.min.toLocaleString('it-IT')} - €${sc.redditoTitolareStimato.max.toLocaleString('it-IT')}`);
      }
      console.log(`   📅 Eventi recenti: ${tri.data.recentEvents.length}`);
      tri.data.recentEvents.slice(0, 3).forEach(e => console.log(`      • [${e.date}] ${e.title.slice(0, 80)} (${e.source})`));
      if (tri.data.meta.warnings.length) console.log(`   ⚠️ Warnings: ${tri.data.meta.warnings.join('; ')}`);
    }

    // 3. PREMIUMS
    console.log(`\n💎 3/5 Premiums...`);
    const pr = await call('/api/insurance/premiums', { piva: a.piva, ragioneSociale: out.anagrafica?.ragione_sociale || a.nome, citta: out.anagrafica?.citta || 'Torino' }, 90000);
    if (!pr.ok) { console.log(`   ❌ FAIL ${pr.status} (${pr.ms}ms)`); out.errors.push(`premiums:${pr.status}`); }
    else {
      out.premiums = pr.data;
      console.log(`   ✅ ${pr.ms}ms`);
      console.log(`   • Premio dichiarato: ${pr.data.premiums?.declared ? '€' + pr.data.premiums.declared.value.toLocaleString('it-IT') : '— (non dichiarato in bilancio)'}`);
      console.log(`   • Premio stimato: ${pr.data.premiums?.estimated ? '€' + pr.data.premiums.estimated.min.toLocaleString('it-IT') + '-' + pr.data.premiums.estimated.max.toLocaleString('it-IT') : '—'}`);
      console.log(`   • Saving opp.: ${pr.data.premiums?.savingOpportunity ? '€' + pr.data.premiums.savingOpportunity.min.toLocaleString('it-IT') + '-' + pr.data.premiums.savingOpportunity.max.toLocaleString('it-IT') : '—'}`);
      console.log(`   • Opportunità: ${pr.data.opportunities?.length || 0}`);
      (pr.data.opportunities || []).slice(0, 3).forEach((o, j) => console.log(`      ${j + 1}. ${o.ramo} (priorità ${o.priority})`));
    }

    // 4. WORKFORCE
    console.log(`\n👷 4/5 Workforce...`);
    const wf = await call('/api/insurance/workforce', { piva: a.piva, ragioneSociale: out.anagrafica?.ragione_sociale || a.nome, citta: out.anagrafica?.citta || 'Torino' }, 90000);
    if (!wf.ok) { console.log(`   ❌ FAIL ${wf.status} (${wf.ms}ms)`); out.errors.push(`workforce:${wf.status}`); }
    else {
      out.workforce = wf.data;
      console.log(`   ✅ ${wf.ms}ms`);
      console.log(`   • Dipendenti: ${wf.data.employees?.value || '—'}`);
      console.log(`   • Costo personale: ${wf.data.payroll ? '€' + wf.data.payroll.value.toLocaleString('it-IT') : '—'}`);
      console.log(`   • CCNL: ${(wf.data.probableCCNL || []).map(c => c.code).join(', ') || '—'}`);
      console.log(`   • Welfare opp.: ${wf.data.welfareOpportunities?.length || 0}`);
    }

    // 5. CAUZIONI
    console.log(`\n🏗️ 5/5 Cauzioni ANAC...`);
    const cz = await call('/api/insurance/cauzioni', { piva: a.piva, ragioneSociale: out.anagrafica?.ragione_sociale || a.nome }, 90000);
    if (!cz.ok) { console.log(`   ❌ FAIL ${cz.status} (${cz.ms}ms)`); out.errors.push(`cauzioni:${cz.status}`); }
    else {
      out.cauzioni = cz.data;
      console.log(`   ✅ ${cz.ms}ms`);
      console.log(`   • Vince appalti: ${cz.data.vinceAppaltiPubblici ? '✅' : '❌'}`);
      if (cz.data.summary) {
        console.log(`   • Importo aggiudicato: €${cz.data.summary.importoTotaleAggiudicato.toLocaleString('it-IT')}`);
        console.log(`   • CIG count: ${cz.data.summary.cigCount}`);
      }
    }

    results.push(out);
  }

  // RIEPILOGO
  console.log(`\n\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  === FINE TEST ===                                  ║`);
  console.log(`╚════════════════════════════════════════════════════╝`);
  console.log(`Aziende testate: ${results.length}`);
  console.log(`Errori totali: ${results.reduce((s, r) => s + r.errors.length, 0)}`);
  results.forEach((r, i) => {
    const tag = r.errors.length === 0 ? '✅' : r.errors.length < 3 ? '⚠️' : '❌';
    console.log(`${tag} ${i + 1}. ${r.input.nome} — errori: [${r.errors.join(', ') || 'nessuno'}]`);
  });

  // Salva globale
  window.__testResults = results;
  console.log(`\n💾 Risultati completi salvati in: window.__testResults`);
  console.log(`💡 Per esportarli: copy(JSON.stringify(window.__testResults, null, 2))`);
})();
```

---

## Cosa mi serve per validare

Quando finisce, prendi una di queste:

**Opzione 1 (rapida)**: screenshot della console
**Opzione 2 (completa)**: in console scrivi `copy(JSON.stringify(window.__testResults, null, 2))` → poi incolla qui in chat

Io poi te lo analizzo punto per punto e dico:
- ✅ Cosa è coerente / accurato
- ⚠️ Cosa è parziale / migliorabile
- ❌ Cosa è sbagliato / da fixare
