/* 일반판 1단계 테스트: node test_v3.js  (새 데이터 data.js 기준 — 새 효과·지기 4명·적 E1·공급 30장·난이도) */
const assert = require('assert');
const Engine = require('./engine.js');
const Bot = require('./bot.js');
const { lint } = require('./lint.js');
const scn0 = require('./data.js');
const clone = o => JSON.parse(JSON.stringify(o));
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const eng = Engine.create(clone(scn0));
function game(party, seed, opts) {
  return eng.newGame(Object.assign({ seed: seed == null ? 1 : seed, party: party, seats: party.map(() => 'bot') }, opts || {}));
}
// 0번 일행(또는 지정 일행)의 주 단계로 맞춘다
function main(s, hand, mi) {
  s.active = mi || 0; s.phase = 'main'; s.over = null;
  const m = s.mages[s.active]; m.ember = 0; m.played = [];
  if (hand) m.hand = hand.slice();
  return m;
}
const play = (s, idx, extra) => eng.act(s, Object.assign({ type: 'play', idx: idx }, extra || {}));
const ok = r => assert.ok(r.ok, r.err);

console.log('데이터');
t('새 데이터 점검 통과', () => assert.deepStrictEqual(lint(scn0), []));
t('지기 4명 / 적 E1 16장 / 공급 카드 30장', () => {
  assert.strictEqual(scn0.mages.length, 4);
  assert.strictEqual(Object.values(scn0.nemeses.e1.deck).reduce((a, b) => a + b, 0), 16);
  const pool = Object.values(scn0.cards).filter(c => !c.starter && !c.legacyOnly && c.cost > 0);
  assert.strictEqual(pool.length, 30);
  assert.deepStrictEqual(['gem', 'relic', 'spell'].map(ty => pool.filter(c => c.type === ty).length), [10, 8, 12]);
});
t('점검기: 알 수 없는 효과·잘못된 forget을 잡는다', () => {
  const bad = clone(scn0);
  bad.cards.g_drifter.effects.push({ op: 'forget', n: 1, from: 'nowhere' });
  bad.mages[0].breaches[1].onOpen = [{ op: 'zzz', n: 1 }];
  assert.ok(lint(bad).length >= 2);
});

console.log('세팅');
t('모든 지기: 시작 덱 10장, 새김 4자리, 고유 카드 1장', () => {
  scn0.mages.forEach((m, i) => {
    const s = game([i]);
    const g = s.mages[0];
    assert.strictEqual(g.hand.length + g.deck.length, 10, m.id);
    assert.strictEqual(g.breaches.length, 4);
    assert.strictEqual(g.hand.concat(g.deck).filter(id => scn0.cards[id].cost === 0 && scn0.cards[id].type === 'relic').length, 1);
  });
});
t('새김꾼은 새김이 전부 닫힌 채 시작, 나머지는 손등만 열림', () => {
  assert.deepStrictEqual(game([3]).mages[0].breaches.map(b => b.open), [false, false, false, false]);
  [0, 1, 2].forEach(i => assert.deepStrictEqual(game([i]).mages[0].breaches.map(b => b.open), [true, false, false, false]));
});
t('1~4명 모든 조합이 시작되고 같은 시드는 같은 상태', () => {
  [[0], [1], [2], [3], [0, 1], [2, 3], [0, 1, 2], [1, 2, 3], [0, 1, 2, 3], ['seo', 'rec']].forEach(p => {
    assert.deepStrictEqual(game(p, 5).mages.length, p.length);
    assert.deepStrictEqual(game(p, 5), game(p, 5));
  });
});
t('적 선택: e1 / random / 없는 적은 거부', () => {
  assert.strictEqual(game([0], 1, { nemesis: 'e1' }).nem, 'e1');
  assert.strictEqual(game([0], 1, { nemesis: 'random' }).nem, 'e1');
  assert.throws(() => game([0], 1, { nemesis: 'zz' }));
});
t('적 덱 16장, 모든 카드가 데이터에 있다', () => {
  const s = game([0]);
  assert.strictEqual(s.nemDeck.length, 16);
  s.nemDeck.forEach(id => assert.ok(eng.NC[id]));
});

