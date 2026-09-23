import { EarthSurface } from './earth.js';
import { WORLD_COASTLINES } from './world_data.js';

// Физические константы движения спутников (Кеплеровская механика)
const R_EARTH = 6371.0;
const MU_EARTH = 398600.435507;
const OMEGA_EARTH = 2.0 * Math.PI / 86164.09054;

/**
 * Вычисляет точный физический геоцентрический угол видимости psi (градусы)
 * для спутника на высоте altitude_km при минимальном угле места minElevationDeg.
 * Точно соответствует расчету в app.core.geometry:
 * sin(beta) = (R / (R + h)) * cos(elevation)
 * psi = 90° - elevation - beta
 */
export function computeCoverageRadiusDeg(altitude_km = 600.0, minElevationDeg = 10.0) {
    const R = R_EARTH;
    const rSat = R + altitude_km;
    const elRad = (minElevationDeg * Math.PI) / 180;
    const sinBeta = Math.min(1.0, (R / rSat) * Math.cos(elRad));
    const betaRad = Math.asin(sinBeta);
    const psiRad = (Math.PI / 2.0) - elRad - betaRad;
    return (psiRad * 180.0) / Math.PI; // ~15.844° для 600 км и 10°
}

export function getVisibilityDomePolygon(centerLat, centerLon, radiusDeg, segments = 48) {
    const lat0Rad = (centerLat * Math.PI) / 180;
    const lon0Rad = (centerLon * Math.PI) / 180;
    const dRad = (radiusDeg * Math.PI) / 180;
    const points = [];

    for (let i = 0; i <= segments; i++) {
        const bearing = (i * 2 * Math.PI) / segments;
        const lat = Math.asin(
            Math.sin(lat0Rad) * Math.cos(dRad) + 
            Math.cos(lat0Rad) * Math.sin(dRad) * Math.cos(bearing)
        );
        const lon = lon0Rad + Math.atan2(
            Math.sin(bearing) * Math.sin(dRad) * Math.cos(lat0Rad),
            Math.cos(dRad) - Math.sin(lat0Rad) * Math.sin(lat)
        );
        const latDeg = lat * (180 / Math.PI);
        let lonDeg = lon * (180 / Math.PI);
        while (lonDeg > 180) lonDeg -= 360;
        while (lonDeg < -180) lonDeg += 360;
        points.push({ lat: latDeg, lon: lonDeg });
    }
    return points;
}

/**
 * Аналитический расчет положений всех спутников для любого непрерывного момента времени t_s (сек).
 * Выполняется за ~0.04 мс в браузере, обеспечивая плавные 60 FPS без дерганий.
 */
export function computeContinuousSatellites(scenario, t_s) {
    if (!scenario || !scenario.environment || !scenario.design) return [];
    const e = scenario.environment;
    const d = scenario.design;
    const pmap = {};
    for (const p of d.planes) {
        pmap[p.id] = p;
    }
    const r = R_EARTH + e.altitude_km;
    const n = Math.sqrt(MU_EARTH / (r ** 3));
    const inc = (e.inclination_deg * Math.PI) / 180;
    const th = (e.earth_angle0_deg * Math.PI) / 180 + OMEGA_EARTH * t_s;
    const cosTh = Math.cos(th);
    const sinTh = Math.sin(th);
    const cosInc = Math.cos(inc);
    const sinInc = Math.sin(inc);

    const failedSet = new Set();
    for (const f of (scenario.failures || [])) {
        if (f.start_s <= t_s && t_s < f.end_s) {
            failedSet.add(f.satellite_id);
        }
    }

    const sats = [];
    for (const sat of d.satellites) {
        const plane = pmap[sat.plane_id];
        if (!plane) continue;

        const u = ((sat.slot_deg + plane.phase_deg) * Math.PI) / 180 + n * t_s;
        const om = (plane.raan_deg * Math.PI) / 180;
        const cu = Math.cos(u);
        const su = Math.sin(u);
        const co = Math.cos(om);
        const so = Math.sin(om);

        // Инерциальные декартовы координаты (ECI)
        const x_eci = r * (co * cu - so * su * cosInc);
        const y_eci = r * (so * cu + co * su * cosInc);
        const z_eci = r * (su * sinInc);

        // Вращение с Землей (ECEF)
        const x_ecef = x_eci * cosTh + y_eci * sinTh;
        const y_ecef = -x_eci * sinTh + y_eci * cosTh;
        const z_ecef = z_eci;

        // Географические координаты
        const normR = Math.hypot(x_ecef, y_ecef, z_ecef);
        const lat = Math.asin(Math.max(-1, Math.min(1, z_ecef / normR))) * (180 / Math.PI);
        const lon = Math.atan2(y_ecef, x_ecef) * (180 / Math.PI);

        const isFailed = failedSet.has(sat.id);
        const isActive = sat.launch_batch <= d.launch_stage && !isFailed;

        sats.push({
            id: sat.id,
            plane_id: sat.plane_id,
            launch_batch: sat.launch_batch,
            lat_deg: lat,
            lon_deg: lon,
            active: isActive,
            failed: isFailed
        });
    }
    return sats;
}

export class MapViewer {
    constructor(canvasId, tooltipId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.tooltip = document.getElementById(tooltipId);
        
        // Режимы проекции:
        // 'polar' (ДЕФОЛТ: Вид сверху на Северный полюс / Арктический радар — БЕЗ РАСТЯЖЕНИЯ!)
        // 'globe' (3D интерактивный сферический глобус с вращением и перспективой)
        // 'flat'  (Плоская 2D карта мира с правильными пропорциями 2:1)
        this.viewMode = 'globe';
        this.earth = new EarthSurface(() => this.render());

        // Состояние вращения и зума 3D глобуса
        this.globeCenterLat = 65; // начальный ракурс: Арктика 65°N
        this.globeCenterLon = 70; // начальный ракурс: Севморпуть 70°E
        this.globeZoom = 1.0;

        // Состояние зума и панорамирования для Полярного радара
        this.polarZoom = 1.0;
        this.polarPanX = 0;
        this.polarPanY = 0;

        // Состояние зума и панорамирования для Плоской карты
        this.flatZoom = 1.0;
        this.flatPanX = 0;
        this.flatPanY = 0;

        this.isDragging = false;
        this.hasDragged = false;
        
        this.scenario = null;
        this.currentTime_s = 0;
        this.currentSnapshot = null;
        this.currentRouting = null;
        this.selectedClient = 'C65';
        this.hoveredSat = null;
        this.hoveredSite = null;
        this.onSatelliteClick = null;
        this.onSiteClick = null;
        this.pulsePhase = 0;
        
        this.initEvents();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.render();
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this.canvas.style.cursor = 'grab';
        this.render();
    }

