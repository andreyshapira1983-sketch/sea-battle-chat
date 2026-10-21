"use strict";
// Проверки конструктора «Морского боя чата»: чистые функции ссылки,
// разбор значений формы и статическая разметка builder.html.
//
// DOM здесь не нужен: интерфейс строится только в браузере, а в Node
// проверяются значения формы, ссылки и сама страница как текст.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, readProject, plain } = require("./helpers");

// Порядок как на странице: настройки, потом конструктор.
const SB = loadGlobal(["js/config.js", "js/builder.js"]);
const C = SB.Config;
const B = SB.Builder;

// Адрес на GitHub Pages (только данные для теста, не запрос в сеть).
const PAGES_BASE = "https://streamer.github.io/sea-battle-chat/";

// ------------------------------------------------------------------
// Помощники тестов
// ------------------------------------------------------------------
function searchOf(url) {
  const question = url.indexOf("?");
  return new URLSearchParams(question < 0 ? "" : url.slice(question + 1));
}

/** Тег <input> с заданным id (или null, если его нет). */
function inputTag(html, id) {
  const pattern = new RegExp('<input\\b[^>]*\\bid="' + id + '"[^>]*>', "i");
  const match = html.match(pattern);
  return match ? match[0] : null;
}

/** Адреса локальных скриптов в порядке подключения. */
function scriptsOf(html) {
  const list = [];
  const pattern = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) list.push(match[1]);
  return list;
}

/** Все значения формы с «нестандартными» настройками. */
function formValues(overrides) {
  return Object.assign(
    {
      channel: "https://twitch.tv/Some_Streamer",
      theme: "none",
      seaHeight: "45",
      shipScale: "1.4",
      maxShips: "12",
      join: "command",
      cooldown: "9",
      idleMinutes: "7",
      roundPause: "20",
      leaderboard: false,
      lang: "en",
      demo: true,
    },
    overrides || {},
  );
}

const PARAMS = [
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
];

// ------------------------------------------------------------------
// Чистые функции конструктора
// ------------------------------------------------------------------
test("SB.Builder отдаёт функции для формы, ссылок и предпросмотра", () => {
  assert.equal(typeof B.init, "function");
  assert.equal(typeof B.defaultValues, "function");
  assert.equal(typeof B.valuesToSettings, "function");
  assert.equal(typeof B.previewSettings, "function");
  assert.equal(typeof B.buildPreviewUrl, "function");
  assert.equal(typeof B.buildObsUrl, "function");
  assert.equal(typeof B.summary, "function");
  assert.ok(Array.isArray(B.STEPS));
  assert.equal(B.PAGE, "index.html");
  assert.equal(typeof B.PREVIEW_DELAY, "number");
});

test("defaultValues повторяет умолчания SB.Config, числа — строками", () => {
  const values = B.defaultValues();
  const defaults = C.DEFAULT_SETTINGS;
  assert.equal(values.channel, defaults.channel);
  assert.equal(values.theme, defaults.theme);
  assert.equal(values.seaHeight, String(defaults.seaHeight));
  assert.equal(values.shipScale, String(defaults.shipScale));
  assert.equal(values.maxShips, String(defaults.maxShips));
  assert.equal(values.join, defaults.join);
  assert.equal(values.cooldown, String(defaults.cooldown));
  assert.equal(values.idleMinutes, String(defaults.idleMinutes));
  assert.equal(values.roundPause, String(defaults.roundPause));
  assert.equal(values.leaderboard, defaults.leaderboard);
  assert.equal(values.lang, defaults.lang);
  assert.equal(values.demo, defaults.demo);
  // Форма присылает числа строками — так и храним в значениях по умолчанию.
  ["seaHeight", "shipScale", "maxShips", "cooldown", "idleMinutes", "roundPause"]
    .forEach(function (key) {
      assert.equal(typeof values[key], "string", "ключ " + key + " должен быть строкой");
    });
});

test("valuesToSettings(defaultValues()) — полный набор умолчаний", () => {
  assert.deepStrictEqual(
    plain(B.valuesToSettings(B.defaultValues())),
    plain(C.DEFAULT_SETTINGS),
  );
});

