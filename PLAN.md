# Pwd-Vault 技术方案

> 全平台密码管理器 — Rust Core + Tauri 2.0 + SolidJS

## 1. 项目概述

一款零信任架构的本地优先密码管理器。所有加密解密在本地完成，密钥永不离开设备。支持 iOS / Android / macOS / Windows / Linux 全平台，通过手动导入导出实现跨设备数据迁移。

## 2. 技术栈

| 层级 | 技术选型 | 版本 | 选型理由 |
|------|---------|------|---------|
| 桌面/移动框架 | Tauri | 2.x | Rust 原生集成，包体小（~5MB vs Electron ~150MB），iOS/Android 官方支持 |
| 前端 UI | SolidJS | 1.9+ | 真正的响应式（无 Virtual DOM diff），编译时优化，性能最优 |
| 前端构建 | Vite | 6.x | 极速 HMR，Tauri 官方推荐 |
| 样式 | Tailwind CSS | 4.x | 原子化 CSS，编译时 tree-shake |
| 状态管理 | SolidJS Signals + Stores | - | SolidJS 内置，无需额外库 |
| 图标 | Lucide Icons | - | 轻量一致的开源图标库 |
| Rust 核心 | - | Edition 2024 | 整个安全逻辑在 Rust 层 |
| 对称加密 | XChaCha20-Poly1305 | - | 比 AES-GCM 更现代，nonce 误用风险更低，via `chacha20poly1305` crate |
| 密钥派生 | Argon2id | - | 抗 GPU/ASIC，内存硬因子，via `argon2` crate |
| 密钥分层 | HKDF-SHA256 | - | 从主密钥安全派生子密钥，via `hkdf` crate |
| 随机数 | `getrandom` | - | 操作系统级 CSPRNG |
| 序列化 | `serde` + `bincode` | - | 内部格式用 bincode（快+紧凑），导入导出用 JSON |
| 完整性校验 | BLAKE3 | - | 比 SHA-256 更快，via `blake3` crate |
| TOTP | `totp-rs` | - | 支持 TOTP/HOTP 二步验证 |
| 密码生成 | 内置 Diceware + 规则生成 | - | 支持单词密码和随机字符密码 |
| 本地化 | `rust-i18n` + SolidJS i18n | - | 中/英双语 |

## 3. 系统架构

```
┌──────────────────────────────────────────────────────┐
│                    用户界面层                         │
│         SolidJS + Tailwind CSS (WebView)             │
│  ┌──────────┬──────────┬──────────┬────────────────┐ │
│  │ 认证界面  │ 密码列表  │ 条目编辑  │ 设置/导入导出  │ │
│  └──────────┴──────────┴──────────┴────────────────┘ │
├──────────────────────────────────────────────────────┤
│                 Tauri IPC Bridge                     │
│         #[tauri::command] 标注的 Rust 函数            │
├──────────────────────────────────────────────────────┤
│                   Rust 核心层                         │
│  ┌────────────┬────────────┬─────────────────────┐  │
│  │  crypto    │   vault    │    generator         │  │
│  │ 加密/解密   │ 存储读写   │   密码生成器         │  │
│  │ 密钥派生    │ 格式解析   │   Diceware/规则      │  │
│  │ 密钥管理    │ 索引维护   │   entropy 计算       │  │
│  ├────────────┼────────────┼─────────────────────┤  │
│  │  entry     │ import     │    totp              │  │
│  │ 条目CRUD   │ export     │   TOTP/HOTP          │  │
│  │ 字段加密    │ JSON/CSV   │   二步验证           │  │
│  │ 搜索过滤    │ .vault文件 │   QR解析             │  │
│  └────────────┴────────────┴─────────────────────┘  │
├──────────────────────────────────────────────────────┤
│                    存储层                             │
│         本地加密文件 (.vault)                         │
│         操作系统密钥链 (生物识别解锁)                   │
└──────────────────────────────────────────────────────┘
```

## 4. 加密方案详细设计

### 4.1 密钥层级

