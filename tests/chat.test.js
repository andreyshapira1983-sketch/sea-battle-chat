"use strict";
/* Тесты чтения чата Twitch: разбор IRC, анонимность сокета, живость связи.
 *
 * Настоящей сети здесь нет и быть не может: WebSocket, часы и таймеры
 * поддельные, поэтому тесты не ждут ни одной реальной секунды.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, readProject } = require("./helpers");

const SB = loadGlobal(["js/chat.js"]);
const Chat = SB.Chat;

const PRIVMSG =
  "@badges=;color=#FF69B4;display-name=Луна;first-msg=1;id=abc-123;" +
  "mod=0 :luna_kot!luna_kot@luna_kot.tmi.twitch.tv PRIVMSG #test_channel :привет мир";

/** Собрать строку PRIVMSG с нужными тегами и текстом. */
function privmsg(tags, text, nick) {
  const user = nick || "luna_kot";
  return (
    "@" +
    tags +
    " :" +
    user +
    "!" +
    user +
    "@" +
    user +
    ".tmi.twitch.tv PRIVMSG #test_channel :" +
    text
  );
}

/** Поддельные часы и таймеры: время идёт только по команде теста. */
class FakeTimers {
  constructor() {
    this.current = 0;
    this.tasks = [];
    this.nextId = 1;
  }

  now() {
    return this.current;
  }

  setTimeout(fn, ms) {
    const id = this.nextId;
    this.nextId += 1;
    const delay = Math.max(0, Math.floor(Number(ms) || 0));
    this.tasks.push({ id, at: this.current + delay, fn });
    return id;
  }

  clearTimeout(id) {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  }

  get pending() {
    return this.tasks.length;
  }

  /** Продвинуть время и выполнить всё, что наступило, по порядку. */
  advance(ms) {
    const target = this.current + ms;
    let guard = 0;
    for (;;) {
      let next = null;
      for (const task of this.tasks) {
        if (task.at > target) continue;
        if (
          next === null ||
          task.at < next.at ||
          (task.at === next.at && task.id < next.id)
        ) {
          next = task;
        }
      }
      if (!next) break;
      guard += 1;
      if (guard > 10000) {
        throw new Error("слишком много таймеров — похоже на бесконечный цикл");
      }
      this.tasks = this.tasks.filter((task) => task !== next);
      this.current = Math.max(this.current, next.at);
      next.fn();
    }
    this.current = target;
  }
}

/** Поддельный WebSocket: записывает отправленное и даёт тесту роль сервера. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._closeFired = false;
  }

  send(data) {
    this.sent.push(String(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this._fireClose();
  }

  _fireClose() {
    if (this._closeFired) return;
    this._closeFired = true;
    if (typeof this.onclose === "function") this.onclose({ type: "close" });
  }

  /** Тест: сервер открыл соединение. */
  open() {
    this.readyState = 1;
    if (typeof this.onopen === "function") this.onopen({ type: "open" });
  }

  /** Тест: сервер прислал пачку строк. */
  receive(text) {
    if (typeof this.onmessage === "function") this.onmessage({ data: text });
  }

  /** Тест: сервер закрыл соединение сам. */
  serverClose() {
    this.readyState = 3;
    this._fireClose();
  }

  /** Тест: ошибка сокета. */
  fail() {
    if (typeof this.onerror === "function") this.onerror({ type: "error" });
  }

  /** Отправленные строки без CRLF — так их удобнее сравнивать. */
  lines() {
    return this.sent.map((line) => line.replace(/\r\n$/, ""));
  }
}

/** Собрать клиент на поддельных сокетах, часах и таймерах. */
function makeHarness(options) {
  const settings = options || {};
  const timers = new FakeTimers();
  const sockets = [];
  const statuses = [];
  const messages = [];

  class Socket extends FakeSocket {
    constructor(url) {
      super(url);
      sockets.push(this);
    }
  }

  const client = new Chat.Client({
    channel: settings.channel !== undefined ? settings.channel : "Test_Channel",
    // Явно переданный null значит «в среде нет WebSocket».
    WebSocketClass: Object.prototype.hasOwnProperty.call(settings, "WebSocketClass")
      ? settings.WebSocketClass
      : Socket,
    now: () => timers.now(),
    setTimeoutFn: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeoutFn: (id) => timers.clearTimeout(id),
    rng: () => 0.5,
    onStatus: (status, info) => statuses.push({ status, info }),
    onMessage: (message) => messages.push(message),
  });

  return { client, timers, sockets, statuses, messages, Socket };
}

