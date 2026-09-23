from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert len(data["presets_loaded"]) >= 4


def test_scenarios_list():
    res = client.get("/api/scenarios")
    assert res.status_code == 200
    scenarios = res.json()
    assert len(scenarios) >= 4
    ids = [s["id"] for s in scenarios]
    assert "01_full_constellation" in ids


def test_simulate_default():
    res = client.post("/api/simulate", json={"scenario_id": "01_full_constellation"})
    assert res.status_code == 200
    data = res.json()
    assert "summary_metrics" in data
    assert "timeline_steps" in data
    assert "C65" in data["summary_metrics"]


def test_snapshot():
    # Сначала сделаем simulate, чтобы закэшировать
    client.post("/api/simulate", json={"scenario_id": "01_full_constellation"})
    res = client.get("/api/snapshot/0")
    assert res.status_code == 200
    snap = res.json()
    assert "clients_routing" in snap
    assert "snapshot" in snap


def test_export():
    client.post("/api/simulate", json={"scenario_id": "01_full_constellation"})
    res = client.post("/api/export")
    assert res.status_code == 200
    data = res.json()
    assert data["schema_version"] == "cosmo-A-result-1.0"
    assert "routes" in data
