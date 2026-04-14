#!/usr/bin/env python3
import os
import time
from dotenv import load_dotenv
from supabase import create_client

load_dotenv('/opt/ckb-backend/.env.bak')
OLD_URL = os.getenv('SUPABASE_URL')
OLD_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

NEW_URL = 'https://ieavvbjrevnfawvlcsjz.supabase.co'
NEW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllYXZ2YmpyZXZuZmF3dmxjc2p6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAwODc0NywiZXhwIjoyMDkxNTg0NzQ3fQ.SASzOJPd9hBPb7yr8TVpZNfP25utAg9RV4E3RKvBJnA'

old_sb = create_client(OLD_URL, OLD_KEY)
new_sb = create_client(NEW_URL, NEW_KEY)

BATCH = 500

def fetch_all_ids(sb, table):
    ids = set()
    offset = 0
    while True:
        res = sb.table(table).select('id').range(offset, offset + BATCH - 1).execute()
        rows = res.data or []
        if not rows:
            break
        ids.update(r['id'] for r in rows if r.get('id'))
        offset += BATCH
        print(f'{table}: fetched ids {len(ids)}')
    return ids

print('Loading old IDs...')
old_ids = fetch_all_ids(old_sb, 'searches')
print('Loading new IDs...')
new_ids = fetch_all_ids(new_sb, 'searches')
missing_ids = sorted(old_ids - new_ids)
print(f'Missing IDs: {len(missing_ids)}')

if not missing_ids:
    print('Nothing to sync.')
    raise SystemExit(0)

synced = 0
for idx, search_id in enumerate(missing_ids, 1):
    row_res = old_sb.table('searches').select('*').eq('id', search_id).single().execute()
    row = row_res.data
    new_sb.table('searches').upsert(row).execute()
    synced += 1
    if idx % 50 == 0:
        print(f'Synced {synced}/{len(missing_ids)}')
        time.sleep(0.2)

final_count = new_sb.table('searches').select('*', count='exact').limit(0).execute().count
print(f'Final new searches count: {final_count}')
