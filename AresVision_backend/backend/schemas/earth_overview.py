"""Response models for the read-only 2D Earth overview endpoints.

``NaN``/``Infinity`` serialization is disabled so a bad field cannot silently
become ``null`` in a numeric array.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat

MODEL_CONFIG = ConfigDict(allow_inf_nan=False)

VariableId = Literal["TO3", "U10M", "V10M", "T2M", "SWGDN"]
FiniteNumber = Annotated[FiniteFloat, Field()]


class EarthResponseIdentity(BaseModel):
    model_config = MODEL_CONFIG

    dataset_id: str
    dataset_version: Optional[str] = None
    dataset_fingerprint: str
    planet: Literal["earth"]
    variable: VariableId
    units: str


class EarthCoverage(BaseModel):
    model_config = MODEL_CONFIG

    latitude_range: list[FiniteNumber]
    longitude_range: list[FiniteNumber]
    wrap_longitude: bool


class EarthColorRange(BaseModel):
    model_config = MODEL_CONFIG

    min: FiniteNumber
    max: FiniteNumber
    scope: Literal["dataset"]
    centered_on_zero: bool


class EarthFieldStatistics(BaseModel):
    model_config = MODEL_CONFIG

    min: FiniteNumber
    max: FiniteNumber
    regional_mean: FiniteNumber
    valid_count: int


class EarthFieldResponse(EarthResponseIdentity):
    date: str
    calendar: str
    lat: list[FiniteNumber]
    lon: list[FiniteNumber]
    dimension_order: list[Literal["lat", "lon"]]
    field: list[list[FiniteNumber]]
    coverage: EarthCoverage
    color_range: EarthColorRange
    statistics: EarthFieldStatistics


class EarthRegionalSeriesResponse(EarthResponseIdentity):
    start: str
    end: str
    dates: list[str]
    values: list[FiniteNumber]
    aggregation: Literal["cos_lat_sample_mean", "spherical_cell_area_mean"]
    coverage: EarthCoverage


class EarthGridPoint(BaseModel):
    model_config = MODEL_CONFIG

    lat: FiniteNumber
    lon: FiniteNumber
    lat_index: int
    lon_index: int


class EarthRequestedPoint(BaseModel):
    model_config = MODEL_CONFIG

    lat: FiniteNumber
    lon: FiniteNumber


class EarthPointSeriesResponse(EarthResponseIdentity):
    start: str
    end: str
    requested: EarthRequestedPoint
    grid_point: EarthGridPoint
    selection: Literal["nearest_grid_point"]
    dates: list[str]
    values: list[FiniteNumber]


__all__ = [
    "EarthColorRange",
    "EarthCoverage",
    "EarthFieldResponse",
    "EarthFieldStatistics",
    "EarthGridPoint",
    "EarthPointSeriesResponse",
    "EarthRegionalSeriesResponse",
    "EarthRequestedPoint",
    "EarthResponseIdentity",
]
