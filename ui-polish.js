(function initUiPolish(){
  function ensureToastStack(){
    let stack=document.querySelector('.toast-stack');
    if(!stack){stack=document.createElement('div');stack.className='toast-stack';stack.setAttribute('aria-live','polite');document.body.append(stack);}return stack;
  }
  window.showAppToast=function(message,detail='',type='success'){
    const stack=ensureToastStack(),toast=document.createElement('div');
    toast.className=`app-toast ${type==='success'?'':type}`;
    const icon=type==='error'?'!':type==='warn'?'•':'✓';
    toast.innerHTML=`<i>${icon}</i><div><strong>${message}</strong>${detail?`<span>${detail}</span>`:''}</div>`;
    stack.append(toast);
    setTimeout(()=>{toast.classList.add('out');setTimeout(()=>toast.remove(),220);},3200);
  };

  const main=document.querySelector('main.container');
  if(main){
    const nav=document.createElement('nav');nav.className='quick-nav';nav.innerHTML=`<div class="quick-nav-links"><a href="#discover-area" data-target="discover-area">⚽ Próximos jogos</a><a href="#ticket-area" data-target="ticket-area">🎫 Bilhete ativo</a><a href="#games" data-target="games">📊 Monitor</a></div><span class="quick-nav-meta">Atualização automática a cada 30s</span>`;
    main.insertBefore(nav,main.firstChild);
    const firstPanel=main.querySelector('.discover-panel');if(firstPanel)firstPanel.id='discover-area';
    const ticketBar=main.querySelector('.ticket-bar');if(ticketBar)ticketBar.id='ticket-area';
    const links=[...nav.querySelectorAll('a')];
    links.forEach(a=>a.addEventListener('click',()=>{links.forEach(x=>x.classList.remove('active'));a.classList.add('active');}));
    const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!visible)return;links.forEach(a=>a.classList.toggle('active',a.dataset.target===visible.target.id));},{rootMargin:'-120px 0px -65% 0px',threshold:[0,.1,.25]});
    ['discover-area','ticket-area','games'].forEach(id=>{const el=document.getElementById(id);if(el)observer.observe(el);});
  }

  document.addEventListener('click',event=>{
    const add=event.target.closest('.discover-add');
    if(add){showAppToast('Jogo preparado para o bilhete','Confira as condições antes de salvar.');}
  },true);

  const refreshButton=document.querySelector('#refreshButton');
  if(refreshButton)refreshButton.addEventListener('click',()=>showAppToast('Atualizando painel','Buscando os dados mais recentes.','warn'));

  const originalAlert=window.alert.bind(window);
  window.alert=function(message){
    const text=String(message||'');
    if(/não consegui|falha|erro|preencha|informe/i.test(text)){showAppToast('Atenção',text,'error');return;}
    showAppToast('Informação',text,'warn');
  };

  window.addEventListener('offline',()=>showAppToast('Sem internet','Os dados ao vivo serão retomados quando a conexão voltar.','error'));
  window.addEventListener('online',()=>showAppToast('Conexão restaurada','O monitor pode atualizar os jogos novamente.'));
})();