test("valuesToSettings переводит строки формы в числа и перечисления", () => {
  const settings = B.valuesToSettings(
    formValues({ channel: "Some_Streamer", leaderboard: true, demo: false }),
  );
  assert.equal(settings.channel, "some_streamer");
  assert.equal(settings.theme, "none");
  assert.equal(settings.seaHeight, 45);
  assert.equal(settings.shipScale, 1.4);
  assert.equal(settings.maxShips, 12);
  assert.equal(settings.join, "command");
  assert.equal(settings.cooldown, 9);
  assert.equal(settings.idleMinutes, 7);
  assert.equal(settings.roundPause, 20);
  assert.equal(settings.leaderboard, true);
  assert.equal(settings.lang, "en");
  assert.equal(settings.demo, false);
});

test("valuesToSettings понимает чекбоксы и строковые флаги", () => {
  assert.equal(B.valuesToSettings({ leaderboard: false }).leaderboard, false);
  assert.equal(B.valuesToSettings({ leaderboard: true }).leaderboard, true);
  assert.equal(B.valuesToSettings({ leaderboard: "off" }).leaderboard, false);
  assert.equal(B.valuesToSettings({ leaderboard: "вкл" }).leaderboard, true);
  assert.equal(B.valuesToSettings({ demo: false }).demo, false);
  assert.equal(B.valuesToSettings({ demo: "on" }).demo, true);
  // Без поля — умолчание.
  assert.equal(B.valuesToSettings({}).leaderboard, true);
  assert.equal(B.valuesToSettings({}).demo, false);
});

test("valuesToSettings приводит канал из имени, @, # и ссылки", () => {
  assert.equal(B.valuesToSettings({ channel: "Some_Streamer" }).channel, "some_streamer");
  assert.equal(B.valuesToSettings({ channel: "@Some_Streamer" }).channel, "some_streamer");
  assert.equal(B.valuesToSettings({ channel: "#Some_Streamer" }).channel, "some_streamer");
  assert.equal(
    B.valuesToSettings({ channel: "https://twitch.tv/Some_Streamer" }).channel,
    "some_streamer",
  );
  assert.equal(
    B.valuesToSettings({ channel: "twitch.tv/Some_Streamer?sr=a" }).channel,
    "some_streamer",
  );
  assert.equal(B.valuesToSettings({ channel: "Имя" }).channel, "");
  assert.equal(B.valuesToSettings({ channel: "" }).channel, "");
});

test("valuesToSettings заменяет мусор и пустые поля умолчаниями", () => {
  const garbage = B.valuesToSettings({
    channel: "Имя",
    theme: "космос",
    seaHeight: "abc",
    shipScale: "5",
    maxShips: "999",
    join: "может быть",
    cooldown: "0",
    idleMinutes: "",
    roundPause: "999",
    leaderboard: "непонятно",
    lang: "de",
    demo: "непонятно",
  });
  assert.deepStrictEqual(plain(garbage), plain(C.DEFAULT_SETTINGS));

  assert.deepStrictEqual(plain(B.valuesToSettings(null)), plain(C.DEFAULT_SETTINGS));
  assert.deepStrictEqual(plain(B.valuesToSettings(undefined)), plain(C.DEFAULT_SETTINGS));
  assert.deepStrictEqual(plain(B.valuesToSettings("строка")), plain(C.DEFAULT_SETTINGS));
});

test("valuesToSettings принимает границы пределов из ТЗ", () => {
  const low = B.valuesToSettings({
    seaHeight: "15",
    shipScale: "0.6",
    maxShips: "5",
    cooldown: "2",
    idleMinutes: "1",
    roundPause: "1",
  });
  assert.equal(low.seaHeight, 15);
  assert.equal(low.shipScale, 0.6);
  assert.equal(low.maxShips, 5);
  assert.equal(low.cooldown, 2);
  assert.equal(low.idleMinutes, 1);
  assert.equal(low.roundPause, 1);

  const high = B.valuesToSettings({
    seaHeight: "60",
    shipScale: "2",
    maxShips: "60",
    cooldown: "30",
    idleMinutes: "180",
    roundPause: "120",
  });
  assert.equal(high.seaHeight, 60);
  assert.equal(high.shipScale, 2);
  assert.equal(high.maxShips, 60);
  assert.equal(high.cooldown, 30);
  assert.equal(high.idleMinutes, 180);
  assert.equal(high.roundPause, 120);

  // Дробные значения и русская запятая тоже принимаются.
  assert.equal(B.valuesToSettings({ shipScale: "1,25" }).shipScale, 1.25);
  assert.equal(B.valuesToSettings({ cooldown: "2,5" }).cooldown, 2.5);
});

