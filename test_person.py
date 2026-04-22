import urllib.request, json, time

start = time.time()
req = urllib.request.Request('http://localhost:3000/api/person-lookup',
    data=json.dumps({'query':'Marco Alessi Alessi Lino SRL'}).encode(),
    headers={'Content-Type':'application/json'})
try:
    r = urllib.request.urlopen(req, timeout=300)
    d = json.loads(r.read().decode())
    elapsed = time.time() - start
    print(f"STATUS: {r.status} in {elapsed:.1f}s")
    print()
    print("=== PERSONA ===")
    for k in sorted(d.keys()):
        v = d.get(k)
        if v and v != [] and str(v).strip():
            val = str(v)[:150]
            print(f"  {k}: {val}")
except urllib.error.HTTPError as e:
    elapsed = time.time() - start
    print(f"HTTP {e.code} in {elapsed:.1f}s: {e.read().decode()[:300]}")
except Exception as ex:
    elapsed = time.time() - start
    print(f"ERR {type(ex).__name__} in {elapsed:.1f}s: {ex}")
