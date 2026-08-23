const DISCOVER_API = window.MONITOR_API_BASE || 'http://127.0.0.1:8000';

(function initDiscovery(){
  const main=document.querySelector('main.container');
  if(!main)return;
  const section=document.createElement('section');
  section.className='discover-panel';
  section.innerHTML=`
    <div class="discover-head">
      <div><span class="section-kicker">DESCOBRIR PARTIDAS</span><h2>Próximos jogos</h2><p>Encontre times, escolha a equipe exata e veja os próximos confrontos em ligas do mundo todo.</p></div>
      <div class="discover-head-actions"><span class="discover-count" id="discoverCount">ATÉ 15 JOGOS</span><span class="discover-source" id="discoverSource">FUTEBOL GLOBAL</span></div>
    </div>
    <div class="discover-tools">
      <div class="discover-search-wrap">
        <label class="discover-label" for="discoverSearch">Pesquisar time ou liga</label>
        <div class="discover-search-box"><span class="discover-search-icon">⌕</span><input id="discoverSearch" class="discover-input" autocomplete="off" placeholder="Ex.: Flamengo, Barcelona, Premier League" /><button id="discoverClear" type="button" aria-label="Limpar pesquisa" hidden>×</button></div>
        <div id="discoverSelected" class="discover-selected" hidden></div>
        <div id="discoverSuggestions" class="discover-suggestions" hidden></div>
      </div>
      <div>
        <label class="discover-label" for="discoverDate">Dia de referência</label>
        <input id="discoverDate" class="discover-date" type="date" />
      </div>
      <button id="discoverButton" class="primary-button discover-toggle" type="button">Buscar jogos</button>
    </div>
    <div class="discover-chips"><button type="button" data-day="0" class="discover-chip active">Hoje</button><button type="button" data-day="1" class="discover-chip">Amanhã</button><button type="button" data-day="7" class="discover-chip">+7 dias</button></div>
    <div id="discoverGrid" class="discover-grid"><div class="discover-state"><span class="discover-loader"></span>Carregando próximos jogos...</div></div>`;
  main.insertBefore(section, main.firstChild);

  const search=document.querySelector('#discoverSearch');
  const date=document.querySelector('#discoverDate');
  const suggestions=document.querySelector('#discoverSuggestions');
  const grid=document.querySelector('#discoverGrid');
  const count=document.querySelector('#discoverCount');
  const source=document.querySelector('#discoverSource');
  const button=document.querySelector('#discoverButton');
  const clearButton=document.querySelector('#discoverClear');
  const selected=document.querySelector('#discoverSelected');
  let debounceTimer=null;
  let selectedEntity=null;

  const now=new Date();
  setDate(now);

  function setDate(value){date.value=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
  function esc(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
  function teamLogo(id){return id?`https://api.sofascore.app/api/v1/team/${id}/image`:'';}
  function formatDate(value){if(!value)return'--';const[d1,m1,y1]=value.split('-');return`${y1}/${m1}/${d1}`.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/,(_,y,m,d)=>`${d}/${m}/${y}`);}
  function variantClass(variant){return String(variant||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');}

  function updateSelectedEntity(){
    if(!selectedEntity){selected.hidden=true;selected.innerHTML='';return;}
    selected.innerHTML=`<div><strong>${esc(selectedEntity.name)}</strong><span>${esc(selectedEntity.variant||selectedEntity.type)} · ${esc(selectedEntity.country||'Futebol')}</span></div><button type="button" aria-label="Remover seleção">×</button>`;
    selected.hidden=false;
    selected.querySelector('button').addEventListener('click',()=>{selectedEntity=null;search.value='';clearButton.hidden=true;updateSelectedEntity();loadUpcoming();});
  }

  async function loadSuggestions(){
    const q=search.value.trim();
    clearButton.hidden=!q;
    if(q.length<2){suggestions.hidden=true;suggestions.innerHTML='';return;}
    try{
      const response=await fetch(`${DISCOVER_API.replace(/\/$/,'')}/discover/search?q=${encodeURIComponent(q)}&limit=12`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      suggestions.innerHTML='';
      for(const item of data.results||[]){
        const el=document.createElement('button');
        el.type='button';el.className='suggestion-item';
        const kind=item.type==='team'?'TIME':'LIGA';
        el.innerHTML=`<span class="suggestion-avatar ${item.type}">${item.type==='team'?'⚽':'🏆'}</span><span class="suggestion-main"><strong>${esc(item.name)}</strong><small>${esc(item.variant||kind)} · ${esc(item.country||'Futebol')}</small></span><span class="suggestion-type ${variantClass(item.variant)}">${esc(kind)}</span>`;
        el.addEventListener('click',()=>{selectedEntity=item;search.value=item.name;clearButton.hidden=false;suggestions.hidden=true;updateSelectedEntity();loadUpcoming();});
        suggestions.append(el);
      }
      suggestions.hidden=!suggestions.children.length;
    }catch{suggestions.hidden=true;}
  }

  function addToTicket(event){
    if(typeof openTicketDialog!=='function'||typeof addGameEditor!=='function')return;
    const ticket=typeof activeTicket==='function'?activeTicket():null;
    openTicketDialog(ticket||null);
    if(ticket?.selections?.length){
      addGameEditor({id:`game-${event.eventId||Date.now()}`,home:event.home,away:event.away,kickoff:`${event.date} ${event.time}`,conditions:[{type:'goals_over',value:0.5,label:'Mais de 0,5 gols'}]});
    }else{
      const cards=document.querySelectorAll('.editor-card');
      if(cards.length===1&&!(cards[0].querySelector('.editor-home')?.value||'').trim())cards[0].remove();
      addGameEditor({id:`game-${event.eventId||Date.now()}`,home:event.home,away:event.away,kickoff:`${event.date} ${event.time}`,conditions:[{type:'goals_over',value:0.5,label:'Mais de 0,5 gols'}]});
    }
    document.querySelector('#dialogTitle').textContent='Adicionar jogo ao bilhete';
  }

  function renderEvents(events){
    grid.innerHTML='';
    count.textContent=`${events.length} JOGO${events.length===1?'':'S'}`;
    if(!events.length){grid.innerHTML='<div class="discover-state"><span class="discover-empty-icon">⌕</span><strong>Nenhum jogo encontrado</strong><small>Tente outro time, liga ou deixe a busca vazia para ver os jogos do dia.</small></div>';return;}
    for(const event of events){
      const card=document.createElement('article');card.className='discover-card';
      const homeLogo=teamLogo(event.homeTeamId),awayLogo=teamLogo(event.awayTeamId);
      card.innerHTML=`
        <div class="discover-card-head"><span class="discover-league" title="${esc(event.league)}">${esc(event.league)}</span><span class="discover-country">${esc(event.country)}</span></div>
        <div class="discover-fixture">
          <div class="discover-team"><i class="discover-logo" ${homeLogo?`style="background-image:url('${homeLogo}')"`:''}></i><span title="${esc(event.home)}">${esc(event.home)}</span></div>
          <div class="discover-center"><span class="discover-time-big">${esc(event.time)}</span><span class="discover-vs">VS</span></div>
          <div class="discover-team away"><span title="${esc(event.away)}">${esc(event.away)}</span><i class="discover-logo" ${awayLogo?`style="background-image:url('${awayLogo}')"`:''}></i></div>
        </div>
        <div class="discover-card-foot"><span class="discover-date-pill">${formatDate(event.date)}</span><button class="discover-add" type="button"><span>＋</span> Adicionar</button></div>`;
      card.querySelector('.discover-add').addEventListener('click',()=>addToTicket(event));
      grid.append(card);
    }
  }

  async function loadUpcoming(){
    button.disabled=true;button.textContent='Buscando...';
    grid.innerHTML='<div class="discover-state"><span class="discover-loader"></span>Buscando partidas...</div>';
    const params=new URLSearchParams({date:date.value,limit:'15'});
    const q=search.value.trim();if(q)params.set('q',q);
    if(selectedEntity?.type==='team')params.set('team_id',String(selectedEntity.id));
    try{
      const response=await fetch(`${DISCOVER_API.replace(/\/$/,'')}/discover/upcoming?${params.toString()}`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      source.textContent=data.source==='exact-team'?'TIME EXATO':data.source==='global-schedule'?'JOGOS DO DIA':'BUSCA AMPLA';
      renderEvents(data.events||[]);
    }catch(e){grid.innerHTML='<div class="discover-state"><strong>Não foi possível carregar os jogos.</strong><small>Confira se o backend está ligado e tente novamente.</small></div>';count.textContent='ERRO';source.textContent='SEM CONEXÃO';}
    finally{button.disabled=false;button.textContent='Buscar jogos';}
  }

  search.addEventListener('input',()=>{if(selectedEntity&&search.value!==selectedEntity.name){selectedEntity=null;updateSelectedEntity();}clearTimeout(debounceTimer);debounceTimer=setTimeout(loadSuggestions,220);});
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();suggestions.hidden=true;loadUpcoming();}});
  clearButton.addEventListener('click',()=>{search.value='';selectedEntity=null;clearButton.hidden=true;suggestions.hidden=true;updateSelectedEntity();loadUpcoming();search.focus();});
  date.addEventListener('change',()=>{document.querySelectorAll('.discover-chip').forEach(chip=>chip.classList.remove('active'));loadUpcoming();});
  button.addEventListener('click',()=>{suggestions.hidden=true;loadUpcoming();});
  document.querySelectorAll('.discover-chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.discover-chip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');const d=new Date();d.setDate(d.getDate()+Number(chip.dataset.day||0));setDate(d);loadUpcoming();}));
  document.addEventListener('click',e=>{if(!e.target.closest('.discover-search-wrap'))suggestions.hidden=true;});
  loadUpcoming();
})();