// ------------------------------------------------------------------
// Ссылка для OBS
// ------------------------------------------------------------------
test("значения по умолчанию не пишутся в ссылку для OBS", () => {
  assert.equal(B.buildObsUrl(B.defaultValues()), "index.html");
  assert.equal(B.buildObsUrl(B.valuesToSettings({})), "index.html");
  assert.equal(B.buildObsUrl({}), "index.html");
  assert.doesNotMatch(B.buildObsUrl(B.defaultValues()), /\?/);
});

test("все поля формы доходят до ссылки для OBS", () => {
  const settings = B.valuesToSettings(formValues());
  const url = B.buildObsUrl(settings);
  assert.ok(url.startsWith("index.html?"), "ссылка должна быть на index.html");
  const params = searchOf(url);
  assert.equal(params.get("channel"), "some_streamer");
  assert.equal(params.get("theme"), "none");
  assert.equal(params.get("sea_height"), "45");
  assert.equal(params.get("ship_scale"), "1.4");
  assert.equal(params.get("max_ships"), "12");
  assert.equal(params.get("join"), "command");
  assert.equal(params.get("cooldown"), "9");
  assert.equal(params.get("idle_minutes"), "7");
  assert.equal(params.get("round_pause"), "20");
  assert.equal(params.get("leaderboard"), "0");
  assert.equal(params.get("lang"), "en");
  assert.equal(params.get("demo"), "1");
  // Ровно двенадцать параметров — ни одного лишнего.
  assert.deepStrictEqual(Array.from(params.keys()).sort(), PARAMS.slice().sort());
});

test("buildObsUrl без базы — относительный index.html без demo", () => {
  const settings = B.valuesToSettings({ channel: "Streamer" });
  const url = B.buildObsUrl(settings);
  assert.equal(url, "index.html?channel=streamer");
  assert.equal(searchOf(url).get("demo"), null);
});

test("buildObsUrl с базой-папкой ставит index.html", () => {
  const settings = B.valuesToSettings({ channel: "Streamer" });
  assert.equal(
    B.buildObsUrl(settings, PAGES_BASE),
    PAGES_BASE + "index.html?channel=streamer",
  );
});

test("buildObsUrl с адресом страницы не дублирует путь", () => {
  const settings = B.valuesToSettings({ channel: "Streamer" });
  assert.equal(
    B.buildObsUrl(
      settings,
      "https://streamer.github.io/sea-battle-chat/index.html?x=1#top",
    ),
    "https://streamer.github.io/sea-battle-chat/index.html?channel=streamer",
  );
});

test("buildObsUrl берёт index.html рядом с builder.html", () => {
  // Ссылку копируют из конструктора — она должна указывать на страницу
  // игры рядом с ним, а не на сам конструктор.
  const settings = B.valuesToSettings({ channel: "Streamer" });
  assert.equal(
    B.buildObsUrl(settings, "https://streamer.github.io/sea-battle-chat/builder.html"),
    "https://streamer.github.io/sea-battle-chat/index.html?channel=streamer",
  );
  // Локальный файл тоже: рядом с конструктором лежит index.html.
  assert.equal(
    B.buildObsUrl(settings, "file:///C:/sea-battle-chat/builder.html?x=1#y"),
    "file:///C:/sea-battle-chat/index.html?channel=streamer",
  );
});

// ------------------------------------------------------------------
// Предпросмотр
// ------------------------------------------------------------------
test("buildPreviewUrl всегда включает demo=1", () => {
  const settings = B.valuesToSettings({ demo: false, channel: "Streamer" });
  const url = B.buildPreviewUrl(settings);
  const params = searchOf(url);
  assert.equal(params.get("demo"), "1");
  assert.equal(params.get("channel"), null);
  assert.equal(url.startsWith("index.html?"), true);

  // Даже если демо выключено в форме, предпросмотр остаётся с ботами.
  assert.equal(searchOf(B.buildPreviewUrl({ demo: false })).get("demo"), "1");
});

test("buildPreviewUrl по умолчанию — просто demo=1", () => {
  assert.equal(B.buildPreviewUrl(B.defaultValues()), "index.html?demo=1");
  assert.equal(B.buildPreviewUrl({}), "index.html?demo=1");
  assert.equal(B.buildPreviewUrl(B.valuesToSettings({})), "index.html?demo=1");
});

