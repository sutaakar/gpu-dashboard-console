import React, { useState } from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Label,
  Progress,
  ProgressMeasureLocation,
  ProgressVariant,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import { GpuNodeData, GpuWorkload } from '../utils/gpu-utils';
import './gpu-node-card.css';

interface QueueVisualization {
  type: 'queue' | 'available';
  name: string;
  workloads: GpuWorkload[];
  totalGPUs: number;
}

interface WorkloadLayout extends GpuWorkload {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QueueLayout extends QueueVisualization {
  x: number;
  y: number;
  width: number;
  height: number;
  workloadLayouts: WorkloadLayout[];
}

interface HoveredItem {
  type: 'queue' | 'workload';
  data: QueueVisualization | WorkloadLayout;
  queue?: string;
}

const QUEUE_COLOR_PALETTE: Record<string, string> = {
  Unassigned: '#95a5a6',
};

function getQueueColor(name: string, index: number): string {
  if (QUEUE_COLOR_PALETTE[name]) return QUEUE_COLOR_PALETTE[name];
  return `hsl(${(index * 137.5) % 360}, 60%, 55%)`;
}

function getProgressVariant(pct: number): ProgressVariant {
  if (pct >= 80) return ProgressVariant.danger;
  if (pct >= 50) return ProgressVariant.warning;
  return ProgressVariant.success;
}

interface GpuNodeCardProps {
  node: GpuNodeData;
  resourceTypeColors: Record<string, string>;
}

const GpuNodeCard: React.FC<GpuNodeCardProps> = ({ node, resourceTypeColors }) => {
  const [hoveredItem, setHoveredItem] = useState<HoveredItem | null>(null);

  // Build hierarchical data: ClusterQueues -> Workloads
  const clusterQueueMap: Record<string, GpuWorkload[]> = {};
  node.workloadGPUs.forEach((wl) => {
    if (!clusterQueueMap[wl.clusterQueue]) {
      clusterQueueMap[wl.clusterQueue] = [];
    }
    clusterQueueMap[wl.clusterQueue].push(wl);
  });

  const visualizationData: QueueVisualization[] = Object.entries(clusterQueueMap)
    .map(([queueName, workloads]) => ({
      type: 'queue' as const,
      name: queueName,
      workloads,
      totalGPUs: workloads.reduce((sum, wl) => sum + wl.gpus, 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (node.available > 0) {
    visualizationData.push({
      type: 'available',
      name: 'Available',
      workloads: [
        {
          name: 'Free GPUs',
          gpus: node.available,
          namespace: '',
          clusterQueue: '',
          podName: '',
          resourceType: '',
          resourceName: '',
          failing: false,
          failureReason: null,
        },
      ],
      totalGPUs: node.available,
    });
  }

  // SVG treemap layout
  const totalGPUs = node.capacity || 8;
  const chartWidth = 1000;
  const chartHeight = 500;
  const padding = 10;
  const headerHeight = 50;

  let currentY = padding;
  const layoutData: QueueLayout[] = visualizationData.map((queue, _qIdx) => {
    const queueHeight = Math.max(
      headerHeight + 80,
      (queue.totalGPUs / totalGPUs) * (chartHeight - padding * 2),
    );
    const queueWidth = chartWidth - padding * 2;

    const layout: QueueLayout = {
      ...queue,
      x: padding,
      y: currentY,
      width: queueWidth,
      height: queueHeight,
      workloadLayouts: [],
    };

    let currentX = padding + 5;
    const workloadHeight = queueHeight - headerHeight - 5;

    queue.workloads.forEach((wl) => {
      const workloadWidth = Math.max(30, (wl.gpus / queue.totalGPUs) * (queueWidth - 10));
      layout.workloadLayouts.push({
        ...wl,
        x: currentX,
        y: currentY + headerHeight,
        width: workloadWidth - 5,
        height: workloadHeight,
      });
      currentX += workloadWidth;
    });

    currentY += queueHeight + 5;
    return layout;
  });

  return (
    <Card className="gpu-node-card" isCompact>
      <CardTitle>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
          <FlexItem>
            <span className="gpu-node-name">{node.name}</span>
          </FlexItem>
          <FlexItem>
            <Label color={node.isReady ? 'green' : 'red'}>
              {node.isReady ? 'Ready' : 'Not Ready'}
            </Label>
          </FlexItem>
        </Flex>
        {node.gpuProduct && (
          <div className="gpu-product-label">
            {node.gpuProduct}
            {node.gpuMemoryPerGPU > 0 && ` (${node.gpuMemoryPerGPU} MB/GPU)`}
          </div>
        )}
      </CardTitle>
      <CardBody>
        {/* Stats */}
        <DescriptionList
          isCompact
          isHorizontal
          columnModifier={{ default: '2Col' }}
          className="gpu-stats-list"
        >
          <DescriptionListGroup>
            <DescriptionListTerm>Total GPUs</DescriptionListTerm>
            <DescriptionListDescription>{node.capacity}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Allocatable</DescriptionListTerm>
            <DescriptionListDescription>{node.allocatable}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Requested</DescriptionListTerm>
            <DescriptionListDescription>{node.requested}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Available</DescriptionListTerm>
            <DescriptionListDescription>{node.available}</DescriptionListDescription>
          </DescriptionListGroup>
          {node.gpuUtilization !== null && (
            <DescriptionListGroup>
              <DescriptionListTerm>GPU Utilization</DescriptionListTerm>
              <DescriptionListDescription>{node.gpuUtilization}%</DescriptionListDescription>
            </DescriptionListGroup>
          )}
          {node.totalMemMB !== null && node.totalMemMB > 0 && (
            <DescriptionListGroup>
              <DescriptionListTerm>GPU Memory</DescriptionListTerm>
              <DescriptionListDescription>
                {((node.totalMemUsedMB || 0) / 1024).toFixed(1)} /{' '}
                {(node.totalMemMB / 1024).toFixed(1)} GB
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>

        {/* Utilization bars */}
        <div className="gpu-progress-bars">
          <Progress
            value={node.utilizationPercent}
            title="GPU Allocation"
            variant={getProgressVariant(node.utilizationPercent)}
            measureLocation={ProgressMeasureLocation.outside}
            className="gpu-progress"
          />
          {node.gpuUtilization !== null && (
            <Progress
              value={node.gpuUtilization}
              title="GPU Compute Usage"
              variant={getProgressVariant(node.gpuUtilization)}
              measureLocation={ProgressMeasureLocation.outside}
              className="gpu-progress"
            />
          )}
          {node.memUtilizationPercent !== null && (
            <Progress
              value={node.memUtilizationPercent}
              title="GPU Memory Usage"
              variant={getProgressVariant(node.memUtilizationPercent)}
              measureLocation={ProgressMeasureLocation.outside}
              className="gpu-progress"
            />
          )}
        </div>

        {/* Treemap */}
        <div className="gpu-treemap-section">
          <div className="gpu-treemap-title">GPU Allocation — ClusterQueues &gt; Workloads</div>

          {/* Legend */}
          <div className="gpu-treemap-legend">
            {visualizationData
              .filter((q) => q.type !== 'available')
              .map((queue, idx) => {
                const color = getQueueColor(queue.name, idx);
                return (
                  <div key={queue.name} className="gpu-legend-item">
                    <div className="gpu-legend-box" style={{ backgroundColor: color }} />
                    <span>
                      CQ: {queue.name} ({queue.totalGPUs} GPU
                      {queue.totalGPUs !== 1 ? 's' : ''})
                    </span>
                  </div>
                );
              })}
            {visualizationData.some((q) => q.type === 'available') && (
              <div className="gpu-legend-item">
                <div className="gpu-legend-box" style={{ backgroundColor: '#d0d7de' }} />
                <span>Free GPUs</span>
              </div>
            )}
          </div>

          {/* SVG Treemap */}
          <div className="gpu-treemap-container">
            <svg
              width="100%"
              height="500"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="headerFade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="black" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="black" stopOpacity="0" />
                </linearGradient>
              </defs>

              {layoutData.map((queue, qIdx) => {
                const queueColor =
                  queue.type === 'available' ? '#d0d7de' : getQueueColor(queue.name, qIdx);

                return (
                  <g key={queue.name}>
                    {/* ClusterQueue background */}
                    <rect
                      x={queue.x}
                      y={queue.y}
                      width={queue.width}
                      height={queue.height}
                      fill={queueColor}
                      stroke={queueColor}
                      strokeWidth="6"
                      opacity="0.9"
                      onMouseEnter={() =>
                        setHoveredItem({ type: 'queue', data: queue })
                      }
                      onMouseLeave={() => setHoveredItem(null)}
                    />

                    {/* Workloads */}
                    {queue.workloadLayouts.map((wl) => {
                      const workloadColor = wl.failing
                        ? '#e74c3c'
                        : queue.type === 'available'
                          ? '#e8eaed'
                          : resourceTypeColors[wl.resourceType || 'Unknown'] || '#8b9eea';

                      return (
                        <g key={`${wl.podName || wl.name}`}>
                          <rect
                            x={wl.x}
                            y={wl.y}
                            width={wl.width}
                            height={wl.height}
                            fill={workloadColor}
                            stroke={queueColor}
                            strokeWidth="2"
                            opacity="0.95"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() =>
                              setHoveredItem({
                                type: 'workload',
                                data: wl,
                                queue: queue.name,
                              })
                            }
                            onMouseLeave={() => setHoveredItem(null)}
                          />
                          {wl.width > 40 && wl.height > 20 && (
                            <>
                              {queue.type !== 'available' && (
                                <text
                                  x={wl.x + wl.width / 2}
                                  y={wl.y + wl.height / 2 - 28}
                                  textAnchor="middle"
                                  fill="rgba(255,255,255,0.8)"
                                  fontSize="22"
                                  fontWeight="400"
                                >
                                  {wl.resourceType || 'Pod'}
                                </text>
                              )}
                              <text
                                x={wl.x + wl.width / 2}
                                y={wl.y + wl.height / 2 + 4}
                                textAnchor="middle"
                                fill={queue.type === 'available' ? '#333' : 'white'}
                                fontSize="26"
                                fontWeight="600"
                              >
                                {(wl.resourceName || wl.name).length > 22
                                  ? (wl.resourceName || wl.name).substring(0, 19) + '...'
                                  : wl.resourceName || wl.name}
                              </text>
                              <text
                                x={wl.x + wl.width / 2}
                                y={wl.y + wl.height / 2 + 34}
                                textAnchor="middle"
                                fill={
                                  queue.type === 'available' ? '#666' : 'rgba(255,255,255,0.85)'
                                }
                                fontSize="22"
                              >
                                {wl.gpus} GPU{wl.gpus !== 1 ? 's' : ''}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}

                    {/* CQ header band (on top of workloads) */}
                    <rect
                      x={queue.x}
                      y={queue.y}
                      width={queue.width}
                      height={75}
                      fill="url(#headerFade)"
                      pointerEvents="none"
                    />
                    <text
                      x={queue.x + 14}
                      y={queue.y + 34}
                      fill="white"
                      fontSize="28"
                      fontWeight="bold"
                      pointerEvents="none"
                    >
                      {queue.type === 'available' ? 'Available' : `CQ: ${queue.name}`}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Tooltip */}
            {hoveredItem && (
              <div className="gpu-treemap-tooltip">
                {hoveredItem.type === 'queue' ? (
                  <>
                    <div className="tooltip-label">
                      ClusterQueue: {(hoveredItem.data as QueueVisualization).name}
                    </div>
                    <div className="tooltip-detail">
                      Workloads: {(hoveredItem.data as QueueVisualization).workloads.length}
                    </div>
                    <div className="tooltip-value">
                      {(hoveredItem.data as QueueVisualization).totalGPUs} GPU
                      {(hoveredItem.data as QueueVisualization).totalGPUs !== 1 ? 's' : ''}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tooltip-label">
                      {(hoveredItem.data as WorkloadLayout).resourceType || 'Resource'}
                    </div>
                    <div className="tooltip-detail" style={{ fontWeight: 600 }}>
                      {(hoveredItem.data as WorkloadLayout).resourceName ||
                        (hoveredItem.data as WorkloadLayout).name}
                    </div>
                    {(hoveredItem.data as WorkloadLayout).namespace && (
                      <div className="tooltip-detail">
                        Namespace: {(hoveredItem.data as WorkloadLayout).namespace}
                      </div>
                    )}
                    <div className="tooltip-detail">ClusterQueue: {hoveredItem.queue}</div>
                    {(hoveredItem.data as WorkloadLayout).failing && (
                      <div className="tooltip-detail" style={{ color: '#c9190b', fontWeight: 600 }}>
                        Warning: {(hoveredItem.data as WorkloadLayout).failureReason}
                      </div>
                    )}
                    <div className="tooltip-value">
                      {(hoveredItem.data as WorkloadLayout).gpus} GPU
                      {(hoveredItem.data as WorkloadLayout).gpus !== 1 ? 's' : ''}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
};

export default GpuNodeCard;
