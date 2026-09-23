from __future__ import annotations
from typing import Dict, List, Any
import numpy as np

from app.core.routing import solve_step_routing, RoutingReason


def simulate_full_scenario(
    scenario: dict, 
    strategy: str = "min_hops"
) -> Dict[str, Any]:
    """
    Полное суточное моделирование группировки на временной сетке.
    Возвращает:
    - timeline_steps: список результатов по каждому шагу t_s
    - summary_metrics: сводные показатели по каждому клиентскому терминалу
    - effective_scenario: использованный сценарий
    """
    env = scenario['environment']
    step_s = env['step_s']
    horizon_s = env['horizon_s']
    target_avail = env.get('target_availability', 0.9)
    
    # Моменты времени: 0, step_s, ..., horizon_s - step_s
    time_points = list(range(0, horizon_s, step_s))
    total_steps = len(time_points)
    
    client_ids = [g['id'] for g in scenario['ground_sites'] if g['role'] == 'client']
    
    # Инициализация структур накопления данных
    client_history = {
        cid: {
            'visible_steps': 0,
            'available_steps': 0,
            'hops_list': [],
            'latency_list': [],
            'step_states': [], # list of bool (True if route available)
            'step_reasons': [], # list of reason_code
            'routes': [] # list of (t_s, path)
        }
        for cid in client_ids
    }
    
    timeline_steps = []
    
    for t_s in time_points:
        step_res = solve_step_routing(scenario, t_s, strategy=strategy)
        timeline_steps.append({
            't_s': t_s,
            'clients': step_res['clients_routing'],
            'edges': step_res['snapshot']['edges']
        })
        
        elevations = step_res['snapshot']['elevation_deg']
        
        for cid in client_ids:
            c_data = step_res['clients_routing'][cid]
            is_avail = c_data['available']
            
            # Проверка видимости спутников
            c_elevs = elevations.get(cid, {})
            is_visible = any(el >= env['min_elevation_deg'] for el in c_elevs.values())
            
            if is_visible:
                client_history[cid]['visible_steps'] += 1
                
            if is_avail:
                client_history[cid]['available_steps'] += 1
                client_history[cid]['hops_list'].append(c_data['hops'])
                client_history[cid]['latency_list'].append(c_data['latency_ms'])
                
            client_history[cid]['step_states'].append(is_avail)
            client_history[cid]['step_reasons'].append(c_data['reason_code'])
            client_history[cid]['routes'].append({
                't_s': t_s,
                'client_id': cid,
                'path': c_data['path']
            })
            
    # Расчет финальных метрик
    summary_metrics = {}
    for cid in client_ids:
        hist = client_history[cid]
        avail_ratio = hist['available_steps'] / total_steps if total_steps else 0.0
        vis_ratio = hist['visible_steps'] / total_steps if total_steps else 0.0
        
        # Расчет максимального непрерывного перерыва (max outage)
        states = hist['step_states']
        reasons = hist['step_reasons']
        max_outage_steps = 0
        current_outage = 0
        
        outage_intervals = []
        outage_start_step = None
        current_reason = None
        
        for step_idx, st in enumerate(states):
            if not st:
                current_outage += 1
                if outage_start_step is None:
                    outage_start_step = step_idx
                    current_reason = reasons[step_idx]
            else:
                if current_outage > 0:
                    if current_outage > max_outage_steps:
                        max_outage_steps = current_outage
                    outage_intervals.append({
                        'start_s': time_points[outage_start_step],
                        'end_s': time_points[step_idx], # правая граница интервала
                        'duration_s': current_outage * step_s,
                        'reason_code': current_reason,
                        'reason_text': RoutingReason.REASON_DESCRIPTIONS.get(current_reason, "")
                    })
                    current_outage = 0
                    outage_start_step = None
                    current_reason = None
                    
        # Если перерыв продолжался до конца горизонта
        if current_outage > 0:
            if current_outage > max_outage_steps:
                max_outage_steps = current_outage
            outage_intervals.append({
                'start_s': time_points[outage_start_step],
                'end_s': horizon_s,
                'duration_s': current_outage * step_s,
                'reason_code': current_reason,
                'reason_text': RoutingReason.REASON_DESCRIPTIONS.get(current_reason, "")
            })
            
        max_outage_s = max_outage_steps * step_s
        avg_hops = float(np.mean(hist['hops_list'])) if hist['hops_list'] else None
        avg_latency = float(np.mean(hist['latency_list'])) if hist['latency_list'] else None
        
        # Расчет распределения причин отказов
        failure_reasons_count = {}
        for r_code in hist['step_reasons']:
            if r_code != RoutingReason.SUCCESS:
                failure_reasons_count[r_code] = failure_reasons_count.get(r_code, 0) + 1
                
        summary_metrics[cid] = {
            'client_id': cid,
            'total_steps': total_steps,
            'visible_steps': hist['visible_steps'],
            'visibility_ratio': round(vis_ratio, 4),
            'visibility_percent': round(vis_ratio * 100.0, 2),
            'available_steps': hist['available_steps'],
            'availability_ratio': round(avail_ratio, 4),
            'availability_percent': round(avail_ratio * 100.0, 2),
            'target_availability': target_avail,
            'target_met': avail_ratio >= (target_avail - 1e-9),
            'max_outage_s': max_outage_s,
            'max_outage_min': round(max_outage_s / 60.0, 1),
            'avg_hops': round(avg_hops, 2) if avg_hops is not None else None,
            'avg_latency_ms': round(avg_latency, 2) if avg_latency is not None else None,
            'outage_count': len(outage_intervals),
            'outage_intervals': outage_intervals,
            'failure_distribution': failure_reasons_count
        }
        
    all_routes = []
    for t_s_idx, t_s in enumerate(time_points):
        for cid in client_ids:
            all_routes.append(client_history[cid]['routes'][t_s_idx])
            
    return {
        'summary_metrics': summary_metrics,
        'timeline_steps': timeline_steps,
        'effective_scenario': scenario,
        'all_routes': all_routes
    }
