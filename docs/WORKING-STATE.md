# ToMe 开工与交接

当前 UX 第二批唯一实施目录为云实例 `/workspace/tome-workbench`，远端 main 只读核验为 `87bc1d7f722b1992b0ad58561da632c8262612d0`，新分支 `fix/product-ux-simplify-batch2`。PR #62 已合并；本批不使用 Mac、不部署。当前范围见 [PRODUCT-UX-SIMPLIFY](PRODUCT-UX-SIMPLIFY.md)，下文第一批及 Mac 状态均为历史。

本轮激活工作区为云实例 `/workspace/tome-workbench`，仓库 `BA7IEE/tome-workbench`，开工远端 main=`dfa1de8da4c9ea6d4b5f2ed980206955ebd8db4d`，独立分支 `fix/product-edit-ux-batch1`；不在 Mac 开发。当前实施及云端状态见 [PRODUCT-EDIT-UX](PRODUCT-EDIT-UX.md) 与 [云实例验收](CLOUD-ACCEPTANCE-2026-10-13.md)。下文 Mac、旧 PR 和旧运行结果仅保留为历史，不作为本轮目录、版本或验收指令。

规范身份为 `github.com/ba7iee/tome-workbench`；当前 owner 的审阅树为 `/Users/dengwang/Documents/Codex/2026-10-10/task-2/tome-menu-fix`，PR #57、`fix/ux-csp-and-task-flow`。框架基线 `cf7565a0c0f68b87e9c6b8802b8cf4d39c825447` 是 AntD 6.6.5 / ProComponents 3.1.15-5。原 `coding/tome-workbench` 的 Arco 基线和独有资源改动保留，不能覆盖或当当前修复树。

本工具接入前的 CSP checkpoint 为 `ae905e4057ced7e9f206209a4515863e52889b05`（Pro token nonce 修复）；先前 `7d60b54` 云端为 189/191 Chromium 通过，两处未通过均是已定位的 Pro 变量 style。该状态不代表当前候选通过。实际固定 HEAD/upstream/dirty 以每次以下审计的新 JSON 和 PR head 为准，不能拿旧 clean/dirty 数复用。

## 日常触发入口

- 每次开工、恢复或换目录前：`npm run dev:preflight`。
- 每个独立切片完成、第二个切片前或约 60 分钟：`npm run dev:checkpoint`；由 owner 在原授权内做小提交和远端同步，未验证改动明确 checkpoint 风险。
- 结束/换 owner 前：`npm run dev:handoff`，记录固定提交、PR/CI、产物和线上各自身份。

三者只读，dirty 仅提示，不自动 stage/commit/push/pull/fetch/reset/clean/stash。默认 sync 是缓存口径；需要实际 GitHub 分支核对时明确调用 `python3 scripts/dev-guard.py audit --repo . --phase handoff --online`，失败记录 UNKNOWN，不读取凭据或业务内容。输出留在仓库外的任务证据目录，保全已有 ignored 数据/配置。

实际接入检查：脚本与共享版本逐字节一致；运行 checkpoint 正确识别本仓身份、`ae905e4` 与本人引入的接入文件，dirty 非阻断，没有 Git 冲突。共享工具的 26 项离线自测为其来源证据，不替代本项目业务验收。连续切片的 audit/小提交/交接记录要继续形成，不能仅凭这一次运行称日常机制已经完整落实。

## 构建、发布与原门禁

不替换 AGENTS、prepare-test、typecheck/lint/build、verify:release、audit、pack 或已验证 PR head 的最终批准规则。新增构建若要使用通用来源检查，必须由 owner 明确审阅命令、从干净固定源码创建全新产物与仓外新 manifest；`build/release` 是显式调用，不属于三个日常只读命令。旧包/现有 GitHub 产物不能追补 manifest 假装重新构建；继续按原 CI head、源码指纹、artifact digest 和 pack 保密检查核对。来源检查只称 PASS_PROVENANCE_ONLY，不授权部署。

线上仍是 `https://tome.23cc.cn/`，精确生产 commit/image/byte hash 未取得现场证据，保持 UNKNOWN；版本号或目录不能作部署证明。保留的旧树、补丁和证据是待核验材料，不能标为已验证回退。禁止混装、强推、盲清或自动提交其他 owner 改动。
