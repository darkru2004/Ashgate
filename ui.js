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
    return { party: [{ id: 'seo', seat: 'human' }], nemesis: NEM_IDS[0], supplyMode: 'recommended', custom: null, difficulty: 'normal', speed: 'normal', fx: 'full', autoOrder: true };
  }
  var G = {
    s: null, screen: 'title', cfg: load(KEY_CFG) || defaultCfg(), modal: null, prepSel: null, toastMsg: '',
    timer: null, seenN: 0, lastHuman: -1, paused: false,
    scene: null, evSeen: 0, undo: [], tab: 'me'
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
    if (G.scene) return;                                   // 적 차례 연출 중에는 멈춰 있는다
    if (!G.modal && maybeScene()) { render(); return; }
    if (s.over) { finish(); return; }
    var who = eng.controller(s);
    if (who === 'bot') {
      if (G.paused || G.modal) return;
      G.timer = setTimeout(function () {
        if (G.screen !== 'play' || G.s !== s || G.modal || G.scene) return;
        bot.takeTurn(s);
        saveRun();
        if (!maybeScene()) render();
        pump();
      }, SPEED[G.cfg.speed] || 650);
      return;
    }
    // 사람 차례: (연출을 껐다면) 그동안 일어난 일과 "지금 누구" 안내
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


  // ================= 적 차례 연출 =================
  // 규칙은 이미 끝난 뒤이고, 엔진이 남긴 사건(s.ev)을 순서대로 보여 줄 뿐이다.
  // 종 → 징조·잿것 → 적 카드가 뒤집힘(탭하면 결과) → 피해·굶주림·먹힘·섞임.
  var sceneEl = document.createElement('div');
  sceneEl.id = 'scene';
  document.body.appendChild(sceneEl);

  function foeCardInfo(id) {
    var d = eng.NC[id], kind, txt;
    if (d.kind === 'attack') { kind = '공격'; txt = eng.describe(d.effects); }
    else if (d.kind === 'power') { kind = '징조'; txt = d.countdown + '번의 적 차례 뒤: ' + eng.describe(d.effects) + (d.disarm ? ' (해제: 불씨 ' + d.disarm + ')' : ''); }
    else { kind = '잿것'; txt = '생명 ' + d.life + ' · 매 적 차례: ' + eng.describe(d.each) + (d.onDeath ? ' · 처치 시: ' + eng.describe(d.onDeath) : ''); }
    if (d.onDraw) txt += ' · 나올 때: ' + eng.describe(d.onDraw);
    return { name: d.name, kind: kind, kindId: d.kind, txt: txt, memo: d.memo || '' };
  }

  function buildBeats(s, evs) {
    var B = [], mname = function (i) { return s.mages[i] ? s.mages[i].name : '지기'; };
    evs.forEach(function (e) {
      switch (e.t) {
        case 'foeTurn': B.push({ k: 'round', n: e.n, w: 650 }); break;
        case 'tick': B.push({ k: 'line', c: 'warn', tx: '징조 「' + eng.name(e.id) + '」 — 앞으로 ' + e.left + '번의 적 차례', w: 650 }); break;
        case 'fire': B.push({ k: 'line', c: 'bad big', tx: '징조 「' + eng.name(e.id) + '」 발동! ' + eng.describe(eng.NC[e.id].effects), w: 950 }); break;
        case 'minionAct': B.push({ k: 'line', c: 'warn', tx: '잿것 「' + eng.name(e.id) + '」의 공격', w: 700 }); break;
        case 'reshuffle': B.push({ k: 'line', c: 'dim', tx: '적 덱이 다시 섞인다. 이제 단계 없이 무엇이든 나온다.', w: 800 }); break;
        case 'nemCard': B.push({ k: 'card', id: e.id, tier: e.tier, w: 700 }); break;
        case 'hitGrave': B.push({ k: 'line', c: 'bad', tx: scn.gravehold.name + ' −' + e.n + ' (남은 ' + e.hp + ')', w: 750, hit: 'grave' }); break;
        case 'hitMage': B.push({ k: 'line', c: 'bad', tx: mname(e.mi) + ' −' + e.n + ' (남은 생명 ' + e.hp + ')', w: 750, hit: 'mage' }); break;
        case 'hunger': if (e.n > 0) B.push({ k: 'line', c: 'warn', tx: '굶주림 +' + e.n + ' (' + e.v + '/' + e.th + ')', w: 600 }); break;
        case 'strike': B.push({ k: 'line', c: 'bad big', tx: '굶주림이 폭발한다!', w: 900, hit: 'grave' }); break;
        case 'devour': B.push({ k: 'line', c: 'bad', tx: mname(e.mi) + '의 「' + eng.name(e.id) + '」이(가) 먹혔다', w: 800 }); break;
        case 'scramble': B.push({ k: 'line', c: 'bad', tx: mname(e.mi) + '의 버림 더미가 뒤섞였다', w: 800 }); break;
        case 'anchor': B.push({ k: 'line', c: 'good', tx: mname(e.mi) + '의 매듭이 ' + (e.what === 'devour' ? '먹힘' : '섞임') + '을 막았다', w: 700 }); break;
      }
    });
    return B.some(function (b) { return b.k === 'round'; }) ? B : [];
  }

  function maybeScene() {
    var s = G.s;
    if (!s) return false;
    var n = (s.evN || 0) - G.evSeen;
    G.evSeen = s.evN || 0;
    if (n <= 0 || G.cfg.fx === 'off' || G.screen !== 'play') return false;
    var beats = buildBeats(s, s.ev.slice(Math.max(0, s.ev.length - n)));
    if (!beats.length) return false;
    G.seenN = s.logN || 0;
    var fast = G.cfg.fx === 'fast' || humanCount(s) === 0;
    G.scene = { beats: beats, i: 0, lines: [], card: null, hdr: '', wait: false, done: false, fresh: -1, freshCard: false, t: null, auto: fast, fast: fast, nem: nemOf(s).name };
    sceneStep();
    return true;
  }

  function sceneStep() {
    var S = G.scene; if (!S) return;
    clearTimeout(S.t);
    S.freshCard = false; S.fresh = -1;
    if (S.i >= S.beats.length) {
      S.done = true; S.wait = false; renderScene();
      if (S.auto) S.t = setTimeout(sceneClose, 900);
      return;
    }
    var b = S.beats[S.i++];
    if (b.k === 'round') { S.hdr = '적의 차례 ' + b.n; S.card = null; S.lines = []; }
    else if (b.k === 'card') { S.card = { info: foeCardInfo(b.id), tier: b.tier }; S.freshCard = true; }
    else { S.lines.push({ c: b.c, tx: b.tx }); S.fresh = S.lines.length - 1; if (b.hit) shake(b.hit); }
    var holdForTap = b.k === 'card' && !S.auto;
    S.wait = holdForTap;
    renderScene();
    if (holdForTap) return;
    S.t = setTimeout(sceneStep, b.w * (S.fast ? 0.55 : 1));
  }

  function sceneClose() {
    var S = G.scene; if (!S) return;
    clearTimeout(S.t);
    G.scene = null; G.tab = 'me';
    renderScene(); render(); pump();
  }

  function sceneNext() {
    var S = G.scene; if (!S) return;
    if (S.done) { sceneClose(); return; }
    S.wait = false; sceneStep();
  }

  function shake(kind) {
    app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake');
    try { if (navigator.vibrate) navigator.vibrate(kind === 'grave' ? 60 : 35); } catch (e) { /* 무시 */ }
  }

  function renderScene() {
    var S = G.scene;
    if (!S) { sceneEl.innerHTML = ''; sceneEl.className = ''; return; }
    sceneEl.className = 'on';
    var c = S.card, card;
    if (c) {
      var I = c.info;
      card = '<div class="bigcard k-' + I.kindId + ' tier' + (c.tier || 0) + (S.freshCard ? ' fresh' : '') + '">' +
        '<div class="bc-top"><span class="bc-kind">' + esc(I.kind) + '</span>' + (c.tier ? '<span class="bc-tier">' + c.tier + '단계</span>' : '') + '</div>' +
        '<div class="bc-nm">' + esc(I.name) + '</div><div class="bc-ef">' + esc(I.txt) + '</div>' + (I.memo ? '<div class="bc-memo">“' + esc(I.memo) + '”</div>' : '') + '</div>';
    } else card = '<div class="bigcard back"><div class="bc-nm">…</div></div>';
    var lines = S.lines.map(function (l, i) { return '<div class="ln ' + l.c + (i === S.fresh ? ' fresh' : '') + '">' + esc(l.tx) + '</div>'; }).join('');
    var foot = S.done ? '<button class="btn primary" data-act="sceneNext">계속</button>'
      : S.wait ? '<div class="tap">화면을 눌러 결과 보기</div>' : '<div class="tap dim">화면을 누르면 빨리 넘어간다</div>';
    sceneEl.innerHTML = '<div class="sc" data-act="sceneNext"><div class="sc-hdr">' + esc(S.hdr) + ' <small>' + esc(S.nem) + '</small></div>' +
      '<div class="sc-body">' + card + '<div class="sc-lines">' + lines + '</div></div><div class="sc-foot">' + foot + '</div></div>';
  }
  sceneEl.addEventListener('click', function (ev) { if (ev.target.closest('[data-act=sceneNext]')) sceneNext(); });

  // 사람의 행동 하나 실행
  function run(a) {
    var s = G.s;
    var snap = null;
    if (a.type !== 'endMain' && a.type !== 'pickMage') { try { snap = JSON.stringify(s); } catch (e) { snap = null; } }
    var r = eng.act(s, a);
    if (!r.ok) { toast(r.err); return false; }
    if (snap) { G.undo.push(snap); if (G.undo.length > 40) G.undo.shift(); } else G.undo = [];
    G.prepSel = null; G.modal = null;
    // 차례를 넘길 때는 seenN을 그대로 둬서, 다음 사람 차례에 "그동안 일어난 일"을 보여 준다
    if (a.type !== 'endMain' && a.type !== 'pickMage') G.seenN = s.logN || 0;
    saveRun();
    if (maybeScene()) { render(); return true; }
    if (s.over) { finish(); return true; }
    render(); pump();
    return true;
  }

  function undo() {
    if (!G.undo.length) return;
    G.s = JSON.parse(G.undo.pop());
    G.evSeen = G.s.evN || 0; G.seenN = G.s.logN || 0; G.prepSel = null; G.wiz = null; G.modal = null;
    saveRun(); render(); pump();
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
    G.scene = null; G.evSeen = 0; G.undo = []; G.tab = 'me';
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

  function hudHTML(s) {
    var N = nemOf(s);
    return '<div class="hud">' +
      '<div class="hb boss"><label>' + esc(N.name) + '</label><b>' + s.nemLife + '<small>/' + s.nemMax + '</small></b><div class="bar"><i style="width:' + pct(s.nemLife, s.nemMax) + '%"></i></div></div>' +
      '<div class="hb grave"><label>' + esc(scn.gravehold.name) + '</label><b>' + s.graveLife + '<small>/' + s.graveMax + '</small></b><div class="bar"><i style="width:' + pct(s.graveLife, s.graveMax) + '%"></i></div></div>' +
      '<div class="hb hun" title="가득 차면: ' + esc(eng.describe(N.unleash.strike)) + '"><label>굶주림 ' + s.hunger + '/' + s.threshold + '</label><span class="pips hunger">' + pips(s.hunger, s.threshold) + '</span></div></div>';
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
    var br = '<div class="sect"><h3>' + esc(m.name) + '의 새김</h3><div class="breaches">' +
      m.breaches.map(function (_, i) { return breachHTML(s, mi, i, mine); }).join('') + '</div></div>';
    var canAb = mine && !eng.validate(s, { type: 'ability' });
    var ab = '<div class="ability"><div><b>기술 「' + esc(D.ability.name) + '」</b> <span class="pips">' + pips(m.charge, D.ability.cost) + '</span><div class="dim sm">' + esc(D.ability.text || eng.describe(D.ability.effects)) + '</div></div>' +
      (mine ? '<button class="btn sm' + (canAb ? ' primary' : '') + '" data-act="ability"' + (canAb ? '' : ' disabled') + '>사용</button>' : '') + '</div>';
    var hand = m.hand.map(function (id, i) {
      var cls = '', attr = mine && s.phase === 'main' ? 'data-act="hand" data-i="' + i + '"' : 'disabled';
      if (G.prepSel === i) cls = 'sel';
      return cardHTML(id, attr, cls);
    }).join('');
    var hd = '<div class="sect"><h3>손 (' + m.hand.length + ')' + (mine && s.phase === 'main' ? ' — 보석·유물은 눌러서 사용, 주문은 눌러서 새김에 준비' : '') + '</h3><div class="cards">' + (hand || '<span class="dim sm">손이 비었다</span>') + '</div></div>';
    var rest = '';
    if (m.played.length) rest += '<div class="sect"><h3>이번 차례에 쓴 카드</h3><div class="disc">' + m.played.map(function (id) { return '<span>' + esc(eng.name(id)) + '</span>'; }).join('') + '</div></div>';
    if (mine && s.phase === 'main') {
      var pv = eng.previewHand(s, mi, null);
      rest += '<details class="nexthand"><summary>다음 손 (예상)</summary><div class="disc">' + pv.hand.map(function (id, k) {
        return (k === pv.refilledAt ? '<span class="cut">│ 여기부터 버림 더미 순서</span>' : '') + '<span>' + esc(eng.name(id)) + '</span>';
      }).join('') + '</div></details>';
    }
    rest += '<div class="row sm"><button class="btn sm" data-act="view" data-v="discard">버림 더미 ' + m.discard.length + '</button>' +
      '<span class="dim">덱 ' + m.deck.length + '장 (섞지 않음)</span>' + (m.forgotten.length ? '<button class="btn sm" data-act="view" data-v="forgotten">잊은 카드 ' + m.forgotten.length + '</button>' : '') + '</div>';
    // 시전 단계에는 새김이 먼저, 주 단계에는 손이 먼저 (손으로 하는 일이 대부분이라)
    return s.phase === 'cast' ? br + ab + hd + rest : ab + hd + br + rest;
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

  function tabsHTML(s) {
    var urgent = s.powers.some(function (p) { return p.tokens <= 1; });
    var nf = s.powers.length + s.minions.length;
    var T = [['me', '내 차례', ''], ['foe', '적·전장', nf ? '<i class="bd' + (urgent ? ' hot' : '') + '">' + nf + '</i>' : ''], ['supply', '공급처', ''], ['log', '기록', '']];
    return '<div class="tabs">' + T.map(function (x) {
      return '<button class="tab' + (G.tab === x[0] ? ' on' : '') + '" data-act="tab" data-v="' + x[0] + '">' + x[1] + x[2] + '</button>';
    }).join('') + '</div>';
  }

  function playHTML() {
    var s = G.s, N = nemOf(s);
    var cur = s.active >= 0 ? s.mages[s.active] : null;
    var human = cur && s.seats[s.active] === 'human';
    var phaseTx = !cur ? (s.phase === 'wild' ? '와일드: 움직일 지기를 고른다' : '진행 중') : s.phase === 'cast' ? '① 시전 단계' : '② 주 단계';
    var h = '<div class="topbar"><div class="t">재의 문 <small>' + esc(N.name) + ' · ' + esc((DIFFS[s.difficulty] || {}).name || '') + '</small></div>' +
      '<div class="row"><button class="btn sm" data-act="rules">규칙</button><button class="btn sm" data-act="menu">메뉴</button></div></div>';
    h += '<div class="hudwrap">' + hudHTML(s) + turnDeckHTML(s) + '</div>' + partyHTML(s);
    h += '<div class="phase">' + (cur ? '<b>' + esc(cur.name) + '</b><span class="seat ' + s.seats[s.active] + '">' + (human ? '사람' : 'AI') + '</span>' : '') +
      '<span>' + phaseTx + '</span>' + (cur && s.phase === 'main' ? '<span>불씨 <span class="ember">' + cur.ember + '</span></span>' : '') +
      '<span class="sp"></span>' + (!human && !s.over ? '<span class="dim">AI 진행 중…</span><button class="btn sm" data-act="pause">' + (G.paused ? '계속' : '멈춤') + '</button>' : '') + '</div>';
    if (human) h += '<p class="hint">' + (s.phase === 'cast' ? '지난 차례에 준비한 주문을 시전한다. 닫힌 새김의 주문은 반드시 시전해야 한다.' : G.prepSel != null ? '주문을 준비할 새김을 누른다 (점선 테두리). 다시 누르면 취소.' : '카드 사용 → 불씨로 구매·덧긋기·열기·징조 해제 → 주문은 새김에 준비 → 차례 종료.') + '</p>';
    h += tabsHTML(s);
    var foe = '<div class="sect"><h3>주린 자</h3>' + enemyHTML(s) + '</div>' +
      '<div class="sect"><h3>굶주림</h3><div class="panel sm">' + pips(s.hunger, s.threshold) + ' <span class="dim">가득 차면: ' + esc(eng.describe(N.unleash.strike)) + '</span>' +
      (s.devoured && s.devoured.length ? '<div style="margin-top:6px"><button class="btn sm" data-act="view" data-v="devoured">이름 더미 (먹힌 카드) ' + s.devoured.length + '장 보기</button></div>' : '') + '</div></div>';
    h += '<div class="panes">' +
      '<section class="pane p-me' + (G.tab === 'me' ? ' on' : '') + '">' + (cur ? activeHTML(s) : '<div class="panel dim">적 또는 다른 지기의 차례.</div>') + '</section>' +
      '<section class="pane p-foe' + (G.tab === 'foe' ? ' on' : '') + '">' + foe + '</section>' +
      '<section class="pane p-supply' + (G.tab === 'supply' ? ' on' : '') + '">' + supplyHTML(s) + '</section>' +
      '<section class="pane p-log' + (G.tab === 'log' ? ' on' : '') + '">' + logHTML(s) + '</section></div>';
    if (human) {
      h += '<div class="actionbar"><div class="in">';
      var undoB = G.undo.length ? '<button class="btn" data-act="undo" title="이번 차례에 한 행동을 하나 취소">↶</button>' : '';
      if (s.phase === 'cast') h += '<div class="row nowrap">' + undoB + '<button class="btn primary grow" data-act="endCast"' + (eng.validate(s, { type: 'endCast' }) ? ' disabled' : '') + '>시전 마치고 주 단계로</button></div>';
      else h += '<div class="row nowrap"><div class="emb">불씨<b>' + cur.ember + '</b></div>' + undoB + '<button class="btn primary grow" data-act="endMain">차례 종료</button>' +
        (G.cfg.autoOrder === false && eng.orderItems(s, s.active).length >= 2 ? '<button class="btn" data-act="order">순서</button>' : '') + '</div>';
      h += '</div></div>';
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
    }).join('') + '</div><h3 style="margin-top:10px">적 차례 연출</h3><div class="chips">' + [['full', '자세히'], ['fast', '빠르게'], ['off', '끄기']].map(function (x) {
      return '<button class="chip' + ((c.fx || 'full') === x[0] ? ' on' : '') + '" data-act="fx" data-v="' + x[0] + '">' + x[1] + '</button>';
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
      var om = s.mages[s.active], items = eng.orderItems(s, s.active), nG = items.length - om.played.length;
      var pv = eng.previewHand(s, s.active, m.order), needN = Math.max(0, 5 - om.hand.length);
      body = '<h2>버릴 순서 정하기</h2><p class="dim sm">덱이 비면 버림 더미가 이 순서 그대로 덱이 된다. <b>위</b>에 둔 카드가 먼저 뽑히고, <b>맨 아래</b> 카드는 가장 늦게 뽑히며 적의 먹힘에 가장 먼저 걸린다.</p>' +
        m.order.map(function (ii, k) {
          var id = items[ii];
          return '<div class="ord"><span class="no">' + (k + 1) + '</span><div class="sp"><b>' + esc(eng.name(id)) + '</b>' + (ii < nG ? ' <span class="tag">이번에 산 카드</span>' : '') +
            '<small>' + esc(eng.describe(eng.def(id).effects)) + '</small></div>' +
            '<button class="btn sm" data-act="oup" data-k="' + k + '"' + (k === 0 ? ' disabled' : '') + '>▲</button><button class="btn sm" data-act="odown" data-k="' + k + '"' + (k === m.order.length - 1 ? ' disabled' : '') + '>▼</button></div>';
        }).join('') +
        '<h3>다음 손 (예상)</h3><div class="disc">' + pv.hand.map(function (id, k) {
          return (k === pv.refilledAt ? '<span class="cut">│ 여기부터 이 순서</span>' : '') + '<span>' + esc(eng.name(id)) + '</span>';
        }).join('') + '</div><p class="dim sm">' + (pv.refilledAt >= 0 ? '이번에 덱이 비어서, 정한 순서가 곧바로 다음 손에 들어온다.' :
          '덱이 아직 남아 있어 이번 손은 달라지지 않는다. 덱이 비는 약 ' + (Math.floor(Math.max(0, om.deck.length - needN) / 5) + 1) + '차례 뒤부터 이 순서가 쓰인다.') + '</p>' +
        '<div class="row end"><button class="btn" data-act="close">취소</button><button class="btn" data-act="odef">기본 순서로 끝내기</button><button class="btn primary" data-act="ook">이 순서로 끝내기</button></div>';
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
        '<button class="btn" data-act="fxc">적 차례 연출: ' + { full: '자세히', fast: '빠르게', off: '끄기' }[G.cfg.fx || 'full'] + ' (바꾸기)</button>' +
        '<button class="btn" data-act="aoc">버릴 순서 화면: ' + (G.cfg.autoOrder === false ? '직접 열기' : '차례 끝에 자동') + ' (바꾸기)</button>' +
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
        if (r) { G.s = r.s; G.cfg = r.cfg || G.cfg; G.screen = 'play'; G.modal = null; G.paused = false; G.lastHuman = -1; G.seenN = r.s.logN || 0; G.scene = null; G.evSeen = r.s.evN || 0; G.undo = []; G.tab = 'me'; render(); pump(); }
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
      case 'fx': c.fx = v; render(); break;
      case 'fxc': c.fx = { full: 'fast', fast: 'off', off: 'full' }[c.fx || 'full']; store(KEY_CFG, c); render(); break;
      case 'aoc': c.autoOrder = c.autoOrder === false; store(KEY_CFG, c); render(); break;
      case 'tab': G.tab = v; render(); break;
      case 'undo': undo(); break;
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
      case 'endMain': {
        var its = eng.orderItems(s, s.active), uniq = {};
        its.forEach(function (id) { uniq[id] = 1; });
        if (its.length >= 2 && Object.keys(uniq).length >= 2 && G.cfg.autoOrder !== false) { G.modal = { type: 'order', order: its.map(function (_, i) { return i; }) }; render(); }
        else run({ type: 'endMain' });
        break;
      }
      case 'order': G.modal = { type: 'order', order: eng.orderItems(s, s.active).map(function (_, i) { return i; }) }; render(); break;
      case 'odef': G.modal = null; run({ type: 'endMain' }); break;
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
