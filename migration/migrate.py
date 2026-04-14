#!/usr/bin/env python3
"""Migrate data from old shared Supabase to new CKB Supabase"""
import os, json, time
from dotenv import load_dotenv
load_dotenv('/opt/ckb-backend/.env')
from supabase import create_client

OLD_URL = os.getenv('SUPABASE_URL')
OLD_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

NEW_URL = 'https://ieavvbjrevnfawvlcsjz.supabase.co'
NEW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllYXZ2YmpyZXZuZmF3dmxjc2p6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAwODc0NywiZXhwIjoyMDkxNTg0NzQ3fQ.SASzOJPd9hBPb7yr8TVpZNfP25utAg9RV4E3RKvBJnA'

old_sb = create_client(OLD_URL, OLD_KEY)
new_sb = create_client(NEW_URL, NEW_KEY)

def migrate_table(name, batch_size=500, order_col='created_at'):
    print(f'\n=== Migrating {name} ===')
    offset = 0
    total = 0
    while True:
        try:
            r = old_sb.table(name).select('*').order(order_col, desc=False).range(offset, offset + batch_size - 1).execute()
        except Exception as e:
            if 'PGRST205' in str(e):
                print(f'  Table {name} not found in old DB, skipping')
                return 0
            raise
        rows = r.data or []
        if not rows:
            break
        try:
            new_sb.table(name).upsert(rows).execute()
        except Exception as e:
            print(f'  ERROR batch at offset {offset}: {str(e)[:200]}')
            for row in rows:
                try:
                    new_sb.table(name).upsert(row).execute()
                except Exception as e2:
                    print(f'  SKIP row: {str(e2)[:100]}')
        total += len(rows)
        offset += batch_size
        print(f'  Migrated {total} rows...')
        time.sleep(0.3)
    print(f'  DONE: {total} rows migrated')
    return total

print('Starting migration...')
print(f'OLD: {OLD_URL}')
print(f'NEW: {NEW_URL}')

migrate_table('profiles', batch_size=50, order_col='id')
migrate_table('searches', batch_size=200, order_col='created_at')
migrate_table('leads', batch_size=500, order_col='created_at')
migrate_table('lists', batch_size=50, order_col='created_at')
migrate_table('list_leads', batch_size=100, order_col='created_at')
migrate_table('environments', batch_size=50, order_col='created_at')
migrate_table('lead_interactions', batch_size=100, order_col='created_at')

print('\n=== MIGRATION COMPLETE ===')
