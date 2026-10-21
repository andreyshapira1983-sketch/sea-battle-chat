/* «Морской бой чата»: настройки страницы.
 *
 * Настройки живут в адресе: конструктор собирает ссылку, а страница игры
 * её разбирает. Здесь только перевод между адресом и понятным набором
 * значений — сам мир игры настраивается в js/game.js.
 *
 * Файл — обычный браузерный скрипт (без import/export): страница должна
 * работать и с GitHub Pages, и открытая как локальный файл в OBS.
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Пределы из ТЗ. Всё, что не входит в них, заменяется значением по
  // умолчанию: ссылку может править кто угодно, а вид ломаться не должен.
  const SEA_HEIGHT_MIN = 15;
  const SEA_HEIGHT_MAX = 60;
  const SHIP_SCALE_MIN = 0.6;
  const SHIP_SCALE_MAX = 2;
  const MAX_SHIPS_MIN = 5;
  const MAX_SHIPS_MAX = 60;
  const COOLDOWN_MIN = 2;
  const COOLDOWN_MAX = 30;
  const IDLE_MINUTES_MIN = 1;
  const IDLE_MINUTES_MAX = 180;
  const ROUND_PAUSE_MIN = 1;
  const ROUND_PAUSE_MAX = 120;
  const CHANNEL_PATTERN = /^[a-z0-9_]{1,25}$/;

  // Общая сцена для OBS: «Светлячки» уже опубликованы, их адрес — по
  // умолчанию. Человек может указать свой: параметр svet_url.
  const SVET_DEFAULT_URL =
    "https://andreyshapira1983-sketch.github.io/svetlyachki/index.html";
  const BATTLE_IDLE_MIN = 1;
  const BATTLE_IDLE_MAX = 120;
  const BATTLE_IDLE_DEFAULT = 3;
  const SVET_BACKDROP_MAX = 80;
  const SVET_URL_MAX_LENGTH = 500;
  // Темы «Светлячков» — только те, что понимает их конструктор.
  const SVET_THEME_ALIASES = {
    city: "city",
    "город": "city",
    meadow: "meadow",
    "лужайка": "meadow",
    space: "space",
    "космос": "space",
    none: "none",
    "пусто": "none",
  };

  const THEME_ALIASES = {
    sea: "sea",
    "море": "sea",
    none: "none",
    "пусто": "none",
  };
  const JOIN_ALIASES = {
    chat: "chat",
    "чат": "chat",
    command: "command",
    "команда": "command",
  };
  const LANG_ALIASES = {
    ru: "ru",
    "рус": "ru",
    en: "en",
    "англ": "en",
  };

  const TRUE_VALUES = ["true", "1", "вкл", "да", "on", "yes"];
  const FALSE_VALUES = ["false", "0", "выкл", "нет", "off", "no"];

  // Настройки по умолчанию: всё, чего нет в ссылке, берётся отсюда.
  const DEFAULT_SETTINGS = Object.freeze({
    channel: "",
    theme: "sea",
    seaHeight: 30,
    shipScale: 1,
    maxShips: 30,
    join: "chat",
    cooldown: 6,
    idleMinutes: 5,
    roundPause: 10,
    leaderboard: true,
    lang: "ru",
    demo: false,
  });

  // Настройки общей сцены stage.html поверх настроек боя.
  const STAGE_DEFAULTS = Object.freeze({
    auto: true,
    battleIdle: BATTLE_IDLE_DEFAULT,
    svetUrl: SVET_DEFAULT_URL,
    svetTheme: "",
    svetBackdrop: 0,
  });

  // ------------------------------------------------------------------
  // Мелкие помощники
  // ------------------------------------------------------------------
  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function round(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function toNumber(value) {
    // Русская запись «0,6» тоже должна работать.
    const raw = text(value).replace(",", ".");
    if (!raw) return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function boolValue(value) {
    // Флаг: true/false, вкл/выкл, 1/0. Непонятное — null.
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const raw = text(value).toLowerCase();
    if (TRUE_VALUES.indexOf(raw) >= 0) return true;
    if (FALSE_VALUES.indexOf(raw) >= 0) return false;
    return null;
  }

  function enumValue(value, aliases) {
    const raw = text(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : null;
  }

  function themeValue(value) {
    return enumValue(value, THEME_ALIASES);
  }

  function joinValue(value) {
    return enumValue(value, JOIN_ALIASES);
  }

  function langValue(value) {
    return enumValue(value, LANG_ALIASES);
  }

  // ------------------------------------------------------------------
  // Разбор чисел из ссылки и из формы конструктора
  // ------------------------------------------------------------------
  function seaHeightValue(value) {
    // Высота моря: проценты 15–60. «0,3» — это те же 30 %.
    let number = toNumber(value);
    if (number === null) return null;
    if (number > 0 && number <= 1) number *= 100;
    if (number < SEA_HEIGHT_MIN || number > SEA_HEIGHT_MAX) return null;
    return Math.round(number);
  }

  function shipScaleValue(value) {
    const number = toNumber(value);
    if (number === null || number < SHIP_SCALE_MIN || number > SHIP_SCALE_MAX) {
      return null;
    }
    return round(number, 2);
  }

  function maxShipsValue(value) {
    const number = toNumber(value);
    if (number === null || number < MAX_SHIPS_MIN || number > MAX_SHIPS_MAX) {
      return null;
    }
    return Math.round(number);
  }

  function cooldownValue(value) {
    const number = toNumber(value);
    if (number === null || number < COOLDOWN_MIN || number > COOLDOWN_MAX) {
      return null;
    }
    return round(number, 1);
  }

  function idleMinutesValue(value) {
    const number = toNumber(value);
    if (number === null || number < IDLE_MINUTES_MIN || number > IDLE_MINUTES_MAX) {
      return null;
    }
    return Math.round(number);
  }

  function roundPauseValue(value) {
    const number = toNumber(value);
    if (number === null || number < ROUND_PAUSE_MIN || number > ROUND_PAUSE_MAX) {
      return null;
    }
    return Math.round(number);
  }

  function normalizeChannel(value) {
    // Принимает «имя», «@имя», «#имя», «twitch.tv/имя» и полный адрес
    // канала. Возвращает логин в нижнем регистре или пустую строку.
    let raw = text(value);
    if (!raw) return "";
    raw = raw.replace(/^https?:\/\//i, "");
    // Сначала снимаем ведущие @ и # — иначе «#имя» ниже примем за якорь.
    raw = raw.replace(/^[@#]+/, "");
    const slash = raw.indexOf("/");
    if (slash >= 0) {
      // Отбрасываем домен и служебные хвосты вроде ?sr=a или /videos.
      raw = raw.slice(slash + 1);
      raw = raw.replace(/[?#].*$/, "");
      raw = raw.split("/")[0];
    } else {
      raw = raw.replace(/[?#].*$/, "");
    }
    raw = raw.trim().toLowerCase();
    return CHANNEL_PATTERN.test(raw) ? raw : "";
  }

  // ------------------------------------------------------------------
  // Разбор адреса страницы
  // ------------------------------------------------------------------
  function splitSearch(search) {
    // Строка запроса в виде «?a=b&c=d» или «a=b»; без формы URL.
    let raw = String(search === null || search === undefined ? "" : search);
    const hash = raw.indexOf("#");
    if (hash >= 0) raw = raw.slice(0, hash);
    const question = raw.indexOf("?");
    if (question >= 0) raw = raw.slice(question + 1);
    const result = Object.create(null);
    if (!raw) return result;
    for (const pair of raw.split("&")) {
      if (!pair) continue;
      const equals = pair.indexOf("=");
      const key = equals < 0 ? pair : pair.slice(0, equals);
      const value = equals < 0 ? "" : pair.slice(equals + 1);
      let name = key;
      let decoded = value;
      try {
        name = decodeURIComponent(key.replace(/\+/g, " "));
      } catch (error) {
        name = key;
      }
      try {
        decoded = decodeURIComponent(value.replace(/\+/g, " "));
      } catch (error) {
        decoded = value;
      }
      if (name) result[name] = decoded;
    }
    return result;
  }

  function pick(params, names) {
    // Первое из имён параметров, которое вообще есть в адресе.
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
    }
    return undefined;
  }

  // ------------------------------------------------------------------
  // Сборка полного набора значений
  // ------------------------------------------------------------------
  // Каждое поле разбирается одинаково: мусор -> значение по умолчанию.
  function assignEnum(settings, raw, parser, field, fallback) {
    if (raw === undefined) return;
    const parsed = parser(raw);
    if (parsed !== null) settings[field] = parsed;
    else settings[field] = fallback;
  }

  function parseSearch(search) {
    // Всегда возвращает полный набор: битая ссылка не ломает картинку.
    const params = splitSearch(search);
    const settings = Object.assign({}, DEFAULT_SETTINGS);

    const channel = pick(params, ["channel", "twitch", "канал"]);
    if (channel !== undefined) settings.channel = normalizeChannel(channel);

    assignEnum(settings, pick(params, ["theme", "тема"]), themeValue, "theme",
      DEFAULT_SETTINGS.theme);
    assignEnum(settings, pick(params, ["join", "вход"]), joinValue, "join",
      DEFAULT_SETTINGS.join);
    assignEnum(settings, pick(params, ["lang", "язык"]), langValue, "lang",
      DEFAULT_SETTINGS.lang);

    const numbers = [
      ["sea_height", ["sea_height", "высота_моря"], seaHeightValue, "seaHeight"],
      ["ship_scale", ["ship_scale", "размер"], shipScaleValue, "shipScale"],
      ["max_ships", ["max_ships", "кораблей"], maxShipsValue, "maxShips"],
      ["cooldown", ["cooldown", "пауза"], cooldownValue, "cooldown"],
      ["idle_minutes", ["idle_minutes", "неактивность"], idleMinutesValue, "idleMinutes"],
      ["round_pause", ["round_pause", "пауза_раунда"], roundPauseValue, "roundPause"],
    ];
    for (const [name, aliases, parser, field] of numbers) {
      if (!Object.prototype.hasOwnProperty.call(params, name) &&
          pick(params, aliases) === undefined) {
        continue;
      }
      const raw = pick(params, aliases);
      const parsed = parser(raw);
      settings[field] = parsed === null ? DEFAULT_SETTINGS[field] : parsed;
    }

    for (const [param, field] of [
      ["leaderboard", "leaderboard"],
      ["demo", "demo"],
    ]) {
      if (!Object.prototype.hasOwnProperty.call(params, param)) continue;
      const flag = boolValue(params[param]);
      settings[field] = flag === null ? DEFAULT_SETTINGS[field] : flag;
    }
    return settings;
  }

  function parseUrl(url) {
    // Настройки из полного адреса — те же, что из location.search.
    const raw = text(url);
    const question = raw.indexOf("?");
    return parseSearch(question < 0 ? "" : raw.slice(question));
  }

  function sanitize(settings) {
    // Привести произвольный набор значений (в том числе строки формы)
    // к полному и допустимому. Непонятное заменяется умолчанием.
    const source = settings && typeof settings === "object" ? settings : {};
    const result = Object.assign({}, DEFAULT_SETTINGS);

    result.channel = normalizeChannel(source.channel);

    result.theme = themeValue(source.theme) || DEFAULT_SETTINGS.theme;
    result.join = joinValue(source.join) || DEFAULT_SETTINGS.join;
    result.lang = langValue(source.lang) || DEFAULT_SETTINGS.lang;

    const numbers = [
      [seaHeightValue, "seaHeight"],
      [shipScaleValue, "shipScale"],
      [maxShipsValue, "maxShips"],
      [cooldownValue, "cooldown"],
      [idleMinutesValue, "idleMinutes"],
      [roundPauseValue, "roundPause"],
    ];
    for (const [parser, field] of numbers) {
      const parsed = parser(source[field]);
      result[field] = parsed === null ? DEFAULT_SETTINGS[field] : parsed;
    }

    for (const field of ["leaderboard", "demo"]) {
      const flag = boolValue(source[field]);
      result[field] = flag === null ? DEFAULT_SETTINGS[field] : flag;
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Сборка ссылки
  // ------------------------------------------------------------------
  function buildSearch(settings) {
    // Короткая ссылка: значения по умолчанию не пишем вовсе.
    const s = sanitize(settings);
    const pairs = [];
    const push = (name, value) => pairs.push(name + "=" + encodeURIComponent(value));
    if (s.channel) push("channel", s.channel);
    if (s.theme !== DEFAULT_SETTINGS.theme) push("theme", s.theme);
    if (s.seaHeight !== DEFAULT_SETTINGS.seaHeight) {
      push("sea_height", String(s.seaHeight));
    }
    if (s.shipScale !== DEFAULT_SETTINGS.shipScale) {
      push("ship_scale", String(s.shipScale));
    }
    if (s.maxShips !== DEFAULT_SETTINGS.maxShips) {
      push("max_ships", String(s.maxShips));
    }
    if (s.join !== DEFAULT_SETTINGS.join) push("join", s.join);
    if (s.cooldown !== DEFAULT_SETTINGS.cooldown) {
      push("cooldown", String(s.cooldown));
    }
    if (s.idleMinutes !== DEFAULT_SETTINGS.idleMinutes) {
      push("idle_minutes", String(s.idleMinutes));
    }
    if (s.roundPause !== DEFAULT_SETTINGS.roundPause) {
      push("round_pause", String(s.roundPause));
    }
    if (!s.leaderboard) push("leaderboard", "0");
    if (s.lang !== DEFAULT_SETTINGS.lang) push("lang", s.lang);
    if (s.demo) push("demo", "1");
    return pairs.join("&");
  }

  function stripQuery(url) {
    // Адрес без строки запроса и якоря: база, к которой добавим настройки.
    let raw = text(url);
    if (!raw) return "";
    const hash = raw.indexOf("#");
    if (hash >= 0) raw = raw.slice(0, hash);
    const question = raw.indexOf("?");
    if (question >= 0) raw = raw.slice(0, question);
    return raw;
  }

  function buildUrl(baseUrl, settings) {
    // Ссылка для OBS: базовый адрес страницы плюс настройки.
    const base = stripQuery(baseUrl) || "index.html";
    const query = buildSearch(settings);
    return query ? base + "?" + query : base;
  }

  function summary(settings) {
    // Короткое человеческое описание — пригодится конструктору и тестам.
    const s = sanitize(settings);
    const themes = { sea: "море", none: "без моря" };
    const langs = { ru: "русский", en: "английский" };
    const joins = { chat: "любое сообщение", command: "только !играть" };
    const parts = [];
    if (s.channel) parts.push("канал " + s.channel);
    parts.push("тема «" + (themes[s.theme] || s.theme) + "»");
    parts.push("море " + s.seaHeight + "%");
    parts.push("до " + s.maxShips + " кораблей");
    parts.push("вход: " + (joins[s.join] || s.join));
    if (!s.leaderboard) parts.push("без таблицы");
    parts.push(langs[s.lang] || s.lang);
    if (s.demo) parts.push("демо");
    return parts.join(", ");
  }

  // ------------------------------------------------------------------
  // Общая сцена stage.html: настройки боя + «Светлячки» + переключение
  // ------------------------------------------------------------------
  function svetThemeValue(value) {
    const raw = text(value).toLowerCase();
    if (!raw) return "";
    return Object.prototype.hasOwnProperty.call(SVET_THEME_ALIASES, raw)
      ? SVET_THEME_ALIASES[raw]
      : null;
  }

  function battleIdleValue(value) {
    const number = toNumber(value);
    if (number === null || number < BATTLE_IDLE_MIN || number > BATTLE_IDLE_MAX) {
      return null;
    }
    return Math.round(number);
  }

  function svetBackdropValue(value) {
    // Подложка неба «Светлячков»: проценты 0–80 (0 — прозрачно).
    let number = toNumber(value);
    if (number === null) return null;
    if (number > 0 && number <= 1) number *= 100;
    if (number < 0 || number > SVET_BACKDROP_MAX) return null;
    return Math.round(number);
  }

  function svetUrlValue(value) {
    // Готовая ссылка «Светлячков»: только http(s), без пробелов.
    const raw = text(value);
    if (!raw) return SVET_DEFAULT_URL;
    if (raw.length > SVET_URL_MAX_LENGTH) return SVET_DEFAULT_URL;
    if (!/^https?:\/\/[^\s]+$/i.test(raw)) return SVET_DEFAULT_URL;
    return raw;
  }

  function sanitizeStage(stage) {
    // Привести произвольный набор к полному и допустимому.
    const source = stage && typeof stage === "object" ? stage : {};
    const result = Object.assign({}, STAGE_DEFAULTS);
    const auto = boolValue(source.auto);
    result.auto = auto === null ? STAGE_DEFAULTS.auto : auto;
    const idle = battleIdleValue(source.battleIdle);
    result.battleIdle = idle === null ? STAGE_DEFAULTS.battleIdle : idle;
    result.svetUrl = svetUrlValue(source.svetUrl);
    const theme = svetThemeValue(source.svetTheme);
    result.svetTheme = theme === null ? STAGE_DEFAULTS.svetTheme : theme;
    const backdrop = svetBackdropValue(source.svetBackdrop);
    result.svetBackdrop =
      backdrop === null ? STAGE_DEFAULTS.svetBackdrop : backdrop;
    return result;
  }

  function parseStageSearch(search) {
    // Настройки сцены: параметры боя разбираются как обычно, поверх них —
    // auto, battle_idle, svet_url, svet_theme, svet_backdrop.
    const params = splitSearch(search);
    const battle = parseSearch(search);
    const stage = sanitizeStage({
      auto: params.auto,
      battleIdle: params.battle_idle,
      svetUrl: params.svet_url,
      svetTheme: params.svet_theme,
      svetBackdrop: params.svet_backdrop,
    });
    return { battle, stage };
  }

  function buildSvetUrl(stage, battle) {
    // Ссылка для iframe «Светлячков». Готовая чужая ссылка передаётся как
    // есть; к нашей по умолчанию добавляем канал и настройки вида.
    const s = sanitizeStage(stage);
    const b = sanitize(battle);
    if (s.svetUrl !== SVET_DEFAULT_URL) return s.svetUrl;
    const pairs = [];
    if (b.channel) pairs.push("channel=" + encodeURIComponent(b.channel));
    // В демо «Светлячки» тоже без канала — иначе они просят его указать.
    if (b.demo && !b.channel) pairs.push("demo=1");
    if (s.svetTheme) pairs.push("theme=" + encodeURIComponent(s.svetTheme));
    if (s.svetBackdrop > 0) {
      pairs.push("backdrop=" + encodeURIComponent(String(s.svetBackdrop)));
    }
    return pairs.length ? s.svetUrl + "?" + pairs.join("&") : s.svetUrl;
  }

  function buildStageSearch(battle, stage) {
    // Одна ссылка для OBS: параметры боя + настройки сцены. Умолчания
    // сцены не пишем, как и умолчания боя.
    const s = sanitizeStage(stage);
    const pairs = [];
    const base = buildSearch(battle);
    if (base) pairs.push(base);
    if (!s.auto) pairs.push("auto=0");
    if (s.battleIdle !== STAGE_DEFAULTS.battleIdle) {
      pairs.push("battle_idle=" + s.battleIdle);
    }
    if (s.svetUrl !== SVET_DEFAULT_URL) {
      pairs.push("svet_url=" + encodeURIComponent(s.svetUrl));
    }
    if (s.svetTheme) pairs.push("svet_theme=" + encodeURIComponent(s.svetTheme));
    if (s.svetBackdrop > 0) {
      pairs.push("svet_backdrop=" + s.svetBackdrop);
    }
    return pairs.join("&");
  }

  function buildStageUrl(baseUrl, battle, stage) {
    const base = stripQuery(baseUrl) || "stage.html";
    const query = buildStageSearch(battle, stage);
    return query ? base + "?" + query : base;
  }

  function stageSummary(battle, stage) {
    // Короткое описание сцены для конструктора.
    const s = sanitizeStage(stage);
    const parts = [summary(battle)];
    parts.push(s.auto ? "бой сам включается по команде" : "только по !бой");
    parts.push("возврат через " + s.battleIdle + " мин");
    parts.push(
      s.svetUrl === SVET_DEFAULT_URL ? "Светлячки по умолчанию" : "свои Светлячки"
    );
    return parts.join("; ");
  }

  SB.Config = {
    DEFAULT_SETTINGS,
    STAGE_DEFAULTS,
    SVET_DEFAULT_URL,
    BATTLE_IDLE_MIN,
    BATTLE_IDLE_MAX,
    BATTLE_IDLE_DEFAULT,
    SVET_BACKDROP_MAX,
    SVET_THEME_ALIASES,
    SEA_HEIGHT_MIN,
    SEA_HEIGHT_MAX,
    SHIP_SCALE_MIN,
    SHIP_SCALE_MAX,
    MAX_SHIPS_MIN,
    MAX_SHIPS_MAX,
    COOLDOWN_MIN,
    COOLDOWN_MAX,
    IDLE_MINUTES_MIN,
    IDLE_MINUTES_MAX,
    ROUND_PAUSE_MIN,
    ROUND_PAUSE_MAX,
    CHANNEL_PATTERN,
    THEME_ALIASES,
    JOIN_ALIASES,
    LANG_ALIASES,
    clamp,
    round,
    boolValue,
    themeValue,
    joinValue,
    langValue,
    seaHeightValue,
    shipScaleValue,
    maxShipsValue,
    cooldownValue,
    idleMinutesValue,
    roundPauseValue,
    normalizeChannel,
    splitSearch,
    parseSearch,
    parseUrl,
    sanitize,
    buildSearch,
    buildUrl,
    stripQuery,
    summary,
    svetThemeValue,
    battleIdleValue,
    svetBackdropValue,
    svetUrlValue,
    sanitizeStage,
    parseStageSearch,
    buildSvetUrl,
    buildStageSearch,
    buildStageUrl,
    stageSummary,
  };
})(typeof window !== "undefined" ? window : globalThis);
