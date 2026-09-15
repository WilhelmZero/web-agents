// UI-only translations. Source images, prompts and generated artwork are never translated.
const messages: Record<string, string> = {
  疑似误用参考图: "Possible reference-image copy",
  "疑似误用参考图，图片已保留，等待人工确认":
    "Possible reference-image copy. Image retained for manual review.",
  "已保留疑似结果，可查看全部图片、编辑或下载；请人工确认后使用。":
    "Flagged images are retained. View all images, edit or download, and confirm before use.",
  "已保留原始返回图片，请人工确认后使用。":
    "The returned image has been retained. Please confirm before use.",
  "图像服务返回的图片与风格参考图高度相似，可能误把参考图当成了输出。图片已保留并标记为待人工确认；未自动重试，请核对原照后决定是否使用。":
    "The image closely resembles the style reference. It has been retained and flagged for manual review without retrying. Compare it with the original before use.",
  "生成的图片将在这里显示。生成过程中也可调参和下载已有结果。":
    "Generated images will appear here. You can edit and download existing results while generation continues.",
  下次生成重新识别主体: "Identify subjects again on next generation",
  暂无主体审核通过的版本: "No version has passed the subject check",

  识别并锁定原照主体: "Identifying and locking source subjects",
  原照主体锁定: "Locked source subjects",
  主体未通过审核: "Subject integrity check failed",
  "主体信息已锁定，后续审核不能修改原照主体。":
    "Source subjects are locked and cannot be changed by later reviews.",
  "识别不确定，使用通用方案；自动审核需要人工确认。":
    "Identification uncertain. Using general guidance; automatic review requires manual confirmation.",
  "首次生成识别并锁定原照主体，同一任务复用；每轮审核增加一次独立矛盾核对，按审核模型 Token 计费。矛盾时停止，不自动重试。":
    "The first generation identifies and locks source subjects for reuse in this task. Each review adds an independent consistency check, billed as review-model tokens. Contradictions stop optimization without retrying.",
  "审核意见与图片主体识别矛盾或证据不足，已停止优化并保留图片。请人工检查后再生成。":
    "Review statements contradict subject identification or lack sufficient evidence. Optimization stopped and images were preserved. Inspect manually before generating again.",
  "主体识别返回无效结果，已停止并保留图片。":
    "Subject identification returned invalid data. Processing stopped; images preserved.",
  "主体识别未完成，已停止且未自动重试。":
    "Subject identification did not complete. Stopped without automatic retry.",

  任务历史: "Task history",
  全选: "Select all",
  "场景 + Logo 一次替换": "Replace scene and logo",
  "AI 萌宠字母贴纸": "AI pet letter stickers",

  正在生成的图片: "Image being generated",
  "图片完成后将在此显示，已有结果仍可查看。":
    "The image will appear here when complete. Existing results remain available.",
  "批量提取照片主体，生成可编辑的激光雕刻效果。":
    "Extract subjects from photos in batches and create editable laser engraving artwork.",
  导入原照: "Import source images",
  点击或拖拽导入原照: "Click or drag source images here",
  "支持多张 JPEG / PNG / WebP / SVG，每张不超过20MB，最多20张":
    "JPEG / PNG / WebP / SVG · Up to 20 images · Max 20 MB each",
  继续添加原照: "Add more images",
  同时处理: "Concurrent tasks",
  同时处理任务数: "Concurrent task limit",
  全部生成: "Generate all",
  全部停止: "Stop all",
  全部删除: "Remove all",
  "设置整批共用 · 每次生成全部原照":
    "Shared batch settings · Generate all source images each time",
  "删除仅移出当前工作区，已保存任务可从历史恢复。生成或导入期间不可删除，请先停止并等待任务结束。":
    "Removal only affects this workspace. Saved tasks remain in history. Stop and wait for active tasks before removing images.",
  "按当前封面下载，默认采用最高分；可在图片弹窗手动采用或下载全部版本。":
    "Download the selected cover, which defaults to the highest score. Open the image gallery to choose another cover or download all versions.",
  整批任务历史: "Batch history",
  "刷新默认新建空白任务；已保存原照、结果和设置可在这里恢复。使用中的批次不会被删除。":
    "Refreshing starts an empty task. Restore saved images, results and settings here. Active batches cannot be deleted.",
  "清空全部可删除历史？此操作不能撤销。":
    "Clear all inactive history? This cannot be undone.",
  清空历史: "Clear history",
  "暂无保存的历史。": "No saved history.",
  未命名批次: "Untitled batch",
  恢复整批副本: "Restore batch copy",
  "删除这条历史和不再被引用的图片？":
    "Delete this history entry and images no longer in use?",
  删除历史: "Delete history",
  "清空当前批次的全部生成结果？请先下载需要的图片。":
    "Clear all results in this batch? Download any images you want to keep first.",
  "整批设置无法保存，请检查浏览器存储权限。":
    "Cannot save batch settings. Check browser storage permissions.",
  "整批历史保存失败，请及时下载结果。":
    "Could not save batch history. Please download your results.",
  "已恢复整批副本；再次生成会处理全部原照。":
    "Batch copy restored. Generating again will process all source images.",
  "历史已清理。": "History cleared.",
  "请导入20MB以内的 JPEG、PNG、WebP 或 SVG 图片。":
    "Import JPEG, PNG, WebP or SVG images up to 20 MB each.",
  "单个工作区最多20张，请在新标签继续导入。":
    "Each workspace supports up to 20 images. Open another tab to add more.",
  "无法保存工作区列表，请及时下载结果。":
    "Cannot save the workspace list. Please download your results.",
  "请等待全部原照导入完成；导入失败的图片请删除后重新添加。":
    "Wait for all images to finish importing. Remove and re-add any failed imports.",
  "已停止排队，已返回结果均保留":
    "Queue stopped. Returned results are preserved.",
  "批量处理结束，请逐张检查结果": "Batch complete. Please inspect each result.",
  "已停止后续请求，已收到结果保留；服务端可能仍处理或计费":
    "Further requests stopped. Results are preserved; submitted requests may still be processed or billed.",
  任务尚未准备好: "Task is not ready yet",
  "已从工作区删除，已保存的任务仍可从历史恢复":
    "Removed from workspace. Saved tasks can still be restored from history.",
  "未能保存任务或工作区列表，图片尚未删除，请重试。":
    "Could not save the task or workspace. Images were not removed. Please retry.",
  "结果尚未准备好，请稍后重试。":
    "Results are not ready. Please retry shortly.",
  "已清空当前批次的生成结果，保留原照与设置。":
    "Batch results cleared. Source images and settings are preserved.",
  雕刻设置: "Engraving settings",
  整批共用: "Shared across batch",
  单图: "Single image",
  "可从列表选择，也可直接输入完整模型名称。":
    "Select a model or enter its full name.",
  选择或输入图片模型: "Select or enter an image model",
  审核模型: "Review model",
  生成质量: "Generation quality",
  显示生成过程预览: "Show generation previews",
  "最多接收3张中间预览，可能增加输出Token费用；不支持流式的服务可关闭。失败不自动重试。":
    "Receive up to 3 intermediate previews, which may increase output token costs. Disable for services without streaming support. Failures are not retried automatically.",
  自动优化: "Auto optimization",
  在生成图上持续优化: "Continue editing the best result",
  "开启后，从评分最佳的生成图继续修改，并附带原照保留人物和构图。":
    "Continue from the highest-scoring image, with the original as a reference to preserve subjects and composition.",
  最多轮数: "Maximum rounds",
  目标评分: "Target score",
  "每轮审核后调参或重新生成，可能多次计费；失败不自动重发。审核 Token 按实际账单计费。":
    "Each review may trigger adjustments or another generation, with additional charges. Failed requests are not retried automatically. Review tokens are billed by actual usage.",
  主体与风格: "Subject and style",
  保留主体: "Subject to retain",
  纹理风格: "Texture style",
  细腻写实: "Natural detail",
  强纹理雕刻: "Strong engraving texture",
  人和动物: "People and animals",
  骑马: "Horse and rider",
  扩图补全主体: "Extend image to complete subjects",
  扩图要求: "Image extension instructions",
  "例如：向图片上/下/左/右侧扩图，补全人物手臂和手肘/腿部，保留安全边距":
    "Example: extend the top, bottom, left or right to complete arms, elbows or legs, leaving a safe margin.",
  "补全照片边缘被截断的主体，画面外细节由AI推测；开启自动优化可检查完整性。":
    "Complete subjects cut off at the photo edges. AI estimates missing details; auto optimization can check completeness.",
  主体保留要求: "Subject preservation instructions",
  "例如：保留所有人物和宠物；保留手中的花束；保留骑手、马匹与缰绳；去掉桌椅等无关物体（最多1600字）":
    "Examples: keep all people and pets; retain the bouquet; keep the rider, horse and reins; remove unrelated tables and chairs (up to 1,600 characters).",
  参数设置: "Settings",
  原照: "Source image",
  上传单张原图: "Upload a source image",
  替换原图: "Replace source image",
  "替换原图将开始独立任务；当前原照、结果和参数保留在任务历史中。":
    "Replacing the source starts a separate task. Current images, results and settings remain in history.",
  "生成黑白 Logo": "Generate monochrome logo",
  补充提示词再生成一张: "Generate another with extra instructions",
  "补充提示词，再生成一张": "Generate another with extra instructions",
  补充提示词: "Additional instructions",
  再生成一张: "Generate another",
  停止后续步骤: "Stop further steps",
  停止此任务: "Stop this task",
  "使用原照与当前风格参考生成一张新图，不覆盖已有结果，也不启动自动循环。":
    "Generate a new image from the source and current style reference. Existing results are preserved and no automatic loop is started.",
  "生成失败，已保留可用结果": "Generation failed; available results preserved",
  已中断: "Interrupted",
  "准备生成图片…": "Preparing generation…",
  生成结果: "Results",
  清空结果: "Clear results",
  下载选中: "Download selected",
  下载全部: "Download all",
  取消选择: "Deselect all",
  全部生成图片: "All generated images",
  查看全部生成图片: "View all generated images",
  生成结果放大: "Enlarged result",
  原照对比: "Source comparison",
  封面生成结果: "Cover result",
  生成过程预览: "Generation preview",
  查看所有生成版本: "View all versions",
  未评分: "Not scored",
  未审核: "Not reviewed",
  已采用: "Selected cover",
  采用此图: "Use as cover",
  "原审核分数，调整后未重新审核":
    "Score from the original review; edits have not been reviewed again.",
  编辑图片: "Edit image",
  调节单张参数: "Adjust image settings",
  单张参数设置: "Image settings",
  参数自动保存: "Settings saved automatically",
  放大实时预览: "Enlarge live preview",
  单张实时预览: "Live image preview",
  "正在计算预览…": "Rendering preview…",
  "预览失败，点击查看": "Preview failed; click to inspect",
  "正在更新预览…": "Updating preview…",
  预览已更新: "Preview updated",
  "正在计算高清预览…": "Rendering full-resolution preview…",
  查看生成图: "View result",
  裁剪: "Crop",
  添加文字: "Add text",
  重置裁剪: "Reset crop",
  纹理: "Texture",
  对比度: "Contrast",
  暗部细节: "Shadow detail",
  亮度: "Brightness",
  黑底清理: "Black background cleanup",
  主体反相: "Invert subject",
  重置雕刻参数: "Reset engraving settings",
  擦除校正: "Erase background",
  单张输出模式: "Image output mode",
  灰度: "Grayscale",
  二值点阵: "Black-and-white dither",
  达到目标评分: "Target score reached",
  审核修改意见: "Review suggestions",
  无额外修改意见: "No additional suggestions",
  "AI 原始返回图、提示词与审核详情":
    "AI source image, prompt and review details",
  "AI 原始返回图（未调参）": "AI source image (before adjustments)",
  "AI 原始返回图": "AI source image",
  实际提示词: "Submitted prompt",
  旧任务未记录实际提示词: "The prompt was not recorded for this older task",
  初始参数: "Initial settings",
  本地调参: "Local adjustments",
  "AI 生图": "AI generation",
  "常用 DPI": "Common DPI values",
  裁剪比例: "Crop aspect ratio",
  自由比例: "Free aspect ratio",
  应用裁剪: "Apply crop",
  取消裁剪: "Cancel crop",
  "拖动框内移动，拖动右下角调整大小，框外拖动重新框选。原始文件不会被修改。":
    "Drag inside to move, drag the lower-right corner to resize, or drag outside to draw a new crop. The source file stays unchanged.",
  裁剪画布: "Crop canvas",
  背景擦除校正: "Background eraser",
  应用校正: "Apply correction",
  "涂抹多余环境或残留亮点，标记区域将变为纯黑，不参与雕刻。可撤销最近 10 笔。":
    "Paint over unwanted background or bright spots to turn them black and exclude them from engraving. Undo up to 10 strokes.",
  "无法载入蒙版，请清空重新绘制。":
    "Cannot load the mask. Clear it and paint again.",
  待擦除生成图: "Image to erase",
  擦除画布: "Erasing canvas",
  添加文字与画布排版: "Text and canvas layout",
  清除文字与排版: "Clear text and layout",
  适应窗口: "Fit to window",
  拖动画布: "Pan canvas",
  画布工具: "Canvas tools",
  选择与移动: "Select and move",
  添加文本图层: "Add text layer",
  黑色画笔: "Black brush",
  白色画笔: "White brush",
  橡皮擦: "Eraser",
  "橡皮擦（仅擦除画笔）": "Eraser (brush strokes only)",
  排版画布: "Layout canvas",
  画布下方设置: "Canvas toolbar",
  橡皮擦大小: "Eraser size",
  画笔大小: "Brush size",
  文字内容: "Text content",
  文字工具: "Text tools",
  文字颜色: "Text color",
  描边颜色: "Outline color",
  文字加粗: "Bold text",
  文字水平居中: "Center text horizontally",
  "文字超出文本框，请扩大文本框或减小字号后应用。":
    "Text exceeds its box. Enlarge the box or reduce the font size before applying.",
  画布: "Canvas",
  画布宽度: "Canvas width",
  画布高度: "Canvas height",
  图层: "Layers",
  图层列表: "Layer list",
  "从上到下为从前到后；拖动文字图层左侧手柄排序。":
    "Top layers appear in front. Drag the handle on the left to reorder text layers.",
  "上下拖动排序，也可用方向键调整":
    "Drag up or down to reorder, or use the arrow keys",
  删除文本图层: "Delete text layer",
  空文字: "Empty text",
  图片图层: "Image layer",
  底层: "Background layer",
  图片位置: "Image position",
  文字位置: "Text position",
  缩放图片: "Scale image",
  缩放文字: "Scale text",
  图片参数: "Image settings",
  "图片 X": "Image X",
  "图片 Y": "Image Y",
  图片宽度: "Image width",
  图片水平居中: "Center image horizontally",
  文字参数: "Text settings",
  "文字 X": "Text X",
  "文字 Y": "Text Y",
  文字宽度: "Text width",
  文字高度: "Text height",
  字号: "Font size",
  行距倍数: "Line height",
  字距: "Letter spacing",
  描边宽度: "Outline width",
  字体: "Font",
  字体分类: "Font category",
  全部字体: "All fonts",
  手写: "Handwriting",
  衬线: "Serif",
  无衬线: "Sans serif",
  标题: "Display",
  等宽: "Monospace",
  本机导入: "Imported fonts",
  读取本机字体: "Read local fonts",
  上传字体: "Upload font",
  本机字体: "Local fonts",
  选择需要缓存的本机字体: "Select a local font to cache",
  "内置字体可免费商用；本机字体请确认使用许可。字体仅保存在本机。":
    "Bundled fonts allow commercial use. Check licenses for local fonts. Fonts are stored only on this device.",
  "加载字体样例…": "Loading font sample…",
  "此浏览器不支持读取本机字体，请上传字体文件。":
    "This browser cannot read local fonts. Upload a font file instead.",
  "未获准读取本机字体，可上传字体文件。":
    "Local font access was denied. You can upload a font file instead.",
  "字体文件最多10MB。": "Font files must be 10 MB or smaller.",
  尺寸单位: "Size units",
  "毫米＋DPI": "Millimeters + DPI",
  像素宽度: "Pixel width",
  "宽度（mm）": "Width (mm)",
  "宽度（px）": "Width (px)",
  "边距（mm）": "Margin (mm)",
  "边距（px）": "Margin (px)",
  输出宽度: "Output width",
  输出边距: "Output margin",
  "高度按裁剪后比例计算。完整尺寸从 AI 原图重新处理，不放大预览图。上限 8192px / 2400 万像素。":
    "Height follows the cropped aspect ratio. Full-size output is rendered from the AI source, not enlarged from a preview. Limits: 8,192 px per side / 24 megapixels.",
  确定并下载: "Confirm and download",
  "下载已准备好。": "Download is ready.",
  "无法保存下载设置，本次下载不受影响。":
    "Cannot save download settings. This download is unaffected.",
  雕刻预览: "Engraving preview",
  雕刻预览格式: "Engraving preview format",
  下载雕刻用图: "Download engraving image",
  "3D预览": "3D preview",
  高质量3D预览: "High-quality 3D preview",
  黑白点阵: "Black-and-white dither",
  连续灰度: "Continuous grayscale",
  "白色雕刻 · 黑色不雕刻": "White is engraved · Black is not engraved",
  "材质模拟，实际效果取决于设备与玻璃。点击图片可放大，滚轮缩放并拖动查看。":
    "Material simulation; actual results depend on the laser and glass. Click to enlarge, scroll to zoom and drag to pan.",
  "正在按最终输出尺寸计算预览…":
    "Rendering preview at final output resolution…",
  激光雕刻用图: "Laser engraving image",
  透明玻璃雕刻模拟: "Clear glass engraving simulation",
  玻璃预览生成失败: "Glass preview failed",
  预览生成失败: "Preview failed",
  复位: "Reset view",
  "新窗口被拦截，请允许弹窗后重试，或下载图片后手动导入。":
    "Popup blocked. Allow popups and retry, or download the image and import it manually.",
  "正在应用雕刻贴图…": "Applying engraving texture…",
  "3D预览已打开，雕刻贴图已自动导入。":
    "3D preview opened. Engraving texture imported automatically.",
  "3D导入失败，请重试或下载图片后手动导入。":
    "3D import failed. Retry or download the image and import it manually.",
  "3D窗口已关闭，可重新打开。": "3D window closed. You can open it again.",
  "3D导入超时，请重试或下载图片后手动导入。":
    "3D import timed out. Retry or download the image and import it manually.",
  "等待3D工作台就绪…": "Waiting for the 3D studio…",
  准备风格参考: "Preparing style reference",
  风格参考加载失败: "Could not load style reference",
  "本轮生图完成，正在处理最终图":
    "Generation complete; processing the final image",
  "已停止，未提交生成请求": "Stopped before submitting generation",
  正在生成图片: "Generating image",
  "已停止，已返回图片已保存": "Stopped; returned images saved",
  "生成完成，请人工检查": "Generation complete. Please inspect the result.",
  已停止后续步骤并保留可用结果:
    "Further steps stopped; available results preserved",
  "处理失败。": "Processing failed.",
  "请填写图像模型和审核模型。": "Enter both an image model and a review model.",
  "请先停止生成并等待图片导入完成。":
    "Stop generation and wait for image imports to finish first.",
  "已停止。已收到的结果保留；已提交请求可能仍由服务端处理或计费。":
    "Stopped. Received results are preserved; submitted requests may still be processed or billed.",
  已停止后续调试: "Further optimization stopped",
  "已停止，未提交下一次生图": "Stopped before submitting the next generation",
  "已停止，保留现有结果": "Stopped; existing results preserved",
  "已停止，保留最好的一版": "Stopped; best version preserved",
  "已达目标评分，已停止优化；请人工确认后雕刻":
    "Target score reached. Optimization stopped; inspect the image before engraving.",
  "已达轮数上限，未达标；保留综合最佳的一版供手动调整":
    "Round limit reached without meeting the target. The best version is preserved for manual adjustments.",
  "自动调试已停止，保留已生成图片":
    "Auto optimization stopped; generated images preserved",
  "本地处理或保存失败，请检查浏览器存储和图片。":
    "Local processing or saving failed. Check browser storage and the image.",
  重新生成: "Regenerating",
  生成图片: "Generating image",
  图片已保存: "Image saved",
  本地调参并检查: "Adjusting locally and reviewing",
  检查效果: "Reviewing image",
  检查通过: "Review passed",
  发现待改进项: "Improvements needed",
  "自动调试轮数必须为 1–10，默认 5 轮。":
    "Auto optimization requires 1–10 rounds; the default is 5.",
  "目标评分必须为 70–95。": "Target score must be between 70 and 95.",
  "本地图像处理超时，请降低输出尺寸或DPI后重试。未重新请求AI。":
    "Local image processing timed out. Reduce output size or DPI and retry. No new AI request was sent.",
  "图像处理返回的数据无效，请重试本地预览。":
    "Image processing returned invalid data. Retry the local preview.",
  "本地图像处理线程中断。请降低输出尺寸或DPI；若页面刚更新，请在保存结果后刷新。":
    "Local image processing was interrupted. Reduce output size or DPI. If the page was updated, save your results before refreshing.",
  "本地图像数据传递失败，请降低输出尺寸后重试。":
    "Local image transfer failed. Reduce output size and retry.",
  "无法读取任务历史，请先下载当前结果。":
    "Cannot read task history. Download current results first.",
  "已恢复为本标签的独立副本，不影响其他标签；不会自动生成。":
    "Restored as an independent copy in this tab. Other tabs are unaffected and generation will not start automatically.",
  "恢复历史失败，请保留当前页面并先下载结果。":
    "History restoration failed. Keep this page open and download your results first.",
  "本地保存失败（可能存储空间不足或浏览器禁止存储）。当前结果仍在内存，请及时下载；刷新可能丢失。":
    "Local save failed, possibly due to storage limits or permissions. Results remain in memory; download them before refreshing.",
  "无法恢复本地任务，请检查浏览器 IndexedDB 权限。":
    "Cannot restore the local task. Check browser IndexedDB permissions.",
  "设置无法写入本地存储。": "Cannot save settings to local storage.",
  "本地任务保存失败，请先下载结果。":
    "Could not save the local task. Download your results first.",
  "各标签独立保存。恢复会创建副本，当前任务仍保留在历史中；历史仅保存在此浏览器。":
    "Tabs save independently. Restoring creates a copy and keeps the current task in history. History is stored only in this browser.",
  "暂无保存的任务。": "No saved tasks.",
  未命名任务: "Untitled task",
  恢复副本: "Restore copy",
  清空历史结果: "Clear saved results",
  确认清空: "Confirm clear",
  "历史生成结果及审核记录已清空，无法撤销。原照、风格参考和全局生成统计已保留。":
    "Saved results and reviews cleared permanently. Source images, style references and global generation counts are preserved.",
  "清空失败，历史结果仍保留，请检查本地存储权限后重试。":
    "Clear failed. History is preserved. Check local storage permissions and retry.",
  "将删除当前工具本地保存的全部生成图片、逐图参数、裁剪、擦除蒙版及审核记录，清空后无法恢复。请先下载需要保留的图片。":
    "This permanently deletes locally saved generated images, individual settings, crops, erase masks and reviews for this tool. Download images you want to keep first.",
  "保留原照、风格参考、生成配置和全局生成张数统计。":
    "Source images, style references, generation settings and global generation counts are preserved.",
  "刷新前任务已中断，已恢复保存结果；不会自动重发请求。":
    "The task was interrupted by a refresh. Saved results restored; requests will not be resent automatically.",
  已选: "Selected",
  张: "images",
  "张原照 ·": "source images ·",
  "张结果 ·": "results ·",
  耗时: "Elapsed",
  秒: "s",
  生图: "Generations",
  "次 · 审核": "· Reviews",
  次: "times",
  "尺寸单位：设计像素": "Units: design pixels",
  "% · 尺寸单位：设计像素": "% · Units: design pixels",
  第: "Version",
  "轮 ·": "round ·",
  "分 ·": "points ·",
  "生成结果 ·": "Results ·",
  "下载成功部分（": "Download successful images (",
  "张）": "images)",
  "查看全部生成图片（": "View all generated images (",
  "）": ")",
  重置: "Reset",
  应用: "Apply",
  撤销: "Undo",
  清空: "Clear",
  保存: "Save",
  已完成: "Completed",
  等待生成: "Waiting",
  已停止: "Stopped",
  已取消: "Cancelled",
  生成失败: "Generation failed",
  "上传失败。": "Upload failed.",
};

