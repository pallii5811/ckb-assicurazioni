import json, time, urllib.request, ssl
ssl._create_default_https_context = ssl._create_unverified_context
BASE = 'http://localhost:3000'

def post(path, payload, timeout=180):
    req = urllib.request.Request(BASE + path,
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except Exception as e:
        return 0, {'error': str(e)}

a = 'Sagicofim spa'
report = {}
report['company_lookup'] = post('/api/company-lookup', {'query': a})
report['lead_registry'] = post('/api/lead-registry', {'lead': {'business_name': 'Sagicofim', 'city': 'Cernusco sul Naviglio'}, '_skipPersonEnrichment': True})
report['visura_free'] = post('/api/visura-free', {'ragione_sociale': a, 'partita_iva': '11071250150'})
report['company_news'] = post('/api/company-news', {'ragione_sociale': a, 'anni_lookback': 2})
report['anac_gare'] = post('/api/anac-gare', {'ragione_sociale': a})
report['tech_stack'] = post('/api/tech-stack', {'sito_web': 'https://www.sagicofim.com'})
# titolare
if isinstance(report['company_lookup'][1], dict):
    tit = report['company_lookup'][1].get('titolare')
    if tit:
        report['person_lookup'] = post('/api/person-lookup', {'query': tit + ' Sagicofim'})

print(json.dumps(report, ensure_ascii=False, indent=2))
