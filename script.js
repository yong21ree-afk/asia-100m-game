(function () {
  "use strict";

  // ---------- Config ----------
  var RACE_DISTANCE = 100; // meters
  var ALT_STEP = 2.5;      // meters gained when alternating feet
  var SAME_STEP = 0.6;     // meters gained when pressing the same foot twice in a row
  var BOT_BASE_SPEED = 6.1; // meters per second (base)
  var MAX_LEFT_PERCENT = 90; // runner travels 0% -> 90% of track width

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

    return {
      unlock: unlock,
      setMuted: function (v) { muted = v; },
      isMuted: function () { return muted; },
      playFoot: playFoot,
      playMiss: playMiss,
      playGunshot: playGunshot,
      playFalseStart: playFalseStart,
      playWinFanfare: playWinFanfare,
      playLoseFanfare: playLoseFanfare
    };
  })();

  // ---------- DOM ----------
  var playerEl = document.getElementById("player");
  var botEl = document.getElementById("bot");
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
  var soundToggleBtn = document.getElementById("soundToggleBtn");
  var falseStartOverlay = document.getElementById("falseStartOverlay");
  var falseStartRetryBtn = document.getElementById("falseStartRetryBtn");

  var crowdContainer = document.getElementById("crowd");

  // ---------- State ----------
  var phase = "ready"; // ready | countdown | racing | finished | falseStart
  var playerMeters = 0;
  var botMeters = 0;
  var lastFoot = null;
  var botSpeed = BOT_BASE_SPEED;

  var startTime = 0;
  var lastFrameTime = 0;
  var rafId = null;

  var countdownTimer = null;

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

  // ---------- Game flow ----------
  function resetGame() {
    phase = "ready";
    playerMeters = 0;
    botMeters = 0;
    lastFoot = null;
    botSpeed = BOT_BASE_SPEED + (Math.random() * 0.6 - 0.3);
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
    playerEl.classList.remove("finished");
    botEl.classList.remove("finished");
    timerEl.textContent = "0.00초";
    hideOverlay(falseStartOverlay);
    render();
  }

  function showOverlay(el) {
    el.classList.remove("hidden");
  }
  function hideOverlay(el) {
    el.classList.add("hidden");
  }

  function startCountdown() {
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
    timerEl.textContent = formatTime(elapsed) + "초";

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
    playerMeters = Math.min(playerMeters, RACE_DISTANCE);
    botMeters = Math.min(botMeters, RACE_DISTANCE);
    render();

    if (winner === "player") {
      playerEl.classList.add("finished");
      resultTitleEl.textContent = "🏆 승리!";
      resultMessageEl.textContent = "먼저 결승선을 통과했습니다!";
      AudioEngine.playWinFanfare();
    } else {
      botEl.classList.add("finished");
      resultTitleEl.textContent = "😢 아쉬워요";
      resultMessageEl.textContent = "상대 선수가 먼저 결승선을 통과했습니다.";
      AudioEngine.playLoseFanfare();
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
      AudioEngine.playMiss();
    } else {
      AudioEngine.playFoot(foot);
    }

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
  });
  falseStartRetryBtn.addEventListener("click", function () {
    hideOverlay(falseStartOverlay);
    startCountdown();
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

  // ---------- Init ----------
  buildCrowd();
  resetGame();
})();
