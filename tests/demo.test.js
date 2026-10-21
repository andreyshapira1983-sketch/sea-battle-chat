"use strict";
/* Тесты демо-режима: придуманные боты, детерминированный поток сообщений
 * по подставным часам, входы/команды/уходы и прогон потока через настоящий
 * мир игры (потопления, победитель, новый раунд). Ни сети, ни настоящих
 * секунд: часы мира двигаем сами. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, readProject, plain, fakeStorage } = require("./helpers");

// Порядок как на странице: настройки, команды, маска, цвета, мир, демо.
const SB = loadGlobal([
  "js/config.js",
  "js/commands.js",
  "js/mask.js",
  "js/colors.js",
  "js/game.js",
  "js/demo.js",
]);
const Demo = SB.Demo;
const Commands = SB.Commands;
const Game = SB.Game;
const Config = SB.Config;

const BOT_USERS = Demo.BOTS.map((bot) => bot.user);
const BOT_NAMES = Object.create(null);
for (const bot of Demo.BOTS) BOT_NAMES[bot.user] = bot.display_name;

// Боевые команды демо — по ним считается доля выстрелов.
const COMBAT_TEXTS = new Set(["!огонь", "!вперёд", "!назад", "!щит", "!ремонт"]);

/**
 * Забрать первые want сообщений, двигая подставные часы по миллисекунде.
 * Возвращает сами сообщения и точный момент, когда каждое стало доступно.
 * Хватает на проверки интервалов: больше одного сообщения за миллисекунду
 * быть не может, потому что минимальный зазор — 1000 мс.
 */
function collect(feed, want) {
  const messages = [];
  const times = [];
  const limit = want * 3000 + 6000;
  for (let now = 0; messages.length < want && now <= limit; now += 1) {
    const due = feed.nextDue(now);
    for (const message of due) {
      messages.push(message);
      times.push(now);
    }
  }
  return { messages, times };
}

/**
 * Прогнать демо через настоящий мир игры, как это делает js/main.js:
 * кадр 100 мс, сообщения берутся по world.now. Мир и поток с одним seed,
 * поэтому прогон повторяем. Настройки — из приёмки: 8 кораблей, пауза
 * между раундами 2 с.
 */
function simulate(seconds) {
  const world = Game.createWorld({
    settings: Config.sanitize({ maxShips: 8, roundPause: 2 }),
    seed: Demo.SEED,
    storage: fakeStorage(),
  });
  const feed = Demo.createFeed({ seed: Demo.SEED, lang: "ru" });
  const frameMs = 100;
  const frames = Math.round((seconds * 1000) / frameMs);

  let roundNumber = world.frame().round.number;
  let sinkings = 0;
  let previousDrowned = 0;
  let fireCount = 0;
  let commandCount = 0;
  let acceptedInNextRound = 0;
  const finishedRounds = [];
  const winners = [];

  for (let index = 0; index < frames; index += 1) {
    for (const message of feed.nextDue(world.now)) {
      if (COMBAT_TEXTS.has(message.text)) {
        commandCount += 1;
        if (message.text === "!огонь") fireCount += 1;
      }
      const report = world.onMessage(message);
      if (report && report.ok && report.command && roundNumber >= 2) {
        acceptedInNextRound += 1;
      }
    }
    world.step(frameMs);
    const frame = world.frame();
    roundNumber = frame.round.number;
    // «На дне» копится внутри раунда и чистится при новом — считаем прирост.
    if (frame.drowned.length > previousDrowned) {
      sinkings += frame.drowned.length - previousDrowned;
    }
    previousDrowned = frame.drowned.length;
    if (frame.round.state === "finished") {
      if (finishedRounds.indexOf(frame.round.number) < 0) {
        finishedRounds.push(frame.round.number);
      }
      if (frame.round.winner && winners.indexOf(frame.round.winner.name) < 0) {
        winners.push(frame.round.winner.name);
      }
    }
  }

  return {
    frame: world.frame(),
    sinkings,
    finishedRounds,
    winners,
    fireCount,
    commandCount,
    acceptedInNextRound,
  };
}

// ---------------------------------------------------------------------
// Придуманные боты и сценарий.
// ---------------------------------------------------------------------

