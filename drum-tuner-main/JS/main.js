// ===================== МУЛЬТИЯЗЫЧНОСТЬ =====================
const select = document.querySelector('.change-lang');
const allLang = ['ru', 'en', 'ua'];

select.addEventListener('change', () => {
    let lang = select.value;
    window.location.hash = lang;   // меняем hash без reload
    changeLanguage();              // сразу обновляем текст
});

function changeLanguage() {
    let hash = window.location.hash.substr(1);
    
    if (!allLang.includes(hash)) {
        hash = 'en'; // язык по умолчанию
        window.location.hash = hash;
    }
    
    select.value = hash;

    for (let key in langArr) {
        let elem = document.querySelector('.lng-' + key);
        if (elem) {
            elem.innerHTML = langArr[key][hash];
        } 
    }

    // меняем картинку флага
    document.querySelector('.lannguage_flag-img').src = "img/" + hash + ".png";
}        
changeLanguage();


// ===================== ТЕМА (светлая/тёмная) =====================
let themeIcon = document.getElementById('themeIcon');

document.addEventListener('DOMContentLoaded', () => {
  const themeSwitch = document.querySelector('.theme__switch');
  const body = document.body;
  
  const savedTheme = localStorage.getItem('theme') || 'dark';
  themeSwitch.value = savedTheme;
  if (savedTheme === 'light') {
    body.classList.add('light-theme');
  }
  
  themeSwitch.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    localStorage.setItem('theme', newTheme);  
    
    if (newTheme === 'light') {
      body.classList.add('light-theme');
      themeIcon.className = "fa fa-sun";
    } else {
      body.classList.remove('light-theme');
      themeIcon.className = "fa fa-moon";
    }
  });
});


// ===================== ТЮНЕР =====================
let numLugs;
let audioContext;
let analyser;
let source;
let requestId;
let currentLug = 0;
let lugFrequencies = new Array(numLugs).fill('--');
let targetFreq = 100;
let fundamentalTargetFreq = 0; // целевая частота для режима "Fundamental" (из калькулятора)
let rmsThreshold = 0.02;
let isRunning = false;
let mediaStream;
let holdUntil = 0;              // до какого момента (Date.now()) держим текущее показание
const HOLD_DURATION_MS = 3500;  // сколько мс держим частоту после чёткого удара (3-4 сек)
let input_lug_1 = document.querySelector('.lug__input');
let input_lug_2 = document.getElementById('numLugs');
let fundamentalFrec = document.getElementById('fundamental');
let fundamentalValueSpan = document.getElementById('fundamentalValue');
let lugTargetBtn = document.getElementById('lugTarget');
let lugTargetValueSpan = document.getElementById('lugTargetValue');
let isStarted = false;



input_lug_1.addEventListener('input', () => {
  input_lug_2.value = input_lug_1.value;
});

input_lug_2.addEventListener('input', () => {
  input_lug_1.value = input_lug_2.value;
});

// конвертация частоты в ноту
function freqToNote(freq) {
    if (freq <= 0) return '--';
    const midi = 12 * Math.log2(freq / 440) + 69;
    const noteNum = Math.round(midi);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const note = noteNames[noteNum % 12];
    const octave = Math.floor(noteNum / 12) - 1;
    return `${note}${octave}`;
}

// обновление целевой частоты и чувствительности
document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetFreq');
    targetInput.addEventListener('input', () => {
        targetFreq = parseInt(targetInput.value) || 100;
        if (lugTargetValueSpan) lugTargetValueSpan.innerText = targetFreq;
    });
    if (lugTargetValueSpan) lugTargetValueSpan.innerText = targetFreq;

    const sensitivityInput = document.getElementById('rmsThreshold');
    const sensitivityValue = document.getElementById('sensitivityValue');

    sensitivityInput.addEventListener('input', () => {
        let min = parseFloat(sensitivityInput.min);
        let max = parseFloat(sensitivityInput.max);
        let val = parseFloat(sensitivityInput.value);

        let percent = ((val - min) / (max - min)) * 100;
        sensitivityValue.innerText = Math.round(percent) + "%";
    });
});

// Кнопки "Lug 1, Lug 2..." и дублирующая кнопка "Fundamental" больше не
// создаются в lugsContainer при старте тюнера — остаётся только общий
// счётчик частоты (#frequency) и статичный блок Fundamental из HTML,
// который теперь сам работает как переключатель режима.
function createLugButtons() {
  if (lugsContainer) lugsContainer.innerHTML = '';

  numLugs = parseInt((input_lug_2 && input_lug_2.value) || numLugs, 10) || numLugs;
  lugFrequencies = new Array(numLugs).fill('--');
  selectLug(0);
}

// Слушатели вешаем один раз при загрузке скрипта, а не при каждом старте,
// чтобы не плодить дублирующиеся обработчики клика.
if (lugTargetBtn) {
    lugTargetBtn.addEventListener('click', () => {
        if (!isRunning) return;
        selectLug(0);
        const lugValue = parseInt(lugTargetValueSpan && lugTargetValueSpan.innerText) || targetFreq;
        setTargetFrequency(lugValue);
    });
}

