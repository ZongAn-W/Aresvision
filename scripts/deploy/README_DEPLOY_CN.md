# AstraAtmos Linux 一键部署说明

平台原名 AresVision；部署目录、脚本和服务名沿用原名称，现有配置无需迁移。

适用环境：Ubuntu 22.04 GPU 服务器，不依赖 Docker。

## 首次部署

```bash
cd /home/ubuntu/AresVision
bash scripts/deploy/aresvision.sh install
```

脚本会安装系统依赖、Node.js、Python 虚拟环境、PyTorch、后端依赖，构建前端，并创建 `aresvision.service`。

## 上传覆盖后重新部署

```bash
cd /home/ubuntu/AresVision
bash scripts/deploy/aresvision.sh deploy
```

适合你在本地修改项目后，把文件上传覆盖到服务器，再快速重建和重启。

## Git 更新后部署

```bash
cd /home/ubuntu/AresVision
bash scripts/deploy/aresvision.sh update
```

该命令会执行 `git pull --ff-only`，然后自动走重新部署流程。

## 常用运维命令

```bash
bash scripts/deploy/aresvision.sh status
bash scripts/deploy/aresvision.sh logs
bash scripts/deploy/aresvision.sh health
bash scripts/deploy/aresvision.sh restart
bash scripts/deploy/aresvision.sh stop
bash scripts/deploy/aresvision.sh backup
```

## 访问地址

默认端口是 `8000`：

```text
http://服务器公网IP:8000
```

健康检查：

```text
http://服务器公网IP:8000/health
```

## 环境变量

后端环境文件位于：

```text
AresVision_backend/backend/.env
```

首次部署时脚本会保留已有 `.env`。如果不存在，则从 `.env.example` 创建，并补充部署需要的默认值。

重要配置：

```env
JWT_SECRET_KEY=部署时自动生成或自行设置
AI_API_KEY=你的 AI 接口密钥
MCD_RAW_3H_DIR=/home/ubuntu/Data/MCD_Output_global_10m_ls_lst
TRAINING_PYTHON_PATH=/home/ubuntu/AresVision/AresVision_backend/backend/.venv/bin/python
```

## 数据保留

重新部署不会主动删除：

- `AresVision_backend/backend/.env`
- `AresVision_backend/backend/data`
- `AresVision_backend/backend/models`
- `AresVision_backend/backend/logs`

## 备份

```bash
bash scripts/deploy/aresvision.sh backup
```

备份默认保存到：

```text
/home/ubuntu/aresvision-backups/
```

## 排错

查看服务状态：

```bash
systemctl status aresvision --no-pager
```

查看实时日志：

```bash
journalctl -u aresvision -f
```

如果前端页面没有更新，重新运行：

```bash
bash scripts/deploy/aresvision.sh deploy
```

如果 AI 对话不可用，检查 `.env` 中的 `AI_API_KEY`。
