/* «Морской бой чата»: сборка страницы.
 *
 * Здесь всё, что связывает части вместе: настройки из ссылки, мир из
 * js/game.js, демо-поток или чат Twitch и один цикл рисования. Сам мир
 * живёт в game.js, рисование — в render.js: main.js только крутит время,
 * передаёт сообщения и снимки кадра.
 *
 * Файл — обычный браузерный скрипт (без import/export).
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Больше 100 мс за кадр не отдаём: после сворачивания вкладки мир не
  // должен прыгать на полминуты вперёд (мир сам режет шаг так же).
  const MAX_STEP_MS = 100;
  // Запасной шаг, если браузер не дал requestAnimationFrame.
  const FALLBACK_STEP_MS = 33;

  const state = {
    running: false,
    rafId: 0,
    last: 0,
    world: null,
    renderer: null,
    feed: null,
    chat: null,
    settings: null,
    hint: null,
    handle: null,
    listening: false,
    // Видимость слоя: stage.html прячет «Морской бой», когда показывают
    // «Светлячков». Мир при этом живёт, но кадры не рисуются.
    visible: true,
    messageListening: false,
  };

  function nowMs() {
    const performance = global.performance;
    if (performance && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function requestFrame(callback) {
    if (typeof global.requestAnimationFrame === "function") {
      return global.requestAnimationFrame(callback);
    }
    return global.setTimeout(function () {
      callback(nowMs());
    }, FALLBACK_STEP_MS);
  }

  function cancelFrame(id) {
    if (!id) return;
    if (typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(id);
    } else if (typeof global.clearTimeout === "function") {
      global.clearTimeout(id);
    }
  }

  function querySearch() {
    const location = global.location;
    if (location && typeof location.search === "string") return location.search;
    return "";
  }

  function pageHidden() {
    const document = global.document;
    return Boolean(document && document.hidden === true);
  }

  function findElement(id) {
    const document = global.document;
    if (!document || typeof document.getElementById !== "function") return null;
    try {
      return document.getElementById(id);
    } catch (error) {
      return null;
    }
  }

  function showHint(visible) {
    const hint = state.hint;
    if (!hint) return;
    if (hint.style && typeof hint.style === "object") {
      hint.style.display = visible ? "" : "none";
    }
    if (typeof hint.setAttribute === "function") {
      hint.setAttribute("aria-hidden", visible ? "false" : "true");
    }
  }

  function safeStorage() {
    // localStorage может быть недоступен (приватный режим, file://):
    // тогда счёт побед просто живёт в памяти до конца страницы.
    try {
      const storage = global.localStorage;
      if (
        storage &&
        typeof storage.getItem === "function" &&
        typeof storage.setItem === "function"
      ) {
        return storage;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function readSettings() {
    const Config = SB.Config;
    if (!Config || typeof Config.parseSearch !== "function") return null;
    return Config.parseSearch(querySearch());
  }

  function createWorld(settings) {
    const Game = SB.Game;
    if (!Game || typeof Game.createWorld !== "function") return null;
    try {
      return Game.createWorld({ settings, storage: safeStorage() });
    } catch (error) {
      return null;
    }
  }

  function startDemoFeed(settings) {
    const Demo = SB.Demo;
    if (!Demo || typeof Demo.createFeed !== "function") return null;
    try {
      return Demo.createFeed({ seed: Demo.SEED, lang: settings.lang });
    } catch (error) {
      return null;
    }
  }

  function acceptMessage(message) {
    // Боты из списка не становятся кораблями: в Python-версии их отсекал
    // сервер, здесь — эта проверка.
    if (!message || !message.user) return false;
    const Chat = SB.Chat;
    if (!Chat || typeof Chat.isIgnored !== "function") return true;
    return !Chat.isIgnored(message.user, Chat.BOT_USERS || []);
  }

  function startChat(channel, world) {
    const Chat = SB.Chat;
    if (!Chat || typeof Chat.Client !== "function") return null;
    try {
      const client = new Chat.Client({
        channel,
        onMessage(message) {
          if (!acceptMessage(message)) return;
          if (world && typeof world.onMessage === "function") {
            world.onMessage(message);
          }
        },
        onStatus(status) {
          if (status === "joined") showHint(false);
        },
      });
      client.start();
      return client;
    } catch (error) {
      return null;
    }
  }

  function drawFrame(world, renderer) {
    if (!renderer) return;
    const frame =
      world && typeof world.frame === "function" ? world.frame() : null;
    if (!frame) return;
    try {
      renderer.draw(frame, 1 / 30);
    } catch (error) {
      // Один неудачный кадр не должен останавливать оверлей.
    }
  }

  function resizeRenderer() {
    // OBS может менять размер источника: холст должен остаться резким.
    const renderer = state.renderer;
    if (!renderer || typeof renderer.resize !== "function") return;
    try {
      renderer.resize();
    } catch (error) {
      // Размер — не повод ронять страницу.
    }
  }

  /**
   * Включить или выключить рисование. Мир продолжает идти: зрители пишут
   * команды, корабли входят в игру, раунды сменяются — просто картинка не
   * тратит кадры, пока слой скрыт (так просит stage.html).
   */
  function setVisible(flag) {
    state.visible = Boolean(flag);
    return state.visible;
  }

  function onWindowMessage(event) {
    // stage.html (свой же origin, но проверка не лишняя) присылает знак
    // «тебя не видно». Сообщения другого вида не трогаем.
    const data = event && typeof event === "object" ? event.data : null;
    if (!data || typeof data !== "object") return;
    if (data.type === "sea-battle-visibility") {
      setVisible(data.visible !== false);
    }
  }

  function tick(timestamp) {
    if (!state.running) return;
    const moment = typeof timestamp === "number" ? timestamp : nowMs();
    let delta = state.last ? moment - state.last : FALLBACK_STEP_MS;
    state.last = moment;
    if (!Number.isFinite(delta) || delta < 0) delta = FALLBACK_STEP_MS;
    // Скрытая вкладка: кадры не копим — просто ждём следующего.
    if (pageHidden()) {
      state.last = moment;
      state.rafId = requestFrame(tick);
      return;
    }
    delta = Math.min(MAX_STEP_MS, delta);

    const world = state.world;
    if (world) {
      // Демо-реплики отдаём по часам мира — как строки чата от сервера.
      if (state.feed && typeof state.feed.nextDue === "function") {
        const due = state.feed.nextDue(world.now);
        for (const message of due) {
          if (typeof world.onMessage === "function") world.onMessage(message);
        }
      }
      if (typeof world.step === "function") world.step(delta);
    }

    // Скрытый слой не рисует: мир уже шагнул выше, картинку пропускаем.
    if (state.visible) drawFrame(world, state.renderer);
    state.rafId = requestFrame(tick);
  }

  function start() {
    // Запуск оверлея. Возвращает ручку с миром и рисовальщиком.
    if (state.running) return state.handle;
    const canvas = findElement("sea");
    if (!canvas) return null;
    const Render = SB.Render;
    if (!Render || typeof Render.create !== "function") return null;

    const settings = readSettings() || SB.Config.sanitize({});
    const world = createWorld(settings);
    if (!world) return null;
    let renderer = null;
    try {
      renderer = Render.create(canvas);
    } catch (error) {
      return null;
    }
    if (!renderer) return null;

    const demo = settings.demo === true;
    const channel = String(settings.channel || "");
    state.hint = findElement("hint");
    state.feed = demo ? startDemoFeed(settings) : null;
    state.chat = !demo && channel ? startChat(channel, world) : null;

    state.running = true;
    state.last = 0;
    state.world = world;
    state.renderer = renderer;
    state.settings = settings;
    resizeRenderer();
    if (typeof global.addEventListener === "function") {
      global.addEventListener("resize", resizeRenderer);
      state.listening = true;
      // stage.html управляет видимостью слоя через postMessage.
      global.addEventListener("message", onWindowMessage);
      state.messageListening = true;
    }

    // Подсказка нужна, только когда нечего показывать: ни демо, ни канала.
    showHint(!demo && !channel);
    state.rafId = requestFrame(tick);

    const handle = {
      world,
      renderer,
      feed: state.feed,
      chat: state.chat,
      settings,
      stop,
    };
    state.handle = handle;
    return handle;
  }

  function stop() {
    // Остановить цикл и соединение: пригодится тестам и перезапуску.
    if (!state.running) return;
    state.running = false;
    cancelFrame(state.rafId);
    state.rafId = 0;
    if (state.chat && typeof state.chat.stop === "function") state.chat.stop();
    state.chat = null;
    state.feed = null;
    state.handle = null;
    if (state.listening && typeof global.removeEventListener === "function") {
      global.removeEventListener("resize", resizeRenderer);
    }
    state.listening = false;
    if (state.messageListening && typeof global.removeEventListener === "function") {
      global.removeEventListener("message", onWindowMessage);
    }
    state.messageListening = false;
    state.visible = true;
  }

  SB.Main = {
    MAX_STEP_MS,
    start,
    stop,
    acceptMessage,
    setVisible,
    isVisible() {
      return state.visible;
    },
    isRunning() {
      return state.running;
    },
    currentWorld() {
      return state.world;
    },
  };

  // Скрипт подключён последним и запускается сам. В тестах холста нет —
  // тогда start() просто не вызывается.
  if (typeof global.document !== "undefined" && global.document) {
    try {
      if (findElement("sea")) start();
    } catch (error) {
      // Страницу могли открыть раньше, чем собрались все скрипты.
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
