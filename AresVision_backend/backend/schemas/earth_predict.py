"""Earth historical prediction response models.

The public contract is intentionally explicit: a client gets the selectable
forecast origins, the three target dates, the real published grid, the three DU
fields and the metrics — never a bare array it would have to interpret.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

MODEL_CONFIG = ConfigDict(allow_inf_nan=False)


class EarthPredictGrid(BaseModel):
    model_config = MODEL_CONFIG

    shape: list[int] = Field(default_factory=list)
    latitude: list[float] = Field(default_factory=list)
    longitude: list[float] = Field(default_factory=list)
    latitude_range: Optional[list[float]] = None
    longitude_range: Optional[list[float]] = None
    latitude_step: Optional[float] = None
    longitude_step: Optional[float] = None
    coverage: Optional[str] = None
    wrap_longitude: Optional[bool] = None


class EarthPredictVariable(BaseModel):
    model_config = MODEL_CONFIG

    id: str
    label: str
    units: str
    role: str


class EarthPredictFieldDay(BaseModel):
    model_config = MODEL_CONFIG

    field: list[list[float]]
    minVal: float
    maxVal: float
    valid_cells: int


class EarthLeadMetric(BaseModel):
    model_config = MODEL_CONFIG

    lead_day: int
    rmse: float
    mae: float


class EarthPredictMetrics(BaseModel):
    model_config = MODEL_CONFIG

    unit: str
    target: str
    aggregation: str
    reference_available: bool
    overall: dict[str, float] = Field(default_factory=dict)
    by_lead: list[EarthLeadMetric] = Field(default_factory=list)


class EarthPredictOrigins(BaseModel):
    model_config = MODEL_CONFIG

    start: str
    end: str
    count: int
    dates: list[str] = Field(default_factory=list)
    window: int
    horizon: int
    input_offset_days: int
    target_offset_days: int


class EarthPredictRunBlock(BaseModel):
    model_config = MODEL_CONFIG

    best_epoch: Optional[int] = None
    epochs_completed: Optional[int] = None
    seed: Optional[int] = None
    device: Optional[str] = None
    created_utc: Optional[str] = None
    linear_hidden_layers: Optional[int] = None


class EarthPredictModelIdentity(BaseModel):
    """Which model produced (or will produce) the prediction.

    Published so the page can name the trained model and, for an uploaded one, show
    its pinned package, version and content hash - never a server file path.
    """

    model_config = MODEL_CONFIG

    model_source: Optional[str] = None
    model_architecture: Optional[str] = None
    uploaded_model_id: Optional[str] = None
    uploaded_model_name: Optional[str] = None
    uploaded_model_version: Optional[int] = None
    uploaded_model_content_hash: Optional[str] = None
    uploaded_model_source_embedded: Optional[bool] = None


class EarthPredictContextResponse(BaseModel):
    model_config = MODEL_CONFIG

    planet: str = "earth"
    task_id: int
    dataset_id: str
    dataset_version: str
    dataset_fingerprint: str
    target: str
    target_unit: str
    window: int
    horizon: int
    input_channel_order: list[str] = Field(default_factory=list)
    input_units: list[str] = Field(default_factory=list)
    grid: EarthPredictGrid
    origins: EarthPredictOrigins
    training_split_end: Optional[str] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    run: EarthPredictRunBlock = Field(default_factory=EarthPredictRunBlock)
    model: EarthPredictModelIdentity = Field(default_factory=EarthPredictModelIdentity)
    warnings: list[str] = Field(default_factory=list)


class EarthPredictRequest(BaseModel):
    model_config = MODEL_CONFIG

    training_task_id: int = Field(..., ge=1)
    forecast_origin: str = Field(..., min_length=8, max_length=10)


class EarthPredictResponse(BaseModel):
    model_config = MODEL_CONFIG

    planet: str = "earth"
    task_id: int
    dataset_id: str
    dataset_version: str
    dataset_fingerprint: str
    target: str
    target_unit: str
    model_architecture: Optional[str] = None
    model_source: Optional[str] = None
    model: EarthPredictModelIdentity = Field(default_factory=EarthPredictModelIdentity)
    warnings: list[str] = Field(default_factory=list)
    input_channel_order: list[str] = Field(default_factory=list)
    input_units: list[str] = Field(default_factory=list)
    forecast_origin: str
    input_dates: list[str] = Field(default_factory=list)
    target_dates: list[str] = Field(default_factory=list)
    window: int
    horizon: int
    grid: EarthPredictGrid
    variables: list[EarthPredictVariable] = Field(default_factory=list)
    prediction: list[EarthPredictFieldDay] = Field(default_factory=list)
    reference: list[EarthPredictFieldDay] = Field(default_factory=list)
    residual: list[EarthPredictFieldDay] = Field(default_factory=list)
    metrics: EarthPredictMetrics


__all__ = [
    "EarthLeadMetric",
    "EarthPredictContextResponse",
    "EarthPredictFieldDay",
    "EarthPredictGrid",
    "EarthPredictMetrics",
    "EarthPredictModelIdentity",
    "EarthPredictOrigins",
    "EarthPredictRequest",
    "EarthPredictResponse",
    "EarthPredictRunBlock",
    "EarthPredictVariable",
]
