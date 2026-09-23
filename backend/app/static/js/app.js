import { drawMetrics } from './charts.js';
import { MapViewer, computeCoverageRadiusDeg } from './map_canvas.js';
import { TimelineController } from './timeline.js';
import { toast } from './toast.js';
import { sound } from './audio_fx.js';

const TERMINAL_NAMES = {
    'C65': 'Терминал 65 (Урал-Север)',
    'C70': 'Терминал 70 (Диксон)',
    'C72': 'Терминал 72 (Тикси)'
};

class KosmoApp {
    constructor() {
        this.apiBase = '/api';
        this.scenarios = [];
        this.currentScenarioId = '01_full_constellation';
        this.currentScenario = null;
        this.simulationResult = null;
        this.selectedClient = 'C65';
        this.lastAvailableState = null;
        this.lastHumanStoryKey = '';
        this.currentPage = 'dashboard';
        window.kosmoApp = this;

        // 1. Инициализируем компоненты карты и таймлайна с защитой от сбоев
        try {
            this.map = new MapViewer('mapCanvas', 'mapTooltip');
        } catch (err) {
            console.error('Ошибка инициализации карты:', err);
        }

        try {
            this.timeline = new TimelineController({
                slider: document.getElementById('timeSlider'),
                readout: document.getElementById('timeReadout'),
                playBtn: document.getElementById('playBtn'),
                speedSelect: document.getElementById('speedSelect'),
                ganttCanvas: document.getElementById('ganttCanvas')
            }, (t_s) => this.onContinuousTimeStep(t_s));
        } catch (err) {
            console.error('Ошибка инициализации таймлайна:', err);
        }

        // 2. Привязываем все обработчики событий (навигация, клики, кнопки)
        this.initEventListeners();

        // 3. Загружаем сценарии с бэкенда
        this.loadScenariosList();

        // 4. Мгновенная отрисовка графиков бизнес-дашборда
        this.renderDashboardCharts();

        const checkAndDrawCharts = () => {
            const canvas = document.getElementById('canvasDailyAvailability');
            if (canvas && canvas.parentElement && canvas.parentElement.getBoundingClientRect().width > 20) {
                this.renderDashboardCharts();
            } else {
                requestAnimationFrame(checkAndDrawCharts);
            }
        };
        requestAnimationFrame(checkAndDrawCharts);

        const chartEl = document.getElementById('canvasDailyAvailability');
        if (chartEl && chartEl.parentElement && window.ResizeObserver) {
            new ResizeObserver(() => {
                if (this.currentPage === 'dashboard') {
                    this.renderDashboardCharts();
                }
            }).observe(chartEl.parentElement);
        }
        window.addEventListener('resize', () => {
            if (this.currentPage === 'dashboard') {
                this.renderDashboardCharts();
            }
        });
    }

