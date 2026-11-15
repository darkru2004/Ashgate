/* 밸런스 측정용 봇. "적당히 합리적으로" 두는 휴리스틱이라 사람보다 약간 못하거나 비슷하다고 가정한다.
 * 목적은 승률 측정이지 최적 플레이가 아니다. 규칙은 전부 엔진을 통해서만 실행한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AshBot = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(eng, baseCfg) {
    let cfg = null;
    const defaults = {
      disarmAt: 1,          // 힘(Power)의 남은 카운트가 이 이하일 때 해제
      minDensity: 1.0,      // 덱 평균 불씨가 이보다 낮으면 보석 우선
      spellTarget: 0.40,    // 덱 중 주문 비율 목표
      extraSpells: 1,       // 열린 균열 수 + 이 값 이상 주문이 있어야 새 균열을 연다
      maxWaste: 3,          // 하수인을 잡을 때 허용하는 초과 피해
      focusPrep: true,
      forgetMode: 'normal', // normal | aggressive | never — 잊음 카드를 얼마나 쓰는가 (잊음 비용 검증용)
      healBelow: 0.6,       // 성채 생명이 이 비율 아래면 회복을 중시
      allySupport: false    // 동료 새김 지원형(새김꾼)
    };
    baseCfg = baseCfg || {};
    const scn = eng.scn, C = scn.cards, NC = eng.NC;

    function sum(effects, op) {
      return effects.reduce(function (a, e) { return a + (e.op === op ? e.n : 0); }, 0);
    }
    function has(c, op) { return c.effects.some(function (e) { return e.op === op; }); }
    function dmgOf(c) { return sum(c.effects, 'dmg') + sum(c.effects, 'dmgAll') * 1.3; }
    function forgets(c) { return c.effects.filter(function (e) { return e.op === 'forget'; }); }
    function ownedCards(s) {
      const m = eng.cur(s);
      let all = m.deck.concat(m.hand, m.discard, m.played);
      m.breaches.forEach(function (b) { if (b.prepped) all.push(b.prepped); });
      return all;
    }
    // 회복 효과를 받을 동료: 살아 있는 다른 일행 중 생명 비율이 가장 낮은 쪽 (없으면 undefined)
    function closedCount(m) { return m.breaches.filter(function (b) { return !b.open; }).length; }
    function pickAlly(s) {
      let best = -1, ratio = 2;
      eng.living(s).forEach(function (i) {
        if (i === s.active) return;
        // 새김 지원형: 닫힌 새김이 많은 동료를 먼저. 그 밖에는 생명 비율이 낮은 동료
        const r = cfg && cfg.allySupport ? 1 - closedCount(s.mages[i]) / 4 : s.mages[i].life / s.mages[i].max;
        if (r < ratio) { ratio = r; best = i; }
      });
      return best >= 0 ? best : undefined;
    }
    function threat(m, s) {
      const e = NC[m.id].each;
      // 처치하면 먹힌 카드를 돌려주는 잿것은 먹힌 카드가 있을 때 우선 처치
      const bonus = NC[m.id].onDeath && s && s.devoured.length ? 3 : 0;
      return sum(e, 'hitGrave') + sum(e, 'hitMage') * 1.5 + sum(e, 'unleash') * 2 + bonus;
    }
    // 이 적이 카드를 먹거나 섞는가 (매듭의 값어치 판단)
    function attacksDeck(s) {
      return /"devour"|"scramble"/.test(JSON.stringify(eng.nem(s)));
    }

    // 피해 한 번 한 번의 대상을 정한다
    function pickTargets(s, instances) {
      const targets = [];
      const minions = s.minions.map(function (m) { return { uid: m.uid, life: m.life, threat: threat(m, s) }; });
      let nemLeft = s.nemLife;
      instances.forEach(function (n) {
        if (nemLeft <= n) { targets.push('N'); nemLeft -= n; return; }
        const killable = minions
          .filter(function (m) { return m.life <= n && n - m.life <= cfg.maxWaste; })
          .sort(function (a, b) { return b.threat - a.threat || b.life - a.life; })[0];
        if (killable) { targets.push(killable.uid); minions.splice(minions.indexOf(killable), 1); }
        else { targets.push('N'); nemLeft -= n; }
      });
      return targets;
    }

    function cardScore(s, c, stats) {
      const needHeal = s.graveLife <= s.graveMax * cfg.healBelow;
      const multi = s.mages.length > 1;
      const ember = sum(c.effects, 'ember'), draw = sum(c.effects, 'draw');
      const heal = sum(c.effects, 'heal'), charge = sum(c.effects, 'charge'), dmg = dmgOf(c);
      // 보조 효과의 대략적인 값 (동료가 있으면 더 쓸모 있다)
      let extra = sum(c.effects, 'healMage') * (multi ? 2 : 0.5) + sum(c.effects, 'recall') * 4 + sum(c.effects, 'focusAlly') * (multi ? 5 : 3)
        + sum(c.effects, 'dmgMinion') * (s.minions.length ? 3 : 1) + sum(c.effects, 'peekTurn') * 1 + sum(c.effects, 'delayPower') * 3
        - sum(c.effects, 'hitSelf') * 3 + (sum(c.effects, 'hunger') < 0 ? 3 : 0);
      if (sum(c.effects, 'anchor')) extra += attacksDeck(s) ? 14 : -4;
      // 잊음: 굶주림 +1이 따라붙는다
      const fg = forgets(c).filter(function (e) { return !e.optional; }).length;
      if (cfg.forgetMode === 'never') extra -= fg * 100;
      else if (cfg.forgetMode === 'aggressive') extra += fg * 6;
      else extra -= fg * 8;
      if (c.type === 'spell') {
        let v = dmg * 8 + heal * (needHeal ? 5 : 1.5) + extra;
        v += stats.spellFrac < cfg.spellTarget ? 12 : -5;
        return v;
      }
      let v = ember * 10 + draw * (has(c, 'draw') && c.effects.some(function (e) { return e.op === 'draw' && e.to === 'ally'; }) ? 3 : 6) + heal * (needHeal ? 3 : 1) + charge * 3 + extra;
      if (stats.density < cfg.minDensity) v += 12;
      return v;
    }
    function deckStats(s) {
      const all = ownedCards(s);
      let ember = 0, spells = 0;
      all.forEach(function (id) {
        const c = eng.def(id);
        ember += c.effects.reduce(function (a, e) { return a + (e.op === 'ember' ? e.n : 0); }, 0);
        if (c.type === 'spell') spells++;
      });
      return { density: ember / all.length, spellFrac: spells / all.length, spells: spells, total: all.length };
    }

    function prepAll(s) {
      const m = eng.cur(s);
      for (let guard = 0; guard < 12; guard++) {
        if (s.over) return;
        let done = true;
        const spells = [];
        m.hand.forEach(function (id, i) { if (C[id] && C[id].type === 'spell') spells.push({ id: id, i: i }); });
        if (!spells.length) return;
        spells.sort(function (a, b) { return dmgOf(C[b.id]) - dmgOf(C[a.id]); });
        for (let b = 0; b < m.breaches.length; b++) {
          const br = m.breaches[b];
          if (br.prepped || !(br.open || br.focusedTurn === s.turnNo)) continue;
          const sp = spells[0];
          if (!sp) return;
          if (eng.act(s, { type: 'prep', idx: sp.i, breach: b }).ok) { done = false; break; }
        }
        if (done) return;
      }
    }

    function spend(s) {
      const m = eng.cur(s), MD = eng.mageDef(s, s.active);
      for (let guard = 0; guard < 40 && !s.over; guard++) {
        // a) 곧 터지는 힘(Power) 해제
        let di = -1, best = 99;
        s.powers.forEach(function (p, i) {
          const d = NC[p.id];
          const value = sum(d.effects, 'hitGrave') + sum(d.effects, 'hitMage') * 1.5 + sum(d.effects, 'unleash') * 2;
          if (p.tokens <= cfg.disarmAt && d.disarm <= m.ember && value >= d.disarm * 0.9 && p.tokens < best) { di = i; best = p.tokens; }
        });
        if (di >= 0) { eng.act(s, { type: 'disarm', idx: di }); continue; }

        // b) 균열 열기: 주문이 충분히 있을 때만
        const st = deckStats(s);
        const openCount = m.breaches.filter(function (b) { return b.open; }).length;
        let ob = -1, oc = 99;
        m.breaches.forEach(function (b, i) {
          if (!b.open && eng.openCost(s, i) <= m.ember && eng.openCost(s, i) < oc) { ob = i; oc = eng.openCost(s, i); }
        });
        if (ob >= 0 && st.spells >= openCount + cfg.extraSpells) {
          eng.act(s, { type: 'open', breach: ob }); prepAll(s); continue;
        }

        // c) 손에 주문이 남았고 열린 균열이 없다면 집중해서 한 번 준비
        if (cfg.focusPrep) {
          const hasSpell = m.hand.some(function (id) { return C[id] && C[id].type === 'spell'; });
          const freeOpen = m.breaches.some(function (b) { return b.open && !b.prepped; });
          if (hasSpell && !freeOpen) {
            let fb = -1;
            m.breaches.forEach(function (b, i) {
              if (fb < 0 && !b.open && !b.prepped && MD.breaches[i].focusCost <= m.ember) fb = i;
            });
            if (fb >= 0) { eng.act(s, { type: 'focus', breach: fb }); prepAll(s); continue; }
          }
        }

        // d) 구매
        let pick = null, pickScore = -1e9;
        Object.keys(s.supply).forEach(function (id) {
          if (!(s.supply[id] > 0) || C[id].cost > m.ember) return;
          const sc = cardScore(s, C[id], st) + C[id].cost * 0.01;
          if (sc > pickScore) { pickScore = sc; pick = id; }
        });
        if (pick) { eng.act(s, { type: 'buy', id: pick }); continue; }
        break;
      }
    }

    // 기술을 쓸 만한가: 동료 새김을 여는 기술은 열 새김이 있을 때만, 회복은 필요할 때만
    function abilityUseful(s) {
      const MD = eng.mageDef(s, s.active), m = eng.cur(s);
      return MD.ability.effects.every(function (e) {
        if (e.op === 'openAlly') {
          const t = pickAlly(s);
          const tm = t == null ? m : s.mages[t];
          return !!e.fallback || tm.breaches.some(function (b) { return !b.open; });
        }
        if (e.op === 'heal') return s.graveLife < s.graveMax - 2;
        return true;
      });
    }

    // 와일드 차례: 시전할 주문이 준비된 일행을 우선, 같으면 생명 비율이 높은 쪽
    function pickWild(s) {
      let best = -1, bestScore = -1e9;
      eng.living(s).forEach(function (i) {
        const m = s.mages[i];
        const ready = m.breaches.filter(function (b) { return b.prepped; }).length;
        const sc = ready * 10 + m.life / m.max;
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      return best;
    }

    // 지금 행동할 차례인 일행 한 명의 한 차례를 끝까지 둔다 (와일드면 먼저 고른다)
    function takeTurn(s) {
      if (s.over) return;
      if (s.phase === 'wild') {
        eng.act(s, { type: 'pickMage', mage: pickWild(s) });
        if (s.over) return;
      }
      const m = eng.cur(s);
      if (!m) return;
      const MD = eng.mageDef(s, s.active);
      cfg = Object.assign({}, defaults, baseCfg, MD.bot || {});
      const me = s.active;           // 차례 도중 탈진 등으로 차례가 넘어가면 그만둔다
      const gone = function () { return s.over || s.active !== me; };
      // 시전 단계
      let guard = 0;
      while (s.phase === 'cast' && guard++ < 10) {
        const list = eng.castables(s);
        if (!list.length) { eng.act(s, { type: 'endCast' }); break; }
        const bi = list[0];
        eng.act(s, { type: 'cast', breach: bi, targets: pickTargets(s, eng.dmgInstances(s, bi)), ally: pickAlly(s) });
        if (gone()) return;
      }
      if (s.phase === 'cast') eng.act(s, { type: 'endCast' });
      if (gone()) return;
      // 주 단계: 낼 수 있는 보석/유물 전부 사용 (뽑기 효과가 있는 유물 먼저)
      for (guard = 0; guard < 20; guard++) {
        if (gone()) return;
        let idx = m.hand.findIndex(function (id) {
          const c = C[id]; return c && (c.type === 'relic' || c.type === 'gem') && sum(c.effects, 'draw') > 0;
        });
        if (idx < 0) idx = m.hand.findIndex(function (id) { const c = C[id]; return c && (c.type === 'relic' || c.type === 'gem'); });
        if (idx < 0) break;
        const card = C[m.hand[idx]], act = { type: 'play', idx: idx, ally: pickAlly(s) };
        if (cfg.forgetMode === 'aggressive' && forgets(card).length) {
          // 잊을 카드: 나머지 손에서 가장 값싼 카드 (손에서 낸 카드는 이미 빠져 있다)
          const rest = m.hand.filter(function (_, i) { return i !== idx; });
          let wi = 0;
          rest.forEach(function (id, i) { if (C[id].cost < C[rest[wi]].cost || (C[id].cost === C[rest[wi]].cost && C[id].effects.length < C[rest[wi]].effects.length)) wi = i; });
          if (rest.length) act.pick = [wi];
        }
        eng.act(s, act);
      }
      if (gone()) return;
      // 충전이 찼으면 기술
      if (m.charge >= MD.ability.cost && abilityUseful(s)) {
        const inst = MD.ability.effects.filter(function (e) { return e.op === 'dmg'; }).map(function (e) { return e.n; });
        eng.act(s, { type: 'ability', targets: pickTargets(s, inst), ally: pickAlly(s) });
        if (gone()) return;
      }
      prepAll(s);
      spend(s);
      if (gone()) return;
      eng.act(s, { type: 'endMain' });
    }

    return { takeTurn: takeTurn, get cfg() { return cfg; } };
  }

  return { create: create };
});
