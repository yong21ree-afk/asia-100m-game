(function () {
  "use strict";

  // ---------- Config ----------
  var RACE_DISTANCE = 100; // meters
  var ALT_STEP = 1.25;     // meters gained when alternating feet (halved from 2.5 to slow the race down)
  var SAME_STEP = 0.3;     // meters gained when pressing the same foot twice in a row (halved from 0.6)
  var MAX_LEFT_PERCENT = 90; // runner travels 0% -> 90% of track width

  var MEDAL_THRESHOLDS = { gold: 10.0, silver: 11.0 }; // < gold = GOLD, < silver = SILVER, else BRONZE
  var COMBO_MILESTONES = { 3: "comboGood", 5: "comboGreat", 10: "comboAmazing", 20: "comboPerfect" };
  var NEXT_GOAL_MARGIN = 0.2; // seconds faster than personal best
  var DAILY_CHALLENGE_MIN = 9.8;
  var DAILY_CHALLENGE_MAX = 10.8;

  // ---------- Rivals: a fixed roster, one picked deterministically per day ----------
  var RIVALS = [
    { flag: "🇯🇵", name: "TANAKA", record: 10.31 },
    { flag: "🇺🇸", name: "JOHNSON", record: 9.98 },
    { flag: "🇰🇷", name: "MINJUN", record: 10.55 },
    { flag: "🇯🇲", name: "CAMPBELL", record: 9.85 },
    { flag: "🇬🇧", name: "SMITH", record: 10.72 },
    { flag: "🇧🇷", name: "SILVA", record: 10.18 }
  ];

  function seededFraction(seed) {
    var x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function todaySeedBase() {
    var now = new Date();
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  }

  function computeDailyRival() {
    var idx = Math.floor(seededFraction(todaySeedBase() + 777) * RIVALS.length) % RIVALS.length;
    return RIVALS[idx];
  }

  var dailyRival = computeDailyRival();
  var rivalPaceSpeed = RACE_DISTANCE / dailyRival.record;

  // Bot speed is anchored to today's rival: Normal races at the rival's exact pace,
  // Easy/Hard scale relative to it so the difficulty picker still means something.
  var DIFFICULTIES = {
    easy: { speed: rivalPaceSpeed * 0.82 },
    normal: { speed: rivalPaceSpeed },
    hard: { speed: rivalPaceSpeed * 1.18 }
  };

  // ---------- Audio (Web Audio API, no sound files) ----------
  var AudioEngine = (function () {
    var ctx = null;
    var muted = false;
    var unlocked = false;

    function getCtx() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      return ctx;
    }

    function unlock() {
      var c = getCtx();
      if (!c || unlocked) return;
      unlocked = true;
      if (c.state === "suspended") c.resume();
      var buffer = c.createBuffer(1, 1, 22050);
      var src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start(0);
    }

    function tone(freq, startOffset, duration, opts) {
      var c = getCtx();
      if (!c || muted) return;
      opts = opts || {};
      var t0 = c.currentTime + (startOffset || 0);
      var osc = c.createOscillator();
      osc.type = opts.type || "square";
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), t0 + duration);
      }
      var gainNode = c.createGain();
      var peak = opts.gain != null ? opts.gain : 0.25;
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.01));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gainNode);
      gainNode.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.03);
    }

    function noiseBurst(startOffset, duration, opts) {
      var c = getCtx();
      if (!c || muted) return;
      opts = opts || {};
      var t0 = c.currentTime + (startOffset || 0);
      var bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
      var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, opts.decay || 2);
      }
      var noise = c.createBufferSource();
      noise.buffer = buffer;
      var filter = c.createBiquadFilter();
      filter.type = opts.filterType || "lowpass";
      filter.frequency.value = opts.filterFreq || 4000;
      var gainNode = c.createGain();
      gainNode.gain.setValueAtTime(opts.gain != null ? opts.gain : 0.4, t0);
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(c.destination);
      noise.start(t0);
      noise.stop(t0 + duration);
    }

    function playFoot(foot) {
      var freq = foot === "left" ? 660 : 880;
      tone(freq, 0, 0.09, { type: "square", gain: 0.22, attack: 0.004 });
    }

    function playMiss() {
      tone(140, 0, 0.16, { type: "sawtooth", gain: 0.22, attack: 0.004, freqEnd: 60 });
    }

    function playGunshot() {
      noiseBurst(0, 0.18, { gain: 0.5, filterFreq: 2600, decay: 2.2 });
      tone(90, 0, 0.16, { type: "square", gain: 0.3, attack: 0.001, freqEnd: 35 });
    }

    function playFalseStart() {
      tone(280, 0, 0.14, { type: "sawtooth", gain: 0.28 });
      tone(280, 0.17, 0.14, { type: "sawtooth", gain: 0.28 });
    }

    function playWinFanfare() {
      var notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6, bright & fast
      notes.forEach(function (f, i) {
        tone(f, i * 0.12, 0.24, { type: "square", gain: 0.26, attack: 0.005 });
      });
    }

    function playLoseFanfare() {
      var notes = [392, 440, 493.88, 523.25]; // G4 A4 B4 C5, ascending but soft/low
      notes.forEach(function (f, i) {
        tone(f, i * 0.18, 0.3, { type: "triangle", gain: 0.18, attack: 0.015 });
      });
    }

    // ---- Main-menu background music: original chiptune riff, procedurally generated ----
    var BGM_STEP = 0.2;
    var bgmMelody = [523.25, 659.25, 783.99, 659.25, 523.25, 659.25, 587.33, 523.25];
    var bgmBassLine = [130.81, 130.81, 196.0, 196.0, 130.81, 130.81, 196.0, 130.81];
    var bgmIndex = 0;
    var bgmNextTime = 0;
    var bgmIntervalId = null;
    var bgmActive = false;

    function bgmScheduleTick() {
      var c = getCtx();
      if (!c) return;
      while (bgmNextTime < c.currentTime + 0.12) {
        var i = bgmIndex % bgmMelody.length;
        var offset = Math.max(0, bgmNextTime - c.currentTime);
        tone(bgmMelody[i], offset, BGM_STEP * 0.9, { type: "square", gain: 0.07, attack: 0.006 });
        tone(bgmBassLine[i], offset, BGM_STEP * 0.95, { type: "triangle", gain: 0.06, attack: 0.01 });
        bgmNextTime += BGM_STEP;
        bgmIndex++;
      }
    }

    function startBgm() {
      var c = getCtx();
      if (!c || bgmActive) return;
      bgmActive = true;
      bgmIndex = 0;
      bgmNextTime = c.currentTime + 0.05;
      bgmIntervalId = setInterval(bgmScheduleTick, 50);
    }

    function stopBgm() {
      bgmActive = false;
      if (bgmIntervalId) {
        clearInterval(bgmIntervalId);
        bgmIntervalId = null;
      }
    }

    // ---- Gentle crowd-cheering ambience during the race (filtered noise, no samples) ----
    var crowdNoise = null;
    var crowdGain = null;
    var crowdLfo = null;
    var CROWD_TARGET_GAIN = 0.045;

    function startCrowdAmbience() {
      var c = getCtx();
      if (!c) return;
      stopCrowdAmbience();

      var bufferSize = c.sampleRate * 2;
      var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      var noise = c.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      var filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900;
      filter.Q.value = 0.6;

      var gainNode = c.createGain();
      var target = muted ? 0.0001 : CROWD_TARGET_GAIN;
      gainNode.gain.setValueAtTime(0.0001, c.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(target, c.currentTime + 1.1);

      var lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.15;
      var lfoGain = c.createGain();
      lfoGain.gain.value = 0.015;
      lfo.connect(lfoGain);
      lfoGain.connect(gainNode.gain);
      lfo.start();

      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(c.destination);
      noise.start();

      crowdNoise = noise;
      crowdGain = gainNode;
      crowdLfo = lfo;
    }

    function stopCrowdAmbience() {
      var c = getCtx();
      if (crowdGain && c) {
        try {
          crowdGain.gain.cancelScheduledValues(c.currentTime);
          crowdGain.gain.setValueAtTime(crowdGain.gain.value, c.currentTime);
          crowdGain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
        } catch (e) {
          /* ignore */
        }
      }
      var noiseToStop = crowdNoise;
      var lfoToStop = crowdLfo;
      setTimeout(function () {
        if (noiseToStop) { try { noiseToStop.stop(); } catch (e) { /* ignore */ } }
        if (lfoToStop) { try { lfoToStop.stop(); } catch (e) { /* ignore */ } }
      }, 400);
      crowdNoise = null;
      crowdGain = null;
      crowdLfo = null;
    }

    return {
      unlock: unlock,
      setMuted: function (v) {
        muted = v;
        var c = getCtx();
        if (crowdGain && c) {
          var target = v ? 0.0001 : CROWD_TARGET_GAIN;
          crowdGain.gain.cancelScheduledValues(c.currentTime);
          crowdGain.gain.setValueAtTime(crowdGain.gain.value, c.currentTime);
          crowdGain.gain.exponentialRampToValueAtTime(target, c.currentTime + 0.15);
        }
      },
      isMuted: function () { return muted; },
      playFoot: playFoot,
      playMiss: playMiss,
      playGunshot: playGunshot,
      playFalseStart: playFalseStart,
      playWinFanfare: playWinFanfare,
      playLoseFanfare: playLoseFanfare,
      startBgm: startBgm,
      stopBgm: stopBgm,
      startCrowdAmbience: startCrowdAmbience,
      stopCrowdAmbience: stopCrowdAmbience,
      suspendContext: function () {
        var c = getCtx();
        if (c && c.state === "running") c.suspend();
      },
      resumeContext: function () {
        var c = getCtx();
        if (c && c.state === "suspended") c.resume();
      }
    };
  })();

  // ---------- DOM ----------
  var playerEl = document.getElementById("player");
  var botEl = document.getElementById("bot");
  var ghostEl = document.getElementById("ghost");
  var timerEl = document.getElementById("timer");
  var playerDistEl = document.getElementById("playerDist");
  var botDistEl = document.getElementById("botDist");

  var leftFootBtn = document.getElementById("leftFootBtn");
  var rightFootBtn = document.getElementById("rightFootBtn");

  var startOverlay = document.getElementById("startOverlay");
  var startBtn = document.getElementById("startBtn");
  var countdownOverlay = document.getElementById("countdownOverlay");
  var countdownNumberEl = document.getElementById("countdownNumber");
  var resultOverlay = document.getElementById("resultOverlay");
  var resultTitleEl = document.getElementById("resultTitle");
  var resultMessageEl = document.getElementById("resultMessage");
  var resultTimeEl = document.getElementById("resultTime");
  var restartBtn = document.getElementById("restartBtn");
  var mainMenuBtn = document.getElementById("mainMenuBtn");
  var shareImageBtn = document.getElementById("shareImageBtn");
  var soundToggleBtn = document.getElementById("soundToggleBtn");
  var langToggleBtn = document.getElementById("langToggleBtn");
  var falseStartOverlay = document.getElementById("falseStartOverlay");
  var falseStartRetryBtn = document.getElementById("falseStartRetryBtn");

  var difficultyButtons = document.querySelectorAll(".difficulty-btn");

  var comboDisplayEl = document.getElementById("comboDisplay");
  var comboPopupEl = document.getElementById("comboPopup");

  var medalBadgeEl = document.getElementById("medalBadge");
  var newRecordBannerEl = document.getElementById("newRecordBanner");
  var bestTimeRowEl = document.getElementById("bestTimeRow");
  var bestTimeValueEl = document.getElementById("bestTimeValue");
  var beatBestRowEl = document.getElementById("beatBestRow");
  var nextGoalRowEl = document.getElementById("nextGoalRow");
  var nextGoalValueEl = document.getElementById("nextGoalValue");
  var dailyChallengeBadgeEl = document.getElementById("dailyChallengeBadge");
  var dailyChallengeTextEl = document.getElementById("dailyChallengeText");

  var rivalBoxTextEl = document.getElementById("rivalBoxText");
  var rivalResultRowEl = document.getElementById("rivalResultRow");
  var ghostBeatBadgeEl = document.getElementById("ghostBeatBadge");

  var crowdContainer = document.getElementById("crowd");

  // ---------- i18n ----------
  var LANG_STORAGE_KEY = "asia100m_lang";
  var I18N = {
    ko: {
      docTitle: "아시아 스포츠 페스티벌 - 육상 100m",
      h1Main: "🏟️ 아시아 스포츠 페스티벌",
      h1Sub: "육상 100m",
      labelMe: "🔵 나",
      labelRival: "🔴 상대",
      startTitle: "🏃 육상 100m 달리기",
      startInstruction: "왼발/오른발 버튼(또는 키보드 A / D)을 <b>번갈아</b> 눌러서 전력 질주하세요!",
      startTip: "같은 발을 연속으로 누르면 조금만 전진해요. 리듬을 타면서 번갈아 눌러야 빨라져요.",
      startBtn: "레이스 시작",
      falseStartTitle: "🚫 부정출발!",
      falseStartMsg: "총소리가 나기 전에 발을 움직였어요.<br />신호를 기다렸다가 다시 도전하세요.",
      falseStartRetry: "다시 도전",
      finishTimeLabel: "완주 시간:",
      secondsUnit: "초",
      restartBtn: "다시 달리기",
      mainMenuBtn: "메인으로 돌아가기",
      footLeft: "왼발",
      footRight: "오른발",
      soundToggleLabel: "소리 켜기/끄기",
      langToggleLabel: "언어 전환",
      winTitle: "🏆 승리!",
      winMsg: "먼저 결승선을 통과했습니다!",
      loseTitle: "😢 아쉬워요",
      loseMsg: "상대 선수가 먼저 결승선을 통과했습니다.",
      difficultyEasy: "쉬움",
      difficultyNormal: "보통",
      difficultyHard: "어려움",
      newRecordBanner: "🏆 최고기록 경신!",
      personalBestLabel: "🥇 개인 최고기록:",
      beatBestTemplate: "최고기록까지 {time}초!",
      nextGoalLabel: "🎯 다음 목표:",
      goldMedal: "GOLD MEDAL",
      silverMedal: "SILVER MEDAL",
      bronzeMedal: "BRONZE MEDAL",
      dailyChallengeTitle: "🎯 오늘의 챌린지",
      dailyChallengeGoalTemplate: "목표 기록: {time}초 이내",
      dailyChallengeSuccess: "🎯 오늘의 챌린지 성공!",
      rivalBoxTitle: "🏁 오늘의 라이벌",
      rivalBoxTemplate: "{flag} {name} {time}초",
      rivalResultWinTemplate: "🆚 {name} 라이벌전: 승리!",
      rivalResultLoseTemplate: "🆚 {name} 라이벌전: 석패, 다음엔 이겨봐요",
      ghostBeatBadge: "👻 내 자신을 이겼습니다!",
      shareImageBtn: "📸 결과 이미지 저장",
      shareCardFinishLabel: "완주 시간",
      comboLabel: "COMBO",
      comboGood: "GOOD!",
      comboGreat: "GREAT!",
      comboAmazing: "AMAZING!",
      comboPerfect: "PERFECT!"
    },
    en: {
      docTitle: "Asia Sports Festival - 100m Sprint",
      h1Main: "🏟️ Asia Sports Festival",
      h1Sub: "100m Sprint",
      labelMe: "🔵 Me",
      labelRival: "🔴 Rival",
      startTitle: "🏃 100m Sprint",
      startInstruction: "Tap the Left/Right foot buttons (or press A / D) <b>alternately</b> to sprint full speed!",
      startTip: "Pressing the same foot twice in a row only moves you a little. Alternate in rhythm to go faster.",
      startBtn: "Start Race",
      falseStartTitle: "🚫 False Start!",
      falseStartMsg: "You moved before the gun went off.<br />Wait for the signal and try again.",
      falseStartRetry: "Retry",
      finishTimeLabel: "Finish Time:",
      secondsUnit: "s",
      restartBtn: "Run Again",
      mainMenuBtn: "Main Menu",
      footLeft: "Left",
      footRight: "Right",
      soundToggleLabel: "Toggle Sound",
      langToggleLabel: "Switch Language",
      winTitle: "🏆 Victory!",
      winMsg: "You crossed the finish line first!",
      loseTitle: "😢 So Close",
      loseMsg: "Your rival crossed the finish line first.",
      difficultyEasy: "Easy",
      difficultyNormal: "Normal",
      difficultyHard: "Hard",
      newRecordBanner: "🏆 NEW RECORD!",
      personalBestLabel: "🥇 PERSONAL BEST:",
      beatBestTemplate: "{time}s TO BEAT!",
      nextGoalLabel: "🎯 Next Goal:",
      goldMedal: "GOLD MEDAL",
      silverMedal: "SILVER MEDAL",
      bronzeMedal: "BRONZE MEDAL",
      dailyChallengeTitle: "🎯 Today's Challenge",
      dailyChallengeGoalTemplate: "Beat {time}s",
      dailyChallengeSuccess: "🎯 Today's Challenge Complete!",
      rivalBoxTitle: "🏁 Today's Rival",
      rivalBoxTemplate: "{flag} {name} {time}s",
      rivalResultWinTemplate: "🆚 vs {name}: Victory!",
      rivalResultLoseTemplate: "🆚 vs {name}: So Close — Beat Them Next Time!",
      ghostBeatBadge: "👻 You Beat Your Own Ghost!",
      shareImageBtn: "📸 Save Result Image",
      shareCardFinishLabel: "FINISH TIME",
      comboLabel: "COMBO",
      comboGood: "GOOD!",
      comboGreat: "GREAT!",
      comboAmazing: "AMAZING!",
      comboPerfect: "PERFECT!"
    }
  };

  function detectInitialLang() {
    try {
      var saved = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === "ko" || saved === "en") return saved;
    } catch (e) {
      /* ignore storage errors */
    }
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    return nav.indexOf("ko") === 0 ? "ko" : "en";
  }

  var currentLang = detectInitialLang();
  var lastWinner = null;
  var displayedElapsed = 0;

  function t(key) {
    var dict = I18N[currentLang] || I18N.en;
    return dict[key] != null ? dict[key] : key;
  }

  function applyLanguage(lang) {
    currentLang = lang === "ko" ? "ko" : "en";
    document.documentElement.lang = currentLang;
    document.title = t("docTitle");

    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      nodes[i].innerHTML = t(key);
    }

    soundToggleBtn.setAttribute("aria-label", t("soundToggleLabel"));
    langToggleBtn.setAttribute("aria-label", t("langToggleLabel"));
    langToggleBtn.textContent = currentLang === "ko" ? "EN" : "KO";

    timerEl.textContent = formatTime(displayedElapsed) + t("secondsUnit");

    if (lastWinner) {
      resultTitleEl.textContent = lastWinner === "player" ? t("winTitle") : t("loseTitle");
      resultMessageEl.textContent = lastWinner === "player" ? t("winMsg") : t("loseMsg");
      if (lastWinner === "player") {
        renderRecordInfo();
      }
    }

    updateComboDisplay();
    renderDailyChallengeBox();
    renderRivalBox();

    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, currentLang);
    } catch (e) {
      /* ignore storage errors */
    }
  }

  // ---------- State ----------
  var phase = "ready"; // ready | countdown | racing | finished | falseStart
  var playerMeters = 0;
  var botMeters = 0;
  var lastFoot = null;
  var botSpeed = DIFFICULTIES.normal.speed;

  var startTime = 0;
  var lastFrameTime = 0;
  var rafId = null;

  var countdownTimer = null;

  var comboCount = 0;
  var lastMedalTier = null;
  var lastIsNewRecord = false;
  var lastBestTime = null;
  var lastBeatDiff = null;
  var lastDailyChallengeSuccess = false;
  var lastRivalBeaten = false;
  var lastBeatGhost = false;

  var ghostRecordBuffer = [];
  var hadGhostThisRun = false;

  // ---------- Persisted settings (difficulty, personal best, ghost) ----------
  var DIFFICULTY_STORAGE_KEY = "asia100m_difficulty";
  var BEST_TIME_STORAGE_KEY = "asia100m_best_time";
  var GHOST_TRACE_STORAGE_KEY = "asia100m_ghost_trace";

  function loadDifficulty() {
    try {
      var v = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (v === "easy" || v === "normal" || v === "hard") return v;
    } catch (e) {
      /* ignore storage errors */
    }
    return "normal";
  }

  function saveDifficulty(v) {
    try {
      window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, v);
    } catch (e) {
      /* ignore storage errors */
    }
  }

  function loadBestTime() {
    try {
      var raw = window.localStorage.getItem(BEST_TIME_STORAGE_KEY);
      if (raw === null) return null;
      var val = parseFloat(raw);
      return isFinite(val) ? val : null;
    } catch (e) {
      return null;
    }
  }

  function saveBestTime(seconds) {
    try {
      window.localStorage.setItem(BEST_TIME_STORAGE_KEY, String(seconds));
    } catch (e) {
      /* ignore storage errors */
    }
  }

  function loadGhostTrace() {
    try {
      var raw = window.localStorage.getItem(GHOST_TRACE_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 1 ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveGhostTrace(trace) {
    try {
      window.localStorage.setItem(GHOST_TRACE_STORAGE_KEY, JSON.stringify(trace));
    } catch (e) {
      /* ignore storage errors */
    }
  }

  var ghostTrace = loadGhostTrace();

  var selectedDifficulty = loadDifficulty();

  function updateDifficultyButtons() {
    difficultyButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-difficulty") === selectedDifficulty);
    });
  }

  difficultyButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedDifficulty = btn.getAttribute("data-difficulty");
      saveDifficulty(selectedDifficulty);
      updateDifficultyButtons();
    });
  });

  // ---------- Crowd generation ----------
  function buildCrowd() {
    crowdContainer.innerHTML = "";
    var colors = ["#00f6ff", "#ff2ea6", "#fff400", "#39ff88", "#7a5cff", "#ff6a00"];
    var count = 90;
    for (var i = 0; i < count; i++) {
      var dot = document.createElement("div");
      dot.className = "crowd-dot";
      dot.style.left = (Math.random() * 100).toFixed(2) + "%";
      dot.style.top = (Math.random() * 75 + 5).toFixed(2) + "%";
      dot.style.background = colors[Math.floor(Math.random() * colors.length)];
      dot.style.animationDuration = (0.9 + Math.random() * 1.3).toFixed(2) + "s";
      dot.style.animationDelay = (Math.random() * 1.5 * -1).toFixed(2) + "s";
      crowdContainer.appendChild(dot);
    }
  }

  // ---------- Rendering ----------
  function setRunnerPosition(el, meters) {
    var fraction = Math.min(meters / RACE_DISTANCE, 1);
    el.style.left = (fraction * MAX_LEFT_PERCENT).toFixed(2) + "%";
  }

  function setRunnerPhase(el, phaseName) {
    el.classList.remove("phase-left", "phase-right");
    if (phaseName) el.classList.add("phase-" + phaseName);
  }

  function render() {
    setRunnerPosition(playerEl, playerMeters);
    setRunnerPosition(botEl, botMeters);
    playerDistEl.textContent = Math.min(playerMeters, RACE_DISTANCE).toFixed(0);
    botDistEl.textContent = Math.min(botMeters, RACE_DISTANCE).toFixed(0);
  }

  function formatTime(seconds) {
    return seconds.toFixed(2);
  }

  // ---------- Combo display ----------
  function updateComboDisplay() {
    if (comboCount > 0) {
      comboDisplayEl.textContent = "🔥 " + comboCount + " " + t("comboLabel");
      showOverlay(comboDisplayEl);
    } else {
      hideOverlay(comboDisplayEl);
    }
  }

  function showComboPopup(text) {
    comboPopupEl.textContent = text;
    comboPopupEl.classList.remove("show");
    void comboPopupEl.offsetWidth; // force reflow so the animation restarts
    comboPopupEl.classList.add("show");
  }

  function checkComboMilestone(count) {
    var key = COMBO_MILESTONES[count];
    if (key) showComboPopup(t(key));
  }

  // ---------- Medal & personal-best record ----------
  function getMedalTier(elapsed) {
    if (elapsed < MEDAL_THRESHOLDS.gold) return "gold";
    if (elapsed < MEDAL_THRESHOLDS.silver) return "silver";
    return "bronze";
  }

  function medalEmoji(tier) {
    if (tier === "gold") return "🥇";
    if (tier === "silver") return "🥈";
    return "🥉";
  }

  function medalKey(tier) {
    if (tier === "gold") return "goldMedal";
    if (tier === "silver") return "silverMedal";
    return "bronzeMedal";
  }

  // ---------- Daily challenge: deterministic target from today's date ----------
  function computeDailyChallengeTarget() {
    var now = new Date();
    var seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    var x = Math.sin(seed) * 10000;
    var frac = x - Math.floor(x);
    var target = DAILY_CHALLENGE_MIN + frac * (DAILY_CHALLENGE_MAX - DAILY_CHALLENGE_MIN);
    return Math.round(target * 100) / 100;
  }

  var dailyChallengeTarget = computeDailyChallengeTarget();

  function renderDailyChallengeBox() {
    dailyChallengeTextEl.textContent = t("dailyChallengeGoalTemplate").replace("{time}", formatTime(dailyChallengeTarget));
  }

  // ---------- Rival ----------
  function renderRivalBox() {
    rivalBoxTextEl.textContent = t("rivalBoxTemplate")
      .replace("{flag}", dailyRival.flag)
      .replace("{name}", dailyRival.name)
      .replace("{time}", formatTime(dailyRival.record));
  }

  // ---------- Ghost: replay of the run that set the current personal best ----------
  function getGhostMetersAtTime(elapsed) {
    if (!ghostTrace || ghostTrace.length < 2) return null;
    if (elapsed <= ghostTrace[0][0]) return ghostTrace[0][1];
    var last = ghostTrace[ghostTrace.length - 1];
    if (elapsed >= last[0]) return RACE_DISTANCE;
    for (var i = 1; i < ghostTrace.length; i++) {
      var prev = ghostTrace[i - 1];
      var next = ghostTrace[i];
      if (elapsed <= next[0]) {
        var span = next[0] - prev[0];
        var ratio = span > 0 ? (elapsed - prev[0]) / span : 0;
        return prev[1] + (next[1] - prev[1]) * ratio;
      }
    }
    return RACE_DISTANCE;
  }

  function renderRecordInfo() {
    if (lastMedalTier) {
      medalBadgeEl.textContent = medalEmoji(lastMedalTier) + " " + t(medalKey(lastMedalTier));
      medalBadgeEl.className = "medal-badge medal-" + lastMedalTier;
      showOverlay(medalBadgeEl);
    } else {
      hideOverlay(medalBadgeEl);
    }

    if (lastIsNewRecord) {
      showOverlay(newRecordBannerEl);
    } else {
      hideOverlay(newRecordBannerEl);
    }

    if (lastBestTime != null) {
      bestTimeValueEl.textContent = formatTime(lastBestTime);
      showOverlay(bestTimeRowEl);
    } else {
      hideOverlay(bestTimeRowEl);
    }

    if (!lastIsNewRecord && lastBeatDiff != null) {
      beatBestRowEl.textContent = t("beatBestTemplate").replace("{time}", formatTime(lastBeatDiff));
      showOverlay(beatBestRowEl);
    } else {
      hideOverlay(beatBestRowEl);
    }

    if (lastBestTime != null) {
      var nextGoal = Math.max(0, lastBestTime - NEXT_GOAL_MARGIN);
      nextGoalValueEl.textContent = formatTime(nextGoal);
      showOverlay(nextGoalRowEl);
    } else {
      hideOverlay(nextGoalRowEl);
    }

    if (lastWinner === "player" && lastDailyChallengeSuccess) {
      showOverlay(dailyChallengeBadgeEl);
    } else {
      hideOverlay(dailyChallengeBadgeEl);
    }

    if (lastWinner === "player") {
      var template = lastRivalBeaten ? t("rivalResultWinTemplate") : t("rivalResultLoseTemplate");
      rivalResultRowEl.textContent = template.replace("{name}", dailyRival.name);
      showOverlay(rivalResultRowEl);
    } else {
      hideOverlay(rivalResultRowEl);
    }

    if (lastWinner === "player" && lastBeatGhost) {
      showOverlay(ghostBeatBadgeEl);
    } else {
      hideOverlay(ghostBeatBadgeEl);
    }

    if (lastWinner === "player") {
      showOverlay(shareImageBtn);
    } else {
      hideOverlay(shareImageBtn);
    }
  }

  // ---------- Share card (Canvas-generated result image) ----------
  var SHARE_CARD_SIZE = 1080;
  var SHARE_CARD_URL = "https://asia-100m-game.vercel.app/";
  var KOREAN_SAFE_FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  var PIXEL_FONT = "'Press Start 2P', monospace";

  var MEDAL_COLORS = {
    gold: "#fff400",
    silver: "#d9d9f5",
    bronze: "#ff9c4a"
  };

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob);
      }, "image/png");
    });
  }

  async function generateShareCardBlob() {
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    } catch (e) {
      /* ignore font-loading errors, canvas will fall back to default fonts */
    }

    var size = SHARE_CARD_SIZE;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    var cx = size / 2;

    // Background
    var bgGrad = ctx.createLinearGradient(0, 0, 0, size);
    bgGrad.addColorStop(0, "#0a0018");
    bgGrad.addColorStop(1, "#1a0b30");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    var glow = ctx.createRadialGradient(cx, size * 0.55, 80, cx, size * 0.55, size * 0.7);
    glow.addColorStop(0, "rgba(255, 46, 166, 0.28)");
    glow.addColorStop(1, "rgba(255, 46, 166, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Outer neon frame
    ctx.strokeStyle = "#fff400";
    ctx.lineWidth = 10;
    ctx.strokeRect(24, 24, size - 48, size - 48);
    ctx.strokeStyle = "rgba(0, 246, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, size - 80, size - 80);

    ctx.textAlign = "center";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Title
    ctx.fillStyle = "#00f6ff";
    ctx.shadowColor = "#00f6ff";
    ctx.shadowBlur = 22;
    ctx.font = "bold 46px " + KOREAN_SAFE_FONT;
    ctx.fillText(t("h1Main"), cx, 150);
    ctx.font = "bold 40px " + KOREAN_SAFE_FONT;
    ctx.fillText(t("h1Sub"), cx, 205);

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 244, 0, 0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(140, 250);
    ctx.lineTo(size - 140, 250);
    ctx.stroke();

    // Medal
    if (lastMedalTier) {
      ctx.font = "110px sans-serif";
      ctx.shadowColor = MEDAL_COLORS[lastMedalTier];
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#fff";
      ctx.fillText(medalEmoji(lastMedalTier), cx, 420);

      ctx.font = "34px " + PIXEL_FONT;
      ctx.fillStyle = MEDAL_COLORS[lastMedalTier];
      ctx.shadowColor = MEDAL_COLORS[lastMedalTier];
      ctx.shadowBlur = 16;
      ctx.fillText(t(medalKey(lastMedalTier)), cx, 470);
    }

    // Finish time
    ctx.shadowBlur = 0;
    ctx.font = "30px " + KOREAN_SAFE_FONT;
    ctx.fillStyle = "#d8e0f5";
    ctx.fillText(t("shareCardFinishLabel"), cx, 560);

    var timeStr = resultTimeEl.textContent;
    var unitStr = t("secondsUnit");
    var timeFont = "bold 120px " + PIXEL_FONT;
    var unitFont = "bold 56px " + KOREAN_SAFE_FONT;

    ctx.font = timeFont;
    var timeWidth = ctx.measureText(timeStr).width;
    ctx.font = unitFont;
    var unitWidth = ctx.measureText(unitStr).width;
    var gap = 14;
    var startX = cx - (timeWidth + gap + unitWidth) / 2;

    ctx.textAlign = "left";
    ctx.fillStyle = "#fff400";
    ctx.shadowColor = "#fff400";
    ctx.shadowBlur = 20;
    ctx.font = timeFont;
    ctx.fillText(timeStr, startX, 680);
    ctx.font = unitFont;
    ctx.fillText(unitStr, startX + timeWidth + gap, 680);
    ctx.textAlign = "center";
    ctx.shadowBlur = 0;

    // New record banner
    var nextY = 760;
    if (lastIsNewRecord) {
      ctx.font = "34px " + KOREAN_SAFE_FONT;
      ctx.fillStyle = "#39ff88";
      ctx.shadowColor = "#39ff88";
      ctx.shadowBlur = 16;
      ctx.fillText(t("newRecordBanner"), cx, nextY);
      ctx.shadowBlur = 0;
      nextY += 60;
    }

    // Rival result
    if (dailyRival) {
      var rivalTemplate = lastRivalBeaten ? t("rivalResultWinTemplate") : t("rivalResultLoseTemplate");
      var rivalLine = rivalTemplate.replace("{name}", dailyRival.name);
      ctx.font = "30px " + KOREAN_SAFE_FONT;
      ctx.fillStyle = "#00f6ff";
      ctx.shadowColor = "#00f6ff";
      ctx.shadowBlur = 14;
      wrapCanvasText(ctx, rivalLine, cx, nextY, size - 200, 40);
      ctx.shadowBlur = 0;
    }

    // Footer URL
    ctx.font = "22px " + PIXEL_FONT;
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.fillText(SHARE_CARD_URL, cx, size - 60);

    return canvasToBlob(canvas);
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = text.split(" ");
    var line = "";
    var lines = [];
    for (var i = 0; i < words.length; i++) {
      var testLine = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    var startY = y - ((lines.length - 1) * lineHeight) / 2;
    for (var j = 0; j < lines.length; j++) {
      ctx.fillText(lines[j], x, startY + j * lineHeight);
    }
  }

  async function shareOrDownloadImage(blob) {
    if (!blob) return;
    var fileName = "asia100m_result.png";
    try {
      if (window.File && navigator.canShare) {
        var file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: t("docTitle") });
          return;
        }
      }
    } catch (e) {
      /* user cancelled the share sheet, or it's unsupported here — fall back to download */
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  // ---------- Game flow ----------
  function resetGame() {
    phase = "ready";
    playerMeters = 0;
    botMeters = 0;
    lastFoot = null;
    botSpeed = DIFFICULTIES[selectedDifficulty].speed + (Math.random() * 0.6 - 0.3);
    startTime = 0;
    lastFrameTime = 0;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    setRunnerPhase(playerEl, null);
    setRunnerPhase(botEl, null);
    setRunnerPhase(ghostEl, null);
    playerEl.classList.remove("finished");
    botEl.classList.remove("finished");
    ghostEl.classList.remove("finished");
    displayedElapsed = 0;
    timerEl.textContent = formatTime(displayedElapsed) + t("secondsUnit");
    hideOverlay(falseStartOverlay);
    AudioEngine.stopCrowdAmbience();
    comboCount = 0;
    updateComboDisplay();

    ghostRecordBuffer = [[0, 0]];
    hadGhostThisRun = !!ghostTrace;
    if (hadGhostThisRun) {
      showOverlay(ghostEl);
      setRunnerPosition(ghostEl, 0);
    } else {
      hideOverlay(ghostEl);
    }

    render();
  }

  function showOverlay(el) {
    el.classList.remove("hidden");
  }
  function hideOverlay(el) {
    el.classList.add("hidden");
  }

  function startCountdown() {
    AudioEngine.stopBgm();
    hideOverlay(startOverlay);
    hideOverlay(resultOverlay);
    hideOverlay(falseStartOverlay);
    resetGame();
    phase = "countdown";
    showOverlay(countdownOverlay);

    var steps = ["3", "2", "1"];
    var idx = 0;
    countdownNumberEl.textContent = steps[idx];

    countdownTimer = setInterval(function () {
      idx++;
      if (idx >= steps.length) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        countdownNumberEl.textContent = "GO!";
        AudioEngine.playGunshot();
        beginRace();
        setTimeout(function () {
          hideOverlay(countdownOverlay);
        }, 400);
        return;
      }
      countdownNumberEl.textContent = steps[idx];
    }, 700);
  }

  function triggerFalseStart() {
    phase = "falseStart";
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    hideOverlay(countdownOverlay);
    AudioEngine.playFalseStart();
    showOverlay(falseStartOverlay);
  }

  function beginRace() {
    phase = "racing";
    startTime = performance.now();
    lastFrameTime = startTime;
    AudioEngine.startCrowdAmbience();
    rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    if (phase !== "racing") return;

    var dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Bot auto-advance with a little natural variation
    var wobble = 1 + Math.sin(now / 350) * 0.06;
    botMeters += botSpeed * wobble * dt;
    if (botMeters > RACE_DISTANCE) botMeters = RACE_DISTANCE;

    // Bot leg animation driven by elapsed time
    var botPhase = Math.floor(now / 140) % 2 === 0 ? "left" : "right";
    setRunnerPhase(botEl, botPhase);

    var elapsed = (now - startTime) / 1000;
    displayedElapsed = elapsed;
    timerEl.textContent = formatTime(elapsed) + t("secondsUnit");

    ghostRecordBuffer.push([elapsed, playerMeters]);

    if (hadGhostThisRun) {
      var ghostMeters = getGhostMetersAtTime(elapsed);
      if (ghostMeters != null) {
        setRunnerPosition(ghostEl, ghostMeters);
        var ghostPhase = Math.floor(now / 140) % 2 === 0 ? "right" : "left";
        setRunnerPhase(ghostEl, ghostPhase);
      }
    }

    render();

    if (playerMeters >= RACE_DISTANCE) {
      finishRace("player", elapsed);
      return;
    }
    if (botMeters >= RACE_DISTANCE) {
      finishRace("bot", elapsed);
      return;
    }

    rafId = requestAnimationFrame(loop);
  }

  function finishRace(winner, elapsed) {
    phase = "finished";
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    AudioEngine.stopCrowdAmbience();
    playerMeters = Math.min(playerMeters, RACE_DISTANCE);
    botMeters = Math.min(botMeters, RACE_DISTANCE);
    render();

    lastWinner = winner;
    if (winner === "player") {
      playerEl.classList.add("finished");
      resultTitleEl.textContent = t("winTitle");
      resultMessageEl.textContent = t("winMsg");
      AudioEngine.playWinFanfare();

      lastMedalTier = getMedalTier(elapsed);
      lastDailyChallengeSuccess = elapsed <= dailyChallengeTarget;
      lastRivalBeaten = elapsed <= dailyRival.record;

      var prevBest = loadBestTime();
      lastIsNewRecord = prevBest === null || elapsed < prevBest;
      lastBeatGhost = hadGhostThisRun && lastIsNewRecord;
      if (lastIsNewRecord) {
        saveBestTime(elapsed);
        lastBestTime = elapsed;
        lastBeatDiff = null;
        ghostTrace = ghostRecordBuffer.slice();
        saveGhostTrace(ghostTrace);
      } else {
        lastBestTime = prevBest;
        lastBeatDiff = elapsed - prevBest;
      }
      renderRecordInfo();
    } else {
      botEl.classList.add("finished");
      resultTitleEl.textContent = t("loseTitle");
      resultMessageEl.textContent = t("loseMsg");
      AudioEngine.playLoseFanfare();

      lastMedalTier = null;
      lastIsNewRecord = false;
      lastBestTime = null;
      lastBeatDiff = null;
      lastDailyChallengeSuccess = false;
      lastRivalBeaten = false;
      lastBeatGhost = false;
      renderRecordInfo();
    }
    resultTimeEl.textContent = formatTime(elapsed);
    showOverlay(resultOverlay);
  }

  // ---------- Input handling ----------
  function pressFoot(foot) {
    if (phase === "countdown") {
      triggerFalseStart();
      return;
    }
    if (phase !== "racing") return;

    var isSameFoot = lastFoot === foot;
    var gain = isSameFoot ? SAME_STEP : ALT_STEP;
    lastFoot = foot;
    playerMeters = Math.min(playerMeters + gain, RACE_DISTANCE);

    if (isSameFoot) {
      comboCount = 0;
      AudioEngine.playMiss();
    } else {
      comboCount++;
      AudioEngine.playFoot(foot);
      checkComboMilestone(comboCount);
    }
    updateComboDisplay();

    setRunnerPhase(playerEl, foot);
    render();

    var btn = foot === "left" ? leftFootBtn : rightFootBtn;
    btn.classList.add("pressed");
    setTimeout(function () {
      btn.classList.remove("pressed");
    }, 90);
  }

  leftFootBtn.addEventListener("click", function () {
    pressFoot("left");
  });
  rightFootBtn.addEventListener("click", function () {
    pressFoot("right");
  });

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    var key = e.key.toLowerCase();
    if (key === "a") {
      pressFoot("left");
    } else if (key === "d") {
      pressFoot("right");
    }
  });

  startBtn.addEventListener("click", startCountdown);
  restartBtn.addEventListener("click", function () {
    hideOverlay(resultOverlay);
    startCountdown();
  });
  mainMenuBtn.addEventListener("click", function () {
    hideOverlay(resultOverlay);
    resetGame();
    showOverlay(startOverlay);
    AudioEngine.startBgm();
  });
  shareImageBtn.addEventListener("click", function () {
    shareImageBtn.disabled = true;
    generateShareCardBlob()
      .then(shareOrDownloadImage)
      .catch(function () {
        /* canvas/share failed silently; the game itself keeps working */
      })
      .then(function () {
        shareImageBtn.disabled = false;
      });
  });
  falseStartRetryBtn.addEventListener("click", function () {
    hideOverlay(falseStartOverlay);
    startCountdown();
  });

  langToggleBtn.addEventListener("click", function () {
    applyLanguage(currentLang === "ko" ? "en" : "ko");
  });

  // ---------- Sound toggle ----------
  var soundMuted = false;
  try {
    soundMuted = window.localStorage.getItem("asia100m_muted") === "1";
  } catch (e) {
    soundMuted = false;
  }

  function updateSoundBtn() {
    soundToggleBtn.textContent = soundMuted ? "🔇" : "🔊";
    soundToggleBtn.classList.toggle("muted", soundMuted);
  }

  AudioEngine.setMuted(soundMuted);
  updateSoundBtn();

  soundToggleBtn.addEventListener("click", function () {
    soundMuted = !soundMuted;
    AudioEngine.setMuted(soundMuted);
    updateSoundBtn();
    try {
      window.localStorage.setItem("asia100m_muted", soundMuted ? "1" : "0");
    } catch (e) {
      /* ignore storage errors (e.g. private browsing) */
    }
  });

  // ---------- Unlock audio on first user gesture (mobile browsers) ----------
  function unlockAudioOnce() {
    AudioEngine.unlock();
    document.removeEventListener("touchstart", unlockAudioOnce);
    document.removeEventListener("pointerdown", unlockAudioOnce);
    document.removeEventListener("keydown", unlockAudioOnce);
  }
  document.addEventListener("touchstart", unlockAudioOnce, { passive: true });
  document.addEventListener("pointerdown", unlockAudioOnce);
  document.addEventListener("keydown", unlockAudioOnce);

  // ---------- Silence audio when the tab/app is backgrounded or closed ----------
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      AudioEngine.stopBgm();
      AudioEngine.stopCrowdAmbience();
      AudioEngine.suspendContext();
    } else {
      AudioEngine.resumeContext();
      if (phase === "ready") {
        AudioEngine.startBgm();
      } else if (phase === "racing") {
        AudioEngine.startCrowdAmbience();
      }
    }
  });
  window.addEventListener("pagehide", function () {
    AudioEngine.stopBgm();
    AudioEngine.stopCrowdAmbience();
    AudioEngine.suspendContext();
  });

  // ---------- Init ----------
  applyLanguage(currentLang);
  updateDifficultyButtons();
  buildCrowd();
  resetGame();
  AudioEngine.startBgm();
})();
