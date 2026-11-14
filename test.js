/* 규칙 테스트: node test.js */
const assert = require('assert');
const Engine = require('./engine.js');
const Bot = require('./bot.js');
const { lint } = require('./lint.js');
const scn0 = require('./fixture.js');
const clone = o => JSON.parse(JSON.stringify(o));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
// 같은 일행 정의를 여러 명이 쓰는 파티로 새 게임을 만든다 (n명, 기본 1명)
function fresh(seed, mut, n) {
  const scn = clone(scn0);
  if (mut) mut(scn);
  const eng = Engine.create(scn);
  const party = Array(n || 1).fill(0);
  return { eng, scn, s: eng.newGame({ seed: seed == null ? 1 : seed, party, seats: party.map(() => 'bot') }) };
}
// 지금 차례인 일행의 주 단계로 맞춰 놓고 손을 직접 지정하는 도우미
function mainPhase(eng, s, hand) {
  if (s.active < 0) {            // 적 차례/와일드 중이면 0번 일행 차례로 강제
    s.active = 0; s.phase = 'main';
  }
  const m = eng.cur(s);
  s.phase = 'main'; m.ember = 0; m.played = []; s.over = null;
  if (hand) m.hand = hand.slice();
  return m;
}
// 턴 순서 덱을 고정한다 (pop으로 뒤에서부터 뽑는다)
function setTurns(s, arr) { s.turnDeck = arr.slice(); s.turnDiscard = []; }

console.log('데이터');
t('시나리오 데이터 점검 통과', () => assert.deepStrictEqual(lint(scn0), []));
t('점검기: 없는 일행/잘못된 효과를 잡는다', () => {
  const bad = clone(scn0);
  bad.mages[0].startingDeck.nope = 1;
  bad.nemesis.cards.a_breath.onDraw = [{ op: 'xxx', n: 1 }];
  assert.ok(lint(bad).length >= 2);
});

console.log('세팅');
t('시작 덱 10장: 손 5 + 덱 5 (첫 차례 전)', () => {
  const { s } = fresh(3);
  const m = s.mages[0];
  assert.strictEqual(m.hand.length + m.deck.length + m.discard.length, 10);
  assert.strictEqual(m.hand.length, 5);
});
t('공급처 9더미 (보석 3x7, 유물 2x5, 주문 4x5)', () => {
  const { s } = fresh();
  const v = Object.values(s.supply);
  assert.strictEqual(v.length, 9);
  assert.strictEqual(v.reduce((a, b) => a + b, 0), 21 + 10 + 20);
});
t('균열: 1번만 열려 있고 나머지는 닫힘', () => {
  const { s } = fresh();
  assert.deepStrictEqual(s.mages[0].breaches.map(b => b.open), [true, false, false, false]);
});
t('같은 시드는 같은 시작 상태', () => {
  assert.deepStrictEqual(fresh(42).s, fresh(42).s);
  assert.deepStrictEqual(fresh(42, null, 3).s, fresh(42, null, 3).s);
});

