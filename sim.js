#!/usr/bin/env node
/* 시뮬레이션 밸런스 도구
 *   node sim.js                         기본 3000판 승률/통계
 *   node sim.js --games 5000
 *   node sim.js --party 3               일행 인원(1~4)별로 측정
 *   node sim.js --set nemesis.life=45   수치를 임시로 바꿔서 측정
 *   node sim.js --tune nemesis.life     목표 승률 구간 중앙에 맞는 값을 이분 탐색
 *   node sim.js --tune gravehold.life --range 15,60
 * 새 시나리오: data 파일의 balance 항목(target/knobs)만 채우면 같은 도구를 그대로 쓴다.
 */
const Engine = require('./engine.js');
const Bot = require('./bot.js');

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function setPath(obj, path, v) {
  const k = path.split('.'); let o = obj;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k[k.length - 1]] = v;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }

// partySize: 인원수(0번 지기만 반복) 또는 일행 배열(id/번호). gameOpts: {nemesis, difficulty, supply}
function runBatch(scn, games, seed0, botCfg, legacy, partySize, gameOpts) {
  const party = Array.isArray(partySize) ? partySize : Array(partySize || 1).fill(0);
  const eng = Engine.create(scn);
  const bot = Bot.create(eng, botCfg);
  const rawAct = eng.act; eng.act = function (st, a) { const x = rawAct(st, a); if (!x.ok) r.rejected++; return x; };
  gameOpts = gameOpts || {};
  const r = { games, rejected: 0, wins: 0, loseGrave: 0, loseMage: 0, stall: 0, winTurns: [], loseTurns: [], bossLeftOnLoss: [], breachesOpen: [], nemTurnsWin: [], powerFires: 0 };
  for (let g = 0; g < games; g++) {
    const s = eng.newGame(Object.assign({ seed: seed0 + g * 7919, legacy: legacy, party: party, seats: party.map(() => 'bot') }, gameOpts));
    let guard = 0;
    while (!s.over && guard++ < 1500) bot.takeTurn(s);
    if (!s.over) { r.stall++; continue; }
    const opened = s.mages.reduce((a, m) => a + m.breaches.filter(b => b.open).length, 0) / s.mages.length;
    r.breachesOpen.push(opened);
    if (s.over === 'win') { r.wins++; r.winTurns.push(s.turnNo); r.nemTurnsWin.push(s.nemTurns); }
    else {
      r.loseTurns.push(s.turnNo); r.bossLeftOnLoss.push(s.nemLife);
      if (s.graveLife <= 0) r.loseGrave++; else r.loseMage++;
    }
  }
  return r;
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function pct(x) { return (x * 100).toFixed(1) + '%'; }

function report(scn, r) {
  const p = r.wins / r.games, ci = 1.96 * Math.sqrt(p * (1 - p) / r.games);
  const t = scn.balance.target;
  const verdict = p < t[0] ? '너무 어려움' : p > t[1] ? '너무 쉬움' : '목표 구간 안';
  console.log('판수 ' + r.games + ' | 승률 ' + pct(p) + ' (±' + pct(ci) + ') | 목표 ' + pct(t[0]) + '~' + pct(t[1]) + ' → ' + verdict);
  console.log('승리 시 평균 술사 차례 ' + avg(r.winTurns).toFixed(1) + ' / 평균 적 차례 ' + avg(r.nemTurnsWin).toFixed(1));
  const losses = r.games - r.wins - r.stall;
  console.log('패배 ' + losses + '판 — 성채 붕괴 ' + r.loseGrave + ', 일행 전멸 ' + r.loseMage + ', 보스 남은 생명 평균 ' + avg(r.bossLeftOnLoss).toFixed(1) + (r.stall ? ', 교착 ' + r.stall : '') + (r.rejected ? ' | ★거부된 행동 ' + r.rejected : ''));
  console.log('종료 시 일행 1명당 열린 균열 평균 ' + avg(r.breachesOpen).toFixed(2));
}

function tune(scn, path, range, games, botCfg, partySize) {
  const target = (scn.balance.target[0] + scn.balance.target[1]) / 2;
  let lo = range[0], hi = range[1];
  const rate = v => { const c = clone(scn); setPath(c, path, v); const r = runBatch(c, games, 1000, botCfg, null, partySize, {}); return r.wins / r.games; };
  const rLo = rate(lo), rHi = rate(hi);
  const dir = rLo > rHi ? 1 : -1;   // 값이 커질수록 승률이 내려가면 1
  console.log('탐색 ' + path + ' [' + lo + ', ' + hi + '] — 양끝 승률 ' + pct(rLo) + ' / ' + pct(rHi) + ', 목표 중앙 ' + pct(target));
  while (hi - lo > 1) {
    const mid = Math.round((lo + hi) / 2);
    const m = rate(mid);
    console.log('  ' + path + ' = ' + mid + ' → ' + pct(m));
    if ((m > target) === (dir === 1)) lo = mid; else hi = mid;
  }
  const a = rate(lo), b = rate(hi);
  const best = Math.abs(a - target) <= Math.abs(b - target) ? lo : hi;
  console.log('권장값 ' + path + ' = ' + best + ' (승률 ' + pct(best === lo ? a : b) + ')');
  return best;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
  const scn = clone(require('./data.js'));
  const games = parseInt(opt('games') || scn.balance.games, 10);
  args.forEach((a, i) => {
    if (a === '--set') { const [k, v] = args[i + 1].split('='); setPath(scn, k, isNaN(+v) ? v : +v); }
  });
  const botCfg = {};
  args.forEach((a, i) => { if (a === '--bot') { const [k, v] = args[i + 1].split('='); botCfg[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; } });
  const gameOpts = {};
  if (opt('nem')) gameOpts.nemesis = opt('nem');
  if (opt('diff')) gameOpts.difficulty = opt('diff');
  if (opt('supply')) gameOpts.supply = opt('supply');
  const ids = scn.mages.map(m => m.id);
  const label = p => p.map(x => (typeof x === 'number' ? scn.mages[x] : scn.mages.find(m => m.id === x)).name).join('+');
  const tp = opt('tune');
  // --mages seo,rec,tow  : 이 일행으로 측정 / --party N : 지기 N명(세오 반복) / --each : 지기별 1인 + 인원별 기본 일행
  let parties;
  if (opt('mages')) parties = [opt('mages').split(',')];
  else if (args.includes('--each')) parties = ids.map(i => [i]).concat([ids.slice(0, 2), ids.slice(0, 3), ids.slice(0, 4)]);
  else parties = [Array(parseInt(opt('party') || '1', 10)).fill(0)];
  if (tp) {
    const range = (opt('range') || '').split(',').map(Number);
    const cur = getPath(scn, tp);
    tune(scn, tp, range.length === 2 ? range : [Math.round(cur * 0.4), Math.round(cur * 2)], Math.min(games, 1500), botCfg, parties[0]);
  } else {
    parties.forEach(p => {
      console.log('일행 ' + p.length + '인 [' + label(p) + ']' + (gameOpts.nemesis ? ' 적=' + gameOpts.nemesis : '') + (gameOpts.difficulty ? ' 난이도=' + gameOpts.difficulty : ''));
      report(scn, runBatch(scn, games, 1000, botCfg, null, p, gameOpts));
    });
  }
}
module.exports = { runBatch, tune, setPath, getPath, report, clone };
