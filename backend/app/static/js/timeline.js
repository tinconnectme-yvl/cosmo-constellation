import { sound } from './audio_fx.js';

export class TimelineController {
    constructor(elements, onContinuousTime) {
        this.slider = elements.slider;
        this.readout = elements.readout;
        this.playBtn = elements.playBtn;
        this.speedSelect = elements.speedSelect;
        this.ganttCanvas = elements.ganttCanvas;
        this.onContinuousTime = onContinuousTime;

        this.currentTime_s = 0; // Точное непрерывное время (сек)
        this.step_s = 120;
        this.horizon_s = 86400;
        this.isPlaying = false;
        this.speed = Number(this.speedSelect.value) || 120;
        this.animFrameId = null;
        this.lastFrameTimestamp = null;

        this.timelineSteps = null;
        this.selectedClient = 'C65';

        this.initEvents();
        this.initGantt();
        window.addEventListener('resize', () => this.initGantt());
    }

    initEvents() {
        this.slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.setTime(val, true);
        });

        this.playBtn.addEventListener('click', () => {
            sound.playClick();
            this.togglePlay();
        });

        this.speedSelect.addEventListener('change', (e) => {
            this.speed = parseFloat(e.target.value);
            sound.playClick();
        });

        const handleSeek = (e) => {
            const rect = this.ganttCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1.0, clickX / rect.width));
            const targetTime = ratio * this.horizon_s;
            this.setTime(targetTime, true);
        };

        let isDragging = false;
        this.ganttCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            sound.playClick();
            handleSeek(e);
        });
        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                handleSeek(e);
            }
        });
        window.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    initGantt() {
        if (!this.ganttCanvas || !this.ganttCanvas.parentElement) return;
        const rect = this.ganttCanvas.parentElement.getBoundingClientRect();
        if (rect.width < 10) return;
        const dpr = window.devicePixelRatio || 1;
        this.dpr = dpr;
        this.ganttCanvas.width = Math.round(rect.width * dpr);
        this.ganttCanvas.height = Math.round(28 * dpr);
        this.ganttCanvas.style.width = `${rect.width}px`;
        this.ganttCanvas.style.height = `28px`;
        this.renderGantt();
    }

    setSimulationData(simulationResult, selectedClient = 'C65') {
        this.selectedClient = selectedClient;
        const env = simulationResult.effective_scenario.environment;
        this.step_s = env.step_s;
        this.horizon_s = env.horizon_s;
        this.slider.max = this.horizon_s - 1;
        this.slider.step = 1; // плавный шаг

        this.timelineSteps = simulationResult.timeline_steps;
        this.renderGantt();
        this.setTime(this.currentTime_s || 0, false);
    }

    setSelectedClient(clientId) {
        this.selectedClient = clientId;
        this.renderGantt();
    }

    setTime(t_s, triggerCallback = true) {
        this.currentTime_s = t_s;
        this.slider.value = Math.round(t_s);
        this.readout.textContent = this.formatTime(t_s);
        this.renderGantt();
        if (triggerCallback && this.onContinuousTime) {
            this.onContinuousTime(this.currentTime_s);
        }
    }

    formatTime(seconds) {
        const secInt = Math.floor(seconds);
        const h = Math.floor(secInt / 3600);
        const m = Math.floor((secInt % 3600) / 60);
        const s = secInt % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.playBtn.innerHTML = '⏸ Пауза';
        this.playBtn.classList.add('btn-primary');

        this.lastFrameTimestamp = performance.now();
        const loop = (timestamp) => {
            if (!this.isPlaying) return;

            const dt_sec = Math.min(timestamp - this.lastFrameTimestamp, 100) / 1000;
            this.lastFrameTimestamp = timestamp;

            // Коэффициент ускорения: 1x = 30с/с, 5x = 120с/с, 15x = 400с/с, 60x = 1600с/с
            const speedMultiplier = this.speed;
            this.currentTime_s += dt_sec * speedMultiplier;

            if (this.currentTime_s >= this.horizon_s) {
                this.currentTime_s = 0; // зацикливание суток
            }

            // Быстрое обновление контролов
            this.slider.value = Math.round(this.currentTime_s);
            this.readout.textContent = this.formatTime(this.currentTime_s);
            if (!this.lastGanttDraw || timestamp-this.lastGanttDraw>100) {this.renderGantt();this.lastGanttDraw=timestamp;}

            if (this.onContinuousTime) {
                this.onContinuousTime(this.currentTime_s);
            }

            this.animFrameId = requestAnimationFrame(loop);
        };

        this.animFrameId = requestAnimationFrame(loop);
    }

    stop() {
        this.isPlaying = false;
        this.playBtn.innerHTML = '▶ Пуск';
        this.playBtn.classList.remove('btn-primary');
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    jumpToNextOutage() {
        if (!this.timelineSteps || this.timelineSteps.length === 0) return;
        const currentIdx = Math.floor(this.currentTime_s / this.step_s);
        
        // Поиск от текущего момента вперед
        for (let i = currentIdx + 1; i < this.timelineSteps.length; i++) {
            const stepData = this.timelineSteps[i];
            const clientInfo = stepData.clients[this.selectedClient];
            if (clientInfo && !clientInfo.available) {
                sound.playBeep();
                this.setTime(stepData.t_s, true);
                return;
            }
        }
        // Поиск с начала суток
        for (let i = 0; i <= currentIdx; i++) {
            const stepData = this.timelineSteps[i];
            const clientInfo = stepData.clients[this.selectedClient];
            if (clientInfo && !clientInfo.available) {
                sound.playBeep();
                this.setTime(stepData.t_s, true);
                return;
            }
        }
    }

    renderGantt() {
        if (!this.ganttCanvas) return;
        const ctx = this.ganttCanvas.getContext('2d');
        const w = this.ganttCanvas.width;
        const h = this.ganttCanvas.height;
        const dpr = this.dpr || window.devicePixelRatio || 1;

        ctx.clearRect(0, 0, w, h);

        // Фоновый трек
        ctx.fillStyle = '#06132b';
        ctx.fillRect(0, 0, w, h);

        if (!this.timelineSteps || this.timelineSteps.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = `${11 * dpr}px var(--font-mono)`;
            ctx.fillText('Загрузка суточного графика 24ч...', 20 * dpr, h / 2 + 4 * dpr);
            return;
        }

        const totalSteps = this.timelineSteps.length;
        const stepWidth = w / totalSteps;

        // Отрисовка цветных полос доступности связи
        for (let i = 0; i < totalSteps; i++) {
            const st = this.timelineSteps[i];
            const cInfo = st.clients[this.selectedClient];
            const isAvail = cInfo ? cInfo.available : false;

            ctx.fillStyle = isAvail ? '#10b981' : '#ef4444';
            ctx.fillRect(i * stepWidth, 0, stepWidth + 0.9, h);
        }

        // Тонкие часовые засечки (каждые 2 и 4 часа)
        ctx.font = `700 ${9 * dpr}px var(--font-mono)`;
        for (let hour = 2; hour <= 22; hour += 2) {
            const ratio = (hour * 3600) / this.horizon_s;
            const x = ratio * w;
            ctx.fillStyle = (hour % 4 === 0) ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(x, 0, 1 * dpr, h);
            if (hour % 4 === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillText(`${hour}:00`, x + 4 * dpr, 10 * dpr);
            }
        }

        // Текущий светящийся неоновый курсор времени
        const cursorRatio = Math.min(1.0, Math.max(0, this.currentTime_s / this.horizon_s));
        const cursorX = cursorRatio * w;

        ctx.save();
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 10 * dpr;
        ctx.fillStyle = '#00f2fe';
        ctx.fillRect(cursorX - 2.5 * dpr, 0, 5 * dpr, h);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cursorX - 1 * dpr, 0, 2 * dpr, h);

        // Верхний указатель-ромб
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX - 5 * dpr, 0);
        ctx.lineTo(cursorX, 7 * dpr);
        ctx.lineTo(cursorX + 5 * dpr, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}
