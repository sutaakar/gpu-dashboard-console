import { useState, useEffect, useRef, useMemo } from 'react';
import {
  useK8sWatchResource,
  K8sResourceCommon,
  consoleFetchJSON,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  GpuNodeData,
  GpuWorkload,
  PrometheusResult,
  RESOURCE_TYPE_COLORS,
  getTopLevelOwner,
  getPodGpuCount,
  getPodFailureReason,
  isPodActive,
} from '../utils/gpu-utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyK8s = K8sResourceCommon & Record<string, any>;

interface GpuNodeDataResult {
  nodes: GpuNodeData[];
  resourceTypeColors: Record<string, string>;
  loaded: boolean;
  error: Error | null;
}

/** Fetch Prometheus instant-query via the console proxy to thanos-querier */
async function queryPrometheus(query: string): Promise<PrometheusResult[]> {
  try {
    const url = `/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`;
    const data = await consoleFetchJSON(url);
    if (data?.status === 'success' && data.data?.result) {
      return data.data.result as PrometheusResult[];
    }
  } catch (err) {
    console.warn(`Prometheus query failed for "${query}":`, err);
  }
  return [];
}

/** Build per-node GPU metrics from Prometheus DCGM results */
function buildGpuMetrics(
  utilResults: PrometheusResult[],
  memUsedResults: PrometheusResult[],
  memFreeResults: PrometheusResult[],
): Record<string, { avgUtil: number; memUsed: number; memFree: number; memTotal: number; memUtilPct: number }> {
  const perNode: Record<string, { utils: number[]; memUsed: number; memFree: number }> = {};

  const getNode = (m: Record<string, string>) => m.Hostname || m.instance || 'unknown';

  utilResults.forEach((r) => {
    const node = getNode(r.metric);
    if (!perNode[node]) perNode[node] = { utils: [], memUsed: 0, memFree: 0 };
    perNode[node].utils.push(parseFloat(r.value[1]));
  });

  memUsedResults.forEach((r) => {
    const node = getNode(r.metric);
    if (!perNode[node]) perNode[node] = { utils: [], memUsed: 0, memFree: 0 };
    perNode[node].memUsed += parseFloat(r.value[1]);
  });

  memFreeResults.forEach((r) => {
    const node = getNode(r.metric);
    if (!perNode[node]) perNode[node] = { utils: [], memUsed: 0, memFree: 0 };
    perNode[node].memFree += parseFloat(r.value[1]);
  });

  const result: Record<string, { avgUtil: number; memUsed: number; memFree: number; memTotal: number; memUtilPct: number }> = {};
  Object.entries(perNode).forEach(([node, data]) => {
    const avgUtil = data.utils.length > 0
      ? data.utils.reduce((a, b) => a + b, 0) / data.utils.length
      : 0;
    const memTotal = data.memUsed + data.memFree;
    result[node] = {
      avgUtil: Math.round(avgUtil),
      memUsed: Math.round(data.memUsed),
      memFree: Math.round(data.memFree),
      memTotal: Math.round(memTotal),
      memUtilPct: memTotal > 0 ? Math.round((data.memUsed / memTotal) * 100) : 0,
    };
  });
  return result;
}