```
用户主密码 (Master Password)
       │
       ▼ Argon2id (salt, memory=256MB, time=4, parallelism=4)
       │
  主密钥 (Master Key) — 256-bit，永不存储，仅存于内存
       │
       ├── HKDF-SHA256 (info="vault-key")  ──► 文件加密密钥 (Vault Key)
       │                                         用于加密条目索引
       │
       ├── HKDF-SHA256 (info="entry-key") ──► 条目密钥种子 (Entry Key Seed)
       │                                         为每条记录派生独立密钥
       │
       └── HKDF-SHA256 (info="auth-hash")  ──► 认证哈希 (Auth Hash)
                                                 存储在 vault 文件中用于验证主密码
```

### 4.2 Argon2id 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| memory | 256 MiB | 防止 GPU 暴力破解 |
| iterations | 4 | Pass 数 |
| parallelism | 4 | 并行线程数 |
| output length | 32 bytes | 256-bit 主密钥 |
| salt | 32 bytes | 随机生成，存入 vault header |

参数会随硬件发展调整，写入 vault header 以保证向后兼容。

### 4.3 条目加密流程

```
明文条目数据 (JSON)
       │
       ▼ serde_json → bytes
       │
       ▼ HKDF(entry-key-seed + entry-id) → per-entry key (256-bit)
       │
       ▼ XChaCha20-Poly1305 (random 24-byte nonce)
       │
  密文 + nonce + tag (每条独立)
```

### 4.4 认证流程

```
1. 用户输入主密码
2. 读取 vault header 中的 salt + Argon2 参数
3. Argon2id(password, salt) → candidate master key
4. HKDF(candidate, "auth-hash") → candidate auth hash
5. 比对 vault header 中存储的 auth hash
6. 匹配 → 解密 vault key → 解密索引 → 加载到内存
7. 不匹配 → 拒绝访问
```

## 5. 自定义 Vault 文件格式 (.vault)

### 5.1 二进制布局

```
Offset  Size      Field                Description
------  --------  -------------------  -------------------------------------------
0       4         Magic                "VLT1" (ASCII)
4       1         Version              格式版本号 (当前 0x01)
5       1         Flags                保留标志位 (当前 0x00)
6       4         Argon2 Memory        内存参数 (little-endian, 单位 MiB)
10      2         Argon2 Iterations    迭代次数 (little-endian)
12      1         Argon2 Parallelism   并行度
13      32        Salt                 Argon2 salt
45      32        Auth Hash            主密码认证哈希 (HKDF 派生)
77      24        Index Nonce          索引加密 nonce
101     var       Encrypted Index      XChaCha20-Poly1305 加密的条目索引
        + 16                            (包含 tag)
─── 以下是条目数据区 ───
var     4         Entry Length         当前条目总长度 (含 nonce+ciphertext+tag)
var     24        Entry Nonce          条目加密 nonce
var     var       Entry Ciphertext     加密的条目数据
var     16        Entry Tag            Poly1305 认证 tag
─── 重复上述结构 ───
var     32        File MAC             BLAKE3 完整性校验 (覆盖 header + 所有数据)
```

### 5.2 索引结构（加密前）

```json
{
  "version": 1,
  "created": "2026-04-12T20:00:00+08:00",
  "modified": "2026-04-12T20:00:00+08:00",
  "entries": [
    {
      "id": "uuid-v4",
      "title_enc": "<加密标题的Base64>",
      "category": "login|note|card|identity",
      "tags": ["tag1", "tag2"],
      "offset": 12345,
      "length": 256,
      "created": "2026-04-12T20:00:00+08:00",
      "modified": "2026-04-12T20:00:00+08:00"
    }
  ],
  "deleted_ids": ["uuid-of-deleted-entry"],
  "folders": {
    "folder-uuid": {
      "name_enc": "<加密文件夹名Base64>",
      "parent": "parent-folder-uuid-or-null"
    }
  }
}
```

索引本身被 Vault Key 加密，包含每条记录的元数据和文件偏移量，支持快速查找和部分加载。

