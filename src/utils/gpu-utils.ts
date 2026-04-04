import {
  K8sResourceCommon,
  k8sGet,
} from '@openshift-console/dynamic-plugin-sdk';

/** Kubernetes models used by the plugin */
export const NodeModel = {
  apiVersion: 'v1',
  apiGroup: '',
  kind: 'Node',
  plural: 'nodes',
  abbr: 'N',
  label: 'Node',
  labelPlural: 'Nodes',
  namespaced: false,
};

export const PodModel = {
  apiVersion: 'v1',
  apiGroup: '',
  kind: 'Pod',
  plural: 'pods',
  abbr: 'P',
  label: 'Pod',
  labelPlural: 'Pods',
  namespaced: true,
};

export const WorkloadModel = {
  apiVersion: 'v1beta1',
  apiGroup: 'kueue.x-k8s.io',
  kind: 'Workload',
  plural: 'workloads',
  abbr: 'WL',
  label: 'Workload',
  labelPlural: 'Workloads',
  namespaced: true,
};

export const ReplicaSetModel = {
  apiVersion: 'v1',
  apiGroup: 'apps',
  kind: 'ReplicaSet',
  plural: 'replicasets',
  abbr: 'RS',
  label: 'ReplicaSet',
  labelPlural: 'ReplicaSets',
  namespaced: true,
};

export const JobModel = {
  apiVersion: 'v1',
  apiGroup: 'batch',
  kind: 'Job',
  plural: 'jobs',
  abbr: 'J',
  label: 'Job',
  labelPlural: 'Jobs',
  namespaced: true,
};

export const StatefulSetModel = {
  apiVersion: 'v1',
  apiGroup: 'apps',
  kind: 'StatefulSet',
  plural: 'statefulsets',
  abbr: 'SS',
  label: 'StatefulSet',
  labelPlural: 'StatefulSets',
  namespaced: true,
};

/** Types */
export interface GpuWorkload {
  name: string;
  namespace: string;
  clusterQueue: string;
  gpus: number;
  podName: string;
  resourceType: string;
  resourceName: string;
  failing: boolean;
  failureReason: string | null;
}

export interface GpuNodeData {
  name: string;
  capacity: number;
  allocatable: number;
  requested: number;
  available: number;
  utilizationPercent: number;
  gpuProduct: string;
  gpuMemoryPerGPU: number;
  gpuUtilization: number | null;
  memUtilizationPercent: number | null;
  totalMemUsedMB: number | null;
  totalMemMB: number | null;
  isReady: boolean;
  workloadGPUs: GpuWorkload[];
  clusterQueueGPUs: Record<string, number>;
}

export interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

/** Failure reasons that indicate a pod is stuck, not just pending */
export const FAILING_REASONS = new Set([
  'ImagePullBackOff',
  'ErrImagePull',
  'CrashLoopBackOff',
  'CreateContainerConfigError',
  'InvalidImageName',
  'CreateContainerError',
  'RunContainerError',
]);

/** Color palette for resource types (consistent across nodes) */
export const RESOURCE_TYPE_COLORS = [
  '#8b9eea', '#ea8b8b', '#8bc5ea', '#eac18b', '#8beaa5',
  '#ea8bc5', '#c58bea', '#8beac5', '#eae28b', '#6b7ca0',
  '#6ba095', '#d39b70', '#c07b7b', '#7ba9c9', '#a07bc4',
];

/** Resolve a K8sModel from apiVersion + kind for owner traversal */
function getModelForOwner(
  apiVersion: string,
  kind: string,
): { apiGroup: string; apiVersion: string; kind: string; plural: string; namespaced: boolean } | null {
  if (kind === 'ReplicaSet') return { ...ReplicaSetModel, namespaced: true };
  if (kind === 'Job') return { ...JobModel, namespaced: true };
  if (kind === 'StatefulSet') return { ...StatefulSetModel, namespaced: true };

  // Custom resources — build model from apiVersion
  if (apiVersion.includes('/')) {
    const [group, version] = apiVersion.split('/');
    return {
      apiGroup: group,
      apiVersion: version,
      kind,
      plural: kind.toLowerCase() + 's',
      namespaced: true,
    };
  }
  return null;
}