console.log('일행 1~4인');
t('인원별 턴 순서 덱: 일행 한 장씩 + 와일드 + 적 2장', () => {
  [1, 2, 3, 4].forEach(n => {
    const { s } = fresh(7, null, n);
    const all = s.turnDeck.concat(s.turnDiscard);
    const slots = n === 1 ? 3 : 4;
    assert.strictEqual(all.length, slots + 2, n + '인 총 장수');
    assert.strictEqual(all.filter(x => x === 'N').length, 2);
    assert.strictEqual(all.filter(x => x === 'W').length, slots - n);
    for (let i = 0; i < n; i++) assert.strictEqual(all.filter(x => x === 'M' + i).length, 1);
  });
});
t('일행마다 자기 덱·손·균열을 따로 가진다', () => {
  const { s } = fresh(9, null, 3);
  assert.strictEqual(s.mages.length, 3);
  s.mages.forEach(m => {
    assert.strictEqual(m.hand.length, 5);
    assert.strictEqual(m.hand.length + m.deck.length, 10);
  });
  s.mages[0].breaches[1].open = true;
  assert.strictEqual(s.mages[1].breaches[1].open, false);
  assert.notStrictEqual(s.mages[0].deck, s.mages[1].deck);
});
t('같은 일행 정의를 여러 명이 써도 이름이 겹치지 않는다', () => {
  const { s } = fresh(11, null, 2);
  assert.notStrictEqual(s.mages[0].name, s.mages[1].name);
});
t('1~4명 밖이면 거부', () => {
  const eng = Engine.create(clone(scn0));
  assert.throws(() => eng.newGame({ seed: 1, party: [] }));
  assert.throws(() => eng.newGame({ seed: 1, party: [0, 0, 0, 0, 0] }));
  assert.throws(() => eng.newGame({ seed: 1, party: [9] }));
});
t('자리 설정: 기본은 첫 번째가 사람, 나머지는 봇. 한 사람이 둘을 조종하는 것도 가능', () => {
  const eng = Engine.create(clone(scn0));
  const a = eng.newGame({ seed: 3, party: [0, 0, 0] });
  assert.deepStrictEqual(a.seats, ['human', 'bot', 'bot']);
  const b = eng.newGame({ seed: 3, party: [0, 0], seats: ['human', 'human'] });
  assert.deepStrictEqual(b.seats, ['human', 'human']);
  setTurns(b, ['N', 'M1']); // 다음에 M1
  const c = eng.newGame({ seed: 3, party: [0, 0], seats: ['human', 'human'] });
  assert.ok(['human', 'bot', null].includes(eng.controller(c)));
});
t('controller: 차례인 일행의 자리 종류를 돌려준다', () => {
  const eng = Engine.create(clone(scn0));
  const s = eng.newGame({ seed: 5, party: [0, 0], seats: ['human', 'bot'] });
  if (s.phase !== 'wild') assert.strictEqual(eng.controller(s), s.seats[s.active]);
  s.active = 1; s.phase = 'main';
  assert.strictEqual(eng.controller(s), 'bot');
  s.active = 0;
  assert.strictEqual(eng.controller(s), 'human');
});

console.log('턴 순서');
t('와일드 카드: 2인 이상이면 누가 움직일지 골라야 하고, 고르면 그 일행의 차례가 된다', () => {
  const { eng, s } = fresh(13, null, 2);
  mainPhase(eng, s, []);
  setTurns(s, ['M0', 'W']);       // 다음: W
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.phase, 'wild');
  assert.ok(eng.validate(s, { type: 'endMain' }), '고르기 전에는 다른 행동 불가');
  assert.ok(eng.validate(s, { type: 'pickMage', mage: 5 }));
  assert.ok(eng.act(s, { type: 'pickMage', mage: 1 }).ok);
  assert.strictEqual(s.active, 1);
  assert.ok(['cast', 'main'].includes(s.phase));
});
t('와일드: 살아 있는 일행이 한 명이면 자동으로 그 일행이 움직인다', () => {
  const { eng, s } = fresh(15, null, 2);
  s.mages[1].exhausted = true; s.mages[1].life = 0;
  mainPhase(eng, s, []);
  setTurns(s, ['M0', 'W']);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.active, 0);
  assert.notStrictEqual(s.phase, 'wild');
});
t('쓰러진 일행의 차례 카드는 건너뛴다', () => {
  const { eng, s } = fresh(17, null, 2);
  s.mages[1].exhausted = true; s.mages[1].life = 0;
  mainPhase(eng, s, []);
  setTurns(s, ['M0', 'M1']);      // 다음: M1(쓰러짐) → 건너뛰고 M0
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.active, 0);
});
t('턴 순서 덱이 비면 버린 카드를 다시 섞어 계속 진행한다', () => {
  const { eng, s } = fresh(19, null, 2);
  const total = s.turnDeck.length + s.turnDiscard.length;
  const bot = Bot.create(eng);
  for (let i = 0; i < 12 && !s.over; i++) bot.takeTurn(s);
  assert.strictEqual(s.turnDeck.length + s.turnDiscard.length, total);
});

