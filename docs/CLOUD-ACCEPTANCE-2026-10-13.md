# 云实例验收 · 2026-10-13

本次仅使用 `/workspace/tome-workbench`，没有在 Mac 开发。开工远端只读核对 `main=dfa1de8da4c9ea6d4b5f2ed980206955ebd8db4d`，工作树干净，仓库身份 `BA7IEE/tome-workbench`，版本 rc.14。仓库内与 `/workspace` 未提供 `.agents/skills`；已读 AGENTS、当前架构/业务/AC、Foundation、商品工作流、package/lock 与两个 CI workflow，旧 README/WORKING-STATE 中的 Mac/旧 PR 叙述不作为本轮基线。

## 本实例实际结果

| 检查 | 结果及范围 |
| --- | --- |
| 默认运行时 | Node 24.19.0、npm 11.9.0 |
| 本次运行时 | 在任务外部缓存使用 Node 22.22.3、npm 10.9.8，与 CI Node、声明 packageManager 对齐；未改全局运行时或持久凭据 |
| 依赖 | 锁文件 `npm ci` 成功，463 包；package/lock 未修改，无 peer bypass |
| PostgreSQL | 单独创建 `tome-ux-test-pg`，使用 CI 固定的 PostgreSQL 16 镜像摘要，仅绑定本机 55438；一次性合成账户与空 `tome_dev`，目标测试库限定本机 `tome_test` |
| Prisma 客户端 | BLOCKED：锁定 6.19.3 的官方 schema/query engine 下载及校验下载均被网络代理拒绝（403）；普通调用及临时授权网络调用均未解决；没有忽略校验或使用非官方镜像 |
| prepare-test / 迁移 / 合成服务 | NOT_RUN：缺少可运行的 Prisma 引擎；没有触碰任何生产/其他应用数据库 |
| Playwright 官方缓存 | BLOCKED：官方 CDN 与微软下载地址均返回 403；不把系统 Chromium 当成官方双浏览器安装通过 |
| 完整 typecheck / API build / DB 集成 / 双浏览器 / HA / 恢复 / verify:release / pack | NOT_RUN：依赖上述运行准备；现有 GitHub CI 执行固定 PR head 完整验收 |
| Library 方案 | 按本轮 Library 技能两次 materialize `libfile_948395635e488191ae6bd74c838c64ef` v0，下载均失败，未取得可读本地文件；按授权中明确的第一批范围继续实施，没有借用其他环境路径 |
| GitHub | 只读远端核对与普通 push dry-run 成功；CLI token 状态无效，连接器仓库读取成功，后续 Draft PR 采用连接器；不修改持久凭据 |

独立检查已通过：前端 `tsc --noEmit -p web/tsconfig.json`、全项目 lint、前端 build、Foundation admission、70 个脚本语法、audit（0 vulnerabilities）。尝试部分 Node 测试得到 16 通过、2 个文件因缺少 API dist 无法加载，不能称该组通过。单独 Harness selftest 初次 31/33，通过的负向守卫保留；2 个失败均为本地还没有当前源码验证摘要/指纹。提交前生成明确 pending 摘要后，静态 selftest 33/33、198 项静态守卫全部通过；pending 仍为 passed=false，不表示完整运行通过。本轮代码运行证据以现有 CI 对应固定 SHA 和源码指纹为准。

## 全新任务 setup 复现

状态为 **NOT_RUN**。本次是一个新实例上的手工准备验收，不等于已验证保存环境的 setup 能在下一个任务自动复现。没有修改保存环境网络安全策略或持久凭据。新任务必须重新确认运行时、锁文件安装、Prisma 原生引擎、迁移、Playwright Chromium/WebKit 与系统依赖，不能复用本实例已有缓存的结论。

复现顺序采用仓库/官方流程：固定 Node 22.22.3 与 npm 10.9.8 → `npm ci` → `npm run db:generate` → 在本机独立 PostgreSQL 设置仅用于合成数据的 DATABASE_URL → `node scripts/prepare-test.mjs` → `npx playwright install --with-deps chromium webkit` → `npm run typecheck && npm run lint && npm run build` → `npm run verify:release` → audit、pack。不得使用生产 URL、真实经营数据或降低校验来补齐准备。

Prisma 与 Playwright 的官方下载被网络代理以 403 阻断；Library 材料两次下载失败，返回的是通用下载失败信息，未取得可读文件。保存环境 setup 的修复与全新任务复现仍未验收。可继续使用现有 GitHub-hosted CI 的独立 PostgreSQL、真实登录、原文件和两浏览器完成代码回归。

首轮 CI `38433294741` 对 head `1a99acb` 的完整类型、lint、API/web build、单元 51/51、Harness 33/33、集成 174/174 通过；Chromium 205 通过、2 失败，WebKit/HA/恢复/pack 尚未执行。两个新增列表用例把分页设为后端拒绝的 20（正式合同只允许 30/60/100），进入了读取错误页而等不到选择控件；测试已改为合法 30，并先检查真实列表 API 与页面加载。没有扩大超时、模拟成功或修改业务分页合同；后续新固定 head 必须重新完整验收。

第二轮 `38435479958` 对 `0842a4f` 仍为 Chromium 205/207；新增用例已经实际通过直接入口、13图布局、字段修改、上传保存、返回与重开，停在用中文 multipart 文件名识别原图的断言。现有上传没有承诺不同 multipart 客户端的中文文件名编码一致；新用例改为核对资产数量、服务端 SHA-256 和实际原文件下载字节，保留图片身份验收并加强原文件断言，不改变媒体 API。后续仍必须以新的固定 head 双浏览器完整 CI 为准。

## 身份与交付边界

源码、构建产物、CI 与线上各自记录。线上地址仍为 `https://tome.23cc.cn`；本任务没有登录生产、读取生产数据库、核对现场 image/SHA、合并或部署，生产身份仍为 UNKNOWN。用户授权覆盖普通 commit/push 和 Draft PR，未授权 merge/deploy。
