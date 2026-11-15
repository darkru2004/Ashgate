/* 브라우저 구동 테스트 v3 (Chrome 헤드리스): node uitest3.js
 * 화면 버튼만 눌러서 여러 설정으로 판을 끝까지 진행하고, 화면 오류·멈춤이 없는지 확인한다.
 */
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs');
const FILE = 'file://' + path.join(__dirname, 'dist', 'ashgate.html');
const SHOT = path.join(__dirname, 'shots'); fs.mkdirSync(SHOT, { recursive: true });

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) fails++; };

async function newPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  return page;
}
const G = page => page.evaluate(() => { const g = window.__ash.G; return { screen: g.screen, modal: g.modal && g.modal.type, scene: !!g.scene, over: g.s && g.s.over, ctrl: g.s && !g.s.over ? window.__ash.eng.controller(g.s) : null, phase: g.s && g.s.phase }; });
const click = async (page, sel) => { const l = page.locator(sel + ':not([disabled])').first(); if (await l.count()) { await l.click(); return true; } return false; };

const tab = async (page, v) => { const l = page.locator('[data-act=tab][data-v=' + v + ']'); if (await l.count() && await l.first().isVisible()) await l.first().click(); };
// 설정 화면에서 일행/적/공급처/난이도 고르기
async function setup(page, o) {
  await click(page, '[data-act=setup]');
  // 일행 수 맞추기
  for (let i = 1; i < o.party.length; i++) await click(page, '[data-act=padd]');
  for (let k = 0; k < o.party.length; k++) {
    await click(page, `[data-act=pmage][data-k="${k}"][data-id="${o.party[k][0]}"]`);
    await click(page, `[data-act=pseat][data-k="${k}"][data-v="${o.party[k][1]}"]`);
  }
  await click(page, `[data-act=nem][data-v="${o.nem}"]`);
  await click(page, `[data-act=diff][data-v="${o.diff || 'normal'}"]`);
  await click(page, '[data-act=speed][data-v="fast"]');
  if (o.supply === 'custom') {
    await click(page, '[data-act=sup][data-v="custom"]');
    for (const [g, n] of [['gems', 3], ['relics', 2], ['spells', 4]]) {
      for (let i = 0; i < n; i++) await page.locator(`[data-act=spick][data-g="${g}"]`).nth(i).click();
    }
    await click(page, '[data-act=sok]');
  } else await click(page, `[data-act=sup][data-v="${o.supply || 'recommended'}"]`);
  await click(page, '[data-act=start]');
}

// 사람 차례를 화면 버튼으로 둔다 (단순한 규칙: 시전 → 카드 사용 → 주문 준비 → 구매 → 종료)
async function humanTurn(page) {
  let noPrep = false, noBuy = 0;
  for (let g = 0; g < 60; g++) {
    const st = await G(page);
    if (st.screen !== 'play') return;
    if (st.scene) { await click(page, '[data-act=sceneNext]'); await page.waitForTimeout(30); continue; }
    if (st.ctrl !== 'human') return;
    if (st.modal) {
      if (st.modal === 'order') { await click(page, '[data-act=ook]'); continue; }
      if (await click(page, '[data-act=wild]')) continue;
      if (await click(page, '[data-act=wpick]')) continue;
      if (await click(page, '[data-act=close]')) continue;
      return;
    }
    await tab(page, 'me');
    if (st.phase === 'cast') {
      if (await click(page, '[data-act=cast]')) continue;
      if (await click(page, '[data-act=endCast]')) continue;
    }
    // 보석/유물 사용
    const playable = page.locator('.card.gem[data-act=hand], .card.relic[data-act=hand]');
    if (await playable.count()) { await playable.first().click(); continue; }
    // 주문 준비
    const spell = page.locator('.card.spell[data-act=hand]');
    if (!noPrep && await spell.count()) {
      await spell.first().click();
      if (await click(page, '[data-act=prepTo]')) continue;
      noPrep = true;
      if (await page.locator('.card.sel').count()) await page.locator('.card.sel').first().click();   // 준비할 곳이 없으면 선택 취소
    }
    if (await click(page, '[data-act=ability]')) continue;
    await tab(page, 'foe');
    if (await click(page, '[data-act=disarm]')) continue;
    await tab(page, 'supply');
    // 가장 비싼 살 수 있는 카드 하나
    const buys = page.locator('[data-act=buy]:not([disabled])');
    const nb = await buys.count();
    if (nb && noBuy++ < 4) { await buys.nth(nb - 1).click(); continue; }
    await tab(page, 'me');
    if (await click(page, '[data-act=open]')) continue;
    await click(page, '[data-act=endMain]');
    return;
  }
}

