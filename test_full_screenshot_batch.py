import json
import re
import time
from urllib import request, error

BASE = 'http://localhost:3000'
TIMEOUT = 300

COMPANIES = [
    {'name': 'SAGICOFIM spa', 'city': 'Cernusco sul Naviglio', 'phone': '02/9239021', 'street': 'Via Firenze 1', 'sector': 'Depurazione aria - Impianti'},
    {'name': 'SAIM spa', 'city': 'Buccinasco', 'phone': '02/488531', 'street': 'Via E. Fermi 19', 'sector': 'Apparecchiature elettromeccaniche'},
    {'name': 'SAIP srl', 'city': 'Opera', 'phone': '02/57603913', 'street': 'Via Lambro 23/25/27', 'sector': 'Apparecchiature pneumatiche, idrauliche ed idropneumatiche'},
    {'name': 'SALCA srl', 'city': 'Milano', 'phone': '02/48000001', 'street': 'Via Jacopo della Quercia 7/9', 'sector': 'Sistemi di fissaggio'},
    {'name': 'SALSONE IMPIANTI srl', 'city': 'Milano', 'phone': '02/26144571', 'street': 'Via Merano 18', 'sector': 'Riscaldamento - Impianti'},
    {'name': 'S.I.A.T.E. srl', 'city': 'Cologno Monzese', 'phone': '02/27300000', 'street': 'Via Ponchielli 39', 'sector': 'Quadri elettrici ed elettronici'},
    {'name': 'S.I.P.O. srl', 'city': 'Settala', 'phone': '02/95770008', 'street': 'Via Fratelli Rosselli 6', 'sector': 'Pigmenti e coloranti'},
    {'name': 'S.I.U.D. srl', 'city': 'Buccinasco', 'phone': '02/45708488', 'street': 'Via Meucci 20', 'sector': 'Utensili diamantati'},
    {'name': 'S2 Tech srl', 'city': 'Milano', 'phone': '02/8910142', 'street': 'Via Imperia 28', 'sector': 'Elettronica industriale'},
    {'name': 'SAFIM ITALIANA srl', 'city': 'Arluno', 'phone': '02/90110743', 'street': 'Via Lombardia 10', 'sector': 'Condizionamento aria - Componenti'},
    {'name': 'RTI spa', 'city': 'Rodano Millepini', 'phone': '02/95328010', 'street': 'Via Ambrosoli 2/A', 'sector': 'Impianti oleodinamici - Componenti'},
    {'name': 'RUBINETTERIA GST srl', 'city': 'Cologno Monzese', 'phone': '02/2542803', 'street': 'Viale Brianza 91', 'sector': 'Stampaggio metalli a caldo'},
    {'name': 'RUDY PROFUMI srl', 'city': 'Assago', 'phone': '02/48844454', 'street': 'Via Einstein 2/4', 'sector': 'Cosmetici'},
    {'name': 'RULLIGRAFICA srl', 'city': 'Cornaredo', 'phone': '02/93661450', 'street': 'Via Merendi 42', 'sector': 'Rivestimento rulli'},
    {'name': 'RURMEC srl', 'city': 'Assago', 'phone': None, 'street': 'Via Einstein 17', 'sector': 'Edilizia - Attrezzature'},
    {'name': 'S & H snc di G. Crivellaro & C.', 'city': 'Peschiera Borromeo', 'phone': None, 'street': None, 'sector': 'Quadri elettrici ed elettronici'},
    {'name': 'S. & T. PLAST sas', 'city': 'Robecco sul Naviglio', 'phone': None, 'street': 'Via A. Gramsci 3', 'sector': 'Stampaggio materie plastiche'},
    {'name': 'S.B.M. MANGIAGALLI srl', 'city': 'Pessano con Bornago', 'phone': None, 'street': 'Via Marconi 16', 'sector': 'Trattamenti e finiture di superficie dei metalli'},
    {'name': 'S.C.A.E. spa', 'city': 'Segrate', 'phone': None, 'street': 'Via A. Volta 6', 'sector': 'Segnaletica stradale ed antinfortunistica'},
]

PLACEHOLDER_RX = re.compile(r'(?i)(esempio|example|sample|placeholder|lorem|ipsum|12345678|0123456789|3456789012|nome\.cognome|mario\.rossi)')
PORTAL_DOMS = ['risultati.it', 'nomeesatto.it', 'esattospa.it', 'reportaziende.it']


def post(path, payload, timeout=TIMEOUT):
    start = time.time()
    req = request.Request(
        f'{BASE}{path}',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'}
    )
    try:
        resp = request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode())
        return resp.status, data, time.time() - start
    except error.HTTPError as e:
        try:
            body = e.read().decode()
        except Exception:
            body = str(e)
        return e.code, {'error': body}, time.time() - start
    except Exception as e:
        return 0, {'error': str(e)}, time.time() - start


