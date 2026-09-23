"""Response models for the public server dataset catalog.

Every nested structure is modeled explicitly so the public contract cannot
silently grow untyped fields. ``NaN``/``Infinity`` serialization is disabled.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Availability = Literal["available", "missing", "invalid", "unverified"]

MODEL_CONFIG = ConfigDict(allow_inf_nan=False)


class DatasetCapabilities(BaseModel):
    model_config = MODEL_CONFIG

    metadata: bool
    training: bool
    web_overview: bool
    trained_prediction: bool


class DatasetTime(BaseModel):
    model_config = MODEL_CONFIG

    kind: str
    calendar: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    count: Optional[int] = None
    step: Optional[int] = None
    step_unit: Optional[str] = None


class DatasetGrid(BaseModel):
    model_config = MODEL_CONFIG

    shape: list[int] = Field(default_factory=list)
    dimension_order: list[str] = Field(default_factory=list)
    latitude_range: list[float] = Field(default_factory=list)
    longitude_range: list[float] = Field(default_factory=list)
    cell_bounds: Optional[dict[str, list[float]]] = None
    latitude_step: Optional[float] = None
    longitude_step: Optional[float] = None
    latitude_order: Optional[str] = None
    longitude_order: Optional[str] = None
    coverage: Optional[str] = None
    wrap_longitude: Optional[bool] = None
    latitude_values: list[float] = Field(default_factory=list)
    longitude_values: list[float] = Field(default_factory=list)


class DatasetVariable(BaseModel):
    model_config = MODEL_CONFIG

    id: str
    label: str
    units: str
    role: Literal["target_and_input", "optional_input"]


class DatasetSplit(BaseModel):
    model_config = MODEL_CONFIG

    start: str
    end: str
    days: int


class DatasetDescriptor(BaseModel):
    # The public field name is ``schema``; the Python attribute avoids shadowing
    # the deprecated ``BaseModel.schema`` accessor.
    model_config = ConfigDict(allow_inf_nan=False, populate_by_name=True)

    dataset_id: str
    display_name: str
    planet: Literal["mars", "earth"]
    dataset_version: Optional[str] = None
    schema_: Optional[str] = Field(default=None, alias="schema")
    availability: Availability
    availability_reason: Optional[str] = None
    manifest_sha256: Optional[str] = None
    data_sha256: Optional[str] = None
    dataset_fingerprint: Optional[str] = None
    capabilities: DatasetCapabilities
    time: DatasetTime
    grid: Optional[DatasetGrid] = None
    channel_order: list[str] = Field(default_factory=list)
    variables: list[DatasetVariable] = Field(default_factory=list)
    splits: Optional[dict[str, DatasetSplit]] = None
    limitations: list[str] = Field(default_factory=list)


class DatasetListResponse(BaseModel):
    model_config = MODEL_CONFIG

    items: list[DatasetDescriptor]


__all__ = [
    "Availability",
    "DatasetCapabilities",
    "DatasetDescriptor",
    "DatasetGrid",
    "DatasetListResponse",
    "DatasetSplit",
    "DatasetTime",
    "DatasetVariable",
]
