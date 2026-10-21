"use strict";
// Статические правила проекта: страницы, скрипты, адреса, лицензия.
// Проверяем то, что нельзя проверить запуском: «работает и как файл, и на
// GitHub Pages», «нет import/CDN/eval», «внешних адресов ровно два и оба
// разрешены ТЗ части 2».
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT, readProject, hasProject } = require("./helpers");

const PAGES = ["index.html", "builder.html", "stage.html"];
// ТЗ части 2, раздел 3: только чат Twitch и адрес «Светлячков» по умолчанию.
const TWITCH_URL = "wss://irc-ws.chat.twitch.tv:443";
const SVET_URL = "https://andreyshapira1983-sketch.github.io/svetlyachki/index.html";
const ALLOWED_URLS = [TWITCH_URL, SVET_URL];

function projectFiles() {
  const result = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = dir ? dir + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(relative);
      else result.push(relative);
    }
  };
  walk("");
  return result;
}

const JS_FILES = projectFiles().filter(
  (file) => file.startsWith("js/") && file.endsWith(".js")
);

test("static: все файлы проекта на месте", () => {
  for (const file of [
    "index.html",
    "builder.html",
    "stage.html",
    "README.md",
    "LICENSE",
    ".nojekyll",
    "js/config.js",
    "js/chat.js",
    "js/commands.js",
    "js/mask.js",
    "js/colors.js",
    "js/layout.js",
    "js/game.js",
    "js/demo.js",
    "js/render.js",
    "js/main.js",
    "js/builder.js",
    "js/stage.js",
  ]) {
    assert.equal(hasProject(file), true, file);
  }
});

