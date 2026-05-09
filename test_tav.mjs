import dotenv from 'dotenv';
dotenv.config({path: '.env.local'});
fetch('https://api.tavily.com/search', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({api_key: process.env.TAVILY_API_KEY, query: 'G.E.M. di Gorgone Marco Milano telefono site:reteimprese.it OR site:paginegialle.it', max_results: 10, search_depth: 'advanced'})
}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d, null, 2)));
