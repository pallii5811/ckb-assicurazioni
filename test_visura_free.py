"""
Test ISOLATO per /api/visura-free
Non tocca nessun altro test. Verifica che l'endpoint nuovo ritorni dati
da fonti gratuite (ufficiocamerale, cerca-pec, inipec) senza rompere nulla.
"""
import json
import time
import requests

BASE = "http://localhost:3000"
TIMEOUT = 120

TESTS = [
    {"ragione_sociale": "SIMPLEX RAPID srl", "partita_iva": "00700220155"},
    {"ragione_sociale": "SIMMM ENGINEERING srl", "partita_iva": "02480860960"},
    {"ragione_sociale": "SIRCA INTERNATIONAL spa", "partita_iva": "07589260152"},
    {"ragione_sociale": "Falegnameria Cecconi", "codice_fiscale": "01208710382"},
]

def call(payload):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/api/visura-free", json=payload, timeout=TIMEOUT)
        elapsed = time.time() - t0
        return r.status_code, r.json(), elapsed
    except Exception as e:
        return 0, {"error": str(e)}, time.time() - t0

def summary(label, status, data, elapsed):
    print(f"\n{'='*60}")
    print(f"  {label}  —  {status} in {elapsed:.1f}s")
    print(f"{'='*60}")
    if status != 200 or "error" in data:
        print(f"  ❌ ERROR: {data.get('error', data)}")
        return False
    if not data.get("found"):
        print(f"  ⚠ NESSUN DATO: {data.get('message', 'vuoto')}")
        return False
    for k in ("ragione_sociale", "forma_giuridica", "capitale_sociale",
             "sede_legale", "stato_attivita", "codice_ateco", "pec"):
        v = data.get(k)
        if v:
            print(f"  {k}: {v}")
    amm = data.get("amministratori") or []
    if amm:
        print(f"  amministratori ({len(amm)}):")
        for a in amm[:5]:
            print(f"    - {a.get('nome', '?')} — {a.get('ruolo', '?')}")
    soci = data.get("soci") or []
    if soci:
        print(f"  soci ({len(soci)}):")
        for s in soci[:5]:
            print(f"    - {s.get('nome', '?')} ({s.get('quota_percentuale', '?')})")
    fonti = data.get("fonti") or []
    if fonti:
        print(f"  fonti: {len(fonti)} url")
    return True

results = []
for t in TESTS:
    label = t.get("ragione_sociale") or t.get("partita_iva")
    print(f"\n>>> {label}")
    status, data, elapsed = call(t)
    ok = summary(label, status, data, elapsed)
    results.append((label, ok))
    print("  (pausa 5s...)")
    time.sleep(5)

print("\n\n" + "="*60)
print("  RIEPILOGO")
print("="*60)
for label, ok in results:
    print(f"  {'✓' if ok else '✗'} {label}")
all_ok = all(ok for _, ok in results)
print(f"\n{'✅ TUTTO OK' if all_ok else '⚠ ALCUNI FALLITI'}")
