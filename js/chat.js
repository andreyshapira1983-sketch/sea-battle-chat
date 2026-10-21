/* «Морской бой чата»: анонимное чтение чата Twitch.
 *
 * Один WebSocket и только чтение: просим у Twitch теги, представляемся
 * анонимным ником justinfan + восемь цифр (такой ник не умеет писать),
 * входим в канал и разбираем строки IRC. Сами в чат не пишем: исходящие
 * строки — только CAP, PASS, NICK, JOIN, PONG и свой PING для проверки
 * живости. Никаких PRIVMSG.
 *
 * Всё, что связано со временем и сетью, приходит параметрами: в тестах это
 * поддельные WebSocket, часы и таймеры, поэтому проверки не ждут настоящих
 * секунд и не лезут в интернет.
 *
 * Статусы onStatus(status, info):
 *   "connecting" — начинаем подключаться (info: {attempt});
 *   "open"       — сокет открыт (info: {nick});
 *   "joined"     — сервер подтвердил вход в канал (info: {channel});
 *   "message"    — пришло сообщение чата (info: само сообщение);
 *   "closed"     — сокет закрыт (info: {reason});
 *   "reconnect"  — ждём паузу перед новой попыткой (info: {attempt, delay, reason});
 *   "error"      — ошибка сокета (info: {error}).
 *
 * Файл — обычный браузерный скрипт (без import/export): страница должна
 * работать и с GitHub Pages, и открытая как локальный файл в OBS.
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Ники ботов: они не должны становиться кораблями в игре.
  const BOT_USERS = Object.freeze([
    "nightbot",
    "streamelements",
    "streamlabs",
    "moobot",
    "fossabot",
    "wizebot",
    "soundalerts",
  ]);

  // Единственный внешний адрес игры: Twitch слушает именно здесь.
  const DEFAULT_URL = "wss://irc-ws.chat.twitch.tv:443";

  // Тишина в чате — норма, а не обрыв. Через четыре минуты без единой
  // строки спрашиваем PING, и только если ещё 60 секунд ничего не пришло,
  // считаем соединение мёртвым и переподключаемся.
  const IDLE_PING_MS = 240000;
  const PING_REPLY_MS = 60000;
  const WATCHDOG_PING = "PING :sea-battle";

  // Экранирование в тегах Twitch: пробел — \s, точка с запятой — \:,
  // обратная косая черта — \\, а ещё бывают \r и \n.
  const TAG_ESCAPES = Object.freeze({
    s: " ",
    ":": ";",
    "\\": "\\",
    r: "\r",
    n: "\n",
  });

  // Обёртка сообщения /me в IRC: \x01ACTION текст\x01.
  const ACTION_PREFIX = "\u0001ACTION ";

  /** Привести имя канала к виду «без #, нижним регистром». */
  function normalizeChannel(value) {
    let text = String(value == null ? "" : value).trim();
    if (text.charAt(0) === "#") text = text.slice(1);
    return text.trim().toLowerCase();
  }

  /** Входит ли ник в список игнорируемых (без учёта регистра). */
  function isIgnored(user, ignoreUsers) {
    const name = String(user == null ? "" : user).trim().toLowerCase();
    if (!name) return false;
    const ignored = new Set();
    for (const item of ignoreUsers || []) {
      const text = String(item == null ? "" : item).trim().toLowerCase();
      if (text) ignored.add(text);
    }
    return ignored.has(name);
  }

  /** Случайный анонимный ник justinfan + восемь цифр. */
  function makeAnonNick(rng) {
    const generator = typeof rng === "function" ? rng : Math.random;
    let digits = "";
    for (let index = 0; index < 8; index += 1) {
      const value = Number(generator());
      const bounded = Math.min(0.999999, Math.max(0, Number.isFinite(value) ? value : 0));
      digits += String(Math.floor(bounded * 10));
    }
    return "justinfan" + digits;
  }

  /** Пауза перед повторным подключением, секунды: 1, 2, 4, 8, 16 и 30 — потолок.
   *
   * В ТЗ рост записан как «1 → 2 → 4 … 30»: первая попытка ждёт одну
   * секунду, каждая следующая удваивает паузу, но не больше 30 секунд.
   */
  function retryDelay(attempt) {
    let number = Number(attempt);
    if (!Number.isFinite(number) || number < 1) number = 1;
    return Math.min(30, Math.pow(2, number - 1));
  }

  /** Раскрыть экранирование значения тега IRC.
   *
   * Неизвестное экранирование оставляем без косой черты: строка не должна
   * терять данные из-за чужой версии сервера.
   */
  function unescapeTag(value) {
    const text = String(value == null ? "" : value);
    let result = "";
    let index = 0;
    while (index < text.length) {
      const char = text.charAt(index);
      if (char === "\\" && index + 1 < text.length) {
        const next = text.charAt(index + 1);
        result += Object.prototype.hasOwnProperty.call(TAG_ESCAPES, next)
          ? TAG_ESCAPES[next]
          : next;
        index += 2;
      } else {
        result += char;
        index += 1;
      }
    }
    return result;
  }

  /** Разобрать строку тегов вида «ключ=значение;ключ2=значение2». */
  function parseTags(raw) {
    const tags = {};
    for (const part of String(raw == null ? "" : raw).split(";")) {
      if (!part) continue;
      const equalsAt = part.indexOf("=");
      const key = (equalsAt >= 0 ? part.slice(0, equalsAt) : part).trim();
      const value = equalsAt >= 0 ? part.slice(equalsAt + 1) : "";
      if (key) tags[key] = unescapeTag(value);
    }
    return tags;
  }

  /** Разобрать строку IRC на теги, префикс, ник, команду, параметры и текст. */
  function splitLine(line) {
    let rest = String(line == null ? "" : line).replace(/[\r\n]+$/, "");
    let tags = {};

    if (rest.charAt(0) === "@") {
      const spaceAt = rest.indexOf(" ");
      const tagPart = spaceAt >= 0 ? rest.slice(0, spaceAt) : rest;
      rest = spaceAt >= 0 ? rest.slice(spaceAt + 1).replace(/^\s+/, "") : "";
      tags = parseTags(tagPart.slice(1));
    }

    let prefix = "";
    if (rest.charAt(0) === ":") {
      const spaceAt = rest.indexOf(" ");
      prefix = spaceAt >= 0 ? rest.slice(1, spaceAt) : rest.slice(1);
      rest = spaceAt >= 0 ? rest.slice(spaceAt + 1).replace(/^\s+/, "") : "";
    }

    let text = "";
    const textAt = rest.indexOf(" :");
    if (textAt >= 0) {
      text = rest.slice(textAt + 2);
      rest = rest.slice(0, textAt);
    }

    const parts = rest.split(/\s+/).filter((part) => part.length > 0);
    const command = parts.length ? parts[0] : "";
    return {
      tags,
      prefix,
      nick: prefix ? prefix.split("!")[0] : "",
      command,
      params: parts.slice(1),
      text,
    };
  }

  /** Есть ли в строке значков Twitch значок с именем name. */
  function hasBadge(badges, name) {
    const wanted = String(name == null ? "" : name);
    for (const badge of String(badges == null ? "" : badges).split(",")) {
      if (badge.split("/")[0].trim() === wanted) return true;
    }
    return false;
  }

  /** Убрать обёртку сообщения /me: \x01ACTION текст\x01. */
  function splitAction(text) {
    const raw = String(text == null ? "" : text);
    if (raw.startsWith(ACTION_PREFIX) && raw.endsWith("\u0001")) {
      return { text: raw.slice(ACTION_PREFIX.length, -1), action: true };
    }
    return { text: raw, action: false };
  }

  /** Строгое целое для диапазона эмоута: мусор и минусы не проходят. */
  function toEmoteNumber(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
  }

  /** Разобрать тег emotes в диапазоны по символам Юникода.
   *
   * Формат Twitch: id:начало-конец,начало-конец/id2:начало-конец.
   * Позиции считаются по кодовым точкам, поэтому кириллица и эмодзи их не
   * сбивают: строку режем через Array.from. Позиции за пределами текста
   * отбрасываем — лучше без эмоута, чем со сдвинутым.
   */
  function parseEmotes(raw, text) {
    const result = [];
    const chars = Array.from(String(text == null ? "" : text));
    const length = chars.length;
    const source = String(raw == null ? "" : raw);
    if (!source || length === 0) return result;

    for (const chunk of source.split("/")) {
      const colonAt = chunk.indexOf(":");
      const emoteId = (colonAt >= 0 ? chunk.slice(0, colonAt) : chunk).trim();
      const ranges = colonAt >= 0 ? chunk.slice(colonAt + 1) : "";
      if (!emoteId) continue;
      for (const pair of ranges.split(",")) {
        const dashAt = pair.indexOf("-");
        if (dashAt < 0) continue;
        const start = toEmoteNumber(pair.slice(0, dashAt));
        const end = toEmoteNumber(pair.slice(dashAt + 1));
        if (start === null || end === null) continue;
        if (start >= 0 && start <= end && end < length) {
          result.push({ id: emoteId, start, end });
        }
      }
    }
    result.sort((left, right) => left.start - right.start);
    return result;
  }

  /** Собрать сообщение игры из разобранной строки PRIVMSG.
   *
   * Набор полей ровно такой, какой ждёт мир игры: логин, отображаемое имя,
   * текст, признак первого сообщения, роли, id и цвет ника. Обёртку /me
   * снимаем, текст остаётся обычной строкой.
   */
  function messageFromParsed(parsed) {
    if (!parsed || parsed.command !== "PRIVMSG") return null;
    const nick = String(parsed.nick || "").trim();
    if (!nick) return null;

    const tags = parsed.tags || {};
    const badges = String(tags.badges || "");
    const displayName = String(tags["display-name"] || "").trim() || nick;
    const isBroadcaster = hasBadge(badges, "broadcaster");
    // Модератором считаем и по тегу mod=1, и по значку: Twitch присылает
    // их не всегда вместе, а модератор должен быть узнан в любом случае.
    const isMod = String(tags.mod || "") === "1" || hasBadge(badges, "moderator");

    const action = splitAction(parsed.text);

    return {
      user: nick,
      display_name: displayName,
      text: action.text,
      first_msg: String(tags["first-msg"] || "") === "1",
      is_mod: isMod,
      is_broadcaster: isBroadcaster,
      msg_id: String(tags.id || ""),
      chat_color: String(tags.color || ""),
    };
  }

  /** Обработать одну строку IRC.
   *
   * Возвращает пару «ответ серверу, сообщение чата». Ответ нужен на PING,
   * сообщение — только для PRIVMSG; служебные строки дают {null, null}.
   */
  function handleLine(line) {
    const parsed = splitLine(line);
    if (parsed.command === "PING") {
      let tail = String(parsed.text || "");
      if (!tail && parsed.params.length) tail = parsed.params.join(" ");
      // PING без хвоста тоже должен получить валидный PONG, иначе сервер
      // Twitch может посчитать нас невежливыми.
      if (!tail) tail = "tmi.twitch.tv";
      return { reply: "PONG :" + tail, message: null };
    }
    return { reply: null, message: messageFromParsed(parsed) };
  }

  /** Анонимный клиент чтения чата: WebSocket, IRC, переподключение. */
  class ChatClient {
    constructor(options) {
      const settings = options || {};

      this._channel = normalizeChannel(settings.channel);
      if (!this._channel) {
        throw new Error(
          'Не указан канал Twitch: впишите его в ссылку (параметр "channel").'
        );
      }

      this._onMessage =
        typeof settings.onMessage === "function" ? settings.onMessage : function () {};
      this._onStatus =
        typeof settings.onStatus === "function" ? settings.onStatus : function () {};

      // Если WebSocketClass передали явно (даже null), средний global не
      // подставляем: тестам нужно уметь проверить среду без WebSocket.
      this._WebSocketClass = Object.prototype.hasOwnProperty.call(
        settings,
        "WebSocketClass"
      )
        ? settings.WebSocketClass
        : global.WebSocket;
      this._url = settings.url || DEFAULT_URL;
      // Часы и таймеры — параметры, чтобы тесты не ждали минутами.
      this._now = typeof settings.now === "function" ? settings.now : Date.now;
      this._setTimeoutFn =
        typeof settings.setTimeoutFn === "function"
          ? settings.setTimeoutFn
          : function (fn, ms) {
              return global.setTimeout(fn, ms);
            };
      this._clearTimeoutFn =
        typeof settings.clearTimeoutFn === "function"
          ? settings.clearTimeoutFn
          : function (id) {
              global.clearTimeout(id);
            };
      this._rng = typeof settings.rng === "function" ? settings.rng : Math.random;

      // Ник выбираем один раз: соединение анонимное, а стабильный ник
      // проще показывать и сравнивать.
      this._nick = makeAnonNick(this._rng);

      this._ws = null;
      this._started = false;
      this._stopped = false;
      this._connected = false;
      this._joined = false;
      this._attempt = 0;
      this._lastLineAt = 0;
      this._pingPending = false;
      this._pingAt = 0;
      this._livenessTimer = null;
      this._reconnectTimer = null;
    }

    /** Сколько неудачных подключений подряд было без единой строки. */
    get attempt() {
      return this._attempt;
    }

    /** Открыт ли сокет прямо сейчас. */
    get connected() {
      return Boolean(this._connected && this._ws);
    }

    /** Канал без # и в нижнем регистре. */
    get channel() {
      return this._channel;
    }

    /** Анонимный ник justinfan + восемь цифр. */
    get nick() {
      return this._nick;
    }

    /** Начать читать чат. Повторный вызов ничего не ломает. */
    start() {
      if (this._started && !this._stopped) return this;
      this._started = true;
      this._stopped = false;
      this._attempt = 0;
      this._emitStatus("connecting", { attempt: 0 });
      this._connect();
      return this;
    }

    /** Остановить чтение: отменить таймеры, закрыть сокет, не переподключаться. */
    stop() {
      if (this._stopped) return this;
      this._stopped = true;
      this._started = false;
      this._clearReconnectTimer();
      this._clearLivenessTimer();
      const ws = this._ws;
      this._ws = null;
      this._connected = false;
      this._pingPending = false;
      if (ws && typeof ws.close === "function") {
        try {
          ws.close();
        } catch (error) {
          // Сокет мог закрыться сам — это не мешает остановке.
        }
      }
      this._emitStatus("closed", { reason: "stop" });
      return this;
    }

    /** Отправить одну строку IRC. Пока сокет не открыт — молча ничего.
     *
     * PRIVMSG не отправляется никогда: игра только читает чат. Это не
     * вежливость, а требование ТЗ — картинка для OBS не должна уметь
     * писать в чат зрителя.
     */
    send(line) {
      const text = String(line == null ? "" : line).replace(/[\r\n]+$/, "");
      if (!text || /^PRIVMSG\b/i.test(text)) return false;
      if (!this._connected || !this._ws) return false;
      try {
        this._ws.send(text + "\r\n");
      } catch (error) {
        return false;
      }
      return true;
    }

    /** Приветствие каналу: JOIN #канал. Вызывается при открытии сокета. */
    enterChannel() {
      return this.send("JOIN #" + this._channel);
    }

    /** Обработать одну строку от сервера.
     *
     * Возвращает {reply, message, joined, ignored}: reply — что ответили
     * на PING, message — сообщение чата или null, joined — подтвердился ли
     * вход в канал именно этой строкой, ignored — отброшено ли сообщение
     * бота из BOT_USERS.
     */
    handleLine(line) {
      const clean = String(line == null ? "" : line).replace(/[\r\n]+$/, "");
      if (!clean) return { reply: null, message: null, joined: false, ignored: false };

      // Любая строка от сервера — доказательство, что связь жива:
      // ожидание PONG снимается, счётчик попыток обнуляется.
      this._lastLineAt = this._now();
      this._pingPending = false;
      this._attempt = 0;
      this._scheduleLiveness(IDLE_PING_MS);

      const parsed = splitLine(clean);
      // Это чистая функция из этого же файла, не метод класса.
      const answer = handleLine(clean);

      let joined = false;
      if (!this._joined && this._isJoinConfirmation(parsed)) {
        this._joined = true;
        joined = true;
        this._emitStatus("joined", { channel: this._channel });
      }

      if (answer.reply) this.send(answer.reply);

      let ignored = false;
      if (answer.message) {
        if (isIgnored(answer.message.user, BOT_USERS)) {
          // Бот не должен стать кораблём: in game он не попадает.
          ignored = true;
        } else {
          this._emitStatus("message", answer.message);
          this._onMessage(answer.message);
        }
      }
      return {
        reply: answer.reply,
        message: ignored ? null : answer.message,
        joined,
        ignored,
      };
    }

    /** Проверить, живы ли мы. Возвращает "closed" | "waiting" | "pinged" | "alive" | "dead".
     *
     * В браузере этот метод зовут таймеры, но и тестам он полезен: можно
     * подвинуть поддельные часы и спросить состояние вручную.
     */
    checkLiveness() {
      if (!this._connected || !this._ws) return "closed";
      const now = this._now();

      if (this._pingPending) {
        const waited = now - this._pingAt;
        if (waited >= PING_REPLY_MS) {
          // Шестьдесят секунд тишины после нашего PING — соединение мёртвое.
          this._handleDisconnect("нет ответа на PING");
          return "dead";
        }
        this._scheduleLiveness(PING_REPLY_MS - waited);
        return "waiting";
      }

      const silent = now - this._lastLineAt;
      if (silent >= IDLE_PING_MS) {
        this.send(WATCHDOG_PING);
        this._pingPending = true;
        this._pingAt = now;
        this._scheduleLiveness(PING_REPLY_MS);
        return "pinged";
      }
      this._scheduleLiveness(IDLE_PING_MS - silent);
      return "alive";
    }

    // ------------------------------------------------------------------
    // Внутреннее: сокет, таймеры, переподключение.
    // ------------------------------------------------------------------

    /** Открыть новое соединение. */
    _connect() {
      if (this._stopped) return;
      const WebSocketClass = this._WebSocketClass;
      if (typeof WebSocketClass !== "function") {
        this._emitStatus("error", { error: new Error("В этой среде нет WebSocket") });
        this._scheduleRetry("нет WebSocket");
        return;
      }

      let ws;
      try {
        ws = new WebSocketClass(this._url);
      } catch (error) {
        this._emitStatus("error", { error });
        this._scheduleRetry("не удалось открыть сокет");
        return;
      }

      this._ws = ws;
      this._joined = false;
      this._connected = false;
      // Старые обработчики не должны трогать новый сокет: сверяем ссылку.
      ws.onopen = () => {
        if (this._ws !== ws) return;
        this._handleOpen(ws);
      };
      ws.onmessage = (event) => {
        if (this._ws !== ws) return;
        this._handlePayload(event);
      };
      ws.onerror = (error) => {
        if (this._ws !== ws) return;
        this._emitStatus("error", { error });
        this._handleDisconnect("ошибка сокета");
      };
      ws.onclose = () => {
        if (this._ws !== ws) return;
        this._handleDisconnect("сокет закрыт");
      };
    }

    /** Сокет открылся: представиться и войти в канал. */
    _handleOpen(ws) {
      if (this._stopped) {
        try {
          ws.close();
        } catch (error) {
          // Уже закрыт — ничего страшного.
        }
        return;
      }
      this._connected = true;
      this._joined = false;
      this._pingPending = false;
      this._lastLineAt = this._now();
      this._emitStatus("open", { nick: this._nick });

      // Порядок важен: теги просим и PASS шлём до NICK, а канал выбираем
      // уже после того, как представились. Так требует Twitch.
      this.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      this.send("PASS SCHMOOPIIE");
      this.send("NICK " + this._nick);
      this.enterChannel();
      this._scheduleLiveness(IDLE_PING_MS);
    }

    /** Разобрать пачку строк из одного сообщения WebSocket. */
    _handlePayload(event) {
      const data = event && typeof event === "object" && "data" in event ? event.data : event;
      if (typeof data !== "string") return;
      for (const raw of data.split("\n")) {
        const line = raw.replace(/[\r\n]+$/, "");
        if (line) this.handleLine(line);
      }
    }

    /** Сервер подтвердил вход в канал (JOIN или конец списка имён). */
    _isJoinConfirmation(parsed) {
      if (!parsed) return false;
      if (parsed.command === "JOIN") {
        const target = normalizeChannel(
          (parsed.params && parsed.params[0]) || parsed.text
        );
        return target === this._channel;
      }
      if (parsed.command === "366") {
        return (parsed.params || []).some(
          (param) => normalizeChannel(param) === this._channel
        );
      }
      return false;
    }

    /** Сокет закрылся (сам или из-за ошибки): закрыть и назначить повтор. */
    _handleDisconnect(reason) {
      const ws = this._ws;
      if (!ws) return;
      this._ws = null;
      this._connected = false;
      this._pingPending = false;
      this._clearLivenessTimer();
      if (typeof ws.close === "function") {
        try {
          ws.close();
        } catch (error) {
          // Сокет мог закрыться сам.
        }
      }
      this._emitStatus("closed", { reason });
      if (this._stopped) return;
      this._scheduleRetry(reason);
    }

    /** Подождать и попробовать снова: 1, 2, 4, 8, 16 … 30 секунд. */
    _scheduleRetry(reason) {
      if (this._stopped || !this._started) return;
      this._clearReconnectTimer();
      this._attempt += 1;
      const delay = retryDelay(this._attempt);
      this._emitStatus("reconnect", { attempt: this._attempt, delay, reason });
      const timer = this._setTimeoutFn(() => {
        this._reconnectTimer = null;
        if (this._stopped) return;
        this._connect();
      }, delay * 1000);
      this._reconnectTimer = timer;
      this._maybeUnref(timer);
    }

    /** Поставить проверку живости через delayMs миллисекунд. */
    _scheduleLiveness(delayMs) {
      this._clearLivenessTimer();
      if (!this._connected || this._stopped) return;
      const wait = Math.max(0, Math.floor(Number(delayMs) || 0));
      const timer = this._setTimeoutFn(() => {
        this._livenessTimer = null;
        this.checkLiveness();
      }, wait);
      this._livenessTimer = timer;
      this._maybeUnref(timer);
    }

    _clearLivenessTimer() {
      if (this._livenessTimer === null || this._livenessTimer === undefined) return;
      const timer = this._livenessTimer;
      this._livenessTimer = null;
      this._clearTimeoutFn(timer);
    }

    _clearReconnectTimer() {
      if (this._reconnectTimer === null || this._reconnectTimer === undefined) return;
      const timer = this._reconnectTimer;
      this._reconnectTimer = null;
      this._clearTimeoutFn(timer);
    }

    /** В Node таймеры можно отпустить, чтобы тесты не ждали их впустую. */
    _maybeUnref(timer) {
      if (timer && typeof timer.unref === "function") timer.unref();
    }

    _emitStatus(status, info) {
      this._onStatus(status, info || {});
    }
  }

  SB.Chat = {
    BOT_USERS,
    DEFAULT_URL,
    IDLE_PING_MS,
    PING_REPLY_MS,
    WATCHDOG_PING,
    ACTION_PREFIX,
    normalizeChannel,
    isIgnored,
    makeAnonNick,
    retryDelay,
    unescapeTag,
    parseTags,
    splitLine,
    hasBadge,
    splitAction,
    parseEmotes,
    messageFromParsed,
    handleLine,
    Client: ChatClient,
  };
})(typeof window !== "undefined" ? window : globalThis);