def digits(v):
    return re.sub(r'\D+', '', str(v or ''))


def norm(v):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', str(v or '').lower())).strip()


def short_name(name):
    return norm(name).replace(' srl', '').replace(' spa', '').replace(' sas', '').replace(' snc', '').strip()


def collect_placeholders(data):
    issues = []
    if not isinstance(data, dict):
        return ['payload non dict']
    for k, v in data.items():
        if isinstance(v, str) and PLACEHOLDER_RX.search(v):
            issues.append(f'placeholder in {k}: {v[:80]}')
    site = data.get('sito') or data.get('sito_web') or ''
    if site and any(dom in site for dom in PORTAL_DOMS):
        issues.append(f'sito portale: {site}')
    for k in ['telefono', 'cellulare', 'pec', 'email']:
        val = str(data.get(k, ''))
        if '1234567' in digits(val):
            issues.append(f'sequenziale in {k}: {val}')
    return issues


def verify_contact_data(expected, data, source_label):
    issues = []
    data_name = data.get('ragione_sociale') or data.get('business_name') or ''
    if data_name and short_name(expected['name']) not in norm(data_name):
        issues.append(f'{source_label}: ragione sociale diversa -> {data_name}')
    phone_expected = expected.get('phone')
    phone_found = digits(data.get('telefono') or data.get('phone') or '')
    if phone_expected:
        exp = digits(phone_expected)
        if not phone_found:
            issues.append(f'{source_label}: telefono mancante (atteso {phone_expected})')
        elif exp not in phone_found and phone_found not in exp:
            issues.append(f'{source_label}: telefono mismatch trovato={data.get("telefono")} atteso={phone_expected}')
    street = expected.get('street')
    addr = str(data.get('indirizzo') or data.get('sede_legale') or data.get('address') or '')
    if street:
        tokens = [t for t in norm(street).split() if len(t) > 2]
        if not addr:
            issues.append(f'{source_label}: indirizzo mancante (atteso {street})')
        elif not any(tok in norm(addr) for tok in tokens[-2:]):
            issues.append(f'{source_label}: indirizzo mismatch trovato={addr[:80]} atteso~={street}')
    city = expected.get('city')
    if city:
        text_blob = ' '.join([
            str(data.get('indirizzo') or ''),
            str(data.get('sede_legale') or ''),
            str(data.get('location') or ''),
        ])
        if text_blob and norm(city).split()[0] not in norm(text_blob):
            issues.append(f'{source_label}: città non coerente -> {text_blob[:80]} atteso {city}')
    issues.extend(collect_placeholders(data))
    return issues


def verify_visura(expected, data):
    issues = []
    if 'error' in data:
        return [f'visura-free errore: {data["error"][:120]}']
    if not data.get('found'):
        return ['visura-free nessun dato']
    rs = data.get('ragione_sociale') or ''
    if rs and short_name(expected['name']) not in norm(rs):
        issues.append(f'visura-free ragione sociale diversa -> {rs}')
    sl = str(data.get('sede_legale') or '')
    if expected.get('city') and sl and norm(expected['city']).split()[0] not in norm(sl):
        issues.append(f'visura-free sede non coerente -> {sl[:80]}')
    if not data.get('forma_giuridica'):
        issues.append('visura-free forma_giuridica mancante')
    issues.extend(collect_placeholders(data))
    return issues


def verify_news(expected, data):
    issues = []
    if 'error' in data:
        return [f'company-news errore: {str(data["error"])[:120]}']
    if data.get('ragione_sociale') and short_name(expected['name']) not in norm(data.get('ragione_sociale')):
        issues.append(f'company-news ragione sociale diversa -> {data.get("ragione_sociale")}')
    if data.get('news') is None:
        issues.append('company-news campo news mancante')
    if data.get('trigger_commerciali') is None:
        issues.append('company-news campo trigger_commerciali mancante')
    return issues


def verify_anac(expected, data):
    issues = []
    if 'error' in data:
        return [f'anac-gare errore: {str(data["error"])[:120]}']
    if 'vince_appalti_pubblici' not in data:
        issues.append('anac-gare campo vince_appalti_pubblici mancante')
    if 'gare' not in data:
        issues.append('anac-gare campo gare mancante')
    return issues


def verify_tech(data):
    issues = []
    if 'error' in data:
        return [f'tech-stack errore: {str(data["error"])[:120]}']
    if 'cyber_risk' not in data:
        issues.append('tech-stack campo cyber_risk mancante')
    if 'tecnologie' not in data:
        issues.append('tech-stack campo tecnologie mancante')
    if data.get('https') is None:
        issues.append('tech-stack campo https mancante')
    return issues


