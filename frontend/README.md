

# AresVision 智绘赤星 — 前端本地运行指南

---

## 环境准备（只需一次）

### 1. 安装 Node.js

前往 https://nodejs.org 下载 **LTS 版本**（≥18），安装后打开终端验证：

```bash
node --version    # 应显示 v18.x.x 或更高
npm --version     # 应显示 9.x.x 或更高
```

### 2. 在 PyCharm 中打开项目

1. 用 PyCharm 打开整个 `AresVision/` 目录
2. PyCharm 会自动识别 `frontend/` 为前端子项目
3. 建议安装 PyCharm 的 **JavaScript and TypeScript** 插件（通常自带）

---

## 启动前端（每次开发时）

打开 PyCharm 的 **Terminal**（底部面板），执行：

```bash
# 1. 进入前端目录
cd frontend

# 2. 首次运行需安装依赖（之后不用重复）
npm install

# 3. 启动开发服务器
npm run dev
```

你会看到类似输出：

```
  VITE v6.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

**浏览器打开 http://localhost:5173 即可看到页面。**

修改任何 `.jsx` 文件后保存，浏览器会自动热更新，无需手动刷新。

---

## 项目结构说明

```
AresVision/
├── AresVision_backend/
│   └── backend/                 ← FastAPI 后端
│       ├── main.py              ← 应用入口 + lifespan 初始化
│       ├── config.py            ← 全局配置常量
│       ├── auth/                ← JWT 认证模块
│       │   ├── security.py      ← 密码哈希 / Token 生成验证
│       │   └── dependencies.py  ← FastAPI Depends 函数
│       ├── database/
│       │   ├── engine.py        ← SQLAlchemy async engine
│       │   └── models.py        ← User / UploadRecord / Notification / Feedback
│       ├── routers/             ← API 路由
│       │   ├── auth.py          ← /api/auth/*（注册/登录/验证码/找回密码）
│       │   ├── upload.py        ← /api/upload/*（文件上传/贡献/审核）
│       │   ├── notification.py  ← /api/notification/*（站内通知）
│       │   ├── user_data.py     ← /api/user-data/*（用户数据可视化）
│       │   ├── feedback.py      ← /api/feedback/*（用户反馈）
│       │   ├── analysis.py      ← /api/explore/*（内置数据探索）
│       │   ├── predict.py       ← /api/predict/*（预测）
│       │   └── ai.py            ← /api/ai/*（AI 对话）
│       ├── services/            ← 业务逻辑层
│       │   ├── upload_service.py    NC 文件校验 + SHA256 去重
│       │   ├── user_data_service.py 用户数据按需读取 + 热更新
│       │   ├── email_service.py     QQ SMTP 发送验证码
│       │   ├── analysis_service.py  内置数据分析
│       │   └── ai_service.py        LLM 对话
│       └── core/                ← ML 核心模块
│
└── frontend/                    ← React 前端
    ├── index.html               ← HTML 入口（Google Fonts: Orbitron + Exo 2）
    ├── package.json             ← 依赖声明
    ├── vite.config.js           ← Vite 配置（/api/* → localhost:8000 代理）
    └── src/
        ├── main.jsx             ← 应用挂载点：SettingsProvider > ToastProvider > AuthProvider > App + AuthModal + Toast
        ├── App.jsx              ← 根组件：页面路由（hash） + 全局弹窗状态
        ├── index.css            ← 全局样式 + observation-window CSS 类
        │
        ├── constants/
        │   └── colors.js        ← 颜色 Token（C.mars / C.blue / C.ice 等）
        │
        ├── i18n/
        │   ├── index.js         ← useT() Hook
        │   ├── zh.js            ← 中文文案
        │   └── en.js            ← 英文文案
        │
        ├── utils/
        │   └── colormaps.js     ← 7 套色彩映射（Inferno/Viridis/Plasma/Magma/Cividis/Jet/RdBu）
        │
        ├── hooks/
        │   └── useScrollLock.js ← 模块级 lockCount，支持多层弹窗
        │
        ├── contexts/
        │   ├── SettingsContext.jsx   ← 语言/主题/Colormap/单位制/精度/导出，持久化 localStorage
        │   ├── AuthContext.jsx       ← 登录状态/token/user，自动注入 Bearer 请求头
        │   ├── ToastContext.jsx      ← 全局 Toast 队列，showToast(msg, type)
        │   └── DataOverviewContext.jsx ← DataOverviewPage 内部状态
        │
        ├── components/
        │   ├── Navbar.jsx            ← 导航栏（用户头像下拉/通知铃铛/管理员入口）
        │   ├── SettingsFab.jsx       ← 左下角浮动按钮（语言/主题/Colormap 快捷切换）
        │   ├── SettingsPanel.jsx     ← 右侧完整设置抽屉
        │   ├── AuthModal.jsx         ← 登录/注册/找回密码（createPortal）
        │   ├── NotificationPanel.jsx ← 站内通知抽屉
        │   ├── AdminReviewPanel.jsx  ← 管理员 NC 文件审核抽屉
        │   ├── FeedbackManagePanel.jsx ← 管理员反馈管理抽屉
        │   ├── FeedbackModal.jsx     ← 用户反馈提交弹窗（支持截图）
        │   ├── ContributeModal.jsx   ← 三步贡献向导（createPortal）
        │   ├── ContributeHistoryPanel.jsx ← 贡献记录抽屉
        │   ├── ChangePasswordModal.jsx ← 修改密码（createPortal）
        │   ├── ConfirmDialog.jsx     ← 通用确认对话框（createPortal）
        │   ├── Toast.jsx             ← Toast 通知条（createPortal）
        │   ├── StarField.jsx         ← 星空粒子背景
        │   ├── GlowCard.jsx          ← 发光卡片
        │   ├── SectionTitle.jsx      ← 区块标题
        │   ├── Mars3DPlaceholder.jsx ← Three.js 火星球体（3 光源系统）
        │   └── SphericalFieldCanvas.jsx ← DataOverviewPage 球面场渲染
        │
        ├── pages/
        │   ├── HomePage.jsx          ← 首页（3D 火星 + feature cards）
        │   ├── DataOverviewPage.jsx  ← 数据中心（react-globe.gl + 6 数据窗口）
        │   ├── ExplorePage.jsx       ← 数据探索（含 MyDataTab 用户数据管理）
        │   ├── PredictPage.jsx       ← 已训练模型预测与多模型对比（Canvas 场可视化）
        │   ├── AIPage.jsx            ← AI 对话助手
        │   └── AboutPage.jsx         ← 关于页面
        │
        └── services/
            └── api.js               ← 全部后端调用封装（fetch + Auth header 注入）
```

---

## 运行后端

```bash
cd AresVision_backend/backend
pip install -r requirements.txt
pip install torch==2.5.1       # CPU；或安装对应 CUDA 版本
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

`vite.config.js` 已配置代理：前端所有 `/api/*` 请求自动转发到 `http://localhost:8000`。

**开发时需同时运行两个终端：**
- 终端 1：`cd AresVision_backend/backend && uvicorn main:app --reload`
- 终端 2：`cd frontend && npm run dev`

**环境变量**（`AresVision_backend/backend/.env`，不提交 git）：

```env
AI_API_KEY=your_gemini_api_key
JWT_SECRET_KEY=your_random_secret
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your_qq@qq.com
SMTP_PASSWORD=your_qq_auth_code
```

---

## 常见问题

**Q: `npm install` 报错？**
A: 确认 Node.js 版本 ≥ 18。用 `node --version` 检查。

**Q: 页面空白？**
A: 打开浏览器 F12 控制台看报错信息。

**Q: 如何加新页面？**
A: 在 `pages/` 下创建新文件，在 `App.jsx` 的 `VALID_PAGES` 数组和渲染条件中注册，在 `Navbar.jsx` 中添加导航项。

**Q: 注册/登录报错"无法连接到服务器"？**
A: 确认后端已启动（`uvicorn` 运行在 8000 端口），且 `.env` 中 `JWT_SECRET_KEY` 已设置。

**Q: 验证码发不出去？**
A: 检查 `.env` 中 SMTP 配置；QQ 邮箱需在设置中开启 SMTP 并获取授权码（非登录密码）。

**Q: 弹窗/模态框出现在屏幕角落位置不对？**
A: 检查该组件是否使用了 `ReactDOM.createPortal(..., document.body)`。Navbar 的 `backdrop-filter` 会创建新 containing block，导致子组件 `position:fixed` 失效。
