"use strict";
// Настройки игры: разбор ссылки, пределы, сборка ссылки обратно.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, plain } = require("./helpers");

const SB = loadGlobal(["js/config.js"]);
const Config = SB.Config;

test("config: пустая ссылка даёт полный набор значений по умолчанию", () => {
  const settings = Config.parseSearch("");
  assert.deepEqual(plain(settings), plain(Config.DEFAULT_SETTINGS));
});

test("config: настройки по умолчанию заморожены и полны", () => {
  assert.equal(Object.isFrozen(Config.DEFAULT_SETTINGS), true);
  assert.deepEqual(Object.keys(Config.DEFAULT_SETTINGS).sort(), [
    "channel",
    "cooldown",
    "demo",
    "idleMinutes",
    "join",
    "lang",
    "leaderboard",
    "maxShips",
    "roundPause",
    "seaHeight",
    "shipScale",
    "theme",
  ]);
});

test("config: значения по умолчанию из ТЗ", () => {
  assert.equal(Config.DEFAULT_SETTINGS.theme, "sea");
  assert.equal(Config.DEFAULT_SETTINGS.seaHeight, 30);
  assert.equal(Config.DEFAULT_SETTINGS.shipScale, 1);
  assert.equal(Config.DEFAULT_SETTINGS.maxShips, 30);
  assert.equal(Config.DEFAULT_SETTINGS.join, "chat");
  assert.equal(Config.DEFAULT_SETTINGS.cooldown, 6);
  assert.equal(Config.DEFAULT_SETTINGS.idleMinutes, 5);
  assert.equal(Config.DEFAULT_SETTINGS.roundPause, 10);
  assert.equal(Config.DEFAULT_SETTINGS.leaderboard, true);
  assert.equal(Config.DEFAULT_SETTINGS.lang, "ru");
  assert.equal(Config.DEFAULT_SETTINGS.demo, false);
  assert.equal(Config.DEFAULT_SETTINGS.channel, "");
});

test("config: канал принимает имя, @, # и ссылку twitch", () => {
  assert.equal(Config.normalizeChannel("SomeNick"), "somenick");
  assert.equal(Config.normalizeChannel("@SomeNick"), "somenick");
  assert.equal(Config.normalizeChannel("#SomeNick"), "somenick");
  assert.equal(Config.normalizeChannel("twitch.tv/SomeNick"), "somenick");
  assert.equal(Config.normalizeChannel("https://www.twitch.tv/some_nick?sr=a"), "some_nick");
  assert.equal(Config.normalizeChannel("https://twitch.tv/some_nick/videos"), "some_nick");
});

test("config: плохой канал не ломает вид", () => {
  assert.equal(Config.normalizeChannel(""), "");
  assert.equal(Config.normalizeChannel("канал с пробелами"), "");
  assert.equal(Config.normalizeChannel("ник-через-дефис"), "");
  assert.equal(Config.normalizeChannel(null), "");
  assert.equal(Config.parseSearch("?channel=!!!").channel, "");
});

test("config: тема sea и none, мусор — море", () => {
  assert.equal(Config.parseSearch("?theme=none").theme, "none");
  assert.equal(Config.parseSearch("?theme=sea").theme, "sea");
  assert.equal(Config.parseSearch("?theme=море").theme, "sea");
  assert.equal(Config.parseSearch("?theme=space").theme, "sea");
});

test("config: высота моря — проценты 15–60, 0.5 значит 50 %", () => {
  assert.equal(Config.parseSearch("?sea_height=45").seaHeight, 45);
  assert.equal(Config.parseSearch("?sea_height=0.5").seaHeight, 50);
  assert.equal(Config.parseSearch("?sea_height=0,45").seaHeight, 45);
  assert.equal(Config.parseSearch("?sea_height=15").seaHeight, 15);
  assert.equal(Config.parseSearch("?sea_height=60").seaHeight, 60);
  assert.equal(Config.parseSearch("?sea_height=10").seaHeight, 30);
  assert.equal(Config.parseSearch("?sea_height=80").seaHeight, 30);
  assert.equal(Config.parseSearch("?sea_height=abc").seaHeight, 30);
});