console.log('덱 (섞지 않는다)');
t('덱이 비면 버림 더미가 "그 순서 그대로" 덱이 된다', () => {
  const { eng, s } = fresh(5);
  const m = mainPhase(eng, s, []);
  m.deck = []; m.discard = ['coal', 'lance', 'shard', 'spark', 'foundry'];
  setTurns(s, ['M0']);
  eng.act(s, { type: 'endMain' });
  assert.deepStrictEqual(s.mages[0].hand.slice(0, 5), ['coal', 'lance', 'shard', 'spark', 'foundry']);
});
t('구매한 카드는 버림 더미 맨 위, 사용한 보석은 지정한 순서로 그 위에', () => {
  const { eng, s } = fresh(9);
  const m = mainPhase(eng, s, ['shard', 'shard', 'coal', 'spark', 'spark']);
  m.discard = []; s.supply.coal = 7;
  eng.act(s, { type: 'play', idx: 0 });
  eng.act(s, { type: 'play', idx: 1 });
  assert.strictEqual(m.ember, 3);
  eng.act(s, { type: 'buy', id: 'coal' });
  assert.deepStrictEqual(m.discard, ['coal']);
  const before = m.played.slice();
  setTurns(s, ['M0']);
  eng.act(s, { type: 'endMain', order: before.map((_, i) => i).reverse() });
  const tail = m.discard.slice(1, 1 + before.length);
  assert.deepStrictEqual(tail, before.slice().reverse());
});
t('자발적 버리기는 없다: 쓰지 않은 카드는 손에 남고 5장까지만 보충', () => {
  const { eng, s } = fresh(11);
  const m = mainPhase(eng, s, ['shard', 'shard', 'shard', 'spark', 'spark', 'spark']);
  m.deck = ['coal', 'coal']; m.discard = [];
  setTurns(s, ['M0']);
  eng.act(s, { type: 'endMain' });
  assert.ok(m.hand.length >= 6, '손 6장은 유지되어야 한다 (최대 손 크기 없음)');
});
t('다인: 한 일행의 불씨·구매·손이 다른 일행에 영향을 주지 않는다', () => {
  const { eng, s } = fresh(21, null, 2);
  const a = mainPhase(eng, s, ['shard', 'shard']);
  const other = s.mages.find(x => x !== a), oHand = other.hand.slice();
  eng.act(s, { type: 'play', idx: 0 });
  assert.strictEqual(a.ember, 1);
  assert.strictEqual(other.ember, 0);
  assert.deepStrictEqual(other.hand, oHand);
});

console.log('균열 / 준비 / 시전');
t('준비한 주문은 같은 차례에 시전할 수 없고 다음 차례부터 시전된다', () => {
  const { eng, s } = fresh(13);
  const m = mainPhase(eng, s, ['spark', 'shard']);
  assert.ok(eng.act(s, { type: 'prep', idx: 0, breach: 0 }).ok);
  assert.deepStrictEqual(eng.castables(s), [], '같은 차례엔 시전 불가');
  s.turnNo++;
  assert.deepStrictEqual(eng.castables(s), [0]);
});
t('닫힌 균열에는 이번 차례에 집중했을 때만 준비할 수 있다', () => {
  const { eng, s } = fresh(15);
  const m = mainPhase(eng, s, ['spark', 'spark']); m.ember = 10;
  assert.ok(eng.validate(s, { type: 'prep', idx: 0, breach: 1 }), '집중 전엔 불가');
  assert.ok(eng.act(s, { type: 'focus', breach: 1 }).ok);
  assert.strictEqual(eng.validate(s, { type: 'prep', idx: 0, breach: 1 }), null);
  s.turnNo++;
  m.breaches[1].prepped = null;
  assert.ok(eng.validate(s, { type: 'prep', idx: 0, breach: 1 }), '이전 차례 집중은 무효');
});
t('닫힌 균열의 주문은 반드시 시전해야 단계를 넘길 수 있다', () => {
  const { eng, s } = fresh(17);
  const m = eng.cur(s) || mainPhase(eng, s, []);
  s.phase = 'cast'; s.turnNo = 5;
  m.breaches[1].prepped = 'spark'; m.breaches[1].preppedTurn = 4;
  assert.ok(eng.validate(s, { type: 'endCast' }));
  assert.ok(eng.act(s, { type: 'cast', breach: 1, targets: ['N'] }).ok);
  assert.strictEqual(s.phase, 'main');
  assert.strictEqual(m.breaches[1].open, false, '시전해도 닫힌 균열은 닫힌 채');
});
t('집중할수록 개방 비용이 줄고, 4번째 집중에서 열린다', () => {
  const { eng, s } = fresh(19);
  const m = mainPhase(eng, s, []); m.ember = 99;
  const base = eng.openCost(s, 1);
  eng.act(s, { type: 'focus', breach: 1 });
  assert.strictEqual(eng.openCost(s, 1), base - 1);
  eng.act(s, { type: 'focus', breach: 1 }); eng.act(s, { type: 'focus', breach: 1 });
  assert.strictEqual(m.breaches[1].open, false);
  eng.act(s, { type: 'focus', breach: 1 });
  assert.strictEqual(m.breaches[1].open, true);
});
t('균열 2의 보너스: 열렸을 때 첫 피해 +1', () => {
  const { eng, s } = fresh(21);
  const m = eng.cur(s) || mainPhase(eng, s, []);
  s.phase = 'cast'; s.turnNo = 3; m.breaches[1].open = true;
  m.breaches[1].prepped = 'chain'; m.breaches[1].preppedTurn = 2;
  assert.deepStrictEqual(eng.dmgInstances(s, 1), [3, 3]);
  const before = s.nemLife;
  eng.act(s, { type: 'cast', breach: 1, targets: ['N', 'N'] });
  assert.strictEqual(before - s.nemLife, 6);
});