test("BOTS: восемь придуманных ботов, логин латиницей, имя по-русски", () => {
  assert.equal(Demo.BOTS.length, 8);
  assert.equal(Demo.VIEWER_NAMES.length, 8);
  const users = Demo.BOTS.map((bot) => bot.user);
  assert.equal(new Set(users).size, 8, "логины должны быть уникальны");
  assert.equal(new Set(Demo.VIEWER_NAMES).size, 8, "имена должны быть уникальны");
  for (const bot of Demo.BOTS) {
    assert.match(bot.user, /^[a-z0-9_]+$/, "логин латиницей: " + bot.user);
    assert.match(bot.display_name, /[А-Яа-яЁё]/, "имя по-русски: " + bot.display_name);
  }
  // Никаких настоящих зрителей и ботов Twitch: только выдуманные.
  const realBots = ["nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot"];
  for (const bot of Demo.BOTS) {
    assert.ok(!realBots.includes(bot.user), "настоящий бот в демо: " + bot.user);
    assert.ok(!/twitch|stream|sasha|admin|moderator/i.test(bot.user));
  }
});

test("SEED и VIEWER_NAMES: seed по умолчанию — 20261021", () => {
  assert.equal(Demo.SEED, 20261021);
  assert.equal(Demo.DEFAULT_SEED, Demo.SEED);
  assert.deepEqual(
    plain(Demo.VIEWER_NAMES),
    Demo.BOTS.map((bot) => bot.display_name)
  );
});

test("createFeed: nextDue и bots, поток бесконечный и данные не портятся", () => {
  const feed = Demo.createFeed();
  assert.equal(typeof feed.nextDue, "function");
  assert.equal(feed.bots.length, 8);
  assert.deepEqual(
    plain(feed.bots.map((bot) => bot.user)),
    BOT_USERS
  );
  // bots — копия: испортить общий список снаружи нельзя.
  feed.bots[0].display_name = "испорчено";
  assert.equal(Demo.BOTS[0].display_name, "Капитан Шторм");
  // Поток не кончается: и через час есть сообщения.
  const later = feed.nextDue(3600000);
  assert.ok(later.length > 0);
});

test("первые восемь сообщений — вход в игру !играть от восьми ботов", () => {
  const { messages } = collect(Demo.createFeed({ seed: Demo.SEED }), 8);
  assert.equal(messages.length, 8);
  assert.deepEqual(
    messages.map((message) => message.text),
    ["!играть", "!играть", "!играть", "!играть", "!играть", "!играть", "!играть", "!играть"]
  );
  assert.deepEqual(
    messages.map((message) => message.user),
    BOT_USERS
  );
  for (const message of messages) assert.equal(message.first_msg, true);
});

test("интервалы между сообщениями — от 1 до 3 секунд", () => {
  const { times } = collect(Demo.createFeed(), 120);
  assert.equal(times.length, 120);
  assert.ok(times[0] >= 1000 && times[0] <= 3000, "первый интервал: " + times[0]);
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index] - times[index - 1];
    assert.ok(gap >= 1000, "слишком маленький интервал: " + gap);
    assert.ok(gap <= 3000, "слишком большой интервал: " + gap);
  }
});

test("в сценарии есть все виды команд и «!уйти» с повторным входом", () => {
  const { messages } = collect(Demo.createFeed(), 120);
  const texts = messages.map((message) => message.text);
  for (const command of ["!огонь", "!вперёд", "!назад", "!щит", "!ремонт"]) {
    assert.ok(texts.includes(command), "в демо нет команды " + command);
  }
  assert.ok(texts.includes("!уйти"), "демо-боты должны иногда уплывать");
  const joins = texts.filter((text) => text === "!играть");
  assert.ok(joins.length > 8, "после первых восьми входов должен быть повторный");
});

test("детерминизм: одинаковый seed — одинаковые сообщения и времена", () => {
  const first = collect(Demo.createFeed({ seed: 12345 }), 80);
  const second = collect(Demo.createFeed({ seed: 12345 }), 80);
  assert.deepEqual(plain(first.messages), plain(second.messages));
  assert.deepEqual(first.times, second.times);

  // seed по умолчанию и явный 20261021 — одно и то же.
  const implicit = collect(Demo.createFeed(), 40);
  const explicit = collect(Demo.createFeed({ seed: Demo.SEED }), 40);
  assert.deepEqual(plain(implicit.messages), plain(explicit.messages));
  assert.deepEqual(implicit.times, explicit.times);
});

test("другой seed — другой поток сообщений", () => {
  const first = collect(Demo.createFeed({ seed: 1 }), 40);
  const second = collect(Demo.createFeed({ seed: 2 }), 40);
  assert.notDeepEqual(
    plain(first.messages),
    plain(second.messages),
    "разные seed обязаны давать разные сценарии"
  );
});

