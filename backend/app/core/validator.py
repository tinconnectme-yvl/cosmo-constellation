from __future__ import annotations
import math
from typing import Any, Tuple, List


def is_finite_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and (not isinstance(x, bool)) and math.isfinite(x)


def validate_scenario_detailed(s: dict) -> Tuple[bool, List[str]]:
    """
    Детальная валидация сценария с формированием понятного списка замечаний.
    Возвращает:
        (is_valid: bool, errors: list[str])
    """
    errors: List[str] = []
    
    if not isinstance(s, dict):
        return False, ["Файл должен содержать JSON-объект верхнего уровня."]
        
    if s.get('schema_version') != 'cosmo-A-1.0':
        errors.append(f"Поле 'schema_version' должно иметь точное значение 'cosmo-A-1.0', получено: '{s.get('schema_version')}'.")
        
    # Проверка meta
    meta = s.get('meta')
    if not isinstance(meta, dict):
        errors.append("Отсутствует раздел 'meta' с полями 'id' и 'title'.")
    else:
        if not meta.get('id'):
            errors.append("В разделе 'meta' поле 'id' не должно быть пустым.")
        if not meta.get('title'):
            errors.append("В разделе 'meta' поле 'title' не должно быть пустым.")
            
    # Проверка environment
    env = s.get('environment')
    if not isinstance(env, dict):
        errors.append("Отсутствует обязательный раздел 'environment'.")
        env = {}
    else:
        num_fields = {
            'altitude_km': (200, 1200, "высота орбиты [200, 1200] км"),
            'inclination_deg': (0, 180, "наклонение (0, 180] градусов"),
            'earth_angle0_deg': (-360, 360, "начальный угол Земли"),
            'min_elevation_deg': (0, 90, "минимальный угол возвышения [0, 90) градусов"),
            'isl_range_km': (0, 10000, "дальность межспутниковой связи (0, 10000] км"),
            'target_availability': (0, 1, "целевая доступность [0, 1]")
        }
        for field, (low, high, desc) in num_fields.items():
            val = env.get(field)
            if not is_finite_number(val):
                errors.append(f"В 'environment' поле '{field}' должно быть конечным числом ({desc}).")
            else:
                if field == 'inclination_deg' and not (low < val <= high):
                    errors.append(f"В 'environment' поле '{field}'={val} вне допустимого диапазона ({low}, {high}].")
                elif field == 'isl_range_km' and not (low < val <= high):
                    errors.append(f"В 'environment' поле '{field}'={val} вне допустимого диапазона ({low}, {high}].")
                elif field == 'min_elevation_deg' and not (low <= val < high):
                    errors.append(f"В 'environment' поле '{field}'={val} вне допустимого диапазона [{low}, {high}).")
                elif field in ('altitude_km', 'target_availability') and not (low <= val <= high):
                    errors.append(f"В 'environment' поле '{field}'={val} вне допустимого диапазона [{low}, {high}].")
                    
        # Сетка времени
        step_s = env.get('step_s')
        horizon_s = env.get('horizon_s')
        if not isinstance(step_s, int) or step_s <= 0:
            errors.append("В 'environment' поле 'step_s' должно быть положительным целым числом секунд.")
        if not isinstance(horizon_s, int) or horizon_s <= 0:
            errors.append("В 'environment' поле 'horizon_s' должно быть положительным целым числом секунд.")
        if isinstance(step_s, int) and isinstance(horizon_s, int) and step_s > 0 and horizon_s > 0:
            if horizon_s > 172800:
                errors.append(f"В 'environment' горизонт расчета 'horizon_s' ({horizon_s} с) превышает лимит 172800 с (48 часов).")
            if horizon_s % step_s != 0:
                errors.append(f"В 'environment' горизонт 'horizon_s' ({horizon_s}) должен быть нацело кратен шагу 'step_s' ({step_s}).")

    # Проверка design
    design = s.get('design')
    planes_dict = {}
    sat_ids = []
    if not isinstance(design, dict):
        errors.append("Отсутствует обязательный раздел 'design'.")
    else:
        launch_stage = design.get('launch_stage')
        if not isinstance(launch_stage, int) or launch_stage not in (1, 2, 3):
            errors.append(f"В 'design' поле 'launch_stage' должно быть целым числом 1, 2 или 3 (получено: {launch_stage}).")
            
        planes = design.get('planes')
        if not isinstance(planes, list) or len(planes) == 0:
            errors.append("В 'design' список 'planes' не должен быть пустым.")
        else:
            p_ids = set()
            for p in planes:
                if not isinstance(p, dict):
                    errors.append("Каждый элемент в 'design.planes' должен быть объектом.")
                    continue
                pid = p.get('id')
                if not pid or pid in p_ids:
                    errors.append(f"Некорректный или дублирующийся ID орбитальной плоскости: '{pid}'.")
                p_ids.add(pid)
                planes_dict[pid] = p
                
                for angle_field in ('raan_deg', 'phase_deg'):
                    val = p.get(angle_field)
                    if not is_finite_number(val) or not (0 <= val < 360):
                        errors.append(f"В плоскости '{pid}' угол '{angle_field}' должен быть в полуинтервале [0, 360) градусов (получено: {val}).")
                        
        satellites = design.get('satellites')
        if not isinstance(satellites, list) or len(satellites) == 0:
            errors.append("В 'design' список 'satellites' не должен быть пустым.")
        else:
            s_ids_set = set()
            for sat in satellites:
                if not isinstance(sat, dict):
                    errors.append("Элемент 'design.satellites' должен быть объектом.")
                    continue
                sid = sat.get('id')
                if not sid or sid in s_ids_set:
                    errors.append(f"Некорректный или дублирующийся ID спутника: '{sid}'.")
                s_ids_set.add(sid)
                sat_ids.append(sid)
                
                if sat.get('plane_id') not in planes_dict:
                    errors.append(f"Спутник '{sid}' ссылается на несуществующую орбитальную плоскость: '{sat.get('plane_id')}'.")
                if sat.get('launch_batch') not in (1, 2, 3):
                    errors.append(f"У спутника '{sid}' очередь запуска 'launch_batch' должна быть 1, 2 или 3.")
                slot = sat.get('slot_deg')
                if not is_finite_number(slot):
                    errors.append(f"У спутника '{sid}' начальный угол 'slot_deg' должен быть конечным числом.")

    # Проверка ground_sites
    ground = s.get('ground_sites')
    ground_ids = set()
    clients_count = 0
    gateways_count = 0
    if not isinstance(ground, list) or len(ground) == 0:
        errors.append("Отсутствует или пуст список наземных станций 'ground_sites'.")
    else:
        for g in ground:
            if not isinstance(g, dict):
                errors.append("Элемент 'ground_sites' должен быть объектом.")
                continue
            gid = g.get('id')
            if not gid or gid in ground_ids:
                errors.append(f"Некорректный или дублирующийся ID наземного пункта: '{gid}'.")
            if gid in set(sat_ids):
                errors.append(f"Коллизия идентификаторов: наземный пункт '{gid}' совпадает с ID спутника.")
            ground_ids.add(gid)
            
            role = g.get('role')
            if role == 'client':
                clients_count += 1
            elif role == 'gateway':
                gateways_count += 1
            else:
                errors.append(f"Наземный пункт '{gid}' имеет неизвестную роль '{role}'. Допустимо: 'client' или 'gateway'.")
                
            lat = g.get('lat_deg')
            lon = g.get('lon_deg')
            if not is_finite_number(lat) or not (-90 <= lat <= 90):
                errors.append(f"Наземный пункт '{gid}': широта 'lat_deg'={lat} вне диапазона [-90, 90].")
            if not is_finite_number(lon) or not (-180 <= lon <= 180):
                errors.append(f"Наземный пункт '{gid}': долгота 'lon_deg'={lon} вне диапазона [-180, 180].")
                
        if clients_count == 0:
            errors.append("В 'ground_sites' должен быть хотя бы один пункт с ролью 'client'.")
        if gateways_count == 0:
            errors.append("В 'ground_sites' должен быть хотя бы один пункт с ролью 'gateway'.")

    # Проверка failures
    horizon = env.get('horizon_s', 86400) if isinstance(env.get('horizon_s'), (int, float)) else 86400
    for f in s.get('failures', []):
        if not isinstance(f, dict):
            errors.append("Элемент в 'failures' должен быть объектом.")
            continue
        sid = f.get('satellite_id')
        if sid not in set(sat_ids):
            errors.append(f"Отказ спутника: указан несуществующий спутник '{sid}'.")
        s_start, s_end = f.get('start_s'), f.get('end_s')
        if not is_finite_number(s_start) or not is_finite_number(s_end):
            errors.append(f"Отказ спутника '{sid}': start_s и end_s должны быть числами.")
        elif not (0 <= s_start < s_end <= horizon):
            errors.append(f"Отказ спутника '{sid}': интервал [{s_start}, {s_end}) вне пределов расчета [0, {horizon}].")

    # Проверка gateway_outages
    valid_gw = {g['id'] for g in ground if isinstance(g, dict) and g.get('role') == 'gateway'} if isinstance(ground, list) else set()
    for f in s.get('gateway_outages', []):
        if not isinstance(f, dict):
            errors.append("Элемент в 'gateway_outages' должен быть объектом.")
            continue
        gid = f.get('gateway_id')
        if gid not in valid_gw:
            errors.append(f"Отказ шлюза: указан несуществующий gateway_id '{gid}'.")
        s_start, s_end = f.get('start_s'), f.get('end_s')
        if not is_finite_number(s_start) or not is_finite_number(s_end):
            errors.append(f"Отказ шлюза '{gid}': start_s и end_s должны быть числами.")
        elif not (0 <= s_start < s_end <= horizon):
            errors.append(f"Отказ шлюза '{gid}': интервал [{s_start}, {s_end}) вне пределов расчета [0, {horizon}].")

    return (len(errors) == 0), errors
