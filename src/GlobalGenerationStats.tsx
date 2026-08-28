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
        <Statistic title="累计成功生成" value={stats.total} suffix="张" />
        {stats.updatedAt ? (
          <Text type="secondary" className="global-generation-stats-time">
            最近生成
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
            <List.Item extra={<Tag color="purple">{item.count} 张</Tag>}>
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
          description="还没有成功生成的图片"
        />
      )}
      <Divider />
      <Flex justify="space-between" align="center" gap={12}>
        <Text type="secondary">数据仅保存在当前浏览器或桌面客户端。</Text>
        <Popconfirm
          title="清空本机生成统计？"
          description="该操作不会删除生成结果。"
          okText="清空"
          cancelText="取消"
          onConfirm={resetGenerationStats}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!stats.total}
          >
            清空
          </Button>
        </Popconfirm>
      </Flex>
    </div>
  );

  return (
    <Popover title="AI 生成图片统计" content={content} trigger="click">
      <Button
        icon={<BarChartOutlined />}
        aria-label={`AI 累计生成 ${stats.total} 张图片`}
        title="查看各模型累计生成张数"
      >
        已生成 {stats.total} 张
      </Button>
    </Popover>
  );
}
