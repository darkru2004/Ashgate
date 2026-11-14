// 인원별 scaling.nemLife 배율을 이분 탐색 (그 인원의 대표 일행들을 합친 승률이 목표 중앙에 오도록)
const S = require('./sim.js');
const base = S.clone(require('./data.js'));
if (process.env.NCOUNT) base.turnDeck.nemesis = JSON.parse(process.env.NCOUNT);   // 예: {"1":2,"4":3}
const ids = base.mages.map(m => m.id);
const groups = { 1: ids.map(i => [i]), 2: [[ids[0], ids[1]], [ids[2], ids[3]], [ids[0], ids[3]]], 3: [[ids[0], ids[1], ids[2]], [ids[1], ids[2], ids[3]]], 4: [ids] };
const games = +(process.argv[2] || 300), target = 0.675;
const out = {};
function rate(n, mult, key) {
  const c = S.clone(base);
  if (NEM) { const N = c.nemeses[NEM]; N.scaling = N.scaling || {}; N.scaling[n] = Object.assign({}, N.scaling[n]); N.scaling[n][key] = mult; }
  else { c.scaling[n] = Object.assign({}, c.scaling[n]); c.scaling[n][key] = mult; }
  let w = 0, g = 0;
  groups[n].forEach(p => { const r = S.runBatch(c, games, 1000, {}, null, p, NEM ? { nemesis: NEM } : {}); w += r.wins; g += r.games; });
  return w / g;
}
const key = process.argv[3] || 'nemLife';
const NEM = process.argv[4] || null;   // 적 id를 주면 그 적 전용 배율(nemeses.<id>.scaling)을 탐색
(process.env.ONLY ? process.env.ONLY.split(',').map(Number) : [1, 2, 3, 4]).forEach(n => {
  let lo = 0.5, hi = 6.0;
  for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (rate(n, mid, key) > target) lo = mid; else hi = mid; }
  const m = Math.round((lo + hi) / 2 * 100) / 100;
  out[n] = m; console.log(n + '인 ' + key + ' ×' + m + ' → ' + (rate(n, m, key) * 100).toFixed(1) + '%');
});
console.log(JSON.stringify(out));