// ---------------------------------------------------------------------
// Чистые функции разбора IRC.
// ---------------------------------------------------------------------

test("константы чата: адрес Twitch, таймауты живости и список ботов", () => {
  assert.equal(Chat.DEFAULT_URL, "wss://irc-ws.chat.twitch.tv:443");
  assert.equal(Chat.IDLE_PING_MS, 240000);
  assert.equal(Chat.PING_REPLY_MS, 60000);
  for (const bot of ["nightbot", "streamelements", "streamlabs", "moobot", "fossabot"]) {
    assert.ok(Chat.BOT_USERS.includes(bot), "в списке ботов нет " + bot);
  }
});

test("retryDelay: 1, 2, 4, 8, 16, 30 и потолок 30 секунд", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(Chat.retryDelay), [
    1, 2, 4, 8, 16, 30, 30, 30, 30,
  ]);
  // Мусор и числа меньше единицы ведут себя как первая попытка.
  assert.equal(Chat.retryDelay(0), 1);
  assert.equal(Chat.retryDelay(-5), 1);
  assert.equal(Chat.retryDelay(100), 30);
  assert.equal(Chat.retryDelay(NaN), 1);
});

test("теги: \\s, \\:, \\\\, \\r и \\n раскрываются", () => {
  assert.equal(Chat.unescapeTag("Test\\sUser"), "Test User");
  assert.equal(Chat.unescapeTag("a\\:b"), "a;b");
  assert.equal(Chat.unescapeTag("back\\\\slash"), "back\\slash");
  assert.equal(Chat.unescapeTag("строка\\r\\n"), "строка\r\n");
  // Неизвестное экранирование не теряет символ.
  assert.equal(Chat.unescapeTag("\\x"), "x");
  assert.equal(Chat.unescapeTag("просто текст"), "просто текст");
});

test("parseTags собирает словарь и не спотыкается о пустые куски", () => {
  const tags = Chat.parseTags("display-name=Test\\sUser;badges=;id=42;;без-значения;=пусто");
  assert.equal(tags["display-name"], "Test User");
  assert.equal(tags.badges, "");
  assert.equal(tags.id, "42");
  assert.equal(tags["без-значения"], "");
  assert.equal(Object.prototype.hasOwnProperty.call(tags, ""), false);
  assert.deepEqual(Chat.parseTags(""), {});
});

test("splitLine разбирает теги, префикс, ник, команду, параметры и текст", () => {
  const parsed = Chat.splitLine(
    "@badges=;color=#ff0 :luna_kot!luna_kot@luna_kot.tmi.twitch.tv PRIVMSG #test_channel :привет мир"
  );
  assert.deepEqual(parsed.tags, { badges: "", color: "#ff0" });
  assert.equal(parsed.prefix, "luna_kot!luna_kot@luna_kot.tmi.twitch.tv");
  assert.equal(parsed.nick, "luna_kot");
  assert.equal(parsed.command, "PRIVMSG");
  assert.deepEqual(parsed.params, ["#test_channel"]);
  assert.equal(parsed.text, "привет мир");
});

test("splitLine: CRLF, двоеточие в тексте и строка без тегов и префикса", () => {
  const parsed = Chat.splitLine("PRIVMSG #test_channel :время: 23:59, ещё не сплю\r\n");
  assert.equal(parsed.command, "PRIVMSG");
  assert.deepEqual(parsed.params, ["#test_channel"]);
  assert.equal(parsed.text, "время: 23:59, ещё не сплю");

  const ping = Chat.splitLine("PING tmi.twitch.tv\r\n");
  assert.equal(ping.command, "PING");
  assert.deepEqual(ping.params, ["tmi.twitch.tv"]);
  assert.equal(ping.text, "");
  assert.equal(ping.prefix, "");
  assert.equal(ping.nick, "");
  assert.deepEqual(ping.tags, {});
});