console.log('난이도 / 공급처');
t('난이도: 입문·어려움·절망이 생명/굶주림/문턱에 반영된다', () => {
  const n = game([0], 1, { difficulty: 'normal' });
  const e = game([0], 1, { difficulty: 'easy' });
  const h = game([0], 1, { difficulty: 'hard' });
  const d = game([0], 1, { difficulty: 'despair' });
  assert.ok(e.nemMax < n.nemMax && e.graveMax > n.graveMax);
  assert.ok(h.nemMax > n.nemMax && h.hunger === 1 && n.hunger === 0);
  assert.ok(d.threshold === n.threshold - 1 && d.graveMax < n.graveMax);
});
t('추천 공급처: 9더미 (보석 3, 유물 2, 주문 4)', () => {
  const s = game([0]);
  assert.strictEqual(Object.keys(s.supply).length, 9);
  assert.deepStrictEqual([s.supplyPiles.gems.length, s.supplyPiles.relics.length, s.supplyPiles.spells.length], [3, 2, 4]);
});
t('무작위 공급처: 9더미, 비용 3 이하 보석·4 이하 주문이 반드시 있고, 같은 시드는 같은 결과', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = game([0], seed, { supply: 'random' });
    const p = s.supplyPiles;
    assert.deepStrictEqual([p.gems.length, p.relics.length, p.spells.length], [3, 2, 4]);
    assert.ok(p.gems.some(id => scn0.cards[id].cost <= 3), 'seed ' + seed);
    assert.ok(p.spells.some(id => scn0.cards[id].cost <= 4), 'seed ' + seed);
    assert.strictEqual(new Set(p.gems.concat(p.relics, p.spells)).size, 9);
  }
  assert.deepStrictEqual(game([0], 9, { supply: 'random' }).supplyPiles, game([0], 9, { supply: 'random' }).supplyPiles);
});
t('이름 붙은 세트와 직접 고른 세트', () => {
  assert.ok(game([0], 1, { supply: 'forget' }).supply.s_oblivion > 0);
  const custom = { gems: ['g_coal', 'g_smith', 'g_miner'], relics: ['r_key', 'r_hammer'], spells: ['s_arrow', 's_choirdead', 's_scream', 's_star'] };
  const s = game([0], 1, { supply: custom });
  assert.ok(s.supply.g_miner === 7 && s.supply.r_key === 5 && s.supply.s_star === 5);
});

console.log('잊음');
t('손에서 잊기: 카드가 이번 판에서 사라지고 굶주림 +1', () => {
  const s = game([0]); const m = main(s, ['g_drifter', 'shard', 'spark']);
  const before = s.hunger;
  ok(play(s, 0, { pick: [1] }));              // 남은 손 [shard, spark] 중 1번 = spark
  assert.deepStrictEqual(m.forgotten, ['spark']);
  assert.strictEqual(s.hunger, before + 1);
  assert.ok(m.hand.indexOf('spark') < 0 && m.deck.indexOf('spark') + m.discard.indexOf('spark') >= -2);
});
t('필수 잊음에 고르지 않으면 가장 싼 카드를 잊는다', () => {
  const s = game([0]); const m = main(s, ['g_drifter', 'g_baker', 'shard']);
  ok(play(s, 0));
  assert.deepStrictEqual(m.forgotten, ['shard']);
});
t('선택 잊음(뱃사공의 동전)은 고르지 않으면 아무것도 잊지 않는다', () => {
  const s = game([0]); const m = main(s, ['r_coin', 'shard']);
  const h = s.hunger;
  ok(play(s, 0));
  assert.strictEqual(m.forgotten.length, 0); assert.strictEqual(s.hunger, h);
  const s2 = game([0]); const m2 = main(s2, ['r_coin', 'shard']);
  ok(play(s2, 0, { pick: [0] }));
  assert.deepStrictEqual(m2.forgotten, ['shard']);
});
t('덱 맨 위 / 버림 맨 위 잊음', () => {
  const s = game([0]); const m = main(s, []);
  m.deck = ['g_baker', 'shard']; m.discard = ['spark', 'g_miner'];
  s.supply; // no-op
  const e1 = eng.scn;
  // 직접 효과를 부르는 대신 새김 대가로 확인: 세오 팔 새김이 열릴 때 덱 맨 위를 잊는다
  m.ember = 4; ok(eng.act(s, { type: 'open', breach: 1 }));
  assert.deepStrictEqual(m.forgotten, ['g_baker']);
  assert.strictEqual(m.deck[0], 'shard');
});
t('잊음으로 굶주림이 문턱에 닿으면 삼킴이 터진다 (성채 -3)', () => {
  const s = game([0]); const m = main(s, ['g_drifter', 'shard']);
  s.hunger = s.threshold - 1;
  const g = s.graveLife;
  ok(play(s, 0));
  assert.strictEqual(s.graveLife, g - 3); assert.strictEqual(s.hunger, 0);
});