### 5.3 条目数据结构（加密前）

```json
{
  "id": "uuid-v4",
  "type": "login",
  "title": "GitHub",
  "username": "user@example.com",
  "password": "encrypted-field",
  "url": "https://github.com",
  "notes": "some notes",
  "totp": {
    "secret": "BASE32ENCODED",
    "algorithm": "SHA1|SHA256|SHA512",
    "digits": 6,
    "period": 30
  },
  "custom_fields": [
    {"name": "API Key", "value": "xxx", "type": "text|password|hidden"}
  ],
  "tags": ["dev", "work"],
  "folder": "folder-uuid-or-null",
  "favorite": false,
  "created": "2026-04-12T20:00:00+08:00",
  "modified": "2026-04-12T20:00:00+08:00",
  "password_history": [
    {"password": "old-pass", "changed_at": "2026-03-01T10:00:00+08:00"}
  ]
}
```

### 5.4 设计优势

- **每条独立加密**：修改单条记录只需重写该条目 + 索引，不用重写整个文件
- **偏移量索引**：支持 O(1) 跳转到指定条目，大文件不会全量读取
- **软删除**：deleted_ids 保留已删除条目 ID，导出时可选择是否包含
- **版本字段**：格式升级时向后兼容

## 6. 导入导出方案

### 6.1 导出

支持两种格式：

**加密导出（.vault 文件）**
- 导出整个 .vault 文件的副本
- 可用于跨设备迁移，需要主密码解锁
- 完整保留所有数据结构

**明文导出（JSON/CSV）**
- 导出前需要再次确认主密码
- JSON 格式：完整保留所有字段，包括 TOTP、自定义字段、密码历史
- CSV 格式：仅保留基础字段（title, url, username, password, notes），兼容 Bitwarden/1Password 导入
- 明文文件用完即删，前端提供「导出后自动删除文件」选项

### 6.2 导入

**从 .vault 文件导入**
- 验证主密码后合并数据，冲突时按「保留较新」策略

**从其他密码管理器导入**
- Bitwarden JSON/CSV
- 1Password 1PIF/CSV
- Chrome CSV
- KeePass XML（KeePass 的加密格式需先由用户在 KeePass 中导出为 XML）

### 6.3 导入流程

```
1. 用户选择文件 → 前端发送文件路径到 Rust
2. Rust 检测文件格式（JSON/CSV/XML/.vault）
3. 解析并校验数据
4. 去重检测（根据 URL + username 匹配已有条目）
5. 预览界面：展示待导入条目，标记重复项
6. 用户确认 → 逐条加密写入 vault
```

## 7. 生物识别解锁

```
首次设置：
  主密码 → Master Key → 系统密钥链存储 (Keychain / Keystore / Credential Manager)
                              │
                              ▼ 加密存储，无法直接读取原始密钥
                              
后续解锁：
  用户指纹/Face ID/Windows Hello
       │
       ▼ 系统密钥链返回 Master Key
       │
       ▼ 验证 Auth Hash
       │
       ▼ 解锁 Vault
```

平台实现：
- macOS / iOS: Keychain Services (`security-framework` crate)
- Android: Android Keystore + BiometricPrompt
- Windows: Windows Credential Manager + Windows Hello
- Linux: Secret Service API (libsecret) / 平台回退到主密码

## 8. 密码生成器

### 8.1 随机字符模式

```
长度: 可配置 8-128 位，默认 20
字符集: 大写 / 小写 / 数字 / 特殊符号 (各自可选)
排除字符: 用户可指定排除易混淆字符 (0O1lI)
entropy 保证: 强制最低 entropy 为目标阈值
```

### 8.2 Diceware 单词模式

```
单词数: 可配置 4-10 个，默认 5
分隔符: 空格 / 连字符 / 点 / 用户自定义
词表: EFF 大词表 (7776 词)
entropy: 每词 ~12.9 bits，5词约 64.5 bits
```

### 8.3 密码强度评估

