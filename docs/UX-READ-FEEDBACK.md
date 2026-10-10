# 读取失败反馈与批量菜单交互

基于已合并 AntD Foundation 的 `main@cf7565a`，保留迁移后的批量内部滚动修复 `691f494`。本切片不修改 CSP、权限、业务命令或数据。

GET 读取失败以前会显示“提交结果可能未确认”，损坏 JSON 也会要求核对提交结果。现在明确显示未能读取/数据未完整收到，指向现有“重新读取”入口。POST 等写入的网络/回执丢失提示、status=0、同幂等键与原载荷恢复继续保留。

现有 Foundation 浏览器套件新增断网读取及真实重新读取断言：登录仍走真实服务，只中断 GET，不伪造成功响应；恢复后原 URL 和商品库保持。Chromium/WebKit 既有配置均包含该套件。新增用例尚未执行。

轻量本机证据：实际 core.request 在合成传输下的七项读取/写入/同键检查通过，旧 main 在首个 READ_FAILED 断言失败；九项实际菜单监听器检查通过；当前真实 catalog-menu.ts 单文件转译加真实 ui08.css 的无 API 合成 DOM 夹具，在单个已支持 Chrome 标签页串行验证桌面及 390×844 内部滚动、选择保持、Escape 回焦、普通指针点击最末菜单动作、页面滚动关闭及取消选择。未对真实记录执行动作。选择夹具不代表完整 catalog-context/业务保存验收。

线上只打开快速录入弹窗并取消：初始焦点位于商品名称，取消后回到原入口；没有填写或保存。分页/排序的动态样式缺失已确认属于 HTTP CSP 阻止，安全修复仅保留未提交草稿并另有精确审批方案。

定向 ESLint、Prettier、测试语法、Foundation admission 与 diff 空白检查通过。完整 typecheck/build、真实数据库与 Chromium/WebKit 全量、audit、release/pack、GitHub 新 CI、推送与部署均 NOT_RUN。不要沿用基线 CI 验证本轮变更。
