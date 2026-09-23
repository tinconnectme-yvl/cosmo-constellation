from __future__ import annotations
import copy
import json
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response

from app.core.geometry import load_scenario, snapshot
from app.core.validator import validate_scenario_detailed
from app.core.routing import solve_step_routing
from app.core.metrics import simulate_full_scenario
from app.core.exporter import build_result_payload
from app.models.schemas import SimulationRequest, CompareRequest

app = FastAPI(
    title="KosmoHack 2026 - Спутниковая группировка",
    description="API веб-сервиса проектирования и оценки устойчивости орбитальной группировки",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).resolve().parent / "data"
STATIC_DIR = Path(__file__).resolve().parent / "static"

# Кэш предзагруженных сценариев
PRESET_SCENARIOS: Dict[str, dict] = {}
LAST_SIMULATION_CACHE: Dict[str, Any] = {}


def init_presets():
    if DATA_DIR.exists():
        for f in sorted(DATA_DIR.glob("*.json")):
            try:
                sc = load_scenario(f)
                sc_id = sc.get("meta", {}).get("id", f.stem)
                PRESET_SCENARIOS[sc_id] = sc
            except Exception as e:
                print(f"Error loading {f.name}: {e}")


init_presets()


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy", 
        "presets_loaded": list(PRESET_SCENARIOS.keys())
    }


@app.get("/api/scenarios")
def list_scenarios():
    """Список доступных сценариев."""
    result = []
    for sid, sc in PRESET_SCENARIOS.items():
        meta = sc.get("meta", {})
        env = sc.get("environment", {})
        design = sc.get("design", {})
        ground = sc.get("ground_sites", [])
        failures = sc.get("failures", [])
        gw_outages = sc.get("gateway_outages", [])
        result.append({
            "id": sid,
            "title": meta.get("title", sid),
            "altitude_km": env.get("altitude_km"),
            "inclination_deg": env.get("inclination_deg"),
            "isl_range_km": env.get("isl_range_km"),
            "launch_stage": design.get("launch_stage"),
            "planes_count": len(design.get("planes", [])),
            "satellites_count": len(design.get("satellites", [])),
            "clients_count": sum(1 for g in ground if g.get("role") == "client"),
            "gateways_count": sum(1 for g in ground if g.get("role") == "gateway"),
            "failures_count": len(failures) + len(gw_outages)
        })
    return result


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    """Получение полного содержимого сценария."""
    if scenario_id not in PRESET_SCENARIOS:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return PRESET_SCENARIOS[scenario_id]


