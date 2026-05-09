import dotenv from 'dotenv';
dotenv.config({path: '.env.local'});
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Fetching recent searches...');
  const { data: searches, error } = await supabase
    .from('searches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching:', error);
    return;
  }

  let deletedCount = 0;
  for (const s of searches) {
    const sStr = JSON.stringify(s);
    if (sStr.includes('03843580964') || sStr.includes('Gorgone') || sStr.includes('G.E.M')) {
      await supabase.from('searches').delete().eq('id', s.id);
      deletedCount++;
      console.log('Deleted search ID:', s.id);
    }
  }
  console.log(`Deleted ${deletedCount} recent searches containing the target data.`);
}

run();
