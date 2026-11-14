/* 재의 문 (Ashgate) — 게임 엔진 v3 (일행 1~4인 · 일반판 보충 설계 1단계)
 * 규칙 틀: 협력 덱빌딩(섞지 않는 덱, 가변 턴 순서, 균열/준비/시전, 적 덱)을 따르고
 * 카드·세계관·수치는 전부 data.js(시나리오 데이터)에서 온다.
 * 엔진은 DOM을 모른다. 상태(state)는 순수 JSON이라 그대로 세이브된다.
 * 생성형 AI 판단은 어디에도 들어가지 않는다 (같은 seed + 같은 행동 = 같은 결과).
 *
 * v2: 일행 1~4인(각자 덱·손·균열), 자리(seats), 턴 순서 덱(M0..M3 + W + N), 새 적 차례 순서, 카드 발동 굶주림, 탈진.
 * v3: 일반판 1단계 — 새로 생긴 효과(잊음·회수·동료 새김·새김 대가·최대 생명 등), 적/공급처/난이도 선택,
 *     "동료가 없으면 자기 자신에게 적용" 규칙, 효과 중 선택은 행동의 pick/allyBreach/power/targets로 받고
 *     없으면 엔진이 정한 기본 규칙을 쓴다(그래서 행동이 선택 때문에 거부되는 일은 없다).
 *
 * 용어: 엔진 내부 이름(breach, nemesis …)은 그대로. 화면 글자(지기·새김·덧긋기·열·징조·잿것·종)는 데이터/UI에서.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AshEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- 난수 (상태에 저장되는 시드형 RNG) ----------
  function rnd(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(s, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(s) * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // 효과 목록을 사람이 읽는 글로 (카드 설명은 항상 효과 데이터에서 자동 생성 → 글과 규칙이 어긋나지 않음)
  function describe(effects) {
    return (effects || []).map(function (e) {
      const ally = e.to === 'ally' || e.who === 'ally';
      switch (e.op) {
        case 'ember': return '불씨 +' + e.n;
        case 'dmg': return '피해 ' + e.n;
        case 'heal': return '성채 +' + e.n;
        case 'healMage': return (ally ? '동료 ' : '자신 ') + '생명 +' + e.n;
        case 'charge': return (ally ? '동료 ' : '') + '열 +' + e.n;
        case 'chargeReset': return '열 0';
        case 'draw': return (ally ? '동료 ' : '') + '카드 ' + e.n + '장 뽑기';
        case 'hitGrave': return '성채 -' + e.n;
        case 'hitMage': return (e.all ? '모든 지기 -' : '지기 -') + e.n;
        case 'hitSelf': return '자신 -' + e.n;
        case 'hunger': return e.n < 0 ? '굶주림 ' + e.n : '굶주림 +' + e.n;
        case 'unleash': return '격화' + (e.n > 1 ? ' ×' + e.n : '');
        case 'forget': return '잊음 ' + (e.from === 'hand' ? '(손) ' : e.from === 'discardTop' ? '(버림 맨 위) ' : '(덱 맨 위) ') + (e.n || 1) + '장' + (e.optional ? ' (선택)' : '');
        case 'recall': return (ally ? '동료 ' : '') + '회수 ' + (e.n || 1) + '장 (' + (e.to === 'hand' ? '손' : '덱 맨 위') + ')';
        case 'focusAlly': return '동료 새김 덧긋기 +' + (e.n || 1);
        case 'openAlly': return '동료 새김 즉시 열기';
        case 'maxLife': return '최대 생명 -' + e.n;
        case 'dmgMinion': return '잿것 하나에 피해 ' + e.n;
        case 'dmgAll': return '모든 잿것과 적에게 피해 ' + e.n;
        case 'peekTurn': return '다음 종 미리 보기';
        case 'delayPower': return '징조 하나 +' + e.n + '차례';
        case 'anchor': return '매듭: 다음 섞임/먹힘 1회 무효';
        default: return e.op;
      }
    }).join(', ');
  }

  function create(scn) {
    const C = scn.cards;
    const NEMS = scn.nemeses || { default: scn.nemesis };
    const NEM_DEFAULT = scn.defaultNemesis || Object.keys(NEMS)[0];
    const NC = {};                                   // 모든 적의 카드를 한 표로 (id는 적끼리 겹치지 않는다)
    Object.keys(NEMS).forEach(function (k) { Object.assign(NC, NEMS[k].cards); });
    const MAGES = scn.mages || [scn.mage];
    const def = function (id) { return C[id] || NC[id]; };
    const nm = function (id) { const d = def(id); return d ? d.name : id; };

    function log(s, msg) {
      s.log.push(msg);
      if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
    }
    function nem(s) { return NEMS[s.nem]; }
    function cur(s) { return s.active >= 0 ? s.mages[s.active] : null; }
    function mdef(s, mi) { return MAGES[s.mages[mi].di]; }
    function living(s) {
      const r = [];
      s.mages.forEach(function (m, i) { if (!m.exhausted) r.push(i); });
      return r;
    }
    function who(s, mi) { return s.mages[mi].name; }
    function cap(s, mi, v) { return Math.min(MAGES[s.mages[mi].di].ability.cost, v); }

    // ---------- 공급처 ----------
    // 공급 카드 풀: 공급처에 올릴 수 있는 카드(시작 카드·레거시 전용 제외). 적에게 쓸모없는 카드(usefulVs)는 그 적일 때 뺀다.
    function poolOf(nemId) {
      const r = { gems: [], relics: [], spells: [] };
      Object.keys(C).forEach(function (id) {
        const c = C[id];
        if (c.legacyOnly || c.starter) return;
        if (c.usefulVs && c.usefulVs.indexOf(nemId) < 0) return;
        if (c.type === 'gem') r.gems.push(id);
        else if (c.type === 'relic') r.relics.push(id);
        else if (c.type === 'spell') r.spells.push(id);
      });
      return r;
    }
    // 무작위 9더미. 비용 3 이하 보석 1개 이상, 비용 4 이하 주문 1개 이상은 반드시 넣는다.
    function randomSupply(s, nemId) {
      const pool = poolOf(nemId);
      const need = { gems: 3, relics: 2, spells: 4 };
      const out = {};
      Object.keys(need).forEach(function (g) {
        const list = shuffle(s, pool[g].slice());
        const cheapLimit = g === 'gems' ? 3 : g === 'spells' ? 4 : null;
        let pick = [];
        if (cheapLimit != null) {
          const cheap = list.filter(function (id) { return C[id].cost <= cheapLimit; })[0];
          if (cheap) pick.push(cheap);
        }
        list.forEach(function (id) { if (pick.length < need[g] && pick.indexOf(id) < 0) pick.push(id); });
        out[g] = pick;
      });
      return out;
    }
    function resolveSupply(s, opt, nemId) {
      if (opt && typeof opt === 'object') return opt;
      if (opt === 'random') return randomSupply(s, nemId);
      if (opt && scn.supplySets && scn.supplySets[opt]) return scn.supplySets[opt];
      return scn.supply;                              // 'recommended' / 미지정
    }

    // ---------- 새 게임 ----------
    function defaultSlots(n) { return n === 1 ? 3 : 4; }

    function newGame(opts) {
      opts = opts || {};
      const lg = opts.legacy || {};
      const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2147483647);
      const party = (opts.party || [0]).map(function (p) {
        return typeof p === 'string' ? MAGES.findIndex(function (m) { return m.id === p; }) : p;
      });
      if (party.length < 1 || party.length > 4) throw new Error('일행은 1~4명이어야 한다.');
      party.forEach(function (p) { if (!MAGES[p]) throw new Error('없는 일행: ' + p); });
      const n = party.length;
      const seats = (opts.seats || party.map(function (_, i) { return i === 0 ? 'human' : 'bot'; })).slice(0, n);
      while (seats.length < n) seats.push('bot');

      const s = {
        v: 3, scn: scn.id, rng: seed | 0, uid: 1, turnNo: 0, nemTurns: 0,
        phase: 'init', active: -1, lastActive: -1, over: null, reason: '', log: [],
        hunger: 0, legacy: lg, seats: seats, peek: null
      };

      // 적 / 난이도
      let nemId = opts.nemesis || NEM_DEFAULT;
      if (nemId === 'random') { const ks = Object.keys(NEMS); nemId = ks[Math.floor(rnd(s) * ks.length)]; }
      if (!NEMS[nemId]) throw new Error('없는 적: ' + nemId);
      s.nem = nemId;
      const N = NEMS[nemId];
      s.difficulty = opts.difficulty || 'normal';
      const diff = (scn.difficulties || {})[s.difficulty] || {};
      const un = N.unleash || { step: 1, threshold: 999, strike: [] };
      s.step = un.step || 1;
      s.threshold = Math.max(2, un.threshold + (diff.thresholdDelta || 0));
      s.hunger = diff.hungerStart || 0;

      // 일행
      const dupCount = {}, dupSeen = {};
      party.forEach(function (di) { dupCount[di] = (dupCount[di] || 0) + 1; });
      s.mages = party.map(function (di, i) {
        const d = MAGES[di];
        dupSeen[di] = (dupSeen[di] || 0) + 1;
        const ids = [];
        Object.keys(d.startingDeck).forEach(function (id) {
          for (let k = 0; k < d.startingDeck[id]; k++) ids.push(id);
        });
        const lists = [];
        if (i === 0) lists.push(lg);                       // 최상위 레거시 항목은 첫 번째 일행에게
        if (lg.mages && lg.mages[d.id]) lists.push(lg.mages[d.id]);
        lists.forEach(function (l) {
          (l.deckRemove || []).forEach(function (id) { const k = ids.indexOf(id); if (k >= 0) ids.splice(k, 1); });
          (l.deckAdd || []).forEach(function (id) { ids.push(id); });
        });
        return {
          di: di, id: d.id, name: d.name + (dupCount[di] > 1 ? ' ' + dupSeen[di] : ''),
          deck: shuffle(s, ids),                           // 시작할 때 단 한 번만 섞는다
          hand: [], discard: [], played: [], forgotten: [], anchor: 0,
          life: d.life, max: d.life, ember: 0, charge: 0, exhausted: false,
          breaches: d.breaches.map(function (b) {
            return { open: !!b.open, focus: 0, focusedTurn: -1, prepped: null, preppedTurn: -99 };
          })
        };
      });

      const sc = (scn.scaling && scn.scaling[n]) || {};
      s.graveMax = Math.round((scn.gravehold.life + (lg.graveBonus || 0)) * (sc.graveLife || 1) * (diff.graveLife || 1));
      s.graveLife = s.graveMax;
      s.supply = {};
      const sup = resolveSupply(s, opts.supply, nemId);
      s.supplyPiles = sup;
      ['gems', 'relics', 'spells'].forEach(function (g) {
        sup[g].forEach(function (id) {
          if (!C[id]) throw new Error('공급처에 없는 카드: ' + id);
          s.supply[id] = scn.supplyCount[g];
        });
      });
      s.nemMax = Math.round(N.life * (sc.nemLife || 1) * (diff.nemLife || 1)); s.nemLife = s.nemMax;
      s.powers = []; s.minions = [];
      const nd = [];
      Object.keys(N.deck).forEach(function (id) {
        for (let i = 0; i < N.deck[id]; i++) nd.push(id);
      });
      (lg.nemesisAdd || []).forEach(function (id) { nd.push(id); });
      s.nemDeck = shuffle(s, nd); s.nemDiscard = [];

      // 턴 순서 덱: 일행마다 한 장 + 와일드 + 적 2장
      const slots = ((scn.turnDeck && scn.turnDeck.slots) || {})[n] || defaultSlots(n);
      const td = [];
      for (let i = 0; i < n; i++) td.push('M' + i);
      for (let i = 0; i < Math.max(0, slots - n); i++) td.push('W');
      for (let i = 0; i < ((scn.turnDeck && scn.turnDeck.nemesis) || 2); i++) td.push('N');
      s.turnDeck = shuffle(s, td); s.turnDiscard = [];

      s.mages.forEach(function (m, i) { draw(s, i, 5); });
      log(s, '전투 시작. ' + N.name + '이(가) 문 밖으로 몸을 내민다.');
      advance(s);
      return s;
    }

    // ---------- 카드 뽑기: 덱이 비면 버림 더미를 "섞지 않고" 그대로 덱으로 ----------
    function refill(s, mi) {
      const m = s.mages[mi];
      if (!m.deck.length && m.discard.length) {
        m.deck = m.discard; m.discard = [];
        log(s, who(s, mi) + '의 덱이 비어 버림 더미가 덱이 된다. (섞지 않는다)');
      }
    }
    function draw(s, mi, n) {
      const m = s.mages[mi];
      for (let i = 0; i < n; i++) {
        refill(s, mi);
        if (!m.deck.length) return;
        m.hand.push(m.deck.shift());
      }
    }

    // ---------- 승패 ----------
    function check(s) {
      if (s.over) return;
      if (s.nemLife <= 0) { s.nemLife = 0; s.over = 'win'; s.reason = nem(s).name + '이(가) 쓰러졌다.'; }
      else if (s.graveLife <= 0) { s.graveLife = 0; s.over = 'lose'; s.reason = '성채가 무너졌다.'; }
      else if (!living(s).length) { s.over = 'lose'; s.reason = s.mages.length === 1 ? '술사가 쓰러졌다.' : '모든 술사가 쓰러졌다.'; }
      if (s.over) { s.phase = 'over'; log(s, '■ ' + s.reason); }
    }

    // ---------- 피해 / 탈진 ----------
    function dmgTo(s, target, n) {
      if (target && target !== 'N') {
        const mi = s.minions.findIndex(function (m) { return m.uid === target; });
        if (mi >= 0) {
          const m = s.minions[mi];
          m.life -= n;
          log(s, nm(m.id) + '에게 피해 ' + n + (m.life <= 0 ? ' — 쓰러졌다.' : ' (남은 ' + m.life + ')'));
          if (m.life <= 0) { s.minions.splice(mi, 1); s.nemDiscard.push(m.id); }
          return;
        }
      }
      s.nemLife -= n;
      log(s, nem(s).name + '에게 피해 ' + n + ' (남은 ' + Math.max(0, s.nemLife) + ')');
      check(s);
    }
    function exhaust(s, mi) {
      const m = s.mages[mi];
      m.life = 0; m.exhausted = true;
      m.discard = m.discard.concat(m.hand, m.played);
      m.breaches.forEach(function (b) { if (b.prepped) { m.discard.push(b.prepped); b.prepped = null; } });
      m.hand = []; m.played = [];
      log(s, who(s, mi) + '이(가) 쓰러졌다. (탈진)');
      check(s);
    }
    function hitMage(s, mi, n) {
      const m = s.mages[mi];
      if (m.exhausted) return;
      m.life -= n;
      log(s, who(s, mi) + '이(가) ' + n + ' 피해를 입었다 (' + Math.max(0, m.life) + '/' + m.max + ')');
      if (m.life <= 0) exhaust(s, mi);
    }
    // 적 효과가 맞출 술사를 고른다. 시드 난수라 같은 판은 같은 결과.
    function pickMageTarget(s) {
      const alive = living(s);
      if (!alive.length) return -1;
      if (alive.length === 1) return alive[0];
      const rule = nem(s).targeting || 'random';
      if (rule === 'lowest') {
        return alive.slice().sort(function (a, b) { return s.mages[a].life - s.mages[b].life || a - b; })[0];
      }
      if (rule === 'last' && s.lastActive >= 0 && alive.indexOf(s.lastActive) >= 0) return s.lastActive;
      return alive[Math.floor(rnd(s) * alive.length)];
    }

    // ---------- 굶주림 ----------
    function addHunger(s, n, why) {
      if (n < 0) {
        s.hunger = Math.max(0, s.hunger + n);
        log(s, nem(s).name + '의 굶주림이 가라앉는다 (' + s.hunger + '/' + s.threshold + ')');
        return;
      }
      s.hunger += n;
      if (why) log(s, nem(s).name + '의 굶주림이 깊어진다 (' + s.hunger + '/' + s.threshold + ')');
      while (s.hunger >= s.threshold && !s.over) {
        s.hunger -= s.threshold;
        log(s, nem(s).name + '의 굶주림이 폭발한다!');
        applyEffects(s, (nem(s).unleash && nem(s).unleash.strike) || [], null);
      }
    }

    // ---------- 효과 중 선택: pick(카드), allyBreach(동료 새김), power(징조), targets(피해 대상) ----------
    // 대상 일행: "동료가 없으면 자기 자신" — 고른 동료가 없거나 쓰러졌거나 자신이면 자신.
    function allyOrSelf(s, ctx) {
      const a = ctx && ctx.ally;
      if (a != null && a !== ctx.mage && s.mages[a] && !s.mages[a].exhausted) return a;
      return ctx.mage;
    }
    function takePick(ctx) { return ctx && ctx.picks && ctx.picks.length ? ctx.picks.shift() : undefined; }
    function closedOrder(s, t) {          // 닫힌 새김을 열기 쉬운 순서로
      const m = s.mages[t], MD = MAGES[m.di];
      const r = [];
      m.breaches.forEach(function (b, i) {
        if (!b.open) r.push({ i: i, cost: Math.max(0, (MD.breaches[i].openCost || 0) - b.focus) });
      });
      return r.sort(function (a, b) { return a.cost - b.cost || a.i - b.i; });
    }
    function chooseClosedBreach(s, t, ctx) {
      const m = s.mages[t];
      const want = ctx && ctx.allyBreach;
      if (want != null && m.breaches[want] && !m.breaches[want].open) return want;
      const o = closedOrder(s, t);
      return o.length ? o[0].i : -1;
    }

    // 새김을 연다 + 대가(onOpen) 발동. 덧긋기 4번째로 열리든 불씨로 열든 똑같다.
    function openBreach(s, t, bi) {
      const m = s.mages[t], b = m.breaches[bi];
      if (b.open) return;
      b.open = true;
      log(s, m.name + ': 새김 ' + (bi + 1) + '이 열렸다.');
      const d = MAGES[m.di].breaches[bi];
      if (d.onOpen && d.onOpen.length) applyEffects(s, d.onOpen, { mage: t, picks: [], targets: [] });
    }
    function focusBreach(s, t, bi) {
      const b = s.mages[t].breaches[bi];
      b.focus++;
      log(s, s.mages[t].name + ': 새김 ' + (bi + 1) + ' 덧긋기 (' + b.focus + '/4)');
      if (b.focus >= 4) openBreach(s, t, bi);
    }

    // 잊음: 이번 판에서 영구 제거 + 굶주림 +1 (잊은 기억은 문으로 간다)
    function doForget(s, mi, e, ctx) {
      const m = s.mages[mi];
      const n = e.n || 1;
      for (let k = 0; k < n && !s.over; k++) {
        let card = null;
        if (e.from === 'hand') {
          if (!m.hand.length) break;
          const p = takePick(ctx);
          let idx;
          if (p != null && m.hand[p] != null) idx = p;
          else if (e.optional) break;                     // 선택 효과: 고르지 않으면 하지 않는다
          else idx = autoForgetIdx(m);
          card = m.hand.splice(idx, 1)[0];
        } else if (e.from === 'discardTop') {
          if (!m.discard.length) break;
          card = m.discard.pop();
        } else {                                          // deckTop
          refill(s, mi);
          if (!m.deck.length) break;
          card = m.deck.shift();
        }
        m.forgotten.push(card);
        log(s, m.name + '이(가) 「' + nm(card) + '」을(를) 잊는다. 기억은 문으로 간다.');
        addHunger(s, 1, true);
      }
    }
    function cardWorth(id) {              // 기본 선택 규칙용 대략의 값 (비용 우선, 같으면 효과 크기)
      const c = def(id);
      return (c.cost || 0) * 10 + (c.effects || []).reduce(function (a, x) { return a + (x.n || 0); }, 0);
    }
    function autoForgetIdx(m) {           // 필수 잊음의 기본: 가장 싼 카드
      let best = 0;
      m.hand.forEach(function (id, i) { if (cardWorth(id) < cardWorth(m.hand[best])) best = i; });
      return best;
    }
    // 회수: 버림 더미에서 골라 덱 맨 위(기본)/손으로. pick:'top'이면 버림 더미 맨 위를 가져온다.
    function doRecall(s, mi, e, ctx) {
      const t = e.who === 'ally' ? allyOrSelf(s, ctx) : mi;
      const tm = s.mages[t];
      const n = e.n || 1;
      for (let k = 0; k < n; k++) {
        if (!tm.discard.length) break;
        let idx;
        if (e.pick === 'top') idx = tm.discard.length - 1;
        else {
          const p = takePick(ctx);
          if (p != null && tm.discard[p] != null) idx = p;
          else {                                          // 기본: 가장 비싼 카드 (같으면 더 최근 것)
            idx = 0;
            tm.discard.forEach(function (id, i) { if (cardWorth(id) >= cardWorth(tm.discard[idx])) idx = i; });
          }
        }
        const card = tm.discard.splice(idx, 1)[0];
        if (e.to === 'hand') tm.hand.push(card); else tm.deck.unshift(card);
        log(s, tm.name + ': 「' + nm(card) + '」을(를) 되찾아 ' + (e.to === 'hand' ? '손에' : '덱 맨 위에') + ' 둔다.');
      }
    }
    function minionTarget(s, ctx) {       // 잿것 하나: 고른 대상이 잿것이면 그것, 아니면 생명이 가장 낮은 잿것
      if (!s.minions.length) return null;
      if (ctx && ctx.targets && ctx.targets.length) {
        const p = ctx.targets.shift();
        if (p !== 'N' && s.minions.some(function (m) { return m.uid === p; })) return p;
      }
      return s.minions.slice().sort(function (a, b) { return a.life - b.life || a.uid - b.uid; })[0].uid;
    }

    // ---------- 효과 처리 ----------
    function applyEffects(s, effects, ctx) {
      const mi = ctx && ctx.mage != null ? ctx.mage : -1;
      for (let i = 0; i < effects.length; i++) {
        if (s.over) return;
        const e = effects[i];
        switch (e.op) {
          case 'ember': if (mi >= 0) s.mages[mi].ember += e.n; break;
          case 'dmg': {
            let n = e.n;
            if (ctx && ctx.dmgBonus) { n += ctx.dmgBonus; ctx.dmgBonus = 0; }
            dmgTo(s, ctx && ctx.targets ? ctx.targets.shift() : 'N', n);
            break;
          }
          case 'dmgMinion': {
            if (mi < 0) break;
            const u = minionTarget(s, ctx);
            if (u != null) dmgTo(s, u, e.n);
            break;
          }
          case 'dmgAll':
            s.minions.slice().forEach(function (m) { if (!s.over) dmgTo(s, m.uid, e.n); });
            if (!s.over) dmgTo(s, 'N', e.n);
            break;
          case 'heal':
            s.graveLife = Math.min(s.graveMax, s.graveLife + e.n);
            log(s, '성채가 ' + e.n + ' 회복 (' + s.graveLife + '/' + s.graveMax + ')'); break;
          case 'healMage': {
            if (mi < 0) break;
            const t = e.to === 'ally' ? allyOrSelf(s, ctx) : mi;
            const m = s.mages[t];
            m.life = Math.min(m.max, m.life + e.n);
            log(s, who(s, t) + '이(가) ' + e.n + ' 회복 (' + m.life + '/' + m.max + ')'); break;
          }
          case 'charge': {
            if (mi < 0) break;
            const t = e.to === 'ally' ? allyOrSelf(s, ctx) : mi;
            s.mages[t].charge = cap(s, t, s.mages[t].charge + e.n); break;
          }
          case 'chargeReset': if (mi >= 0) { s.mages[mi].charge = 0; log(s, who(s, mi) + '의 열이 빠져나간다.'); } break;
          case 'draw': {
            if (mi < 0) break;
            draw(s, e.to === 'ally' ? allyOrSelf(s, ctx) : mi, e.n); break;
          }
          case 'hitGrave':
            s.graveLife -= e.n; log(s, '성채가 ' + e.n + ' 피해를 입었다 (' + Math.max(0, s.graveLife) + '/' + s.graveMax + ')'); check(s); break;
          case 'hitMage':
            if (e.all) living(s).forEach(function (k) { if (!s.over) hitMage(s, k, e.n); });
            else { const t = pickMageTarget(s); if (t >= 0) hitMage(s, t, e.n); }
            break;
          case 'hitSelf': if (mi >= 0) { hitMage(s, mi, e.n); } break;
          case 'maxLife': {
            if (mi < 0) break;
            const m = s.mages[mi];
            m.max = Math.max(1, m.max - e.n); m.life = Math.max(1, Math.min(m.max, m.life - e.n));
            log(s, who(s, mi) + '의 최대 생명이 ' + e.n + ' 줄었다 (' + m.life + '/' + m.max + ')'); break;
          }
          case 'hunger': addHunger(s, e.n, false); break;
          case 'unleash':
            for (let k = 0; k < e.n && !s.over; k++) addHunger(s, s.step, true);
            break;
          case 'forget': if (mi >= 0) doForget(s, mi, e, ctx); break;
          case 'recall': if (mi >= 0) doRecall(s, mi, e, ctx); break;
          case 'focusAlly': case 'openAlly': {
            if (mi < 0) break;
            const t = allyOrSelf(s, ctx);
            const bi = chooseClosedBreach(s, t, ctx);
            if (bi < 0) break;
            if (e.op === 'openAlly') openBreach(s, t, bi);
            else for (let k = 0; k < (e.n || 1) && !s.mages[t].breaches[bi].open; k++) focusBreach(s, t, bi);
            break;
          }
          case 'peekTurn':
            s.peek = s.turnDeck.length ? s.turnDeck[s.turnDeck.length - 1] : null;
            log(s, '종소리를 미리 듣는다: 다음은 ' + (s.peek === 'N' ? '적' : s.peek === 'W' ? '와일드' : s.peek ? who(s, parseInt(s.peek.slice(1), 10)) : '(다시 섞는다)')); break;
          case 'delayPower': {
            if (!s.powers.length) break;
            let p = ctx && ctx.power != null && s.powers[ctx.power] ? s.powers[ctx.power] : null;
            if (!p) p = s.powers.slice().sort(function (a, b) { return a.tokens - b.tokens; })[0];
            p.tokens += e.n;
            log(s, '[' + nm(p.id) + '] 발동이 ' + e.n + '차례 늦춰진다 (남은 ' + p.tokens + ')'); break;
          }
          case 'anchor': if (mi >= 0) { s.mages[mi].anchor += (e.n || 1); log(s, who(s, mi) + '이(가) 매듭을 묶는다.'); } break;
        }
      }
    }

    // ---------- 균열 (현재 차례인 일행 기준) ----------
    function openCost(s, bi) {
      const m = cur(s);
      return Math.max(0, (MAGES[m.di].breaches[bi].openCost || 0) - m.breaches[bi].focus);
    }
    function castables(s) {
      const m = cur(s), r = [];
      if (!m) return r;
      m.breaches.forEach(function (b, i) { if (b.prepped && b.preppedTurn < s.turnNo) r.push(i); });
      return r;
    }
    // 이 균열에서 시전하면 나오는 피해 횟수와 각 피해량 (균열 보너스 반영) — UI/봇이 대상 선택에 쓴다
    function dmgInstances(s, bi) {
      const m = cur(s), b = m.breaches[bi], d = MAGES[m.di].breaches[bi];
      const arr = [];
      def(b.prepped).effects.forEach(function (e) { if (e.op === 'dmg') arr.push(e.n); });
      if (b.open && d.bonus && d.bonus.type === 'dmg' && arr.length) arr[0] += d.bonus.n;
      return arr;
    }

    // ---------- 턴 진행 ----------
    function advance(s) {
      while (!s.over) {
        if (!s.turnDeck.length) { s.turnDeck = shuffle(s, s.turnDiscard); s.turnDiscard = []; }
        const t = s.turnDeck.pop();
        s.peek = null;
        s.turnDiscard.push(t);
        if (t === 'N') { nemesisTurn(s); continue; }
        if (t === 'W') {
          const alive = living(s);
          if (!alive.length) return;
          if (alive.length === 1) { startMageTurn(s, alive[0]); return; }
          s.phase = 'wild'; s.active = -1;
          log(s, '── 와일드: 누가 움직일지 고른다 ──');
          return;
        }
        const mi = parseInt(t.slice(1), 10);
        if (s.mages[mi].exhausted) continue;
        startMageTurn(s, mi);
        return;
      }
    }
    function startMageTurn(s, mi) {
      const m = s.mages[mi];
      s.active = mi; s.turnNo++; m.ember = 0; m.played = []; s.phase = 'cast';
      log(s, '── ' + m.name + '의 차례 ' + s.turnNo + ' ──');
      if (!castables(s).length) s.phase = 'main';
    }
    function nemesisTurn(s) {
      s.nemTurns++; s.active = -1;
      log(s, '── 적의 차례 ──');
      // 1) 메인 단계: 하수인과 힘을 놓인 순서(오래된 것부터)대로 처리
      const items = [];
      s.powers.forEach(function (p) { items.push({ k: 'p', o: p }); });
      s.minions.forEach(function (m) { items.push({ k: 'm', o: m }); });
      items.sort(function (a, b) { return a.o.uid - b.o.uid; });
      for (let i = 0; i < items.length; i++) {
        if (s.over) return;
        const it = items[i], o = it.o;
        if (it.k === 'p') {
          if (s.powers.indexOf(o) < 0) continue;
          o.tokens--;
          if (o.tokens <= 0) {
            log(s, '[' + nm(o.id) + '] 발동!');
            s.powers.splice(s.powers.indexOf(o), 1); s.nemDiscard.push(o.id);
            applyEffects(s, NC[o.id].effects, null);
          } else log(s, '[' + nm(o.id) + '] 남은 ' + o.tokens);
        } else {
          if (s.minions.indexOf(o) < 0) continue;
          log(s, nm(o.id) + '의 공격');
          applyEffects(s, NC[o.id].each, null);
        }
      }
      if (s.over) return;
      // 2) 뽑기 단계: 적 카드 한 장 (공격은 즉시 처리, 하수인·힘은 놓는다 — 놓인 차례에는 움직이지 않는다)
      if (!s.nemDeck.length) { s.nemDeck = shuffle(s, s.nemDiscard); s.nemDiscard = []; }
      if (!s.nemDeck.length) { log(s, '적 덱이 비었다.'); return; }
      const id = s.nemDeck.pop();
      const d = NC[id];
      if (d.kind === 'attack') {
        log(s, '「' + d.name + '」');
        s.nemDiscard.push(id);
        applyEffects(s, d.effects, null);
      } else if (d.kind === 'power') {
        s.powers.push({ uid: s.uid++, id: id, tokens: d.countdown });
        log(s, '「' + d.name + '」 — ' + d.countdown + '번의 적 차례 뒤 발동');
      } else if (d.kind === 'minion') {
        s.minions.push({ uid: s.uid++, id: id, life: d.life });
        log(s, '「' + d.name + '」 등장 (생명 ' + d.life + ')');
      }
      if (!s.over && d.onDraw) applyEffects(s, d.onDraw, null);
    }

    // ---------- 행동 검증 (UI 버튼 활성/비활성에도 사용) ----------
    function validate(s, a) {
      if (s.over) return '게임이 끝났다.';
      if (s.phase === 'wild') {
        if (a.type !== 'pickMage') return '먼저 움직일 술사를 골라야 한다.';
        if (!s.mages[a.mage] || s.mages[a.mage].exhausted) return '고를 수 없는 술사다.';
        return null;
      }
      if (a.type === 'pickMage') return '지금은 술사를 고르는 단계가 아니다.';
      const m = cur(s);
      if (!m) return '지금은 일행의 차례가 아니다.';
      const MD = MAGES[m.di];
      const main = s.phase === 'main';
      if (a.ally != null && (!s.mages[a.ally] || s.mages[a.ally].exhausted || a.ally === s.active)) return '동료 대상이 올바르지 않다.';
      switch (a.type) {
        case 'cast':
          if (s.phase !== 'cast') return '시전 단계가 아니다.';
          if (castables(s).indexOf(a.breach) < 0) return '시전할 수 없는 균열이다.';
          return null;
        case 'endCast':
          if (s.phase !== 'cast') return '시전 단계가 아니다.';
          if (castables(s).some(function (i) { return !m.breaches[i].open; })) return '닫힌 균열의 주문은 반드시 시전해야 한다.';
          return null;
        case 'play': {
          if (!main) return '주 단계가 아니다.';
          const c = m.hand[a.idx] && def(m.hand[a.idx]);
          if (!c || (c.type !== 'gem' && c.type !== 'relic')) return '낼 수 없는 카드다.';
          return null;
        }
        case 'buy': {
          if (!main) return '주 단계가 아니다.';
          const c = C[a.id];
          if (!c || !(s.supply[a.id] > 0)) return '재고가 없다.';
          if (m.ember < c.cost) return '불씨가 부족하다.';
          return null;
        }
        case 'focus': {
          if (!main) return '주 단계가 아니다.';
          const b = m.breaches[a.breach], d = MD.breaches[a.breach];
          if (!b || b.open) return '닫힌 균열만 집중할 수 있다.';
          if (m.ember < d.focusCost) return '불씨가 부족하다.';
          return null;
        }
        case 'open': {
          if (!main) return '주 단계가 아니다.';
          const b = m.breaches[a.breach];
          if (!b || b.open) return '닫힌 균열만 열 수 있다.';
          if (m.ember < openCost(s, a.breach)) return '불씨가 부족하다.';
          return null;
        }
        case 'prep': {
          if (!main) return '주 단계가 아니다.';
          const c = m.hand[a.idx] && def(m.hand[a.idx]);
          const b = m.breaches[a.breach];
          if (!c || c.type !== 'spell') return '주문 카드가 아니다.';
          if (!b) return '없는 균열이다.';
          if (b.prepped) return '이미 주문이 준비되어 있다.';
          if (!b.open && b.focusedTurn !== s.turnNo) return '닫힌 균열은 이번 차례에 집중해야 준비할 수 있다.';
          return null;
        }
        case 'disarm': {
          if (!main) return '주 단계가 아니다.';
          const p = s.powers[a.idx];
          if (!p) return '대상이 없다.';
          if (m.ember < NC[p.id].disarm) return '불씨가 부족하다.';
          return null;
        }
        case 'ability':
          if (!main) return '주 단계가 아니다.';
          if (m.charge < MD.ability.cost) return '충전이 부족하다.';
          return null;
        case 'endMain':
          if (!main) return '주 단계가 아니다.';
          if (a.order) {
            const o = a.order.slice().sort(function (x, y) { return x - y; });
            if (o.length !== m.played.length || o.some(function (v, i) { return v !== i; })) return '버림 순서가 올바르지 않다.';
          }
          return null;
      }
      return '알 수 없는 행동이다.';
    }

    function ctxOf(a, mi) {
      return {
        mage: mi, ally: a.ally, targets: (a.targets || []).slice(), picks: (a.pick || []).slice(),
        power: a.power, allyBreach: a.allyBreach, dmgBonus: 0
      };
    }

    function act(s, a) {
      const err = validate(s, a);
      if (err) return { ok: false, err: err };
      if (a.type === 'pickMage') {
        log(s, who(s, a.mage) + '이(가) 와일드 차례를 가져간다.');
        startMageTurn(s, a.mage);
        return { ok: true };
      }
      const mi = s.active, m = s.mages[mi], MD = MAGES[m.di];
      switch (a.type) {
        case 'cast': {
          const b = m.breaches[a.breach], d = MD.breaches[a.breach];
          const id = b.prepped;
          b.prepped = null; b.preppedTurn = -99;
          log(s, '「' + nm(id) + '」 시전 (' + m.name + ', 새김 ' + (a.breach + 1) + ')');
          const ctx = ctxOf(a, mi);
          ctx.dmgBonus = (b.open && d.bonus && d.bonus.type === 'dmg') ? d.bonus.n : 0;
          applyEffects(s, def(id).effects, ctx);
          if (!s.over && b.open && d.bonus) {
            const bn = d.bonus;
            if (bn.type === 'ember') m.ember += bn.n;
            else if (bn.type === 'charge') m.charge = cap(s, mi, m.charge + bn.n);
            else if (bn.type === 'recall') doRecall(s, mi, { op: 'recall', n: bn.n, to: 'top' }, ctx);
            else if (bn.type === 'heal') applyEffects(s, [{ op: 'heal', n: bn.n }], ctx);
          }
          m.discard.push(id);                       // 시전한 주문은 효과가 끝난 뒤 버림 더미 맨 위로
          if (!s.over) m.charge = cap(s, mi, m.charge + (MD.chargeOnCast || 0));
          if (!s.over && !castables(s).length) s.phase = 'main';
          break;
        }
        case 'endCast': s.phase = 'main'; break;
        case 'play': {
          const id = m.hand.splice(a.idx, 1)[0];
          m.played.push(id);
          log(s, '「' + nm(id) + '」 사용: ' + describe(def(id).effects));
          applyEffects(s, def(id).effects, ctxOf(a, mi));
          break;
        }
        case 'buy':
          m.ember -= C[a.id].cost; s.supply[a.id]--; m.discard.push(a.id);
          log(s, m.name + ': 「' + nm(a.id) + '」 획득 (버림 더미 맨 위)'); break;
        case 'focus': {
          const d = MD.breaches[a.breach];
          m.ember -= d.focusCost; m.breaches[a.breach].focusedTurn = s.turnNo;
          focusBreach(s, mi, a.breach);
          break;
        }
        case 'open': {
          m.ember -= openCost(s, a.breach);
          openBreach(s, mi, a.breach);
          break;
        }
        case 'prep': {
          const id = m.hand.splice(a.idx, 1)[0];
          const b = m.breaches[a.breach];
          b.prepped = id; b.preppedTurn = s.turnNo;
          log(s, '「' + nm(id) + '」 준비 (새김 ' + (a.breach + 1) + ')'); break;
        }
        case 'disarm': {
          const p = s.powers[a.idx];
          m.ember -= NC[p.id].disarm;
          s.powers.splice(a.idx, 1); s.nemDiscard.push(p.id);
          log(s, '[' + nm(p.id) + '] 해제');
          break;
        }
        case 'ability': {
          m.charge -= MD.ability.cost;
          log(s, m.name + '의 기술 「' + MD.ability.name + '」');
          applyEffects(s, MD.ability.effects, ctxOf(a, mi));
          break;
        }
        case 'endMain': {
          const order = a.order || m.played.map(function (_, i) { return i; });
          order.forEach(function (i) { m.discard.push(m.played[i]); });
          m.played = []; m.ember = 0;
          draw(s, mi, Math.max(0, 5 - m.hand.length));
          s.lastActive = mi; s.active = -1;
          advance(s);
          break;
        }
      }
      // 자기 차례에 쓰러졌다면(자기 피해 등) 그 차례는 거기서 끝난다
      if (!s.over && s.active >= 0 && s.mages[s.active].exhausted) {
        s.lastActive = s.active; s.active = -1;
        advance(s);
      }
      return { ok: true };
    }

    // 지금 누가 행동해야 하는지: 'human' | 'bot' | null(끝남)
    function controller(s) {
      if (s.over) return null;
      if (s.phase === 'wild') {
        return living(s).some(function (i) { return s.seats[i] === 'human'; }) ? 'human' : 'bot';
      }
      return s.active >= 0 ? s.seats[s.active] : null;
    }

    return {
      scn: scn, newGame: newGame, act: act, validate: validate,
      castables: castables, dmgInstances: dmgInstances, openCost: openCost,
      cur: cur, living: living, mageDef: mdef, controller: controller, nem: nem,
      poolOf: poolOf, NC: NC, nemeses: Object.keys(NEMS),
      def: def, name: nm, describe: describe
    };
  }

  return { create: create, describe: describe };
});
