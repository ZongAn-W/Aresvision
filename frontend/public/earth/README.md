# 本地地球底图资源

二维地球总览只使用仓库内的这份海岸线，运行时**不请求在线瓦片或外部 CDN**。

| 项目 | 值 |
| --- | --- |
| 数据集 | Natural Earth 1:110m coastline（`ne_110m_coastline`） |
| 上游 URL | <https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson> |
| 上游许可入口 | <https://www.naturalearthdata.com/about/terms-of-use/> |
| 抓取日期 | 2026-09-23 |
| 文件字节数 | 139907 |
| SHA-256 | `851f581ff5ffb844deed8ae1a9ce22e3c4bb3d74fa342cadb5d8e39b41ae7c3c` |
| 本地路径 | `frontend/public/earth/ne_110m_coastline.geojson` |

## 许可

Natural Earth 数据属于公共领域（public domain），可自由使用，无需署名。上游许可说明以上方“上游许可入口”为准。

## 用途与限制

- 该轮廓**仅作地理定位参考**；它不参与任何数值计算，也不影响色带、统计或均值。
- 分辨率为 1:110m，海岸线经过简化，不能用于精细边界判断。
- 图中不包含任何未经数据支持的政治边界。
- 相邻经度差大于 180° 时，渲染层会把折线拆成独立子路径，避免出现横跨全世界的长线（见 `src/pages/DataOverviewPage/EarthOverview/earthMapGeometry.js` 的 `splitCoastline`）。

## 校验方式

更新资源时必须先核对字节数与 SHA-256：

```powershell
# 从仓库根目录执行
$file = 'frontend/public/earth/ne_110m_coastline.geojson'
(Get-Item $file).Length
(Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
```

若数值与上表不一致，说明上游已变化。此时不应悄悄替换文件，而应确认上游变化原因、记录新的真实来源与 SHA，并同步更新本文件。若底图加载失败，页面保留经纬网与有效数据，并提供重试提示，日期与数据查询不受影响。

## 三维彩色影像

三维底球使用 NASA Blue Marble 静态地表合成影像；二维地图继续使用上面的 Natural Earth 海岸线。运行时均从本地站点加载，不请求外部影像服务。

| 项目 | 值 |
| --- | --- |
| 影像 | NASA Blue Marble：land, ocean and ice |
| 来源页面 | <https://earthobservatory.nasa.gov/images/57730/the-blue-marble> |
| 原始资源 | <https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.png> |
| 署名 | NASA / Robert Simmon and Reto Stöckli |
| 使用政策 | <https://www.nasa.gov/nasa-brand-center/images-and-media/> |
| 获取日期 | 2026-09-24 |
| 尺寸 | 2048 × 1024，等经纬度投影 |
| 文件字节数 | 1912469 |
| SHA-256 | `b5e0139834c638d10c2c747f4bac63df5f9387680c00d87e5a2a9ed9a3dfea71` |
| 本地路径 | `frontend/public/earth/blue-marble-2048.png` |

NASA 影像按其媒体使用政策用于展示，并保留来源署名；不表示 NASA 对本项目的认可。该文件原样保存，未添加政治边界。纹理仅作地理参考，不参与数据计算、不随时间轴变化，也不代表当前日期的冰雪覆盖。三维场景保留可切换的独立海岸线。影像加载失败时，三维底球回退到海洋渐变，数据分析与独立海岸线不受影响。

可从仓库根目录执行 `(Get-FileHash 'frontend/public/earth/blue-marble-2048.png' -Algorithm SHA256).Hash.ToLower()` 核对资源。
