const API_BASE = window.MONITOR_API_BASE || 'http://127.0.0.1:8000';
const STORAGE_KEY = 'liveScoreMonitorTicketsV1';
const ACTIVE_KEY = 'liveScoreMonitorActiveTicketV1';

const sampleTicket = {
  id: 'sample-20260823', name: 'Bilhete exemplo 23/08',
  selections: [
    {id:'palmeiras-vasco',home:'Palmeiras',away:'Vasco da Gama',kickoff:'2026-08-23 15:00',conditions:[{type:'goals_over',value:1.5,label:'Mais de 1,5 gols'},{type:'corners_over',value:5.5,label:'Mais de 5,5 escanteios'},{type:'reds_under',value:1.5,label:'Menos de 1,5 cartões vermelhos'},{type:'winner',team:'Palmeiras',label:'Palmeiras vence'}]},
    {id:'man-city',home:'Manchester City',away:'AFC Bournemouth',kickoff:'2026-08-23 09:00',conditions:[{type:'winner',team:'Manchester City',label:'Manchester City vence'},{type:'corners_over',value:5.5,label:'Mais de 5,5 escanteios'},{type:'reds_under',value:1.5,label:'Menos de 1,5 cartões vermelhos'}]},
    {id:'barcelona',home:'Elche',away:'Barcelona',kickoff:'2026-08-23 15:30',conditions:[{type:'winner',team:'Barcelona',label:'Barcelona vence'},{type:'goals_over',value:1.5,label:'Mais de 1,5 gols'},{type:'corners_over',value:6.5,label:'Mais de 6,5 escanteios'},{type:'reds_under',value:1.5,label:'Menos de 1,5 cartões vermelhos'}]},
    {id:'santos-mirassol',home:'Santos',away:'Mirassol',kickoff:'2026-08-23 17:30',conditions:[{type:'goals_over',value:0.5,label:'Mais de 0,5 gols'},{type:'corners_over',value:5.5,label:'Mais de 5,5 escanteios'},{type:'reds_under',value:1.5,label:'Menos de 1,5 cartões vermelhos'}]}
  ]
};

let tickets = loadTickets();
let activeTicketId = localStorage.getItem(ACTIVE_KEY) || tickets[0]?.id || null;
let state = new Map();
let editingTicketId = null;

