#!/usr/bin/env node
/* 엔진 + 데이터 + UI + CSS를 한 개의 HTML 파일로 합친다. 외부 파일·네트워크 불필요 (오프라인 실행 가능).
 *   node build.js  →  dist/ashgate.html
 */
const fs = require('fs'), path = require('path');
const r = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14110f">
<title>재의 문</title>
<style>
${r('ui.css')}
</style></head>
<body><div id="app"></div>
<script>
${r('engine.js')}
</script>
<script>
${r('data.js')}
</script>
<script>
${r('bot.js')}
</script>
<script>
${r('ui.js')}
</script></body></html>`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'ashgate.html'), html);
console.log('빌드 완료: dist/ashgate.html (' + (html.length / 1024).toFixed(1) + ' KB)');