test("buildPreviewUrl сохраняет остальные настройки, но убирает канал", () => {
  const settings = B.valuesToSettings(
    formValues({ channel: "Streamer", leaderboard: false }),
  );
  const params = searchOf(B.buildPreviewUrl(settings));
  assert.equal(params.get("channel"), null);
  assert.equal(params.get("theme"), "none");
  assert.equal(params.get("sea_height"), "45");
  assert.equal(params.get("ship_scale"), "1.4");
  assert.equal(params.get("max_ships"), "12");
  assert.equal(params.get("join"), "command");
  assert.equal(params.get("cooldown"), "9");
  assert.equal(params.get("idle_minutes"), "7");
  assert.equal(params.get("round_pause"), "20");
  assert.equal(params.get("leaderboard"), "0");
  assert.equal(params.get("lang"), "en");
  assert.equal(params.get("demo"), "1");
});

// ------------------------------------------------------------------
// Разбор ссылки назад
// ------------------------------------------------------------------
test("туда и обратно: значения формы → ссылка → parseUrl", () => {
  const variants = [
    B.defaultValues(),
    formValues(),
    B.valuesToSettings({
      channel: "@Some_Streamer",
      theme: "none",
      seaHeight: "60",
      shipScale: "2",
      maxShips: "60",
      join: "command",
      cooldown: "30",
      idleMinutes: "180",
      roundPause: "120",
      leaderboard: false,
      lang: "en",
      demo: false,
    }),
  ];
  variants.forEach(function (values) {
    const settings = B.valuesToSettings(values);
    const parsed = C.parseUrl(B.buildObsUrl(settings));
    assert.deepStrictEqual(plain(parsed), plain(settings));
  });
  // И обратно: ссылка для предпросмотра разбирается с demo=true.
  const preview = C.parseUrl(B.buildPreviewUrl(formValues()));
  assert.equal(preview.demo, true);
  assert.equal(preview.channel, "");
});

// ------------------------------------------------------------------
// Краткое описание настроек
// ------------------------------------------------------------------
test("summary содержит ключевые слова и учитывает флаги", () => {
  const text = B.summary(
    B.valuesToSettings({ channel: "Streamer", leaderboard: false, demo: true }),
  );
  [
    "канал streamer",
    "тема «море»",
    "море 30%",
    "корабл",
    "вход: любое сообщение",
    "без таблицы",
    "русский",
    "демо",
  ].forEach(function (word) {
    assert.ok(text.includes(word), "в описании нет «" + word + "»: " + text);
  });

  const defaults = B.summary(B.defaultValues());
  assert.equal(defaults.includes("демо"), false);
  assert.equal(defaults.includes("без таблицы"), false);
});

// ------------------------------------------------------------------
// DOM-часть без DOM
// ------------------------------------------------------------------
test("init в Node без DOM не падает и возвращает null", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(B.init(), null);
  assert.equal(B.init(null), null);
  assert.equal(B.init({}), null);
});

// ------------------------------------------------------------------
// Статическая разметка builder.html
// ------------------------------------------------------------------
test("builder.html: доктайп, iframe с demo=1 и только локальные скрипты", () => {
  const html = readProject("builder.html");
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<style>/);

  assert.deepStrictEqual(scriptsOf(html), ["js/config.js", "js/builder.js"]);

  const frames = html.match(/<iframe\b[^>]*>/gi) || [];
  assert.equal(frames.length, 1, "в конструкторе ровно один iframe предпросмотра");
  assert.match(frames[0], /id="preview"/);
  assert.match(frames[0], /src="index\.html\?demo=1"/);
});

