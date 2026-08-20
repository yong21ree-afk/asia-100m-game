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
  var langToggleBtn = document.getElementById("langToggleBtn");
  var falseStartOverlay = document.getElementById("falseStartOverlay");
  var falseStartRetryBtn = document.getElementById("falseStartRetryBtn");

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
      restartBtn: "다시 시작",
      mainMenuBtn: "메인으로 돌아가기",
      footLeft: "왼발",
      footRight: "오른발",
      soundToggleLabel: "소리 켜기/끄기",
      langToggleLabel: "언어 전환",
      winTitle: "🏆 승리!",
      winMsg: "먼저 결승선을 통과했습니다!",
      loseTitle: "😢 아쉬워요",
      loseMsg: "상대 선수가 먼저 결승선을 통과했습니다."
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
      restartBtn: "Restart",
      mainMenuBtn: "Main Menu",
      footLeft: "Left",
      footRight: "Right",
      soundToggleLabel: "Toggle Sound",
      langToggleLabel: "Switch Language",
      winTitle: "🏆 Victory!",
      winMsg: "You crossed the finish line first!",
      loseTitle: "😢 So Close",
      loseMsg: "Your rival crossed the finish line first."
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
    }

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
    displayedElapsed = 0;
    timerEl.textContent = formatTime(displayedElapsed) + t("secondsUnit");
    hideOverlay(falseStartOverlay);
    AudioEngine.stopCrowdAmbience();
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
    } else {
      botEl.classList.add("finished");
      resultTitleEl.textContent = t("loseTitle");
      resultMessageEl.textContent = t("loseMsg");
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
    AudioEngine.startBgm();
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
  buildCrowd();
  resetGame();
  AudioEngine.startBgm();
})();
