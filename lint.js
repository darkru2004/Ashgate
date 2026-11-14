/* 시나리오 데이터 점검기: 새 캠페인 데이터를 만들 때 "없는 카드를 참조" 같은 실수를 엔진 실행 전에 잡는다.
 * node lint.js  (기본: data.js)
 */
function lint(scn) {
  const errs = [];
  const NEMS = scn.nemeses || { default: scn.nemesis };
  const C = scn.cards, NC = {};
  Object.keys(NEMS).forEach(k => Object.assign(NC, NEMS[k].cards));
  const ops = new Set(['ember', 'dmg', 'heal', 'healMage', 'charge', 'chargeReset', 'draw', 'hitGrave', 'hitMage', 'hitSelf', 'hunger', 'unleash', 'forget', 'recall', 'focusAlly', 'openAlly', 'maxLife', 'dmgMinion', 'dmgAll', 'peekTurn', 'delayPower', 'anchor', 'devour', 'returnDevoured']);
  const MAGES = scn.mages || [scn.mage];
  const checkEff = (where, eff) => (eff || []).forEach(e => { if (!ops.has(e.op)) errs.push(where + ': 알 수 없는 효과 ' + e.op);
    if (e.op !== 'chargeReset' && !(e.n > 0 || (e.op === 'hunger' && e.n < 0))) errs.push(where + ': 수치 오류');
    if (e.op === 'forget' && !['hand', 'deckTop', 'discardTop'].includes(e.from)) errs.push(where + ': forget.from 값 오류');
    if (e.op === 'devour' && !['one', 'all'].includes(e.who)) errs.push(where + ': devour.who 값 오류');
    if (e.op === 'recall' && !['top', 'hand'].includes(e.to)) errs.push(where + ': recall.to 값 오류'); });
  Object.keys(C).forEach(id => {
    const c = C[id];
    if (c.id !== id) errs.push('카드 id 불일치: ' + id);
    if (!['gem', 'relic', 'spell'].includes(c.type)) errs.push(id + ': type 오류');
    checkEff(id, c.effects);
  });
  if (!MAGES.length) errs.push('일행(mages)이 하나도 없다');
  const mids = new Set();
  MAGES.forEach(m => {
    if (!m.id) errs.push('일행 id 필요: ' + m.name);
    if (mids.has(m.id)) errs.push('일행 id 중복: ' + m.id);
    mids.add(m.id);
    Object.keys(m.startingDeck).forEach(id => { if (!C[id]) errs.push(m.id + ': 시작 덱에 없는 카드: ' + id); });
    if (!(m.life > 0)) errs.push(m.id + ': life 필요');
    if (!m.ability || !(m.ability.cost > 0)) errs.push(m.id + ': ability.cost 필요');
    else checkEff(m.id + '.ability', m.ability.effects);
    (m.breaches || []).forEach((b, i) => checkEff(m.id + '.breach' + i + '.onOpen', b.onOpen));
    if (m.breaches.length !== 4) errs.push(m.id + ': 균열은 4개');
    else if (!m.breaches[0].open && !m.allClosed) errs.push(m.id + ': 1번 균열은 처음부터 열려 있어야 한다');
  });
  const td = scn.turnDeck || {};
  [1, 2, 3, 4].forEach(n => { const sl = (td.slots || {})[n]; if (sl != null && sl < n) errs.push('turnDeck.slots[' + n + '] 은 인원수 이상이어야 한다'); });
  const checkSupply = (name, sup) => {
  const piles = [];
  ['gems', 'relics', 'spells'].forEach(g => (sup[g] || []).forEach(id => {
    piles.push(id);
    if (!C[id]) errs.push('공급처에 없는 카드: ' + id);
    else if (C[id].type + 's' !== g) errs.push(id + ': ' + g + ' 칸에 맞지 않는 타입');
  }));
  if (piles.length !== 9) errs.push(name + ': 공급처는 9더미여야 한다 (현재 ' + piles.length + ')');
  if (new Set(piles).size !== piles.length) errs.push(name + ': 공급처에 중복 카드');
  };
  checkSupply('supply', scn.supply);
  Object.keys(scn.supplySets || {}).forEach(k => checkSupply('supplySets.' + k, scn.supplySets[k]));
  Object.keys(NEMS).forEach(k => Object.keys(NEMS[k].deck).forEach(id => { if (!NEMS[k].cards[id]) errs.push(k + ' 적 덱에 없는 카드: ' + id); }));
  Object.keys(NC).forEach(id => {
    const c = NC[id];
    if (c.onDraw) checkEff(id + '.onDraw', c.onDraw);
    if (c.kind === 'attack') checkEff(id, c.effects);
    if (c.kind === 'power') { checkEff(id, c.effects); if (!(c.countdown > 0) || !(c.disarm > 0)) errs.push(id + ': countdown/disarm 필요'); }
    if (c.onDeath) checkEff(id + '.onDeath', c.onDeath);
    if (c.lifePlus && c.lifePlus !== 'devoured') errs.push(id + ': lifePlus 값 오류');
    if (c.kind === 'minion') { checkEff(id, c.each); if (!(c.life > 0)) errs.push(id + ': life 필요'); }
    if (!['attack', 'power', 'minion'].includes(c.kind)) errs.push(id + ': kind 오류');
  });
  Object.keys(NEMS).forEach(k => {
    if (NEMS[k].recommended && !(scn.supplySets || {})[NEMS[k].recommended]) errs.push(k + ': recommended 세트가 supplySets에 없다');
    const u = NEMS[k].unleash;
    if (u) { if (!(u.threshold > 0)) errs.push(k + ': unleash.threshold 필요'); checkEff(k + '.unleash.strike', u.strike); }
    if (NEMS[k].targeting && !['random', 'lowest', 'last'].includes(NEMS[k].targeting)) errs.push(k + ': targeting 값 오류');
  });
  scn.story.choice.options.forEach(o => {
    const l = o.legacy;
    (l.deckAdd || []).concat(l.deckRemove || []).forEach(id => { if (!C[id]) errs.push('레거시가 없는 카드를 참조: ' + id); });
    (l.nemesisAdd || []).forEach(id => { if (!NC[id]) errs.push('레거시가 없는 적 카드를 참조: ' + id); });
  });
  const sk = scn.balance && scn.balance.target;
  if (!sk || sk[0] >= sk[1]) errs.push('balance.target 필요');
  return errs;
}
module.exports = { lint };
if (require.main === module) {
  const e = lint(require('./data.js'));
  if (e.length) { console.log('데이터 오류 ' + e.length + '건'); e.forEach(x => console.log(' - ' + x)); process.exit(1); }
  console.log('데이터 점검 통과');
}
