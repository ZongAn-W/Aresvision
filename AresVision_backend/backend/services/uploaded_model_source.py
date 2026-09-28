"""Server-managed source files for uploaded user models.

An uploaded model is a single ``.py`` file that the platform validates once at
upload time and then executes whenever it builds the model - during training and
again during prediction. Two properties matter for correctness:

* **A task must never change its code.** The packages are immutable (a new upload
  creates a new id), and every reference here pins id + version + sha256, so a
  task keeps training the model it was created with even if the user uploads a
  newer version afterwards.
* **Earth prediction must survive the original file disappearing.** The Earth
  checkpoint embeds the verified source text, so a prediction can rebuild the
  model from the artifact alone. Missing or changed files are reported instead of
  being silently ignored.

Hashing the bytes is enough to detect tampering; the source is still AST-checked
the same way at upload and at use, so a tampered file can never introduce an
import or call that validation previously rejected.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class UploadedModelSourceError(ValueError):
    """An uploaded model source file is missing, unreadable or not the expected one."""

    def __init__(self, message: str, *, code: str = "uploaded_model_source_invalid"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class UploadedModelReference:
    """Everything needed to pin and later reproduce one uploaded model build."""

    package_id: str
    display_name: str
    version: int
    source_path: str
    content_hash: str
    param_schema: dict[str, Any]
    custom_model_params: dict[str, Any]
    source_text: str | None = None

    def checkpoint_reference(self) -> dict[str, Any]:
        """Return the plain-data form stored inside an Earth checkpoint."""
        return {
            "package_id": self.package_id,
            "display_name": self.display_name,
            "version": int(self.version),
            "content_hash": self.content_hash,
            "param_schema": dict(self.param_schema),
            "custom_model_params": dict(self.custom_model_params),
            "source_text": self.source_text,
            "source_available": self.source_text is not None,
        }


def hash_source_bytes(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


def read_source_file(path: Any) -> tuple[str, str]:
    """Return ``(source_text, sha256)`` for an uploaded model file, or raise."""
    file_path = Path(path)
    if not file_path.is_file():
        raise UploadedModelSourceError(
            f"The uploaded model file is missing: {file_path.name}",
            code="uploaded_model_missing",
        )
    try:
        raw = file_path.read_bytes()
    except OSError as exc:
        raise UploadedModelSourceError(
            f"The uploaded model file could not be read: {exc}",
            code="uploaded_model_unreadable",
        ) from exc
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UploadedModelSourceError(
            f"The uploaded model file is not valid UTF-8: {exc}",
            code="uploaded_model_unreadable",
        ) from exc
    return text, hash_source_bytes(raw)


def build_reference(
    *,
    package: Any,
    param_schema: Any,
    custom_model_params: Any,
    embed_source: bool = True,
) -> UploadedModelReference:
    """Build a pinned reference from a ``UserModelPackage`` row.

    ``embed_source`` reads and hashes the file so the returned reference can be
    carried inside a checkpoint; pass False when only the identity is needed.
    """
    storage_path = str(getattr(package, "storage_path", "") or "")
    if not storage_path:
        raise UploadedModelSourceError(
            "The uploaded model package has no source file",
            code="uploaded_model_missing",
        )
    expected_hash = str(getattr(package, "content_hash", "") or "")
    source_text = None
    if embed_source:
        source_text, actual_hash = read_source_file(storage_path)
        if expected_hash and actual_hash != expected_hash:
            raise UploadedModelSourceError(
                "The uploaded model file no longer matches the verified version; "
                "re-upload or revalidate the model",
                code="uploaded_model_tampered",
            )
    return UploadedModelReference(
        package_id=str(getattr(package, "id", "") or ""),
        display_name=str(getattr(package, "display_name", "") or ""),
        version=int(getattr(package, "version", 1) or 1),
        source_path=storage_path,
        content_hash=expected_hash,
        param_schema=dict(param_schema or {}),
        custom_model_params=dict(custom_model_params or {}),
        source_text=source_text,
    )


def verify_reference_source(reference: Any) -> dict[str, Any]:
    """Compare the on-disk file with a stored reference without executing it.

    Returns ``{"status": ..., "detail": ...}`` where ``status`` is one of:

    * ``available`` - the file exists and hashes to the recorded digest;
    * ``missing`` - the file is gone, so the embedded source is required;
    * ``tampered`` - the file exists but is not the recorded version;
    * ``unknown`` - the reference carries no digest to compare against.
    """
    if not isinstance(reference, dict):
        return {"status": "unknown", "detail": "no stored model reference"}
    expected = str(reference.get("content_hash") or "")
    source_path = str(reference.get("source_path") or reference.get("storage_path") or "")
    if not source_path:
        return {"status": "missing", "detail": "the stored model reference has no file path"}
    path = Path(source_path)
    if not path.is_file():
        return {"status": "missing", "detail": f"{path.name} is no longer on disk"}
    if not expected:
        return {"status": "unknown", "detail": "the stored reference has no content hash"}
    try:
        raw = path.read_bytes()
    except OSError as exc:
        return {"status": "missing", "detail": f"could not read {path.name}: {exc}"}
    actual = hash_source_bytes(raw)
    if actual != expected:
        return {
            "status": "tampered",
            "detail": f"{path.name} changed (expected {expected[:12]}…, found {actual[:12]}…)",
        }
    return {"status": "available", "detail": f"{path.name} matches {expected[:12]}…"}


def resolve_source_text(reference: Any) -> tuple[str, dict[str, Any]]:
    """Return the source to execute plus a verification report.

    A hash mismatch is a hard error: continuing would train or predict with code
    the validation never approved. A missing file is acceptable **only** when the
    checkpoint embedded the verified source.
    """
    if not isinstance(reference, dict):
        raise UploadedModelSourceError(
            "The Earth checkpoint has no uploaded model reference",
            code="uploaded_model_reference_missing",
        )
    report = verify_reference_source(reference)
    embedded = reference.get("source_text")
    if report["status"] == "tampered":
        raise UploadedModelSourceError(
            "The uploaded model file was modified after this task was created; "
            f"{report['detail']}. Retrain or re-upload the model.",
            code="uploaded_model_tampered",
        )
    if report["status"] == "available":
        text, digest = read_source_file(reference["source_path"])
        if reference.get("content_hash") and digest != reference["content_hash"]:
            raise UploadedModelSourceError(
                "The uploaded model file changed while it was being read",
                code="uploaded_model_tampered",
            )
        return text, report
    if isinstance(embedded, str) and embedded.strip():
        report = dict(report)
        report["used_embedded_source"] = True
        return embedded, report
    raise UploadedModelSourceError(
        "The uploaded model file is unavailable and this checkpoint has no embedded "
        "copy, so the model cannot be rebuilt",
        code="uploaded_model_missing",
    )


__all__ = [
    "UploadedModelReference",
    "UploadedModelSourceError",
    "build_reference",
    "hash_source_bytes",
    "read_source_file",
    "resolve_source_text",
    "verify_reference_source",
]