Object.assign(messages, {
  "请先在全局 API Key 设置中填写 OpenAI / GPT 密钥。":
    "Enter your OpenAI / GPT key in global API Key settings first.",
  "请求超时，未自动重试。服务端可能仍在处理，请检查账单后手动操作。":
    "Request timed out without retrying. The server may still be processing it. Check billing before retrying manually.",
  "无法连接兼容 API：请检查地址、HTTPS、网络和服务端 CORS（需允许当前网页来源及 Authorization）。未自动重试。":
    "Cannot connect to the compatible API. Check the URL, HTTPS, network and server CORS permissions for this origin and Authorization. No automatic retry was made.",
  "请输入图片模型名称。": "Enter an image model name.",
  "当前模型不支持此生成质量，请选择 high 或更低档位。":
    "This model does not support the selected quality. Choose high or lower.",
  "扩图要求最多800字。":
    "Image extension instructions are limited to 800 characters.",
  "持续优化缺少原照参考。":
    "The original image is missing for continued editing.",
  "图像服务返回错误，未自动重试。":
    "The image service returned an error. No automatic retry was made.",
  "图片编辑接口未返回最终图片，未自动重试。请查看服务返回详情。":
    "The image editing API returned no final image. No automatic retry was made. Check the service response details.",
  "自动审核未完成，已保留图片且未自动重试。":
    "Automatic review did not complete. Images were preserved and no automatic retry was made.",
  "模型拒绝本次审核，已保留图片。":
    "The model declined the review. Images were preserved.",
  审核失败: "Review failed",
  "API 返回内容为空。": "The API returned an empty response.",
  "API 返回内容过大。": "The API response is too large.",
  密钥无效: "Invalid API key",
  权限不足: "Insufficient permissions",
  额度不足或限流: "Quota exceeded or rate limited",
  模型暂不可用: "Model temporarily unavailable",
  "照片雕刻工作台 · 保留主体细节，输出适合黑色涂层的灰度或点阵 PNG":
    "Photo engraving studio · Preserve subject details and export grayscale or dithered PNG for dark coatings",
  "JPEG / PNG / WebP · ≤20 MB · ≤4000 万像素":
    "JPEG / PNG / WebP · ≤20 MB · ≤40 megapixels",
  上传客户照片后开始制作: "Upload a customer photo to begin",
  生成结果将在此显示: "Generated results will appear here",
  "保留主体细节，输出雕刻效果":
    "Preserve subject details and create engraving artwork",
  人物雕刻: "Portrait engraving",
  双人雕刻: "Couple engraving",
  人物与花束: "Person with bouquet",
  当前风格参考图: "Current style reference",
  "用于 AI 风格对照，不复制参考人物。内置素材随网页公开分发。":
    "Used only as an AI style guide, not to copy the reference subjects. Bundled references are distributed publicly with this site.",
  上传风格参考图: "Upload style reference",
  恢复内置风格参考: "Restore bundled reference",
  "本地数据库被其他页面占用，请关闭旧页面后刷新。":
    "The local database is in use by another page. Close older pages and refresh.",
  "本地存储失败，请下载结果。":
    "Local storage failed. Please download your results.",
  "无效任务。": "Invalid task.",
  "该历史任务已不可用。": "This history entry is no longer available.",
  "图像 Worker 运行失败，请使用新版 Chrome/Edge。":
    "Image worker failed. Please use a recent version of Chrome or Edge.",
  正在生成的图片: "Image being generated",
  "图片完成后将在此显示，已有结果仍可查看。":
    "The image will appear here when complete. Existing results remain available.",
});

