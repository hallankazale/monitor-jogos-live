const DISCOVER_API = window.MONITOR_API_BASE || 'http://127.0.0.1:8000';

(function initDiscovery(){
  const main=document.querySelector('main.container');
  if(!main)return;
  const section=document.createElement('section');
  section.className='discover-panel';
  section.innerHTML=`
    <div class="discover-head">
      <div><span class="section-kicker">DESCOBRIR PARTIDAS</span><h2>Próximos jogos</h2><p>Pesquise times com autocomplete ou veja os jogos do dia em ligas do mundo todo.</p></div>
      <span class="discover-count" id="discoverCount">ATÉ 15 JOGOS</span>
    </div>
    <div class="discover-tools">
      <div class="discover-search-wrap">
        <label class="discover-label" for="discoverSearch">Pesquisar time ou liga</label>
        <input id="discoverSearch" class="discover-input" autocomplete="off" placeholder="Ex.: Palmeiras, Barcelona, Premier League" />
        <div id="discoverSuggestions" class="discover-suggestions" hidden></div>
      </div>
      <div>
        <label class="discover-label" for="discoverDate">Dia</label>
        <input id="discoverDate" class="discover-date" type="date" />
      </div>
      <button id="discoverButton" class="primary-button discover-toggle" type="button">Buscar jogos</button>
    </div>
    <div id="discoverGrid" class="discover-grid"><div class="discover-state">Carregando próximos jogos...</div></div>`;
  main.insertBefore(section, main.firstChild);

  const search=document.querySelector('#discoverSearch');
  const date=document.querySelector('#discoverDate');
  const suggestions=document.querySelector('#discoverSuggestions');
  const grid=document.querySelector('#discoverGrid');
  const count=document.querySelector('#discoverCount');
  const button=document.querySelector('#discoverButton');
  let debounceTimer=null;

  const now=new Date();
  date.value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  function esc(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
  function teamLogo(id){return id?`https://api.sofascore.app/api/v1/team/${id}/image`:'';}

  async function loadSuggestions(){
    const q=search.value.trim();
    if(q.length<2){suggestions.hidden=true;suggestions.innerHTML='';return;}
    try{
      const response=await fetch(`${DISCOVER_API.replace(/\/$/,'')}/discover/search?q=${encodeURIComponent(q)}&limit=10`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      suggestions.innerHTML='';
      for(const item of data.results||[]){
        const el=document.createElement('button');
        el.type='button';el.className='suggestion-item';
        el.innerHTML=`<span class="suggestion-main"><strong>${esc(item.name)}</strong><small>${esc(item.country||'Futebol')}</small></span><span class="suggestion-type">${item.type==='team'?'TIME':'LIGA'}</span>`;
        el.addEventListener('click',()=>{search.value=item.name;suggestions.hidden=true;loadUpcoming();});
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
    if(!events.length){grid.innerHTML='<div class="discover-state">Nenhum jogo encontrado para esse filtro. Tente outro dia ou pesquise por um time.</div>';return;}
    for(const event of events){
      const card=document.createElement('article');card.className='discover-card';
      const homeLogo=teamLogo(event.homeTeamId),awayLogo=teamLogo(event.awayTeamId);
      card.innerHTML=`
        <div class="discover-card-head"><span class="discover-league">${esc(event.league)}</span><span>${esc(event.country)}</span></div>
        <div class="discover-fixture">
          <div class="discover-team"><i class="discover-logo" ${homeLogo?`style="background-image:url('${homeLogo}')"`:''}></i><span>${esc(event.home)}</span></div>
          <span class="discover-vs">VS</span>
          <div class="discover-team away"><span>${esc(event.away)}</span><i class="discover-logo" ${awayLogo?`style="background-image:url('${awayLogo}')"`:''}></i></div>
        </div>
        <div class="discover-card-foot"><span class="discover-time">${esc(event.date)} · <strong>${esc(event.time)}</strong></span><button class="discover-add" type="button">+ Bilhete</button></div>`;
      card.querySelector('.discover-add').addEventListener('click',()=>addToTicket(event));
      grid.append(card);
    }
  }

  async function loadUpcoming(){
    button.disabled=true;button.textContent='Buscando...';
    grid.innerHTML='<div class="discover-state">Buscando partidas...</div>';
    const params=new URLSearchParams({date:date.value,limit:'15'});
    const q=search.value.trim();if(q)params.set('q',q);
    try{
      const response=await fetch(`${DISCOVER_API.replace(/\/$/,'')}/discover/upcoming?${params.toString()}`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();renderEvents(data.events||[]);
    }catch(e){grid.innerHTML='<div class="discover-state">Não foi possível carregar os próximos jogos agora. Confira se o backend está ligado.</div>';count.textContent='ERRO';}
    finally{button.disabled=false;button.textContent='Buscar jogos';}
  }

  search.addEventListener('input',()=>{clearTimeout(debounceTimer);debounceTimer=setTimeout(loadSuggestions,250);});
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();suggestions.hidden=true;loadUpcoming();}});
  date.addEventListener('change',loadUpcoming);
  button.addEventListener('click',()=>{suggestions.hidden=true;loadUpcoming();});
  document.addEventListener('click',e=>{if(!e.target.closest('.discover-search-wrap'))suggestions.hidden=true;});
  loadUpcoming();
})();