    resetView() {
        if (this.viewMode === 'globe') {
            this.globeCenterLat = 65;
            this.globeCenterLon = 70;
            this.globeZoom = 1.0;
        } else if (this.viewMode === 'polar') {
            this.polarZoom = 1.0;
            this.polarPanX = 0;
            this.polarPanY = 0;
        } else if (this.viewMode === 'flat') {
            this.flatZoom = 1.0;
            this.flatPanX = 0;
            this.flatPanY = 0;
        }
        this.render();
    }

    resetGlobeView() {
        this.resetView();
    }

    setSelectedClient(clientId) {
        this.selectedClient = clientId;
        this.render();
    }

    updateContinuous(scenario, t_s, nearestRouting, nearestEdges) {
        this.scenario = scenario;
        this.currentTime_s = t_s;
        this.pulsePhase = (this.pulsePhase + 0.05) % (Math.PI * 2);

        const satellites = computeContinuousSatellites(scenario, t_s);
        this.currentSnapshot = {
            satellites,
            edges: nearestEdges || []
        };
        this.currentRouting = nearestRouting || {};
        this.render();
    }

    /**
     * Преобразование (lat, lon, altKm) в координаты холста для выбранной проекции.
     * Возвращает { x, y, visible, z, d_xy } с честной 3D окклюзией планеты!
     */
    geoToCanvas(lat, lon, altKm = 0) {
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // 1. ПОЛЯРНЫЙ РАДАР (Вид сверху на Северный полюс)
        if (this.viewMode === 'polar') {
            const minLat = 20;
            const baseR = Math.min(cx, cy) * 0.90;
            const maxR = baseR * this.polarZoom;
            
            if (lat < 18) {
                return { x: -9999, y: -9999, visible: false, z: 1, isClamped: true };
            }

            const r = maxR * ((90 - lat) / (90 - minLat));
            const angleRad = ((lon - 60) * Math.PI) / 180;
            const centerX = cx + this.polarPanX;
            const centerY = cy + this.polarPanY;
            const x = centerX + r * Math.sin(angleRad);
            const y = centerY + r * Math.cos(angleRad);
            return { x, y, visible: true, z: 1, isClamped: false };
        }

        // 2. 3D СФЕРИЧЕСКИЙ ГЛОБУС
        if (this.viewMode === 'globe') {
            const radius = Math.min(cx, cy) * 0.82 * this.globeZoom;
            const centerLatRad = (this.globeCenterLat * Math.PI) / 180;
            const centerLonRad = (this.globeCenterLon * Math.PI) / 180;

            const latRad = (lat * Math.PI) / 180;
            const lonRad = (lon * Math.PI) / 180;
            const dLon = lonRad - centerLonRad;

            const rScale = (R_EARTH + altKm) / R_EARTH;
            const rPx = radius * rScale;

            const cosLat = Math.cos(latRad);
            const sinLat = Math.sin(latRad);
            const cosCLat = Math.cos(centerLatRad);
            const sinCLat = Math.sin(centerLatRad);
            const cosDLon = Math.cos(dLon);
            const sinDLon = Math.sin(dLon);

            const X_view = cosLat * sinDLon;
            const Y_view = sinLat * cosCLat - cosLat * sinCLat * cosDLon;
            const Z_view = sinLat * sinCLat + cosLat * cosCLat * cosDLon;

            const D_xy = Math.hypot(X_view, Y_view) * rScale;

            // Наземные объекты на обратной стороне планеты скрыты
            if (altKm <= 10) {
                if (Z_view <= 0.005) {
                    return { x: -9999, y: -9999, visible: false, z: Z_view * R_EARTH, isClamped: true };
                }
            } else {
                // Спутники на высоте 600 км окклюдируются телом Земли
                if (Z_view < 0 && D_xy <= 1.001) {
                    return { x: -9999, y: -9999, visible: false, z: Z_view * (R_EARTH + altKm), isClamped: true };
                }
            }

            const x = cx + X_view * rPx;
            const y = cy - Y_view * rPx;
            return { x, y, visible: true, z: Z_view * (R_EARTH + altKm), d_xy: D_xy, isClamped: false };
        }

        // 3. ПЛОСКАЯ КАРТА МИРА
        let baseMapH = h * 0.88;
        let baseMapW = baseMapH * 2.0;
        if (baseMapW > w * 0.94) {
            baseMapW = w * 0.94;
            baseMapH = baseMapW / 2.0;
        }
        const effMapW = baseMapW * this.flatZoom;
        const effMapH = baseMapH * this.flatZoom;
        const mapCenterX = cx + this.flatPanX;
        const mapCenterY = cy + this.flatPanY;
        const offsetX = mapCenterX - effMapW / 2;
        const offsetY = mapCenterY - effMapH / 2;

        const x = offsetX + ((lon + 180) / 360) * effMapW;
        const y = offsetY + effMapH - ((lat + 85) / 170) * effMapH;
        return { x, y, visible: true, z: 1, isClamped: false, effMapW, effMapH };
    }

