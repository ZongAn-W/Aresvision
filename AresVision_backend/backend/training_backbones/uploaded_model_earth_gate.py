"""Is this uploaded model usable for the Earth MERRA-2 feed?

A model is Earth-compatible only when **all** of these hold:

1. its source file is present and hashes to the recorded digest (nothing drifted);
2. it passes the shared safety gate (torch/numpy imports only, no unsafe calls);
3. its ``MODEL_SPEC`` declares the ``earth_merra2`` feed;
4. that declaration does not ask for Mars-only auxiliary inputs (Ls, MOLA topography);
5. it actually builds and runs on the Earth tensor contract
   ``[B, 7, C, 36, 72] -> [B, 3, 1, 36, 72]`` for both boundary channel counts.

"Validated for Mars" is deliberately **not** part of this: a Mars-capable model is
never treated as Earth-capable by default, which is exactly the assumption this
gate exists to break.

The real work is delegated to :class:`services.user_model_validator.UserModelValidator`,
whose Earth dry-run builds and executes the model on that exact contract. This
module only adds the file-integrity and dataset-identity framing, so the upload
page, the compatibility endpoint and the training start gate all read the same
verdict.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from services.uploaded_model_source import hash_source_bytes
from training_backbones.uploaded_model_dataset_spec import (
    DatasetCapabilityError,
    declares_earth_feed,
    earth_incompatibility_reasons,
    normalize_dataset_declarations,
)
from training_backbones.uploaded_model_source_check import validate_uploaded_model_source


def build_validator() -> Any:
    """Return the shared upload validator (imported lazily to avoid cycles)."""
    from services.user_model_validator import UserModelValidator

    return UserModelValidator()


@dataclass
class EarthCompatibility:
    """The verdict for one uploaded model."""

    compatible: bool
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    declares_earth: bool = False
    datasets: dict[str, Any] = field(default_factory=dict)
    output_shape: list[int] | None = None
    display_name: str | None = None
    version: int | None = None
    param_schema: dict[str, Any] = field(default_factory=dict)

    def report(self) -> dict[str, Any]:
        return {
            "compatible": self.compatible,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "declares_earth_feed": self.declares_earth,
            "datasets": self.datasets,
            "output_shape": self.output_shape,
            "display_name": self.display_name,
            "version": self.version,
        }


def _static_declaration_check(source_text: str, filename: str) -> EarthCompatibility:
    """Cheap check with no runtime: syntax, safety and the dataset declaration.

    This is what explains *why* a model cannot serve Earth before paying for a
    build, and it is the only check available when no validator is supplied.
    """
    safety_errors = validate_uploaded_model_source(source_text, filename)
    if safety_errors:
        return EarthCompatibility(compatible=False, reasons=safety_errors)

    namespace: dict[str, Any] = {}
    try:
        exec(compile(source_text, filename, "exec"), namespace)  # noqa: S102 - AST-checked above
    except Exception as exc:  # noqa: BLE001 - reported as an incompatibility reason
        return EarthCompatibility(
            compatible=False,
            reasons=[f"the uploaded model source could not be executed: {exc}"],
        )

    model_spec = namespace.get("MODEL_SPEC")
    if not isinstance(model_spec, dict):
        return EarthCompatibility(compatible=False, reasons=["MODEL_SPEC must be exported as a dict"])
    if not callable(namespace.get("build_model")):
        return EarthCompatibility(
            compatible=False, reasons=["the model must export build_model(config)"]
        )

    try:
        datasets = normalize_dataset_declarations(model_spec)
    except DatasetCapabilityError as exc:
        return EarthCompatibility(compatible=False, reasons=[str(exc)])

    try:
        from training_backbones.uploaded_model_contract import normalize_auxiliary_inputs

        auxiliary_inputs = normalize_auxiliary_inputs(model_spec)
    except ValueError as exc:
        return EarthCompatibility(compatible=False, reasons=[str(exc)], datasets=datasets)

    declares = declares_earth_feed(model_spec)
    # The channel count the platform would feed is 1..5; declaring the maximum makes
    # this a necessary condition rather than a guess.
    reasons = earth_incompatibility_reasons(
        model_spec,
        auxiliary_inputs,
        height=36,
        width=72,
        channel_count=5,
        window=7,
        horizon=3,
    )
    return EarthCompatibility(
        compatible=False,  # the tensor contract has not been exercised yet
        reasons=reasons,
        declares_earth=declares,
        datasets=datasets,
    )


def evaluate_earth_compatibility(
    *,
    source_text: str,
    filename: str = "uploaded_model.py",
) -> EarthCompatibility:
    """Report whether source text declares a usable Earth feed.

    This is the static half of the verdict: syntax, safety and the dataset
    declaration. Callers that need the executed proof should use
    :func:`evaluate_package_earth_compatibility`, which runs the validator's Earth
    dry-run and returns its verdict.
    """
    static = _static_declaration_check(source_text, filename)
    if not static.reasons:
        # The declaration is consistent, but the tensor contract has not been
        # exercised, so this is not by itself a green light.
        static.reasons = [
            "the Earth tensor contract was not exercised; revalidate the model so the "
            "platform can build it with Earth's 7 -> 3 window on the 36x72 grid"
        ]
    return static


def evaluate_package_earth_compatibility(package: Any, validator: Any = None) -> EarthCompatibility:
    """Run the Earth check for a stored ``UserModelPackage`` row.

    The file is read and hashed first, so a drifted upload is reported as such
    instead of being dry-run and reported as a model problem.
    """
    storage_path = str(getattr(package, "storage_path", "") or "")
    display_name = getattr(package, "display_name", None)
    version = getattr(package, "version", None)
    if not storage_path or not Path(storage_path).is_file():
        return EarthCompatibility(
            compatible=False,
            reasons=["the uploaded model file is missing; re-upload or revalidate the model"],
            display_name=display_name,
            version=version,
        )

    raw = Path(storage_path).read_bytes()
    expected_hash = str(getattr(package, "content_hash", "") or "")
    if expected_hash and hash_source_bytes(raw) != expected_hash:
        return EarthCompatibility(
            compatible=False,
            reasons=[
                "the uploaded model file no longer matches the verified version; "
                "re-upload or revalidate the model"
            ],
            display_name=display_name,
            version=version,
        )

    source_text = raw.decode("utf-8")
    filename = f"{display_name or 'uploaded_model'}.py"
    static = _static_declaration_check(source_text, filename)
    if static.reasons:
        static.display_name = display_name
        static.version = version
        return static

    active_validator = validator or build_validator()
    # The dry-run must use a ``.py`` name: the stored file carries a ``.source``
    # suffix so it is never importable by accident, and the validator rejects that
    # extension - which would report a perfectly good model as unproven.
    with tempfile.TemporaryDirectory(prefix="aresvision_earth_gate_") as temp_dir:
        probe_path = Path(temp_dir) / filename
        probe_path.write_bytes(raw)
        result = active_validator.validate_file(probe_path)
    verdict = EarthCompatibility(
        compatible=bool(result.earth_ok),
        reasons=list(result.earth_errors),
        warnings=list(result.warnings),
        declares_earth=bool(result.datasets),
        datasets=result.datasets,
        output_shape=result.earth_output_shape,
        display_name=display_name,
        version=version,
        param_schema=dict(result.param_schema),
    )
    if not verdict.compatible and not verdict.reasons:
        verdict.reasons = [
            "the model did not pass the Earth dry-run and reported no specific reason"
        ]
    return verdict


__all__ = [
    "EarthCompatibility",
    "build_validator",
    "evaluate_earth_compatibility",
    "evaluate_package_earth_compatibility",
]
