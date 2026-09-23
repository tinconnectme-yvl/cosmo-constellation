from __future__ import annotations
from typing import Dict, Any


def build_result_payload(simulation_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Формирует итоговый JSON по спецификации cosmo-A-result-1.0.
    """
    return {
        'schema_version': 'cosmo-A-result-1.0',
        'effective_scenario': simulation_result['effective_scenario'],
        'routes': simulation_result['all_routes'],
        'summary_metrics': simulation_result['summary_metrics']
    }
