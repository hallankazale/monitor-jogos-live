const API_BASE = window.MONITOR_API_BASE || '';

const selections = [
  { id:'palmeiras-vasco', home:'Palmeiras', away:'Vasco da Gama', kickoff:'2026-08-23T15:00:00-03:00', conditions:[
    {type:'goals_over', value:1.5, label:'Mais de 1,5 gols'},
    {type:'corners_over', value:5.5, label:'Mais de 5,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'},
    {type:'winner', team:'Palmeiras', label:'Palmeiras vence'}
  ]},
  { id:'man-city', home:'Manchester City', away:'AFC Bournemouth', kickoff:'2026-08-23T09:00:00-03:00', conditions:[
    {type:'winner', team:'Manchester City', label:'Manchester City vence'},
    {type:'corners_over', value:5.5, label:'Mais de 5,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'}
  ]},
  { id:'barcelona', home:'Fiche', away:'Barcelona', kickoff:'2026-08-23T15:30:00-03:00', conditions:[
    {type:'winner', team:'Barcelona', label:'Barcelona vence'},
    {type:'goals_over', value:1.5, label:'Mais de 1,5 gols'},
    {type:'corners_over', value:6.5, label:'Mais de 6,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'}
  ]},
  { id:'santos-mirassol', home:'Santos', away:'Mirassol', kickoff:'2026-08-23T17:30:00-03:00', conditions:[
    {type:'goals_over', value:0.5, label:'Mais de 0,5 gols'},
    {type:'corners_over', value:5.5, label:'Mais de 5,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'}
  ]},
  { id:'bragantino-gremio', home:'Bragantino', away:'Grêmio', kickoff:'2026-08-23T15:00:00-03:00', conditions:[
    {type:'corners_over', value:5.5, label:'Mais de 5,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'},
    {type:'goals_over', value:0.5, label:'Mais de 0,5 gols'}
  ]},
  { id:'chapecoense-sao-paulo', home:'Chapecoense', away:'São Paulo', kickoff:'2026-08-23T17:30:00-03:00', conditions:[
    {type:'goals_over', value:1.5, label:'Mais de 1,5 gols'}
  ]},
  { id:'vitoria-bahia', home:'Vitória', away:'Bahia', kickoff:'2026-08-23T15:00:00-03:00', conditions:[
    {type:'goals_over', value:1.5, label:'Mais de 1,5 gols'}
  ]},
  { id:'coritiba-corinthians', home:'Coritiba', away:'Corinthians', kickoff:'2026-08-23T18:30:00-03:00', conditions:[
    {type:'goals_over', value:0.5, label:'Mais de 0,5 gols'},
    {type:'corners_over', value:5.5, label:'Mais de 5,5 escanteios'},
    {type:'reds_under', value:1.5, label:'Menos de 1,5 cartões vermelhos'}
  ]},
  { id:'porto-arouca', home:'FC Porto', away:'Arouca', kickoff:'2026-08-23T15:30:00-03:00', conditions:[
    {type:'winner', team:'FC Porto', label:'FC Porto vence'}
  ]},
  { id:'rennes-psg', home:'Rennes', away:'Paris Saint-Germain', kickoff:'2026-08-23T14:45:00-03:00', conditions:[
    {type:'winner', team:'Paris Saint-Germain', label:'Paris Saint-Germain vence'}
  ]}
];

const state = new Map();

function normalizeMatch(raw, selection){
  return {
    id: selection.id,
    status: raw?.status || 'SCHEDULED',
    minute: raw?.minute ?? null,
    homeScore: raw?.homeScore ?? null,
    awayScore: raw?.awayScore ?? null,
    corners: raw?.corners ?? null,
    redCards: raw?.redCards ?? null,
    updatedAt: raw?.updatedAt || null
  };
}

