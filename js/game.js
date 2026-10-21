/* «Морской бой чата»: мир игры.
 *
 * Здесь живёт вся игра: корабли зрителей по рядам, выстрелы, частицы,
 * надписи «-1»/«щит!», метки стрелка и прицела, раунды и счёт побед.
 * Раскладку (ряды, места, шаг) даёт js/layout.js. Страница (js/render.js)
 * только рисует то, что отдаёт frame(). Настоящих часов и случайности из
 * Math.random здесь нет: время
 * приходит параметром шага, случайность — из seeded-генератора. Поэтому
 * одинаковый seed + одинаковые сообщения дают одинаковый кадр, а тесты
 * повторяемы и не ждут настоящих секунд.
 *
 * Файл — обычный браузерный скрипт (без import/export), как «Светлячки».
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // ------------------------------------------------------------------
  // Константы игры (числа — из ТЗ и договора, менять нельзя)
  // ------------------------------------------------------------------
  const FIXED_STEP_MS = 20; // фиксированный шаг физики
  const MAX_FRAME_MS = 100; // больше не берём за один step (свёрнутая вкладка)
  const MAX_HP = 3; // прочность корабля
  const MAX_PARTICLES = 300; // потолок частиц
  const SINK_MS = 2000; // анимация потопления
  const BANNER_MS = 6000; // надпись «Победитель раунда»
  const SHOT_FLIGHT_MS = 700; // полёт ядра
  const SHIELD_MS = 5000; // щит
  const MARGIN = 0.05; // поля по краям воды
  const MIN_GAP = 0.09; // минимальный зазор между кораблями по x
  const STORAGE_PREFIX = "sea-battle-wins:";

  // Служебные числа мира (не входят в договор, но объясняют поведение).
  const DEFAULT_SEED = 20261021;
  const NAME_CHARS = 16; // ник в кадре — до 16 знаков
  const MOVE_STEP = 0.08; // сдвиг !вперёд/!назад
  const ROW_FALLBACK = 3; // рядов, если js/layout.js ещё не загружен
  const LEAVE_SPEED = 0.42; // долей кадра в секунду при уплывании
  const OUT_EDGE = 0.12; // за этим краем корабль уже уплыл
  const GRAVITY = 0.55; // частицы падают вниз (доли кадра/с²)
  const BOB_SPEED = 0.08; // скорость качки, оборотов в секунду

  // События боя (часть 2, договор §B.4–B.8).
  const SHAKE_MS = 350; // лёгкая тряска корабля после попадания
  const HIT_LABEL_MS = 900; // надпись «-1»
  const SHIELD_LABEL_MS = 1000; // надпись «щит!» / «shield!»
  const SHOT_MARK_MS = 1000; // стрелка над стрелком
  const LABEL_MAX = 12; // потолок надписей в мире
  const MARK_MAX = 20; // потолок меток в мире

  // Состояния корабля и раунда — ровно как в договоре.
  const SAILING = "sailing";
  const SINKING = "sinking";
  const LEAVING = "leaving";
  const DROWNED = "drowned";

  const WAITING = "waiting";
  const PLAYING = "playing";
  const FINISHED = "finished";

  // Модераторские команды (работают и в паузе, но только с правами).
  const MODERATOR_COMMANDS = ["round", "pause", "resume", "clear"];

  // Настройки на случай, если js/config.js ещё не загружен (в тестах и на
  // странице он всегда раньше). Порядок ключей — как в SB.Config.
  const FALLBACK_SETTINGS = Object.freeze({
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

  // ------------------------------------------------------------------
  // Мелкие помощники
  // ------------------------------------------------------------------
  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function roundTo(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  // ------------------------------------------------------------------
  // Детерминированный генератор: один seed — одно море.
  // ------------------------------------------------------------------
  function makeRandom(seed) {
    // Тот же приём, что в «Светлячках»: mulberry32.
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), 1 | value);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Генератор случайных чисел с seed. Тесты могут подсунуть свой rng —
   * главное, чтобы у него были те же пять методов.
   */
  function createRng(seed) {
    const next = makeRandom(Number(seed) || 0);
    return {
      random: next,
      uniform(low, high) {
        return low + (high - low) * next();
      },
      randrange(count) {
        const size = Math.max(0, Math.floor(Number(count) || 0));
        return size === 0 ? 0 : Math.floor(next() * size);
      },
      randint(low, high) {
        const from = Math.floor(Number(low) || 0);
        const to = Math.floor(Number(high) || 0);
        if (to < from) return from;
        return from + Math.floor(next() * (to - from + 1));
      },
      choice(items) {
        if (!items || items.length === 0) return undefined;
        return items[Math.floor(next() * items.length)];
      },
    };
  }

  // ------------------------------------------------------------------
  // Ник, цвет и настройки
  // ------------------------------------------------------------------
  function maskName(displayName, fallback) {
    // В игре ник короткий, с маской мата — как в договоре.
    const raw = text(displayName).trim() || text(fallback).trim();
    if (SB.Mask && typeof SB.Mask.shortName === "function") {
      return SB.Mask.shortName(raw, SB.Mask.DEFAULT_ROOTS, [], NAME_CHARS);
    }
    return raw;
  }

  function colorOf(user, chatColor) {
    // Цвет паруса: цвет из чата (осветлённый) или цвет из палитры по нику.
    if (SB.Colors && typeof SB.Colors.colorForChat === "function") {
      return SB.Colors.colorForChat(user, chatColor);
    }
    return "#8fd8ff";
  }

  function prepareSettings(settings) {
    // Настройки уже причёсаны SB.Config; если его нет — берём умолчания.
    if (SB.Config && typeof SB.Config.sanitize === "function") {
      return SB.Config.sanitize(settings || {});
    }
    const result = Object.assign({}, FALLBACK_SETTINGS);
    if (settings && typeof settings === "object") {
      for (const key of Object.keys(result)) {
        if (settings[key] !== undefined) result[key] = settings[key];
      }
    }
    return result;
  }

  function playerName(displayName, user) {
    return text(displayName).trim() || text(user).trim();
  }

  // ------------------------------------------------------------------
  // Раскладка: ряды и места (SB.Layout — единственный источник чисел)
  // ------------------------------------------------------------------
  function layoutApi() {
    // js/layout.js загружается до game.js; без него мир живёт как в части 1.
    return SB.Layout && typeof SB.Layout.slotX === "function" ? SB.Layout : null;
  }

  function rowCount() {
    const api = layoutApi();
    return api ? api.ROW_COUNT : ROW_FALLBACK;
  }

  function clampRow(row) {
    const value = Math.floor(Number(row));
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(rowCount() - 1, value));
  }

  // ------------------------------------------------------------------
  // Мир
  // ------------------------------------------------------------------
  class World {
    /**
     * @param {object} options {settings, seed, rng, storage, now}
     */
    constructor(options) {
      const opts = options && typeof options === "object" ? options : {};
      this.settings = prepareSettings(opts.settings);
      this.rng =
        opts.rng && typeof opts.rng.random === "function"
          ? opts.rng
          : createRng(opts.seed === undefined ? DEFAULT_SEED : opts.seed);
      this.storage = opts.storage || null;
      this.now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : 0;
      this.paused = false;

      this.ships = [];
      this.shots = [];
      this.particles = [];
      this.queue = [];
      this.drowned = [];
      this.participants = [];
      this.labels = []; // надписи «-1» / «щит!»
      this.marks = []; // стрелка над стрелком и «прицел» на цели

      this.round = {
        state: WAITING,
        number: 1,
        winner: null,
        banner: null,
        finishedAt: null,
        nextRoundAt: null,
      };

      this._acc = 0; // накопитель времени меньше шага
      this._nextShipId = 1;
      this._nextShotId = 1;
      this._cooldowns = Object.create(null); // зритель -> команда -> «не раньше»
      this._wins = this._loadWins(); // зритель -> {name, wins}
    }

    // ----------------------------------------------------------------
    // Счёт побед и storage
    // ----------------------------------------------------------------
    _storageKey() {
      return STORAGE_PREFIX + (this.settings.channel || "local");
    }

    _loadWins() {
      // Формат: {"логин": {"name": "...", "wins": 3}}. Мусор пропускаем.
      const result = Object.create(null);
      if (!this.storage) return result;
      let raw = null;
      try {
        raw = this.storage.getItem(this._storageKey());
      } catch (error) {
        raw = null;
      }
      if (!raw) return result;
      let data = null;
      try {
        data = JSON.parse(String(raw));
      } catch (error) {
        data = null;
      }
      if (!data || typeof data !== "object") return result;
      for (const user of Object.keys(data)) {
        const item = data[user];
        if (!item || typeof item !== "object") continue;
        const wins = Math.floor(Number(item.wins));
        if (!Number.isFinite(wins) || wins <= 0) continue;
        result[user] = {
          name: text(item.name) || text(user),
          wins,
        };
      }
      return result;
    }

    _saveWins() {
      if (!this.storage) return;
      try {
        this.storage.setItem(this._storageKey(), JSON.stringify(this.wins()));
      } catch (error) {
        // Хранилище может быть запрещено (приватный режим) — игра живёт дальше.
      }
    }

    /** Победы по зрителям — копия, без ссылок на внутренние данные. */
    wins() {
      const result = {};
      for (const user of Object.keys(this._wins)) {
        result[user] = { name: this._wins[user].name, wins: this._wins[user].wins };
      }
      return result;
    }

    /** Топ-5 капитанов по победам. */
    leaderboard() {
      const list = [];
      for (const user of Object.keys(this._wins)) {
        list.push({
          user,
          name: this._wins[user].name,
          wins: this._wins[user].wins,
        });
      }
      list.sort((first, second) => {
        if (second.wins !== first.wins) return second.wins - first.wins;
        if (first.user === second.user) return 0;
        return first.user < second.user ? -1 : 1;
      });
      return list.slice(0, 5);
    }

    _addWin(user, name) {
      const entry = this._wins[user] || (this._wins[user] = { name, wins: 0 });
      entry.name = name;
      entry.wins += 1;
      this._saveWins();
    }

    // ----------------------------------------------------------------
    // Команды: разбор, паузы, права
    // ----------------------------------------------------------------
    _parse(messageText) {
      if (SB.Commands && typeof SB.Commands.parse === "function") {
        return SB.Commands.parse(messageText);
      }
      return null;
    }

    _isModeratorCommand(name) {
      return MODERATOR_COMMANDS.indexOf(name) >= 0;
    }

    _cooldownMs(name) {
      // Пауза команды: своя у каждой, из SB.Commands и настройки cooldown.
      if (this._isModeratorCommand(name)) return 0;
      let seconds = 6;
      if (SB.Commands && typeof SB.Commands.cooldownSeconds === "function") {
        seconds = SB.Commands.cooldownSeconds(name, this.settings.cooldown);
      }
      return Math.max(0, Math.round(Number(seconds) * 1000));
    }

    _onCooldown(user, name) {
      const table = this._cooldowns[user];
      if (!table) return false;
      const until = table[name];
      return typeof until === "number" && this.now < until;
    }

    _setCooldown(user, name, ms) {
      if (!(ms > 0)) return;
      let table = this._cooldowns[user];
      if (!table) {
        table = Object.create(null);
        this._cooldowns[user] = table;
      }
      table[name] = this.now + ms;
    }

    _targetMatches(ship, arg) {
      // «!огонь Вася» находит и по логину, и по отображаемому нику.
      if (SB.Commands && typeof SB.Commands.targetMatches === "function") {
        return SB.Commands.targetMatches([ship.user, ship.displayName, ship.name], arg);
      }
      const wanted = text(arg).trim().toLowerCase();
      if (!wanted) return false;
      return [ship.user, ship.displayName, ship.name].some(
        (value) => text(value).trim().toLowerCase() === wanted,
      );
    }

    // ----------------------------------------------------------------
    // Вход в игру и очередь
    // ----------------------------------------------------------------
    _shipOf(user) {
      for (const ship of this.ships) {
        if (ship.user === user) return ship;
      }
      return null;
    }

    _shipById(id) {
      for (const ship of this.ships) {
        if (ship.id === id) return ship;
      }
      return null;
    }

    _queueIndexOf(user) {
      for (let index = 0; index < this.queue.length; index += 1) {
        if (this.queue[index].user === user) return index;
      }
      return -1;
    }

    _countOccupied() {
      // Место на воде занимают только плывущие корабли.
      let count = 0;
      for (const ship of this.ships) {
        if (ship.state === SAILING) count += 1;
      }
      return count;
    }

    _countInRound() {
      // Участники раунда: на плаву и тонущие.
      let count = 0;
      for (const ship of this.ships) {
        if (ship.state === SAILING || ship.state === SINKING) count += 1;
      }
      return count;
    }

    _randomX() {
      // Запасной вариант (ряды переполнены): случайное место, как в части 1.
      return this.rng.uniform(MARGIN, 1 - MARGIN);
    }

    _randomY() {
      // Запасной вариант без раскладки: полоса моря ниже верхней кромки.
      const height = this._seaHeightFraction();
      const top = 1 - height;
      const low = top + height * 0.22;
      const high = 0.96;
      return this.rng.uniform(low, Math.max(low + 0.004, high));
    }

    _seaHeightFraction() {
      return clamp(Number(this.settings.seaHeight) || 30, 15, 60) / 100;
    }

    _shipScale() {
      return Math.max(0.1, Number(this.settings.shipScale) || 1);
    }

    _rowY(row) {
      // Центр корабля в ряду — только через SB.Layout (один источник чисел).
      const api = layoutApi();
      if (api) return api.rowY(row, this._seaHeightFraction());
      return this._randomY();
    }

    _rowScale(row) {
      const api = layoutApi();
      return api ? api.rowScale(row) : 1;
    }

    _slotStep(row) {
      // Шаг мест в ряду: зазор из ТЗ или ширина подписи (что больше).
      const api = layoutApi();
      return api ? api.slotStepFraction(row, this._shipScale()) : MIN_GAP;
    }

    _randomRow() {
      return this.rng.randrange(rowCount());
    }

    _slotIsFree(row, x, placed) {
      // Свободно ли место x в ряду: рядом нет живого/тонущего корабля.
      const step = this._slotStep(row);
      for (const other of placed) {
        if (other.state !== SAILING && other.state !== SINKING) continue;
        if (clampRow(other.row) !== row) continue;
        if (Math.abs(other.x - x) < step - 1e-9) return false;
      }
      return true;
    }

    _freeSlotNear(row, x, placed) {
      // То самое место (по старой координате) ряда, если оно свободно.
      const api = layoutApi();
      if (!api) return null;
      const scale = this._shipScale();
      const count = api.capacity(row, scale);
      const step = api.slotStepFraction(row, scale);
      for (let slot = 0; slot < count; slot += 1) {
        const slotX = api.slotX(row, slot, scale);
        if (Math.abs(slotX - x) >= step - 1e-9) continue;
        if (!this._slotIsFree(row, slotX, placed)) return null;
        return { row, slot, x: slotX };
      }
      return null;
    }

    _freeSlotInRow(row, placed) {
      // Первое свободное место ряда слева направо.
      const api = layoutApi();
      if (!api) return null;
      const scale = this._shipScale();
      const count = api.capacity(row, scale);
      for (let slot = 0; slot < count; slot += 1) {
        const x = api.slotX(row, slot, scale);
        if (this._slotIsFree(row, x, placed)) return { row, slot, x };
      }
      return null;
    }

    _firstFreeSpot(placed) {
      // Первый свободный слот: ряд 0 → 2, внутри ряда — слева направо.
      const list = placed || this.ships;
      for (let row = 0; row < rowCount(); row += 1) {
        const spot = this._freeSlotInRow(row, list);
        if (spot) return spot;
      }
      return null;
    }

    _spawnShip(user, displayName, chatColor) {
      // Корабль встаёт в первый свободный слот рядов; если тесно — как раньше.
      const spot = this._firstFreeSpot();
      const row = spot ? spot.row : this._randomRow();
      const x = spot ? spot.x : this._randomX();
      const ship = {
        id: this._nextShipId,
        user,
        displayName: playerName(displayName, user),
        name: maskName(displayName, user),
        color: colorOf(user, chatColor),
        row,
        x,
        y: this._rowY(row),
        dir: this.rng.random() < 0.5 ? -1 : 1,
        hp: MAX_HP,
        maxHp: MAX_HP,
        shield: false,
        shieldUntil: 0,
        state: SAILING,
        sinkStart: 0,
        sinkProgress: 0,
        crown: false,
        shakeUntil: 0,
        phase: this.rng.random(),
        lastActiveAt: this.now,
        bornAt: this.now,
        leaveDir: 1,
      };
      this._nextShipId += 1;
      this.ships.push(ship);
      return ship;
    }

    _applyJoin(user, displayName, chatColor) {
      const existing = this._shipOf(user);
      if (existing) {
        if (existing.state === SAILING) {
          return { joined: false, queued: false, ok: true, reason: "ok" };
        }
        // Потопленный ждёт нового раунда, уплывающий — уже ушёл.
        return { joined: false, queued: false, ok: false, reason: "not_in_game" };
      }
      if (this._queueIndexOf(user) >= 0) {
        return { joined: false, queued: true, ok: true, reason: "queued" };
      }
      if (this._countOccupied() >= this.settings.maxShips) {
        this.queue.push({
          user,
          displayName: playerName(displayName, user),
          chatColor,
          lastActiveAt: this.now,
        });
        return { joined: false, queued: true, ok: true, reason: "queued" };
      }
      this._spawnShip(user, displayName, chatColor);
      return { joined: true, queued: false, ok: true, reason: "ok" };
    }

    _admitQueue() {
      // Освободилось место — следующий из очереди входит сам (в step).
      const idleMs = this._idleMs();
      while (this.queue.length > 0 && this._countOccupied() < this.settings.maxShips) {
        const entry = this.queue.shift();
        if (idleMs > 0 && this.now - entry.lastActiveAt >= idleMs) continue;
        if (this._shipOf(entry.user)) continue;
        this._spawnShip(entry.user, entry.displayName, entry.chatColor);
      }
    }

    // ----------------------------------------------------------------
    // Вход сообщения из чата
    // ----------------------------------------------------------------
    /**
     * Обработать сообщение чата.
     * @returns {{joined:boolean, queued:boolean, command:string|null,
     *            ok:boolean, reason:string|null}}
     */
    onMessage(message) {
      const data = message && typeof message === "object" ? message : {};
      const rawUser = text(data.user).trim();
      const report = {
        joined: false,
        queued: false,
        command: null,
        ok: false,
        reason: null,
      };
      if (!rawUser) return report;

      // Логин — ключ зрителя (в Twitch он всегда нижним регистром).
      const user = rawUser.toLowerCase();
      const messageText = text(data.text);
      const displayName = playerName(data.display_name || data.displayName, rawUser);
      const chatColor = text(data.chat_color || data.chatColor).trim();
      const rights = Boolean(data.is_mod) || Boolean(data.is_broadcaster);
      const parsed = this._parse(messageText);

      const ship = this._shipOf(user);
      if (ship) ship.lastActiveAt = this.now;
      const queuedAt = this._queueIndexOf(user);
      if (queuedAt >= 0) this.queue[queuedAt].lastActiveAt = this.now;
      report.queued = queuedAt >= 0;

      if (parsed) report.command = parsed.name;

      // Модераторские команды работают даже в паузе.
      if (parsed && this._isModeratorCommand(parsed.name)) {
        return this._moderatorCommand(parsed.name, rights, report);
      }

      if (this.paused) {
        // В паузе игроки и новые корабли молчат, время не идёт.
        report.reason = "paused";
        return report;
      }

      // Вход: «!играть» в любом режиме; при join=chat — любое сообщение.
      let entry = null;
      if (parsed && parsed.name === "join") {
        entry = this._applyJoin(user, displayName, chatColor);
        if (entry.joined || entry.queued) {
          this._setCooldown(user, "join", this._cooldownMs("join"));
        }
      } else if (!ship && !report.queued && this.settings.join !== "command") {
        entry = this._applyJoin(user, displayName, chatColor);
      }
      if (entry) {
        report.joined = entry.joined;
        report.queued = entry.queued;
        report.ok = entry.ok;
        report.reason = entry.reason;
        // «!играть» и любое сообщение в чат-режиме на этом заканчиваются.
        if (!parsed || parsed.name === "join") {
          this._updateRound();
          return report;
        }
      }

      // «!уйти» из очереди — корабля ещё нет, но место в очереди есть.
      if (parsed && parsed.name === "leave" && queuedAt >= 0) {
        if (this._onCooldown(user, "leave")) {
          report.reason = "cooldown";
          return report;
        }
        this.queue.splice(queuedAt, 1);
        this._setCooldown(user, "leave", this._cooldownMs("leave"));
        report.queued = false;
        report.ok = true;
        report.reason = "ok";
        return report;
      }

      const active = this._shipOf(user);
      if (!active || active.state !== SAILING) {
        // Корабль тонет, уплывает или ждёт нового раунда — командовать нельзя.
        if (!parsed) {
          report.reason = active ? "not_in_game" : null;
          return report;
        }
        report.reason = "not_in_game";
        return report;
      }

      if (!parsed) {
        // Обычное сообщение живого корабля: продлили активность.
        report.ok = true;
        report.reason = "ok";
        return report;
      }

      if (this._onCooldown(user, parsed.name)) {
        // Тихо игнорируем, ничего не пишем в чат.
        report.reason = "cooldown";
        return report;
      }

      this._playerCommand(active, parsed);
      this._setCooldown(user, parsed.name, this._cooldownMs(parsed.name));
      report.ok = true;
      report.reason = "ok";
      this._updateRound();
      return report;
    }

    _moderatorCommand(name, rights, report) {
      if (!rights) {
        report.reason = "no_rights";
        return report;
      }
      if (name === "round") this.forceRound();
      else if (name === "pause") this.setPaused(true);
      else if (name === "resume") this.setPaused(false);
      else if (name === "clear") this.clear();
      report.ok = true;
      report.reason = "ok";
      return report;
    }

    _playerCommand(ship, parsed) {
      if (parsed.name === "fire") this._fire(ship, parsed.arg);
      else if (parsed.name === "right") this._move(ship, 1);
      else if (parsed.name === "left") this._move(ship, -1);
      else if (parsed.name === "shield") this._raiseShield(ship);
      else if (parsed.name === "repair") this._repair(ship);
      else if (parsed.name === "leave") this._startLeaving(ship);
    }

    // ----------------------------------------------------------------
    // Действия игроков
    // ----------------------------------------------------------------
    _fire(ship, arg) {
      // Стреляем по названному кораблю (если нашли) или по ближайшему.
      const target = this._findTarget(ship, arg);
      const side = ship.dir >= 0 ? 1 : -1;
      const fromX = ship.x;
      const fromY = Math.max(0.02, ship.y - 0.03);
      let toX;
      let toY;
      if (target) {
        toX = target.x;
        toY = target.y;
      } else {
        // Цели нет — ядро падает в воду рядом, чтобы не было «немого» клика.
        toX = clamp(ship.x + side * 0.16, MARGIN, 1 - MARGIN);
        toY = ship.y;
      }
      // Вспышка и дым у борта стреляющего — видно, кто выстрелил.
      this._splash(fromX, fromY, "muzzle", "#ffe9a8", 4);
      this._splash(fromX, fromY, "smoke", "#cfd6de", 3);
      this.shots.push({
        id: this._nextShotId,
        fromX,
        fromY,
        toX,
        toY,
        x: ship.x,
        y: ship.y,
        progress: 0,
        born: this.now,
        shooter: ship.user,
        shooterName: ship.name,
        targetId: target ? target.id : 0,
        targetName: target ? target.name : "",
      });
      this._nextShotId += 1;
      // Стрелка над стрелком и «прицел» на цели.
      this._addMark({
        kind: "shot",
        x: ship.x,
        y: ship.y,
        tx: toX,
        ty: toY,
        born: this.now,
        until: this.now + SHOT_MARK_MS,
      });
      if (target) {
        this._addMark({
          kind: "aim",
          x: target.x,
          y: target.y,
          tx: target.x,
          ty: target.y,
          born: this.now,
          until: this.now + SHOT_FLIGHT_MS,
        });
      }
    }

    _findTarget(ship, arg) {
      const others = [];
      for (const candidate of this.ships) {
        if (candidate.state === SAILING && candidate.id !== ship.id) {
          others.push(candidate);
        }
      }
      if (arg) {
        for (const candidate of others) {
          if (this._targetMatches(candidate, arg)) return candidate;
        }
      }
      let best = null;
      let bestDistance = Infinity;
      for (const candidate of others) {
        const distance = Math.hypot(candidate.x - ship.x, candidate.y - ship.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      return best;
    }

    _move(ship, dir) {
      ship.dir = dir;
      ship.x = clamp(ship.x + dir * MOVE_STEP, MARGIN, 1 - MARGIN);
      this._splash(ship.x, ship.y, "splash", "#cfefff", 3);
    }

    _raiseShield(ship) {
      ship.shield = true;
      ship.shieldUntil = this.now + SHIELD_MS;
      this._splash(ship.x, ship.y, "hit", "#9fe8ff", 6);
    }

    _repair(ship) {
      ship.hp = Math.min(MAX_HP, ship.hp + 1);
      this._splash(ship.x, ship.y, "hit", "#9dffb0", 5);
    }

    _startLeaving(ship) {
      // Уплываем за ближний край: корабль больше не цель и не участник.
      const previous = ship.state;
      if (previous !== SAILING && previous !== SINKING) return;
      ship.state = LEAVING;
      ship.leaveDir = ship.x <= 0.5 ? -1 : 1;
      ship.shield = false;
      ship.shieldUntil = 0;
      ship.sinkStart = 0;
      ship.sinkProgress = 0;
    }

    _startSinking(ship) {
      ship.state = SINKING;
      ship.sinkStart = this.now;
      ship.sinkProgress = 0;
      ship.shield = false;
      ship.shieldUntil = 0;
      ship.crown = false;
      ship.shakeUntil = 0;
      this._splash(ship.x, ship.y, "smoke", "#cfcfcf", 6);
    }

    _drown(ship) {
      ship.state = DROWNED;
      ship.sinkProgress = 1;
      ship.crown = false;
      this.drowned.push({ user: ship.user, name: ship.name });
    }

    // ----------------------------------------------------------------
    // Ядра и частицы
    // ----------------------------------------------------------------
    _stepShots() {
      if (this.shots.length === 0) return;
      const kept = [];
      for (const shot of this.shots) {
        const progress = (this.now - shot.born) / SHOT_FLIGHT_MS;
        if (progress < 1) {
          shot.progress = progress;
          shot.x = shot.fromX + (shot.toX - shot.fromX) * progress;
          shot.y =
            shot.fromY +
            (shot.toY - shot.fromY) * progress -
            Math.sin(progress * Math.PI) * 0.05;
          kept.push(shot);
          continue;
        }
        this._impact(shot);
      }
      this.shots = kept;
    }

    _impact(shot) {
      const target = shot.targetId ? this._shipById(shot.targetId) : null;
      if (!target || target.state !== SAILING) {
        // Промах или цель уже потоплена — только всплеск.
        this._splash(shot.toX, shot.toY, "splash", "#bfe9ff", 8);
        return;
      }
      if (target.shield) {
        // Щит поглощает ровно одно попадание и снимается.
        target.shield = false;
        target.shieldUntil = 0;
        this._splash(target.x, target.y, "shield", "#9fe8ff", 10);
        this._addLabel({
          text: this.settings.lang === "en" ? "shield!" : "щит!",
          color: "#9fe8ff",
          x: target.x,
          y: target.y - 0.02,
          born: this.now,
          until: this.now + SHIELD_LABEL_MS,
          size: 1,
        });
        return;
      }
      target.hp = Math.max(0, target.hp - 1);
      target.shakeUntil = this.now + SHAKE_MS;
      this._splash(target.x, target.y, "hit", target.color, 8);
      this._splash(target.x, target.y, "splinter", "#a9743f", 6);
      this._addLabel({
        text: "-1",
        color: "#ff4d5e",
        x: target.x,
        y: target.y - 0.02,
        born: this.now,
        until: this.now + HIT_LABEL_MS,
        size: 1,
      });
      if (target.hp <= 0) this._startSinking(target);
    }

    _addParticle(particle) {
      this.particles.push(particle);
      if (this.particles.length > MAX_PARTICLES) {
        this.particles.splice(0, this.particles.length - MAX_PARTICLES);
      }
    }

    _splash(x, y, kind, color, count) {
      // Брызги/дым/искры: всё детерминировано общим rng.
      const amount = Math.max(0, Math.floor(Number(count) || 0));
      for (let index = 0; index < amount; index += 1) {
        const angle = this.rng.uniform(Math.PI * 0.12, Math.PI * 0.88);
        const speed = this.rng.uniform(0.08, 0.35);
        const side = this.rng.random() < 0.5 ? -1 : 1;
        const life = this.rng.uniform(0.35, 0.75);
        this._addParticle({
          x: clamp(x, 0, 1),
          y: clamp(y, 0, 1),
          vx: Math.cos(angle) * speed * side,
          vy: -Math.sin(angle) * speed,
          life,
          maxLife: life,
          color,
          kind,
          size: this.rng.uniform(1.5, 3.5),
        });
      }
    }

    _stepParticles(dt) {
      const alive = [];
      for (const particle of this.particles) {
        particle.life -= dt;
        if (particle.life <= 0) continue;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += GRAVITY * dt;
        alive.push(particle);
      }
      this.particles = alive;
    }

    _addLabel(label) {
      // Надписи «-1»/«щит!»: не больше LABEL_MAX, старые вытесняются.
      this.labels.push(label);
      if (this.labels.length > LABEL_MAX) {
        this.labels.splice(0, this.labels.length - LABEL_MAX);
      }
    }

    _addMark(mark) {
      // Метки выстрела/прицела: не больше MARK_MAX, старые вытесняются.
      this.marks.push(mark);
      if (this.marks.length > MARK_MAX) {
        this.marks.splice(0, this.marks.length - MARK_MAX);
      }
    }

    _stepEvents() {
      // Просроченные надписи и метки убираем прямо в шаге.
      const now = this.now;
      this.labels = this.labels.filter((item) => now < item.until);
      this.marks = this.marks.filter((item) => now < item.until);
    }

    // ----------------------------------------------------------------
    // Шаг мира
    // ----------------------------------------------------------------
    _idleMs() {
      return Math.max(0, Math.round(Number(this.settings.idleMinutes) * 60000));
    }

    _roundPauseMs() {
      return Math.max(0, Math.round(Number(this.settings.roundPause) * 1000));
    }

    /**
     * Продвинуть мир на deltaMs. Берём целыми кусками по FIXED_STEP_MS,
     * не больше MAX_FRAME_MS за вызов (остаток сверх лимита не копим).
     * В паузе время стоит.
     * @returns {number} сколько шагов физики сделано
     */
    step(deltaMs) {
      if (this.paused) return 0;
      const raw = Number(deltaMs);
      if (!Number.isFinite(raw) || raw <= 0) return 0;
      this._acc += Math.min(raw, MAX_FRAME_MS);
      let steps = 0;
      while (this._acc >= FIXED_STEP_MS) {
        this._acc -= FIXED_STEP_MS;
        this._tick();
        steps += 1;
        if (this.paused) break;
      }
      return steps;
    }

    _tick() {
      // Один шаг физики ровно на FIXED_STEP_MS.
      this.now += FIXED_STEP_MS;
      const dt = FIXED_STEP_MS / 1000;
      this._stepShips(dt);
      this._stepShots();
      this._stepParticles(dt);
      this._stepEvents();
      this._separate();
      this._admitQueue();
      this._updateRound();
    }

    _stepShips(dt) {
      const now = this.now;
      const idleMs = this._idleMs();
      const survivors = [];
      for (const ship of this.ships) {
        if (ship.state === SAILING) {
          ship.phase = (ship.phase + dt * BOB_SPEED) % 1;
          if (ship.shield && ship.shieldUntil > 0 && now >= ship.shieldUntil) {
            ship.shield = false;
            ship.shieldUntil = 0;
          }
          if (idleMs > 0 && now - ship.lastActiveAt >= idleMs) {
            this._startLeaving(ship);
          }
        } else if (ship.state === SINKING) {
          const progress = (now - ship.sinkStart) / SINK_MS;
          ship.sinkProgress = clamp(progress, 0, 1);
          if (progress >= 1) this._drown(ship);
        } else if (ship.state === LEAVING) {
          ship.x += ship.leaveDir * LEAVE_SPEED * dt;
          ship.phase = (ship.phase + dt * BOB_SPEED) % 1;
          if (ship.x <= -OUT_EDGE || ship.x >= 1 + OUT_EDGE) continue;
        }
        survivors.push(ship);
      }
      this.ships = survivors;
    }

    _separate() {
      // Раздвигаем только корабли одного ряда: шаг места = slotStepFraction.
      // Корабли разных рядов друг друга не трогают.
      const groups = new Map();
      for (const ship of this.ships) {
        if (ship.state !== SAILING) continue;
        const row = clampRow(ship.row);
        let group = groups.get(row);
        if (!group) {
          group = [];
          groups.set(row, group);
        }
        group.push(ship);
      }
      groups.forEach((group, row) => {
        const step = this._slotStep(row);
        if (!(step > 0)) return;
        for (let first = 0; first < group.length; first += 1) {
          const a = group[first];
          for (let second = first + 1; second < group.length; second += 1) {
            const b = group[second];
            const dx = b.x - a.x;
            const distance = Math.abs(dx);
            if (distance >= step) continue;
            const need = step - distance;
            let sign = 1;
            if (distance > 1e-9) sign = dx > 0 ? 1 : -1;
            else sign = a.id <= b.id ? 1 : -1;
            const roomA = sign > 0 ? a.x - MARGIN : 1 - MARGIN - a.x;
            const roomB = sign > 0 ? 1 - MARGIN - b.x : b.x - MARGIN;
            const shiftA = Math.max(0, Math.min(need / 2, roomA));
            a.x = clamp(a.x - sign * shiftA, MARGIN, 1 - MARGIN);
            const shiftB = Math.max(0, Math.min(need - shiftA, roomB));
            b.x = clamp(b.x + sign * shiftB, MARGIN, 1 - MARGIN);
          }
        }
      });
    }

    // ----------------------------------------------------------------
    // Раунд
    // ----------------------------------------------------------------
    _refreshParticipants() {
      const participants = [];
      for (const ship of this.ships) {
        if (ship.state === SAILING || ship.state === SINKING) {
          participants.push(ship.user);
        }
      }
      this.participants = participants;
    }

    _winnerText(name) {
      return this.settings.lang === "en"
        ? "Round winner: " + name
        : "Победитель раунда: " + name;
    }

    _updateRound() {
      const now = this.now;

      // Надпись живёт BANNER_MS, даже если новый раунд ещё не начался.
      if (this.round.banner && now >= this.round.banner.until) {
        this.round.banner = null;
      }

      this._refreshParticipants();
      const alive = this._countOccupied();

      if (this.round.state === WAITING) {
        // Раунд не начинается, пока кораблей меньше двух.
        if (alive >= 2) this.round.state = PLAYING;
        return;
      }

      if (this.round.state === PLAYING) {
        // Остался один (или ни одного) — раунд кончился.
        if (alive <= 1) {
          let winner = null;
          if (alive === 1) {
            for (const ship of this.ships) {
              if (ship.state === SAILING) {
                winner = ship;
                break;
              }
            }
          }
          this._finishRound(winner);
        }
        return;
      }

      if (
        this.round.state === FINISHED &&
        this.round.nextRoundAt !== null &&
        now >= this.round.nextRoundAt
      ) {
        this._startRound();
      }
    }

    _finishRound(winnerShip) {
      const now = this.now;
      this.round.state = FINISHED;
      this.round.finishedAt = now;
      this.round.nextRoundAt = now + this._roundPauseMs();
      if (!winnerShip) {
        // Все потоплены — раунд без победителя.
        this.round.winner = null;
        this.round.banner = null;
        return;
      }
      winnerShip.crown = true;
      this.round.winner = {
        user: winnerShip.user,
        name: winnerShip.name,
        color: winnerShip.color,
      };
      this.round.banner = {
        text: this._winnerText(winnerShip.name),
        until: now + BANNER_MS,
        name: winnerShip.name,
        color: winnerShip.color,
      };
      this._addWin(winnerShip.user, winnerShip.name);
    }

    _startRound() {
      // Новый раунд: все корабли (кроме уплывших) снова на плаву с 3 hp.
      const now = this.now;
      this.round.number += 1;
      this.round.state = WAITING;
      this.round.winner = null;
      this.round.banner = null;
      this.round.finishedAt = null;
      this.round.nextRoundAt = null;
      this.shots = [];
      this.drowned = [];
      this.labels = [];
      this.marks = [];
      const revived = [];
      const pending = [];
      for (const ship of this.ships) {
        if (ship.state === LEAVING) continue;
        const wasDown = ship.state === DROWNED || ship.state === SINKING;
        // Сброс боевого состояния; место вернём ниже.
        ship.hp = MAX_HP;
        ship.maxHp = MAX_HP;
        ship.shield = false;
        ship.shieldUntil = 0;
        ship.sinkStart = 0;
        ship.sinkProgress = 0;
        ship.crown = false;
        ship.shakeUntil = 0;
        ship.lastActiveAt = now;
        ship.row = clampRow(ship.row);
        if (wasDown) {
          pending.push(ship);
        } else {
          ship.state = SAILING;
          revived.push(ship);
        }
      }
      // Потопленных возвращаем на свободные места, по возможности в свой ряд.
      for (const ship of pending) {
        const own = this._freeSlotNear(ship.row, ship.x, revived);
        const spot = own || this._firstFreeSpot(revived);
        if (spot) {
          ship.row = spot.row;
          ship.x = spot.x;
          ship.y = this._rowY(spot.row);
        } else {
          // Совсем тесно: ставим случайно, как запасной вариант.
          ship.row = this._randomRow();
          ship.x = this._randomX();
          ship.y = this._rowY(ship.row);
        }
        ship.phase = this.rng.random();
        ship.state = SAILING;
        revived.push(ship);
      }
      this.ships = revived;
      this._refreshParticipants();
      if (this._countOccupied() >= 2) this.round.state = PLAYING;
    }

    // ----------------------------------------------------------------
    // Низкоуровневое API (main, демо и тесты)
    // ----------------------------------------------------------------
    join(user, options) {
      const rawUser = text(user).trim();
      if (!rawUser) {
        return { joined: false, queued: false, ok: false, reason: null };
      }
      const opts = options && typeof options === "object" ? options : {};
      const displayName = playerName(opts.displayName || opts.display_name, rawUser);
      const chatColor = text(opts.chatColor || opts.chat_color).trim();
      const result = this._applyJoin(rawUser.toLowerCase(), displayName, chatColor);
      this._updateRound();
      return result;
    }

    leave(user) {
      const rawUser = text(user).trim().toLowerCase();
      const ship = this._shipOf(rawUser);
      if (!ship || ship.state !== SAILING) return false;
      this._startLeaving(ship);
      this._updateRound();
      return true;
    }

    setPaused(flag) {
      this.paused = Boolean(flag);
      return this.paused;
    }

    forceRound() {
      this._startRound();
      this._updateRound();
      return this.round.number;
    }

    clear() {
      // Убрать корабли, очередь и «на дне»; счёт побед остаётся.
      this.ships = [];
      this.shots = [];
      this.particles = [];
      this.queue = [];
      this.drowned = [];
      this.participants = [];
      this.labels = [];
      this.marks = [];
      this._cooldowns = Object.create(null);
      this.round = {
        state: WAITING,
        number: 1,
        winner: null,
        banner: null,
        finishedAt: null,
        nextRoundAt: null,
      };
    }

    // ----------------------------------------------------------------
    // Снимок для рисования
    // ----------------------------------------------------------------
    /**
     * Снимок мира: новый JSON-сериализуемый объект ровно по схеме
     * договора. Менять внутренние массивы через него нельзя.
     */
    frame() {
      const now = this.now;
      const ships = [];
      for (const ship of this.ships) {
        if (ship.state === DROWNED) continue;
        ships.push({
          id: ship.id,
          user: ship.user,
          name: ship.name,
          color: ship.color,
          x: roundTo(ship.x, 4),
          y: roundTo(ship.y, 4),
          dir: ship.dir,
          hp: ship.hp,
          maxHp: ship.maxHp,
          shield: Boolean(ship.shield),
          state: ship.state,
          sinkProgress: roundTo(clamp(ship.sinkProgress, 0, 1), 3),
          crown: Boolean(ship.crown),
          row: clampRow(ship.row),
          scale: roundTo(this._rowScale(clampRow(ship.row)), 3),
          shake: roundTo(clamp((ship.shakeUntil - now) / SHAKE_MS, 0, 1), 3),
          phase: roundTo(ship.phase, 4),
          lastActiveAt: ship.lastActiveAt,
        });
      }

      const shots = [];
      for (const shot of this.shots) {
        shots.push({
          id: shot.id,
          fromX: roundTo(shot.fromX, 4),
          fromY: roundTo(shot.fromY, 4),
          toX: roundTo(shot.toX, 4),
          toY: roundTo(shot.toY, 4),
          x: roundTo(shot.x, 4),
          y: roundTo(shot.y, 4),
          progress: roundTo(clamp(shot.progress, 0, 1), 3),
          shooter: text(shot.shooter),
          shooterName: text(shot.shooterName),
          targetId: Number(shot.targetId) || 0,
          targetName: text(shot.targetName),
          born: shot.born,
        });
      }

      const particles = [];
      for (const particle of this.particles) {
        particles.push({
          x: roundTo(particle.x, 4),
          y: roundTo(particle.y, 4),
          vx: roundTo(particle.vx, 4),
          vy: roundTo(particle.vy, 4),
          life: roundTo(particle.life, 3),
          maxLife: roundTo(particle.maxLife, 3),
          color: particle.color,
          kind: particle.kind,
          size: roundTo(particle.size, 2),
        });
      }

      const drowned = [];
      for (const item of this.drowned) {
        drowned.push({ user: item.user, name: item.name });
      }

      const winner = this.round.winner
        ? {
            user: this.round.winner.user,
            name: this.round.winner.name,
            color: this.round.winner.color,
          }
        : null;
      const banner = this.round.banner
        ? {
            text: this.round.banner.text,
            until: this.round.banner.until,
            name: this.round.banner.name,
            color: this.round.banner.color,
          }
        : null;

      const labels = [];
      for (const item of this.labels) {
        labels.push({
          text: text(item.text),
          color: text(item.color),
          x: roundTo(item.x, 4),
          y: roundTo(item.y, 4),
          born: item.born,
          until: item.until,
          size: Number(item.size) || 1,
        });
      }

      const marks = [];
      for (const item of this.marks) {
        marks.push({
          kind: text(item.kind),
          x: roundTo(item.x, 4),
          y: roundTo(item.y, 4),
          tx: roundTo(item.tx, 4),
          ty: roundTo(item.ty, 4),
          until: item.until,
          born: item.born,
        });
      }

      const leaderboard = [];
      if (this.settings.leaderboard) {
        for (const item of this.leaderboard()) leaderboard.push(item);
      }

      return {
        now,
        paused: Boolean(this.paused),
        theme: this.settings.theme,
        seaHeight: roundTo(Number(this.settings.seaHeight) / 100, 3),
        shipScale: Number(this.settings.shipScale),
        lang: this.settings.lang,
        leaderboardOn: Boolean(this.settings.leaderboard),
        round: {
          state: this.round.state,
          number: this.round.number,
          alive: this._countOccupied(),
          total: this._countInRound(),
          participants: this.participants.slice(),
          winner,
          banner,
          finishedAt: this.round.finishedAt,
          nextRoundAt: this.round.nextRoundAt,
        },
        ships,
        shots,
        particles,
        labels,
        marks,
        queue: this.queue.length,
        drowned,
        leaderboard,
      };
    }
  }

  // ------------------------------------------------------------------
  // Экспорт
  // ------------------------------------------------------------------
  function createWorld(options) {
    return new World(options);
  }

  SB.Game = {
    FIXED_STEP_MS,
    MAX_FRAME_MS,
    MAX_HP,
    MAX_PARTICLES,
    SINK_MS,
    BANNER_MS,
    SHOT_FLIGHT_MS,
    SHIELD_MS,
    MARGIN,
    MIN_GAP,
    STORAGE_PREFIX,
    SHAKE_MS,
    HIT_LABEL_MS,
    SHIELD_LABEL_MS,
    SHOT_MARK_MS,
    createRng,
    createWorld,
    World,
  };
})(typeof window !== "undefined" ? window : globalThis);