/** Process raw K8s data + Prometheus metrics into GpuNodeData[] */
async function processSnapshot(
  nodes: AnyK8s[],
  pods: AnyK8s[],
  workloads: AnyK8s[],
): Promise<{ nodes: GpuNodeData[]; colorMap: Record<string, string> }> {
  // Fetch Prometheus GPU metrics
  const [utilResults, memUsedResults, memFreeResults] = await Promise.all([
    queryPrometheus('DCGM_FI_DEV_GPU_UTIL'),
    queryPrometheus('DCGM_FI_DEV_FB_USED'),
    queryPrometheus('DCGM_FI_DEV_FB_FREE'),
  ]);
  const gpuMetrics = buildGpuMetrics(utilResults, memUsedResults, memFreeResults);

  // Build workload -> clusterQueue mapping
  const wlToQueue = new Map<string, string>();
  workloads.forEach((wl: AnyK8s) => {
    const key = `${wl.metadata?.namespace}/${wl.metadata?.name}`;
    wlToQueue.set(key, wl.status?.admission?.clusterQueue || 'Unknown');
  });

  // Filter to GPU worker nodes
  const gpuWorkerNodes = nodes.filter((n: AnyK8s) => {
    const labels = n.metadata?.labels || {};
    const isWorker = 'node-role.kubernetes.io/worker' in labels;
    const hasGpu = parseInt(n.status?.capacity?.['nvidia.com/gpu'] || '0', 10) > 0;
    return isWorker && hasGpu;
  });

  const allResourceTypes = new Set<string>();

  const processed: GpuNodeData[] = await Promise.all(
    gpuWorkerNodes.map(async (node: AnyK8s) => {
      const name = node.metadata?.name || '';
      const capacity = parseInt(node.status?.capacity?.['nvidia.com/gpu'] || '0', 10);
      const allocatable = parseInt(node.status?.allocatable?.['nvidia.com/gpu'] || '0', 10);
      const labels = node.metadata?.labels || {};
      const gpuProduct = labels['nvidia.com/gpu.product'] || 'Unknown GPU';
      const gpuMemoryPerGPU = parseInt(labels['nvidia.com/gpu.memory'] || '0', 10);

      const isReady = (node.status?.conditions || []).some(
        (c: { type: string; status: string }) => c.type === 'Ready' && c.status === 'True',
      );

      const nodePods = pods.filter(
        (p: AnyK8s) => p.spec?.nodeName === name && isPodActive(p),
      );

      let requested = 0;
      const clusterQueueGPUs: Record<string, number> = {};
      const workloadGPUs: GpuWorkload[] = [];

      await Promise.all(
        nodePods.map(async (pod: AnyK8s) => {
          const podGpus = getPodGpuCount(pod);
          if (podGpus <= 0) return;

          requested += podGpus;

          let resourceType = 'Pod';
          let resourceName = pod.metadata?.name || '';
          let resourceApiVersion = 'v1';
          const ownerRefs = pod.metadata?.ownerReferences;
          if (ownerRefs && ownerRefs.length > 0) {
            const topOwner = await getTopLevelOwner(
              ownerRefs[0],
              pod.metadata?.namespace || '',
            );
            resourceType = topOwner.kind;
            resourceName = topOwner.name;
            resourceApiVersion = topOwner.apiVersion;
          }
          allResourceTypes.add(resourceType);

          let clusterQueue = 'Unassigned';
          const podLabels = pod.metadata?.labels || {};
          const podAnnotations = pod.metadata?.annotations || {};
          const wlName =
            podLabels['kueue.x-k8s.io/workload-name'] ||
            podLabels['kueue.x-k8s.io/pod-group-name'] ||
            podAnnotations['kueue.x-k8s.io/workload'];
          if (wlName) {
            const wlKey = `${pod.metadata?.namespace}/${wlName}`;
            clusterQueue = wlToQueue.get(wlKey) || 'Unknown';
          }

          clusterQueueGPUs[clusterQueue] = (clusterQueueGPUs[clusterQueue] || 0) + podGpus;

          const failureReason = getPodFailureReason(pod);
          workloadGPUs.push({
            name: `${resourceType}/${resourceName}`,
            namespace: pod.metadata?.namespace || '',
            clusterQueue,
            gpus: podGpus,
            podName: pod.metadata?.name || '',
            resourceType,
            resourceName,
            resourceApiVersion,
            failing: failureReason !== null,
            failureReason,
          });
        }),
      );

      const available = allocatable - requested;
      const utilizationPercent = allocatable > 0 ? Math.round((requested / allocatable) * 100) : 0;
      const metrics = gpuMetrics[name];

      return {
        name,
        capacity,
        allocatable,
        requested,
        available,
        utilizationPercent,
        gpuProduct,
        gpuMemoryPerGPU,
        gpuUtilization: metrics?.avgUtil ?? null,
        memUtilizationPercent: metrics?.memUtilPct ?? null,
        totalMemUsedMB: metrics?.memUsed ?? null,
        totalMemMB: metrics?.memTotal ?? null,
        isReady,
        workloadGPUs,
        clusterQueueGPUs,
      };
    }),
  );

  const sorted = Array.from(allResourceTypes).sort();
  const colorMap: Record<string, string> = {};
  sorted.forEach((t, i) => {
    colorMap[t] = RESOURCE_TYPE_COLORS[i % RESOURCE_TYPE_COLORS.length];
  });

  return { nodes: processed, colorMap };
}