test("handleLine: служебные строки дают {reply:null, message:null}", () => {
  const lines = [
    ":luna_kot!luna_kot@luna_kot.tmi.twitch.tv JOIN #test_channel",
    ":tmi.twitch.tv 353 justinfan55555555 = #test_channel :luna_kot кот",
    ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands",
    "@msg-id=resub :tmi.twitch.tv USERNOTICE #test_channel :подписка",
    "",
  ];
  for (const line of lines) {
    assert.deepEqual(Chat.handleLine(line), { reply: null, message: null });
  }
});

test("PING получает PONG с тем же хвостом, без хвоста — валидный PONG", () => {
  assert.deepEqual(Chat.handleLine("PING :tmi.twitch.tv"), {
    reply: "PONG :tmi.twitch.tv",
    message: null,
  });
  assert.equal(Chat.handleLine("PING tmi.twitch.tv").reply, "PONG :tmi.twitch.tv");
  const bare = Chat.handleLine("PING").reply;
  assert.match(bare, /^PONG :\S+$/);
  assert.equal(bare, "PONG :tmi.twitch.tv");
});

test("PRIVMSG превращается в сообщение ровно с полями договора", () => {
  const result = Chat.handleLine(PRIVMSG);
  assert.equal(result.reply, null);
  const message = result.message;
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
  assert.equal(message.user, "luna_kot");
  assert.equal(message.display_name, "Луна");
  assert.equal(message.text, "привет мир");
  assert.equal(message.msg_id, "abc-123");
  assert.equal(message.chat_color, "#FF69B4");
  assert.equal(message.first_msg, true);
  assert.equal(message.is_mod, false);
  assert.equal(message.is_broadcaster, false);
});

test("first-msg=1 отмечает первое сообщение зрителя", () => {
  assert.equal(Chat.handleLine(privmsg("first-msg=1;id=1", "первый раз")).message.first_msg, true);
  assert.equal(Chat.handleLine(privmsg("first-msg=0;id=2", "уже был")).message.first_msg, false);
  assert.equal(Chat.handleLine(privmsg("id=3", "без тега")).message.first_msg, false);
});

test("роли: mod=1, значок moderator, значок broadcaster и обычный зритель", () => {
  const byFlag = Chat.handleLine(privmsg("badges=;mod=1;id=3", "тихо")).message;
  assert.equal(byFlag.is_mod, true);
  assert.equal(byFlag.is_broadcaster, false);

  const byBadge = Chat.handleLine(privmsg("badges=moderator/1,subscriber/3;id=2", "тихо")).message;
  assert.equal(byBadge.is_mod, true);
  assert.equal(byBadge.is_broadcaster, false);

  const host = Chat.handleLine(privmsg("badges=broadcaster/1;id=1", "привет")).message;
  assert.equal(host.is_broadcaster, true);
  assert.equal(host.is_mod, false);

  const plain = Chat.handleLine(privmsg("badges=;id=4", "я просто смотрю")).message;
  assert.equal(plain.is_mod, false);
  assert.equal(plain.is_broadcaster, false);
});

test("display-name и цвет ника: тег главнее, пустой — откат на логин", () => {
  const colored = Chat.handleLine(privmsg("color=#1E90FF;display-name=Луна", "привет")).message;
  assert.equal(colored.chat_color, "#1E90FF");
  assert.equal(Chat.handleLine(privmsg("id=1", "без цвета")).message.chat_color, "");
  assert.equal(
    Chat.handleLine(privmsg("id=1;display-name=", "пустое имя")).message.display_name,
    "luna_kot"
  );
  assert.equal(
    Chat.handleLine(privmsg("id=1;display-name=Луна", "имя")).message.display_name,
    "Луна"
  );
});

