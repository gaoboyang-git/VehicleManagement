# Web 公务用车使用登记及管理系统

## 当前范围

当前版本已完成 Issue 0、Issue 1、Issue 2、Issue 3、Issue 4、Issue 5 和 Issue 6：

- Issue 0：项目骨架、数据库迁移、种子数据和测试基础设施。
- Issue 1：账号密码登录、退出登录、登录态保存与失效、修改本人密码。
- Issue 2：管理员用户列表、新增用户、删除用户、重置普通用户密码，保护内置 `admin`。
- Issue 3：管理员车辆列表、新增车辆、删除车辆，登录后登记页车辆下拉只展示未删除车辆。
- Issue 4：公务用车登记表单、按车辆独立回填默认起步公里、自动计算行车公里、跨天登记、失效车辆拦截。
- Issue 5：管理员用车记录列表、删除记录、删除后默认起步公里回退。
- Issue 6：管理员操作日志查询、PDF 导出、结果筛选与审计追踪能力。

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- 数据库：MySQL
- ORM 与迁移：Prisma
- 测试：Vitest + Supertest + Testing Library

## 本地启动

```bash
npm install
npm run db:init
npm run dev:server
npm run dev:client
```

后端健康检查地址：

```text
http://localhost:3000/api/health
```

前端默认地址：

```text
http://localhost:5173
```

## 数据库

数据库结构通过 Prisma Migrate 创建，初始数据通过 Prisma seed 写入。当前项目已切换为 MySQL，继续保留 Prisma schema、Client、migrate、seed 的标准使用方式。

```bash
npm run db:migrate
npm run db:seed
```

seed 会幂等写入内置管理员账号 `admin`，重复执行不会创建多个 `admin`。

初始管理员登录信息：

```text
账号：admin
密码：admin
```

## 测试

```bash
npm test
```

## 生产部署

当前项目适合以单个 Node Web Service 方式部署，前端构建产物由 Express 统一托管，API 与页面同域访问。

仓库已包含 [render.yaml](/Users/duibagroup/Desktop/Vibe%20Coding/render.yaml:1) 可直接用于 Render Blueprint。由于当前数据库已切换为 MySQL，线上部署需要在 Render 控制台中配置有效的 `DATABASE_URL`，而不再依赖本地 SQLite 文件挂载。