test("config: размер кораблей 0.6–2", () => {
  assert.equal(Config.parseSearch("?ship_scale=1.5").shipScale, 1.5);
  assert.equal(Config.parseSearch("?ship_scale=0.6").shipScale, 0.6);
  assert.equal(Config.parseSearch("?ship_scale=2").shipScale, 2);
  assert.equal(Config.parseSearch("?ship_scale=0.2").shipScale, 1);
  assert.equal(Config.parseSearch("?ship_scale=5").shipScale, 1);
});

test("config: лимит кораблей 5–60 целыми числами", () => {
  assert.equal(Config.parseSearch("?max_ships=10").maxShips, 10);
  assert.equal(Config.parseSearch("?max_ships=5").maxShips, 5);
  assert.equal(Config.parseSearch("?max_ships=60").maxShips, 60);
  assert.equal(Config.parseSearch("?max_ships=4").maxShips, 30);
  assert.equal(Config.parseSearch("?max_ships=61").maxShips, 30);
  assert.equal(Config.parseSearch("?max_ships=30.7").maxShips, 31);
});

test("config: вход только по !играть — join=command", () => {
  assert.equal(Config.parseSearch("?join=command").join, "command");
  assert.equal(Config.parseSearch("?join=chat").join, "chat");
  assert.equal(Config.parseSearch("?join=команда").join, "command");
  assert.equal(Config.parseSearch("?join=что-то").join, "chat");
});

test("config: пауза команд 2–30 секунд", () => {
  assert.equal(Config.parseSearch("?cooldown=3").cooldown, 3);
  assert.equal(Config.parseSearch("?cooldown=30").cooldown, 30);
  assert.equal(Config.parseSearch("?cooldown=1").cooldown, 6);
  assert.equal(Config.parseSearch("?cooldown=31").cooldown, 6);
  assert.equal(Config.parseSearch("?cooldown=7,5").cooldown, 7.5);
});

test("config: неактивность и пауза раунда ограничены разумно", () => {
  assert.equal(Config.parseSearch("?idle_minutes=15").idleMinutes, 15);
  assert.equal(Config.parseSearch("?idle_minutes=0").idleMinutes, 5);
  assert.equal(Config.parseSearch("?idle_minutes=999").idleMinutes, 5);
  assert.equal(Config.parseSearch("?round_pause=20").roundPause, 20);
  assert.equal(Config.parseSearch("?round_pause=0").roundPause, 10);
  assert.equal(Config.parseSearch("?round_pause=999").roundPause, 10);
});

test("config: флаги понимают да/нет, вкл/выкл, 1/0", () => {
  assert.equal(Config.parseSearch("?leaderboard=0").leaderboard, false);
  assert.equal(Config.parseSearch("?leaderboard=нет").leaderboard, false);
  assert.equal(Config.parseSearch("?leaderboard=1").leaderboard, true);
  assert.equal(Config.parseSearch("?leaderboard=мусор").leaderboard, true);
  assert.equal(Config.parseSearch("?demo=1").demo, true);
  assert.equal(Config.parseSearch("?demo=да").demo, true);
  assert.equal(Config.parseSearch("?demo=0").demo, false);
  assert.equal(Config.parseSearch("?demo=").demo, false);
});

test("config: язык ru/en, мусор — русский", () => {
  assert.equal(Config.parseSearch("?lang=en").lang, "en");
  assert.equal(Config.parseSearch("?lang=ru").lang, "ru");
  assert.equal(Config.parseSearch("?lang=de").lang, "ru");
});

test("config: демо и предпросмотр конструктора включаются параметром", () => {
  assert.equal(Config.parseSearch("?demo=1").demo, true);
  assert.equal(Config.parseSearch("?demo=1&theme=none").theme, "none");
});

