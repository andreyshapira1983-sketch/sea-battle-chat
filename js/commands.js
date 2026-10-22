/* «Морской бой чата»: команды зрителей и стримера.
 *
 * Здесь только разбор текста сообщения и права: что за команда, какой у
 * неё аргумент, сколько ждать до следующей. Сам мир игры (корабли, урон,
 * раунды) живёт в js/game.js и зовёт эти функции.
 *
 * Команды пишутся по-русски, но принимаются и латиницей, регистр любой:
 * «!Огонь Вася», «!fire @vAsya» — одно и то же.
 *
 * Файл — обычный браузерный скрипт (без import/export).
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Слово из чата -> каноническое имя команды.
  const ALIASES = Object.freeze({
    "огонь": "fire",
    fire: "fire",
    "вперёд": "right",
    "вперед": "right",
    right: "right",
    forward: "right",
    "назад": "left",
    left: "left",
    back: "left",
    "щит": "shield",
    shield: "shield",
    "ремонт": "repair",
    repair: "repair",
    "играть": "join",
    join: "join",
    "уйти": "leave",
    leave: "leave",
    "раунд": "round",
    round: "round",
    "пауза": "pause",
    pause: "pause",
    "продолжить": "resume",
    resume: "resume",
    "очистить": "clear",
    clear: "clear",
  });

  const PLAYER_COMMANDS = Object.freeze([
    "fire",
    "right",
    "left",
    "shield",
    "repair",
    "join",
    "leave",
  ]);
  const MODERATOR_COMMANDS = Object.freeze([
    "round",
    "pause",
    "resume",
    "clear",
  ]);

  // Своя пауза у каждой команды зрителя, секунды (ТЗ §4).
  const COOLDOWN_SEC = Object.freeze({
    fire: 6,
    right: 6,
    left: 6,
    shield: 20,
    repair: 30,
    join: 6,
    leave: 6,
  });

  const DEFAULT_COOLDOWN_SEC = 6;

  function isModeratorCommand(name) {
    return MODERATOR_COMMANDS.indexOf(name) >= 0;
  }

  function isPlayerCommand(name) {
    return PLAYER_COMMANDS.indexOf(name) >= 0;
  }

  // Знаки, которые зрители прилепляют к команде и нику: «!огонь!», «!щит.»,
  // «!ремонт?» — команда от этого не меняется.
  const TRAILING_PUNCT = /[,\.!?;:…]+$/;
  // Где кончается слово команды: пробел или , ; : — эти знаки работают
  // как пробел перед ником, «!огонь,Вася» = «!огонь Вася».
  const WORD_END = /[\s,;:]/;

  /**
   * Разобрать сообщение чата.
   *
   * Возвращает { name, arg, raw } или null. Команда — только с «!»;
   * знаки .,!?;:… после слова не мешают, а , ; : сразу после него отделяют
   * ник; «!огоньвася», слово из одних знаков — не команда; @/# снимаем.
   */
  function parse(text) {
    const raw = String(text == null ? "" : text).trim();
    if (raw.charAt(0) !== "!") return null;
    const body = raw.slice(1).trim();
    if (!body) return null;

    const wordEnd = body.search(WORD_END);
    const wordRaw = wordEnd < 0 ? body : body.slice(0, wordEnd);
    const word = wordRaw.replace(TRAILING_PUNCT, "").toLowerCase();
    if (!word) return null;
    if (!Object.prototype.hasOwnProperty.call(ALIASES, word)) return null;
    const name = ALIASES[word];

    let arg = wordEnd < 0 ? "" : body.slice(wordEnd).trim();
    arg = arg.replace(/^[,;:]+/, "").trim();
    arg = arg.replace(/^[@#]+/, "").trim();
    arg = arg.replace(TRAILING_PUNCT, "").trim();
    return { name, arg, raw };
  }

  /**
   * Пауза команды в секундах: у каждой своя, но не меньше настройки
   * «cooldown» и не меньше требования ТЗ (щит 20 с, ремонт 30 с).
   * Модераторские команды паузы не имеют.
   */
  function cooldownSeconds(name, settingsCooldown) {
    if (isModeratorCommand(name)) return 0;
    const configured = Number(settingsCooldown);
    const base =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_COOLDOWN_SEC;
    const own = COOLDOWN_SEC[name];
    if (own === undefined) return base;
    return Math.max(own, base);
  }

  function foldName(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  /**
   * Совпадает ли ник с аргументом команды. Сравниваем без регистра и
   * пробелов по краям; можно передать несколько вариантов ника (логин и
   * отображаемое имя) — подойдёт любой.
   */
  function targetMatches(names, arg) {
    const wanted = foldName(arg);
    if (!wanted) return false;
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      if (foldName(name) === wanted) return true;
    }
    return false;
  }

  SB.Commands = {
    ALIASES,
    PLAYER_COMMANDS,
    MODERATOR_COMMANDS,
    COOLDOWN_SEC,
    DEFAULT_COOLDOWN_SEC,
    isModeratorCommand,
    isPlayerCommand,
    parse,
    cooldownSeconds,
    targetMatches,
  };
})(typeof window !== "undefined" ? window : globalThis);
