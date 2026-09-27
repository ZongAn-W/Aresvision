# 实验中心验收夹具

本目录的脚本用于**实验中心（`#/training`）的浏览器验收**：验证三列控制台布局、sticky 侧栏、
上传模型主入口、官方架构选择器、底部运行条、响应式无横向溢出，以及训练监控与结果工作区
仍然可用。它们**不属于应用运行时**，只在改版后手动执行。

| 文件 | 作用 |
| --- | --- |
| `seed-probe-profile.mjs` | 建立 / 清理一次性验收档案：临时账号、通过校验的探针上传模型、可选的 running / completed 任务与真实日志文件 |
| `verify-console.mjs` | 61 项控制台检查（布局、sticky、上传模型主入口、官方架构选择器、检查器联动、响应式、可访问性） |
| `verify-stages.mjs` | 21 项阶段检查（监控阶段的进度 / Loss / 终端日志，结果阶段的指标 / 折叠日志 / 复制配置回填） |

## 前置条件

1. **构建前端**：在 `frontend/` 执行 `npm run build`。
2. **后端在跑**：`GET http://127.0.0.1:8000/health` 返回 200（验收会调用任务列表、日志与登录接口）。
3. **生产静态服务在跑**：在仓库根目录执行 `node scripts/serve-prod.mjs`（`ROOT=frontend/dist`、`PORT=5173`、`API_PORT=8000`），
   或任何等价地把 `frontend/dist` 与 `/api` 代理到后端的静态服务。
4. **无头浏览器**：启动带远程调试端口的 Edge/Chrome，例如
   `msedge --headless=new --remote-debugging-port=9333 --user-data-dir=%TEMP%\aresvision-audit`。

## 执行

```powershell
# 1) 建立验收档案（账号 + 探针上传模型 + running/completed 任务）
node scripts\audit\experiment-console\seed-probe-profile.mjs prepare

# 2) 两套验收（默认读取上一步写出的 .probe-profile.json 里的 JWT）
node scripts\audit\experiment-console\verify-console.mjs --port 9333
node scripts\audit\experiment-console\verify-stages.mjs --port 9333

# 3) 清理：删除账号、上传模型、任务、日志文件与临时文件
node scripts\audit\experiment-console\seed-probe-profile.mjs cleanup
```

只做布局检查时可以用 `--no-tasks` 跳过任务注入；也可以直接用 `--token <jwt>` 指向别的账号。

## 注意

- **只对本地开发库运行。** `seed-probe-profile.mjs` 会直接写 `data/aresvision.db` 并创建账号，
  `cleanup` 会删除该账号及其模型、任务、标签与日志。
- 探针模型源码（`.probe-surface-net.py`）与登录 JWT（`.probe-profile.json`）都已加入 `.gitignore`，
  不要提交或外传。
- 目标准确率依赖视口：脚本使用 CDP 设置 1440×900 / 1024×768 / 390×844 三档，并在改动布局后
  重新确认 sticky 吸附位置（86px）与运行条贴底位置。
- 账号里存在运行中的实验时页面会自动进入监控阶段（既有行为），因此 `verify-console.mjs`
  先点“新建实验”回到配置阶段再检查配置相关项。