function conditionResult(condition, match, selection){
  const finished = match.status === 'FINISHED';
  const totalGoals = (match.homeScore ?? 0) + (match.awayScore ?? 0);
  if(condition.type === 'goals_over'){
    if(totalGoals > condition.value) return 'ok';
    return finished ? 'fail' : 'pending';
  }
  if(condition.type === 'corners_over'){
    if(match.corners == null) return 'pending';
    if(match.corners > condition.value) return 'ok';
    return finished ? 'fail' : 'pending';
  }
  if(condition.type === 'reds_under'){
    if(match.redCards == null) return 'pending';
    if(match.redCards > condition.value) return 'fail';
    return finished ? 'ok' : 'pending';
  }
  if(condition.type === 'winner'){
    if(match.homeScore == null || match.awayScore == null) return 'pending';
    const winner = match.homeScore > match.awayScore ? selection.home : match.awayScore > match.homeScore ? selection.away : null;
    if(finished) return winner === condition.team ? 'ok' : 'fail';
    return winner === condition.team ? 'ok' : 'pending';
  }
  return 'pending';
}

function statusLabel(match){
  if(match.status === 'IN_PLAY' || match.status === 'LIVE') return match.minute ? `${match.minute}' AO VIVO` : 'AO VIVO';
  if(match.status === 'PAUSED') return 'INTERVALO';
  if(match.status === 'FINISHED') return 'ENCERRADO';
  return 'AGENDADO';
}

function formatKickoff(value){
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}

function render(){
  const container = document.querySelector('#games');
  const template = document.querySelector('#gameTemplate');
  container.innerHTML='';
  let live=0, won=0, risk=0;

  for(const selection of selections){
    const match = state.get(selection.id) || normalizeMatch(null, selection);
    const node = template.content.cloneNode(true);
    const status = node.querySelector('.game-status');
    status.textContent = statusLabel(match);
    if(['IN_PLAY','LIVE','PAUSED'].includes(match.status)){ status.classList.add('live'); live++; }
    if(match.status === 'FINISHED') status.classList.add('finished');
    node.querySelector('.match-title').textContent = `${selection.home} × ${selection.away}`;
    node.querySelector('.match-time').textContent = `Início: ${formatKickoff(selection.kickoff)}`;
    node.querySelector('.home-score').textContent = match.homeScore ?? '-';
    node.querySelector('.away-score').textContent = match.awayScore ?? '-';
    node.querySelector('.goals-stat').textContent = match.homeScore == null ? '-' : (match.homeScore + match.awayScore);
    node.querySelector('.corners-stat').textContent = match.corners ?? '-';
    node.querySelector('.reds-stat').textContent = match.redCards ?? '-';

    const conditionsBox = node.querySelector('.conditions');
    const results = selection.conditions.map(c => conditionResult(c, match, selection));
    if(results.some(r=>r==='fail')) risk++;
    else if(match.status === 'FINISHED' && results.every(r=>r==='ok')) won++;

    selection.conditions.forEach((condition,index)=>{
      const result = results[index];
      const row = document.createElement('div');
      row.className = `condition ${result}`;
      const text = document.createElement('span');
      text.textContent = condition.label;
      const badge = document.createElement('span');
      badge.className='condition-status';
      badge.textContent = result==='ok' ? '✓ OK' : result==='fail' ? '✕ PERDEU' : '● AGUARDANDO';
      row.append(text,badge);
      conditionsBox.append(row);
    });
    container.append(node);
  }

  document.querySelector('#liveCount').textContent=live;
  document.querySelector('#wonCount').textContent=won;
  document.querySelector('#riskCount').textContent=risk;
}

async function refresh(){
  const button=document.querySelector('#refreshButton');
  const notice=document.querySelector('#connectionNotice');
  button.disabled=true;
  try{
    if(!API_BASE){
      notice.hidden=false;
      notice.textContent='Dashboard instalado. Falta conectar o endpoint seguro da API de futebol para receber os dados em tempo real.';
      render();
      return;
    }
    const response=await fetch(`${API_BASE.replace(/\/$/,'')}/matches` , {cache:'no-store'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    for(const selection of selections){
      state.set(selection.id, normalizeMatch(payload.matches?.[selection.id], selection));
    }
    notice.hidden=true;
    render();
  }catch(error){
    notice.hidden=false;
    notice.textContent=`Não foi possível atualizar agora: ${error.message}`;
  }finally{
    button.disabled=false;
  }
}

document.querySelector('#refreshButton').addEventListener('click',refresh);
render();
refresh();
setInterval(refresh,30000);