export function useGpuNodeData(refreshInterval: number | null = 30000): GpuNodeDataResult {
  const [gpuNodes, setGpuNodes] = useState<GpuNodeData[]>([]);
  const [resourceTypeColors, setResourceTypeColors] = useState<Record<string, string>>({});
  const hasLoadedOnce = useRef(false);
  const processingRef = useRef(false);

  // Refs to hold the latest watch data without triggering re-renders
  const nodesRef = useRef<AnyK8s[]>([]);
  const podsRef = useRef<AnyK8s[]>([]);
  const workloadsRef = useRef<AnyK8s[]>([]);

  // Watch K8s resources — updates go into refs only
  const [nodes, nodesLoaded, nodesError] = useK8sWatchResource<AnyK8s[]>({
    groupVersionKind: { group: '', version: 'v1', kind: 'Node' },
    isList: true,
  });

  const [pods, podsLoaded, podsError] = useK8sWatchResource<AnyK8s[]>({
    groupVersionKind: { group: '', version: 'v1', kind: 'Pod' },
    isList: true,
  });

  const [workloads, workloadsLoaded, workloadsError] = useK8sWatchResource<AnyK8s[]>({
    groupVersionKind: {
      group: 'kueue.x-k8s.io',
      version: 'v1beta1',
      kind: 'Workload',
    },
    isList: true,
    optional: true,
  });

  // Keep refs in sync with latest watch data
  useEffect(() => { nodesRef.current = nodes || []; }, [nodes]);
  useEffect(() => { podsRef.current = pods || []; }, [pods]);
  useEffect(() => { workloadsRef.current = workloads || []; }, [workloads]);

  const allLoaded = nodesLoaded && podsLoaded && (workloadsLoaded || workloadsError);
  const error = nodesError || podsError || null;

  // Track the number of GPU pods — re-process immediately when it changes
  const gpuPodCount = useMemo(() => {
    return (pods || []).filter((p: AnyK8s) => getPodGpuCount(p) > 0).length;
  }, [pods]);

  // Run a single processing pass reading from refs
  const runProcess = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const result = await processSnapshot(
        nodesRef.current,
        podsRef.current,
        workloadsRef.current,
      );
      setGpuNodes(result.nodes);
      setResourceTypeColors(result.colorMap);
      hasLoadedOnce.current = true;
    } catch (err) {
      console.error('Error processing GPU node data:', err);
    } finally {
      processingRef.current = false;
    }
  };

  // Initial load: process once when all watches are ready
  useEffect(() => {
    if (allLoaded && !hasLoadedOnce.current) {
      runProcess();
    }
  }, [allLoaded]);

  // Re-process when GPU pod count changes (catches late-arriving watch events)
  useEffect(() => {
    if (hasLoadedOnce.current && allLoaded) {
      runProcess();
    }
  }, [gpuPodCount]);

  // Periodic refresh: only trigger on the interval timer
  useEffect(() => {
    if (!allLoaded) return;
    if (refreshInterval === null || refreshInterval <= 0) return;
    const timer = setInterval(runProcess, refreshInterval);
    return () => clearInterval(timer);
  }, [allLoaded, refreshInterval]);

  return {
    nodes: gpuNodes,
    resourceTypeColors,
    loaded: hasLoadedOnce.current || allLoaded,
    error: error as Error | null,
  };
}