test("config: полный адрес разбирается так же, как строка запроса", () => {
  const settings = Config.parseUrl("https://example.github.io/sea/index.html?demo=1&max_ships=12");
  assert.equal(settings.demo, true);
  assert.equal(settings.maxShips, 12);
  assert.equal(Config.parseUrl("index.html").demo, false);
});

test("config: stripQuery убирает запрос и якорь", () => {
  assert.equal(Config.stripQuery("index.html?demo=1#x"), "index.html");
  assert.equal(Config.stripQuery("https://a/b/index.html?x=1"), "https://a/b/index.html");
  assert.equal(Config.stripQuery(""), "");
});

test("config: ссылка по умолчанию короткая — без мусора", () => {
  assert.equal(Config.buildSearch({}), "");
  assert.equal(Config.buildUrl("index.html", {}), "index.html");
  assert.equal(Config.buildUrl("index.html?старое=1", {}), "index.html");
});

test("config: ссылка собирается из изменённых значений", () => {
  const search = Config.buildSearch({ theme: "none", seaHeight: 45, demo: true, leaderboard: false });
  assert.match(search, /theme=none/);
  assert.match(search, /sea_height=45/);
  assert.match(search, /demo=1/);
  assert.match(search, /leaderboard=0/);
  assert.equal(search.includes("lang=ru"), false);
  assert.equal(search.includes("max_ships"), false);
});

test("config: ссылка ⇄ настройки ходят туда и обратно", () => {
  const settings = {
    channel: "Streamer_1",
    theme: "none",
    seaHeight: 55,
    shipScale: 1.3,
    maxShips: 12,
    join: "command",
    cooldown: 8,
    idleMinutes: 9,
    roundPause: 15,
    leaderboard: false,
    lang: "en",
    demo: true,
  };
  const url = Config.buildUrl("https://x/y/index.html", settings);
  assert.match(url, /^https:\/\/x\/y\/index\.html\?/);
  assert.deepEqual(plain(Config.parseUrl(url)), plain(Config.sanitize(settings)));
});

test("config: sanitize принимает строки формы конструктора", () => {
  const settings = Config.sanitize({
    channel: "twitch.tv/Streamer",
    theme: "none",
    seaHeight: "0.5",
    shipScale: "1,5",
    maxShips: "20",
    join: "command",
    cooldown: "10",
    idleMinutes: "7",
    roundPause: "12",
    leaderboard: "0",
    lang: "en",
    demo: "1",
  });
  assert.equal(settings.channel, "streamer");
  assert.equal(settings.theme, "none");
  assert.equal(settings.seaHeight, 50);
  assert.equal(settings.shipScale, 1.5);
  assert.equal(settings.maxShips, 20);
  assert.equal(settings.join, "command");
  assert.equal(settings.cooldown, 10);
  assert.equal(settings.idleMinutes, 7);
  assert.equal(settings.roundPause, 12);
  assert.equal(settings.leaderboard, false);
  assert.equal(settings.lang, "en");
  assert.equal(settings.demo, true);
});

test("config: sanitize заменяет мусор умолчаниями", () => {
  const settings = Config.sanitize({
    channel: "???",
    theme: "space",
    seaHeight: -5,
    shipScale: null,
    maxShips: "много",
    join: "сам",
    cooldown: 0,
    idleMinutes: 0,
    roundPause: 0,
    leaderboard: "может",
    lang: "klingon",
    demo: "иногда",
  });
  assert.deepEqual(plain(settings), plain(Config.DEFAULT_SETTINGS));
  assert.deepEqual(plain(Config.sanitize(null)), plain(Config.DEFAULT_SETTINGS));
});

test("config: boolValue понимает слова и не понимает мусор", () => {
  assert.equal(Config.boolValue(true), true);
  assert.equal(Config.boolValue(false), false);
  assert.equal(Config.boolValue(1), true);
  assert.equal(Config.boolValue(0), false);
  assert.equal(Config.boolValue(" ON "), true);
  assert.equal(Config.boolValue("off"), false);
  assert.equal(Config.boolValue("наверное"), null);
  assert.equal(Config.boolValue(""), null);
});

