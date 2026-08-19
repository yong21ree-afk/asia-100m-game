(function () {
  "use strict";

  // ---------- Config ----------
  var RACE_DISTANCE = 100; // meters
  var ALT_STEP = 2.5;      // meters gained when alternating feet
  var SAME_STEP = 0.6;     // meters gained when pressing the same foot twice in a row
  var BOT_BASE_SPEED = 6.1; // meters per second (base)
  var MAX_LEFT_PERCENT = 90; // runner travels 0% -> 90% of track width

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

  var crowdContainer = document.getElementById("crowd");

  // ---------- State ----------
  var phase = "ready"; // ready | countdown | racing | finished
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
    resetGame();
    phase = "countdown";
    showOverlay(countdownOverlay);

    var steps = ["3", "2", "1", "GO!"];
    var idx = 0;
    countdownNumberEl.textContent = steps[idx];

    countdownTimer = setInterval(function () {
      idx++;
      if (idx >= steps.length) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        hideOverlay(countdownOverlay);
        beginRace();
        return;
      }
      countdownNumberEl.textContent = steps[idx];
    }, 700);
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
    } else {
      botEl.classList.add("finished");
      resultTitleEl.textContent = "😢 아쉬워요";
      resultMessageEl.textContent = "상대 선수가 먼저 결승선을 통과했습니다.";
    }
    resultTimeEl.textContent = formatTime(elapsed);
    showOverlay(resultOverlay);
  }

  // ---------- Input handling ----------
  function pressFoot(foot) {
    if (phase !== "racing") return;

    var gain = lastFoot === foot ? SAME_STEP : ALT_STEP;
    lastFoot = foot;
    playerMeters = Math.min(playerMeters + gain, RACE_DISTANCE);

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

  // ---------- Init ----------
  buildCrowd();
  resetGame();
})();
