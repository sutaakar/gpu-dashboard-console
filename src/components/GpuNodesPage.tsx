import React, { useState } from 'react';
import {
  Page,
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
  Spinner,
  Alert,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import { useGpuNodeData } from '../hooks/useGpuNodeData';
import GpuNodeCard from './GpuNodeCard';
import './gpu-node-card.css';

const REFRESH_OPTIONS: { label: string; value: number | null }[] = [
  { label: '15 seconds', value: 15000 },
  { label: '30 seconds', value: 30000 },
  { label: '1 minute', value: 60000 },
  { label: '5 minutes', value: 300000 },
  { label: '15 minutes', value: 900000 },
  { label: '30 minutes', value: 1800000 },
  { label: '1 hour', value: 3600000 },
  { label: 'Off', value: null },
];

const GpuNodesPage: React.FC = () => {
  const [refreshInterval, setRefreshInterval] = useState<number | null>(30000);
  const [isRefreshOpen, setIsRefreshOpen] = useState(false);
  const { nodes, resourceTypeColors, loaded, error } = useGpuNodeData(refreshInterval);

  const selectedLabel =
    REFRESH_OPTIONS.find((o) => o.value === refreshInterval)?.label || '30 seconds';

  const onRefreshSelect = (_event: React.MouseEvent | undefined, value: string | number | undefined) => {
    const option = REFRESH_OPTIONS.find((o) => o.label === value);
    if (option !== undefined) {
      setRefreshInterval(option.value);
    }
    setIsRefreshOpen(false);
  };

  const refreshToggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={() => setIsRefreshOpen(!isRefreshOpen)}
      isExpanded={isRefreshOpen}
      className="gpu-refresh-toggle"
    >
      Refresh Interval: {selectedLabel}
    </MenuToggle>
  );

  if (!loaded) {
    return (
      <Page>
        <PageSection>
          <EmptyState>
            <Spinner size="xl" />
            <Title headingLevel="h4" size="lg">
              Loading GPU nodes...
            </Title>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageSection>
          <Alert variant="danger" title="Error loading GPU data">
            {error.message}
          </Alert>
        </PageSection>
      </Page>
    );
  }

  if (nodes.length === 0) {
    return (
      <Page>
        <PageSection>
          <Title headingLevel="h1" size="2xl">
            GPU Workloads
          </Title>
        </PageSection>
        <PageSection>
          <EmptyState>
            <Title headingLevel="h4" size="lg">
              No GPU nodes found
            </Title>
            <EmptyStateBody>
              No worker nodes with NVIDIA GPUs were detected in this cluster.
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  // Summary stats
  const totalGPUs = nodes.reduce((s, n) => s + n.capacity, 0);
  const totalRequested = nodes.reduce((s, n) => s + n.requested, 0);
  const totalAvailable = nodes.reduce((s, n) => s + n.available, 0);

  return (
    <Page>
      <PageSection variant="light">
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1" size="2xl">
                GPU Workloads
              </Title>
            </ToolbarItem>
            <ToolbarGroup align={{ default: 'alignRight' }}>
              <ToolbarItem>
                <span style={{ fontSize: 14, color: '#6a6e73', lineHeight: '36px' }}>
                  {nodes.length} node{nodes.length !== 1 ? 's' : ''} &middot;{' '}
                  {totalGPUs} total GPUs &middot;{' '}
                  {totalRequested} requested &middot;{' '}
                  {totalAvailable} available
                </span>
              </ToolbarItem>
              <ToolbarItem>
                <Select
                  isOpen={isRefreshOpen}
                  selected={selectedLabel}
                  onSelect={onRefreshSelect}
                  onOpenChange={setIsRefreshOpen}
                  toggle={refreshToggle}
                  shouldFocusToggleOnSelect
                >
                  <SelectList>
                    {REFRESH_OPTIONS.map((opt) => (
                      <SelectOption
                        key={opt.label}
                        value={opt.label}
                        isSelected={opt.value === refreshInterval}
                      >
                        {opt.label}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection>
        <div className="gpu-nodes-grid">
          {nodes.map((node) => (
            <GpuNodeCard
              key={node.name}
              node={node}
              resourceTypeColors={resourceTypeColors}
            />
          ))}
        </div>
      </PageSection>
    </Page>
  );
};

export default GpuNodesPage;
