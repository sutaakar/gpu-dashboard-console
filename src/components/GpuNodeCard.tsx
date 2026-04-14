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
import { GpuNodeData, GpuWorkload, getResourceConsolePath } from '../utils/gpu-utils';
import './gpu-node-card.css';

/** A renderable item inside a CQ group — either a workload span or a single free slot */
interface GridItem {
  key: string;
  type: 'workload' | 'free';
  workload: GpuWorkload | null;
  gpus: number;
}

/** A CQ group with its items */
interface CqGroup {
  name: string;
  displayName: string;
  type: 'queue' | 'available';
  items: GridItem[];
  totalGpus: number;
  color: string;
}

const QUEUE_COLOR_PALETTE: Record<string, string> = {
  Unassigned: '#95a5a6',
};

function getQueueColor(name: string, queueNames: string[]): string {
  if (QUEUE_COLOR_PALETTE[name]) return QUEUE_COLOR_PALETTE[name];
  const idx = queueNames.indexOf(name);
  return `hsl(${((idx >= 0 ? idx : 0) * 137.5) % 360}, 60%, 55%)`;
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const totalGpus = node.capacity || 1;

  // Collect unique queue names for consistent coloring
  const queueNames = Array.from(
    new Set(node.workloadGPUs.map((wl) => wl.clusterQueue)),
  ).sort();

  // Group workloads by ClusterQueue
  const queueMap: Record<string, GpuWorkload[]> = {};
  node.workloadGPUs.forEach((wl) => {
    if (!queueMap[wl.clusterQueue]) queueMap[wl.clusterQueue] = [];
    queueMap[wl.clusterQueue].push(wl);
  });

  // Deduplicate workloads: multiple pods from the same owner should merge
  // (each entry in workloadGPUs is one pod, but we want one bar per unique owner)
  function deduplicateWorkloads(workloads: GpuWorkload[]): GridItem[] {
    const merged = new Map<string, { wl: GpuWorkload; totalGpus: number }>();
    workloads.forEach((wl) => {
      const key = `${wl.namespace}/${wl.resourceType}/${wl.resourceName}`;
      const existing = merged.get(key);
      if (existing) {
        existing.totalGpus += wl.gpus;
      } else {
        merged.set(key, { wl, totalGpus: wl.gpus });
      }
    });
    return Array.from(merged.entries()).map(([key, { wl, totalGpus }]) => ({
      key,
      type: 'workload' as const,
      workload: { ...wl, gpus: totalGpus },
      gpus: totalGpus,
    }));
  }

  // Build CQ groups
  const cqGroups: CqGroup[] = queueNames.map((qName) => {
    const items = deduplicateWorkloads(queueMap[qName] || []);
    const groupTotal = items.reduce((s, it) => s + it.gpus, 0);
    return {
      name: qName,
      displayName: `CQ: ${qName} (${groupTotal} GPU${groupTotal !== 1 ? 's' : ''})`,
      type: 'queue' as const,
      items,
      totalGpus: groupTotal,
      color: getQueueColor(qName, queueNames),
    };
  });

  // Available group: individual free slots
  if (node.available > 0) {
    const freeItems: GridItem[] = [];
    for (let i = 0; i < node.available; i++) {
      freeItems.push({
        key: `free-${i}`,
        type: 'free',
        workload: null,
        gpus: 1,
      });
    }
    cqGroups.push({
      name: '__available__',
      displayName: `Available (${node.available} GPU${node.available !== 1 ? 's' : ''})`,
      type: 'available',
      items: freeItems,
      totalGpus: node.available,
      color: '#d0d7de',
    });
  }

  // Find selected item
  let selectedItem: GridItem | null = null;
  let selectedCq: string | null = null;
  if (selectedKey !== null) {
    for (const group of cqGroups) {
      const found = group.items.find((it) => it.key === selectedKey);
      if (found) {
        selectedItem = found;
        selectedCq = group.name;
        break;
      }
    }
  }

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

        {/* GPU Grid grouped by ClusterQueue */}
        <div className="gpu-grid-section">
          <div className="gpu-grid-title">GPU Allocation</div>

          {cqGroups.map((group) => (
            <div key={group.name} className="gpu-cq-group">
              {/* CQ header band */}
              <div
                className="gpu-cq-header"
                style={{
                  backgroundColor: group.color,
                  borderColor: group.color,
                }}
              >
                <span
                  className="gpu-cq-header-label"
                  style={group.type === 'available' ? { color: '#333', textShadow: 'none' } : undefined}
                >
                  {group.displayName}
                </span>
              </div>

              {/* Items row */}
              <div
                className="gpu-cq-cells"
                style={{ borderColor: group.color }}
              >
                {group.items.map((item) => {
                  const isFree = item.type === 'free';
                  const isFailing = item.workload?.failing || false;
                  const isSelected = selectedKey === item.key;
                  const bgColor = isFree
                    ? '#c8cdd2'
                    : isFailing
                      ? '#c9190b'
                      : resourceTypeColors[item.workload!.resourceType || 'Unknown'] || '#8b9eea';

                  // Width proportional to GPU count relative to total node GPUs
                  const widthPct = (item.gpus / totalGpus) * 100;

                  return (
                    <button
                      key={item.key}
                      className={[
                        'gpu-bar',
                        isFree ? 'gpu-bar--free' : '',
                        isFailing ? 'gpu-bar--failing' : '',
                        isSelected ? 'gpu-bar--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        backgroundColor: bgColor,
                        flexBasis: `${widthPct}%`,
                        flexGrow: 0,
                        flexShrink: 0,
                      }}
                      onClick={() =>
                        isFree
                          ? undefined
                          : setSelectedKey(isSelected ? null : item.key)
                      }
                      title={
                        isFree
                          ? 'Free'
                          : `${item.workload!.resourceType}/${item.workload!.resourceName} (${item.gpus} GPU${item.gpus !== 1 ? 's' : ''})`
                      }
                    >
                      {!isFree && (
                        <span className="gpu-bar-content">
                          <span className="gpu-bar-type">
                            {item.workload!.resourceType}
                          </span>
                          <span className="gpu-bar-gpus">
                            {item.gpus} GPU{item.gpus !== 1 ? 's' : ''}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Detail panel: shown when an item is clicked */}
          {selectedItem && selectedItem.workload && (
            <div className="gpu-detail-panel">
              <div className="gpu-detail-header">
                <span className="gpu-detail-type">
                  {selectedItem.workload.resourceType || 'Pod'}
                </span>
                <button
                  className="gpu-detail-close"
                  onClick={() => setSelectedKey(null)}
                >
                  &times;
                </button>
              </div>
              <div className="gpu-detail-name">
                <a
                  href={getResourceConsolePath(
                    selectedItem.workload.namespace,
                    selectedItem.workload.resourceType || 'Pod',
                    selectedItem.workload.resourceName || selectedItem.workload.name,
                    selectedItem.workload.resourceApiVersion || 'v1',
                  )}
                  className="gpu-detail-link"
                >
                  {selectedItem.workload.resourceName || selectedItem.workload.name}
                </a>
              </div>
              <div className="gpu-detail-row">
                <span className="gpu-detail-label">Namespace</span>
                <span>{selectedItem.workload.namespace}</span>
              </div>
              <div className="gpu-detail-row">
                <span className="gpu-detail-label">ClusterQueue</span>
                <span>{selectedCq === '__available__' ? '-' : selectedCq}</span>
              </div>
              <div className="gpu-detail-row">
                <span className="gpu-detail-label">GPUs</span>
                <span>
                  {selectedItem.workload.gpus} GPU
                  {selectedItem.workload.gpus !== 1 ? 's' : ''}
                </span>
              </div>
              {selectedItem.workload.failing && (
                <div className="gpu-detail-row gpu-detail-failing">
                  <span className="gpu-detail-label">Status</span>
                  <span>{selectedItem.workload.failureReason || 'Failing'}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
};

export default GpuNodeCard;
