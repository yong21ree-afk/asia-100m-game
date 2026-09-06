(function () {
  "use strict";

  // ---------- Config ----------
  var ROUND_SECONDS = 60;
  var PEAK_HEIGHT_PERCENT = 55; // how high the ball arcs, in % of .court height above the floor
  var ZONE_FRACTION = 0.3; // success zone = bottom 30% of the peak height
  var INITIAL_SERVE_DURATION = 2.3; // seconds for one "toward player" arc
  var MIN_SERVE_DURATION = 1.1;
  var SERVE_SPEEDUP = 0.04; // each success shortens the next serve by 4%
  var RETURN_DURATION_BASE = 0.9; // "ball flies back to opponent" arc, before power scaling
  var MISS_PAUSE_MS = 600;
  var FROM_X = 84; // ball origin (%) near the opponent, per serve
  var TO_X_MIN = 8; // randomized ball landing (%) near our side, per serve
  var TO_X_MAX = 44;
  var COMBO_MILESTONES = { 5: "comboGreat", 10: "comboOnFire" };

  var US_MIN_X = 4;
  var US_MAX_X = 46;
  var MOVE_SPEED = 48; // % per second
  var PROXIMITY_PERCENT = 13; // how close our player must be to the ball (in %) to connect

  var MAX_CHARGE_MS_BASE = 900; // holding this long = fully charged power, at the starting (slowest) serve speed
  var MIN_CHARGE_CAP_MS = 320; // never require more effort than this to fully charge, even at top speed
  var OPP_SWAY_AMPLITUDE = 8; // % — decorative opponent movement
  var OPP_SWAY_SPEED = 0.9; // radians/sec

  // ---------- i18n ----------
  var LANG_STORAGE_KEY = "sepak_lang";
  var I18N = {
    ko: {
      docTitle: "아시아 스포츠 페스티벌 - 세팍타크로",
      h1Main: "🏐 아시아 스포츠 페스티벌",
      h1Sub: "세팍타크로",
      secondsUnit: "초",
      scoreLabel: "점수",
      comboLabel: "콤보",
      kickBtn: "차기",
      startTitle: "🏐 세팍타크로",
      startInstruction: "◀/▶ 버튼(또는 방향키)으로 움직여서 공 아래로 이동하고, 공이 <b>초록색으로 빛날 때</b> \"차기\" 버튼(또는 스페이스바)을 <b>누르고 있다가 떼면</b> 세기 조절해서 넘길 수 있어요!",
      startTip: "오래 누를수록 강하게 차서 점수가 더 올라가요. 타이밍을 놓치거나 공에서 멀리 있으면 콤보가 초기화돼요. 60초 동안 최대한 많은 점수와 콤보를 쌓아보세요.",
      startBtn: "시작하기",
      resultTitle: "⏱️ 타임 업!",
      newRecordBanner: "🏆 최고기록 경신!",
      finalScoreLabel: "이번 점수:",
      finalComboLabel: "이번 최고 콤보:",
      bestScoreLabel: "개인 최고 점수:",
      restartBtn: "다시 하기",
      mainMenuBtn: "메인으로 돌아가기",
      soundToggleLabel: "소리 켜기/끄기",
      langToggleLabel: "언어 전환",
      comboGreat: "GREAT!",
      comboOnFire: "ON FIRE!"
    },
    en: {
      docTitle: "Asia Sports Festival - Sepak Takraw",
      h1Main: "🏐 Asia Sports Festival",
      h1Sub: "Sepak Takraw",
      secondsUnit: "s",
      scoreLabel: "Score",
      comboLabel: "Combo",
      kickBtn: "Kick",
      startTitle: "🏐 Sepak Takraw",
      startInstruction: "Use ◀/▶ (or arrow keys) to move under the ball, then <b>hold and release</b> the \"Kick\" button (or Spacebar) while the ball <b>glows green</b> to control your power!",
      startTip: "Hold longer for a harder kick and more points. Miss the timing or stand too far away and your combo resets. Rack up as much score and combo as you can in 60 seconds.",
      startBtn: "Start",
      resultTitle: "⏱️ Time's Up!",
      newRecordBanner: "🏆 NEW RECORD!",
      finalScoreLabel: "This Round's Score:",
      finalComboLabel: "This Round's Best Combo:",
      bestScoreLabel: "Personal Best Score:",
      restartBtn: "Play Again",
      mainMenuBtn: "Main Menu",
      soundToggleLabel: "Toggle Sound",
      langToggleLabel: "Switch Language",
      comboGreat: "GREAT!",
      comboOnFire: "ON FIRE!"
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

    timerEl.innerHTML = Math.ceil(timeLeftDisplay) + t("secondsUnit");

    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, currentLang);
    } catch (e) {
      /* ignore storage errors */
    }
  }

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

    function playKick(power) {
      var freq = 460 + power * 260;
      tone(freq, 0, 0.09, { type: "square", gain: 0.28, attack: 0.003, freqEnd: freq + 220 });
      noiseBurst(0, 0.05, { gain: 0.18 + power * 0.1, filterFreq: 3200, decay: 3 });
    }

    function playFail() {
      tone(150, 0, 0.2, { type: "sawtooth", gain: 0.25, attack: 0.005, freqEnd: 55 });
    }

    function playComboGreat() {
      [659.25, 987.77].forEach(function (f, i) {
        tone(f, i * 0.09, 0.18, { type: "square", gain: 0.24, attack: 0.005 });
      });
    }

    function playComboFire() {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone(f, i * 0.08, 0.2, { type: "square", gain: 0.26, attack: 0.005 });
      });
    }

    return {
      unlock: unlock,
      setMuted: function (v) { muted = v; },
      isMuted: function () { return muted; },
      playKick: playKick,
      playFail: playFail,
      playComboGreat: playComboGreat,
      playComboFire: playComboFire,
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
  var ballEl = document.getElementById("ball");
  var usPlayerEl = document.getElementById("usPlayer");
  var opponentPlayerEl = document.getElementById("opponentPlayer");
  var zoneGaugeEl = document.getElementById("zoneGauge");
  var zoneMarkerEl = document.getElementById("zoneMarker");
  var landingShadowEl = document.getElementById("landingShadow");
  var comboPopupEl = document.getElementById("comboPopup");
  var powerFillEl = document.getElementById("powerFill");

  var timerEl = document.getElementById("timer");
  var scoreValueEl = document.getElementById("scoreValue");
  var comboValueEl = document.getElementById("comboValue");

  var startOverlay = document.getElementById("startOverlay");
  var startBtn = document.getElementById("startBtn");
  var resultOverlay = document.getElementById("resultOverlay");
  var newRecordBannerEl = document.getElementById("newRecordBanner");
  var finalScoreEl = document.getElementById("finalScore");
  var finalMaxComboEl = document.getElementById("finalMaxCombo");
  var bestScoreValueEl = document.getElementById("bestScoreValue");
  var restartBtn = document.getElementById("restartBtn");
  var mainMenuBtn = document.getElementById("mainMenuBtn");

  var kickBtn = document.getElementById("kickBtn");
  var moveLeftBtn = document.getElementById("moveLeftBtn");
  var moveRightBtn = document.getElementById("moveRightBtn");
  var soundToggleBtn = document.getElementById("soundToggleBtn");
  var langToggleBtn = document.getElementById("langToggleBtn");
  var crowdContainer = document.getElementById("crowd");

  // ---------- Storage ----------
  var BEST_SCORE_KEY = "sepak_best_score";
  var MUTED_KEY = "sepak_muted";

  function loadBestScore() {
    try {
      var raw = window.localStorage.getItem(BEST_SCORE_KEY);
      if (raw === null) return null;
      var val = parseInt(raw, 10);
      return isFinite(val) ? val : null;
    } catch (e) {
      return null;
    }
  }

  function saveBestScore(score) {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(score));
    } catch (e) {
      /* ignore storage errors */
    }
  }

  // ---------- State ----------
  var phase = "ready"; // ready | playing | finished
  var score = 0;
  var combo = 0;
  var maxCombo = 0;
  var timeLeftDisplay = ROUND_SECONDS;

  var roundStartTime = 0;
  var rafId = null;

  var ballPhase = "toward-player"; // toward-player | toward-opponent | landed
  var ballStartTime = 0;
  var currentArcDuration = INITIAL_SERVE_DURATION;
  var serveDuration = INITIAL_SERVE_DURATION;
  var currentToX = 20;
  var currentBallX = FROM_X;
  var inZone = false;
  var kickedThisArc = false;
  var missTimeoutId = null;

  var usX = 25;
  var oppBaseX = 84;
  var movingLeft = false;
  var movingRight = false;

  var charging = false;
  var chargeStartTime = 0;

  function showOverlay(el) { el.classList.remove("hidden"); }
  function hideOverlay(el) { el.classList.add("hidden"); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---------- Crowd ----------
  function buildCrowd() {
    crowdContainer.innerHTML = "";
    var colors = ["#00f6ff", "#ff2ea6", "#fff400", "#39ff88", "#7a5cff", "#ff6a00"];
    for (var i = 0; i < 60; i++) {
      var dot = document.createElement("div");
      dot.className = "crowd-dot";
      dot.style.left = (Math.random() * 100).toFixed(2) + "%";
      dot.style.top = (Math.random() * 70 + 5).toFixed(2) + "%";
      dot.style.background = colors[Math.floor(Math.random() * colors.length)];
      dot.style.animationDuration = (0.9 + Math.random() * 1.3).toFixed(2) + "s";
      dot.style.animationDelay = (Math.random() * 1.5 * -1).toFixed(2) + "s";
      crowdContainer.appendChild(dot);
    }
  }

  // ---------- Combo popup / fire effect ----------
  function showComboPopup(text) {
    comboPopupEl.textContent = text;
    comboPopupEl.classList.remove("show");
    void comboPopupEl.offsetWidth;
    comboPopupEl.classList.add("show");
  }

  function triggerFireEffect() {
    usPlayerEl.classList.remove("on-fire");
    void usPlayerEl.offsetWidth;
    usPlayerEl.classList.add("on-fire");
    setTimeout(function () {
      usPlayerEl.classList.remove("on-fire");
    }, 1200);
  }

  function checkComboMilestone(count) {
    var key = COMBO_MILESTONES[count];
    if (!key) return;
    showComboPopup(t(key));
    if (count === 5) {
      AudioEngine.playComboGreat();
    } else if (count === 10) {
      AudioEngine.playComboFire();
      triggerFireEffect();
    }
  }

  function triggerKickAnimation() {
    usPlayerEl.classList.remove("kicking");
    void usPlayerEl.offsetWidth;
    usPlayerEl.classList.add("kicking");
    setTimeout(function () {
      usPlayerEl.classList.remove("kicking");
    }, 350);
  }

  function updateStatsDisplay() {
    scoreValueEl.textContent = score;
    comboValueEl.textContent = combo;
  }

  // ---------- Movement ----------
  function updateMovement(dt) {
    if (movingLeft && !movingRight) {
      usX = clamp(usX - MOVE_SPEED * dt, US_MIN_X, US_MAX_X);
    } else if (movingRight && !movingLeft) {
      usX = clamp(usX + MOVE_SPEED * dt, US_MIN_X, US_MAX_X);
    }
    usPlayerEl.style.left = usX + "%";
    zoneGaugeEl.style.left = clamp(usX + 9, US_MIN_X, US_MAX_X + 9) + "%";
  }

  function updateOpponentSway(now) {
    var oppX = oppBaseX + Math.sin(now / 1000 * OPP_SWAY_SPEED) * OPP_SWAY_AMPLITUDE;
    opponentPlayerEl.style.left = oppX + "%";
  }

  // ---------- Ball flight ----------
  function startServe(newPhase) {
    ballPhase = newPhase;
    ballStartTime = performance.now();
    if (newPhase === "toward-player") {
      currentArcDuration = serveDuration;
      currentToX = TO_X_MIN + Math.random() * (TO_X_MAX - TO_X_MIN);
      landingShadowEl.style.left = currentToX + "%";
      landingShadowEl.style.opacity = "0.3";
    } else {
      currentArcDuration = RETURN_DURATION_BASE;
      landingShadowEl.style.opacity = "0";
    }
    kickedThisArc = false;
    ballEl.classList.remove("bounce");
  }

  function updateLandingShadow(height) {
    var fraction = clamp(1 - height / PEAK_HEIGHT_PERCENT, 0, 1);
    landingShadowEl.style.opacity = (0.3 + fraction * 0.7).toFixed(2);
    var scale = 0.4 + fraction * 0.9;
    landingShadowEl.style.transform = "translate(-50%, 50%) scale(" + scale.toFixed(2) + ")";
  }

  function updateZoneMarker(height) {
    var pct = clamp((height / PEAK_HEIGHT_PERCENT) * 100, 0, 100);
    zoneMarkerEl.style.bottom = pct + "%";
  }

  function updateBall(now) {
    if (ballPhase === "landed") return;

    var t = Math.min(1, (now - ballStartTime) / 1000 / currentArcDuration);
    var height = PEAK_HEIGHT_PERCENT * Math.sin(Math.PI * t);
    var fromX = ballPhase === "toward-player" ? FROM_X : currentToX;
    var toX = ballPhase === "toward-player" ? currentToX : FROM_X;
    var x = lerp(fromX, toX, t);
    currentBallX = x;

    ballEl.style.left = x + "%";
    ballEl.style.bottom = "calc(22% + " + height + "% - 6px)";

    var zoneNow = ballPhase === "toward-player" && t > 0.5 && height > 0.01 &&
      height <= PEAK_HEIGHT_PERCENT * ZONE_FRACTION;
    if (zoneNow !== inZone) {
      inZone = zoneNow;
      ballEl.classList.toggle("in-zone", inZone);
    }

    if (ballPhase === "toward-player") {
      updateZoneMarker(height);
      updateLandingShadow(height);
    }

    if (t >= 1) {
      if (ballPhase === "toward-player") {
        handleMiss();
      } else {
        startServe("toward-player");
      }
    }
  }

  // ---------- Charge / kick ----------
  // As the serve speeds up, the "in-zone" window (a fixed fraction of the arc's
  // time) gets proportionally shorter too — so the time needed to reach full
  // charge shrinks along with it, keeping full-power kicks reachable instead of
  // demanding the same long hold inside an ever-tinier window.
  function getMaxChargeMs() {
    var ratio = serveDuration / INITIAL_SERVE_DURATION;
    return Math.max(MIN_CHARGE_CAP_MS, MAX_CHARGE_MS_BASE * ratio);
  }

  function startCharge() {
    if (phase !== "playing") return;
    if (charging) return;
    charging = true;
    chargeStartTime = performance.now();
  }

  function releaseCharge() {
    if (!charging) return;
    charging = false;
    powerFillEl.style.width = "0%";

    if (phase !== "playing") return;
    if (ballPhase !== "toward-player" || kickedThisArc) return;

    var closeEnough = Math.abs(usX - currentBallX) <= PROXIMITY_PERCENT;
    if (!inZone || !closeEnough) return;

    var chargeMs = performance.now() - chargeStartTime;
    var power = clamp(chargeMs / getMaxChargeMs(), 0, 1);

    kickedThisArc = true;
    var pointsEarned = 1 + Math.round(power * 2); // 1 to 3 points
    score += pointsEarned;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    updateStatsDisplay();
    checkComboMilestone(combo);
    triggerKickAnimation();
    AudioEngine.playKick(power);

    serveDuration = Math.max(MIN_SERVE_DURATION, serveDuration * (1 - SERVE_SPEEDUP));
    ballStartTime = performance.now();
    ballPhase = "toward-opponent";
    currentArcDuration = RETURN_DURATION_BASE * (1 - power * 0.3);
    kickedThisArc = false;
    ballEl.classList.remove("bounce");

    var btn = kickBtn;
    btn.classList.add("pressed");
    setTimeout(function () {
      btn.classList.remove("pressed");
    }, 90);
  }

  function updatePowerMeter(now) {
    if (!charging) return;
    var ratio = clamp((now - chargeStartTime) / getMaxChargeMs(), 0, 1);
    powerFillEl.style.width = (ratio * 100) + "%";
  }

  function handleMiss() {
    ballPhase = "landed";
    combo = 0;
    updateStatsDisplay();
    AudioEngine.playFail();
    ballEl.classList.add("bounce");
    zoneMarkerEl.style.bottom = "0%";

    missTimeoutId = setTimeout(function () {
      missTimeoutId = null;
      if (phase === "playing") startServe("toward-player");
    }, MISS_PAUSE_MS);
  }

  // ---------- Round flow ----------
  function resetRound() {
    score = 0;
    combo = 0;
    maxCombo = 0;
    serveDuration = INITIAL_SERVE_DURATION;
    usX = 25;
    movingLeft = false;
    movingRight = false;
    charging = false;
    updateStatsDisplay();
    timeLeftDisplay = ROUND_SECONDS;
    timerEl.innerHTML = ROUND_SECONDS + t("secondsUnit");
    powerFillEl.style.width = "0%";
    usPlayerEl.classList.remove("on-fire", "kicking");
    usPlayerEl.style.left = usX + "%";
    zoneGaugeEl.style.left = (usX + 9) + "%";
    opponentPlayerEl.style.left = oppBaseX + "%";
    ballEl.classList.remove("in-zone", "bounce");
    landingShadowEl.style.opacity = "0";
    if (missTimeoutId) {
      clearTimeout(missTimeoutId);
      missTimeoutId = null;
    }
  }

  function startRound() {
    resetRound();
    phase = "playing";
    hideOverlay(startOverlay);
    hideOverlay(resultOverlay);
    roundStartTime = performance.now();
    startServe("toward-player");
    rafId = requestAnimationFrame(loop);
  }

  var lastFrameTime = 0;

  function loop(now) {
    if (phase !== "playing") return;

    var dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;

    var elapsed = (now - roundStartTime) / 1000;
    var timeLeft = Math.max(0, ROUND_SECONDS - elapsed);
    timeLeftDisplay = timeLeft;
    timerEl.innerHTML = Math.ceil(timeLeft) + t("secondsUnit");

    if (timeLeft <= 0) {
      endRound();
      return;
    }

    updateMovement(dt);
    updateOpponentSway(now);
    updateBall(now);
    updatePowerMeter(now);
    rafId = requestAnimationFrame(loop);
  }

  function endRound() {
    phase = "finished";
    lastFrameTime = 0;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (missTimeoutId) {
      clearTimeout(missTimeoutId);
      missTimeoutId = null;
    }
    charging = false;
    powerFillEl.style.width = "0%";

    var prevBest = loadBestScore();
    var isNewRecord = prevBest === null || score > prevBest;
    if (isNewRecord) {
      saveBestScore(score);
    }

    finalScoreEl.textContent = score;
    finalMaxComboEl.textContent = maxCombo;
    bestScoreValueEl.textContent = isNewRecord ? score : prevBest;
    newRecordBannerEl.classList.toggle("hidden", !isNewRecord);

    showOverlay(resultOverlay);
  }

  // ---------- Input: kick (mouse/touch hold + Space hold) ----------
  kickBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    startCharge();
  });
  kickBtn.addEventListener("pointerup", releaseCharge);
  kickBtn.addEventListener("pointerleave", releaseCharge);
  kickBtn.addEventListener("pointercancel", releaseCharge);

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      startCharge();
    }
  });
  document.addEventListener("keyup", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      releaseCharge();
    }
  });

  // ---------- Input: movement (buttons + arrow keys) ----------
  function bindHold(el, onDown, onUp) {
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      onDown();
    });
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  bindHold(moveLeftBtn, function () { movingLeft = true; }, function () { movingLeft = false; });
  bindHold(moveRightBtn, function () { movingRight = true; }, function () { movingRight = false; });

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); movingLeft = true; }
    else if (e.key === "ArrowRight") { e.preventDefault(); movingRight = true; }
  });
  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft") movingLeft = false;
    else if (e.key === "ArrowRight") movingRight = false;
  });
  window.addEventListener("blur", function () {
    movingLeft = false;
    movingRight = false;
    if (charging) releaseCharge();
  });

  // ---------- Overlay buttons ----------
  startBtn.addEventListener("click", startRound);
  restartBtn.addEventListener("click", startRound);
  mainMenuBtn.addEventListener("click", function () {
    phase = "ready";
    resetRound();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    hideOverlay(startOverlay);
    showOverlay(startOverlay);
    hideOverlay(resultOverlay);
  });

  langToggleBtn.addEventListener("click", function () {
    applyLanguage(currentLang === "ko" ? "en" : "ko");
  });

  // ---------- Sound toggle ----------
  var soundMuted = false;
  try {
    soundMuted = window.localStorage.getItem(MUTED_KEY) === "1";
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
      window.localStorage.setItem(MUTED_KEY, soundMuted ? "1" : "0");
    } catch (e) {
      /* ignore storage errors */
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

  // ---------- Pause audio when the tab/app is backgrounded ----------
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      AudioEngine.suspendContext();
    } else {
      AudioEngine.resumeContext();
    }
  });
  window.addEventListener("pagehide", function () {
    AudioEngine.suspendContext();
  });

  // ---------- Init ----------
  buildCrowd();
  applyLanguage(currentLang);
  resetRound();
})();
