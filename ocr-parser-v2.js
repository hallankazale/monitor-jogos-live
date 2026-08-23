(() => {
  const MARKET_RE = /(criar\s+aposta|resultado\s+final|total\s+de\s+gols?|escanteios?|cantos?|cart[oõ]es?\s+vermelhos?|mais\s+de|menos\s+de|m[uú]ltipla|betano|odd|futebol|ao\s+vivo)/i;
  const STATUS_RE = /^(agendado|encerrado|live|ao vivo)$/i;

  function clean(line) {
    return String(line || '')
      .replace(/[|•●■□©®™]/g, ' ')
      .replace(/[“”„]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalized(line) {
    return clean(line)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function parseDateTimeFlexible(line) {
    const value = clean(line);
    const strict = value.match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4}).*?(\d{1,2})\s*[:h.]\s*(\d{2})/i);
    const loose = strict || value.match(/\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2}).*?(\d{1,2})\s+(\d{2})\b/);
    if (!loose) return null;
    let year = Number(loose[3]);
    if (year < 100) year += 2000;
    const month = Number(loose[2]);
    const day = Number(loose[1]);
    const hour = Number(loose[4]);
    const minute = Number(loose[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    return {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  }

  function looksLikeTeam(line) {
    const value = clean(line);
    const n = normalized(value);
    if (!value || value.length < 2 || value.length > 60) return false;
    if (MARKET_RE.test(value) || STATUS_RE.test(value) || parseDateTimeFlexible(value)) return false;
    if (/^[\d\W_]+$/.test(value)) return false;
    if (/^(sim|nao|não|ok|x|vs|v)$/i.test(value)) return false;
    if (/\b\d+[,.]\d+\b/.test(value) && value.replace(/[\d\s,.:/-]/g, '').length < 3) return false;
    return /[a-zà-ÿ]/i.test(n);
  }

  function marketConditions(lines, home, away) {
    const text = lines.map(clean).join('\n');
    const simplified = normalized(text).replace(/\bo\b/g, '0');
    const out = [];
    const seen = new Set();
    const add = (type, value = null, team = null) => {
      const key = `${type}|${value ?? ''}|${team ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type, value, team, label: conditionLabel(type, value, team) });
    };

    for (const m of simplified.matchAll(/mais\s+d[eé]?\s*(\d+(?:[.,]\d+)?)[^\n]{0,55}(escanteio|canto)/gi)) add('corners_over', Number(m[1].replace(',', '.')));
    for (const m of simplified.matchAll(/mais\s+d[eé]?\s*(\d+(?:[.,]\d+)?)[^\n]{0,55}(gol|total\s+de\s+gol)/gi)) add('goals_over', Number(m[1].replace(',', '.')));
    for (const m of simplified.matchAll(/menos\s+d[eé]?\s*(\d+(?:[.,]\d+)?)[^\n]{0,70}(cartao|cartoes|vermelh)/gi)) add('reds_under', Number(m[1].replace(',', '.')));

    // OCR da Betano frequentemente separa "Mais de 1.5" do nome do mercado na linha seguinte.
    lines.forEach((line, i) => {
      const n = normalized(line);
      const num = n.match(/(?:mais|ma[i1]s)\s+d[eé]?\s*(\d+(?:[.,]\d+)?)/i);
      const under = n.match(/(?:menos|men[o0]s)\s+d[eé]?\s*(\d+(?:[.,]\d+)?)/i);
      const context = normalized(lines.slice(Math.max(0, i - 1), i + 3).join(' '));
      if (num) {
        const value = Number(num[1].replace(',', '.'));
        if (/escante|canto/.test(context)) add('corners_over', value);
        else if (/gol/.test(context)) add('goals_over', value);
      }
      if (under) {
        const value = Number(under[1].replace(',', '.'));
        if (/cart|vermelh/.test(context)) add('reds_under', value);
      }
    });

    const finalIndex = lines.findIndex(line => /resultado\s+final/i.test(normalized(line)));
    if (finalIndex >= 0) {
      const around = normalized(lines.slice(Math.max(0, finalIndex - 3), finalIndex + 4).join(' '));
      const homeN = normalized(home);
      const awayN = normalized(away);
      const homePos = homeN ? around.lastIndexOf(homeN) : -1;
      const awayPos = awayN ? around.lastIndexOf(awayN) : -1;
      if (homePos >= 0 || awayPos >= 0) add('winner', null, awayPos > homePos ? away : home);
    }

    return out;
  }

  function blocksFromMarkers(lines) {
    const markers = [];
    lines.forEach((line, index) => {
      if (/criar\s+aposta/i.test(normalized(line))) markers.push(index);
    });
    if (!markers.length) return [];
    return markers.map((start, i) => lines.slice(start, i + 1 < markers.length ? markers[i + 1] : lines.length));
  }

  function blocksFromDates(lines) {
    const dates = [];
    lines.forEach((line, index) => { if (parseDateTimeFlexible(line)) dates.push(index); });
    if (!dates.length) return [];
    return dates.map((idx, i) => {
      const start = i ? dates[i - 1] + 1 : Math.max(0, idx - 10);
      const end = i + 1 < dates.length ? dates[i + 1] : Math.min(lines.length, idx + 14);
      return lines.slice(start, end);
    });
  }

  function extractGame(block) {
    let dateLineIndex = block.findIndex(line => parseDateTimeFlexible(line));
    if (dateLineIndex < 0) return null;
    const dt = parseDateTimeFlexible(block[dateLineIndex]);

    // Em bilhetes Betano, os times ficam normalmente antes da data/hora.
    let candidates = block.slice(Math.max(0, dateLineIndex - 9), dateLineIndex).filter(looksLikeTeam);
    const unique = [];
    candidates.forEach(line => {
      const value = clean(line).replace(/^[-–—]+|[-–—]+$/g, '').trim();
      if (value && !unique.some(x => normalized(x) === normalized(value))) unique.push(value);
    });

    // Se o OCR deslocou a data, tenta também linhas logo depois dela.
    if (unique.length < 2) {
      block.slice(dateLineIndex + 1, dateLineIndex + 6).filter(looksLikeTeam).forEach(line => {
        const value = clean(line);
        if (!unique.some(x => normalized(x) === normalized(value))) unique.push(value);
      });
    }
    if (unique.length < 2) return null;

    const home = unique[Math.max(0, unique.length - 2)];
    const away = unique[unique.length - 1];
    const conditions = marketConditions(block, home, away);
    return {
      id: uid('game'),
      home,
      away,
      kickoff: `${dt.date} ${dt.time}`,
      conditions: conditions.length ? conditions : [{ type: 'goals_over', value: 0.5, team: null, label: 'Mais de 0,5 gols' }],
      _confidence: conditions.length ? 'medium' : 'low',
    };
  }

  function parseTicketTextV2(raw) {
    const lines = String(raw || '').split(/\r?\n/).map(clean).filter(Boolean);
    let blocks = blocksFromMarkers(lines);
    if (!blocks.length) blocks = blocksFromDates(lines);

    const selections = [];
    const signatures = new Set();
    blocks.forEach(block => {
      const game = extractGame(block);
      if (!game) return;
      const signature = `${normalized(game.home)}|${normalized(game.away)}|${game.kickoff}`;
      if (signatures.has(signature)) return;
      signatures.add(signature);
      selections.push(game);
    });

    return {
      id: uid('ticket'),
      name: `Bilhete importado ${new Date().toLocaleDateString('pt-BR')}`,
      selections,
      rawText: raw,
    };
  }

  function openReview(ticket, rawText) {
    closeImportDialog();
    if (ticket.selections.length) {
      openTicketDialog(ticket);
      document.querySelector('#dialogTitle').textContent = 'Conferir bilhete importado';
      editingTicketId = null;
      document.querySelector('#ticketName').value = ticket.name;
      return;
    }

    // Nunca bloqueia a importação: abre uma ficha em branco para conferência manual
    // e preserva o OCR no console para diagnóstico.
    console.warn('OCR sem jogos estruturados. Texto reconhecido:', rawText);
    openTicketDialog({
      id: uid('ticket'),
      name: `Bilhete para conferir ${new Date().toLocaleDateString('pt-BR')}`,
      selections: [{ id: uid('game'), home: '', away: '', kickoff: '', conditions: [{ type: 'goals_over', value: 0.5, label: 'Mais de 0,5 gols' }] }],
    });
    document.querySelector('#dialogTitle').textContent = 'Conferir leitura do print';
    editingTicketId = null;
  }

  function analyzeImportV2() {
    const text = document.querySelector('#ocrText').value.trim();
    if (!text) {
      alert('Escolha um print ou cole o texto do bilhete.');
      return;
    }
    const ticket = parseTicketTextV2(text);
    openReview(ticket, text);
  }

  function installParserV2() {
    const oldButton = document.querySelector('#analyzeImportButton');
    if (!oldButton || oldButton.dataset.parserV2 === '1') return;
    const button = oldButton.cloneNode(true);
    button.dataset.parserV2 = '1';
    oldButton.replaceWith(button);
    button.addEventListener('click', analyzeImportV2);
  }

  installParserV2();
})();
