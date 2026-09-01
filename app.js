/* =========================================================================
 * トランポリン エアトレーニング  app.js
 * 依存ライブラリなし / ビルド不要 / すべて相対パス
 * ========================================================================= */
'use strict';

(function () {

  /* =======================================================================
   * 1. 定数
   * ===================================================================== */

  var SUPPORTED_SCHEMA_VERSION = 1;
  var DATA_URL = './data/training-data.json';
  var LAST_GOOD_KEY = 'tramp-training:last-good-data';
  var VALID_CATEGORIES = ['基礎', '連続技', '中級', '応用', 'マット運動', '種目共通', 'モーグル'];

  var MSG_OFFLINE_VIDEO =
    '動画の再生にはインターネット接続が必要です。技の一覧と解説はオフラインでも確認できます。';

  /* この教材特有の言い換え辞書（§9-1）
     選手は技名ではなく「雪上で何につながるか」で探すことがある。 */
  var ALIAS_DICTIONARY = {
    'シート':     ['腰落ち', 'シートドロップ'],
    'ニー':       ['膝落ち', 'ニードロップ'],
    'フロント':   ['腹落ち', 'フロントドロップ'],
    'バック':     ['背落ち', 'バックドロップ', 'キャットドロップ'],
    'ハーフ':     ['1/2', '1/2捻り', 'ハーフピルエット'],
    'フル':       ['1回捻り', 'フルピルエット'],
    'タック':     ['かかえ跳び', '抱え跳び'],
    'パイク':     ['閉脚跳び', '屈伸跳び', 'ズートニック'],
    'ストラドル': ['開脚跳び', 'コザック'],
    'ツイスト':   ['捻り', 'ひねり'],
    '捻り':       ['ひねり', 'ツイスト'],
    'ティルト':   ['前方系ティルト'],
    'コンタクトツイスト': ['コンタクト'],
    'バックフリップ': ['宙返り', '後方宙返り']
  };

  /* =======================================================================
   * 2. 小さなユーティリティ
   * ===================================================================== */

  function $(id) { return document.getElementById(id); }

  /**
   * 要素生成ヘルパー。文字列は必ず textContent 経由で入るため、
   * データ由来の文字列が HTML として解釈されることはない（§14）。
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var v = props[key];
        if (v === null || v === undefined || v === false) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = String(v);
        else if (key === 'html') { /* 使用しない */ }
        else if (key.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(key.slice(2), v);
        } else if (v === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(v));
      }
    }
    if (children != null) {
      var list = Array.isArray(children) ? children : [children];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c)) : c);
      }
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isOnline() {
    return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  }

  /** 秒 → 0:12 形式 */
  function formatSeconds(sec) {
    var t = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(t / 60);
    var s = t % 60;
    return m + ':' + (s < 10 ? '0' + s : String(s));
  }

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  /** 'YYYY-MM-DD' → {y,m,d,weekday} 。不正なら null */
  function parseDate(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d, weekday: WEEKDAYS[dt.getDay()] };
  }

  function formatDateJa(parsed) {
    if (!parsed) return '日付不明';
    return parsed.y + '年' + parsed.m + '月' + parsed.d + '日（' + parsed.weekday + '）';
  }

  /** ISO文字列 → 「2026年8月4日 21:30」（日本時間で表示） */
  function formatUpdatedAt(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(d);
    } catch (e) {
      return d.toLocaleString('ja-JP');
    }
  }

  /**
   * 検索用の正規化（§9）
   *  - 全角英数→半角（NFKC）
   *  - 小文字化
   *  - 長音「ー」中黒「・」を除去して有無を吸収
   *  - 連続空白の圧縮 / 前後の空白除去
   */
  function normalize(str) {
    if (typeof str !== 'string') return '';
    var s = str;
    if (typeof s.normalize === 'function') s = s.normalize('NFKC');
    s = s.toLowerCase();
    s = s.replace(/[\u30FC\u30FB\uFF65\u00B7]/g, '');   // ー ・ ･ ·
    s = s.replace(/[\u3000\s]+/g, ' ');
    return s.trim();
  }

  /* 辞書キーも正規化しておく */
  var ALIAS_NORM = (function () {
    var out = {};
    for (var k in ALIAS_DICTIONARY) {
      if (!Object.prototype.hasOwnProperty.call(ALIAS_DICTIONARY, k)) continue;
      out[normalize(k)] = ALIAS_DICTIONARY[k];
    }
    return out;
  })();

  /* =======================================================================
   * 3. 状態
   * ===================================================================== */

  var state = {
    sessions: [],
    updatedAt: null,
    query: '',
    category: 'all',
    route: { name: 'home', sessionId: null },
    selectedExerciseId: null,
    focusExerciseId: null,   // 検索結果から詳細を開いたときのスクロール先
    pendingAutoPlay: false,  // 検索結果の「実演を見る」から遷移したか
    dataSource: 'network',   // 'network' | 'fallback'
    validation: { errors: [], warnings: [] }
  };

  var dom = {};

  /* =======================================================================
   * 4. データ読み込みと検証
   * ===================================================================== */

  /** hasStart / hasVideo の正しい判定（§5-2）。start: 0 は有効値。 */
  function hasStart(ex) {
    return typeof ex.start === 'number' && isFinite(ex.start) && ex.start >= 0;
  }
  function hasVideo(session) {
    return typeof session.youtubeId === 'string' && session.youtubeId.trim() !== '';
  }

  function validateTrainingData(rawSessions) {
    var errors = [];
    var warnings = [];
    var sessions = [];

    if (!Array.isArray(rawSessions)) {
      errors.push('sessions が配列ではありません。');
      return { sessions: [], errors: errors, warnings: warnings };
    }

    var seenSessionIds = Object.create(null);

    rawSessions.forEach(function (raw, index) {
      var where = 'sessions[' + index + ']';

      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push(where + ' はオブジェクトではないためスキップしました。');
        return;
      }
      var id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id) {
        warnings.push(where + ' に id がないためスキップしました。');
        return;
      }
      if (seenSessionIds[id]) {
        warnings.push(where + ' の id "' + id + '" が重複しているためスキップしました。');
        return;
      }
      var parsedDate = parseDate(raw.date);
      if (!parsedDate) {
        warnings.push(where + ' (id: ' + id + ') の date "' + raw.date +
          '" が YYYY-MM-DD 形式ではないためスキップしました。');
        return;
      }
      if (!Array.isArray(raw.exercises)) {
        warnings.push(where + ' (id: ' + id + ') の exercises が配列ではないためスキップしました。');
        return;
      }

      seenSessionIds[id] = true;

      var category = typeof raw.category === 'string' ? raw.category.trim() : '';
      if (VALID_CATEGORIES.indexOf(category) === -1) {
        warnings.push('id: ' + id + ' の category "' + category +
          '" は想定外です（想定：' + VALID_CATEGORIES.join(' / ') + '）。表示はそのまま行います。');
      }

      var session = {
        id: id,
        date: raw.date,
        parsedDate: parsedDate,
        dateLabel: formatDateJa(parsedDate),
        title: (typeof raw.title === 'string' && raw.title.trim())
          ? raw.title : formatDateJa(parsedDate),
        category: category,
        youtubeId: typeof raw.youtubeId === 'string' ? raw.youtubeId.trim() : '',
        duration: (typeof raw.duration === 'number' && isFinite(raw.duration) && raw.duration > 0)
          ? raw.duration : null,
        exercises: []
      };

      var seenExIds = Object.create(null);
      var startCount = 0;

      raw.exercises.forEach(function (rawEx, exIndex) {
        var exWhere = 'id: ' + id + ' の exercises[' + exIndex + ']';

        if (!rawEx || typeof rawEx !== 'object' || Array.isArray(rawEx)) {
          warnings.push(exWhere + ' はオブジェクトではないためスキップしました。');
          return;
        }
        var name = typeof rawEx.name === 'string' ? rawEx.name.trim() : '';
        if (!name) {
          warnings.push(exWhere + ' に name がないためスキップしました。');
          return;
        }

        var exId = typeof rawEx.id === 'string' && rawEx.id.trim()
          ? rawEx.id.trim() : id + '-ex' + (exIndex + 1);
        if (seenExIds[exId]) {
          warnings.push(exWhere + ' の id "' + exId + '" が重複しているため連番に置き換えました。');
          exId = exId + '-' + (exIndex + 1);
        }
        seenExIds[exId] = true;

        var start = null;
        if (rawEx.start === null || rawEx.start === undefined) {
          start = null;                       // 未設定は正常な状態
        } else if (typeof rawEx.start === 'number' && isFinite(rawEx.start) && rawEx.start >= 0) {
          start = rawEx.start;
        } else {
          warnings.push(exWhere + ' の start "' + rawEx.start +
            '" は 0 以上の数値ではないため未設定として扱います。');
        }

        var end = null;
        if (typeof rawEx.end === 'number' && isFinite(rawEx.end) && rawEx.end >= 0) end = rawEx.end;

        var detail = typeof rawEx.detail === 'string' ? rawEx.detail : '';
        var group = typeof rawEx.group === 'string' ? rawEx.group : '';
        var prescription = typeof rawEx.prescription === 'string' ? rawEx.prescription : '';
        var aliases = Array.isArray(rawEx.aliases)
          ? rawEx.aliases.filter(function (a) { return typeof a === 'string' && a; }) : [];

        // 表示名は元表の原文どおりに復元する（name（detail））
        var displayName = detail ? name + '（' + detail + '）' : name;

        var ex = {
          id: exId,
          sessionId: id,
          no: (typeof rawEx.no === 'number' && isFinite(rawEx.no)) ? rawEx.no : (exIndex + 1),
          group: group,
          name: name,
          detail: detail,
          displayName: displayName,
          prescription: prescription,
          aliases: aliases,
          start: start,
          end: end,
          notes: typeof rawEx.notes === 'string' ? rawEx.notes : '',
          howto: typeof rawEx.howto === 'string' ? rawEx.howto : '',
          caution: typeof rawEx.caution === 'string' ? rawEx.caution : '',
          safety: typeof rawEx.safety === 'string' ? rawEx.safety : '',
          link: typeof rawEx.link === 'string' ? rawEx.link : '',
          // 「雪上へのつながり」からも引けるようにする（例：バックフリップ で検索）
          searchText: normalize([name, detail, group, aliases.join(' '),
            rawEx.link || '', rawEx.howto || ''].join(' '))
        };

        if (start !== null) startCount++;
        session.exercises.push(ex);
      });

      if (session.exercises.length === 0) {
        warnings.push('id: ' + id + ' には有効な種目が1件もありません。空の状態で表示します。');
      }

      // §5-2 の状態表：youtubeId なし・start あり＝データ不整合（管理者向け警告のみ）
      if (!hasVideo(session) && startCount > 0) {
        warnings.push('id: ' + id + ' は youtubeId が空なのに start が ' + startCount +
          ' 件設定されています。動画IDを設定してください（選手画面には影響しません）。');
      }

      sessions.push(session);
    });

    // 新しい日付が上
    sessions.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });

    return { sessions: sessions, errors: errors, warnings: warnings };
  }

  function readLastGood() {
    try {
      var raw = window.localStorage.getItem(LAST_GOOD_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function writeLastGood(data) {
    try {
      window.localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(data));
    } catch (e) { /* 容量超過・プライベートモード等。致命的ではない */ }
  }

  function applyData(data, source) {
    var result = validateTrainingData(data.sessions);
    state.sessions = result.sessions;
    state.updatedAt = data.updatedAt || null;
    state.validation = { errors: result.errors, warnings: result.warnings };
    state.dataSource = source;

    result.warnings.forEach(function (w) { console.warn('[データ検証] ' + w); });
    result.errors.forEach(function (e) { console.error('[データ検証] ' + e); });

    console.info('[データ検証] セッション ' + result.sessions.length + ' 件 / 種目 ' +
      result.sessions.reduce(function (n, s) { return n + s.exercises.length; }, 0) +
      ' 件 / エラー ' + result.errors.length + ' 件 / 警告 ' + result.warnings.length + ' 件');

    return result;
  }

  async function loadTrainingData() {
    var res, text, data;

    try {
      res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } catch (err) {
      console.warn('教程データを取得できませんでした。', err);
      return fallbackToLastGood('教程データを取得できませんでした。');
    }

    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error('教程データの書式が壊れています（JSONとして読めません）。', err);
      return fallbackToLastGood(
        '教程データの書式が壊れているため読み込めませんでした。',
        'data/training-data.json のカンマ・かっこの閉じ忘れを確認してください。'
      );
    }

    if (!data || typeof data !== 'object') {
      return fallbackToLastGood('教程データの中身が空でした。');
    }

    if (data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      console.error('未対応の schemaVersion です: ' + data.schemaVersion);
      return fallbackToLastGood(
        'この教程データは、いま入っているアプリでは読み込めません。',
        'アプリを最新に更新してから、もう一度開いてください。'
      );
    }

    var result = applyData(data, 'network');

    if (result.sessions.length > 0) {
      writeLastGood(data);   // 次に壊れたときの保険として保存
    }
    return result;
  }

  function fallbackToLastGood(title, hint) {
    var saved = readLastGood();
    if (saved && saved.sessions) {
      applyData(saved, 'fallback');
      showNotice('warn', title, (hint ? hint + ' ' : '') +
        'いまは、前回この端末で読み込めた内容を表示しています。');
      return state.validation;
    }
    state.sessions = [];
    state.updatedAt = null;
    state.dataSource = 'fallback';
    showNotice('error', title, hint || '通信状態を確認して、画面を読み込み直してください。');
    return { sessions: [], errors: [title], warnings: [] };
  }

  /* =======================================================================
   * 5. お知らせ表示
   * ===================================================================== */

  function showNotice(kind, title, body, actionLabel, actionFn) {
    var children = [
      el('span', { class: 'notice__text' }, [
        el('strong', { class: 'notice__title', text: title }),
        body ? document.createTextNode(body) : null
      ])
    ];
    if (actionLabel && actionFn) {
      children.push(el('button', {
        type: 'button', class: 'notice__btn', text: actionLabel, onclick: actionFn
      }));
    }
    var node = el('div', { class: 'notice notice--' + kind, role: 'status' }, children);
    dom.noticeArea.appendChild(node);
    return node;
  }

  /* =======================================================================
   * 6. YouTube プレーヤー（§7）
   *    - 初期表示では YouTube 系ドメインへの通信を一切行わない
   *    - APIスクリプトとプレーヤーはそれぞれ最大1個
   * ===================================================================== */

  var yt = {
    apiPromise: null,
    scriptEl: null,
    player: null,
    ready: false,
    sessionId: null,
    creating: false,
    pending: null,          // {sessionId, start, exerciseId} 最後に選ばれたものが勝つ
    soundOn: false,         // 既定はミュート（自動再生をブラウザに許可させるため）
    lastRequestedStart: null,
    durationChecked: false,
    autoplayTimer: null
  };

  function loadYouTubeApiOnce() {
    if (yt.apiPromise) return yt.apiPromise;

    yt.apiPromise = new Promise(function (resolve, reject) {
      if (window.YT && typeof window.YT.Player === 'function') { resolve(window.YT); return; }

      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('YouTube IFrame API の読み込みがタイムアウトしました。'));
      }, 15000);

      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previous === 'function') { try { previous(); } catch (e) { /* noop */ } }
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(window.YT);
      };

      // <script> の挿入はここ一度きり
      var script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.setAttribute('data-nt-youtube-api', '1');
      script.onerror = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('YouTube IFrame API を読み込めませんでした。'));
      };
      yt.scriptEl = script;
      document.head.appendChild(script);
    });

    // 失敗したときは、再試行できるようにやり直せる状態へ戻す
    yt.apiPromise.catch(function () {
      yt.apiPromise = null;
      if (yt.scriptEl && yt.scriptEl.parentNode) {
        yt.scriptEl.parentNode.removeChild(yt.scriptEl);  // script要素を1個に保つ
      }
      yt.scriptEl = null;
    });

    return yt.apiPromise;
  }

  function destroyPlayer() {
    if (yt.autoplayTimer) { window.clearTimeout(yt.autoplayTimer); yt.autoplayTimer = null; }
    if (yt.player && typeof yt.player.destroy === 'function') {
      try { yt.player.destroy(); } catch (e) { console.warn('プレーヤーの破棄に失敗しました。', e); }
    }
    yt.player = null;
    yt.ready = false;
    yt.sessionId = null;
    yt.creating = false;
    yt.pending = null;
    yt.lastRequestedStart = null;
    yt.durationChecked = false;

    var mount = $('player-mount');
    if (mount && mount.parentNode) mount.parentNode.removeChild(mount);
    updateSoundButton();
  }

  function currentSession() {
    if (state.route.name !== 'session') return null;
    return findSession(state.route.sessionId);
  }

  /** 動画エリアの表示状態を切り替える */
  function setVideoUi(mode, message) {
    var area = $('video-area');
    var frame = $('video-frame');
    var overlay = $('video-overlay');
    var msg = $('video-msg');
    if (!area || !frame) return;

    if (msg) {
      if (message) { msg.textContent = message; msg.hidden = false; }
      else { msg.textContent = ''; msg.hidden = true; }
    }
    if (!overlay) return;

    clear(overlay);
    overlay.hidden = true;

    if (mode === 'loading') {
      overlay.hidden = false;
      overlay.appendChild(el('div', { class: 'spinner', 'aria-hidden': 'true' }));
      overlay.appendChild(el('p', { text: '動画を読み込んでいます' }));
    } else if (mode === 'error') {
      overlay.hidden = false;
      overlay.appendChild(el('p', { text: '動画を読み込めませんでした' }));
      overlay.appendChild(el('button', {
        type: 'button', class: 'video-overlay__btn', text: 'もう一度試す',
        onclick: function () {
          var s = currentSession();
          if (s) requestPlayback(s, yt.lastRequestedStart != null ? yt.lastRequestedStart : 0,
            state.selectedExerciseId);
        }
      }));
    } else if (mode === 'needs-tap') {
      overlay.hidden = false;
      overlay.appendChild(el('p', { text: '準備できました。再生ボタンを押してください' }));
      overlay.appendChild(el('button', {
        type: 'button', class: 'video-overlay__btn', text: '▶ 再生',
        onclick: function () {
          if (yt.player && typeof yt.player.playVideo === 'function') yt.player.playVideo();
          setVideoUi('none');
        }
      }));
    }
  }

  function expandVideo() {
    var area = $('video-area');
    if (area) area.classList.add('is-expanded');
    var actions = $('video-actions');
    if (actions) actions.hidden = false;
    updateSoundButton();
  }

  /** ミュート切り替えボタンの表示を、いまの状態に合わせる */
  function updateSoundButton() {
    var btn = $('sound-toggle');
    if (!btn) return;
    btn.hidden = !yt.player;
    btn.textContent = yt.soundOn ? '🔊 音を消す' : '🔇 音を出す';
    btn.setAttribute('aria-pressed', yt.soundOn ? 'true' : 'false');
  }

  function toggleSound() {
    if (!yt.player) return;
    yt.soundOn = !yt.soundOn;
    try {
      if (yt.soundOn) { yt.player.unMute(); yt.player.setVolume(100); }
      else { yt.player.mute(); }
    } catch (e) {
      console.warn('音量を切り替えられませんでした。', e);
    }
    updateSoundButton();
  }

  function collapseVideo() {
    destroyPlayer();
    var area = $('video-area');
    if (area) area.classList.remove('is-expanded');
    var actions = $('video-actions');
    if (actions) actions.hidden = true;
    var placeholder = $('video-placeholder');
    if (placeholder) placeholder.hidden = false;
    setVideoUi('none');
    setSelectedExercise(null);
  }

  /**
   * 再生要求。プレーヤー準備中に連続タップされても
   * 「最後に選ばれた種目」が勝つ（§7-3 b）。
   */
  function requestPlayback(session, start, exerciseId) {
    if (!session || !hasVideo(session)) return;

    setSelectedExercise(exerciseId || null);

    if (!isOnline()) {
      setVideoUi('none', MSG_OFFLINE_VIDEO);
      return;
    }

    var startSec = (typeof start === 'number' && isFinite(start) && start >= 0) ? start : 0;
    yt.pending = { sessionId: session.id, start: startSec, exerciseId: exerciseId || null };
    yt.lastRequestedStart = startSec;

    var placeholder = $('video-placeholder');
    if (placeholder) placeholder.hidden = true;
    expandVideo();

    // 既に同じ日のプレーヤーがある：新しい iframe は作らず seekTo だけ
    if (yt.player && yt.ready && yt.sessionId === session.id) {
      applyPending();
      return;
    }
    // 別の日のプレーヤーが残っていれば破棄
    if (yt.player && yt.sessionId !== session.id) destroyPlayer();

    setVideoUi('loading');

    loadYouTubeApiOnce().then(function () {
      createPlayer(session);
    }).catch(function (err) {
      console.warn(err && err.message ? err.message : err);
      setVideoUi('error');
    });
  }

  function createPlayer(session) {
    if (yt.creating || yt.player) { return; }
    if (state.route.name !== 'session' || state.route.sessionId !== session.id) return;

    var frame = $('video-frame');
    if (!frame) return;

    yt.creating = true;
    yt.sessionId = session.id;
    yt.durationChecked = false;

    var mount = el('div', { id: 'player-mount', class: 'player-mount' });
    // オーバーレイより下に置く
    frame.insertBefore(mount, $('video-overlay'));

    var startSec = yt.pending ? Math.floor(yt.pending.start) : 0;

    try {
      yt.player = new window.YT.Player(mount, {
        videoId: session.youtubeId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          start: startSec
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError
        }
      });
    } catch (e) {
      yt.creating = false;
      console.warn('プレーヤーを生成できませんでした。', e);
      setVideoUi('error');
    }
  }

  function onPlayerReady() {
    yt.creating = false;
    yt.ready = true;
    setVideoUi('none');
    applyPending();
  }

  function applyPending() {
    var p = yt.pending;
    yt.pending = null;
    if (!p || !yt.player || !yt.ready) return;

    var t = p.start;
    var duration = 0;
    try { duration = yt.player.getDuration ? yt.player.getDuration() : 0; } catch (e) { duration = 0; }

    if (duration > 0) {
      yt.durationChecked = true;
      if (t >= duration) {
        console.warn('種目の開始秒（' + t + '秒）が動画の長さ（' + Math.round(duration) +
          '秒）を超えています。先頭から再生します。');
        t = 0;
      }
    }

    setSelectedExercise(p.exerciseId);

    try {
      // 音ありの自動再生はブラウザに拒否されるため、既定はミュートで始める。
      // 動画にはテロップが焼き込まれているので、音がなくても種目は分かる。
      if (!yt.soundOn) yt.player.mute();
      yt.player.seekTo(t, true);
      yt.player.playVideo();
    } catch (e) {
      console.warn('再生位置の指定に失敗しました。', e);
    }
    updateSoundButton();

    scheduleAutoplayCheck();
    scrollVideoIntoView();
  }

  /** 自動再生が拒否された場合に備え、少し待って状態を確認する（§7-3 d） */
  function scheduleAutoplayCheck() {
    if (yt.autoplayTimer) window.clearTimeout(yt.autoplayTimer);
    yt.autoplayTimer = window.setTimeout(function () {
      yt.autoplayTimer = null;
      if (!yt.player || !yt.ready) return;
      var st = -1;
      try { st = yt.player.getPlayerState(); } catch (e) { return; }
      // 1 = 再生中, 3 = バッファリング
      if (st !== 1 && st !== 3) setVideoUi('needs-tap');
    }, 1600);
  }

  function onPlayerStateChange(event) {
    if (event && (event.data === 1 || event.data === 3)) {
      setVideoUi('none');
      // 再生が始まってから改めて長さを確認する
      if (!yt.durationChecked && yt.lastRequestedStart != null) {
        var duration = 0;
        try { duration = yt.player.getDuration(); } catch (e) { duration = 0; }
        if (duration > 0) {
          yt.durationChecked = true;
          if (yt.lastRequestedStart >= duration) {
            console.warn('種目の開始秒（' + yt.lastRequestedStart + '秒）が動画の長さ（' +
              Math.round(duration) + '秒）を超えています。先頭から再生します。');
            try { yt.player.seekTo(0, true); } catch (e) { /* noop */ }
          }
        }
      }
    }
  }

  function onPlayerError(event) {
    console.warn('YouTubeプレーヤーがエラーを返しました。code=' + (event && event.data));
    setVideoUi('error');
  }

  function scrollVideoIntoView() {
    var area = $('video-area');
    if (!area) return;
    try {
      area.scrollIntoView({
        block: 'start',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      });
    } catch (e) {
      area.scrollIntoView();
    }
  }

  /* =======================================================================
   * 7. 選択状態
   * ===================================================================== */

  function setSelectedExercise(exerciseId) {
    state.selectedExerciseId = exerciseId || null;
    var nodes = document.querySelectorAll('.exercise');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var isSel = !!exerciseId && node.getAttribute('data-exercise-id') === exerciseId;
      node.classList.toggle('is-selected', isSel);
      var main = node.querySelector('.exercise__main');
      if (main) main.setAttribute('aria-pressed', isSel ? 'true' : 'false');
    }
  }

  /* =======================================================================
   * 8. 検索（§9）
   * ===================================================================== */

  /**
   * 検索語 → 「候補（トークン配列）」の配列。
   * いずれかの候補について、そのトークンが全部含まれていればヒット。
   * 辞書展開は「検索文字列全体が辞書キーと完全一致」または
   * 「空白区切りの完全なトークンと一致」のときだけ行う。
   */
  function buildSearchAlternatives(rawQuery) {
    var q = normalize(rawQuery);
    if (!q) return [];

    var tokens = q.split(' ').filter(Boolean);
    if (tokens.length === 0) return [];

    var alternatives = [tokens];

    function pushAlias(list) {
      list.forEach(function (alias) {
        var t = normalize(alias).split(' ').filter(Boolean);
        if (t.length) alternatives.push(t);
      });
    }

    if (Object.prototype.hasOwnProperty.call(ALIAS_NORM, q)) {
      // 検索文字列全体が辞書キーと完全一致
      pushAlias(ALIAS_NORM[q]);
    } else if (tokens.length > 1) {
      // 空白区切りの完全なトークンと一致した場合のみ、そのトークンを置き換えた候補を作る
      tokens.forEach(function (token, i) {
        if (token === 'e') return;   // 「E」は単独検索のときだけ展開する
        if (!Object.prototype.hasOwnProperty.call(ALIAS_NORM, token)) return;
        ALIAS_NORM[token].forEach(function (alias) {
          var replaced = tokens.slice();
          replaced[i] = normalize(alias);
          alternatives.push(replaced.join(' ').split(' ').filter(Boolean));
        });
      });
    }
    return alternatives;
  }

  /** 1文字の英数字は前後を区切って一致させる（英字 e の誤ヒットを防ぐ） */
  function tokenMatches(haystack, token) {
    if (token.length === 1 && /^[a-z0-9]$/.test(token)) {
      var re = new RegExp('(^|[^a-z0-9])' + token + '([^a-z0-9]|$)');
      return re.test(haystack);
    }
    return haystack.indexOf(token) !== -1;
  }

  function matchesAlternatives(haystack, alternatives) {
    for (var i = 0; i < alternatives.length; i++) {
      var tokens = alternatives[i];
      var ok = true;
      for (var j = 0; j < tokens.length; j++) {
        if (!tokenMatches(haystack, tokens[j])) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function searchExercises(query, category) {
    var alternatives = buildSearchAlternatives(query);
    if (alternatives.length === 0) return [];

    var hits = [];
    state.sessions.forEach(function (session) {
      if (category !== 'all' && session.category !== category) return;
      session.exercises.forEach(function (ex) {
        if (matchesAlternatives(ex.searchText, alternatives)) {
          hits.push({ session: session, exercise: ex });
        }
      });
    });
    return hits;
  }

  /* =======================================================================
   * 9. 描画：ホーム
   * ===================================================================== */

  function findSession(id) {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function categoryBadge(category) {
    var cls = 'badge';
    if (category === 'アジプラ') cls += ' badge--agipla';
    else if (category === 'コア') cls += ' badge--core';
    return el('span', { class: cls, text: category || 'カテゴリ未設定' });
  }

  function renderHome() {
    var body = dom.homeBody;
    clear(body);

    if (state.sessions.length === 0) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        el('strong', { text: 'まだ章がありません' }),
        el('p', { text: '章のデータが登録されると、ここに表示されます。' })
      ]));
      return;
    }

    if (state.query.trim()) { renderSearchResults(body); return; }

    var list = state.sessions.filter(function (s) {
      return state.category === 'all' || s.category === state.category;
    });

    if (list.length === 0) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        el('strong', { text: '該当する章がありません' }),
        el('p', { text: '「すべて」を選ぶと、全部の章が表示されます。' })
      ]));
      return;
    }

    body.appendChild(el('p', { class: 'section-label', text: '章（' + list.length + '件）' }));

    var ul = el('ul', { class: 'session-list' });
    list.forEach(function (session, index) {
      var isLatest = false;   // 章に新旧はないので強調しない
      var card = el('a', {
        class: 'session-card' + (isLatest ? ' session-card--latest' : ''),
        href: '#/session/' + encodeURIComponent(session.id)
      }, [
        el('span', { class: 'session-card__date' }, [
          el('span', { class: 'session-card__md', text: String(index + 1) }),
          el('span', { class: 'session-card__yw', text: '章' })
        ]),
        el('span', { class: 'session-card__body' }, [
          el('span', { class: 'session-card__title', text: session.title }),
          el('span', { class: 'session-card__meta' }, [
            categoryBadge(session.category),
            el('span', { text: session.exercises.length + '技' }),
            hasVideo(session) ? el('span', { text: '動画あり' }) : el('span', { text: '動画は準備中' })
          ])
        ]),
        el('span', { class: 'session-card__chev', 'aria-hidden': 'true', text: '›' })
      ]);
      ul.appendChild(el('li', null, card));
    });
    body.appendChild(ul);
  }

  function renderSearchResults(body) {
    var hits = searchExercises(state.query, state.category);

    if (hits.length === 0) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        el('strong', { text: '「' + state.query.trim() + '」に一致する技はありません' }),
        el('p', { text: '技名の一部だけでも検索できます。「バックフリップ」「ティルト」など雪上の動きからも引けます。' })
      ]));
      return;
    }

    body.appendChild(el('p', {
      class: 'result-count',
      text: '検索結果 ' + hits.length + '件'
    }));

    var ul = el('ul', { class: 'result-list' });

    hits.forEach(function (hit) {
      var session = hit.session;
      var ex = hit.exercise;
      var canSeek = hasVideo(session) && hasStart(ex);

      var main = el('button', {
        type: 'button',
        class: 'result-item__main',
        onclick: function () { openSession(session.id, ex.id, false); }
      }, [
        el('span', { class: 'result-item__name', text: ex.displayName }),
        ex.link ? el('span', { class: 'result-item__pres', text: ex.link }) : null,
        el('span', { class: 'result-item__meta' }, [
          categoryBadge(session.category),
          el('span', { text: session.title }),
          ex.group ? el('span', { text: ex.group }) : null
        ])
      ]);

      var item = el('li', { class: 'result-item' }, [main]);

      if (canSeek) {
        item.appendChild(el('button', {
          type: 'button',
          class: 'exercise__play',
          'aria-label': ex.displayName + ' の実演を見る',
          onclick: function () { openSession(session.id, ex.id, true); }
        }, [
          el('span', { class: 'exercise__play-icon', 'aria-hidden': 'true', text: '▶' }),
          el('span', { class: 'exercise__play-label', text: '実演を見る' }),
          el('span', { class: 'exercise__play-time', text: formatSeconds(ex.start) })
        ]));
      }

      ul.appendChild(item);
    });

    body.appendChild(ul);
  }

  /* =======================================================================
   * 10. 描画：詳細
   * ===================================================================== */

  function renderDetail(session) {
    var view = dom.viewDetail;

    // 画面を組み直す前に必ずプレーヤーを破棄する。
    // これを忘れると iframe だけ DOM から消えて音声が鳴り続ける。
    destroyPlayer();
    clear(view);

    view.appendChild(el('button', {
      type: 'button', class: 'back-btn',
      onclick: function () { goHome(); }
    }, [
      el('span', { 'aria-hidden': 'true', text: '←' }),
      el('span', { text: '一覧へ戻る' })
    ]));

    view.appendChild(el('div', { class: 'detail-head' }, [
      el('h2', { class: 'detail-head__title', text: session.title }),
      el('p', { class: 'detail-head__date', text: '統一指導教程' }),
      el('p', { class: 'detail-head__row' }, [
        categoryBadge(session.category),
        el('span', { class: 'badge', text: session.exercises.length + '技' })
      ])
    ]));

    view.appendChild(buildVideoArea(session));
    view.appendChild(buildExerciseList(session));

    view.appendChild(el('button', {
      type: 'button', class: 'back-btn back-btn--bottom',
      onclick: function () { goHome(); }
    }, [
      el('span', { 'aria-hidden': 'true', text: '←' }),
      el('span', { text: '一覧へ戻る' })
    ]));
  }

  function buildVideoArea(session) {
    var frameChildren = [];

    if (hasVideo(session)) {
      frameChildren.push(el('button', {
        type: 'button',
        id: 'video-placeholder',
        class: 'video-placeholder',
        onclick: function () { requestPlayback(session, 0, null); }
      }, [
        el('span', { class: 'video-placeholder__top' }, [
          el('span', { text: session.title }),
          el('span', { class: 'video-placeholder__cat', text: session.category || '' })
        ]),
        el('span', { class: 'video-placeholder__icon', 'aria-hidden': 'true', text: '▶' }),
        el('span', { class: 'video-placeholder__label', text: '動画を見る' })
      ]));
    } else {
      frameChildren.push(el('div', { class: 'video-static' }, [
        el('span', { text: '動画は準備中です' }),
        el('span', { class: 'video-static__sub', text: '技の解説はこのまま読めます' })
      ]));
    }

    frameChildren.push(el('div', {
      id: 'video-overlay', class: 'video-overlay', hidden: true, 'aria-live': 'polite'
    }));

    var area = el('div', { id: 'video-area', class: 'video-area' }, [
      el('div', { id: 'video-frame', class: 'video-frame' }, frameChildren),
      el('div', { id: 'video-actions', class: 'video-actions', hidden: true }, [
        el('button', {
          type: 'button', id: 'sound-toggle', class: 'video-actions__btn',
          hidden: true, 'aria-pressed': 'false', text: '🔇 音を出す',
          onclick: function () { toggleSound(); }
        }),
        el('button', {
          type: 'button', class: 'video-actions__btn', text: '動画を閉じる',
          onclick: function () { collapseVideo(); }
        })
      ]),
      el('p', { id: 'video-msg', class: 'video-msg', hidden: true, role: 'status' }),
      el('p', {
        class: 'video-note',
        text: hasVideo(session)
          ? '動画にはテロップが入っています。音声なしでも種目を確認できます。'
          : '動画が用意でき次第、ここで再生できるようになります。'
      })
    ]);

    return area;
  }

  /**
   * 技の解説。教程の文章は削らず、出す順番だけ変える。
   *  ・雪上へのつながり … 常時表示（この教材でモーグル選手に一番効く部分）
   *  ・安全上の注意     … 常時表示（畳まない）
   *  ・やり方／注意点   … 折りたたみ
   */
  function buildExerciseDoc(ex) {
    var doc = el('div', { class: 'exdoc' });

    if (ex.link) {
      doc.appendChild(el('p', { class: 'exdoc__link' }, [
        el('span', { class: 'exdoc__link-label', text: '雪上へのつながり' }),
        el('span', { class: 'exdoc__link-text', text: ex.link })
      ]));
    }

    if (ex.safety) {
      doc.appendChild(el('p', { class: 'exdoc__safety' }, [
        el('span', { class: 'exdoc__safety-label', 'aria-hidden': 'true', text: '⚠' }),
        el('span', { text: ex.safety })
      ]));
    }

    [['やり方', ex.howto], ['注意点', ex.caution]].forEach(function (pair) {
      if (!pair[1]) return;
      var body = el('div', { class: 'exdoc__panel' }, [el('p', { text: pair[1] })]);
      body.hidden = true;

      var btn = el('button', {
        type: 'button',
        class: 'exdoc__toggle',
        'aria-expanded': 'false',
        onclick: function () {
          var open = body.hidden;
          body.hidden = !open;
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          btn.classList.toggle('is-open', open);
        }
      }, [
        el('span', { text: pair[0] }),
        el('span', { class: 'exdoc__caret', 'aria-hidden': 'true', text: '▾' })
      ]);

      doc.appendChild(el('div', { class: 'exdoc__section' }, [btn, body]));
    });

    return doc;
  }

  function buildExerciseList(session) {
    var wrap = el('div', { class: 'exercise-wrap' });

    if (session.exercises.length === 0) {
      wrap.appendChild(el('div', { class: 'detail-empty' },
        'この章の技データはまだ登録されていません。'));
      return wrap;
    }

    var videoAvailable = hasVideo(session);
    var currentGroup = null;
    var ul = null;

    session.exercises.forEach(function (ex) {
      if (ex.group !== currentGroup || ul === null) {
        currentGroup = ex.group;
        wrap.appendChild(el('h3', { class: 'group-heading', text: currentGroup || 'その他' }));
        ul = el('ul', { class: 'exercise-list' });
        wrap.appendChild(ul);
      }

      var canSeek = videoAvailable && hasStart(ex);

      var main = el('button', {
        type: 'button',
        class: 'exercise__main',
        'aria-pressed': 'false',
        onclick: function () { setSelectedExercise(ex.id); }
      }, [
        el('span', { class: 'exercise__no', 'aria-hidden': 'true', text: String(ex.no) }),
        el('span', { class: 'exercise__body' }, [
          el('span', { class: 'exercise__name', text: ex.name }),
          el('span', { class: 'exercise__pres', text: ex.detail || ex.prescription || '' }),
          el('span', { class: 'exercise__state' }, [
            el('span', { 'aria-hidden': 'true', text: '◆ ' }),
            el('span', { text: '選択中' })
          ])
        ])
      ]);

      var li = el('li', { class: 'exercise', 'data-exercise-id': ex.id, id: 'ex-' + ex.id }, [main]);

      if (canSeek) {
        li.appendChild(el('button', {
          type: 'button',
          class: 'exercise__play',
          'aria-label': ex.displayName + ' の実演を ' + formatSeconds(ex.start) + ' から見る',
          onclick: function () { requestPlayback(session, ex.start, ex.id); }
        }, [
          el('span', { class: 'exercise__play-icon', 'aria-hidden': 'true', text: '▶' }),
          el('span', { class: 'exercise__play-label', text: '実演を見る' }),
          el('span', { class: 'exercise__play-time', text: formatSeconds(ex.start) })
        ]));
      }

      li.appendChild(buildExerciseDoc(ex));
      ul.appendChild(li);
    });

    return wrap;
  }

  /* =======================================================================
   * 11. ルーティング（ハッシュ）
   * ===================================================================== */

  function parseHash() {
    var hash = window.location.hash || '';
    var m = /^#\/session\/([^/?#]+)/.exec(hash);
    if (m) {
      var id = m[1];
      try { id = decodeURIComponent(id); } catch (e) { /* そのまま使う */ }
      return { name: 'session', sessionId: id };
    }
    return { name: 'home', sessionId: null };
  }

  function goHome() {
    if (window.location.hash && window.location.hash !== '#/') {
      window.location.hash = '#/';
    } else {
      handleRoute();
    }
  }

  function openSession(sessionId, focusExerciseId, autoPlay) {
    state.focusExerciseId = focusExerciseId || null;
    state.pendingAutoPlay = !!autoPlay;
    var target = '#/session/' + encodeURIComponent(sessionId);
    if (window.location.hash === target) handleRoute();
    else window.location.hash = target;
  }

  function handleRoute() {
    var route = parseHash();
    var previousSessionId = state.route.sessionId;
    state.route = route;

    // 日付が変わる／一覧へ戻る ときは必ずプレーヤーを破棄する（§7-3 c）
    if (route.name !== 'session' || route.sessionId !== previousSessionId) {
      destroyPlayer();
      state.selectedExerciseId = null;
    }

    if (route.name === 'session') {
      var session = findSession(route.sessionId);
      if (!session) {
        state.route = { name: 'home', sessionId: null };
        if (window.location.hash && window.location.hash !== '#/') {
          window.location.hash = '#/';   // ここで再度 handleRoute が走る
        }
        showNotice('warn', '指定された章が見つかりませんでした',
          '一覧から選び直してください。');
        showHomeView();
        return;
      }
      showDetailView(session);
      return;
    }

    showHomeView();
  }

  function showHomeView() {
    dom.viewDetail.hidden = true;
    clear(dom.viewDetail);
    dom.viewHome.hidden = false;
    renderHome();
    window.scrollTo(0, 0);
  }

  function showDetailView(session) {
    dom.viewHome.hidden = true;
    dom.viewDetail.hidden = false;
    renderDetail(session);

    var focusId = state.focusExerciseId;
    var autoPlay = state.pendingAutoPlay;
    state.focusExerciseId = null;
    state.pendingAutoPlay = false;

    if (focusId) {
      var node = document.querySelector('[data-exercise-id="' + cssEscape(focusId) + '"]');
      setSelectedExercise(focusId);
      if (node) {
        try {
          node.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        } catch (e) { node.scrollIntoView(); }
      }
      if (autoPlay) {
        var ex = null;
        for (var i = 0; i < session.exercises.length; i++) {
          if (session.exercises[i].id === focusId) { ex = session.exercises[i]; break; }
        }
        if (ex && hasStart(ex) && hasVideo(session)) requestPlayback(session, ex.start, ex.id);
      }
    } else {
      window.scrollTo(0, 0);
    }
  }

  /** 属性セレクタ用の最小限のエスケープ */
  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* =======================================================================
   * 12. ネットワーク状態
   * ===================================================================== */

  function updateNetworkUi() {
    var online = isOnline();
    dom.netBadge.classList.toggle('net-badge--offline', !online);
    dom.netBadge.classList.toggle('net-badge--online', online);
    dom.netBadgeText.textContent = online ? 'オンライン' : 'オフライン';
    updateUpdatedAtLabel();
  }

  function updateUpdatedAtLabel() {
    var label = formatUpdatedAt(state.updatedAt);
    var text = label ? 'データ更新：' + label : 'データ更新：日時不明';
    if (!isOnline()) text += '（オフライン保存済みの内容を表示しています）';
    else if (state.dataSource === 'fallback') text += '（前回保存した内容）';
    dom.dataUpdated.textContent = text;
  }

  /* =======================================================================
   * 13. Service Worker（§8）
   * ===================================================================== */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;   // ローカルでは登録しない

    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        // 初回インストール時（まだ制御されていない）は「新しいバージョン」を出さない
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

        reg.addEventListener('updatefound', function () {
          var incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', function () {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              offerUpdate(incoming);
            }
          });
        });
      }).catch(function (err) {
        // 登録に失敗しても通常のWebページとして使えるようにする
        console.warn('オフライン機能を準備できませんでした（アプリは通常どおり使えます）。', err);
      });
    });
  }

  var updateNoticeShown = false;
  function offerUpdate(worker) {
    if (updateNoticeShown) return;
    updateNoticeShown = true;
    showNotice('info', '新しいバージョンがあります',
      '［更新する］を押すと、最新のアプリと教程に切り替わります。',
      '更新する', function () {
        try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { window.location.reload(); }
      });
  }

  /* =======================================================================
   * 14. 初期化
   * ===================================================================== */

  function bindUi() {
    dom.noticeArea = $('notice-area');
    dom.viewHome = $('view-home');
    dom.viewDetail = $('view-detail');
    dom.homeBody = $('home-body');
    dom.searchInput = $('search-input');
    dom.searchClear = $('search-clear');
    dom.netBadge = $('net-badge');
    dom.netBadgeText = $('net-badge-text');
    dom.dataUpdated = $('data-updated');

    dom.searchInput.addEventListener('input', function () {
      state.query = dom.searchInput.value;
      dom.searchClear.hidden = state.query.trim() === '';
      if (state.route.name === 'home') renderHome();
    });

    dom.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); dom.searchInput.blur(); }
    });

    dom.searchClear.addEventListener('click', function () {
      dom.searchInput.value = '';
      state.query = '';
      dom.searchClear.hidden = true;
      dom.searchInput.focus();
      if (state.route.name === 'home') renderHome();
    });

    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function (e) {
        var btn = e.currentTarget;
        state.category = btn.getAttribute('data-category');
        for (var j = 0; j < chips.length; j++) {
          var active = chips[j] === btn;
          chips[j].classList.toggle('is-active', active);
          chips[j].setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (state.route.name === 'home') renderHome();
        else goHome();
      });
    }

    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('online', function () { updateNetworkUi(); });
    window.addEventListener('offline', function () {
      updateNetworkUi();
      if (yt.player) setVideoUi('none', MSG_OFFLINE_VIDEO);
    });
  }

  async function init() {
    bindUi();
    updateNetworkUi();
    registerServiceWorker();

    await loadTrainingData();

    updateUpdatedAtLabel();
    handleRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
