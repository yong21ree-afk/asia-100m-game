(function () {
  "use strict";

  // ---------- Config ----------
  var ROUND_SECONDS = 60;
  var PEAK_HEIGHT_PERCENT = 55; // how high the ball arcs, in % of .court height above the floor
  var ZONE_FRACTION = 0.3; // success zone = bottom 30% of the peak height
  var INITIAL_SERVE_DURATION = 1.9; // seconds for one "toward player" arc
  var MIN_SERVE_DURATION = 0.85;
  var SERVE_SPEEDUP = 0.05; // each success shortens the next serve by 5%
  var RETURN_DURATION = 0.75; // fixed, decorative "ball flies back to opponent" arc
  var MISS_PAUSE_MS = 600;
  var FROM_X = 84; // ball origin (%) near the opponent
  var TO_X = 16; // ball landing (%) near our player
  var COMBO_MILESTONES = { 5: "GREAT!", 10: "ON FIRE!" };

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

    function playKick() {
      tone(520, 0, 0.09, { type: "square", gain: 0.28, attack: 0.003, freqEnd: 760 });
      noiseBurst(0, 0.05, { gain: 0.18, filterFreq: 3200, decay: 3 });
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
  var courtEl = document.querySelector(".court");
  var ballEl = document.getElementById("ball");
  var usPlayerEl = document.getElementById("usPlayer");
  var zoneMarkerEl = document.getElementById("zoneMarker");
  var comboPopupEl = document.getElementById("comboPopup");

  var timerEl = document.getElementById("timer");
  var scoreValueEl = document.getElementById("scoreValue");
  var comboValueEl = document.getElementById("comboValue");

  var startOverlay = document.getElementById("startOverlay");
  var startBtn = document.getElementById("startBtn");
  var resultOverlay = document.getElementById("resultOverlay");
  var resultTitleEl = document.getElementById("resultTitle");
  var newRecordBannerEl = document.getElementById("newRecordBanner");
  var finalScoreEl = document.getElementById("finalScore");
  var finalMaxComboEl = document.getElementById("finalMaxCombo");
  var bestScoreValueEl = document.getElementById("bestScoreValue");
  var restartBtn = document.getElementById("restartBtn");
  var mainMenuBtn = document.getElementById("mainMenuBtn");

  var kickBtn = document.getElementById("kickBtn");
  var soundToggleBtn = document.getElementById("soundToggleBtn");
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

  var roundStartTime = 0;
  var rafId = null;

  var ballPhase = "toward-player"; // toward-player | toward-opponent | landed
  var ballStartTime = 0;
  var currentArcDuration = INITIAL_SERVE_DURATION;
  var serveDuration = INITIAL_SERVE_DURATION;
  var inZone = false;
  var kickedThisArc = false;
  var missTimeoutId = null;

  function showOverlay(el) { el.classList.remove("hidden"); }
  function hideOverlay(el) { el.classList.add("hidden"); }
  function lerp(a, b, t) { return a + (b - a) * t; }

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
    void comboPopupEl.offsetWidth; // restart animation if re-triggered
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
    var text = COMBO_MILESTONES[count];
    if (!text) return;
    showComboPopup(text);
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

  // ---------- Score / combo display ----------
  function updateStatsDisplay() {
    scoreValueEl.textContent = score;
    comboValueEl.textContent = combo;
  }

  // ---------- Ball flight ----------
  function startServe(newPhase) {
    ballPhase = newPhase;
    ballStartTime = performance.now();
    currentArcDuration = newPhase === "toward-player" ? serveDuration : RETURN_DURATION;
    kickedThisArc = false;
    ballEl.classList.remove("bounce");
  }

  function updateZoneMarker(height) {
    var pct = Math.max(0, Math.min(100, (height / PEAK_HEIGHT_PERCENT) * 100));
    zoneMarkerEl.style.bottom = pct + "%";
  }

  function updateBall(now) {
    if (ballPhase === "landed") return;

    var t = Math.min(1, (now - ballStartTime) / 1000 / currentArcDuration);
    var height = PEAK_HEIGHT_PERCENT * Math.sin(Math.PI * t);
    var fromX = ballPhase === "toward-player" ? FROM_X : TO_X;
    var toX = ballPhase === "toward-player" ? TO_X : FROM_X;
    var x = lerp(fromX, toX, t);

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
    }

    if (t >= 1) {
      if (ballPhase === "toward-player") {
        handleMiss();
      } else {
        startServe("toward-player");
      }
    }
  }

  function handleKick() {
    if (phase !== "playing") return;
    if (ballPhase !== "toward-player") return;
    if (kickedThisArc || !inZone) return;

    kickedThisArc = true;
    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    updateStatsDisplay();
    checkComboMilestone(combo);
    triggerKickAnimation();
    AudioEngine.playKick();

    serveDuration = Math.max(MIN_SERVE_DURATION, serveDuration * (1 - SERVE_SPEEDUP));
    startServe("toward-opponent");

    var btn = kickBtn;
    btn.classList.add("pressed");
    setTimeout(function () {
      btn.classList.remove("pressed");
    }, 90);
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
    updateStatsDisplay();
    timerEl.textContent = ROUND_SECONDS + "초";
    usPlayerEl.classList.remove("on-fire", "kicking");
    ballEl.classList.remove("in-zone", "bounce");
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

  function loop(now) {
    if (phase !== "playing") return;

    var elapsed = (now - roundStartTime) / 1000;
    var timeLeft = Math.max(0, ROUND_SECONDS - elapsed);
    timerEl.textContent = Math.ceil(timeLeft) + "초";

    if (timeLeft <= 0) {
      endRound();
      return;
    }

    updateBall(now);
    rafId = requestAnimationFrame(loop);
  }

  function endRound() {
    phase = "finished";
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (missTimeoutId) {
      clearTimeout(missTimeoutId);
      missTimeoutId = null;
    }

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

  // ---------- Input ----------
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

  kickBtn.addEventListener("click", handleKick);

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      handleKick();
    }
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
  resetRound();
})();