console.log('전투');
t('피해 대상을 하수인으로 지정하면 보스는 깎이지 않고 하수인이 죽는다', () => {
  const { eng, s } = fresh(23);
  const m = eng.cur(s) || mainPhase(eng, s, []);
  s.minions = [{ uid: 900, id: 'm_ash', life: 3 }];
  s.phase = 'cast'; s.turnNo = 2; m.breaches[0].prepped = 'lance'; m.breaches[0].preppedTurn = 1;
  const before = s.nemLife;
  eng.act(s, { type: 'cast', breach: 0, targets: [900] });
  assert.strictEqual(s.nemLife, before);
  assert.strictEqual(s.minions.length, 0);
});
t('힘(Power): 놓인 차례에는 줄지 않고 다음 적 차례(메인 단계)부터 카운트다운', () => {
  const { eng, s } = fresh(25);
  s.powers = []; s.minions = []; s.hunger = 0;
  mainPhase(eng, s, []);
  s.nemDeck = ['p_door'];                 // 다음 적 차례에 힘을 놓는다
  setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.powers.length, 1);
  assert.strictEqual(s.powers[0].tokens, 3, '놓인 차례에는 그대로');
  // 한 차례 더: 메인 단계에서 틱
  mainPhase(eng, s, []);
  s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.powers[0].tokens, 2);
});
t('적 차례 순서: 메인(하수인·힘) 먼저, 그다음 카드 뽑기 — 방금 놓인 하수인은 이번 차례에 공격하지 않는다', () => {
  const { eng, s } = fresh(26);
  s.powers = []; s.minions = []; s.hunger = 0;
  mainPhase(eng, s, []);
  const g = s.graveLife;
  s.nemDeck = ['m_bell'];                 // 종지기: 성채 -2 (놓인 차례엔 공격 안 함)
  setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.minions.length, 1);
  assert.strictEqual(s.graveLife, g, '놓인 차례에는 공격하지 않는다');
  mainPhase(eng, s, []);
  s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  s.hunger = 0;
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.graveLife, g - 2, '다음 적 차례의 메인 단계에서 공격');
});
t('처리 순서는 놓인 순서(오래된 것부터)', () => {
  const { eng, s } = fresh(27);
  s.hunger = 0;
  s.powers = [{ uid: 5, id: 'p_door', tokens: 1 }];              // 6 피해
  s.minions = [{ uid: 2, id: 'm_ash', life: 3 }];                 // 1 피해, 더 오래됨
  s.graveLife = 7; s.graveMax = 22;
  mainPhase(eng, s, []);
  s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  // 하수인(1) 먼저 → 6, 이어 힘(6) → 0 이하: 패배
  assert.strictEqual(s.over, 'lose');
  assert.ok(s.log.findIndex(x => x.includes('재의 하수인의 공격')) < s.log.findIndex(x => x.includes('발동!')));
});
t('힘 해제: 불씨를 내고 즉시 제거', () => {
  const { eng, s } = fresh(28);
  s.powers = [{ uid: 1, id: 'p_door', tokens: 2 }];
  const m = mainPhase(eng, s, []); m.ember = 5;
  assert.ok(eng.act(s, { type: 'disarm', idx: 0 }).ok);
  assert.strictEqual(s.powers.length, 0); assert.strictEqual(m.ember, 0);
  m.ember = 4; s.powers = [{ uid: 2, id: 'p_door', tokens: 2 }];
  assert.ok(eng.validate(s, { type: 'disarm', idx: 0 }), '불씨 부족');
});
t('굶주림: 카드의 unleash가 쌓이다가 3에서 폭발해 성채 -3', () => {
  const { eng, s } = fresh(29);
  s.powers = []; s.minions = [];
  s.hunger = 2; s.nemDeck = ['a_claw']; s.nemDiscard = [];
  setTurns(s, ['M0', 'N']); mainPhase(eng, s, []);
  const g = s.graveLife;
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.graveLife, g - 3);
  assert.strictEqual(s.hunger, 0);
});
t('굶주림은 더 이상 매 적 차례 자동으로 오르지 않는다 (unleash 없는 카드면 그대로)', () => {
  const { eng, s } = fresh(30, sc => { sc.nemesis.cards.a_claw.onDraw = []; });
  s.powers = []; s.minions = []; s.hunger = 0; s.nemDeck = ['a_claw'];
  setTurns(s, ['M0', 'N']); mainPhase(eng, s, []);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.hunger, 0);
});
t('unleash ×n: 한 카드가 여러 번 발동하면 폭발도 여러 번', () => {
  const { eng, s } = fresh(31, sc => { sc.nemesis.cards.a_claw.onDraw = [{ op: 'unleash', n: 6 }]; });
  s.powers = []; s.minions = []; s.hunger = 0; s.nemDeck = ['a_claw'];
  setTurns(s, ['M0', 'N']); mainPhase(eng, s, []);
  const g = s.graveLife;
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.graveLife, g - 6);
});
t('보스 생명 0 → 승리, 성채 0 → 패배', () => {
  const a = fresh(32); const am = a.eng.cur(a.s) || mainPhase(a.eng, a.s, []);
  a.s.nemLife = 2; a.s.phase = 'cast'; a.s.turnNo = 2;
  am.breaches[0].prepped = 'spark'; am.breaches[0].preppedTurn = 1;
  a.eng.act(a.s, { type: 'cast', breach: 0, targets: ['N'] });
  assert.strictEqual(a.s.over, 'win');
  const b = fresh(33); b.s.graveLife = 2; b.s.powers = []; b.s.minions = [];
  setTurns(b.s, ['N']); b.s.nemDeck = ['a_breath'];
  mainPhase(b.eng, b.s, []); b.eng.act(b.s, { type: 'endMain' });
  assert.strictEqual(b.s.over, 'lose');
});
t('충전이 차면 기술 사용 가능, 사용 시 충전 소모', () => {
  const { eng, s } = fresh(35);
  const m = mainPhase(eng, s, []); m.charge = 4;
  const before = s.nemLife;
  assert.ok(eng.act(s, { type: 'ability', targets: ['N'] }).ok);
  assert.strictEqual(m.charge, 0); assert.strictEqual(before - s.nemLife, 4);
});

