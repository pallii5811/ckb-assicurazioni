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

# --- TEST CONTATTI: 5 aziende reali, focus su email + telefono ---
companies = [
    "Ferramenta Vanoli Bergamo",       # re-test: mario.rossi@gmail.com dovrebbe sparire
    "Pasticceria Marchesi Milano",     # brand noto, contatti verificabili
    "Idraulica Santini Bologna",
    "Studio Dentistico Bianchi Torino",
    "Carrozzeria Rossi Genova",
]
for c in companies:
    print(f"\n>>> COMPANY: {c}")
    d, s, t = call('/api/company-lookup', {'query': c}, timeout=300)
    # Focus: mostra SOLO i campi contatto
    contatti = {k: d.get(k) for k in ['email','telefono','cellulare','pec','sito','sito_web'] if d.get(k)}
    print(f"  CONTATTI: {contatti}")
    show(f"COMPANY: {c}", d, s, t)
    issues = (check_placeholders(c, d) + extra_checks(d)) if 'error' not in d else []
    results.append((f"Company: {c}", s, t, d, issues))
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