fundamentalFrec.addEventListener('click', () => {
    if (!isRunning) return;
    selectLug(-1);
    setTargetFrequency(fundamentalTargetFreq);
});

// Переносит частоту (клик по Lug/Fundamental) в поле настройки тюнера
// #targetFreq — именно по нему тюнер ориентируется на зелёный/красный цвет.
function setTargetFrequency(value) {
    if (!value) return;
    targetFreq = value;
    const targetInput = document.getElementById('targetFreq');
    if (targetInput) targetInput.value = value;
}

function selectLug(index) {
  currentLug = index;
  fundamentalFrec.classList.toggle('selected', index === -1);
  if (lugTargetBtn) lugTargetBtn.classList.toggle('selected', index !== -1);
}

async function startTuner() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.85;

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        
        createLugButtons();
        detectPitch();
        isRunning = true;
        updateButtonState();
    } catch (err) {
        alert('Ошибка: нужен доступ к микрофону. ' + err.message);
    }

    fundamentalFrec.classList.add('active');
    if (lugTargetBtn) lugTargetBtn.classList.add('active');

    isStarted = true;
}

function stopTuner() {
    if (requestId) cancelAnimationFrame(requestId);
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    if (audioContext) audioContext.close();
    document.getElementById('lugsContainer').innerHTML = '';
    lugFrequencies = new Array(numLugs).fill('--');
    currentLug = 0;
    document.getElementById('frequency').innerText = '-- Hz';
    document.getElementById('progressBar').style.width = '0%';
    holdUntil = 0;
    isRunning = false;
    updateButtonState();
    fundamentalFrec.classList.remove('selected');
    fundamentalFrec.classList.remove('active');
    if (lugTargetBtn) {
        lugTargetBtn.classList.remove('selected');
        lugTargetBtn.classList.remove('active');
    }
}

function updateButtonState() {
    const button = document.getElementById('startButton');
    if (isRunning) {
        button.innerHTML = '<i class="fas fa-stop"></i> Stop';
        changeLanguage();
    } else {
        button.innerHTML = '<i class="fas fa-play"></i> Start';
    }
    isStarted = false;
}

function toggleTuner() {
    if (isRunning) stopTuner();
    else startTuner();
}

function detectPitch() {
    // Если недавно был зафиксирован чёткий удар — держим показание,
    // не трогая индикатор, пока не истечёт HOLD_DURATION_MS.
    if (Date.now() < holdUntil) {
        requestId = requestAnimationFrame(detectPitch);
        return;
    }

    const bufferLength = analyser.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(buffer);

    let rms = 0;
    for (let i = 0; i < bufferLength; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / bufferLength);

    if (rms < rmsThreshold) {
        document.getElementById('frequency').innerText = '-- Hz (quiet)';
        document.getElementById('frequency').classList.remove('good', 'bad');
        document.getElementById('progressBar').style.width = '0%';
        requestId = requestAnimationFrame(detectPitch);
        return;
    }

    const correlations = new Float32Array(bufferLength / 2);
    for (let offset = 0; offset < correlations.length; offset++) {
        for (let i = 0; i < bufferLength - offset; i++) {
            correlations[offset] += buffer[i] * buffer[i + offset];
        }
    }

    const normCorrelations = correlations.map((val) => val / correlations[0]);
    let bestOffset = -1, bestCorrelation = -Infinity;
    const minOffset = 20;
    const maxOffset = Math.floor(audioContext.sampleRate / 50);

    for (let offset = minOffset; offset < Math.min(maxOffset, correlations.length); offset++) {
        if (normCorrelations[offset] > bestCorrelation) {
            bestCorrelation = normCorrelations[offset];
            bestOffset = offset;
        }
    }

    if (bestCorrelation < 0.5 || bestOffset < minOffset) {
        document.getElementById('frequency').innerText = '-- Hz (weak signal)';
        document.getElementById('frequency').classList.remove('good', 'bad');
        document.getElementById('progressBar').style.width = '0%';
        requestId = requestAnimationFrame(detectPitch);
        return;
    }

    if (bestOffset > minOffset && bestOffset < correlations.length - 1) {
        const y1 = normCorrelations[bestOffset - 1];
        const y2 = normCorrelations[bestOffset];
        const y3 = normCorrelations[bestOffset + 1];
        const shift = (y3 - y1) / (2 * (2 * y2 - y3 - y1)) || 0;
        bestOffset += shift;
    }

    const frequency = audioContext.sampleRate / bestOffset;
    if (!isNaN(frequency) && frequency > 0 && frequency < 1000) {
        const roundedFreq = Math.round(frequency);
        const note = freqToNote(roundedFreq);
        document.getElementById('frequency').innerText = `Frec ${roundedFreq} Hz (${note})`;
        if (currentLug === -1) {
  // 🔥 обновляем фундаментал
  const fundSpan = document.getElementById('fundLug');
  if (fundSpan) fundSpan.innerText = `${roundedFreq} Hz (${note})`;
} else {
  // обновляем выбранный лаг
  lugFrequencies[currentLug] = roundedFreq;
  const lugSpan = document.getElementById(`lug${currentLug}`);
  if (lugSpan) lugSpan.innerText = `${roundedFreq} Hz (${note})`;
}

        // Теперь и Lug, и Fundamental при клике переносят своё значение прямо
        // в поле #targetFreq, поэтому тюнер всегда сравнивает с targetFreq.
        const deviation = Math.abs(roundedFreq - targetFreq);
        if (deviation < 5) {
            document.getElementById('frequency').classList.add('good');
            document.getElementById('frequency').classList.remove('bad');
        } else {
            document.getElementById('frequency').classList.add('bad');
            document.getElementById('frequency').classList.remove('good');
        }
        const progress = Math.max(0, 100 - (deviation / (targetFreq * 0.1) * 100));
        document.getElementById('progressBar').style.width = `${progress}%`;

        // Чёткий удар распознан — замораживаем показание на HOLD_DURATION_MS,
        // чтобы значение не "прыгало" от затухающего звука/шума.
        holdUntil = Date.now() + HOLD_DURATION_MS;
    }

    requestId = requestAnimationFrame(detectPitch);
}
document.getElementById('startButton').addEventListener('click', toggleTuner);