export function translateEngravingText(value: string): string | undefined {
  const text = value.trim().replace(/\s+/g, " ");
  const exact =
    messages[text] ||
    messages[text.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "")];
  if (exact) return value.replace(value.trim(), exact);
  const patterns: [RegExp, string][] = [
    [
      /^查看全部生成图片\s*[（(]\s*(\d+)\s*[）)]$/,
      "View all generated images ($1)",
    ],
    [/^已生成 (\d+) 张$/, "Generated $1 images"],
    [/^第 (\d+) 次生成中$/, "Generating · attempt $1"],
    [
      /^第 (\d+) 张 · (未评分|[\d.]+ 分) · 共 (\d+) 张$/,
      "Version $1 · $2 · $3 images",
    ],
    [/^第 (\d+)\/(\d+) 轮：(.+)$/, "Round $1/$2: $3"],
    [/^基于第 (\d+) 版继续优化$/, "Continuing from version $1"],
    [/^选择输出尺寸 · (\d+) 张$/, "Output size · $1 images"],
    [
      /^生成中 · 已收到 (\d+) 张中间预览$/,
      "Generating · $1 intermediate previews received",
    ],
    [/^准备生成 (\d+) 张原照的任务$/, "Preparing tasks for $1 source images"],
    [/^已处理 (\d+) \/ (\d+) 个任务$/, "Processed $1 / $2 tasks"],
    [
      /^已清理可删除历史；跳过 (\d+) 个正在使用的任务。$/,
      "Inactive history cleared; skipped $1 active tasks.",
    ],
    [/^(选择结果|删除原照) (.+)$/, "$1 $2"],
    [/^(拖动图层|删除文本图层) (.+)$/, "$1 $2"],
    [/^(放大图片|选择图片|生成结果) (\d+)$/, "$1 $2"],
    [/^图片 (\d+)：(.*)$/, "Image $1: $2"],
    [/^(单张)?(纹理|对比度|暗部细节|亮度|黑底清理)$/, "$2"],
    [/^(.+)滑动条$/, "$1 slider"],
  ];
  for (const [pattern, replacement] of patterns) {
    if (!pattern.test(text)) continue;
    let out = text.replace(pattern, replacement);
    const terms: Record<string, string> = {
      ...messages,
      选择结果: "Select result",
      删除原照: "Remove source image",
      拖动图层: "Move layer",
      删除文本图层: "Delete text layer",
      放大图片: "Enlarge image",
      选择图片: "Select image",
    };
    // Only translate known UI fragments, never user filenames or layer contents.
    if (/^(选择结果|删除原照|拖动图层|删除文本图层) /.test(text)) {
      const split = text.indexOf(" ");
      return terms[text.slice(0, split)] + text.slice(split);
    }
    if (text.startsWith("第 ") && text.includes(" 轮：")) {
      const phase = text.slice(text.indexOf("：") + 1);
      return out.replace(phase, translateEngravingText(phase) ?? phase);
    }
    out = out.replace(/([\d.]+) 分/g, "$1 points");
    for (const [key, english] of Object.entries(terms).sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      if (key.length > 1) out = out.replaceAll(key, english);
    }
    return out;
  }
  return undefined;
}
