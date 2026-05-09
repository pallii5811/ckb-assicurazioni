import dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function run() {
  const piva = '03843580964';
  const token = process.env.OPENAPI_IT_TOKEN;
  console.log('Fetching IT-ADVANCED for', piva);
  const res = await fetch(`https://api.openapi.it/api/imprese/it-advanced/${piva}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    console.error('API Error', await res.text());
    return;
  }
  const data = await res.json();
  console.log('ADMINISTRATORS:', JSON.stringify(data.data?.administrators, null, 2));
  console.log('SHAREHOLDERS:', JSON.stringify(data.data?.shareholders, null, 2));
}

run();