test("/me: служебная обёртка ACTION снимается, текст остаётся обычным", () => {
  const message = Chat.handleLine(
    privmsg("display-name=Луна", "\u0001ACTION машет рукой\u0001")
  ).message;
  assert.equal(message.text, "машет рукой");
  assert.equal(message.display_name, "Луна");
  assert.equal(Chat.ACTION_PREFIX, "\u0001ACTION ");
  assert.equal(Chat.splitAction("\u0001ACTION привет\u0001").action, true);
  assert.equal(Chat.splitAction("просто текст").action, false);
});

test("parseEmotes: диапазоны, повтор, сортировка, кириллица и мусор", () => {
  assert.deepEqual(Chat.parseEmotes("25:7-15", "привет TwitchLit"), [
    { id: "25", start: 7, end: 15 },
  ]);
  assert.deepEqual(
    Chat.parseEmotes("354:19-27/25:0-4,13-17", "Kappa привет Kappa TwitchLit"),
    [
      { id: "25", start: 0, end: 4 },
      { id: "25", start: 13, end: 17 },
      { id: "354", start: 19, end: 27 },
    ]
  );
  // Позиции считаются по кодовым точкам: эмодзи — один символ.
  const text = "😀 привет TwitchLit";
  const chars = Array.from(text);
  const start = chars.indexOf("T");
  const emotes = Chat.parseEmotes("25:" + start + "-" + (start + 8), text);
  assert.equal(emotes.length, 1);
  assert.equal(chars.slice(emotes[0].start, emotes[0].end + 1).join(""), "TwitchLit");
  // Диапазоны за текстом и мусор отбрасываются.
  assert.deepEqual(Chat.parseEmotes("25:0-99", "коротко"), []);
  assert.deepEqual(Chat.parseEmotes("25:abc-5,25:3,25:5-3", "Kappa"), []);
  assert.deepEqual(Chat.parseEmotes("", "Kappa"), []);
});

test("hasBadge узнаёт значок по имени и не путает с похожим", () => {
  assert.equal(Chat.hasBadge("moderator/1,subscriber/3", "moderator"), true);
  assert.equal(Chat.hasBadge("moderator/1", "mod"), false);
  assert.equal(Chat.hasBadge("broadcaster/1", "broadcaster"), true);
  assert.equal(Chat.hasBadge("", "moderator"), false);
  assert.equal(Chat.hasBadge(undefined, "moderator"), false);
});

test("не PRIVMSG и PRIVMSG без ника не дают сообщения", () => {
  assert.equal(Chat.messageFromParsed(Chat.splitLine("PING :x")), null);
  assert.equal(
    Chat.messageFromParsed({ command: "PRIVMSG", nick: "", tags: {}, text: "x" }),
    null
  );
  assert.equal(Chat.messageFromParsed(null), null);
});

test("канал нормализуется, а анонимный ник — justinfan и восемь цифр", () => {
  assert.equal(Chat.normalizeChannel("#My_Channel"), "my_channel");
  assert.equal(Chat.normalizeChannel("  Test  "), "test");
  assert.equal(Chat.normalizeChannel("#"), "");
  assert.equal(Chat.normalizeChannel(null), "");
  assert.equal(Chat.makeAnonNick(() => 0.5), "justinfan55555555");
  assert.match(Chat.makeAnonNick(), /^justinfan\d{8}$/);
  // Одинаковый rng — одинаковый ник.
  assert.equal(Chat.makeAnonNick(() => 0.1), Chat.makeAnonNick(() => 0.1));
});

test("боты: isIgnored не зависит от регистра, пустой ник не игнорируется", () => {
  assert.equal(Chat.isIgnored("NightBot", Chat.BOT_USERS), true);
  assert.equal(Chat.isIgnored("STREAMELEMENTS", Chat.BOT_USERS), true);
  assert.equal(Chat.isIgnored("luna_kot", Chat.BOT_USERS), false);
  assert.equal(Chat.isIgnored("", Chat.BOT_USERS), false);
  assert.equal(Chat.isIgnored(null, Chat.BOT_USERS), false);
  assert.equal(Chat.isIgnored("бот", [" Бот "]), true);
});

