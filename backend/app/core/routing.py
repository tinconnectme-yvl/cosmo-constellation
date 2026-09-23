from __future__ import annotations
from collections import deque
import heapq
from typing import Dict, List, Optional, Tuple, Any

from app.core.geometry import snapshot, R


class RoutingReason:
    SUCCESS = "OK"
    NO_CLIENT_SATELLITE = "NO_CLIENT_SATELLITE"
    GATEWAY_OUTAGE = "GATEWAY_OUTAGE"
    NO_GATEWAY_SATELLITE = "NO_GATEWAY_SATELLITE"
    ISL_NETWORK_DISCONNECTED = "ISL_NETWORK_DISCONNECTED"

    REASON_DESCRIPTIONS = {
        SUCCESS: "Маршрут построен успешно",
        NO_CLIENT_SATELLITE: "В зоне видимости терминала нет активных спутников (elevation < 10°)",
        GATEWAY_OUTAGE: "Наземный шлюз временно недоступен (период планового отказа)",
        NO_GATEWAY_SATELLITE: "В зоне видимости шлюза нет активных спутников (elevation < 10°)",
        ISL_NETWORK_DISCONNECTED: "Разрыв межспутниковой сети (ISL): нет связующего пути между спутниками терминала и шлюза"
    }


def find_route_bfs(
    client_id: str, 
    target_gateways: set[str], 
    adj: Dict[str, List[Tuple[str, float]]]
) -> Optional[Tuple[List[str], float]]:
    """
    Поиск пути с минимальным количеством переходов (хопов).
    Возвращает: (путь_из_id_узлов, суммарное_расстояние_км) или None.
    """
    queue = deque([(client_id, [client_id], 0.0)])
    visited = {client_id}
    
    best_path = None
    best_dist = float('inf')
    min_hops = float('inf')
    
    while queue:
        curr, path, dist = queue.popleft()
        
        if curr in target_gateways and curr != client_id:
            # Нашли шлюз
            if len(path) < min_hops or (len(path) == min_hops and dist < best_dist):
                min_hops = len(path)
                best_dist = dist
                best_path = path
                continue
                
        if len(path) >= min_hops:
            continue
            
        for neighbor, edge_dist in adj.get(curr, []):
            if neighbor not in visited:
                # Наземные терминалы (кроме целевого шлюза) не могут быть транзитными ретрансляторами
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor], dist + edge_dist))
                
    if best_path:
        return best_path, best_dist
    return None


def find_route_dijkstra(
    client_id: str, 
    target_gateways: set[str], 
    adj: Dict[str, List[Tuple[str, float]]]
) -> Optional[Tuple[List[str], float]]:
    """
    Поиск пути с минимальной задержкой / суммарным расстоянием (км).
    """
    # (distance, current_node, path)
    heap = [(0.0, client_id, [client_id])]
    visited = {}
    
    while heap:
        dist, curr, path = heapq.heappop(heap)
        
        if curr in visited and visited[curr] <= dist:
            continue
        visited[curr] = dist
        
        if curr in target_gateways and curr != client_id:
            return path, dist
            
        for neighbor, edge_dist in adj.get(curr, []):
            new_dist = dist + edge_dist
            if neighbor not in visited or new_dist < visited[neighbor]:
                heap.append((new_dist, neighbor, path + [neighbor]))
                heapq.heapify(heap)
                
    return None


def solve_step_routing(
    scenario: dict, 
    t_s: float, 
    strategy: str = "min_hops"
) -> Dict[str, Any]:
    """
    Вычисляет моментальное состояние сети и маршруты для всех клиентских пунктов.
    """
    snap = snapshot(scenario, t_s)
    edges = snap['edges']
    ground_sites = scenario['ground_sites']
    
    clients = [g for g in ground_sites if g['role'] == 'client']
    gateways = [g for g in ground_sites if g['role'] == 'gateway']
    gateway_ids = {g['id'] for g in gateways}
    
    # Строим список смежности графа
    adj: Dict[str, List[Tuple[str, float]]] = {}
    for u, v, d in edges:
        adj.setdefault(u, []).append((v, d))
        adj.setdefault(v, []).append((u, d))
        
    gw_outages = scenario.get('gateway_outages', [])
    
    results_by_client = {}
    
    for client in clients:
        cid = client['id']
        client_neighbors = [v for v, _ in adj.get(cid, [])]
        
        # Проверка условий доступности
        has_client_sat = len(client_neighbors) > 0
        
        # Проверяем доступность шлюзов
        active_gateways = []
        for gw in gateways:
            gid = gw['id']
            is_offline = any(
                f['gateway_id'] == gid and f['start_s'] <= t_s < f['end_s'] 
                for f in gw_outages
            )
            has_gw_sat = len(adj.get(gid, [])) > 0
            if not is_offline and has_gw_sat:
                active_gateways.append(gid)
                
        target_gw_set = set(active_gateways)
        
        # Поиск маршрута
        route_found = None
        if has_client_sat and target_gw_set:
            if strategy == "min_distance":
                route_found = find_route_dijkstra(cid, target_gw_set, adj)
            else:
                route_found = find_route_bfs(cid, target_gw_set, adj)
                
        if route_found:
            path, dist_km = route_found
            # 1 переход = 1 ребро. Число ребер = len(path) - 1
            hops = len(path) - 1
            # Задержка распространения сигнала со скоростью света (c ~ 299792 км/с)
            latency_ms = (dist_km / 299.792)
            results_by_client[cid] = {
                'available': True,
                'path': path,
                'hops': hops,
                'distance_km': round(dist_km, 2),
                'latency_ms': round(latency_ms, 2),
                'reason_code': RoutingReason.SUCCESS,
                'reason_text': RoutingReason.REASON_DESCRIPTIONS[RoutingReason.SUCCESS]
            }
        else:
            # Диагностика причины отказа
            if not has_client_sat:
                reason = RoutingReason.NO_CLIENT_SATELLITE
            else:
                # Проверим, все ли шлюзы в плановом отказе
                all_gw_offline = all(
                    any(f['gateway_id'] == gw['id'] and f['start_s'] <= t_s < f['end_s'] for f in gw_outages)
                    for gw in gateways
                )
                if all_gw_offline:
                    reason = RoutingReason.GATEWAY_OUTAGE
                elif not target_gw_set:
                    reason = RoutingReason.NO_GATEWAY_SATELLITE
                else:
                    reason = RoutingReason.ISL_NETWORK_DISCONNECTED
                    
            results_by_client[cid] = {
                'available': False,
                'path': [],
                'hops': None,
                'distance_km': None,
                'latency_ms': None,
                'reason_code': reason,
                'reason_text': RoutingReason.REASON_DESCRIPTIONS[reason]
            }
            
    return {
        't_s': t_s,
        'snapshot': snap,
        'clients_routing': results_by_client
    }