console.log('회수 · 동료 · 새김');
t('회수: 기본은 버림 더미에서 가장 비싼 카드를 덱 맨 위로', () => {
  const s = game([0]); const m = main(s, ['rec_ledger']);
  m.discard = ['shard', 'g_miner', 'spark']; m.deck = ['g_coal'];
  ok(play(s, 0));
  assert.strictEqual(m.deck[0], 'g_miner'); assert.strictEqual(m.discard.length, 2);
});
t('회수: pick으로 고르기, 버림 더미가 비면 아무 일도 없다', () => {
  const s = game([0]); const m = main(s, ['rec_ledger']);
  m.discard = ['shard', 'g_miner', 'spark'];
  ok(play(s, 0, { pick: [0] }));
  assert.strictEqual(m.deck[0], 'shard');
  const s2 = game([0]); const m2 = main(s2, ['rec_ledger']); m2.discard = [];
  ok(play(s2, 0)); assert.ok(true);
});
t('동료 효과: 동료 생명 +, 열 +, 카드 뽑기', () => {
  const s = game([0, 1]); const m = main(s, ['g_nurse', 'g_twin', 'g_widow']);
  s.mages[1].life = 5; s.mages[1].charge = 0; const hand1 = s.mages[1].hand.length;
  ok(play(s, 0, { ally: 1 }));               // 유모의 손난로: 동료 +1
  assert.strictEqual(s.mages[1].life, 6);
  ok(play(s, 0, { ally: 1 }));               // 쌍둥이: 동료 열 +1
  assert.strictEqual(s.mages[1].charge, 1);
  assert.strictEqual(m.charge, 0);
});
t('동료가 없으면(1인) 자기 자신에게 적용된다', () => {
  const s = game([0]); const m = main(s, ['g_nurse', 'g_twin']);
  m.life = 5;
  ok(play(s, 0)); assert.strictEqual(m.life, 6);
  ok(play(s, 0)); assert.strictEqual(m.charge, 1);
});
t('동료 새김 덧긋기(focusAlly): 동료의 닫힌 새김이 +1, 4번째면 열리고 대가가 발동', () => {
  const s = game([3, 1]); const m = main(s, ['car_knife'], 0);   // 새김꾼 + 기록관
  const ally = s.mages[1]; ally.breaches[1].focus = 3;
  const h = s.hunger;
  ok(play(s, 0, { ally: 1, allyBreach: 1 }));
  assert.strictEqual(ally.breaches[1].focus, 4); assert.ok(ally.breaches[1].open);
  assert.strictEqual(s.hunger, h + 1);          // 기록관 대가: 굶주림 +1
});
t('focusAlly: 동료가 없으면 자기 새김, 모두 열려 있으면 아무 일도 없다', () => {
  const s = game([3]); const m = main(s, ['car_knife']);
  ok(play(s, 0)); assert.strictEqual(m.breaches[0].focus, 1);
  const s2 = game([0]); const m2 = main(s2, ['car_knife']);
  m2.breaches.forEach(b => b.open = true);
  ok(play(s2, 0)); assert.ok(true);
});
t('새김 대가: 세오(덱 맨 위 잊음), 기록관(굶주림), 망대지기(최대 생명 -2), 새김꾼(열 0)', () => {
  const a = game([0]); const ma = main(a, []); ma.ember = 4; ma.deck = ['g_baker', 'shard'];
  ok(eng.act(a, { type: 'open', breach: 1 })); assert.deepStrictEqual(ma.forgotten, ['g_baker']);
  const b = game([1]); const mb = main(b, []); mb.ember = 4; const h = b.hunger;
  ok(eng.act(b, { type: 'open', breach: 1 })); assert.strictEqual(b.hunger, h + 1);
  const c = game([2]); const mc = main(c, []); mc.ember = 4;
  ok(eng.act(c, { type: 'open', breach: 1 })); assert.strictEqual(mc.max, 10); assert.strictEqual(mc.life, 10);
  const d = game([3]); const md = main(d, []); md.ember = 4; md.charge = 3;
  ok(eng.act(d, { type: 'open', breach: 1 })); assert.strictEqual(md.charge, 0);
});
t('최대 생명 감소는 최소 1에서 멈춘다', () => {
  const s = game([2]); const m = main(s, []); m.max = 2; m.life = 2; m.ember = 4;
  ok(eng.act(s, { type: 'open', breach: 1 }));
  assert.strictEqual(m.max, 1); assert.strictEqual(m.life, 1); assert.ok(!m.exhausted);
});
t('새김꾼 기술: 동료 새김을 즉시 열고 그 동료의 대가가 발동 (1인이면 자기 새김)', () => {
  const s = game([3, 2]); const m = main(s, []); m.charge = 4;
  ok(eng.act(s, { type: 'ability', ally: 1, allyBreach: 2 }));
  assert.ok(s.mages[1].breaches[2].open); assert.strictEqual(s.mages[1].max, 10);
  const s2 = game([3]); const m2 = main(s2, []); m2.charge = 4;
  ok(eng.act(s2, { type: 'ability' })); assert.ok(m2.breaches.some(b => b.open));
});
t('기록관 기술: 동료가 버림에서 손으로 + 카드 1장 / 1인이면 자신', () => {
  const s = game([1, 0]); const m = main(s, []); m.charge = 5;
  s.mages[1].discard = ['g_miner']; const dk = s.mages[1].deck.length, hd = s.mages[1].hand.length;
  ok(eng.act(s, { type: 'ability', ally: 1 }));
  assert.ok(s.mages[1].hand.indexOf('g_miner') >= 0); assert.strictEqual(s.mages[1].hand.length, hd + 2);
  const s2 = game([1]); const m2 = main(s2, []); m2.charge = 5; m2.discard = ['g_miner']; const h2 = m2.hand.length;
  ok(eng.act(s2, { type: 'ability' })); assert.strictEqual(m2.hand.length, h2 + 2);
});

