"use strict";
// Ники в «Морском бое чата»: маскировка мата и обрезка длины.
//
// Ники показываются как есть — это имена зрителей Twitch. Но если в нике
// есть корень мата из списка «Светлячков для всех», видна только первая
// буква слова, остальное закрывается звёздочками: «хуй_зритель» →
// «х**********». Корни с крышей «^» срабатывают только в начале слова.
//
// Логика взята из «Светлячков» (наш же проект, MIT); для игры оставлены
// только разбор и маска — ники длиннее 16 знаков обрезаются с «…».
//
// Это обычный браузерный скрипт, без модулей: страница должна работать
// и с GitHub Pages, и открытой как локальный файл в OBS.
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Сколько знаков ника видно на экране (ТЗ: до 16).
  const NAME_CHARS = 16;

  // Список корней из «Светлячков». «^» — корень только в начале слова:
  // «^бля» закроет «бля» и «бляху», но не тронет «рубля» и «оскорблять».
  const DEFAULT_ROOTS = Object.freeze([
    "^бля",
    "хуй",
    "хуё",
    "хуе",
    "пизд",
    "^ебат",
    "^ебал",
    "^ебёт",
    "^ёбат",
    "^ёбал",
    "нахуй",
    "^сука",
    "мудак",
    "проеб",
  ]);

  // Слово — непрерывная последовательность букв, цифр и подчёркиваний.
  // Проверяем по одной кодовой точке, поэтому эмодзи слово разбивают.
  const WORD_CHAR_RE = /^[\p{L}\p{N}_]$/u;

  function _isWordChar(char) {
    return WORD_CHAR_RE.test(char);
  }

  // Регистр складываем обычным toLowerCase: для кириллицы и латиницы
  // этого достаточно, а экзотические свёртки в никах не встречаются.
  function _fold(text) {
    return text.toLowerCase();
  }

  // Все последовательности пробельных символов (включая переводы строк)
  // превращаются в один пробел, пробелы по краям убираются.
  function collapseSpaces(text) {
    return String(text == null ? "" : text)
      .split(/\s+/)
      .filter(function (piece) {
        return piece.length > 0;
      })
      .join(" ");
  }

  // JavaScript режет строку по единицам UTF-16, поэтому длину и срез
  // всегда считаем через Array.from — по кодовым точкам.
  function shorten(text, limit) {
    const max = limit === undefined ? NAME_CHARS : limit;
    const chars = Array.from(collapseSpaces(text));
    if (max <= 0) return "";
    return chars.slice(0, max).join("");
  }

  // Привести корни к нижнему регистру, отбросив пустые. Для каждого
  // корня запоминаем, привязан ли он к началу слова (крыша «^»).
  function _prepareRoots(roots) {
    if (roots == null) return [];
    const list = typeof roots === "string" ? [roots] : roots;
    if (!Array.isArray(list)) return [];
    const prepared = [];
    for (const root of list) {
      if (typeof root !== "string") continue;
      let folded = _fold(root.trim());
      if (!folded) continue;
      const atStart = folded.startsWith("^");
      if (atStart) folded = folded.slice(1);
      if (!folded) continue;
      prepared.push({ root: folded, atStart: atStart });
    }
    return prepared;
  }

  // Привести слова-исключения к нижнему регистру: сравниваем целые слова.
  function _prepareExceptions(exceptions) {
    const ignored = new Set();
    if (exceptions == null) return ignored;
    const list = typeof exceptions === "string" ? [exceptions] : exceptions;
    if (!Array.isArray(list)) return ignored;
    for (const word of list) {
      if (typeof word !== "string") continue;
      const folded = _fold(word.trim());
      if (folded) ignored.add(folded);
    }
    return ignored;
  }

  /**
   * Закрыть звёздочками слова, содержащие корень, кроме исключений.
   *
   * У найденного слова остаётся первый символ, остальные заменяются на
   * «*». Корень с «^» ищется только в начале слова; слово из exceptions
   * не закрывается никогда. Регистр не важен, пустые корни игнорируются.
   */
  function maskRoots(text, roots, exceptions) {
    const source = text == null ? "" : String(text);
    const prepared = _prepareRoots(roots);
    const ignored = _prepareExceptions(exceptions);
    if (prepared.length === 0 || source === "") return source;

    const chars = Array.from(source);
    const parts = [];
    let index = 0;
    while (index < chars.length) {
      if (!_isWordChar(chars[index])) {
        parts.push(chars[index]);
        index += 1;
        continue;
      }

      let end = index + 1;
      while (end < chars.length && _isWordChar(chars[end])) end += 1;

      const wordChars = chars.slice(index, end);
      const word = wordChars.join("");
      const folded = _fold(word);
      let masked = false;
      if (!ignored.has(folded)) {
        for (const item of prepared) {
          const hit = item.atStart
            ? folded.startsWith(item.root)
            : folded.includes(item.root);
          if (hit) {
            masked = true;
            break;
          }
        }
      }
      parts.push(masked ? wordChars[0] + "*".repeat(wordChars.length - 1) : word);
      index = end;
    }
    return parts.join("");
  }

  /**
   * Подготовить ник к показу: схлопнуть пробелы, скрыть мат, обрезать.
   * Длиннее limit знаков — обрезаем и ставим «…».
   */
  function shortName(name, roots, exceptions, limit) {
    const max = limit === undefined ? NAME_CHARS : limit;
    const cleaned = collapseSpaces(name);
    const masked = maskRoots(cleaned, roots, exceptions);
    const chars = Array.from(masked);
    if (chars.length > max) {
      const keep = Math.max(0, max - 1);
      return chars.slice(0, keep).join("") + "…";
    }
    return masked;
  }

  SB.Mask = {
    NAME_CHARS,
    DEFAULT_ROOTS,
    collapseSpaces,
    shorten,
    maskRoots,
    shortName,
  };
})(typeof window !== "undefined" ? window : globalThis);
