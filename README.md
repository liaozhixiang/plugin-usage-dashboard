# plugin-usage-dashboard

一个轻量的本地看板，用于读取 NX 插件使用记录文本并可视化分析。支持以下两种运行方式：

- **Windows 桌面端（推荐）**：基于 Electron（内置 Chromium），无需安装浏览器，双击安装包即可运行。
- **浏览器网页**：直接用 Chrome / Edge 打开 `index.html`。

## 已实现能力

- 选择本地文件夹并读取其中所有 `.txt` 文件
- 左侧 NX 工具单选（点击即选中并高亮）
- 导入文件夹时仅读取 txt 文件名，不立即解析文本内容
- 选择工具后按需解析 txt 数据
- 选择工具后展示该工具下所有管理号
- 点击管理号查看该管理号的全部使用明细
- 核心指标展示
- 日使用频率趋势图
- 工具成功率图
- 项目总时长 Top 10 图
- 时间范围和工具维度过滤
- 坏行统计（格式错误、时间错误、状态非法等）

## 数据格式

每个文件表示一个插件工具（例如 `toolA.txt`、`toolB.txt`），每行格式：

```text
<user>,<starttime>,<ProjectID>,<endtime>,<state>
```

示例：

```text
alice,2026-04-20 09:10:00,PJT-001,2026-04-20 09:24:10,Success
bob,2026-04-20 10:01:00,PJT-002,2026-04-20 10:08:40,Fail
```

说明：

- `state` 仅支持 `Success` 或 `Fail`（大小写不敏感）
- 结束时间必须晚于开始时间
- 空行会被忽略；非法行计入坏行统计

## Windows 桌面端（Electron）

### 前置条件

- [Node.js](https://nodejs.org/) 18 或更高版本

### 开发运行

```bash
npm install
npm start
```

### 打包成 Windows 安装包

```bash
npm install
npm run build
```

打包完成后，安装包位于 `dist/` 目录（`.exe` NSIS 安装包），双击即可在 Windows 上安装并运行，无需依赖已安装的浏览器。

如只需查看解压后的目录结构（不打包安装包）：

```bash
npm run build:dir
```

## 浏览器网页模式

方式一：直接打开

1. 用 Chrome 或 Edge 打开 `index.html`
2. 点击“选择数据文件夹”（此时只读取 txt 文件名）
3. 在左侧点击一个 NX 工具，页面会自动分析该工具数据
4. 在管理号列表中点击目标管理号，查看使用明细
5. 使用日期筛选并查看看板与图表

方式二：本地静态服务（可选）

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 指标口径

- 总记录数：过滤后记录总数
- 成功率：`Success / 全部记录`
- 成功平均时长：仅 `Success` 记录的平均 `(end - start)`
- 活跃用户数：过滤后去重用户数
- P90 使用时长：过滤后成功记录时长的 90 分位
- 平均每日使用次数：`总记录数 / 有记录的天数`

## 当前技术限制

- 暂未实现导出 CSV 或图片
- 暂未接入 Web Worker（超大数据量下可继续优化）
- 桌面端字体依赖网络加载 Google Fonts；离线环境下会回退到系统 sans-serif 字体，不影响功能
