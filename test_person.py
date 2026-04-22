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

# 1) LEAD-REGISTRY (dettaglio lead - simula click su lead)
print("\n>>> TEST 1: Lead Registry (dettaglio lead)")
d, s, t = call('/api/lead-registry', {
    'lead': {'business_name': 'Pasticceria Marchesi', 'city': 'Milano'},
    '_skipPersonEnrichment': True
}, timeout=120)
show("LEAD-REGISTRY: Pasticceria Marchesi Milano", d, s, t)

# 2) COMPANY-LOOKUP (cerca azienda / P.IVA)
print("\n>>> TEST 2: Company Lookup")
d2, s2, t2 = call('/api/company-lookup', {'query': 'Alessi Lino SRL'})
show("COMPANY-LOOKUP: Alessi Lino SRL", d2, s2, t2)

# 3) PERSON-LOOKUP (cerca referente)
print("\n>>> TEST 3: Person Lookup")
d3, s3, t3 = call('/api/person-lookup', {'query': 'Nicola Del Ben 1micron'}, timeout=360)
show("PERSON-LOOKUP: Nicola Del Ben 1micron", d3, s3, t3)

# Summary
print("\n\n" + "="*60)
print("  RIEPILOGO TEST")
print("="*60)
tests = [
    ("Lead Registry (dettaglio)", s, t, d),
    ("Company Lookup", s2, t2, d2),
    ("Person Lookup", s3, t3, d3),
]
for name, status, elapsed, data in tests:
    ok = status == 200 and 'error' not in data
    titolare = data.get('titolare', data.get('nome_completo', '?'))
    print(f"  {'✓' if ok else '✗'} {name}: {status} in {elapsed:.0f}s — {titolare}")