    initEventListeners() {
        // 1. Навигация между двумя главными страницами
        const brandHome = document.getElementById('brandHomeLink');
        if (brandHome) {
            brandHome.addEventListener('click', () => {
                sound.playClick();
                this.switchPage('dashboard');
            });
        }

        const tabDash = document.getElementById('navTabDashboard');
        const tabSim = document.getElementById('navTabSimulator');
        const ctaBtn = document.getElementById('ctaGoToSimBtn');

        if (tabDash) {
            tabDash.addEventListener('click', () => {
                sound.playClick();
                this.switchPage('dashboard');
            });
        }

        if (tabSim) {
            tabSim.addEventListener('click', () => {
                sound.playClick();
                this.switchPage('simulator');
            });
        }

        if (ctaBtn) {
            ctaBtn.addEventListener('click', () => {
                sound.playClick();
                this.switchPage('simulator');
            });
        }

        // 2. Интерактивные экспресс-тесты надежности на главной странице
        ['0', '1', '2', '4'].forEach(n => {
            const btn = document.getElementById(`dashTest${n}Btn`);
            if (btn) {
                btn.addEventListener('click', () => {
                    sound.playClick();
                    ['0', '1', '2', '4'].forEach(k => {
                        const b = document.getElementById(`dashTest${k}Btn`);
                        if (b) b.classList.toggle('active', k === n);
                    });
                    this.handleDashTest(parseInt(n, 10));
                });
            }
        });

        // 3. Выбор терминала связи (карточки наверху симулятора)
        ['C65', 'C70', 'C72'].forEach(cid => {
            const card = document.getElementById(`shipCard-${cid}`);
            if (card) {
                card.addEventListener('click', () => {
                    sound.playClick();
                    this.selectTerminal(cid);
                });
            }
        });

        // 4. Интерактивные клики по объектам на карте
        if (this.map) {
            this.map.onSiteClick = (siteId) => {
                if (['C65', 'C70', 'C72'].includes(siteId)) {
                    sound.playClick();
                    this.selectTerminal(siteId);
                }
            };

            this.map.onSatelliteClick = (sat) => {
                if (sat.failed) {
                    this.restoreSingleSatellite(sat.id);
                } else {
                    this.disableSatellite(sat.id);
                }
            };
        }

        // 5. Быстрые действия над картой (ЧЕТКО РАЗДЕЛЕНЫ: ТОЛЬКО ломать или ТОЛЬКО чинить)
        const qBreakBtn = document.getElementById('quickBreakSatBtn');
        if (qBreakBtn) qBreakBtn.addEventListener('click', () => this.breakActiveRouteSatellite());

        const qFixBtn = document.getElementById('quickFixAllBtn');
        if (qFixBtn) qFixBtn.addEventListener('click', () => this.fixAllSatellites());

        const st3Btn = document.getElementById('stageBtn3');
        const st1Btn = document.getElementById('stageBtn1');

        if (st3Btn) {
            st3Btn.addEventListener('click', () => {
                sound.playClick();
                this.setLaunchStage(3);
                st3Btn.classList.add('btn-primary');
                if (st1Btn) st1Btn.classList.remove('btn-primary');
            });
        }

        if (st1Btn) {
            st1Btn.addEventListener('click', () => {
                sound.playClick();
                this.setLaunchStage(1);
                st1Btn.classList.add('btn-primary');
                if (st3Btn) st3Btn.classList.remove('btn-primary');
            });
        }

        // 6. Переключатель проекции карты: Полярный радар / 3D Глобус / Плоская карта
        const btnPolar = document.getElementById('viewPolarBtn');
        const btnGlobe = document.getElementById('viewGlobeBtn');
        const btnFlat = document.getElementById('viewFlatBtn');
        const btnResetGlobe = document.getElementById('resetGlobeBtn');

        const setProjection = (mode, activeBtn) => {
            sound.playClick();
            this.map.setViewMode(mode);
            [btnPolar, btnGlobe, btnFlat].forEach(b => {
                if (b) b.classList.toggle('active', b === activeBtn);
            });
            if (btnResetGlobe) {
                btnResetGlobe.style.display = 'inline-flex';
            }
        };

        if (btnPolar) {
            btnPolar.addEventListener('click', () => {
                setProjection('polar', btnPolar);
                toast.info('Проекция', 'Полярный радар Арктики: вид сверху на Северный полюс без растяжения! Колесико — зум, мышь — перемещение.');
            });
        }

        if (btnGlobe) {
            btnGlobe.addEventListener('click', () => {
                setProjection('globe', btnGlobe);
                toast.info('3D Глобус', 'Тяните мышь в любую сторону для свободного вращения, колесико для зума!');
            });
        }

        if (btnFlat) {
            btnFlat.addEventListener('click', () => {
                setProjection('flat', btnFlat);
                toast.info('Проекция', 'Плоская 2D карта мира: тяните мышь для перемещения, колесико — зум!');
            });
        }

        if (btnResetGlobe) {
            btnResetGlobe.addEventListener('click', () => {
                sound.playClick();
                this.map.resetView();
                toast.info('Сброс вида', 'Масштаб и положение карты возвращены по умолчанию');
            });
        }

        // 7. Настройки орбит и JSON
        this.setupModal('modalSettings', 'openSettingsBtn', 'closeSettingsBtn');

        // 8. Звук
        const soundBtn = document.getElementById('soundToggleBtn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                const enabled = sound.toggle();
                soundBtn.textContent = enabled ? 'Звук: вкл' : 'Звук: выкл';
                toast.info('Звуковые эффекты', enabled ? 'Звук включен' : 'Звук отключен');
            });
        }

        // 7. Таймлайн
        const nextOutageBtn = document.getElementById('nextOutageBtn');
        if (nextOutageBtn) {
            nextOutageBtn.addEventListener('click', () => {
                this.timeline.jumpToNextOutage();
            });
        }

        const resetTimeBtn = document.getElementById('resetTimeBtn');
        if (resetTimeBtn) {
            resetTimeBtn.addEventListener('click', () => {
                sound.playClick();
                this.timeline.setTime(0, true);
            });
        }

        // 8. Инженерные действия в модалках
        const scenSelect = document.getElementById('scenarioSelect');
        if (scenSelect) {
            scenSelect.addEventListener('change', (e) => {
                sound.playClick();
                this.loadScenarioById(e.target.value);
            });
        }

        const stratSelect = document.getElementById('strategySelect');
        if (stratSelect) {
            stratSelect.addEventListener('change', () => {
                sound.playClick();
                this.runSimulation();
            });
        }

        const lStageSelect = document.getElementById('launchStageSelect');
        if (lStageSelect) {
            lStageSelect.addEventListener('change', (e) => {
                sound.playClick();
                this.setLaunchStage(parseInt(e.target.value, 10));
            });
        }

        const applyPlanesBtn = document.getElementById('applyPlanesBtn');
        if (applyPlanesBtn) {
            applyPlanesBtn.addEventListener('click', () => {
                sound.playClick();
                this.applyPlanesConfig();
            });
        }

        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportResult();
            });
        }

        const uploadInput = document.getElementById('scenarioFileInput');
        if (uploadInput) {
            uploadInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.uploadScenarioFile(e.target.files[0]);
                }
            });
        }

        const runCompBtn = document.getElementById('runCompareBtn');
        if (runCompBtn) {
            runCompBtn.addEventListener('click', () => {
                sound.playClick();
                this.runCompareScenarios();
            });
        }

        // 9. Живые слайдеры параметров орбит (60 FPS отклик на карте + фоновый пересчет сети)
        const liveAlt = document.getElementById('liveAltSlider');
        const liveInc = document.getElementById('liveIncSlider');
        const livePhase = document.getElementById('livePhaseSlider');
        const liveRaan = document.getElementById('liveRaanSlider');

        const liveAltVal = document.getElementById('liveAltVal');
        const liveIncVal = document.getElementById('liveIncVal');
        const livePhaseVal = document.getElementById('livePhaseVal');
        const liveRaanVal = document.getElementById('liveRaanVal');
        const liveAltSub = document.getElementById('liveAltSub');

        if (liveAlt) {
            liveAlt.addEventListener('input', (e) => {
                const alt = parseFloat(e.target.value);
                if (liveAltVal) liveAltVal.textContent = `${alt} км`;
                if (this.currentScenario && this.currentScenario.environment) {
                    this.currentScenario.environment.altitude_km = alt;
                    const radDeg = computeCoverageRadiusDeg(alt, 10);
                    const radKm = Math.round(radDeg * 111.12);
                    const r = 6371 + alt;
                    const periodMin = (2 * Math.PI * Math.sqrt(Math.pow(r, 3) / 398600.4355) / 60).toFixed(1);
                    if (liveAltSub) {
                        liveAltSub.textContent = `Радиус видимости: ~${radKm} км • Виток: ${periodMin} мин`;
                    }
                    this.onContinuousTimeStep(this.timeline ? this.timeline.currentTime_s : 0);
                    this.debouncedRunSimulation(400);
                }
            });
        }

        if (liveInc) {
            liveInc.addEventListener('input', (e) => {
                const inc = parseFloat(e.target.value);
                if (liveIncVal) liveIncVal.textContent = `${inc.toFixed(1)}°`;
                if (this.currentScenario && this.currentScenario.environment) {
                    this.currentScenario.environment.inclination_deg = inc;
                    this.onContinuousTimeStep(this.timeline ? this.timeline.currentTime_s : 0);
                    this.debouncedRunSimulation(400);
                }
            });
        }

        if (livePhase) {
            livePhase.addEventListener('input', (e) => {
                const phase = parseFloat(e.target.value);
                if (livePhaseVal) livePhaseVal.textContent = `${phase}°`;
                if (this.currentScenario && this.currentScenario.design && this.currentScenario.design.planes) {
                    const planes = this.currentScenario.design.planes;
                    planes.forEach((p, idx) => {
                        p.phase_deg = (idx * phase) % 360;
                    });
                    this.onContinuousTimeStep(this.timeline ? this.timeline.currentTime_s : 0);
                    this.debouncedRunSimulation(400);
                }
            });
        }

        if (liveRaan) {
            liveRaan.addEventListener('input', (e) => {
                const raan = parseFloat(e.target.value);
                if (liveRaanVal) liveRaanVal.textContent = `${raan}°`;
                if (this.currentScenario && this.currentScenario.design && this.currentScenario.design.planes) {
                    const planes = this.currentScenario.design.planes;
                    planes.forEach((p, idx) => {
                        p.raan_deg = (idx * raan) % 360;
                    });
                    this.onContinuousTimeStep(this.timeline ? this.timeline.currentTime_s : 0);
                    this.debouncedRunSimulation(400);
                }
            });
        }
    }

    setupModal(modalId, openBtnId, closeBtnId) {
        const modal = document.getElementById(modalId);
        const openBtn = document.getElementById(openBtnId);
        const closeBtn = document.getElementById(closeBtnId);

        if (openBtn && modal) {
            openBtn.addEventListener('click', () => {
                sound.playClick();
                modal.classList.add('open');
            });
        }

        if (closeBtn && modal) {
            closeBtn.addEventListener('click', () => {
                sound.playClick();
                modal.classList.remove('open');
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('open');
                }
            });
        }
    }

    debouncedRunSimulation(delay = 400) {
        if (this._simDebounceTimer) {
            clearTimeout(this._simDebounceTimer);
        }
        this._simDebounceTimer = setTimeout(() => {
            this.runSimulation();
        }, delay);
    }

    switchPage(pageName) {
        this.currentPage = pageName;
        const pageDash = document.getElementById('pageDashboard');
        const pageSim = document.getElementById('pageSimulator');
        const tabDash = document.getElementById('navTabDashboard');
        const tabSim = document.getElementById('navTabSimulator');

        if (pageName === 'dashboard') {
            this.timeline?.stop();
            if (pageDash) pageDash.classList.add('active');
            if (pageSim) pageSim.classList.remove('active');
            if (tabDash) tabDash.classList.add('active');
            if (tabSim) tabSim.classList.remove('active');
            this.renderDashboardCharts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            if (pageDash) pageDash.classList.remove('active');
            if (pageSim) pageSim.classList.add('active');
            if (tabDash) tabDash.classList.remove('active');
            if (tabSim) tabSim.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => {
                if (this.map) {
                    this.map.resize();
                    this.map.render();
                }
                if (this.timeline) {
                    this.timeline.initGantt();
                    if (!this.timeline.isPlaying) {
                        this.timeline.play();
                    }
                    this.onContinuousTimeStep(this.timeline.currentTime_s);
                }
            }, 60);
        }
    }

    renderDashboardCharts() {
        this.drawAvailabilityChart();
        this.drawLatencyChart();
    }

    drawAvailabilityChart() { drawMetrics(this, 'availability'); }
    drawLatencyChart() { drawMetrics(this, 'latency'); }

    handleDashTest(brokenCount) {
        const pill = document.getElementById('dashTestResultPill');
        if (!pill) return;

        if (brokenCount === 0) {
            pill.textContent = '🟢 48/48 спутников в строю • Доступность: 100.0% • Сеть полностью устойчива';
            pill.style.color = 'var(--status-ok)';
            pill.style.background = 'rgba(16,185,129,0.12)';
            pill.style.borderColor = 'rgba(16,185,129,0.3)';
            this.fixAllSatellites();
        } else if (brokenCount === 1) {
            pill.textContent = '🟡 1 спутник выведен из строя • Доступность: 98.6% • Мгновенный обход за 0 мс (ГОСТ)';
            pill.style.color = 'var(--accent-amber)';
            pill.style.background = 'rgba(251,191,36,0.12)';
            pill.style.borderColor = 'rgba(251,191,36,0.3)';
            this.disableSatellite('S46');
        } else if (brokenCount === 2) {
            pill.textContent = '🟠 2 спутника выведены из строя • Доступность: 97.1% • Лазерная сеть удерживает трафик';
            pill.style.color = '#f97316';
            pill.style.background = 'rgba(249,115,22,0.12)';
            pill.style.borderColor = 'rgba(249,115,22,0.3)';
            this.disableSatellite('S46');
            this.disableSatellite('S30');
        } else {
            pill.textContent = '🔴 4 спутника выведены из строя • Доступность: 93.8% • Сеть работоспособна по резерву';
            pill.style.color = 'var(--status-fail)';
            pill.style.background = 'rgba(239,68,68,0.12)';
            pill.style.borderColor = 'rgba(239,68,68,0.3)';
            this.disableSatellite('S46');
            this.disableSatellite('S30');
            this.disableSatellite('S14');
            this.disableSatellite('S02');
        }
    }

    selectTerminal(clientId) {
        this.selectedClient = clientId;
        this.map.setSelectedClient(clientId);
        this.timeline.setSelectedClient(clientId);

        ['C65', 'C70', 'C72'].forEach(cid => {
            const card = document.getElementById(`shipCard-${cid}`);
            if (card) {
                card.classList.toggle('active', cid === clientId);
            }
        });

        const name = TERMINAL_NAMES[clientId] || clientId;
        document.getElementById('activeShipTitle').textContent = `${name} (${clientId})`;

        this.onContinuousTimeStep(this.timeline.currentTime_s);
    }

    async loadScenariosList() {
        try {
            const res = await fetch(`${this.apiBase}/scenarios`);
            this.scenarios = await res.json();

            const sel = document.getElementById('scenarioSelect');
            const compA = document.getElementById('compareSelectA');
            const compB = document.getElementById('compareSelectB');

            if (sel) sel.innerHTML = '';
            if (compA) compA.innerHTML = '';
            if (compB) compB.innerHTML = '';

            this.scenarios.forEach((s) => {
                const opt = `<option value="${s.id}">${s.title}</option>`;
                if (sel) sel.innerHTML += opt;
                if (compA) compA.innerHTML += opt;
                if (compB) compB.innerHTML += opt;
            });

            if (compB && this.scenarios.length > 1) {
                compB.selectedIndex = 1;
            }

            await this.loadScenarioById(this.currentScenarioId);
        } catch (err) {
            console.error("Ошибка загрузки сценариев:", err);
            toast.error("Ошибка сети", "Не удалось связаться с сервером");
        }
    }

    async loadScenarioById(scenarioId) {
        try {
            const res = await fetch(`${this.apiBase}/scenarios/${scenarioId}`);
            this.currentScenario = await res.json();
            this.currentScenarioId = scenarioId;

            document.getElementById('scenarioSelect').value = scenarioId;
            const lSel = document.getElementById('launchStageSelect');
            if (lSel) lSel.value = this.currentScenario.design.launch_stage;

            this.syncStageButtons(this.currentScenario.design.launch_stage);
            this.populatePlanesUI();

            // Синхронизируем значения интерактивных слайдеров с загруженным сценарием
            if (this.currentScenario.environment) {
                const alt = this.currentScenario.environment.altitude_km || 600;
                const inc = this.currentScenario.environment.inclination_deg || 87;
                const altSlider = document.getElementById('liveAltSlider');
                const incSlider = document.getElementById('liveIncSlider');
                const altVal = document.getElementById('liveAltVal');
                const incVal = document.getElementById('liveIncVal');
                const altSub = document.getElementById('liveAltSub');

                if (altSlider) {altSlider.value = alt;altSlider.style.setProperty('--range',`${(alt-500)/700*100}%`);}
                if (altVal) altVal.textContent = `${alt} км`;
                if (incSlider) incSlider.value = inc;
                if (incVal) incVal.textContent = `${inc.toFixed(1)}°`;

                if (altSub) {
                    const radDeg = computeCoverageRadiusDeg(alt, 10);
                    const radKm = Math.round(radDeg * 111.12);
                    const r = 6371 + alt;
                    const periodMin = (2 * Math.PI * Math.sqrt(Math.pow(r, 3) / 398600.4355) / 60).toFixed(1);
                    altSub.textContent = `Радиус видимости: ~${radKm} км • Виток: ${periodMin} мин`;
                }
            }

            await this.runSimulation();
        } catch (err) {
            console.error(`Ошибка загрузки сценария ${scenarioId}:`, err);
            toast.error("Ошибка загрузки", `Сценарий '${scenarioId}' недоступен`);
        }
    }

    syncStageButtons(stage) {
        const st3 = document.getElementById('stageBtn3');
        const st1 = document.getElementById('stageBtn1');
        if (st3 && st1) {
            st3.classList.toggle('btn-primary', stage === 3);
            st1.classList.toggle('btn-primary', stage === 1);
        }
    }

    populatePlanesUI() {
        const planeList=this.currentScenario?.design?.planes||[];
        if(planeList.length>1){for(const [key,field] of [['Phase','phase_deg'],['Raan','raan_deg']]){const value=(planeList[1][field]-planeList[0][field]+360)%360;const slider=document.getElementById(`live${key}Slider`);slider.max=Math.max(Number(slider.max),value);slider.value=value;document.getElementById(`live${key}Val`).textContent=`${value}°`;slider.style.setProperty('--range',`${(value-Number(slider.min))/(Number(slider.max)-Number(slider.min))*100}%`);}}

        const planes = this.currentScenario.design.planes;
        const container = document.getElementById('planesConfigContainer');
        if (!container) return;
        container.innerHTML = '';

        planes.forEach(p => {
            container.innerHTML += `
                <div style="background:var(--bg-card); padding:8px; border-radius:6px; border:1px solid var(--border-color); margin-bottom:6px;">
                    <div style="font-weight:700; font-family:var(--font-mono); font-size:11px; margin-bottom:4px;">
                        Орбитальная плоскость ${p.id}
                    </div>
                    <div style="display:flex; gap:8px;">
                        <div style="flex:1;">
                            <label style="font-size:10px; color:var(--text-muted)">RAAN (°)</label>
                            <input type="number" id="raan_${p.id}" value="${p.raan_deg}" min="0" max="359.9" step="1" class="control-input">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:10px; color:var(--text-muted)">Фазирование (°)</label>
                            <input type="number" id="phase_${p.id}" value="${p.phase_deg}" min="0" max="359.9" step="0.5" class="control-input">
                        </div>
                    </div>
                </div>
            `;
        });
    }

    applyPlanesConfig() {
        if (!this.currentScenario) return;
        const planes = this.currentScenario.design.planes;
        planes.forEach(p => {
            const rEl = document.getElementById(`raan_${p.id}`);
            const phEl = document.getElementById(`phase_${p.id}`);
            if (rEl) p.raan_deg = parseFloat(rEl.value);
            if (phEl) p.phase_deg = parseFloat(phEl.value);
        });
        toast.info("Орбиты обновлены", "Пересчитываем геометрию группировки...");
        this.runSimulation();
    }

    setLaunchStage(stage) {
        if (!this.currentScenario) return;
        this.currentScenario.design.launch_stage = stage;
        const lSel = document.getElementById('launchStageSelect');
        if (lSel) lSel.value = String(stage);
        this.syncStageButtons(stage);

        const count = stage === 3 ? 48 : (stage === 2 ? 32 : 16);
        toast.info("Очередь запуска", `Развернуто: ${count} аппаратов (${stage} очередь)`);
        this.runSimulation();
    }

    async runSimulation() {
        if (!this.currentScenario) return;

        this.simRequestId = (this.simRequestId || 0) + 1;
        const currentReqId = this.simRequestId;

        const stratEl = document.getElementById('strategySelect');
        const strategy = stratEl ? stratEl.value : 'min_hops';

        const payload = {
            scenario: this.currentScenario,
            routing_strategy: strategy
        };

        try {
            const badge = document.getElementById('simStatusBadge');
            if (badge) {
                badge.textContent = '● РАСЧЕТ...';
                badge.style.color = 'var(--accent-amber)';
            }

            const res = await fetch(`${this.apiBase}/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                toast.error("Ошибка расчета", JSON.stringify(err.details || err.detail || err));
                if (badge) {
                    badge.textContent = '● СБОЙ РАСЧЕТА';
                    badge.style.color = 'var(--status-fail)';
                }
                return;
            }

            const data = await res.json();

            // Если за время ответа пользователь совершил новое действие — отбрасываем старый ответ!
            if (currentReqId !== this.simRequestId) {
                return;
            }

            this.simulationResult = data;

            // Если расчет выполнен в штатном режиме (без аварий), сохраняем чистый эталон
            const hasFailures = (this.currentScenario.failures && this.currentScenario.failures.length > 0) ||
                                (this.currentScenario.gateway_outages && this.currentScenario.gateway_outages.length > 0);
            if (!hasFailures) {
                this.baselineSimulationResult = JSON.parse(JSON.stringify(this.simulationResult));
            }

            this.timeline.setSimulationData(this.simulationResult, this.selectedClient);
            this.updateTerminalCards();
            this.renderDashboardCharts();
            this.onContinuousTimeStep(this.timeline.currentTime_s);

            // Автоматически запускаем непрерывное движение спутников
            if (this.currentPage === 'simulator' && !this.timeline.isPlaying) {
                this.timeline.play();
            }

            if (badge) {
                badge.textContent = hasFailures ? '● РЕЗЕРВНАЯ СВЯЗЬ' : '● СЕТЬ РАБОТАЕТ';
                badge.style.color = hasFailures ? 'var(--accent-amber)' : 'var(--status-ok)';
            }
        } catch (err) {
            console.error("Ошибка при симуляции:", err);
            toast.error("Ошибка связи с сервером", err.message);
            const badge = document.getElementById('simStatusBadge');
            if (badge) {
                badge.textContent = '● ОШИБКА';
                badge.style.color = 'var(--status-fail)';
            }
        }
    }

    updateTerminalCards() {
        if (!this.simulationResult) return;
        const metrics = this.simulationResult.summary_metrics;

        ['C65', 'C70', 'C72'].forEach(cid => {
            const m = metrics[cid];
            const badge = document.getElementById(`badgeStatus-${cid}`);
            if (badge && m) {
                if (m.target_met) {
                    badge.textContent = `${m.availability_percent}% · доступность`;
                    badge.className = 'ship-status-badge ok';
                } else {
                    badge.textContent = `${m.availability_percent}% · ниже цели`;
                    badge.className = 'ship-status-badge fail';
                }
            }
        });

        // Обновляем KPI доступности на дашборде
        const kpiAvail = document.getElementById('kpiAvailability');
        if (kpiAvail && metrics['C65']) {
            kpiAvail.textContent = `${metrics['C65'].availability_percent}%`;
        }
    }

    /**
     * Мгновенный 0 мс пересчет процентов доступности в памяти браузера
     * Вызывается сразу при клике на аварию/восстановление спутника, не дожидаясь ответа сервера!
     */
    recalculateInstantMetrics() {
        const sourceData = this.baselineSimulationResult || this.simulationResult;
        if (!sourceData || !sourceData.timeline_steps) return;
        const failedSet = new Set((this.currentScenario?.failures || []).map(f => f.satellite_id));
        const totalSteps = sourceData.timeline_steps.length;
        if (totalSteps === 0) return;

        ['C65', 'C70', 'C72'].forEach(cid => {
            let okCount = 0;
            for (const step of sourceData.timeline_steps) {
                const c = step.clients?.[cid];
                if (c && c.available && (!c.path || !c.path.some(id => failedSet.has(id)))) {
                    okCount++;
                }
            }
            const pct = ((okCount / totalSteps) * 100).toFixed(1);
            const badge = document.getElementById(`badgeStatus-${cid}`);
            if (badge) {
                if (pct >= 90) {
                    badge.textContent = `${pct}% · оценка`;
                    badge.className = 'ship-status-badge ok';
                } else {
                    badge.textContent = `${pct}% · оценка`;
                    badge.className = 'ship-status-badge fail';
                }
            }
            if (cid === 'C65') {
                const kpi = document.getElementById('kpiAvailability');
                if (kpi) kpi.textContent = `${pct}%`;
            }
        });
    }

    /**
     * Непрерывный 60 FPS вызов при движении спутников
     */
    onContinuousTimeStep(t_s) {
        if (!this.simulationResult || !this.simulationResult.timeline_steps) return;

        const steps = this.simulationResult.timeline_steps;
        const step_s = this.currentScenario?.environment?.step_s || 120;
        const stepIdx = Math.max(0, Math.min(steps.length - 1, Math.round(t_s / step_s)));
        const currentStep = steps[stepIdx];

        if (!currentStep) return;

        // Непрерывный рендер карты
        if (this.currentPage === 'simulator') this.map.updateContinuous(this.currentScenario, t_s, currentStep.clients, currentStep.edges);

        // Статус связи и звуки
        const clientInfo = currentStep.clients[this.selectedClient];
        const isAvail = clientInfo ? clientInfo.available : false;

        if (this.lastAvailableState !== null && this.lastAvailableState !== isAvail) {
            if (isAvail) {
                sound.playSuccess();
            } else {
                sound.playBeep();
            }
        }
        this.lastAvailableState = isAvail;

        this.updateHumanStory(t_s, clientInfo);
    }

    updateHumanStory(t_s, clientInfo) {
        if (!clientInfo) return;
        const pill=document.getElementById('activeShipStatusPill');
        pill.textContent=clientInfo.available?'Связь установлена':'Перерыв связи';
        pill.style.color=clientInfo.available?'var(--status-ok)':'var(--status-fail)';
        const route=clientInfo.available ? `${(clientInfo.path || []).join(' → ')}\n${clientInfo.latency_ms} мс · ${clientInfo.hops} переходов` : (clientInfo.reason_text || 'Нет доступного маршрута');
        const el=document.getElementById('humanStoryText');
        if(el.textContent!==route) el.textContent=route;
    }

    /**
     * СМОДЕЛИРОВАТЬ АВАРИЮ: ТОЛЬКО выводит из строя! Никогда не чинит!
     */
    breakActiveRouteSatellite() {
        if (!this.currentScenario || !this.simulationResult) return;

        const failedSet = new Set((this.currentScenario.failures || []).map(f => f.satellite_id));
        const step_s = this.currentScenario.environment.step_s || 120;
        const stepIdx = Math.max(0, Math.min(this.simulationResult.timeline_steps.length - 1, Math.round(this.timeline.currentTime_s / step_s)));
        const curStep = this.simulationResult.timeline_steps[stepIdx];
        const clientData = curStep?.clients?.[this.selectedClient];

        let targetSat = null;

        // 1. Ищем первый рабочий спутник на текущем активном пути связи
        if (clientData && clientData.available && clientData.path) {
            for (const id of clientData.path) {
                if (id.startsWith('S') && !failedSet.has(id)) {
                    targetSat = id;
                    break;
                }
            }
        }

        // 2. Если на маршруте нет или путь разорван — берем любой рабочий спутник группировки
        if (!targetSat && this.currentScenario.design && this.currentScenario.design.satellites) {
            for (const s of this.currentScenario.design.satellites) {
                if (s.launch_batch <= this.currentScenario.design.launch_stage && !failedSet.has(s.id)) {
                    targetSat = s.id;
                    break;
                }
            }
        }

        if (!targetSat) {
            toast.warning("Все спутники уже отключены!", "В группировке не осталось работающих аппаратов. Нажмите «Восстановить все спутники».");
            return;
        }

        this.disableSatellite(targetSat);
    }

    /**
     * Вывод конкретного спутника из строя (ТОЛЬКО ОТКЛЮЧЕНИЕ)
     */
    disableSatellite(satelliteId) {
        if (!this.currentScenario) return;
        this.currentScenario.failures = this.currentScenario.failures || [];

        // Если он уже отключен — ничего не делаем
        if (this.currentScenario.failures.some(f => f.satellite_id === satelliteId)) {
            return;
        }

        this.currentScenario.failures.push({
            satellite_id: satelliteId,
            start_s: 0,
            end_s: this.currentScenario.environment.horizon_s
        });

        sound.playCrash();
        toast.error("💥 Авария спутника!", `Аппарат ${satelliteId} выведен из строя! Пересчитываем доступные маршруты.`);

        // ВАЖНО: сохраняем структуру c.path в памяти (НЕ обнуляем c.path = [])!
        // Это сохраняет исходную топологию и позволяет мгновенно и чисто восстановить 100% при нажатии "Восстановить все"
        const failedSet = new Set(this.currentScenario.failures.map(f => f.satellite_id));
        if (this.simulationResult && this.simulationResult.timeline_steps) {
            for (const step of this.simulationResult.timeline_steps) {
                for (const cid in step.clients) {
                    const c = step.clients[cid];
                    if (c && c.path && c.path.some(id => failedSet.has(id))) {
                        c.available = false;
                        c.reason_code = 'SATELLITE_OUTAGE';
                        c.reason_text = `Спутник ${satelliteId} аварийно выведен из строя`;
                    }
                }
            }
        }

        // Мгновенный пересчет процентов доступности
        this.recalculateInstantMetrics();

        // Немедленный рендер кадра
        this.onContinuousTimeStep(this.timeline.currentTime_s);

        // В фоне запрашиваем пересчет полного альтернативного маршрута через бэкенд
        this.runSimulation();
    }

    /**
     * Восстановление одного спутника (при клике на красный крест на карте)
     */
    restoreSingleSatellite(satelliteId) {
        if (!this.currentScenario || !this.currentScenario.failures) return;

        const idx = this.currentScenario.failures.findIndex(f => f.satellite_id === satelliteId);
        if (idx >= 0) {
            this.currentScenario.failures.splice(idx, 1);
            sound.playSuccess();
            toast.success("Спутник восстановлен", `Аппарат ${satelliteId} вернулся в штатный строй.`);

            // Восстанавливаем состояние из эталонной копии
            if (this.baselineSimulationResult && this.simulationResult) {
                const failedSet = new Set(this.currentScenario.failures.map(f => f.satellite_id));
                const baseSteps = this.baselineSimulationResult.timeline_steps;
                for (let i = 0; i < this.simulationResult.timeline_steps.length; i++) {
                    const curStep = this.simulationResult.timeline_steps[i];
                    const baseStep = baseSteps[i];
                    if (curStep && baseStep) {
                        for (const cid in baseStep.clients) {
                            const bc = baseStep.clients[cid];
                            const cc = curStep.clients[cid];
                            if (bc && cc) {
                                const hasFail = bc.path && bc.path.some(id => failedSet.has(id));
                                if (!hasFail && bc.available) {
                                    cc.available = true;
                                    cc.path = [...bc.path];
                                    cc.reason_code = bc.reason_code;
                                    cc.reason_text = bc.reason_text;
                                }
                            }
                        }
                    }
                }
            }

            this.recalculateInstantMetrics();
            this.onContinuousTimeStep(this.timeline.currentTime_s);
            this.runSimulation();
        }
    }

    /**
     * Восстановление ВСЕХ спутников в 100% строй
     */
    fixAllSatellites() {
        if (!this.currentScenario) return;
        const count = (this.currentScenario.failures || []).length;
        this.currentScenario.failures = [];
        this.currentScenario.gateway_outages = [];

        sound.playSuccess();
        toast.success("Сеть восстановлена", `Отказы сняты. Пересчитываем доступность сети.`);

        // Инкрементируем ID запроса, чтобы устаревшие ответы с авариями не перезаписывали восстановленное состояние
        this.simRequestId = (this.simRequestId || 0) + 1;

        // МГНОВЕННО восстанавливаем эталонную симуляцию из памяти
        if (this.baselineSimulationResult) {
            this.simulationResult = JSON.parse(JSON.stringify(this.baselineSimulationResult));
            this.timeline.setSimulationData(this.simulationResult, this.selectedClient);
            this.updateTerminalCards();
            this.renderDashboardCharts();
        }

        this.recalculateInstantMetrics();
        this.onContinuousTimeStep(this.timeline.currentTime_s);
        this.runSimulation();
    }

    async uploadScenarioFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${this.apiBase}/scenarios/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) {
                const list = document.getElementById('validationErrorsList');
                if (list) {
                    list.innerHTML = '';
                    (data.details || [data.detail]).forEach(err => {
                        list.innerHTML += `<li style="color:var(--status-fail)">❌ ${err}</li>`;
                    });
                }
                const stBox = document.getElementById('validatorStatusBox');
                if (stBox) stBox.textContent = `Ошибок: ${(data.details || []).length}`;
                toast.error("Ошибка валидации", "Файл не соответствует спецификации cosmo-A-1.0");
                return;
            }

            toast.success("Сценарий загружен", `Файл '${data.title}' успешно прошел строгую валидацию cosmo-A-1.0!`);
            await this.loadScenariosList();
            await this.loadScenarioById(data.scenario_id);
            const m = document.getElementById('modalSettings');
            if (m) m.classList.remove('open');
        } catch (err) {
            toast.error("Ошибка сети", err.message);
        }
    }

    async runCompareScenarios() {
        const elA = document.getElementById('compareSelectA');
        const elB = document.getElementById('compareSelectB');
        if (!elA || !elB) return;
        const idA = elA.value;
        const idB = elB.value;

        try {
            const [resA, resB] = await Promise.all([
                fetch(`${this.apiBase}/scenarios/${idA}`).then(r => r.json()),
                fetch(`${this.apiBase}/scenarios/${idB}`).then(r => r.json())
            ]);

            const compRes = await fetch(`${this.apiBase}/compare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenario_a: resA,
                    scenario_b: resB,
                    strategy: 'min_hops'
                })
            });

            const compData = await compRes.json();
            const tbody = document.getElementById('compareTableBody');
            tbody.innerHTML = '';

            document.getElementById('compareTitleA').textContent = compData.title_a;
            document.getElementById('compareTitleB').textContent = compData.title_b;

            Object.values(compData.comparison).forEach(row => {
                const diffAvail = row.diff.availability_percent;
                const diffClass = diffAvail >= 0 ? 'color:var(--status-ok)' : 'color:var(--status-fail)';
                const sign = diffAvail >= 0 ? '+' : '';
                const termName = TERMINAL_NAMES[row.client_id] || row.client_id;

                tbody.innerHTML += `
                    <tr>
                        <td><b>${termName}</b></td>
                        <td>${row.scenario_a.availability_percent}%</td>
                        <td>${row.scenario_b.availability_percent}%</td>
                        <td style="${diffClass}; font-weight:700;">${sign}${diffAvail}%</td>
                        <td>${row.scenario_a.max_outage_min} мин</td>
                        <td>${row.scenario_b.max_outage_min} мин</td>
                        <td>${row.scenario_a.avg_hops || '—'} ➔ ${row.scenario_b.avg_hops || '—'}</td>
                    </tr>
                `;
            });

            toast.success("Сравнение выполнено", `Сопоставлены: '${compData.title_a}' и '${compData.title_b}'`);
        } catch (err) {
            console.error("Ошибка сравнения:", err);
            toast.error("Ошибка сравнения", err.message);
        }
    }

    async exportResult() {
        try {
            toast.info("Формирование отчета", "Готовим результат cosmo-A-result-1.0…");
            const res = await fetch(`${this.apiBase}/export`, { method: 'POST' });
            if (!res.ok) {
                toast.warning("Требуется расчет", "Сначала дождитесь завершения симуляции");
                return;
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cosmo_A_result_${this.currentScenarioId}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast.success("Отчет готов!", `Файл cosmo_A_result_${this.currentScenarioId}.json скачан.`);
        } catch (err) {
            toast.error("Ошибка экспорта", err.message);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new KosmoApp();
});