function loadTickets(){
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); if(Array.isArray(parsed) && parsed.length) return parsed; } catch {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify([sampleTicket]));
  return [sampleTicket];
}
function saveTickets(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets)); }
function activeTicket(){ return tickets.find(t=>t.id===activeTicketId) || tickets[0] || null; }
function uid(prefix='id'){ return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function kickoffLabel(kickoff){ return kickoff?.split(' ')[1] || '--:--'; }
function initials(name){ return name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join('').toUpperCase(); }

function normalizeMatch(raw, selection){ return {id:selection.id,status:raw?.status||'SCHEDULED',minute:raw?.minute??null,homeScore:raw?.homeScore??null,awayScore:raw?.awayScore??null,corners:raw?.corners??null,redCards:raw?.redCards??null,homeTeamId:raw?.homeTeamId??null,awayTeamId:raw?.awayTeamId??null,fixtureValidated:raw?.fixtureValidated??false}; }
function conditionResult(c,m,s){
  const finished=m.status==='FINISHED', goals=(m.homeScore??0)+(m.awayScore??0);
  if(c.type==='goals_over'){ if(goals>c.value)return'ok'; return finished?'fail':'pending'; }
  if(c.type==='corners_over'){ if(m.corners==null)return'pending'; if(m.corners>c.value)return'ok'; return finished?'fail':'pending'; }
  if(c.type==='reds_under'){ if(m.redCards==null)return'pending'; if(m.redCards>c.value)return'fail'; return finished?'ok':'pending'; }
  if(c.type==='winner'){
    if(m.homeScore==null||m.awayScore==null)return'pending';
    const winner=m.homeScore>m.awayScore?s.home:m.awayScore>m.homeScore?s.away:null;
    if(finished)return winner===c.team?'ok':'fail';
    return winner===c.team?'ok':'pending';
  }
  return'pending';
}
function statusLabel(m){ if(['IN_PLAY','LIVE'].includes(m.status))return m.minute?`${m.minute}' AO VIVO`:'AO VIVO'; if(m.status==='PAUSED')return'INTERVALO'; if(m.status==='FINISHED')return'ENCERRADO'; return'AGENDADO'; }
function applyTeamBadge(el,name,id){ el.title=name; if(id){el.classList.add('has-logo');el.style.backgroundImage=`url(https://api.sofascore.app/api/v1/team/${id}/image)`;} else {el.textContent=initials(name);} }

function renderTicketSelector(){
  const select=document.querySelector('#ticketSelect'); select.innerHTML='';
  tickets.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;if(t.id===activeTicketId)o.selected=true;select.append(o);});
}
function render(){
  const ticket=activeTicket();
  renderTicketSelector();
  document.querySelector('#heroTitle').textContent=ticket?ticket.name:'Nenhum bilhete cadastrado';
  const selections=ticket?.selections||[];
  document.querySelector('#totalSelections').textContent=selections.length;
  document.querySelector('#selectionCountLabel').textContent=`${selections.length} JOGO${selections.length===1?'':'S'}`;
  document.querySelector('#emptyState').hidden=selections.length>0;
  const container=document.querySelector('#games'), template=document.querySelector('#gameTemplate'); container.innerHTML='';
  let live=0,won=0,risk=0,okConditions=0,totalConditions=0;
  selections.forEach((s,index)=>{
    const m=state.get(s.id)||normalizeMatch(null,s), node=template.content.cloneNode(true), card=node.querySelector('.game-card'), status=node.querySelector('.game-status');
    status.textContent=statusLabel(m); if(['IN_PLAY','LIVE','PAUSED'].includes(m.status)){status.classList.add('live');card.classList.add('is-live');live++;} if(m.status==='FINISHED')status.classList.add('finished');
    node.querySelector('.match-time').textContent=kickoffLabel(s.kickoff); node.querySelector('.match-number').textContent=`#${String(index+1).padStart(2,'0')}`;
    node.querySelector('.home-name').textContent=s.home; node.querySelector('.away-name').textContent=s.away;
    applyTeamBadge(node.querySelector('.home-badge'),s.home,m.homeTeamId); applyTeamBadge(node.querySelector('.away-badge'),s.away,m.awayTeamId);
    node.querySelector('.home-score').textContent=m.homeScore??'-'; node.querySelector('.away-score').textContent=m.awayScore??'-';
    node.querySelector('.goals-stat').textContent=m.homeScore==null?'-':(m.homeScore+m.awayScore); node.querySelector('.corners-stat').textContent=m.corners??'-'; node.querySelector('.reds-stat').textContent=m.redCards??'-';
    const results=s.conditions.map(c=>conditionResult(c,m,s)); totalConditions+=results.length; okConditions+=results.filter(r=>r==='ok').length;
    if(results.some(r=>r==='fail')){risk++;card.classList.add('has-risk');} else if(m.status==='FINISHED'&&results.length&&results.every(r=>r==='ok')){won++;card.classList.add('all-ok');}
    node.querySelector('.condition-count').textContent=`${results.filter(r=>r==='ok').length}/${results.length}`;
    const box=node.querySelector('.conditions'); s.conditions.forEach((c,i)=>{const r=results[i],row=document.createElement('div');row.className=`condition ${r}`;row.innerHTML=`<span>${c.label}</span><span class="condition-status">${r==='ok'?'✓ OK':r==='fail'?'✕ PERDEU':'● AGUARDANDO'}</span>`;box.append(row);});
    container.append(node);
  });
  document.querySelector('#liveCount').textContent=live; document.querySelector('#wonCount').textContent=won; document.querySelector('#riskCount').textContent=risk;
  const percent=totalConditions?Math.round(okConditions/totalConditions*100):0; document.querySelector('#progressPercent').textContent=`${percent}%`; document.querySelector('#progressRing').style.setProperty('--progress',percent);
}

