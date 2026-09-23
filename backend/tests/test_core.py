import os
from pathlib import Path
import pytest

from app.core.geometry import load_scenario, snapshot, positions
from app.core.validator import validate_scenario_detailed
from app.core.routing import solve_step_routing, RoutingReason
from app.core.metrics import simulate_full_scenario
from app.core.exporter import build_result_payload

DATA_DIR = Path(__file__).resolve().parent.parent / 'app' / 'data'


def test_validation_default_scenarios():
    for f in ['01_full_constellation.json', '02_first_launch.json', '03_satellite_outages.json', '04_link_range.json']:
        p = DATA_DIR / f
        assert p.exists(), f"File {f} not found"
        sc = load_scenario(p)
        ok, errors = validate_scenario_detailed(sc)
        assert ok, f"Scenario {f} failed validation: {errors}"


def test_validator_detects_errors():
    # Невалидная схема
    bad_sc = {"schema_version": "invalid-1.0"}
    ok, errors = validate_scenario_detailed(bad_sc)
    assert not ok
    assert any("schema_version" in e for e in errors)


def test_step_routing_01():
    p = DATA_DIR / '01_full_constellation.json'
    sc = load_scenario(p)
    res = solve_step_routing(sc, 0.0)
    assert 'clients_routing' in res
    assert 'C65' in res['clients_routing']
    assert 'C70' in res['clients_routing']
    assert 'C72' in res['clients_routing']


def test_full_simulation_01_metrics():
    p = DATA_DIR / '01_full_constellation.json'
    sc = load_scenario(p)
    res = simulate_full_scenario(sc)
    metrics = res['summary_metrics']
    
    # Для полной группировки доступность должна быть высокой (> 80-90%)
    for cid in ['C65', 'C70', 'C72']:
        assert cid in metrics
        m = metrics[cid]
        assert m['total_steps'] == 720
        assert m['availability_percent'] > 0
        print(f"{cid}: avail={m['availability_percent']}%, max_outage={m['max_outage_min']} min, avg_hops={m['avg_hops']}")
        
    # Проверка экспорта
    payload = build_result_payload(res)
    assert payload['schema_version'] == 'cosmo-A-result-1.0'
    assert len(payload['routes']) == 720 * 3