// ---------------------------------------------------------------------
// Клиент: анонимность, сокет, переподключение.
// ---------------------------------------------------------------------

test("конструктор нормализует канал и понятно ругается на пустой", () => {
  const { client } = makeHarness({ channel: "#Test_Channel" });
  assert.equal(client.channel, "test_channel");
  assert.throws(() => new Chat.Client({ channel: "  " }), /канал/i);
  assert.throws(() => new Chat.Client({}), /канал/i);
});

test("start открывает сокет и шлёт ровно CAP, PASS, NICK, JOIN в этом порядке", () => {
  const { client, sockets, statuses } = makeHarness();
  client.start();
  client.start();
  assert.equal(sockets.length, 1, "повторный start не должен открывать второй сокет");
  assert.equal(sockets[0].url, "wss://irc-ws.chat.twitch.tv:443");

  sockets[0].open();
  assert.match(client.nick, /^justinfan\d{8}$/);
  const lines = sockets[0].lines();
  assert.deepEqual(lines, [
    "CAP REQ :twitch.tv/tags twitch.tv/commands",
    "PASS SCHMOOPIIE",
    "NICK " + client.nick,
    "JOIN #test_channel",
  ]);
  assert.deepEqual(
    statuses.map((item) => item.status).slice(0, 2),
    ["connecting", "open"]
  );
  assert.equal(client.connected, true);
});

test("send пишет в сокет только когда он открыт, PRIVMSG не отправляется", () => {
  const { client, sockets } = makeHarness();
  client.start();
  assert.equal(client.send("PING :x"), false);
  assert.equal(sockets[0].sent.length, 0);

  sockets[0].open();
  assert.equal(client.send("PING :x"), true);
  assert.equal(sockets[0].sent.at(-1), "PING :x\r\n");
  // Игра только читает чат: PRIVMSG не уходит никогда.
  const count = sockets[0].sent.length;
  assert.equal(client.send("PRIVMSG #test_channel :привет"), false);
  assert.equal(client.send("privmsg #test_channel :привет"), false);
  assert.equal(sockets[0].sent.length, count);
  assert.equal(client.connected, true);
});

test("PING от сервера получает PONG с тем же хвостом", () => {
  const { client, sockets } = makeHarness();
  client.start();
  sockets[0].open();
  sockets[0].receive("PING :tmi.twitch.tv\r\n");
  assert.equal(sockets[0].sent.at(-1), "PONG :tmi.twitch.tv\r\n");

  assert.equal(client.handleLine("PING").reply, "PONG :tmi.twitch.tv");
  const bare = client.handleLine("PING").reply;
  assert.match(bare, /^PONG :\S+$/);
  assert.equal(client.handleLine("PING :x").message, null);
});

test("PRIVMSG доходит до onMessage, служебные строки — нет", () => {
  const { client, sockets, messages, statuses } = makeHarness();
  client.start();
  sockets[0].open();
  sockets[0].receive(PRIVMSG + "\r\n");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].user, "luna_kot");
  assert.equal(messages[0].display_name, "Луна");
  assert.equal(messages[0].text, "привет мир");
  assert.ok(statuses.some((item) => item.status === "message"));

  sockets[0].receive(
    [
      ":tmi.twitch.tv 353 justinfan55555555 = #test_channel :luna_kot кот",
      ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands",
      "@msg-id=resub :tmi.twitch.tv USERNOTICE #test_channel :подписка",
      "",
      ":luna_kot!luna_kot@luna_kot.tmi.twitch.tv JOIN #test_channel",
    ].join("\r\n") + "\r\n"
  );
  assert.equal(messages.length, 1, "служебные строки не становятся сообщениями");
});