    initEvents() {
        let isMouseDown = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let startCenterLon = 0;
        let startCenterLat = 0;
        let startPolarPanX = 0;
        let startPolarPanY = 0;
        let startFlatPanX = 0;
        let startFlatPanY = 0;

        // Перетаскивание и вращение мышью (Drag & Pan & Rotate) для ВСЕХ 3 карт
        this.canvas.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            this.isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            startCenterLon = this.globeCenterLon;
            startCenterLat = this.globeCenterLat;
            startPolarPanX = this.polarPanX;
            startPolarPanY = this.polarPanY;
            startFlatPanX = this.flatPanX;
            startFlatPanY = this.flatPanY;
            this.hasDragged = false;
            this.canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
                if (Math.hypot(dx, dy) > 4) {
                    this.hasDragged = true;
                }

                if (this.viewMode === 'globe') {
                    const sens = 0.35 / this.globeZoom;
                    let newLon = (startCenterLon - dx * sens) % 360;
                    while (newLon > 180) newLon -= 360;
                    while (newLon < -180) newLon += 360;
                    let newLat = Math.max(-85, Math.min(85, startCenterLat + dy * sens));
                    this.globeCenterLon = newLon;
                    this.globeCenterLat = newLat;
                    this.render();
                    return;
                } else if (this.viewMode === 'polar') {
                    this.polarPanX = startPolarPanX + dx * this.dpr;
                    this.polarPanY = startPolarPanY + dy * this.dpr;
                    this.render();
                    return;
                } else if (this.viewMode === 'flat') {
                    this.flatPanX = startFlatPanX + dx * this.dpr;
                    this.flatPanY = startFlatPanY + dy * this.dpr;
                    this.render();
                    return;
                }
            }

            // Обычное наведение (hover), если не перетаскиваем карту
            const rect = this.canvas.getBoundingClientRect();
            if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
            const mouseX = (e.clientX - rect.left) * this.dpr;
            const mouseY = (e.clientY - rect.top) * this.dpr;
            this.handleHover(mouseX, mouseY, e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', () => {
            if (isMouseDown) {
                isMouseDown = false;
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            if (this.tooltip) this.tooltip.style.display = 'none';
            this.hoveredSat = null;
            this.hoveredSite = null;
            this.render();
        });

        this.canvas.addEventListener('click', () => {
            if (this.hasDragged) {
                this.hasDragged = false;
                return; // подавляем клик после перетаскивания карты
            }
            if (this.hoveredSite && this.onSiteClick) {
                this.onSiteClick(this.hoveredSite.id);
            } else if (this.hoveredSat && this.onSatelliteClick) {
                this.onSatelliteClick(this.hoveredSat);
            }
        });

        // Масштабирование колесиком мыши (Zoom) для ВСЕХ 3 карт
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.10 : 0.90;