async function refresh(){
  const ticket=activeTicket(), button=document.querySelector('#refreshButton'), notice=document.querySelector('#connectionNotice'), sync=document.querySelector('#syncText');
  if(!ticket||!ticket.selections.length){state.clear();render();sync.textContent='Sem jogos';return;}
  button.disabled=true;sync.textContent='Atualizando';
  try{
    const response=await fetch(`${API_BASE.replace(/\/$/,'')}/track`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ticket.name,selections:ticket.selections}),cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`); const payload=await response.json(); state.clear();
    ticket.selections.forEach(s=>state.set(s.id,normalizeMatch(payload.matches?.[s.id],s)));
    const unresolved=Object.keys(payload.errors||{}).length; notice.hidden=!unresolved; if(unresolved)notice.textContent=`${unresolved} jogo(s) ainda não foram encontrados com segurança. Eles ficam como aguardando até o confronto correto ser identificado.`;
    document.querySelector('#lastUpdate').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); sync.textContent='Sincronizado';render();
  }catch(e){notice.hidden=false;notice.textContent=`Não foi possível atualizar agora. Verifique se o backend está ligado em ${API_BASE}.`;sync.textContent='Sem conexão';render();}
  finally{button.disabled=false;}
}

function conditionLabel(type,value,team){ if(type==='goals_over')return`Mais de ${String(value).replace('.',',')} gols`; if(type==='corners_over')return`Mais de ${String(value).replace('.',',')} escanteios`; if(type==='reds_under')return`Menos de ${String(value).replace('.',',')} cartões vermelhos`; return`${team} vence`; }
function addConditionEditor(container,data={type:'goals_over',value:1.5,team:''}){
  const row=document.querySelector('#conditionEditorTemplate').content.firstElementChild.cloneNode(true), type=row.querySelector('.condition-type'), value=row.querySelector('.condition-value'), team=row.querySelector('.condition-team');
  type.value=data.type; value.value=data.value??1.5; team.value=data.team||'';
  const toggle=()=>{const winner=type.value==='winner';value.hidden=winner;team.hidden=!winner;}; type.addEventListener('change',toggle);toggle(); row.querySelector('.remove-condition').addEventListener('click',()=>row.remove()); container.append(row);
}
function addGameEditor(data={}){
  const host=document.querySelector('#gameEditor'), card=document.querySelector('#gameEditorTemplate').content.firstElementChild.cloneNode(true);
  card.dataset.id=data.id||uid('game'); card.querySelector('.editor-home').value=data.home||''; card.querySelector('.editor-away').value=data.away||'';
  const [date='',time='']=String(data.kickoff||'').split(' '); card.querySelector('.editor-date').value=date; card.querySelector('.editor-time').value=time;
  const condHost=card.querySelector('.condition-editor'); (data.conditions?.length?data.conditions:[{type:'goals_over',value:1.5}]).forEach(c=>addConditionEditor(condHost,c));
  card.querySelector('.add-condition').addEventListener('click',()=>addConditionEditor(condHost)); card.querySelector('.remove-game').addEventListener('click',()=>card.remove()); host.append(card); renumberEditor();
}
function renumberEditor(){document.querySelectorAll('.editor-card').forEach((c,i)=>c.querySelector('.editor-game-title').textContent=`Jogo ${i+1}`);}
function openTicketDialog(ticket=null){
  editingTicketId=ticket?.id||null; document.querySelector('#dialogTitle').textContent=ticket?'Editar bilhete':'Novo bilhete'; document.querySelector('#ticketName').value=ticket?.name||''; document.querySelector('#gameEditor').innerHTML='';
  (ticket?.selections?.length?ticket.selections:[{}]).forEach(addGameEditor); document.querySelector('#ticketDialog').showModal();
}
function readEditor(){
  const name=document.querySelector('#ticketName').value.trim(); if(!name)throw new Error('Informe o nome do bilhete.');
  const selections=[...document.querySelectorAll('.editor-card')].map(card=>{
    const home=card.querySelector('.editor-home').value.trim(),away=card.querySelector('.editor-away').value.trim(),date=card.querySelector('.editor-date').value,time=card.querySelector('.editor-time').value;
    if(!home||!away||!date||!time)throw new Error('Preencha times, data e horário de todos os jogos.');
    const conditions=[...card.querySelectorAll('.condition-edit-row')].map(row=>{const type=row.querySelector('.condition-type').value,team=row.querySelector('.condition-team').value.trim(),value=Number(row.querySelector('.condition-value').value);if(type==='winner'&&!team)throw new Error('Informe o time vencedor na condição.');return{type,value:type==='winner'?null:value,team:type==='winner'?team:null,label:conditionLabel(type,value,team)};});
    return{id:card.dataset.id||uid('game'),home,away,kickoff:`${date} ${time}`,conditions};
  });
  return{id:editingTicketId||uid('ticket'),name,selections};
}

function saveDialogTicket(){
  try{const ticket=readEditor(),idx=tickets.findIndex(t=>t.id===ticket.id);if(idx>=0)tickets[idx]=ticket;else tickets.unshift(ticket);activeTicketId=ticket.id;localStorage.setItem(ACTIVE_KEY,activeTicketId);saveTickets();state.clear();document.querySelector('#ticketDialog').close();render();refresh();}catch(e){alert(e.message);}
}
function deleteActiveTicket(){const ticket=activeTicket();if(!ticket)return;if(!confirm(`Excluir o bilhete "${ticket.name}"?`))return;tickets=tickets.filter(t=>t.id!==ticket.id);saveTickets();activeTicketId=tickets[0]?.id||null;if(activeTicketId)localStorage.setItem(ACTIVE_KEY,activeTicketId);else localStorage.removeItem(ACTIVE_KEY);state.clear();render();refresh();}

document.querySelector('#refreshButton').addEventListener('click',refresh);
document.querySelector('#newTicketButton').addEventListener('click',()=>openTicketDialog());
document.querySelector('#emptyAddButton').addEventListener('click',()=>openTicketDialog());
document.querySelector('#editTicketButton').addEventListener('click',()=>openTicketDialog(activeTicket()));
document.querySelector('#deleteTicketButton').addEventListener('click',deleteActiveTicket);
document.querySelector('#ticketSelect').addEventListener('change',e=>{activeTicketId=e.target.value;localStorage.setItem(ACTIVE_KEY,activeTicketId);state.clear();render();refresh();});
document.querySelector('#addGameButton').addEventListener('click',()=>addGameEditor());
document.querySelector('#ticketForm').addEventListener('submit',e=>{e.preventDefault();saveDialogTicket();});
document.querySelector('#closeDialogButton').addEventListener('click',()=>document.querySelector('#ticketDialog').close());
document.querySelector('#cancelDialogButton').addEventListener('click',()=>document.querySelector('#ticketDialog').close());

render(); refresh(); setInterval(refresh,30000);
