# 재의 문 (Ashgate)

다크 판타지 협력 덱빌딩 (1~4인 + AI). 엔진/데이터/UI 분리, 상태는 순수 JSON.

- `engine.js` 규칙 · `data.js` 카드/지기/적 · `bot.js` 봇 · `sim.js` 승률 측정 · `lint.js` 데이터 점검
- `node lint.js` / `node test.js` / `node test_v3.js` / `node sim.js --each`
- UI(`ui.js`, `ui.css`, `build.js`)는 옛 구조 — 4단계에서 재연결 예정
- 설계 문서는 Claude 프로젝트 문서(`ashgate-*.md`)에 있음
