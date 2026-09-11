(function () {
  "use strict";

  // ---------- Config ----------
  var ARROWS_PER_ROUND = 5;
  var FLIGHT_MS = 340;          // arrow travel time
  var SWAY_SPEED_A = 1.7;       // rad/s, horizontal wobble
  var SWAY_SPEED_B = 2.3;       // rad/s, vertical wobble
  var SWAY_AMPLITUDE = 0.085;   // fraction of the target radius each axis drifts
  var RESET_AFTER_SHOT_MS = 520;

  // ---------- i18n ----------
  var LANG_STORAGE_KEY = "archery_lang";
  var I18N = {
    ko: {
      docTitle: "아시아 스포츠 페스티벌 - 양궁",
      h1Main: "🏹 아시아 스포츠 페스티벌",
      h1Sub: "양궁",
      shotLabel: "발",
      scoreLabel: "점수",
      arrowsLabel: "화살",
      shootBtn: "발사",
      aimHint: "마우스나 손가락으로 조준하세요",
      startTitle: "🏹 양궁",
      startInstruction: "화면 위에서 마우스나 손가락을 움직여 과녁을 조준하고, <b>발사</b> 버튼(PC는 화면 클릭도 가능)으로 화살을 쏘세요!",
      startTip: "조준선이 미세하게 흔들려요. 한가운데(10점)에 가까울수록 높은 점수! 5발을 모두 쏘면 경기가 끝나고 결과가 나옵니다.",
      startBtn: "시작하기",
      resultTitle: "🎯 결과",
      newRecordBanner: "🏆 최고기록 경신!",
      finalScoreLabel: "TOTAL SCORE",
      breakdownLabel: "5발의 점수",
      bestScoreLabel: "개인 최고 점수:",
      restartBtn: "다시 쏘기",
      mainMenuBtn: "메인으로 돌아가기",
      soundToggleLabel: "소리 켜기/끄기",
      langToggleLabel: "언어 전환",
      missText: "MISS",
      bullText: "BULLSEYE!",
      ratingPerfect: "명궁! 완벽합니다",
      ratingGreat: "훌륭한 궁수",
      ratingGood: "좋은 실력",
      ratingOk: "연습이 필요해요",
      ratingBad: "다시 도전!"
    },
    en: {
      docTitle: "Asia Sports Festival - Archery",
      h1Main: "🏹 Asia Sports Festival",
      h1Sub: "Archery",
      shotLabel: "Shot",
      scoreLabel: "Score",
      arrowsLabel: "Left",
      shootBtn: "Shoot",
      aimHint: "Aim with your mouse or finger",
      startTitle: "🏹 Archery",
      startInstruction: "Move your mouse or finger over the range to aim, then hit <b>Shoot</b> (on PC you can also click the range) to loose an arrow!",
      startTip: "Your aim drifts a little. The closer to the bullseye (10), the higher the score! The match ends after all 5 arrows.",
      startBtn: "Start",
      resultTitle: "🎯 Results",
      newRecordBanner: "🏆 NEW RECORD!",
      finalScoreLabel: "TOTAL SCORE",
      breakdownLabel: "Each of your 5 shots",
      bestScoreLabel: "Personal Best:",
      restartBtn: "Play Again",
      mainMenuBtn: "Main Menu",
      soundToggleLabel: "Toggle Sound",
      langToggleLabel: "Switch Language",
      missText: "MISS",
      bullText: "BULLSEYE!",
      ratingPerfect: "Master archer! Flawless",
      ratingGreat: "Sharp shooting",
      ratingGood: "Nicely done",
      ratingOk: "Keep practising",
      ratingBad: "Try again!"
    }
  };

  function detectInitialLang() {
    try {
      var saved = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === "ko" || saved === "en") return saved;
    } catch (e) { /* ignore */ }
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    return nav.indexOf("ko") === 0 ? "ko" : "en";
  }

  var currentLang = detectInitialLang();
  var lastRatingKey = null;

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

    // rating text is set imperatively, so re-translate it on a language switch
    if (lastRatingKey) ratingTextEl.textContent = t(lastRatingKey);

    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, currentLang);
    } catch (e) { /* ignore */ }
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

    function playShoot() {
      // bow twang: quick pitched pluck + air
      tone(320, 0, 0.14, { type: "triangle", gain: 0.22, attack: 0.004, freqEnd: 140 });
      noiseBurst(0, 0.12, { gain: 0.12, filterFreq: 2200, decay: 2.5 });
    }

    function playThunk(score) {
      // arrow hitting the target: low click that rises with the score
      var f = 90 + score * 14;
      tone(f, 0, 0.1, { type: "square", gain: 0.28, attack: 0.002, freqEnd: f * 0.6 });
      noiseBurst(0, 0.05, { gain: 0.22, filterFreq: 1600, decay: 4 });
    }

    function playMiss() {
      tone(160, 0, 0.22, { type: "sawtooth", gain: 0.22, attack: 0.005, freqEnd: 55 });
    }

    function playBull() {
      [659.25, 987.77, 1318.51].forEach(function (fr, i) {
        tone(fr, i * 0.08, 0.2, { type: "square", gain: 0.24, attack: 0.004 });
      });
    }

    function playRoundEnd(isRecord) {
      var notes = isRecord ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 587.33, 659.25];
      notes.forEach(function (fr, i) {
        tone(fr, i * 0.11, 0.24, { type: "square", gain: 0.24, attack: 0.006 });
      });
    }

    return {
      unlock: unlock,
      setMuted: function (v) { muted = v; },
      isMuted: function () { return muted; },
      playShoot: playShoot,
      playThunk: playThunk,
      playMiss: playMiss,
      playBull: playBull,
      playRoundEnd: playRoundEnd,
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
  var rangeStage = document.getElementById("rangeStage");
  var targetEl = document.getElementById("target");
  var targetPulseEl = document.getElementById("targetPulse");
  var stuckArrowsEl = document.getElementById("stuckArrows");
  var reticleEl = document.getElementById("reticle");
  var aimLineEl = document.getElementById("aimLine");
  var scorePopupEl = document.getElementById("scorePopup");
  var archerEl = document.getElementById("archer");
  var arrowFlyingEl = document.getElementById("arrowFlying");
  var aimTipEl = document.getElementById("aimTip");

  var scoreValueEl = document.getElementById("scoreValue");
  var arrowsValueEl = document.getElementById("arrowsValue");
  var shotValueEl = document.getElementById("shotValue");

  var startOverlay = document.getElementById("startOverlay");
  var startBtn = document.getElementById("startBtn");
  var resultOverlay = document.getElementById("resultOverlay");
  var newRecordBannerEl = document.getElementById("newRecordBanner");
  var ratingTextEl = document.getElementById("ratingText");
  var finalScoreEl = document.getElementById("finalScore");
  var finalOfMaxEl = document.getElementById("finalOfMax");
  var shotBreakdownEl = document.getElementById("shotBreakdown");
  var bestScoreValueEl = document.getElementById("bestScoreValue");
  var restartBtn = document.getElementById("restartBtn");
  var mainMenuBtn = document.getElementById("mainMenuBtn");

  var shootBtn = document.getElementById("shootBtn");
  var soundToggleBtn = document.getElementById("soundToggleBtn");
  var langToggleBtn = document.getElementById("langToggleBtn");
  var crowdContainer = document.getElementById("crowd");

  // ---------- Storage ----------
  var BEST_SCORE_KEY = "archery_best_score";
  var MUTED_KEY = "archery_muted";

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
    } catch (e) { /* ignore */ }
  }

  // ---------- State ----------
  var phase = "ready";        // ready | aiming | firing | finished
  var score = 0;
  var arrowsLeft = ARROWS_PER_ROUND;
  var shotScores = [];        // score of each arrow shot this match

  var pointer = { x: 0, y: 0 };  // raw aim point (px, relative to rangeStage)
  var aimShown = { x: 0, y: 0 }; // pointer + sway, the crosshair position actually used
  var swayStart = 0;
  var rafId = null;

  function showOverlay(el) { el.classList.remove("hidden"); }
  function hideOverlay(el) { el.classList.add("hidden"); }
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

  // ---------- Geometry helpers ----------
  function getStageRect() { return rangeStage.getBoundingClientRect(); }

  function getTargetGeom() {
    var sr = getStageRect();
    var tr = targetEl.getBoundingClientRect();
    return {
      cx: tr.left - sr.left + tr.width / 2,
      cy: tr.top - sr.top + tr.height / 2,
      r: tr.width / 2
    };
  }

  function getArcherOrigin() {
    var sr = getStageRect();
    var ar = archerEl.getBoundingClientRect();
    return {
      x: ar.left - sr.left + ar.width * 0.1,
      y: ar.top - sr.top + ar.height * 0.35
    };
  }

  // ---------- Display updates ----------
  function updateStatsDisplay() {
    scoreValueEl.textContent = score;
    arrowsValueEl.textContent = arrowsLeft;
    var shotsTaken = ARROWS_PER_ROUND - arrowsLeft;
    var currentShot = Math.min(shotsTaken + 1, ARROWS_PER_ROUND);
    shotValueEl.textContent = currentShot + "/" + ARROWS_PER_ROUND;
  }

  function updateReticle() {
    reticleEl.style.left = aimShown.x + "px";
    reticleEl.style.top = aimShown.y + "px";

    var origin = getArcherOrigin();
    var dx = aimShown.x - origin.x;
    var dy = aimShown.y - origin.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    aimLineEl.style.left = origin.x + "px";
    aimLineEl.style.top = origin.y + "px";
    aimLineEl.style.height = dist + "px";
    aimLineEl.style.transform = "rotate(" + (angle - 90) + "deg)";
    aimLineEl.style.opacity = "0.7";
  }

  // ---------- Aim loop (sway) ----------
  function aimLoop(now) {
    if (phase !== "aiming") return;
    var geom = getTargetGeom();
    var elapsed = (now - swayStart) / 1000;
    var amp = geom.r * SWAY_AMPLITUDE;
    var offX = Math.sin(elapsed * SWAY_SPEED_A) * amp + Math.sin(elapsed * SWAY_SPEED_A * 2.7) * amp * 0.35;
    var offY = Math.cos(elapsed * SWAY_SPEED_B) * amp + Math.cos(elapsed * SWAY_SPEED_B * 1.9) * amp * 0.35;

    var sr = getStageRect();
    aimShown.x = clamp(pointer.x + offX, 6, sr.width - 6);
    aimShown.y = clamp(pointer.y + offY, 6, sr.height - 6);
    updateReticle();

    rafId = requestAnimationFrame(aimLoop);
  }

  // ---------- Scoring ----------
  function scoreForHit(hx, hy) {
    var geom = getTargetGeom();
    var d = Math.sqrt((hx - geom.cx) * (hx - geom.cx) + (hy - geom.cy) * (hy - geom.cy));
    if (d > geom.r) return 0;
    var ring = 11 - Math.ceil(d / (geom.r / 10));
    return clamp(ring, 1, 10);
  }

  // ---------- Shooting ----------
  function fireArrow() {
    if (phase !== "aiming" || arrowsLeft <= 0) return;
    phase = "firing";

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    aimLineEl.style.opacity = "0";

    var origin = getArcherOrigin();
    var targetX = aimShown.x;
    var targetY = aimShown.y;
    var totalDx = targetX - origin.x;
    var totalDy = targetY - origin.y;
    var straightDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
    var arcHeight = Math.min(70, straightDist * 0.14);

    var hitScore = scoreForHit(targetX, targetY);

    archerEl.classList.remove("shooting");
    void archerEl.offsetWidth;
    archerEl.classList.add("shooting");
    AudioEngine.playShoot();

    arrowFlyingEl.style.opacity = "1";

    var startTime = performance.now();
    var landed = false;

    function doLand() {
      if (landed) return;
      landed = true;
      landArrow(targetX, targetY, hitScore);
    }

    function flight(now) {
      if (landed) return;
      var tt = clamp((now - startTime) / FLIGHT_MS, 0, 1);
      var ease = 1 - Math.pow(1 - tt, 2); // easeOutQuad
      var x = origin.x + totalDx * ease;
      var y = origin.y + totalDy * ease - Math.sin(Math.PI * ease) * arcHeight;

      // face direction of travel
      var lookAhead = clamp(ease + 0.02, 0, 1);
      var lx = origin.x + totalDx * lookAhead;
      var ly = origin.y + totalDy * lookAhead - Math.sin(Math.PI * lookAhead) * arcHeight;
      var ang = Math.atan2(ly - y, lx - x) * 180 / Math.PI;

      arrowFlyingEl.style.left = x + "px";
      arrowFlyingEl.style.top = y + "px";
      arrowFlyingEl.style.transform = "translate(-100%, -50%) rotate(" + ang + "deg)";

      if (tt < 1) {
        requestAnimationFrame(flight);
      } else {
        doLand();
      }
    }
    requestAnimationFrame(flight);
    // Safety net: if rAF is throttled (e.g. background tab), still resolve the shot.
    setTimeout(doLand, FLIGHT_MS + 400);
  }

  function landArrow(hx, hy, hitScore) {
    arrowFlyingEl.style.opacity = "0";
    arrowsLeft--;
    score += hitScore;
    shotScores.push(hitScore);
    updateStatsDisplay();

    // stuck arrow marker
    var geom = getTargetGeom();
    if (hitScore > 0) {
      var mark = document.createElement("div");
      mark.className = "stuck-arrow";
      var ang = Math.atan2(hy - geom.cy, hx - geom.cx) * 180 / Math.PI;
      mark.style.left = hx + "px";
      mark.style.top = hy + "px";
      mark.style.transform = "translate(-100%, -50%) rotate(" + (ang + 20) + "deg)";
      stuckArrowsEl.appendChild(mark);

      targetPulseEl.classList.remove("hit");
      void targetPulseEl.offsetWidth;
      targetPulseEl.classList.add("hit");
    }

    // score popup at the impact point
    showScorePopup(hx, hy, hitScore);

    if (hitScore === 10) {
      AudioEngine.playBull();
    } else if (hitScore === 0) {
      AudioEngine.playMiss();
    } else {
      AudioEngine.playThunk(hitScore);
    }

    setTimeout(function () {
      if (arrowsLeft <= 0) {
        endRound();
      } else {
        phase = "aiming";
        swayStart = performance.now();
        rafId = requestAnimationFrame(aimLoop);
      }
    }, RESET_AFTER_SHOT_MS);
  }

  function showScorePopup(x, y, hitScore) {
    scorePopupEl.className = "score-popup";
    if (hitScore === 0) {
      scorePopupEl.textContent = t("missText");
      scorePopupEl.classList.add("miss");
    } else if (hitScore === 10) {
      scorePopupEl.textContent = t("bullText");
      scorePopupEl.classList.add("bull");
    } else {
      scorePopupEl.textContent = "+" + hitScore;
    }
    scorePopupEl.style.left = x + "px";
    scorePopupEl.style.top = y + "px";
    void scorePopupEl.offsetWidth;
    scorePopupEl.classList.add("show");
  }

  // ---------- Round flow ----------
  function resetRound() {
    score = 0;
    arrowsLeft = ARROWS_PER_ROUND;
    shotScores = [];
    updateStatsDisplay();
    stuckArrowsEl.innerHTML = "";
    scorePopupEl.className = "score-popup";
    arrowFlyingEl.style.opacity = "0";
    aimLineEl.style.opacity = "0";
    targetPulseEl.classList.remove("hit");

    var sr = getStageRect();
    pointer.x = sr.width / 2;
    pointer.y = sr.height * 0.4;
    aimShown.x = pointer.x;
    aimShown.y = pointer.y;
    updateReticle();
    aimLineEl.style.opacity = "0";
  }

  function startRound() {
    hideOverlay(startOverlay);
    hideOverlay(resultOverlay);
    resetRound();
    phase = "aiming";
    shootBtn.disabled = false;
    aimTipEl.style.opacity = "1";
    swayStart = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(aimLoop);
  }

  function renderShotBreakdown() {
    shotBreakdownEl.innerHTML = "";
    for (var i = 0; i < shotScores.length; i++) {
      var v = shotScores[i];
      var cell = document.createElement("div");
      cell.className = "shot-cell";
      if (v === 10) cell.classList.add("bull");
      else if (v === 0) cell.classList.add("miss");
      var no = document.createElement("span");
      no.className = "shot-cell-no";
      no.textContent = (i + 1);
      var val = document.createElement("span");
      val.className = "shot-cell-val";
      val.textContent = v;
      cell.appendChild(no);
      cell.appendChild(val);
      shotBreakdownEl.appendChild(cell);
    }
  }

  function ratingKeyFor(finalScore) {
    var max = ARROWS_PER_ROUND * 10;
    var pct = finalScore / max;
    if (pct >= 0.95) return "ratingPerfect";
    if (pct >= 0.8) return "ratingGreat";
    if (pct >= 0.6) return "ratingGood";
    if (pct >= 0.4) return "ratingOk";
    return "ratingBad";
  }

  function endRound() {
    phase = "finished";
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    shootBtn.disabled = true;

    var prevBest = loadBestScore();
    var isNewRecord = prevBest === null || score > prevBest;
    if (isNewRecord) saveBestScore(score);

    finalScoreEl.textContent = score;
    finalOfMaxEl.textContent = "/ " + (ARROWS_PER_ROUND * 10);
    renderShotBreakdown();
    bestScoreValueEl.textContent = isNewRecord ? score : prevBest;
    newRecordBannerEl.classList.toggle("hidden", !isNewRecord);
    lastRatingKey = ratingKeyFor(score);
    ratingTextEl.textContent = t(lastRatingKey);

    AudioEngine.playRoundEnd(isNewRecord);
    showOverlay(resultOverlay);
  }

  // ---------- Input: aiming ----------
  function setPointerFromEvent(e) {
    var sr = getStageRect();
    pointer.x = clamp(e.clientX - sr.left, 0, sr.width);
    pointer.y = clamp(e.clientY - sr.top, 0, sr.height);
    if (phase === "aiming") {
      aimTipEl.style.opacity = "0";
      // Keep the reticle tracking the pointer even if the sway loop is
      // throttled; aimLoop re-applies the wobble on its next frame.
      aimShown.x = pointer.x;
      aimShown.y = pointer.y;
      updateReticle();
    }
  }

  rangeStage.addEventListener("pointermove", function (e) {
    if (phase === "aiming") setPointerFromEvent(e);
  });

  rangeStage.addEventListener("pointerdown", function (e) {
    if (phase !== "aiming") return;
    setPointerFromEvent(e);
    // On mouse, a click on the range also fires (per spec). Touch only aims.
    if (e.pointerType === "mouse") {
      // let the sway loop apply this frame's offset, then fire next tick
      requestAnimationFrame(fireArrow);
    }
  });

  // ---------- Input: shoot button + keyboard ----------
  shootBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    shootBtn.classList.add("pressed");
    fireArrow();
  });
  shootBtn.addEventListener("pointerup", function () {
    shootBtn.classList.remove("pressed");
  });
  shootBtn.addEventListener("pointerleave", function () {
    shootBtn.classList.remove("pressed");
  });

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.code === "Space" || e.key === " " || e.key === "Enter") {
      if (phase === "aiming") {
        e.preventDefault();
        fireArrow();
      }
    }
  });

  // ---------- Overlay buttons ----------
  startBtn.addEventListener("click", startRound);
  restartBtn.addEventListener("click", startRound);
  mainMenuBtn.addEventListener("click", function () {
    phase = "ready";
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    hideOverlay(resultOverlay);
    showOverlay(startOverlay);
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
    } catch (e) { /* ignore */ }
  });

  // ---------- Unlock audio on first gesture (mobile browsers) ----------
  function unlockAudioOnce() {
    AudioEngine.unlock();
    document.removeEventListener("touchstart", unlockAudioOnce);
    document.removeEventListener("pointerdown", unlockAudioOnce);
    document.removeEventListener("keydown", unlockAudioOnce);
  }
  document.addEventListener("touchstart", unlockAudioOnce, { passive: true });
  document.addEventListener("pointerdown", unlockAudioOnce);
  document.addEventListener("keydown", unlockAudioOnce);

  // ---------- Pause audio when backgrounded ----------
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) AudioEngine.suspendContext();
    else AudioEngine.resumeContext();
  });
  window.addEventListener("pagehide", function () {
    AudioEngine.suspendContext();
  });

  // ---------- Keep aim sane on resize ----------
  window.addEventListener("resize", function () {
    var sr = getStageRect();
    pointer.x = clamp(pointer.x, 0, sr.width);
    pointer.y = clamp(pointer.y, 0, sr.height);
    if (phase !== "aiming") {
      aimShown.x = pointer.x;
      aimShown.y = pointer.y;
      updateReticle();
      aimLineEl.style.opacity = "0";
    }
  });

  // ---------- Init ----------
  buildCrowd();
  applyLanguage(currentLang);
  resetRound();
  aimLineEl.style.opacity = "0";
})();