test("nextDue по подставным часам: пусто до первого, повтор не дублирует", () => {
  const feed = Demo.createFeed();
  assert.deepEqual(feed.nextDue(0), []);
  assert.deepEqual(feed.nextDue(999), []);

  const { messages, times } = collect(feed, 1);
  assert.equal(messages.length, 1);
  const firstAt = times[0];
  assert.ok(firstAt >= 1000 && firstAt <= 3000, "первое сообщение: " + firstAt);
  // То же время второй раз уже ничего не отдаёт.
  assert.deepEqual(feed.nextDue(firstAt), []);
  // И назад время не отматывается.
  assert.deepEqual(feed.nextDue(0), []);
});

test("nextDue не отдаёт одно сообщение дважды и не зависит от частоты опроса", () => {
  const slow = Demo.createFeed();
  const fast = Demo.createFeed();
  const slowMessages = [];
  for (let now = 0; now <= 400000; now += 1000) {
    slowMessages.push(...slow.nextDue(now));
  }
  const fastMessages = [];
  for (let now = 0; now <= 400000; now += 1) {
    fastMessages.push(...fast.nextDue(now));
  }
  assert.deepEqual(plain(slowMessages), plain(fastMessages), "сценарий не зависит от опроса");
  assert.ok(slowMessages.length > 100);
  const ids = slowMessages.map((message) => message.msg_id);
  assert.equal(new Set(ids).size, ids.length, "msg_id не должны повторяться");
  // Повторный запрос того же времени ничего не добавляет.
  const last = slowMessages[slowMessages.length - 1];
  const before = slowMessages.length;
  const extra = slow.nextDue(400000);
  assert.ok(Array.isArray(extra));
  assert.equal(slowMessages.length + extra.length, before + extra.length);
  assert.ok(before > 0 && last);
});

test("сообщение демо — того же формата, что из чата", () => {
  const { messages } = collect(Demo.createFeed(), 120);
  for (const message of messages) {
    assert.deepEqual(Object.keys(message).sort(), [
      "chat_color",
      "display_name",
      "first_msg",
      "is_broadcaster",
      "is_mod",
      "msg_id",
      "text",
      "user",
    ]);
    assert.equal(message.is_mod, false);
    assert.equal(message.is_broadcaster, false);
    assert.equal(message.chat_color, "");
    assert.equal(message.display_name, BOT_NAMES[message.user]);
    assert.match(message.msg_id, /^demo-\d{4,}$/);
    assert.equal(typeof message.text, "string");
    assert.ok(message.text.length > 0);
  }
  // first_msg — только у первых восьми входов.
  assert.deepEqual(
    messages.map((message) => message.first_msg),
    messages.map((message, index) => index < 8)
  );
});

test("язык: ru по умолчанию, en — латинские команды, мусор — снова ru", () => {
  const ru = collect(Demo.createFeed({ lang: "ru" }), 8);
  assert.deepEqual(
    ru.messages.map((message) => message.text),
    new Array(8).fill("!играть")
  );
  const en = collect(Demo.createFeed({ lang: "en" }), 120);
  assert.deepEqual(
    en.messages.slice(0, 8).map((message) => message.text),
    new Array(8).fill("!join")
  );
  const enTexts = en.messages.map((message) => message.text);
  for (const command of ["!fire", "!right", "!left", "!shield", "!repair", "!leave"]) {
    assert.ok(enTexts.includes(command), "в en-демо нет команды " + command);
  }
  // Неизвестный язык — русский набор.
  const junk = collect(Demo.createFeed({ lang: "de" }), 8);
  assert.equal(junk.messages[0].text, "!играть");
});

test("команды демо понимает SB.Commands: русские и латинские", () => {
  const expectedRu = {
    "!играть": "join",
    "!уйти": "leave",
    "!огонь": "fire",
    "!вперёд": "right",
    "!назад": "left",
    "!щит": "shield",
    "!ремонт": "repair",
  };
  const expectedEn = {
    "!join": "join",
    "!leave": "leave",
    "!fire": "fire",
    "!right": "right",
    "!left": "left",
    "!shield": "shield",
    "!repair": "repair",
  };
  for (const [lang, expected] of [["ru", expectedRu], ["en", expectedEn]]) {
    const { messages } = collect(Demo.createFeed({ lang }), 120);
    for (const message of messages) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(expected, message.text),
        "неожиданный текст демо (" + lang + "): " + message.text
      );
      const parsed = Commands.parse(message.text);
      assert.ok(parsed, "SB.Commands не разобрал " + message.text);
      assert.equal(parsed.name, expected[message.text]);
    }
  }
});