// ===================== КАЛЬКУЛЯТОР =====================
const noteFrequencies = {
    'C1': 32.70, 'D1': 36.71, 'E1': 41.20, 'F1': 43.65, 'G1': 49.00, 'A1': 55.00, 'B1': 61.74,
    'C2': 65.41, 'D2': 73.42, 'E2': 82.41, 'F2': 87.31, 'G2': 98.00, 'A2': 110.00, 'B2': 123.47,
    'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'G5': 783.99, 'A5': 880.00, 'B5': 987.77,
    'C6': 1046.50
};
const sustainFactors = { 'none': 1.2, 'small': 1.4, 'medium': 1.6, 'large': 1.8, 'very': 1.9 };
const drumBaseFactors = { 'bass': 0.95, 'tom': 1.0, 'snare': 1.05 };

function calculateLugFrequency() {
    const drumType = document.getElementById('drumType').value;
    const note = document.getElementById('note').value;
    const sustain = document.getElementById('sustain').value;
    const diameter = parseFloat(document.getElementById('diameter').value) || 0;
    const numLugs = parseInt(document.getElementById('numLugs').value);

    const fundamental = noteFrequencies[note];
    let factor = sustainFactors[sustain] * drumBaseFactors[drumType];

    const diamCorrection = 14 / diameter; 
    factor *= diamCorrection;
    const lugFreq = Math.round(fundamental * factor);

    fundamentalTargetFreq = Math.round(fundamental); // используется тюнером как ориентир в режиме Fundamental

    const r = (diameter / 2 * 0.0254);
    const maxF = Math.round((2.4048 * 500) / (2 * Math.PI * r));
    const minF = Math.round((2.4048 * 100) / (2 * Math.PI * r));
            
    rangeInfo.innerText = `Recommended range of notes for ${diameter}" drum: ${minF}–${maxF} Hz`;

    document.getElementById('calcResult').innerHTML = `
        <div class="lng-better_frec">Batter lug frec: ${lugFreq} Hz</div>
        <div class="lng-fundamental-frec">Fundamental: ${Math.round(fundamental)} Hz</div>
    `;

    // Обновляем только число внутри кнопки Fundamental — так же, как и у Lug,
    // сама разметка (иконка/подпись) больше не перезаписывается.
    if (fundamentalValueSpan) fundamentalValueSpan.innerText = fundamentalTargetFreq;


    const tbody = document.querySelector('#lugsTable tbody');
    tbody.innerHTML = '';
    for (let i = 1; i <= numLugs; i++) {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = `Lug ${i}`;
        row.insertCell(1).textContent = `${lugFreq} Hz`;
    }

    document.getElementById('targetFreq').value = lugFreq;
    targetFreq = lugFreq;

    // #lugTargetValue берём напрямую из второго столбца таблицы #lugsTable
    // (частота лага), а не из отдельной переменной.
    const firstLugRow = tbody.querySelector('tr');
    if (firstLugRow && lugTargetValueSpan) {
        const freqFromTable = parseInt(firstLugRow.cells[1].textContent) || lugFreq;
        lugTargetValueSpan.innerText = freqFromTable;
        targetFreq = freqFromTable;
    }
}

// слушатели калькулятора
document.getElementById('drumType').addEventListener('change', calculateLugFrequency);
document.getElementById('note').addEventListener('change', calculateLugFrequency);
document.getElementById('sustain').addEventListener('change', calculateLugFrequency);
document.getElementById('diameter').addEventListener('input', calculateLugFrequency);
document.getElementById('numLugs').addEventListener('input', calculateLugFrequency);

// инициализация
calculateLugFrequency();