            if (this.viewMode === 'globe') {
                this.globeZoom = Math.max(0.65, Math.min(3.0, this.globeZoom * zoomFactor));
            } else if (this.viewMode === 'polar') {
                this.polarZoom = Math.max(0.6, Math.min(4.5, this.polarZoom * zoomFactor));
            } else if (this.viewMode === 'flat') {
                this.flatZoom = Math.max(0.7, Math.min(6.0, this.flatZoom * zoomFactor));
            }
            this.render();
        }, { passive: false });

        // Сенсорное управление для смартфонов и планшетов (Touch Drag & Pan)
        let touchStartX = 0;
        let touchStartY = 0;
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                isMouseDown = true;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                startCenterLon = this.globeCenterLon;
                startCenterLat = this.globeCenterLat;
                startPolarPanX = this.polarPanX;
                startPolarPanY = this.polarPanY;
                startFlatPanX = this.flatPanX;
                startFlatPanY = this.flatPanY;
                this.hasDragged = false;
            }
        }, { passive: true });

        this.canvas.addEventListener('touchmove', (e) => {
            if (isMouseDown && e.touches.length === 1) {
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                if (Math.hypot(dx, dy) > 4) this.hasDragged = true;

                if (this.viewMode === 'globe') {
                    const sens = 0.35 / this.globeZoom;
                    let newLon = (startCenterLon - dx * sens) % 360;
                    while (newLon > 180) newLon -= 360;
                    while (newLon < -180) newLon += 360;
                    let newLat = Math.max(-85, Math.min(85, startCenterLat + dy * sens));
                    this.globeCenterLon = newLon;
                    this.globeCenterLat = newLat;
                } else if (this.viewMode === 'polar') {
                    this.polarPanX = startPolarPanX + dx * this.dpr;
                    this.polarPanY = startPolarPanY + dy * this.dpr;
                } else if (this.viewMode === 'flat') {
                    this.flatPanX = startFlatPanX + dx * this.dpr;
                    this.flatPanY = startFlatPanY + dy * this.dpr;
                }
                this.render();
            }
        }, { passive: true });

        this.canvas.addEventListener('touchend', () => {
            isMouseDown = false;
        });
    }

    handleHover(mx, my, screenX, screenY) {
        if (!this.canvas) return;

        // 1. Проверяем наземные пункты (Мурманск, Урал, Диксон, Тикси)
        const sites = [
            { id: 'G_MUR', label: '📡 Шлюз «Мурманск»', lat: 68.97, lon: 33.07, desc: 'Опорный наземный телепорт Ростелекома' },
            { id: 'C65', label: '🏭 Терминал 65 (Урал-Север)', lat: 65.0, lon: 60.0, desc: 'Сухопутный промышленный хаб' },
            { id: 'C70', label: '⚓ Терминал 70 (Диксон)', lat: 70.0, lon: 90.0, desc: 'Атомный ледокол «Арктика» на Севморпути' },
            { id: 'C72', label: '🔬 Терминал 72 (Тикси)', lat: 72.0, lon: 130.0, desc: 'Полярная исследовательская станция' }
        ];

        let foundSite = null;
        for (const s of sites) {
            const pt = this.geoToCanvas(s.lat, s.lon, 0);
            if (pt.visible && !(this.viewMode === 'globe' && pt.isClamped)) {
                const dist = Math.hypot(pt.x - mx, pt.y - my);
                if (dist < 14 * this.dpr) {
                    foundSite = s;
                    break;
                }
            }
        }

        this.hoveredSite = foundSite;
        if (foundSite) {
            this.hoveredSat = null;
            this.canvas.style.cursor = 'pointer';
            if (this.tooltip) {
                this.tooltip.style.display = 'block';
                this.tooltip.style.left = `${screenX + 15}px`;
                this.tooltip.style.top = `${screenY + 15}px`;
                this.tooltip.innerHTML = `
                    <div style="font-weight:700; font-size:12px; margin-bottom:4px; color:var(--accent-cyan)">
                        ${foundSite.label}
                    </div>
                    <div>${foundSite.desc}</div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Широта: ${foundSite.lat}°N | Долгота: ${foundSite.lon}°E</div>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Кликните для выбора активного терминала</div>
                `;
            }
            this.render();
            return;
        }

        // 2. Проверяем спутники
        let foundSat = null;
        if (this.currentSnapshot && this.currentSnapshot.satellites) {
            const altKm = this.scenario?.environment?.altitude_km || 600.0;
            for (const sat of this.currentSnapshot.satellites) {
                const pt = this.geoToCanvas(sat.lat_deg, sat.lon_deg, altKm);
                if (pt.visible) {
                    const dist = Math.hypot(pt.x - mx, pt.y - my);
                    if (dist < 12 * this.dpr) {
                        foundSat = sat;
                        break;
                    }
                }
            }
        }

        this.hoveredSat = foundSat;
        if (foundSat) {
            this.canvas.style.cursor = 'pointer';
            if (this.tooltip) {
                this.tooltip.style.display = 'block';
                this.tooltip.style.left = `${screenX + 15}px`;
                this.tooltip.style.top = `${screenY + 15}px`;
                const statusText = foundSat.failed ? '💥 АВАРИЯ (ОТКАЗ)' : (foundSat.active ? '🟢 В СТРОЮ (ШТАТНО)' : '⚪ НЕ ВЫВЕДЕН');
                const statusColor = foundSat.failed ? '#ef4444' : (foundSat.active ? '#10b981' : '#64748b');

                this.tooltip.innerHTML = `
                    <div style="font-weight:700; font-family:var(--font-mono); font-size:12px; margin-bottom:4px; color:${statusColor}">
                        Спутник: ${foundSat.id} (Орбита ${foundSat.plane_id})
                    </div>
                    <div>Статус: <b style="color:${statusColor}">${statusText}</b></div>
                    <div>Широта: ${foundSat.lat_deg.toFixed(2)}° | Долгота: ${foundSat.lon_deg.toFixed(2)}°</div>
                    <div>Высота: ${foundSat.alt_km || 600} км | Наклонение: 87°</div>
                    <div style="margin-top:4px; font-size:10px; color:var(--accent-cyan)">Кликните, чтобы отключить или восстановить спутник</div>
                `;
            }
        } else {
            this.canvas.style.cursor = (this.viewMode === 'globe') ? (this.isDragging ? 'grabbing' : 'grab') : 'default';
            if (this.tooltip) this.tooltip.style.display = 'none';
        }

        this.render();
    }

    render() {
        if (!this.canvas || this.canvas.width < 10 || this.canvas.height < 10) return;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.clearRect(0, 0, w, h);
        if (this.viewMode === 'globe') {
            let seed=42;
            for(let i=0;i<170;i++){seed=(seed*16807)%2147483647;const x=(seed%10000)/10000*w;seed=(seed*16807)%2147483647;const y=(seed%10000)/10000*h;ctx.fillStyle=i%5?'#637b9650':'#bbd8f09a';ctx.fillRect(x,y,this.dpr*(i%5?.65:1.2),this.dpr*(i%5?.65:1.2));}
        }

        // 1. Космический фон / Проекционная основа
        if (this.viewMode === 'polar') {
            this.drawPolarRadarBase(ctx, cx, cy);
        } else if (this.viewMode === 'globe') {
            this.drawGlobeBase(ctx, cx, cy);
        } else if (this.viewMode === 'flat') {
            this.drawFlatGrid(ctx, w, h);
        }

        // 2. Детализированные береговые линии (Россия, Севморпуть, Арктические острова, материки)
        if (!(this.viewMode === 'globe' && this.earth.ready)) this.drawCoastlines(ctx);

        // 3. Зоны радиовидимости наземных шлюзов и терминалов (Мурманск, Урал, Диксон, Тикси)
        this.drawOrbitTracks(ctx);
        this.drawGroundSites(ctx);

        // 4. Межспутниковые лазерные линии связи (ISL)
        this.drawISLEdges(ctx);

        // 5. Активный маршрут передачи данных с неоновым лазерным свечением
        this.drawActiveRoute(ctx);

        // 6. Спутники орбитальной группировки с 3D сортировкой глубины
        this.drawSatellites(ctx);
    }

    drawPolarRadarBase(ctx, cx, cy) {
        const baseR = Math.max(1, Math.min(cx, cy) * 0.90);
        const maxR = baseR * this.polarZoom;
        const centerX = cx + this.polarPanX;
        const centerY = cy + this.polarPanY;

        ctx.save();
        // Внешний круговой радар Арктики (глубокий океанический синий)
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxR, 0, Math.PI * 2);
        ctx.fillStyle = '#06132b'; // Океан Арктики
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
        ctx.lineWidth = 2 * this.dpr;
        ctx.stroke();

        // Концентрические кольца широт (80°, 70°, 60°, 50°, 40°, 30°)
        const lats = [80, 70, 60, 50, 40, 30];
        ctx.font = `${9 * this.dpr}px var(--font-mono)`;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';

        for (const lat of lats) {
            const r = Math.max(0.5, maxR * ((90 - lat) / (90 - 20)));
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            if (lat === 70) {
                ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
                ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
            } else {
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
                ctx.setLineDash([]);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillText(`${lat}°N`, centerX + 6 * this.dpr, centerY - r + 12 * this.dpr);
        }

        // Радиальные лучи долгот
        for (let angle = 0; angle < 360; angle += 45) {
            const rad = (angle * Math.PI) / 180;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + maxR * Math.cos(rad), centerY + maxR * Math.sin(rad));
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
            ctx.stroke();
        }

        // Метка центра (Северный полюс)
        ctx.beginPath();
        ctx.arc(centerX, centerY, 3.5 * this.dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#a9d8ff';
        ctx.fill();
        ctx.fillText('СЕВЕРНЫЙ ПОЛЮС 90°N', centerX + 8 * this.dpr, centerY + 3 * this.dpr);

        ctx.restore();
    }

    drawGlobeBase(ctx, cx, cy) {
        if (this.earth.draw(ctx,this.canvas.width,this.canvas.height,Math.min(cx,cy)*.82*this.globeZoom,this.globeCenterLat,this.globeCenterLon)) return;
        const radius = Math.max(1, Math.min(cx, cy) * 0.82 * this.globeZoom);

        ctx.save();
        // 1. Внешний мягкий ореол атмосферного свечения
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#040916';
        ctx.shadowColor = 'rgba(0, 242, 254, 0.5)';
        ctx.shadowBlur = 24 * this.dpr;
        ctx.fill();
        ctx.shadowBlur = 0;

        // 2. Тело земного шара с объемным сферическим океаническим градиентом
        const grad = ctx.createRadialGradient(
            cx - radius * 0.35, cy - radius * 0.35, radius * 0.05, 
            cx, cy, radius
        );
        grad.addColorStop(0, '#0a2552');
        grad.addColorStop(0.65, '#061533');
        grad.addColorStop(1, '#020919');

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // 3. 3D сетка широт и долгот на видимой полусфере планеты
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, radius - 0.5), 0, Math.PI * 2);
        ctx.clip();

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.lineWidth = 1 * this.dpr;

        // Параллели широт (-60, -30, 0, 30, 60, 75)
        for (const lat of [-60, -30, 0, 30, 60, 75]) {
            ctx.beginPath();
            let first = true;
            for (let lon = -180; lon <= 180; lon += 4) {
                const pt = this.geoToCanvas(lat, lon, 0);
                if (pt.visible && !pt.isClamped) {
                    if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                    else { ctx.lineTo(pt.x, pt.y); }
                } else {
                    first = true;
                }
            }
            ctx.stroke();
        }

        // Меридианы долгот (-180..180 с шагом 30°)
        for (let lon = -180; lon < 180; lon += 30) {
            ctx.beginPath();
            let first = true;
            for (let lat = -85; lat <= 85; lat += 4) {
                const pt = this.geoToCanvas(lat, lon, 0);
                if (pt.visible && !pt.isClamped) {
                    if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                    else { ctx.lineTo(pt.x, pt.y); }
                } else {
                    first = true;
                }
            }
            ctx.stroke();
        }

        ctx.restore();

        // 4. Тонкая светящаяся линия горизонта планеты (Limb)
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
        ctx.lineWidth = 1.8 * this.dpr;
        ctx.stroke();

        ctx.restore();
    }

    drawFlatGrid(ctx, w, h) {
        const cx = w / 2;
        const cy = h / 2;
        let baseMapH = h * 0.88;
        let baseMapW = baseMapH * 2.0;
        if (baseMapW > w * 0.94) {
            baseMapW = w * 0.94;
            baseMapH = baseMapW / 2.0;
        }
        const effMapW = baseMapW * this.flatZoom;
        const effMapH = baseMapH * this.flatZoom;
        const mapCenterX = cx + this.flatPanX;
        const mapCenterY = cy + this.flatPanY;
        const offsetX = mapCenterX - effMapW / 2;
        const offsetY = mapCenterY - effMapH / 2;

        // Океан плоской карты (глубокий океанический синий)
        ctx.fillStyle = '#06132b';
        ctx.fillRect(offsetX, offsetY, effMapW, effMapH);
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
        ctx.lineWidth = 1.5 * this.dpr;
        ctx.strokeRect(offsetX, offsetY, effMapW, effMapH);

        // Меридианы и параллели
        ctx.save();
        ctx.beginPath();
        ctx.rect(offsetX, offsetY, effMapW, effMapH);
        ctx.clip();

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.lineWidth = 1 * this.dpr;
        ctx.font = `${9 * this.dpr}px var(--font-mono)`;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';

        for (let lon = -180; lon <= 180; lon += 30) {
            const x = offsetX + ((lon + 180) / 360) * effMapW;
            ctx.beginPath();
            ctx.moveTo(x, offsetY);
            ctx.lineTo(x, offsetY + effMapH);
            ctx.stroke();
            if (lon % 60 === 0) {
                ctx.fillText(`${lon}°`, x + 4, offsetY + effMapH - 6);
            }
        }

        const lats = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
        for (const lat of lats) {
            const y = offsetY + effMapH - ((lat + 85) / 170) * effMapH;
            ctx.beginPath();
            ctx.moveTo(offsetX, y);
            ctx.lineTo(offsetX + effMapW, y);
            ctx.stroke();
            if (lat % 30 === 0) {
                ctx.fillText(`${lat}°`, offsetX + 6, y - 4);
            }
        }
        ctx.restore();
    }

    drawCoastlines(ctx) {
        ctx.save();
        // ВЫСОКОКОНТРАСТНЫЙ ЦВЕТ ЗЕМЛИ / СУШИ: тактический темно-зеленый (малахит/хвоя)
        // В отличие от синего океана (#06132b), суша мгновенно читается и выделяется на ВСЕХ трех картах!
        ctx.fillStyle = '#163b36';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 1.3 * this.dpr;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        if (this.viewMode === 'polar') {
            const centerX = cx + this.polarPanX;
            const centerY = cy + this.polarPanY;
            const baseR = Math.max(1, Math.min(cx, cy) * 0.90);
            const maxR = Math.max(1, baseR * this.polarZoom - 0.5);
            ctx.beginPath();
            ctx.arc(centerX, centerY, maxR, 0, Math.PI * 2);
            ctx.clip();
            this.drawCoastlinesPolar(ctx, cx, cy, maxR);
        } else if (this.viewMode === 'globe') {
            const radius = Math.max(1, Math.min(cx, cy) * 0.82 * this.globeZoom - 0.5);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.clip();
            this.drawCoastlinesGlobe(ctx, cx, cy, radius);
        } else if (this.viewMode === 'flat') {
            let baseMapH = h * 0.88;
            let baseMapW = baseMapH * 2.0;
            if (baseMapW > w * 0.94) {
                baseMapW = w * 0.94;
                baseMapH = baseMapW / 2.0;
            }
            const effMapW = baseMapW * this.flatZoom;
            const effMapH = baseMapH * this.flatZoom;
            const mapCenterX = cx + this.flatPanX;
            const mapCenterY = cy + this.flatPanY;
            const offsetX = mapCenterX - effMapW / 2;
            const offsetY = mapCenterY - effMapH / 2;

            ctx.beginPath();
            ctx.rect(offsetX, offsetY, effMapW, effMapH);
            ctx.clip();
            this.drawCoastlinesFlat(ctx, offsetX, offsetY, effMapW, effMapH);
        }
        ctx.restore();
    }

    drawCoastlinesPolar(ctx, cx, cy, maxR) {
        const centerX = cx + this.polarPanX;
        const centerY = cy + this.polarPanY;
        const minLat = 20;

        for (const poly of WORLD_COASTLINES) {
            let hasNorth = false;
            for (let i = 0; i < poly.length; i++) {
                if (poly[i][1] >= minLat) { hasNorth = true; break; }
            }
            if (!hasNorth) continue;

            // 1. Sutherland-Hodgman отсечение по широте lat >= minLat (20°N)
            const clipped = [];
            const n = poly.length;
            for (let i = 0; i < n; i++) {
                const cur = poly[i];
                const next = poly[(i + 1) % n];
                const curIn = cur[1] >= minLat;
                const nextIn = next[1] >= minLat;

                if (curIn && nextIn) {
                    clipped.push([next[0], next[1]]);
                } else if (curIn && !nextIn) {
                    const t = (minLat - cur[1]) / (next[1] - cur[1]);
                    const lonExit = cur[0] + t * (next[0] - cur[0]);
                    clipped.push([lonExit, minLat, 'exit']);
                } else if (!curIn && nextIn) {
                    const t = (minLat - cur[1]) / (next[1] - cur[1]);
                    const lonEnter = cur[0] + t * (next[0] - cur[0]);
                    clipped.push([lonEnter, minLat, 'enter']);
                    clipped.push([next[0], next[1]]);
                }
            }

            if (clipped.length < 3) continue;

            // 2. Интерполяция дуги вдоль границы 20°N между точкой выхода и входа
            const expanded = [];
            for (let i = 0; i < clipped.length; i++) {
                const cur = clipped[i];
                expanded.push([cur[0], cur[1]]);
                if (cur[2] === 'exit') {
                    const next = clipped[(i + 1) % clipped.length];
                    if (next && next[2] === 'enter') {
                        const lonExit = cur[0];
                        const lonEnter = next[0];
                        let dLon = lonEnter - lonExit;
                        while (dLon > 180) dLon -= 360;
                        while (dLon < -180) dLon += 360;
                        const steps = Math.min(12, Math.max(1, Math.ceil(Math.abs(dLon) / 10)));
                        for (let s = 1; s < steps; s++) {
                            expanded.push([lonExit + (dLon * s) / steps, minLat]);
                        }
                    }
                }
            }

            // 3. Отрисовка непрерывного замкнутого полигона
            ctx.beginPath();
            for (let i = 0; i < expanded.length; i++) {
                const lon = expanded[i][0];
                const lat = expanded[i][1];
                const r = maxR * ((90 - lat) / (90 - minLat));
                const angleRad = ((lon - 60) * Math.PI) / 180;
                const x = centerX + r * Math.sin(angleRad);
                const y = centerY + r * Math.cos(angleRad);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    drawCoastlinesGlobe(ctx, cx, cy, radius) {
        const centerLatRad = (this.globeCenterLat * Math.PI) / 180;
        const centerLonRad = (this.globeCenterLon * Math.PI) / 180;
        const cosCLat = Math.cos(centerLatRad);
        const sinCLat = Math.sin(centerLatRad);

        const toVec = (pLon, pLat) => {
            const latR = (pLat * Math.PI) / 180;
            const lonR = (pLon * Math.PI) / 180;
            const dLon = lonR - centerLonRad;
            const cosLat = Math.cos(latR);
            const sinLat = Math.sin(latR);
            const cosDLon = Math.cos(dLon);
            const sinDLon = Math.sin(dLon);
            return {
                x: cosLat * sinDLon,
                y: sinLat * cosCLat - cosLat * sinCLat * cosDLon,
                z: sinLat * sinCLat + cosLat * cosCLat * cosDLon
            };
        };

        for (const poly of WORLD_COASTLINES) {
            // 1. Sutherland-Hodgman отсечение по видимой полусфере Z >= 0
            const clipped = [];
            const n = poly.length;
            for (let i = 0; i < n; i++) {
                const cur = toVec(poly[i][0], poly[i][1]);
                const next = toVec(poly[(i + 1) % n][0], poly[(i + 1) % n][1]);
                const curIn = cur.z >= 0;
                const nextIn = next.z >= 0;

                if (curIn && nextIn) {
                    clipped.push(next);
                } else if (curIn && !nextIn) {
                    const t = cur.z / (cur.z - next.z);
                    let ix = cur.x + t * (next.x - cur.x);
                    let iy = cur.y + t * (next.y - cur.y);
                    const len = Math.hypot(ix, iy) || 1;
                    clipped.push({ x: ix / len, y: iy / len, z: 0, isExit: true });
                } else if (!curIn && nextIn) {
                    const t = cur.z / (cur.z - next.z);
                    let ix = cur.x + t * (next.x - cur.x);
                    let iy = cur.y + t * (next.y - cur.y);
                    const len = Math.hypot(ix, iy) || 1;
                    clipped.push({ x: ix / len, y: iy / len, z: 0, isEnter: true });
                    clipped.push(next);
                }
            }

            if (clipped.length < 3) continue;

            // 2. Интерполяция дуги вдоль лимба горизонта между выходом и входом
            const expanded = [];
            for (let i = 0; i < clipped.length; i++) {
                const cur = clipped[i];
                expanded.push(cur);
                if (cur.isExit) {
                    const next = clipped[(i + 1) % clipped.length];
                    if (next && next.isEnter) {
                        const a1 = Math.atan2(cur.y, cur.x);
                        let a2 = Math.atan2(next.y, next.x);
                        let diff = a2 - a1;
                        while (diff > Math.PI) diff -= 2 * Math.PI;
                        while (diff < -Math.PI) diff += 2 * Math.PI;
                        const steps = Math.min(10, Math.max(1, Math.ceil(Math.abs(diff) / (Math.PI / 10))));
                        for (let s = 1; s < steps; s++) {
                            const a = a1 + (diff * s) / steps;
                            expanded.push({ x: Math.cos(a), y: Math.sin(a), z: 0 });
                        }
                    }
                }
            }

            // 3. Отрисовка непрерывного полигона на видимой сфере
            ctx.beginPath();
            for (let i = 0; i < expanded.length; i++) {
                const pt = expanded[i];
                const x = cx + pt.x * radius;
                const y = cy - pt.y * radius;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    drawCoastlinesFlat(ctx, offsetX, offsetY, effMapW, effMapH) {
        for (const poly of WORLD_COASTLINES) {
            ctx.beginPath();
            const n = poly.length;
            for (let i = 0; i < n; i++) {
                const lon = poly[i][0];
                const lat = poly[i][1];
                const x = offsetX + ((lon + 180) / 360) * effMapW;
                const y = offsetY + effMapH - ((lat + 85) / 170) * effMapH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    drawGroundSites(ctx) {
        const sites = [
            { id: 'G_MUR', label: '📡 Шлюз «Мурманск»', lat: 68.97, lon: 33.07, isGateway: true },
            { id: 'C65', label: '🏭 Терминал 65 (Урал)', lat: 65.0, lon: 60.0, isGateway: false },
            { id: 'C70', label: '⚓ Терминал 70 (Диксон)', lat: 70.0, lon: 90.0, isGateway: false },
            { id: 'C72', label: '🔬 Терминал 72 (Тикси)', lat: 72.0, lon: 130.0, isGateway: false }
        ];

        const altKm = this.scenario?.environment?.altitude_km || 600.0;
        const minEl = this.scenario?.environment?.min_elevation_deg || 10.0;
        const radiusDeg = computeCoverageRadiusDeg(altKm, minEl);

        for (const s of sites) {
            const pt = this.geoToCanvas(s.lat, s.lon, 0);
            if (!pt.visible || (this.viewMode === 'globe' && pt.isClamped)) continue;

            const isSel = (s.id === this.selectedClient);

            // ТОЧНЫЙ ФИЗИЧЕСКИЙ КУПОЛ РАДИОВИДИМОСТИ (угол места >= 10°)
            const domePolygon = getVisibilityDomePolygon(s.lat, s.lon, radiusDeg, 48);
            ctx.beginPath();
            let first = true;
            let visibleCount = 0;
            for (const dp of domePolygon) {
                const p = this.geoToCanvas(dp.lat, dp.lon, 0);
                if (!p.visible || (this.viewMode === 'globe' && p.isClamped)) {
                    first = true;
                    continue;
                }
                visibleCount++;
                if (first) {
                    ctx.moveTo(p.x, p.y);
                    first = false;
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }

            if (visibleCount > 4) {
                ctx.closePath();
                ctx.fillStyle = s.isGateway ? 'rgba(251, 191, 36, 0.08)' : (isSel ? 'rgba(0, 242, 254, 0.12)' : 'rgba(56, 189, 248, 0.05)');
                ctx.fill();
                ctx.strokeStyle = s.isGateway ? 'rgba(251, 191, 36, 0.50)' : (isSel ? 'rgba(0, 242, 254, 0.65)' : 'rgba(56, 189, 248, 0.25)');
                ctx.lineWidth = (isSel ? 1.5 : 1.1) * this.dpr;
                ctx.setLineDash([3 * this.dpr, 3 * this.dpr]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Маркер пункта связи
            ctx.beginPath();
            if (s.isGateway) {
                // Золотой ромб телепорта Мурманска
                const sz = 9 * this.dpr;
                ctx.moveTo(pt.x, pt.y - sz);
                ctx.lineTo(pt.x + sz, pt.y);
                ctx.lineTo(pt.x, pt.y + sz);
                ctx.lineTo(pt.x - sz, pt.y);
                ctx.closePath();
                ctx.fillStyle = '#e3be83';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5 * this.dpr;
                ctx.stroke();
            } else {
                // Пульсирующий круг терминала
                const pulseRadius = (isSel ? (7 + Math.sin(this.pulsePhase) * 1.5) : 5) * this.dpr;
                ctx.arc(pt.x, pt.y, pulseRadius, 0, Math.PI * 2);
                ctx.fillStyle = isSel ? '#a9d8ff' : '#38bdf8';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5 * this.dpr;
                ctx.stroke();
            }

            // Текстовая подпись
            ctx.font = `${(isSel ? 11 : 10) * this.dpr}px Segoe UI`;
            ctx.fillStyle = s.isGateway ? '#e3be83' : (isSel ? '#a9d8ff' : '#e2e8f0');
            if (isSel || s.isGateway || this.hoveredSite?.id === s.id) {const label=s.isGateway?'Мурманск':s.id==='C65'?'Урал-Север':s.id==='C70'?'Диксон':'Тикси'; const tw=ctx.measureText(label).width;ctx.fillText(label,Math.min(this.canvas.width-tw-6*this.dpr,pt.x+12*this.dpr),pt.y+4*this.dpr);}
        }
    }

    drawOrbitTracks(ctx) {
        if (!this.scenario || this.viewMode !== 'globe') return;
        const sc=this.scenario, colors=['#a9d8ff60','#e3be8360','#aaa6e860'];
        ctx.save();ctx.lineWidth=.8*this.dpr;
        sc.design.planes.forEach((plane,index)=>{
            const design={...sc.design,satellites:Array.from({length:91},(_,i)=>({id:'track',plane_id:plane.id,slot_deg:i*4,launch_batch:1}))};
            const points=computeContinuousSatellites({...sc,design,failures:[]},this.currentTime_s);
            ctx.beginPath();let open=false;
            for(const sat of points){const p=this.geoToCanvas(sat.lat_deg,sat.lon_deg,sc.environment.altitude_km);if(!p.visible){open=false;continue;}if(open)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);open=true;}
            ctx.strokeStyle=colors[index%3];ctx.stroke();
        });ctx.restore();
    }

    drawISLEdges(ctx) {
        if (!this.currentSnapshot || !this.currentSnapshot.edges || !this.currentSnapshot.satellites) return;
        const altKm = this.scenario?.environment?.altitude_km || 600.0;
        const satMap = {};
        for (const s of this.currentSnapshot.satellites) {
            satMap[s.id] = this.geoToCanvas(s.lat_deg, s.lon_deg, altKm);
        }

        ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
        ctx.lineWidth = 1 * this.dpr;

        for (const [u, v, _] of this.currentSnapshot.edges) {
            const p1 = satMap[u];
            const p2 = satMap[v];
            if (p1 && p2 && p1.visible && p2.visible) {
                // На 3D глобусе, если обе точки сзади или одна сзади, не чертим луч через планету
                if (this.viewMode === 'globe') {
                    if (p1.z < 0 && p2.z < 0) continue;
                }
                const maxAllowed = (this.viewMode === 'flat') ? ((p1.effMapW || this.canvas.width) * 0.45) : (this.canvas.width * 2.0);
                if (Math.abs(p1.x - p2.x) < maxAllowed) {
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }
    }

    drawActiveRoute(ctx) {
        if (!this.currentRouting || !this.currentRouting[this.selectedClient]) return;
        const routeData = this.currentRouting[this.selectedClient];
        if (!routeData.available || !routeData.path || routeData.path.length < 2) return;

        // МГНОВЕННЫЙ ОБХОД: если путь содержит сломанный спутник, не рисуем его через сломанный узел!
        const failedSet = new Set(
            this.currentSnapshot.satellites.filter(s => s.failed).map(s => s.id)
        );
        if (routeData.path.some(id => failedSet.has(id))) {
            return;
        }

        const altKm = this.scenario?.environment?.altitude_km || 600.0;
        const path = routeData.path;
        const nodeMap = {
            'G_MUR': this.geoToCanvas(68.97, 33.07, 0),
            'C65': this.geoToCanvas(65.0, 60.0, 0),
            'C70': this.geoToCanvas(70.0, 90.0, 0),
            'C72': this.geoToCanvas(72.0, 130.0, 0)
        };
        for (const s of this.currentSnapshot.satellites) {
            nodeMap[s.id] = this.geoToCanvas(s.lat_deg, s.lon_deg, altKm);
        }

        // Яркий неоновый лазер с мягким свечением
        ctx.strokeStyle = '#a9d8ff';
        ctx.lineWidth = 3.5 * this.dpr;
        ctx.shadowColor = '#a9d8ff';
        ctx.shadowBlur = (12 + Math.sin(this.pulsePhase) * 4) * this.dpr;

        for (let i = 0; i < path.length - 1; i++) {
            const u = path[i];
            const v = path[i + 1];
            const p1 = nodeMap[u];
            const p2 = nodeMap[v];
            const maxAllowed = (this.viewMode === 'flat') ? ((p1?.effMapW || this.canvas.width) * 0.45) : (this.canvas.width * 2.0);
            if (p1 && p2 && p1.visible && p2.visible && Math.abs(p1.x - p2.x) < maxAllowed) {
                // На 3D глобусе не чертим луч через тело планеты
                if (this.viewMode === 'globe' && p1.z < 0 && p2.z < 0) continue;

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
        }

        ctx.shadowBlur = 0;
    }

    drawSatellites(ctx) {
        if (!this.currentSnapshot || !this.currentSnapshot.satellites) return;

        const planeColors = {
            'P1': '#a9d8ff',
            'P2': '#e3be83',
            'P3': '#aaa6e8'
        };

        const altKm = this.scenario?.environment?.altitude_km || 600.0;

        // Преобразуем спутники в координаты с глубиной Z
        const projectedSats = [];
        for (const sat of this.currentSnapshot.satellites) {
            const pt = this.geoToCanvas(sat.lat_deg, sat.lon_deg, altKm);
            if (!pt.visible) continue;
            projectedSats.push({
                sat,
                x: pt.x,
                y: pt.y,
                z: pt.z,
                isHovered: (this.hoveredSat && this.hoveredSat.id === sat.id)
            });
        }

        // Честная 3D сортировка по глубине (Z-order: от дальних к ближним)
        // Исключает наслоения спутников друг на друга!
        projectedSats.sort((a, b) => {
            if (a.isHovered) return 1;
            if (b.isHovered) return -1;
            return a.z - b.z;
        });

        for (const item of projectedSats) {
            const { sat, x, y, isHovered, z } = item;

            ctx.save();
            ctx.translate(x, y);

            // На 3D глобусе спутники, выглядывающие сбоку планеты на задней стороне, рисуются мягче
            const isBehind = (this.viewMode === 'globe' && z < 0);
            if (isBehind) {
                ctx.globalAlpha = 0.55;
            }

            if (sat.failed) {
                // Красный крестик аварии
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 2.5 * this.dpr;
                const r = 6 * this.dpr;
                ctx.beginPath();
                ctx.moveTo(-r, -r); ctx.lineTo(r, r);
                ctx.moveTo(r, -r); ctx.lineTo(-r, r);
                ctx.stroke();
            } else if (!sat.active) {
                // Не запущен (очередь еще не выведена)
                ctx.fillStyle = '#475569';
                ctx.beginPath();
                ctx.arc(0, 0, 3 * this.dpr, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Активный аппарат
                const color = planeColors[sat.plane_id] || '#a9d8ff';
                ctx.fillStyle = color;
                if (isHovered) {
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 12 * this.dpr;
                }
                ctx.beginPath();
                ctx.arc(0, 0, (isHovered ? 6.5 : 4.5) * this.dpr, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1 * this.dpr;
                ctx.stroke();
            }

            if (isHovered || this.viewMode === 'polar') {
                ctx.font = `${8.5 * this.dpr}px var(--font-mono)`;
                ctx.fillStyle = sat.failed ? '#ef4444' : '#cbd5e1';
                ctx.fillText(sat.id, 6 * this.dpr, 3 * this.dpr);
            }

            ctx.restore();
        }
    }
}
