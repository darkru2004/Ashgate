/* 재의 문 — 화면(UI). 게임 규칙은 하나도 들어 있지 않고 엔진(AshEngine)만 호출한다. */
(function () {
  'use strict';
  var scn = AshScenario1;
  var eng = AshEngine.create(scn);
  var KEY_RUN = 'ashgate.run.v1', KEY_LG = 'ashgate.legacy.v1';
  var TYPE = { gem: '보석', relic: '유물', spell: '주문' };

  // ---------- 저장소 (localStorage가 막혀 있으면 메모리로) ----------
  var mem = {};
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = JSON.stringify(v); } }
  function load(k) {
    try { var t = localStorage.getItem(k); if (t) return JSON.parse(t); } catch (e) { /* 아래로 */ }
    return mem[k] ? JSON.parse(mem[k]) : null;
  }
  function wipe(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } delete mem[k]; }

  var G = { s: null, screen: 'title', legacy: load(KEY_LG), prepSel: null, modal: null, toastMsg: '', choiceMade: null };
  var app = document.getElementById('app');

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, b) { return Math.max(0, Math.min(100, 100 * a / b)); }
  function pips(n, max) { var r = ''; for (var i = 0; i < max; i++) r += i < n ? '●' : '○'; return r; }
  function saveRun() { if (G.s && !G.s.over) store(KEY_RUN, G.s); }
  function toast(msg) {
    G.toastMsg = msg; render();
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { G.toastMsg = ''; render(); }, 2600);
  }

  // ---------- 행동 실행 ----------
  function run(a) {
    var s = G.s, before = s.log.length;
    var r = eng.act(s, a);
    if (!r.ok) { toast(r.err); return false; }
    G.prepSel = null;
    saveRun();
    if (a.type === 'endMain') {
      var lines = s.log.slice(before);
      var hasFoe = lines.some(function (l) { return l.indexOf('적의 차례') >= 0; });
      if (hasFoe) { G.modal = { type: 'enemy', lines: lines.filter(function (l) { return l.indexOf('술사의 차례') < 0 || true; }) }; }
      else if (s.over) G.screen = 'result';
    } else if (s.over) { G.screen = 'result'; wipe(KEY_RUN); }
    render();
    return true;
  }

  function startGame(useLegacy) {
    G.s = eng.newGame({ legacy: useLegacy ? G.legacy : null });
    G.prepSel = null; G.modal = null; G.choiceMade = null;
    G.screen = 'intro';
    saveRun(); render();
  }

  // ---------- 화면 조각 ----------
  function cardHTML(id, attrs, cls, extra) {
    var c = eng.def(id);
    return '<button class="card ' + c.type + ' ' + (cls || '') + '" ' + (attrs || '') + '>' +
      (c.type !== 'gem' || c.cost ? '<span class="cost">' + c.cost + '</span>' : '') +
      '<span class="nm">' + esc(c.name) + '</span><span class="tp">' + TYPE[c.type] + (extra ? ' · ' + extra : '') + '</span>' +
      '<span class="ef">' + esc(eng.describe(c.effects)) + '</span></button>';
  }

  function statusHTML(s) {
    var u = scn.nemesis.unleash;
    return '<div class="stats">' +
      '<div class="stat boss"><label><span>' + esc(scn.nemesis.name) + '</span></label><b>' + s.nemLife + ' / ' + s.nemMax + '</b><div class="bar"><i style="width:' + pct(s.nemLife, s.nemMax) + '%"></i></div></div>' +
      '<div class="stat grave"><label><span>' + esc(scn.gravehold.name) + '</span></label><b>' + s.graveLife + ' / ' + s.graveMax + '</b><div class="bar"><i style="width:' + pct(s.graveLife, s.graveMax) + '%"></i></div></div>' +
      '<div class="stat mage"><label><span>술사 ' + esc(scn.mage.name) + '</span></label><b>' + s.mageLife + ' / ' + s.mageMax + '</b><div class="bar"><i style="width:' + pct(s.mageLife, s.mageMax) + '%"></i></div></div>' +
      '<div class="stat"><label><span>충전 「' + esc(scn.mage.ability.name) + '」</span><span>' + esc(eng.describe(scn.mage.ability.effects)) + '</span></label><div class="row"><span class="pips">' + pips(s.charge, scn.mage.ability.cost) + '</span><span class="sp"></span>' +
        '<button class="btn sm" data-act="ability"' + (eng.validate(s, { type: 'ability' }) ? ' disabled' : '') + '>사용</button></div></div>' +
      '<div class="stat"><label><span>굶주림</span><span>' + u.threshold + '이 되면 성채 -3</span></label><span class="pips">' + pips(s.hunger, u.threshold) + '</span></div>' +
      '</div>';
  }

  function phaseHTML(s) {
    var m = s.turnDeck.filter(function (x) { return x === 'M'; }).length;
    var n = s.turnDeck.length - m;
    var label = s.phase === 'cast' ? '① 시전 단계' : '② 주 단계';
    var hint = s.phase === 'cast'
      ? '지난 차례에 준비한 주문을 시전한다. 닫힌 균열의 주문은 반드시 시전해야 한다.'
      : '카드를 눌러 사용 → 불씨로 구매·집중·열기 → 주문은 균열에 준비 → 차례 종료.';
    return '<div class="phase"><b>술사의 차례 ' + s.turnNo + '</b><span>' + label + '</span>' +
      (s.phase === 'main' ? '<span>불씨 <span class="ember">' + s.ember + '</span></span>' : '') +
      '<span class="sp"></span><span class="dim">남은 턴 카드 — 술사 ' + m + ' · 적 ' + n + '</span></div>' +
      '<p class="hint">' + hint + '</p>';
  }

  function enemyHTML(s) {
    var h = '<div class="enemy"><div class="bossbox"><div class="nm">' + esc(scn.nemesis.name) + '</div><span class="tag">적 덱 ' + s.nemDeck.length + '장</span><span class="tag">버림 ' + s.nemDiscard.length + '장</span></div>';
    s.powers.forEach(function (p, i) {
      var d = scn.nemesis.cards[p.id];
      var dis = eng.validate(s, { type: 'disarm', idx: i }) ? ' disabled' : '';
      h += '<div class="foe power"><div class="cd" title="남은 적 차례">' + p.tokens + '</div><div class="tx"><span class="nm">' + esc(d.name) + '</span><small>힘 · ' + p.tokens + '번의 적 차례 뒤 발동: ' + esc(eng.describe(d.effects)) + '</small></div>' +
        '<button class="btn sm" data-act="disarm" data-i="' + i + '"' + dis + '>해제 (불씨 ' + d.disarm + ')</button></div>';
    });
    s.minions.forEach(function (m) {
      var d = scn.nemesis.cards[m.id];
      h += '<div class="foe"><div class="cd" style="color:var(--boss)" title="생명">' + m.life + '</div><div class="tx"><span class="nm">' + esc(d.name) + '</span><small>하수인 · 매 적 차례: ' + esc(eng.describe(d.each)) + '</small></div></div>';
    });
    if (!s.powers.length && !s.minions.length) h += '<div class="dim" style="font-size:13px">아직 나와 있는 힘이나 하수인이 없다.</div>';
    return h + '</div>';
  }

  function breachHTML(s, i) {
    var b = s.breaches[i], d = scn.mage.breaches[i];
    var castable = eng.castables(s).indexOf(i) >= 0;
    var canPrep = G.prepSel != null && !eng.validate(s, { type: 'prep', idx: G.prepSel, breach: i });
    var body = b.prepped
      ? '<div class="pp">' + esc(eng.name(b.prepped)) + '<small>' + (b.preppedTurn < s.turnNo ? '시전 가능' : '다음 차례부터 시전') + '</small></div>'
      : '<div class="em">' + (b.open || b.focusedTurn === s.turnNo ? '주문을 준비할 수 있다' : '닫힘') + '</div>';
    var acts = '';
    if (castable && s.phase === 'cast') acts += '<button class="btn sm primary" data-act="cast" data-b="' + i + '">시전</button>';
    if (!b.open && s.phase === 'main') {
      acts += '<button class="btn sm" data-act="focus" data-b="' + i + '"' + (eng.validate(s, { type: 'focus', breach: i }) ? ' disabled' : '') + '>집중 ' + d.focusCost + '</button>';
      acts += '<button class="btn sm" data-act="open" data-b="' + i + '"' + (eng.validate(s, { type: 'open', breach: i }) ? ' disabled' : '') + '>열기 ' + eng.openCost(s, i) + '</button>';
    }
    return '<div class="breach ' + (b.open ? 'open' : '') + (canPrep ? ' target' : '') + '"' + (canPrep ? ' data-act="prepTo" data-b="' + i + '"' : '') + '>' +
      '<div class="h"><span>균열 ' + (i + 1) + '</span><span class="bn">' + (b.open ? '열림' : '닫힘 ' + b.focus + '/4') + '</span></div>' +
      '<div class="bn">' + (d.bonusText ? esc(d.bonusText) : '보너스 없음') + '</div>' + body + '<div class="acts">' + acts + '</div></div>';
  }

  function handHTML(s) {
    if (!s.hand.length) return '<div class="dim">손이 비어 있다.</div>';
    return '<div class="cards">' + s.hand.map(function (id, i) {
      var c = eng.def(id), cls = G.prepSel === i ? 'sel' : '';
      return cardHTML(id, 'data-act="hand" data-i="' + i + '"', cls);
    }).join('') + '</div>';
  }

  function supplyHTML(s) {
    var order = [].concat(scn.supply.gems, scn.supply.relics, scn.supply.spells);
    return '<div class="cards">' + order.map(function (id) {
      var c = scn.cards[id], left = s.supply[id];
      var dis = eng.validate(s, { type: 'buy', id: id }) ? ' disabled' : '';
      return cardHTML(id, 'data-act="buy" data-id="' + id + '"' + dis, left ? '' : 'out', '남은 ' + left);
    }).join('') + '</div>';
  }

  function logHTML(s) {
    var lines = s.log.slice(-60);
    return '<div class="log" id="logbox">' + lines.map(function (l) {
      var c = l.charAt(0) === '─' ? 'h' : (/피해를 입었다|폭발|발동|쓰러졌다\.$/.test(l) && /성채|술사/.test(l) ? 'bad' : (/에게 피해|회복|해제|획득/.test(l) ? 'good' : ''));
      return '<div class="' + c + '">' + esc(l) + '</div>';
    }).join('') + '</div>';
  }

  function playHTML() {
    var s = G.s, h = '';
    h += '<div class="topbar"><div class="t">' + esc(scn.title) + '<small>' + esc(scn.chapter) + '</small></div><div class="row">' +
      '<button class="btn sm" data-act="discard">버림 더미</button><button class="btn sm" data-act="rules">규칙</button><button class="btn sm" data-act="menu">메뉴</button></div></div>';
    h += statusHTML(s) + phaseHTML(s);
    h += '<div class="grid"><div class="colB">';
    h += '<div class="sect"><h3>균열 — 열린 균열에 주문을 준비해 두면 다음 차례부터 시전된다</h3><div class="breaches">' + [0, 1, 2, 3].map(function (i) { return breachHTML(s, i); }).join('') + '</div></div>';
    h += '<div class="sect"><h3>손 (' + s.hand.length + '장) · 덱 ' + s.deck.length + ' · 버림 ' + s.discard.length + (G.prepSel != null ? ' — 준비할 균열을 고르세요' : '') + '</h3>' + handHTML(s) + '</div>';
    h += '<div class="sect"><h3>공급처 — 구매한 카드는 버림 더미 맨 위로 간다</h3>' + supplyHTML(s) + '</div></div>';
    h += '<div class="side"><div class="colA"><div class="sect"><h3>적</h3>' + enemyHTML(s) + '</div></div>';
    h += '<div class="colC"><div class="sect"><h3>기록</h3>' + logHTML(s) + '</div></div></div></div>';
    h += '<div class="actionbar">';
    if (s.phase === 'cast') {
      h += '<button class="btn" data-act="endCast"' + (eng.validate(s, { type: 'endCast' }) ? ' disabled' : '') + '>시전 마치고 주 단계로</button>';
    } else {
      h += '<button class="btn primary" data-act="endMain">차례 종료 · 손이 5장이 되도록 뽑는다</button>';
    }
    h += '</div>';
    return h;
  }

  // ---------- 화면: 시작 / 도입 / 결과 ----------
  function titleHTML() {
    var run = load(KEY_RUN);
    return '<div class="center"><h1>재의 문</h1><div class="sub">' + esc(scn.chapter) + ' · 튜토리얼 (구동 확인용 빌드 — 일러스트·사운드 없음)</div>' +
      '<div class="col"><button class="btn primary" data-act="new">새로 시작</button>' +
      (run ? '<button class="btn" data-act="continue">이어하기 (저장된 전투)</button>' : '') +
      (G.legacy ? '<button class="btn" data-act="newLegacy">저장된 레거시를 반영해서 시작</button>' : '') +
      '<button class="btn" data-act="rules">규칙 보기</button><button class="btn" data-act="saves">세이브 데이터 내보내기 / 불러오기</button></div></div>';
  }
  function introHTML() {
    return '<div class="center"><h2>' + esc(scn.chapter) + '</h2><div class="story">' +
      scn.story.intro.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' +
      (G.legacy && G.s.legacy && G.s.legacy.summary ? '<div class="legacybox"><b>이전 세션의 영구 변화가 적용되었다</b><ul>' + G.s.legacy.summary.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="col"><button class="btn primary" data-act="begin">전투 시작</button></div></div>';
  }
  function resultHTML() {
    var s = G.s, win = s.over === 'win', ch = scn.story.choice;
    var h = '<div class="center"><h2>' + (win ? '문이 닫혔다' : '벨란이 무너졌다') + '</h2><div class="sub">' + esc(s.reason) + ' · 술사 차례 ' + s.turnNo + '회 · 적 차례 ' + s.nemTurns + '회</div>';
    h += '<div class="story">' + (win ? scn.story.winText : scn.story.loseText).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>';
    if (win && !G.choiceMade) {
      h += '<p>' + esc(ch.prompt) + '</p><div class="choice">' + ch.options.map(function (o) { return '<button class="btn" data-act="choose" data-o="' + o.id + '">' + esc(o.label) + '</button>'; }).join('') + '</div>';
    } else if (win && G.choiceMade) {
      var o = ch.options.filter(function (x) { return x.id === G.choiceMade; })[0];
      h += '<div class="story"><p>' + esc(o.result) + '</p></div><div class="legacybox"><b>영구 변화 (다음 세션에 반영 · 저장됨)</b><ul>' +
        o.legacy.summary.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="col"><button class="btn primary" data-act="newLegacy">이 레거시로 다시 시작해 보기</button><button class="btn" data-act="newClear">레거시 지우고 처음부터</button><button class="btn" data-act="saves">세이브 데이터 내보내기</button></div>';
    }
    if (!win) h += '<div class="col"><button class="btn primary" data-act="' + (G.legacy ? 'newLegacy' : 'new') + '">다시 도전</button><button class="btn" data-act="title">처음 화면</button></div>';
    return h + '</div>';
  }

  // ---------- 모달 ----------
  function modalHTML() {
    var m = G.modal; if (!m) return '';
    var body = '';
    if (m.type === 'rules') {
      body = '<h2>규칙 요약</h2><ol>' +
        '<li><b>턴 순서</b>: 덱에서 카드를 한 장씩 뽑아 정한다. 술사 3장 + 적 2장이라 연속으로 걸릴 수 있다. 5장을 다 쓰면 다시 섞는다.</li>' +
        '<li><b>술사 차례</b>: ① 시전(지난 차례에 준비한 주문) → ② 주 단계(카드 사용·구매·집중·열기·준비, 순서와 횟수 자유) → ③ 손이 5장이 되도록 뽑기. 쓰지 않은 카드는 손에 남는다.</li>' +
        '<li><b>불씨</b>: 보석·유물을 내면 얻는다. 이번 차례에만 쓰고 사라진다. 구매·집중·균열 열기에 쓴다.</li>' +
        '<li><b>균열과 주문</b>: 주문은 균열에 준비하고 <b>다음 차례부터</b> 시전한다. 닫힌 균열은 그 차례에 집중했을 때만 준비할 수 있고, 그 주문은 다음 차례에 반드시 시전한다. 집중할수록 열기 비용이 줄고 4번 집중하면 열린다.</li>' +
        '<li><b>덱은 섞지 않는다</b>: 덱이 비면 버림 더미가 순서 그대로 새 덱이 된다. 보석을 내는 순서(차례 종료 때 정한다)가 다음 손을 만든다. 오래된 카드가 먼저 뽑힌다.</li>' +
        '<li><b>적</b>: 공격 카드는 즉시 효과, 힘은 카운트다운 뒤 발동(불씨로 해제 가능), 하수인은 매 적 차례 공격하고 피해를 주면 쓰러진다. 굶주림이 3이 되면 성채가 피해를 입는다.</li>' +
        '<li><b>승패</b>: 보스 생명 0이면 승리. 성채나 술사의 생명이 0이면 패배.</li></ol>' +
        '<div class="row"><span class="sp"></span><button class="btn primary" data-act="close">닫기</button></div>';
    } else if (m.type === 'menu') {
      body = '<h2>메뉴</h2><div class="col" style="display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn" data-act="saves">세이브 데이터 내보내기 / 불러오기</button>' +
        '<button class="btn" data-act="title">처음 화면으로 (전투는 자동 저장됨)</button><button class="btn primary" data-act="close">닫기</button></div>';
    } else if (m.type === 'discard') {
      var s = G.s;
      body = '<h2>버림 더미 (' + s.discard.length + '장)</h2><p class="dim">덱이 비면 이 순서 그대로 <b>왼쪽부터</b> 다시 뽑는다. 덱 ' + s.deck.length + '장은 확인할 수 없다.</p><div class="disc">' +
        (s.discard.length ? s.discard.map(function (id, i) { return '<span>' + (i + 1) + '. ' + esc(eng.name(id)) + '</span>'; }).join('') : '<span>비어 있음</span>') +
        '</div><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn primary" data-act="close">닫기</button></div>';
    } else if (m.type === 'target') {
      body = '<h2>' + esc(m.title) + '</h2>' + m.inst.map(function (n, k) {
        var opts = '<button class="chip ' + (m.pick[k] === 'N' ? 'on' : '') + '" data-act="tpick" data-k="' + k + '" data-t="N">' + esc(scn.nemesis.name) + '</button>' +
          G.s.minions.map(function (mi) { return '<button class="chip ' + (m.pick[k] === mi.uid ? 'on' : '') + '" data-act="tpick" data-k="' + k + '" data-t="' + mi.uid + '">' + esc(eng.name(mi.id)) + ' (생명 ' + mi.life + ')</button>'; }).join('');
        return '<p style="margin:10px 0 4px"><b>피해 ' + n + '</b></p><div class="chips">' + opts + '</div>';
      }).join('') + '<div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn" data-act="close">취소</button><button class="btn primary" data-act="tok">확인</button></div>';
    } else if (m.type === 'order') {
      body = '<h2>버림 순서</h2><p class="dim">이번 차례에 낸 카드를 버림 더미에 놓는 순서다. 덱이 비었을 때 <b>위쪽(1번)부터 먼저</b> 뽑힌다.</p>' +
        m.order.map(function (pi, k) {
          return '<div class="ord"><span style="width:20px">' + (k + 1) + '</span><span class="sp">' + esc(eng.name(G.s.played[pi])) + '</span>' +
            '<button class="btn sm" data-act="oup" data-k="' + k + '"' + (k === 0 ? ' disabled' : '') + '>▲</button><button class="btn sm" data-act="odown" data-k="' + k + '"' + (k === m.order.length - 1 ? ' disabled' : '') + '>▼</button></div>';
        }).join('') + '<div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn" data-act="close">취소</button><button class="btn primary" data-act="ook">이 순서로 차례 종료</button></div>';
    } else if (m.type === 'enemy') {
      body = '<h2>적의 차례</h2><div class="log" style="height:auto;max-height:52vh">' + m.lines.map(function (l) {
        var c = l.charAt(0) === '─' ? 'h' : (/피해를 입었다|폭발|발동!|쓰러졌다\.$/.test(l) && /성채|술사/.test(l) ? 'bad' : '');
        return '<div class="' + c + '">' + esc(l) + '</div>';
      }).join('') + '</div><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn primary" data-act="eok">확인</button></div>';
    } else if (m.type === 'saves') {
      body = '<h2>세이브 데이터</h2><p class="dim">전투와 레거시는 이 브라우저에 자동 저장된다. 브라우저 저장소는 지워질 수 있으니 중요한 진행은 아래 글을 복사해 따로 보관하자.</p>' +
        '<textarea id="savebox" spellcheck="false">' + esc(JSON.stringify({ v: 1, run: load(KEY_RUN), legacy: G.legacy })) + '</textarea>' +
        '<div class="row" style="margin-top:10px"><button class="btn" data-act="sload">이 내용으로 불러오기</button><span class="sp"></span><button class="btn primary" data-act="close">닫기</button></div>';
    }
    return '<div class="ov"><div class="modal">' + body + '</div></div>';
  }

  function render() {
    var h = '';
    if (G.screen === 'title') h = titleHTML();
    else if (G.screen === 'intro') h = introHTML();
    else if (G.screen === 'play') h = playHTML();
    else if (G.screen === 'result') h = resultHTML();
    app.innerHTML = h + modalHTML() + (G.toastMsg ? '<div class="toast">' + esc(G.toastMsg) + '</div>' : '');
    var lb = document.getElementById('logbox'); if (lb) lb.scrollTop = lb.scrollHeight;
  }

  // ---------- 상호작용 ----------
  function castFlow(bi) {
    var inst = eng.dmgInstances(G.s, bi);
    if (inst.length && G.s.minions.length) {
      G.modal = { type: 'target', title: '「' + eng.name(G.s.breaches[bi].prepped) + '」 피해 대상', inst: inst, pick: inst.map(function () { return 'N'; }), onOk: function (p) { return run({ type: 'cast', breach: bi, targets: p }); } };
      render();
    } else run({ type: 'cast', breach: bi, targets: inst.map(function () { return 'N'; }) });
  }
  function abilityFlow() {
    var inst = scn.mage.ability.effects.filter(function (e) { return e.op === 'dmg'; }).map(function (e) { return e.n; });
    if (inst.length && G.s.minions.length) {
      G.modal = { type: 'target', title: '「' + scn.mage.ability.name + '」 피해 대상', inst: inst, pick: inst.map(function () { return 'N'; }), onOk: function (p) { return run({ type: 'ability', targets: p }); } };
      render();
    } else run({ type: 'ability', targets: inst.map(function () { return 'N'; }) });
  }
  function handClick(i) {
    var s = G.s, id = s.hand[i], c = eng.def(id);
    if (c.type !== 'spell') { run({ type: 'play', idx: i }); return; }
    if (s.phase !== 'main') { toast('시전 단계를 마친 뒤에 준비할 수 있다.'); return; }
    var ok = [0, 1, 2, 3].filter(function (b) { return !eng.validate(s, { type: 'prep', idx: i, breach: b }); });
    if (!ok.length) { toast('준비할 균열이 없다. 균열을 열거나 이번 차례에 집중하자.'); return; }
    if (ok.length === 1) { run({ type: 'prep', idx: i, breach: ok[0] }); return; }
    G.prepSel = G.prepSel === i ? null : i; render();
  }

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-act'), s = G.s;
    var i = parseInt(el.getAttribute('data-i'), 10), b = parseInt(el.getAttribute('data-b'), 10);
    switch (a) {
      case 'new': G.legacy = null; wipe(KEY_LG); startGame(false); break;
      case 'newClear': G.legacy = null; wipe(KEY_LG); startGame(false); break;
      case 'newLegacy': startGame(true); break;
      case 'continue': var r = load(KEY_RUN); if (r) { G.s = r; G.screen = 'play'; G.modal = null; render(); } break;
      case 'begin': G.screen = 'play'; render(); break;
      case 'title': G.modal = null; G.screen = 'title'; render(); break;
      case 'rules': G.modal = { type: 'rules' }; render(); break;
      case 'menu': G.modal = { type: 'menu' }; render(); break;
      case 'discard': G.modal = { type: 'discard' }; render(); break;
      case 'saves': G.modal = { type: 'saves' }; render(); break;
      case 'close': G.modal = null; G.prepSel = null; render(); break;
      case 'hand': handClick(i); break;
      case 'prepTo': run({ type: 'prep', idx: G.prepSel, breach: b }); break;
      case 'buy': run({ type: 'buy', id: el.getAttribute('data-id') }); break;
      case 'focus': run({ type: 'focus', breach: b }); break;
      case 'open': run({ type: 'open', breach: b }); break;
      case 'disarm': run({ type: 'disarm', idx: i }); break;
      case 'cast': castFlow(b); break;
      case 'ability': abilityFlow(); break;
      case 'endCast': run({ type: 'endCast' }); break;
      case 'endMain':
        if (s.played.length >= 2) { G.modal = { type: 'order', order: s.played.map(function (_, k) { return k; }) }; render(); }
        else run({ type: 'endMain' });
        break;
      case 'tpick': G.modal.pick[parseInt(el.getAttribute('data-k'), 10)] = el.getAttribute('data-t') === 'N' ? 'N' : parseInt(el.getAttribute('data-t'), 10); render(); break;
      case 'tok': var m = G.modal; G.modal = null; m.onOk(m.pick); break;
      case 'oup': case 'odown':
        var k = parseInt(el.getAttribute('data-k'), 10), o = G.modal.order, j = a === 'oup' ? k - 1 : k + 1;
        var t = o[k]; o[k] = o[j]; o[j] = t; render(); break;
      case 'ook': var ord = G.modal.order; G.modal = null; run({ type: 'endMain', order: ord }); break;
      case 'eok': G.modal = null; if (s.over) { G.screen = 'result'; wipe(KEY_RUN); } render(); break;
      case 'choose':
        var opt = scn.story.choice.options.filter(function (x) { return x.id === el.getAttribute('data-o'); })[0];
        G.choiceMade = opt.id; G.legacy = opt.legacy; store(KEY_LG, opt.legacy); render(); break;
      case 'sload':
        try {
          var d = JSON.parse(document.getElementById('savebox').value);
          if (d.legacy) { G.legacy = d.legacy; store(KEY_LG, d.legacy); }
          if (d.run) { store(KEY_RUN, d.run); G.s = d.run; G.screen = 'play'; }
          G.modal = null; render(); toast('불러왔다.');
        } catch (e) { toast('형식이 올바르지 않다.'); }
        break;
    }
  });

  window.__ash = { G: G, eng: eng, run: run, render: render };
  render();
})();
