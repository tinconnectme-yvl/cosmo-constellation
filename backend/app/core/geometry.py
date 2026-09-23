from __future__ import annotations
import json
import math
from pathlib import Path
import numpy as np

# Физические константы задачи
R = 6371.0  # Радиус Земли, км
MU = 398600.435507  # Гравитационный параметр Земли, км^3/с^2
OMEGA = 2.0 * math.pi / 86164.09054  # Угловая скорость вращения Земли, рад/с


def load_scenario(path: str | Path) -> dict:
    """Загрузка и валидация сценария из JSON файла."""
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    validate_scenario(data)
    return data


def finite(x) -> bool:
    return isinstance(x, (int, float)) and (not isinstance(x, bool)) and math.isfinite(x)


def validate_scenario(s: dict) -> None:
    """Строгая валидация структуры сценария по ТЗ (схема cosmo-A-1.0)."""
    if s.get('schema_version') != 'cosmo-A-1.0':
        raise ValueError("Unsupported scenario schema. Expected 'cosmo-A-1.0'")
    
    if 'environment' not in s or 'design' not in s or 'ground_sites' not in s:
        raise ValueError("Scenario missing required sections: environment, design, ground_sites")
        
    e, d = s['environment'], s['design']
    for key in ('altitude_km', 'inclination_deg', 'earth_angle0_deg', 'horizon_s', 'step_s', 'min_elevation_deg', 'isl_range_km', 'target_availability'):
        if key not in e or not finite(e[key]):
            raise ValueError(f"Non-finite or missing environment value: {key}")
            
    if not (200 <= e['altitude_km'] <= 1200 and 0 < e['inclination_deg'] <= 180):
        raise ValueError(f"Invalid orbit altitude ({e['altitude_km']} km) or inclination ({e['inclination_deg']} deg)")
        
    if not isinstance(e['step_s'], int) or not isinstance(e['horizon_s'], int):
        raise ValueError("Time grid must use integer seconds")
        
    if not (0 < e['step_s'] <= e['horizon_s'] <= 172800 and e['horizon_s'] % e['step_s'] == 0):
        raise ValueError(f"Invalid time grid: step_s={e['step_s']}, horizon_s={e['horizon_s']}")
        
    if not (0 <= e['min_elevation_deg'] < 90 and 0 < e['isl_range_km'] <= 10000 and (0 <= e['target_availability'] <= 1)):
        raise ValueError("Invalid link/target values")
        
    planes = {p['id']: p for p in d['planes']}
    if len(planes) != len(d['planes']) or not planes:
        raise ValueError("Duplicate or empty planes in design")
        
    for p in planes.values():
        if not all((k in p and finite(p[k]) and 0 <= p[k] < 360 for k in ('raan_deg', 'phase_deg'))):
            raise ValueError(f"Invalid plane angle for plane {p.get('id')}")
            
    ids = [sat['id'] for sat in d['satellites']]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Duplicate or empty satellite IDs")
        
    if not isinstance(d['launch_stage'], int) or d['launch_stage'] not in (1, 2, 3):
        raise ValueError("launch_stage must be integer 1, 2 or 3")
        
    for sat in d['satellites']:
        if sat.get('plane_id') not in planes or sat.get('launch_batch') not in (1, 2, 3) or not finite(sat.get('slot_deg')):
            raise ValueError(f"Invalid satellite definition: {sat.get('id')}")
            
    ground = s['ground_sites']
    gids = [g['id'] for g in ground]
    if len(gids) != len(set(gids)) or set(gids) & set(ids):
        raise ValueError("Non-unique ground node IDs or collision with satellite IDs")
        
    if not any((g.get('role') == 'client' for g in ground)) or not any((g.get('role') == 'gateway' for g in ground)):
        raise ValueError("Both client and gateway ground sites required")
        
    for g in ground:
        if g.get('role') not in ('client', 'gateway') or not finite(g.get('lat_deg')) or not finite(g.get('lon_deg')) or not (-90 <= g['lat_deg'] <= 90 and -180 <= g['lon_deg'] <= 180):
            raise ValueError(f"Invalid ground site coordinates or role: {g.get('id')}")
            
    failures = s.get('failures', [])
    for f in failures:
        if f.get('satellite_id') not in set(ids) or not all((k in f and finite(f[k]) for k in ('start_s', 'end_s'))) or not (0 <= f['start_s'] < f['end_s'] <= e['horizon_s']):
            raise ValueError(f"Invalid satellite outage: {f}")
            
    gw_outages = s.get('gateway_outages', [])
    valid_gw = {g['id'] for g in ground if g['role'] == 'gateway'}
    for f in gw_outages:
        if f.get('gateway_id') not in valid_gw or not all((k in f and finite(f[k]) for k in ('start_s', 'end_s'))) or not (0 <= f['start_s'] < f['end_s'] <= e['horizon_s']):
            raise ValueError(f"Invalid gateway outage: {f}")