/** Cache for owner reference lookups */
const ownerCache = new Map<string, { owner: { kind: string; name: string }; ts: number }>();
const OWNER_CACHE_TTL = 5 * 60 * 1000;

/**
 * Traverse owner references to find the top-level owner of a pod.
 * Uses k8sGet from the console SDK (authenticated via console proxy).
 */
export async function getTopLevelOwner(
  ownerRef: { apiVersion: string; kind: string; name: string },
  namespace: string,
): Promise<{ kind: string; name: string }> {
  const cacheKey = `${namespace}/${ownerRef.apiVersion}/${ownerRef.kind}/${ownerRef.name}`;
  const cached = ownerCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OWNER_CACHE_TTL) {
    return cached.owner;
  }

  let current = ownerRef;
  let depth = 0;

  while (depth < 10) {
    const model = getModelForOwner(current.apiVersion, current.kind);
    if (!model) break;

    try {
      const resource = (await k8sGet({
        model: { ...model, label: model.kind, labelPlural: model.plural, abbr: '' },
        name: current.name,
        ns: namespace,
      })) as K8sResourceCommon;

      const nextOwner = resource.metadata?.ownerReferences?.[0];
      if (nextOwner) {
        current = { apiVersion: nextOwner.apiVersion, kind: nextOwner.kind, name: nextOwner.name };
        depth++;
      } else {
        break;
      }
    } catch {
      // If we can't fetch the owner (permissions, not found), stop here
      break;
    }
  }

  const result = { kind: current.kind, name: current.name };
  ownerCache.set(cacheKey, { owner: result, ts: Date.now() });
  return result;
}

/** Get number of GPUs requested by a pod */
export function getPodGpuCount(pod: K8sResourceCommon & { spec?: { containers?: Array<{ resources?: { requests?: Record<string, string> } }> } }): number {
  let gpus = 0;
  pod.spec?.containers?.forEach((c) => {
    const req = c.resources?.requests?.['nvidia.com/gpu'];
    if (req) gpus += parseInt(req, 10);
  });
  return gpus;
}

/** Check if a pod is in a failing state */
export function getPodFailureReason(pod: K8sResourceCommon & {
  status?: {
    phase?: string;
    containerStatuses?: Array<{ state?: { waiting?: { reason?: string }; terminated?: { exitCode?: number; reason?: string } }; restartCount?: number }>;
    initContainerStatuses?: Array<{ state?: { waiting?: { reason?: string }; terminated?: { exitCode?: number; reason?: string } }; restartCount?: number }>;
  };
}): string | null {
  const phase = pod.status?.phase;
  if (phase === 'Running' || phase === 'Succeeded') return null;

  const statuses = [
    ...(pod.status?.containerStatuses || []),
    ...(pod.status?.initContainerStatuses || []),
  ];

  for (const cs of statuses) {
    if (cs.state?.waiting?.reason && FAILING_REASONS.has(cs.state.waiting.reason)) {
      return cs.state.waiting.reason;
    }
    if (cs.state?.terminated?.exitCode !== undefined && cs.state.terminated.exitCode !== 0) {
      return `Exit ${cs.state.terminated.exitCode}`;
    }
  }

  if (phase === 'Failed') return 'Failed';
  return null;
}

/** Check whether a pod should be counted (Running or failing, not Succeeded) */
export function isPodActive(pod: K8sResourceCommon & {
  status?: {
    phase?: string;
    containerStatuses?: Array<{ state?: { waiting?: { reason?: string } } }>;
    initContainerStatuses?: Array<{ state?: { waiting?: { reason?: string } } }>;
  };
}): boolean {
  const phase = pod.status?.phase;
  if (phase === 'Succeeded') return false;
  if (phase === 'Running' || phase === 'Failed') return true;

  const statuses = [
    ...(pod.status?.containerStatuses || []),
    ...(pod.status?.initContainerStatuses || []),
  ];
  return statuses.some(
    (cs) => cs.state?.waiting?.reason && FAILING_REASONS.has(cs.state.waiting.reason),
  );
}
