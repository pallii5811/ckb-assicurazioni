"""
Test ISOLATO per i 3 nuovi endpoint:
  - /api/company-news
  - /api/anac-gare
  - /api/tech-stack

Non tocca niente di esistente.
"""
import time
import requests

BASE = "http://localhost:3000"
TIMEOUT = 180

def call(path, payload):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}{path}", json=payload, timeout=TIMEOUT)
        return r.status_code, r.json(), time.time() - t0
    except Exception as e:
        return 0, {"error": str(e)}, time.time() - t0

def show(label, status, data, elapsed):
    print(f"\n{'='*70}")
    print(f"  {label}  —  {status} in {elapsed:.1f}s")
    print(f"{'='*70}")
    if status != 200 or "error" in data:
        print(f"  ❌ ERROR: {data.get('error', data)}")
        return False
    for k, v in data.items():
        if k == "_meta":
            continue
        if isinstance(v, list):
            print(f"  {k} ({len(v)}):")
            for item in v[:5]:
                if isinstance(item, dict):
                    short = {kk: (str(vv)[:60] if vv else None) for kk, vv in item.items() if vv}
                    print(f"    · {short}")
                else:
                    print(f"    · {str(item)[:100]}")
        elif isinstance(v, dict):
            print(f"  {k}: {v}")
        else:
            print(f"  {k}: {str(v)[:150]}")
    return True

results = []

# ── 1) COMPANY NEWS ──
print("\n\n" + "█"*70)
print("  TEST 1: /api/company-news")
print("█"*70)
for rs in ["Ferrari NV", "Simplex Rapid srl", "Generali Italia"]:
    print(f"\n>>> COMPANY-NEWS: {rs}")
    s, d, t = call("/api/company-news", {"ragione_sociale": rs, "anni_lookback": 2})
    ok = show(f"NEWS: {rs}", s, d, t)
    results.append((f"news:{rs}", ok))
    time.sleep(5)

# ── 2) ANAC GARE ──
print("\n\n" + "█"*70)
print("  TEST 2: /api/anac-gare")
print("█"*70)
gare_tests = [
    {"ragione_sociale": "Webuild spa"},
    {"ragione_sociale": "Salini Impregilo"},
    {"ragione_sociale": "Simplex Rapid srl", "partita_iva": "00700220155"},
]
for payload in gare_tests:
    label = payload.get("ragione_sociale")
    print(f"\n>>> ANAC-GARE: {label}")
    s, d, t = call("/api/anac-gare", payload)
    ok = show(f"ANAC: {label}", s, d, t)
    results.append((f"anac:{label}", ok))
    time.sleep(5)

# ── 3) TECH STACK ──
print("\n\n" + "█"*70)
print("  TEST 3: /api/tech-stack")
print("█"*70)
siti = [
    "https://www.simplexrapid.it",
    "https://www.simmm.com",
    "https://www.ferramentavanoli.com",
    "https://www.generali.it",
]
for sito in siti:
    print(f"\n>>> TECH-STACK: {sito}")
    s, d, t = call("/api/tech-stack", {"sito_web": sito})
    ok = show(f"TECH: {sito}", s, d, t)
    results.append((f"tech:{sito}", ok))
    time.sleep(3)

# Summary
print("\n\n" + "="*70)
print("  RIEPILOGO TEST")
print("="*70)
all_ok = True
for label, ok in results:
    mark = "✓" if ok else "✗"
    if not ok: all_ok = False
    print(f"  {mark} {label}")
print(f"\n{'✅ TUTTO OK' if all_ok else '⚠ ALCUNI FALLITI'}")
