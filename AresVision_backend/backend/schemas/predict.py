"""
预测分析页 — 请求/响应 Schema
"""
from typing import Any

from pydantic import BaseModel, Field
from schemas.explore import SourceMeta


class PredictRequest(BaseModel):
    selected_variables: list[str] = Field(
        default=["Temperature", "Dust_Optical_Depth", "Solar_Flux_DN",
                 "U_Wind", "V_Wind"],
    )
    horizon: int = Field(default=3, ge=1, le=30)
    ls_start: float = Field(default=90.0, ge=0, le=360)
    mars_year: int = Field(default=27)
    training_task_id: int | None = Field(default=None, ge=1)


class PredictFieldData(BaseModel):
    points: list[dict] = Field(default_factory=list)
    lat: list[float] = Field(default_factory=list)
    lon: list[float] = Field(default_factory=list)
    field: list[list[float]]
    minVal: float
    maxVal: float


class PredictResponse(BaseModel):
    ground_truth: list[PredictFieldData]
    prediction: list[PredictFieldData]
    residual: list[PredictFieldData]
    selected_variables: list[str]
    horizon: int
    ls_values: list[float]
    model_info: dict = Field(default_factory=dict)
    metrics: dict[str, Any] | None = None
    source_meta: SourceMeta | None = None


class StepMetrics(BaseModel):
    step: int
    rmse: float
    mae: float
    ssim: float
    r2: float


class EvalMetricsResponse(BaseModel):
    overall: StepMetrics
    per_step: list[StepMetrics]
    source_meta: SourceMeta | None = None


class TrainingModelCompareRequest(BaseModel):
    task_ids: list[int] = Field(..., min_length=2)
    horizon: int = Field(default=3, ge=1, le=30)


class TrainingModelMetrics(BaseModel):
    overall: StepMetrics
    per_step: list[StepMetrics]


class TrainingModelCompareItem(BaseModel):
    task_id: int
    model_name: str
    model_source: str
    architecture: str
    selected_channels: list[str] = Field(default_factory=list)
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    metrics: TrainingModelMetrics


class TrainingModelCompareResponse(BaseModel):
    items: list[TrainingModelCompareItem]


class DiurnalResponse(BaseModel):
    hours: list[float]
    ozone_values: list[float]
    lat_band: str
    ls: float
    source_meta: SourceMeta | None = None


class ScatterData(BaseModel):
    trues: list[float]
    preds: list[float]
    density: list[float]


class HistogramData(BaseModel):
    bin_edges: list[float]
    counts: list[int]


class ErrorDistributionResponse(BaseModel):
    scatter: ScatterData
    hist_trues: HistogramData
    hist_preds: HistogramData
    hist_errors: HistogramData
    mae: float
    rmse: float


class PermutationImportanceItem(BaseModel):
    name: str
    importance: float


class PermutationImportanceResponse(BaseModel):
    items: list[PermutationImportanceItem]
    baseline_metric: str
    baseline_value: float