test("сообщение бота не доходит до onMessage", () => {
  const { client, sockets, messages } = makeHarness();
  client.start();
  sockets[0].open();
  const line = privmsg("id=1;display-name=Nightbot", "!огонь", "nightbot");
  const result = client.handleLine(line);
  assert.equal(result.ignored, true);
  assert.equal(result.message, null);
  assert.equal(messages.length, 0);

  // Обычный зритель проходит.
  const normal = client.handleLine(privmsg("id=2", "!огонь", "vasya"));
  assert.equal(normal.ignored, false);
  assert.equal(messages.length, 1);
});

test("подтверждение JOIN даёт статус joined ровно один раз", () => {
  const { client, sockets, statuses } = makeHarness();
  client.start();
  sockets[0].open();
  const result = client.handleLine(
    ":luna_kot!luna_kot@luna_kot.tmi.twitch.tv JOIN #test_channel"
  );
  assert.equal(result.joined, true);
  client.handleLine(":tmi.twitch.tv 366 justinfan55555555 #test_channel :End of /NAMES list");
  const joined = statuses.filter((item) => item.status === "joined");
  assert.equal(joined.length, 1);
  assert.equal(joined[0].info.channel, "test_channel");
});

test("первая строка сервера сбрасывает счётчик попыток", () => {
  const { client, sockets, statuses, timers } = makeHarness();
  client.start();
  sockets[0].open();
  sockets[0].receive(PRIVMSG + "\r\n");
  assert.equal(client.attempt, 0);

  sockets[0].serverClose();
  const reconnect = statuses.filter((item) => item.status === "reconnect").at(-1);
  assert.equal(reconnect.info.attempt, 1);
  assert.equal(reconnect.info.delay, 1);
  timers.advance(1000);
  assert.equal(sockets.length, 2);
});

test("переподключение ждёт 1→2→4→8→16→30 и упирается в 30 секунд", () => {
  const { client, sockets, statuses, timers } = makeHarness();
  client.start();
  const delays = [];
  for (let index = 0; index < 9; index += 1) {
    const socket = sockets[sockets.length - 1];
    socket.serverClose();
    const status = statuses[statuses.length - 1];
    assert.equal(status.status, "reconnect");
    delays.push(status.info.delay);
    timers.advance(status.info.delay * 1000);
  }
  assert.deepEqual(delays, [1, 2, 4, 8, 16, 30, 30, 30, 30]);
  assert.equal(client.attempt, 9);
});

test("тихий чат — не обрыв: PING только через четыре минуты тишины", () => {
  const { client, sockets, timers } = makeHarness();
  client.start();
  sockets[0].open();

  timers.advance(239999);
  assert.equal(sockets[0].lines().filter((line) => line.startsWith("PING ")).length, 0);
  assert.equal(sockets[0].closed, false);
  assert.equal(client.connected, true);

  timers.advance(1);
  assert.equal(sockets[0].lines().filter((line) => line === Chat.WATCHDOG_PING).length, 1);
  assert.equal(sockets[0].closed, false, "тишина сама по себе не закрывает сокет");
  assert.equal(client.connected, true);
});

test("ещё 60 секунд молчания после PING — мёртвое соединение и переподключение", () => {
  const { client, sockets, statuses, timers } = makeHarness();
  client.start();
  sockets[0].open();
  timers.advance(240000);
  assert.equal(sockets[0].lines().at(-1), Chat.WATCHDOG_PING);

  timers.advance(59999);
  assert.equal(sockets[0].closed, false);
  timers.advance(1);
  assert.equal(sockets[0].closed, true);
  assert.equal(client.connected, false);
  assert.equal(client.attempt, 1);

  const reconnect = statuses.filter((item) => item.status === "reconnect").at(-1);
  assert.equal(reconnect.info.delay, 1);
  timers.advance(1000);
  assert.equal(sockets.length, 2);
});

test("строка после PING снимает ожидание: соединение живёт дальше", () => {
  const { client, sockets, timers } = makeHarness();
  client.start();
  sockets[0].open();
  timers.advance(240000);
  assert.equal(sockets[0].lines().filter((line) => line === Chat.WATCHDOG_PING).length, 1);

  sockets[0].receive(PRIVMSG + "\r\n");
  assert.equal(client.attempt, 0);
  timers.advance(60000);
  assert.equal(sockets[0].closed, false);

  timers.advance(180000);
  assert.equal(sockets[0].lines().filter((line) => line === Chat.WATCHDOG_PING).length, 2);
  assert.equal(sockets[0].closed, false);
});