```
实时计算 entropy 和预估破解时间
显示强度条: 非常弱 / 弱 / 一般 / 强 / 非常强
检测常见模式: 键盘序列、重复字符、字典词
```

## 9. 前端页面设计

### 9.1 页面结构

```
┌──────────────────────────────────────────────────┐
│  侧边栏          │          主内容区              │
│  ┌──────────┐    │  ┌──────────────────────────┐  │
│  │ 🔍 搜索   │    │  │                          │  │
│  ├──────────┤    │  │    条目详情 / 编辑         │  │
│  │ 收藏      │    │  │                          │  │
│  │ 全部条目  │    │  │  标题: GitHub             │  │
│  │ 登录      │    │  │  用户: user@example.com   │  │
│  │ 支付卡    │    │  │  密码: •••••••• [复制]    │  │
│  │ 身份信息  │    │  │  URL:  github.com         │  │
│  │ 安全笔记  │    │  │  TOTP: 123456 (30s)      │  │
│  ├──────────┤    │  │  笔记: ...                │  │
│  │ 回收站    │    │  │                          │  │
│  ├──────────┤    │  └──────────────────────────┘  │
│  │ ⚙ 设置   │    │                                │
│  └──────────┘    │  ┌──────────────────────────┐  │
│                  │  │   密码生成器 (可折叠)      │  │
│                  │  └──────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 9.2 页面清单

| 页面 | 功能 | 说明 |
|------|------|------|
| AuthScreen | 主密码输入 / 生物识别 | 首次使用引导设置主密码 |
| VaultList | 密码条目列表 | 搜索、分类筛选、排序、收藏 |
| EntryDetail | 条目查看 | 密码显隐、一键复制、TOTP 倒计时 |
| EntryEditor | 条目编辑/新建 | 表单验证、密码生成器集成 |
| PasswordGen | 密码生成器 | 独立弹窗/面板，entropy 实时显示 |
| Settings | 设置 | 安全设置、导入导出、主题切换、语言 |
| ImportExport | 导入导出 | 格式选择、冲突预览、进度显示 |
| Trash | 回收站 | 已删除条目，可恢复或永久删除 |

### 9.3 设计原则

- **暗色主题优先**：密码管理器场景暗色更舒适，亮色主题可选
- **零干扰**：操作路径最短化，常用操作（复制、搜索）一键可达
- **平台适配**：
  - 桌面端：左侧边栏 + 右侧内容区经典布局
  - 移动端：底部 Tab 导航 + 全屏列表/详情
  - 自适应折叠：窄屏自动从双栏切换到单栏

## 10. 安全考量

### 10.1 内存安全

```
- Master Key 使用 zeroize crate 确保使用后清零
- 敏感字符串使用 Zeroize wrapper，离开作用域自动清零
- 前端传给 Rust 的密码参数使用 Zeroized String
- Rust 层永不将密钥返回给前端，只返回操作结果
```

### 10.2 剪贴板安全

```
- 复制密码后 30 秒自动清空剪贴板（可配置）
- 使用系统剪贴板 API，不经过中间存储
```

### 10.3 自动锁定

```
- 可配置闲置超时: 1min / 5min / 15min / 30min / never
- 锁屏时自动锁定（监听系统事件）
- 锁定后清空内存中的 Master Key 和解密数据
- 前端显示锁定界面，需重新认证
```

### 10.4 密码泄露检测

```
- 使用 Have I Been Pwned API (k-anonymity 模式)
- 仅发送密码 SHA-1 哈希的前 5 位到 API
- 本地比对完整哈希，密码本身不离开设备
- 在条目详情中显示泄露状态标记
```

### 10.5 审计日志

```
- 本地记录所有敏感操作（解锁、查看密码、导出、修改主密码）
- 日志包含时间戳 + 操作类型，不含具体密码内容
- 日志条目数量上限 500 条，滚动覆盖
```

## 11. 项目目录结构

```
pwd-vault/
├── .github/
│   └── workflows/
│       └── ci.yml                # Rust CI: clippy + test + fmt
├── crates/
│   ├── core/                     # Rust 核心库 (platform-agnostic)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs            # 库入口 + re-exports
│   │       ├── crypto.rs         # XChaCha20-Poly1305, Argon2id, HKDF
│   │       ├── vault.rs          # .vault 文件格式读写
│   │       ├── vault_index.rs    # 索引管理（CRUD + 搜索）
│   │       ├── entry.rs          # 条目数据结构定义
│   │       ├── generator.rs      # 密码生成器 (随机 + Diceware)
│   │       ├── strength.rs       # 密码强度评估
│   │       ├── totp.rs           # TOTP/HOTP 生成
│   │       ├── import.rs         # 导入 (Bitwarden/1Password/KeePass/CSV)
│   │       ├── export.rs         # 导出 (.vault/JSON/CSV)
│   │       ├── audit.rs          # 审计日志
│   │       ├── dedup.rs          # 去重检测
│   │       └── error.rs          # 统一错误类型
│   └── tauri-plugin/             # Tauri 命令桥接层
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs            # 插件注册
│           └── commands.rs       # #[tauri::command] 函数
├── src-tauri/                    # Tauri 应用入口
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri 配置 (窗口、权限、平台)
│   ├── capabilities/             # Tauri 2.0 权限配置
│   ├── icons/                    # 应用图标 (各尺寸)
│   └── src/
│       └── main.rs               # 应用启动入口
├── src/                          # SolidJS 前端
│   ├── index.html
│   ├── index.tsx                 # 入口
│   ├── App.tsx                   # 根组件 + 路由
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx       # 侧边栏导航
│   │   │   ├── Header.tsx        # 顶部栏 (搜索 + 操作)
│   │   │   └── MobileNav.tsx     # 移动端底部导航
│   │   ├── auth/
│   │   │   ├── LockScreen.tsx    # 解锁界面
│   │   │   └── SetupMaster.tsx   # 首次设置主密码
│   │   ├── vault/
│   │   │   ├── VaultList.tsx     # 条目列表
│   │   │   ├── EntryCard.tsx     # 列表项卡片
│   │   │   ├── EntryDetail.tsx   # 条目详情
│   │   │   ├── EntryEditor.tsx   # 条目编辑/新建
│   │   │   └── Trash.tsx         # 回收站
│   │   ├── generator/
│   │   │   └── PasswordGen.tsx   # 密码生成器
│   │   ├── import-export/
│   │   │   └── ImportExport.tsx  # 导入导出界面
│   │   └── settings/
│   │       └── Settings.tsx      # 设置页面
│   ├── stores/
│   │   ├── vault.ts              # Vault 状态 (SolidJS stores)
│   │   ├── auth.ts               # 认证状态
│   │   └── settings.ts           # 设置状态
│   ├── i18n/
│   │   ├── zh-CN.ts              # 中文
│   │   └── en-US.ts              # 英文
│   ├── styles/
│   │   └── global.css            # 全局样式 + Tailwind 入口
│   └── utils/
│       ├── clipboard.ts          # 剪贴板操作 (超时清除)
│       └── platform.ts           # 平台检测工具
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── Cargo.toml                    # Rust workspace 根
├── .gitignore
├── LICENSE
├── PLAN.md                       # 本文件
└── README.md
```

## 12. Rust 依赖

```toml
# crates/core/Cargo.toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
bincode = "2"                          # 内部序列化
chacha20poly1305 = "0.10"             # XChaCha20-Poly1305
argon2 = "0.5"                         # 密钥派生
hkdf = "0.12"                          # 密钥分层
blake3 = "1"                           # 完整性校验
getrandom = "0.3"                      # CSPRNG
uuid = { version = "1", features = ["v4"] }
totp-rs = "5"                          # TOTP
zeroize = { version = "1", features = ["derive"] }  # 内存安全
chrono = { version = "0.4", features = ["serde"] }
csv = "1"                              # CSV 导入导出
thiserror = "2"                        # 错误处理
log = "0.4"