console.log('탈진 / 동료');
t('술사를 때리는 효과: 한 명만 살아 있으면 반드시 그 일행에게', () => {
  const { eng, s } = fresh(36, null, 2);
  s.mages[1].exhausted = true; s.mages[1].life = 0;
  mainPhase(eng, s, []);
  s.powers = []; s.minions = []; s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  const before = s.mages[0].life;
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.mages[0].life, before - 2);
});
t('대상 규칙 lowest: 생명이 가장 낮은 일행을 때린다', () => {
  const { eng, s } = fresh(37, sc => { sc.nemesis.targeting = 'lowest'; }, 3);
  s.mages[0].life = 9; s.mages[1].life = 4; s.mages[2].life = 7;
  mainPhase(eng, s, []);
  s.powers = []; s.minions = []; s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  assert.strictEqual(s.mages[1].life, 2);
  assert.strictEqual(s.mages[0].life, 9);
});
t('대상 규칙 random은 같은 시드면 같은 결과 (재현 가능)', () => {
  const run = () => {
    const { eng, s } = fresh(38, null, 3);
    mainPhase(eng, s, []);
    s.powers = []; s.minions = []; s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
    eng.act(s, { type: 'endMain' });
    return s.mages.map(m => m.life);
  };
  assert.deepStrictEqual(run(), run());
});
t('생명 0이면 탈진: 손과 준비한 주문은 버림 더미로, 그 일행은 더 이상 차례가 없다', () => {
  const sc2 = clone(scn0); sc2.nemesis.targeting = 'lowest';
  const e2 = Engine.create(sc2);
  const g = e2.newGame({ seed: 39, party: [0, 0] });
  g.mages[1].life = 1; g.mages[1].breaches[0].prepped = 'spark';
  const hand = g.mages[1].hand.length;
  g.powers = []; g.minions = []; g.nemDeck = ['a_ceiling'];
  g.mages[0].life = 10; g.active = 0; g.phase = 'main';
  setTurns(g, ['M0', 'N']);
  e2.act(g, { type: 'endMain' });
  assert.strictEqual(g.mages[1].exhausted, true);
  assert.strictEqual(g.mages[1].hand.length, 0);
  assert.strictEqual(g.mages[1].breaches[0].prepped, null);
  assert.ok(g.mages[1].discard.length >= hand);
  assert.strictEqual(g.over, null, '한 명이 쓰러져도 게임은 계속');
});
t('모든 일행이 쓰러지면 패배', () => {
  const e = Engine.create(clone(scn0));
  const g = e.newGame({ seed: 1, party: [0, 0] });
  g.mages.forEach(m => { m.life = 1; });
  g.powers = []; g.minions = [];
  g.nemDeck = ['a_ceiling', 'a_ceiling']; g.active = 0; g.phase = 'main'; g.graveLife = 99; g.graveMax = 99;
  setTurns(g, ['N', 'N']);
  e.act(g, { type: 'endMain' });
  assert.strictEqual(g.over, 'lose');
  assert.ok(g.reason.includes('모든'));
});
t('hitMage all: 살아 있는 모든 일행이 피해를 입는다', () => {
  const { eng, s } = fresh(41, sc => { sc.nemesis.cards.a_claw.effects = [{ op: 'hitMage', n: 1, all: true }]; }, 3);
  mainPhase(eng, s, []);
  s.powers = []; s.minions = []; s.nemDeck = ['a_claw']; setTurns(s, ['M0', 'N']);
  eng.act(s, { type: 'endMain' });
  s.mages.forEach(m => assert.strictEqual(m.life, m.max - 1));
});
t('동료 회복: to:ally 효과는 고른 동료를 치료하고, 대상이 없으면 자신', () => {
  const { eng, s } = fresh(42, sc => {
    sc.cards.sera_lamp.effects = [{ op: 'ember', n: 2 }, { op: 'healMage', n: 3, to: 'ally' }];
  }, 2);
  const a = mainPhase(eng, s, ['sera_lamp', 'sera_lamp']);
  s.mages[1].life = 4; a.life = 5;
  eng.act(s, { type: 'play', idx: 0, ally: 1 });
  assert.strictEqual(s.mages[1].life, 7);
  assert.strictEqual(a.life, 5);
  eng.act(s, { type: 'play', idx: 0 });         // 대상 미지정 → 자신
  assert.strictEqual(a.life, 8);
});
t('동료 대상 검증: 자기 자신·없는 일행·쓰러진 일행은 안 된다', () => {
  const { eng, s } = fresh(43, null, 3);
  mainPhase(eng, s, ['shard']);
  assert.ok(eng.validate(s, { type: 'play', idx: 0, ally: s.active }));
  assert.ok(eng.validate(s, { type: 'play', idx: 0, ally: 9 }));
  const other = (s.active + 1) % 3;
  s.mages[other].exhausted = true;
  assert.ok(eng.validate(s, { type: 'play', idx: 0, ally: other }));
});
t('인원 배율(scaling): 보스와 성채 생명이 인원별로 조정된다', () => {
  const { s } = fresh(44, sc => { sc.scaling = { 1: {}, 2: { nemLife: 1.5, graveLife: 2 } }; }, 2);
  assert.strictEqual(s.nemMax, 90);
  assert.strictEqual(s.graveMax, 44);
});

