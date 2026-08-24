from __future__ import annotations

import ast
import importlib.util
import keyword
import multiprocessing
from queue import Empty
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import config
from training_backbones.uploaded_model_contract import (
    attach_uploaded_model_contract,
    normalize_auxiliary_inputs,
    run_uploaded_model,
)


ALLOWED_IMPORT_ROOTS = {"torch", "numpy"}
DISALLOWED_DIRECT_CALLS = {"open", "eval", "exec", "compile", "__import__"}
DISALLOWED_ATTRIBUTE_CALLS = {"system", "popen", "Popen", "run"}
EXPECTED_OUTPUT_SHAPE = [2, 3, 1, 8, 16]


@dataclass
class UserModelValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    display_name: str | None = None
    description: str | None = None
    param_schema: dict[str, Any] = field(default_factory=dict)
    output_shape: list[int] | None = None

    def report_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "errors": self.errors,
            "warnings": self.warnings,
            "output_shape": self.output_shape,
        }


class UserModelValidator:
    def __init__(self, timeout_seconds: float | None = 30.0):
        self.timeout_seconds = timeout_seconds

    def validate_file(self_or_file_path, file_path: Path | None = None) -> UserModelValidationResult:
        if isinstance(self_or_file_path, UserModelValidator):
            path = file_path
            timeout_seconds = self_or_file_path.timeout_seconds
        else:
            path = self_or_file_path
            timeout_seconds = 30.0

        if path is None:
            raise TypeError("validate_file() missing required file_path")

        if timeout_seconds is None:
            return UserModelValidator._validate_file_in_process(Path(path))
        return UserModelValidator._validate_file_with_timeout(Path(path), timeout_seconds)

    @staticmethod
    def _validate_file_with_timeout(
        file_path: Path,
        timeout_seconds: float,
    ) -> UserModelValidationResult:
        context = multiprocessing.get_context("spawn")
        result_queue = context.Queue(maxsize=1)
        process = context.Process(
            target=_validate_file_child,
            args=(str(file_path), result_queue),
        )
        process.start()
        process.join(timeout_seconds)

        if process.is_alive():
            process.terminate()
            process.join(1)
            return UserModelValidationResult(
                ok=False,
                errors=[f"User model validation timed out after {timeout_seconds} seconds"],
            )

        try:
            payload = result_queue.get(timeout=1)
        except Empty:
            exitcode = process.exitcode
            return UserModelValidationResult(
                ok=False,
                errors=[f"User model validation process exited without a result: {exitcode}"],
            )
        finally:
            result_queue.close()

        return UserModelValidationResult(
            ok=bool(payload.get("ok", False)),
            errors=list(payload.get("errors", [])),
            warnings=list(payload.get("warnings", [])),
            display_name=payload.get("display_name"),
            description=payload.get("description"),
            param_schema=dict(payload.get("param_schema", {})),
            output_shape=payload.get("output_shape"),
        )

    @staticmethod
    def _validate_file_in_process(file_path: Path) -> UserModelValidationResult:
        path = Path(file_path)
        errors: list[str] = []
        warnings: list[str] = []

        if path.suffix.lower() != ".py":
            return UserModelValidationResult(
                ok=False,
                errors=[f"User model file must use .py suffix, got {path.suffix or '<none>'}"],
                warnings=warnings,
            )

        try:
            size_bytes = path.stat().st_size
        except OSError as exc:
            return UserModelValidationResult(
                ok=False,
                errors=[f"Could not read user model file: {exc}"],
                warnings=warnings,
            )

        max_size_bytes = config.MAX_USER_MODEL_SIZE_KB * 1024
        if size_bytes > max_size_bytes:
            return UserModelValidationResult(
                ok=False,
                errors=[
                    "User model file exceeds "
                    f"{config.MAX_USER_MODEL_SIZE_KB} KB size limit"
                ],
                warnings=warnings,
            )

        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            return UserModelValidationResult(
                ok=False,
                errors=[f"User model file must be valid UTF-8: {exc}"],
                warnings=warnings,
            )
        except OSError as exc:
            return UserModelValidationResult(
                ok=False,
                errors=[f"Could not read user model file: {exc}"],
                warnings=warnings,
            )

        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError as exc:
            return UserModelValidationResult(
                ok=False,
                errors=[f"Syntax error in user model file: {exc}"],
                warnings=warnings,
            )

        ast_errors = UserModelValidator._validate_ast(tree)
        if ast_errors:
            return UserModelValidationResult(ok=False, errors=ast_errors, warnings=warnings)

        module_name = f"_aresvision_user_model_{uuid.uuid4().hex}"
        try:
            module = UserModelValidator._import_module(path, module_name)
            return UserModelValidator._validate_module(module, warnings)
        except Exception as exc:  # noqa: BLE001 - return validation errors, not service exceptions.
            return UserModelValidationResult(
                ok=False,
                errors=[f"Failed to load user model: {exc}"],
                warnings=warnings,
            )
        finally:
            sys.modules.pop(module_name, None)

    @staticmethod
    def _validate_ast(tree: ast.AST) -> list[str]:
        errors: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".", 1)[0]
                    if root not in ALLOWED_IMPORT_ROOTS:
                        errors.append(f"Disallowed import: {root}")
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    errors.append("Disallowed import: relative import")
                    continue
                root = (node.module or "").split(".", 1)[0]
                if root not in ALLOWED_IMPORT_ROOTS:
                    errors.append(f"Disallowed import: {root or '<unknown>'}")
            elif isinstance(node, ast.Call):
                call_name = UserModelValidator._call_name(node.func)
                if isinstance(node.func, ast.Name) and call_name in DISALLOWED_DIRECT_CALLS:
                    errors.append(f"Disallowed call: {call_name}")
                elif isinstance(node.func, ast.Attribute) and call_name in DISALLOWED_ATTRIBUTE_CALLS:
                    errors.append(f"Disallowed call: {call_name}")
        return errors

    @staticmethod
    def _call_name(func: ast.expr) -> str | None:
        if isinstance(func, ast.Name):
            return func.id
        if isinstance(func, ast.Attribute):
            return func.attr
        return None

    @staticmethod
    def _import_module(path: Path, module_name: str):
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ValueError("could not create module spec")

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def _validate_module(module: Any, warnings: list[str]) -> UserModelValidationResult:
        import torch

        model_spec = getattr(module, "MODEL_SPEC", None)
        if not isinstance(model_spec, dict):
            return UserModelValidationResult(
                ok=False,
                errors=["MODEL_SPEC must be exported as a dict"],
                warnings=warnings,
            )

        build_model = getattr(module, "build_model", None)
        if not callable(build_model):
            return UserModelValidationResult(
                ok=False,
                errors=["build_model(config) must be exported as a callable"],
                warnings=warnings,
            )

        display_name = model_spec.get("name")
        if not isinstance(display_name, str) or not display_name.strip():
            return UserModelValidationResult(
                ok=False,
                errors=["MODEL_SPEC.name must be a non-empty string"],
                warnings=warnings,
            )
        display_name = display_name.strip()

        description = model_spec.get("description")
        if description is not None and not isinstance(description, str):
            return UserModelValidationResult(
                ok=False,
                errors=["MODEL_SPEC.description must be a string when provided"],
                warnings=warnings,
            )

        try:
            normalize_auxiliary_inputs(model_spec)
        except ValueError as exc:
            return UserModelValidationResult(
                ok=False,
                errors=[str(exc)],
                warnings=warnings,
                display_name=display_name,
                description=description,
            )

        param_schema, schema_errors = UserModelValidator._normalize_parameters(
            model_spec.get("parameters", {})
        )
        if schema_errors:
            return UserModelValidationResult(
                ok=False,
                errors=schema_errors,
                warnings=warnings,
                display_name=display_name,
                description=description,
                param_schema=param_schema,
            )

        dry_run_config = {
            "in_channels": 1,
            "window": 3,
            "horizon": 3,
            "height": 8,
            "width": 16,
            "selected_channels": [],
        }
        dry_run_config.update(
            {name: schema["default"] for name, schema in param_schema.items()}
        )

        try:
            model = build_model(dry_run_config)
        except Exception as exc:  # noqa: BLE001
            return UserModelValidationResult(
                ok=False,
                errors=[f"build_model(config) failed: {exc}"],
                warnings=warnings,
                display_name=display_name,
                description=description,
                param_schema=param_schema,
            )

        if not isinstance(model, torch.nn.Module):
            return UserModelValidationResult(
                ok=False,
                errors=["build_model(config) must return torch.nn.Module"],
                warnings=warnings,
                display_name=display_name,
                description=description,
                param_schema=param_schema,
            )

        attach_uploaded_model_contract(model, model_spec)

        try:
            model.eval()
            with torch.no_grad():
                output = run_uploaded_model(
                    model,
                    torch.zeros(2, 3, 1, 8, 16),
                    torch.zeros(2, 3, dtype=torch.float32),
                    context="uploaded model dry-run",
                )
        except Exception as exc:  # noqa: BLE001
            return UserModelValidationResult(
                ok=False,
                errors=[f"Model dry-run failed: {exc}"],
                warnings=warnings,
                display_name=display_name,
                description=description,
                param_schema=param_schema,
            )

        output_shape = list(output.shape) if hasattr(output, "shape") else None
        if output_shape != EXPECTED_OUTPUT_SHAPE:
            return UserModelValidationResult(
                ok=False,
                errors=[
                    "Unexpected output shape: "
                    f"expected {EXPECTED_OUTPUT_SHAPE}, got {output_shape}"
                ],
                warnings=warnings,
                display_name=display_name,
                description=description,
                param_schema=param_schema,
                output_shape=output_shape,
            )

        return UserModelValidationResult(
            ok=True,
            errors=[],
            warnings=warnings,
            display_name=display_name,
            description=description,
            param_schema=param_schema,
            output_shape=output_shape,
        )

    @staticmethod
    def _normalize_parameters(parameters: Any) -> tuple[dict[str, Any], list[str]]:
        if parameters is None:
            return {}, []
        if not isinstance(parameters, dict):
            return {}, ["MODEL_SPEC.parameters must be a dict"]

        normalized: dict[str, Any] = {}
        errors: list[str] = []
        for name, schema in parameters.items():
            if not isinstance(name, str) or not name:
                errors.append("MODEL_SPEC.parameters keys must be non-empty strings")
                continue
            if not name.isidentifier() or keyword.iskeyword(name):
                errors.append(f"Invalid parameter name: {name}")
                continue
            if not isinstance(schema, dict):
                errors.append(f"Parameter {name} must be a dict")
                continue

            field_type = schema.get("type")
            if field_type not in {"int", "float", "bool", "select"}:
                errors.append(f"Parameter {name} has unsupported type: {field_type}")
                continue

            if field_type in {"int", "float"}:
                normalized_schema, field_errors = UserModelValidator._normalize_numeric_param(
                    name,
                    field_type,
                    schema,
                )
            elif field_type == "bool":
                normalized_schema, field_errors = UserModelValidator._normalize_bool_param(
                    name,
                    schema,
                )
            else:
                normalized_schema, field_errors = UserModelValidator._normalize_select_param(
                    name,
                    schema,
                )

            if field_errors:
                errors.extend(field_errors)
                continue
            normalized[name] = normalized_schema

        return normalized, errors

    @staticmethod
    def _normalize_numeric_param(
        name: str,
        field_type: str,
        schema: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        default = schema.get("default")
        min_value = schema.get("min")
        max_value = schema.get("max")
        errors: list[str] = []

        if field_type == "int":
            if not UserModelValidator._is_int(default):
                errors.append(f"Parameter {name} default must be an int")
            if not UserModelValidator._is_int(min_value):
                errors.append(f"Parameter {name} min must be an int")
            if not UserModelValidator._is_int(max_value):
                errors.append(f"Parameter {name} max must be an int")
        else:
            if not UserModelValidator._is_number(default):
                errors.append(f"Parameter {name} default must be numeric")
            if not UserModelValidator._is_number(min_value):
                errors.append(f"Parameter {name} min must be numeric")
            if not UserModelValidator._is_number(max_value):
                errors.append(f"Parameter {name} max must be numeric")

        if errors:
            return {}, errors
        if min_value > max_value:
            return {}, [f"Parameter {name} min must be less than or equal to max"]
        if default < min_value or default > max_value:
            return {}, [f"Parameter {name} default must be between min and max"]

        return {
            "type": field_type,
            "default": default,
            "min": min_value,
            "max": max_value,
        }, []

    @staticmethod
    def _normalize_bool_param(
        name: str,
        schema: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        default = schema.get("default")
        if not isinstance(default, bool):
            return {}, [f"Parameter {name} default must be boolean"]
        return {"type": "bool", "default": default}, []

    @staticmethod
    def _normalize_select_param(
        name: str,
        schema: dict[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        options = schema.get("options")
        default = schema.get("default")
        if not isinstance(options, list) or not options:
            return {}, [f"Parameter {name} options must be a non-empty list"]
        if not all(isinstance(option, str) for option in options):
            return {}, [f"Parameter {name} select options must be strings"]
        if not all(option.strip() for option in options):
            return {}, [f"Parameter {name} select options must be non-empty strings"]
        if not isinstance(default, str):
            return {}, [f"Parameter {name} select default must be a string"]
        if default not in options:
            return {}, [f"Parameter {name} default must be one of options"]
        return {
            "type": "select",
            "default": default,
            "options": list(options),
        }, []

    @staticmethod
    def _is_int(value: Any) -> bool:
        return isinstance(value, int) and not isinstance(value, bool)

    @staticmethod
    def _is_number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_file_child(file_path: str, result_queue: Any) -> None:
    try:
        result = UserModelValidator._validate_file_in_process(Path(file_path))
        result_queue.put(
            {
                "ok": result.ok,
                "errors": result.errors,
                "warnings": result.warnings,
                "display_name": result.display_name,
                "description": result.description,
                "param_schema": result.param_schema,
                "output_shape": result.output_shape,
            }
        )
    except BaseException as exc:  # noqa: BLE001 - child process must report failures.
        result_queue.put(
            {
                "ok": False,
                "errors": [f"User model validation process failed: {exc}"],
                "warnings": [],
                "display_name": None,
                "description": None,
                "param_schema": {},
                "output_shape": None,
            }
        )