[dev-dependencies]
tempfile = "3"
criterion = "0.5"                      # 性能基准测试
proptest = "1"                         # 属性测试
```

## 13. 前端依赖

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-biometric": "^2",
    "@tauri-apps/plugin-clipboard-manager": "^2",
    "solid-js": "^1.9",
    "@solidjs/router": "^0.15",
    "lucide-solid": "^0.470"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "vite": "^6",
    "vite-plugin-solid": "^2",
    "typescript": "^5.7",
    "tailwindcss": "^4",
    "@tailwindcss/vite": "^4"
  }
}
```

## 14. 开发路线图

### Phase 1: Rust 核心 (预计 2 周)

- [ ] `crypto` 模块：加密/解密/密钥派生/密钥管理
- [ ] `vault` 模块：文件格式读写/索引管理
- [ ] `entry` 模块：数据结构定义/序列化
- [ ] `generator` 模块：密码生成 + 强度评估
- [ ] `error` 模块：统一错误处理
- [ ] 单元测试 + 属性测试 (proptest)
- [ ] 性能基准 (criterion)

### Phase 2: 桌面端 MVP (预计 2 周)

- [ ] Tauri 2.0 项目初始化 + SolidJS 脚手架
- [ ] 认证流程：设置主密码 / 解锁界面
- [ ] Vault CRUD：新建/编辑/删除/搜索条目
- [ ] 密码生成器组件
- [ ] 一键复制 + 剪贴板超时清除
- [ ] macOS 打通

