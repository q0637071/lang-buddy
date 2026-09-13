# 老师照片

把每位老师的照片放在这个目录，文件名用**人设 id**，代码会自动认出来，
不用改 `data/personas.json`，也不用改前端。

| 老师 | 文件名（三选一） |
|---|---|
| 👩‍🏫 Dawn 耐心的老师 | `dawn.jpg` / `dawn.png` / `dawn.webp` |
| 👩‍💼 Steph 职场同事 | `steph.jpg` … |
| 🧑‍🎤 Lucy 闲聊的朋友 | `lucy.jpg` … |
| 🕴️ Olivia 面试官 | `olivia.jpg` … |
| 🌏 Ruby 旅行达人 | `ruby.jpg` … |
| 🧔 Lee 严格的教练 | `lee.jpg` … |
| 🧑 Jamie 健谈的邻居 | `jamie.jpg` … |
| 🧑‍🎓 Daniel 同龄学生 | `danny.jpg` （注意：id 是 danny，名字显示 Daniel） |

照片直接从 Tavus 形象库那一页截图裁一下就行——列表里看到谁，接通后就是谁。

没放照片的老师会继续显示 emoji，不会出错。

## 建议

- **正方形**，短边 ≥ 256px（列表里显示成圆形，非正方形会被裁掉两边）
- 单张控制在 **200KB** 以内，六张全放也就一兆多
- 用 Tavus 那位形象的正脸截图最好——用户在列表里看到谁，视频接通后就该是谁

## 为什么不放进 personas.json

放进去就得每加一张照片改一次配置、还容易和实际文件对不上。
现在是服务端启动时扫这个目录，有就用、没有就退回 emoji。
