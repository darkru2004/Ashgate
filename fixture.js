/* 시나리오 1 「문 아래」 — 콘텐츠 데이터
 * 엔진을 고치지 않고 이 파일만 바꿔서 카드/적/수치/이야기를 교체한다.
 * 밸런싱 대상 수치는 balance 항목에 모아 둔다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AshScenario1 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    id: 'ashgate-1',
    title: '재의 문 — 튜토리얼',
    chapter: '1장 「문 아래」',

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
              nemesisAdd: ['p_door'],
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

    // 일행(술사) 목록. 파티는 이 목록에서 1~4명을 고른다. (지금은 튜토리얼용 1명뿐 — 세계관 확정 뒤 교체)
    // bot: 이 일행을 AI가 조종할 때의 성향 수치(선택). 없으면 기본값.
    mages: [{
      id: 'seo',
      name: '세오',
      life: 10,
      startingDeck: { shard: 7, spark: 3 },
      chargeOnCast: 1,
      ability: {
        name: '불씨 폭주',
        cost: 4,                       // 충전 4를 쓴다
        effects: [{ op: 'dmg', n: 4 }],
        text: '충전 4: 피해 4'
      },
      // 균열 4개. 1번은 처음부터 열려 있다. 열린 균열의 보너스는 시전할 때 적용된다.
      breaches: [
        { open: true, bonus: null },
        { open: false, focusCost: 2, openCost: 4, bonus: { type: 'dmg', n: 1 }, bonusText: '시전 시 첫 피해 +1' },
        { open: false, focusCost: 2, openCost: 5, bonus: { type: 'ember', n: 1 }, bonusText: '시전 시 불씨 +1' },
        { open: false, focusCost: 3, openCost: 6, bonus: { type: 'charge', n: 1 }, bonusText: '시전 시 충전 +1' }
      ]
    }],

    // 턴 순서 덱: 일행마다 1장 + 와일드(부족한 칸) + 적 2장. slots[인원] = 일행 쪽 칸 수. 소진되면 다시 섞는다.
    // (1인 3칸 = 일행 1 + 와일드 2: 기존 솔로 규칙과 같다. 2~4인 칸 수는 추정치 — 시뮬레이션으로 확인)
    turnDeck: { nemesis: 2, slots: { 1: 3, 2: 4, 3: 4, 4: 4 } },

    // 인원별 배율 (미지정 = 1). 시뮬레이션으로 맞출 자리.
    scaling: { 1: {}, 2: {}, 3: {}, 4: {} },

    supply: {
      gems: ['coal', 'resonant', 'foundry'],
      relics: ['compass', 'lantern'],
      spells: ['lance', 'chain', 'mend', 'nova']
    },
    supplyCount: { gems: 7, relics: 5, spells: 5 },

    cards: {
      // 시작 덱
      shard:    { id: 'shard',    name: '불씨 조각', type: 'gem',   cost: 0, effects: [{ op: 'ember', n: 1 }] },
      spark:    { id: 'spark',    name: '점화',     type: 'spell', cost: 0, effects: [{ op: 'dmg', n: 2 }] },
      // 보석
      coal:      { id: 'coal',      name: '숯불',      type: 'gem', cost: 3, effects: [{ op: 'ember', n: 2 }] },
      resonant:  { id: 'resonant',  name: '공명 수정', type: 'gem', cost: 4, effects: [{ op: 'ember', n: 2 }, { op: 'charge', n: 1 }] },
      foundry:   { id: 'foundry',   name: '용광 결정', type: 'gem', cost: 5, effects: [{ op: 'ember', n: 3 }] },
      // 유물
      compass:  { id: 'compass',  name: '낡은 나침반', type: 'relic', cost: 3, effects: [{ op: 'ember', n: 1 }, { op: 'draw', n: 1 }] },
      lantern:  { id: 'lantern',  name: '성채 등불',   type: 'relic', cost: 4, effects: [{ op: 'ember', n: 1 }, { op: 'heal', n: 2 }] },
      // 주문
      lance:    { id: 'lance',    name: '재의 창',      type: 'spell', cost: 3, effects: [{ op: 'dmg', n: 4 }] },
      chain:    { id: 'chain',    name: '불꽃 연쇄',    type: 'spell', cost: 4, effects: [{ op: 'dmg', n: 2 }, { op: 'dmg', n: 3 }] },
      mend:     { id: 'mend',     name: '치유의 잿불',  type: 'spell', cost: 4, effects: [{ op: 'heal', n: 3 }, { op: 'dmg', n: 2 }] },
      nova:     { id: 'nova',     name: '별조각 폭발',  type: 'spell', cost: 6, effects: [{ op: 'dmg', n: 7 }] },
      // 레거시로만 들어오는 카드 (공급처에는 없다)
      sera_lamp: { id: 'sera_lamp', name: '세라의 등불', type: 'relic', cost: 0, effects: [{ op: 'ember', n: 2 }, { op: 'healMage', n: 1 }], legacyOnly: true }
    },

    nemesis: {
      name: '굶주린 문',
      life: 60,
      // 굶주림: 카드의 'unleash' 효과가 발동할 때마다 +step, threshold에 닿으면 폭발
      unleash: { step: 1, threshold: 3, strike: [{ op: 'hitGrave', n: 3 }] },
      targeting: 'random',   // 술사를 때리는 효과의 대상: random | lowest | last
      deck: {
        a_breath: 3, a_claw: 2, a_ceiling: 2,
        p_door: 2, p_song: 1,
        m_ash: 2, m_wolf: 1, m_bell: 1
      },
      cards: {
        a_breath:  { id: 'a_breath',  kind: 'attack', name: '문틈의 숨결',   effects: [{ op: 'hitGrave', n: 3 }], onDraw: [{ op: 'unleash', n: 1 }] },
        a_claw:    { id: 'a_claw',    kind: 'attack', name: '굶주린 손톱',   effects: [{ op: 'hitMage', n: 2 }], onDraw: [{ op: 'unleash', n: 1 }] },
        a_ceiling: { id: 'a_ceiling', kind: 'attack', name: '무너지는 천장', effects: [{ op: 'hitGrave', n: 2 }, { op: 'hitMage', n: 1 }], onDraw: [{ op: 'unleash', n: 1 }] },
        p_door: { id: 'p_door', kind: 'power', name: '문이 열린다',   countdown: 3, disarm: 5, effects: [{ op: 'hitGrave', n: 6 }], onDraw: [{ op: 'unleash', n: 1 }] },
        p_song: { id: 'p_song', kind: 'power', name: '굶주림의 노래', countdown: 3, disarm: 4, effects: [{ op: 'hitMage', n: 4 }], onDraw: [{ op: 'unleash', n: 1 }] },
        m_ash:  { id: 'm_ash',  kind: 'minion', name: '재의 하수인', life: 3, each: [{ op: 'hitGrave', n: 1 }], onDraw: [{ op: 'unleash', n: 1 }] },
        m_wolf: { id: 'm_wolf', kind: 'minion', name: '균열 늑대',   life: 4, each: [{ op: 'hitMage', n: 1 }], onDraw: [{ op: 'unleash', n: 1 }] },
        m_bell: { id: 'm_bell', kind: 'minion', name: '종지기',      life: 5, each: [{ op: 'hitGrave', n: 2 }], onDraw: [{ op: 'unleash', n: 1 }] }
      }
    },

    // 새 시나리오를 만들 때 이 항목만 채우면 밸런스 도구가 목표 승률에 맞춰 준다.
    balance: {
      target: [0.60, 0.75],          // 봇 기준 목표 승률 (튜토리얼은 넉넉하게)
      knobs: ['nemesis.life', 'gravehold.life'],
      games: 3000
    }
  };
});
