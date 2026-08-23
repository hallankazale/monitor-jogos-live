# Monitor Jogos Live

Painel para acompanhar em tempo real as condições de uma múltipla de futebol: placar, gols, escanteios, cartões vermelhos e resultado.

## Arquitetura

- Frontend estático: `index.html`, `styles.css`, `app.js`
- Backend: FastAPI em `backend/`
- Fonte de dados: EasySoccerData usando Sofascore
- Atualização do painel: automática a cada 60 segundos

## Por que EasySoccerData

O projeto fornece partidas do dia, eventos ao vivo e estatísticas de jogo sem exigir uma chave de API no navegador. O backend faz a consulta e entrega ao frontend apenas os dados necessários.

## Rodar o backend localmente

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Teste:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/matches
```

## Publicação

O arquivo `render.yaml` já prepara o backend para o Render. Depois da publicação, copie `config.example.js` para `config.js` e informe a URL do backend.

## Segurança

Nenhuma chave privada é colocada no frontend. Esta versão usa uma fonte pública via EasySoccerData. Antes de uso comercial, verifique os termos de uso das fontes de dados e restrinja `ALLOWED_ORIGINS` ao domínio do painel.

## Testes essenciais

1. `/health` deve retornar status `ok`.
2. `/matches` deve retornar as 10 partidas monitoradas.
3. Durante uma partida ao vivo, minuto e placar devem atualizar.
4. Escanteios devem refletir `corner_kicks` do Sofascore.
5. Cartões vermelhos são contados pelos incidentes da partida.
6. Ao encerrar, as condições do frontend devem mudar para cumprida ou perdida.
