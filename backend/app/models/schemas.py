from __future__ import annotations
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class ScenarioMeta(BaseModel):
    id: str
    title: str


class PlaneConfig(BaseModel):
    id: str
    raan_deg: float = Field(..., ge=0, lt=360)
    phase_deg: float = Field(..., ge=0, lt=360)


class SatelliteConfig(BaseModel):
    id: str
    plane_id: str
    slot_deg: float
    launch_batch: int = Field(..., ge=1, le=3)


class GroundSite(BaseModel):
    id: str
    name: str
    role: str # client or gateway
    lat_deg: float = Field(..., ge=-90, le=90)
    lon_deg: float = Field(..., ge=-180, le=180)


class OutageInterval(BaseModel):
    satellite_id: str
    start_s: float = Field(..., ge=0)
    end_s: float = Field(..., ge=0)


class GatewayOutageInterval(BaseModel):
    gateway_id: str
    start_s: float = Field(..., ge=0)
    end_s: float = Field(..., ge=0)


class EnvironmentConfig(BaseModel):
    altitude_km: float = 550.0
    inclination_deg: float = 87.0
    earth_angle0_deg: float = 12.0
    horizon_s: int = 86400
    step_s: int = 120
    min_elevation_deg: float = 10.0
    isl_range_km: float = 3000.0
    target_availability: float = 0.9


class DesignConfig(BaseModel):
    launch_stage: int = Field(3, ge=1, le=3)
    planes: List[PlaneConfig]
    satellites: List[SatelliteConfig]


class ScenarioPayload(BaseModel):
    schema_version: str = "cosmo-A-1.0"
    meta: ScenarioMeta
    environment: EnvironmentConfig
    design: DesignConfig
    ground_sites: List[GroundSite]
    failures: List[OutageInterval] = []
    gateway_outages: List[GatewayOutageInterval] = []


class SimulationRequest(BaseModel):
    scenario: Optional[dict] = None
    scenario_id: Optional[str] = None
    launch_stage: Optional[int] = None
    modified_planes: Optional[List[PlaneConfig]] = None
    additional_failures: Optional[List[OutageInterval]] = None
    routing_strategy: str = "min_hops" # min_hops or min_distance


class CompareRequest(BaseModel):
    scenario_a: dict
    scenario_b: dict
    strategy: str = "min_hops"