def positions(s: dict, t_s: float) -> tuple[list[str], np.ndarray, np.ndarray]:
    """
    Возвращает:
    - список идентификаторов спутников
    - декартовы координаты в инерциальной системе ECI [км]
    - декартовы координаты во вращающейся системе ECEF [км]
    """
    e, d = s['environment'], s['design']
    pmap = {p['id']: p for p in d['planes']}
    r = R + e['altitude_km']
    n = math.sqrt(MU / (r ** 3))
    inc = math.radians(e['inclination_deg'])
    
    # Истинная аномалия / положение на орбите
    u = np.array([math.radians(x['slot_deg'] + pmap[x['plane_id']]['phase_deg']) + n * t_s for x in d['satellites']])
    om = np.array([math.radians(pmap[x['plane_id']]['raan_deg']) for x in d['satellites']])
    
    cu, su = np.cos(u), np.sin(u)
    co, so = np.cos(om), np.sin(om)
    
    xyz = r * np.stack((
        co * cu - so * su * math.cos(inc),
        so * cu + co * su * math.cos(inc),
        su * math.sin(inc)
    ), axis=1)
    
    # Поворот Земли (переход в ECEF)
    th = math.radians(e['earth_angle0_deg']) + OMEGA * t_s
    c, ss = math.cos(th), math.sin(th)
    rot = np.array([[c, -ss, 0.0], [ss, c, 0.0], [0.0, 0.0, 1.0]])
    fixed = xyz @ rot
    
    return [x['id'] for x in d['satellites']], xyz, fixed


def ground_position(g: dict) -> np.ndarray:
    """Декартовы координаты наземного пункта на сфере Земли."""
    lat, lon = math.radians(g['lat_deg']), math.radians(g['lon_deg'])
    return R * np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])


def ecef_to_geo(xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Перевод координат ECEF (x, y, z) в широту и долготу (в градусах).
    Идеально для плоской/сферической карты.
    """
    x = xyz[:, 0]
    y = xyz[:, 1]
    z = xyz[:, 2]
    r = np.linalg.norm(xyz, axis=1)
    lat_rad = np.arcsin(np.clip(z / r, -1.0, 1.0))
    lon_rad = np.arctan2(y, x)
    return np.degrees(lat_rad), np.degrees(lon_rad)


def snapshot(s: dict, t_s: float) -> dict:
    """
    Возвращает состояние сети в момент времени t_s:
    - satellites: координаты xyz, гео-координаты (lat, lon), статус активности, plane_id, launch_batch
    - edges: контакты [u, v, distance_km]
    - elevation_deg: углы возвышения спутников над наземными станциями
    """
    e, d = s['environment'], s['design']
    ids, inertial, xyz = positions(s, t_s)
    
    failed = {f['satellite_id'] for f in s.get('failures', []) if f['start_s'] <= t_s < f['end_s']}
    active = np.array([
        sat['launch_batch'] <= d['launch_stage'] and sat['id'] not in failed 
        for sat in d['satellites']
    ], dtype=bool)
    
    # Межспутниковые связи (ISL)
    n_sats = len(ids)
    i, j = np.triu_indices(n_sats, 1)
    delta = xyz[j] - xyz[i]
    dist = np.linalg.norm(delta, axis=1)
    denom = np.sum(delta * delta, axis=1)
    lam = np.clip(-np.sum(xyz[i] * delta, axis=1) / np.maximum(denom, 1e-12), 0.0, 1.0)
    closest = np.linalg.norm(xyz[i] + lam[:, None] * delta, axis=1)
    
    # Условие связи: расстояние < isl_range_km, луч выше поверхности Земли (closest > R) и оба активны
    isl_ok = (dist < e['isl_range_km']) & (closest > R) & active[i] & active[j]
    edges = [[ids[a], ids[b], float(dd)] for a, b, dd in zip(i[isl_ok], j[isl_ok], dist[isl_ok])]
    
    # Наземные связи
    elevations = {}
    gw_outages = s.get('gateway_outages', [])
    for g in s['ground_sites']:
        gp = ground_position(g)
        dif = xyz - gp
        dl = np.linalg.norm(dif, axis=1)
        el = np.degrees(np.arcsin(np.clip(dif @ (gp / R) / dl, -1.0, 1.0)))
        elevations[g['id']] = {sid: float(el[k]) for k, sid in enumerate(ids) if active[k]}
        
        offline = any(
            f['gateway_id'] == g['id'] and f['start_s'] <= t_s < f['end_s'] 
            for f in gw_outages
        )
        vis = (el >= e['min_elevation_deg']) & active & (not offline)
        edges.extend([[g['id'], ids[k], float(dl[k])] for k in np.where(vis)[0]])
        
    lats, lons = ecef_to_geo(xyz)
    satellites_info = []
    sat_lookup = {sat['id']: sat for sat in d['satellites']}
    for k, sid in enumerate(ids):
        sat_cfg = sat_lookup[sid]
        satellites_info.append({
            'id': sid,
            'plane_id': sat_cfg['plane_id'],
            'launch_batch': sat_cfg['launch_batch'],
            'x_km': float(xyz[k, 0]),
            'y_km': float(xyz[k, 1]),
            'z_km': float(xyz[k, 2]),
            'lat_deg': float(lats[k]),
            'lon_deg': float(lons[k]),
            'active': bool(active[k]),
            'failed': bool(sid in failed),
            'launched': bool(sat_cfg['launch_batch'] <= d['launch_stage'])
        })
        
    return {
        't_s': t_s,
        'satellites': satellites_info,
        'edges': edges,
        'elevation_deg': elevations
    }
