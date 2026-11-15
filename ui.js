/* 재의 문 — 화면(UI) v3. 게임 규칙은 하나도 들어 있지 않고 엔진(AshEngine)과 봇(AshBot)만 호출한다.
 * 화면: 처음 → 설정(일행·자리·적·공급처·난이도) → 전투 → 결과
 * 사람 자리가 여럿이면(한 폰 번갈아 하기) 차례가 바뀔 때마다 "지금: ○○" 안내를 띄운다.
 * AI 자리는 정해진 속도로 자동 진행된다.
 */
(function () {
  'use strict';
  var scn = AshScenario1;
  var eng = AshEngine.create(scn);
  var bot = AshBot.create(eng, {});
  var KEY_RUN = 'ashgate.run.v3', KEY_CFG = 'ashgate.cfg.v3';
  var TYPE = { gem: '보석', relic: '유물', spell: '주문' };
  var NEM_IDS = eng.nemeses;
  var DIFFS = scn.difficulties;
  var SPEED = { fast: 150, normal: 650, slow: 1300 };

  // ---------- 저장소 (localStorage가 막혀 있으면 메모리로) ----------
  var mem = {};
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = JSON.stringify(v); } }
  function load(k) {
    try { var t = localStorage.getItem(k); if (t) return JSON.parse(t); } catch (e) { /* 아래로 */ }
    return mem[k] ? JSON.parse(mem[k]) : null;
  }
  function wipe(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } delete mem[k]; }

  function defaultCfg() {
    return { party: [{ id: 'seo', seat: 'human' }], nemesis: NEM_IDS[0], supplyMode: 'recommended', custom: null, difficulty: 'normal', speed: 'normal' };
  }
  var G = {
    s: null, screen: 'title', cfg: load(KEY_CFG) || defaultCfg(), modal: null, prepSel: null, toastMsg: '',
    timer: null, seenN: 0, lastHuman: -1, paused: false
  };
  var app = document.getElementById('app');

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, b) { return Math.max(0, Math.min(100, 100 * a / b)); }
  function pips(n, max) { var r = ''; for (var i = 0; i < max; i++) r += i < n ? '●' : '○'; return r; }
  function mdefOf(id) { return scn.mages.find(function (m) { return m.id === id; }); }
  function nemOf(s) { return scn.nemeses[s.nem]; }
  function saveRun() { if (G.s && !G.s.over) store(KEY_RUN, { s: G.s, cfg: G.cfg }); }
  function toast(msg) {
    G.toastMsg = msg; render();
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { G.toastMsg = ''; render(); }, 2600);
  }
  function newLines(s, fromN) {
    var k = Math.min(s.log.length, (s.logN || 0) - fromN);
    return k > 0 ? s.log.slice(s.log.length - k) : [];
  }
  function humanCount(s) { return s.seats.filter(function (x) { return x === 'human'; }).length; }

  // ================= 진행 (사람 ↔ AI) =================
  // 지금 둘 사람이 누군지 보고, AI 차례면 정해진 속도로 한 차례씩 자동 진행한다.
  function pump() {
    clearTimeout(G.timer);
    var s = G.s;
    if (!s || G.screen !== 'play') return;
    if (s.over) { finish(); return; }
    var who = eng.controller(s);
    if (who === 'bot') {
      if (G.paused || G.modal) return;
      G.timer = setTimeout(function () {
        if (G.screen !== 'play' || G.s !== s || G.modal) return;
        bot.takeTurn(s);
        saveRun(); render(); pump();
      }, SPEED[G.cfg.speed] || 650);
      return;
    }
    // 사람 차례: 그동안 일어난 일(적 차례 포함)과 "지금 누구" 안내
    var lines = newLines(s, G.seenN);
    var enemyHappened = lines.some(function (l) { return l.indexOf('적의 차례') >= 0; });
    var switched = s.phase !== 'wild' && humanCount(s) > 1 && s.active !== G.lastHuman;
    if (!G.modal && (enemyHappened || switched || s.phase === 'wild')) {
      G.modal = {
        type: 'handoff', lines: enemyHappened ? lines : [],
        title: s.phase === 'wild' ? '와일드 — 누가 움직일까?' : (switched ? '지금: ' + s.mages[s.active].name + '의 차례' : '그동안 일어난 일')
      };
    }
    if (s.phase !== 'wild') G.lastHuman = s.active;
    G.seenN = s.logN || 0;
    render();
  }

  function finish() {
    clearTimeout(G.timer);
    wipe(KEY_RUN);
    G.screen = 'result'; G.modal = null;
    render();
  }

  // 사람의 행동 하나 실행
  function run(a) {
    var s = G.s;
    var r = eng.act(s, a);
    if (!r.ok) { toast(r.err); return false; }
    G.prepSel = null; G.modal = null;
    // 차례를 넘길 때는 seenN을 그대로 둬서, 다음 사람 차례에 "그동안 일어난 일"을 보여 준다
    if (a.type !== 'endMain' && a.type !== 'pickMage') G.seenN = s.logN || 0;
    saveRun();
    if (s.over) { finish(); return true; }
    render(); pump();
    return true;
  }

  function startGame(cfg) {
    G.cfg = cfg; store(KEY_CFG, cfg);
    var opts = {
      party: cfg.party.map(function (p) { return p.id; }),
      seats: cfg.party.map(function (p) { return p.seat; }),
      nemesis: cfg.nemesis, difficulty: cfg.difficulty,
      supply: cfg.supplyMode === 'custom' && cfg.custom ? cfg.custom : cfg.supplyMode
    };
    G.s = eng.newGame(opts);
    G.prepSel = null; G.modal = null; G.paused = false; G.lastHuman = -1; G.seenN = 0;
    G.screen = 'play';
    var N = nemOf(G.s);
    G.modal = { type: 'intro', lines: (scn.story && scn.story.intro) || [], nem: N };
    saveRun(); render();
  }

  // ================= 효과 선택 마법사 =================
  // 카드·기술·시전에 필요한 선택(동료, 동료 새김, 잊을 카드, 회수할 카드, 징조, 피해 대상)을 차례로 묻고 행동을 만든다.
  function needAlly(effects) {
    return effects.some(function (e) { return e.to === 'ally' || e.who === 'ally' || e.op === 'focusAlly' || e.op === 'openAlly'; });
  }
  function allyCands(s) { return eng.living(s).filter(function (i) { return i !== s.active; }); }

  function startWizard(title, base, effects, opt) {
    opt = opt || {};
    var s = G.s;
    var W = { title: title, base: base, effects: effects, opt: opt, ans: {}, steps: null, i: 0 };
    if (needAlly(effects)) {
      var c = allyCands(s);
      if (c.length === 1) W.ans.ally = c[0];
      else if (c.length > 1) {
        W.allyStep = {
          q: '누구에게? (동료 대상 효과)',
          opts: c.map(function (k) {
            var m = s.mages[k];
            return { v: k, label: m.name, sub: '생명 ' + m.life + '/' + m.max + ' · 열 ' + m.charge + ' · 닫힌 새김 ' + m.breaches.filter(function (b) { return !b.open; }).length };
          })
        };
      }
    }
    G.wiz = W;
    advanceWizard();
  }

  function buildSteps(W) {
    var s = G.s, m = s.mages[s.active], steps = [];
    var tgtIdx = W.ans.ally != null ? W.ans.ally : s.active;
    var hand = m.hand.filter(function (_, i) { return i !== W.opt.handExclude; });
    var firstDmg = true;
    var discardPopped = 0;
    W.effects.forEach(function (e) {
      if (e.op === 'focusAlly' || e.op === 'openAlly') {
        var t = s.mages[tgtIdx], closed = [];
        t.breaches.forEach(function (b, i) { if (!b.open) closed.push(i); });
        if (closed.length > 1) steps.push({
          key: 'allyBreach', q: t.name + '의 어느 새김을 ' + (e.op === 'openAlly' ? '열까?' : '덧그을까?'),
          opts: closed.map(function (i) {
            var d = eng.mageDef(s, tgtIdx).breaches[i];
            return { v: i, label: '새김 ' + (i + 1) + ' (' + t.breaches[i].focus + '/4)', sub: (d.bonusText || '보너스 없음') + (d.onOpenText ? ' · 대가: ' + d.onOpenText : '') };
          })
        });
      } else if (e.op === 'forget' && e.from === 'hand') {
        if (!hand.length) return;
        var o = hand.map(function (id, i) { return { v: i, label: eng.name(id), sub: eng.describe(eng.def(id).effects) }; });
        if (e.optional) o.unshift({ v: null, label: '잊지 않는다', sub: '아무 일도 없다' });
        steps.push({ key: 'pick', q: '잊을 카드' + (e.optional ? ' (선택)' : ' (필수)') + ' — 잊으면 굶주림 +1', opts: o });
      } else if (e.op === 'recall') {
        var who = e.who === 'ally' ? tgtIdx : s.active;
        if (e.pick === 'top') { discardPopped++; return; }
        var dis = s.mages[who].discard.slice(0, s.mages[who].discard.length - (who === s.active ? discardPopped : 0));
        if (dis.length > 1) steps.push({
          key: 'pick', q: s.mages[who].name + '의 버림 더미에서 ' + (e.to === 'hand' ? '손으로' : '덱 맨 위로') + ' 가져올 카드',
          opts: dis.map(function (id, i) { return { v: i, label: eng.name(id), sub: (i === dis.length - 1 ? '맨 위 · ' : '') + eng.describe(eng.def(id).effects) }; }).reverse()
        });
        else if (dis.length === 1) steps.push({ key: 'pick', auto: 0 });
      } else if (e.op === 'delayPower') {
        if (s.powers.length > 1) steps.push({
          key: 'power', q: '어느 징조를 늦출까?',
          opts: s.powers.map(function (p, i) { return { v: i, label: eng.name(p.id), sub: '남은 ' + p.tokens + '차례' }; })
        });
      } else if (e.op === 'dmg') {
        var n = e.n + (firstDmg && W.opt.dmgBonus ? W.opt.dmgBonus : 0);
        firstDmg = false;
        if (s.minions.length) steps.push({
          key: 'targets', q: '피해 ' + n + '을(를) 누구에게?',
          opts: [{ v: 'N', label: nemOf(s).name, sub: '생명 ' + s.nemLife }].concat(s.minions.map(function (mi) {
            return { v: mi.uid, label: eng.name(mi.id), sub: '잿것 · 생명 ' + mi.life + (mi.life <= n ? ' (처치)' : '') };
          }))
        });
        else steps.push({ key: 'targets', auto: 'N' });
      } else if (e.op === 'dmgMinion') {
        if (s.minions.length > 1) steps.push({
          key: 'targets', q: '피해 ' + e.n + '을(를) 어느 잿것에게?',
          opts: s.minions.map(function (mi) { return { v: mi.uid, label: eng.name(mi.id), sub: '생명 ' + mi.life }; })
        });
      }
    });
    // 기록관 눈 새김: 시전 시 회수 보너스 (주문 효과 뒤에 처리된다)
    if (W.opt.bonusRecall) {
      var d2 = m.discard.slice(0, m.discard.length - discardPopped);
      if (d2.length > 1) steps.push({
        key: 'pick', q: '새김 보너스: 버림 더미에서 덱 맨 위로 올릴 카드',
        opts: d2.map(function (id, i) { return { v: i, label: eng.name(id), sub: eng.describe(eng.def(id).effects) }; }).reverse()
      });
    }
    return steps;
  }

  function advanceWizard() {
    var W = G.wiz;
    if (W.allyStep && W.ans.ally == null) { G.modal = { type: 'wiz', step: W.allyStep, key: 'ally' }; render(); return; }
    if (!W.steps) { W.steps = buildSteps(W); W.picks = []; W.targets = []; }
    while (W.i < W.steps.length) {
      var st = W.steps[W.i];
      if (st.auto !== undefined) { answer(st.key, st.auto, true); continue; }
      G.modal = { type: 'wiz', step: st, key: st.key, n: W.i + 1, total: W.steps.length };
      render(); return;
    }
    // 다 모였다 → 실행
    var a = Object.assign({}, W.base);
    if (W.ans.ally != null) a.ally = W.ans.ally;
    if (W.ans.allyBreach != null) a.allyBreach = W.ans.allyBreach;
    if (W.ans.power != null) a.power = W.ans.power;
    if (W.picks.length) a.pick = W.picks;
    if (W.targets.length) a.targets = W.targets;
    G.wiz = null; G.modal = null;
    run(a);
  }
  function answer(key, v, auto) {
    var W = G.wiz;
    if (key === 'ally') { W.ans.ally = v; advanceWizard(); return; }
    if (key === 'pick') {
      if (v === null) W.picks.push(-1);      // 선택 잊음을 하지 않음 → 없는 번호를 넘기면 엔진이 "고르지 않음"으로 처리
      else W.picks.push(v);
    } else if (key === 'targets') W.targets.push(v);
    else W.ans[key] = v;
    W.i++;
    if (!auto) advanceWizard();
  }

  // ================= 화면 조각 =================
  function cardHTML(id, attrs, cls, extra) {
    var c = eng.def(id);
    return '<button class="card ' + c.type + ' ' + (cls || '') + '" ' + (attrs || '') + '>' +
      (c.cost ? '<span class="cost">' + c.cost + '</span>' : '') +
      '<span class="nm">' + esc(c.name) + '</span><span class="tp">' + TYPE[c.type] + (extra ? ' · ' + extra : '') + '</span>' +
      '<span class="ef">' + esc(eng.describe(c.effects)) + '</span>' +
      (c.memo ? '<span class="memo">“' + esc(c.memo) + '”</span>' : '') + '</button>';
  }

  function statusHTML(s) {
    var N = nemOf(s), u = N.unleash;
    var h = '<div class="stats">' +
      '<div class="stat boss"><label><span>주린 자 · ' + esc(N.name) + '</span></label><b>' + s.nemLife + ' / ' + s.nemMax + '</b><div class="bar"><i style="width:' + pct(s.nemLife, s.nemMax) + '%"></i></div></div>' +
      '<div class="stat grave"><label><span>' + esc(scn.gravehold.name) + '</span></label><b>' + s.graveLife + ' / ' + s.graveMax + '</b><div class="bar"><i style="width:' + pct(s.graveLife, s.graveMax) + '%"></i></div></div>' +
      '<div class="stat"><label><span>굶주림</span><span>가득 차면: ' + esc(eng.describe(u.strike)) + '</span></label><span class="pips hunger">' + pips(s.hunger, s.threshold) + '</span></div>';
    if (s.devoured && s.devoured.length) h += '<div class="stat"><label><span>이름 더미 (먹힌 카드)</span></label><button class="btn sm" data-act="view" data-v="devoured">' + s.devoured.length + '장 보기</button></div>';
    return h + '</div>';
  }

  function turnDeckHTML(s) {
    var lab = function (t) { return t === 'N' ? '적' : t === 'W' ? '와일드' : s.mages[+t.slice(1)].name; };
    var cnt = {};
    s.turnDeck.forEach(function (t) { var l = lab(t); cnt[l] = (cnt[l] || 0) + 1; });
    var left = Object.keys(cnt).map(function (k) { return '<span class="tk' + (k === '적' ? ' foe' : '') + '">' + esc(k) + (cnt[k] > 1 ? '×' + cnt[k] : '') + '</span>'; }).join('');
    var used = s.turnDiscard.map(function (t, i) { return '<span class="tk used' + (t === 'N' ? ' foe' : '') + (i === s.turnDiscard.length - 1 ? ' now' : '') + '">' + esc(lab(t)) + '</span>'; }).join('');
    return '<div class="turns"><span class="dim">종</span> ' + used + '<span class="sep">│ 남은 종</span>' + (left || '<span class="dim">(다 쓰면 다시 섞는다)</span>') +
      (s.peek ? '<span class="peek">다음: ' + esc(lab(s.peek)) + '</span>' : '') + '</div>';
  }

  function partyHTML(s) {
    return '<div class="party">' + s.mages.map(function (m, i) {
      var D = eng.mageDef(s, i);
      var br = m.breaches.map(function (b) { return '<i class="' + (b.open ? 'o' : '') + (b.prepped ? ' p' : '') + '">' + (b.open ? '' : b.focus) + '</i>'; }).join('');
      return '<button class="pm' + (i === s.active ? ' act' : '') + (m.exhausted ? ' ex' : '') + '" data-act="inspect" data-i="' + i + '">' +
        '<div class="h"><b>' + esc(m.name) + '</b><span class="seat ' + s.seats[i] + '">' + (s.seats[i] === 'human' ? '사람' : 'AI') + '</span></div>' +
        (m.exhausted ? '<div class="dim">쓰러짐</div>' :
          '<div class="bar mg"><i style="width:' + pct(m.life, D.life) + '%"></i></div>' +
          '<div class="mini"><span>생명 ' + m.life + '/' + m.max + '</span><span>열 ' + m.charge + '/' + D.ability.cost + '</span></div>' +
          '<div class="mini"><span class="brs">' + br + '</span><span>손 ' + m.hand.length + ' · 덱 ' + m.deck.length + ' · 버림 ' + m.discard.length + '</span></div>' +
          (m.anchor ? '<div class="mini"><span>매듭 ' + m.anchor + '</span></div>' : '')) +
        '</button>';
    }).join('') + '</div>';
  }

  function enemyHTML(s) {
    var N = nemOf(s);
    var h = '<div class="enemy"><div class="bossbox"><div class="nm">' + esc(N.name) + '</div><div class="dim sm">' + esc(N.blurb || '') + '</div>' +
      '<span class="tag">적 덱 ' + s.nemDeck.length + '장' + (eng.nemTier(s) ? ' · ' + eng.nemTier(s) + '단계' : '') + '</span><span class="tag">버림 ' + s.nemDiscard.length + '장</span><span class="tag">문턱 ' + s.threshold + '</span></div>';
    var me = s.active >= 0 && s.seats[s.active] === 'human' && s.phase === 'main';
    s.powers.forEach(function (p, i) {
      var d = eng.def(p.id);
      var dis = !me || eng.validate(s, { type: 'disarm', idx: i }) ? ' disabled' : '';
      h += '<div class="foe power"><div class="cd" title="남은 적 차례">' + p.tokens + '</div><div class="tx"><span class="nm">' + esc(d.name) + '</span><small>징조 · ' + p.tokens + '번의 적 차례 뒤: ' + esc(eng.describe(d.effects)) + '</small></div>' +
        '<button class="btn sm" data-act="disarm" data-i="' + i + '"' + dis + '>해제 (불씨 ' + d.disarm + ')</button></div>';
    });
    s.minions.forEach(function (mi) {
      var d = eng.def(mi.id);
      h += '<div class="foe"><div class="cd hp" title="생명">' + mi.life + '</div><div class="tx"><span class="nm">' + esc(d.name) + '</span><small>잿것 · 매 적 차례: ' + esc(eng.describe(d.each)) +
        (d.onDeath ? ' · 처치 시: ' + esc(eng.describe(d.onDeath)) : '') + '</small></div></div>';
    });
    if (!s.powers.length && !s.minions.length) h += '<div class="dim sm">아직 나와 있는 징조나 잿것이 없다.</div>';
    return h + '</div>';
  }

  function breachHTML(s, mi, i, mine) {
    var m = s.mages[mi], b = m.breaches[i], d = eng.mageDef(s, mi).breaches[i];
    var castable = mine && s.phase === 'cast' && eng.castables(s).indexOf(i) >= 0;
    var canPrep = mine && G.prepSel != null && !eng.validate(s, { type: 'prep', idx: G.prepSel, breach: i });
    var body = b.prepped
      ? '<div class="pp">' + esc(eng.name(b.prepped)) + '<small>' + esc(eng.describe(eng.def(b.prepped).effects)) + ' · ' + (b.preppedTurn < s.turnNo ? '시전 가능' : '다음 차례부터') + '</small></div>'
      : '<div class="em">' + (b.open || (mine && b.focusedTurn === s.turnNo) ? '주문을 준비할 수 있다' : '닫힘') + '</div>';
    var acts = '';
    if (castable) acts += '<button class="btn sm primary" data-act="cast" data-b="' + i + '">시전</button>';
    if (mine && !b.open && s.phase === 'main') {
      acts += '<button class="btn sm" data-act="focus" data-b="' + i + '"' + (eng.validate(s, { type: 'focus', breach: i }) ? ' disabled' : '') + '>덧긋기 ' + d.focusCost + '</button>';
      acts += '<button class="btn sm" data-act="open" data-b="' + i + '"' + (eng.validate(s, { type: 'open', breach: i }) ? ' disabled' : '') + '>열기 ' + eng.openCost(s, i) + '</button>';
    }
    return '<div class="breach ' + (b.open ? 'open' : '') + (canPrep ? ' target' : '') + '"' + (canPrep ? ' data-act="prepTo" data-b="' + i + '"' : '') + '>' +
      '<div class="h"><span>새김 ' + (i + 1) + ' <small>' + ['손등', '팔', '가슴', '눈'][i] + '</small></span><span class="bn">' + (b.open ? '열림' : '닫힘 ' + b.focus + '/4') + '</span></div>' +
      '<div class="bn">' + (d.bonusText ? esc(d.bonusText) : '보너스 없음') + '</div>' +
      (d.onOpenText && !b.open ? '<div class="bn cost-t">대가: ' + esc(d.onOpenText) + '</div>' : '') +
      body + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
  }

  function activeHTML(s) {
    var mi = s.active, m = s.mages[mi], D = eng.mageDef(s, mi);
    var mine = s.seats[mi] === 'human';
    var h = '<div class="sect"><h3>' + esc(m.name) + '의 새김</h3><div class="breaches">' +
      m.breaches.map(function (_, i) { return breachHTML(s, mi, i, mine); }).join('') + '</div></div>';
    var canAb = mine && !eng.validate(s, { type: 'ability' });
    h += '<div class="ability"><div><b>기술 「' + esc(D.ability.name) + '」</b> <span class="pips">' + pips(m.charge, D.ability.cost) + '</span><div class="dim sm">' + esc(D.ability.text || eng.describe(D.ability.effects)) + '</div></div>' +
      (mine ? '<button class="btn sm' + (canAb ? ' primary' : '') + '" data-act="ability"' + (canAb ? '' : ' disabled') + '>사용</button>' : '') + '</div>';
    var hand = m.hand.map(function (id, i) {
      var c = eng.def(id), cls = '', attr = mine && s.phase === 'main' ? 'data-act="hand" data-i="' + i + '"' : 'disabled';
      if (G.prepSel === i) cls = 'sel';
      return cardHTML(id, attr, cls);
    }).join('');
    h += '<div class="sect"><h3>손 (' + m.hand.length + ')' + (mine && s.phase === 'main' ? ' — 보석·유물은 눌러서 사용, 주문은 눌러서 새김에 준비' : '') + '</h3><div class="cards">' + (hand || '<span class="dim sm">손이 비었다</span>') + '</div></div>';
    if (m.played.length) h += '<div class="sect"><h3>이번 차례에 쓴 카드</h3><div class="disc">' + m.played.map(function (id) { return '<span>' + esc(eng.name(id)) + '</span>'; }).join('') + '</div></div>';
    h += '<div class="row sm"><button class="btn sm" data-act="view" data-v="discard">버림 더미 ' + m.discard.length + '</button>' +
      '<span class="dim">덱 ' + m.deck.length + '장 (섞지 않음)</span>' + (m.forgotten.length ? '<button class="btn sm" data-act="view" data-v="forgotten">잊은 카드 ' + m.forgotten.length + '</button>' : '') + '</div>';
    return h;
  }

  function supplyHTML(s) {
    var me = s.active >= 0 && s.seats[s.active] === 'human' && s.phase === 'main';
    var piles = s.supplyPiles;
    var ids = piles.gems.concat(piles.relics, piles.spells);
    return '<div class="sect"><h3>공급처 (불씨로 구매 → 버림 더미 맨 위)</h3><div class="cards">' + ids.map(function (id) {
      var left = s.supply[id];
      var dis = !me || eng.validate(s, { type: 'buy', id: id }) ? ' disabled' : '';
      return cardHTML(id, 'data-act="buy" data-id="' + id + '"' + dis, left ? '' : 'out', '남은 ' + left);
    }).join('') + '</div></div>';
  }

  function logHTML(s) {
    var lines = s.log.slice(-60);
    return '<div class="sect"><h3>기록</h3><div class="log" id="log">' + lines.map(function (l) {
      var c = l.indexOf('──') === 0 ? 'h' : /피해를 입었다|삼킨|폭발|쓰러졌다|먹혔다|뒤섞였다|발동/.test(l) ? 'bad' : /회복|해제|돌아왔다|열렸다/.test(l) ? 'good' : '';
      return '<div class="' + c + '">' + esc(l) + '</div>';
    }).join('') + '</div></div>';
  }

  function playHTML() {
    var s = G.s;
    var cur = s.active >= 0 ? s.mages[s.active] : null;
    var human = cur && s.seats[s.active] === 'human';
    var phaseTx = !cur ? (s.phase === 'wild' ? '와일드: 움직일 지기를 고른다' : '진행 중') : s.phase === 'cast' ? '① 시전 단계' : '② 주 단계';
    var h = '<div class="topbar"><div class="t">재의 문 <small>' + esc(nemOf(s).name) + ' · ' + esc((DIFFS[s.difficulty] || {}).name || '') + '</small></div>' +
      '<div class="row"><button class="btn sm" data-act="rules">규칙</button><button class="btn sm" data-act="menu">메뉴</button></div></div>';
    h += statusHTML(s) + turnDeckHTML(s) + partyHTML(s);
    h += '<div class="phase">' + (cur ? '<b>' + esc(cur.name) + '</b><span class="seat ' + s.seats[s.active] + '">' + (human ? '사람' : 'AI') + '</span>' : '') +
      '<span>' + phaseTx + '</span>' + (cur && s.phase === 'main' ? '<span>불씨 <span class="ember">' + cur.ember + '</span></span>' : '') +
      '<span class="sp"></span>' + (!human && !s.over ? '<span class="dim">AI 진행 중…</span><button class="btn sm" data-act="pause">' + (G.paused ? '계속' : '멈춤') + '</button>' : '') + '</div>';
    if (human) h += '<p class="hint">' + (s.phase === 'cast' ? '지난 차례에 준비한 주문을 시전한다. 닫힌 새김의 주문은 반드시 시전해야 한다.' : G.prepSel != null ? '주문을 준비할 새김을 누른다 (점선 테두리). 다시 누르면 취소.' : '카드 사용 → 불씨로 구매·덧긋기·열기·징조 해제 → 주문은 새김에 준비 → 차례 종료.') + '</p>';
    h += '<div class="grid"><div class="colA">' + (cur ? activeHTML(s) : '<div class="panel dim">적 또는 다른 지기의 차례.</div>') + '</div>' +
      '<div class="side"><div class="colB sect"><h3>주린 자</h3>' + enemyHTML(s) + '</div><div class="colC">' + logHTML(s) + '</div></div></div>';
    h += supplyHTML(s);
    if (human) {
      h += '<div class="actionbar">';
      if (s.phase === 'cast') h += '<button class="btn" data-act="endCast"' + (eng.validate(s, { type: 'endCast' }) ? ' disabled' : '') + '>시전 마치고 주 단계로</button>';
      else h += '<div class="row nowrap"><button class="btn primary grow" data-act="endMain">차례 종료 · 손 5장까지 뽑기</button>' +
        (cur.played.length >= 2 ? '<button class="btn" data-act="order">버릴 순서</button>' : '') + '</div>';
      h += '</div>';
    }
    return h;
  }

  // ---------- 처음 / 설정 / 결과 ----------
  function titleHTML() {
    var r = load(KEY_RUN);
    return '<div class="center"><h1>재 의 문</h1><div class="sub">문이 숨을 들이켤 때마다, 누군가의 기억이 사라진다.</div>' +
      '<div class="col"><button class="btn primary" data-act="setup">새 판 준비</button>' +
      (r ? '<button class="btn" data-act="continue">이어하기 (' + esc(scn.nemeses[r.s.nem].name) + ', 지기 ' + r.s.mages.length + '명)</button>' : '') +
      '<button class="btn" data-act="rules">규칙 보기</button></div></div>';
  }

  function setupHTML() {
    var c = G.cfg;
    var h = '<div class="setup"><div class="topbar"><div class="t">새 판 준비</div><button class="btn sm" data-act="title">처음으로</button></div>';
    // 일행
    h += '<div class="panel sect"><h3>일행 (지기 1~4명) — 자리마다 사람/AI. 사람이 둘 이상이면 한 폰으로 번갈아 한다.</h3>';
    c.party.forEach(function (p, k) {
      h += '<div class="slot"><span class="no">' + (k + 1) + '</span><div class="chips">' + scn.mages.map(function (m) {
        return '<button class="chip' + (p.id === m.id ? ' on' : '') + '" data-act="pmage" data-k="' + k + '" data-id="' + m.id + '">' + esc(m.name) + '</button>';
      }).join('') + '</div><div class="chips"><button class="chip' + (p.seat === 'human' ? ' on' : '') + '" data-act="pseat" data-k="' + k + '" data-v="human">사람</button>' +
        '<button class="chip' + (p.seat === 'bot' ? ' on' : '') + '" data-act="pseat" data-k="' + k + '" data-v="bot">AI</button></div>' +
        (c.party.length > 1 ? '<button class="btn sm" data-act="prm" data-k="' + k + '">빼기</button>' : '') +
        '<div class="role dim">' + esc((mdefOf(p.id) || {}).role || '') + '</div></div>';
    });
    if (c.party.length < 4) h += '<button class="btn sm" data-act="padd">+ 지기 추가</button>';
    h += '</div>';
    // 적
    h += '<div class="panel sect"><h3>주린 자</h3><div class="chips">' + NEM_IDS.map(function (id) {
      return '<button class="chip' + (c.nemesis === id ? ' on' : '') + '" data-act="nem" data-v="' + id + '">' + esc(scn.nemeses[id].name) + '</button>';
    }).join('') + '<button class="chip' + (c.nemesis === 'random' ? ' on' : '') + '" data-act="nem" data-v="random">무작위</button></div>' +
      '<div class="dim sm" style="margin-top:6px">' + esc(c.nemesis === 'random' ? '셋 중 하나가 무작위로 나온다.' : scn.nemeses[c.nemesis].blurb || '') + '</div></div>';
    // 공급처
    var sm = [['recommended', '추천'], ['random', '무작위'], ['custom', '직접 고르기']];
    h += '<div class="panel sect"><h3>공급처 (보석 3 · 유물 2 · 주문 4)</h3><div class="chips">' + sm.map(function (x) {
      return '<button class="chip' + (c.supplyMode === x[0] ? ' on' : '') + '" data-act="sup" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div><div class="dim sm" style="margin-top:6px">' +
      (c.supplyMode === 'recommended' ? '적마다 맞춘 추천 세트를 쓴다.' : c.supplyMode === 'random' ? '무작위 9더미 (싼 보석·주문은 반드시 포함).' :
        (c.custom ? esc(['gems', 'relics', 'spells'].map(function (g) { return c.custom[g].map(function (id) { return scn.cards[id].name; }).join(', '); }).join(' / ')) : '아직 고르지 않았다.') +
        ' <button class="btn sm" data-act="supPick">고르기</button>') + '</div></div>';
    // 난이도·속도
    h += '<div class="panel sect"><h3>난이도</h3><div class="chips">' + Object.keys(DIFFS).map(function (k) {
      return '<button class="chip' + (c.difficulty === k ? ' on' : '') + '" data-act="diff" data-v="' + k + '">' + esc(DIFFS[k].name) + '</button>';
    }).join('') + '</div><h3 style="margin-top:10px">AI 진행 속도</h3><div class="chips">' + [['fast', '빠르게'], ['normal', '보통'], ['slow', '천천히']].map(function (x) {
      return '<button class="chip' + (c.speed === x[0] ? ' on' : '') + '" data-act="speed" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div></div>';
    var ok = c.supplyMode !== 'custom' || (c.custom && c.custom.gems.length === 3 && c.custom.relics.length === 2 && c.custom.spells.length === 4);
    h += '<div class="actionbar"><button class="btn primary" data-act="start"' + (ok ? '' : ' disabled') + '>이 설정으로 시작</button></div></div>';
    return h;
  }

  function resultHTML() {
    var s = G.s, N = nemOf(s), win = s.over === 'win';
    var ep = N.epitaph || {};
    return '<div class="center"><h1 class="' + (win ? 'win' : 'lose') + '">' + (win ? '문이 닫혔다' : '등불이 꺼졌다') + '</h1>' +
      '<div class="story"><p>' + esc(win ? ep.win : ep.lose) + '</p><p class="dim">' + esc(s.reason) + '</p>' + (ep.after ? '<p class="after">후일 — ' + esc(ep.after) + '</p>' : '') + '</div>' +
      '<div class="panel sm" style="text-align:left">지기 차례 ' + s.turnNo + ' · 적 차례 ' + s.nemTurns + ' · 성채 ' + s.graveLife + '/' + s.graveMax + ' · ' + esc(N.name) + ' ' + s.nemLife + '/' + s.nemMax +
      '<br>' + s.mages.map(function (m) { return esc(m.name) + (m.exhausted ? ' (쓰러짐)' : ' ' + m.life + '/' + m.max) + (m.forgotten.length ? ' · 잊음 ' + m.forgotten.length : ''); }).join(' · ') + '</div>' +
      '<div class="col"><button class="btn primary" data-act="again">같은 설정으로 다시</button><button class="btn" data-act="setup">설정 바꾸기</button><button class="btn" data-act="title">처음 화면</button></div></div>';
  }

  // ---------- 모달 ----------
  function modalHTML() {
    var m = G.modal; if (!m) return '';
    var s = G.s, body = '';
    var close = '<div class="row end"><button class="btn primary" data-act="close">닫기</button></div>';
    if (m.type === 'intro') {
      body = '<h2>' + esc(m.nem.name) + '</h2>' + m.lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') +
        '<p class="dim">' + esc(m.nem.blurb || '') + '</p><div class="row end"><button class="btn primary" data-act="close">전투 시작</button></div>';
    } else if (m.type === 'handoff') {
      body = '<h2>' + esc(m.title) + '</h2>';
      if (m.lines.length) body += '<div class="log short">' + m.lines.slice(-40).map(function (l) { return '<div class="' + (l.indexOf('──') === 0 ? 'h' : '') + '">' + esc(l) + '</div>'; }).join('') + '</div>';
      if (s.phase === 'wild') {
        body += '<div class="col">' + eng.living(s).map(function (k) {
          var mm = s.mages[k];
          return '<button class="btn" data-act="wild" data-i="' + k + '">' + esc(mm.name) + ' <span class="dim">(' + (s.seats[k] === 'human' ? '사람' : 'AI') + ' · 생명 ' + mm.life + ' · 준비된 주문 ' + mm.breaches.filter(function (b) { return b.prepped; }).length + ')</span></button>';
        }).join('') + '</div>';
      } else body += '<div class="row end"><button class="btn primary" data-act="close">' + (humanCount(s) > 1 ? esc(s.mages[s.active].name) + '(으)로 진행' : '확인') + '</button></div>';
    } else if (m.type === 'wiz') {
      var st = m.step, W = G.wiz;
      body = '<h2>' + esc(W.title) + '</h2><p>' + esc(st.q) + (m.total > 1 ? ' <span class="dim">(' + m.n + '/' + m.total + ')</span>' : '') + '</p><div class="col">' +
        st.opts.map(function (o, k) { return '<button class="btn opt" data-act="wpick" data-k="' + k + '"><b>' + esc(o.label) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</button>'; }).join('') +
        '</div><div class="row end"><button class="btn" data-act="wcancel">취소</button></div>';
    } else if (m.type === 'order') {
      var cur = s.mages[s.active];
      body = '<h2>버릴 순서</h2><p class="dim">아래쪽이 버림 더미 맨 위가 된다 (덱이 비면 이 순서 그대로 다시 뽑힌다).</p>' +
        m.order.map(function (pi, k) {
          return '<div class="ord"><span class="sp">' + (k + 1) + '. ' + esc(eng.name(cur.played[pi])) + '</span>' +
            '<button class="btn sm" data-act="oup" data-k="' + k + '"' + (k === 0 ? ' disabled' : '') + '>▲</button><button class="btn sm" data-act="odown" data-k="' + k + '"' + (k === m.order.length - 1 ? ' disabled' : '') + '>▼</button></div>';
        }).join('') + '<div class="row end"><button class="btn" data-act="close">취소</button><button class="btn primary" data-act="ook">이 순서로 차례 종료</button></div>';
    } else if (m.type === 'view') {
      var list = m.list;
      body = '<h2>' + esc(m.title) + '</h2>' + (list.length ? '<div class="disc">' + list.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '<p class="dim">비어 있다.</p>') + (m.note ? '<p class="dim sm">' + esc(m.note) + '</p>' : '') + close;
    } else if (m.type === 'inspect') {
      var k = m.i, mm = s.mages[k], D = eng.mageDef(s, k);
      body = '<h2>' + esc(mm.name) + ' <span class="seat ' + s.seats[k] + '">' + (s.seats[k] === 'human' ? '사람' : 'AI') + '</span></h2><p class="dim sm">' + esc(D.role || '') + '</p>' +
        '<p>생명 ' + mm.life + '/' + mm.max + ' · 열 ' + mm.charge + '/' + D.ability.cost + ' (기술 「' + esc(D.ability.name) + '」: ' + esc(D.ability.text || '') + ')' + (mm.anchor ? ' · 매듭 ' + mm.anchor : '') + '</p>' +
        '<div class="breaches">' + mm.breaches.map(function (_, i) { return breachHTML(s, k, i, false); }).join('') + '</div>' +
        '<h3 class="sm dim">손 ' + mm.hand.length + '장</h3><div class="disc">' + mm.hand.map(function (id) { return '<span>' + esc(eng.name(id)) + '</span>'; }).join('') + '</div>' +
        '<h3 class="sm dim">버림 더미 (오른쪽이 맨 위)</h3><div class="disc">' + mm.discard.map(function (id) { return '<span>' + esc(eng.name(id)) + '</span>'; }).join('') + '</div>' +
        '<p class="dim sm">덱 ' + mm.deck.length + '장' + (mm.forgotten.length ? ' · 잊은 카드: ' + mm.forgotten.map(eng.name).join(', ') : '') + '</p>' + close;
    } else if (m.type === 'menu') {
      body = '<h2>메뉴</h2><div class="col"><button class="btn" data-act="spd">AI 속도: ' + { fast: '빠르게', normal: '보통', slow: '천천히' }[G.cfg.speed] + ' (바꾸기)</button>' +
        '<button class="btn" data-act="title">처음 화면으로 (전투는 자동 저장됨)</button><button class="btn" data-act="giveup">포기하고 새 판</button><button class="btn primary" data-act="close">닫기</button></div>';
    } else if (m.type === 'supPick') {
      var cu = m.sel, pool = eng.poolOf(G.cfg.nemesis === 'random' ? NEM_IDS[0] : G.cfg.nemesis);
      var need = { gems: 3, relics: 2, spells: 4 }, nm = { gems: '보석', relics: '유물', spells: '주문' };
      body = '<h2>공급처 직접 고르기</h2>' + ['gems', 'relics', 'spells'].map(function (g) {
        return '<h3 class="sm">' + nm[g] + ' ' + cu[g].length + '/' + need[g] + '</h3><div class="cards">' + pool[g].map(function (id) {
          return cardHTML(id, 'data-act="spick" data-g="' + g + '" data-id="' + id + '"', cu[g].indexOf(id) >= 0 ? 'sel' : '');
        }).join('') + '</div>';
      }).join('') + '<div class="row end"><button class="btn" data-act="close">취소</button><button class="btn primary" data-act="sok"' +
        (cu.gems.length === 3 && cu.relics.length === 2 && cu.spells.length === 4 ? '' : ' disabled') + '>이대로</button></div>';
    } else if (m.type === 'rules') {
      body = '<h2>규칙 요약</h2><ul>' +
        '<li><b>목표</b>: 주린 자의 생명을 0으로. 성채가 무너지거나 지기가 모두 쓰러지면 패배.</li>' +
        '<li><b>종</b>(차례 순서): 지기마다 1장 + 와일드 + 적 2장을 섞어 한 장씩 뒤집는다. 와일드는 아무 지기나 움직인다.</li>' +
        '<li><b>내 차례</b>: ① 시전 — 지난 차례 새김에 준비한 주문을 쏜다(닫힌 새김의 주문은 필수). ② 주 단계 — 보석·유물을 써서 <b>불씨</b>를 모아 카드 구매, 새김 덧긋기·열기, 징조 해제, 주문 준비. ③ 손을 5장까지 채운다.</li>' +
        '<li><b>덱은 섞지 않는다</b>: 덱이 비면 버림 더미가 그 순서 그대로 덱이 된다. 그래서 버리는 순서가 중요하다.</li>' +
        '<li><b>새김</b>: 닫힌 새김은 덧긋기(불씨)할 때마다 열기 비용이 줄고 4번째에 열린다. 덧그은 차례에만 주문을 준비할 수 있다. 열린 새김엔 보너스가 있지만, 열리는 순간 <b>대가</b>를 치른다.</li>' +
        '<li><b>열</b>: 주문을 시전할 때마다 차오르고, 가득 차면 기술을 쓴다.</li>' +
        '<li><b>굶주림</b>: 격화 효과마다 차오르고, 문턱에 닿으면 주린 자가 삼킨다. 카드를 <b>잊을</b> 때마다 굶주림 +1.</li>' +
        '<li><b>징조</b>는 몇 번의 적 차례 뒤에 터진다(불씨로 해제 가능). <b>잿것</b>은 매 적 차례 공격한다.</li>' +
        '<li><b>동료 대상</b> 효과는 동료가 없으면 자기 자신에게 적용된다.</li></ul>' + close;
    }
    return '<div class="ov"><div class="modal">' + body + '</div></div>';
  }

  // ---------- 그리기 ----------
  function render() {
    var h;
    if (G.screen === 'title') h = titleHTML();
    else if (G.screen === 'setup') h = setupHTML();
    else if (G.screen === 'result') h = resultHTML();
    else h = playHTML();
    var y = window.scrollY;
    app.innerHTML = h + modalHTML() + (G.toastMsg ? '<div class="toast">' + esc(G.toastMsg) + '</div>' : '');
    window.scrollTo(0, y);
    var lg = document.getElementById('log'); if (lg) lg.scrollTop = lg.scrollHeight;
  }

  // ---------- 입력 ----------
  function onHand(i) {
    var s = G.s, m = s.mages[s.active], c = eng.def(m.hand[i]);
    if (c.type === 'spell') { G.prepSel = G.prepSel === i ? null : i; render(); return; }
    startWizard('「' + c.name + '」', { type: 'play', idx: i }, c.effects, { handExclude: i });
  }
  function onCast(bi) {
    var s = G.s, m = s.mages[s.active], b = m.breaches[bi], d = eng.mageDef(s, s.active).breaches[bi];
    var bonus = b.open && d.bonus;
    startWizard('「' + eng.name(b.prepped) + '」 시전', { type: 'cast', breach: bi }, eng.def(b.prepped).effects,
      { dmgBonus: bonus && bonus.type === 'dmg' ? bonus.n : 0, bonusRecall: bonus && bonus.type === 'recall' });
  }
  function onAbility() {
    var s = G.s, D = eng.mageDef(s, s.active);
    startWizard('기술 「' + D.ability.name + '」', { type: 'ability' }, D.ability.effects, {});
  }

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-act'), s = G.s, c = G.cfg;
    var k = +el.getAttribute('data-k'), v = el.getAttribute('data-v');
    switch (a) {
      // 처음 / 설정
      case 'setup': G.screen = 'setup'; G.modal = null; render(); break;
      case 'title': clearTimeout(G.timer); G.modal = null; G.screen = 'title'; render(); break;
      case 'continue': {
        var r = load(KEY_RUN);
        if (r) { G.s = r.s; G.cfg = r.cfg || G.cfg; G.screen = 'play'; G.modal = null; G.paused = false; G.lastHuman = -1; G.seenN = r.s.logN || 0; render(); pump(); }
        break;
      }
      case 'pmage': c.party[k].id = el.getAttribute('data-id'); render(); break;
      case 'pseat': c.party[k].seat = v; render(); break;
      case 'prm': c.party.splice(k, 1); render(); break;
      case 'padd': {
        var used = c.party.map(function (p) { return p.id; });
        var nx = scn.mages.find(function (m) { return used.indexOf(m.id) < 0; }) || scn.mages[0];
        c.party.push({ id: nx.id, seat: 'bot' }); render(); break;
      }
      case 'nem': c.nemesis = v; render(); break;
      case 'sup': c.supplyMode = v; if (v === 'custom' && !c.custom) { G.modal = { type: 'supPick', sel: { gems: [], relics: [], spells: [] } }; } render(); break;
      case 'supPick': G.modal = { type: 'supPick', sel: c.custom ? JSON.parse(JSON.stringify(c.custom)) : { gems: [], relics: [], spells: [] } }; render(); break;
      case 'spick': {
        var g = el.getAttribute('data-g'), id = el.getAttribute('data-id'), sel = G.modal.sel[g], lim = { gems: 3, relics: 2, spells: 4 }[g];
        var at = sel.indexOf(id);
        if (at >= 0) sel.splice(at, 1); else if (sel.length < lim) sel.push(id); else toast('이 종류는 ' + lim + '더미까지');
        render(); break;
      }
      case 'sok': c.custom = G.modal.sel; c.supplyMode = 'custom'; G.modal = null; render(); break;
      case 'diff': c.difficulty = v; render(); break;
      case 'speed': c.speed = v; render(); break;
      case 'start': startGame(c); break;
      case 'again': startGame(c); break;
      // 전투
      case 'close':
        G.modal = null; G.prepSel = null; G.wiz = null; render(); pump(); break;
      case 'rules': G.modal = { type: 'rules' }; render(); break;
      case 'menu': G.modal = { type: 'menu' }; render(); break;
      case 'spd': c.speed = { fast: 'normal', normal: 'slow', slow: 'fast' }[c.speed]; store(KEY_CFG, c); render(); break;
      case 'giveup': wipe(KEY_RUN); clearTimeout(G.timer); G.modal = null; G.screen = 'setup'; render(); break;
      case 'pause': G.paused = !G.paused; render(); pump(); break;
      case 'inspect': G.modal = { type: 'inspect', i: +el.getAttribute('data-i') }; render(); break;
      case 'view': {
        var cm = s.mages[s.active] || s.mages[0];
        if (v === 'discard') G.modal = { type: 'view', title: cm.name + '의 버림 더미', list: cm.discard.map(eng.name), note: '오른쪽이 맨 위. 덱이 비면 이 순서 그대로 덱이 된다.' };
        else if (v === 'forgotten') G.modal = { type: 'view', title: cm.name + '이(가) 잊은 카드', list: cm.forgotten.map(eng.name), note: '이번 판에서 영구히 사라졌다.' };
        else G.modal = { type: 'view', title: '이름 더미 (먹힌 카드)', list: s.devoured.map(function (d) { return s.mages[d.mage].name + ': ' + eng.name(d.id); }), note: '이름 없는 자를 처치하면 가장 최근 것부터 1장씩 돌아온다.' };
        render(); break;
      }
      case 'wild': G.modal = null; run({ type: 'pickMage', mage: +el.getAttribute('data-i') }); break;
      case 'hand': onHand(+el.getAttribute('data-i')); break;
      case 'prepTo': run({ type: 'prep', idx: G.prepSel, breach: +el.getAttribute('data-b') }); break;
      case 'cast': onCast(+el.getAttribute('data-b')); break;
      case 'endCast': run({ type: 'endCast' }); break;
      case 'focus': run({ type: 'focus', breach: +el.getAttribute('data-b') }); break;
      case 'open': run({ type: 'open', breach: +el.getAttribute('data-b') }); break;
      case 'buy': run({ type: 'buy', id: el.getAttribute('data-id') }); break;
      case 'disarm': run({ type: 'disarm', idx: +el.getAttribute('data-i') }); break;
      case 'ability': onAbility(); break;
      case 'endMain': run({ type: 'endMain' }); break;
      case 'order': G.modal = { type: 'order', order: s.mages[s.active].played.map(function (_, i) { return i; }) }; render(); break;
      case 'oup': case 'odown': {
        var o = G.modal.order, j = a === 'oup' ? k - 1 : k + 1, t = o[k]; o[k] = o[j]; o[j] = t; render(); break;
      }
      case 'ook': { var ord = G.modal.order; G.modal = null; run({ type: 'endMain', order: ord }); break; }
      case 'wpick': { var st = G.modal.step; answer(G.modal.key, st.opts[k].v); break; }
      case 'wcancel': G.wiz = null; G.modal = null; render(); break;
    }
  });

  window.__ash = { G: G, eng: eng, render: render, pump: pump, startGame: startGame };
  render();
})();
