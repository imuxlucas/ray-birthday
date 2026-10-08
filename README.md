# A little sunshine, for Ray

为 Ray 制作的生日动画，使用 p5.js / WebGL。固定 1000 × 1500（2:3）画布，按浏览器可用高度等比例显示。

- 头像光源、丝线聚光灯、生日蛋糕与碰撞爱心粒子。
- 本地合成的音乐盒生日旋律；若浏览器阻止自动播放，点击画面后启动。
- 页面为黑色沉浸式展示，空格键暂停或继续。
- 所有运行依赖及头像素材随仓库提供，无需构建。

## 在线访问

https://imuxlucas.github.io/ray-birthday/

## 本地预览

```sh
python3 -m http.server 8765
```

打开 http://localhost:8765/ 。

## 部署

GitHub Pages 从 `main` 分支根目录发布。推送修改后自动更新。