test("builder.html: нет color-scheme, внешних адресов и модулей", () => {
  const html = readProject("builder.html");
  const js = readProject("js/builder.js");

  // Иначе Chrome подкладывает под iframe непрозрачный фон и предпросмотр
  // становится белым — ошибка из раздела 8 ТЗ.
  assert.doesNotMatch(html, /color-scheme/i);

  assert.doesNotMatch(html, /\b(?:https?|wss?):\/\//i);
  assert.doesNotMatch(js, /\b(?:https?|wss?):\/\//i);
  [html, js].forEach(function (source) {
    assert.doesNotMatch(source, /\bimport\b/);
    assert.doesNotMatch(source, /\bexport\b/);
    assert.doesNotMatch(source, /\beval\b/);
    assert.doesNotMatch(source, /type="module"/i);
  });

  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /url\(/i);
  assert.doesNotMatch(html, /@import/i);
});

test("builder.html: есть все имена параметров из раздела 5 ТЗ", () => {
  const html = readProject("builder.html");
  PARAMS.forEach(function (name) {
    assert.ok(
      html.includes('name="' + name + '"'),
      "нет поля с именем параметра name=\"" + name + "\"",
    );
  });
});

test("builder.html: у ползунков правильные пределы и шаг", () => {
  const html = readProject("builder.html");
  const ranges = [
    ["seaHeight", 15, 60, 1, 30],
    ["shipScale", 0.6, 2, 0.1, 1],
    ["maxShips", 5, 60, 1, 30],
    ["cooldown", 2, 30, 1, 6],
    ["idleMinutes", 1, 180, 1, 5],
    ["roundPause", 1, 120, 1, 10],
  ];
  ranges.forEach(function (range) {
    const id = range[0];
    const tag = inputTag(html, id);
    assert.ok(tag, "нет ползунка id=" + id);
    assert.match(tag, /type="range"/);
    assert.ok(tag.includes('min="' + range[1] + '"'), "min у " + id);
    assert.ok(tag.includes('max="' + range[2] + '"'), "max у " + id);
    assert.ok(tag.includes('step="' + range[3] + '"'), "step у " + id);
    assert.ok(tag.includes('value="' + range[4] + '"'), "value у " + id);
  });
});

test("builder.html: живой предпросмотр 16:9 на шахматке", () => {
  const html = readProject("builder.html");
  assert.match(html, /aspect-ratio:\s*16\s*\/\s*9/);
  // Шахматка — фон контейнера; iframe прозрачный.
  assert.match(html, /background-image:/);
  assert.match(html, /background-size:\s*22px\s+22px/);
  assert.match(html, /\.preview-frame iframe\s*\{[^}]*background:\s*transparent/i);
});

test("builder.html: есть ссылка для OBS, копирование и описание", () => {
  const html = readProject("builder.html");
  const ids = [
    "builder",
    "channel",
    "themeChoices",
    "seaHeight",
    "shipScale",
    "maxShips",
    "joinChoices",
    "cooldown",
    "idleMinutes",
    "roundPause",
    "leaderboard",
    "langChoices",
    "demo",
    "preview",
    "previewFrame",
    "obsLink",
    "copyLink",
    "openLink",
    "copyStatus",
    "summaryText",
    "steps",
  ];
  ids.forEach(function (id) {
    assert.ok(html.includes('id="' + id + '"'), "нет элемента id=" + id);
  });

  const link = inputTag(html, "obsLink");
  assert.ok(link, "нет поля готовой ссылки");
  assert.match(link, /readonly/);

  assert.match(html, />Скопировать</);
  assert.match(html, />Открыть</);
  assert.match(html, /id="summaryText"/);
  assert.match(html, /«Лучшие капитаны»/);
  assert.match(html, /только !играть/);
});

test("js/builder.js берёт ссылки и описание из SB.Config", () => {
  const js = readProject("js/builder.js");
  assert.match(js, /SB\.Builder\s*=/);
  assert.match(js, /Config\.buildUrl\(/);
  assert.match(js, /Config\.sanitize\(/);
  assert.match(js, /Config\.summary\(/);
  assert.match(js, /Config\.DEFAULT_SETTINGS/);
  assert.match(js, /Config\.stripQuery\(/);
  // Копирование: современное API и запасной путь без падения.
  assert.match(js, /navigator\.clipboard/);
  assert.match(js, /writeText\(/);
  assert.match(js, /execCommand\("copy"\)/);
  assert.match(js, /try\s*\{/);
  // Запуск страницы и защита от отсутствия DOM.
  assert.match(js, /typeof document/);
  assert.match(js, /getElementById\("builder"\)/);
  assert.match(js, /addEventListener\("input"/);
  assert.match(js, /addEventListener\("change"/);
});

// ------------------------------------------------------------------
// Часть 2: общая сцена «Светлячки + Морской бой» (stage.html)
// ------------------------------------------------------------------
const STAGE_PARAMS = ["svet_url", "svet_theme", "svet_backdrop", "auto", "battle_idle"];

function stageFormValues(overrides) {
  return Object.assign(
    {
      stageEnabled: true,
      svetUrl: "",
      svetTheme: "space",
      svetBackdrop: "40",
      auto: false,
      battleIdle: "7",
    },
    overrides || {},
  );
}

function stageDefaults() {
  return {
    auto: true,
    battleIdle: 3,
    svetUrl: C.SVET_DEFAULT_URL,
    svetTheme: "",
    svetBackdrop: 0,
  };
}

test("SB.Builder отдаёт функции общей сцены", () => {
  [
    "defaultStageValues",
    "stageValuesToSettings",
    "isStageOn",
    "buildStageUrl",
    "buildStagePreviewUrl",
    "previewUrlFor",
    "stageSummary",
    "collect",
    "collectStage",
    "collectAll",
  ].forEach(function (name) {
    assert.equal(typeof B[name], "function", "нет функции " + name);
  });
  assert.equal(B.STAGE_PAGE, "stage.html");
});

test("defaultStageValues — умолчания сцены в виде значений формы", () => {
  const values = B.defaultStageValues();
  assert.equal(values.stageEnabled, false);
  assert.equal(values.svetUrl, "");
  assert.equal(values.svetTheme, "");
  assert.equal(values.svetBackdrop, "0");
  assert.equal(values.auto, true);
  assert.equal(values.battleIdle, "3");
  // Числа — строками, как их отдаёт DOM.
  assert.equal(typeof values.svetBackdrop, "string");
  assert.equal(typeof values.battleIdle, "string");
});

test("stageValuesToSettings(defaultStageValues()) — умолчания STAGE_DEFAULTS", () => {
  assert.deepStrictEqual(
    plain(B.stageValuesToSettings(B.defaultStageValues())),
    stageDefaults(),
  );
  assert.deepStrictEqual(plain(B.stageValuesToSettings(null)), stageDefaults());
  assert.deepStrictEqual(plain(B.stageValuesToSettings({})), stageDefaults());
});

test("stageValuesToSettings переводит строки формы и готовую ссылку", () => {
  const custom = "https://example.com/svetlyachki/index.html?theme=city";
  const stage = B.stageValuesToSettings(
    stageFormValues({ svetUrl: custom, auto: "off" }),
  );
  assert.equal(stage.auto, false);
  assert.equal(stage.battleIdle, 7);
  assert.equal(stage.svetTheme, "space");
  assert.equal(stage.svetBackdrop, 40);
  assert.equal(stage.svetUrl, custom);
  // Тема принимается и по-русски, как в их конструкторе.
  assert.equal(B.stageValuesToSettings({ svetTheme: "город" }).svetTheme, "city");
  assert.equal(B.stageValuesToSettings({ svetTheme: "космос" }).svetTheme, "space");
});

test("stageValuesToSettings заменяет мусор умолчаниями", () => {
  const garbage = B.stageValuesToSettings({
    auto: "непонятно",
    battleIdle: "999",
    svetUrl: "ftp://example.com/svet",
    svetTheme: "луна",
    svetBackdrop: "999",
  });
  assert.deepStrictEqual(plain(garbage), stageDefaults());

  // Границы пределов принимаются.
  const low = B.stageValuesToSettings({ battleIdle: "1", svetBackdrop: "0" });
  assert.equal(low.battleIdle, 1);
  assert.equal(low.svetBackdrop, 0);
  const high = B.stageValuesToSettings({ battleIdle: "120", svetBackdrop: "80" });
  assert.equal(high.battleIdle, 120);
  assert.equal(high.svetBackdrop, 80);
});

test("buildStageUrl пишет параметры боя и сцены в stage.html", () => {
  const values = Object.assign(formValues({ demo: false }), stageFormValues());
  const url = B.buildStageUrl(values);
  assert.ok(url.startsWith("stage.html?"), url);
  const params = searchOf(url);
  assert.equal(params.get("channel"), "some_streamer");
  assert.equal(params.get("theme"), "none");
  assert.equal(params.get("sea_height"), "45");
  assert.equal(params.get("demo"), null);
  assert.equal(params.get("auto"), "0");
  assert.equal(params.get("battle_idle"), "7");
  assert.equal(params.get("svet_theme"), "space");
  assert.equal(params.get("svet_backdrop"), "40");
  // Пустая ссылка «Светлячков» — адрес по умолчанию, в ссылку не пишется.
  assert.equal(params.get("svet_url"), null);
});

test("buildStageUrl по умолчанию — просто stage.html", () => {
  assert.equal(B.buildStageUrl({}), "stage.html");
  assert.equal(B.buildStageUrl(B.defaultStageValues()), "stage.html");
  assert.equal(
    B.buildStageUrl(B.valuesToSettings({}), B.stageValuesToSettings({})),
    "stage.html",
  );
  assert.doesNotMatch(B.buildStageUrl({}), /\?/);
});

test("svet_url вложен как есть и не теряется", () => {
  const custom = "https://example.com/svetlyachki/index.html?theme=city&backdrop=40";
  const url = B.buildStageUrl(stageFormValues({ svetUrl: custom }));
  // Ссылка закодирована ровно один раз и попадает в параметр целиком.
  assert.ok(url.includes("svet_url=" + encodeURIComponent(custom)), url);
  const parsed = C.parseStageSearch(url);
  assert.equal(parsed.stage.svetUrl, custom);
  // Готовая чужая ссылка уходит в iframe «Светлячков» без изменений.
  assert.equal(C.buildSvetUrl(parsed.stage, parsed.battle), custom);
  // И не теряется при повторном переводе настроек в значения.
  assert.equal(B.stageValuesToSettings(parsed.stage).svetUrl, custom);
});

test("buildStageUrl принимает пару (бой, сцена)", () => {
  const battle = B.valuesToSettings({ channel: "Streamer", theme: "none" });
  const stage = B.stageValuesToSettings({
    auto: false,
    battleIdle: "9",
    svetTheme: "city",
  });
  const pairUrl = B.buildStageUrl(battle, stage);
  const singleUrl = B.buildStageUrl({
    channel: "Streamer",
    theme: "none",
    stageEnabled: true,
    auto: false,
    battleIdle: "9",
    svetTheme: "city",
  });
  assert.equal(pairUrl, singleUrl);
  const parsed = C.parseStageSearch(pairUrl);
  assert.equal(parsed.stage.auto, false);
  assert.equal(parsed.stage.battleIdle, 9);
  assert.equal(parsed.stage.svetTheme, "city");
});

test("buildStagePreviewUrl всегда stage.html?demo=1 и без канала", () => {
  const values = Object.assign(formValues({ demo: false }), stageFormValues());
  const url = B.buildStagePreviewUrl(values);
  assert.ok(url.startsWith("stage.html?"), url);
  const params = searchOf(url);
  assert.equal(params.get("demo"), "1");
  assert.equal(params.get("channel"), null);
  assert.equal(params.get("theme"), "none");
  assert.equal(params.get("svet_theme"), "space");
  // Демо включено, даже если в форме оно выключено.
  assert.equal(
    searchOf(B.buildStagePreviewUrl({ demo: false, stageEnabled: true })).get("demo"),
    "1",
  );
});

test("previewUrlFor переключает предпросмотр по галочке", () => {
  const stageUrl = B.previewUrlFor(stageFormValues({ stageEnabled: true }));
  assert.ok(stageUrl.startsWith("stage.html?"), stageUrl);
  assert.equal(searchOf(stageUrl).get("demo"), "1");

  const battleUrl = B.previewUrlFor({ stageEnabled: false, theme: "none" });
  assert.ok(battleUrl.startsWith("index.html?"), battleUrl);
  assert.equal(searchOf(battleUrl).get("demo"), "1");
  assert.equal(searchOf(battleUrl).get("theme"), "none");

  // Поля сцены без галочки на предпросмотр боя не влияют.
  assert.equal(
    B.previewUrlFor({ stageEnabled: false, svetTheme: "space", battleIdle: "7" }),
    "index.html?demo=1",
  );
});

test("stageSummary описывает автозапуск, возврат и «Светлячков»", () => {
  const on = B.stageSummary({ auto: true, battleIdle: 3 });
  assert.ok(on.includes("море 30%"), on);
  assert.ok(on.includes("бой сам включается по команде"), on);
  assert.ok(on.includes("возврат через 3 мин"), on);
  assert.ok(on.includes("Светлячки по умолчанию"), on);

  const off = B.stageSummary({ auto: false, battleIdle: "12" });
  assert.ok(off.includes("только по !бой"), off);
  assert.ok(off.includes("возврат через 12 мин"), off);

  const custom = B.stageSummary({
    svetUrl: "https://example.com/svet/index.html",
    svetTheme: "space",
  });
  assert.ok(custom.includes("свои Светлячки"), custom);

  // Пара (бой, сцена) даёт то же описание, что и общий набор значений.
  const battle = B.valuesToSettings({ channel: "Streamer", theme: "none" });
  const stage = B.stageValuesToSettings({ battleIdle: "12", auto: false });
  assert.equal(
    B.stageSummary(battle, stage),
    B.stageSummary({
      channel: "Streamer",
      theme: "none",
      battleIdle: "12",
      auto: false,
    }),
  );
});

test("туда и обратно: stage-ссылка → parseStageSearch", () => {
  const custom = "https://example.com/svet/index.html?x=1";
  const variants = [
    B.defaultStageValues(),
    Object.assign(formValues({ demo: false }), stageFormValues({ svetUrl: custom })),
    Object.assign(
      formValues({ channel: "@Some_Streamer", demo: false }),
      stageFormValues({
        svetTheme: "none",
        svetBackdrop: "80",
        auto: true,
        battleIdle: "120",
      }),
    ),
  ];
  variants.forEach(function (values) {
    const url = B.buildStageUrl(values);
    const parsed = C.parseStageSearch(url);
    assert.deepStrictEqual(plain(parsed.battle), plain(B.valuesToSettings(values)));
    assert.deepStrictEqual(plain(parsed.stage), plain(B.stageValuesToSettings(values)));
  });
});

test("builder.html: раздел «Вместе со Светлячками» и поля сцены", () => {
  const html = readProject("builder.html");
  assert.match(html, /Вместе со Светлячками/);
  assert.match(html, /Один источник: Светлячки \+ Морской бой/);
  assert.match(html, /ОДИН источник/);
  assert.ok(html.includes("stage.html"), "нет ссылки на stage.html");

  [
    "stageEnabled",
    "stageFields",
    "svetUrl",
    "svetTheme",
    "svetBackdrop",
    "svetBackdropValue",
    "auto",
    "autoHint",
    "battleIdle",
    "battleIdleValue",
    "stageLink",
    "stageCopy",
    "stageOpen",
    "stageStatus",
    "stageSummaryText",
    "previewNote",
  ].forEach(function (id) {
    assert.ok(html.includes('id="' + id + '"'), "нет элемента id=" + id);
  });

  STAGE_PARAMS.forEach(function (name) {
    assert.ok(html.includes('name="' + name + '"'), "нет поля name=" + name);
  });

  // Темы «Светлячков» — те же, что понимает их конструктор.
  ["city", "meadow", "space", "none"].forEach(function (theme) {
    assert.ok(html.includes('value="' + theme + '"'), "нет темы " + theme);
  });

  const backdrop = inputTag(html, "svetBackdrop");
  assert.match(backdrop, /type="range"/);
  assert.match(backdrop, /min="0"/);
  assert.match(backdrop, /max="80"/);
  assert.match(backdrop, /step="10"/);
  assert.match(backdrop, /value="0"/);

  const idle = inputTag(html, "battleIdle");
  assert.match(idle, /type="range"/);
  assert.match(idle, /min="1"/);
  assert.match(idle, /max="120"/);
  assert.match(idle, /step="1"/);
  assert.match(idle, /value="3"/);
});

test("builder.html: у сцены нет внешних адресов и color-scheme", () => {
  const html = readProject("builder.html");
  const js = readProject("js/builder.js");
  assert.match(js, /stage\.html/);
  [html, js].forEach(function (source) {
    assert.doesNotMatch(source, /color-scheme/i);
    assert.doesNotMatch(source, /\b(?:https?|wss?):\/\//i);
    assert.doesNotMatch(source, /\bimport\b/);
    assert.doesNotMatch(source, /\bexport\b/);
    assert.doesNotMatch(source, /\beval\b/);
  });
  // Скрипты прежние: код общей сцены подключает уже stage.html.
  assert.deepStrictEqual(scriptsOf(html), ["js/config.js", "js/builder.js"]);
});

test("js/builder.js собирает сцену через SB.Config", () => {
  const js = readProject("js/builder.js");
  assert.match(js, /Config\.sanitizeStage\(/);
  assert.match(js, /Config\.buildStageUrl\(/);
  assert.match(js, /Config\.stageSummary\(/);
  assert.match(js, /Config\.STAGE_DEFAULTS/);
  assert.match(js, /collectStage\(/);
  assert.match(js, /previewUrlFor\(/);
  assert.match(js, /stageEnabled/);
});
