/* «Морской бой чата»: демо-режим без чата.
 *
 * Придуманный чат для конструктора и проверки без Twitch: восемь ботов
 * сами входят в игру и пишут команды. Сценарий детерминирован — один и
 * тот же seed даёт одни и те же сообщения через одни и те же промежутки,
 * поэтому тесты повторяемы, а предпросмотр не «прыгает».
 *
 * Поток бесконечный: js/main.js запускает его один раз и зовёт nextDue
 * по часам мира. Внутри сценарий идёт кругами — боты воюют, иногда
 * уплывают (!уйти) и возвращаются (!играть).
 *
 * Сообщение — ровно того же формата, что прилетает из чата Twitch:
 * { user, display_name, text, first_msg, is_mod, is_broadcaster, msg_id,
 * chat_color }. Ролей у демо-ботов нет: is_mod и is_broadcaster — false.
 *
 * Файл — обычный браузерный скрипт (без import/export).
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Seed по умолчанию: дата сценария, 21.10.2026.
  const SEED = 20261021;
  const DEFAULT_SEED = SEED;

  // Интервал между соседними сообщениями — от 1 до 3 секунд (ТЗ §4 ДЕМО).
  const MIN_GAP_MS = 1000;
  const MAX_GAP_MS = 3000;

  // Восемь придуманных ботов: логин латиницей, отображаемое имя выдумано.
  // Ни одного настоящего никa зрителя или стримера здесь нет.
  const BOTS = Object.freeze([
    Object.freeze({ user: "kapitan_shtorm", display_name: "Капитан Шторм" }),
    Object.freeze({ user: "mayak_maks", display_name: "Маяк Макс" }),
    Object.freeze({ user: "sonnyy_krab", display_name: "Сонный Краб" }),
    Object.freeze({ user: "belaya_chaika", display_name: "Белая Чайка" }),
    Object.freeze({ user: "korall_13", display_name: "Коралл 13" }),
    Object.freeze({ user: "shturman_bob", display_name: "Штурман Боб" }),
    Object.freeze({ user: "morskoy_kot", display_name: "Морской Кот" }),
    Object.freeze({ user: "pirat_nya", display_name: "Пират Ня" }),
  ]);

  // Отображаемые имена ботов — для подписей и проверок.
  const VIEWER_NAMES = Object.freeze(BOTS.map((bot) => bot.display_name));

  // Слова команд по языку страницы. Оба набора принимает SB.Commands:
  // команды в чате работают и по-русски, и латиницей.
  const WORDS = Object.freeze({
    ru: Object.freeze({
      join: "!играть",
      leave: "!уйти",
      command: Object.freeze({
        fire: "!огонь",
        right: "!вперёд",
        left: "!назад",
        shield: "!щит",
        repair: "!ремонт",
      }),
    }),
    en: Object.freeze({
      join: "!join",
      leave: "!leave",
      command: Object.freeze({
        fire: "!fire",
        right: "!right",
        left: "!left",
        shield: "!shield",
        repair: "!repair",
      }),
    }),
  });

  // Боевой ритм команд: шесть выстрелов из двенадцати — ровно половина,
  // как требует ТЗ («около половины команд»). Демо должно показывать бой —
  // потопления, победителя и новый раунд, — а не только «!щит/!ремонт»:
  // при редком огне корабли с 3 hp не успевают потопить друг друга.
  const COMMAND_CYCLE = Object.freeze([
    "fire",
    "fire",
    "fire",
    "fire",
    "fire",
    "fire",
    "right",
    "left",
    "right",
    "left",
    "shield",
    "repair",
  ]);

  // Сколько ботов не отпускаем из игры: игре нужны соперники.
  const MIN_IN_GAME = 4;

  // Ритм «команды — уплыл — вернулся»: на каждые 20 сообщений один уход
  // и одно возвращение, остальное — боевые команды.
  const SLOT_PERIOD = 20;
  const LEAVE_SLOT = 6;
  const REJOIN_SLOT = 10;

  // Предохранитель на один вызов nextDue: после свёрнутой вкладки не
  // вываливаем сразу тысячу сообщений.
  const MAX_DUE_PER_CALL = 60;

  // ------------------------------------------------------------------
  // Свой маленький ГПСЧ: одинаковый seed — одинаковый сценарий.
  // mulberry32 целочисленный, поэтому не зависит от версии движка.
  // ------------------------------------------------------------------
  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Целое от low до high включительно по функции случайности. */
  function randomInt(random, low, high) {
    return low + Math.floor(random() * (high - low + 1));
  }

  /** Демо-поток сообщений по условному времени. */
  class DemoFeed {
    constructor(seed, lang) {
      const value = Number(seed);
      this.seed = Number.isFinite(value) ? value : SEED;
      this.lang = lang === "en" ? "en" : "ru";
      // Копия общего списка: снаружи нельзя испортить BOTS.
      this.bots = BOTS.map((bot) => ({ user: bot.user, display_name: bot.display_name }));

      this._words = WORDS[this.lang];
      this._random = mulberry32(this.seed);
      this._joined = new Set();
      this._joinIndex = 0;
      this._slot = 0;
      this._commandIndex = 0;
      this._count = 0;
      // Время последнего выданного сообщения и время следующего; null —
      // следующее ещё не назначено и будет посчитано при первом спросе.
      this._lastAt = 0;
      this._nextAt = null;
    }

    /** Сообщения, время которых уже наступило: по одному разу и по порядку. */
    nextDue(nowMs) {
      const due = [];
      const now = Number(nowMs);
      if (!Number.isFinite(now)) return due;

      let guard = 0;
      while (guard < MAX_DUE_PER_CALL) {
        if (this._nextAt === null) {
          this._nextAt = this._lastAt + this._rollGap();
        }
        if (this._nextAt > now) break;
        due.push(this._buildMessage());
        this._lastAt = this._nextAt;
        this._nextAt = null;
        guard += 1;
      }
      return due;
    }

    /**
     * Пауза до следующего сообщения, 1–3 с по rng.
     *
     * Куб случайного числа смещает паузы к коротким (в среднем ~1,5 с
     * вместо 2 с): демо выглядит живее, а границы из ТЗ «1–3 с» держатся
     * для любого значения rng.
     */
    _rollGap() {
      const span = MAX_GAP_MS - MIN_GAP_MS + 1;
      const random = this._random();
      return MIN_GAP_MS + Math.floor(random * random * random * span);
    }

    /** Кто сейчас в игре. */
    _activeBots() {
      return BOTS.filter((bot) => this._joined.has(bot.user));
    }

    /** Кто сейчас вне игры — ждёт возвращения. */
    _inactiveBots() {
      return BOTS.filter((bot) => !this._joined.has(bot.user));
    }

    /** Выбрать сюжет следующего сообщения: бот, текст, первое ли это сообщение. */
    _takeSpec() {
      const words = this._words;

      // Первые восемь сообщений — вход в игру всех ботов по очереди.
      if (this._joinIndex < BOTS.length) {
        const bot = BOTS[this._joinIndex];
        this._joinIndex += 1;
        this._joined.add(bot.user);
        return { bot, text: words.join, first: true };
      }

      for (let guard = 0; guard < 100; guard += 1) {
        const slot = this._slot % SLOT_PERIOD;
        this._slot += 1;

        if (slot === LEAVE_SLOT) {
          const active = this._activeBots();
          if (active.length > MIN_IN_GAME) {
            const bot = active[randomInt(this._random, 0, active.length - 1)];
            this._joined.delete(bot.user);
            return { bot, text: words.leave, first: false };
          }
          continue;
        }

        if (slot === REJOIN_SLOT) {
          const inactive = this._inactiveBots();
          if (inactive.length) {
            const bot = inactive[randomInt(this._random, 0, inactive.length - 1)];
            this._joined.add(bot.user);
            return { bot, text: words.join, first: false };
          }
          continue;
        }

        const active = this._activeBots();
        if (active.length) {
          const bot = active[randomInt(this._random, 0, active.length - 1)];
          const name = COMMAND_CYCLE[this._commandIndex % COMMAND_CYCLE.length];
          this._commandIndex += 1;
          return { bot, text: words.command[name], first: false };
        }
      }

      // Запасной путь теоретически недостижим, но поток не должен падать.
      const bot = BOTS[0];
      this._joined.add(bot.user);
      return { bot, text: words.join, first: false };
    }

    /** Собрать сообщение в формате чата Twitch. */
    _buildMessage() {
      const spec = this._takeSpec();
      this._count += 1;
      return {
        user: spec.bot.user,
        display_name: spec.bot.display_name,
        text: spec.text,
        first_msg: spec.first,
        is_mod: false,
        is_broadcaster: false,
        msg_id: "demo-" + String(this._count).padStart(4, "0"),
        chat_color: "",
      };
    }
  }

  /** Создать демо-поток: { seed, lang } — как в ссылке страницы. */
  function createFeed(options) {
    const settings = options || {};
    const lang = settings.lang === "en" ? "en" : "ru";
    const seed = Number(settings.seed);
    return new DemoFeed(Number.isFinite(seed) ? seed : SEED, lang);
  }

  SB.Demo = {
    SEED,
    DEFAULT_SEED,
    BOTS,
    VIEWER_NAMES,
    MIN_GAP_MS,
    MAX_GAP_MS,
    WORDS,
    COMMAND_CYCLE,
    mulberry32,
    DemoFeed,
    createFeed,
  };
})(typeof window !== "undefined" ? window : globalThis);