test("config: числовые разборщики возвращают null на мусоре", () => {
  assert.equal(Config.seaHeightValue("30"), 30);
  assert.equal(Config.seaHeightValue(0.3), 30);
  assert.equal(Config.seaHeightValue("много"), null);
  assert.equal(Config.shipScaleValue("0.6"), 0.6);
  assert.equal(Config.maxShipsValue(60), 60);
  assert.equal(Config.cooldownValue(2), 2);
  assert.equal(Config.idleMinutesValue(180), 180);
  assert.equal(Config.roundPauseValue(120), 120);
});

test("config: summary коротко описывает настройки", () => {
  const text = Config.summary({ channel: "streamer", theme: "none", demo: true, lang: "en", leaderboard: false });
  assert.match(text, /streamer/);
  assert.match(text, /тем/);
  assert.match(text, /демо/);
  assert.match(text, /английский/);
  assert.match(text, /без таблицы/);
});

test("config: splitSearch разбирает параметры, формы и пустые значения", () => {
  const params = Config.splitSearch("?a=1&b=%D0%B4%D0%B0&c&d=");
  assert.equal(params.a, "1");
  assert.equal(params.b, "да");
  assert.equal(params.c, "");
  assert.equal(params.d, "");
  assert.deepEqual(plain(Config.splitSearch("")), {});
  assert.equal(Config.splitSearch("?x=1#якорь").x, "1");
});

// ------------------------------------------------------------------
// Общая сцена stage.html (часть 2)
// ------------------------------------------------------------------
test("config: у сцены свои умолчания — автозапуск, 3 минуты, «Светлячки» по умолчанию", () => {
  assert.equal(Config.STAGE_DEFAULTS.auto, true);
  assert.equal(Config.STAGE_DEFAULTS.battleIdle, 3);
  assert.equal(Config.STAGE_DEFAULTS.svetUrl, Config.SVET_DEFAULT_URL);
  assert.equal(Config.STAGE_DEFAULTS.svetTheme, "");
  assert.equal(Config.STAGE_DEFAULTS.svetBackdrop, 0);
  assert.match(Config.SVET_DEFAULT_URL, /^https:\/\/andreyshapira1983-sketch\.github\.io\/svetlyachki\/index\.html$/);
});

test("config: пустая ссылка сцены даёт умолчания боя и сцены", () => {
  const parsed = Config.parseStageSearch("");
  assert.deepEqual(plain(parsed.battle), plain(Config.DEFAULT_SETTINGS));
  assert.deepEqual(plain(parsed.stage), plain(Config.STAGE_DEFAULTS));
});

test("config: auto=0 и battle_idle разбираются", () => {
  const parsed = Config.parseStageSearch("?auto=0&battle_idle=7");
  assert.equal(parsed.stage.auto, false);
  assert.equal(parsed.stage.battleIdle, 7);
  assert.equal(Config.parseStageSearch("?auto=1").stage.auto, true);
  assert.equal(Config.parseStageSearch("?battle_idle=500").stage.battleIdle, 3);
  assert.equal(Config.parseStageSearch("?battle_idle=0").stage.battleIdle, 3);
});

test("config: настройки боя и сцены живут в одной ссылке", () => {
  const parsed = Config.parseStageSearch("?channel=Streamer&theme=none&max_ships=12&auto=0&battle_idle=5");
  assert.equal(parsed.battle.channel, "streamer");
  assert.equal(parsed.battle.theme, "none");
  assert.equal(parsed.battle.maxShips, 12);
  assert.equal(parsed.stage.auto, false);
  assert.equal(parsed.stage.battleIdle, 5);
});