def verify_person(person_query, data):
    issues = []
    if 'error' in data:
        return [f'person-lookup errore: {str(data["error"])[:120]}']
    issues.extend(collect_placeholders(data))
    if data.get('nome_completo') and short_name(data.get('nome_completo')) not in norm(person_query):
        pass
    return issues


all_results = []
referents = []

for idx, company in enumerate(COMPANIES, start=1):
    label = f"{company['name']} {company['city']}"
    print('\n' + '=' * 90)
    print(f'[{idx}/{len(COMPANIES)}] {label}')
    print('=' * 90)

    company_status, company_data, company_elapsed = post('/api/company-lookup', {'query': label}, timeout=300)
    company_issues = [] if company_status == 200 else [f'company-lookup status {company_status}']
    if company_status == 200:
        company_issues.extend(verify_contact_data(company, company_data, 'company-lookup'))
    print(f'company-lookup: {company_status} in {company_elapsed:.1f}s | issues={len(company_issues)}')
    print(f'  ragione_sociale={company_data.get("ragione_sociale") if isinstance(company_data, dict) else None}')
    print(f'  telefono={company_data.get("telefono") if isinstance(company_data, dict) else None}')
    print(f'  email={company_data.get("email") if isinstance(company_data, dict) else None}')
    print(f'  pec={company_data.get("pec") if isinstance(company_data, dict) else None}')
    print(f'  sito={company_data.get("sito") if isinstance(company_data, dict) else None}')
    all_results.append({'company': label, 'endpoint': 'company-lookup', 'status': company_status, 'elapsed': round(company_elapsed, 1), 'issues': company_issues, 'data': company_data})

    lead_payload = {'lead': {'business_name': company['name'], 'city': company['city']}, '_skipPersonEnrichment': True}
    lead_status, lead_data, lead_elapsed = post('/api/lead-registry', lead_payload, timeout=240)
    lead_issues = [] if lead_status == 200 else [f'lead-registry status {lead_status}']
    if lead_status == 200:
        lead_issues.extend(verify_contact_data(company, lead_data, 'lead-registry'))
    print(f'lead-registry: {lead_status} in {lead_elapsed:.1f}s | issues={len(lead_issues)}')
    print(f'  ragione_sociale={lead_data.get("ragione_sociale") if isinstance(lead_data, dict) else None}')
    print(f'  telefono={lead_data.get("telefono") if isinstance(lead_data, dict) else None}')
    print(f'  pec={lead_data.get("pec") if isinstance(lead_data, dict) else None}')
    print(f'  sito_web={lead_data.get("sito_web") if isinstance(lead_data, dict) else None}')
    all_results.append({'company': label, 'endpoint': 'lead-registry', 'status': lead_status, 'elapsed': round(lead_elapsed, 1), 'issues': lead_issues, 'data': lead_data})

    piva = None
    if isinstance(company_data, dict):
        piva = company_data.get('partita_iva') or company_data.get('piva')
    if not piva and isinstance(lead_data, dict):
        piva = lead_data.get('partita_iva') or lead_data.get('piva')

    visura_payload = {'ragione_sociale': company['name']}
    if piva:
        visura_payload['partita_iva'] = piva
    visura_status, visura_data, visura_elapsed = post('/api/visura-free', visura_payload, timeout=240)
    visura_issues = [] if visura_status == 200 else [f'visura-free status {visura_status}']
    if visura_status == 200:
        visura_issues.extend(verify_visura(company, visura_data))
    print(f'visura-free: {visura_status} in {visura_elapsed:.1f}s | issues={len(visura_issues)}')
    print(f'  found={visura_data.get("found") if isinstance(visura_data, dict) else None} pec={visura_data.get("pec") if isinstance(visura_data, dict) else None}')
    all_results.append({'company': label, 'endpoint': 'visura-free', 'status': visura_status, 'elapsed': round(visura_elapsed, 1), 'issues': visura_issues, 'data': visura_data})

    news_status, news_data, news_elapsed = post('/api/company-news', {'ragione_sociale': company['name'], 'anni_lookback': 2}, timeout=240)
    news_issues = [] if news_status == 200 else [f'company-news status {news_status}']
    if news_status == 200:
        news_issues.extend(verify_news(company, news_data))
    print(f'company-news: {news_status} in {news_elapsed:.1f}s | issues={len(news_issues)}')
    print(f'  found={news_data.get("found") if isinstance(news_data, dict) else None} news={len(news_data.get("news") or []) if isinstance(news_data, dict) else None} triggers={len(news_data.get("trigger_commerciali") or []) if isinstance(news_data, dict) else None}')
    all_results.append({'company': label, 'endpoint': 'company-news', 'status': news_status, 'elapsed': round(news_elapsed, 1), 'issues': news_issues, 'data': news_data})

    anac_payload = {'ragione_sociale': company['name']}
    if piva:
        anac_payload['partita_iva'] = piva
    anac_status, anac_data, anac_elapsed = post('/api/anac-gare', anac_payload, timeout=240)
    anac_issues = [] if anac_status == 200 else [f'anac-gare status {anac_status}']
    if anac_status == 200:
        anac_issues.extend(verify_anac(company, anac_data))
    print(f'anac-gare: {anac_status} in {anac_elapsed:.1f}s | issues={len(anac_issues)}')
    print(f'  vince_appalti_pubblici={anac_data.get("vince_appalti_pubblici") if isinstance(anac_data, dict) else None} gare={len(anac_data.get("gare") or []) if isinstance(anac_data, dict) else None}')
    all_results.append({'company': label, 'endpoint': 'anac-gare', 'status': anac_status, 'elapsed': round(anac_elapsed, 1), 'issues': anac_issues, 'data': anac_data})

    site = None
    if isinstance(company_data, dict):
        site = company_data.get('sito') or company_data.get('website')
    if not site and isinstance(lead_data, dict):
        site = lead_data.get('sito_web') or lead_data.get('sito')
    if site:
        tech_status, tech_data, tech_elapsed = post('/api/tech-stack', {'sito_web': site}, timeout=180)
        tech_issues = [] if tech_status == 200 else [f'tech-stack status {tech_status}']
        if tech_status == 200:
            tech_issues.extend(verify_tech(tech_data))
        print(f'tech-stack: {tech_status} in {tech_elapsed:.1f}s | issues={len(tech_issues)}')
        print(f'  dominio={tech_data.get("dominio") if isinstance(tech_data, dict) else None} https={tech_data.get("https") if isinstance(tech_data, dict) else None}')
        all_results.append({'company': label, 'endpoint': 'tech-stack', 'status': tech_status, 'elapsed': round(tech_elapsed, 1), 'issues': tech_issues, 'data': tech_data})
    else:
        print('tech-stack: SKIP (sito non disponibile)')
        all_results.append({'company': label, 'endpoint': 'tech-stack', 'status': -1, 'elapsed': 0, 'issues': ['skip: sito non disponibile'], 'data': {}})

    titolare = None
    if isinstance(company_data, dict):
        titolare = company_data.get('titolare')
    if not titolare and isinstance(lead_data, dict):
        titolare = lead_data.get('titolare')
    if titolare:
        referents.append({'company': company['name'], 'query': f'{titolare} {company["name"]}'})

    time.sleep(4)

