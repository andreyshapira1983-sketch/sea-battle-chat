/* «Морской бой чата»: конструктор ссылки для OBS.
 *
 * Страница builder.html собирает настройки из формы, показывает живой
 * предпросмотр и отдаёт готовые ссылки для источника «Браузер» в OBS:
 * отдельно «Морской бой» (index.html) и — по желанию — общий источник
 * «Светлячки + Морской бой» (stage.html).
 *
 * Здесь нет мира и рисования: только значения формы, ссылки и
 * предпросмотр.
 *
 * Файл — обычный браузерный скрипт (без модулей): страница должна
 * работать и с GitHub Pages, и открытая как локальный файл.
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});
  const Config = SB.Config;

  // Страницы рядом с конструктором. Ссылки строятся относительно них,
  // поэтому конструктор годится и для GitHub Pages, и для локального
  // файла в OBS.
  const PAGE = "index.html";
  const STAGE_PAGE = "stage.html";
  const PREVIEW_DELAY = 120; // не чаще восьми обновлений предпросмотра в секунду
  const STATUS_TIMEOUT = 6000;

  // Три шага вставки ссылки в OBS — по строке на шаг.
  const STEPS = [
    "OBS → «Источники» → «+» → «Браузер»",
    "Вставьте ссылку в поле «URL»",
    "Ширина 1920, высота 1080 → «ОК»",
  ];

  const CHANNEL_HINT =
    "Впишите имя, @имя или ссылку twitch.tv/имя — логин возьмём из неё.";

  const AUTO_HINT_ON =
    "Команда боя от зрителя сама включает море. Выключите — бой будет " +
    "включать только стример командой !бой.";
  const AUTO_HINT_OFF =
    "Автозапуск выключен: море включает только стример или модератор " +
    "командой !бой.";

  // Подпись под предпросмотром: у боя и у общей сцены она разная.
  const PREVIEW_NOTES = {
    battle:
      "Шахматка показывает прозрачность: в OBS фон вне моря будет " +
      "прозрачным. Здесь играют придуманные зрители, в OBS будут сообщения " +
      "вашего чата.",
    stage:
      "Общий источник: в демо сцена сама меняет режимы каждые 20 секунд. " +
      "В OBS «Светлячки» видны обычно, а по командам боя сцена плавно " +
      "переключается на море.",
  };

  // ------------------------------------------------------------------
  // Чистые функции боя: значения формы → настройки → ссылки
  // ------------------------------------------------------------------
  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function defaultValues() {
    // Значения формы по умолчанию. Числа — строками: именно так их отдаёт
    // DOM, а SB.Config.sanitize умеет превращать строки в числа.
    const defaults = Config.DEFAULT_SETTINGS;
    return {
      channel: defaults.channel,
      theme: defaults.theme,
      seaHeight: String(defaults.seaHeight),
      shipScale: String(defaults.shipScale),
      maxShips: String(defaults.maxShips),
      join: defaults.join,
      cooldown: String(defaults.cooldown),
      idleMinutes: String(defaults.idleMinutes),
      roundPause: String(defaults.roundPause),
      leaderboard: defaults.leaderboard,
      lang: defaults.lang,
      demo: defaults.demo,
    };
  }

  function valuesToSettings(values) {
    // Значения формы (строки, флаги) приводим к полному допустимому
    // набору. Мусор и числа вне пределов заменяются умолчаниями — так
    // одна и та же логика работает и для формы, и для адреса страницы.
    return Config.sanitize(isObject(values) ? values : {});
  }

  function previewSettings(settings) {
    // В предпросмотре демо включено всегда и канал не нужен: играть
    // должны придуманные зрители, а не настоящий чат.
    return Config.sanitize(
      Object.assign({}, valuesToSettings(settings), { channel: "", demo: true }),
    );
  }

  function buildPreviewUrl(settings) {
    // Живой предпросмотр боя: всегда index.html?demo=1&…
    return Config.buildUrl(PAGE, previewSettings(settings));
  }

  function resolvePage(page, baseUrl) {
    // Адрес страницы `page` рядом с адресом `baseUrl`: и на GitHub Pages,
    // и у локального файла.
    if (!page) page = PAGE;
    if (!baseUrl) return page;
    const clean = Config.stripQuery(baseUrl);
    if (!clean) return page;
    try {
      if (typeof URL === "function") return new URL(page, clean).href;
    } catch (error) {
      // Ниже — запасной путь для необычных адресов.
    }
    if (/\.html?$/i.test(clean)) return clean.replace(/[^/]*$/, page);
    if (/\/$/.test(clean)) return clean + page;
    return clean + "/" + page;
  }

  function pageBase(baseUrl) {
    return resolvePage(PAGE, baseUrl);
  }

  function locationPage(page) {
    // Из адреса конструктора получаем адрес соседней страницы.
    if (typeof location === "undefined" || !location || !location.href) {
      return page || PAGE;
    }
    return resolvePage(page || PAGE, String(location.href));
  }

  function locationBase() {
    return locationPage(PAGE);
  }

  function buildObsUrl(settings, baseUrl) {
    // Ссылка для OBS: demo попадает в неё только если его включили.
    return Config.buildUrl(pageBase(baseUrl), valuesToSettings(settings));
  }

  function summary(settings) {
    // Короткое человеческое описание — то же, что SB.Config.summary.
    return Config.summary(valuesToSettings(settings));
  }

  // ------------------------------------------------------------------
  // Чистые функции общей сцены: «Светлячки + Морской бой»
  // ------------------------------------------------------------------
  function defaultStageValues() {
    // Значения формы новой секции. Пустая ссылка «Светлячков» означает
    // адрес по умолчанию: его подставит SB.Config.sanitizeStage.
    const defaults = Config.STAGE_DEFAULTS;
    return {
      stageEnabled: false,
      svetUrl: "",
      svetTheme: defaults.svetTheme || "",
      svetBackdrop: String(defaults.svetBackdrop),
      auto: defaults.auto,
      battleIdle: String(defaults.battleIdle),
    };
  }

  function stageValuesToSettings(values) {
    // Значения формы сцены → допустимый набор. Работает и с уже
    // приготовленными настройками (тогда ничего не меняется).
    const source = isObject(values) ? values : {};
    return Config.sanitizeStage({
      auto: source.auto,
      battleIdle: source.battleIdle,
      svetUrl: source.svetUrl,
      svetTheme: source.svetTheme,
      svetBackdrop: source.svetBackdrop,
    });
  }

  function isStageOn(values) {
    const source = isObject(values) ? values : {};
    return Config.boolValue(source.stageEnabled) === true;
  }

  function stageParts(values) {
    // Из одних значений формы получаем и настройки боя, и настройки сцены:
    // лишние ключи SB.Config просто игнорирует.
    const source = isObject(values) ? values : {};
    return {
      battle: valuesToSettings(source),
      stage: stageValuesToSettings(source),
    };
  }

  function buildStageUrl(first, second) {
    // Можно передать значения формы целиком либо пару
    // (настройки боя, настройки сцены).
    if (isObject(second)) {
      return Config.buildStageUrl(
        STAGE_PAGE,
        valuesToSettings(first),
        stageValuesToSettings(second),
      );
    }
    const parts = stageParts(first);
    return Config.buildStageUrl(STAGE_PAGE, parts.battle, parts.stage);
  }

  function stageUrlWithBase(values, baseUrl) {
    // То же, но с базой страницы: в браузере нужен полный адрес stage.html.
    const parts = stageParts(values);
    return Config.buildStageUrl(baseUrl || STAGE_PAGE, parts.battle, parts.stage);
  }

  function buildStagePreviewUrl(values) {
    // Предпросмотр сцены: всегда с demo=1 и без канала — сцена сама
    // переключает режимы каждые 20 секунд.
    const parts = stageParts(values);
    const battle = Config.sanitize(
      Object.assign({}, parts.battle, { channel: "", demo: true }),
    );
    return Config.buildStageUrl(STAGE_PAGE, battle, parts.stage);
  }

  function previewUrlFor(values) {
    // Один предпросмотр на две секции: бой или общая сцена.
    const source = isObject(values) ? values : {};
    if (isStageOn(source)) return buildStagePreviewUrl(source);
    return buildPreviewUrl(valuesToSettings(source));
  }

  function stageSummary(first, second) {
    // Короткое описание сцены. Как и buildStageUrl, принимает значения
    // формы целиком или пару (бой, сцена).
    if (isObject(second)) {
      return Config.stageSummary(
        valuesToSettings(first),
        stageValuesToSettings(second),
      );
    }
    const parts = stageParts(first);
    return Config.stageSummary(parts.battle, parts.stage);
  }

  // ------------------------------------------------------------------
  // Мелкие помощники для страницы
  // ------------------------------------------------------------------
  function find(host, selector) {
    if (!host || typeof host.querySelector !== "function") return null;
    return host.querySelector(selector);
  }

  function findByInputId(host, id) {
    return find(host, "#" + id);
  }

  function valueOf(host, id, fallback) {
    const node = findByInputId(host, id);
    if (!node || node.value === undefined || node.value === null) return fallback;
    return String(node.value);
  }

  function checkedOf(host, id, fallback) {
    const node = findByInputId(host, id);
    return node ? Boolean(node.checked) : fallback;
  }

  function radioValue(host, name, fallback) {
    const node = find(host, 'input[name="' + name + '"]:checked');
    return node && node.value !== undefined ? String(node.value) : fallback;
  }

  function setText(host, selector, value) {
    const node = find(host, selector);
    if (node) node.textContent = value;
  }

  function setValue(host, id, value) {
    const node = findByInputId(host, id);
    if (node) node.value = String(value);
  }

  function setChecked(host, id, value) {
    const node = findByInputId(host, id);
    if (node) node.checked = Boolean(value);
  }

  function setRadio(host, name, value) {
    if (typeof host.querySelectorAll !== "function") return;
    const nodes = host.querySelectorAll('input[name="' + name + '"]');
    for (let index = 0; index < nodes.length; index += 1) {
      nodes[index].checked = nodes[index].value === value;
    }
  }

  function decimal(value) {
    return String(value).replace(".", ",");
  }

  // ------------------------------------------------------------------
  // Значения формы: чтение и установка умолчаний
  // ------------------------------------------------------------------
  const RANGE_FIELDS = [
    "seaHeight",
    "shipScale",
    "maxShips",
    "cooldown",
    "idleMinutes",
    "roundPause",
  ];
  const RADIO_FIELDS = ["theme", "join", "lang"];
  const FLAG_FIELDS = ["leaderboard", "demo"];

  function collect(host) {
    // Значения формы боя как есть: строки для полей и чисел, флаги — boolean.
    const defaults = Config.DEFAULT_SETTINGS;
    return {
      channel: valueOf(host, "channel", defaults.channel),
      theme: radioValue(host, "theme", defaults.theme),
      seaHeight: valueOf(host, "seaHeight", String(defaults.seaHeight)),
      shipScale: valueOf(host, "shipScale", String(defaults.shipScale)),
      maxShips: valueOf(host, "maxShips", String(defaults.maxShips)),
      join: radioValue(host, "join", defaults.join),
      cooldown: valueOf(host, "cooldown", String(defaults.cooldown)),
      idleMinutes: valueOf(host, "idleMinutes", String(defaults.idleMinutes)),
      roundPause: valueOf(host, "roundPause", String(defaults.roundPause)),
      leaderboard: checkedOf(host, "leaderboard", defaults.leaderboard),
      lang: radioValue(host, "lang", defaults.lang),
      demo: checkedOf(host, "demo", defaults.demo),
    };
  }

  function collectStage(host) {
    // Значения формы общей сцены.
    const defaults = Config.STAGE_DEFAULTS;
    return {
      stageEnabled: checkedOf(host, "stageEnabled", false),
      svetUrl: valueOf(host, "svetUrl", ""),
      svetTheme: valueOf(host, "svetTheme", defaults.svetTheme || ""),
      svetBackdrop: valueOf(host, "svetBackdrop", String(defaults.svetBackdrop)),
      auto: checkedOf(host, "auto", defaults.auto),
      battleIdle: valueOf(host, "battleIdle", String(defaults.battleIdle)),
    };
  }

  function collectAll(host) {
    return Object.assign({}, collect(host), collectStage(host));
  }

  function applyDefaults(host) {
    // Форма в разметке уже заполнена, но пусть значения берутся из
    // SB.Config: тогда форма и страницы не разойдутся.
    const values = defaultValues();
    setValue(host, "channel", values.channel);
    for (const name of RADIO_FIELDS) setRadio(host, name, values[name]);
    for (const id of RANGE_FIELDS) setValue(host, id, values[id]);
    for (const id of FLAG_FIELDS) setChecked(host, id, values[id]);
  }

  function applyStageDefaults(host) {
    const values = defaultStageValues();
    setChecked(host, "stageEnabled", values.stageEnabled);
    setValue(host, "svetUrl", values.svetUrl);
    setValue(host, "svetTheme", values.svetTheme);
    setValue(host, "svetBackdrop", values.svetBackdrop);
    setChecked(host, "auto", values.auto);
    setValue(host, "battleIdle", values.battleIdle);
  }

  function updateOutputs(host, settings) {
    setText(host, "#seaHeightValue", settings.seaHeight + " %");
    setText(host, "#shipScaleValue", decimal(settings.shipScale) + "×");
    setText(host, "#maxShipsValue", String(settings.maxShips));
    setText(host, "#cooldownValue", decimal(settings.cooldown) + " с");
    setText(host, "#idleMinutesValue", String(settings.idleMinutes) + " мин");
    setText(host, "#roundPauseValue", String(settings.roundPause) + " с");
  }

  function updateStageOutputs(host, stage) {
    setText(host, "#svetBackdropValue", stage.svetBackdrop + " %");
    setText(host, "#battleIdleValue", stage.battleIdle + " мин");
    const hint = find(host, "#autoHint");
    if (hint) hint.textContent = stage.auto ? AUTO_HINT_ON : AUTO_HINT_OFF;
  }

  function updateChannelHint(host, typed, channel) {
    const hint = find(host, "#channelHint");
    if (!hint) return;
    const raw = String(typed === null || typed === undefined ? "" : typed).trim();
    hint.classList.toggle("is-warn", Boolean(raw) && !channel);
    hint.classList.toggle("is-ok", Boolean(channel));
    hint.textContent = !raw
      ? CHANNEL_HINT
      : channel
        ? "Канал: " + channel + ". Ссылка ниже готова."
        : "Не получилось узнать логин. Нужны латинские буквы, цифры или знак «_».";
  }

  function setStageVisible(host, visible) {
    // Поля и ссылка сцены показываются только при включённой галочке.
    const fields = find(host, "#stageFields");
    if (fields) fields.hidden = !visible;
  }

  // ------------------------------------------------------------------
  // Предпросмотр
  // ------------------------------------------------------------------
  let previewTimer = null;
  let previewPending = null;

  function schedulePreview(host, url) {
    // Обновляем iframe не на каждый пиксель ползунка, а чуть реже:
    // перезагрузка страницы на каждое движение мышью слишком тяжёлая.
    previewPending = { host: host, url: url };
    if (previewTimer !== null) return;
    previewTimer = setTimeout(function () {
      previewTimer = null;
      const task = previewPending;
      previewPending = null;
      if (!task) return;
      const frame = find(task.host, "#preview");
      if (!frame) return;
      if (frame.getAttribute("src") !== task.url) {
        frame.setAttribute("src", task.url);
      }
    }, PREVIEW_DELAY);
  }

  // ------------------------------------------------------------------
  // Общая синхронизация формы со ссылками и предпросмотром
  // ------------------------------------------------------------------
  function sync(host) {
    const values = collectAll(host);
    const settings = valuesToSettings(values);
    const stage = stageValuesToSettings(values);
    const stageOn = isStageOn(values);

    updateOutputs(host, settings);
    updateStageOutputs(host, stage);
    updateChannelHint(host, values.channel, settings.channel);

    // Ссылка «только Морской бой» — как в части 1.
    const obs = buildObsUrl(settings, locationBase());
    const link = find(host, "#obsLink");
    if (link) link.value = obs;
    const open = find(host, "#openLink");
    if (open && typeof open.setAttribute === "function") {
      open.setAttribute("href", obs);
    }
    setText(host, "#summaryText", summary(settings));

    // Ссылка общего источника (stage.html) — с параметрами боя и сцены.
    const stageUrl = stageUrlWithBase(values, locationPage(STAGE_PAGE));
    const stageLink = find(host, "#stageLink");
    if (stageLink) stageLink.value = stageUrl;
    const stageOpen = find(host, "#stageOpen");
    if (stageOpen && typeof stageOpen.setAttribute === "function") {
      stageOpen.setAttribute("href", stageUrl);
    }
    setText(host, "#stageSummaryText", stageSummary(values));
    setStageVisible(host, stageOn);

    const note = find(host, "#previewNote");
    if (note) note.textContent = stageOn ? PREVIEW_NOTES.stage : PREVIEW_NOTES.battle;

    // Предпросмотр: бой или общая сцена (тоже с demo=1).
    schedulePreview(host, previewUrlFor(values));
  }

  // ------------------------------------------------------------------
  // Копирование ссылок и кнопки «Открыть»
  // ------------------------------------------------------------------
  const statusTimers = Object.create(null);

  function setStatus(host, message, tone, selector) {
    const key = selector || "#copyStatus";
    const status = find(host, key);
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-warn", tone === "warn");
    status.classList.toggle("is-ok", Boolean(message) && tone !== "warn");
    if (statusTimers[key]) {
      clearTimeout(statusTimers[key]);
      delete statusTimers[key];
    }
    if (message) {
      statusTimers[key] = setTimeout(function () {
        delete statusTimers[key];
        status.textContent = "";
        status.classList.remove("is-ok", "is-warn");
      }, STATUS_TIMEOUT);
    }
  }

  function selectField(field) {
    if (!field || typeof field.select !== "function") return false;
    try {
      field.focus();
      field.select();
      return true;
    } catch (error) {
      return false;
    }
  }

  function copyBySelection(field) {
    if (!selectField(field)) return false;
    try {
      if (typeof document !== "undefined" && typeof document.execCommand === "function") {
        return document.execCommand("copy") === true;
      }
    } catch (error) {
      // Остаётся выделенный текст: его можно скопировать вручную.
    }
    return false;
  }

  function writeClipboard(host, url, field, selector) {
    const statusSelector = selector || "#copyStatus";
    let finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      if (ok) {
        setStatus(host, "Ссылка скопирована", "ok", statusSelector);
      } else if (selectField(field)) {
        setStatus(
          host,
          "Ссылка выделена — нажмите Ctrl+C, чтобы скопировать",
          "warn",
          statusSelector,
        );
      } else {
        setStatus(
          host,
          "Не получилось скопировать. Выделите ссылку и нажмите Ctrl+C.",
          "warn",
          statusSelector,
        );
      }
    }
    // navigator.clipboard есть не всегда (локальный файл, старый браузер),
    // поэтому всё в try/catch и с запасным способом через выделение.
    const clipboard =
      typeof navigator !== "undefined" && navigator ? navigator.clipboard : null;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        const result = clipboard.writeText(url);
        if (result && typeof result.then === "function") {
          result.then(
            function () {
              finish(true);
            },
            function () {
              finish(copyBySelection(field));
            },
          );
          return;
        }
        finish(true);
        return;
      } catch (error) {
        // Ниже — старый способ через выделение поля.
      }
    }
    finish(copyBySelection(field));
  }

  function setOpenHref(host, selector, url) {
    const open = find(host, selector);
    if (open && typeof open.setAttribute === "function") {
      open.setAttribute("href", url);
    }
  }

  function copyLink(host) {
    const settings = valuesToSettings(collect(host));
    const url = buildObsUrl(settings, locationBase());
    const field = find(host, "#obsLink");
    if (field) field.value = url;
    setOpenHref(host, "#openLink", url);
    writeClipboard(host, url, field, "#copyStatus");
  }

  function copyStageLink(host) {
    const values = collectAll(host);
    const url = stageUrlWithBase(values, locationPage(STAGE_PAGE));
    const field = find(host, "#stageLink");
    if (field) field.value = url;
    setOpenHref(host, "#stageOpen", url);
    writeClipboard(host, url, field, "#stageStatus");
  }

  function handleClick(host, event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return;
    const button = target.closest("button");
    if (!button) return;
    if (button.id === "copyLink") {
      copyLink(host);
      return;
    }
    if (button.id === "stageCopy") copyStageLink(host);
    // Ссылки «Открыть» — обычные <a>, их href уже обновлён в sync.
  }

  // ------------------------------------------------------------------
  // Запуск на странице
  // ------------------------------------------------------------------
  function init(root) {
    // В тестах Node DOM нет — просто ничего не делаем.
    if (typeof document === "undefined" || !document) return null;
    const host =
      root ||
      (typeof document.getElementById === "function"
        ? document.getElementById("builder")
        : null);
    if (!host || typeof host.addEventListener !== "function") return null;
    if (host.dataset && host.dataset.builderReady === "1") return host;
    if (host.dataset) host.dataset.builderReady = "1";

    applyDefaults(host);
    applyStageDefaults(host);

    host.addEventListener("input", function () {
      sync(host);
    });
    host.addEventListener("change", function () {
      sync(host);
    });
    host.addEventListener("click", function (event) {
      handleClick(host, event);
    });
    host.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || !event.target) return;
      if (event.target.id === "channel") {
        event.preventDefault();
        copyLink(host);
      } else if (event.target.id === "svetUrl") {
        event.preventDefault();
        copyStageLink(host);
      }
    });

    sync(host);
    return host;
  }

  SB.Builder = {
    PAGE: PAGE,
    STAGE_PAGE: STAGE_PAGE,
    STEPS: STEPS,
    PREVIEW_DELAY: PREVIEW_DELAY,
    defaultValues: defaultValues,
    valuesToSettings: valuesToSettings,
    previewSettings: previewSettings,
    buildPreviewUrl: buildPreviewUrl,
    buildObsUrl: buildObsUrl,
    summary: summary,
    defaultStageValues: defaultStageValues,
    stageValuesToSettings: stageValuesToSettings,
    isStageOn: isStageOn,
    buildStageUrl: buildStageUrl,
    buildStagePreviewUrl: buildStagePreviewUrl,
    previewUrlFor: previewUrlFor,
    stageSummary: stageSummary,
    collect: collect,
    collectStage: collectStage,
    collectAll: collectAll,
    init: init,
  };

  // Автозапуск: скрипт подключён в конце body, поэтому #builder уже есть.
  if (typeof document !== "undefined" && document &&
      typeof document.getElementById === "function" &&
      document.getElementById("builder")) {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
