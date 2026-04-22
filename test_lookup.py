import urllib.request, json, time

start = time.time()
req = urllib.request.Request('http://localhost:3000/api/company-lookup',
    data=json.dumps({'query':'ALESSI LINO SRL'}).encode(),
    headers={'Content-Type':'application/json'})
try:
    r = urllib.request.urlopen(req, timeout=240)
    d = json.loads(r.read().decode())
    elapsed = time.time() - start
    print(f"STATUS: {r.status} in {elapsed:.1f}s")
    print()
    print("=== AZIENDA ===")
    for k in ['ragione_sociale','partita_iva','sito','telefono','cellulare','email','pec','fatturato','dipendenti','sede_legale','codice_ateco','forma_giuridica','indirizzo','citta','categoria','rating']:
        v = d.get(k)
        if v: print(f"  {k}: {str(v)[:120]}")
    print()
    print("=== TITOLARE COMPLETO ===")
    for k in sorted(d.keys()):
        if 'titolare' in k or k.startswith('trigger_') or k in ['colleghi_titolare']:
            v = d.get(k)
            if v: print(f"  {k}: {str(v)[:120]}")
    print()
    print("=== SOCIAL AZIENDA ===")
    for k in ['linkedin','instagram','facebook','twitter','youtube']:
        v = d.get(k)
        if v: print(f"  {k}: {str(v)[:120]}")
    print()
    print("=== PERSONE ===")
    persone = d.get('persone', [])
    if persone:
        for p in persone[:5]:
            print(f"  {p.get('nome','')} — {p.get('ruolo','')}")
    print()
    print(f"fonti: {d.get('fonti')}")
except urllib.error.HTTPError as e:
    elapsed = time.time() - start
    print(f"HTTP {e.code} in {elapsed:.1f}s: {e.read().decode()[:300]}")
except Exception as ex:
    elapsed = time.time() - start
    print(f"ERR {type(ex).__name__} in {elapsed:.1f}s: {ex}")
