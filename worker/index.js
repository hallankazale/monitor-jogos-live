const TRACKED = [
  ['palmeiras-vasco','Palmeiras','Vasco da Gama'],
  ['man-city','Manchester City','AFC Bournemouth'],
  ['barcelona','Fiche','Barcelona'],
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
    'Cache-Control':'no-store',
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

async function findFixture(home,away,env){
  const today='2026-08-23';
  const payload=await apiGet(`/fixtures?date=${today}&timezone=America/Sao_Paulo`,env);
  return payload.response.find(item=>sameTeam(item.teams?.home?.name,home) && sameTeam(item.teams?.away?.name,away));
}

async function hydrateFixture(fixture,env){
  const id=fixture.fixture.id;
  const stats=await apiGet(`/fixtures/statistics?fixture=${id}`,env);
  return {
    status: fixture.fixture.status?.short==='FT' ? 'FINISHED' : fixture.fixture.status?.short==='HT' ? 'PAUSED' : ['1H','2H','ET','P'].includes(fixture.fixture.status?.short) ? 'IN_PLAY' : 'SCHEDULED',
    minute: fixture.fixture.status?.elapsed ?? null,
    homeScore: fixture.goals?.home ?? null,
    awayScore: fixture.goals?.away ?? null,
    corners: sumStat(stats.response,'Corner Kicks'),
    redCards: sumStat(stats.response,'Red Cards'),
    updatedAt: new Date().toISOString()
  };
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='OPTIONS') return new Response(null,{headers:cors(request.headers.get('Origin'))});
    if(url.pathname!=='/matches') return new Response(JSON.stringify({error:'Not found'}),{status:404,headers:cors(request.headers.get('Origin'))});
    if(!env.API_FOOTBALL_KEY) return new Response(JSON.stringify({error:'API_FOOTBALL_KEY não configurada'}),{status:500,headers:cors(request.headers.get('Origin'))});

    try{
      const matches={};
      for(const [key,home,away] of TRACKED){
        const fixture=await findFixture(home,away,env);
        matches[key]=fixture ? await hydrateFixture(fixture,env) : null;
      }
      return new Response(JSON.stringify({matches}),{headers:cors(request.headers.get('Origin'))});
    }catch(error){
      return new Response(JSON.stringify({error:error.message}),{status:502,headers:cors(request.headers.get('Origin'))});
    }
  }
};