test("static: все скрипты — синтаксически корректные классические файлы", () => {
  assert.ok(JS_FILES.length >= 12, "скриптов должно быть не меньше двенадцати");
  for (const file of JS_FILES) {
    const code = readProject(file);
    assert.doesNotThrow(() => new vm.Script(code, { filename: file }), file);
    assert.equal(/^\s*(import|export)\s/m.test(code), false, "import/export в " + file);
    assert.equal(/\bimport\s*\(/.test(code), false, "динамический import в " + file);
    assert.equal(/\beval\s*\(/.test(code), false, "eval в " + file);
    assert.equal(/\bnew\s+Function\s*\(/.test(code), false, "new Function в " + file);
    assert.match(code, /"use strict"/, "нет use strict: " + file);
    assert.match(code, /global\.SB/, "скрипт не кладёт себя в SB: " + file);
  }
});

test("static: внешних адресов ровно два — чат Twitch и «Светлячки»", () => {
  const urls = [];
  for (const file of JS_FILES.concat(PAGES)) {
    const code = readProject(file);
    const found = code.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi) || [];
    for (const url of found) urls.push({ file, url: url.replace(/[.,;]+$/, "") });
  }
  for (const item of urls) {
    assert.ok(ALLOWED_URLS.includes(item.url), "лишний адрес: " + item.file + " → " + item.url);
  }
  const twitch = urls.filter((item) => item.url === TWITCH_URL);
  assert.equal(twitch.length, 1, "адрес чата должен встречаться ровно один раз");
  assert.equal(twitch[0].file, "js/chat.js");
  const svet = urls.filter((item) => item.url === SVET_URL);
  assert.ok(svet.length >= 1, "нет адреса «Светлячков»");
  for (const item of svet) {
    assert.ok(
      item.file === "js/config.js" || item.file === "stage.html",
      "адрес «Светлячков» может быть только в config.js и stage.html: " + item.file,
    );
  }
  assert.equal(hasProject("stage.html"), true);
  assert.match(readProject("stage.html"), /src="https:\/\/andreyshapira1983-sketch\.github\.io\/svetlyachki\/index\.html"/);
});

test("static: ни одного import, export, CDN и сборщика в страницах", () => {
  for (const page of PAGES) {
    const html = readProject(page);
    assert.equal(/type=["']module["']/.test(html), false, page);
    assert.equal(/\bimport\b|\bexport\b/.test(html), false, page);
    assert.equal(/unpkg\.com|cdn\.|jsdelivr|googleapis/.test(html), false, page);
    assert.equal(/<link[^>]+href=["']https?:/.test(html), false, page);
  }
});

test("static: все скрипты страниц — локальные файлы из js/", () => {
  for (const page of PAGES) {
    const html = readProject(page);
    const sources = Array.from(html.matchAll(/<script([^>]*)>/g)).map((match) => match[1]);
    assert.ok(sources.length >= 2, page);
    for (const attributes of sources) {
      assert.equal(/\bsrc=/.test(attributes), true, "скрипт без src в " + page);
      const match = /src=["']([^"']+)["']/.exec(attributes);
      assert.ok(match, "не разобрали src в " + page);
      const source = match[1];
      assert.equal(source.startsWith("js/"), true, page + ": " + source);
      assert.equal(hasProject(source), true, "нет файла " + source);
    }
  }
});

test("static: index.html подключает все части игры в нужном порядке", () => {
  const html = readProject("index.html");
  const order = [
    "js/config.js",
    "js/chat.js",
    "js/commands.js",
    "js/mask.js",
    "js/colors.js",
    "js/layout.js",
    "js/game.js",
    "js/demo.js",
    "js/render.js",
    "js/main.js",
  ];
  let cursor = -1;
  for (const file of order) {
    const at = html.indexOf('src="' + file + '"');
    assert.ok(at > cursor, "порядок скриптов нарушен: " + file);
    cursor = at;
  }
  assert.equal(html.indexOf("js/main.js"), html.lastIndexOf("js/main.js"));
});

test("static: все js-файлы проекта используются хотя бы одной страницей", () => {
  const used = new Set();
  for (const page of PAGES) {
    const html = readProject(page);
    for (const match of html.matchAll(/src=["']([^"']+)["']/g)) used.add(match[1]);
  }
  for (const file of JS_FILES) {
    assert.equal(used.has(file), true, "скрипт не подключён: " + file);
  }
});

test("static: index.html — прозрачный оверлей для OBS", () => {
  const html = readProject("index.html");
  assert.match(html, /<canvas[^>]+id=["']sea["']/);
  assert.match(html, /background:\s*transparent/);
  assert.match(html, /<meta\s+charset=["']utf-8["']/i);
  assert.equal(/<link[^>]+stylesheet/.test(html), false);
  assert.equal(html.includes("OBS"), true);
});

test("static: ни на одной странице нет meta color-scheme", () => {
  for (const page of PAGES) {
    assert.equal(/color-scheme/i.test(readProject(page)), false, page);
  }
});

test("static: builder.html — конструктор с предпросмотром demo=1", () => {
  const html = readProject("builder.html");
  assert.match(html, /<iframe/i);
  assert.equal(/demo=1/.test(html) || /demo/.test(readProject("js/builder.js")), true);
  assert.match(html, /js\/config\.js/);
  assert.match(html, /js\/builder\.js/);
  assert.match(html, /OBS/);
});

test("static: в builder.html есть все параметры боя из ТЗ части 1", () => {
  const html = readProject("builder.html");
  for (const name of [
    "channel",
    "theme",
    "sea_height",
    "ship_scale",
    "max_ships",
    "join",
    "cooldown",
    "idle_minutes",
    "round_pause",
    "leaderboard",
    "lang",
    "demo",
  ]) {
    assert.equal(html.includes(name), true, name);
  }
});

test("static: в builder.html есть раздел «Вместе со Светлячками»", () => {
  const html = readProject("builder.html");
  const text = html.replace(/\s+/g, " ");
  assert.match(text, /Вместе со Светлячками/);
  for (const marker of ["svet_url", "svet_theme", "svet_backdrop", "battle_idle", "stage.html"]) {
    assert.equal(text.includes(marker), true, marker);
  }
  assert.match(text, /Один источник|один источник/i);
});

test("static: stage.html — две прозрачные рамки и плавное затухание", () => {
  const html = readProject("stage.html");
  assert.match(html, /<iframe[^>]+id=["']svet["']/);
  assert.match(html, /<iframe[^>]+id=["']battle["']/);
  assert.match(html, /background:\s*transparent/);
  assert.match(html, /transition:\s*opacity\s+1\.5s/);
  assert.match(html, /src=["']index\.html["']/);
  for (const file of ["js/config.js", "js/chat.js", "js/commands.js", "js/stage.js"]) {
    assert.match(html, new RegExp('src="' + file.replace(/\./g, "\\.") + '"'), file);
  }
});

test("static: пакетов, сборщиков и node_modules в проекте нет", () => {
  assert.equal(hasProject("package.json"), false);
  assert.equal(hasProject("node_modules"), false);
  assert.equal(hasProject("package-lock.json"), false);
  for (const file of projectFiles()) {
    assert.equal(/\.(ts|jsx|tsx|mjs|cjs|map)$/.test(file), false, file);
  }
});

test("static: LICENSE — MIT, автор Sasha AI, 2026", () => {
  const license = readProject("LICENSE");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Sasha AI/);
  assert.match(license, /Permission is hereby granted/);
});

test("static: .nojekyll есть и пуст — GitHub Pages не соберёт мусор", () => {
  assert.equal(hasProject(".nojekyll"), true);
  assert.equal(readProject(".nojekyll").trim(), "");
});

test("static: README написан по-русски и отвечает на вопросы стримера", () => {
  const readme = readProject("README.md");
  assert.ok(readme.length > 2500, "README слишком короткий");
  for (const word of ["OBS", "!огонь", "!щит", "!ремонт", "channel", "demo", "тест"]) {
    assert.equal(readme.includes(word), true, word);
  }
  assert.match(readme, /чего не умеет/i);
  assert.match(readme, /DeepSeek/);
  assert.match(readme, /Claude/);
});

test("static: README рассказывает про один источник со «Светлячками»", () => {
  const readme = readProject("README.md");
  const text = readme.replace(/\s+/g, " ");
  assert.match(text, /Один источник/);
  assert.match(text, /stage\.html/);
  assert.match(text, /!бой/);
  assert.match(text, /!светлячки/);
  assert.match(text, /battle_idle/);
  assert.match(text, /svet_url/);
});

test("static: демо-ники придуманы, настоящих зрителей в коде нет", () => {
  const demo = readProject("js/demo.js");
  assert.match(demo, /BOTS/);
  for (const real of ["xqc", "pokimane", "ninja", "brunofin", "sasha_ai_stream"]) {
    assert.equal(demo.toLowerCase().includes(real), false, real);
  }
});

test("static: в коде нет отправки сообщений в чат", () => {
  const chat = readProject("js/chat.js");
  assert.equal(/send\s*\(\s*["']PRIVMSG/.test(chat), false);
  assert.equal(/send\s*\(\s*["']\/me/.test(chat), false);
  // И у сцены нет своего сокета: чат читает общий клиент.
  const stage = readProject("js/stage.js");
  assert.equal(/new\s+WebSocket/.test(stage), false);
  assert.equal(/PRIVMSG/.test(stage), false);
});
