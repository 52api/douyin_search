<div align="center">
  <h1>抖音搜索 API</h1>
  <p>基于 Playwright 浏览器自动化的抖音搜索接口，自动处理登录、签名、反爬验证</p>
  <img src="https://img.shields.io/badge/语言-JavaScript-f7df1e?style=flat-square&logo=javascript">
  <img src="https://img.shields.io/badge/运行时-Node.js_18%2B-339933?style=flat-square&logo=nodedotjs">
  <img src="https://img.shields.io/badge/自动化-Playwright-45ba4b?style=flat-square">
  <img src="https://img.shields.io/badge/浏览器-Chrome-4285f4?style=flat-square&logo=googlechrome">
  <br>
  <img src="https://img.shields.io/badge/接口-综合搜索_·_视频搜索_·_用户搜索-ff6b6b?style=flat-square">
  <img src="https://img.shields.io/badge/签名-a_bogus_·_verifyFp_·_msToken-blue?style=flat-square">
  <br><br>
</div>

---

## 📋 项目信息

| 项目 | 说明 |
|------|------|
| **开发语言** | JavaScript (Node.js 18+) |
| **运行时** | Node.js v18+ |
| **核心依赖** | Playwright 浏览器自动化框架 |
| **浏览器** | 系统已安装的 Chrome（Playwright 控制） |
| **架构** | 事件驱动 + 浏览器拦截模式 |
| **作者** | 我爱API平台 |
| **官网** | https://www.52api.cn |
| **QQ 群** | `1072499758` |

---

## 🏗 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                       node index.js                         │
│                                                             │
│  ① 读取 cookie.txt（反爬基础 Cookie）                       │
│  ② 读取 douyin_state.json（浏览器状态缓存）                  │
│  ③ 启动 Playwright → 控制系统 Chrome                        │
│  ④ 导航到抖音搜索页 → 页面自动触发 JSVMP + webmssdk         │
│  ⑤ page.on('response') 拦截搜索 API 响应                    │
│  ⑥ 解析 chunked 响应 → 合并多段 JSON → 输出结果             │
│  ⑦ 保存结果到 {type}_{keyword}_{timestamp}.json              │
└─────────────────────────────────────────────────────────────┘
```

### 反爬签名链路

```
用户请求
  └→ cookie.txt 提供 s_v_web_id / __ac_nonce 等反爬 Cookie
      └→ 页面 JSVMP 字节码运行 → byted_acrawler.sign() 生成 __ac_signature
          └→ webmssdk 拦截 fetch → 注入 a_bogus 签名
              └→ 抖音 API 网关验证签名 → 返回搜索结果
```

---

## 🔧 安装

```bash
cd douyin_search
npm init -y
npm install playwright
```

---

## 📄 文件结构

| 文件 | 必需 | 说明 |
|------|------|------|
| `index.js` | ✅ | 主脚本（入口） |
| `cookie.txt` | ✅ | Cookie 配置文件（需手动准备） |
| `douyin_state.json` | ❌ | 浏览器状态缓存（首次运行自动生成） |
| `{type}_{keyword}_{ts}.json` | ❌ | 搜索结果导出文件（自动生成） |
| `README.md` | - | 本说明文档 |

---

## 🚀 使用

```bash
# 综合搜索
node index.js 薛之谦

# 视频搜索
node index.js 周杰伦 video

# 用户搜索
node index.js 薛之谦 user
```

### 首次运行

1. 确保 `cookie.txt` 已配置好 Cookie（见下方说明）
2. 运行脚本 → 弹出 Chrome 浏览器
3. 如出现滑块验证码 → **手动完成拼图验证**
4. 验证通过后自动保存会话 → 后续可无界面执行

---

## 🍪 Cookie 配置

从浏览器获取 Cookie：

```
F12 → Application → Cookies → www.douyin.com
→ 复制所有 Cookie 值 → 粘贴到 cookie.txt
```

**关键 Cookie 说明：**

| Cookie 名 | 作用 |
|-----------|------|
| `s_v_web_id` | 浏览器指纹（用作 `verifyFp` / `fp` 参数） |
| `__ac_nonce` | 反爬签名种子 |
| `sessionid` / `sid_tt` | 登录会话（可选，未登录也能搜索） |

---

## 🔍 搜索类型与 API

| 类型 | 命令 | API 端点 | search_channel |
|------|------|----------|---------------|
| 综合 | `node index.js 关键词` | `/aweme/v1/web/general/search/stream/` | `aweme_general` |
| 视频 | `node index.js 关键词 video` | `/aweme/v1/web/search/item/` | `aweme_video_web` |
| 用户 | `node index.js 关键词 user` | `/aweme/v1/web/discover/search/` | `aweme_user_web` |

---

## 📤 输出格式

```json
{
  "status_code": 0,
  "data": [
    {
      "type": 1,
      "aweme_info": {
        "aweme_id": "7654160511785096357",
        "desc": "视频标题...",
        "author": { "nickname": "作者名" },
        "statistics": { "digg_count": 12345 }
      }
    }
  ],
  "has_more": 1,
  "cursor": 10
}
```

输出同时保存到本地文件 `{type}_{关键词}_{时间戳}.json`。

---

## 🛡 安全参数

| 参数 | 生成方式 | 长度 |
|------|---------|------|
| `a_bogus` | webmssdk fetch interceptor 自动注入 | ~180 字符 |
| `verifyFp` / `fp` | `s_v_web_id` Cookie | verify_xxx 格式 |
| `msToken` | 响应头 `x-ms-token` 回传 | 变化 |
| `__ac_signature` | byted_acrawler.sign() 生成 | ~48 字符 |

---

## 📝 示例

```bash
# 搜索"薛之谦"综合结果
node index.js 薛之谦
# 输出: HTTP 200 | status=0 | has_more=1 | 结果数=10

# 搜索"周杰伦"视频结果
node index.js 周杰伦 video
# 输出: HTTP 200 | status=0 | has_more=1 | 结果数=20
```

---

<div align="center">
  <p>本项目由 <a href="https://www.52api.cn"><b>我爱API平台</b></a> 提供</p>
  <p>官方 QQ 群：<code>1072499758</code></p>
</div>
