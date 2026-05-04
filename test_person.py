import urllib.request, json, time, sys

def call(url, payload, timeout=300):
    start = time.time()
    req = urllib.request.Request(f'http://localhost:3000{url}',
        data=json.dumps(payload).encode(),
        headers={'Content-Type':'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        d = json.loads(r.read().decode())
        elapsed = time.time() - start
        return d, r.status, elapsed
    except Exception as e:
        return {'error': str(e)}, 0, time.time() - start

def show(label, d, status, elapsed):
    print(f"\n{'='*60}")
    print(f"  {label}  —  {status} in {elapsed:.1f}s")
    print(f"{'='*60}")
    if 'error' in d:
        print(f"  ERROR: {d['error'][:200]}")
        return
    for k in sorted(d.keys()):
        v = d.get(k)
        if v and v != [] and str(v).strip():
            print(f"  {k}: {str(v)[:130]}")

results = []
PLACEHOLDER_RX = r'(?i)(esempio|example|sample|placeholder|lorem|ipsum|12345678|nicolas.*hayek|risultati$|via esempio|0123456789|3456789012)'
import re

def check_placeholders(label, data):
    """Check for any remaining placeholder values"""
    issues = []
    for k, v in data.items():
        if isinstance(v, str) and re.search(PLACEHOLDER_RX, v):
            issues.append(f"  ⚠ PLACEHOLDER in '{k}': {v[:80]}")
    return issues

PORTAL_DOMS = ['risultati.it','nomeesatto.it','esattospa.it','reportaziende.it']
FAKE_EMAILS = ['mario.rossi@', 'nome.cognome@', 'test@', 'user@', 'prova@', 'esempio@']
def extra_checks(d):
    issues = []
    sito = d.get('sito', d.get('sito_web', ''))
    if sito and any(p in sito for p in PORTAL_DOMS):
        issues.append(f"  ⚠ PORTAL in sito: {sito}")
    for fk in ['telefono', 'cellulare']:
        tel = str(d.get(fk, ''))
        if '1234567' in tel.replace(' ', '').replace('-', ''):
            issues.append(f"  ⚠ SEQUENTIAL {fk}: {tel}")
    email = d.get('email', '')
    if any(email.lower().startswith(f) for f in FAKE_EMAILS):
        issues.append(f"  ⚠ FAKE EMAIL: {email}")
    return issues

# Dati attesi da PMI Lombarde (nuovo batch screenshot - verifica accuratezza)
EXPECTED = {
    "STIROTECNICA srl": {"tel": "02/92147450", "via": "Via S. Pio X 7", "citta": "Cernusco sul Naviglio", "settore": "Ferri da stiro uso domestico e industriale"},
    "SURFATEK srl": {"tel": "02/94698622", "via": "Via Leopardi 24/26", "citta": "Abbiategrasso", "settore": "Chimica - prodotti industriali"},
    "SPECIAL IND spa": {"tel": "02/6074741", "via": "P.zza Spotorno 3", "citta": "Milano", "settore": "Elettronica industriale"},
    "SPEEDY BLOCK srl": {"tel": "02/90753026", "via": "Via P. Da Volpedo 38", "citta": "Locate di Triulzi", "settore": "Attrezzi di serraggio rapido"},
    "SOTRADE srl": {"tel": "02/6460695", "via": "Via IV Novembre 20/22", "citta": "Novate Milanese", "settore": "Trasporti internazionali"},
    "STAMP spa": {"tel": "02/95350295", "via": "Via Cardinal Pierogrosso 33", "citta": "Pozzuolo Martesana", "settore": "Stampaggio materie plastiche"},
    "SPREAFICO R. srl": {"tel": "02/5471230", "via": "Via Liguria 3/6", "citta": "Peschiera Borromeo", "settore": "Forni industriali"},
    "SUPERGALVANICA srl": {"tel": "02/66306646", "via": "Via A. Gramsci 25", "citta": "Cormano", "settore": "Galvanotecnica"},
}

def verify_vs_expected(name, d):
    """Confronta dati trovati con quelli attesi da PMI Lombarde"""
    exp = None
    for k, v in EXPECTED.items():
        if k.lower() in name.lower() or name.lower() in k.lower():
            exp = v; break
    if not exp: return []
    issues = []
    # Verifica telefono
    tel_found = str(d.get('telefono', ''))
    tel_exp_digits = exp['tel'].replace('/', '').replace(' ', '')
    if tel_found and tel_exp_digits not in tel_found.replace(' ', '').replace('-', '').replace('+39', ''):
        issues.append(f"  📞 TEL MISMATCH: trovato={tel_found} atteso={exp['tel']}")
    elif not tel_found:
        issues.append(f"  📞 TEL MANCANTE (atteso: {exp['tel']})")
    else:
        issues.append(f"  ✅ TEL OK: {tel_found} (atteso: {exp['tel']})")
    # Verifica indirizzo
    addr = str(d.get('indirizzo', d.get('sede_legale', '')))
    via_key = exp['via'].split(' ')[-1].lower()  # ultima parola della via
    if addr and via_key in addr.lower():
        issues.append(f"  ✅ INDIRIZZO OK: contiene '{via_key}'")
    elif addr:
        issues.append(f"  📍 INDIRIZZO DIVERSO: trovato={addr[:60]} atteso contiene '{exp['via']}'")
    else:
        issues.append(f"  📍 INDIRIZZO MANCANTE (atteso: {exp['via']})")
    return issues

# ═══════════════════════════════════════════════════════════
# TEST 1: COMPANY LOOKUP — 6 aziende da PMI Lombarde
# ═══════════════════════════════════════════════════════════
companies = [
    "STIROTECNICA srl Cernusco sul Naviglio",
    "SURFATEK srl Abbiategrasso",
    "SPECIAL IND spa Milano",
    "SPEEDY BLOCK srl Locate di Triulzi",
    "SOTRADE srl Novate Milanese",
    "STAMP spa Pozzuolo Martesana",
]
titolari_trovati = {}
for c in companies:
    print(f"\n>>> COMPANY: {c}")
    d, s, t = call('/api/company-lookup', {'query': c}, timeout=300)
    contatti = {k: d.get(k) for k in ['email','telefono','cellulare','pec','sito','ragione_sociale','titolare','indirizzo','sede_legale'] if d.get(k)}
    print(f"  CONTATTI: {contatti}")
    issues = (check_placeholders(c, d) + extra_checks(d) + verify_vs_expected(c, d)) if 'error' not in d else []
    # Salva titolare per test referente
    if d.get('titolare'):
        titolari_trovati[c] = d['titolare']
    results.append((f"Company: {c}", s, t, d, issues))
    print("  (pausa 8s...)")
    time.sleep(8)

# ═══════════════════════════════════════════════════════════
# TEST 2: LEAD-REGISTRY (dettaglio lead) — 3 delle stesse aziende
# ═══════════════════════════════════════════════════════════
leads = [
    {'business_name': 'STIROTECNICA srl', 'city': 'Cernusco sul Naviglio'},
    {'business_name': 'SPEEDY BLOCK srl', 'city': 'Locate di Triulzi'},
    {'business_name': 'STAMP spa', 'city': 'Pozzuolo Martesana'},
]
for l in leads:
    label = f"{l['business_name']} {l['city']}"
    print(f"\n>>> LEAD: {label}")
    d, s, t = call('/api/lead-registry', {'lead': l, '_skipPersonEnrichment': True}, timeout=180)
    contatti = {k: d.get(k) for k in ['email','telefono','cellulare','pec','sito_web','ragione_sociale','titolare','sede_legale'] if d.get(k)}
    print(f"  CONTATTI: {contatti}")
    issues = (check_placeholders(label, d) + extra_checks(d) + verify_vs_expected(label, d)) if 'error' not in d else []
    results.append((f"Lead: {label}", s, t, d, issues))
    print("  (pausa 8s...)")
    time.sleep(8)

# ═══════════════════════════════════════════════════════════
# TEST 3: PERSON LOOKUP (referenti) — titolari trovati
# ═══════════════════════════════════════════════════════════
# Prendi max 2 titolari dal test company per cercare come referenti
person_tests = []
for comp, tit in list(titolari_trovati.items())[:2]:
    person_tests.append(f"{tit} {comp.split(' ')[0]}")  # es. "Mario Rossi SOITRA"
# Aggiungi anche un referente inventato da PMI Lombarde
person_tests.append("Elena Bodini Studio Bodini sas Vittuone")
for p in person_tests:
    print(f"\n>>> REFERENTE: {p}")
    d, s, t = call('/api/person-lookup', {'query': p}, timeout=360)
    contatti = {k: d.get(k) for k in ['email','telefono','cellulare','linkedin','instagram','facebook','azienda','ruolo'] if d.get(k)}
    print(f"  CONTATTI: {contatti}")
    issues = (check_placeholders(p, d) + extra_checks(d)) if 'error' not in d else []
    results.append((f"Referente: {p}", s, t, d, issues))
    print("  (pausa 8s...)")
    time.sleep(8)

# Summary
print("\n\n" + "="*60)
print("  RIEPILOGO TEST")
print("="*60)
all_ok = True
for name, status, elapsed, data, issues in results:
    ok = status == 200 and 'error' not in data
    if not ok: all_ok = False
    who = data.get('titolare', data.get('nome_completo', data.get('ragione_sociale', '?')))
    piva = data.get('partita_iva', '')
    print(f"  {'✓' if ok else '✗'} {name}: {status} in {elapsed:.0f}s — {who} (P.IVA: {piva or 'N/A'})")
    for iss in issues:
        all_ok = False
        print(iss)
print(f"\n  {'✅ TUTTI I TEST OK' if all_ok else '❌ CI SONO PROBLEMI'}")