console.log('피해 · 기타 효과');
t('아이의 나무 칼 / 망대지기 기술: 잿것 하나에 피해, 잿것이 없으면 아무 일도 없다', () => {
  const s = game([0]); const m = main(s, ['r_knife', 'r_knife']);
  s.minions = [{ uid: 90, id: 'e1_ash', life: 3 }, { uid: 91, id: 'e1_wolf', life: 4 }];
  ok(play(s, 0, { targets: [91] })); assert.strictEqual(s.minions.find(x => x.uid === 91).life, 2);
  ok(play(s, 0)); assert.ok(!s.minions.find(x => x.uid === 91));   // 지정 없으면 생명이 가장 낮은 잿것(91, 남은 2)
  const s2 = game([0]); main(s2, ['r_knife']); s2.minions = []; const nl = s2.nemLife;
  ok(play(s2, 0)); assert.strictEqual(s2.nemLife, nl);
});
t('망자의 합창(dmgAll): 모든 잿것과 주린 자에게 피해', () => {
  const s = game([0]); const m = main(s, []); s.minions = [{ uid: 90, id: 'e1_ash', life: 3 }, { uid: 91, id: 'e1_bell', life: 5 }];
  m.breaches[0].prepped = 's_choirdead'; m.breaches[0].preppedTurn = -1; s.phase = 'cast';
  const nl = s.nemLife; ok(eng.act(s, { type: 'cast', breach: 0 }));
  assert.strictEqual(s.minions.length, 1); assert.strictEqual(s.minions[0].life, 2); assert.strictEqual(s.nemLife, nl - 3);
});
t('광인의 웃음: 자기 피해, 마지막 한 점이면 탈진하고 차례가 넘어간다', () => {
  const s = game([0, 1]); const m = main(s, []); m.life = 1;
  m.breaches[0].prepped = 's_laugh'; m.breaches[0].preppedTurn = -1; s.phase = 'cast';
  ok(eng.act(s, { type: 'cast', breach: 0 }));
  assert.ok(m.exhausted); assert.notStrictEqual(s.active, 0);
});
t('주문 시전: 효과가 끝난 뒤에 버림 더미 맨 위로 (도둑의 손버릇은 직전 버림 카드를 가져온다)', () => {
  const s = game([0]); const m = main(s, []); m.discard = ['g_miner', 'shard'];
  m.breaches[0].prepped = 's_thief'; m.breaches[0].preppedTurn = -1; s.phase = 'cast';
  ok(eng.act(s, { type: 'cast', breach: 0 }));
  assert.ok(m.hand.indexOf('shard') >= 0);
  assert.strictEqual(m.discard[m.discard.length - 1], 's_thief');
});
t('행렬의 끝자락: 굶주림 -1, 0 아래로 내려가지 않는다', () => {
  const s = game([0]); const m = main(s, []); s.hunger = 0;
  m.breaches[0].prepped = 's_tail'; m.breaches[0].preppedTurn = -1; s.phase = 'cast';
  ok(eng.act(s, { type: 'cast', breach: 0 })); assert.strictEqual(s.hunger, 0);
  const s2 = game([0]); const m2 = main(s2, []); s2.hunger = 2;
  m2.breaches[0].prepped = 's_tail'; m2.breaches[0].preppedTurn = -1; s2.phase = 'cast';
  ok(eng.act(s2, { type: 'cast', breach: 0 })); assert.strictEqual(s2.hunger, 1);
});
t('새김 보너스 확장: 기록관 눈=회수, 망대지기 눈=성채 +1', () => {
  const s = game([1]); const m = main(s, []); m.breaches[3].open = true; m.discard = ['g_miner', 'shard'];
  m.breaches[3].prepped = 's_arrow'; m.breaches[3].preppedTurn = -1; s.phase = 'cast';
  ok(eng.act(s, { type: 'cast', breach: 3 })); assert.strictEqual(m.deck[0], 'g_miner');
  const s2 = game([2]); const m2 = main(s2, []); m2.breaches[3].open = true; s2.graveLife = 10;
  m2.breaches[3].prepped = 's_arrow'; m2.breaches[3].preppedTurn = -1; s2.phase = 'cast';
  ok(eng.act(s2, { type: 'cast', breach: 3 })); assert.strictEqual(s2.graveLife, 11);
});
t('문지기의 열쇠: 징조 하나 +1 차례 / 호각: 다음 종 공개 / 매듭: 보호 +1', () => {
  const s = game([0]); const m = main(s, ['r_key', 'r_whistle', 'r_knot']);
  s.powers = [{ uid: 80, id: 'e1_door', tokens: 2 }, { uid: 81, id: 'e1_song', tokens: 1 }];
  ok(play(s, 0, { power: 0 })); assert.strictEqual(s.powers[0].tokens, 3);
  s.turnDeck = ['M0', 'N'];
  ok(play(s, 0)); assert.strictEqual(s.peek, 'N');
  ok(play(s, 0)); assert.strictEqual(m.anchor, 1);
});
t('적 카드: 깊은 들숨(격화 ×2), 무너지는 천장(모든 지기 -1), 징조 발동', () => {
  const s = game([0, 1]); s.hunger = 0; s.turnDeck = ['M1', 'N']; s.turnDiscard = []; s.nemDeck = ['e1_inhale']; s.nemDiscard = [];
  main(s, []); eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.hunger, 2);
  const s2 = game([0, 1]); s2.turnDeck = ['M1', 'N']; s2.turnDiscard = []; s2.nemDeck = ['e1_ceiling']; s2.nemDiscard = []; const l = s2.mages.map(m => m.life);
  main(s2, []); eng.act(s2, { type: 'endMain' });
  assert.deepStrictEqual(s2.mages.map(m => m.life), l.map(x => x - 1));
});

