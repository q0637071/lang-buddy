# 老师照片

把每位老师的照片放在这个目录，文件名用**人设 id**，代码会自动认出来，
不用改 `data/personas.json`，也不用改前端。

| 老师 | 文件名（三选一） |
|---|---|
| 👩‍🏫 Hannah 耐心的老师 | `hannah.jpg` / `hannah.png` / `hannah.webp` |
| 👩‍💼 Diana 职场同事 | `diana.jpg` … |
| 🧑‍🎤 Autumn 闲聊的朋友 | `autumn.jpg` … |
| 🧑 Austin 健谈的男生 | `austin.jpg` … |
| 🕴️ Daniel 面试官 | `daniel.jpg` … |
| 🧔 Troy 严格的教练 | `troy.jpg` … |

没放照片的老师会继续显示 emoji，不会出错。

## 建议

- **正方形**，短边 ≥ 256px（列表里显示成圆形，非正方形会被裁掉两边）
- 单张控制在 **200KB** 以内，六张全放也就一兆多
- 用 Tavus 那位形象的正脸截图最好——用户在列表里看到谁，视频接通后就该是谁

## 为什么不放进 personas.json

放进去就得每加一张照片改一次配置、还容易和实际文件对不上。
现在是服务端启动时扫这个目录，有就用、没有就退回 emoji。
