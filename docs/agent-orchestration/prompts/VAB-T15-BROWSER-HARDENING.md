# VAB-T15：Playwright Driver 安全与可靠性加固

```prompt
修复只读审查对 VAB-T11 的阻塞问题。只能修改 task catalog 中 VAB-T15 allowed_paths。

必须修复：
1. `file:` URL 不得读取任意宿主文件。由控制面传入可信 allowlist policy；真实路径（含 symlink）
   必须位于允许 fixture root 内。默认不允许任意 file root。
2. loopback HTTP 只允许 policy 明确声明的精确 origin（scheme/host/port），不能放行宿主机所有端口。
3. 阻止非 allowlist 子资源、Service Worker、WebSocket；同时明确本机文件隔离不是安全沙箱。
4. timeout 下限必须大于 0；限制 step 数；增加 capture 总 deadline，超时后强制关闭 context/browser，
   产出结构化 environment 或 product failure，不能永久挂起。
5. full-page screenshot 记录 PNG 实际尺寸，最终 page_url 使用 capture 结束时 URL。

新增 adversarial tests：`file:///etc/hosts` 或平台等价敏感文件被拒绝、symlink 逃逸被拒绝、未声明
loopback origin 被拒绝、timeout=0 被拒绝、step 上限、capture deadline、截图尺寸/最终 URL。
保留 T11 成功/失败/环境分类回归。完成 evidence、测试、npm test、diff check 后提交独立 commit。
```