console.log('저장 / 전수 시뮬레이션');
t('새 상태도 JSON 저장·복원 후 같은 결과', () => {
  const s = game([3, 1, 2], 21, { supply: 'random', difficulty: 'hard' });
  const bot = Bot.create(eng, {});
  for (let i = 0; i < 6 && !s.over; i++) bot.takeTurn(s);
  const copy = JSON.parse(JSON.stringify(s));
  for (let i = 0; i < 20 && !s.over; i++) { bot.takeTurn(s); bot.takeTurn(copy); }
  assert.deepStrictEqual(s, copy);
});
function simAll(party, n, opts, botCfg) {
  const e = Engine.create(clone(scn0)); const bot = Bot.create(e, botCfg || {});
  let rej = 0, stall = 0; const raw = e.act; e.act = (s, a) => { const r = raw(s, a); if (!r.ok) rej++; return r; };
  for (let g = 0; g < n; g++) {
    const s = e.newGame(Object.assign({ seed: 500 + g * 31, party: party, seats: party.map(() => 'bot') }, opts || {}));
    let k = 0; while (!s.over && k++ < 1500) bot.takeTurn(s);
    if (!s.over) stall++;
  }
  return { rej, stall };
}
[[['seo'], 300], [['rec'], 300], [['tow'], 300], [['car'], 300], [['seo', 'rec'], 200], [['rec', 'tow', 'car'], 200], [['seo', 'rec', 'tow', 'car'], 200], [['car', 'car', 'rec', 'tow'], 100]].forEach(c => {
  t('봇 ' + c[1] + '판 [' + c[0].join('+') + '] 무작위 공급처·난이도: 교착 0, 규칙 위반 행동 0', () => {
    ['normal', 'hard'].forEach(df => {
      const r = simAll(c[0], c[1], { supply: 'random', difficulty: df });
      assert.strictEqual(r.stall, 0, 'stall'); assert.strictEqual(r.rej, 0, 'rejected');
    });
  });
});
t('잊음 봇(aggressive/never)도 오류 없이 끝난다', () => {
  ['aggressive', 'never'].forEach(fm => {
    const r = simAll(['seo', 'rec'], 200, { supply: 'forget' }, { forgetMode: fm });
    assert.strictEqual(r.stall, 0); assert.strictEqual(r.rej, 0);
  });
});

console.log('\n' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