print('\n' + '=' * 90)
print('TEST REFERENTI')
print('=' * 90)

seen_queries = set()
for idx, ref in enumerate(referents, start=1):
    if ref['query'] in seen_queries:
        continue
    seen_queries.add(ref['query'])
    status, data, elapsed = post('/api/person-lookup', {'query': ref['query']}, timeout=360)
    issues = [] if status == 200 else [f'person-lookup status {status}']
    if status == 200:
        issues.extend(verify_person(ref['query'], data))
    print(f'[{idx}] referente {ref["query"]}: {status} in {elapsed:.1f}s | issues={len(issues)}')
    print(f'  nome={data.get("nome_completo") if isinstance(data, dict) else None} email={data.get("email") if isinstance(data, dict) else None} linkedin={data.get("linkedin") if isinstance(data, dict) else None}')
    all_results.append({'company': ref['company'], 'endpoint': 'person-lookup', 'status': status, 'elapsed': round(elapsed, 1), 'issues': issues, 'data': data, 'query': ref['query']})
    time.sleep(4)

with open('test_full_screenshot_batch_output.json', 'w', encoding='utf-8') as f:
    json.dump(all_results, f, ensure_ascii=False, indent=2)

print('\n' + '=' * 90)
print('RIEPILOGO FINALE')
print('=' * 90)
problem_count = 0
for item in all_results:
    ok = item['status'] == 200 and not item['issues']
    if not ok:
        problem_count += 1
    tag = '✓' if ok else '✗'
    ident = item.get('query') or item['company']
    print(f"{tag} {item['endpoint']} | {ident} | status={item['status']} | issues={len(item['issues'])}")
    for iss in item['issues'][:5]:
        print(f'   - {iss}')

print(f'\nTotale controlli: {len(all_results)}')
print(f'Problemi rilevati: {problem_count}')
print('File dettagliato: test_full_screenshot_batch_output.json')