console.log('레거시 / 세이브');
t('레거시: 덱 추가·제거, 성채 보너스, 적 덱 추가가 새 게임에 반영된다', () => {
  const eng = Engine.create(clone(scn0));
  const base = eng.newGame({ seed: 5 });
  const lg = eng.newGame({ seed: 5, legacy: { deckAdd: ['sera_lamp'], deckRemove: ['spark'], graveBonus: 5, nemesisAdd: ['p_door'] } });
  const count = (s, id) => s.mages[0].deck.concat(s.mages[0].hand).filter(x => x === id).length;
  assert.strictEqual(count(lg, 'sera_lamp'), 1);
  assert.strictEqual(count(lg, 'spark'), count(base, 'spark') - 1);
  assert.strictEqual(lg.graveMax, base.graveMax + 5);
  assert.strictEqual(lg.nemDeck.concat(lg.nemDiscard).length, base.nemDeck.concat(base.nemDiscard).length + 1);
});
t('레거시: 일행별 항목(mages.<id>)은 해당 일행에게만 적용', () => {
  const eng = Engine.create(clone(scn0));
  const g = eng.newGame({ seed: 5, party: [0, 0], legacy: { mages: { seo: { deckAdd: ['sera_lamp'] } } } });
  const count = m => m.deck.concat(m.hand).filter(x => x === 'sera_lamp').length;
  assert.strictEqual(count(g.mages[0]) + count(g.mages[1]), 2, '같은 id를 가진 일행 모두에게 적용');
});
t('상태를 JSON으로 저장·복원해도 이어서 똑같이 진행된다 (1인·3인)', () => {
  [1, 3].forEach(n => {
    const eng = Engine.create(clone(scn0)), bot = Bot.create(eng);
    const a = eng.newGame({ seed: 77, party: Array(n).fill(0), seats: Array(n).fill('bot') });
    for (let i = 0; i < 4 && !a.over; i++) bot.takeTurn(a);
    const b = JSON.parse(JSON.stringify(a));
    for (let i = 0; i < 6 && !a.over; i++) bot.takeTurn(a);
    for (let i = 0; i < 6 && !b.over; i++) bot.takeTurn(b);
    assert.deepStrictEqual(a, b);
  });
});

console.log('전수 시뮬레이션');
[1, 2, 3, 4].forEach(n => {
  t('봇 ' + (n === 1 ? 600 : 300) + '판 (' + n + '인): 오류·교착 없이 전부 종료, 규칙 위반 행동 0건', () => {
    const eng = Engine.create(clone(scn0)), bot = Bot.create(eng);
    let stalls = 0, bad = 0;
    const realAct = eng.act;
    eng.act = function (s, a) { const r = realAct(s, a); if (!r.ok) bad++; return r; };
    const games = n === 1 ? 600 : 300;
    for (let g = 0; g < games; g++) {
      const party = Array(n).fill(0);
      const s = eng.newGame({ seed: 500 + g, party, seats: party.map(() => 'bot') });
      let guard = 0;
      while (!s.over && guard++ < 3000) bot.takeTurn(s);
      if (!s.over) stalls++;
    }
    assert.strictEqual(stalls, 0, '교착 ' + stalls);
    assert.strictEqual(bad, 0, '거부된 행동 ' + bad + '건');
  });
});

console.log('\n' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