async function playToEnd(page, label, limitMs) {
  const t0 = Date.now();
  let humanTurns = 0;
  while (Date.now() - t0 < (limitMs || 120000)) {
    const st = await G(page);
    if (st.screen === 'result') break;
    if (st.scene) { await click(page, '[data-act=sceneNext]'); await page.waitForTimeout(30); }
    else if (st.ctrl === 'human' || st.modal) { await humanTurn(page); humanTurns++; }
    else await page.waitForTimeout(60);
  }
  const st = await G(page);
  ok(st.screen === 'result', label + ': 결과 화면까지 진행 (' + (st.over || '미종료') + ', 사람 차례 ' + humanTurns + '번)');
  ok(page.errors.length === 0, label + ': 화면 오류 없음' + (page.errors.length ? ' → ' + page.errors.slice(0, 3).join(' | ') : ''));
  return st;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  // 1) 1인 사람, E1, 추천
  {
    const p = await newPage(browser);
    await p.screenshot({ path: SHOT + '/v3_1_title.png' });
    await click(p, '[data-act=setup]'); await p.screenshot({ path: SHOT + '/v3_2_setup.png', fullPage: true }); await click(p, '[data-act=title]');
    await setup(p, { party: [['seo', 'human']], nem: 'e1' });
    await p.screenshot({ path: SHOT + '/v3_3_intro.png' });
    await click(p, '[data-act=close]');
    await p.screenshot({ path: SHOT + '/v3_4_play.png', fullPage: true });
    await playToEnd(p, '1인 세오(사람) vs E1');
    await p.screenshot({ path: SHOT + '/v3_5_result.png' });
    // 같은 설정으로 다시
    await click(p, '[data-act=again]');
    ok((await G(p)).screen === 'play', '같은 설정으로 다시 시작');
    await p.close();
  }
  // 2) 2인 (사람 기록관 + AI 새김꾼), E2, 무작위 공급
  {
    const p = await newPage(browser);
    await setup(p, { party: [['rec', 'human'], ['car', 'bot']], nem: 'e2', supply: 'random' });
    await click(p, '[data-act=close]');
    await playToEnd(p, '2인 기록관(사람)+새김꾼(AI) vs E2');
    await p.close();
  }
  // 3) 한 폰 번갈아: 사람 2명 + AI 1명, E3, 직접 고른 공급처, 어려움 — 모바일 화면
  {
    const p = await newPage(browser, { width: 390, height: 844 });
    await setup(p, { party: [['tow', 'human'], ['seo', 'human'], ['rec', 'bot']], nem: 'e3', supply: 'custom', diff: 'hard' });
    await click(p, '[data-act=close]');
    await p.screenshot({ path: SHOT + '/v3_6_mobile.png', fullPage: true });
    // 차례 전환 안내가 한 번 이상 나오는지
    let sawSwitch = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      const st = await G(p);
      if (st.screen === 'result') break;
      if (st.modal === 'handoff') {
        const title = await p.locator('.modal h2').first().textContent();
        if (title.indexOf('지금:') >= 0) { sawSwitch = true; if (!fs.existsSync(SHOT + '/v3_7_handoff.png')) await p.screenshot({ path: SHOT + '/v3_7_handoff.png' }); }
      }
      if (st.scene) { await click(p, '[data-act=sceneNext]'); await p.waitForTimeout(30); } else if (st.ctrl === 'human' || st.modal) await humanTurn(p); else await p.waitForTimeout(60);
    }
    ok(sawSwitch, '사람 2명: "지금: ○○의 차례" 전환 안내가 나온다');
    ok((await G(p)).screen === 'result', '사람 2명+AI vs E3(어려움, 직접 공급): 결과 화면까지');
    ok(p.errors.length === 0, '모바일: 화면 오류 없음' + (p.errors.length ? ' → ' + p.errors.slice(0, 3).join(' | ') : ''));
    await p.close();
  }
  // 4) AI 4명 관전 (무작위 적)
  {
    const p = await newPage(browser);
    await setup(p, { party: [['seo', 'bot'], ['rec', 'bot'], ['tow', 'bot'], ['car', 'bot']], nem: 'random' });
    await click(p, '[data-act=close]');
    await playToEnd(p, 'AI 4명 관전', 180000);
    await p.close();
  }
  // 5) 저장 → 새로고침 → 이어하기
  {
    const p = await newPage(browser);
    await setup(p, { party: [['seo', 'human'], ['rec', 'bot']], nem: 'e1' });
    await click(p, '[data-act=close]');
    for (let i = 0; i < 3; i++) await humanTurn(p);
    await p.waitForTimeout(400);
    const before = await p.evaluate(() => window.__ash.G.s.turnNo);
    await p.reload();
    ok(await p.locator('[data-act=continue]').count() > 0, '새로고침 뒤 "이어하기" 버튼');
    await click(p, '[data-act=continue]');
    const after = await p.evaluate(() => window.__ash.G.s.turnNo);
    ok(after >= before && (await G(p)).screen === 'play', '이어하기로 같은 판 복원 (차례 ' + before + ' → ' + after + ')');
    // 효과 선택 창: 동료 대상 카드 강제 확인 (손에 유모의 손난로를 넣고 사람 차례로)
    await p.evaluate(() => {
      const g = window.__ash.G, s = g.s;
      s.over = null; s.active = 0; s.phase = 'main'; s.mages[0].hand = ['r_lamp', 'g_drifter', 'shard'];
      s.mages[0].discard = ['g_baker', 'spark']; s.mages.push(JSON.parse(JSON.stringify(s.mages[1]))); s.mages[2].name = '테스트'; s.seats.push('bot');
      g.modal = null; window.__ash.render();
    });
    await p.locator('.card[data-act=hand]').first().click();
    const q = await p.locator('.modal p').first().textContent().catch(() => '');
    ok(q.indexOf('누구에게') >= 0, '동료가 둘 이상이면 "누구에게?" 선택 창');
    await p.screenshot({ path: SHOT + '/v3_8_wizard.png' });
    await click(p, '[data-act=wpick]');
    await p.locator('.card[data-act=hand]').first().click();    // 떠돌이의 잿불 → 잊을 카드 선택
    const q2 = await p.locator('.modal p').first().textContent().catch(() => '');
    ok(q2.indexOf('잊을 카드') >= 0, '필수 잊음: 잊을 카드 선택 창');
    const h0 = await p.evaluate(() => window.__ash.G.s.hunger);
    await click(p, '[data-act=wpick]');
    const r = await p.evaluate(() => ({ f: window.__ash.G.s.mages[0].forgotten.length, h: window.__ash.G.s.hunger }));
    ok(r.f === 1, '고른 카드가 잊혔다');
    ok(p.errors.length === 0, '이어하기/선택 창: 화면 오류 없음' + (p.errors.length ? ' → ' + p.errors.slice(0, 3).join(' | ') : ''));
    await p.close();
  }
  // 6) 5단계: 버림 순서 화면 · 적 차례 연출 · 되돌리기 · 연출 끄기
  {
    const p = await newPage(browser, { width: 390, height: 844 });
    await setup(p, { party: [['seo', 'human']], nem: 'e1' });
    await click(p, '[data-act=close]');
    for (let i = 0; i < 40 && (await G(p)).scene; i++) { await click(p, '[data-act=sceneNext]'); await p.waitForTimeout(40); }
    ok(!(await G(p)).scene, '시작 때 나온 적 차례 연출을 눌러서 넘길 수 있다');
    await p.evaluate(() => {
      const g = window.__ash.G, s = g.s, m = s.mages[0];
      s.active = 0; s.phase = 'main'; m.hand = ['shard']; m.played = ['spark', 'shard']; m.gained = []; m.ember = 3;
      m.discard = ['shard']; m.deck = ['shard', 'shard', 'shard', 'shard', 'shard', 'shard'];
      s.turnDeck = ['M0', 'N']; s.turnDiscard = []; s.nemDeck = ['e1_claw']; s.tierSizes = [1, 0, 0]; s.tierPass = true; s.powers = []; s.minions = [];
      g.modal = null; g.undo = []; window.__ash.render();
    });
    // 되돌리기: 공급처에서 하나 사고 되돌린다
    await tab(p, 'supply');
    const e0 = await p.evaluate(() => window.__ash.G.s.mages[0].ember);
    const buyable = p.locator('[data-act=buy]:not([disabled])');
    if (await buyable.count()) {
      await buyable.first().click();
      ok(await p.locator('[data-act=undo]').count() > 0, '산 뒤에 되돌리기 버튼이 생긴다');
      await click(p, '[data-act=undo]');
      ok((await p.evaluate(() => window.__ash.G.s.mages[0].ember)) === e0, '되돌리기로 불씨가 원래대로');
    } else ok(false, '살 수 있는 카드가 없어 되돌리기를 시험하지 못함');
    await tab(p, 'me');
    await click(p, '[data-act=endMain]');
    ok((await G(p)).modal === 'order', '쓴 카드가 둘 이상이면 버릴 순서 화면이 자동으로 뜬다');
    await p.screenshot({ path: SHOT + '/v3_9_order.png' });
    await click(p, '[data-act=oup][data-k="1"]');       // 두 번째 카드를 위로
    await click(p, '[data-act=ook]');
    await p.waitForTimeout(200);
    const orderRes = await p.evaluate(() => { const s = window.__ash.G.s; return { scene: !!window.__ash.G.scene, d: s.mages[0].discard.concat(s.mages[0].deck).slice(0, 3) }; });
    ok(orderRes.scene, '차례를 마치면 적 차례 연출이 나온다');
    await p.screenshot({ path: SHOT + '/v3_10_scene.png' });
    // 카드 장면에서 탭을 기다리는지 → 탭하면 결과 줄이 나온다
    let waited = false;
    for (let i = 0; i < 40; i++) {
      const S = await p.evaluate(() => { const s = window.__ash.G.scene; return s && { wait: s.wait, done: s.done, n: s.lines.length, card: !!s.card }; });
      if (!S) break;
      if (S.wait) { waited = true; ok(S.card, '보스 카드가 뒤집힌 채 탭을 기다린다'); await p.screenshot({ path: SHOT + '/v3_11_card.png' }); }
      await click(p, '[data-act=sceneNext]'); await p.waitForTimeout(60);
    }
    ok(waited, '보스 카드 장면에서 탭 대기가 있다');
    ok(!(await G(p)).scene && (await G(p)).screen === 'play', '연출이 끝나면 다시 내 차례 화면');
    ok(p.errors.length === 0, '순서·연출·되돌리기: 화면 오류 없음' + (p.errors.length ? ' → ' + p.errors.slice(0, 3).join(' | ') : ''));
    // 연출 끄기: 연출 없이 바로 진행 (그동안 일어난 일 창으로 대신)
    await p.evaluate(() => { const g = window.__ash.G; g.cfg.fx = 'off'; const s = g.s, m = s.mages[0]; s.active = 0; s.phase = 'main'; m.hand = []; m.played = []; s.turnDeck = ['M0', 'N']; s.nemDeck = ['e1_claw']; window.__ash.render(); });
    await click(p, '[data-act=endMain]'); await p.waitForTimeout(200);
    const off = await G(p);
    ok(!off.scene, '연출 끄기: 장면이 나오지 않는다');
    await p.close();
  }
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '건' : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
