/* 재의 문 (Ashgate) — 일반판 콘텐츠 데이터 (1단계: 지기 4명 · 적 E1 · 공급 카드 30장)
 * 엔진을 고치지 않고 이 파일만 바꿔서 카드/적/수치/이야기를 교체한다.
 * 화면 글자는 세계관 용어(지기·새김·덧긋기·열·징조·잿것·종·주린 자). 엔진 내부 이름은 그대로.
 * 밸런싱 대상 수치는 balance 항목에 모아 둔다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AshScenario1 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- 카드 작성 도우미 (데이터를 짧게 쓰기 위한 것, 엔진과 무관) ----
  const gem = (id, name, cost, effects, memo) => ({ id, name, type: 'gem', cost, effects, memo });
  const relic = (id, name, cost, effects, memo) => ({ id, name, type: 'relic', cost, effects, memo });
  const spell = (id, name, cost, effects, memo) => ({ id, name, type: 'spell', cost, effects, memo });
  const E = (op, n, more) => Object.assign({ op, n }, more || {});

  const cards = {};
  [
    // 시작 덱 (공용 2 + 지기별 고유 1)
    { id: 'shard', name: '불씨 조각', type: 'gem', cost: 0, starter: true, effects: [E('ember', 1)] },
    { id: 'spark', name: '점화', type: 'spell', cost: 0, starter: true, effects: [E('dmg', 2)] },
    relic('seo_flint', '세오의 부싯돌', 0, [E('ember', 1), E('charge', 1)]),
    relic('rec_ledger', '기록관의 명부', 0, [E('ember', 1), E('recall', 1, { to: 'top' })]),
    relic('tow_torch', '망루 횃불', 0, [E('ember', 1), E('heal', 1)]),
    relic('car_knife', '새김칼', 0, [E('ember', 1), E('focusAlly', 1)]),

    // ---- 보석 10 ----
    gem('g_coal', '늙은 우물지기의 숯', 2, [E('ember', 1), E('heal', 1)], '식기 전에 먹어.'),
    gem('g_drifter', '떠돌이의 잿불', 2, [E('ember', 2), E('forget', 1, { from: 'hand' })]),
    gem('g_smith', '대장간 아이의 불씨', 3, [E('ember', 2)]),
    gem('g_nurse', '유모의 손난로', 3, [E('ember', 1), E('healMage', 1, { to: 'ally' })]),
    gem('g_pilgrim', '순례자의 온기', 4, [E('ember', 2), E('charge', 1)]),
    gem('g_twin', '쌍둥이의 반쪽 불', 4, [E('ember', 2), E('charge', 1, { to: 'ally' })]),
    gem('g_widow', '과부의 촛농', 4, [E('ember', 1), E('draw', 1)]),
    gem('g_choir', '성가대의 촛불', 5, [E('ember', 2), E('recall', 1, { to: 'top' })]),
    gem('g_baker', '제빵사의 화덕', 5, [E('ember', 3)]),
    gem('g_miner', '광부의 마지막 등', 6, [E('ember', 4)]),

    // ---- 유물 8 ----
    relic('r_knife', '아이의 나무 칼', 2, [E('dmgMinion', 2)]),
    relic('r_thread', '기록공의 실', 3, [E('ember', 1), E('recall', 1, { to: 'top' })]),
    relic('r_whistle', '늙은 순찰병의 호각', 3, [E('peekTurn', 1)]),
    relic('r_coin', '뱃사공의 동전', 3, [E('ember', 2), E('forget', 1, { from: 'hand', optional: true })]),
    relic('r_knot', '누군가의 매듭', 4, [E('anchor', 1)]),
    relic('r_lamp', '산파의 등잔', 4, [E('ember', 1), E('healMage', 2, { to: 'ally' })]),
    relic('r_key', '문지기의 열쇠', 4, [E('delayPower', 1)]),
    relic('r_hammer', '성벽 석공의 망치', 5, [E('ember', 1), E('focusAlly', 1)]),

    // ---- 주문 12 ----
    spell('s_scream', '아이의 비명', 2, [E('dmg', 2), E('charge', 1)]),
    spell('s_arrow', '사냥꾼의 마지막 화살', 3, [E('dmg', 4)]),
    spell('s_thief', '도둑의 손버릇', 3, [E('dmg', 2), E('recall', 1, { to: 'hand', pick: 'top' })]),
    spell('s_rage', '대장장이의 분노', 4, [E('dmg', 2), E('dmg', 3)]),
    spell('s_prayer', '수녀의 잿빛 기도', 4, [E('heal', 3), E('dmg', 2)]),
    spell('s_laugh', '광인의 웃음', 4, [E('dmg', 5), E('hitSelf', 1)]),
    spell('s_tail', '행렬의 끝자락', 4, [E('dmg', 3), E('hunger', -1)]),
    spell('s_breath', '병사의 마지막 숨', 5, [E('dmg', 4), E('healMage', 1, { to: 'ally' })]),
    spell('s_promise', '연인의 약속', 5, [E('dmg', 3), E('draw', 1, { to: 'ally' })]),
    spell('s_oblivion', '늙은 사제의 망각', 5, [E('dmg', 6), E('forget', 1, { from: 'hand' })]),
    spell('s_star', '별지기의 추락', 6, [E('dmg', 7)]),
    spell('s_choirdead', '망자의 합창', 7, [E('dmgAll', 3)]),

    // 레거시로만 들어오는 카드 (공급처에는 없다)
    { id: 'sera_lamp', name: '세라의 등불', type: 'relic', cost: 0, legacyOnly: true, effects: [E('ember', 2), E('healMage', 1)] }
  ].forEach(c => { cards[c.id] = c; });

  // ---- 지기 4명 ----
  const std = (open1, extra) => [
    { open: true, bonus: null },
    Object.assign({ open: false, focusCost: 2, openCost: 4 }, extra[0]),
    Object.assign({ open: false, focusCost: 2, openCost: 5 }, extra[1]),
    Object.assign({ open: false, focusCost: 3, openCost: 6 }, extra[2])
  ];
  const mages = [
    {
      id: 'seo', name: '세오', life: 10, chargeOnCast: 1,
      startingDeck: { shard: 6, spark: 3, seo_flint: 1 },
      ability: { name: '불씨 폭주', cost: 4, effects: [E('dmg', 5)], text: '열 4: 피해 5' },
      breaches: std(true, [
        { bonus: { type: 'dmg', n: 1 }, bonusText: '시전 시 첫 피해 +1', onOpen: [E('forget', 1, { from: 'deckTop' })], onOpenText: '덱 맨 위 1장 잊음' },
        { bonus: { type: 'ember', n: 1 }, bonusText: '시전 시 불씨 +1', onOpen: [E('forget', 1, { from: 'deckTop' })], onOpenText: '덱 맨 위 1장 잊음' },
        { bonus: { type: 'charge', n: 1 }, bonusText: '시전 시 열 +1', onOpen: [E('forget', 1, { from: 'deckTop' })], onOpenText: '덱 맨 위 1장 잊음' }
      ]),
      bot: {}
    },
    {
      id: 'rec', name: '기록관', life: 9, chargeOnCast: 1,
      startingDeck: { shard: 6, spark: 3, rec_ledger: 1 },
      ability: { name: '이름 부르기', cost: 5, effects: [E('recall', 1, { to: 'hand', who: 'ally' }), E('draw', 1, { to: 'ally' })], text: '열 5: 동료가 버림 더미에서 1장을 손으로, 카드 1장 뽑기 (동료가 없으면 자신)' },
      breaches: std(true, [
        { bonus: { type: 'ember', n: 1 }, bonusText: '시전 시 불씨 +1', onOpen: [E('hunger', 1)], onOpenText: '굶주림 +1' },
        { bonus: { type: 'charge', n: 1 }, bonusText: '시전 시 열 +1', onOpen: [E('hunger', 1)], onOpenText: '굶주림 +1' },
        { bonus: { type: 'recall', n: 1 }, bonusText: '시전 시 버림 더미에서 1장 덱 맨 위로', onOpen: [E('hunger', 1)], onOpenText: '굶주림 +1' }
      ]),
      bot: {}
    },
    {
      id: 'tow', name: '망대지기', life: 12, chargeOnCast: 1,
      startingDeck: { shard: 6, spark: 3, tow_torch: 1 },
      ability: { name: '성벽 걷기', cost: 5, effects: [E('heal', 5), E('dmgMinion', 3)], text: '열 5: 성채 +5, 잿것 하나에 피해 3' },
      breaches: std(true, [
        { bonus: { type: 'dmg', n: 1 }, bonusText: '시전 시 첫 피해 +1', onOpen: [E('maxLife', 2)], onOpenText: '최대 생명 -2' },
        { bonus: { type: 'ember', n: 1 }, bonusText: '시전 시 불씨 +1', onOpen: [E('maxLife', 2)], onOpenText: '최대 생명 -2' },
        { bonus: { type: 'heal', n: 1 }, bonusText: '시전 시 성채 +1', onOpen: [E('maxLife', 2)], onOpenText: '최대 생명 -2' }
      ]),
      bot: { healBelow: 0.6 }
    },
    {
      id: 'car', name: '새김꾼', life: 9, chargeOnCast: 1, allClosed: true,
      startingDeck: { shard: 7, spark: 2, car_knife: 1 },
      ability: { name: '칼끝', cost: 4, effects: [E('openAlly', 1)], text: '열 4: 동료 1명의 닫힌 새김 1곳을 즉시 연다 (동료가 없으면 자신)' },
      breaches: [
        { open: false, focusCost: 1, openCost: 3, bonus: null },
        { open: false, focusCost: 2, openCost: 4, bonus: { type: 'ember', n: 1 }, bonusText: '시전 시 불씨 +1', onOpen: [{ op: 'chargeReset' }], onOpenText: '열 0으로' },
        { open: false, focusCost: 2, openCost: 5, bonus: { type: 'charge', n: 1 }, bonusText: '시전 시 열 +1', onOpen: [{ op: 'chargeReset' }], onOpenText: '열 0으로' },
        { open: false, focusCost: 3, openCost: 6, bonus: { type: 'dmg', n: 1 }, bonusText: '시전 시 첫 피해 +1', onOpen: [{ op: 'chargeReset' }], onOpenText: '열 0으로' }
      ],
      bot: { allySupport: true }
    }
  ];

  // ---- 적 ----
  const nemeses = {
    e1: {
      id: 'e1', name: '굶주린 문', life: 60,
      epitaph: { win: '문이 닫혔다. 연기가 멎는다.', lose: '등불이 하나씩 꺼진다. 벨란은 조용해졌다.', after: '닫힌 문 아래에서는 아직 무언가 숨을 고른다.' },
      // 굶주림: 격화(unleash)가 발동할 때마다 +step, threshold에 닿으면 삼킴(strike)
      unleash: { step: 1, threshold: 3, strike: [E('hitGrave', 3)] },
      targeting: 'random',
      deck: {
        e1_breath: 3, e1_claw: 2, e1_ceiling: 2, e1_inhale: 2,
        e1_door: 2, e1_song: 1,
        e1_ash: 2, e1_wolf: 1, e1_bell: 1
      },
      cards: {
        e1_breath:  { id: 'e1_breath',  kind: 'attack', name: '문틈의 숨결',   effects: [E('hitGrave', 2), E('unleash', 1)] },
        e1_claw:    { id: 'e1_claw',    kind: 'attack', name: '굶주린 손톱',   effects: [E('hitMage', 2)] },
        e1_ceiling: { id: 'e1_ceiling', kind: 'attack', name: '무너지는 천장', effects: [E('hitGrave', 2), E('hitMage', 1, { all: true })] },
        e1_inhale:  { id: 'e1_inhale',  kind: 'attack', name: '깊은 들숨',     effects: [E('unleash', 2)] },
        e1_door: { id: 'e1_door', kind: 'power', name: '문이 열린다',   countdown: 3, disarm: 5, effects: [E('hitGrave', 6)] },
        e1_song: { id: 'e1_song', kind: 'power', name: '굶주림의 노래', countdown: 2, disarm: 4, effects: [E('unleash', 2), E('hitMage', 2)] },
        e1_ash:  { id: 'e1_ash',  kind: 'minion', name: '재의 하수인', life: 3, each: [E('hitGrave', 1)] },
        e1_wolf: { id: 'e1_wolf', kind: 'minion', name: '문틈 늑대',   life: 4, each: [E('hitMage', 1)] },
        e1_bell: { id: 'e1_bell', kind: 'minion', name: '종지기',      life: 5, each: [E('unleash', 1)] }
      }
    },
    e2: {
      id: 'e2', name: '이름 없는 행렬', life: 75,
      recommended: 'e2',
      // 이 적 전용 인원별 배율 (전역 scaling보다 우선)
      scaling: { 1: { nemLife: 1.3 }, 2: { nemLife: 1.4 }, 3: { nemLife: 1.0 }, 4: { nemLife: 2.15 } },
      epitaph: { win: '행렬이 걸음을 멈춘다. 이름 없는 얼굴들이 하나씩 흩어진다.', lose: '이름이 하나씩 불린다. 대답하는 사람은 없다.', after: '돌아오지 않은 이름들은 아직 문 아래에 쌓여 있다.' },
      // 삼킴: 성채 -3, 모든 지기의 버림 더미 맨 위 1장이 먹힌다(이번 판에서 제거, 이름 더미로)
      unleash: { step: 1, threshold: 3, strike: [E('hitGrave', 3), E('devour', 1, { who: 'all' })] },
      targeting: 'random',
      deck: {
        e2_step: 3, e2_call: 2, e2_end: 2, e2_tag: 1,
        e2_march: 2, e2_hand: 1,
        e2_nameless: 3, e2_clad: 2
      },
      cards: {
        e2_step:  { id: 'e2_step',  kind: 'attack', name: '낯선 발걸음', effects: [E('hitMage', 2), E('unleash', 1)] },
        e2_call:  { id: 'e2_call',  kind: 'attack', name: '이름 부르기', effects: [E('devour', 1, { who: 'one' })] },
        e2_end:   { id: 'e2_end',   kind: 'attack', name: '행렬의 끝',   effects: [E('hitGrave', 4)] },
        e2_tag:   { id: 'e2_tag',   kind: 'attack', name: '빈 명찰',     effects: [E('unleash', 2)] },
        e2_march: { id: 'e2_march', kind: 'power', name: '행진', countdown: 3, disarm: 5, effects: [E('devour', 2, { who: 'all' })] },
        e2_hand:  { id: 'e2_hand',  kind: 'power', name: '이름을 새기는 손', countdown: 2, disarm: 4, effects: [E('hitGrave', 4), E('unleash', 1)] },
        e2_nameless: { id: 'e2_nameless', kind: 'minion', name: '이름 없는 자', life: 4, each: [E('hitGrave', 1)], onDeath: [E('returnDevoured', 1)] },
        e2_clad:     { id: 'e2_clad',     kind: 'minion', name: '이름을 입은 것', life: 3, lifePlus: 'devoured', each: [E('hitMage', 2)] }
      }
    },
    e3: {
      id: 'e3', name: '뒤섞는 자', life: 80,
      recommended: 'e3',
      scaling: { 1: { nemLife: 1.0 }, 2: { nemLife: 1.65 }, 3: { nemLife: 1.3 }, 4: { nemLife: 1.8, graveLife: 0.68 } },
      epitaph: { win: '말이 제 순서를 찾는다. 뒤섞는 자는 더 이상 말하지 못한다.', lose: '기억을, 너의, 내가, 정리해 주마. 아무도 제 이름을 기억하지 못한다.', after: '순서를 되찾은 기억은 아직 어딘가 한 줄씩 어긋나 있다.' },
      // 삼킴: 성채 -3, 지기 1명의 버림 더미가 뒤섞인다
      unleash: { step: 1, threshold: 4, strike: [E('hitGrave', 3), E('scramble', 1, { who: 'one' })] },
      targeting: 'random',
      deck: {
        e3_tangle: 3, e3_reverse: 2, e3_stagger: 2, e3_breath: 1,
        e3_vortex: 2, e3_syntax: 1,
        e3_skein: 2, e3_shard: 3
      },
      cards: {
        e3_tangle:  { id: 'e3_tangle',  kind: 'attack', name: '뒤엉킨 말',      effects: [E('hitMage', 2), E('unleash', 1)] },
        e3_reverse: { id: 'e3_reverse', kind: 'attack', name: '거꾸로 된 기억', effects: [E('scramble', 1, { who: 'one' })] },
        e3_stagger: { id: 'e3_stagger', kind: 'attack', name: '엇갈린 걸음',   effects: [E('hitGrave', 3), E('reshuffleTurns', 1)] },
        e3_breath:  { id: 'e3_breath',  kind: 'attack', name: '흐트러진 숨',   effects: [E('unleash', 2)] },
        e3_vortex:  { id: 'e3_vortex',  kind: 'power', name: '망각의 소용돌이', countdown: 3, disarm: 6, effects: [E('scramble', 1, { who: 'all' }), E('hitGrave', 3)] },
        e3_syntax:  { id: 'e3_syntax',  kind: 'power', name: '어순 붕괴',       countdown: 2, disarm: 4, effects: [E('unleash', 2), E('hitMage', 3)] },
        e3_skein:   { id: 'e3_skein',   kind: 'minion', name: '엉킨 실타래', life: 5, each: [E('unleash', 1)] },
        e3_shard:   { id: 'e3_shard',   kind: 'minion', name: '거울 조각',   life: 3, each: [E('hitMage', 2)] }
      }
    }
  };

  return {
    id: 'ashgate-1',
    title: '재의 문',
    chapter: '일반판',

    story: {
      intro: [
        '벨란은 석 달째 밤이 길다.',
        '성문 아래 바닥이 갈라진 날부터, 불을 꺼도 연기가 올랐다.',
        '세오는 남은 등불지기 가운데 가장 늦게까지 버틴 사람이다. 세라가 아래로 내려간 지 이틀이 지났다.',
        '문이 다시 열린다. 성채가 버티는 동안 닫아야 한다.'
      ],
      winText: [
        '문이 닫혔다. 연기가 멎는다.',
        '닫힌 틈에 세라가 끼어 있다. 숨은 붙어 있다.'
      ],
      loseText: ['등불이 하나씩 꺼진다. 벨란은 조용해졌다.'],
      choice: {
        prompt: '틈은 오래 버티지 못한다. 세라를 끌어내면 문이 다시 벌어질 수 있다.',
        options: [
          {
            id: 'pull',
            label: '세라를 끌어낸다',
            result: '세라가 기침을 하며 눈을 뜬다. 문은 완전히 닫히지 않았다.',
            legacy: {
              sera: 'alive',
              deckAdd: ['sera_lamp'],
              nemesisAdd: ['e1_door'],
              summary: ['세라 생존 — 시작 덱에 「세라의 등불」 추가', '문이 덜 닫힘 — 다음 세션 적 덱에 「문이 열린다」 1장 추가']
            }
          },
          {
            id: 'seal',
            label: '그대로 두고 봉인한다',
            result: '틈이 닫힌다. 아래에서 아무 소리도 나지 않는다.',
            legacy: {
              sera: 'dead',
              graveBonus: 5,
              deckRemove: ['spark'],
              summary: ['세라 사망', '문이 단단히 봉인됨 — 성채 생명 +5', '술사의 손이 무뎌짐 — 시작 덱에서 「점화」 1장 영구 제거']
            }
          }
        ]
      }
    },

    gravehold: { name: '벨란 성채', life: 22 },

    mages: mages,
    nemeses: nemeses,
    defaultNemesis: 'e1',

    // 턴 순서 덱(종): 일행마다 1장 + 와일드(부족한 칸) + 적 2장. slots[인원] = 일행 쪽 칸 수.
    turnDeck: { nemesis: 2, slots: { 1: 3, 2: 3, 3: 3, 4: 4 } },

    // 인원별 배율 (미지정 = 1). 시뮬레이션으로 맞춘다.
    scaling: { 1: { nemLife: 1.55 }, 2: { nemLife: 1.25 }, 3: { nemLife: 0.95 }, 4: { nemLife: 1.65 } },

    // 난이도: 주린 자 생명 / 성채 생명 배율, 굶주림 시작값, 문턱 보정
    difficulties: {
      easy:    { name: '입문',   nemLife: 0.85, graveLife: 1.2 },
      normal:  { name: '보통' },
      hard:    { name: '어려움', nemLife: 1.15, hungerStart: 1 },
      despair: { name: '절망',   nemLife: 1.25, graveLife: 0.9, thresholdDelta: -1 }
    },

    // 공급처: 추천 세트 (보석 3 + 유물 2 + 주문 4)
    supply: {
      gems: ['g_smith', 'g_pilgrim', 'g_baker'],
      relics: ['r_thread', 'r_lamp'],
      spells: ['s_arrow', 's_rage', 's_prayer', 's_star']
    },
    supplySets: {
      // E2(먹힘) 대응: 산파의 등잔→누군가의 매듭, 수녀의 잿빛 기도→도둑의 손버릇
      e2: {
        gems: ['g_smith', 'g_pilgrim', 'g_baker'],
        relics: ['r_thread', 'r_knot'],
        spells: ['s_arrow', 's_rage', 's_thief', 's_star']
      },
      // E3(섞임) 대응: E2와 같은 구성 (누군가의 매듭, 도둑의 손버릇)
      e3: {
        gems: ['g_smith', 'g_pilgrim', 'g_baker'],
        relics: ['r_thread', 'r_knot'],
        spells: ['s_arrow', 's_rage', 's_thief', 's_star']
      },
      // 잊음 카드가 많은 세트 (잊음 비용 검증용이자 "압축형" 플레이용)
      forget: {
        gems: ['g_drifter', 'g_smith', 'g_baker'],
        relics: ['r_coin', 'r_thread'],
        spells: ['s_oblivion', 's_arrow', 's_rage', 's_star']
      }
    },
    supplyCount: { gems: 7, relics: 5, spells: 5 },

    cards: cards,

    // 새 시나리오를 만들 때 이 항목만 채우면 밸런스 도구가 목표 승률에 맞춰 준다.
    balance: {
      target: [0.60, 0.75],
      knobs: ['nemeses.e1.life', 'nemeses.e2.life', 'nemeses.e3.life', 'gravehold.life'],
      games: 3000
    }
  };
});
