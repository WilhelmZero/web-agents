import { BarChartOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  Button,
  Divider,
  Empty,
  Flex,
  List,
  Popconfirm,
  Popover,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useSyncExternalStore } from "react";
import { MODEL_CAPABILITIES } from "./constants";
import { useLanguage } from "./i18n";
import {
  getGenerationStatsSnapshot,
  resetGenerationStats,
  subscribeGenerationStats,
} from "./services/generationStats";
import type { ImageModel } from "./types";

const { Text } = Typography;

function modelLabel(model: string) {
  return model in MODEL_CAPABILITIES
    ? MODEL_CAPABILITIES[model as ImageModel].label
    : model;
}

export default function GlobalGenerationStats() {
  const { language } = useLanguage();
  const en = language === "en-US";
  const stats = useSyncExternalStore(
    subscribeGenerationStats,
    getGenerationStatsSnapshot,
    getGenerationStatsSnapshot,
  );
  const models = Object.entries(stats.byModel).sort(
    ([modelA, a], [modelB, b]) =>
      b.count - a.count || modelA.localeCompare(modelB),
  );

  const content = (
    <div className="global-generation-stats-panel">
      <Flex justify="space-between" align="end" gap={16}>
        <Statistic title={en ? "Images generated" : "累计成功生成"} value={stats.total} suffix={en ? undefined : "张"} />
        {stats.updatedAt ? (
          <Text type="secondary" className="global-generation-stats-time">
            {en ? "Last generated" : "最近生成"}
            <br />
            {new Date(stats.updatedAt).toLocaleString()}
          </Text>
        ) : null}
      </Flex>
      <Divider />
      {models.length ? (
        <List
          size="small"
          dataSource={models}
          renderItem={([model, item]) => (
            <List.Item extra={<Tag color="purple">{item.count} {en ? "images" : "张"}</Tag>}>
              <List.Item.Meta
                title={modelLabel(model)}
                description={
                  modelLabel(model) === model ? null : (
                    <Text type="secondary" copyable>
                      {model}
                    </Text>
                  )
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={en ? "No images generated yet" : "还没有成功生成的图片"}
        />
      )}
      <Divider />
      <Flex justify="space-between" align="center" gap={12}>
        <Text type="secondary">{en ? "These counts are stored only in this browser." : "数据仅保存在当前浏览器。"}</Text>
        <Popconfirm
          title={en ? "Clear local generation counts?" : "清空本机生成统计？"}
          description={en ? "This will not delete generated results." : "该操作不会删除生成结果。"}
          okText={en ? "Clear" : "清空"}
          cancelText={en ? "Cancel" : "取消"}
          onConfirm={resetGenerationStats}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!stats.total}
          >
            {en ? "Clear" : "清空"}
          </Button>
        </Popconfirm>
      </Flex>
    </div>
  );

  return (
    <Popover title={en ? "AI image generation counts" : "AI 生成图片统计"} content={content} trigger="click">
      <Button
        icon={<BarChartOutlined />}
        aria-label={en ? `AI generated ${stats.total} images in total` : `AI 累计生成 ${stats.total} 张图片`}
        title={en ? "View generated image counts by model" : "查看各模型累计生成张数"}
      >
        {en ? `Generated ${stats.total} images` : `已生成 ${stats.total} 张`}
      </Button>
    </Popover>
  );
}