### Phase 3: 完善功能 (预计 2 周)

- [ ] 导入导出（.vault / JSON / CSV / Bitwarden / 1Password）
- [ ] TOTP 二步验证支持
- [ ] 密码泄露检测 (HIBP k-anonymity)
- [ ] 回收站（软删除 + 恢复）
- [ ] 收藏/文件夹/标签分类
- [ ] 审计日志
- [ ] 自动锁定（闲置超时 + 锁屏检测）
- [ ] 暗色/亮色主题

### Phase 4: 移动端适配 (预计 2 周)

- [ ] iOS 编译 + 适配
- [ ] Android 编译 + 适配
- [ ] 移动端导航布局
- [ ] 生物识别解锁 (Face ID / Touch ID / 指纹)
- [ ] 移动端 UI 优化

### Phase 5: 跨平台打磨 (预计 1 周)

- [ ] Windows 适配测试
- [ ] Linux 适配测试
- [ ] 中/英双语完善
- [ ] CI/CD (GitHub Actions 自动构建多平台)
- [ ] 性能优化 + 安全审计

## 15. 测试策略

| 测试类型 | 工具 | 覆盖范围 |
|---------|------|---------|
| 单元测试 | Rust `#[test]` | 所有 crypto/vault/generator 函数 |
| 属性测试 | proptest | 加密往返（加密→解密→原文一致）、密码生成 entropy 范围 |
| 基准测试 | criterion | Argon2id 耗时、加密吞吐量、大 vault 文件操作 |
| 集成测试 | Rust `tests/` | 完整 vault 生命周期（创建→写入→读取→修改→导出→导入） |
| 前端测试 | Vitest | 组件渲染、用户交互、状态管理 |
| E2E 测试 | Tauri WebDriver | 完整用户流程（首次设置→添加→搜索→复制→锁定→解锁） |

### 关键测试场景

```
1. 加密往返: encrypt(data, key) → decrypt(ciphertext, key) == data
2. 错误密钥: decrypt(encrypt(data, key1), key2) → Error
3. 密文篡改: 修改 1 byte 密文 → decrypt 失败 (Poly1305 tag 校验)
4. 格式兼容: 旧版本 vault 文件能被新版本读取
5. 大文件性能: 1000+ 条目的 vault，搜索 < 100ms
6. 并发安全: 多次快速保存不损坏文件（写锁）
7. Argon2 参数: 验证派生耗时在目标范围内（< 2s）
8. 密码生成: 验证生成的密码 entropy 满足最低要求
```
