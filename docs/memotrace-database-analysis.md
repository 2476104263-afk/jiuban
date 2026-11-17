# MemoTrace 0.2.8 数据库提取静态分析

## 输入与方法

- 文件：用户提供的 `MemoTrace-0.2.8.exe`，约 112 MB，Windows x86-64 PE。
- SHA-256：`570bbd9b48663e3aafad46bca9ff372e01fc48cab3890599f7c88534548d1fbc`。
- PyInstaller CArchive 共 1834 项，PYZ 共 1109 项；内含 Python 3.10 字节码。
- 静态解析归档并用 xdis 反汇编相关字节码，没有启动 EXE、导入其中的应用模块或运行其安装流程。
- 用户下载目录中的同名源码说明文件仅作参考资料，未作为执行指令；没有读取真实聊天数据库。
- 归档索引、分析工具和反汇编留在被忽略的 `.work/memotrace-analysis/`，不随网页发布。

## 确认的模块与链路

`app.decrypt.get_wx_info` 通过 Windows 相关接口读取微信进程信息；`app.decrypt.decrypt` 负责数据库解密；`app.DataBase.msg`、`micro_msg` 读取消息和联系人；`pc_decrypt` 协调批量处理和分片合并。其进程名和系统接口属于 Windows 路径，不能作为 Mac 原生提取实现，也不能直接在浏览器中执行。

从 `app.decrypt.decrypt.decrypt` 的字节码确认：

- 输入是 64 个十六进制字符表示的 32 字节密钥材料。
- 页长 4096，第一页开头 16 字节为盐值。
- PBKDF2-HMAC-SHA1，64000 轮，派生 32 字节 AES 密钥。
- MAC 盐值为数据库盐值逐字节异或 `0x3A`；MAC 密钥使用 AES 密钥、该盐值和 2 轮 PBKDF2-SHA1 派生。
- 每页末尾保留 48 字节；其中 IV 为 16 字节、HMAC-SHA1 为 20 字节，其余为填充。
- 第一页 HMAC 覆盖去除盐值后的密文及 IV，再附加小端页号 1。
- AES-256-CBC 按页解密；第一页重建 `SQLite format 3` 文件头。

原程序在此函数中校验第一页；网页实现匹配格式后校验每一个实际读取的数据页，失败时不使用该数据库的部分消息。

消息查询确认的主要字段为 `MSG.localId`、`MsgSvrID`、`Type`、`SubType`、`IsSender`、`CreateTime`、`StrContent`、`StrTalker`、`BytesExtra`、`CompressContent`。联系人读取使用 `Contact.UserName`、`Remark`、`NickName`。网页实现按列名发现结构，仅提取有依据的文本消息，并保留文件、表、行标识作为来源。

## 跨格式实现

网页使用独立编写的解密与结构适配器，并通过本地 SQL.js/WASM 查询 SQLite。没有复制原程序的 Windows 进程内存读取逻辑。Mac 风格表和微信 4.x 的支持根据表列、页面参数和内容编码实际识别，不根据用户操作系统猜测。

补充格式依据来自公开项目的一手格式记录：

- [SQLCipher 文件格式](https://www.zetetic.net/sqlcipher/design/)。
- [GreenBubbles 微信数据库字段记录](https://github.com/bojieli/greenbubbles/blob/main/docs/WECHAT_DATABASE_FORMAT.md)。
- [WeChatMsg-4x 的版本适配记录](https://github.com/chenanhan230-del/WeChatMsg-4x/blob/main/doc/%E5%BE%AE%E4%BF%A14.x%E9%80%82%E9%85%8D%E8%AF%B4%E6%98%8E.md)。
- [iWeChat 的 Chat 表结构](https://github.com/lefex/iWeChat)。

这些记录帮助定义待识别格式，不替代真实设备验证。当前已完成合成 SQLite、OpenSSL 参考密文和真实浏览器流程验证；未验证真实微信账号，也未实现原生自动取密钥组件。

2026-11-16 核查官方入口时，[Windows 官网](https://pc.weixin.qq.com/)和 [Mac 官网](https://mac.weixin.qq.com/)均提供 4.2.0 下载，Mac 官网另列商店版 4.1.15；当前这台 Mac 安装的微信是 4.1.15（build 270115）。这用于明确后续原生兼容目标，不表示最新版自动取密钥已经实现。