@app.post("/api/scenarios/upload")
async def upload_scenario(file: UploadFile = File(...)):
    """Загрузка пользовательского сценария в формате JSON с детальной валидацией."""
    try:
        content = await file.read()
        data = json.loads(content.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file format: {str(e)}")
        
    is_valid, errors = validate_scenario_detailed(data)
    if not is_valid:
        return JSONResponse(
            status_code=422,
            content={
                "error": "Validation failed",
                "details": errors
            }
        )
        
    sc_id = data.get("meta", {}).get("id", f"uploaded_{len(PRESET_SCENARIOS)+1}")
    PRESET_SCENARIOS[sc_id] = data
    return {
        "status": "success",
        "scenario_id": sc_id,
        "title": data.get("meta", {}).get("title", sc_id),
        "message": "Сценарий успешно загружен и прошел валидацию"
    }


@app.post("/api/simulate")
def run_simulation(req: SimulationRequest):
    """
    Выполнение полного суточного моделирования группировки с расчетом метрик и маршрутов.
    """
    # 1. Получаем базовый сценарий
    if req.scenario:
        sc = copy.deepcopy(req.scenario)
    elif req.scenario_id:
        if req.scenario_id not in PRESET_SCENARIOS:
            raise HTTPException(status_code=404, detail=f"Scenario '{req.scenario_id}' not found")
        sc = copy.deepcopy(PRESET_SCENARIOS[req.scenario_id])
    else:
        # По умолчанию берем 01_full_constellation
        default_id = "01_full_constellation"
        if default_id in PRESET_SCENARIOS:
            sc = copy.deepcopy(PRESET_SCENARIOS[default_id])
        else:
            raise HTTPException(status_code=400, detail="No scenario provided")

    # 2. Применяем модификаторы интерфейса (если переданы)
    if req.launch_stage is not None:
        sc['design']['launch_stage'] = req.launch_stage
        
    if req.modified_planes:
        pmap = {p.id: p for p in req.modified_planes}
        for pl in sc['design']['planes']:
            if pl['id'] in pmap:
                pl['raan_deg'] = pmap[pl['id']].raan_deg
                pl['phase_deg'] = pmap[pl['id']].phase_deg
                
    if req.additional_failures:
        sc.setdefault('failures', [])
        for f in req.additional_failures:
            sc['failures'].append({
                'satellite_id': f.satellite_id,
                'start_s': f.start_s,
                'end_s': f.end_s
            })

    # 3. Валидация эффективного сценария
    is_valid, errors = validate_scenario_detailed(sc)
    if not is_valid:
        return JSONResponse(status_code=422, content={"error": "Effective scenario invalid", "details": errors})

    # 4. Моделирование
    res = simulate_full_scenario(sc, strategy=req.routing_strategy)
    
    # Сохраняем в кэш последней симуляции для быстрого интерактивного таймлайна
    cache_key = "current"
    LAST_SIMULATION_CACHE[cache_key] = {
        'scenario': sc,
        'strategy': req.routing_strategy,
        'result': res
    }
    
    return {
        'summary_metrics': res['summary_metrics'],
        'timeline_steps': res['timeline_steps'],
        'effective_scenario': sc
    }


@app.get("/api/snapshot/{t_s}")
def get_snapshot_at_time(
    t_s: float, 
    strategy: str = Query("min_hops", enum=["min_hops", "min_distance"])
):
    """
    Моментальный снимок координат спутников, ребер графа и маршрутов в заданный момент t_s.
    """
    cached = LAST_SIMULATION_CACHE.get("current")
    if not cached:
        # Если симуляция еще не запускалась, берем дефолтный сценарий
        default_id = "01_full_constellation"
        if default_id in PRESET_SCENARIOS:
            sc = PRESET_SCENARIOS[default_id]
        else:
            raise HTTPException(status_code=400, detail="Run simulation first")
    else:
        sc = cached['scenario']
        
    res = solve_step_routing(sc, t_s, strategy=strategy)
    return res


@app.post("/api/compare")
def compare_scenarios(req: CompareRequest):
    """
    Сравнение двух вариантов конфигурации side-by-side с расчетом разницы метрик.
    """
    is_valid_a, errors_a = validate_scenario_detailed(req.scenario_a)
    is_valid_b, errors_b = validate_scenario_detailed(req.scenario_b)
    
    if not is_valid_a or not is_valid_b:
        return JSONResponse(
            status_code=422, 
            content={
                "error": "One or both scenarios failed validation",
                "errors_a": errors_a,
                "errors_b": errors_b
            }
        )
        
    res_a = simulate_full_scenario(req.scenario_a, strategy=req.strategy)
    res_b = simulate_full_scenario(req.scenario_b, strategy=req.strategy)
    
    metrics_a = res_a['summary_metrics']
    metrics_b = res_b['summary_metrics']
    
    comparison = {}
    all_clients = sorted(set(metrics_a.keys()) | set(metrics_b.keys()))
    
    for cid in all_clients:
        ma = metrics_a.get(cid, {})
        mb = metrics_b.get(cid, {})
        
        avail_a = ma.get('availability_percent', 0.0)
        avail_b = mb.get('availability_percent', 0.0)
        outage_a = ma.get('max_outage_min', 0.0)
        outage_b = mb.get('max_outage_min', 0.0)
        
        comparison[cid] = {
            'client_id': cid,
            'scenario_a': ma,
            'scenario_b': mb,
            'diff': {
                'availability_percent': round(avail_b - avail_a, 2),
                'max_outage_min': round(outage_b - outage_a, 1),
                'target_met_a': ma.get('target_met', False),
                'target_met_b': mb.get('target_met', False)
            }
        }
        
    return {
        'comparison': comparison,
        'title_a': req.scenario_a.get('meta', {}).get('title', 'Scenario A'),
        'title_b': req.scenario_b.get('meta', {}).get('title', 'Scenario B')
    }


@app.post("/api/export")
def export_result_file():
    """
    Выгрузка стандартного JSON-результата cosmo-A-result-1.0 для экспертов.
    """
    cached = LAST_SIMULATION_CACHE.get("current")
    if not cached:
        raise HTTPException(status_code=400, detail="No calculated simulation available. Run /api/simulate first.")
        
    payload = build_result_payload(cached['result'])
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=cosmo_result.json"}
    )


# Подключение раздачи статики веб-интерфейса, если она существует
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
