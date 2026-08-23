const TRACKED = [
  ['palmeiras-vasco','Palmeiras','Vasco da Gama'],
  ['man-city','Manchester City','AFC Bournemouth'],
  ['barcelona','Elche','Barcelona'],
  ['santos-mirassol','Santos','Mirassol'],
  ['bragantino-gremio','Bragantino','Grêmio'],
  ['chapecoense-sao-paulo','Chapecoense','São Paulo'],
  ['vitoria-bahia','Vitória','Bahia'],
  ['coritiba-corinthians','Coritiba','Corinthians'],
  ['porto-arouca','FC Porto','Arouca'],
  ['rennes-psg','Rennes','Paris Saint-Germain']
];

function cors(origin){
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods':'GET,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Cache-Control':'public, max-age=45',
    'Content-Type':'application/json; charset=utf-8'
  };
}

function normalize(value=''){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

function sameTeam(a,b){
  const x=normalize(a), y=normalize(b);
  return x===y || x.includes(y) || y.includes(x);
}

async function apiGet(path, env){
  const response = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers:{'x-apisports-key': env.API_FOOTBALL_KEY}
  });
  if(!response.ok) throw new Error(`API-Football ${response.status}`);
  const json=await response.json();
  if(json.errors && Object.keys(json.errors).length) throw new Error(JSON.stringify(json.errors));
  return json;
}

function sumStat(statistics,type){
  let total=0, found=false;
  for(const team of statistics || []){
    const row=(team.statistics||[]).find(item=>item.type===type);
    if(row && row.value != null){ total += Number(row.value) || 0; found=true; }
  }
  return found ? total : null;
}

function mapStatus(short){
  if(['FT','AET','PEN'].includes(short)) return 'FINISHED';
  if(short==='HT') return 'PAUSED';
  if(['1H','2H','ET','P','BT'].includes(short)) return 'IN_PLAY';
  return 'SCHEDULED';
}

function findFixture(fixtures,home,away){
  return fixtures.find(item=>sameTeam(item.teams?.home?.name,home) && sameTeam(item.teams?.away?.name,away));
}

async function hydrateFixture(fixture,env){
  const status=mapStatus(fixture.fixture.status?.short);
  let corners=null;
  let redCards=null;

  // Estatísticas detalhadas custam uma chamada extra. Só consultamos quando o jogo
  // está ao vivo, no intervalo ou já terminou; jogos futuros usam apenas o placar base.
  if(status!=='SCHEDULED'){
    const stats=await apiGet(`/fixtures/statistics?fixture=${fixture.fixture.id}`,env);
    corners=sumStat(stats.response,'Corner Kicks');
    redCards=sumStat(stats.response,'Red Cards');
  }

  return {
    status,
    minute: fixture.fixture.status?.elapsed ?? null,
    homeScore: fixture.goals?.home ?? null,
    awayScore: fixture.goals?.away ?? null,
    corners,
    redCards,
    updatedAt:new Date().toISOString()
  };
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const origin=request.headers.get('Origin');
    if(request.method==='OPTIONS') return new Response(null,{headers:cors(origin)});
    if(url.pathname!=='/matches') return new Response(JSON.stringify({error:'Not found'}),{status:404,headers:cors(origin)});
    if(!env.API_FOOTBALL_KEY) return new Response(JSON.stringify({error:'API_FOOTBALL_KEY não configurada'}),{status:500,headers:cors(origin)});

    const cache=caches.default;
    const cacheKey=new Request(`${url.origin}/matches-cache`,request);
    const cached=await cache.match(cacheKey);
    if(cached) return cached;

    try{
      const day='2026-08-23';
      const fixturesPayload=await apiGet(`/fixtures?date=${day}&timezone=America/Sao_Paulo`,env);
      const fixtures=fixturesPayload.response || [];
      const matches={};

      for(const [key,home,away] of TRACKED){
        const fixture=findFixture(fixtures,home,away);
        matches[key]=fixture ? await hydrateFixture(fixture,env) : null;
      }

      const response=new Response(JSON.stringify({matches}),{headers:cors(origin)});
      ctx.waitUntil(cache.put(cacheKey,response.clone()));
      return response;
    }catch(error){
      return new Response(JSON.stringify({error:error.message}),{status:502,headers:cors(origin)});
    }
  }
};
