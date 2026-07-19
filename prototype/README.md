# 网页原型

## 页面

- `setup.html`：运行前设置，编辑内容映射到统一 RunSpec；
- `review.html`：结合机器证据补充视觉、交互、业务判断和人工时间；
- `report.html`：面向领导的结果报告，当前全部为显式标记的示例数据。

## 本地查看

可以直接打开 HTML，也可以在项目根目录启动静态服务：

```bash
python3 -m http.server 4173 --directory prototype
```

然后访问：

- <http://127.0.0.1:4173/setup.html>
- <http://127.0.0.1:4173/review.html>
- <http://127.0.0.1:4173/report.html>

## 原型边界

- 设置页不会真实启动 CLI；
- 不保存或显示 Secret；
- 人工评审原型只保存到浏览器 localStorage，并支持导出 JSON；
- 报告数字不代表任何模型真实能力；
- 后续正式 Web 控制台必须调用 Runner Core，不在浏览器中拼接并执行 Shell。