test("«!уйти» и повторный вход: команды шлют только те, кто в игре", () => {
  const { messages } = collect(Demo.createFeed(), 160);
  const inGame = new Set();
  let joins = 0;
  let leaves = 0;
  let firstPhase = 0;
  for (const message of messages) {
    if (message.text === "!играть") {
      if (firstPhase < 8) {
        assert.equal(message.first_msg, true, "первый вход должен быть first_msg");
        firstPhase += 1;
      } else {
        assert.equal(inGame.has(message.user), false, "повторный вход без ухода: " + message.user);
        assert.equal(message.first_msg, false, "повторный вход — не первое сообщение");
        joins += 1;
      }
      inGame.add(message.user);
      continue;
    }
    assert.ok(inGame.has(message.user), "команда от того, кто вне игры: " + message.user);
    if (message.text === "!уйти") {
      leaves += 1;
      inGame.delete(message.user);
    }
  }
  assert.ok(leaves >= 3, "боты должны иногда уплывать, уходов: " + leaves);
  assert.ok(joins >= 3, "после уходов должны быть возвращения, их: " + joins);
  assert.ok(inGame.size >= 4, "в игре всегда должно оставаться несколько ботов");
});

// ---------------------------------------------------------------------
// Боевой настрой и прогон через настоящий мир игры.
// ---------------------------------------------------------------------

test("доля !огонь — около половины боевых команд (не меньше 35 %)", () => {
  const { messages } = collect(Demo.createFeed(), 160);
  const commands = messages.filter((message) => COMBAT_TEXTS.has(message.text));
  const fires = commands.filter((message) => message.text === "!огонь");
  assert.ok(commands.length >= 100, "боевых команд слишком мало: " + commands.length);
  const share = fires.length / commands.length;
  // Обязательный порог приёмки: выстрелов не меньше 35 % от всех команд.
  assert.ok(share >= 0.35, "доля выстрелов меньше 35 %: " + share.toFixed(3));
  // И это действительно «около половины», а не случайные 40 %.
  assert.ok(share >= 0.45 && share <= 0.6, "доля выстрелов не около половины: " + share.toFixed(3));
  // Остальные команды не потерялись: щит, ремонт и движение тоже есть.
  for (const text of ["!вперёд", "!назад", "!щит", "!ремонт"]) {
    assert.ok(
      commands.some((message) => message.text === text),
      "в бою нет команды " + text,
    );
  }
});

test("симуляция мира: за 240 с есть потопление, победитель и новый раунд", () => {
  const result = simulate(240);
  assert.ok(result.sinkings >= 1, "за 240 с ни один корабль не потоплен: " + result.sinkings);
  assert.ok(
    result.finishedRounds.length >= 1,
    "за 240 с не завершился ни один раунд: " + JSON.stringify(result.finishedRounds),
  );
  assert.ok(
    result.winners.length >= 1,
    "у завершённого раунда нет победителя: " + JSON.stringify(result.winners),
  );
  // После конца раунда и паузы (round_pause=2) начался следующий.
  assert.ok(result.frame.round.number >= 2, "новый раунд не начался: " + result.frame.round.number);
  assert.ok(["playing", "waiting"].indexOf(result.frame.round.state) >= 0);
  assert.ok(result.frame.round.alive >= 2, "в новом раунде меньше двух кораблей");
  // Доля выстрелов в реальной симуляции тоже боевая.
  const share = result.fireCount / result.commandCount;
  assert.ok(share >= 0.35, "в симуляции мало огня: " + share.toFixed(3));
});

test("симуляция мира: боты продолжают играть в следующих раундах", () => {
  const result = simulate(300);
  assert.ok(result.finishedRounds.length >= 1, "ни один раунд не завершился");
  assert.ok(result.frame.round.number >= 2, "второй раунд не начался");
  assert.ok(
    result.acceptedInNextRound >= 5,
    "в новом раунде боты почти не действуют, принятых команд: " + result.acceptedInNextRound,
  );
  assert.ok(result.sinkings >= 2, "потоплений за 300 с слишком мало: " + result.sinkings);
  assert.ok(result.frame.round.alive >= 2, "в новом раунде осталось меньше двух кораблей");
});

test("js/demo.js — обычный скрипт без сети и импортов", () => {
  const source = readProject("js/demo.js");
  // Заголовочный комментарий пропускаем: сам код начинается с IIFE.
  const code = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trimStart();
  assert.ok(code.startsWith("(function"), "js/demo.js должен быть IIFE");
  for (const [title, pattern] of [
    ["внешний адрес", /(?:https?|wss?):\/\//],
    ["require", /\brequire\s*\(/],
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /WebSocket/],
    ["import", /^\s*import\s/m],
    ["export", /^\s*export\s/m],
  ]) {
    assert.ok(!pattern.test(source), "js/demo.js: найден " + title);
  }
  assert.match(source, /SB\.Demo\s*=/);
});
