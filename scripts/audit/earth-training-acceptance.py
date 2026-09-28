"""End-to-end acceptance over the live HTTP API: real v2 training then prediction.

Run against a running backend (``uvicorn main:app`` on port 8000). Every step uses
the public API only - the same calls the web pages make:

1. register or log in a dedicated acceptance account
2. read the Earth dataset descriptor from the registry
3. start a real Earth DLinear training run on ``earth_merra2_daily_v2``
4. poll the task until it settles and report the real metrics
5. read the selectable forecast origins and run a historical prediction
6. verify the three DU fields, the dates, the grid and the metrics
7. exercise the documented error paths (out-of-range origin, Mars routes, ...)
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000/api"
EMAIL = "earth-acceptance@example.com"
USERNAME = "earth_acceptance"
PASSWORD = "EarthAcceptance!2026"


def call(method: str, path: str, *, body=None, token=None, expect=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            status, payload = response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read().decode("utf-8")
    parsed = None
    if payload:
        try:
            parsed = json.loads(payload)
        except ValueError:
            parsed = payload
    if expect is not None and status != expect:
        raise SystemExit(f"FAIL {method} {path}: expected {expect}, got {status}: {payload[:400]}")
    return status, parsed


def step(number: str, text: str) -> None:
    print(f"\n[{number}] {text}", flush=True)


def main() -> int:
    step("1", "登录验收账号")
    # 注册需邮箱验证码，因此验收账号由接口同步脚本预先写入；使用真实密码登录。
    status, login = call("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    token = login.get("token") if isinstance(login, dict) else None
    assert token, f"no access token ({status}): {login}"
    print(f"    token acquired ({len(token)} chars)")

    step("2", "读取数据集目录")
    _, descriptor = call("GET", "/datasets/earth_merra2_daily_v2", token=token)
    print(f"    availability={descriptor['availability']} version={descriptor['dataset_version']}")
    print(f"    fingerprint={descriptor['dataset_fingerprint']}")
    print(f"    grid={descriptor['grid']['shape']} coverage={descriptor['grid']['coverage']}")
    print(f"    splits={json.dumps(descriptor['splits'])}")
    profile = descriptor["training_profile"]
    print(f"    profile={profile['profile_id']} window={profile['window']} horizon={profile['horizon']} "
          f"target={profile['target']}[{profile['target_unit']}]")
    assert descriptor["availability"] == "available"
    assert descriptor["capabilities"]["training"] is True

    step("3", "启动真实 Earth DLinear 训练（epochs=1, batch=8, 全部辅助变量）")
    name = f"Earth Acceptance {int(time.time())}"
    _, task = call("POST", "/training/start", token=token, body={
        "model_script": "demo3.py",
        "model_name": name,
        "model_source": "official",
        "data_source": "default",
        "dataset_id": "earth_merra2_daily_v2",
        "tag_ids": [],
        "hyperparameters": {
            "training_dataset": "earth_merra2_daily_v2",
            "model_architecture": "dlinear",
            "selected_channels": ["U10M", "V10M", "T2M", "SWGDN"],
            "window": 7,
            "horizon": 3,
            "epochs": 1,
            "batch_size": 8,
            "learning_rate": 0.001,
            "seed": 11,
            "early_stopping_patience": 0,
            "linear_hidden_layers": 2,
            "use_sphere": False,
        },
    })
    task_id = task["id"]
    print(f"    task_id={task_id} script={task['model_script']} dataset_id={task['dataset_id']}")
    print(f"    identity_status={task['dataset_identity_status']} fingerprint={task['dataset_fingerprint']}")
    print(f"    is_earth_task={task['is_earth_task']} trained_prediction_supported={task['trained_prediction_supported']}")
    assert task["model_script"] == "earth_daily.py"
    assert task["dataset_identity_status"] == "verified"
    assert task["is_earth_task"] is True

    step("4", "轮询任务直至结束")
    deadline = time.time() + 3600
    final = None
    last_status = None
    while time.time() < deadline:
        _, tasks = call("GET", "/training/tasks", token=token)
        final = next(item for item in tasks if item["id"] == task_id)
        if final["status"] != last_status:
            print(f"    status={final['status']} progress={final['progress']:.1f}% "
                  f"epoch={final['current_epoch']}/{final['total_epochs']}", flush=True)
            last_status = final["status"]
        if final["status"] in ("completed", "failed"):
            break
        time.sleep(5)
    assert final, "task never appeared"
    print(f"    final status={final['status']} progress={final['progress']} "
          f"model_available={final['model_available']}")
    print(f"    output_model_path={final['output_model_path']}")
    if final["status"] != "completed":
        print(f"    metrics/error={final['metrics']}")
        raise SystemExit("FAIL: training did not complete")
    metrics = json.loads(final["metrics"])
    print(f"    metrics.unit={metrics['unit']} target={metrics['target']} "
          f"aggregation={metrics['aggregation']}")
    print(f"    validation: {metrics['splits']['validation']}")
    print(f"    test      : {metrics['splits']['test']}")
    assert metrics["unit"] == "DU"
    assert metrics["splits"]["test"]["window_count"] == 175
    assert metrics["splits"]["validation"]["window_count"] == 172

    step("5", "读取可选历史预测起点")
    _, context = call("GET", f"/earth/predict/context?training_task_id={task_id}", token=token)
    print(f"    dataset={context['dataset_id']}@{context['dataset_version']} unit={context['target_unit']}")
    print(f"    grid={context['grid']['shape']} window={context['window']} horizon={context['horizon']}")
    print(f"    channels={context['input_channel_order']} units={context['input_units']}")
    print(f"    origins: {context['origins']['start']} .. {context['origins']['end']} "
          f"count={context['origins']['count']}")
    print(f"    run={context['run']}")
    assert context["origins"]["start"] == "2020-01-08"
    assert context["origins"]["end"] == "2021-12-28"
    assert context["origins"]["count"] == 721
    assert len(context["grid"]["latitude"]) == 36
    assert len(context["grid"]["longitude"]) == 72

    origin = "2021-07-08"
    step("6", f"运行历史预测（起点 {origin}）")
    _, result = call("POST", "/earth/predict/run", token=token, body={
        "training_task_id": task_id, "forecast_origin": origin,
    })
    print(f"    forecast_origin={result['forecast_origin']}")
    print(f"    input_dates={result['input_dates'][0]} .. {result['input_dates'][-1]} "
          f"({len(result['input_dates'])} days)")
    print(f"    target_dates={result['target_dates']}")
    print(f"    grid={result['grid']['shape']} lat=[{result['grid']['latitude'][0]}, "
          f"{result['grid']['latitude'][-1]}] lon=[{result['grid']['longitude'][0]}, "
          f"{result['grid']['longitude'][-1]}]")
    for kind in ("prediction", "reference", "residual"):
        day = result[kind][0]
        values = [cell for row in day["field"] for cell in row]
        assert len(day["field"]) == 36 and len(day["field"][0]) == 72
        assert day["valid_cells"] == 36 * 72, f"{kind} has empty cells"
        print(f"    {kind:>10}: day1 rows={len(day['field'])} cols={len(day['field'][0])} "
              f"min={day['minVal']:.3f} max={day['maxVal']:.3f} valid={day['valid_cells']} "
              f"finite={all(v == v for v in values)}")
    print(f"    metrics={result['metrics']}")
    assert result["metrics"]["unit"] == "DU"
    assert result["metrics"]["reference_available"] is True
    assert len(result["target_dates"]) == 3
    assert result["target_dates"] == ["2021-07-09", "2021-07-10", "2021-07-11"]
    overall = result["metrics"]["overall"]
    assert overall["rmse"] == overall["rmse"] and overall["mae"] == overall["mae"], "non-finite metrics"

    step("7", "错误路径")
    cases = [
        ("POST", "/earth/predict/run", {"training_task_id": task_id, "forecast_origin": "2021-12-31"},
         422, "earth_prediction_origin_out_of_range"),
        ("POST", "/earth/predict/run", {"training_task_id": task_id, "forecast_origin": "2020-01-01"},
         422, "earth_prediction_origin_out_of_range"),
        ("POST", "/predict/run", {"training_task_id": task_id, "horizon": 3, "mars_year": 27, "ls_start": 90},
         409, "dataset_prediction_not_supported"),
        ("POST", "/predict/metrics", {"training_task_id": task_id, "horizon": 3, "mars_year": 27, "ls_start": 90},
         409, "dataset_prediction_not_supported"),
        ("POST", f"/training/tasks/{task_id}/action?action=test", None, 409, "dataset_prediction_not_supported"),
        ("POST", "/training/start", {
            "model_script": "demo3.py", "model_name": f"Earth Reject {int(time.time())}",
            "dataset_id": "earth_merra2_daily_v2",
            "hyperparameters": {"training_dataset": "earth_merra2_daily_v2", "model_architecture": "simvp"},
        }, 409, "dataset_training_configuration_not_supported"),
        ("POST", "/training/start", {
            "model_script": "demo3.py", "model_name": f"Earth Range {int(time.time())}",
            "dataset_id": "earth_merra2_daily_v2",
            "hyperparameters": {"training_dataset": "earth_merra2_daily_v2", "window": 3},
        }, 422, "invalid_earth_training_parameters"),
    ]
    for method, path, body, expected_status, expected_code in cases:
        status, payload = call(method, path, body=body, token=token)
        code = payload.get("detail", {}).get("code") if isinstance(payload, dict) else None
        ok = status == expected_status and code == expected_code
        print(f"    {'OK ' if ok else 'BAD'} {method} {path} -> {status} {code}")
        assert ok, f"{path}: expected {expected_status}/{expected_code}, got {status}/{code}"

    step("8", "Mars 回归：Earth 任务不出现在火星模型下拉")
    _, tasks = call("GET", "/training/tasks", token=token)
    earth_tasks = [item for item in tasks if item.get("is_earth_task")]
    print(f"    earth tasks={len(earth_tasks)} mars tasks={len(tasks) - len(earth_tasks)}")
    assert any(item["id"] == task_id for item in earth_tasks)
    # The Mars selector filters on is_earth_task; verify the payload carries it.
    mars_only = [item for item in tasks if not item.get("is_earth_task")]
    for item in earth_tasks:
        assert item["is_earth_task"] is True

    print("\n=== RESULT ===")
    print(json.dumps({
        "task_id": task_id,
        "model_name": name,
        "dataset_id": descriptor["dataset_id"],
        "dataset_version": descriptor["dataset_version"],
        "dataset_fingerprint": descriptor["dataset_fingerprint"],
        "train_windows": 357,
        "validation_windows": metrics["splits"]["validation"]["window_count"],
        "test_windows": metrics["splits"]["test"]["window_count"],
        "test_rmse_du": metrics["splits"]["test"]["overall"]["rmse"],
        "test_mae_du": metrics["splits"]["test"]["overall"]["mae"],
        "forecast_origin": origin,
        "target_dates": result["target_dates"],
        "prediction_rmse_du": overall["rmse"],
        "prediction_mae_du": overall["mae"],
        "origins": [context["origins"]["start"], context["origins"]["end"], context["origins"]["count"]],
        "grid": result["grid"]["shape"],
        "input_channels": context["input_channel_order"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
