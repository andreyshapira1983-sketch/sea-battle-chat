/* «Морской бой чата», часть 2: общая сцена для OBS.
 *
 * Один источник «Браузер» в OBS показывает две страницы разом: сверху
 * «Светлячки» (чужой iframe), под ними «Морской бой» (свой index.html).
 * По умолчанию видны «Светлячки»; как только зритель пишет боевую команду,
 * сцена плавно за 1,5 с переключается на море с кораблями, а через
 * battle_idle минут без команд возвращается обратно. Стример и модераторы
 * могут переключить вручную: !бой / !светлячки.
 *
 * Скрытый бой продолжает жить (корабли входят у всех, кто пишет), а о том,
 * что его не видно, узнаёт из postMessage — в этом режиме index.html не
 * тратит кадры на рисование (SB.Main.setVisible).
 *
 * Файл — обычный браузерный скрипт (без import/export): страница должна
 * работать и с GitHub Pages, и открытая как локальный файл в OBS.
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Переключение слоёв плавное: CSS transition на .layer длится 1,5 с.
  const FADE_MS = 1500;
  // Не дёргаться туда-сюда: минимум 30 с в режиме боя.
  const MIN_BATTLE_MS = 30000;
  // Демо-предпросмотр конструктора: режимы меняются сами каждые 20 с.
  const DEMO_SWITCH_MS = 20000;

  // Команды игроков, которые считаются «боем» (каноны SB.Commands).
  const BATTLE_COMMANDS = Object.freeze([
    "fire",
    "right",
    "left",
    "shield",
    "repair",
    "join",
    "leave",
  ]);

  // Ручные команды сцены: слово из чата -> режим.
  const STAGE_ALIASES = Object.freeze({
    "бой": "battle",
    battle: "battle",
    "светлячки": "svet",
    svet: "svet",
  });

  // Тип сообщения видимости для iframe боя (его слушает SB.Main).
  const VISIBILITY_TYPE = "sea-battle-visibility";

  // battle_idle по умолчанию — 3 минуты (как в настройках сцены).
  const DEFAULT_BATTLE_IDLE_MINUTES = 3;

  // ------------------------------------------------------------------
  // Мелкие помощники: числа, флаги, разбор текста.
  // ------------------------------------------------------------------
  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function nonNegativeNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number >= 0 ? number : fallback;
  }

  /** Флаг auto: не задан — включён; явные «нет» — выключен. */
  function autoEnabled(value) {
    if (value === undefined || value === null || value === "") return true;
    if (value === false || value === 0) return false;
    const text = String(value).trim().toLowerCase();
    return !(text === "0" || text === "false" || text === "off" || text === "no" || text === "выкл" || text === "нет");
  }

  /** Время в миллисекундах из значения/функции/часов страницы. */
  function readNow(value) {
    if (typeof value === "function") {
      const called = Number(value());
      return Number.isFinite(called) ? called : 0;
    }
    return finiteNumber(value, 0);
  }

  /** Слово-команда сцены из текста сообщения ("!бой", "!Светлячки"). */
  function stageAlias(text) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw || raw.charAt(0) !== "!") return "";
    const word = raw.slice(1).split(/\s+/)[0].toLowerCase();
    return Object.prototype.hasOwnProperty.call(STAGE_ALIASES, word)
      ? STAGE_ALIASES[word]
      : "";
  }

  /** Каноническое имя боевой команды по общему разбору SB.Commands. */
  function battleCommand(text) {
    const Commands = SB.Commands;
    if (!Commands || typeof Commands.parse !== "function") return "";
    let parsed = null;
    try {
      parsed = Commands.parse(text);
    } catch (error) {
      parsed = null;
    }
    if (!parsed || !parsed.name) return "";
    return BATTLE_COMMANDS.indexOf(parsed.name) >= 0 ? parsed.name : "";
  }

  // ------------------------------------------------------------------
  // Переключатель режимов (чистый, без DOM).
  // ------------------------------------------------------------------
  /**
   * @param {object} options {auto, battleIdleMinutes, minBattleMs, fadeMs, demo, now}
   * @returns объект с mode, onMessage, tick, status.
   */
  function createSwitcher(options) {
    const opts = options && typeof options === "object" ? options : {};

    const auto = autoEnabled(opts.auto);
    const battleIdleMinutes = positiveNumber(
      opts.battleIdleMinutes,
      DEFAULT_BATTLE_IDLE_MINUTES
    );
    const minBattleMs = nonNegativeNumber(opts.minBattleMs, MIN_BATTLE_MS);
    const fadeMs = nonNegativeNumber(opts.fadeMs, FADE_MS);
    const demo = Boolean(opts.demo);

    let now = readNow(opts.now);
    let mode = "svet";
    let lastBattleAt = now;
    let enteredAt = now;
    let lastSwitchAt = now;

    /** Переключить режим и вернуть отчёт. */
    function enter(next, reason) {
      const changed = next !== mode;
      mode = next;
      if (changed && next === "battle") enteredAt = now;
      return { changed: changed, mode: mode, reason: reason };
    }

    /** Сообщение из чата: ручные команды сцены и боевые команды игроков. */
    function onMessage(message) {
      const data = message && typeof message === "object" ? message : {};
      const text = String(data.text == null ? "" : data.text).trim();
      if (!text) return { changed: false, mode: mode, reason: null };

      const rights = Boolean(data.is_mod) || Boolean(data.is_broadcaster);
      const alias = stageAlias(text);

      // Ручные команды сцены: только стример и модераторы.
      if (alias === "battle") {
        if (!rights) return { changed: false, mode: mode, reason: "no_rights" };
        lastBattleAt = now;
        enteredAt = now;
        const changed = mode !== "battle";
        mode = "battle";
        return { changed: changed, mode: mode, reason: "mod" };
      }
      if (alias === "svet") {
        if (!rights) return { changed: false, mode: mode, reason: "no_rights" };
        // Автозапуск боя после ручного возврата остаётся включённым.
        return enter("svet", "mod");
      }

      // Боевая команда зрителя: продлевает бой и при auto включает его.
      const command = battleCommand(text);
      if (!command) return { changed: false, mode: mode, reason: null };
      lastBattleAt = now;
      if (mode === "battle") {
        // Уже в бою: команда просто продлила таймер простоя.
        return { changed: false, mode: mode, reason: "command" };
      }
      if (!auto) {
        // Автозапуск выключен: переключают только !бой и !светлячки.
        return { changed: false, mode: mode, reason: "no_auto" };
      }
      return enter("battle", "command");
    }

    /** Тик часов: возврат к «Светлячкам» по простою или демо-переключение. */
    function tick(nowMs) {
      const value = Number(nowMs);
      if (Number.isFinite(value)) now = value;

      if (demo) {
        // Предпросмотр конструктора: смена режима каждые 20 секунд.
        if (now - lastSwitchAt >= DEMO_SWITCH_MS) {
          lastSwitchAt = now;
          const next = mode === "battle" ? "svet" : "battle";
          mode = next;
          if (next === "battle") {
            enteredAt = now;
            lastBattleAt = now;
          }
          return { changed: true, mode: mode, reason: "demo" };
        }
        return { changed: false, mode: mode, reason: null };
      }

      if (auto && mode === "battle") {
        const idleMs = battleIdleMinutes * 60000;
        const idle = now - lastBattleAt >= idleMs;
        const enough = now - enteredAt >= minBattleMs;
        if (idle && enough) return enter("svet", "idle");
      }
      return { changed: false, mode: mode, reason: null };
    }

    function status() {
      return {
        mode: mode,
        auto: auto,
        fadeMs: fadeMs,
        lastBattleAt: lastBattleAt,
        enteredAt: enteredAt,
        battleIdleMinutes: battleIdleMinutes,
        minBattleMs: minBattleMs,
        visibleBattle: mode === "battle",
        visibleSvet: mode === "svet",
      };
    }

    return {
      onMessage: onMessage,
      tick: tick,
      status: status,
      get mode() {
        return mode;
      },
    };
  }

  // ------------------------------------------------------------------
  // postMessage видимости: скрытый бой не рисует, но мир живёт.
  // ------------------------------------------------------------------
  function postVisibility(targetWindow, visible) {
    if (!targetWindow || typeof targetWindow.postMessage !== "function") return false;
    try {
      targetWindow.postMessage(
        { type: VISIBILITY_TYPE, visible: Boolean(visible) },
        "*"
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // DOM: два iframe, классы is-hidden, чат.
  // ------------------------------------------------------------------
  function findElement(document, id) {
    if (!document || typeof document.getElementById !== "function") return null;
    try {
      return document.getElementById(id);
    } catch (error) {
      return null;
    }
  }

  function frameWindow(frame) {
    if (!frame) return null;
    return frame.contentWindow || null;
  }

  function classListOf(element) {
    if (!element) return null;
    const list = element.classList;
    if (list && typeof list.add === "function" && typeof list.remove === "function") {
      return list;
    }
    return null;
  }

  function addClass(element, name) {
    if (!element) return;
    const list = classListOf(element);
    if (list) {
      list.add(name);
      return;
    }
    const current = String(element.className || "");
    const parts = current.split(/\s+/).filter((part) => part.length > 0);
    if (parts.indexOf(name) < 0) parts.push(name);
    element.className = parts.join(" ");
  }

  function removeClass(element, name) {
    if (!element) return;
    const list = classListOf(element);
    if (list) {
      list.remove(name);
      return;
    }
    const parts = String(element.className || "")
      .split(/\s+/)
      .filter((part) => part.length > 0 && part !== name);
    element.className = parts.join(" ");
  }

  function setOpacity(element, value) {
    if (!element) return;
    if (element.style && typeof element.style === "object") {
      element.style.opacity = String(value);
    }
  }

  /** Настройки сцены: из options.settings, из options.search или из адреса. */
  function resolveSettings(Config, win, options) {
    const given = options.settings;
    if (given && given.battle && given.stage) return given;
    let search = "";
    if (typeof options.search === "string") {
      search = options.search;
    } else if (win && win.location && typeof win.location.search === "string") {
      search = win.location.search;
    }
    return Config.parseStageSearch(search);
  }

  /**
   * Инициализация страницы-сцены. Возвращает ручку для тестов и main:
   * {switcher, svet, battle, chat, refresh, onMessage, tick, stop}.
   * Без DOM ничего не делает и не падает.
   */
  function init(options) {
    const opts = options && typeof options === "object" ? options : {};
    const win =
      opts.window || (typeof window !== "undefined" ? window : global);
    const document = opts.document || (win && win.document);
    if (!document) return null;

    const Config = SB.Config;
    if (!Config || typeof Config.parseStageSearch !== "function") return null;

    const settings = resolveSettings(Config, win, opts);
    const battle = settings.battle;
    const stage = settings.stage;

    const svetFrame = findElement(document, "svet");
    const battleFrame = findElement(document, "battle");
    // Чужой/пустой документ — это не страница сцены: молча выходим и ничего
    // не запускаем (иначе в тестах мог бы завестись настоящий таймер).
    if (!svetFrame && !battleFrame) return null;

    // Адреса слоёв: «Светлячки» — их ссылка (или наша сборка с каналом),
    // бой — свой index.html с настройками игры (включая demo).
    if (svetFrame) {
      try {
        svetFrame.src = Config.buildSvetUrl(stage, battle);
      } catch (error) {
        // Кривая ссылка не должна ронять сцену.
      }
    }
    if (battleFrame) {
      try {
        battleFrame.src = Config.buildUrl("index.html", battle);
      } catch (error) {
        // Ссылка боя не критична: iframe останется с адресом из разметки.
      }
    }

    const nowFn =
      typeof opts.now === "function"
        ? function () {
            return readNow(opts.now);
          }
        : function () {
            const performance = win && win.performance;
            if (performance && typeof performance.now === "function") {
              return performance.now();
            }
            return Date.now();
          };

    const setTimeoutFn =
      typeof opts.setTimeoutFn === "function"
        ? opts.setTimeoutFn
        : typeof win.setTimeout === "function"
          ? function (fn, ms) {
              return win.setTimeout(fn, ms);
            }
          : function () {
              return 0;
            };
    const clearTimeoutFn =
      typeof opts.clearTimeoutFn === "function"
        ? opts.clearTimeoutFn
        : typeof win.clearTimeout === "function"
          ? function (id) {
              win.clearTimeout(id);
            }
          : function () {};
    const setIntervalFn =
      typeof opts.setIntervalFn === "function"
        ? opts.setIntervalFn
        : typeof win.setInterval === "function"
          ? function (fn, ms) {
              return win.setInterval(fn, ms);
            }
          : null;
    const clearIntervalFn =
      typeof opts.clearIntervalFn === "function"
        ? opts.clearIntervalFn
        : typeof win.clearInterval === "function"
          ? function (id) {
              win.clearInterval(id);
            }
          : function () {};

    const switcher = createSwitcher({
      auto: stage.auto,
      battleIdleMinutes: stage.battleIdle,
      minBattleMs: MIN_BATTLE_MS,
      fadeMs: FADE_MS,
      demo: Boolean(battle.demo),
      now: nowFn(),
    });

    // Таймеры затухания, чтобы слои не мигали при быстрой смене режима.
    const fadeTimers = Object.create(null);

    function clearFade(key) {
      if (fadeTimers[key] === undefined) return;
      const id = fadeTimers[key];
      delete fadeTimers[key];
      try {
        clearTimeoutFn(id);
      } catch (error) {
        // Таймер мог уже сработать.
      }
    }

    function showLayer(frame, key) {
      if (!frame) return;
      clearFade(key);
      removeClass(frame, "is-hidden");
      setOpacity(frame, "1");
    }

    /** Спрятать слой: сначала opacity 0 (плавно), через FADE_MS — is-hidden. */
    function hideLayer(frame, key, immediate) {
      if (!frame) return;
      clearFade(key);
      if (immediate) {
        addClass(frame, "is-hidden");
        setOpacity(frame, "0");
        return;
      }
      removeClass(frame, "is-hidden");
      setOpacity(frame, "0");
      if (FADE_MS > 0) {
        const timer = setTimeoutFn(function () {
          delete fadeTimers[key];
          addClass(frame, "is-hidden");
        }, FADE_MS);
        fadeTimers[key] = timer;
      } else {
        addClass(frame, "is-hidden");
      }
    }

    /** Применить текущий режим к слоям и сообщить бою о видимости. */
    function applyMode() {
      const battleVisible = switcher.mode === "battle";
      if (battleVisible) {
        showLayer(battleFrame, "battle");
        hideLayer(svetFrame, "svet", false);
      } else {
        showLayer(svetFrame, "svet");
        hideLayer(battleFrame, "battle", false);
      }
      postVisibility(frameWindow(battleFrame), battleVisible);
      return battleVisible;
    }

    /** Стартовое состояние: видны «Светлячки», бой скрыт и живёт. */
    function applyInitial() {
      showLayer(svetFrame, "svet");
      hideLayer(battleFrame, "battle", true);
      postVisibility(frameWindow(battleFrame), false);
    }

    /** Сообщение чата: переключатель решает, режим применяется сразу. */
    function handleMessage(message) {
      const result = switcher.onMessage(message);
      if (result && result.changed) applyMode();
      return result;
    }

    /** Тик: по простою или демо-переключению меняет режим. */
    function handleTick(nowMs) {
      const value = typeof nowMs === "number" ? nowMs : nowFn();
      const result = switcher.tick(value);
      if (result && result.changed) applyMode();
      return result;
    }

    // Чат сцены: тот же анонимный клиент, что и у игры. Переключение
    // слушает он один; iframe боя читает чат сам.
    let chat = null;
    const Chat = SB.Chat;
    if (battle.channel && Chat && typeof Chat.Client === "function") {
      try {
        chat = new Chat.Client({
          channel: battle.channel,
          onMessage: handleMessage,
          onStatus: function () {},
        });
        if (typeof chat.start === "function") chat.start();
      } catch (error) {
        chat = null;
      }
    }

    // После загрузки iframe боя повторяем знак видимости: он мог не успеть.
    if (battleFrame && typeof battleFrame.addEventListener === "function") {
      battleFrame.addEventListener("load", function () {
        postVisibility(frameWindow(battleFrame), switcher.mode === "battle");
      });
    }

    applyInitial();

    // Часы сцены: раз в секунду проверяем простой и демо-переключение.
    let intervalId = null;
    if (setIntervalFn) {
      intervalId = setIntervalFn(function () {
        handleTick();
      }, 1000);
    }

    function stop() {
      if (intervalId !== null) {
        clearIntervalFn(intervalId);
        intervalId = null;
      }
      clearFade("svet");
      clearFade("battle");
      if (chat && typeof chat.stop === "function") chat.stop();
      chat = null;
    }

    return {
      switcher: switcher,
      svet: svetFrame,
      battle: battleFrame,
      chat: chat,
      settings: settings,
      refresh: applyMode,
      onMessage: handleMessage,
      tick: handleTick,
      stop: stop,
    };
  }

  SB.Stage = {
    FADE_MS,
    MIN_BATTLE_MS,
    DEMO_SWITCH_MS,
    BATTLE_COMMANDS,
    STAGE_ALIASES,
    createSwitcher,
    postVisibility,
    init,
  };

  // На реальной странице запускаемся сами. В тестах DOM нет (или нет
  // наших iframe) — init не зовём, чтобы не открывать лишних соединений.
  if (
    typeof document !== "undefined" &&
    document &&
    typeof document.getElementById === "function"
  ) {
    try {
      if (document.getElementById("svet") || document.getElementById("battle")) {
        init();
      }
    } catch (error) {
      // Сцена не должна ронять страницу OBS.
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
