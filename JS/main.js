// мультиязычность на тюнере

const select = document.querySelector('.change-lang');
const allLang = ['ru', 'en', 'ua'];

select.addEventListener('change', changeURLLanguage);

function changeURLLanguage(){
    let lang = select.value;
    location.href = window.location.pathname + '#' + lang;
    location.reload();   
}

function changeLanguage(){
    let hash = window.location.hash;
    hash = hash.substr(1);
    console.log(hash);
    if (!allLang.includes(hash)) {
        location.href = window.location.pathname + '#en';
        location.reload();
    }
    select.value = hash;
    for (let key in langArr){
        let elem = document.querySelector('.lng-'+ key);
        if (elem) {
            elem.innerHTML = langArr[key][hash];
        }
        
    }
}

changeLanguage();


let numLugs;
let audioContext;
let analyser;
let source;
let requestId;
let currentLug = 0;
let lugFrequencies = new Array(numLugs).fill('--');
let targetFreq = 100;
let rmsThreshold = 0.02;
let isRunning = false;
let mediaStream;

// Функция для конвертации частоты в ноту
function freqToNote(freq) {
    if (freq <= 0) return '--';
    const midi = 12 * Math.log2(freq / 440) + 69;
    const noteNum = Math.round(midi);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const note = noteNames[noteNum % 12];
    const octave = Math.floor(noteNum / 12) - 1;
    return `${note}${octave}`;
}

// Обновление целевой частоты и чувствительности
document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetFreq');
    targetInput.addEventListener('input', () => {
        targetFreq = parseInt(targetInput.value) || 100;
    });

    const sensitivityInput = document.getElementById('rmsThreshold');
    const sensitivityValue = document.getElementById('sensitivityValue');

    sensitivityInput.addEventListener('input', () => {
        let min = parseFloat(sensitivityInput.min);
        let max = parseFloat(sensitivityInput.max);
        let val = parseFloat(sensitivityInput.value);

        // процент прокрутки (0–100)
        let percent = ((val - min) / (max - min)) * 100;

        // если нужно наоборот (100 → 0):
        // percent = 100 - percent;

        sensitivityValue.innerText = Math.round(percent) + "%";
    });
});

function createLugButtons() {
    const container = document.getElementById('lugsContainer');
    container.innerHTML = '';
    numLugs = document.querySelector('.lug__input').value;
    for (let i = 0; i < numLugs; i++) {
        const div = document.createElement('div');
        div.className = 'lug';
        div.innerHTML = `<i class="fas fa-bolt"></i> Lug ${i+1}: <span id="lug${i}">-- Hz</span>`;
        div.onclick = () => selectLug(i);
        container.appendChild(div);
    }
    selectLug(0);
}

function selectLug(index) {
    document.querySelectorAll('.lug').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });
    currentLug = index;
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
}

function stopTuner() {
    if (requestId) {
        cancelAnimationFrame(requestId);
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
    document.getElementById('lugsContainer').innerHTML = '';
    lugFrequencies = new Array(numLugs).fill('--');
    currentLug = 0;
    document.getElementById('frequency').innerText = '-- Hz';
    document.getElementById('progressBar').style.width = '0%';
    isRunning = false;
    updateButtonState();
}

function updateButtonState() {
    const button = document.getElementById('startButton');
    if (isRunning) {
        button.innerHTML = '<i class="fas fa-stop"></i> Stop';
        changeLanguage();
    } else {
        button.innerHTML = '<i class="fas fa-play"></i> Start';
    }
}

function toggleTuner() {
    if (isRunning) {
        stopTuner();
    } else {
        startTuner();
    }
}

function detectPitch() {
    const bufferLength = analyser.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(buffer);

    let rms = 0;
    for (let i = 0; i < bufferLength; i++) {
        rms += buffer[i] * buffer[i];
    }
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

    let bestOffset = -1;
    let bestCorrelation = -Infinity;

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
        lugFrequencies[currentLug] = roundedFreq;
        document.getElementById(`lug${currentLug}`).innerText = `${roundedFreq} Hz (${note})`;

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
    }

    requestId = requestAnimationFrame(detectPitch);
}

document.getElementById('startButton').addEventListener('click', toggleTuner);