test("config: тема и подложка «Светлячков»", () => {
  assert.equal(Config.parseStageSearch("?svet_theme=space").stage.svetTheme, "space");
  assert.equal(Config.parseStageSearch("?svet_theme=космос").stage.svetTheme, "space");
  assert.equal(Config.parseStageSearch("?svet_theme=чужое").stage.svetTheme, "");
  assert.equal(Config.parseStageSearch("?svet_backdrop=40").stage.svetBackdrop, 40);
  assert.equal(Config.parseStageSearch("?svet_backdrop=0.4").stage.svetBackdrop, 40);
  assert.equal(Config.parseStageSearch("?svet_backdrop=999").stage.svetBackdrop, 0);
});

test("config: своя ссылка «Светлячков» сохраняется как есть, мусор — умолчание", () => {
  const custom = "https://example.com/svet/index.html?theme=space&channel=test";
  const parsed = Config.parseStageSearch("?svet_url=" + encodeURIComponent(custom));
  assert.equal(parsed.stage.svetUrl, custom);
  assert.equal(
    Config.parseStageSearch("?svet_url=javascript:alert(1)").stage.svetUrl,
    Config.SVET_DEFAULT_URL
  );
  assert.equal(Config.sanitizeStage({ svetUrl: "  " }).svetUrl, Config.SVET_DEFAULT_URL);
});

test("config: ссылка «Светлячков» по умолчанию получает канал и вид", () => {
  const url = Config.buildSvetUrl(
    { svetTheme: "space", svetBackdrop: 40 },
    { channel: "Streamer" }
  );
  assert.match(url, /^https:\/\/andreyshapira1983-sketch\.github\.io\/svetlyachki\/index\.html\?/);
  assert.match(url, /channel=streamer/);
  assert.match(url, /theme=space/);
  assert.match(url, /backdrop=40/);
  assert.equal(Config.buildSvetUrl({}, {}), Config.SVET_DEFAULT_URL);
});

test("config: в демо без канала «Светлячки» тоже получают demo=1", () => {
  assert.match(Config.buildSvetUrl({}, { demo: true }), /\?demo=1$/);
  assert.doesNotMatch(Config.buildSvetUrl({}, { demo: true, channel: "streamer" }), /demo=/);
  assert.doesNotMatch(Config.buildSvetUrl({}, {}), /demo=/);
});

test("config: готовая чужая ссылка «Светлячков» не переписывается", () => {
  const custom = "https://example.com/svet/index.html?channel=other&theme=city";
  assert.equal(Config.buildSvetUrl({ svetUrl: custom }, { channel: "streamer" }), custom);
});

test("config: ссылка stage собирается и разбирается обратно", () => {
  const battle = { channel: "streamer", theme: "none", demo: true };
  const stage = { auto: false, battleIdle: 7, svetTheme: "space", svetBackdrop: 30 };
  const url = Config.buildStageUrl("stage.html", battle, stage);
  assert.match(url, /^stage\.html\?/);
  assert.match(url, /channel=streamer/);
  assert.match(url, /auto=0/);
  assert.match(url, /battle_idle=7/);
  assert.match(url, /svet_theme=space/);
  assert.match(url, /svet_backdrop=30/);
  const back = Config.parseStageSearch(url);
  assert.equal(back.battle.channel, "streamer");
  assert.equal(back.stage.auto, false);
  assert.equal(back.stage.battleIdle, 7);
  assert.equal(back.stage.svetTheme, "space");
  assert.equal(back.stage.svetBackdrop, 30);
});

test("config: умолчания сцены в ссылку не пишутся", () => {
  const url = Config.buildStageUrl("stage.html", { channel: "streamer" }, {});
  assert.equal(url, "stage.html?channel=streamer");
});

test("config: stageSummary описывает сцену по-русски", () => {
  const text = Config.stageSummary({ channel: "streamer" }, { auto: false, battleIdle: 5 });
  assert.match(text, /streamer/);
  assert.match(text, /только по !бой/);
  assert.match(text, /5 мин/);
  assert.match(text, /Светлячки/);
});