test("нет WebSocket — клиент не падает, а пробует снова", () => {
  const { client, sockets, statuses, timers } = makeHarness({ WebSocketClass: null });
  assert.doesNotThrow(() => client.start());
  assert.equal(sockets.length, 0);
  assert.equal(client.connected, false);
  assert.ok(statuses.some((item) => item.status === "error"));
  assert.ok(statuses.some((item) => item.status === "reconnect"));
  assert.ok(timers.pending > 0, "должен быть назначен повтор");
  timers.advance(1000);
  assert.equal(sockets.length, 0);
});

test("stop закрывает сокет и больше не переподключается", () => {
  const { client, sockets, statuses, timers } = makeHarness();
  client.start();
  sockets[0].open();
  sockets[0].receive(PRIVMSG + "\r\n");
  client.stop();

  assert.equal(sockets[0].closed, true);
  assert.equal(client.connected, false);
  assert.ok(statuses.some((item) => item.status === "closed" && item.info.reason === "stop"));
  timers.advance(600000);
  assert.equal(sockets.length, 1);
});

test("stop отменяет уже назначенное переподключение", () => {
  const { client, sockets, timers } = makeHarness();
  client.start();
  sockets[0].open();
  sockets[0].serverClose();
  assert.ok(timers.pending > 0);

  client.stop();
  assert.equal(timers.pending, 0);
  timers.advance(120000);
  assert.equal(sockets.length, 1);
});

test("анонимность: за весь сценарий уходят только CAP/PASS/NICK/JOIN/PONG/PING", () => {
  const { client, sockets, timers } = makeHarness();
  client.start();
  sockets[0].open();
  // Полный сценарий: приветствие, сообщение, PING, служебные строки,
  // мёртвое соединение, переподключение и второй сокет.
  sockets[0].receive(PRIVMSG + "\r\n");
  sockets[0].receive("PING :tmi.twitch.tv\r\n");
  sockets[0].receive(":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n");
  sockets[0].receive(":luna_kot!luna_kot@luna_kot.tmi.twitch.tv JOIN #test_channel\r\n");
  timers.advance(240000);
  timers.advance(60000);
  timers.advance(1000);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].receive(PRIVMSG + "\r\n");
  sockets[1].serverClose();
  timers.advance(2000);
  assert.equal(sockets.length, 3);
  sockets[2].open();

  const allSent = sockets.flatMap((socket) => socket.lines());
  const allowed = [
    /^CAP REQ :twitch\.tv\/tags twitch\.tv\/commands$/,
    /^PASS SCHMOOPIIE$/,
    /^NICK justinfan\d{8}$/,
    /^JOIN #[a-z0-9_]+$/,
    /^PONG :\S+$/,
    /^PING :\S+$/,
  ];
  for (const line of allSent) {
    assert.ok(
      allowed.some((pattern) => pattern.test(line)),
      "неожиданная исходящая строка: «" + line + "»"
    );
    assert.ok(!/^PRIVMSG\s/i.test(line), "PRIVMSG отправлять нельзя: " + line);
  }
  assert.equal(allSent.length, 4 * 3 + 1 + 1, "приветствия трёх сокетов + PONG + PING");
});

test("js/chat.js — обычный скрипт, единственный адрес, никаких PRIVMSG", () => {
  const source = readProject("js/chat.js");
  assert.doesNotMatch(source, /^\s*(import|export)\b/m);
  assert.match(source, /SB\.Chat\s*=/);
  const urls = source.match(/wss:\/\/[^"'\s]+/g) || [];
  assert.deepEqual(urls, ["wss://irc-ws.chat.twitch.tv:443"]);
  assert.doesNotMatch(source, /\.send\(\s*["'`][^"'`]*PRIVMSG/);
  assert.doesNotMatch(source, /send\(\s*["'`][^"'`]*PRIVMSG/);
});
